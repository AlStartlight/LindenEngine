import { expect } from '@playwright/test'
import * as C from '../../../editor/commands/entityCommands'
import type { EditorCommand } from '../../../editor/commands/CommandStack'
import type { World } from '../../../engine/ecs/World'
import type { Case } from '../lib/define'
import { freshStore, snapshot, state } from '../lib/store'
import { TAGS, mulberry32, pick, randInt, randFloat, round3, seedOf, quiet, type Rng } from '../lib/util'

// Undo / Redo — 100.000 cases
//   88.000 = 11 command kinds x 8.000 seeds: do -> undo restores the exact scene, redo re-applies it
//   12.000 random sequences of 5..25 commands: undo all restores the start, redo all restores the end
export const COUNT = 100_000

const COMPONENTS = ['MeshRenderer', 'Camera', 'Light', 'Rigidbody'] as const

function componentData(rng: Rng, type: string): Record<string, unknown> {
  switch (type) {
    case 'MeshRenderer': return { roughness: round3(rng()), metalness: round3(rng()), color: '#' + randInt(rng, 0, 0xffffff).toString(16).padStart(6, '0') }
    case 'Camera': return { fov: randInt(rng, 10, 120), near: round3(randFloat(rng, 0.01, 1)), far: randInt(rng, 100, 5000) }
    case 'Light': return { intensity: round3(randFloat(rng, 0, 10)), range: round3(randFloat(rng, 0.1, 100)) }
    default: return { mass: round3(randFloat(rng, 0.1, 100)), drag: round3(randFloat(rng, 0, 5)), useGravity: rng() < 0.5 }
  }
}

/** Random scene built directly on the world, so the undo history starts empty */
export function buildScene(rng: Rng): World {
  freshStore()
  const w = state().world
  const ids: string[] = []
  for (let i = randInt(rng, 3, 15); i > 0; i--) {
    const parent = ids.length && rng() < 0.55 ? pick(rng, ids) : null
    const e = w.createEntity(`Go${ids.length}`, parent)
    e.getTransform().setPosition(randInt(rng, -50, 50), randInt(rng, -50, 50), randInt(rng, -50, 50))
    e.layer = randInt(rng, 0, 15)
    for (let t = randInt(rng, 0, 3); t > 0; t--) w.addTag(e.id, pick(rng, TAGS))
    for (const type of COMPONENTS) if (rng() < 0.35) w.addComponent(e.id, type, componentData(rng, type))
    ids.push(e.id)
  }
  // Guarantee at least one parent with a child
  if (!w.getEntities().some((e) => e.childIds.length)) w.createEntity('Child', ids[0])
  return w
}

function descendants(w: World, id: string): Set<string> {
  const out = new Set<string>([id])
  const visit = (x: string) => { for (const c of w.getEntity(x)!.childIds) { out.add(c); visit(c) } }
  visit(id)
  return out
}

type Maker = (w: World, rng: Rng) => EditorCommand | null

