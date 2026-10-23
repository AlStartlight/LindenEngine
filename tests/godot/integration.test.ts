import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { WebSocket } from 'ws'
import { GodotBridge } from '../../engine/godot/GodotBridge'
import { World } from '../../engine/ecs/World'
import { MeshRenderer, Camera, Light, LightType } from '../../engine/renderer/Components'
import { Rigidbody, BoxCollider } from '../../engine/physics/components'
import { BlueprintGraph } from '../../engine/blueprints/BlueprintGraph'
import { EventTick, RotateNode } from '../../engine/blueprints/BlueprintNode'
import { MaterialMap } from '../../engine/godot/mapping/MaterialMap'
import { AnimatorMap } from '../../engine/godot/mapping/AnimatorMap'
import { SyncServer } from '../../engine/godot/sync/SyncServer'
import { TscnParser } from '../../engine/godot/tscn/TscnParser'
import { TscnWriter } from '../../engine/godot/tscn/TscnWriter'
import { ComponentMap } from '../../engine/godot/mapping/ComponentMap'
import { CompatReport } from '../../engine/godot/report/CompatReport'

const TEST_DIR = path.join(process.cwd(), 'tests', 'godot', 'temp_proj')

describe('Godot Bridge - Integration Tests (IT-01 to IT-09)', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true })
    }
    fs.mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  // IT-02: Round-trip Linden -> Godot -> Linden
  it('IT-02: round-trip Linden -> Godot -> Linden preserves entities, hierarchy, components, and values', async () => {
    const bridge = new GodotBridge(null, { godotProjectPath: TEST_DIR })
    const world = new World()

    // 1. Root entity
    const root = world.createEntity('SceneRoot')
    root.getTransform().setPosition(0, 10, 0)

    // 2. Child with Camera
    const camEntity = world.createEntity('MainCamera', root.id)
    const cam = new Camera()
    cam.fov = 70
    cam.near = 0.5
    cam.far = 500
    camEntity.addComponent(cam)

    // 3. Child with Light
    const lightEntity = world.createEntity('Sun', root.id)
    const light = new Light(LightType.POINT)
    light.intensity = 3.5
    light.range = 25
    lightEntity.addComponent(light)

    // 4. Mesh cube with Rigidbody & BoxCollider
    const boxEntity = world.createEntity('PhysicsBox', root.id)
    boxEntity.getTransform().setPosition(5, 5, 5)
    boxEntity.getTransform().setRotation(10, 20, 30)
    const rb = new Rigidbody()
    rb.mass = 12.5
    boxEntity.addComponent(rb)
    const col = new BoxCollider()
    col.size = { x: 2, y: 2, z: 2 }
    boxEntity.addComponent(col)

    // Export to .tscn
    const tscnPath = path.join(TEST_DIR, 'roundtrip.tscn')
    const exportRep = await bridge.exportScene(world, tscnPath)
    expect(exportRep.isSuccess).toBe(true)
    expect(fs.existsSync(tscnPath)).toBe(true)

    // Import back into fresh world
    const { world: importedWorld, report: importRep } = await bridge.importScene(tscnPath)
    expect(importRep.isSuccess).toBe(true)

    const importedEntities = importedWorld.getEntities()
    expect(importedEntities.length).toBeGreaterThanOrEqual(4)

    // Verify root
    const impRoot = importedEntities.find((e) => e.name === 'SceneRoot')
    expect(impRoot).toBeDefined()
    expect(impRoot!.getTransform().position.y).toBeCloseTo(10, 3)

    // Verify camera child
    const impCam = importedEntities.find((e) => e.name === 'MainCamera')
    expect(impCam).toBeDefined()
    const camComp = impCam!.getComponent<Camera>('Camera')
    expect(camComp).toBeDefined()
    expect(camComp!.fov).toBe(70)

    // Verify light child
    const impLight = importedEntities.find((e) => e.name === 'Sun')
    expect(impLight).toBeDefined()
    const lightComp = impLight!.getComponent<Light>('Light')
    expect(lightComp).toBeDefined()
    expect(lightComp!.intensity).toBe(3.5)

    // Verify physics box
    const impBox = importedEntities.find((e) => e.name === 'PhysicsBox')
    expect(impBox).toBeDefined()
    expect(impBox!.getTransform().position.x).toBeCloseTo(5, 3)
    const rbComp = impBox!.getComponent<Rigidbody>('Rigidbody')
    expect(rbComp).toBeDefined()
    expect(rbComp!.mass).toBe(12.5)
  })

  // IT-03: Round-trip Godot -> Linden -> Godot
  it('IT-03: round-trip Godot -> Linden -> Godot preserves passthrough nodes without data loss', async () => {
    const originalTscn = `[gd_scene format=3]

[node name="World" type="Node3D"]

[node name="CustomEmitters" type="GPUParticles3D" parent="."]
amount = 128
explosiveness = 0.85

[node name="Navigation" type="NavigationRegion3D" parent="."]
travel_cost = 1.5
`
    const parser = new TscnParser()
    const doc = parser.parse(originalTscn)
    const rep = new CompatReport()
    const world = ComponentMap.importWorld(doc, rep)

    expect(world.getEntities().length).toBe(3)

    // Re-export to Godot AST
    const exportedDoc = ComponentMap.exportWorld(world, new CompatReport())
    const writer = new TscnWriter()
    const exportedTscn = writer.write(exportedDoc)

    expect(exportedTscn).toContain('type="GPUParticles3D"')
    expect(exportedTscn).toContain('amount = 128')
    expect(exportedTscn).toContain('type="NavigationRegion3D"')
    expect(exportedTscn).toContain('travel_cost = 1.5')
  })

  // IT-04: Blueprint rotating cube runnable structure
  it('IT-04: transpiles rotating cube Blueprint to valid GDScript structure', () => {
    const graph = new BlueprintGraph('RotatingCube')
    const tick = graph.createNode('EventTick') as EventTick
    const rotate = graph.createNode('Rotate') as RotateNode
    const speedPin = rotate.inputPins.find((p) => p.name === 'Speed')!
    speedPin.defaultValue = 180.0

    const tickExec = tick.outputPins.find((p) => p.name === 'Then')!
    const rotExec = rotate.inputPins.find((p) => p.name === 'Execute')!
    graph.connect(tick.id, tickExec.id, rotate.id, rotExec.id)

    const bridge = new GodotBridge()
    const { code, report } = bridge.transpileBlueprint(graph)

    expect(report.isSuccess).toBe(true)
    expect(code).toContain('extends Node3D')
    expect(code).toContain('func _process(delta: float) -> void:')
    expect(code).toContain('rotate_y(deg_to_rad(180) * delta)')
  })

  // IT-05: Material PBR
  it('IT-05: converts PBR material with red albedo, metallic 1, roughness 0.2 to StandardMaterial3D', () => {
    const matProps = MaterialMap.toGodotStandardMaterial({
      color: '#ff0000',
      metallic: 1.0,
      roughness: 0.2,
    })

    expect(matProps['albedo_color']).toEqual({ r: 1, g: 0, b: 0, a: 1 })
    expect(matProps['metallic']).toBe(1.0)
    expect(matProps['roughness']).toBe(0.2)
  })

  // IT-06: Animator
  it('IT-06: converts Animator state machine with 3 states and transitions to AnimationTree and AnimationNodeStateMachine', () => {
    const states = [
      { name: 'Idle', loop: true },
      { name: 'Running', speed: 1.2 },
      { name: 'Jumping', loop: false },
    ]
    const transitions = [
      {
        fromState: 'Idle',
        toState: 'Running',
        conditions: [{ parameter: 'Speed', operator: 'greater' as const, threshold: 0.1 }],
      },
      {
        fromState: 'Running',
        toState: 'Jumping',
        conditions: [{ parameter: 'IsGrounded', operator: 'equal' as const, threshold: false }],
      },
    ]

    const res = AnimatorMap.toGodotAnimationTree('PlayerAnim', states, transitions, [])

    expect(res.subResources.length).toBe(1)
    const sm = res.subResources[0]
    expect(sm.type).toBe('AnimationNodeStateMachine')
    expect(sm.properties['states']).toEqual(['Idle', 'Running', 'Jumping'])
    expect(sm.properties['transitions'].length).toBe(2)
    expect(res.treeNodeProperties['active']).toBe(true)
  })

  // IT-07: Sequencer
  it('IT-07: converts cutscene 4 tracks to AnimationPlayer sub_resource', () => {
    const tracks = [
      { name: 'Position', type: 'transform' as const, keyframes: [{ time: 0, value: 0 }, { time: 2, value: 10 }] },
      { name: 'RunAnim', type: 'animation' as const, keyframes: [{ time: 0, value: 'run' }] },
      { name: 'Voiceover', type: 'audio' as const, keyframes: [{ time: 1, value: 'intro.wav' }] },
      { name: 'SpawnParticle', type: 'event' as const, keyframes: [{ time: 2.5, value: 'trigger_fx' }] },
    ]

    const anim = AnimatorMap.toGodotAnimationPlayer('Cutscene1', tracks, 3.0)

    expect(anim.subResources.length).toBe(1)
    const animRes = anim.subResources[0]
    expect(animRes.type).toBe('Animation')
    expect(animRes.properties['length']).toBe(3.0)
    expect(animRes.properties['tracks'].length).toBe(4)
    expect(animRes.properties['tracks'][3].type).toBe('method')
  })

  // IT-08: Handshake addon
  it('IT-08: successful handshake between Godot client and Linden SyncServer', async () => {
    const port = 6018
    const token = 'valid_session_token_123'
    const server = new SyncServer({ port, token })
    let clientConnectedVersion = ''

    server.onClientConnected = (info) => {
      clientConnectedVersion = info.godotVersion || ''
    }

    await server.start()

    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const receivedMessages: any[] = []

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        // Send hello handshake
        ws.send(
          JSON.stringify({
            v: 1,
            type: 'hello',
            token,
            godot_version: '4.3.stable',
          })
        )
      })

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        receivedMessages.push(msg)
        if (msg.type === 'ack') {
          resolve()
        }
      })

      ws.on('error', reject)
    })

    expect(receivedMessages.length).toBeGreaterThanOrEqual(1)
    expect(receivedMessages[0].type).toBe('ack')
    expect(receivedMessages[0].details.status).toBe('connected')
    expect(clientConnectedVersion).toBe('4.3.stable')

    ws.close()
    server.stop()
  })

  // IT-09: Token salah
  it('IT-09: connection rejected when client presents invalid session token', async () => {
    const port = 6019
    const validToken = 'valid_token'
    const server = new SyncServer({ port, token: validToken })
    let serverErrorCaptured = false

    server.onError = () => {
      serverErrorCaptured = true
    }

    await server.start()

    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    let closedCode = 0

    await new Promise<void>((resolve) => {
      ws.on('open', () => {
        // Send hello with incorrect token
        ws.send(
          JSON.stringify({
            v: 1,
            type: 'hello',
            token: 'wrong_random_token',
          })
        )
      })

      ws.on('close', (code) => {
        closedCode = code
        resolve()
      })
    })

    expect(closedCode).toBe(4001)
    expect(serverErrorCaptured).toBe(true)

    server.stop()
  })
})
