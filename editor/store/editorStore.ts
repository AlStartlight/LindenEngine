import { create } from 'zustand'
import { World } from '../../engine/ecs/World'
import { SceneBridge } from '../../engine/scene/SceneBridge'
import { CommandStack, EditorCommand } from '../commands/CommandStack'
import { SceneSerializer } from '../../engine/scene/serializer'
import { Physics } from '../../engine/physics/components'
import { RapierBackend } from '../../engine/physics/RapierBackend'
import { Input, InputActionDef, TouchConfig } from '../../engine/input/InputActions'
import { cloneDefaultActions, cloneDefaultTouch } from '../../engine/input/defaultInput'
import { normalizeInputActions, normalizeTouchConfig } from '../../engine/input/normalizeActions'
import { Tween } from '../../engine/time/Tween'
import { LayerMask } from '../../engine/scene/LayerMask'
import { ExportPreset, RecentProject } from '../../shared/types/project'
import { getSceneNameFromPath } from '../ui/windowTitle'
import type { PlayStartResult } from '../../shared/playProtocol'

export interface ProjectSettingsState {
  tags: string[]
  layers: string[]
  collisionMatrix: boolean[][]
  inputActions: InputActionDef[]
  touch: TouchConfig
  services: any[]
  scenesInBuild: string[]
}

export interface PlaySessionInfo {
  id: string
  url: string
  mode: 'scene' | 'html'
}

function formatPlayErrors(errors: PlayStartResult['errors']): string {
  return (errors ?? [])
    .map((e) => `${e.file ? `${e.file}${e.line ? `:${e.line}${e.col ? `:${e.col}` : ''}` : ''}: ` : ''}${e.message}`)
    .join('\n')
}

export interface EditorState {
  world: World
  bridge: SceneBridge
  commandStack: CommandStack
  selectedEntityIds: string[]
  playState: 'stopped' | 'playing' | 'paused'
  playSnapshot: string | null
  /** Set while Play runs in the viewport Game Frame (linden-game:// iframe); null for legacy in-editor play */
  playSession: PlaySessionInfo | null
  /** Bumped by Step while a Game Frame is running; GameFrame forwards it to the game */
  playStepNonce: number
  /** From project.linden.json "runtime": 'html' projects run their own index.html */
  projectRuntime: 'scene' | 'html'
  sceneName: string
  currentScenePath: string | null
  isDirty: boolean
  activeWindow: string | null
  activeEditorPanel: 'viewport' | 'bridge' | 'godot'
  projectSettings: ProjectSettingsState
  physicsBackend: RapierBackend | null

  // Project state
  projectPath: string | null
  projectName: string
  isProjectOpen: boolean
  exportPresets: ExportPreset[]
  recentProjects: RecentProject[]
  openLastProjectOnStartup: boolean

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
  newScene: (name?: string) => void
  saveScene: (path?: string, name?: string) => string
  openScene: (jsonString: string, path?: string) => void
  /** Load a scene the agent wrote to disk as one undoable step; false if not applied (playing) */
  applyAgentSceneChange: (jsonString: string) => boolean
  setActiveWindow: (windowName: string | null) => void
  setActiveEditorPanel: (panel: 'viewport' | 'bridge' | 'godot') => void
  setProjectSettings: (settings: Partial<ProjectSettingsState>) => void
  /** Apply Input Actions / touch layout and persist them to project.linden.json (input.*) */
  saveInputSettings: (actions: InputActionDef[], touch: TouchConfig) => Promise<'saved' | 'memory-only' | 'error'>
  /** Result of normalizing input.touch when the project was opened (v1 -> v2 migration, problems) */
  touchLoadReport: { migrated: number; warnings: string[] } | null
  addProjectTag: (tag: string) => void
  removeProjectTag: (tag: string) => void
  setProjectLayers: (layers: string[]) => void
  setCollisionMatrixCell: (layer1: number, layer2: number, collides: boolean) => void

  // Project Actions
  setProject: (
    path: string | null,
    settings?: Partial<ProjectSettingsState>,
    name?: string,
    presets?: ExportPreset[]
  ) => void
  closeProject: () => void
  setRecentProjects: (projects: RecentProject[]) => void
  addRecentProject: (project: RecentProject) => void
  removeRecentProject: (path: string) => void
  clearRecentProjects: () => void
  setExportPresets: (presets: ExportPreset[]) => void
  addExportPreset: (preset: ExportPreset) => void
  updateExportPreset: (preset: ExportPreset) => void
  removeExportPreset: (id: string) => void
  setOpenLastProjectOnStartup: (value: boolean) => void
}

