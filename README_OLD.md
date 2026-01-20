[contributors-shield]: https://img.shields.io/github/contributors/yourusername/LindenEngine.svg?style=for-the-badge
[contributors-url]: https://github.com/yourusername/LindenEngine/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/yourusername/LindenEngine.svg?style=for-the-badge
[forks-url]: https://github.com/yourusername/LindenEngine/network/members
[stars-shield]: https://img.shields.io/github/stars/yourusername/LindenEngine.svg?style=for-the-badge
[stars-url]: https://github.com/yourusername/LindenEngine/stargazers
[issues-shield]: https://img.shields.io/github/issues/yourusername/LindenEngine.svg?style=for-the-badge
[issues-url]: https://github.com/yourusername/LindenEngine/issues
[license-shield]: https://img.shields.io/github/license/yourusername/LindenEngine.svg?style=for-the-badge
[license-url]: https://github.com/yourusername/LindenEngine/blob/main/LICENSE

<div align="center">

# Linden Engine

<p align="center"><strong>A Modern Desktop Game Engine for the Web Era</strong></p>

[![Stargazers][stars-shield]][stars-url] [![Forks][forks-shield]][forks-url]
[![Contributors][contributors-shield]][contributors-url]
[![Issues][issues-shield]][issues-url]
[![MIT License][license-shield]][license-url]

<p align="center">
Build stunning games with visual scripting, real-time 3D rendering, and a professional-grade editor — all powered by modern web technologies.
</p>

</div>

---

## Welcome to Linden Engine

Linden Engine is a **modern desktop game engine** built with ElectronJS, TypeScript, React, and WebGPU. Inspired by industry-leading engines like Unreal Engine and Unity, Linden Engine provides an intuitive visual editor, powerful scripting capabilities, and cross-platform support — all wrapped in a web-first architecture.

Whether you're a solo indie developer, a student learning game development, or a team building the next big hit, Linden Engine gives you the tools to bring your creative vision to life.

With Linden Engine, you can:

- **Create games visually** using Blueprint visual scripting (no coding required!)
- **Build in real-time** with a professional 3D viewport and live editing
- **Script with TypeScript** for advanced gameplay logic with hot-reload support
- **Design materials** with a node-based material editor
- **Animate characters** using a state machine animator
- **Create cinematics** with a timeline-based sequencer
- **Deploy everywhere** — Windows, macOS, Linux, and Web

> **Note:** Linden Engine is currently in **active development** (v0.1 Alpha). Features and APIs may change. We welcome contributions and feedback from the community!

---

## 🎯 Core Features

### Visual Scripting (Blueprints)

Create game logic without writing code using our **Blueprint visual scripting system** — inspired by Unreal Engine's Blueprints.

- **Event-driven**: BeginPlay, Tick, Input events
- **Flow control**: Branch, Loops, Sequences
- **Math & Logic**: Add, Multiply, Compare
- **Game actions**: Spawn actors, Play sounds, Move objects
- **Variables**: Store and manipulate data visually

[Learn more about Blueprints →](docs/BLUEPRINT_GUIDE.md)

### Professional Editor

A complete editing environment with all the tools you need:

- **Scene Viewport**: Real-time 3D rendering with transform gizmos
- **Hierarchy Panel**: Organize entities in a tree structure
- **Inspector Panel**: Edit properties and add components
- **Asset Browser**: Manage textures, models, sounds, and scripts
- **Console**: Debug output and error tracking
- **Material Editor**: Node-based shader authoring
- **Animator**: State machine for character animations
- **Sequencer**: Timeline-based cinematic editing

### Modern Architecture

- **ECS (Entity Component System)**: Scalable and performant game world management
- **WebGPU Rendering**: Next-gen graphics with Three.js fallback
- **TypeScript**: Type-safe scripting with full IDE support
- **Hot Reload**: See changes instantly without restarting
- **Plugin System**: Extend the engine with custom features

### Cross-Platform

Build once, deploy everywhere:

- **Desktop**: Windows, macOS, Linux (via Electron)
- **Web**: Export to HTML5 for browser playback
- **Future**: Mobile support planned

---

## 📚 Table of Contents

