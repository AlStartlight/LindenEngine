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
import os
import struct
import sys
import zlib

import bpy
import numpy as np
from mathutils import Matrix, Vector, noise

bridge_dir = os.path.dirname(os.path.abspath(__file__))
if bridge_dir not in sys.path:
    sys.path.insert(0, bridge_dir)

from rigging.armature import bind_meshes_to_armature, create_humanoid_armature
from rigging.locomotion import generate_locomotion_actions

RESULT_MARKER = "LINDEN_RESULT:"
ERROR_MARKER = "LINDEN_ERROR:"
MAX_TRIANGLES = 2_000_000

PRIMITIVES = {"cube", "uv_sphere", "cylinder", "cone", "torus", "plane", "lathe"}
MODIFIERS = {"bevel", "subdivision", "solidify", "array", "mirror", "boolean", "weightedNormal"}
OBJECT_KEYS = {"name", "primitive", "params", "location", "rotation", "scale", "modifiers", "sculpt", "material", "smooth", "smoothAngle", "uv", "cutter"}
PARAM_KEYS = {
    "size", "radius", "radius1", "radius2", "depth", "segments", "rings", "vertices",
    "majorRadius", "minorRadius", "majorSegments", "minorSegments", "profile", "profileSubdivisions",
}
SCULPT_PRESETS = {"clay", "stone", "wood", "fabric", "hammered", "organic", "custom"}
SCULPT_LAYER_TYPES = {"noise", "ridged", "dents", "wrinkles", "grain", "chips"}
TEXTURE_PATTERNS = {"noise", "wood", "marble", "concrete", "fabric", "stone", "brushed", "rust"}
RIG_TYPES = {"humanoid_biped", "mechanical_biped", "custom"}
MAX_SCULPT_TRIANGLES = 280_000
WARNINGS = []


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
        if key in ("--spec", "--script", "--source", "--rig", "--out", "--previews") and i + 1 < len(args):
            opts[key[2:]] = args[i + 1]
            i += 2
        else:
            raise SpecError("argumen tidak dikenal: %s" % key)
    if "out" not in opts:
        raise SpecError("harus menyertakan --out")
    modes = sum(1 for k in ("spec", "script", "source") if k in opts)
    if modes != 1:
        raise SpecError("pakai --out dengan tepat satu dari --spec, --script, atau --source")
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


def validate_sculpt(sculpt, where):
    if not isinstance(sculpt, dict):
        raise SpecError("%s harus object" % where)
    unknown = set(sculpt) - {"preset", "strength", "scale", "seed", "subdivide", "decimate", "layers"}
    if unknown:
        raise SpecError("%s: key tidak dikenal %s" % (where, sorted(unknown)))
    preset = sculpt.get("preset", "custom")
    if preset not in SCULPT_PRESETS:
        raise SpecError("%s.preset harus salah satu %s" % (where, sorted(SCULPT_PRESETS)))
    if sculpt.get("strength") is not None:
        num(sculpt["strength"], where + ".strength", 0, 0.2)
    if sculpt.get("scale") is not None:
        num(sculpt["scale"], where + ".scale", 0.5, 200)
    if sculpt.get("seed") is not None:
        num(sculpt["seed"], where + ".seed", 0, 999999)
    if sculpt.get("subdivide") is not None:
        num(sculpt["subdivide"], where + ".subdivide", 0, 3)
    if sculpt.get("decimate") is not None:
        num(sculpt["decimate"], where + ".decimate", 0, 1)
    layers = sculpt.get("layers")
    if layers is not None:
        if not isinstance(layers, list) or not (1 <= len(layers) <= 8):
            raise SpecError("%s.layers harus 1..8 layer" % where)
        for j, layer in enumerate(layers):
            lw = "%s.layers[%d]" % (where, j)
            if not isinstance(layer, dict) or layer.get("type") not in SCULPT_LAYER_TYPES:
                raise SpecError("%s.type harus salah satu %s" % (lw, sorted(SCULPT_LAYER_TYPES)))
            for k in ("strength", "scale", "detail", "seed"):
                if layer.get(k) is not None:
                    num(layer[k], "%s.%s" % (lw, k), 0, 999999)
    if preset == "custom" and not layers:
        raise SpecError("%s: preset custom butuh layers" % where)


def validate_texture(tex, where):
    if not isinstance(tex, dict):
        raise SpecError("%s harus object" % where)
    unknown = set(tex) - {"pattern", "scale", "contrast", "colorA", "colorB", "roughnessMin", "roughnessMax", "bump", "normalStrength", "resolution", "seed"}
    if unknown:
        raise SpecError("%s: key tidak dikenal %s" % (where, sorted(unknown)))
    if tex.get("pattern") not in TEXTURE_PATTERNS:
        raise SpecError("%s.pattern harus salah satu %s" % (where, sorted(TEXTURE_PATTERNS)))
    for k in ("scale", "contrast", "roughnessMin", "roughnessMax", "bump", "normalStrength"):
        if tex.get(k) is not None:
            num(tex[k], "%s.%s" % (where, k), 0, 64)
    if tex.get("resolution") is not None and int(tex["resolution"]) not in (256, 512, 1024):
        raise SpecError("%s.resolution harus 256, 512, atau 1024" % where)


def validate_grade(grade):
    if not isinstance(grade, dict):
        raise SpecError("spec.grade harus object")
    unknown = set(grade) - {"viewTransform", "look", "exposure", "whiteBalance", "colorGrade"}
    if unknown:
        raise SpecError("spec.grade: key tidak dikenal %s" % sorted(unknown))
    if grade.get("viewTransform") not in (None, "AgX", "Filmic", "Standard", "Khronos PBR Neutral"):
        raise SpecError("spec.grade.viewTransform tidak valid")


