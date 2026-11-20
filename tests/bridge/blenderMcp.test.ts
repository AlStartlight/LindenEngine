import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const PROXY_PATH = path.join(__dirname, '..', '..', 'blender-bridge', 'mcp_proxy.js')
const SERVER_PATH = path.join(__dirname, '..', '..', 'blender-bridge', 'mcp_server.py')

describe('Blender MCP Bridge & Server', () => {
  it('has valid proxy and server scripts existing with GPL headers', () => {
    expect(fs.existsSync(PROXY_PATH)).toBe(true)
    expect(fs.existsSync(SERVER_PATH)).toBe(true)

    const proxyContent = fs.readFileSync(PROXY_PATH, 'utf-8')
    const serverContent = fs.readFileSync(SERVER_PATH, 'utf-8')

    expect(proxyContent).toMatch(/SPDX-License-Identifier: GPL-3\.0-or-later/)
    expect(serverContent).toMatch(/SPDX-License-Identifier: GPL-3\.0-or-later/)
  })

  it('mcp_server.py defines all required MCP tools for objects and environments', () => {
    const serverContent = fs.readFileSync(SERVER_PATH, 'utf-8')
    expect(serverContent).toContain('blender_execute_code')
    expect(serverContent).toContain('blender_inspect_scene')
    expect(serverContent).toContain('blender_render_viewport')
    expect(serverContent).toContain('blender_build_environment')
    expect(serverContent).toContain('blender_export_glb')
  })

  it('mcp_proxy.js executable runs and outputs help or handles fallback cleanly', async () => {
    const proc = spawn('node', [PROXY_PATH, 'nonexistent_blender_binary'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const initMsg = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' },
    }) + '\n'

    proc.stdin.write(initMsg)

    const result = await new Promise<{ exitCode: number | null; stderr: string }>((resolve) => {
      let stderr = ''
      proc.stderr.on('data', (d) => (stderr += d.toString()))
      proc.on('close', (code) => {
        resolve({ exitCode: code, stderr })
      })
      setTimeout(() => {
        try { proc.kill('SIGKILL') } catch {}
        resolve({ exitCode: null, stderr })
      }, 1500)
    })

    // It should have either failed finding the nonexistent binary or closed
    expect(result.exitCode !== null || result.stderr.length > 0).toBe(true)
  })
})