const initialWorld = new World()
const initialBridge = new SceneBridge(initialWorld)
const initialCommandStack = new CommandStack(initialWorld)

export const defaultExportPresets: ExportPreset[] = [
  {
    id: 'preset-windows-desktop',
    name: 'Windows Desktop',
    platform: 'windows',
    backend: 'linden',
    arch: ['x64'],
    output: 'build/windows/LindenProject.exe',
    mode: 'release',
  },
  {
    id: 'preset-macos-desktop',
    name: 'macOS',
    platform: 'macos',
    backend: 'linden',
    arch: ['universal'],
    output: 'build/mac/LindenProject.dmg',
    mode: 'release',
  },
  {
    id: 'preset-linux-desktop',
    name: 'Linux',
    platform: 'linux',
    backend: 'linden',
    arch: ['x64'],
    output: 'build/linux/LindenProject.AppImage',
    mode: 'release',
  },
  {
    id: 'preset-web-html5',
    name: 'Web',
    platform: 'web',
    backend: 'linden',
    arch: ['wasm'],
    output: 'build/web/index.html',
    mode: 'release',
  },
  {
    id: 'preset-android',
    name: 'Android',
    platform: 'android',
    backend: 'godot',
    arch: ['arm64'],
    output: 'build/android/LindenProject.apk',
    mode: 'debug',
  },
  {
    id: 'preset-ios',
    name: 'iOS',
    platform: 'ios',
    backend: 'godot',
    arch: ['arm64'],
    output: 'build/ios/LindenProject.ipa',
    mode: 'debug',
  },
]

