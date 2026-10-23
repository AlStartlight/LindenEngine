import { describe, it, expect, vi } from 'vitest'
import { ComponentRegistry } from '../../engine/ecs/ComponentRegistry'
import { World } from '../../engine/ecs/World'

describe('F0.2: ComponentRegistry & Components (TC-F02-01, TC-F02-04, TC-F02-05)', () => {
  it('TC-F02-01: search("rigid") returns Rigidbody as first result', () => {
    const results = ComponentRegistry.search('rigid')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].type).toBe('Rigidbody')
  })

  it('TC-F02-04: adding CharacterController automatically adds required CapsuleCollider', () => {
    const world = new World()
    const player = world.createEntity('Player')

    expect(player.hasComponent('CapsuleCollider')).toBe(false)
    expect(player.hasComponent('CharacterController')).toBe(false)

    world.addComponent(player.id, 'CharacterController')

    expect(player.hasComponent('CharacterController')).toBe(true)
    expect(player.hasComponent('CapsuleCollider')).toBe(true)
  })

  it('TC-F02-05: adding second Rigidbody to same entity is rejected (disallowMultiple)', () => {
    const world = new World()
    const cube = world.createEntity('Cube')

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const rb1 = world.addComponent(cube.id, 'Rigidbody')
    expect(rb1).toBeDefined()

    const rb2 = world.addComponent(cube.id, 'Rigidbody')
    expect(rb2).toBe(rb1)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('cannot be added multiple times'))

    warnSpy.mockRestore()
  })

  it('ComponentRegistry categories and menuPaths are correctly configured', () => {
    const physicsComps = ComponentRegistry.getAll().filter((c) => c.menuPath.startsWith('Physics/'))
    expect(physicsComps.map((c) => c.type)).toContain('Rigidbody')
    expect(physicsComps.map((c) => c.type)).toContain('BoxCollider')
  })
})
