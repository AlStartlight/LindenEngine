@tool
extends EditorPlugin

## Linden Bridge Editor Plugin for Godot 4.x
## Integrates Linden Engine Live Sync into the Godot Editor

const LindenSyncClient = preload("res://addons/linden_bridge/sync_client.gd")

var _client: LindenSyncClient
var _dock: Control

func _enter_tree() -> void:
	_client = LindenSyncClient.new()
	add_child(_client)

	_client.connect("connected", Callable(self, "_on_sync_connected"))
	_client.connect("disconnected", Callable(self, "_on_sync_disconnected"))
	_client.connect("message_received", Callable(self, "_on_message_received"))

	print("[Linden Bridge] Plugin loaded successfully.")

func _exit_tree() -> void:
	if _client:
		_client.disconnect_from_linden()
		_client.queue_free()

func _on_sync_connected() -> void:
	print("[Linden Bridge] Connected to Linden Engine.")

func _on_sync_disconnected() -> void:
	print("[Linden Bridge] Disconnected from Linden Engine.")

func _on_message_received(data: Dictionary) -> void:
	var msg_type = data.get("type", "")
	if msg_type == "property_changed":
		_apply_property_changed(data)

func _apply_property_changed(data: Dictionary) -> void:
	var linden_id = data.get("linden_id", "")
	var prop_path = data.get("path", "")
	var value = data.get("value", null)

	var edited_root = get_tree().edited_scene_root
	if not edited_root:
		return

	var target_node = _find_node_by_linden_id(edited_root, linden_id)
	if target_node:
		if prop_path == "transform.position" and typeof(value) == TYPE_DICTIONARY:
			target_node.position = Vector3(value.x, value.y, value.z)
		elif prop_path == "transform.rotation" and typeof(value) == TYPE_DICTIONARY:
			target_node.rotation_degrees = Vector3(value.x, value.y, value.z)
		elif prop_path == "transform.scale" and typeof(value) == TYPE_DICTIONARY:
			target_node.scale = Vector3(value.x, value.y, value.z)

func _find_node_by_linden_id(root: Node, linden_id: String) -> Node:
	if root.has_meta("linden_id") and root.get_meta("linden_id") == linden_id:
		return root
	for child in root.get_children():
		var found = _find_node_by_linden_id(child, linden_id)
		if found:
			return found
	return null
