# SPDX-License-Identifier: GPL-3.0-or-later
#
# Linden Engine Blender bridge runner.
# Copyright (C) 2026 Linden Engine Contributors
#
# This program is free software: you can redistribute it and/or modify it under the terms of the
# GNU General Public License as published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version. See LICENSE in this folder.
#
# Runs INSIDE the user's own Blender, started by Linden as a separate process:
#
#   blender -b --factory-startup -Y --offline-mode --python-exit-code 1 -P runner.py -- \
#       --spec spec.json --out out.glb
#   blender ... -P runner.py -- --script script.py --out out.glb
#
# Spec mode builds primitives + modifiers + PBR materials from a JSON spec (no eval/exec).
# Script mode executes an agent-written bpy script the user approved in Linden.
# Both modes apply all modifiers, put the objects on the ground (z = 0) and export a GLB.
# The summary is printed as one stdout line "LINDEN_RESULT:{json}"; failures print
# "LINDEN_ERROR:<message>" on stderr and exit with code 1.

import json
import math
import sys

import bpy
from mathutils import Matrix, Vector

RESULT_MARKER = "LINDEN_RESULT:"
ERROR_MARKER = "LINDEN_ERROR:"
MAX_TRIANGLES = 2_000_000

PRIMITIVES = {"cube", "uv_sphere", "cylinder", "cone", "torus", "plane"}
MODIFIERS = {"bevel", "subdivision", "solidify", "array", "mirror", "boolean"}
OBJECT_KEYS = {"name", "primitive", "params", "location", "rotation", "scale", "modifiers", "material", "smooth", "uv", "cutter"}
PARAM_KEYS = {
    "size", "radius", "radius1", "radius2", "depth", "segments", "rings", "vertices",
    "majorRadius", "minorRadius", "majorSegments", "minorSegments",
}


class SpecError(Exception):
    pass


def fail(message):
    sys.stderr.write(ERROR_MARKER + str(message).replace("\n", " ") + "\n")
    sys.stderr.flush()
    sys.exit(1)


def parse_args(argv):
    args = argv[argv.index("--") + 1:] if "--" in argv else []
    opts = {}
    i = 0
    while i < len(args):
        key = args[i]
        if key in ("--spec", "--script", "--out") and i + 1 < len(args):
            opts[key[2:]] = args[i + 1]
            i += 2
        else:
            raise SpecError("argumen tidak dikenal: %s" % key)
    if "out" not in opts or ("spec" in opts) == ("script" in opts):
        raise SpecError("pakai --out dengan tepat satu dari --spec atau --script")
    return opts


# ---------------------------------------------------------------- validation (defensive copy of
# shared/blenderSpec.ts; Linden validates first, this guards against a hand-written spec.json)

def num(value, where, lo=-1e6, hi=1e6):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise SpecError("%s harus angka" % where)
    if value < lo or value > hi:
        raise SpecError("%s di luar rentang %s..%s" % (where, lo, hi))
    return float(value)


def vec3(value, where, lo=-1000, hi=1000):
    if not isinstance(value, list) or len(value) != 3:
        raise SpecError("%s harus [x, y, z]" % where)
    return [num(v, "%s[%d]" % (where, i), lo, hi) for i, v in enumerate(value)]


def validate_spec(spec):
    if not isinstance(spec, dict) or not isinstance(spec.get("objects"), list) or not spec["objects"]:
        raise SpecError("spec.objects harus array tidak kosong")
    if len(spec["objects"]) > 64:
        raise SpecError("maksimal 64 objek")
    names = set()
    for i, obj in enumerate(spec["objects"]):
        where = "objects[%d]" % i
        if not isinstance(obj, dict):
            raise SpecError("%s harus object" % where)
        unknown = set(obj) - OBJECT_KEYS
        if unknown:
            raise SpecError("%s: key tidak dikenal %s" % (where, sorted(unknown)))
        name = obj.get("name")
        if not isinstance(name, str) or not name or len(name) > 48:
            raise SpecError("%s.name tidak valid" % where)
        if name in names:
            raise SpecError("nama %s dipakai lebih dari sekali" % name)
        names.add(name)
        if obj.get("primitive") not in PRIMITIVES:
            raise SpecError("%s.primitive harus salah satu %s" % (where, sorted(PRIMITIVES)))
        params = obj.get("params") or {}
        if not isinstance(params, dict) or set(params) - PARAM_KEYS:
            raise SpecError("%s.params tidak valid" % where)
        for k, v in params.items():
            num(v, "%s.params.%s" % (where, k), 0, 256)
        for mod in obj.get("modifiers") or []:
            if not isinstance(mod, dict) or mod.get("type") not in MODIFIERS:
                raise SpecError("%s.modifiers: type harus salah satu %s" % (where, sorted(MODIFIERS)))
    for obj in spec["objects"]:
        for mod in obj.get("modifiers") or []:
            if mod["type"] == "boolean" and (mod.get("with") not in names or mod.get("with") == obj["name"]):
                raise SpecError("boolean pada %s menunjuk objek yang tidak valid: %s" % (obj["name"], mod.get("with")))
    if all(obj.get("cutter") for obj in spec["objects"]):
        raise SpecError("minimal satu objek bukan cutter")


