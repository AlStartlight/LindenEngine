# SPDX-License-Identifier: GPL-3.0-or-later
#
# Linden Engine Blender MCP (Model Context Protocol) Server.
# Copyright (C) 2026 Linden Engine Contributors
#
# Runs INSIDE Blender in background mode (-b -P mcp_server.py) or as an MCP daemon.
# Implements JSON-RPC 2.0 over standard input / output conforming to the MCP specification.

import base64
import json
import math
import os
import sys
import tempfile
import traceback

import bpy
from mathutils import Matrix, Vector

MAX_TRIANGLES = 2_000_000

TOOLS = [
    {
        "name": "blender_execute_code",
        "description": "Menjalankan script Python bpy di Blender untuk membuat atau memodifikasi objek 3D.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "code": {"type": "string", "description": "Kode Python bpy yang dieksekusi"},
                "clear_scene": {"type": "boolean", "description": "Bersihkan scene sebelum eksekusi (default false)"}
            },
            "required": ["code"]
        }
    },
    {
        "name": "blender_inspect_scene",
        "description": "Menginspeksi daftar objek, material, jumlah segitiga, dan bounding box scene Blender saat ini.",
        "inputSchema": {
            "type": "object",
            "properties": {}
        }
    },
    {
        "name": "blender_render_viewport",
        "description": "Merender tampilan kamera Blender ke file gambar PNG untuk verifikasi visual dengan gambar referensi.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "camera_pos": {"type": "array", "items": {"type": "number"}, "description": "[x, y, z] posisi kamera"},
                "camera_target": {"type": "array", "items": {"type": "number"}, "description": "[x, y, z] titik pandang kamera"},
                "fov": {"type": "number", "description": "Field of View dalam derajat (default 65)"},
                "out_path": {"type": "string", "description": "Path absolut file PNG output"},
                "resolution": {"type": "array", "items": {"type": "integer"}, "description": "[lebar, tinggi] (default [512, 512])"}
            }
        }
    },
    {
        "name": "blender_build_environment",
        "description": "Membangun struktur lingkungan/ruangan 3D (lantai, dinding, plafon, bukaan pintu/jendela, pencahayaan) sesuai layout visual dari gambar referensi.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Nama environment"},
                "dimensions": {
                    "type": "object",
                    "properties": {
                        "width": {"type": "number", "description": "Lebar ruangan (X, meter)"},
                        "length": {"type": "number", "description": "Panjang ruangan (Y, meter)"},
                        "height": {"type": "number", "description": "Tinggi ruangan (Z, meter)"}
                    },
                    "required": ["width", "length", "height"]
                },
                "floorColor": {"type": "string", "description": "Hex warna lantai (#rrggbb)"},
                "wallColor": {"type": "string", "description": "Hex warna dinding (#rrggbb)"},
                "ceilingColor": {"type": "string", "description": "Hex warna plafon (#rrggbb)"},
                "hasCeiling": {"type": "boolean", "description": "Buat plafon/atap atau tidak (default true)"},
                "openings": {
                    "type": "array",
                    "description": "Daftar bukaan jendela atau pintu",
                    "items": {
                        "type": "object",
                        "properties": {
                            "wall": {"type": "string", "enum": ["north", "south", "east", "west"]},
                            "type": {"type": "string", "enum": ["window", "door"]},
                            "width": {"type": "number"},
                            "height": {"type": "number"},
                            "offset": {"type": "number", "description": "Offset horizontal dari tengah dinding"}
                        }
                    }
                }
            },
            "required": ["name", "dimensions"]
        }
    },
    {
        "name": "blender_export_glb",
        "description": "Mengekspor model atau seluruh lingkungan di scene Blender ke file GLB (format Y-up Linden).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Nama model"},
                "out_path": {"type": "string", "description": "Path absolut tujuan file .glb"}
            },
            "required": ["name", "out_path"]
        }
    }
]


def clear_all_objects():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh, do_unlink=True)
    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat, do_unlink=True)


def parse_hex_color(hex_str):
    s = hex_str.lstrip("#")
    if len(s) == 6:
        r = int(s[0:2], 16) / 255.0
        g = int(s[2:4], 16) / 255.0
        b = int(s[4:6], 16) / 255.0
        return (r, g, b, 1.0)
    return (0.8, 0.8, 0.8, 1.0)


