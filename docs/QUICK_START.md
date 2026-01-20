# Quick Start Guide

## Installation & Setup

### Prerequisites
- Node.js 16+ 
- npm atau yarn
- Git

### Installation

```bash
# Clone atau navigate ke project
cd LindenEngine

# Install dependencies
npm install

# Start development server
npm run electron-dev
```

Setelah beberapa saat, Electron window akan terbuka dengan Linden Engine editor.

## Project Tour

### 1. File Structure Overview

```
LindenEngine/
├── electron/                 # Electron main process
│   ├── main.ts              # App window setup & menu
│   ├── preload.ts           # API exposure to renderer
│   └── util.ts              # Helper functions
│
├── engine/                   # Core engine
│   ├── core/                # Engine lifecycle & initialization
│   │   └── Engine.ts        # LindenEngine class
│   ├── ecs/                 # Entity Component System
│   │   ├── Component.ts     # Base component & built-ins
│   │   ├── Entity.ts        # Entity class
│   │   └── World.ts         # World, System classes
│   ├── renderer/            # Rendering system
│   │   ├── Renderer.ts      # WebGPU & Three.js abstraction
│   │   └── Components.ts    # Camera, Light, MeshRenderer, etc
│   ├── physics/             # Physics simulation
│   ├── scripting/           # Script system & lifecycle
│   │   └── ScriptSystem.ts  # IGameScript, hot-reload
│   ├── assets/              # Asset loading & caching
│   └── utils/               # Utilities & helpers
│
├── editor/                   # React editor UI
│   ├── EditorLayout.tsx     # Main editor layout
│   ├── viewport/            # 3D viewport
│   │   └── Viewport.tsx     # Canvas & gizmos
│   ├── panels/              # Editor panels
│   │   ├── HierarchyPanel.tsx    # Scene hierarchy
│   │   ├── InspectorPanel.tsx    # Entity properties
│   │   ├── AssetBrowser.tsx      # Asset management
│   │   └── ConsolePanel.tsx      # Debug console
│   └── ui/                  # UI components
│       └── Toolbar.tsx      # Play/Pause/Stop buttons
│
├── src/                      # React app entry point
│   ├── App.tsx              # Main app component
│   └── App.css              # App styles
│
├── docs/                     # Documentation
│   ├── ARCHITECTURE.md      # System design & diagrams
│   ├── API.md               # Complete API reference
│   ├── BEST_PRACTICES.md    # Performance & patterns
│   └── PLUGIN_DEVELOPMENT.md # Plugin creation guide
│
├── index.html               # HTML entry point
├── package.json             # Dependencies
├── tsconfig.json            # TypeScript config
├── vite.config.ts           # Vite config
├── tailwind.config.js       # Tailwind CSS config
└── README.md                # Project overview
```

## Next Steps

### 1. Membuat First Game Object

```typescript
// Create scene
const world = engine.getWorld()!

// Create player
const player = new Entity('Player')
player.addComponent(new Transform())
player.addComponent(new MeshRenderer('player.gltf'))
player.addComponent(new RigidBody())
world.addEntity(player)

// Lihat di editor!
```

### 2. Membuat Custom Script

```typescript
// 1. Create file: scripts/PlayerController.ts
export default class PlayerController implements IGameScript {
  async onInit(context) {
    console.log('Player ready!')
  }

  onUpdate(deltaTime) {
    // Gameplay logic
  }
}

// 2. Attach ke entity
const scriptComponent = player.addComponent(
  new ScriptComponent('scripts/PlayerController.ts')
)
```

### 3. Testing di Editor

1. Lihat entity di Hierarchy Panel
2. Click entity untuk select
3. Edit properties di Inspector Panel
4. Click "Play" button untuk mulai
5. Debug di Console Panel

## Common Tasks

### Adding Components

```typescript
// Transform (sudah included)
entity.getTransform()

// Rendering
entity.addComponent(new Camera())
entity.addComponent(new Light())
entity.addComponent(new MeshRenderer('model.gltf'))

// Physics
entity.addComponent(new RigidBody())
entity.addComponent(new Collider())

// Scripting
entity.addComponent(new ScriptComponent('script.ts'))
```

### Querying Entities

```typescript
// Get semua entities
const all = world.getEntities()

// Get entities dengan specific components
const movables = world.getEntitiesWithComponents('RigidBody', 'Transform')

// Get specific entity
const camera = world.getEntity('main-camera')
```

### Listening to Events

```typescript
// Engine events
engine.on('stateChanged', (data) => {
  console.log('Engine state:', data.state)
})

engine.on('resize', (data) => {
  console.log('Window resized:', data.width, data.height)
})

// Custom events
engine.emit('gameWon', { score: 1000 })
```

### Creating Systems

```typescript
class MySystem extends System {
  initialize() {
    console.log('System init')
  }

  update(deltaTime) {
    // Process entities
    const entities = this.getEntitiesWithComponents('MyComponent')
    for (const entity of entities) {
      // Update logic
    }
  }

  shutdown() {
    console.log('System shutdown')
  }
}

world.addSystem(new MySystem())
```

## Debugging Tips

### Enable Debug Logging

```typescript
import { Logger, LogLevel } from '@engine/utils/index'

Logger.setLevel(LogLevel.DEBUG)
Logger.debug('Custom debug message')
```

### Performance Profiling

```typescript
const monitor = engine.getPerformanceMonitor()

monitor.startMeasure('render')
// ... code to measure
const elapsed = monitor.endMeasure('render')

console.log(`Render took ${elapsed}ms`)
monitor.printStats()
```

### Check Entity Components

```typescript
const entity = world.getEntity('player')
const components = entity.getComponents()

for (const comp of components) {
  console.log(comp.name)
}
```

## Build & Deployment

### Web Build

```bash
npm run build
# Output: dist/
```

### Desktop Build (Windows/Mac/Linux)

```bash
npm run build:all
# Output: out/ (installers)
```

### Development Mode

```bash
npm run electron-dev
# Hot reload enabled
```

## Next Documentation

- **Architecture**: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **API Reference**: [docs/API.md](docs/API.md)
- **Best Practices**: [docs/BEST_PRACTICES.md](docs/BEST_PRACTICES.md)
- **Plugin Development**: [docs/PLUGIN_DEVELOPMENT.md](docs/PLUGIN_DEVELOPMENT.md)

## Troubleshooting

### WebGPU Not Available?
- Engine automatically fallback ke Three.js
- Check browser support di https://caniuse.com/webgpu

### Scripts Not Reloading?
- Ensure hot-reload is enabled
- Check console untuk errors
- Verify script file path

### Low FPS?
- Check performance monitor
- Look untuk expensive systems
- Use LOD untuk distant objects

## Getting Help

- 📖 Read full documentation
- 🐛 Check console untuk errors
- 💬 Open GitHub issues
- 🔗 Check Discord community

## What to Try Next

1. **Create Your First Scene** - Setup camera, lights, geometry
2. **Write a Script** - Implement player movement
3. **Add Physics** - Enable gravity dan collision
4. **Build a Plugin** - Extend engine functionality
5. **Export Project** - Build untuk web or desktop
