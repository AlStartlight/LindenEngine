[contributors-shield]: https://img.shields.io/github/contributors/AlStartlight/LindenEngine.svg?style=for-the-badge
[contributors-url]: https://github.com/AlStartlight/LindenEngine/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/AlStartlight/LindenEngine.svg?style=for-the-badge
[forks-url]: https://github.com/AlStartlight/LindenEngine/network/members
[stars-shield]: https://img.shields.io/github/stars/AlStartlight/LindenEngine.svg?style=for-the-badge
[stars-url]: https://github.com/AlStartlight/LindenEngine/stargazers
[issues-shield]: https://img.shields.io/github/issues/AlStartlight/LindenEngine.svg?style=for-the-badge
[issues-url]: https://github.com/AlStartlight/LindenEngine/issues
[license-shield]: https://img.shields.io/github/license/AlStartlight/LindenEngine.svg?style=for-the-badge
[license-url]: https://github.com/AlStartlight/LindenEngine/blob/main/LICENSE

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
- **Flow control**: Branch, Loops, Sequences, Gates
- **Math & Logic**: Add, Multiply, Compare, Random
- **Game actions**: Spawn actors, Play sounds, Move objects
- **Variables**: Store and manipulate data visually

**[Learn more about Blueprints →](docs/BLUEPRINT_GUIDE.md)**

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