def create_pbr_material(name, color_hex, roughness=0.5, metallic=0.0):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        rgba = parse_hex_color(color_hex)
        if "Base Color" in bsdf.inputs:
            bsdf.inputs["Base Color"].default_value = rgba
        if "Roughness" in bsdf.inputs:
            bsdf.inputs["Roughness"].default_value = roughness
        if "Metallic" in bsdf.inputs:
            bsdf.inputs["Metallic"].default_value = metallic
    return mat


def execute_code(code, clear_scene=False):
    if clear_scene:
        clear_all_objects()
    stdout_capture = []
    
    class StdoutProxy:
        def write(self, s):
            stdout_capture.append(s)
        def flush(self):
            pass
            
    old_stdout = sys.stdout
    sys.stdout = StdoutProxy()
    exec_globals = {
        "bpy": bpy,
        "mathutils": sys.modules.get("mathutils"),
        "Vector": Vector,
        "Matrix": Matrix,
        "math": math,
        "os": os,
    }
    try:
        exec(code, exec_globals)
        output = "".join(stdout_capture)
        objs = [o.name for o in bpy.context.scene.objects]
        return {
            "success": True,
            "output": output,
            "objects": objs,
            "count": len(objs)
        }
    except Exception as e:
        output = "".join(stdout_capture)
        return {
            "success": False,
            "error": f"{type(e).__name__}: {str(e)}",
            "output": output,
            "traceback": traceback.format_exc()
        }
    finally:
        sys.stdout = old_stdout


def inspect_scene():
    objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    triangles = 0
    materials = set()
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3

    for obj in objs:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
        for m in obj.data.materials:
            if m:
                materials.add(m.name)
        for corner in obj.bound_box:
            world_pt = obj.matrix_world @ Vector(corner)
            for i in range(3):
                lo[i] = min(lo[i], world_pt[i])
                hi[i] = max(hi[i], world_pt[i])

    bounds = None
    if objs and lo[0] != float("inf"):
        bounds = {
            "min": [round(v, 4) for v in lo],
            "max": [round(v, 4) for v in hi],
            "size": [round(hi[i] - lo[i], 4) for i in range(3)]
        }

    return {
        "object_count": len(bpy.context.scene.objects),
        "mesh_objects": [o.name for o in objs],
        "triangles": triangles,
        "materials": sorted(materials),
        "bounds": bounds
    }


def render_viewport(camera_pos=None, camera_target=None, fov=65, out_path=None, resolution=None):
    if not out_path:
        out_path = os.path.join(tempfile.gettempdir(), "blender_render_preview.png")

    # Camera setup
    cam = bpy.data.objects.get("MCP_Camera")
    if not cam:
        cam_data = bpy.data.cameras.new(name="MCP_Camera")
        cam = bpy.data.objects.new(name="MCP_Camera", object_data=cam_data)
        bpy.context.scene.collection.objects.link(cam)

    bpy.context.scene.camera = cam
    cam.data.angle = math.radians(fov if fov else 65)

    pos = Vector(camera_pos if camera_pos else [3.0, -4.0, 2.5])
    target = Vector(camera_target if camera_target else [0.0, 0.0, 0.5])
    direction = target - pos
    rot_quat = direction.to_track_quat('-Z', 'Y')
    cam.location = pos
    cam.rotation_euler = rot_quat.to_euler()

    # Lighting setup if missing
    light = bpy.data.objects.get("MCP_Sun")
    if not light:
        light_data = bpy.data.lights.new(name="MCP_Sun", type='SUN')
        light_data.energy = 2.5
        light = bpy.data.objects.new(name="MCP_Sun", object_data=light_data)
        light.rotation_euler = (math.radians(45), math.radians(30), math.radians(45))
        bpy.context.scene.collection.objects.link(light)

    res = resolution or [512, 512]
    bpy.context.scene.render.resolution_x = res[0]
    bpy.context.scene.render.resolution_y = res[1]
    bpy.context.scene.render.filepath = out_path
    bpy.context.scene.render.image_settings.file_format = 'PNG'

    # Fast render with workbench or eevee
    try:
        bpy.context.scene.render.engine = 'BLENDER_EEVEE'
    except Exception:
        bpy.context.scene.render.engine = 'BLENDER_WORKBENCH'

    bpy.ops.render.render(write_still=True)

    b64_data = ""
    if os.path.exists(out_path):
        with open(out_path, "rb") as f:
            b64_data = base64.b64encode(f.read()).decode("ascii")

    return {
        "success": True,
        "out_path": out_path,
        "bytes": len(b64_data),
        "base64_preview": b64_data[:120] + "..." if b64_data else None
    }