def validate_preview(preview):
    if not isinstance(preview, dict):
        raise SpecError("spec.preview harus object")
    unknown = set(preview) - {"engine", "samples", "resolution", "backdrop"}
    if unknown:
        raise SpecError("spec.preview: key tidak dikenal %s" % sorted(unknown))
    if preview.get("engine") not in (None, "cycles", "eevee"):
        raise SpecError("spec.preview.engine harus cycles atau eevee")
    if preview.get("resolution") is not None and int(preview["resolution"]) not in (256, 512, 768, 1024):
        raise SpecError("spec.preview.resolution tidak valid")


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
            if k == "profile":
                if not isinstance(v, list) or not (2 <= len(v) <= 128):
                    raise SpecError("%s.params.profile harus 2..128 titik [radius, z]" % where)
                for j, pt in enumerate(v):
                    if not isinstance(pt, list) or len(pt) != 2:
                        raise SpecError("%s.params.profile[%d] harus [radius, z]" % (where, j))
                    num(pt[0], "%s.params.profile[%d].r" % (where, j), 0, 100)
                    num(pt[1], "%s.params.profile[%d].z" % (where, j), -100, 100)
            elif k == "profileSubdivisions":
                num(v, "%s.params.profileSubdivisions" % where, 1, 8)
            else:
                num(v, "%s.params.%s" % (where, k), 0, 256)
        if obj.get("primitive") == "lathe" and not params.get("profile"):
            raise SpecError("%s: primitive lathe butuh params.profile" % where)
        if obj.get("sculpt") is not None:
            validate_sculpt(obj["sculpt"], where + ".sculpt")
        for mod in obj.get("modifiers") or []:
            if not isinstance(mod, dict) or mod.get("type") not in MODIFIERS:
                raise SpecError("%s.modifiers: type harus salah satu %s" % (where, sorted(MODIFIERS)))
        material = obj.get("material")
        if material is not None:
            if not isinstance(material, dict):
                raise SpecError("%s.material harus object" % where)
            if material.get("texture") is not None:
                validate_texture(material["texture"], where + ".material.texture")
    if spec.get("grade") is not None:
        validate_grade(spec["grade"])
    if spec.get("preview") is not None:
        validate_preview(spec["preview"])
    for obj in spec["objects"]:
        for mod in obj.get("modifiers") or []:
            if mod["type"] == "boolean" and (mod.get("with") not in names or mod.get("with") == obj["name"]):
                raise SpecError("boolean pada %s menunjuk objek yang tidak valid: %s" % (obj["name"], mod.get("with")))
    if all(obj.get("cutter") for obj in spec["objects"]):
        raise SpecError("minimal satu objek bukan cutter")
    if "rig" in spec and spec["rig"] is not None:
        rig = spec["rig"]
        if not isinstance(rig, dict):
            raise SpecError("spec.rig harus object")
        rig_type = rig.get("type", "humanoid_biped")
        if rig_type not in RIG_TYPES:
            raise SpecError("spec.rig.type harus salah satu %s" % sorted(RIG_TYPES))
        if "height" in rig:
            num(rig["height"], "spec.rig.height", 0.1, 100)


# ---------------------------------------------------------------- scene helpers

def reset_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights, bpy.data.curves, bpy.data.images, bpy.data.worlds):
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
    if spec.get("clearcoat") is not None:
        bsdf.inputs["Coat Weight"].default_value = num(spec.get("clearcoat"), name + ".clearcoat", 0, 1)
    if spec.get("clearcoatRoughness") is not None:
        bsdf.inputs["Coat Roughness"].default_value = num(spec.get("clearcoatRoughness"), name + ".clearcoatRoughness", 0, 1)
    mat.diffuse_color = bsdf.inputs["Base Color"].default_value
    return mat


# ---------------------------------------------------------------- procedural PBR textures

TEXTURE_DIR = None
TEXTURE_NAMES = []


def _hex_rgb8(value, fallback):
    if isinstance(value, str) and len(value) == 7 and value.startswith("#"):
        try:
            return tuple(int(value[i:i + 2], 16) for i in (1, 3, 5))
        except ValueError:
            pass
    return fallback


def _shade(rgb, factor):
    return tuple(max(0, min(255, int(c * factor))) for c in rgb)