<details>
<summary>Getting Started</summary>

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Your First Project](#your-first-project)

</details>

<details>
<summary>Development</summary>

- [Running the Editor](#running-the-editor)
- [Building for Production](#building-for-production)
- [Project Structure](#project-structure)
- [Architecture Overview](#architecture-overview)

</details>

<details>
<summary>Features & Guides</summary>

- [Blueprint Visual Scripting](#blueprint-visual-scripting)
- [Material Editor](#material-editor)
- [Animator System](#animator-system)
- [Sequencer](#sequencer)
- [Scripting with TypeScript](#scripting-with-typescript)
- [Plugin Development](#plugin-development)

</details>

<details>
<summary>API Reference</summary>

- [Engine API](#engine-api)
- [Entity & Components](#entity--components)
- [World & Systems](#world--systems)
- [Scripting API](#scripting-api)

</details>

<details>
<summary>Community & Support</summary>

- [Contributing](#contributing)
- [Community](#community)
- [License](#license)
- [Acknowledgments](#acknowledgments)

</details>

---

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v18 or higher) - [Download here](https://nodejs.org/)
- **npm** (v9 or higher) - Comes with Node.js
- **Git** - [Download here](https://git-scm.com/)
- **Visual Studio Code** (recommended) - [Download here](https://code.visualstudio.com/)

Optional but recommended:

- **TypeScript knowledge** - For advanced scripting
- **Basic 3D concepts** - Understanding of vectors, transforms, etc.

---

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/LindenEngine.git
cd LindenEngine
```

### 2. Install Dependencies

```bash
npm install
```

This will install all required packages including:

- React 18
- Three.js
- Electron
- TypeScript
- Tailwind CSS
- And more...

### 3. Verify Installation

```bash
npm run dev
```

If everything is set up correctly, you should see:

```
  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

Open your browser and navigate to `http://localhost:5173` to see the editor!

---

## Quick Start

### Running the Editor

There are two ways to run Linden Engine:

#### **Option 1: Web-based Editor** (Faster for development)

```bash
npm run dev
```

Then open your browser to `http://localhost:5173`

#### **Option 2: Desktop Editor** (Full Electron experience)

```bash
npm run electron-dev
```

This will open the editor in a native desktop window.

### Your First Project

Let's create a simple scene with a rotating cube:

1. **Start the Editor**
   ```bash
   npm run dev
   ```

2. **Create an Entity**
   - In the Hierarchy panel, right-click and select "Create Empty"
   - Name it "Rotating Cube"

3. **Add a Mesh Component**
   - Select the entity in the Hierarchy
   - In the Inspector, click "Add Component"
   - Choose "Mesh Renderer"
   - Select "Cube" as the mesh

4. **Add a Blueprint Component**
   - Click "Add Component" again
   - Choose "Blueprint"
   - Click "Edit Blueprint" to open the Blueprint Editor

5. **Create Rotation Logic**
   
   In the Blueprint Editor:
   
   - Drag **Event Tick** from the left palette
   - Drag **Get Transform** and connect it
   - Drag **Rotate** and connect it
   - Set rotation values (e.g., X=0, Y=1, Z=0)
   - Connect back to **Set Transform**

6. **Test Your Scene**
   - Click the **Play** button (▶) in the toolbar
   - Your cube should now rotate!

Congratulations! You've created your first interactive scene in Linden Engine! 🎉

---

## 📁 Project Structure

```
LindenEngine/
├── electron/          # Electron main process
├── editor/           # React editor UI components
│   ├── ui/          # Toolbar, buttons, etc
│   ├── viewport/    # 3D viewport
│   └── panels/      # Hierarchy, Inspector, Console
├── engine/          # Core engine code
│   ├── core/        # Engine core & lifecycle
│   ├── ecs/         # Entity Component System
│   ├── renderer/    # WebGPU + Three.js renderer
│   ├── physics/     # Physics engine
│   ├── scripting/   # Script system & lifecycle
│   ├── assets/      # Asset loader & cache
│   └── utils/       # Utilities & helpers
├── plugins/         # Plugin system
├── shared/          # Shared utilities
└── public/          # Static assets
```

## 🧠 Architecture Overview

### ECS (Entity Component System)

```typescript
// Entities = Containers untuk data
const entity = new Entity('Player')

// Components = Data containers
entity.addComponent(new Transform())
entity.addComponent(new MeshRenderer('player.gltf'))
entity.addComponent(new RigidBody())

// Systems = Logika yang operate pada entities
world.addSystem(new PhysicsSystem())
world.addSystem(new RenderSystem())
```

### Engine Lifecycle

```
[Initialize] → [Start] → [Update Loop] → [Stop] → [Dispose]
   ├─ Renderer Init
   ├─ World Init
   ├─ Systems Init
   └─ Scripts Init
```

### Script Lifecycle

```typescript
export class MyGameScript implements IGameScript {
  async onInit(context: ScriptContext) {
    // Called saat initialization
  }

  onUpdate(deltaTime: number) {
    // Called setiap frame
  }

  onFixedUpdate(deltaTime: number) {
    // Called untuk physics updates
  }

  onDestroy() {
    // Called saat cleanup
  }

  async onReload(context: ScriptContext) {
    // Hot reload support
  }
}
```

## 💻 Code Examples

### Membuat Game World

```typescript
import { LindenEngine } from '@engine/core/Engine'
import { Entity } from '@engine/ecs/Entity'
import { Transform } from '@engine/ecs/Component'
import { Camera, Light, MeshRenderer } from '@engine/renderer/Components'

// Initialize engine
const engine = new LindenEngine({
  canvas: document.getElementById('viewport'),
  width: 1920,
  height: 1080,
  useWebGPU: true,
})

await engine.initialize()

// Create scene
const world = engine.getWorld()!

// Create camera
const cameraEntity = new Entity('Main Camera')
const camera = cameraEntity.addComponent(new Camera())
camera.fov = 45
world.addEntity(cameraEntity)

// Create light
const lightEntity = new Entity('Directional Light')
const light = lightEntity.addComponent(new Light())
light.intensity = 1
world.addEntity(lightEntity)

// Start engine
engine.start()
```

### Membuat Custom Script

```typescript
import { IGameScript, ScriptContext } from '@engine/scripting/ScriptSystem'
import { Vector3Utils } from '@engine/utils/index'

export class PlayerController implements IGameScript {
  private speed = 5
  private jumpForce = 10
  private isGrounded = false

  async onInit(context: ScriptContext) {
    console.log('Player initialized')
  }

  onUpdate(deltaTime: number) {
    const input = this.getInput()
    const moveDirection = Vector3Utils.normalize({
      x: input.x,
      y: 0,
      z: input.z,
    })

    const rigidbody = context.entity.getComponent('RigidBody')
    if (rigidbody) {
      rigidbody.velocity = Vector3Utils.multiply(
        moveDirection,
        this.speed * deltaTime
      )
    }

    if (input.jump && this.isGrounded) {
      rigidbody?.applyForce({ x: 0, y: this.jumpForce, z: 0 }, deltaTime)
      this.isGrounded = false
    }
  }

  onDestroy() {
    console.log('Player destroyed')
  }

  private getInput() {
    return {
      x: 0,
      y: 0,
      z: 0,
      jump: false,
    }
  }
}
```

### Using Zustand untuk Global State

```typescript
import { create } from 'zustand'

interface EditorStore {
  selectedEntity: string | null
  isPlaying: boolean
  setSelectedEntity: (id: string | null) => void
  setIsPlaying: (playing: boolean) => void
}

export const useEditorStore = create<EditorStore>((set) => ({
  selectedEntity: null,
  isPlaying: false,
  setSelectedEntity: (id) => set({ selectedEntity: id }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
}))
```

## 🎨 UI Components

### Toolbar
- Play/Pause/Stop controls
- Save/Build buttons
- Settings panel

### Hierarchy Panel
- Expandable entity tree
- Parent-child relationships
- Entity creation/deletion

### Inspector Panel
- Transform editing (position, rotation, scale)
- Component management
- Property editing

### Viewport
- 3D rendering canvas
- Viewport gizmo
- Stats overlay

### Console
- Real-time logging
- Debug output
- Error tracking

## 🔌 Plugin System

```typescript
import { EnginePlugin } from '@engine/core/Plugin'

export class MyPlugin implements EnginePlugin {
  name = 'MyPlugin'
  version = '1.0.0'

  async onLoad(engine: LindenEngine) {
    console.log('Plugin loaded')
  }

  async onUnload(engine: LindenEngine) {
    console.log('Plugin unloaded')
  }

  registerComponents() {
    return [/* custom components */]
  }

  registerSystems() {
    return [/* custom systems */]
  }
}
```

## 🚀 Performance Best Practices

1. **Object Pooling** - Reuse entities untuk menghindari memory allocation
2. **Spatial Partitioning** - Gunakan quadtree/octree untuk collision detection
3. **Level of Detail (LOD)** - Reduce poly count untuk far objects
4. **Batching** - Combine meshes untuk reduce draw calls
5. **Dirty Flags** - Only update transformations ketika berubah
6. **Async Loading** - Load assets asynchronously

## 📊 Performance Monitoring

```typescript
const monitor = engine.getPerformanceMonitor()

monitor.startMeasure('physics')
// ... physics calculations
const elapsed = monitor.endMeasure('physics')

console.log(`Physics took ${elapsed}ms`)
console.log(`Average FPS: ${monitor.getFPS()}`)
monitor.printStats()
```

## 🛣️ Roadmap

### MVP (v0.1) ✅
- [x] ECS foundation
- [x] WebGPU renderer with Three.js fallback
- [x] Basic editor UI
- [x] Electron integration
- [x] Script system

### Phase 2 (v0.2)
- [ ] Asset import system (GLTF/FBX)
- [ ] Visual script editor
- [ ] Animation system
- [ ] Particle system
- [ ] Audio system

### Phase 3 (v0.3)
- [ ] Physics engine (Rapier integration)
- [ ] UI Canvas system
- [ ] Input system polish
- [ ] Networking (WebSocket)
- [ ] Build export (Web, Desktop)

### Phase 4 (v0.4)
- [ ] Multiplayer support
- [ ] Lua scripting
- [ ] WASM support
- [ ] Advanced rendering (BRDF, PBR)
- [ ] Terrain system

### Advanced (v1.0+)
- [ ] Visual shader editor
- [ ] Multiplayer game templates
- [ ] Marketplace
- [ ] Advanced debugging tools
- [ ] Performance profiling

## 📝 API Documentation

### Engine API

```typescript
// Engine lifecycle
engine.initialize(): Promise<boolean>
engine.start(): void
engine.pause(): void
engine.resume(): void
engine.stop(): void
engine.dispose(): void

// Access components
engine.getWorld(): World | null
engine.getRenderer(): Renderer | null
engine.getPerformanceMonitor(): PerformanceMonitor

// Events
engine.on(eventName: string, callback: Function): void
engine.off(eventName: string, callback: Function): void
engine.emit(eventName: string, data?: any): void
```

### Entity API

```typescript
// Component management
entity.addComponent<T>(component: T): T
entity.getComponent<T>(name: string): T | undefined
entity.hasComponent(name: string): boolean
entity.removeComponent(name: string): boolean
entity.getComponents(): Component[]

// Utilities
entity.clone(): Entity
entity.serialize(): Record<string, any>
```

### World API

```typescript
// Entity management
world.addEntity(entity: Entity): Entity
world.getEntity(id: string): Entity | undefined
world.removeEntity(id: string): boolean
world.getEntities(): Entity[]
world.getEntitiesWithComponents(...names: string[]): Entity[]

// System management
world.addSystem(system: System): System
world.getSystem(name: string): System | undefined
world.removeSystem(name: string): boolean

// Lifecycle
world.initialize(): void
world.start(): void
world.stop(): void
world.update(): void
```

## 🐛 Debugging

### Enable Debug Logging

```typescript
import { Logger, LogLevel } from '@engine/utils/index'

Logger.setLevel(LogLevel.DEBUG)
```

### Access Console History

```typescript
const logs = Logger.getHistory(100)
console.log(logs)
```

### Performance Profiling

```typescript
const perf = engine.getPerformanceMonitor()
perf.printStats()
```

## 📄 License

MIT

## 🤝 Contributing

Kontribusi sangat diterima! Please follow:
1. Fork repository
2. Create feature branch
3. Commit changes
4. Push to branch
5. Create Pull Request

## 📞 Support

- Documentation: [docs/](./docs/)
- Issues: GitHub Issues
- Discussions: GitHub Discussions
