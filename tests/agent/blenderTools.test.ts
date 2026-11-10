import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import * as THREE from 'three'
import { LINDEN_TOOLS, setBlenderSpawn } from '../../electron/agent/lindenTools'
import { STDERR_TAIL, tail } from '../../electron/agent/lindenTools/blenderTools'
import { LindenMcpServer } from '../../electron/agent/LindenMcpServer'
import { beginBlenderTurn, endBlenderTurn } from '../../electron/agent/blenderMode'
import { setBlenderStatusForTest } from '../../electron/bridge/blenderDetect'
import { BlenderSpecSchema, parseBlenderError, parseBlenderResult } from '../../shared/blenderSpec'
import { writeGlb } from '../../engine/assets/glbWriter'

const OFF = 'Mode Blender 3D tidak aktif untuk prompt ini. Gunakan linden_model_build.'

const cube = {
  objects: [{ name: 'box', primitive: 'cube', scale: [1, 1, 0.5], modifiers: [{ type: 'bevel', width: 0.05, segments: 3 }], material: { baseColor: '#cc3333', roughness: 0.4 } }],
}

const RESULT = { objects: 1, triangles: 12, bounds: { min: [-0.5, -0.5, 0], max: [0.5, 0.5, 0.5] }, materials: ['box_mat'], warnings: [] }

type FakeRun = (args: string[]) => { code: number | null; stdout?: string; stderr?: string; writeGlb?: boolean; hang?: boolean }

interface SpawnCall {
  bin: string
  args: string[]
  opts: any
}

/** Fake `spawn`: emits the scripted output and writes out.glb like runner.py would */
function fakeSpawn(run: FakeRun, calls: SpawnCall[]) {
  return ((bin: string, args: string[], opts: any) => {
    calls.push({ bin, args, opts })
    const child: any = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    const out = run(args)
    child.kill = () => setImmediate(() => child.emit('close', null))
    if (!out.hang) {
      setImmediate(() => {
        if (out.writeGlb) {
          const outFile = args[args.indexOf('--out') + 1]
          const geom = new THREE.BoxGeometry(1, 0.5, 1).translate(0, 0.25, 0)
          fs.writeFileSync(outFile, writeGlb([{ name: 'box', geometry: geom, material: new THREE.MeshStandardMaterial({ name: 'box_mat' }) }]))
        }
        if (out.stdout) child.stdout.emit('data', Buffer.from(out.stdout))
        if (out.stderr) child.stderr.emit('data', Buffer.from(out.stderr))
        child.emit('close', out.code)
      })
    }
    return child
  }) as any
}

const ok: FakeRun = () => ({ code: 0, writeGlb: true, stdout: `Blender 4.2.3\nLINDEN_RESULT:${JSON.stringify(RESULT)}\n` })

let dir: string
let calls: SpawnCall[]
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-blender-tools-'))
  fs.writeFileSync(path.join(dir, 'project.linden.json'), JSON.stringify({ name: 'T' }))
  calls = []
  setBlenderStatusForTest({ found: true, path: '/fake/blender', version: '4.2.3', source: 'manual' })
  setBlenderSpawn(fakeSpawn(ok, calls))
})
afterEach(() => {
  endBlenderTurn()
  setBlenderSpawn(null)
  setBlenderStatusForTest(null)
  fs.rmSync(dir, { recursive: true, force: true })
})

const run = (name: string, args: unknown, options: any = {}) => LINDEN_TOOLS[name].execute(dir, args as any, options)

describe('BlenderSpecSchema', () => {
  it('accepts a bevelled cube and a boolean with a cutter', () => {
    expect(BlenderSpecSchema.safeParse(cube).success).toBe(true)
    const mug = {
      objects: [
        { name: 'body', primitive: 'cylinder', params: { radius: 0.045, depth: 0.1 }, modifiers: [{ type: 'boolean', operation: 'difference', with: 'hole' }] },
        { name: 'hole', primitive: 'cylinder', params: { radius: 0.04, depth: 0.1 }, cutter: true },
      ],
      join: true,
    }
    expect(BlenderSpecSchema.safeParse(mug).success).toBe(true)
  })

  it('rejects unknown primitives and keys, duplicate names, bad boolean targets and heavy stacks', () => {
    const bad = (spec: unknown) => {
      const r = BlenderSpecSchema.safeParse(spec)
      expect(r.success).toBe(false)
      return r.success ? '' : r.error.issues.map((i) => i.message).join('; ')
    }
    bad({ objects: [{ name: 'a', primitive: 'monkey' }] })
    bad({ objects: [{ name: 'a', primitive: 'cube', eval: 'x' }] })
    bad({ objects: [] })
    expect(bad({ objects: [{ name: 'a', primitive: 'cube' }, { name: 'a', primitive: 'cube' }] })).toMatch(/lebih dari sekali/)
    expect(bad({ objects: [{ name: 'a', primitive: 'cube', modifiers: [{ type: 'boolean', operation: 'difference', with: 'zzz' }] }] })).toMatch(/tidak ada/)
    expect(bad({ objects: [{ name: 'a', primitive: 'cube', modifiers: [{ type: 'boolean', operation: 'union', with: 'a' }] }] })).toMatch(/itu sendiri/)
    expect(bad({ objects: [{ name: 'a', primitive: 'cube', cutter: true }] })).toMatch(/bukan cutter/)
    bad({ objects: [{ name: 'a', primitive: 'cube', modifiers: [{ type: 'subdivision', levels: 4 }] }] })
    const heavy = { objects: [{ name: 'a', primitive: 'cube', modifiers: [{ type: 'subdivision', levels: 3 }, { type: 'array', count: 64, offset: [1, 0, 0] }, { type: 'mirror', axes: ['x'] }] }] }
    expect(bad(heavy)).toMatch(/terlalu berat/)
    bad({ objects: [{ name: 'a b/../c', primitive: 'cube' }] })
  })
})

