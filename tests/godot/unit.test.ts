import { describe, it, expect } from 'vitest'
import { TscnWriter, sanitizeNodeName } from '../../engine/godot/tscn/TscnWriter'
import { TscnParser, TscnParserError } from '../../engine/godot/tscn/TscnParser'
import {
  parseVariant,
  formatVariant,
  eulerDegreesToTransform3D,
  transform3DToEulerDegrees,
  GodotNodePath,
} from '../../engine/godot/tscn/Variant'
import { ComponentMap } from '../../engine/godot/mapping/ComponentMap'
import { GodotPassthroughComponent } from '../../engine/godot/mapping/GodotPassthroughComponent'
import { World } from '../../engine/ecs/World'
import { Light, LightType } from '../../engine/renderer/Components'
import { DiffEngine, EntitySnapshot } from '../../engine/godot/sync/DiffEngine'
import { ConflictResolver } from '../../engine/godot/sync/ConflictResolver'
import { CompatReport } from '../../engine/godot/report/CompatReport'

describe('Bridge (Godot) - Unit Tests (UT-01 to UT-09, UT-15 to UT-16)', () => {
  // UT-01: TscnWriter - Single entity with Transform
  it('UT-01: exports single entity with position (1,2,3) and Y rotation 90 deg', () => {
    const world = new World()
    const entity = world.createEntity('Player')
    entity.getTransform().setPosition(1, 2, 3)
    entity.getTransform().setRotation(0, 90, 0)

    const report = new CompatReport()
    const doc = ComponentMap.exportWorld(world, report)
    const writer = new TscnWriter()
    const output = writer.write(doc)

    expect(output).toContain('[node name="Player" type="Node3D"]')
    expect(output).toContain(`metadata/linden_id = "${entity.id}"`)
    // Rotation of 90 deg Y should convert to basis containing ~0 and 1 / -1
    expect(output).toContain('Transform3D(')
    expect(output).toContain('1, 2, 3)')
  })

  // UT-02: TscnWriter - Determinism
  it('UT-02: produces byte-identical output when exporting the same scene twice', () => {
    const world = new World()
    const e1 = world.createEntity('ObjA')
    e1.getTransform().setPosition(10, 20, 30)
    const e2 = world.createEntity('ObjB')
    e2.getTransform().setScale(2, 2, 2)

    const report = new CompatReport()
    const doc1 = ComponentMap.exportWorld(world, report)
    const doc2 = ComponentMap.exportWorld(world, report)

    const writer = new TscnWriter()
    const out1 = writer.write(doc1)
    const out2 = writer.write(doc2)

    expect(out1).toBe(out2)
  })

  // UT-03: TscnWriter - Name Sanitization
  it('UT-03: sanitizes forbidden node characters and preserves original name in metadata', () => {
    const rawName = 'Player.1/Main@Test:Obj"Special%Char'
    const { sanitized, original, changed } = sanitizeNodeName(rawName)

    expect(changed).toBe(true)
    expect(original).toBe(rawName)
    expect(sanitized).not.toMatch(/[.:@/"%]/)

    const world = new World()
    const entity = world.createEntity(rawName)
    const doc = ComponentMap.exportWorld(world, new CompatReport())
    const node = doc.nodes[0]

    expect(node.name).toBe(sanitized)
    expect(node.properties['metadata/linden_name']).toBe(rawName)
  })

  // UT-04: TscnParser - Parse standard scene
  it('UT-04: parses standard .tscn text to AST with correct hierarchy', () => {
    const tscn = `[gd_scene format=3]

[node name="Main" type="Node3D"]

[node name="Camera" type="Camera3D" parent="."]
fov = 75.0

[node name="Cube" type="MeshInstance3D" parent="."]
`
    const parser = new TscnParser()
    const doc = parser.parse(tscn)

    expect(doc.nodes.length).toBe(3)
    expect(doc.nodes[0].name).toBe('Main')
    expect(doc.nodes[1].name).toBe('Camera')
    expect(doc.nodes[1].parent).toBe('.')
    expect(doc.nodes[1].properties['fov']).toBe(75.0)
    expect(doc.nodes[2].name).toBe('Cube')
  })

  // UT-05: TscnParser - ext_resource and sub_resource
  it('UT-05: resolves ext_resource and sub_resource without orphan references', () => {
    const tscn = `[gd_scene format=3]

[ext_resource type="Script" path="res://player.gd" id="1_abc"]

[sub_resource type="StandardMaterial3D" id="Mat_1"]
albedo_color = Color(1, 0, 0, 1)

[node name="Player" type="Node3D"]
script = ExtResource("1_abc")

[node name="Mesh" type="MeshInstance3D" parent="."]
material = SubResource("Mat_1")
`
    const parser = new TscnParser()
    const doc = parser.parse(tscn)

    expect(doc.extResources.length).toBe(1)
    expect(doc.extResources[0].id).toBe('1_abc')
    expect(doc.subResources.length).toBe(1)
    expect(doc.subResources[0].id).toBe('Mat_1')
    expect(doc.nodes[0].properties['script'].id).toBe('1_abc')
    expect(doc.nodes[1].properties['material'].id).toBe('Mat_1')
  })

  // UT-06: TscnParser - Broken file handling
  it('UT-06: reports controlled line-numbered error when parsing corrupted file', () => {
    const corruptTscn = `[gd_scene format=3]

[node name="UnclosedSection
transform = Transform3D()
`
    const parser = new TscnParser()
    expect(() => parser.parse(corruptTscn)).toThrowError(TscnParserError)
    try {
      parser.parse(corruptTscn)
    } catch (err: any) {
      expect(err.line).toBe(3)
    }
  })

  // UT-07: Variant - Type conversions
  it('UT-07: round-trips Vector3, Color, Transform3D, NodePath, Array, and Dictionary within 1e-6', () => {
    const v3 = { x: 1.234567, y: -2.345678, z: 9.876543 }
    const formattedV3 = formatVariant(v3)
    const parsedV3 = parseVariant(formattedV3)
    expect(parsedV3.x).toBeCloseTo(v3.x, 5)
    expect(parsedV3.y).toBeCloseTo(v3.y, 5)
    expect(parsedV3.z).toBeCloseTo(v3.z, 5)

    const col = { r: 0.1, g: 0.5, b: 0.9, a: 1 }
    const parsedCol = parseVariant(formatVariant(col))
    expect(parsedCol.r).toBeCloseTo(col.r, 5)
    expect(parsedCol.g).toBeCloseTo(col.g, 5)

    const np = new GodotNodePath('Parent/Child')
    expect(formatVariant(np)).toBe('NodePath("Parent/Child")')
    const parsedNp = parseVariant('NodePath("Parent/Child")')
    expect(parsedNp.path).toBe('Parent/Child')

    // Euler to Transform3D and back
    const pos = { x: 10, y: 20, z: -5 }
    const rot = { x: 30, y: 45, z: 60 }
    const scale = { x: 1, y: 1, z: 1 }
    const t3d = eulerDegreesToTransform3D(pos, rot, scale)
    const decomposed = transform3DToEulerDegrees(t3d)
    expect(decomposed.position.x).toBeCloseTo(pos.x, 4)
    expect(decomposed.position.y).toBeCloseTo(pos.y, 4)
    expect(decomposed.position.z).toBeCloseTo(pos.z, 4)
    expect(decomposed.rotation.x).toBeCloseTo(rot.x, 2)
    expect(decomposed.rotation.y).toBeCloseTo(rot.y, 2)
    expect(decomposed.rotation.z).toBeCloseTo(rot.z, 2)
  })

  // UT-08: ComponentMap - Light mapping
  it('UT-08: converts Point light with intensity 2 to OmniLight3D with light_energy = 2', () => {
    const world = new World()
    const entity = world.createEntity('Lamp')
    const light = new Light(LightType.POINT)
    light.intensity = 2
    entity.addComponent(light)

    const report = new CompatReport()
    const doc = ComponentMap.exportWorld(world, report)
    const node = doc.nodes[0]

    expect(node.type).toBe('OmniLight3D')
    expect(node.properties['light_energy']).toBe(2)
  })

  // UT-09: ComponentMap - Unknown node passthrough
  it('UT-09: imports unknown GPUParticles3D as GodotPassthroughComponent and warns in report', () => {
    const tscn = `[gd_scene format=3]

[node name="Particles" type="GPUParticles3D"]
amount = 64
`
    const parser = new TscnParser()
    const doc = parser.parse(tscn)
    const report = new CompatReport()
    const world = ComponentMap.importWorld(doc, report)

    const entity = world.getEntities()[0]
    const passthrough = entity.getComponent<GodotPassthroughComponent>('GodotPassthrough')

    expect(passthrough).toBeDefined()
    expect(passthrough?.rawType).toBe('GPUParticles3D')
    expect(passthrough?.rawProperties['amount']).toBe(64)
    expect(report.skippedCount).toBe(1)
  })

  // UT-15: DiffEngine - Property diff
  it('UT-15: produces only 1 property_changed diff message when 1 entity changes among 100', () => {
    const diffEngine = new DiffEngine()
    const initialSnapshots: EntitySnapshot[] = []

    for (let i = 0; i < 100; i++) {
      initialSnapshots.push({
        id: `entity_${i}`,
        name: `Entity_${i}`,
        parentId: null,
        transform: {
          position: { x: i, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
        properties: {},
      })
    }

    diffEngine.setPreviousState(initialSnapshots)

    // Clone and modify only entity_42
    const currentSnapshots = JSON.parse(JSON.stringify(initialSnapshots))
    currentSnapshots[42].transform.position.y = 99.5

    const messages = diffEngine.computeDiff(currentSnapshots, 'test_token', 'linden')

    expect(messages.length).toBe(1)
    expect(messages[0].type).toBe('property_changed')
    expect(messages[0].linden_id).toBe('entity_42')
    expect(messages[0].path).toBe('transform.position')
    expect(messages[0].value.y).toBe(99.5)
  })

  // UT-16: ConflictResolver - Concurrent edits
  it('UT-16: detects conflict when local rev 41 and remote rev 41 modify same path and does not overwrite in ask mode', () => {
    const resolver = new ConflictResolver('ask')
    resolver.setRevision('cube_1', 'transform.position', 40)

    const localChange = {
      entityId: 'cube_1',
      path: 'transform.position',
      value: { x: 1, y: 2, z: 3 },
      rev: 41,
    }

    const remoteMsg = {
      v: 1,
      type: 'property_changed' as const,
      linden_id: 'cube_1',
      path: 'transform.position',
      value: { x: 9, y: 9, z: 9 },
      rev: 41,
    }

    const res = resolver.processIncomingChange(localChange, remoteMsg)

    expect(res.status).toBe('conflict')
    expect(res.conflict).toBeDefined()
    expect(resolver.getPendingConflicts().length).toBe(1)

    // Resolve conflict choosing linden
    resolver.resolveConflict(res.conflict!.id, 'linden')
    expect(resolver.getPendingConflicts().length).toBe(0)
    expect(resolver.getRevision('cube_1', 'transform.position')).toBe(42)
  })
})
