extends SceneTree

# Extractor Godot Headless for Linden Engine
# Runs under: godot --headless --path <project> --script res://.linden/linden_extract.gd -- --out <out_dir>

func _init():
	var args = OS.get_cmdline_user_args()
	var out_dir = ""
	for i in range(args.size()):
		if args[i] == "--out" and i + 1 < args.size():
			out_dir = args[i + 1]
			break

	if out_dir == "":
		out_dir = ProjectSettings.globalize_path("res://.linden/ir")

	var dir = DirAccess.open(out_dir)
	if dir == null:
		DirAccess.make_dir_recursive_absolute(out_dir)

	var files = []
	_scan_dir("res://", files)

	var ok_count = 0
	var failed_files = []
	var total_nodes_instantiated = 0
	var total_instance_nodes = 0

	for scene_path in files:
		var packed_scene = load(scene_path)
		if packed_scene == null or not (packed_scene is PackedScene):
			failed_files.append({"path": scene_path, "error": "Failed to load as PackedScene"})
			continue

		var state = packed_scene.get_state()
		if state == null:
			failed_files.append({"path": scene_path, "error": "PackedScene get_state() returned null"})
			continue

		# Build Scene IR from PackedScene state
		var scene_ir = {
			"path": scene_path,
			"inheritsFrom": null,
			"nodes": [],
			"connections": []
		}

		var node_count = state.get_node_count()
		for i in range(node_count):
			var node_path_val = String(state.get_node_path(i))
			var node_name_val = String(state.get_node_name(i))
			var node_type_val = String(state.get_node_type(i))
			var instance_val = state.get_node_instance(i)
			var groups_packed = state.get_node_groups(i)
			var groups_arr = []
			for g in groups_packed:
				groups_arr.append(String(g))

			var instance_path = null
			if instance_val is PackedScene and instance_val.resource_path != "":
				instance_path = instance_val.resource_path

			var props = {}
			var prop_count = state.get_node_property_count(i)
			for p in range(prop_count):
				var p_name = state.get_node_property_name(p)
				var p_val = state.get_node_property_value(p)
				props[p_name] = _serialize_variant(p_val)

			var script_path = null
			if props.has("script") and props["script"] is Dictionary:
				if props["script"].has("path"):
					script_path = props["script"]["path"]

			var node_ir = {
				"path": node_path_val,
				"name": node_name_val,
				"type": node_type_val,
				"groups": groups_arr,
				"props": props
			}
			if instance_path != null:
				node_ir["instance"] = instance_path
			if script_path != null:
				node_ir["script"] = script_path

			scene_ir["nodes"].append(node_ir)

		# Connections
		var conn_count = state.get_connection_count()
		for c in range(conn_count):
			scene_ir["connections"].append({
				"from": String(state.get_connection_source(c)),
				"signal": String(state.get_connection_signal(c)),
				"to": String(state.get_connection_target(c)),
				"method": String(state.get_connection_method(c)),
				"flags": state.get_connection_flags(c)
			})

		# Instantiation check for expansion count and overrides
		var inst_root = packed_scene.instantiate()
		if inst_root != null:
			var stack = [inst_root]
			while stack.size() > 0:
				var curr = stack.pop_back()
				total_nodes_instantiated += 1
				if curr.scene_file_path != "" and curr != inst_root:
					total_instance_nodes += 1
				var children = curr.get_children()
				for ch in children:
					stack.append(ch)
			inst_root.free()

		# Save IR json file
		var rel = scene_path.replace("res://", "")
		var target_file_path = out_dir.path_join(rel + ".json")
		var target_sub_dir = target_file_path.get_base_dir()
		if not DirAccess.dir_exists_absolute(target_sub_dir):
			DirAccess.make_dir_recursive_absolute(target_sub_dir)

		var f = FileAccess.open(target_file_path, FileAccess.WRITE)
		if f != null:
			f.store_string(JSON.stringify(scene_ir, "\t"))
			f.close()
			ok_count += 1
		else:
			failed_files.append({"path": scene_path, "error": "Cannot write IR output file: " + target_file_path})

	var summary = {
		"scenes": files.size(),
		"ok": ok_count,
		"failed": failed_files,
		"nodes_instantiated": total_nodes_instantiated,
		"instance_nodes": total_instance_nodes
	}

	var summary_file_path = out_dir.path_join("summary.json")
	var sf = FileAccess.open(summary_file_path, FileAccess.WRITE)
	if sf != null:
		sf.store_string(JSON.stringify(summary, "\t"))
		sf.close()

	print("LINDEN_SUMMARY:" + JSON.stringify(summary))
	quit(0)

func _scan_dir(current_path: String, out_files: Array):
	var da = DirAccess.open(current_path)
	if da == null:
		return
	da.include_hidden = false
	da.list_dir_begin()
	var item = da.get_next()
	while item != "":
		if da.current_is_dir():
			if item != ".godot" and item != ".linden" and item != ".git":
				_scan_dir(current_path.path_join(item), out_files)
		else:
			if item.ends_with(".tscn"):
				out_files.append(current_path.path_join(item))
		item = da.get_next()
	da.list_dir_end()

func _serialize_variant(val):
	if val == null:
		return null
	var t = typeof(val)
	match t:
		TYPE_BOOL, TYPE_INT, TYPE_FLOAT, TYPE_STRING:
			return val
		TYPE_VECTOR2:
			return {"$t": "Vector2", "v": [val.x, val.y]}
		TYPE_VECTOR2I:
			return {"$t": "Vector2", "v": [val.x, val.y]}
		TYPE_VECTOR3:
			return {"$t": "Vector3", "v": [val.x, val.y, val.z]}
		TYPE_VECTOR3I:
			return {"$t": "Vector3", "v": [val.x, val.y, val.z]}
		TYPE_COLOR:
			return {"$t": "Color", "v": [val.r, val.g, val.b, val.a]}
		TYPE_QUATERNION:
			return {"$t": "Quaternion", "v": [val.x, val.y, val.z, val.w]}
		TYPE_TRANSFORM3D:
			return {
				"$t": "Transform3D",
				"basis": [
					val.basis.x.x, val.basis.x.y, val.basis.x.z,
					val.basis.y.x, val.basis.y.y, val.basis.y.z,
					val.basis.z.x, val.basis.z.y, val.basis.z.z
				],
				"origin": [val.origin.x, val.origin.y, val.origin.z]
			}
		TYPE_TRANSFORM2D:
			return {
				"$t": "Transform2D",
				"v": [val.x.x, val.x.y, val.y.x, val.y.y, val.origin.x, val.origin.y]
			}
		TYPE_NODE_PATH:
			return {"$t": "NodePath", "v": String(val)}
		TYPE_ARRAY:
			var arr = []
			for elem in val:
				arr.append(_serialize_variant(elem))
			return arr
		TYPE_DICTIONARY:
			var d = {}
			for k in val.keys():
				d[String(k)] = _serialize_variant(val[k])
			return d
		TYPE_OBJECT:
			if val is Resource:
				var res_dict = {
					"$t": "Resource",
					"type": val.get_class()
				}
				if val.resource_path != "":
					res_dict["path"] = val.resource_path
				return res_dict
			return {"$t": "Object", "type": val.get_class()}
		_:
			return str(val)
