# Plugin Development Guide

## 🔌 Plugin Architecture

Linden Engine memiliki sistem plugin yang powerful untuk extending engine dengan custom functionality.

## Plugin Interface

```typescript
export interface EnginePlugin {
  name: string
  version: string

  onLoad(engine: LindenEngine): Promise<void>
  onUnload(engine: LindenEngine): Promise<void>
  
  registerComponents?(): typeof Component[]
  registerSystems?(): typeof System[]
  registerEditorTools?(): EditorTool[]
}
```

## Creating Your First Plugin

### 1. Basic Plugin Structure

```typescript
// plugins/my-plugin/src/index.ts
import { EnginePlugin, Component, System } from '@engine/core/Plugin'
import { LindenEngine } from '@engine/core/Engine'

export class MyPlugin implements EnginePlugin {
  name = 'My Plugin'
  version = '1.0.0'

  async onLoad(engine: LindenEngine): Promise<void> {
    console.log(`Loaded ${this.name} v${this.version}`)
    // Initialize plugin
  }

  async onUnload(engine: LindenEngine): Promise<void> {
    console.log(`Unloaded ${this.name}`)
    // Cleanup
  }

  registerComponents() {
    return [CustomComponent1, CustomComponent2]
  }

  registerSystems() {
    return [CustomSystem1]
  }
}

export default MyPlugin
```

### 2. Custom Component

```typescript
// plugins/my-plugin/src/CustomComponent.ts
import { Component } from '@engine/ecs/Component'

export class CustomComponent extends Component {
  customProperty: string = 'default'

  constructor() {
    super('CustomComponent')
  }

  onUpdate(deltaTime: number): void {
    // Custom logic
  }

  clone(): CustomComponent {
    return new CustomComponent()
  }
}
```

### 3. Custom System

```typescript
// plugins/my-plugin/src/CustomSystem.ts
import { System } from '@engine/ecs/World'

export class CustomSystem extends System {
  constructor() {
    super('CustomSystem')
  }

  initialize(): void {
    console.log('CustomSystem initialized')
  }

  update(deltaTime: number): void {
    const entities = this.getEntitiesWithComponents('CustomComponent')
    for (const entity of entities) {
      // Process entities with CustomComponent
    }
  }

  shutdown(): void {
    console.log('CustomSystem shutdown')
  }
}
```

## Plugin Configuration

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "main": "dist/index.js",
  "entry": "src/index.ts",
  "engine": "0.1.0",
  "components": ["CustomComponent"],
  "systems": ["CustomSystem"]
}
```

## Loading Plugins

### Programmatic Loading

```typescript
import { LindenEngine } from '@engine/core/Engine'
import MyPlugin from '@plugins/my-plugin'

const engine = new LindenEngine({ canvas })
await engine.initialize()

// Load plugin
const plugin = new MyPlugin()
await engine.loadPlugin(plugin)
```

### From Directory

```typescript
// Load all plugins from directory
await engine.loadPluginsFromDirectory('./plugins')
```

### Configuration File

```yaml
# engine.config.yaml
plugins:
  - name: physics
    enabled: true
    config:
      gravity: 9.81
  
  - name: my-custom-plugin
    enabled: true
    path: ./plugins/my-plugin
```

## Hot Reload

```typescript
class HotReloadManager {
  watchPlugin(pluginPath: string): void {
    fs.watch(pluginPath, async (eventType, filename) => {
      if (eventType === 'change' && filename.endsWith('.ts')) {
        console.log(`Reloading ${pluginPath}...`)
        await this.reloadPlugin(pluginPath)
      }
    })
  }

  async reloadPlugin(pluginPath: string): Promise<void> {
    // Unload old plugin
    await this.engine.unloadPlugin(pluginName)

    // Clear require cache
    delete require.cache[require.resolve(pluginPath)]

    // Load new plugin
    const newPlugin = require(pluginPath).default
    await this.engine.loadPlugin(new newPlugin())
  }
}
```

## Example Plugins

### 1. Physics Plugin

```typescript
export class PhysicsPlugin implements EnginePlugin {
  name = 'Physics'
  version = '1.0.0'

  async onLoad(engine: LindenEngine) {
    console.log('Physics plugin loaded')
  }

  registerComponents() {
    return [RigidBody, Collider, Joint]
  }

