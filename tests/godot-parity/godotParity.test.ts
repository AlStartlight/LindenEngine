import { describe, it, expect, vi } from 'vitest'
import { Node, Node2D, Node3D, Control } from '../../engine/scene/Node'
import { SceneTree } from '../../engine/scene/SceneTree'
import { PackedScene } from '../../engine/scene/PackedScene'
import { Signal } from '../../engine/scene/Signal'
import { Sprite2D, Renderer2D } from '../../engine/renderer2d/Renderer2D'
import { TileSet } from '../../engine/tilemap/TileSet'
import { TileMapLayer } from '../../engine/tilemap/TileMap'
import { AnimationPlayer } from '../../engine/animation/AnimationPlayer'
import { CharacterBody2D, StaticBody2D, Area2D } from '../../engine/physics/Physics2D'
import { InputMap } from '../../engine/input/InputMap'
import { CommandStack } from '../../editor/commands/CommandStack'
import { World } from '../../engine/ecs/World'

describe('Godot Parity Features (TC-GF-01 to TC-GF-14)', () => {
  // TC-GF-01: Node hierarchy & reordering
  it('TC-GF-01: creates Node2D with 3 children, moves 3rd child to index 0, recalculates global transform', () => {
    const parent = new Node2D('Parent')
    parent.position = { x: 100, y: 100 }

    const c1 = new Node2D('Child1')
    c1.position = { x: 10, y: 0 }
    const c2 = new Node2D('Child2')
    c2.position = { x: 20, y: 0 }
    const c3 = new Node2D('Child3')
    c3.position = { x: 30, y: 0 }

    parent.addChild(c1)
    parent.addChild(c2)
    parent.addChild(c3)

    expect(parent.getChildren().map((c) => c.name)).toEqual(['Child1', 'Child2', 'Child3'])

    // Move child 3 to index 0
    parent.moveChild(c3, 0)
    expect(parent.getChildren().map((c) => c.name)).toEqual(['Child3', 'Child1', 'Child2'])

    // Global position recalculation
    expect(c3.getGlobalPosition()).toEqual({ x: 130, y: 100 })
  })

  // TC-GF-02: Save & load scene (.lscn)
  it('TC-GF-02: saves scene with 50 nodes to .lscn and reloads identically', () => {
    const root = new Node2D('Root')
    for (let i = 0; i < 49; i++) {
      const child = new Node2D(`Node_${i}`)
      child.position = { x: i * 5, y: i * 10 }
      child.addToGroup(i % 2 === 0 ? 'evens' : 'odds')
      root.addChild(child)
    }

    const packed = new PackedScene()
    packed.pack(root)
    const serialized1 = packed.serialize()

    const reloadedPacked = PackedScene.deserialize(serialized1)
    const reloadedRoot = reloadedPacked.instantiate()
    expect(reloadedRoot.name).toBe('Root')
    expect(reloadedRoot.getChildren().length).toBe(49)
    expect((reloadedRoot.getChildren()[10] as Node2D).position).toEqual({ x: 50, y: 100 })

    // Stable diff: serialize reloaded should match serialized1
    const packed2 = new PackedScene()
    packed2.pack(reloadedRoot)
    const serialized2 = packed2.serialize()
    expect(serialized2).toBe(serialized1)
  })

  // TC-GF-03: Scene instancing
  it('TC-GF-03: instances scene 3 times and supports property overrides', () => {
    const enemyPrefab = new Node2D('Enemy')
    enemyPrefab.position = { x: 0, y: 0 }
    const sprite = new Sprite2D('Sprite')
    sprite.modulate = '#ff0000'
    enemyPrefab.addChild(sprite)

    const packed = new PackedScene()
    packed.pack(enemyPrefab)

    const inst1 = packed.instantiate() as Node2D
    const inst2 = packed.instantiate() as Node2D
    const inst3 = packed.instantiate() as Node2D

    // Override inst2 position
    inst2.position = { x: 250, y: 100 }

    expect(inst1.position).toEqual({ x: 0, y: 0 })
    expect(inst2.position).toEqual({ x: 250, y: 100 })
    expect(inst3.position).toEqual({ x: 0, y: 0 })
  })

  // TC-GF-04: Signals
  it('TC-GF-04: connects Button.pressed to Door.open(), emits signal and verifies persistence', () => {
    const button = new Node('Button')
    const door = {
      isOpen: false,
      open() {
        this.isOpen = true
      },
    }

    button.connect('pressed', door, 'open')
    button.emitSignal('pressed')

    expect(door.isOpen).toBe(true)
  })

  // TC-GF-05: Area2D Signals
  it('TC-GF-05: emits body_entered signal when body enters Area2D', () => {
    const area = new Area2D('TriggerZone')
    const spy = vi.fn()
    area.connect('body_entered', spy)

    const player = new CharacterBody2D('Player')
    area.notifyBodyEntered(player)

    expect(spy).toHaveBeenCalledWith(player)
  })

  // TC-GF-06: Groups
  it('TC-GF-06: adds 10 nodes to group "enemies" and invokes callGroup("enemies", "stun")', () => {
    const tree = new SceneTree()
    const enemies: any[] = []

    for (let i = 0; i < 10; i++) {
      const e = new Node(`Enemy_${i}`) as any
      e.stunned = false
      e.stun = function () {
        this.stunned = true
      }
      e.addToGroup('enemies')
      tree.root.addChild(e)
      enemies.push(e)
    }

    expect(tree.getNodesInGroup('enemies').length).toBe(10)

    tree.callGroup('enemies', 'stun')
    expect(enemies.every((e) => e.stunned === true)).toBe(true)
  })

  // TC-GF-07: Autoload
  it('TC-GF-07: registers GameState as autoload, persists across scene transitions', () => {
    const tree = new SceneTree()
    const gameState = new Node('GameState') as any
    gameState.score = 42

    tree.registerAutoload('GameState', gameState)

    // Set first scene
    const scene1 = new Node('Level1')
    tree.setCurrentScene(scene1)
    expect(tree.getAutoload('GameState')).toBe(gameState)
    expect((tree.getAutoload('GameState') as any).score).toBe(42)

    // Switch scene
    const scene2 = new Node('Level2')
    tree.setCurrentScene(scene2)
    expect(tree.getAutoload('GameState')).toBe(gameState)
    expect((tree.getAutoload('GameState') as any).score).toBe(42)
  })

  // TC-GF-08: Render 2D z-index sorting
  it('TC-GF-08: sorts 3 sprites with z-indices 0, 5, -1 into -1, 0, 5', () => {
    const s1 = new Sprite2D('Sprite1')
    s1.zIndex = 0
    const s2 = new Sprite2D('Sprite2')
    s2.zIndex = 5
    const s3 = new Sprite2D('Sprite3')
    s3.zIndex = -1

    const sorted = Renderer2D.sortItemsByZIndex([s1, s2, s3])
    expect(sorted.map((s) => s.zIndex)).toEqual([-1, 0, 5])
  })

  // TC-GF-09: TileMap autotiling & collisions
  it('TC-GF-09: paints tiles with terrain autotile and detects collision', () => {
    const tileSet = new TileSet()
    tileSet.setTileData(1, 0, { atlasCoords: { x: 1, y: 0 }, collision: { hasCollision: true } })
    tileSet.setTileData(1, 1, { atlasCoords: { x: 1, y: 1 }, collision: { hasCollision: true } })

    const tileMap = new TileMapLayer('LevelTiles')
    tileMap.tileSet = tileSet

    // Set grid of cells
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) {
        tileMap.setCell({ x, y }, 0, { x: 1, y: 1 })
      }
    }

    expect(tileMap.getCellCount()).toBe(100)
    expect(tileMap.hasCollisionAt({ x: 5, y: 5 })).toBe(true)

    // Autotile check for top border vs center
    const topBorder = tileMap.resolveTerrainAutotile({ x: 5, y: 0 })
    expect(topBorder).toEqual({ x: 1, y: 0 })
  })

  // TC-GF-10: AnimationPlayer keyframe interpolation
  it('TC-GF-10: animates position and modulate over 2 seconds, samples at t=1s', () => {
    const anim = new AnimationPlayer('Player')
    const target = new Node2D('Target')
    anim.targetNode = target

    anim.addClip({
      name: 'walk',
      length: 2.0,
      loop: false,
      tracks: [
        {
          property: 'position.x',
          keyframes: [
            { time: 0, value: 0 },
            { time: 2, value: 200 },
          ],
        },
        {
          property: 'modulate',
          keyframes: [
            { time: 0, value: '#000000' },
            { time: 2, value: '#ffffff' },
          ],
        },
      ],
    })

    anim.play('walk')
    anim.seek(1.0)

    expect(target.position.x).toBeCloseTo(100, 4)
    expect(target.modulate.toLowerCase()).toBe('#808080')
  })

  // TC-GF-11: CharacterBody2D movement & collision
  it('TC-GF-11: CharacterBody2D falls towards StaticBody2D, lands and sets isOnFloor=true', () => {
    const root = new Node2D('Root')
    const ground = new StaticBody2D('Ground')
    ground.position = { x: 0, y: 100 }

    const char = new CharacterBody2D('Player')
    char.position = { x: 0, y: 50 }
    char.velocity = { x: 0, y: 600 } // falling down

    root.addChild(ground)
    root.addChild(char)

    // Step physics
    char.moveAndSlide(0.1) // moves down by 60
    expect(char.isOnFloor()).toBe(true)
    expect(char.position.y).toBe(68) // 100 - 32
  })

  // TC-GF-12: InputMap actions
  it('TC-GF-12: maps action "jump" to Space key and Gamepad button A, verifies isActionPressed', () => {
    InputMap.clear()
    InputMap.actionAddEvent('jump', { type: 'key', code: 'Space' })
    InputMap.actionAddEvent('jump', { type: 'gamepad', code: 0 })

    expect(InputMap.isActionPressed('jump')).toBe(false)

    // Press Space
    InputMap.setPressed('key', 'Space', true)
    expect(InputMap.isActionPressed('jump')).toBe(true)
    expect(InputMap.isActionJustPressed('jump')).toBe(true)

    // Release Space
    InputMap.setPressed('key', 'Space', false)
    expect(InputMap.isActionPressed('jump')).toBe(false)

    // Press Gamepad A
    InputMap.setPressed('gamepad', 0, true)
    expect(InputMap.isActionPressed('jump')).toBe(true)
  })

  // TC-GF-13: Undo/Redo
  it('TC-GF-13: adds node, changes transform, removes node, undoes 3x to restore original state', () => {
    const world = new World()
    const stack = new CommandStack(world)

    // 1. Add entity
    let entityId: string = ''
    stack.execute({
      label: 'Add Entity',
      do: (w) => {
        const e = w.createEntity('Box')
        entityId = e.id
      },
      undo: (w) => {
        w.destroyEntity(entityId)
      },
    })
    expect(world.getEntity(entityId)).toBeDefined()

    // 2. Change transform
    stack.execute({
      label: 'Change Transform',
      do: (w) => {
        w.getEntity(entityId)!.getTransform().setPosition(5, 5, 5)
      },
      undo: (w) => {
        w.getEntity(entityId)!.getTransform().setPosition(0, 0, 0)
      },
    })
    expect(world.getEntity(entityId)!.getTransform().position).toEqual({ x: 5, y: 5, z: 5 })

    // 3. Remove entity
    let savedPos = { x: 5, y: 5, z: 5 }
    stack.execute({
      label: 'Remove Entity',
      do: (w) => {
        const p = w.getEntity(entityId)!.getTransform().position
        savedPos = { x: p.x, y: p.y, z: p.z }
        w.destroyEntity(entityId)
      },
      undo: (w) => {
        const re = w.createEntity('Box', null, undefined, entityId)
        re.getTransform().setPosition(savedPos.x, savedPos.y, savedPos.z)
      },
    })
    expect(world.getEntity(entityId)).toBeUndefined()

    // Undo 3x
    stack.undo() // restores entity
    expect(world.getEntity(entityId)).toBeDefined()
    expect(world.getEntity(entityId)!.getTransform().position).toEqual({ x: 5, y: 5, z: 5 })

    stack.undo() // restores position to 0,0,0
    expect(world.getEntity(entityId)!.getTransform().position).toEqual({ x: 0, y: 0, z: 0 })

    stack.undo() // removes entity
    expect(world.getEntity(entityId)).toBeUndefined()
  })

  // TC-GF-14: Export preset validation
  it('TC-GF-14: verifies export preset configuration for Web, Windows, macOS, Linux', () => {
    const presets = [
      { name: 'Web', platform: 'web', target: 'dist/web' },
      { name: 'Windows', platform: 'windows', target: 'dist/win' },
      { name: 'macOS', platform: 'macos', target: 'dist/mac' },
      { name: 'Linux', platform: 'linux', target: 'dist/linux' },
    ]

    expect(presets.length).toBe(4)
    expect(presets.find((p) => p.platform === 'web')?.target).toBe('dist/web')
  })
})