def build_environment(config):
    name = config.get("name", "RoomEnvironment")
    dims = config.get("dimensions", {"width": 5.0, "length": 5.0, "height": 2.8})
    w = float(dims.get("width", 5.0))
    l = float(dims.get("length", 5.0))
    h = float(dims.get("height", 2.8))
    wall_thickness = 0.15

    clear_all_objects()

    floor_mat = create_pbr_material(f"{name}_FloorMat", config.get("floorColor", "#4a3c31"), roughness=0.6)
    wall_mat = create_pbr_material(f"{name}_WallMat", config.get("wallColor", "#dcdcdc"), roughness=0.8)
    ceil_mat = create_pbr_material(f"{name}_CeilMat", config.get("ceilingColor", "#f5f5f5"), roughness=0.9)

    # 1. Floor slab
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, -wall_thickness / 2.0))
    floor_obj = bpy.context.active_object
    floor_obj.name = f"{name}_Floor"
    floor_obj.scale = (w, l, wall_thickness)
    bpy.ops.object.transform_apply(scale=True)
    floor_obj.data.materials.append(floor_mat)

    # 2. Ceiling slab if requested
    if config.get("hasCeiling", True):
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, h + wall_thickness / 2.0))
        ceil_obj = bpy.context.active_object
        ceil_obj.name = f"{name}_Ceiling"
        ceil_obj.scale = (w, l, wall_thickness)
        bpy.ops.object.transform_apply(scale=True)
        ceil_obj.data.materials.append(ceil_mat)

    # 3. Four walls
    # North (Y+)
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, (l + wall_thickness) / 2.0, h / 2.0))
    wall_n = bpy.context.active_object
    wall_n.name = f"{name}_Wall_North"
    wall_n.scale = (w + 2 * wall_thickness, wall_thickness, h)
    bpy.ops.object.transform_apply(scale=True)
    wall_n.data.materials.append(wall_mat)

    # South (Y-)
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, -(l + wall_thickness) / 2.0, h / 2.0))
    wall_s = bpy.context.active_object
    wall_s.name = f"{name}_Wall_South"
    wall_s.scale = (w + 2 * wall_thickness, wall_thickness, h)
    bpy.ops.object.transform_apply(scale=True)
    wall_s.data.materials.append(wall_mat)

    # East (X+)
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=((w + wall_thickness) / 2.0, 0, h / 2.0))
    wall_e = bpy.context.active_object
    wall_e.name = f"{name}_Wall_East"
    wall_e.scale = (wall_thickness, l, h)
    bpy.ops.object.transform_apply(scale=True)
    wall_e.data.materials.append(wall_mat)

    # West (X-)
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(-(w + wall_thickness) / 2.0, 0, h / 2.0))
    wall_w = bpy.context.active_object
    wall_w.name = f"{name}_Wall_West"
    wall_w.scale = (wall_thickness, l, h)
    bpy.ops.object.transform_apply(scale=True)
    wall_w.data.materials.append(wall_mat)

    # Process openings (doors/windows cutters)
    walls_map = {"north": wall_n, "south": wall_s, "east": wall_e, "west": wall_w}
    for i, opening in enumerate(config.get("openings", [])):
        w_side = opening.get("wall")
        target_wall = walls_map.get(w_side)
        if not target_wall:
            continue
        op_w = float(opening.get("width", 1.2))
        op_h = float(opening.get("height", 1.4))
        op_type = opening.get("type", "window")
        offset = float(opening.get("offset", 0.0))
        z_pos = op_h / 2.0 if op_type == "door" else 1.0 + op_h / 2.0

        cutter_x, cutter_y = 0.0, 0.0
        if w_side == "north":
            cutter_x, cutter_y = offset, (l + wall_thickness) / 2.0
            scale_xyz = (op_w, wall_thickness * 2.0, op_h)
        elif w_side == "south":
            cutter_x, cutter_y = offset, -(l + wall_thickness) / 2.0
            scale_xyz = (op_w, wall_thickness * 2.0, op_h)
        elif w_side == "east":
            cutter_x, cutter_y = (w + wall_thickness) / 2.0, offset
            scale_xyz = (wall_thickness * 2.0, op_w, op_h)
        else: # west
            cutter_x, cutter_y = -(w + wall_thickness) / 2.0, offset
            scale_xyz = (wall_thickness * 2.0, op_w, op_h)

        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(cutter_x, cutter_y, z_pos))
        cutter = bpy.context.active_object
        cutter.name = f"Cutter_{i}"
        cutter.scale = scale_xyz
        bpy.ops.object.transform_apply(scale=True)

        mod = target_wall.modifiers.new(name=f"Cut_{i}", type='BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.object = cutter
        bpy.context.view_layer.objects.active = target_wall
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(cutter, do_unlink=True)

    return {
        "success": True,
        "environment": name,
        "bounds": {"width": w, "length": l, "height": h},
        "openings_applied": len(config.get("openings", []))
    }


def export_glb(name, out_path):
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if not objs:
        raise ValueError("Scene tidak memiliki mesh untuk diekspor")

    for o in bpy.context.view_layer.objects:
        o.select_set(o in objs)
    bpy.context.view_layer.objects.active = objs[0]

    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        export_apply=True,
        use_selection=True,
        export_yup=True
    )

    triangles = 0
    for o in objs:
        o.data.calc_loop_triangles()
        triangles += len(o.data.loop_triangles)

    return {
        "success": True,
        "name": name,
        "out_path": out_path,
        "objects": len(objs),
        "triangles": triangles,
        "bytes": os.path.getsize(out_path)
    }