- ✅ **Desktop**: Windows, macOS, Linux (via Electron)
- ✅ **Web**: Export to HTML5 for browser playback
- 🚧 **Mobile**: Android & iOS support (coming soon)

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
- [Roadmap](#roadmap)
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
git clone https://github.com/AlStartlight/LindenEngine.git
cd LindenEngine
```

### 2. Install Dependencies

```bash
npm install
```

This will install all required packages including:

- React 18 & React DOM
- Three.js (3D rendering)
- Electron (desktop app)
- TypeScript
- Tailwind CSS
- And more...

### 3. Verify Installation

```bash
npm run dev
```

If everything is set up correctly, you should see:

```
  VITE v5.0.8  ready in 423 ms

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

**Pros:**
- Faster hot-reload
- Easier debugging with browser DevTools
- No Electron overhead

#### **Option 2: Desktop Editor** (Full Electron experience)

```bash
npm run electron-dev
```

This will open the editor in a native desktop window.

**Pros:**
- Native window controls
- Better performance
- File system access
- Production-ready experience

---

## Your First Project

Let's create a simple scene with a rotating cube:

### Step 1: Start the Editor

```bash
npm run dev
```

### Step 2: Create an Entity

1. In the **Hierarchy** panel (left side), right-click in empty space
2. Select **"Create Empty"**
3. Name it **"Rotating Cube"**

### Step 3: Add a Mesh Component

1. Select the "Rotating Cube" entity in the Hierarchy
2. In the **Inspector** panel (right side), click **"+ Add Component"**
3. Choose **"Mesh Renderer"**
4. In the Mesh Renderer properties, select **"Cube"** as the mesh type

### Step 4: Add a Blueprint Component

1. Click **"+ Add Component"** again
2. Choose **"📝 Blueprint"**
3. Click **"Edit Blueprint"** button to open the Blueprint Editor

### Step 5: Create Rotation Logic

In the Blueprint Editor:

1. From the **left palette**, drag **"Event Tick"** to the canvas
2. Drag **"Get Actor Location"** and place it to the right
3. Drag **"Rotate"** node and connect it
4. Set rotation values:
   - X: `0`
   - Y: `1` (rotate on Y-axis)
   - Z: `0`
5. Drag **"Set Actor Location"** and connect the execution flow

Your blueprint should look like this:

```
[Event Tick] ──exec──> [Get Transform] ──transform──> [Rotate] ──transform──> [Set Transform]
                                                         ↑
                                                    [Y = 1.0]
```

### Step 6: Test Your Scene

1. Click the **Play** button (▶) in the top toolbar
2. Your cube should now rotate smoothly!
3. Click **Stop** (⏹) to stop playback

**Congratulations! You've created your first interactive scene in Linden Engine!** 🎉

---

## Building for Production

### Build Options

```bash
# Build everything (frontend + desktop app)
npm run build:all

# Build frontend only
npm run build

# Build Electron app only
npm run build:electron

# Create distributable packages
npm run electron-builder
```

### Build Output

After building, you'll find:

| Type | Location | Description |
|------|----------|-------------|
| **Web build** | `dist/` | Static files ready to deploy |
| **Desktop app** | `dist-electron/` | Electron bundles |
| **Installers** | `release/` | Platform-specific installers |

### Deployment

#### Web Deployment

Deploy your game to any static hosting service:

```bash
# Build for web
npm run build

# Deploy to Netlify (example)
npm install -g netlify-cli
netlify deploy --prod --dir=dist

# Or deploy to Vercel
npm install -g vercel
vercel --prod
```

#### Desktop Distribution

Create installers for all platforms:

```bash
# Build installers
npm run electron-builder

# Find installers in: release/
# - LindenEngine-Setup-0.1.0.exe    (Windows)
# - LindenEngine-0.1.0.dmg          (macOS)
# - LindenEngine-0.1.0.AppImage     (Linux)
```

---

## Project Structure

```
LindenEngine/
├── 📂 editor/              # React-based editor UI
│   ├── 📂 ui/             # Toolbar, buttons, modals
│   ├── 📂 viewport/       # 3D viewport component
│   ├── 📂 panels/         # Editor panels
│   │   ├── HierarchyPanel.tsx
│   │   ├── InspectorPanel.tsx
│   │   ├── AssetBrowser.tsx
│   │   ├── BlueprintEditor.tsx
│   │   ├── MaterialEditor.tsx
│   │   ├── AnimatorEditor.tsx
│   │   └── SequencerEditor.tsx
│   └── EditorLayout.tsx   # Main layout component
│
├── 📂 engine/             # Core engine code
│   ├── 📂 core/          # Engine lifecycle & initialization
│   ├── 📂 ecs/           # Entity Component System
│   │   ├── Entity.ts
│   │   ├── Component.ts
│   │   └── World.ts
│   ├── 📂 renderer/      # WebGPU + Three.js renderer
│   ├── 📂 physics/       # Physics engine (Rapier)
│   ├── 📂 scripting/     # Script system & lifecycle
│   ├── 📂 blueprints/    # Blueprint visual scripting
│   │   ├── BlueprintGraph.ts
│   │   ├── BlueprintNode.ts
│   │   └── BlueprintComponent.ts
│   ├── 📂 assets/        # Asset loader & cache
│   └── 📂 utils/         # Utilities & helpers
│
├── 📂 electron/           # Electron main process
│   └── main.ts
│
├── 📂 plugins/            # Plugin system
├── 📂 shared/             # Shared utilities
├── 📂 public/             # Static assets
├── 📂 docs/               # Documentation
│   └── BLUEPRINT_GUIDE.md
│
├── 📄 package.json
├── 📄 tsconfig.json
├── 📄 vite.config.ts
└── 📄 README.md
```

---

## Architecture Overview

### ECS (Entity Component System)

Linden Engine uses an **Entity Component System** architecture for optimal performance and flexibility.

```typescript
// 🎮 Entities = Containers for components
const player = new Entity('Player')

// 📦 Components = Data containers
player.addComponent(new Transform())
player.addComponent(new MeshRenderer('character.gltf'))
player.addComponent(new RigidBody())
player.addComponent(new BlueprintComponent(playerBlueprint))

// ⚙️ Systems = Logic that operates on entities
world.addSystem(new PhysicsSystem())
world.addSystem(new RenderSystem())
world.addSystem(new ScriptSystem())
```

**Benefits of ECS:**
- 🚀 High performance through data-oriented design
- 🔧 Flexible composition over inheritance
- 🎯 Easy to add/remove features at runtime
- 📊 Cache-friendly memory layout

### Engine Lifecycle

```
┌─────────────┐
│ Initialize  │  Load renderer, create world, init systems
└──────┬──────┘
       │
┌──────▼──────┐
│   Start     │  Execute BeginPlay events
└──────┬──────┘
       │
┌──────▼──────┐
│ Update Loop │  ◄───┐
│             │      │
│  - Physics  │      │
│  - Scripts  │      │  60 FPS
│  - Rendering│      │
│  - Input    │      │
└──────┬──────┘      │
       │             │
       └─────────────┘
       │
┌──────▼──────┐
│    Stop     │  Cleanup, save state
└──────┬──────┘
       │
┌──────▼──────┐
│   Dispose   │  Free resources
└─────────────┘
```

### Script Lifecycle

```typescript
export class GameScript implements IGameScript {
  // 🎬 Called once during initialization
  async onInit(context: ScriptContext) {
    console.log('Script initialized')
  }

  // 🔄 Called every frame (~60 FPS)
  onUpdate(deltaTime: number) {
    // Game logic here
  }

  // ⚙️ Called at fixed intervals (for physics)
  onFixedUpdate(deltaTime: number) {
    // Physics calculations here
  }

  // 🧹 Called when script is destroyed
  onDestroy() {
    console.log('Cleanup')
  }

  // 🔥 Hot reload support!
  async onReload(context: ScriptContext) {
    // Reinitialize after code changes
  }
}
```

---

## Blueprint Visual Scripting

Blueprints allow you to create game logic **visually** without writing code. Perfect for designers, artists, and anyone who wants to prototype quickly!

### Getting Started with Blueprints

1. **Select an entity** in the Hierarchy
2. **Add Blueprint Component** from the Inspector
3. **Click "Edit Blueprint"** to open the editor
4. **Drag nodes** from the palette to the canvas
5. **Connect nodes** by dragging from output pins to input pins
6. **Test immediately** by clicking Play

### Available Node Types

| Category | Nodes | Color |
|----------|-------|-------|
| **Events** | BeginPlay, Tick, Input, Collision | 🔴 Red |
| **Flow Control** | Branch, Sequence, Loop, Delay, Gate | 🔵 Blue |
| **Math** | Add, Subtract, Multiply, Divide, Lerp | 🟡 Yellow |
| **Comparison** | Equal, Greater, Less | 🟢 Green |
| **Actions** | Print, Spawn, Destroy, Move, Rotate | 🟣 Purple |
| **Variables** | Get, Set | 🟢 Green |

### Example: Player Movement

```
[Event Tick]
     │ exec
     ▼
[Get Axis Value (Horizontal)]
     │ float
     ▼
[Multiply: Speed]
     │ float
     ▼
[Add Movement Input]
```

**[Full Blueprint Guide →](docs/BLUEPRINT_GUIDE.md)**

---

## Material Editor

Create stunning visuals with our **node-based material editor** — similar to Unreal Engine's Material Editor or Unity's Shader Graph.

### Features

- **PBR Materials**: Albedo, Metallic, Roughness, Normal maps
- **Math Operations**: Add, Multiply, Lerp, Clamp
- **Texture Sampling**: UV mapping, tiling, offset
- **Vertex Manipulation**: Displace, morph, animate
- **Real-time Preview**: See changes instantly

### Example: Animated Water Material

```
[Time] ──> [Sine] ──> [Multiply: 0.1] ──> [Vertex Offset]
                              │
                              ▼
[Base Color] ──> [Lerp] ──> [Output]
                    ▲
                    │
            [Fresnel: Edge Color]
```

---

## Animator System

Create character animations with a **state machine animator** — similar to Unity's Animator or Unreal's Animation Blueprint.

### Features

- **State Machine**: Define animation states and transitions
- **Blend Trees**: Smooth blending between animations
- **Parameters**: Boolean, Float, Integer, Trigger
- **Conditions**: Control transitions with logic
- **Animation Events**: Trigger code at specific frames

### Example: Character States

```
     ┌──────┐
     │ Idle │ ◄─────────────────┐
     └───┬──┘                   │
         │ Speed > 0            │ Speed = 0
         ▼                      │
     ┌──────────┐               │
     │ Running  │ ──────────────┘
     └──────────┘
         │ Jump Trigger
         ▼
     ┌──────────┐
     │ Jumping  │
     └──────────┘
```

---

## Sequencer

Create cinematic sequences and cutscenes with our **timeline-based sequencer** — similar to Unreal's Sequencer or Unity's Timeline.

### Features

- **Timeline Editor**: Drag and arrange keyframes
- **Multiple Tracks**: Transform, Animation, Audio, Events
- **Keyframe Animation**: Animate any property over time
- **Camera Cuts**: Switch between cameras
- **Audio Sync**: Sync animations to music/sound effects

### Example: Opening Cutscene

```
Track 1 (Camera):     [Dolly In] ────────────────> [Pan to Character]
Track 2 (Character):  [Idle] ──> [Wave Animation] ──────────────────>
Track 3 (Audio):      [Music Start] ──────────────> [Fade Out]
Track 4 (Events):     [TriggerDialogue] ────────────> [EndCutscene]
```

---

## Scripting with TypeScript

For advanced users, Linden Engine supports **full TypeScript scripting** with hot-reload and type safety.

### Creating a Custom Script

```typescript
import { IGameScript, ScriptContext } from '@engine/scripting/ScriptSystem'
import { Vector3Utils } from '@engine/utils/index'

export class PlayerController implements IGameScript {
  private speed = 5
  private jumpForce = 10
  private isGrounded = false

  async onInit(context: ScriptContext) {
    console.log('Player initialized!')
  }

  onUpdate(deltaTime: number) {
    const input = this.getInput()
    
    // Calculate movement
    const moveDirection = Vector3Utils.normalize({
      x: input.horizontal,
      y: 0,
      z: input.vertical
    })

    // Apply movement
    const rigidbody = context.entity.getComponent('RigidBody')
    if (rigidbody) {
      rigidbody.velocity = Vector3Utils.multiply(
        moveDirection,
        this.speed
      )
    }

    // Jump
    if (input.jump && this.isGrounded) {
      rigidbody?.applyForce({ x: 0, y: this.jumpForce, z: 0 })
      this.isGrounded = false
    }
  }

  onDestroy() {
    console.log('Player destroyed')
  }

  private getInput() {
    return {
      horizontal: 0,
      vertical: 0,
      jump: false
    }
  }
}
```

### Attaching Scripts to Entities

```typescript
import { Entity } from '@engine/ecs/Entity'
import { PlayerController } from './PlayerController'

const player = new Entity('Player')
player.addComponent(new ScriptComponent(PlayerController))
```

---

## Plugin Development

Extend Linden Engine with custom plugins! Add new components, systems, editors, and more.

### Creating a Plugin

```typescript
import { EnginePlugin } from '@engine/core/Plugin'
import { LindenEngine } from '@engine/core/Engine'

export class MyAwesomePlugin implements EnginePlugin {
  name = 'MyAwesomePlugin'
  version = '1.0.0'

  async onLoad(engine: LindenEngine) {
    console.log('🔌 Plugin loaded!')
    
    // Register custom components
    engine.registerComponent('MyComponent', MyComponent)
    
    // Register custom systems
    engine.registerSystem('MySystem', MySystem)
  }

  async onUnload(engine: LindenEngine) {
    console.log('🔌 Plugin unloaded!')
  }

  registerComponents() {
    return [MyComponent, AnotherComponent]
  }

  registerSystems() {
    return [MySystem]
  }
}
```

### Loading Plugins

```typescript
import { LindenEngine } from '@engine/core/Engine'
import { MyAwesomePlugin } from './plugins/MyAwesomePlugin'

const engine = new LindenEngine()
await engine.loadPlugin(new MyAwesomePlugin())
```

---

## Engine API

### Engine Lifecycle

```typescript
import { LindenEngine } from '@engine/core/Engine'

const engine = new LindenEngine({
  canvas: document.getElementById('viewport'),
  width: 1920,
  height: 1080,
  useWebGPU: true
})

// Initialize engine
await engine.initialize()

// Start game loop
engine.start()

// Pause execution
engine.pause()

// Resume execution
engine.resume()

// Stop engine
engine.stop()

// Cleanup resources
engine.dispose()
```

### Accessing Subsystems

```typescript
// Get the world (contains all entities)
const world = engine.getWorld()

// Get the renderer
const renderer = engine.getRenderer()

// Get performance monitor
const monitor = engine.getPerformanceMonitor()

// Get input system
const input = engine.getInputSystem()
```

---

## Entity & Components

### Creating Entities

```typescript
import { Entity } from '@engine/ecs/Entity'
import { Transform } from '@engine/ecs/Component'

// Create entity
const player = new Entity('Player')

// Get/set transform
const transform = player.getTransform()
transform.position = { x: 0, y: 0, z: 0 }
transform.rotation = { x: 0, y: 90, z: 0 }
transform.scale = { x: 1, y: 1, z: 1 }

// Add to world
world.addEntity(player)
```

### Working with Components

```typescript
// Add component
const meshRenderer = player.addComponent(new MeshRenderer())

// Get component
const rigidbody = player.getComponent('RigidBody')

// Check if component exists
if (player.hasComponent('Collider')) {
  // Do something
}

// Remove component
player.removeComponent('OldComponent')

// Get all components
const allComponents = player.getComponents()
```

### Common Components

| Component | Description |
|-----------|-------------|
| `Transform` | Position, rotation, scale |
| `MeshRenderer` | 3D mesh rendering |
| `Camera` | Camera view and projection |
| `Light` | Directional, point, spot lights |
| `RigidBody` | Physics simulation |
| `Collider` | Collision detection |
| `AudioSource` | 3D positional audio |
| `BlueprintComponent` | Visual scripting |

---

## World & Systems

### Managing the World

```typescript
import { World } from '@engine/ecs/World'

const world = new World()

// Add entity
world.addEntity(entity)

// Get entity by ID
const entity = world.getEntity('entity-id-123')

// Get all entities
const allEntities = world.getEntities()

// Find entities with specific components
const renderables = world.getEntitiesWithComponents('Transform', 'MeshRenderer')

// Remove entity
world.removeEntity('entity-id-123')
```

### Creating Custom Systems

```typescript
import { System } from '@engine/ecs/System'
import { World } from '@engine/ecs/World'

export class RotationSystem extends System {
  name = 'RotationSystem'

  onUpdate(world: World, deltaTime: number) {
    // Get all entities with Transform
    const entities = world.getEntitiesWithComponents('Transform')

    for (const entity of entities) {
      const transform = entity.getComponent('Transform')
      
      // Rotate on Y-axis
      transform.rotation.y += 45 * deltaTime
    }
  }
}

// Register system
world.addSystem(new RotationSystem())
```

---

## Performance Monitoring

Monitor your game's performance in real-time:

```typescript
const monitor = engine.getPerformanceMonitor()

// Get current FPS
const fps = monitor.getFPS()

// Get average FPS
const avgFps = monitor.getAverageFPS()

// Measure specific code
monitor.startMeasure('physics')
// ... physics code here
const elapsed = monitor.endMeasure('physics')

console.log(`Physics took ${elapsed}ms`)

// Print all stats
monitor.printStats()
```

**Output:**

```
Performance Stats:
  FPS: 60.00 (avg: 59.83)
  Frame Time: 16.67ms
  Physics: 2.34ms
  Rendering: 8.12ms
  Scripts: 1.45ms
```

---

## Roadmap

Linden Engine is actively developed. Here's what's coming:

### ✅ Completed (v0.1 Alpha)

- [x] ECS architecture foundation
- [x] WebGPU renderer with Three.js fallback
- [x] Professional editor UI (Hierarchy, Inspector, Viewport)
- [x] Blueprint visual scripting system
- [x] Material node editor
- [x] Animator state machine
- [x] Sequencer timeline editor
- [x] TypeScript scripting with hot-reload
- [x] Electron desktop app

### 🚧 In Progress (v0.2 Beta)

- [ ] Asset import pipeline (GLTF, FBX, OBJ)
- [ ] Physics engine (Rapier integration)
- [ ] Audio system (3D positional audio)
- [ ] Particle system
- [ ] UI Canvas system
- [ ] Input management (keyboard, mouse, gamepad)

### 📋 Planned (v0.3)

- [ ] Terrain system
- [ ] Networking (WebSocket multiplayer)
- [ ] Build export wizard
- [ ] Scene serialization/deserialization
- [ ] Prefab system
- [ ] Undo/Redo system

### 🔮 Future (v1.0+)

- [ ] Mobile support (iOS, Android)
- [ ] Visual shader editor
- [ ] Advanced post-processing effects
- [ ] Lua scripting support
- [ ] Marketplace for assets and plugins
- [ ] Cloud collaboration
- [ ] AI-powered tools

**Want to contribute?** See our [Contributing Guide](#contributing) below!

---

## Contributing

We welcome contributions from everyone! Whether you're fixing bugs, adding features, improving docs, or sharing ideas — your help is appreciated.

### Ways to Contribute

1. **Report bugs** - Open an issue with reproduction steps
2. **Suggest features** - Share your ideas in Discussions
3. **Fix bugs** - Submit a PR with a bug fix
4. **Add features** - Implement new features (check Roadmap first)
5. **Improve docs** - Fix typos, add examples, write guides
6. **Share feedback** - Let us know what you think!

### Development Workflow

1. **Fork the repository**

   Click the "Fork" button on GitHub

2. **Clone your fork**

   ```bash
   git clone https://github.com/YOUR_USERNAME/LindenEngine.git
   cd LindenEngine
   ```

3. **Create a branch**

   ```bash
   git checkout -b feature/my-awesome-feature
   ```

4. **Make your changes**

   - Write clean, documented code
   - Follow existing code style
   - Add tests if applicable
   - Update documentation

5. **Test your changes**

   ```bash
   npm run dev
   npm run build
   ```

6. **Commit your changes**

   ```bash
   git add .
   git commit -m "Add awesome feature"
   ```

7. **Push to your fork**

   ```bash
   git push origin feature/my-awesome-feature
   ```

8. **Create a Pull Request**

   Go to the original repo and click "New Pull Request"

### Code Style Guidelines

- Use **TypeScript** for all new code
- Follow **ESLint** and **Prettier** rules
- Use **meaningful variable names**
- Add **JSDoc comments** for public APIs
- Keep functions **small and focused**
- Write **tests** for new features

### Commit Message Format

```
type(scope): brief description

Longer description if needed...

Fixes #123
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code formatting
- `refactor`: Code restructuring
- `test`: Adding tests
- `chore`: Maintenance tasks

**Example:**

```
feat(blueprints): add delay node

Added a Delay node to the Blueprint editor that pauses
execution for a specified duration.

Closes #45
```

---

## Community

Join our growing community!

- **Discord** - Chat with other developers (coming soon)
- **GitHub Discussions** - Ask questions, share projects
- **Twitter** - Follow for updates (coming soon)
- **YouTube** - Tutorials and devlogs (coming soon)

### Code of Conduct

Be respectful, inclusive, and kind. We're all here to learn and build cool things together!

---

## License

Linden Engine is licensed under the **MIT License**.

You're free to:
- ✅ Use commercially
- ✅ Modify the source code
- ✅ Distribute
- ✅ Use privately

See [LICENSE](LICENSE) file for full details.

---

## Acknowledgments

Linden Engine wouldn't be possible without these amazing open-source projects:

- [Three.js](https://threejs.org/) - 3D rendering library
- [React](https://react.dev/) - UI framework
- [Electron](https://www.electronjs.org/) - Desktop app framework
- [TypeScript](https://www.typescriptlang.org/) - Type-safe JavaScript
- [Vite](https://vitejs.dev/) - Build tool
- [Tailwind CSS](https://tailwindcss.com/) - Styling framework
- [Zustand](https://github.com/pmndrs/zustand) - State management

Special thanks to:
- **Unreal Engine** & **Unity** - For inspiration
- **Three.js community** - For excellent 3D web tools
- **All contributors** - For making this project better!

---

## FAQ

<details>
<summary><strong>Is Linden Engine free?</strong></summary>

Yes! Linden Engine is completely free and open-source under the MIT License. You can use it for personal or commercial projects.

</details>

<details>
<summary><strong>What platforms can I build for?</strong></summary>

Currently:
- Desktop (Windows, macOS, Linux)
- Web (HTML5)

Coming soon:
- Mobile (iOS, Android)

</details>

<details>
<summary><strong>Can I use Linden Engine for commercial games?</strong></summary>

Absolutely! The MIT License allows commercial use without any royalties or fees.

</details>

<details>
<summary><strong>How does it compare to Unity/Unreal?</strong></summary>

**Pros:**
- Lightweight and fast
- Web-first architecture
- Easy to extend with TypeScript
- No installation size bloat

**Cons:**
- Still in alpha (fewer features)
- Smaller ecosystem
- Not as battle-tested

Linden Engine is perfect for:
- Web games
- Prototyping
- Learning game development
- Small to medium projects

</details>

<details>
<summary><strong>Can I contribute even if I'm a beginner?</strong></summary>

Yes! We welcome contributions from developers of all skill levels. Start with:
- Fixing typos in documentation
- Reporting bugs
- Suggesting features
- Sharing your projects

</details>

---

<div align="center">

## 🚀 Ready to Build Something Amazing?

**[Get Started Now](#installation)** | **[Read the Docs](docs/)** | **[Join Discord](#community)**

Made with ❤️ by the Linden Engine community

</div>
