import { describe, it, expect } from 'vitest'
import { parseSceneFile } from '../../engine/scene/parseSceneFile'
import { SCENE_FORMAT, SCENE_VERSION } from '../../engine/scene/SceneSchema'
import { PRIMITIVE_SIZES } from '../../engine/renderer/primitives'
import fs from 'fs'
import path from 'path'

describe('parseSceneFile', () => {
  it('parses minimal valid v2 scene with 0 entities', () => {
    const json = JSON.stringify({ format: SCENE_FORMAT, version: SCENE_VERSION, name: 'EmptyScene', entities: [] })
    const res = parseSceneFile(json)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.scene.name).toBe('EmptyScene')
      expect(res.scene.entities).toHaveLength(0)
      expect(res.migratedFrom).toBeUndefined()
    }
  })

  it('migrates a v1 scene with 0 objects to v2', () => {
    const json = JSON.stringify({ format: SCENE_FORMAT, version: 1, name: 'EmptyScene', camera: { position: [10, 10, 10], target: [0, 0, 0] }, objects: [] })
    const res = parseSceneFile(json)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.migratedFrom).toBe(1)
      expect(res.scene.version).toBe(2)
      expect(res.scene.entities).toHaveLength(0)
      expect(res.scene.settings?.editorCamera).toEqual({ position: [10, 10, 10], target: [0, 0, 0] })
    }
  })

  it('parses valid-basic fixture with 3 objects', () => {
    const filePath = path.resolve(__dirname, '../../fixtures/valid-basic.lscene')
    const content = fs.readFileSync(filePath, 'utf-8')
    const res = parseSceneFile(content)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.migratedFrom).toBe(1)
      expect(res.scene.name).toBe('Level01')
      expect(res.scene.entities.map((e) => e.id)).toEqual(['cube-1', 'sphere-1', 'cylinder-1'])
      expect((res.scene.settings?.editorCamera as any).position).toEqual([15, 12, 18])
      // v1 primitives were 2 m (box), v2 are 1 m: the mesh size keeps the visible size
      const cube = res.scene.entities[0].components.find((c) => c.type === 'MeshRenderer')!
      expect(cube.data.size).toEqual([2, 2, 2])
      expect(cube.data.color).toBe('#ff3333')
      const box = PRIMITIVE_SIZES.box
      expect(cube.data.size.map((s: number, i: number) => s * box[i])).toEqual([2, 2, 2])
    }
  })

  it('parses valid-hierarchy fixture', () => {
    const filePath = path.resolve(__dirname, '../../fixtures/valid-hierarchy.lscene')
    const content = fs.readFileSync(filePath, 'utf-8')
    const res = parseSceneFile(content)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.scene.entities[1].parentId).toBe('parent-box')
    }
  })

  it('ignores unknown extra fields (FR-12 forward-compatibility)', () => {
    const json = JSON.stringify({
      format: SCENE_FORMAT,
      version: 1,
      name: 'TestScene',
      extraTopLevel: 12345,
      camera: {
        position: [10, 10, 10],
        target: [0, 0, 0],
        fov: 60,
      },
      objects: [
        {
          id: 'box-1',
          name: 'Box 1',
          parentId: null,
          kind: 'primitive',
          primitive: 'box',
          transform: {
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
          material: {
            color: '#112233',
            roughness: 0.5,
            metalness: 0.5,
          },
          unknownObjectProp: 'hello',
        },
      ],
    })
    const res = parseSceneFile(json)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect((res.scene as any).extraTopLevel).toBeUndefined()
      expect((res.scene.entities[0] as any).unknownObjectProp).toBeUndefined()
    }
  })

  it('returns INVALID_JSON for corrupted JSON', () => {
    const filePath = path.resolve(__dirname, '../../fixtures/invalid-json.lscene')
    const content = fs.readFileSync(filePath, 'utf-8')
    const res = parseSceneFile(content)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('INVALID_JSON')
      expect(res.message).toBe('File bukan JSON yang valid.')
    }
  })

  it('returns NOT_A_SCENE when format is not linden-scene', () => {
    const json = JSON.stringify({
      format: 'some-other-engine',
      version: 1,
      name: 'Other',
      camera: { position: [0, 0, 0], target: [0, 0, 0] },
      objects: [],
    })
    const res = parseSceneFile(json)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('NOT_A_SCENE')
      expect(res.message).toBe('File ini bukan scene Linden Engine.')
    }
  })

  it('returns UNSUPPORTED_VERSION when version is newer than supported', () => {
    const filePath = path.resolve(__dirname, '../../fixtures/future-version.lscene')
    const content = fs.readFileSync(filePath, 'utf-8')
    const res = parseSceneFile(content)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('UNSUPPORTED_VERSION')
      expect(res.message).toContain('Scene dibuat dengan versi engine yang lebih baru (v3).')
    }
  })

  it('returns SCHEMA_INVALID for bad primitive kind', () => {
    const filePath = path.resolve(__dirname, '../../fixtures/bad-schema.lscene')
    const content = fs.readFileSync(filePath, 'utf-8')
    const res = parseSceneFile(content)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('SCHEMA_INVALID')
      expect(res.message).toContain('objects.0.primitive')
    }
  })

  it('returns SCHEMA_INVALID for duplicate object ids', () => {
    const filePath = path.resolve(__dirname, '../../fixtures/duplicate-id.lscene')
    const content = fs.readFileSync(filePath, 'utf-8')
    const res = parseSceneFile(content)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('SCHEMA_INVALID')
      expect(res.message).toContain('Duplicate object id')
    }
  })

  it('returns SCHEMA_INVALID for parentId cycles', () => {
    const json = JSON.stringify({
      format: SCENE_FORMAT,
      version: 1,
      name: 'Cycle',
      camera: { position: [0, 0, 0], target: [0, 0, 0] },
      objects: [
        {
          id: 'A',
          name: 'Object A',
          parentId: 'B',
          kind: 'primitive',
          primitive: 'box',
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          material: { color: '#ffffff', roughness: 0.5, metalness: 0.5 },
        },
        {
          id: 'B',
          name: 'Object B',
          parentId: 'A',
          kind: 'primitive',
          primitive: 'box',
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          material: { color: '#ffffff', roughness: 0.5, metalness: 0.5 },
        },
      ],
    })
    const res = parseSceneFile(json)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('SCHEMA_INVALID')
      expect(res.message).toContain('Parent cycle detected')
    }
  })

  it('validates v2 entities: duplicate ids, missing parents and cycles', () => {
    const ent = (id: string, parentId: string | null) => ({ id, name: id, parentId, components: [] })
    const parse = (entities: unknown[]) => parseSceneFile(JSON.stringify({ format: SCENE_FORMAT, version: 2, name: 'S', entities }))
    const dup = parse([ent('a', null), ent('a', null)])
    expect(!dup.ok && dup.message).toContain('Duplicate entity id')
    const missing = parse([ent('a', 'x')])
    expect(!missing.ok && missing.message).toContain('invalid parent')
    const cycle = parse([ent('a', 'b'), ent('b', 'a')])
    expect(!cycle.ok && cycle.message).toContain('Parent cycle')
  })

  it('returns SCHEMA_INVALID when parentId refers to self or non-existent parent', () => {
    const json = JSON.stringify({
      format: SCENE_FORMAT,
      version: 1,
      name: 'BadParent',
      camera: { position: [0, 0, 0], target: [0, 0, 0] },
      objects: [
        {
          id: 'obj-1',
          name: 'Object 1',
          parentId: 'obj-1',
          kind: 'primitive',
          primitive: 'box',
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          material: { color: '#ffffff', roughness: 0.5, metalness: 0.5 },
        },
      ],
    })
    const res = parseSceneFile(json)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('SCHEMA_INVALID')
      expect(res.message).toContain('cannot have itself as parent')
    }
  })
})
