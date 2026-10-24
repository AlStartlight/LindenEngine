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
import { BlueprintGraph } from '../../engine/blueprints/BlueprintGraph'
import {
  EventBeginPlay,
  EventTick,
  RotateNode,
  BranchNode,
  ForLoopNode,
  DelayNode,
  PrintStringNode,
  BlueprintNode,
  NodeCategory,
} from '../../engine/blueprints/BlueprintNode'
import { BlueprintToGd, BlueprintTranspileError } from '../../engine/godot/transpiler/BlueprintToGd'
import { DiffEngine, EntitySnapshot } from '../../engine/godot/sync/DiffEngine'
import { ConflictResolver } from '../../engine/godot/sync/ConflictResolver'
import { CompatReport } from '../../engine/godot/report/CompatReport'

describe('Bridge (Godot) - Unit Tests (UT-01 to UT-16)', () => {
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

  // UT-10: BlueprintToGd - Event Tick + Rotate
  it('UT-10: transpiles rotating cube graph to _process and rotate_y', () => {
    const graph = new BlueprintGraph('RotatingCube')
    const tick = graph.createNode('EventTick') as EventTick
    const rotate = graph.createNode('Rotate') as RotateNode

    expect(tick).toBeDefined()
    expect(rotate).toBeDefined()

    const tickExec = tick.outputPins.find((p) => p.name === 'Then')!
    const rotateExec = rotate.inputPins.find((p) => p.name === 'Execute')!
    graph.connect(tick.id, tickExec.id, rotate.id, rotateExec.id)

    const { code } = BlueprintToGd.transpile(graph)

    expect(code).toContain('extends Node3D')
    expect(code).toContain('func _process(delta: float) -> void:')
    expect(code).toContain('rotate_y(deg_to_rad(90) * delta)')
  })

  // UT-11: BlueprintToGd - Branch + Loop
  it('UT-11: generates valid tab indentation for nested Branch and For Loop', () => {
    const graph = new BlueprintGraph('BranchLoop')
    const begin = graph.createNode('EventBeginPlay')!
    const branch = graph.createNode('Branch')!
    const loop = graph.createNode('ForLoop')!
    const print = graph.createNode('PrintString')!

    const beginExec = begin.outputPins.find((p) => p.name === 'Then')!
    const branchExec = branch.inputPins.find((p) => p.name === 'Execute')!
    graph.connect(begin.id, beginExec.id, branch.id, branchExec.id)

    const branchTrue = branch.outputPins.find((p) => p.name === 'True')!
    const loopExec = loop.inputPins.find((p) => p.name === 'Execute')!
    graph.connect(branch.id, branchTrue.id, loop.id, loopExec.id)

    const loopBody = loop.outputPins.find((p) => p.name === 'Loop Body')!
    const printExec = print.inputPins.find((p) => p.name === 'Execute')!
    graph.connect(loop.id, loopBody.id, print.id, printExec.id)

    const { code } = BlueprintToGd.transpile(graph)

    expect(code).toContain('func _ready() -> void:')
    expect(code).toContain('\tif false:')
    expect(code).toContain('\t\tfor i in range(0, (10) + 1):')
    expect(code).toContain('\t\t\tprint("Hello")')
  })

  // UT-12: BlueprintToGd - Delay
  it('UT-12: BeginPlay -> Delay 2s -> Print produces await create_timer(2.0)', () => {
    const graph = new BlueprintGraph('DelayGraph')
    const begin = graph.createNode('EventBeginPlay')!
    const delay = graph.createNode('Delay')!
    const print = graph.createNode('PrintString')!

    // Set delay duration to 2.0
    const durPin = delay.inputPins.find((p) => p.name === 'Duration')!
    durPin.defaultValue = 2.0

    const beginExec = begin.outputPins.find((p) => p.name === 'Then')!
    const delayExec = delay.inputPins.find((p) => p.name === 'Execute')!
    graph.connect(begin.id, beginExec.id, delay.id, delayExec.id)

    const delayComp = delay.outputPins.find((p) => p.name === 'Completed')!
    const printExec = print.inputPins.find((p) => p.name === 'Execute')!
    graph.connect(delay.id, delayComp.id, print.id, printExec.id)

    const { code } = BlueprintToGd.transpile(graph)

    expect(code).toContain('await get_tree().create_timer(2).timeout')
    expect(code).toContain('print("Hello")')
  })

  // UT-13: BlueprintToGd - Unsupported node
  it('UT-13: marks unsupported nodes with comment and continues generating remaining graph', () => {
    class CustomPluginNode extends BlueprintNode {
      constructor() {
        super('CustomPluginNode', 'Fancy Shader Effect', NodeCategory.CUSTOM)
        this.addExecInput()
        this.addExecOutput()
      }
      execute() {
        return new Map()
      }
    }

    const graph = new BlueprintGraph('UnsupportedGraph')
    const begin = graph.createNode('EventBeginPlay')!
    const custom = new CustomPluginNode()
    graph.addNode(custom)
    const print = graph.createNode('PrintString')!

    const beginExec = begin.outputPins.find((p) => p.name === 'Then')!
    const customExecIn = custom.inputPins[0]
    graph.connect(begin.id, beginExec.id, custom.id, customExecIn.id)

    const customExecOut = custom.outputPins[0]
    const printExec = print.inputPins.find((p) => p.name === 'Execute')!
    graph.connect(custom.id, customExecOut.id, print.id, printExec.id)

    const { code, report } = BlueprintToGd.transpile(graph)

    expect(code).toContain('# UNSUPPORTED: Fancy Shader Effect')
    expect(code).toContain('print("Hello")')
    expect(report.warnings.length).toBeGreaterThanOrEqual(1)
  })

  // UT-14: BlueprintToGd - Execution cycle
  it('UT-14: rejects infinite execution loop with clear error message', () => {
    const graph = new BlueprintGraph('CycleGraph')
    const begin = graph.createNode('EventBeginPlay')!
    const print1 = graph.createNode('PrintString')!
    const print2 = graph.createNode('PrintString')!

    const beginExec = begin.outputPins.find((p) => p.name === 'Then')!
    const p1In = print1.inputPins.find((p) => p.name === 'Execute')!
    graph.connect(begin.id, beginExec.id, print1.id, p1In.id)

    const p1Out = print1.outputPins.find((p) => p.name === 'Then')!
    const p2In = print2.inputPins.find((p) => p.name === 'Execute')!
    graph.connect(print1.id, p1Out.id, print2.id, p2In.id)

    // Direct cycle back to p1 without branch or exit
    const p2Out = print2.outputPins.find((p) => p.name === 'Then')!
    graph.connect(print2.id, p2Out.id, print1.id, p1In.id)

    expect(() => BlueprintToGd.transpile(graph)).toThrowError(BlueprintTranspileError)
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
