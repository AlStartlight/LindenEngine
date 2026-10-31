import { Ray, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { makeCube, makeCylinder, makeUvSphere } from '../../../engine/mesh/core/primitives'
import { MeshEditor } from '../../../engine/mesh/modeling/MeshEditor'
import { MeshPicker } from '../../../engine/mesh/modeling/picking'
import { edgeVertices } from '../../../engine/mesh/modeling/topology'

const down = (x: number, z: number) => new Ray(new Vector3(x, 5, z), new Vector3(0, -1, 0))

describe('MeshPicker (three-mesh-bvh)', () => {
  it('hits the top face of a cube and snaps to the nearest vertex and edge', () => {
    const cube = makeCube(1)
    const picker = new MeshPicker(cube)
    const hit = picker.raycast(down(0.4, 0.45))
    expect(hit).not.toBeNull()
    if (!hit) return
    expect(cube.faceNormal(hit.face)[1]).toBeGreaterThan(0)
    expect(hit.point[1]).toBeCloseTo(0.5)
    expect(hit.distance).toBeCloseTo(4.5)
    expect(Array.from(cube.positions.subarray(hit.vertex * 3, hit.vertex * 3 + 3))).toEqual([0.5, 0.5, 0.5])
    // Nearest edge is the one along x at z = +0.5
    const [a, b] = edgeVertices(cube, hit.edge)
    expect(cube.positions[a * 3 + 2]).toBe(0.5)
    expect(cube.positions[b * 3 + 2]).toBe(0.5)
  })

  it('pick() returns the element for each mode, null on a miss', () => {
    const cube = makeCube(1)
    const picker = new MeshPicker(cube)
    const hit = picker.raycast(down(0.1, 0.1))!
    expect(picker.pick(down(0.1, 0.1), 'face')).toBe(hit.face)
    expect(picker.pick(down(0.1, 0.1), 'vertex')).toBe(hit.vertex)
    expect(picker.pick(down(0.1, 0.1), 'edge')).toBe(hit.edge)
    expect(picker.pick(down(3, 3), 'face')).toBeNull()
  })

  it('n-gon faces: any triangle of the cap maps back to the cap face', () => {
    const c = makeCylinder(16)
    const picker = new MeshPicker(c)
    for (const [x, z] of [[0, 0], [0.3, 0.1], [-0.2, -0.3]]) {
      expect(picker.pick(down(x, z), 'face')).toBe(17) // top cap
    }
  })

  it('the reported face really contains the hit point (triangle -> face map survives BVH build)', () => {
    const sphere = makeUvSphere(1, 24, 12)
    const picker = new MeshPicker(sphere)
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
    for (let i = 0; i < 300; i++) {
      const dir = new Vector3(rand(), rand(), rand()).normalize()
      const ray = new Ray(dir.clone().multiplyScalar(-5), dir)
      const hit = picker.raycast(ray)!
      const vs = sphere.faceVertices(hit.face)
      const n = new Vector3(...sphere.faceNormal(hit.face)).normalize()
      const p0 = new Vector3().fromArray(sphere.positions, vs[0] * 3)
      const p = new Vector3(...hit.point)
      expect(Math.abs(p.clone().sub(p0).dot(n))).toBeLessThan(1e-4)
      // Nearest-vertex snap is one of the face's corners
      expect(vs).toContain(hit.vertex)
      for (const v of vs) expect(new Vector3().fromArray(sphere.positions, v * 3).distanceTo(p)).toBeLessThan(0.6)
    }
  })

  it('refit follows moved vertices; rebuild follows topology changes', async () => {
    const e = new MeshEditor(makeCube(1))
    const picker = new MeshPicker(e.mesh)
    e.selection.setMode('face')
    const top = picker.pick(down(0, 0), 'face')!
    e.selection.click(top)
    await e.transform({ translate: [0, 1, 0] })
    picker.refit()
    expect(picker.raycast(down(0, 0))!.point[1]).toBeCloseTo(1.5)
    await e.extrude(1)
    picker.rebuild()
    const hit = picker.raycast(down(0, 0))!
    expect(hit.point[1]).toBeCloseTo(2.5)
    expect(e.selection.faces.has(hit.face)).toBe(true)
  })

  it('handles empty meshes and is fast on 100k triangles', () => {
    const empty = new MeshPicker(new (makeCube().constructor as new () => ReturnType<typeof makeCube>)())
    expect(empty.raycast(down(0, 0))).toBeNull()
    const sphere = makeUvSphere(1, 316, 160) // ~100k triangles
    const t0 = performance.now()
    const picker = new MeshPicker(sphere)
    const build = performance.now() - t0
    const t1 = performance.now()
    let hits = 0
    for (let i = 0; i < 1000; i++) if (picker.raycast(down(Math.sin(i) * 0.5, Math.cos(i) * 0.5))) hits++
    const perRay = (performance.now() - t1) / 1000
    expect(hits).toBe(1000)
    expect(perRay).toBeLessThan(1) // ms
    console.log(`BVH build ${build.toFixed(0)} ms, ${perRay.toFixed(3)} ms/ray on ${sphere.faceCount} faces`)
  })
})
