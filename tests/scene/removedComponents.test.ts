import { describe, it, expect, vi } from 'vitest'
import { World } from '../../engine/ecs/World'
import { SceneSerializer } from '../../engine/scene/serializer'
import { ScriptRuntime } from '../../engine/scripting/ScriptRuntime'
import '../../engine/ecs/ComponentRegistry'

// Blueprints were removed (docs/specs/SPEC-Remove-Blueprint-Material-Animator-Sequencer.md);
// scenes saved before that still carry a "Blueprint" component and must keep working.
const legacyScene = JSON.stringify({
  format: 'linden-scene',
  version: 2,
  name: 'Legacy',
  entities: [
    {
      id: 'door',
      name: 'Door',
      parentId: null,
      components: [
        { type: 'Transform', data: { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] } },
        { type: 'Blueprint', data: { blueprintName: 'X', isEnabled: true } },
        { type: 'Script', data: { src: 'scripts/Door.ts', props: {} } },
      ],
    },
  ],
})

describe('scenes with components that no longer exist', () => {
  it('open, run scripts and save again without losing the old component data', async () => {
    const world = new World()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => SceneSerializer.deserialize(legacyScene, world)).not.toThrow()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Komponen tidak dikenal "Blueprint"'))
    warn.mockRestore()
    const door = world.getEntity('door')!
    expect(door.getTransform().position).toEqual({ x: 1, y: 2, z: 3 })

    const inits: string[] = []
    const rt = new ScriptRuntime({
      world,
      loadModule: async () => ({ default: class { onInit(ctx: any) { inits.push(ctx.entity.name) } } }),
    })
    await rt.loadAll()
    expect(inits).toEqual(['Door'])
    expect(rt.errors).toEqual([])

    const saved = JSON.parse(SceneSerializer.serialize(world, 'Legacy'))
    const bp = saved.entities[0].components.find((c: any) => c.type === 'Blueprint')
    expect(bp?.data).toMatchObject({ blueprintName: 'X' })

    // And the resaved file opens again
    const again = new World()
    SceneSerializer.deserialize(JSON.stringify(saved), again)
    expect(again.getEntity('door')!.getComponents().map((c) => c.name)).toContain('Blueprint')
  })
})
