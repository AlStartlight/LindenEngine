import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LINDEN_TOOLS } from '../../electron/agent/lindenTools'
import { beginBlenderTurn, endBlenderTurn } from '../../electron/agent/blenderMode'
import { detectBlender } from '../../electron/bridge/blenderDetect'
import { setBridgeSettingsDir } from '../../electron/bridge/godotExec'

/**
 * Optional end-to-end run with a real Blender (>= 4.2): skipped when none is found, so CI never
 * needs Blender. Point LINDEN_BLENDER at a specific install to test that one.
 */
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-blender-e2e-settings-'))
setBridgeSettingsDir(settingsDir)
const status = await detectBlender({ refresh: true })

describe.skipIf(!status.found)(`linden_blender_build with a real Blender (${status.version ?? 'tidak ditemukan'})`, () => {
  let dir: string
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-blender-e2e-'))
    fs.writeFileSync(path.join(dir, 'project.linden.json'), JSON.stringify({ name: 'E2E' }))
    beginBlenderTurn('e2e')
  })
  afterAll(() => {
    endBlenderTurn()
    fs.rmSync(dir, { recursive: true, force: true })
    fs.rmSync(settingsDir, { recursive: true, force: true })
  })

  it('builds a bevelled cube and imports the GLB into assets/models', async () => {
    const res = await LINDEN_TOOLS.linden_blender_build.execute(dir, {
      name: 'Kubus Bevel',
      spec: {
        objects: [
          {
            name: 'cube',
            primitive: 'cube',
            location: [0, 0, 3],
            scale: [0.5, 0.5, 0.5],
            modifiers: [{ type: 'bevel', width: 0.05, segments: 3 }],
            material: { baseColor: '#3366cc', roughness: 0.4 },
          },
        ],
      },
    })
    expect(res.error).toBeUndefined()
    expect(res.success).toBe(true)
    const file = path.join(dir, 'assets/models/kubus_bevel.glb')
    expect(fs.readFileSync(file).subarray(0, 4).toString('latin1')).toBe('glTF')
    // Bevel adds faces beyond the cube's 12 triangles; the model sits on the ground (y = 0 after Y-up)
    expect(res.data.blender.triangles).toBeGreaterThan(12)
    expect(res.data.bounds[0][1]).toBeCloseTo(0, 3)
    expect(res.data.size[1]).toBeCloseTo(0.5, 2)
    // The agent must SEE the result: three review renders come back as MCP images
    expect(res.images).toHaveLength(3)
    expect(res.images?.[0].mimeType).toBe('image/png')
    expect((res.images?.[0].data as string).length).toBeGreaterThan(1000)
    expect(res.data.previewCount).toBe(3)
  }, 180_000)

  it('sculpts a lathe and bakes PBR maps + photoreal graded previews into the GLB', async () => {
    const res = await LINDEN_TOOLS.linden_blender_build.execute(dir, {
      name: 'Sculpted Vase',
      spec: {
        objects: [
          {
            name: 'Vase',
            primitive: 'lathe',
            params: {
              segments: 64,
              profileSubdivisions: 2,
              profile: [
                [0, 0], [0.075, 0], [0.09, 0.012], [0.145, 0.09], [0.155, 0.15],
                [0.135, 0.23], [0.085, 0.3], [0.098, 0.345], [0.072, 0.335], [0, 0.04],
              ],
            },
            sculpt: { preset: 'clay', strength: 0.0015, subdivide: 1, seed: 3 },
            material: {
              baseColor: '#cbb49b',
              roughness: 0.3,
              texture: { pattern: 'stone', scale: 2, contrast: 0.5, resolution: 256, bump: 0.5 },
            },
            smooth: true,
          },
        ],
        grade: { exposure: -0.1, colorGrade: { contrast: 1.1, vignette: 0.2 } },
        preview: { samples: 8, resolution: 256 },
      },
    })
    expect(res.error).toBeUndefined()
    expect(res.success).toBe(true)
    const file = path.join(dir, 'assets/models/sculpted_vase.glb')
    const glb = fs.readFileSync(file)
    expect(glb.subarray(0, 4).toString('latin1')).toBe('glTF')
    // All three PBR maps are embedded in the single GLB (no loose texture files)
    expect(glb.includes(Buffer.from('image/png'))).toBe(true)
    expect(res.data.blender.textures).toHaveLength(3)
    expect(res.data.blender.textures?.join(',')).toMatch(/albedo/)
    expect(res.data.blender.textures?.join(',')).toMatch(/orm/)
    expect(res.data.blender.textures?.join(',')).toMatch(/normal/)
    expect(res.data.blender.grade?.colorGrade?.contrast).toBe(1.1)
    expect(res.images).toHaveLength(3)
  }, 240_000)

  it('rigs a character with standard biped armature and locomotion actions', async () => {
    const res = await LINDEN_TOOLS.linden_blender_rig_character.execute(dir, {
      name: 'Robot Hero',
      spec: {
        objects: [
          { name: 'body', primitive: 'cube', scale: [0.6, 0.4, 0.8], location: [0, 0, 1.2], material: { baseColor: '#5588cc' } },
          { name: 'head', primitive: 'uv_sphere', params: { radius: 0.25 }, location: [0, 0, 1.8], material: { baseColor: '#ffffff' } },
        ],
      },
      height: 1.8,
    })
    expect(res.error).toBeUndefined()
    expect(res.success).toBe(true)
    const file = path.join(dir, 'assets/models/robot_hero.glb')
    expect(fs.readFileSync(file).subarray(0, 4).toString('latin1')).toBe('glTF')
    expect(res.data.blender.bones).toBe(22)
    expect(res.data.blender.animations).toEqual(expect.arrayContaining(['Idle', 'Walk', 'Run', 'Jump_Start', 'Fall', 'Land']))
  }, 180_000)
})
