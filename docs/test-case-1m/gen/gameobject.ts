import { expect } from '@playwright/test'
import * as C from '../../../editor/commands/entityCommands'
import type { Case } from '../lib/define'
import { freshStore, state } from '../lib/store'
import { buildScene } from './undo'
import { TAGS, mulberry32, pick, seedOf, quiet } from '../lib/util'

// GameObject menu / Hierarchy — 60.000 cases
//   20.000 Create at sibling index 0..9, as root or child (1.000 variants each)
//   12.000 Duplicate copies transform, tags, layer and components to a new id (one seed each)
//    3.000 Duplicate also copies the children (Unity behaviour) (one seed each)
//   15.000 Set Tags to one of 1.000 tag subsets on 15 scene sizes
//   10.000 Toggle active / static through the Inspector header, undoable
export const COUNT = 60_000

const componentSummary = (e: any) =>
  e.getComponents().filter((c: any) => c.name !== 'Transform').map((c: any) => {
    const { entityId: _e, ...data } = JSON.parse(JSON.stringify(c))
    return data
  })

export function* cases(): Generator<Case> {
  for (const asChild of [false, true]) {
    for (let index = 0; index < 10; index++) {
      for (let v = 0; v < 1_000; v++) {
        yield { title: `Create "Item${v}" at index ${index} ${asChild ? 'under a parent' : 'at root'}`, run: () => {
          freshStore()
          const w = state().world
          const parent = asChild ? w.createEntity('Parent') : null
          for (let i = 0; i < 10; i++) w.createEntity(`Sib${i}`, parent?.id ?? null)
          state().executeCommand(C.createEntityCommand(`Item${v}`, parent?.id ?? null, index))
          const siblings = parent ? w.getEntity(parent.id)!.childIds : w.getRootEntityIds().filter((id) => id !== parent?.id)
          const created = w.getEntities().find((e) => e.name === `Item${v}`)!
          expect(created.parentId).toBe(parent?.id ?? null)
          expect(siblings.indexOf(created.id)).toBe(index)
          state().undo()
          expect(w.getEntity(created.id)).toBeUndefined()
        } }
      }
    }
  }

  for (let s = 0; s < 12_000; s++) {
    const seed = seedOf(901, s)
    yield { title: `Duplicate copies transform, tags, layer and components seed=${s}`, run: () => quiet(() => {
      const rng = mulberry32(seed)
      const w = buildScene(rng)
      const src = pick(rng, w.getEntities())
      const before = new Set(w.getEntities().map((e) => e.id))
      state().executeCommand(C.duplicateEntityCommand(src.id))
      const copy = w.getEntities().find((e) => !before.has(e.id))!
      expect(copy).toBeDefined()
      expect(copy.id).not.toBe(src.id)
      expect(copy.parentId).toBe(src.parentId)
      expect(copy.getTransform().position).toEqual(src.getTransform().position)
      expect(copy.tags).toEqual(src.tags)
      expect(copy.layer).toBe(src.layer)
      expect(componentSummary(copy)).toEqual(componentSummary(src))
    }) }
  }

  for (let s = 0; s < 3_000; s++) {
    const seed = seedOf(902, s)
    yield { title: `Duplicate a parent also duplicates its children seed=${s}`, run: () => quiet(() => {
      const rng = mulberry32(seed)
      const w = buildScene(rng)
      const src = pick(rng, w.getEntities().filter((e) => e.childIds.length))
      const before = new Set(w.getEntities().map((e) => e.id))
      state().executeCommand(C.duplicateEntityCommand(src.id))
      const copy = w.getEntities().find((e) => !before.has(e.id) && e.parentId === src.parentId)!
      expect(copy.childIds.length).toBe(src.childIds.length)
    }) }
  }

  for (let v = 0; v < 15; v++) {
    for (let m = 0; m < 1_000; m++) {
      const subset = TAGS.filter((_, i) => m & (1 << i))
      yield { title: `Set Tags [${subset.join(', ')}] on a scene of ${v + 1} GameObjects`, run: () => {
        freshStore()
        const w = state().world
        for (let i = 0; i <= v; i++) w.createEntity(`G${i}`)
        const target = w.getEntities()[v % (v + 1)]
        w.addTag(target.id, 'Door')
        const prev = [...target.tags]
        state().executeCommand(C.setTagsCommand(target.id, subset))
        expect(target.tags).toEqual(subset)
        for (const t of TAGS) expect(w.findByTag(t).some((e) => e.id === target.id)).toBe(subset.includes(t))
        state().undo()
        expect(target.tags).toEqual(prev)
      } }
    }
  }

  for (const prop of ['active', 'isStatic'] as const) {
    for (const value of [true, false]) {
      for (let v = 0; v < 2_500; v++) {
        yield { title: `Inspector header sets ${prop}=${value} on GameObject #${v}, undoable`, run: () => {
          freshStore()
          const w = state().world
          const e = w.createEntity(`Obj${v}`)
          ;(e as any)[prop] = !value
          state().executeCommand(C.setPropertyCommand(e.id, 'Entity', prop, value))
          expect((e as any)[prop]).toBe(value)
          state().undo()
          expect((e as any)[prop]).toBe(!value)
          state().redo()
          expect((e as any)[prop]).toBe(value)
        } }
      }
    }
  }
}
