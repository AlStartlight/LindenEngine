import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as THREE from 'three'
import { LINDEN_TOOLS, setPreviewRenderer } from '../../electron/agent/lindenTools'
import { writeGlb } from '../../engine/assets/glbWriter'
import { inspectAssetFile } from '../../electron/agent/assetInspect'
import { LindenMcpServer } from '../../electron/agent/LindenMcpServer'

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-model-tools-'))
  fs.writeFileSync(path.join(dir, 'project.linden.json'), JSON.stringify({ name: 'T', scenesInBuild: ['scenes/Main.lscene'] }))
})
afterEach(() => {
  setPreviewRenderer(null)
  fs.rmSync(dir, { recursive: true, force: true })
})

const run = (name: string, args: unknown) => LINDEN_TOOLS[name].execute(dir, args as any, {})

const table = {
  category: 'dining_table',
  parts: [
    { id: 'top', shape: { type: 'roundedBox', size: [1.6, 0.035, 0.9] }, position: [0, 0.7325, 0], material: 'wood_walnut' },
    ...[[-0.74, -0.39], [0.74, -0.39], [-0.74, 0.39], [0.74, 0.39]].map(([x, z], i) => ({
      id: `leg${i}`,
      shape: { type: 'roundedBox', size: [0.06, 0.715, 0.06] },
      position: [x, 0.3575, z],
      material: 'wood_walnut',
      attachTo: 'top',
    })),
  ],
}

describe('linden_model_build', () => {
  it('writes a Model entity and reports a clean validation with the real-world reference', async () => {
    const res = await run('linden_model_build', { name: 'Meja Makan', model: table, position: [0, 0, 0] })
    expect(res.success).toBe(true)
    expect(res.data.validation.ok).toBe(true)
    expect(res.data.realWorldReference.key).toBe('dining_table')
    expect(res.data.stats.meshes).toBe(1)
    const scene = JSON.parse(fs.readFileSync(path.join(dir, 'scenes/Main.lscene'), 'utf-8'))
    const ent = scene.entities.find((e: any) => e.id === 'meja_makan')
    expect(ent.components.map((c: any) => c.type)).toEqual(['Transform', 'Model'])
    expect(scene.settings.environment).toBe('room')
  })

  it('updates in place and keeps the entity\'s other components', async () => {
    await run('linden_model_build', { name: 'Meja', entityId: 'meja', model: table })
    const file = path.join(dir, 'scenes/Main.lscene')
    const scene = JSON.parse(fs.readFileSync(file, 'utf-8'))
    scene.entities[0].components.push({ type: 'BoxCollider', data: { size: { x: 1.6, y: 0.75, z: 0.9 } } })
    fs.writeFileSync(file, JSON.stringify(scene))
    const res = await run('linden_model_build', { name: 'Meja', entityId: 'meja', model: { ...table, parts: table.parts.map((p) => (p.id === 'top' ? { ...p, material: 'marble' } : p)) } })
    expect(res.success).toBe(true)
    const after = JSON.parse(fs.readFileSync(file, 'utf-8'))
    expect(after.entities).toHaveLength(1)
    expect(after.entities[0].components.map((c: any) => c.type).sort()).toEqual(['BoxCollider', 'Model', 'Transform'])
  })

  it('returns validator issues for a broken model and zod errors for a malformed one', async () => {
    const floating = { ...table, parts: [...table.parts.slice(0, 4), { ...table.parts[4], position: [0.74, 0.2, 0.39] }] }
    const res = await run('linden_model_build', { name: 'Meja', model: floating, dryRun: true })
    expect(res.success).toBe(true)
    expect(res.data.validation.ok).toBe(false)
    expect(res.data.validation.issues.map((i: any) => i.code)).toContain('ATTACH_GAP')
    expect(fs.existsSync(path.join(dir, 'scenes/Main.lscene'))).toBe(false)

    const bad = await run('linden_model_build', { name: 'X', model: { parts: [{ id: 'a', shape: { type: 'blob' } }] } })
    expect(bad.success).toBe(false)
    expect(bad.error).toMatch(/Model tidak valid/)
  })
})

describe('linden_material_presets / linden_dimensions', () => {
  it('lists presets with parameters and filters by category', async () => {
    const all = await run('linden_material_presets', {})
    expect(all.data.length).toBeGreaterThanOrEqual(25)
    const glass = await run('linden_material_presets', { category: 'glass' })
    expect(glass.data.every((p: any) => p.category === 'glass')).toBe(true)
    expect(glass.data.find((p: any) => p.id === 'glass_solid').params.transmission).toBe(1)
  })

  it('looks up real-world sizes by Indonesian name', async () => {
    const res = await run('linden_dimensions', { query: 'kursi' })
    expect(res.data.key).toBe('chair')
    expect(res.data.details.seatHeight).toBe(0.45)
  })
})

