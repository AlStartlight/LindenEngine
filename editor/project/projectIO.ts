import { LindenProjectConfig, RecentProject } from '../../shared/types/project'
import { generateProjectConfig, generateTemplateScene, ProjectTemplateId } from './projectTemplates'
import { invokeIpc } from './ipc'

export interface CreateProjectOptions {
  name: string
  location: string
  template: ProjectTemplateId
  renderer: 'webgpu' | 'webgl'
}

export interface ProjectLoadResult {
  status: 'ok' | 'error' | 'canceled'
  projectPath?: string
  config?: LindenProjectConfig
  initialSceneContent?: string
  initialScenePath?: string
  message?: string
}

const RECENT_KEY = 'linden_recent_projects'
const STARTUP_KEY = 'linden_open_last_project_startup'

const memoryStorage = new Map<string, string>()

function getStorage(key: string): string | null {
  if (typeof localStorage !== 'undefined') {
    try {
      return localStorage.getItem(key)
    } catch {}
  }
  return memoryStorage.get(key) || null
}

function setStorage(key: string, val: string): void {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(key, val)
      return
    } catch {}
  }
  memoryStorage.set(key, val)
}

function removeStorage(key: string): void {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(key)
      return
    } catch {}
  }
  memoryStorage.delete(key)
}

export async function fetchRecentProjects(): Promise<RecentProject[]> {
  if (typeof window !== 'undefined' && (window.electronAPI as any)?.getRecentProjects) {
    try {
      const res = await invokeIpc<any>(() => (window.electronAPI as any).getRecentProjects())
      if (Array.isArray(res)) return res
    } catch {
      // fallback
    }
  }

  try {
    const raw = getStorage(RECENT_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return []
}

export async function saveRecentProject(project: RecentProject): Promise<void> {
  if (typeof window !== 'undefined' && (window.electronAPI as any)?.addRecentProject) {
    try {
      await invokeIpc<any>(() => (window.electronAPI as any).addRecentProject(project))
      return
    } catch {}
  }

  try {
    const list = await fetchRecentProjects()
    const filtered = list.filter((p) => p.path !== project.path)
    const updated = [project, ...filtered].slice(0, 10)
    setStorage(RECENT_KEY, JSON.stringify(updated))
  } catch {}
}

export async function removeRecentProjectEntry(path: string): Promise<void> {
  if (typeof window !== 'undefined' && (window.electronAPI as any)?.removeRecentProject) {
    try {
      await invokeIpc<any>(() => (window.electronAPI as any).removeRecentProject(path))
      return
    } catch {}
  }

  try {
    const list = await fetchRecentProjects()
    const updated = list.filter((p) => p.path !== path)
    setStorage(RECENT_KEY, JSON.stringify(updated))
  } catch {}
}

export async function clearRecentProjectsList(): Promise<void> {
  if (typeof window !== 'undefined' && (window.electronAPI as any)?.clearRecentProjects) {
    try {
      await invokeIpc<any>(() => (window.electronAPI as any).clearRecentProjects())
      return
    } catch {}
  }
  removeStorage(RECENT_KEY)
}

export function getStartupOpenLastSetting(): boolean {
  try {
    return getStorage(STARTUP_KEY) === 'true'
  } catch {
    return false
  }
}

export function setStartupOpenLastSetting(val: boolean): void {
  try {
    setStorage(STARTUP_KEY, val ? 'true' : 'false')
  } catch {}
}

/**
 * Creates a new project in the target directory
 */
export async function createNewProject(opts: CreateProjectOptions): Promise<ProjectLoadResult> {
  const sanitizedName = opts.name.trim()
  if (!sanitizedName) {
    return { status: 'error', message: 'Project name cannot be empty.' }
  }

  const invalidChars = /[\\/:*?"<>|]/
  if (invalidChars.test(sanitizedName)) {
    return {
      status: 'error',
      message: 'Project name contains invalid characters (/ \\ : * ? " < > |).',
    }
  }

  const config = generateProjectConfig(sanitizedName, opts.renderer)
  const initialScene = generateTemplateScene(opts.template, 'Main')
  const initialSceneJson = JSON.stringify(initialScene, null, 2)

  if (typeof window !== 'undefined' && (window.electronAPI as any)?.createProject) {
    try {
      const res = await invokeIpc<any>(() =>
        (window.electronAPI as any).createProject({
          name: sanitizedName,
          location: opts.location,
          config,
          sceneContent: initialSceneJson,
        })
      )
      if (res.status === 'ok') {
        await saveRecentProject({
          name: sanitizedName,
          path: res.projectPath,
          lastOpened: Date.now(),
          exists: true,
        })
        return {
          status: 'ok',
          projectPath: res.projectPath,
          config: res.config || config,
          initialSceneContent: initialSceneJson,
          initialScenePath: `${res.projectPath}/scenes/Main.lscene`,
        }
      }
      return { status: 'error', message: res.message || 'Failed to create project.' }
    } catch (err: any) {
      return { status: 'error', message: err.message || String(err) }
    }
  }

  // Web / fallback mode
  const mockPath = `${opts.location.replace(/\/$/, '')}/${sanitizedName}`
  await saveRecentProject({
    name: sanitizedName,
    path: mockPath,
    lastOpened: Date.now(),
    exists: true,
  })

  return {
    status: 'ok',
    projectPath: mockPath,
    config,
    initialSceneContent: initialSceneJson,
    initialScenePath: `${mockPath}/scenes/Main.lscene`,
  }
}

/**
 * Opens an existing project from directory or project.linden.json
 */
export async function openExistingProject(dirOrJsonPath?: string): Promise<ProjectLoadResult> {
  if (typeof window !== 'undefined' && (window.electronAPI as any)?.openProject) {
    try {
      const res = await invokeIpc<any>(() =>
        (window.electronAPI as any).openProject({ projectPath: dirOrJsonPath })
      )
      if (res.status === 'canceled') return { status: 'canceled' }
      if (res.status === 'ok') {
        await saveRecentProject({
          name: res.config?.name || 'Linden Project',
          path: res.projectPath,
          lastOpened: Date.now(),
          exists: true,
        })
        return {
          status: 'ok',
          projectPath: res.projectPath,
          config: res.config,
          initialSceneContent: res.initialSceneContent,
          initialScenePath: res.initialScenePath,
        }
      }
      return { status: 'error', message: res.message || 'Invalid project format.' }
    } catch (err: any) {
      return { status: 'error', message: err.message || String(err) }
    }
  }

  // Browser mode file picker fallback
  if (typeof document === 'undefined') {
    return { status: 'canceled' }
  }

  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) {
        resolve({ status: 'canceled' })
        return
      }
      try {
        const text = await file.text()
        const parsed = JSON.parse(text)
        if (!parsed.name) {
          resolve({ status: 'error', message: 'File is not a valid project.linden.json' })
          return
        }
        const mockPath = `/projects/${parsed.name}`
        await saveRecentProject({
          name: parsed.name,
          path: mockPath,
          lastOpened: Date.now(),
          exists: true,
        })
        resolve({
          status: 'ok',
          projectPath: mockPath,
          config: parsed,
        })
      } catch (err: any) {
        resolve({ status: 'error', message: `Failed to parse project.linden.json: ${err.message}` })
      }
    }
    input.click()
  })
}