describe('runner output parsing', () => {
  it('reads the last LINDEN_RESULT line and the LINDEN_ERROR message', () => {
    expect(parseBlenderResult(`noise\nLINDEN_RESULT:${JSON.stringify(RESULT)}\nBlender quit\n`)).toEqual(RESULT)
    expect(parseBlenderResult('no marker')).toBeNull()
    expect(parseBlenderResult('LINDEN_RESULT:{broken')).toBeNull()
    expect(parseBlenderResult('LINDEN_RESULT:{"objects":1}')).toBeNull()
    expect(parseBlenderError('Traceback...\nLINDEN_ERROR:boolean pada body menunjuk objek yang tidak valid\n')).toBe('boolean pada body menunjuk objek yang tidak valid')
    expect(parseBlenderError('nothing')).toBeNull()
  })

  it('keeps only the last 4 KB of long stderr', () => {
    const long = 'x'.repeat(10_000) + 'END'
    const t = tail(long)
    expect(t.length).toBe(STDERR_TAIL + 1)
    expect(t.endsWith('END')).toBe(true)
  })
})

describe('Blender tools refuse while the per-turn flag is off', () => {
  it('build and script return the off message and never spawn Blender', async () => {
    expect(await run('linden_blender_build', { name: 'Box', spec: cube })).toEqual({ success: false, error: OFF })
    expect(await run('linden_blender_script', { name: 'Box', code: 'import bpy' }, { requestPermission: async () => true })).toEqual({ success: false, error: OFF })
    expect(calls).toHaveLength(0)
    const status = await run('linden_blender_status', {})
    expect(status.data).toMatchObject({ found: true, version: '4.2.3', active: false })
  })
})

describe('linden_blender_build', () => {
  beforeEach(() => beginBlenderTurn('ses_1'))

  it('runs Blender with safe flags in a project job folder and imports the GLB into assets/models', async () => {
    const res = await run('linden_blender_build', { name: 'Kotak Bevel', spec: cube })
    expect(res.success).toBe(true)
    expect(res.data.path).toBe('assets/models/kotak_bevel.glb')
    expect(res.data.triangles).toBe(12)
    expect(res.data.blender).toMatchObject({ version: '4.2.3', objects: 1, triangles: 12 })
    expect(fs.existsSync(path.join(dir, 'assets/models/kotak_bevel.glb'))).toBe(true)

    const call = calls[0]
    expect(call.bin).toBe('/fake/blender')
    expect(call.args.slice(0, 7)).toEqual(['-b', '--factory-startup', '-Y', '--offline-mode', '--python-exit-code', '1', '-P'])
    expect(call.args[7]).toMatch(/blender-bridge[\\/]runner\.py$/)
    expect(call.args).toContain('--spec')
    expect(call.opts.shell).toBe(false)
    expect(call.opts.cwd.startsWith(path.join(dir, '.linden/agent/blender'))).toBe(true)
    expect(call.opts.env.PYTHONPATH).toBeUndefined()
    // The successful job folder is cleaned up
    expect(fs.existsSync(call.opts.cwd)).toBe(false)
  })

  it('writes the validated spec for the runner', async () => {
    let written: any = null
    setBlenderSpawn(
      fakeSpawn((args) => {
        written = JSON.parse(fs.readFileSync(args[args.indexOf('--spec') + 1], 'utf-8'))
        return ok(args)
      }, calls)
    )
    await run('linden_blender_build', { name: 'Box', spec: cube, target: 'assets/models/props/box.glb' })
    expect(written).toEqual(cube)
    expect(fs.existsSync(path.join(dir, 'assets/models/props/box.glb'))).toBe(true)
  })

  it('rejects an invalid spec or target before spawning', async () => {
    const res = await run('linden_blender_build', { name: 'Box', spec: { objects: [{ name: 'a', primitive: 'monkey' }] } })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/Spec Blender tidak valid/)
    expect((await run('linden_blender_build', { name: 'Box', spec: cube, target: '../x.glb' })).success).toBe(false)
    expect((await run('linden_blender_build', { name: 'Box', spec: cube, target: 'assets/../../x.glb' })).success).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('reports a failed run with the runner error and the stderr tail, keeping the job log', async () => {
    const noise = 'y'.repeat(9000)
    setBlenderSpawn(fakeSpawn(() => ({ code: 1, stderr: `${noise}\nLINDEN_ERROR:Principled BSDF tidak tersedia\n` }), calls))
    const res = await run('linden_blender_build', { name: 'Box', spec: cube })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/^Principled BSDF tidak tersedia/)
    expect(res.error!.length).toBeLessThan(STDERR_TAIL + 400)
    expect(res.error).toMatch(/log: \.linden\/agent\/blender\/.+\/log\.txt/)
    expect(fs.existsSync(path.join(calls[0].opts.cwd, 'log.txt'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'assets/models'))).toBe(false)
  })

  it('fails when Blender exits 0 without a result line', async () => {
    setBlenderSpawn(fakeSpawn(() => ({ code: 0, stdout: 'Blender quit\n' }), calls))
    expect((await run('linden_blender_build', { name: 'Box', spec: cube })).error).toMatch(/tanpa baris LINDEN_RESULT/)
  })

  it('kills Blender after the timeout', async () => {
    const { runBlender } = await import('../../electron/agent/lindenTools/blenderTools')
    let killed = false
    setBlenderSpawn(((bin: string, args: string[], opts: any) => {
      const child: any = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.kill = () => {
        killed = true
        setImmediate(() => child.emit('close', null))
      }
      return child
    }) as any)
    const job = path.join(dir, 'job')
    fs.mkdirSync(job)
    const res = await runBlender('/fake/blender', job, ['--spec', 'x'], 30)
    expect(killed).toBe(true)
    expect(res).toEqual({ ok: false, error: 'Blender melewati batas waktu 0 detik dan dihentikan' })
  })

  it('refuses results above the triangle budget', async () => {
    setBlenderSpawn(fakeSpawn(() => ({ code: 0, writeGlb: true, stdout: `LINDEN_RESULT:${JSON.stringify({ ...RESULT, triangles: 500_000 })}\n` }), calls))
    const res = await run('linden_blender_build', { name: 'Box', spec: cube })
    expect(res.error).toMatch(/terlalu berat/)
    expect(fs.existsSync(path.join(dir, 'assets/models/box.glb'))).toBe(false)
  })

  it('reports a missing Blender', async () => {
    setBlenderStatusForTest({ found: false, reason: 'Blender 4.2+ tidak ditemukan' })
    expect((await run('linden_blender_build', { name: 'Box', spec: cube })).error).toMatch(/tidak ditemukan/)
  })
})

