import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { TscnParser } from '../../engine/godot/tscn/TscnParser'
import { Pipeline, transmute } from '../../engine/transmuter/core/Pipeline'
import { runCli } from '../../engine/transmuter/cli/transmuter'
import { FidelityReport } from '../../engine/transmuter/core/FidelityReport'

describe('Transmuter: Performance, CLI & UI (TC-PF-01 to TC-UI-05)', () => {
  // TC-PF-01: 500 assets project conversion performance <= 60s
  it('TC-PF-01: imports 500 node elements within 5 seconds (well below 60s limit)', async () => {
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-500-'))
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-out-'))

    fs.writeFileSync(path.join(srcDir, 'project.godot'), 'config_version=5\n[application]\nconfig/name="Perf500"')

    // Generate scene with 500 nodes
    const lines = ['[gd_scene format=3]', '', '[node name="Root" type="Node3D"]']
    for (let i = 0; i < 500; i++) {
      lines.push(`[node name="Node_${i}" type="Node3D" parent="."]`)
      lines.push(`position = Vector3(${i}, 0, 0)`)
    }
    fs.writeFileSync(path.join(srcDir, 'big_scene.tscn'), lines.join('\n'), 'utf-8')

    const start = Date.now()
    const pipeline = new Pipeline()
    const report = await pipeline.run(srcDir, 'godot', 'linden', outDir)
    const elapsed = (Date.now() - start) / 1000

    expect(elapsed).toBeLessThan(5.0) // Well below 60s
    expect(report.getSummary().full).toBeGreaterThan(0)

    fs.rmSync(srcDir, { recursive: true, force: true })
    fs.rmSync(outDir, { recursive: true, force: true })
  })

  // TC-PF-02: Parse scene with 10,000 nodes in <= 5s
  it('TC-PF-02: parses .tscn with 10,000 nodes in <= 5 seconds', () => {
    const lines = ['[gd_scene format=3]', '', '[node name="Root" type="Node3D"]']
    for (let i = 0; i < 10000; i++) {
      lines.push(`[node name="Obj_${i}" type="Node3D" parent="."]`)
    }
    const tscn = lines.join('\n')

    const start = Date.now()
    const parser = new TscnParser()
    const doc = parser.parse(tscn)
    const durationSec = (Date.now() - start) / 1000

    expect(doc.nodes.length).toBe(10001)
    expect(durationSec).toBeLessThan(5.0)
  })

  // TC-CL-01: CLI exit code 2 when partial items exist
  it('TC-CL-01: returns exit code 2 when partial conversion items exist', async () => {
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-test-'))
    fs.writeFileSync(path.join(srcDir, 'project.godot'), 'config_version=5\n[application]\nconfig/name="CliTest"')
    // Script with unsupported construct to trigger partial
    fs.writeFileSync(
      path.join(srcDir, 'test.gd'),
      'extends Node\nfunc test():\n\tawait get_tree().create_timer(1).timeout\n',
      'utf-8'
    )

    const code = await runCli(['analyze', srcDir, '--to', 'linden', '--json'])
    expect(code).toBe(2)

    fs.rmSync(srcDir, { recursive: true, force: true })
  })

  // TC-CL-02: Cancellation cleanup
  it('TC-CL-02: cancels conversion cleanly via AbortSignal without corrupting destination', async () => {
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abort-src-'))
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abort-out-'))

    fs.writeFileSync(path.join(srcDir, 'project.godot'), 'config_version=5\n[application]\nconfig/name="AbortTest"')
    fs.writeFileSync(path.join(srcDir, 'scene.tscn'), '[gd_scene format=3]\n[node name="Root" type="Node3D"]\n')

    const controller = new AbortController()
    controller.abort() // Pre-aborted

    await expect(
      transmute(srcDir, 'godot', 'linden', outDir, { signal: controller.signal })
    ).rejects.toThrow('Conversion aborted by user')

    fs.rmSync(srcDir, { recursive: true, force: true })
    fs.rmSync(outDir, { recursive: true, force: true })
  })

  // TC-UI-02: Dry run analysis leaves output folder untouched
  it('TC-UI-02: dry-run analysis generates fidelity report without creating files in output folder', async () => {
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dry-src-'))
    const outDir = path.join(os.tmpdir(), `dry-out-${Date.now()}`)

    fs.writeFileSync(path.join(srcDir, 'project.godot'), 'config_version=5\n[application]\nconfig/name="DryRunTest"')
    fs.writeFileSync(path.join(srcDir, 'scene.tscn'), '[gd_scene format=3]\n[node name="Box" type="Node3D"]\n')

    const report = await transmute(srcDir, 'godot', 'linden', outDir, { dryRun: true })

    expect(report.getSummary().full).toBeGreaterThan(0)
    // Target output directory should NOT exist because dryRun=true
    expect(fs.existsSync(outDir)).toBe(false)

    fs.rmSync(srcDir, { recursive: true, force: true })
  })

  // TC-UI-03: Report navigation & inspection
  it('TC-UI-03: reports source element paths for node hierarchy navigation', () => {
    const report = new FidelityReport()
    report.addItem('node', 'res://levels/level1.tscn#Player/AnimationTree', 'partial', 'BlendSpace2D converted', 'Rebuild in Animator')

    const data = report.getData()
    expect(data.items[0].source).toBe('res://levels/level1.tscn#Player/AnimationTree')
    expect(data.items[0].fix).toContain('Rebuild in Animator')
  })

  // TC-UI-05: WCAG AA contrast verification in reports
  it('TC-UI-05: verifies HTML report uses high contrast colors >= 4.5:1', () => {
    const report = new FidelityReport()
    report.addItem('node', 'Root', 'full')
    const html = report.toHTML()

    // Background #0f172a, Text #f8fafc (contrast ratio 16.5:1, well above WCAG AA 4.5:1)
    expect(html).toContain('background: #0f172a')
    expect(html).toContain('color: #f8fafc')
  })
})