export const useEditorStore = create<EditorState>((set, get) => ({
  world: initialWorld,
  bridge: initialBridge,
  commandStack: initialCommandStack,
  selectedEntityIds: [],
  playState: 'stopped',
  playSnapshot: null,
  playSession: null,
  playStepNonce: 0,
  projectRuntime: 'scene',
  sceneName: 'Untitled',
  currentScenePath: null,
  isDirty: false,
  activeWindow: null,
  activeEditorPanel: 'viewport',
  physicsBackend: null,

  // Project state
  projectPath: null,
  projectName: 'Untitled Project',
  isProjectOpen: false,
  exportPresets: defaultExportPresets,
  recentProjects: [],
  openLastProjectOnStartup: false,
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
    inputActions: cloneDefaultActions(),
    touch: cloneDefaultTouch(),
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
    const { world, projectSettings, projectPath } = get()

    // Run in the sandboxed Game Frame (same LindenPlayer as the web build) when a project is open
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined
    if (projectPath && api?.playStart) {
      const res = await api.playStart({ projectPath })
      if (res.status !== 'ok' || !res.sessionId || !res.url) {
        const details = formatPlayErrors(res.errors)
        throw new Error(`${res.message || 'Play gagal dimulai'}${details ? `\n${details}` : ''}`)
      }
      set({
        playState: 'playing',
        playSnapshot: null,
        playSession: { id: res.sessionId, url: res.url, mode: res.mode ?? 'scene' },
      })
      return
    }

    // Legacy in-editor simulation (no project folder, e.g. browser-only editor)
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
    if (get().playSession) {
      set((state) => ({ playStepNonce: state.playStepNonce + 1 }))
      return
    }
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
    const { playSession } = get()
    if (playSession) {
      // The editor world was never touched: the game ran in its own frame
      window.electronAPI?.playStop?.(playSession.id)
      set({ playState: 'stopped', playSession: null, playSnapshot: null })
      return
    }
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

  newScene: (name?: string) => {
    const { world, commandStack } = get()
    world.clear()
    commandStack.clear()
    set({
      sceneName: name || 'Untitled',
      currentScenePath: null,
      selectedEntityIds: [],
      isDirty: false,
    })
  },

  saveScene: (path?: string, name?: string) => {
    const { world, commandStack } = get()
    const finalName = name || (path ? getSceneNameFromPath(path) : get().sceneName)
    const json = SceneSerializer.serialize(world, finalName)
    commandStack.markSaved()
    set({
      sceneName: finalName,
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
    const finalName = path ? getSceneNameFromPath(path) : (name || 'Untitled')
    set({
      sceneName: finalName,
      currentScenePath: path || null,
      selectedEntityIds: [],
      isDirty: false,
    })
  },

  applyAgentSceneChange: (jsonString: string) => {
    const { world, commandStack, playState, sceneName } = get()
    if (playState !== 'stopped') return false
    const before = SceneSerializer.serialize(world, sceneName)
    commandStack.execute({
      label: 'Perubahan Agent',
      do: (w) => {
        SceneSerializer.deserialize(jsonString, w)
      },
      undo: (w) => {
        SceneSerializer.deserialize(before, w)
      },
    })
    // The new content is what is on disk; undoing it makes the scene dirty again
    commandStack.markSaved()
    set({ selectedEntityIds: [], isDirty: false })
    return true
  },

  setActiveWindow: (windowName: string | null) => {
    set({ activeWindow: windowName })
  },

  setActiveEditorPanel: (panel: 'viewport' | 'bridge' | 'godot') => {
    const normalized = (panel as string) === 'godot' ? 'bridge' : panel
    set({ activeEditorPanel: normalized as any })
  },

  touchLoadReport: null,

  saveInputSettings: async (actions, touch) => {
    const touchResult = normalizeTouchConfig(touch, normalizeInputActions(actions).actions)
    const normalized = touchResult.actions
    const layout = touchResult.config
    set((state) => ({ projectSettings: { ...state.projectSettings, inputActions: normalized, touch: layout } }))
    Input.loadActions(normalized)
    const { projectPath } = get()
    const save = typeof window !== 'undefined' ? window.electronAPI?.saveProjectInput : undefined
    if (!projectPath || !save) return 'memory-only'
    try {
      const res = await save({ projectPath, input: { actions: normalized, touch: layout } })
      return res?.status === 'ok' ? 'saved' : 'error'
    } catch {
      return 'error'
    }
  },

  setProjectSettings: (settings: Partial<ProjectSettingsState>) => {
    set((state) => ({
      projectSettings: { ...state.projectSettings, ...settings },
    }))
  },

  setProject: (
    path: string | null,
    settings?: Partial<ProjectSettingsState>,
    name?: string,
    presets?: ExportPreset[]
  ) => {
    // input.touch v1 buttons get connected to their actions here (bindings move onto the buttons)
    const rawInput = (settings as any)?.input
    const loaded = settings
      ? normalizeTouchConfig(rawInput?.touch ?? (settings as any).touch, normalizeInputActions(rawInput?.actions ?? (settings as any).inputActions).actions)
      : null
    set((state) => {
      const pName =
        name ||
        (path ? path.split(/[\/\\]/).filter(Boolean).pop() : undefined) ||
        'Linden Project'
      return {
        projectPath: path,
        projectName: pName,
        isProjectOpen: Boolean(path),
        projectRuntime: (settings as any)?.runtime === 'html' ? 'html' : 'scene',
        projectSettings: settings
          ? {
              ...state.projectSettings,
              ...settings,
              // project.linden.json keeps them under input.{actions,touch}; the editor works on normalized copies
              inputActions: loaded!.actions,
              touch: loaded!.config,
            }
          : state.projectSettings,
        touchLoadReport: loaded ? { migrated: loaded.migrated, warnings: loaded.warnings } : null,
        exportPresets: presets && presets.length > 0 ? presets : state.exportPresets,
      }
    })
  },

  closeProject: () => {
    const { world, commandStack } = get()
    world.clear()
    commandStack.clear()
    set({
      projectPath: null,
      projectName: 'Untitled Project',
      isProjectOpen: false,
      projectRuntime: 'scene',
      sceneName: 'Untitled',
      currentScenePath: null,
      selectedEntityIds: [],
      isDirty: false,
    })
  },

  setRecentProjects: (projects: RecentProject[]) => {
    set({ recentProjects: projects.slice(0, 10) })
  },

  addRecentProject: (project: RecentProject) => {
    set((state) => {
      const filtered = state.recentProjects.filter((p) => p.path !== project.path)
      return {
        recentProjects: [project, ...filtered].slice(0, 10),
      }
    })
  },

  removeRecentProject: (path: string) => {
    set((state) => ({
      recentProjects: state.recentProjects.filter((p) => p.path !== path),
    }))
  },

  clearRecentProjects: () => {
    set({ recentProjects: [] })
  },

  setExportPresets: (presets: ExportPreset[]) => {
    set({ exportPresets: presets })
  },

  addExportPreset: (preset: ExportPreset) => {
    set((state) => ({
      exportPresets: [...state.exportPresets, preset],
    }))
  },

  updateExportPreset: (preset: ExportPreset) => {
    set((state) => ({
      exportPresets: state.exportPresets.map((p) => (p.id === preset.id ? preset : p)),
    }))
  },

  removeExportPreset: (id: string) => {
    set((state) => ({
      exportPresets: state.exportPresets.filter((p) => p.id !== id),
    }))
  },

  setOpenLastProjectOnStartup: (value: boolean) => {
    set({ openLastProjectOnStartup: value })
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