describe('linden_blender_script', () => {
  beforeEach(() => beginBlenderTurn('ses_1'))
  const code = 'import bpy\nbpy.ops.mesh.primitive_monkey_add()\n'

  it('asks the user with the full code and does not run when refused', async () => {
    const asked: any[] = []
    const res = await run('linden_blender_script', { name: 'Suzanne', code }, { requestPermission: async (r: any) => (asked.push(r), false) })
    expect(asked[0]).toMatchObject({ action: 'blender_script', resources: ['Suzanne'], code })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/ditolak user/)
    expect(calls).toHaveLength(0)
  })

  it('runs the approved script and imports the result', async () => {
    let script = ''
    setBlenderSpawn(
      fakeSpawn((args) => {
        script = fs.readFileSync(args[args.indexOf('--script') + 1], 'utf-8')
        return ok(args)
      }, calls)
    )
    const res = await run('linden_blender_script', { name: 'Suzanne', code }, { requestPermission: async () => true })
    expect(res.success).toBe(true)
    expect(script).toBe(code)
    expect(res.data.path).toBe('assets/models/suzanne.glb')
  })

  it('refuses without an editor to ask, oversized code, and a turn that ended while waiting', async () => {
    expect((await run('linden_blender_script', { name: 'S', code })).error).toMatch(/persetujuan/)
    expect((await run('linden_blender_script', { name: 'S', code: 'x'.repeat(70 * 1024) }, { requestPermission: async () => true })).error).toMatch(/terlalu panjang/)
    const res = await run('linden_blender_script', { name: 'S', code }, { requestPermission: async () => (endBlenderTurn(), true) })
    expect(res.error).toBe(OFF)
    expect(calls).toHaveLength(0)
  })
})

describe('MCP tool list', () => {
  it('lists the Blender tools only while Blender is detected', async () => {
    const server = new LindenMcpServer({ projectPath: dir })
    await server.start()
    const list = async () => {
      const res = await fetch(server.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${server.token}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      })
      return ((await res.json()).result.tools as any[]).map((t) => t.name)
    }
    try {
      expect(await list()).toEqual(expect.arrayContaining(['blender_build', 'blender_script', 'blender_status']))
      setBlenderStatusForTest({ found: false })
      const names = await list()
      expect(names.some((n) => n.startsWith('blender_'))).toBe(false)
      expect(names).toContain('model_build')
      const call = await fetch(server.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${server.token}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'blender_status', arguments: {} } }),
      })
      expect((await call.json()).error.message).toMatch(/Unknown tool/)
    } finally {
      server.close()
    }
  })
})
