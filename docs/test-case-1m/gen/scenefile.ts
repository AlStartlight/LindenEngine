import { expect } from '@playwright/test'
import { createEntityCommand, setPropertyCommand } from '../../../editor/commands/entityCommands'
import { SceneSerializer } from '../../../engine/scene/serializer'
import type { Case } from '../lib/define'
import { freshStore, state, snapshot } from '../lib/store'
import { mulberry32, randInt, seedOf, quiet } from '../lib/util'

// File menu: New Scene / Open Scene / Save Scene / Save Scene As — 60.000 cases
//   10.000 New Scene after N edits clears the scene and history
//   20.000 Save then Open restores the same scene, clean, with path
//   10.000 Save As to a second path keeps content and moves the path
//   10.000 Open of a broken file throws and leaves the current scene intact
//   10.000 dirty flag: edit -> save -> undo -> redo
export const COUNT = 60_000

function populate(seed: number) {
  const rng = mulberry32(seed)
  const s = state()
  const count = randInt(rng, 1, 15)
  for (let i = 0; i < count; i++) {
    s.executeCommand(createEntityCommand(`Obj${i}_${randInt(rng, 0, 999)}`))
  }
  const ids = s.world.getEntities().map((e) => e.id)
  for (const id of ids) {
    if (rng() < 0.5) s.executeCommand(setPropertyCommand(id, 'Transform', 'position', [randInt(rng, -50, 50), randInt(rng, -50, 50), randInt(rng, -50, 50)]))
  }
  return count
}

const BROKEN = [
  ['truncated JSON', () => '{"format":"linden-scene","version":2,'],
  ['not a scene', () => JSON.stringify({ format: 'other', version: 2, entities: [] })],
  ['future version', () => JSON.stringify({ format: 'linden-scene', version: 99, entities: [] })],
  ['empty file', () => ''],
] as const

export function* cases(): Generator<Case> {
  for (let edits = 1; edits <= 100; edits++) {
    for (let v = 0; v < 100; v++) {
      yield { title: `New Scene after ${edits} edits (variant ${v}) clears scene, history and path`, run: () => {
        freshStore()
        const s = state()
        for (let i = 0; i < edits; i++) s.executeCommand(createEntityCommand(`E${v}_${i}`))
        s.saveScene(`scenes/v${v}.lscene`)
        s.executeCommand(createEntityCommand('Unsaved'))
        s.newScene()
        const after = state()
        expect(after.world.getEntities().length).toBe(0)
        expect(after.commandStack.canUndo()).toBe(false)
        expect(after.isDirty).toBe(false)
        expect(after.sceneName).toBe('Untitled')
        expect(after.currentScenePath).toBeNull()
        expect(after.selectedEntityIds).toEqual([])
      } }
    }
  }

  for (let s = 0; s < 20_000; s++) {
    const seed = seedOf(601, s)
    yield { title: `Save Scene then Open Scene restores the scene seed=${s}`, run: () => {
      freshStore()
      populate(seed)
      const json = state().saveScene(`scenes/save_${s}.lscene`)
      const before = snapshot()
      state().newScene()
      state().openScene(json, `scenes/save_${s}.lscene`)
      const after = state()
      expect(snapshot()).toBe(before)
      expect(after.isDirty).toBe(false)
      expect(after.currentScenePath).toBe(`scenes/save_${s}.lscene`)
      expect(after.commandStack.canUndo()).toBe(false)
    } }
  }

  for (let s = 0; s < 10_000; s++) {
    const seed = seedOf(602, s)
    yield { title: `Save Scene As moves the path and keeps the content seed=${s}`, run: () => {
      freshStore()
      populate(seed)
      const first = state().saveScene(`scenes/a_${s}.lscene`)
      expect(state().currentScenePath).toBe(`scenes/a_${s}.lscene`)
      const second = state().saveScene(`scenes/b_${s}.lscene`)
      expect(second).toBe(first)
      expect(state().currentScenePath).toBe(`scenes/b_${s}.lscene`)
      expect(state().isDirty).toBe(false)
      // Ctrl+S without a path keeps the Save As path
      state().saveScene()
      expect(state().currentScenePath).toBe(`scenes/b_${s}.lscene`)
    } }
  }

  for (let b = 0; b < BROKEN.length; b++) {
    const [label, make] = BROKEN[b]
    for (let s = 0; s < 2_500; s++) {
      const seed = seedOf(603 + b, s)
      yield { title: `Open Scene with ${label} throws and keeps the current scene seed=${s}`, run: () => quiet(() => {
        freshStore()
        populate(seed)
        state().saveScene(`scenes/keep_${s}.lscene`)
        const before = snapshot()
        expect(() => state().openScene(make(), 'broken.lscene')).toThrow()
        expect(snapshot()).toBe(before)
        expect(state().currentScenePath).toBe(`scenes/keep_${s}.lscene`)
      }) }
    }
  }

  for (let s = 0; s < 10_000; s++) {
    const seed = seedOf(608, s)
    yield { title: `dirty flag follows edit, save, undo and redo seed=${s}`, run: () => {
      freshStore()
      const edits = populate(seed)
      expect(state().isDirty).toBe(true)
      state().saveScene('scenes/dirty.lscene')
      expect(state().isDirty).toBe(false)
      state().undo()
      expect(state().isDirty).toBe(true)
      state().redo()
      expect(state().isDirty).toBe(false)
      expect(edits).toBeGreaterThan(0)
      expect(SceneSerializer.serialize(state().world, 'x').length).toBeGreaterThan(0)
    } }
  }
}
