import { create } from 'zustand'
import { World } from '../../engine/ecs/World'
import { SceneBridge } from '../../engine/scene/SceneBridge'
import { CommandStack, EditorCommand } from '../commands/CommandStack'
import { SceneSerializer } from '../../engine/scene/serializer'
import { Physics } from '../../engine/physics/components'
import { RapierBackend } from '../../engine/physics/RapierBackend'
import { Input } from '../../engine/input/InputActions'
import { Tween } from '../../engine/time/Tween'
import { LayerMask } from '../../engine/scene/LayerMask'

export interface ProjectSettingsState {
  tags: string[]
  layers: string[]
  collisionMatrix: boolean[][]
  inputActions: any[]
  services: any[]
  scenesInBuild: string[]
}

export interface EditorState {
  world: World
  bridge: SceneBridge
  commandStack: CommandStack
  selectedEntityIds: string[]
  playState: 'stopped' | 'playing' | 'paused'
  playSnapshot: string | null
  sceneName: string
  currentScenePath: string | null
  isDirty: boolean
  activeWindow: string | null
  activeEditorPanel: 'viewport' | 'blueprint' | 'material' | 'animator' | 'sequencer' | 'godot'
  projectSettings: ProjectSettingsState
  physicsBackend: RapierBackend | null

  // Actions
  selectEntity: (id: string | null, multi?: boolean) => void
  setSelectedEntityIds: (ids: string[]) => void
  executeCommand: (cmd: EditorCommand) => void
  undo: () => void
  redo: () => void
  startPlay: () => Promise<void>
  pausePlay: () => void
  stepPlay: () => void
  stopPlay: () => void
  newScene: () => void
  saveScene: (path?: string) => string
  openScene: (jsonString: string, path?: string) => void
  setActiveWindow: (windowName: string | null) => void
  setActiveEditorPanel: (panel: 'viewport' | 'blueprint' | 'material' | 'animator' | 'sequencer' | 'godot') => void
  setProjectSettings: (settings: Partial<ProjectSettingsState>) => void
  addProjectTag: (tag: string) => void
  removeProjectTag: (tag: string) => void
  setProjectLayers: (layers: string[]) => void
  setCollisionMatrixCell: (layer1: number, layer2: number, collides: boolean) => void
}

const initialWorld = new World()
const initialBridge = new SceneBridge(initialWorld)
const initialCommandStack = new CommandStack(initialWorld)

