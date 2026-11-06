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

describe('model validator: real contact and balance', () => {
  it('a part next to a rotated brace is not touching just because it is inside the brace bounding box', () => {
    // Brace from (-0.49, -0.49) to (0.49, 0.49); the cube sits in the empty corner, 0.57 m from it
    const report = validateModel(model({
      placement: 'free',
      parts: [
        { id: 'brace', shape: { type: 'roundedBox', size: [1.4, 0.05, 0.05] }, rotation: [0, 0, 45] },
        { id: 'cube', shape: { type: 'roundedBox', size: [0.1, 0.1, 0.1] }, position: [-0.4, 0.4, 0], attachTo: 'brace' },
      ],
    }))
    expect(report.issues.map((i) => i.code).sort()).toEqual(['ATTACH_GAP', 'DISCONNECTED_PART'])
    const gap = report.issues.find((i) => i.code === 'ATTACH_GAP')!
    expect(gap.message).toMatch(/berjarak (4[5-9]|5\d)\.\d cm/)
  })

  it('a part touching the rotated brace surface is connected', () => {
    // Cube centered on the brace axis at (0.3, 0.3)
    const report = validateModel(model({
      placement: 'free',
      parts: [
        { id: 'brace', shape: { type: 'roundedBox', size: [1.4, 0.05, 0.05] }, rotation: [0, 0, 45] },
        { id: 'cube', shape: { type: 'roundedBox', size: [0.1, 0.1, 0.1] }, position: [0.3, 0.3, 0], attachTo: 'brace' },
      ],
    }))
    expect(report.issues).toEqual([])
  })

  it('a part fully inside another counts as connected (bulb inside a shade)', () => {
    const report = validateModel(model({
      placement: 'free',
      parts: [
        { id: 'shell', shape: { type: 'sphere', radius: 0.3 } },
        { id: 'core', shape: { type: 'sphere', radius: 0.05 }, allowOverlap: true },
      ],
    }))
    expect(report.issues.filter((i) => i.code === 'DISCONNECTED_PART')).toEqual([])
  })

  it('reports mass and center of mass from material densities', () => {
    // 1 m³ of oak (750 kg/m³) and 0.001 m³ of steel... as 10 cm cube on top
    const report = validateModel(model({
      parts: [
        { id: 'block', shape: { type: 'roundedBox', size: [1, 1, 1], radius: 0 }, position: [0, 0.5, 0], material: 'wood_oak' },
        { id: 'weight', shape: { type: 'roundedBox', size: [0.1, 0.1, 0.1], radius: 0 }, position: [0, 1.05, 0], material: 'metal_steel' },
      ],
    }))
    expect(report.mass).toBeCloseTo(750 + 7.85, 1)
    expect(report.centerOfMass[0]).toBeCloseTo(0, 3)
    expect(report.centerOfMass[1]).toBeCloseTo((750 * 0.5 + 7.85 * 1.05) / 757.85, 3)
    expect(report.supportMargin).toBeCloseTo(0.5, 2)
  })

  it('part density overrides the material (hollow car body)', () => {
    const solid = validateModel(model({ parts: [{ id: 'b', shape: { type: 'roundedBox', size: [1, 1, 1], radius: 0 }, position: [0, 0.5, 0], material: 'metal_steel' }] }))
    const hollow = validateModel(model({ parts: [{ id: 'b', shape: { type: 'roundedBox', size: [1, 1, 1], radius: 0 }, position: [0, 0.5, 0], material: 'metal_steel', density: 150 }] }))
    expect(solid.mass).toBeCloseTo(7850, 0)
    expect(hollow.mass).toBeCloseTo(150, 0)
  })

  it('reports an object whose center of mass is outside its footprint (heavy arm over a small base)', () => {
    const report = validateModel(model({
      parts: [
        { id: 'base', shape: { type: 'cylinder', radiusTop: 0.06, radiusBottom: 0.06, height: 0.02 }, position: [0, 0.01, 0], material: 'plastic_matte' },
        { id: 'pole', shape: { type: 'cylinder', radiusTop: 0.01, radiusBottom: 0.01, height: 0.5 }, position: [0, 0.27, 0], material: 'metal_steel', attachTo: 'base' },
        { id: 'arm', shape: { type: 'roundedBox', size: [0.6, 0.04, 0.04] }, position: [0.3, 0.54, 0], material: 'metal_steel', attachTo: 'pole' },
        { id: 'head', shape: { type: 'sphere', radius: 0.08 }, position: [0.6, 0.5, 0], material: 'metal_brass', attachTo: 'arm' },
      ],
    }))
    const issue = report.issues.find((i) => i.code === 'UNSTABLE_BALANCE')
    expect(issue?.severity).toBe('error')
    expect(report.supportMargin).toBeLessThan(0)
    expect(report.ok).toBe(false)
  })

  it('the well-formed chair is balanced', () => {
    const report = validateModel(model(chair()))
    expect(report.supportMargin).toBeGreaterThan(0.1)
    expect(report.mass).toBeGreaterThan(1)
    expect(report.mass).toBeLessThan(15)
  })

  it('a sphere resting on one point is balanced', () => {
    const report = validateModel(model({ parts: [{ id: 'ball', shape: { type: 'sphere', radius: 0.11 }, position: [0, 0.11, 0], material: 'rubber' }] }))
    expect(report.issues.filter((i) => i.code === 'UNSTABLE_BALANCE')).toEqual([])
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

describe('model compound collider', () => {
  const table = () => {
    const leg = (id: string, x: number, z: number) => ({ id, shape: { type: 'roundedBox', size: [0.05, 0.72, 0.05] }, position: [x, 0.36, z], material: 'wood_oak', attachTo: 'top' })
    return {
      category: 'dining_table',
      collider: 'compound',
      parts: [
        { id: 'top', shape: { type: 'roundedBox', size: [1.6, 0.03, 0.9] }, position: [0, 0.735, 0], material: 'wood_oak' },
        leg('l1', -0.75, -0.4), leg('l2', 0.75, -0.4), leg('l3', -0.75, 0.4), leg('l4', 0.75, 0.4),
      ],
    }
  }

  it('builds one primitive per part with mass shares, capsules along tubes and tori', async () => {
    const { modelColliderShape } = await import('../../engine/model/modelCollider')
    const shape = modelColliderShape(chair() as any, { x: 1, y: 1, z: 1 })
    expect(shape).toBeNull() // chair() has no collider set
    const c = modelColliderShape({ ...(chair() as any), collider: 'compound' }, { x: 2, y: 2, z: 2 })
    expect(c?.kind).toBe('compound')
    if (c?.kind !== 'compound') return
    expect(c.colliders.map((x) => x.kind)).toEqual(['cuboid', 'cuboid', 'cuboid', 'cuboid', 'cuboid', 'cuboid'])
    expect(c.colliders.reduce((a, x) => a + x.massFraction, 0)).toBeCloseTo(1, 6)
    const seat = c.colliders.find((x) => x.part === 'seat')!
    expect(seat.kind === 'cuboid' && seat.halfExtents[0]).toBeCloseTo(0.44, 3) // 0.44 m × scale 2 / 2
    expect(seat.center[1]).toBeCloseTo(0.89, 3)

    const curved = modelColliderShape({
      collider: 'compound',
      parts: [
        { id: 'handle', shape: { type: 'tube', path: [[0, 0, 0], [0.1, 0.1, 0], [0.2, 0, 0]], radius: 0.01 }, material: 'metal_chrome' },
        { id: 'ring', shape: { type: 'torus', radius: 0.2, tube: 0.02 }, rotation: [90, 0, 0], material: 'rubber' },
        { id: 'tilted', shape: { type: 'roundedBox', size: [1, 0.1, 0.1] }, rotation: [0, 0, 30] },
      ],
    }, { x: 1, y: 1, z: 1 })
    if (curved?.kind !== 'compound') throw new Error('expected compound')
    const handle = curved.colliders.filter((x) => x.part === 'handle')
    const ring = curved.colliders.filter((x) => x.part === 'ring')
    expect(handle.length).toBeGreaterThan(3)
    expect(handle.every((x) => x.kind === 'capsule' && Math.abs(x.radius - 0.01) < 1e-9)).toBe(true)
    expect(ring.length).toBeGreaterThanOrEqual(12)
    // Torus rotated 90° about X lies flat: every capsule center at y ≈ 0
    expect(ring.every((x) => Math.abs(x.center[1]) < 1e-6)).toBe(true)
    expect(ring[0].friction).toBe(0.9)
    const tilted = curved.colliders.find((x) => x.part === 'tilted')!
    expect(tilted.kind).toBe('cuboid')
    expect(tilted.rotation[2]).toBeCloseTo(Math.sin((30 * Math.PI) / 360), 6)
  })

  it('non-uniform entity scale falls back to per-part hulls', async () => {
    const { modelColliderShape } = await import('../../engine/model/modelCollider')
    const c = modelColliderShape({ ...(chair() as any), collider: 'compound' }, { x: 2, y: 1, z: 1 })
    if (c?.kind !== 'compound') throw new Error('expected compound')
    expect(c.colliders.every((x) => x.kind === 'hull')).toBe(true)
  })

  it('a crate dropped under a compound table reaches the floor (a convex hull would fill the table)', async () => {
    const { simulateScene } = await import('../../electron/agent/lindenTools')
    const run = async (collider: string) => {
      const scene = {
        format: 'linden-scene',
        version: 2,
        name: 'Table',
        entities: [
          { id: 'ground', name: 'Ground', parentId: null, components: [{ type: 'Transform', data: { position: [0, -0.5, 0], rotation: [0, 0, 0], scale: [20, 1, 20] } }, { type: 'BoxCollider', data: { size: { x: 1, y: 1, z: 1 } } }] },
          { id: 'table', name: 'Table', parentId: null, components: [{ type: 'Transform', data: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }, { type: 'Model', data: { ...table(), collider } }] },
          { id: 'crate', name: 'Crate', parentId: null, components: [{ type: 'Transform', data: { position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [0.2, 0.2, 0.2] } }, { type: 'BoxCollider', data: { size: { x: 1, y: 1, z: 1 } } }, { type: 'Rigidbody', data: { bodyType: 'dynamic', mass: 2 } }] },
        ],
      }
      const report: any = await simulateScene(JSON.stringify(scene), 2)
      expect(report.errors).toEqual([])
      return report.finalPositions.Crate[1] as number
    }
    expect(await run('compound')).toBeLessThan(0.15)
    expect(await run('convexHull')).toBeGreaterThan(0.5)
  })

  it('a dynamic compound table lands upright on its legs', async () => {
    const { simulateScene } = await import('../../electron/agent/lindenTools')
    const scene = {
      format: 'linden-scene',
      version: 2,
      name: 'Drop',
      entities: [
        { id: 'ground', name: 'Ground', parentId: null, components: [{ type: 'Transform', data: { position: [0, -0.5, 0], rotation: [0, 0, 0], scale: [20, 1, 20] } }, { type: 'BoxCollider', data: { size: { x: 1, y: 1, z: 1 } } }] },
        { id: 'table', name: 'Table', parentId: null, components: [{ type: 'Transform', data: { position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }, { type: 'Model', data: table() }, { type: 'Rigidbody', data: { bodyType: 'dynamic', mass: 30 } }] },
      ],
    }
    const report: any = await simulateScene(JSON.stringify(scene), 2)
    expect(report.errors).toEqual([])
    const [x, y, z] = report.finalPositions.Table
    expect(y).toBeGreaterThan(-0.03)
    expect(y).toBeLessThan(0.05)
    expect(Math.hypot(x, z)).toBeLessThan(0.05)
  })
})

describe('static collider rotation', () => {
  it('a collider without Rigidbody follows the entity rotation', async () => {
    const { simulateScene } = await import('../../electron/agent/lindenTools')
    // A 4 m board turned 90° about Z is a 0.2 m post: a ball dropped 1.5 m to its side falls past it
    const scene = {
      format: 'linden-scene',
      version: 2,
      name: 'Post',
      entities: [
        { id: 'ground', name: 'Ground', parentId: null, components: [{ type: 'Transform', data: { position: [0, -0.5, 0], rotation: [0, 0, 0], scale: [20, 1, 20] } }, { type: 'BoxCollider', data: { size: { x: 1, y: 1, z: 1 } } }] },
        { id: 'post', name: 'Post', parentId: null, components: [{ type: 'Transform', data: { position: [0, 2, 0], rotation: [0, 0, 90], scale: [1, 1, 1] } }, { type: 'BoxCollider', data: { size: { x: 4, y: 0.2, z: 1 } } }] },
        { id: 'ball', name: 'Ball', parentId: null, components: [{ type: 'Transform', data: { position: [1.5, 5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }, { type: 'SphereCollider', data: { radius: 0.2 } }, { type: 'Rigidbody', data: { bodyType: 'dynamic', mass: 1 } }] },
      ],
    }
    const report: any = await simulateScene(JSON.stringify(scene), 3)
    expect(report.errors).toEqual([])
    expect(report.finalPositions.Ball[1]).toBeLessThan(0.5)
  })
})
