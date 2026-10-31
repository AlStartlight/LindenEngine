import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { toLindenMesh } from '../../../engine/mesh/core/convert'
import { encodeHalfEdgeMesh } from '../../../engine/mesh/core/encoding'
import { validateTopology } from '../../../engine/mesh/core/validate'
import { exportGlb } from '../../../engine/mesh/io/gltf'
import { bbox, isClosedManifold, signedVolume } from '../helpers'
import { buildElf } from './elfModel'
import { subdivideMesh } from '../../../engine/mesh/subdiv/opensubdivAdapter'

describe('box-modeling test: low-poly female elf', () => {
  it('builds with only Edit Mode operations, valid after every step, closed and symmetric', async () => {
    const { editor, steps } = await buildElf()
    const mesh = editor.mesh
    console.log(`elf: ${steps.length} operations, ${mesh.vertexCount} vertices, ${mesh.faceCount} faces`)
    expect(steps.length).toBeGreaterThan(100)
    expect(validateTopology(mesh).filter((i) => i.severity === 'error')).toEqual([])

    const l = toLindenMesh(mesh, { polygons: false })
    expect(isClosedManifold(l)).toBe(true)
    expect(signedVolume(l)).toBeGreaterThan(0)
    const b = bbox(l.positions)
    const height = b.max[1] - b.min[1]
    expect(height).toBeGreaterThan(1.6)
    expect(height).toBeLessThan(2.0)
    expect(b.min[1]).toBeGreaterThan(-0.05)
    // Left/right symmetry: every vertex has a mirror partner
    const key = (x: number, y: number, z: number) => `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`
    const set = new Set<string>()
    for (let v = 0; v < mesh.vertexSlots; v++) if (mesh.vertexAlive[v]) set.add(key(mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]))
    let unmatched = 0
    for (let v = 0; v < mesh.vertexSlots; v++) {
      if (mesh.vertexAlive[v] && !set.has(key(-mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]))) unmatched++
    }
    expect(unmatched).toBe(0)
    expect(b.max[0] - b.min[0]).toBeGreaterThan(0.8) // arm span in A-pose
  }, 60_000)

  it('the whole build undoes back to the starting box', async () => {
    const { editor } = await buildElf()
    const first = await buildElf(() => undefined)
    let undone = 0
    while (editor.history.canUndo) {
      await editor.undo()
      undone++
    }
    expect(undone).toBe(first.steps.length)
    expect(editor.mesh.faceCount).toBe(14)
    expect(validateTopology(editor.mesh).filter((i) => i.severity === 'error')).toEqual([])
  }, 60_000)

  it('writes a scene and GLB when ELF_OUT is set (used by the preview e2e)', async () => {
    const out = process.env.ELF_OUT
    if (!out) return
    const { editor } = await buildElf()
    // Phase 4: the same cage smoothed with Catmull-Clark (OpenSubdiv), shown next to it
    const smooth = await subdivideMesh(editor.mesh, 2, 'catmull-clark')
    if (!smooth.ok) throw new Error(smooth.message)
    fs.mkdirSync(out, { recursive: true })
    const scene = {
      format: 'linden-scene', version: 2, name: 'Elf',
      entities: [
        { id: 'sun', name: 'Sun', active: true, static: false, tags: [], layer: 0, parentId: null, components: [
          { type: 'Transform', data: { position: [3, 6, 4], rotation: [-50, 35, 0], scale: [1, 1, 1] } },
          { type: 'Light', data: { type: 'directional', intensity: 3, castShadow: true } },
        ] },
        { id: 'ground', name: 'Ground', active: true, static: true, tags: [], layer: 0, parentId: null, components: [
          { type: 'Transform', data: { position: [0, -0.05, 0], rotation: [0, 0, 0], scale: [4, 0.1, 4] } },
          { type: 'MeshRenderer', data: { primitive: 'box', color: '#4b5563', roughness: 0.9 } },
        ] },
        { id: 'elf', name: 'Elf (cage)', active: true, static: false, tags: [], layer: 0, parentId: null, components: [
          { type: 'Transform', data: { position: [-0.65, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
          { type: 'EditableMesh', data: { mesh: encodeHalfEdgeMesh(editor.mesh), color: '#e9c9b0', roughness: 0.65, metalness: 0 } },
        ] },
        { id: 'elfSmooth', name: 'Elf (subdivided)', active: true, static: false, tags: [], layer: 0, parentId: null, components: [
          { type: 'Transform', data: { position: [0.65, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
          { type: 'EditableMesh', data: { mesh: encodeHalfEdgeMesh(smooth.value), color: '#e9c9b0', roughness: 0.55, metalness: 0 } },
        ] },
      ],
    }
    fs.writeFileSync(path.join(out, 'Elf.lscene'), JSON.stringify(scene, null, 2))
    const glb = await exportGlb(toLindenMesh(editor.mesh, { polygons: false }), { draco: true })
    if (glb.ok) fs.writeFileSync(path.join(out, 'elf.glb'), glb.value)
    expect(glb.ok).toBe(true)
  }, 60_000)
})