export const KINDS: Array<[string, Maker]> = [
  ['Create GameObject', (w, rng) => {
    const ids = w.getEntities().map((e) => e.id)
    return C.createEntityCommand(`New${randInt(rng, 0, 9999)}`, rng() < 0.5 ? pick(rng, ids) : null)
  }],
  ['Delete leaf GameObject', (w, rng) => {
    const leaves = w.getEntities().filter((e) => !e.childIds.length)
    return C.deleteEntityCommand(pick(rng, leaves).id)
  }],
  ['Delete GameObject with children', (w, rng) => {
    const parents = w.getEntities().filter((e) => e.childIds.length)
    return C.deleteEntityCommand(pick(rng, parents).id)
  }],
  ['Duplicate GameObject (Ctrl+D)', (w, rng) => C.duplicateEntityCommand(pick(rng, w.getEntities()).id)],
  ['Set Transform.position', (w, rng) => C.setPropertyCommand(pick(rng, w.getEntities()).id, 'Transform', 'position', [randInt(rng, -99, 99), randInt(rng, -99, 99), randInt(rng, -99, 99)])],
  ['Reparent GameObject', (w, rng) => {
    const e = pick(rng, w.getEntities())
    const banned = descendants(w, e.id)
    const options = w.getEntities().filter((x) => !banned.has(x.id))
    return C.setParentCommand(e.id, options.length && rng() < 0.7 ? pick(rng, options).id : null)
  }],
  ['Add Component', (w, rng) => {
    const e = pick(rng, w.getEntities())
    const missing = COMPONENTS.filter((t) => !e.hasComponent(t))
    return C.addComponentCommand(e.id, missing.length ? pick(rng, missing) : 'BoxCollider')
  }],
  ['Remove Component', (w, rng) => {
    const withComps = w.getEntities().filter((e) => COMPONENTS.some((t) => e.hasComponent(t)))
    if (!withComps.length) return null
    const e = pick(rng, withComps)
    return C.removeComponentCommand(e.id, pick(rng, COMPONENTS.filter((t) => e.hasComponent(t))))
  }],
  ['Set Tags', (w, rng) => C.setTagsCommand(pick(rng, w.getEntities()).id, TAGS.filter(() => rng() < 0.3))],
  ['Set Layer', (w, rng) => C.setLayerCommand(pick(rng, w.getEntities()).id, randInt(rng, 0, 31), rng() < 0.5)],
  ['Paste Component Values', (w, rng) => {
    const withComps = w.getEntities().filter((e) => COMPONENTS.some((t) => e.hasComponent(t)))
    if (!withComps.length) return null
    const e = pick(rng, withComps)
    const type = pick(rng, COMPONENTS.filter((t) => e.hasComponent(t)))
    return C.pasteComponentValuesCommand(e.id, type, componentData(rng, type))
  }],
]

export function* cases(): Generator<Case> {
  for (let k = 0; k < KINDS.length; k++) {
    const [name, make] = KINDS[k]
    for (let s = 0; s < 8_000; s++) {
      const seed = seedOf(801 + k, s)
      yield { title: `${name}: undo restores and redo re-applies the scene seed=${s}`, run: () => quiet(() => {
        const rng = mulberry32(seed)
        const w = buildScene(rng)
        let cmd = make(w, rng)
        if (!cmd) {
          // No component to act on: give one entity a Rigidbody first (outside history)
          w.addComponent(w.getEntities()[0].id, 'Rigidbody', componentData(rng, 'Rigidbody'))
          state().commandStack.clear()
          cmd = make(w, rng)!
        }
        const before = snapshot()
        state().executeCommand(cmd)
        const after = snapshot()
        state().undo()
        expect(snapshot()).toBe(before)
        state().redo()
        expect(snapshot()).toBe(after)
      }) }
    }
  }

  for (let s = 0; s < 12_000; s++) {
    const seed = seedOf(820, s)
    yield { title: `random sequence of commands: undo all then redo all seed=${s}`, run: () => quiet(() => {
      const rng = mulberry32(seed)
      const w = buildScene(rng)
      const start = snapshot()
      let applied = 0
      for (let i = randInt(rng, 5, 25); i > 0; i--) {
        const [, make] = pick(rng, KINDS)
        if (make === KINDS[1][1] && !w.getEntities().some((e) => !e.childIds.length)) continue
        if (make === KINDS[2][1] && !w.getEntities().some((e) => e.childIds.length)) continue
        if (!w.getEntities().length) break
        const cmd = make(w, rng)
        if (!cmd) continue
        state().executeCommand(cmd)
        applied++
      }
      const end = snapshot()
      for (let i = 0; i < applied; i++) state().undo()
      expect(snapshot()).toBe(start)
      for (let i = 0; i < applied; i++) state().redo()
      expect(snapshot()).toBe(end)
    }) }
  }
}
