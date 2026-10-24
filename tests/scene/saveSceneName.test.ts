import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useEditorStore } from '../../editor/store/editorStore'
import { SceneSerializer } from '../../engine/scene/serializer'
import { World } from '../../engine/ecs/World'
import { pickSceneSavePath, writeSceneFile } from '../../editor/io/sceneIO'
import { getSceneNameFromPath } from '../../editor/ui/windowTitle'

describe('Scene Name Store and Save Flow', () => {
  beforeEach(() => {
    useEditorStore.getState().closeProject()
  })

  describe('Store: newScene', () => {
    it('sets sceneName to provided name and resets scene state', () => {
      const store = useEditorStore.getState()
      store.newScene('Isac')

      const state = useEditorStore.getState()
      expect(state.sceneName).toBe('Isac')
      expect(state.currentScenePath).toBeNull()
      expect(state.isDirty).toBe(false)
    })

    it('defaults sceneName to "Untitled" when no name is provided', () => {
      const store = useEditorStore.getState()
      store.newScene()

      const state = useEditorStore.getState()
      expect(state.sceneName).toBe('Untitled')
      expect(state.currentScenePath).toBeNull()
      expect(state.isDirty).toBe(false)
    })
  })

  describe('Store: saveScene', () => {
    it('updates sceneName and currentScenePath and marks clean', () => {
      const store = useEditorStore.getState()
      store.newScene('Isac')
      const json = store.saveScene('/p/scenes/Level2.lscene', 'Level2')

      const state = useEditorStore.getState()
      expect(state.sceneName).toBe('Level2')
      expect(state.currentScenePath).toBe('/p/scenes/Level2.lscene')
      expect(state.isDirty).toBe(false)

      const parsed = JSON.parse(json)
      expect(parsed.name).toBe('Level2')
    })

    it('derives sceneName from path if name is not explicitly passed', () => {
      const store = useEditorStore.getState()
      store.newScene('Temp')
      const json = store.saveScene('/p/scenes/ForestZone.lscene')

      const state = useEditorStore.getState()
      expect(state.sceneName).toBe('ForestZone')
      expect(state.currentScenePath).toBe('/p/scenes/ForestZone.lscene')
      expect(state.isDirty).toBe(false)

      const parsed = JSON.parse(json)
      expect(parsed.name).toBe('ForestZone')
    })
  })

  describe('Store: openScene', () => {
    it('derives sceneName from file path even if internal JSON name differs', () => {
      const world = new World()
      world.createEntity('SampleEntity')
      const json = SceneSerializer.serialize(world, 'OldInternalName')

      const store = useEditorStore.getState()
      store.openScene(json, '/projects/MyGame/scenes/Isac.lscene')

      const state = useEditorStore.getState()
      expect(state.sceneName).toBe('Isac')
      expect(state.currentScenePath).toBe('/projects/MyGame/scenes/Isac.lscene')
      expect(state.isDirty).toBe(false)
    })

    it('falls back to JSON name when path is not provided (browser mode)', () => {
      const world = new World()
      const json = SceneSerializer.serialize(world, 'BrowserScene')

      const store = useEditorStore.getState()
      store.openScene(json, undefined)

      const state = useEditorStore.getState()
      expect(state.sceneName).toBe('BrowserScene')
      expect(state.currentScenePath).toBeNull()
      expect(state.isDirty).toBe(false)
    })
  })

  describe('Save Flow with Mocked electronAPI', () => {
    const originalWindow = globalThis.window

    afterEach(() => {
      globalThis.window = originalWindow
    })

    it('serializes content using the chosen file basename', async () => {
      const mockPick = vi.fn().mockResolvedValue({
        status: 'ok',
        path: '/projects/MyGame/scenes/Isac.lscene',
      })
      const mockWrite = vi.fn().mockResolvedValue({ status: 'ok' })

      // @ts-ignore
      globalThis.window = {
        electronAPI: {
          pickSceneSavePath: mockPick,
          writeSceneFile: mockWrite,
        },
      } as any

      const world = new World()
      world.createEntity('Player')

      // Step 1: Pick path
      const pickRes = await pickSceneSavePath('/projects/MyGame/scenes/Untitled.lscene')
      expect(pickRes.status).toBe('ok')
      expect(pickRes.path).toBe('/projects/MyGame/scenes/Isac.lscene')

      // Step 2: Extract name & serialize
      const finalName = getSceneNameFromPath(pickRes.path!)
      expect(finalName).toBe('Isac')
      const content = SceneSerializer.serialize(world, finalName)

      // Step 3: Write
      const writeRes = await writeSceneFile(pickRes.path!, content)
      expect(writeRes.status).toBe('ok')
      expect(mockWrite).toHaveBeenCalledWith({
        path: '/projects/MyGame/scenes/Isac.lscene',
        content,
      })

      // Verify serialized JSON contains "name": "Isac"
      const parsed = JSON.parse(content)
      expect(parsed.name).toBe('Isac')
    })

    it('cancels gracefully without writing when user cancels save dialog', async () => {
      const mockPick = vi.fn().mockResolvedValue({ status: 'canceled' })
      const mockWrite = vi.fn()

      // @ts-ignore
      globalThis.window = {
        electronAPI: {
          pickSceneSavePath: mockPick,
          writeSceneFile: mockWrite,
        },
      } as any

      const pickRes = await pickSceneSavePath('/projects/MyGame/scenes/NewScene.lscene')
      expect(pickRes.status).toBe('canceled')
      expect(mockWrite).not.toHaveBeenCalled()
    })
  })
})
