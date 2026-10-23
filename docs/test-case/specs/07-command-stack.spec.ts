import { test, expect } from '@playwright/test'
import { World } from '../../../engine/ecs/World'
import { CommandStack, type EditorCommand } from '../../../editor/commands/CommandStack'
import { mulberry32, randInt, tcId, type Rng } from './_helpers'

// 1.000 cases: 700 random undo/redo sequences vs. a reference model,
// 150 grouped-command cases, 150 dirty-flag cases

const ENTITY = 'target'

function setName(world: World, value: string) {
  world.getEntity(ENTITY)!.name = value
}

function renameCommand(world: World, next: string): EditorCommand {
  const prev = world.getEntity(ENTITY)!.name
  return { label: `Rename ${next}`, do: (w) => setName(w, next), undo: (w) => setName(w, prev) }
}

/** Reference model of undo/redo with a bounded history */
class Model {
  history: Array<{ prev: string; next: string }> = []
  cursor = 0
  saved = 0
  value = 'v0'
  constructor(private max: number) {}
  execute(next: string) {
    this.history = this.history.slice(0, this.cursor)
    this.history.push({ prev: this.value, next })
    this.cursor++
    this.value = next
    if (this.history.length > this.max) {
      const excess = this.history.length - this.max
      this.history = this.history.slice(excess)
      this.cursor -= excess
      this.saved -= excess
    }
  }
  undo() {
    if (this.cursor <= 0) return
    this.cursor--
    this.value = this.history[this.cursor].prev
  }
  redo() {
    if (this.cursor >= this.history.length) return
    this.value = this.history[this.cursor].next
    this.cursor++
  }
}

function setup(maxDepth: number) {
  const world = new World()
  world.createEntity('v0', null, undefined, ENTITY)
  return { world, stack: new CommandStack(world, maxDepth) }
}

const name = (world: World) => world.getEntity(ENTITY)!.name

function runSequence(rng: Rng, steps: number, maxDepth: number) {
  const { world, stack } = setup(maxDepth)
  const model = new Model(maxDepth)
  let counter = 0
  for (let i = 0; i < steps; i++) {
    const r = rng()
    if (r < 0.5) {
      const next = `v${++counter}`
      stack.execute(renameCommand(world, next))
      model.execute(next)
    } else if (r < 0.8) {
      stack.undo()
      model.undo()
    } else {
      stack.redo()
      model.redo()
    }
    expect(name(world)).toBe(model.value)
    expect(stack.cursor).toBe(model.cursor)
    expect(stack.history.length).toBe(model.history.length)
    expect(stack.canUndo()).toBe(model.cursor > 0)
    expect(stack.canRedo()).toBe(model.cursor < model.history.length)
  }
}

test.describe('CommandStack (undo/redo)', () => {
  let n = 0

  for (let s = 0; s < 700; s++) {
    const rng = mulberry32(8000 + s)
    const steps = randInt(rng, 5, 60)
    const maxDepth = randInt(rng, 3, 40)
    test(`${tcId('CMD', ++n)} ${steps} random ops with maxDepth ${maxDepth} match the reference model`, () => {
      runSequence(rng, steps, maxDepth)
    })
  }

  for (let s = 0; s < 150; s++) {
    const rng = mulberry32(9000 + s)
    const size = randInt(rng, 1, 10)
    test(`${tcId('CMD', ++n)} a group of ${size} commands undoes and redoes as one step`, () => {
      const { world, stack } = setup(200)
      stack.execute(renameCommand(world, 'before'))
      stack.beginGroup('Batch')
      for (let i = 0; i < size; i++) stack.execute(renameCommand(world, `g${i}`))
      stack.endGroup()
      expect(stack.history.length).toBe(2)
      expect(name(world)).toBe(`g${size - 1}`)
      stack.undo()
      expect(name(world)).toBe('before')
      stack.redo()
      expect(name(world)).toBe(`g${size - 1}`)
    })
  }

  for (let s = 0; s < 150; s++) {
    const rng = mulberry32(10000 + s)
    const before = randInt(rng, 0, 10)
    const after = randInt(rng, 1, 10)
    test(`${tcId('CMD', ++n)} dirty flag: save after ${before} edits, ${after} more edits, undo back`, () => {
      const { world, stack } = setup(200)
      for (let i = 0; i < before; i++) stack.execute(renameCommand(world, `a${i}`))
      stack.markSaved()
      expect(stack.isDirty()).toBe(false)
      for (let i = 0; i < after; i++) stack.execute(renameCommand(world, `b${i}`))
      expect(stack.isDirty()).toBe(true)
      for (let i = 0; i < after; i++) stack.undo()
      expect(stack.isDirty()).toBe(false)
      if (before > 0) {
        stack.undo()
        expect(stack.isDirty()).toBe(true)
      }
    })
  }
})
