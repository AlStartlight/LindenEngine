import { describe, it, expect } from 'vitest'
import {
  generatePrefabChildId,
  checkPrefabCycle,
  PrefabAsset,
} from '../../engine/scene/prefab'
import { World } from '../../engine/ecs/World'
import { instantiatePrefabCommand } from '../../editor/commands/prefabAndEventCommands'
import { SceneSerializer } from '../../engine/scene/serializer'

describe('F1.1: Prefabs (TC-F11-09 to TC-F11-12)', () => {
  const sampleDoorPrefab: PrefabAsset = {
    format: 'linden-prefab',
    version: 1,
    root: 'door-root-id',
    entities: [
      {
        id: 'door-root-id',
        name: 'Door',
        components: [
          { type: 'Transform', data: { position: [0, 0, 0] } },
          { type: 'MeshRenderer', data: { primitive: 'box', color: '#8b4513' } },
        ],
      },
      {
        id: 'door-handle-id',
        name: 'Handle',
        parentId: 'door-root-id',
        components: [
          { type: 'Transform', data: { position: [0.8, 0, 0.1] } },
          { type: 'MeshRenderer', data: { primitive: 'sphere', color: '#ffd700' } },
        ],
      },
    ],
  }

  it('TC-F11-09: saving scene with prefab instance stores prefab.asset and overrides, not copied prefab definition', () => {
    const world = new World()
    const cmd = instantiatePrefabCommand(sampleDoorPrefab, 'assets/prefabs/Door.lprefab', 'Door')
    cmd.do(world)

    const instances = world.getEntities().filter((e) => e.prefab)
    expect(instances).toHaveLength(1)
    expect(instances[0].prefab.asset).toBe('assets/prefabs/Door.lprefab')

    const json = SceneSerializer.serialize(world, 'PrefabScene')
    const parsed = JSON.parse(json)
    const savedInstance = parsed.entities.find((e: any) => e.id === instances[0].id)

    expect(savedInstance.prefab).toBeDefined()
    expect(savedInstance.prefab.asset).toBe('assets/prefabs/Door.lprefab')
    expect(savedInstance.prefab.overrides).toEqual([])
  })

  it('TC-F11-10: load scene twice generates same deterministic child entity IDs (hash stable)', () => {
    const instanceId1 = 'inst-alpha'
    const instanceId2 = 'inst-alpha'
    const childPrefabId = 'door-handle-id'

    const childId1 = generatePrefabChildId(instanceId1, childPrefabId)
    const childId2 = generatePrefabChildId(instanceId2, childPrefabId)

    expect(childId1).toBe(childId2)
    expect(childId1.startsWith('pfb-')).toBe(true)

    // Different instance gets different deterministic ID
    const otherChildId = generatePrefabChildId('inst-beta', childPrefabId)
    expect(otherChildId).not.toBe(childId1)
  })

  it('TC-F11-11: nested prefab cycle check allows valid non-cyclic nested prefabs', () => {
    const prefabs: Record<string, PrefabAsset> = {
      'B.lprefab': {
        format: 'linden-prefab',
        version: 1,
        root: 'b-root',
        entities: [{ id: 'b-root', name: 'B', components: [] }],
      },
      'A.lprefab': {
        format: 'linden-prefab',
        version: 1,
        root: 'a-root',
        entities: [
          {
            id: 'a-root',
            name: 'A',
            prefab: { asset: 'B.lprefab' },
            components: [],
          },
        ],
      },
    }

    const loader = (path: string) => prefabs[path] || null
    expect(() => {
      checkPrefabCycle('A.lprefab', [], loader)
    }).not.toThrow()
  })

  it('TC-F11-12: cyclic prefab (A contains A or A -> B -> A) is rejected with PREFAB_CYCLE', () => {
    const directCycle: Record<string, PrefabAsset> = {
      'Self.lprefab': {
        format: 'linden-prefab',
        version: 1,
        root: 'self-root',
        entities: [
          {
            id: 'self-root',
            name: 'Self',
            prefab: { asset: 'Self.lprefab' },
            components: [],
          },
        ],
      },
    }

    expect(() => {
      checkPrefabCycle('Self.lprefab', [], (p) => directCycle[p] || null)
    }).toThrow(/PREFAB_CYCLE/)

    const indirectCycle: Record<string, PrefabAsset> = {
      'A.lprefab': {
        format: 'linden-prefab',
        version: 1,
        root: 'a-root',
        entities: [{ id: 'a-root', name: 'A', prefab: { asset: 'B.lprefab' }, components: [] }],
      },
      'B.lprefab': {
        format: 'linden-prefab',
        version: 1,
        root: 'b-root',
        entities: [{ id: 'b-root', name: 'B', prefab: { asset: 'A.lprefab' }, components: [] }],
      },
    }

    expect(() => {
      checkPrefabCycle('A.lprefab', [], (p) => indirectCycle[p] || null)
    }).toThrow(/PREFAB_CYCLE/)
  })
})
