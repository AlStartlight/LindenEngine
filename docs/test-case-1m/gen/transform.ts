import { expect } from '@playwright/test'
import { setPropertyCommand } from '../../../editor/commands/entityCommands'
import type { Case } from '../lib/define'
import { freshStore, state } from '../lib/store'

// Inspector Transform + scene tools (Move W / Rotate E / Scale R / 2D) — 100.000 cases
//   30.000 Move:   dx [-15,14] x dy [-12,12] x dz [-20,19]
//   30.000 Rotate: rx [-15,14]*7 x ry [-12,12]*9 x rz [-20,19]*4 degrees
//   20.000 Scale:  fx k/4 (k 1..25) x fy k/4 (k 1..25) x fz k/8 (k 1..32)
//   10.000 2D move in the XY plane keeps z: dx [-50,49] x dy [-50,49]
//   10.000 gizmo drag of 2..41 steps merges into one undo entry (250 step sizes each)
export const COUNT = 100_000

const START = { position: { x: 3, y: -4, z: 5 }, rotation: { x: 10, y: 20, z: 30 }, scale: { x: 1, y: 2, z: 0.5 } }

function selected() {
  freshStore()
  const e = state().world.createEntity('Selected')
  const t = e.getTransform()
  t.position = { ...START.position }
  t.rotation = { ...START.rotation }
  t.scale = { ...START.scale }
  state().selectEntity(e.id)
  return e
}

function applyAndUndo(prop: 'position' | 'rotation' | 'scale', next: [number, number, number]) {
  const e = selected()
  state().executeCommand(setPropertyCommand(e.id, 'Transform', prop, next))
  expect(e.getTransform()[prop]).toEqual({ x: next[0], y: next[1], z: next[2] })
  expect(state().isDirty).toBe(true)
  state().undo()
  expect(e.getTransform()[prop]).toEqual(START[prop])
  state().redo()
  expect(e.getTransform()[prop]).toEqual({ x: next[0], y: next[1], z: next[2] })
}

export function* cases(): Generator<Case> {
  const p = START.position
  for (let dx = -15; dx < 15; dx++) for (let dy = -12; dy <= 12; dy++) for (let dz = -20; dz < 20; dz++) {
    yield { title: `Move (W) by (${dx}, ${dy}, ${dz})`, run: () => applyAndUndo('position', [p.x + dx, p.y + dy, p.z + dz]) }
  }

  const r = START.rotation
  for (let a = -15; a < 15; a++) for (let b = -12; b <= 12; b++) for (let c = -20; c < 20; c++) {
    yield { title: `Rotate (E) by (${a * 7}, ${b * 9}, ${c * 4}) degrees`, run: () => applyAndUndo('rotation', [r.x + a * 7, r.y + b * 9, r.z + c * 4]) }
  }

  const s = START.scale
  for (let i = 1; i <= 25; i++) for (let j = 1; j <= 25; j++) for (let k = 1; k <= 32; k++) {
    yield { title: `Scale (R) by factors (${i / 4}, ${j / 4}, ${k / 8})`, run: () => applyAndUndo('scale', [s.x * (i / 4), s.y * (j / 4), s.z * (k / 8)]) }
  }

  for (let dx = -50; dx < 50; dx++) for (let dy = -50; dy < 50; dy++) {
    yield { title: `2D mode move by (${dx}, ${dy}) keeps z`, run: () => {
      const e = selected()
      state().executeCommand(setPropertyCommand(e.id, 'Transform', 'position', [p.x + dx, p.y + dy, e.getTransform().position.z]))
      expect(e.getTransform().position).toEqual({ x: p.x + dx, y: p.y + dy, z: p.z })
    } }
  }

  for (let steps = 2; steps <= 41; steps++) for (let size = 1; size <= 250; size++) {
    yield { title: `gizmo drag of ${steps} steps of ${size / 100} merges into one undo`, run: () => {
      const e = selected()
      const before = state().commandStack.history.length
      for (let i = 1; i <= steps; i++) {
        state().executeCommand(setPropertyCommand(e.id, 'Transform', 'position', [p.x + (i * size) / 100, p.y, p.z], undefined, `drag:${e.id}:position`))
      }
      expect(state().commandStack.history.length).toBe(before + 1)
      expect(e.getTransform().position.x).toBeCloseTo(p.x + (steps * size) / 100, 12)
      state().undo()
      expect(e.getTransform().position).toEqual(START.position)
    } }
  }
}
