import { describe, it, expect } from 'vitest'
import { ModelSpecSchema, ModelSpec } from '../../engine/model/ModelSpec'
import { validateModel } from '../../engine/model/validateModel'
import { buildModelObject } from '../../engine/model/buildModel'
import { REAL_WORLD_DIMENSIONS, findRealWorldDimension } from '../../engine/assets/realWorldDimensions'

const model = (raw: unknown): ModelSpec => ModelSpecSchema.parse(raw)

/** A dining chair at real size: 4 legs, seat, backrest posts and a backrest */
function chair(): unknown {
  const leg = (id: string, x: number, z: number, h: number) => ({
    id,
    shape: { type: 'roundedBox', size: [0.035, h, 0.035] },
    position: [x, h / 2, z],
    material: 'wood_teak',
    attachTo: 'seat',
  })
  return {
    category: 'chair',
    parts: [
      leg('leg_fl', -0.19, 0.19, 0.43),
      leg('leg_fr', 0.19, 0.19, 0.43),
      leg('leg_bl', -0.19, -0.19, 0.85),
      leg('leg_br', 0.19, -0.19, 0.85),
      { id: 'seat', shape: { type: 'roundedBox', size: [0.44, 0.03, 0.44] }, position: [0, 0.445, 0], material: 'wood_teak' },
      { id: 'back', shape: { type: 'roundedBox', size: [0.345, 0.3, 0.02] }, position: [0, 0.68, -0.19], material: 'rattan', attachTo: 'leg_bl' },
    ],
  }
}

