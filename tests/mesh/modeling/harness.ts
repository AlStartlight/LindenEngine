import { expect } from 'vitest'
import type { HalfEdgeMesh } from '../../../engine/mesh/core/HalfEdgeMesh'
import { meshFromPolygons } from '../../../engine/mesh/core/primitives'
import type { GeomResult } from '../../../engine/mesh/core/result'
import { validateTopology } from '../../../engine/mesh/core/validate'
import type { MeshEditor } from '../../../engine/mesh/modeling/MeshEditor'

export function topologyErrors(mesh: HalfEdgeMesh) {
  return validateTopology(mesh).filter((i) => i.severity === 'error')
}

export function expectValid(mesh: HalfEdgeMesh): void {
  expect(topologyErrors(mesh)).toEqual([])
}

/**
 * Runs an editor action and checks the Phase 3 contract: valid topology after do, undo restores the exact
 * previous mesh, redo restores the exact result; topology is validated after every step.
 */
export async function checkUndoRedo(editor: MeshEditor, action: () => Promise<GeomResult<void>>): Promise<void> {
  const before = editor.mesh.toData()
  const r = await action()
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`)
  expectValid(editor.mesh)
  const after = editor.mesh.toData()
  expect(await editor.undo()).toBe(true)
  expect(editor.mesh.toData()).toEqual(before)
  expectValid(editor.mesh)
  expect(await editor.redo()).toBe(true)
  expect(editor.mesh.toData()).toEqual(after)
  expectValid(editor.mesh)
}

/** n x n grid of quads in the XY plane (open mesh) */
export function makeGrid(n: number): HalfEdgeMesh {
  const pos: number[] = []
  for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) pos.push(x, y, 0)
  const id = (x: number, y: number) => y * (n + 1) + x
  const loops: number[][] = []
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) loops.push([id(x, y), id(x + 1, y), id(x + 1, y + 1), id(x, y + 1)])
  return meshFromPolygons(pos, loops)
}

export function gridVertex(n: number, x: number, y: number): number {
  return y * (n + 1) + x
}