# ---------------------------------------------------------------- scene helpers

def reset_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights, bpy.data.curves):
        for block in list(coll):
            coll.remove(block)
    scene = bpy.context.scene
    for child in list(scene.collection.children):
        bpy.data.collections.remove(child)
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = "METERS"


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def parse_color(value, where):
    if isinstance(value, str) and len(value) == 7 and value.startswith("#"):
        try:
            rgb = [int(value[i:i + 2], 16) / 255.0 for i in (1, 3, 5)]
        except ValueError:
            raise SpecError("%s bukan warna hex" % where)
    else:
        rgb = vec3(value, where, 0, 1)
    # Colours in the spec are sRGB like a colour picker; Principled Base Color is linear
    return [srgb_to_linear(c) for c in rgb] + [1.0]


def make_material(name, spec):
    mat = bpy.data.materials.new(name)
    if bpy.app.version < (5, 0, 0):
        mat.use_nodes = True  # always on (and deprecated) from Blender 5.0
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        raise SpecError("Principled BSDF tidak tersedia")
    bsdf.inputs["Base Color"].default_value = parse_color(spec.get("baseColor"), name + ".baseColor")
    bsdf.inputs["Metallic"].default_value = num(spec.get("metallic", 0.0), name + ".metallic", 0, 1)
    bsdf.inputs["Roughness"].default_value = num(spec.get("roughness", 0.5), name + ".roughness", 0, 1)
    mat.diffuse_color = bsdf.inputs["Base Color"].default_value
    return mat


def add_primitive(kind, p):
    ops = bpy.ops.mesh
    if kind == "cube":
        ops.primitive_cube_add(size=p.get("size", 1.0))
    elif kind == "plane":
        ops.primitive_plane_add(size=p.get("size", 1.0))
    elif kind == "uv_sphere":
        ops.primitive_uv_sphere_add(radius=p.get("radius", 0.5), segments=int(p.get("segments", 32)), ring_count=int(p.get("rings", 16)))
    elif kind == "cylinder":
        ops.primitive_cylinder_add(radius=p.get("radius", 0.5), depth=p.get("depth", 1.0), vertices=int(p.get("vertices", 32)))
    elif kind == "cone":
        ops.primitive_cone_add(
            radius1=p.get("radius1", p.get("radius", 0.5)), radius2=p.get("radius2", 0.0),
            depth=p.get("depth", 1.0), vertices=int(p.get("vertices", 32)),
        )
    elif kind == "torus":
        ops.primitive_torus_add(
            major_radius=p.get("majorRadius", 0.5), minor_radius=p.get("minorRadius", 0.15),
            major_segments=int(p.get("majorSegments", 48)), minor_segments=int(p.get("minorSegments", 12)),
        )
    return bpy.context.active_object


def add_modifier(obj, mod, objects):
    kind = mod["type"]
    where = "%s.%s" % (obj.name, kind)
    if kind == "bevel":
        m = obj.modifiers.new("Bevel", "BEVEL")
        m.width = num(mod.get("width"), where + ".width", 0, 10)
        m.segments = int(num(mod.get("segments", 1), where + ".segments", 1, 8))
        m.limit_method = "NONE" if mod.get("limit") == "none" else "ANGLE"
    elif kind == "subdivision":
        m = obj.modifiers.new("Subdivision", "SUBSURF")
        m.levels = m.render_levels = int(num(mod.get("levels"), where + ".levels", 1, 3))
    elif kind == "solidify":
        m = obj.modifiers.new("Solidify", "SOLIDIFY")
        m.thickness = num(mod.get("thickness"), where + ".thickness", -10, 10)
    elif kind == "array":
        m = obj.modifiers.new("Array", "ARRAY")
        m.count = int(num(mod.get("count"), where + ".count", 2, 64))
        m.use_relative_offset = True
        m.relative_offset_displace = vec3(mod.get("offset"), where + ".offset", -100, 100)
    elif kind == "mirror":
        m = obj.modifiers.new("Mirror", "MIRROR")
        axes = mod.get("axes") or []
        m.use_axis = ["x" in axes, "y" in axes, "z" in axes]
    elif kind == "boolean":
        m = obj.modifiers.new("Boolean", "BOOLEAN")
        m.operation = {"difference": "DIFFERENCE", "union": "UNION", "intersect": "INTERSECT"}.get(mod.get("operation"), "DIFFERENCE")
        m.solver = "EXACT"
        m.object = objects[mod["with"]]


