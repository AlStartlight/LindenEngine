import { describe, it, expect, vi } from 'vitest'
import { CommandStack, EditorCommand } from '../../editor/commands/CommandStack'
import { World } from '../../engine/ecs/World'

describe('F0.3: Undo/Redo & CommandStack (TC-F03-01 to TC-F03-05)', () => {
  it('TC-F03-01: execute c1, c2, undo, undo calls c2.undo then c1.undo; cursor = 0', () => {
    const world = new World()
    const stack = new CommandStack(world)
    const log: string[] = []

    const c1: EditorCommand = {
      label: 'c1',
      do: () => log.push('c1.do'),
      undo: () => log.push('c1.undo'),
    }
    const c2: EditorCommand = {
      label: 'c2',
      do: () => log.push('c2.do'),
      undo: () => log.push('c2.undo'),
    }

    stack.execute(c1)
    stack.execute(c2)
    expect(log).toEqual(['c1.do', 'c2.do'])
    expect(stack.cursor).toBe(2)

    stack.undo()
    expect(log).toEqual(['c1.do', 'c2.do', 'c2.undo'])
    expect(stack.cursor).toBe(1)

    stack.undo()
    expect(log).toEqual(['c1.do', 'c2.do', 'c2.undo', 'c1.undo'])
    expect(stack.cursor).toBe(0)
  })

  it('TC-F03-02: execute c1, undo, execute c3 clears redo stack', () => {
    const world = new World()
    const stack = new CommandStack(world)

    const c1: EditorCommand = { label: 'c1', do: vi.fn(), undo: vi.fn() }
    const c2: EditorCommand = { label: 'c2', do: vi.fn(), undo: vi.fn() }
    const c3: EditorCommand = { label: 'c3', do: vi.fn(), undo: vi.fn() }

    stack.execute(c1)
    stack.execute(c2)
    stack.undo() // c2 undone
    expect(stack.canRedo()).toBe(true)

    stack.execute(c3)
    expect(stack.canRedo()).toBe(false)
    stack.redo() // does nothing
    expect(stack.cursor).toBe(2)
  })

  it('TC-F03-03: Two commands with same mergeKey within 500ms merge into 1 entry', () => {
    const world = new World()
    const stack = new CommandStack(world)

    let val = 0
    const c1: EditorCommand = {
      label: 'Change Mass to 2',
      mergeKey: 'mass-change',
      do: () => { val = 2 },
      undo: () => { val = 0 },
    }
    const c2: EditorCommand = {
      label: 'Change Mass to 5',
      mergeKey: 'mass-change',
      do: () => { val = 5 },
      undo: () => { val = 2 },
    }

    stack.execute(c1)
    expect(val).toBe(2)
    expect(stack.history).toHaveLength(1)

    stack.execute(c2)
    expect(val).toBe(5)
    expect(stack.history).toHaveLength(1) // Merged!

    // Undo should revert to value before c1 (val = 0)
    stack.undo()
    expect(val).toBe(0)
  })

  it('TC-F03-04: 201 commands with maxDepth=200 caps history to 200, oldest discarded', () => {
    const world = new World()
    const stack = new CommandStack(world, 200)

    for (let i = 1; i <= 201; i++) {
      stack.execute({
        label: `Command ${i}`,
        do: () => {},
        undo: () => {},
      })
    }

    expect(stack.history).toHaveLength(200)
    expect(stack.cursor).toBe(200)
    expect(stack.history[0].label).toBe('Command 2')
    expect(stack.history[199].label).toBe('Command 201')
  })

  it('TC-F03-05: beginGroup("Duplicate"), 3 commands, endGroup(), undo() undoes all 3 in reverse order', () => {
    const world = new World()
    const stack = new CommandStack(world)
    const log: string[] = []

    stack.beginGroup('Duplicate')
    stack.execute({ label: 'cmd1', do: () => log.push('1.do'), undo: () => log.push('1.undo') })
    stack.execute({ label: 'cmd2', do: () => log.push('2.do'), undo: () => log.push('2.undo') })
    stack.execute({ label: 'cmd3', do: () => log.push('3.do'), undo: () => log.push('3.undo') })
    stack.endGroup()

    expect(stack.history).toHaveLength(1)
    expect(stack.history[0].label).toBe('Duplicate')
    expect(log).toEqual(['1.do', '2.do', '3.do'])

    stack.undo()
    expect(log).toEqual(['1.do', '2.do', '3.do', '3.undo', '2.undo', '1.undo'])
  })
})
