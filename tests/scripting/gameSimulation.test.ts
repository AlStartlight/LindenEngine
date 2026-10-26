import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { World } from '../../engine/ecs/World'
import { GameSimulation } from '../../engine/runtime/GameSimulation'
import { ScriptRuntime } from '../../engine/scripting/ScriptRuntime'
import '../../engine/ecs/ComponentRegistry'

async function positionAfterOneSecond(fps: number): Promise<number> {
  const world = new World()
  const ent = world.createEntity('Mover')
  world.addComponent(ent.id, 'Script', { src: 'scripts/Mover.ts' })
  const sim = new GameSimulation(world)
  sim.scripts = new ScriptRuntime({
    world,
    loadModule: async () => ({
      default: class {
        ctx: any
        onInit(ctx: any) {
          this.ctx = ctx
        }
        onFixedUpdate(dt: number) {
          this.ctx.entity.getTransform().position.x += 2 * dt
        }
      },
    }),
  })
  await sim.scripts.loadAll()
  for (let i = 0; i < fps; i++) sim.frame(1 / fps)
  return ent.getTransform().position.x
}

describe('GameSimulation fixed timestep', () => {
  it('moves the same distance at 30, 60 and 144 FPS', async () => {
    const results = await Promise.all([30, 60, 144].map(positionAfterOneSecond))
    for (const x of results) expect(x).toBeCloseTo(2, 1)
    expect(Math.abs(results[0] - results[2])).toBeLessThan(2 / 60 + 1e-6)
  })
})

describe('linden_play runs project scripts', () => {
  it('compiles, runs and reports script errors with location', async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-play-'))
    try {
      fs.mkdirSync(path.join(project, 'scripts'))
      fs.writeFileSync(
        path.join(project, 'scripts/Lift.ts'),
        "import { Vector3 } from 'three'\nexport default class Lift {\n  speed: number = 1\n  ctx: any\n  onInit(ctx: any) { this.ctx = ctx; new Vector3() }\n  onUpdate(dt: number) { this.ctx.entity.getTransform().position.y += this.speed * dt }\n}\n"
      )
      fs.writeFileSync(path.join(project, 'scripts/Crash.ts'), "export default class Crash {\n  onUpdate() { throw new Error('boom') }\n}\n")
      const scene = JSON.stringify({
        format: 'linden-scene',
        version: 2,
        name: 'T',
        entities: [
          { id: 'l', name: 'Lift', parentId: null, components: [
            { type: 'Transform', data: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
            { type: 'Script', data: { src: 'scripts/Lift.ts', props: { speed: 3 } } },
          ] },
          { id: 'c', name: 'Crasher', parentId: null, components: [
            { type: 'Transform', data: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
            { type: 'Script', data: { src: 'scripts/Crash.ts' } },
          ] },
        ],
      })
      const { simulateScene } = await import('../../electron/agent/lindenTools')
      const report = await simulateScene(scene, 1, { projectPath: project })
      expect(report.scripts.compiled).toEqual(['scripts/Crash.ts', 'scripts/Lift.ts'])
      expect(report.scripts.running).toBe(1)
      expect(report.errors.join('\n')).toMatch(/scripts\/Crash\.ts \(Crasher, update\): boom/)
    } finally {
      fs.rmSync(project, { recursive: true, force: true })
    }
  })
})