def apply_modifiers(objs):
    """Bake every modifier into the mesh (booleans read their cutters before those are removed)."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    baked = []
    for obj in objs:
        if obj.type != "MESH" or not obj.modifiers:
            continue
        mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph), preserve_all_data_layers=True, depsgraph=depsgraph)
        baked.append((obj, mesh))
    for obj, mesh in baked:
        old = obj.data
        obj.modifiers.clear()
        obj.data = mesh
        if old.users == 0:
            bpy.data.meshes.remove(old)


def set_active(obj):
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.view_layer.objects:
        o.select_set(o == obj)


def smart_uv(obj):
    set_active(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")


def build_from_spec(spec):
    validate_spec(spec)
    objects = {}
    entries = []
    for entry in spec["objects"]:
        obj = add_primitive(entry["primitive"], entry.get("params") or {})
        obj.name = entry["name"]
        obj.data.name = entry["name"]
        if entry.get("location") is not None:
            obj.location = vec3(entry["location"], entry["name"] + ".location")
        if entry.get("rotation") is not None:
            obj.rotation_euler = [math.radians(v) for v in vec3(entry["rotation"], entry["name"] + ".rotation", -36000, 36000)]
        if entry.get("scale") is not None:
            # Baked into the mesh so modifier sizes (bevel width, thickness) stay in meters
            sx, sy, sz = vec3(entry["scale"], entry["name"] + ".scale", 1e-6, 1000)
            obj.data.transform(Matrix.Diagonal((sx, sy, sz, 1.0)))
        if entry.get("material"):
            obj.data.materials.append(make_material(entry["name"] + "_mat", entry["material"]))
        if entry.get("smooth"):
            for poly in obj.data.polygons:
                poly.use_smooth = True
        objects[entry["name"]] = obj
        entries.append((entry, obj))
    for entry, obj in entries:
        for mod in entry.get("modifiers") or []:
            add_modifier(obj, mod, objects)

    keep = [obj for entry, obj in entries if not entry.get("cutter")]
    apply_modifiers(keep)
    for entry, obj in entries:
        if entry.get("cutter"):
            bpy.data.objects.remove(obj, do_unlink=True)
    for entry, obj in entries:
        if not entry.get("cutter") and entry.get("uv") == "smart":
            smart_uv(obj)
    if spec.get("join") and len(keep) > 1:
        with bpy.context.temp_override(active_object=keep[0], object=keep[0], selected_objects=keep, selected_editable_objects=keep):
            bpy.ops.object.join()
        keep = [keep[0]]
    return keep


def run_script(path):
    with open(path, "r", encoding="utf-8") as fh:
        code = fh.read()
    exec(compile(code, path, "exec"), {"__name__": "__main__", "bpy": bpy})
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH" and not o.hide_get() and not o.hide_render]
    apply_modifiers(meshes)
    return meshes


def world_bounds(objs):
    lo = Vector((math.inf, math.inf, math.inf))
    hi = Vector((-math.inf, -math.inf, -math.inf))
    for obj in objs:
        for corner in obj.bound_box:
            p = obj.matrix_world @ Vector(corner)
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
    return lo, hi


def main():
    try:
        opts = parse_args(sys.argv)
        reset_scene()
        if "spec" in opts:
            with open(opts["spec"], "r", encoding="utf-8") as fh:
                spec = json.load(fh)
            objs = build_from_spec(spec)
            ground = spec.get("ground", True)
        else:
            objs = run_script(opts["script"])
            ground = True
        objs = [o for o in objs if o.name in bpy.data.objects]
        if not objs:
            raise SpecError("tidak ada objek mesh untuk diekspor")

        bpy.context.view_layer.update()
        warnings = []
        if ground:
            lo, _ = world_bounds(objs)
            for obj in objs:
                if obj.parent is None:
                    obj.location.z -= lo.z
            bpy.context.view_layer.update()
        lo, hi = world_bounds(objs)

        triangles = 0
        materials = set()
        for obj in objs:
            obj.data.calc_loop_triangles()
            triangles += len(obj.data.loop_triangles)
            materials.update(m.name for m in obj.data.materials if m)
            if not obj.data.materials:
                warnings.append("%s tanpa material" % obj.name)
        if triangles > MAX_TRIANGLES:
            raise SpecError("hasil terlalu berat: %d segitiga" % triangles)

        for o in bpy.context.view_layer.objects:
            o.select_set(o in objs)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.export_scene.gltf(
            filepath=opts["out"], export_format="GLB", export_apply=True,
            use_selection=True, export_yup=True,
        )

        result = {
            "objects": len(objs),
            "triangles": triangles,
            "bounds": {"min": [round(v, 5) for v in lo], "max": [round(v, 5) for v in hi]},
            "materials": sorted(materials),
            "warnings": warnings,
        }
        sys.stdout.write(RESULT_MARKER + json.dumps(result) + "\n")
        sys.stdout.flush()
    except SpecError as err:
        fail(err)
    except Exception as err:  # noqa: BLE001 - report every Blender error to Linden
        fail("%s: %s" % (type(err).__name__, err))


main()