export const useEditorStore = create<EditorState>((set, get) => ({
  world: initialWorld,
  bridge: initialBridge,
  commandStack: initialCommandStack,
  selectedEntityIds: [],
  playState: 'stopped',
  playSnapshot: null,
  sceneName: 'Untitled',
  currentScenePath: null,
  isDirty: false,
  activeWindow: null,
  activeEditorPanel: 'viewport',
  physicsBackend: null,
  projectSettings: {
    tags: ['Player', 'Enemy', 'Pickup', 'Coin', 'Ground', 'Flying'],
    layers: [
      'Default',
      'TransparentFX',
      'Ignore Raycast',
      '',
      'Water',
      'UI',
      'Player',
      'Enemy',
    ],
    collisionMatrix: Array(16)
      .fill(null)
      .map(() => Array(16).fill(true)),
    inputActions: [
      { name: 'Jump', type: 'button', bindings: ['Keyboard/Space', 'Gamepad/ButtonSouth'] },
      {
        name: 'Move',
        type: 'vector2',
        composite: { up: 'Keyboard/KeyW', down: 'Keyboard/KeyS', left: 'Keyboard/KeyA', right: 'Keyboard/KeyD' },
        bindings: ['Gamepad/LeftStick'],
        deadzone: 0.2,
      },
    ],
    services: [],
    scenesInBuild: ['scenes/Level01.lscene'],
  },

  selectEntity: (id: string | null, multi: boolean = false) => {
    if (!id) {
      set({ selectedEntityIds: [] })
      return
    }

    const { selectedEntityIds } = get()
    if (multi) {
      if (selectedEntityIds.includes(id)) {
        set({ selectedEntityIds: selectedEntityIds.filter((x) => x !== id) })
      } else {
        set({ selectedEntityIds: [...selectedEntityIds, id] })
      }
    } else {
      set({ selectedEntityIds: [id] })
    }
  },

  setSelectedEntityIds: (ids: string[]) => {
    set({ selectedEntityIds: ids })
  },

  executeCommand: (cmd: EditorCommand) => {
    const { commandStack, playState } = get()
    if (playState !== 'stopped') {
      // Per SPEC §5.2: Undo is NOT active in Play mode
      cmd.do(get().world)
      return
    }
    commandStack.execute(cmd)
    set({ isDirty: commandStack.isDirty() })
  },

  undo: () => {
    const { commandStack, playState } = get()
    if (playState !== 'stopped') return
    if (commandStack.canUndo()) {
      commandStack.undo()
      set({ isDirty: commandStack.isDirty() })
    }
  },

  redo: () => {
    const { commandStack, playState } = get()
    if (playState !== 'stopped') return
    if (commandStack.canRedo()) {
      commandStack.redo()
      set({ isDirty: commandStack.isDirty() })
    }
  },

  startPlay: async () => {
    const { world, projectSettings } = get()
    // Snapshot scene
    const snapshot = SceneSerializer.serialize(world, get().sceneName)

    // Lazy load and init physics
    let backend = get().physicsBackend
    if (!backend) {
      backend = new RapierBackend((id) => world.getEntity(id))
      set({ physicsBackend: backend })
    }
    await backend.init()
    backend.setLayerCollisionMatrix(projectSettings.collisionMatrix)
    Physics.setBackend(backend)

    // Sync bodies and colliders into physics backend
    for (const ent of world.getEntities()) {
      const rb = ent.getComponent('Rigidbody') as any
      const transform = ent.getTransform()
      if (rb) {
        backend.createBody(ent.id, rb, transform, ent.layer)
      }
      for (const comp of ent.getComponents()) {
        if (
          comp.name === 'BoxCollider' ||
          comp.name === 'SphereCollider' ||
          comp.name === 'CapsuleCollider' ||
          comp.name === 'MeshCollider'
        ) {
          backend.createCollider(ent.id, comp as any, transform, rb, ent.layer)
        }
        if (comp.name === 'CharacterController') {
          const cc = comp as any
          cc.moveCallback = (delta: any) => backend!.moveCharacter(ent.id, delta)
        }
      }
    }

    // Call Start / BeginPlay on components
    for (const ent of world.getEntities()) {
      for (const comp of ent.getComponents()) {
        if (typeof (comp as any).onBeginPlay === 'function') {
          ;(comp as any).onBeginPlay(world)
        }
        if (typeof (comp as any).start === 'function') {
          ;(comp as any).start()
        }
      }
    }

    set({
      playState: 'playing',
      playSnapshot: snapshot,
    })
  },

  pausePlay: () => {
    set((state) => ({
      playState: state.playState === 'playing' ? 'paused' : 'playing',
    }))
  },

  stepPlay: () => {
    const { world, physicsBackend } = get()
    const dt = 1 / 50
    // Physics step
    if (physicsBackend) {
      physicsBackend.step(dt)
      // Sync transforms of dynamic bodies
      for (const ent of world.getEntities()) {
        const rb = ent.getComponent('Rigidbody') as any
        if (rb && rb.bodyType === 'dynamic') {
          const pos = physicsBackend.getTranslation(ent.id)
          const rot = physicsBackend.getRotation(ent.id)
          if (pos) {
            world.setProperty(ent.id, 'Transform', 'position', [pos.x, pos.y, pos.z])
          }
          if (rot) {
            world.setProperty(ent.id, 'Transform', 'rotation', [rot.x, rot.y, rot.z])
          }
        }
      }
    }

    Input.update()
    Tween.update(dt)
    world.update(dt)
    world.fixedUpdate(dt)
  },

  stopPlay: () => {
    const { world, playSnapshot, selectedEntityIds, physicsBackend } = get()
    if (physicsBackend) {
      physicsBackend.clear()
    }
    Tween.clear()

    if (playSnapshot) {
      SceneSerializer.deserialize(playSnapshot, world)
      // Restore selection if entities still exist
      const validIds = selectedEntityIds.filter((id) => Boolean(world.getEntity(id)))
      set({ selectedEntityIds: validIds })
    }

    set({
      playState: 'stopped',
      playSnapshot: null,
    })
  },

  newScene: () => {
    const { world, commandStack } = get()
    world.clear()
    commandStack.clear()
    set({
      sceneName: 'Untitled',
      currentScenePath: null,
      selectedEntityIds: [],
      isDirty: false,
    })
  },

  saveScene: (path?: string) => {
    const { world, commandStack, sceneName } = get()
    const json = SceneSerializer.serialize(world, sceneName)
    commandStack.markSaved()
    set({
      isDirty: false,
      currentScenePath: path || get().currentScenePath,
    })
    return json
  },

  openScene: (jsonString: string, path?: string) => {
    const { world, commandStack } = get()
    const { name } = SceneSerializer.deserialize(jsonString, world)
    commandStack.clear()
    commandStack.markSaved()
    set({
      sceneName: name || 'Untitled',
      currentScenePath: path || null,
      selectedEntityIds: [],
      isDirty: false,
    })
  },

  setActiveWindow: (windowName: string | null) => {
    set({ activeWindow: windowName })
  },

  setActiveEditorPanel: (panel: 'viewport' | 'blueprint' | 'material' | 'animator' | 'sequencer' | 'godot') => {
    set({ activeEditorPanel: panel })
  },

  setProjectSettings: (settings: Partial<ProjectSettingsState>) => {
    set((state) => ({
      projectSettings: { ...state.projectSettings, ...settings },
    }))
  },

  addProjectTag: (tag: string) => {
    const trimmed = tag.trim()
    if (!trimmed) return
    set((state) => {
      if (state.projectSettings.tags.includes(trimmed)) return state
      return {
        projectSettings: {
          ...state.projectSettings,
          tags: [...state.projectSettings.tags, trimmed],
        },
      }
    })
  },

  removeProjectTag: (tag: string) => {
    const { world } = get()
    // Remove tag from all entities
    for (const ent of world.findByTag(tag)) {
      world.removeTag(ent.id, tag)
    }
    set((state) => ({
      projectSettings: {
        ...state.projectSettings,
        tags: state.projectSettings.tags.filter((t) => t !== tag),
      },
    }))
  },

  setProjectLayers: (layers: string[]) => {
    LayerMask.setLayerNames(layers)
    set((state) => ({
      projectSettings: { ...state.projectSettings, layers: [...layers] },
    }))
  },

  setCollisionMatrixCell: (l1: number, l2: number, collides: boolean) => {
    set((state) => {
      const matrix = state.projectSettings.collisionMatrix.map((row) => [...row])
      if (matrix[l1]) matrix[l1][l2] = collides
      if (matrix[l2]) matrix[l2][l1] = collides
      if (state.physicsBackend) {
        state.physicsBackend.setLayerCollisionMatrix(matrix)
      }
      return {
        projectSettings: { ...state.projectSettings, collisionMatrix: matrix },
      }
    })
  },
}))