describe('model validator', () => {
  it('accepts a well-formed chair at real size', () => {
    const report = validateModel(model(chair()))
    expect(report.issues).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.size[1]).toBeCloseTo(0.85, 2)
    expect(report.reference?.key).toBe('chair')
  })

  it('every shape type is built outside-out', () => {
    const shapes = [
      { type: 'roundedBox', size: [1, 1, 1] },
      { type: 'sphere', radius: 0.5 },
      { type: 'capsule', radius: 0.2, length: 0.5 },
      { type: 'cylinder', radiusTop: 0.3, radiusBottom: 0.4, height: 1 },
      { type: 'cone', radius: 0.4, height: 1 },
      { type: 'torus', radius: 0.4, tube: 0.1 },
      { type: 'lathe', points: [[0.1, 0], [0.15, 0.1], [0.08, 0.3], [0.1, 0.35]], thickness: 0.005, capBottom: true },
      { type: 'extrude', shape: [[0, 0], [0.5, 0], [0.5, 0.3], [0, 0.3]], depth: 0.05, cornerRadius: 0.02 },
      { type: 'tube', path: [[0, 0, 0], [0.2, 0.3, 0], [0.4, 0, 0]], radius: 0.02, capped: true },
    ]
    for (const shape of shapes) {
      const report = validateModel(model({ placement: 'free', parts: [{ id: 'p', shape }] }))
      expect(report.issues.filter((i) => i.code === 'INVERTED_NORMALS'), shape.type).toEqual([])
    }
  })

  it('reports a floating part with its gap', () => {
    const spec = chair() as any
    spec.parts[5].position = [0, 0.75, -0.3] // backrest pulled 10 cm behind the legs
    delete spec.parts[5].attachTo
    const report = validateModel(model(spec))
    const issue = report.issues.find((i) => i.code === 'DISCONNECTED_PART')
    expect(issue?.parts).toEqual(['back'])
    expect(issue?.message).toMatch(/cm/)
    expect(report.ok).toBe(false)
  })

  it('reports a broken attachTo', () => {
    const spec = chair() as any
    spec.parts[0].position = [-0.19, 0.2, 0.19] // front-left leg no longer reaches the seat
    const report = validateModel(model(spec))
    expect(report.issues.some((i) => i.code === 'ATTACH_GAP' && i.parts[0] === 'leg_fl')).toBe(true)
  })

  it('reports an object that floats above or sinks below the ground', () => {
    const up = validateModel(model({ parts: [{ id: 'b', shape: { type: 'roundedBox', size: [1, 1, 1] }, position: [0, 0.8, 0] }] }))
    expect(up.issues.map((i) => i.code)).toContain('NOT_ON_GROUND')
    const down = validateModel(model({ parts: [{ id: 'b', shape: { type: 'roundedBox', size: [1, 1, 1] }, position: [0, 0.2, 0] }] }))
    expect(down.issues.map((i) => i.code)).toContain('BELOW_GROUND')
    const wall = validateModel(model({ placement: 'wall', parts: [{ id: 'b', shape: { type: 'roundedBox', size: [1, 1, 1] }, position: [0, 2, 0] }] }))
    expect(wall.issues).toEqual([])
  })

  it('reports a scale far from the real-world table', () => {
    const spec = chair() as any
    spec.category = 'car_sedan'
    const report = validateModel(model(spec))
    expect(report.issues.find((i) => i.code === 'SCALE_MISMATCH')?.message).toMatch(/car_sedan/)
  })

  it('reports a part buried in another unless allowOverlap', () => {
    const spec = {
      placement: 'free',
      parts: [
        { id: 'big', shape: { type: 'roundedBox', size: [1, 1, 1] } },
        { id: 'small', shape: { type: 'sphere', radius: 0.2 } },
      ],
    }
    expect(validateModel(model(spec)).issues.map((i) => i.code)).toContain('EXCESSIVE_OVERLAP')
    ;(spec.parts[1] as any).allowOverlap = true
    expect(validateModel(model(spec)).issues).toEqual([])
  })

  it('accepts water inside a hollow glass without allowOverlap (the glass is a thin shell)', () => {
    const report = validateModel(
      model({
        category: 'drinking_glass',
        parts: [
          { id: 'glass', shape: { type: 'lathe', points: [[0.03, 0], [0.0375, 0.12]], thickness: 0.0025, capBottom: true }, material: 'glass_clear' },
          { id: 'water', shape: { type: 'lathe', points: [[0.0274, 0.0026], [0.0335, 0.09]], capBottom: true }, material: 'water', attachTo: 'glass' },
        ],
      })
    )
    expect(report.issues).toEqual([])
  })

  it('reports inside-out geometry (negative scale, reversed lathe profile)', () => {
    const neg = validateModel(model({ placement: 'free', parts: [{ id: 'b', shape: { type: 'roundedBox', size: [1, 1, 1] }, scale: [-1, 1, 1] }] }))
    expect(neg.issues.map((i) => i.code)).toContain('INVERTED_NORMALS')
    const lathe = validateModel(model({ placement: 'free', parts: [{ id: 'v', shape: { type: 'lathe', points: [[0.1, 0.3], [0.15, 0.15], [0.1, 0]] } }] }))
    expect(lathe.issues.find((i) => i.code === 'INVERTED_NORMALS')?.message).toMatch(/bawah ke atas/)
  })

  it('rejects specs with unknown part references or cycles', () => {
    expect(ModelSpecSchema.safeParse({ parts: [{ id: 'a', parent: 'x', shape: { type: 'sphere', radius: 1 } }] }).success).toBe(false)
    expect(
      ModelSpecSchema.safeParse({
        parts: [
          { id: 'a', parent: 'b', shape: { type: 'sphere', radius: 1 } },
          { id: 'b', parent: 'a', shape: { type: 'sphere', radius: 1 } },
        ],
      }).success
    ).toBe(false)
  })

  it('merges parts that share a material and instances whole models', () => {
    const merged = buildModelObject(model(chair()))
    // teak (seat + 4 legs) and rattan (back)
    expect(merged.children).toHaveLength(2)
    const instanced = buildModelObject(model({ ...(chair() as any), instances: [{ position: [0, 0, 0] }, { position: [1, 0, 0] }, { position: [2, 0, 0] }] }))
    expect(instanced.children.every((c) => (c as any).isInstancedMesh && (c as any).count === 3)).toBe(true)
    expect(instanced.userData.modelStats.triangles).toBe(merged.userData.modelStats.triangles * 3)
  })
})