describe('linden_asset_import', () => {
  function sampleGlb(file: string) {
    const geom = new THREE.BoxGeometry(0.5, 1, 0.5).translate(0, 0.5, 0)
    const mat = new THREE.MeshStandardMaterial({ name: 'Painted', color: '#cc3333', roughness: 0.4 })
    const clip = new THREE.AnimationClip('Spin', 2, [new THREE.QuaternionKeyframeTrack('Box.quaternion', [0, 2], [0, 0, 0, 1, 0, 1, 0, 0])])
    fs.writeFileSync(file, writeGlb([{ name: 'Box', geometry: geom, material: mat }], [clip]))
  }

  it('copies a GLB into assets/models and reports size, triangles, materials and animations', async () => {
    const src = path.join(os.tmpdir(), `linden-sample-${Date.now()}.glb`)
    sampleGlb(src)
    try {
      const res = await run('linden_asset_import', { source: src })
      expect(res.success).toBe(true)
      expect(res.data.path).toBe(`assets/models/${path.basename(src)}`)
      expect(res.data.triangles).toBe(12)
      expect(res.data.size).toEqual([0.5, 1, 0.5])
      expect(res.data.materials).toEqual(['Painted'])
      expect(res.data.animations).toEqual([{ name: 'Spin', duration: 2 }])
      expect(fs.existsSync(path.join(dir, res.data.path))).toBe(true)

      // and it can be placed as a Model with src; bounds are stored for the auto collider
      const built = await run('linden_model_build', { name: 'Box', model: { src: res.data.path, collider: 'box' } })
      expect(built.success).toBe(true)
      const scene = JSON.parse(fs.readFileSync(path.join(dir, 'scenes/Main.lscene'), 'utf-8'))
      expect(scene.entities[0].components[1].data.bounds).toEqual([[-0.25, 0, -0.25], [0.25, 1, 0.25]])
    } finally {
      fs.rmSync(src, { force: true })
    }
  })

  it('reads HDR headers and rejects unsupported files', async () => {
    const hdr = path.join(dir, 'sky.hdr')
    fs.writeFileSync(hdr, Buffer.concat([Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 256 +X 512\n', 'latin1'), Buffer.alloc(16)]))
    const info = inspectAssetFile(hdr)
    expect(info).toMatchObject({ kind: 'environment', format: 'hdr', width: 512, height: 256, warnings: [] })
    const res = await run('linden_asset_import', { source: 'sky.hdr' })
    expect(res.data.path).toBe('assets/hdri/sky.hdr')
    fs.writeFileSync(path.join(dir, 'x.fbx'), 'x')
    expect((await run('linden_asset_import', { source: 'x.fbx' })).error).toMatch(/tidak didukung/)
  })
})

describe('linden_render_preview', () => {
  it('needs the editor; with a renderer registered it saves PNGs and returns them as MCP images', async () => {
    await run('linden_model_build', { name: 'Meja', model: table })
    const none = await run('linden_render_preview', {})
    expect(none.success).toBe(false)

    const png = Buffer.from('89504e470d0a1a0a', 'hex')
    setPreviewRenderer(async (req) => ({ images: req.views.map((view) => ({ view, png })), size: [1.6, 0.75, 0.9], triangles: 1000, warnings: [] }))
    const res = await run('linden_render_preview', { entityId: 'meja' })
    expect(res.success).toBe(true)
    expect(res.data.views).toEqual(['front', 'side', 'top', 'threeQuarter'])
    expect(res.images).toHaveLength(4)
    expect(fs.existsSync(path.join(dir, '.linden/previews/meja-front.png'))).toBe(true)

    // The MCP server forwards them as image content
    const server = new LindenMcpServer({ projectPath: dir })
    await server.start()
    try {
      const reply = await fetch(server.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${server.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'render_preview', arguments: { entityId: 'meja', views: ['front'] } } }),
      }).then((r) => r.json())
      const kinds = reply.result.content.map((c: any) => c.type)
      expect(kinds).toEqual(['text', 'text', 'image'])
      expect(reply.result.content[2]).toMatchObject({ type: 'image', mimeType: 'image/png' })
    } finally {
      server.close()
    }
  })
})

describe('linden_scene_apply settings', () => {
  it('changes only the settings when entities are omitted and rejects invalid settings', async () => {
    await run('linden_model_build', { name: 'Meja', model: table })
    const res = await run('linden_scene_apply', { settings: { environment: 'none', exposure: 1.3, postFx: { enabled: true, ao: true } } })
    expect(res.success).toBe(true)
    const scene = JSON.parse(fs.readFileSync(path.join(dir, 'scenes/Main.lscene'), 'utf-8'))
    expect(scene.entities.map((e: any) => e.id)).toEqual(['meja'])
    expect(scene.settings).toMatchObject({ environment: 'none', exposure: 1.3, toneMapping: 'agx' })
    expect(scene.settings.postFx).toMatchObject({ enabled: true, ao: true, antialias: 'smaa' })
    const bad = await run('linden_scene_apply', { settings: { toneMapping: 'filmic-ish' } })
    expect(bad.success).toBe(false)
    expect(bad.error).toMatch(/toneMapping/)
  })
})
