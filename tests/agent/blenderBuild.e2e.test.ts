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
  }, 180_000)

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