describe('real-world dimensions', () => {
  it('has at least 60 entries with plausible sizes', () => {
    const entries = Object.entries(REAL_WORLD_DIMENSIONS)
    expect(entries.length).toBeGreaterThanOrEqual(60)
    for (const [key, e] of entries) {
      expect(e.size.every((n) => n > 0 && n < 50), key).toBe(true)
    }
    expect(REAL_WORLD_DIMENSIONS.chair.details?.seatHeight).toBe(0.45)
    expect(REAL_WORLD_DIMENSIONS.dining_table.size[1]).toBe(0.75)
    expect(REAL_WORLD_DIMENSIONS.door.size.slice(0, 2)).toEqual([0.9, 2.0])
    expect(REAL_WORLD_DIMENSIONS.human_adult.size[1]).toBe(1.7)
    expect(REAL_WORLD_DIMENSIONS.car_sedan.size).toEqual([1.8, 1.45, 4.5])
  })

  it('finds entries by Indonesian alias', () => {
    expect(findRealWorldDimension('kursi')?.key).toBe('chair')
    expect(findRealWorldDimension('Lampu Meja')?.key).toBe('desk_lamp')
    expect(findRealWorldDimension('mobil sport')?.key).toBe('car_sports')
    expect(findRealWorldDimension('unicorn')).toBeNull()
  })
})

describe('model auto collider', () => {
  it('box collider wraps the parts (with entity scale), convex hull keeps the points under the cap', async () => {
    const { modelColliderShape } = await import('../../engine/model/modelCollider')
    const spec = chair() as any
    const box = modelColliderShape({ ...spec, collider: 'box' }, { x: 2, y: 1, z: 1 })
    expect(box?.kind).toBe('box')
    if (box?.kind === 'box') {
      expect(box.halfExtents[1]).toBeCloseTo(0.425, 3)
      expect(box.halfExtents[0]).toBeCloseTo(0.44, 3) // seat 0.44 m wide, scaled ×2, halved
      expect(box.center[1]).toBeCloseTo(0.425, 3)
    }
    const hull = modelColliderShape({ ...spec, collider: 'convexHull' }, { x: 1, y: 1, z: 1 })
    expect(hull?.kind).toBe('hull')
    if (hull?.kind === 'hull') expect(hull.points.length / 3).toBeLessThanOrEqual(2048)
    expect(modelColliderShape({ ...spec, collider: 'none' }, { x: 1, y: 1, z: 1 })).toBeNull()
    expect(modelColliderShape({ src: 'assets/a.glb', bounds: [[-1, 0, -1], [1, 2, 1]], collider: 'convexHull' }, { x: 1, y: 1, z: 1 })).toEqual({ kind: 'box', center: [0, 1, 0], halfExtents: [1, 1, 1] })
  })

  it('a dynamic model with an auto collider lands on the ground in the headless simulation', async () => {
    const { simulateScene } = await import('../../electron/agent/lindenTools')
    const scene = {
      format: 'linden-scene',
      version: 2,
      name: 'Drop',
      entities: [
        { id: 'ground', name: 'Ground', parentId: null, components: [{ type: 'Transform', data: { position: [0, -0.5, 0], rotation: [0, 0, 0], scale: [20, 1, 20] } }, { type: 'MeshRenderer', data: { primitive: 'box' } }, { type: 'BoxCollider', data: { size: { x: 1, y: 1, z: 1 } } }] },
        { id: 'chair', name: 'Chair', parentId: null, components: [{ type: 'Transform', data: { position: [0, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }, { type: 'Model', data: { ...(chair() as any), collider: 'convexHull' } }, { type: 'Rigidbody', data: { bodyType: 'dynamic', mass: 5 } }] },
      ],
    }
    const report: any = await simulateScene(JSON.stringify(scene), 2)
    expect(report.errors).toEqual([])
    // Resting on its legs: the origin (lowest point) ends at ground level
    const [, y] = report.finalPositions.Chair
    expect(y).toBeGreaterThan(-0.05)
    expect(y).toBeLessThan(0.1)
  })
})
