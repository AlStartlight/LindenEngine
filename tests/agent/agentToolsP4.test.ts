import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LINDEN_TOOLS } from '../../electron/agent/lindenTools'
import { reviewBlocksExport } from '../../electron/agent/lindenTools/reviewTools'

/**
 * P4 capability backlog: batch play tests, seeded level synthesis, time-travel
 * snapshots, block-level script patching and the review gate.
 */

let root = ''
let project = ''

const scene = {
  format: 'linden-scene',
  version: 2,
  name: 'Main',
  settings: {},
  entities: [
    {
      id: 'g',
      name: 'Ground',
      parentId: null,
      components: [
        { type: 'Transform', data: { position: [0, -0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
        { type: 'BoxCollider', data: { size: { x: 100, y: 1, z: 100 } } },
      ],
    },
    {
      id: 'p',
      name: 'Hero',
      parentId: null,
      components: [
        { type: 'Transform', data: { position: [0, 1.05, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
        { type: 'CapsuleCollider', data: { radius: 0.5, height: 2 } },
        { type: 'CharacterController', data: {} },
        { type: 'CharacterMovement', data: { walkSpeed: 4 } },
      ],
    },
  ],
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-p4-'))
  project = path.join(root, 'game')
  fs.mkdirSync(path.join(project, 'scenes'), { recursive: true })
  fs.mkdirSync(path.join(project, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(project, 'project.linden.json'), JSON.stringify({ name: 'P4 Game', version: '1.0.0' }))
  fs.writeFileSync(path.join(project, 'scenes/Main.lscene'), JSON.stringify(scene, null, 2))
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('linden_play_matrix', () => {
  it('runs several scenarios and aggregates the verdicts', async () => {
    const out = await LINDEN_TOOLS.linden_play_matrix.execute(project, {
      scenePath: 'scenes/Main.lscene',
      runs: [
        { label: 'walk', durationSeconds: 1, inputScript: [{ at: 0.1, action: 'Move', value: [0, 1] }] },
        { label: 'jump', durationSeconds: 1, inputScript: [{ at: 0.2, action: 'Jump', press: true }, { at: 0.3, action: 'Jump', press: false }] },
      ],
    })
    expect(out.success).toBe(true)
    expect(out.data.runs).toBe(2)
    expect(out.data.passed).toBe(2)
    expect(out.data.failed).toBe(0)
    expect(out.data.failures).toEqual([])
    expect(out.data.totalSimulatedSeconds).toBeGreaterThan(1.5)
    expect(out.data.results[0].characters.length).toBe(1)
  })

  it('generates deterministic random scenarios from a seed', async () => {
    const args = { scenePath: 'scenes/Main.lscene', generate: { count: 2, seed: 7, durationSeconds: 1 } }
    const a = await LINDEN_TOOLS.linden_play_matrix.execute(project, args)
    const b = await LINDEN_TOOLS.linden_play_matrix.execute(project, args)
    expect(a.success).toBe(true)
    expect(a.data.results.map((r: any) => r.label)).toEqual(b.data.results.map((r: any) => r.label))
    expect(a.data.runs).toBe(2)
  })

  it('requires runs or generate', async () => {
    const out = await LINDEN_TOOLS.linden_play_matrix.execute(project, {})
    expect(out.success).toBe(false)
  })
})

describe('linden_level_synthesize', () => {
  it('is deterministic for the same seed and brief', async () => {
    const args = { brief: 'ice temple with a boss arena', seed: 42, width: 15, height: 15, tileSize: 2 }
    const a = await LINDEN_TOOLS.linden_level_synthesize.execute(project, args)
    const b = await LINDEN_TOOLS.linden_level_synthesize.execute(project, args)
    expect(a.success).toBe(true)
    expect(a.data.theme).toBe('ice')
    expect(JSON.stringify(a.data.entities)).toBe(JSON.stringify(b.data.entities))
    expect(a.data.map.join('\n')).toContain('S')
    expect(a.data.map.join('\n')).toContain('E')
    expect(a.data.stats.entityCount).toBeGreaterThan(5)
  })

  it('produces a different layout for a different seed', async () => {
    const a = await LINDEN_TOOLS.linden_level_synthesize.execute(project, { brief: 'cave', seed: 1, width: 15, height: 15 })
    const b = await LINDEN_TOOLS.linden_level_synthesize.execute(project, { brief: 'cave', seed: 2, width: 15, height: 15 })
    expect(JSON.stringify(a.data.entities)).not.toBe(JSON.stringify(b.data.entities))
  })

  it('tags the markers the level agent and architect rely on', async () => {
    const out = await LINDEN_TOOLS.linden_level_synthesize.execute(project, { brief: 'mars outpost', seed: 5 })
    const tags = new Set(out.data.entities.flatMap((e: any) => e.tags))
    for (const tag of ['Spawn', 'Exit', 'Wall', 'Ground', 'Hazard', 'Loot', 'EnemySpawn']) expect(tags.has(tag)).toBe(true)
    expect(out.data.theme).toBe('mars')
  })
})

describe('linden_snapshot_*', () => {
  it('creates, lists and restores a snapshot, keeping a pre-restore copy', async () => {
    const created = await LINDEN_TOOLS.linden_snapshot_create.execute(project, { label: 'before edit' })
    expect(created.success).toBe(true)
    const id = created.data.id as string

    const scenePath = path.join(project, 'scenes/Main.lscene')
    fs.writeFileSync(scenePath, JSON.stringify({ format: 'linden-scene', version: 2, name: 'Changed', entities: [] }))

    const list = await LINDEN_TOOLS.linden_snapshot_list.execute(project, {})
    expect(list.data.snapshots.map((s: any) => s.id)).toContain(id)

    const restored = await LINDEN_TOOLS.linden_snapshot_restore.execute(project, { id })
    expect(restored.success).toBe(true)
    expect(restored.data.restoredCount).toBeGreaterThan(0)
    expect(restored.data.preRestoreId).toMatch(/^snap_/)

    const after = JSON.parse(fs.readFileSync(scenePath, 'utf-8'))
    expect(after.name).toBe('Main')
    expect(after.entities.length).toBe(2)

    const list2 = await LINDEN_TOOLS.linden_snapshot_list.execute(project, {})
    expect(list2.data.snapshots.length).toBeGreaterThanOrEqual(2)
  })

  it('rejects an invalid snapshot id', async () => {
    const out = await LINDEN_TOOLS.linden_snapshot_restore.execute(project, { id: '../../etc/passwd' })
    expect(out.success).toBe(false)
  })
})

describe('linden_script_patch', () => {
  const script = `export default class Player {
  private speed = 4

  update(dt: number) {
    this.x += this.speed * dt
  }

  move(x: number) {
    return x * this.speed
  }
}
`
  beforeAll(() => {
    fs.writeFileSync(path.join(project, 'scripts/Player.ts'), script)
  })

  it('replaces one method and preserves the rest of the file', async () => {
    const out = await LINDEN_TOOLS.linden_script_patch.execute(project, {
      scriptPath: 'scripts/Player.ts',
      target: { kind: 'method', name: 'update' },
      op: 'replace',
      code: 'update(dt: number) {\n    this.x += 2 * dt\n    this.emit("moved")\n  }',
    })
    expect(out.success).toBe(true)
    const text = fs.readFileSync(path.join(project, 'scripts/Player.ts'), 'utf-8')
    expect(text).toContain('this.emit("moved")')
    expect(text).not.toContain('this.speed * dt')
    expect(text).toContain('move(x: number)')
    expect(text).toContain('private speed = 4')
  })

  it('inserts a method after an existing one', async () => {
    const out = await LINDEN_TOOLS.linden_script_patch.execute(project, {
      scriptPath: 'scripts/Player.ts',
      target: { kind: 'method', name: 'move' },
      op: 'insert-after',
      code: 'dash() {\n    this.x += 10\n  }',
    })
    expect(out.success).toBe(true)
    const text = fs.readFileSync(path.join(project, 'scripts/Player.ts'), 'utf-8')
    expect(text).toContain('dash()')
    expect(text.indexOf('dash()')).toBeGreaterThan(text.indexOf('move(x: number)'))
  })

  it('deletes a method and rejects an unknown target', async () => {
    const del = await LINDEN_TOOLS.linden_script_patch.execute(project, {
      scriptPath: 'scripts/Player.ts',
      target: { kind: 'method', name: 'dash' },
      op: 'delete',
    })
    expect(del.success).toBe(true)
    expect(fs.readFileSync(path.join(project, 'scripts/Player.ts'), 'utf-8')).not.toContain('dash()')

    const missing = await LINDEN_TOOLS.linden_script_patch.execute(project, {
      scriptPath: 'scripts/Player.ts',
      target: { kind: 'method', name: 'nope' },
      op: 'delete',
    })
    expect(missing.success).toBe(false)
    expect(missing.error).toContain('tidak ditemukan')
  })

  it('refuses non-TypeScript scripts', async () => {
    const out = await LINDEN_TOOLS.linden_script_patch.execute(project, {
      scriptPath: 'scripts/Enemy.cs',
      target: { kind: 'class', name: 'Enemy' },
      op: 'delete',
    })
    expect(out.success).toBe(false)
  })
})

describe('linden_review_gate', () => {
  it('records a request and an independent approval, then unblocks export', async () => {
    const requested = await LINDEN_TOOLS.linden_review_gate.execute(
      project,
      { action: 'request', target: 'scenes/Main.lscene', quorum: 1 },
      { agent: { clientId: 'linden-game-architect', role: 'linden-game-architect' } }
    )
    expect(requested.success).toBe(true)
    expect(requested.data.review.status).toBe('requested')

    const verdict = await LINDEN_TOOLS.linden_review_gate.execute(
      project,
      { action: 'verdict', verdict: 'approve', note: 'play test pass' },
      { agent: { clientId: 'linden-qa-physics-tester', role: 'linden-qa-physics-tester' } }
    )
    expect(verdict.success).toBe(true)
    expect(verdict.data.review.status).toBe('approved')
    expect(verdict.data.approvals).toEqual(['linden-qa-physics-tester'])
  })

  it('refuses a verdict from the requesting role', async () => {
    await LINDEN_TOOLS.linden_review_gate.execute(
      project,
      { action: 'request', target: 'self review' },
      { agent: { clientId: 'linden-qa-physics-tester', role: 'linden-qa-physics-tester' } }
    )
    const out = await LINDEN_TOOLS.linden_review_gate.execute(
      project,
      { action: 'verdict', verdict: 'approve' },
      { agent: { clientId: 'linden-qa-physics-tester', role: 'linden-qa-physics-tester' } }
    )
    expect(out.success).toBe(false)
    expect(out.error).toContain('sendiri')
  })

  it('gates export only when the project opts in', async () => {
    expect(reviewBlocksExport(project)).toBeNull()

    const configPath = path.join(project, 'project.linden.json')
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    fs.writeFileSync(configPath, JSON.stringify({ ...config, agentReview: { required: true } }))
    expect(reviewBlocksExport(project)).toContain('LINDEN_E_REVIEW')

    await LINDEN_TOOLS.linden_review_gate.execute(
      project,
      { action: 'request', target: 'ship' },
      { agent: { clientId: 'linden-game-architect', role: 'linden-game-architect' } }
    )
    await LINDEN_TOOLS.linden_review_gate.execute(
      project,
      { action: 'verdict', verdict: 'approve' },
      { agent: { clientId: 'linden-qa-physics-tester', role: 'linden-qa-physics-tester' } }
    )
    expect(reviewBlocksExport(project)).toBeNull()
  })
})