def write_png(path, rgb8):
    """Minimal PNG writer (no PIL in Blender): 8-bit RGB, filter 0."""
    arr = np.clip(rgb8, 0, 255).astype(np.uint8)
    h, w, _ = arr.shape
    raw = b"".join(b"\x00" + arr[y].tobytes() for y in range(h))

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    with open(path, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def _smooth(t):
    return t * t * (3.0 - 2.0 * t)


def _value_noise(size, freq, seed):
    """Tileable 2D value noise in [0, 1]."""
    freq = max(2, min(int(freq), size))
    rng = np.random.default_rng(seed)
    grid = rng.random((freq, freq)).astype(np.float32)
    coord = np.linspace(0.0, freq, size, endpoint=False, dtype=np.float32)
    i0 = np.floor(coord).astype(np.int32)
    frac = coord - i0
    i1 = (i0 + 1) % freq
    i0 = i0 % freq
    sx = _smooth(frac)[None, :]
    sy = _smooth(frac)[:, None]
    x0, x1 = i0[None, :], i1[None, :]
    y0, y1 = i0[:, None], i1[:, None]
    top = grid[y0, x0] * (1 - sx) + grid[y0, x1] * sx
    bottom = grid[y1, x0] * (1 - sx) + grid[y1, x1] * sx
    return top * (1 - sy) + bottom * sy


def _fbm2(size, freq, octaves, seed):
    total = np.zeros((size, size), dtype=np.float32)
    norm = 0.0
    amp = 1.0
    f = freq
    for i in range(octaves):
        total += amp * _value_noise(size, max(2, int(f)), seed + i * 101)
        norm += amp
        amp *= 0.5
        f *= 2.0
    return total / max(norm, 1e-6)


def _blur(a):
    out = np.zeros_like(a)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            out += np.roll(np.roll(a, dy, axis=0), dx, axis=1)
    return out / 9.0


def _pattern_maps(pattern, size, seed, scale, contrast, colorA, colorB):
    """Returns (height, albedo_srgb_float, roughness, ao) arrays for one pattern."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / float(size)
    fine = _fbm2(size, 24, 4, seed + 7)
    broad = _fbm2(size, 6, 4, seed + 3)
    if pattern == "wood":
        warp = _fbm2(size, 4, 3, seed + 11) * 2.2
        rings = 0.5 + 0.5 * np.sin((yy * 9.0 + warp) * math.pi * max(1.0, scale))
        grain = 0.5 + 0.5 * np.sin((xx * 70.0 + broad * 6.0) * math.pi)
        height = np.clip(rings * 0.75 + grain * 0.25, 0, 1)
        tone = np.clip(rings * 0.7 + fine * 0.3, 0, 1)
        rough = 0.55 + 0.25 * (1.0 - tone)
    elif pattern == "marble":
        veins = np.abs(np.sin((xx * 2.0 + yy * 1.2 + broad * 4.5) * math.pi))
        height = 1.0 - veins ** 0.6
        tone = np.clip(height * 0.8 + fine * 0.2, 0, 1)
        rough = 0.22 + 0.18 * fine
    elif pattern == "concrete":
        speck = _value_noise(size, size, seed + 19)
        height = np.clip(broad * 0.55 + speck * 0.25 + fine * 0.2, 0, 1)
        tone = np.clip(0.45 + broad * 0.4 + speck * 0.15, 0, 1)
        rough = 0.7 + 0.25 * fine
    elif pattern == "fabric":
        weave = 0.5 + 0.5 * np.sin(xx * 220.0 * max(0.25, scale)) * np.sin(yy * 220.0 * max(0.25, scale))
        wrinkle = _fbm2(size, 5, 4, seed + 23)
        height = np.clip(weave * 0.45 + wrinkle * 0.55, 0, 1)
        tone = np.clip(wrinkle * 0.7 + weave * 0.3, 0, 1)
        rough = 0.82 + 0.15 * fine
    elif pattern == "stone":
        ridged = 1.0 - np.abs(broad * 2.0 - 1.0)
        height = np.clip(ridged * 0.55 + fine * 0.45, 0, 1)
        tone = np.clip(0.35 + height * 0.6, 0, 1)
        rough = 0.62 + 0.3 * fine
    elif pattern == "brushed":
        # Anisotropic streaks: high frequency across X, low across Y
        streak = _value_noise(size, 4, seed + 31)
        brushed = 0.5 + 0.5 * np.sin(yy * 380.0 + streak * 12.0)
        height = np.clip(brushed * 0.5 + fine * 0.5, 0, 1)
        tone = np.clip(brushed * 0.25 + fine * 0.25 + 0.5, 0, 1)
        rough = 0.18 + 0.22 * fine
    elif pattern == "rust":
        mask = _fbm2(size, 5, 5, seed + 37)
        pits = _value_noise(size, 64, seed + 41)
        height = np.clip(mask * 0.7 + pits * 0.3, 0, 1)
        tone = np.clip(mask * 0.8 + pits * 0.2, 0, 1)
        rough = 0.55 + 0.4 * mask
    else:  # noise
        height = np.clip(fine * 0.6 + broad * 0.4, 0, 1)
        tone = height
        rough = 0.5 + 0.35 * (1.0 - height)

    height = np.clip(0.5 + (height - 0.5) * (0.55 + contrast * 1.5), 0, 1)
    tone = np.clip(0.5 + (tone - 0.5) * (0.55 + contrast * 1.5), 0, 1)
    a = np.array(colorA, dtype=np.float32)
    b = np.array(colorB, dtype=np.float32)
    albedo = a[None, None, :] * (1.0 - tone[..., None]) + b[None, None, :] * tone[..., None]
    if pattern == "rust":
        rust = np.clip(mask * 1.4 - 0.3, 0, 1)[..., None]
        albedo = albedo * (1.0 - rust) + np.array([116, 68, 34], dtype=np.float32)[None, None, :] * rust
    ao = np.clip(1.0 - np.clip(_blur(height) - height, 0, 1) * 4.0, 0.35, 1.0)
    albedo = albedo * (0.55 + 0.45 * ao[..., None])
    return height, albedo, np.clip(rough, 0, 1), ao


def _load_packed_image(path, name, colorspace):
    img = bpy.data.images.load(path, check_existing=False)
    img.name = name
    img.colorspace_settings.name = colorspace
    img.pack()
    return img


def make_textured_material(name, spec):
    """Build a Principled material with baked albedo/ORM/normal PNGs that survive glTF export."""
    global TEXTURE_DIR
    tex = spec["texture"]
    base = _hex_rgb8(spec.get("baseColor"), (180, 178, 172))
    color_a = _hex_rgb8(tex.get("colorA"), base)
    color_b = _hex_rgb8(tex.get("colorB"), _shade(base, 0.45))
    size = int(tex.get("resolution", 512))
    scale = float(tex.get("scale", 1.0))
    contrast = float(tex.get("contrast", 0.5))
    seed = int(tex.get("seed", 7))
    height, albedo, rough, ao = _pattern_maps(tex["pattern"], size, seed, scale, contrast, color_a, color_b)
    rmin = float(tex.get("roughnessMin", spec.get("roughness", 0.5)) - 0.12)
    rmax = float(tex.get("roughnessMax", spec.get("roughness", 0.5)) + 0.12)
    rough = np.clip(rmin + (rmax - rmin) * rough, 0, 1)
    normal_strength = float(tex.get("normalStrength", 1.0))
    bump = float(tex.get("bump", 0.5))
    gy, gx = np.gradient(height)
    sx = gx * (4.0 * bump * normal_strength)
    sy = gy * (4.0 * bump * normal_strength)
    inv = 1.0 / np.sqrt(sx * sx + sy * sy + 1.0)
    normal = np.stack([-sx * inv, -sy * inv, inv], axis=-1)
    metallic = float(spec.get("metallic", 0.0))
    orm = np.stack([ao, rough, np.full_like(ao, metallic)], axis=-1)

    if not TEXTURE_DIR:
        raise SpecError("folder tekstur tidak tersedia")
    os.makedirs(TEXTURE_DIR, exist_ok=True)
    stem = "%s_%s_%d" % (name, tex["pattern"], seed)
    paths = {
        "albedo": os.path.join(TEXTURE_DIR, stem + "_albedo.png"),
        "orm": os.path.join(TEXTURE_DIR, stem + "_orm.png"),
        "normal": os.path.join(TEXTURE_DIR, stem + "_normal.png"),
    }
    write_png(paths["albedo"], albedo)
    write_png(paths["orm"], orm * 255.0)
    write_png(paths["normal"], (normal * 0.5 + 0.5) * 255.0)
    albedo_img = _load_packed_image(paths["albedo"], name + "_albedo", "sRGB")
    orm_img = _load_packed_image(paths["orm"], name + "_orm", "Non-Color")
    normal_img = _load_packed_image(paths["normal"], name + "_normal", "Non-Color")

    mat = bpy.data.materials.new(name)
    if bpy.app.version < (5, 0, 0):
        mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        raise SpecError("Principled BSDF tidak tersedia")
    nodes = nt.nodes
    links = nt.links

    tex_node = nodes.new("ShaderNodeTexImage")
    tex_node.name = tex_node.label = "Albedo"
    tex_node.image = albedo_img
    tex_node.location = (-620, 260)
    links.new(tex_node.outputs["Color"], bsdf.inputs["Base Color"])

    orm_node = nodes.new("ShaderNodeTexImage")
    orm_node.name = orm_node.label = "ORM"
    orm_node.image = orm_img
    orm_node.location = (-620, -20)
    sep = nodes.new("ShaderNodeSeparateColor")
    sep.location = (-360, -20)
    links.new(orm_node.outputs["Color"], sep.inputs["Color"])
    links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])

    normal_node = nodes.new("ShaderNodeTexImage")
    normal_node.name = normal_node.label = "Normal"
    normal_node.image = normal_img
    normal_node.location = (-620, -320)
    nmap = nodes.new("ShaderNodeNormalMap")
    nmap.location = (-360, -320)
    nmap.inputs["Strength"].default_value = normal_strength
    links.new(normal_node.outputs["Color"], nmap.inputs["Color"])
    links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])

    bsdf.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    if spec.get("clearcoat") is not None:
        bsdf.inputs["Coat Weight"].default_value = num(spec.get("clearcoat"), name + ".clearcoat", 0, 1)
    if spec.get("clearcoatRoughness") is not None:
        bsdf.inputs["Coat Roughness"].default_value = num(spec.get("clearcoatRoughness"), name + ".clearcoatRoughness", 0, 1)
    mat.diffuse_color = (albedo.mean(axis=(0, 1))[0] / 255.0, albedo.mean(axis=(0, 1))[1] / 255.0, albedo.mean(axis=(0, 1))[2] / 255.0, 1.0)
    for key, path in paths.items():
        TEXTURE_NAMES.append(os.path.basename(path))
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
    elif kind == "lathe":
        return add_lathe(p["profile"], int(p.get("segments", 64)), int(p.get("profileSubdivisions", 3)))
    return bpy.context.active_object


def _smooth_profile(profile, subdivisions):
    """Catmull-Rom resampling so a coarse [radius, z] outline becomes a smooth turnable curve."""
    if subdivisions <= 1 or len(profile) < 3:
        return [list(pt) for pt in profile]
    pts = [profile[0]] + [list(pt) for pt in profile] + [profile[-1]]
    out = [list(profile[0])]
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for step in range(1, subdivisions + 1):
            t = step / float(subdivisions)
            t2, t3 = t * t, t * t * t
            r = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
            z = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
            out.append([max(0.0, r), z])
    return out


def add_lathe(profile, segments, profile_subdivisions=3):
    """Surface of revolution from [radius, z] points around Blender Z (vases, bowls, chess pieces)."""
    import bmesh

    profile = _smooth_profile(profile, profile_subdivisions)
    bm = bmesh.new()
    verts = [bm.verts.new((float(r), 0.0, float(z))) for r, z in profile]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    geom = verts + edges
    bmesh.ops.spin(
        bm, geom=geom, cent=(0.0, 0.0, 0.0), axis=(0.0, 0.0, 1.0),
        dvec=(0.0, 0.0, 0.0), angle=math.radians(360.0), steps=segments,
        use_merge=True, use_normal_flip=False, use_duplicate=False,
    )
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new("Lathe")
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("Lathe", mesh)
    bpy.context.scene.collection.objects.link(obj)
    set_active(obj)
    return obj


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
    elif kind == "weightedNormal":
        m = obj.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
        m.weight = int(num(mod.get("weight", 50), where + ".weight", 0, 100))
        m.keep_sharp = True
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


# ---------------------------------------------------------------- procedural sculpting

SCULPT_PRESET_LAYERS = {
    "clay": [("noise", 0.75, 2.5, 4), ("wrinkles", 0.35, 14.0, 3)],
    "stone": [("ridged", 0.65, 5.0, 4), ("dents", 0.35, 11.0, 3), ("chips", 0.25, 28.0, 2)],
    "wood": [("grain", 0.85, 9.0, 3), ("noise", 0.20, 3.0, 3)],
    "fabric": [("wrinkles", 0.70, 7.0, 3), ("noise", 0.30, 22.0, 2)],
    "hammered": [("dents", 1.00, 13.0, 3)],
    "organic": [("noise", 0.65, 3.5, 4), ("ridged", 0.25, 8.0, 3), ("wrinkles", 0.18, 20.0, 2)],
}


def _smoothstep(edge0, edge1, x):
    t = max(0.0, min(1.0, (x - edge0) / (edge1 - edge0))) if edge1 > edge0 else 0.0
    return t * t * (3.0 - 2.0 * t)


def _fbm(p, octaves, seed):
    """Deterministic multi-octave Perlin in roughly [-1, 1]."""
    off = Vector((seed * 0.731, seed * 0.193, seed * 0.457))
    total = 0.0
    amp = 0.5
    freq = 1.0
    for _ in range(octaves):
        total += amp * noise.noise(Vector((p.x * freq + off.x, p.y * freq + off.y, p.z * freq + off.z)))
        freq *= 2.0
        amp *= 0.5
    return total


def _sculpt_layer_value(kind, p, layer):
    detail = int(layer.get("detail", 3))
    seed = int(layer.get("seed", 0))
    if kind == "noise":
        return _fbm(p, detail, seed)
    if kind == "ridged":
        return 0.55 - (1.0 - abs(_fbm(p, detail, seed) * 2.0))
    if kind == "dents":
        return -_smoothstep(0.10, 0.55, _fbm(p, detail, seed))
    if kind == "wrinkles":
        ridge = 1.0 - abs(_fbm(p, detail, seed) * 2.0)
        return -1.25 * _smoothstep(0.72, 1.0, ridge)
    if kind == "grain":
        # Fine lines along the world Z axis (wood turned on a lathe) broken by turbulence
        warp = _fbm(p * 0.35, 2, seed) * 5.0
        return 0.5 * math.sin(p.z * 90.0 + warp)
    if kind == "chips":
        return -_smoothstep(0.30, 0.62, abs(_fbm(p, detail, seed)))
    return 0.0


def sculpt_layers(sculpt):
    preset = sculpt.get("preset", "custom")
    strength = float(sculpt.get("strength", 0.006))
    scale = float(sculpt.get("scale", 1.0))
    seed = int(sculpt.get("seed", 1))
    if sculpt.get("layers"):
        layers = []
        for i, layer in enumerate(sculpt["layers"]):
            layers.append({
                "type": layer["type"],
                "strength": float(layer.get("strength", 0.5)),
                "scale": float(layer.get("scale", 8.0)) * scale,
                "detail": int(layer.get("detail", 3)),
                "seed": int(layer.get("seed", seed + i * 17)),
            })
    else:
        layers = [
            {"type": kind, "strength": s, "scale": sc * scale, "detail": d, "seed": seed + i * 31}
            for i, (kind, s, sc, d) in enumerate(SCULPT_PRESET_LAYERS.get(preset, SCULPT_PRESET_LAYERS["organic"]))
        ]
    return strength, layers


def apply_sculpt(obj, sculpt):
    """Subdivide, displace along normals with presets/layers, then decimate back into budget."""
    levels = int(sculpt.get("subdivide", 2))
    if levels > 0:
        mod = obj.modifiers.new("SculptSubdiv", "SUBSURF")
        mod.subdivision_type = "SIMPLE"
        mod.levels = mod.render_levels = levels
        apply_modifiers([obj])
    import bmesh

    me = obj.data
    me.calc_loop_triangles()
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.normal_update()
    if not bm.verts:
        bm.free()
        return
    lo = Vector((min(v.co.x for v in bm.verts), min(v.co.y for v in bm.verts), min(v.co.z for v in bm.verts)))
    hi = Vector((max(v.co.x for v in bm.verts), max(v.co.y for v in bm.verts), max(v.co.z for v in bm.verts)))
    diag = max((hi - lo).length, 1e-4)
    center = (lo + hi) * 0.5
    strength, layers = sculpt_layers(sculpt)
    amount = strength * diag
    for v in bm.verts:
        p = (v.co - center) / diag
        d = 0.0
        for layer in layers:
            q = p * layer["scale"]
            d += layer["strength"] * _sculpt_layer_value(layer["type"], q, layer)
        v.co += v.normal * (d * amount)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    me.update()

    me.calc_loop_triangles()
    ratio = sculpt.get("decimate")
    if ratio is None and len(me.loop_triangles) > MAX_SCULPT_TRIANGLES:
        ratio = MAX_SCULPT_TRIANGLES / float(len(me.loop_triangles))
        WARNINGS.append("%s: decimate otomatis ke %.0f%% (batas %d segitiga)" % (obj.name, ratio * 100, MAX_SCULPT_TRIANGLES))
    if ratio is not None and 0.02 <= float(ratio) < 1.0:
        mod = obj.modifiers.new("SculptDecimate", "DECIMATE")
        mod.ratio = float(ratio)
        apply_modifiers([obj])


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


def cylindrical_uv(obj, tiles=1.0):
    """Seam-free unwrap around Blender Z: angle -> U, height -> V (turned vessels, columns)."""
    me = obj.data
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    layer = me.uv_layers.new(name="UVMap")
    me.uv_layers.active = layer
    verts = me.vertices
    if not verts or not me.polygons:
        return
    zmin = min(v.co.z for v in verts)
    zmax = max(v.co.z for v in verts)
    dz = max(zmax - zmin, 1e-6)
    two_pi = math.pi * 2.0
    for poly in me.polygons:
        loops = poly.loop_indices
        # Face centre angle keeps every loop of the face on the same side of the seam
        center = 0.0
        for li in loops:
            co = verts[me.loops[li].vertex_index].co
            center += math.atan2(co.x, co.y)
        center /= max(len(loops), 1)
        for li in loops:
            co = verts[me.loops[li].vertex_index].co
            a = math.atan2(co.x, co.y)
            while a - center > math.pi:
                a -= two_pi
            while a - center < -math.pi:
                a += two_pi
            u = (a % two_pi) / two_pi
            v = (co.z - zmin) / dz
            layer.data[li].uv = (u * tiles, v * tiles)


def build_from_spec(spec):
    validate_spec(spec)
    objects = {}
    entries = []
    smooth_angles = {}
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
            mat_spec = entry["material"]
            mat = make_textured_material(entry["name"] + "_mat", mat_spec) if mat_spec.get("texture") else make_material(entry["name"] + "_mat", mat_spec)
            obj.data.materials.append(mat)
        if entry.get("smooth"):
            for poly in obj.data.polygons:
                poly.use_smooth = True
        if entry.get("smoothAngle") is not None:
            smooth_angles[entry["name"]] = num(entry["smoothAngle"], entry["name"] + ".smoothAngle", 0, 180)
        objects[entry["name"]] = obj
        entries.append((entry, obj))
    # Sculpt the base mesh first, then let bevel/solidify/boolean work on the detailed surface
    for entry, obj in entries:
        if entry.get("sculpt"):
            apply_sculpt(obj, entry["sculpt"])
    for entry, obj in entries:
        for mod in entry.get("modifiers") or []:
            add_modifier(obj, mod, objects)

    keep = [obj for entry, obj in entries if not entry.get("cutter")]
    apply_modifiers(keep)
    # Blender 4.1+ replaced mesh auto-smooth with a shading operator; use it when the
    # spec asks for an angle so bevels stay crisp and curved surfaces stay smooth.
    for name, angle in smooth_angles.items():
        obj = bpy.data.objects.get(name)
        if obj is None:
            continue
        try:
            set_active(obj)
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
        except Exception:
            for poly in obj.data.polygons:
                poly.use_smooth = True
    # Re-assert smooth shading on the final mesh (sculpt/decimate can leave flat faces behind)
    for entry, obj in entries:
        if entry.get("cutter") or not entry.get("smooth") or entry.get("smoothAngle") is not None:
            continue
        try:
            set_active(obj)
            bpy.ops.object.shade_smooth()
        except Exception:
            for poly in obj.data.polygons:
                poly.use_smooth = True
    for entry, obj in entries:
        if entry.get("cutter"):
            bpy.data.objects.remove(obj, do_unlink=True)
    for entry, obj in entries:
        textured = bool((entry.get("material") or {}).get("texture"))
        mode = entry.get("uv")
        if mode is None and textured:
            mode = "cylindrical" if entry.get("primitive") == "lathe" else "smart"
        if entry.get("cutter") or mode == "none":
            continue
        if mode == "cylindrical":
            cylindrical_uv(obj)
        elif mode == "smart" or textured:
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


def _look_at(obj, target):
    direction = target - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


DEFAULT_GRADE = {
    "viewTransform": "AgX",
    "look": "AgX - Medium High Contrast",
    "exposure": 0.0,
    "colorGrade": {"contrast": 1.05, "saturation": 1.04, "temperature": 0.0, "tint": 0.0, "lift": 0.0, "gamma": 1.0, "gain": 1.0, "vignette": 0.12},
}


def merge_grade(grade):
    merged = json.loads(json.dumps(DEFAULT_GRADE))
    if not isinstance(grade, dict):
        return merged
    for key in ("viewTransform", "look", "exposure", "whiteBalance"):
        if grade.get(key) is not None:
            merged[key] = grade[key]
    for key, value in (grade.get("colorGrade") or {}).items():
        merged["colorGrade"][key] = value
    return merged


def apply_color_management(grade):
    vs = bpy.context.scene.view_settings
    try:
        vs.view_transform = grade.get("viewTransform", "AgX")
    except Exception:
        vs.view_transform = "AgX"
    try:
        vs.look = grade.get("look") or "None"
    except Exception:
        try:
            vs.look = "None"
        except Exception:
            pass
    vs.exposure = float(grade.get("exposure", 0.0))
    vs.gamma = float(grade.get("gamma", 1.0))
    wb = grade.get("whiteBalance")
    if wb:
        try:
            vs.use_white_balance = True
            vs.white_balance_temperature = float(wb.get("temperature", 6500))
            vs.white_balance_tint = float(wb.get("tint", 0))
        except Exception:
            pass


def _studio_world(scene):
    world = scene.world or bpy.data.worlds.new("PreviewWorld")
    scene.world = world
    try:
        world.use_nodes = True
        nt = world.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputWorld")
        bg = nt.nodes.new("ShaderNodeBackground")
        bg.inputs["Strength"].default_value = 1.0
        coord = nt.nodes.new("ShaderNodeTexCoord")
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position = 0.0
        ramp.color_ramp.elements[0].color = (0.004, 0.0045, 0.006, 1.0)
        ramp.color_ramp.elements[1].position = 0.75
        ramp.color_ramp.elements[1].color = (0.10, 0.105, 0.125, 1.0)
        nt.links.new(coord.outputs["Generated"], sep.inputs["Vector"])
        nt.links.new(sep.outputs["Z"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
        nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    except Exception:
        pass


def _add_backdrop(scene, lo, hi):
    """Neutral studio floor so the object has contact shadows and a believable ground."""
    size = max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z, 0.2)
    bpy.ops.mesh.primitive_plane_add(size=size * 40.0, location=(0.0, 0.0, lo.z - 0.0015))
    floor = bpy.context.active_object
    floor.name = "Preview_Floor"
    mat = bpy.data.materials.new("Preview_Floor_Mat")
    if bpy.app.version < (5, 0, 0):
        mat.use_nodes = True
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.085, 0.088, 0.10, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.62
        bsdf.inputs["Metallic"].default_value = 0.0
    floor.data.materials.append(mat)
    return floor


def _preview_setup(lo, hi, grade, preview):
    """Cycles studio product shot: softkey lighting, cyclorama floor, AgX color management."""
    scene = bpy.context.scene
    _studio_world(scene)
    if preview.get("backdrop", True):
        _add_backdrop(scene, lo, hi)
    center = (lo + hi) * 0.5
    diag = max((hi - lo).length, 0.2)
    # Light positions and power scale with the object so a mug and a room both frame correctly
    dist = diag * 1.9 + 0.25
    energy = max(35.0, 210.0 * diag * diag)
    for name, power, size, direction, color in (
        ("Preview_Key", energy * 1.0, diag * 1.6 + 0.2, (1.4, -1.9, 1.9), (1.0, 0.93, 0.84)),
        ("Preview_Fill", energy * 0.30, diag * 2.2 + 0.3, (-1.9, -1.3, 0.75), (0.82, 0.9, 1.0)),
        ("Preview_Rim", energy * 0.60, diag * 1.0 + 0.15, (0.15, 2.0, 1.3), (0.9, 0.95, 1.0)),
        ("Preview_Top", energy * 0.20, diag * 2.6 + 0.3, (0.0, 0.0, 1.6), (1.0, 0.97, 0.94)),
    ):
        data = bpy.data.lights.new(name, type="AREA")
        data.energy = power
        data.size = size
        data.color = color
        light = bpy.data.objects.new(name, data)
        light.location = center + Vector(direction).normalized() * dist
        _look_at(light, center)
        scene.collection.objects.link(light)
    cam_data = bpy.data.cameras.new("Preview_Cam")
    cam = bpy.data.objects.new("Preview_Cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.lens = 70
    scene.render.resolution_x = int(preview.get("resolution", 512))
    scene.render.resolution_y = int(preview.get("resolution", 512))
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.film_transparent = False
    engine = preview.get("engine", "cycles")
    candidates = ["CYCLES", "BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "BLENDER_WORKBENCH"] if engine == "cycles" else ["BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "BLENDER_WORKBENCH"]
    for name in candidates:
        try:
            scene.render.engine = name
            break
        except Exception:
            continue
    if scene.render.engine == "CYCLES":
        cy = scene.cycles
        cy.device = "CPU"
        cy.samples = int(preview.get("samples", 48))
        cy.use_denoising = True
        cy.max_bounces = 6
        cy.diffuse_bounces = 3
        cy.glossy_bounces = 3
        cy.transmission_bounces = 4
        for attr in ("use_caustics_reflective", "use_caustics_refractive", "caustics_reflective", "caustics_refractive"):
            if hasattr(cy, attr):
                setattr(cy, attr, False)
    else:
        try:
            scene.eevee.taa_render_samples = int(preview.get("samples", 64))
        except Exception:
            pass
    apply_color_management(grade)
    return cam


def _grade_rgb(arr, cg):
    """Display-referred CDL grade; the engine post pass uses the same constants."""
    c = arr.astype(np.float32)
    temperature = float(cg.get("temperature", 0.0))
    tint = float(cg.get("tint", 0.0))
    c[..., 0] *= 1.0 + 0.12 * temperature
    c[..., 2] *= 1.0 - 0.12 * temperature
    c[..., 1] *= 1.0 - 0.08 * tint
    c[..., 0] *= 1.0 + 0.04 * tint
    c[..., 2] *= 1.0 + 0.04 * tint
    c += float(cg.get("lift", 0.0))
    c *= float(cg.get("gain", 1.0))
    gamma = max(0.05, float(cg.get("gamma", 1.0)))
    if abs(gamma - 1.0) > 1e-4:
        c = np.power(np.clip(c, 0.0, None), 1.0 / gamma)
    luma = c[..., 0] * 0.2126 + c[..., 1] * 0.7152 + c[..., 2] * 0.0722
    sat = float(cg.get("saturation", 1.0))
    c = luma[..., None] + (c - luma[..., None]) * sat
    contrast = float(cg.get("contrast", 1.0))
    c = (c - 0.5) * contrast + 0.5
    vignette = float(cg.get("vignette", 0.0))
    if vignette > 0.0:
        h, w = c.shape[:2]
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        nx = (xx / max(w - 1, 1) - 0.5) * 2.0
        ny = (yy / max(h - 1, 1) - 0.5) * 2.0
        d = np.sqrt(nx * nx + ny * ny) / 1.41421356
        t = np.clip((1.0 - d) / 0.55, 0.0, 1.0)
        mask = t * t * (3.0 - 2.0 * t)
        c *= (1.0 + (mask - 1.0) * vignette)[..., None]
    return np.clip(c, 0.0, 1.0)


def grade_png(path, cg):
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    graded = _grade_rgb(px[..., :3], cg)
    # Blender image rows are bottom-up; write_png expects top-down
    write_png(path, np.flip(graded, axis=0) * 255.0)
    bpy.data.images.remove(img)


def render_previews(out_dir, lo, hi, grade, preview):
    """Render three review angles so the agent can SEE what it built before importing."""
    os.makedirs(out_dir, exist_ok=True)
    cam = _preview_setup(lo, hi, grade, preview)
    center = (lo + hi) * 0.5
    size = max((hi.x - lo.x), (hi.y - lo.y), (hi.z - lo.z), 0.2)
    distance = size * 2.15 + 0.45
    views = (
        ("three_quarter", Vector((1.0, -1.4, 0.72))),
        ("front", Vector((0.0, -1.0, 0.22))),
        ("side", Vector((1.0, 0.0, 0.22))),
    )
    written = []
    for label, direction in views:
        cam.location = center + direction.normalized() * distance
        _look_at(cam, center + Vector((0.0, 0.0, size * 0.03)))
        filepath = os.path.join(out_dir, "preview_%s.png" % label)
        bpy.context.scene.render.filepath = filepath
        bpy.ops.render.render(write_still=True)
        if os.path.exists(filepath):
            grade_png(filepath, grade.get("colorGrade") or {})
            written.append(filepath)
    return written


def main():
    global TEXTURE_DIR
    try:
        opts = parse_args(sys.argv)
        TEXTURE_DIR = os.path.join(os.path.dirname(os.path.abspath(opts["out"])), "textures")
        reset_scene()
        spec = None
        if "spec" in opts:
            with open(opts["spec"], "r", encoding="utf-8") as fh:
                spec = json.load(fh)
            objs = build_from_spec(spec)
            ground = spec.get("ground", True)
        elif "source" in opts:
            bpy.ops.import_scene.gltf(filepath=opts["source"])
            objs = [o for o in bpy.context.scene.objects if o.type == "MESH" and not o.hide_get()]
            ground = False
        else:
            objs = run_script(opts["script"])
            ground = True
        objs = [o for o in objs if o.name in bpy.data.objects]
        if not objs:
            raise SpecError("tidak ada objek mesh untuk diekspor")

        bpy.context.view_layer.update()
        grade = merge_grade((spec or {}).get("grade"))
        preview = dict((spec or {}).get("preview") or {})
        warnings = WARNINGS
        if ground:
            lo, _ = world_bounds(objs)
            for obj in objs:
                if obj.parent is None:
                    obj.location.z -= lo.z
            bpy.context.view_layer.update()
        lo, hi = world_bounds(objs)

        rig_spec = None
        if "rig" in opts:
            with open(opts["rig"], "r", encoding="utf-8") as fh:
                rig_spec = json.load(fh)
        elif spec and isinstance(spec, dict) and "rig" in spec and spec["rig"]:
            rig_spec = spec["rig"]

        armature_obj = None
        if rig_spec:
            default_h = max(0.5, float(hi.z - lo.z))
            h = num(rig_spec.get("height", default_h), "rig.height", 0.1, 100)
            w = max(0.2, float(hi.x - lo.x))
            d = max(0.2, float(hi.y - lo.y))
            armature_obj = create_humanoid_armature(height=h, width=w, depth=d, base_z=lo.z)
            bind_meshes_to_armature(objs, armature_obj, rig_type=rig_spec.get("type", "humanoid_biped"), rig_mapping=rig_spec.get("rigMapping"))
            if rig_spec.get("generateLocomotion", True):
                generate_locomotion_actions(armature_obj, actions=rig_spec.get("actions"), height=h)

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

        has_armature = any(o.type == "ARMATURE" for o in bpy.context.scene.objects)
        if has_armature:
            for o in bpy.context.view_layer.objects:
                o.select_set(True)
            bpy.ops.export_scene.gltf(
                filepath=opts["out"],
                export_format="GLB",
                export_apply=False,
                export_animations=True,
                export_animation_mode="ACTIONS",
                export_skins=True,
                export_morph=True,
                export_def_bones=True,
                use_selection=False,
                export_yup=True,
                export_image_format="AUTO",
                export_materials="EXPORT",
                export_texcoords=True,
                export_normals=True,
            )
        else:
            for o in bpy.context.view_layer.objects:
                o.select_set(o in objs)
            bpy.context.view_layer.objects.active = objs[0]
            bpy.ops.export_scene.gltf(
                filepath=opts["out"], export_format="GLB", export_apply=True,
                use_selection=True, export_yup=True,
                export_image_format="AUTO", export_materials="EXPORT",
                export_texcoords=True, export_normals=True,
            )

        preview_paths = []
        if opts.get("previews"):
            try:
                preview_paths = render_previews(opts["previews"], lo, hi, grade, preview)
            except Exception as err:  # noqa: BLE001 - previews are best-effort
                warnings.append("preview gagal: %s" % err)

        actions = sorted({a.name for a in bpy.data.actions})
        result = {
            "objects": len(objs),
            "triangles": triangles,
            "bounds": {"min": [round(v, 5) for v in lo], "max": [round(v, 5) for v in hi]},
            "materials": sorted(materials),
            "warnings": warnings,
            "animations": actions,
            "previews": [os.path.basename(p) for p in preview_paths],
            "textures": sorted(set(TEXTURE_NAMES)),
            "grade": {
                "viewTransform": grade.get("viewTransform"),
                "look": grade.get("look"),
                "exposure": grade.get("exposure"),
                "colorGrade": grade.get("colorGrade"),
            },
        }
        if armature_obj:
            result["bones"] = len(armature_obj.data.bones)
        sys.stdout.write(RESULT_MARKER + json.dumps(result) + "\n")
        sys.stdout.flush()
    except SpecError as err:
        fail(err)
    except Exception as err:  # noqa: BLE001 - report every Blender error to Linden
        fail("%s: %s" % (type(err).__name__, err))


main()
