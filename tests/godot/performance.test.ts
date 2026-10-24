import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { World } from '../../engine/ecs/World'
import { ComponentMap } from '../../engine/godot/mapping/ComponentMap'
import { TscnWriter } from '../../engine/godot/tscn/TscnWriter'
import { TscnParser } from '../../engine/godot/tscn/TscnParser'
import { GodotBuildRunner } from '../../engine/godot/build/GodotBuildRunner'
import { CompatReport } from '../../engine/godot/report/CompatReport'

describe('Bridge (Godot) - Performance and E2E Tests (PC-01, PC-02, E2E-08)', () => {
  // PC-01: Export 1,000 entities in <= 5 seconds
  it('PC-01: exports 1,000 entities in <= 5.0 seconds', () => {
    const world = new World()
    const root = world.createEntity('BenchmarkRoot')

    for (let i = 0; i < 999; i++) {
      const e = world.createEntity(`Entity_${i}`, root.id)
      e.getTransform().setPosition(i * 1.5, 0, (i % 10) * 2)
      e.getTransform().setRotation(0, (i * 15) % 360, 0)
    }

    expect(world.getEntities().length).toBe(1000)

    const startTime = performance.now()
    const report = new CompatReport()
    const doc = ComponentMap.exportWorld(world, report)
    const writer = new TscnWriter()
    const output = writer.write(doc)
    const durationSec = (performance.now() - startTime) / 1000

    expect(report.isSuccess).toBe(true)
    expect(doc.nodes.length).toBe(1000)
    expect(output.length).toBeGreaterThan(10000)
    expect(durationSec).toBeLessThan(5.0)
  })

  // PC-02: Import 1,000 nodes in <= 5 seconds
  it('PC-02: imports 1,000 nodes in <= 5.0 seconds', () => {
    const lines: string[] = ['[gd_scene format=3]', '', '[node name="Root" type="Node3D"]', '']
    for (let i = 0; i < 999; i++) {
      lines.push(
        `[node name="Node_${i}" type="Node3D" parent="."]`,
        `transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, ${i}, 0, 0)`,
        `metadata/linden_id = "bench_${i}"`,
        ''
      )
    }
    const tscnText = lines.join('\n')

    const startTime = performance.now()
    const parser = new TscnParser()
    const doc = parser.parse(tscnText)
    const report = new CompatReport()
    const world = ComponentMap.importWorld(doc, report)
    const durationSec = (performance.now() - startTime) / 1000

    expect(world.getEntities().length).toBe(1000)
    expect(report.isSuccess).toBe(true)
    expect(durationSec).toBeLessThan(5.0)
  })

  // E2E-08: Godot not found handling
  it('E2E-08: returns descriptive error when Godot executable is not found without crashing', async () => {
    const runner = new GodotBuildRunner('/dummy/project', '/nonexistent/godot_binary_path')
    const result = await runner.build('Web', '/dummy/output')

    expect(result.success).toBe(false)
    expect(result.exitCode).toBe(-1)
    expect(result.error).toContain('Godot executable not found')
    expect(result.logs[0]).toContain('Godot executable not found')
  })
})