def handle_tool_call(tool_name, arguments):
    if tool_name == "blender_execute_code":
        return execute_code(arguments.get("code", ""), arguments.get("clear_scene", False))
    elif tool_name == "blender_inspect_scene":
        return inspect_scene()
    elif tool_name == "blender_render_viewport":
        return render_viewport(
            arguments.get("camera_pos"),
            arguments.get("camera_target"),
            arguments.get("fov", 65),
            arguments.get("out_path"),
            arguments.get("resolution")
        )
    elif tool_name == "blender_build_environment":
        return build_environment(arguments)
    elif tool_name == "blender_export_glb":
        return export_glb(arguments.get("name", "model"), arguments.get("out_path"))
    else:
        raise ValueError(f"Tool {tool_name} tidak ditemukan")


def send_response(req_id, result=None, error=None):
    resp = {"jsonrpc": "2.0", "id": req_id}
    if error is not None:
        resp["error"] = error
    else:
        resp["result"] = result
    sys.stdout.write(json.dumps(resp) + "\n")
    sys.stdout.flush()


def main():
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception as e:
            send_response(None, error={"code": -32700, "message": f"Parse error: {e}"})
            continue

        req_id = req.get("id")
        method = req.get("method")
        params = req.get("params", {})

        if method == "initialize":
            send_response(req_id, result={
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "blender-mcp", "version": "1.0.0"}
            })
        elif method == "notifications/initialized":
            pass
        elif method == "tools/list":
            send_response(req_id, result={"tools": TOOLS})
        elif method == "tools/call":
            tool_name = params.get("name")
            tool_args = params.get("arguments", {})
            try:
                out = handle_tool_call(tool_name, tool_args)
                send_response(req_id, result={
                    "content": [{"type": "text", "text": json.dumps(out, indent=2)}]
                })
            except Exception as e:
                send_response(req_id, result={
                    "content": [{"type": "text", "text": f"Error: {str(e)}"}],
                    "isError": True
                })
        elif method == "ping":
            send_response(req_id, result={})
        else:
            if req_id is not None:
                send_response(req_id, error={"code": -32601, "message": f"Method not found: {method}"})


if __name__ == "__main__":
    main()
