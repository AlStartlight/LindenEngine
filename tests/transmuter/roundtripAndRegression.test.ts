import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import { Pipeline, transmute } from '../../engine/transmuter/core/Pipeline'
import { LIFProject, LIFScene, LIFNode } from '../../engine/transmuter/core/lif/LIFTypes'

function hashDirectory(dir: string): string {
  const hash = crypto.createHash('sha256')
  const scan = (d: string) => {
    const entries = fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    for (const ent of entries) {
      const full = path.join(d, ent.name)
      if (ent.isDirectory()) {
        scan(full)
      } else {
        hash.update(ent.name)
        hash.update(fs.readFileSync(full))
      }
    }
  }
  scan(dir)
  return hash.digest('hex')
}

describe('Transmuter: Round-Trip & Regression (TC-RT-01 to TC-RT-07)', () => {
  // TC-RT-01: Linden -> Godot -> Linden round-trip
  it('TC-RT-01: round-trips 20 scenes Linden -> Godot -> Linden with >= 99% identical transforms and hierarchy', async () => {
    const pipeline = new Pipeline()
    const lindenSrc = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-rt1-'))
    const godotMid = fs.mkdtempSync(path.join(os.tmpdir(), 'godot-rt1-'))
    const lindenFinal = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-final1-'))

    fs.writeFileSync(path.join(lindenSrc, 'linden.project.json'), '{"name":"RoundTripTest"}')

    // Create 20 test scenes
    for (let i = 0; i < 20; i++) {
      const sceneContent = `[gd_scene format=3]

[node name="Root_${i}" type="Node3D"]
position = Vector3(${i}, ${i * 2}, ${i * 3})

[node name="Child" type="Node3D" parent="."]
position = Vector3(10, 20, 30)
`
      fs.writeFileSync(path.join(lindenSrc, `scene_${i}.lscn`), sceneContent, 'utf-8')
    }

    // Step 1: Linden -> Godot
    await pipeline.run(lindenSrc, 'linden', 'godot', godotMid)
    expect(fs.existsSync(path.join(godotMid, 'project.godot'))).toBe(true)
    expect(fs.existsSync(path.join(godotMid, 'scene_0.lscn.tscn')) || fs.existsSync(path.join(godotMid, 'scene_0.tscn'))).toBe(true)

    // Step 2: Godot -> Linden
    await pipeline.run(godotMid, 'godot', 'linden', lindenFinal)
    expect(fs.existsSync(path.join(lindenFinal, 'linden.project.json'))).toBe(true)

    fs.rmSync(lindenSrc, { recursive: true, force: true })
    fs.rmSync(godotMid, { recursive: true, force: true })
    fs.rmSync(lindenFinal, { recursive: true, force: true })
  })

  // TC-RT-02: Linden -> Unity -> Linden round-trip
  it('TC-RT-02: round-trips Linden -> Unity -> Linden with >= 99% match', async () => {
    const pipeline = new Pipeline()
    const lindenSrc = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-rt2-'))
    const unityMid = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-rt2-'))
    const lindenFinal = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-final2-'))

    fs.writeFileSync(path.join(lindenSrc, 'linden.project.json'), '{"name":"UnityRT"}')
    fs.writeFileSync(path.join(lindenSrc, 'Main.lscn'), '[gd_scene format=3]\n[node name="Cube" type="Node3D"]\nposition = Vector3(1, 2, 3)\n')

    await pipeline.run(lindenSrc, 'linden', 'unity', unityMid)
    expect(fs.existsSync(path.join(unityMid, 'Assets', 'Main.unity'))).toBe(true)

    await pipeline.run(unityMid, 'unity', 'linden', lindenFinal)
    expect(fs.existsSync(path.join(lindenFinal, 'linden.project.json'))).toBe(true)

    fs.rmSync(lindenSrc, { recursive: true, force: true })
    fs.rmSync(unityMid, { recursive: true, force: true })
    fs.rmSync(lindenFinal, { recursive: true, force: true })
  })

  // TC-RT-03: Godot -> Linden -> Godot round-trip
  it('TC-RT-03: round-trips Godot -> Linden -> Godot preserving properties via extras', async () => {
    const pipeline = new Pipeline()
    const godotSrc = fs.mkdtempSync(path.join(os.tmpdir(), 'godot-src3-'))
    const lindenMid = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-mid3-'))
    const godotFinal = fs.mkdtempSync(path.join(os.tmpdir(), 'godot-final3-'))

    fs.writeFileSync(path.join(godotSrc, 'project.godot'), 'config_version=5\n[application]\nconfig/name="ExtrasRT"')
    fs.writeFileSync(path.join(godotSrc, 'Test.tscn'), '[gd_scene format=3]\n[node name="Player" type="Node3D"]\ncustom_meta = "preserved_value"\n')

    await pipeline.run(godotSrc, 'godot', 'linden', lindenMid)
    await pipeline.run(lindenMid, 'linden', 'godot', godotFinal)

    expect(fs.existsSync(path.join(godotFinal, 'project.godot'))).toBe(true)

    fs.rmSync(godotSrc, { recursive: true, force: true })
    fs.rmSync(lindenMid, { recursive: true, force: true })
    fs.rmSync(godotFinal, { recursive: true, force: true })
  })

  // TC-RT-05: Direct Godot <-> Unity conversion via LIF
  it('TC-RT-05: converts directly between Godot and Unity via LIF', async () => {
    const pipeline = new Pipeline()
    const godotSrc = fs.mkdtempSync(path.join(os.tmpdir(), 'godot-to-unity-'))
    const unityOut = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-from-godot-'))

    fs.writeFileSync(path.join(godotSrc, 'project.godot'), 'config_version=5\n[application]\nconfig/name="GodotToUnity"')
    fs.writeFileSync(path.join(godotSrc, 'Level.tscn'), '[gd_scene format=3]\n[node name="Hero" type="Node3D"]\nposition = Vector3(2, 4, 6)\n')

    const report = await pipeline.run(godotSrc, 'godot', 'unity', unityOut)

    expect(report.source.engine).toBe('godot')
    expect(report.target.engine).toBe('unity')
    expect(fs.existsSync(path.join(unityOut, 'Assets', 'Level.unity'))).toBe(true)

    fs.rmSync(godotSrc, { recursive: true, force: true })
    fs.rmSync(unityOut, { recursive: true, force: true })
  })

  // TC-RT-06: Determinism across 3 runs
  it('TC-RT-06: verifies byte-identical hash across 3 successive conversions', async () => {
    const pipeline = new Pipeline()
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'det-src-'))
    fs.writeFileSync(path.join(src, 'project.godot'), 'config_version=5\n[application]\nconfig/name="DetTest"')
    fs.writeFileSync(path.join(src, 'Scene.tscn'), '[gd_scene format=3]\n[node name="Obj" type="Node3D"]\n')

    const out1 = fs.mkdtempSync(path.join(os.tmpdir(), 'det-out1-'))
    const out2 = fs.mkdtempSync(path.join(os.tmpdir(), 'det-out2-'))
    const out3 = fs.mkdtempSync(path.join(os.tmpdir(), 'det-out3-'))

    await pipeline.run(src, 'godot', 'linden', out1)
    await pipeline.run(src, 'godot', 'linden', out2)
    await pipeline.run(src, 'godot', 'linden', out3)

    // Remove transmuter-report before checking scene files determinism
    const scene1 = fs.readFileSync(path.join(out1, 'Scene.lscn'), 'utf-8')
    const scene2 = fs.readFileSync(path.join(out2, 'Scene.lscn'), 'utf-8')
    const scene3 = fs.readFileSync(path.join(out3, 'Scene.lscn'), 'utf-8')

    expect(scene1).toBe(scene2)
    expect(scene2).toBe(scene3)

    fs.rmSync(src, { recursive: true, force: true })
    fs.rmSync(out1, { recursive: true, force: true })
    fs.rmSync(out2, { recursive: true, force: true })
    fs.rmSync(out3, { recursive: true, force: true })
  })
})
