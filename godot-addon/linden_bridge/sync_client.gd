@tool
extends Node
class_name LindenSyncClient

## Linden Bridge Live Sync Client (Godot 4.x)
## Communicates via WebSocket with Linden Engine Live Sync Server

signal connected
signal disconnected
signal message_received(data: Dictionary)
signal error_occurred(msg: String)

var _peer: WebSocketPeer = WebSocketPeer.new()
var _server_url: String = "ws://127.0.0.1:6007"
var _token: String = ""
var _is_connected: boolean = false
var _rev: int = 1

func configure(server_url: String, token: String) -> void:
	_server_url = server_url
	_token = token

func connect_to_linden() -> Error:
	_peer = WebSocketPeer.new()
	var err = _peer.connect_to_url(_server_url)
	if err != OK:
		emit_signal("error_occurred", "Failed to connect to %s (code %d)" % [_server_url, err])
		return err
	set_process(true)
	return OK

func disconnect_from_linden() -> void:
	if _peer.get_ready_state() == WebSocketPeer.STATE_OPEN:
		_peer.close()
	_is_connected = false
	set_process(false)
	emit_signal("disconnected")

func send_message(dict: Dictionary) -> void:
	if _peer.get_ready_state() != WebSocketPeer.STATE_OPEN:
		return
	dict["v"] = 1
	dict["token"] = _token
	dict["origin"] = "godot"
	var json_str = JSON.stringify(dict)
	_peer.send_text(json_str)

func send_property_changed(linden_id: String, path: String, value: Variant) -> void:
	_rev += 1
	var msg = {
		"type": "property_changed",
		"linden_id": linden_id,
		"path": path,
		"value": value,
		"rev": _rev
	}
	send_message(msg)

func _process(_delta: float) -> void:
	_peer.poll()
	var state = _peer.get_ready_state()

	if state == WebSocketPeer.STATE_OPEN:
		if not _is_connected:
			_is_connected = true
			_send_handshake()
			emit_signal("connected")

		while _peer.get_available_packet_count() > 0:
			var packet = _peer.get_packet()
			var text = packet.get_string_from_utf8()
			var parsed = JSON.parse_string(text)
			if typeof(parsed) == TYPE_DICTIONARY:
				emit_signal("message_received", parsed)

	elif state == WebSocketPeer.STATE_CLOSED:
		if _is_connected:
			_is_connected = false
			emit_signal("disconnected")
		set_process(false)

func _send_handshake() -> void:
	var handshake = {
		"type": "hello",
		"token": _token,
		"godot_version": Engine.get_version_info()["string"]
	}
	send_message(handshake)
