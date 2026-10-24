import { describe, it, expect, beforeEach } from 'vitest'
import {
  generateProjectConfig,
  generateTemplateScene,
  PROJECT_TEMPLATES,
} from '../../editor/project/projectTemplates'
import {
  createNewProject,
  fetchRecentProjects,
  saveRecentProject,
  removeRecentProjectEntry,
  clearRecentProjectsList,
} from '../../editor/project/projectIO'
import { useEditorStore } from '../../editor/store/editorStore'

describe('Project System (Spec §4 & §5.1)', () => {
  beforeEach(async () => {
    // Reset store state
    useEditorStore.getState().closeProject()
    await clearRecentProjectsList()
  })

  it('generates 4 project templates with valid schema', () => {
    expect(PROJECT_TEMPLATES.length).toBe(4)

    const templates = ['empty-3d', 'empty-2d', '2d-platformer', '3d-fps'] as const
    for (const t of templates) {
      const scene = generateTemplateScene(t, 'Main')
      expect(scene.format).toBe('linden-scene')
      expect(scene.version).toBe(2)
      expect(scene.name).toBe('Main')
      expect(Array.isArray(scene.entities)).toBe(true)
      expect(scene.entities.length).toBeGreaterThan(0)
    }
  })

  it('rejects invalid project names with clear error messages', async () => {
    const resEmpty = await createNewProject({
      name: '   ',
      location: '/tmp',
      template: 'empty-3d',
      renderer: 'webgpu',
    })
    expect(resEmpty.status).toBe('error')
    expect(resEmpty.message).toContain('empty')

    const resInvalid = await createNewProject({
      name: 'Game/Invalid:Name?',
      location: '/tmp',
      template: 'empty-3d',
      renderer: 'webgpu',
    })
    expect(resInvalid.status).toBe('error')
    expect(resInvalid.message).toContain('invalid characters')
  })

  it('creates project config with export presets for multi-platform', () => {
    const config = generateProjectConfig('MyAdventure', 'webgpu')
    expect(config.name).toBe('MyAdventure')
    expect(config.exportPresets).toBeDefined()
    expect(config.exportPresets?.length).toBeGreaterThanOrEqual(6)

    const platforms = config.exportPresets?.map((p) => p.platform)
    expect(platforms).toContain('windows')
    expect(platforms).toContain('macos')
    expect(platforms).toContain('linux')
    expect(platforms).toContain('web')
    expect(platforms).toContain('android')
    expect(platforms).toContain('ios')
  })

  it('maintains a maximum of 10 recent projects in LIFO order', async () => {
    for (let i = 1; i <= 15; i++) {
      await saveRecentProject({
        name: `Project ${i}`,
        path: `/path/to/proj_${i}`,
        lastOpened: i * 1000,
        exists: true,
      })
    }

    const recents = await fetchRecentProjects()
    expect(recents.length).toBe(10)
    // Most recent (Project 15) must be first
    expect(recents[0].name).toBe('Project 15')
    expect(recents[9].name).toBe('Project 6')

    // Remove entry
    await removeRecentProjectEntry('/path/to/proj_15')
    const afterRemoval = await fetchRecentProjects()
    expect(afterRemoval.length).toBe(9)
    expect(afterRemoval[0].name).toBe('Project 14')

    // Clear
    await clearRecentProjectsList()
    const cleared = await fetchRecentProjects()
    expect(cleared.length).toBe(0)
  })

  it('updates editor store project state on setProject and closeProject', () => {
    const store = useEditorStore.getState()
    expect(store.isProjectOpen).toBe(false)

    store.setProject('/Users/dev/MyGame', { tags: ['CustomTag'] }, 'MyGame')
    const updated = useEditorStore.getState()
    expect(updated.isProjectOpen).toBe(true)
    expect(updated.projectName).toBe('MyGame')
    expect(updated.projectPath).toBe('/Users/dev/MyGame')
    expect(updated.projectSettings.tags).toContain('CustomTag')

    store.closeProject()
    const closed = useEditorStore.getState()
    expect(closed.isProjectOpen).toBe(false)
    expect(closed.projectPath).toBeNull()
  })
})
