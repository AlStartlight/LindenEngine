#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Linden Engine Blender MCP Proxy Bridge.
// Connects to the official Blender Lab MCP Server over TCP (port 9876) if active,
// or spawns a background managed Blender process running mcp_server.py.

const net = require('net')
const { spawn } = require('child_process')
const path = require('path')

const BLENDER_PORT = 9876
const BLENDER_HOST = '127.0.0.1'
const PROBE_TIMEOUT_MS = 400

const blenderBin = process.argv[2] || 'blender'
const mcpServerScript = path.join(__dirname, 'mcp_server.py')

let backend = null
let stdinBuffer = []

function forwardBuffer(dest) {
  while (stdinBuffer.length > 0) {
    const chunk = stdinBuffer.shift()
    dest.write(chunk)
  }
}

process.stdin.on('data', (chunk) => {
  if (backend) {
    backend.write(chunk)
  } else {
    stdinBuffer.push(chunk)
  }
})

// Probe port 9876 (Blender Lab MCP Server)
const socket = new net.Socket()
let connected = false

const timer = setTimeout(() => {
  if (!connected) {
    socket.destroy()
    startHeadlessBlender()
  }
}, PROBE_TIMEOUT_MS)

socket.connect(BLENDER_PORT, BLENDER_HOST, () => {
  connected = true
  clearTimeout(timer)
  backend = socket

  socket.pipe(process.stdout)
  forwardBuffer(socket)

  socket.on('close', () => {
    process.exit(0)
  })
})

socket.on('error', () => {
  if (!connected) {
    clearTimeout(timer)
    socket.destroy()
    startHeadlessBlender()
  }
})

function startHeadlessBlender() {
  const args = [
    '-b',
    '--factory-startup',
    '-Y',
    '--offline-mode',
    '--python-exit-code', '1',
    '-P', mcpServerScript,
  ]

  let child
  try {
    child = spawn(blenderBin, args, {
      stdio: ['pipe', 'pipe', 'inherit'],
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONDONTWRITEBYTECODE: '1',
      },
    })
  } catch (err) {
    process.stderr.write(`[Blender MCP Proxy] Gagal menjalankan Blender: ${err.message}\n`)
    process.exit(1)
  }

  backend = child.stdin
  child.stdout.pipe(process.stdout)
  forwardBuffer(child.stdin)

  child.on('error', (err) => {
    process.stderr.write(`[Blender MCP Proxy] Error child process: ${err.message}\n`)
    process.exit(1)
  })

  child.on('close', (code) => {
    process.exit(code || 0)
  })

  function onParentDisconnected() {
    if (child) {
      try { child.kill('SIGTERM') } catch {}
      setTimeout(() => {
        try { child.kill('SIGKILL') } catch {}
        process.exit(0)
      }, 400)
    } else {
      process.exit(0)
    }
  }

  process.stdin.on('end', onParentDisconnected)
  process.stdin.on('close', onParentDisconnected)

  process.on('SIGINT', onParentDisconnected)
  process.on('SIGTERM', onParentDisconnected)
  process.on('SIGHUP', onParentDisconnected)
}