  registerSystems() {
    return [PhysicsSystem, CollisionSystem]
  }
}
```

### 2. Audio Plugin

```typescript
export class AudioPlugin implements EnginePlugin {
  name = 'Audio'
  version = '1.0.0'
  private audioContext: AudioContext

  async onLoad(engine: LindenEngine) {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
  }

  registerComponents() {
    return [AudioSource, AudioListener]
  }

  registerSystems() {
    return [AudioSystem]
  }

  getAudioContext() {
    return this.audioContext
  }
}
```

### 3. Particle System Plugin

```typescript
export class ParticlePlugin implements EnginePlugin {
  name = 'Particle System'
  version = '1.0.0'

  registerComponents() {
    return [ParticleSystem, ParticleEmitter]
  }

  registerSystems() {
    return [ParticleUpdateSystem, ParticleRenderSystem]
  }
}
```

## Building Plugins

### Build Script

```json
{
  "scripts": {
    "build:plugin": "tsc && vite build",
    "dev:plugin": "vite build --watch"
  }
}
```

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

## Publishing Plugins

### 1. NPM Registry

```bash
npm publish
```

### 2. Plugin Marketplace

- Create account on Linden Engine Marketplace
- Upload plugin with metadata
- Get discovered by other developers

### 3. GitHub Releases

```bash
# Tag and release
git tag v1.0.0
git push origin v1.0.0
```

## Best Practices

### 1. Versioning

```typescript
// Declare engine compatibility
export class MyPlugin implements EnginePlugin {
  engineVersion = '^0.1.0'
  name = 'My Plugin'
  version = '1.0.0'

  async onLoad(engine: LindenEngine) {
    const engineVersion = engine.getVersion()
    if (!this.isCompatible(engineVersion)) {
      throw new Error('Plugin not compatible with this engine version')
    }
  }

  private isCompatible(version: string): boolean {
    // Version compatibility check
    return true
  }
}
```

### 2. Error Handling

```typescript
async onLoad(engine: LindenEngine): Promise<void> {
  try {
    // Load resources
    this.resources = await this.loadResources()
  } catch (error) {
    console.error(`Failed to load ${this.name}`, error)
    throw new PluginLoadError(this.name, error)
  }
}
```

### 3. Lifecycle Management

```typescript
async onLoad(engine: LindenEngine): Promise<void> {
  this.engine = engine
  this.world = engine.getWorld()

  // Register listeners
  this.engine.on('stateChanged', this.onEngineStateChange)
  this.engine.on('resize', this.onWindowResize)
}

async onUnload(engine: LindenEngine): Promise<void> {
  // Remove listeners
  this.engine.off('stateChanged', this.onEngineStateChange)
  this.engine.off('resize', this.onWindowResize)

  // Cleanup resources
  await this.cleanup()
}
```

## Performance Considerations

### 1. Lazy Loading

```typescript
class LazyPlugin implements EnginePlugin {
  private loaded = false

  async onLoad(engine: LindenEngine) {
    // Don't load everything immediately
  }

  async ensureLoaded() {
    if (!this.loaded) {
      await this.loadResources()
      this.loaded = true
    }
  }
}
```

### 2. Resource Management

```typescript
class MemoryAwarePlugin implements EnginePlugin {
  private maxMemory = 100 * 1024 * 1024 // 100MB

  private monitorMemory() {
    setInterval(() => {
      const used = performance.memory?.usedJSHeapSize || 0
      if (used > this.maxMemory) {
        this.cleanup()
      }
    }, 1000)
  }
}
```

## Debugging Plugins

### Logging

```typescript
class LoggingPlugin implements EnginePlugin {
  async onLoad(engine: LindenEngine) {
    Logger.info(`${this.name} loaded`)
  }

  update() {
    Logger.debug(`${this.name} update called`)
  }
}
```

### Performance Profiling

```typescript
class ProfilingPlugin implements EnginePlugin {
  private monitor = new PerformanceMonitor()

  async onLoad(engine: LindenEngine) {
    this.monitor.start()
  }

  shutdown() {
    this.monitor.printStats()
  }
}
```

## Checklist untuk Plugin Development

- [ ] Follow plugin interface
- [ ] Implement onLoad and onUnload
- [ ] Add error handling
- [ ] Document plugin configuration
- [ ] Add TypeScript definitions
- [ ] Test hot reload
- [ ] Performance profiling
- [ ] Memory leak testing
- [ ] Write documentation
- [ ] Add examples
- [ ] Version compatibility
- [ ] Test on all platforms
