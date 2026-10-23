import { World } from '../ecs/World'
import { SceneSerializer } from './serializer'
import { Services } from '../services/Services'

export interface LoadSceneOptions {
  mode?: 'single' | 'additive'
}

export class SceneManagerClass {
  private currentWorld: World | null = null
  private scenesInBuild: Map<string, string> = new Map() // nameOrPath -> sceneContentJson
  private sceneNamesInBuild: string[] = []
  private activeSceneName: string = 'Untitled'

  setWorld(world: World): void {
    this.currentWorld = world
  }

  setScenesInBuild(scenes: { name: string; path: string; content?: string }[]): void {
    this.scenesInBuild.clear()
    this.sceneNamesInBuild = []
    for (const sc of scenes) {
      this.sceneNamesInBuild.push(sc.name)
      if (sc.content) {
        this.scenesInBuild.set(sc.name, sc.content)
        this.scenesInBuild.set(sc.path, sc.content)
      }
    }
  }

  registerScene(name: string, content: string): void {
    this.scenesInBuild.set(name, content)
    if (!this.sceneNamesInBuild.includes(name)) {
      this.sceneNamesInBuild.push(name)
    }
  }

  getActiveSceneName(): string {
    return this.activeSceneName
  }

  async load(nameOrPath: string, options: LoadSceneOptions = { mode: 'single' }): Promise<void> {
    const content = this.scenesInBuild.get(nameOrPath)
    if (!content) {
      const err = `[SceneManager] Scene "${nameOrPath}" not found in Scenes In Build`
      console.error(err)
      throw new Error(err)
    }

    if (!this.currentWorld) {
      throw new Error('[SceneManager] No active World set')
    }

    if (options.mode === 'single') {
      this.currentWorld.clear()
    }

    const { name } = SceneSerializer.deserialize(content, this.currentWorld)
    this.activeSceneName = name || nameOrPath

    // Services remain alive!
    Services.initializeServices()
  }
}

export const SceneManager = new SceneManagerClass()
