# Linden Engine - Architecture Documentation

## 📐 System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    LINDEN ENGINE STACK                      │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         EDITOR UI (React + Tailwind)                 │  │
│  │  ├─ Viewport   ├─ Hierarchy  ├─ Inspector           │  │
│  │  └─ Toolbar    ├─ Console    ├─ Asset Browser       │  │
│  └──────────────────────────────────────────────────────┘  │
│                           │                                  │
│                    IPC (Electron)                            │
│                           ▼                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │            LINDEN ENGINE (Core)                       │  │
│  │                                                        │  │
│  │  ┌──────────────────────────────────────────────┐   │  │
│  │  │  ECS - Entity Component System               │   │  │
│  │  │  ├─ World      ├─ System                    │   │  │
│  │  │  ├─ Entity     ├─ Component                 │   │  │
│  │  │  └─ Lifecycle  ├─ Query                    │   │  │
│  │  └──────────────────────────────────────────────┘   │  │
│  │                                                        │  │
│  │  ┌──────────────────────────────────────────────┐   │  │
│  │  │  Rendering System                            │   │  │
│  │  │  ├─ WebGPU Renderer (Primary)               │   │  │
│  │  │  ├─ Three.js Renderer (Fallback)            │   │  │
│  │  │  ├─ Shader Management                        │   │  │
│  │  │  └─ Material System                          │   │  │
│  │  └──────────────────────────────────────────────┘   │  │
│  │                                                        │  │
│  │  ┌──────────────────────────────────────────────┐   │  │
│  │  │  Physics System                              │   │  │
│  │  │  ├─ Rigidbody Simulation                     │   │  │
│  │  │  ├─ Collision Detection                      │   │  │
│  │  │  ├─ Gravity & Forces                         │   │  │
│  │  │  └─ Collider Management                      │   │  │
│  │  └──────────────────────────────────────────────┘   │  │
│  │                                                        │  │
│  │  ┌──────────────────────────────────────────────┐   │  │
│  │  │  Scripting System                            │   │  │
│  │  │  ├─ Script Loader                            │   │  │
│  │  │  ├─ Hot Reload Manager                       │   │  │
│  │  │  ├─ Lifecycle Management                     │   │  │
│  │  │  └─ API Exposure                             │   │  │
│  │  └──────────────────────────────────────────────┘   │  │
│  │                                                        │  │
│  │  ┌──────────────────────────────────────────────┐   │  │
│  │  │  Asset System                                │   │  │
│  │  │  ├─ Asset Loader                             │   │  │
│  │  │  ├─ Asset Cache                              │   │  │
│  │  │  ├─ Metadata Management                      │   │  │
│  │  │  └─ Format Support (GLTF, FBX, PNG, JPG)    │   │  │
│  │  └──────────────────────────────────────────────┘   │  │
│  │                                                        │  │
│  │  ┌──────────────────────────────────────────────┐   │  │
│  │  │  Plugin System                               │   │  │
│  │  │  ├─ Plugin Loader                            │   │  │
│  │  │  ├─ Hot Reload                               │   │  │
│  │  │  ├─ API Exposure                             │   │  │
│  │  │  └─ Plugin Registry                          │   │  │
│  │  └──────────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────┘  │
│                           │                                  │
│              ┌────────────┼────────────┐                    │
│              ▼            ▼            ▼                    │
│         ┌─────────┐  ┌────────┐  ┌──────────┐              │
│         │ WebGPU  │  │ Three  │  │ Browser  │              │
│         │ Device  │  │  .js   │  │  APIs    │              │
│         └─────────┘  └────────┘  └──────────┘              │
│                                                               │
├─────────────────────────────────────────────────────────────┤
│           Electron (OS Level Integration)                    │
│  ├─ File System Access   ├─ Window Management               │
│  ├─ Menu Integration     ├─ Build Process                   │
│  └─ Native APIs          └─ Distribution                    │
└─────────────────────────────────────────────────────────────┘
```

## 🔄 Engine Update Loop

```
┌─────────────────────────────────┐
│      Game Loop (60 FPS)         │
└─────────────────────────────────┘
           │
           ▼
    ┌─────────────────┐
    │  requestAnimFrame │
    └─────────────────┘
           │
           ├──► Calculate deltaTime
           │
           ├──► Update Systems
           │    ├─ PhysicsSystem.update()
           │    ├─ ScriptSystem.update()
           │    ├─ AnimationSystem.update()
           │    └─ AudioSystem.update()
           │
           ├──► Update Entities
           │    ├─ Component.onUpdate(dt)
           │    ├─ Transform calculations
           │    └─ Lifecycle callbacks
           │
           ├──► Render
           │    ├─ Collect render data
           │    ├─ Submit draw calls
           │    ├─ GPU Execution
           │    └─ Present frame
           │
           ├──► Performance monitoring
           │
           ▼
    ┌─────────────────┐
    │  Next Frame     │
    └─────────────────┘
```

## 🎯 ECS (Entity Component System) Design

### Entity vs Object-Oriented

**Traditional OOP:**
```
Player extends Character {
  health: number
  armor: number
  weapons: Weapon[]
  move() { }
  shoot() { }
  takeDamage() { }
}

// Problems:
// - Rigid hierarchy
// - Hard to extend
// - Difficult composition
```

**ECS Approach:**
```
Entity {
  Transform (position, rotation, scale)
  Health (health, maxHealth)
  Armor (armorValue)
  Inventory (weapons)
  Movement (velocity)
  Weapon (damage, fireRate)
}

// Benefits:
// - Flexible composition
// - Easy to enable/disable
// - Data-driven design
// - Easy to debug
```

### Component Hierarchy

```
Component (Base)
├─ Transform (position, rotation, scale, parent/children)
├─ MeshRenderer (mesh, materials, shadows)
├─ Camera (FOV, near, far, projection)
├─ Light (type, color, intensity, range)
├─ RigidBody (mass, velocity, gravity)
├─ Collider (shape, size, trigger mode)
├─ AudioSource (clip, volume, pitch)
├─ Animator (animations, states)
├─ ParticleSystem (particles, emission)
└─ ScriptComponent (script path, properties)
```

### System Architecture

```
System (Base)
├─ PhysicsSystem
│  ├─ Apply forces & gravity
│  ├─ Update velocities
│  ├─ Collision detection
│  └─ Resolve collisions
│
├─ RenderSystem
│  ├─ Collect render data
│  ├─ Frustum culling
│  ├─ Sort by material
│  └─ Submit draw calls
│
├─ ScriptSystem
│  ├─ Execute onUpdate
│  ├─ Handle hot reload
│  ├─ Event distribution
│  └─ Script cleanup
│
├─ AnimationSystem
│  ├─ Update animations
│  ├─ Apply skeletal data
│  └─ Interpolation
│
└─ AudioSystem
   ├─ Play audio sources
   ├─ Update 3D positions
   └─ Fade management
```

## 📜 Script Lifecycle

```
┌──────────────────────────┐
│   Script Creation        │
└──────────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│  1. onInit() - Initialization    │
│  - Called once at startup        │
│  - Setup component references    │
│  - Load resources                │
│  - Register event listeners      │
└──────────────────────────────────┘
           │
           ▼
    ┌────────────────┐
    │  Game Running  │
    └────────────────┘
           │
      ┌────┴────┐
      │          │
      ▼          ▼
  ┌─────────┐  ┌──────────────┐
  │ onUpdate│  │onFixedUpdate │
  │(every   │  │ (physics     │
  │ frame)  │  │  rate)       │
  └─────────┘  └──────────────┘
      │          │
      │  Event   │
      │ Trigger  │
      │          │
      ▼          ▼
  ┌──────────────┐
  │ onEvent()    │
  │ onCollision()│
  │ onTrigger()  │
  └──────────────┘
           │
     ┌─────┴─────┐
     │            │
     │    Dev     │
     │ Hot Reload │
     │            │
     ▼            ▼
  ┌──────────────────────┐
  │ onReload()           │
  │ - Script reloaded    │
  │ - Restore state      │
  │ - Re-setup listeners │
  └──────────────────────┘
           │
           ▼
    ┌────────────────┐
    │ Game Destroyed │
    └────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ onDestroy() - Cleanup            │
│ - Remove event listeners         │
│ - Cleanup resources              │
│ - Save state if needed           │
└──────────────────────────────────┘
```

## 🎨 Rendering Pipeline

```
┌────────────────────────────────┐
│   Scene Data Collection        │
│ - Gather all renderables       │
│ - Camera matrix calculations   │
│ - Light data collection        │
└────────────────────────────────┘
           │
           ▼
┌────────────────────────────────┐
│   Frustum Culling              │
│ - Skip entities outside view   │
│ - Reduce draw calls            │
└────────────────────────────────┘
           │
           ▼
┌────────────────────────────────┐
│   Shadow Map Generation        │
│ - Render to shadow texture     │
│ - Setup shadow matrix          │
└────────────────────────────────┘
           │
           ▼
┌────────────────────────────────┐
│   Material Sorting             │
│ - Group by material            │
│ - Sort by texture              │
│ - Batch similar draws          │
└────────────────────────────────┘
           │
           ▼
┌────────────────────────────────┐
│   Draw Call Submission         │
│ (WebGPU)                       │
│ ├─ Set pipeline               │
│ ├─ Bind resources             │
│ ├─ Set uniforms               │
│ └─ Draw indexed               │
└────────────────────────────────┘
           │
           ▼
┌────────────────────────────────┐
│   GPU Execution                │
│ ├─ Vertex shader              │
│ ├─ Fragment shader            │
│ ├─ Rasterization              │
│ └─ Post-processing            │
└────────────────────────────────┘
           │
           ▼
┌────────────────────────────────┐
│   Present Frame                │
│ - Show on screen               │
│ - VSync synchronization        │
└────────────────────────────────┘
```

## 🧬 Data Flow

```
┌─────────────────┐
│ User Input      │
│ - Mouse         │
│ - Keyboard      │
│ - Controller    │
└─────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Input System                     │
│ - Translate to actions          │
│ - Send to relevant scripts      │
└─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Script Execution (onUpdate)     │
│ - Player controller script      │
│ - Enemy AI script               │
│ - UI script                     │
│ └─ Modify entity state          │
└─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Physics System                  │
│ - Calculate velocities          │
│ - Collision detection           │
│ - Update transforms             │
└─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Updated World State             │
│ - All entities positioned       │
│ - All physics resolved          │
│ - All animations updated        │
└─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Render System                   │
│ - Collect render data           │
│ - Generate draw calls           │
│ - Send to GPU                   │
└─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Screen Output                   │
│ - Visual feedback to user       │
└─────────────────────────────────┘
```

## 🔌 Plugin System Architecture

```
┌──────────────────────────────┐
│   Plugin Manager             │
│ ├─ Load plugins             │
│ ├─ Initialize plugins       │
│ ├─ Hot reload               │
│ └─ Unload plugins           │
└──────────────────────────────┘
         │
    ┌────┼────┐
    │    │    │
    ▼    ▼    ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Plugin A    │  │  Plugin B    │  │  Plugin C    │
├──────────────┤  ├──────────────┤  ├──────────────┤
│ Components   │  │ Systems      │  │ Scripting    │
│ ├─ Custom    │  │ ├─ Custom    │  │ ├─ Custom    │
│ │ Renderable │  │ │ Physics    │  │ │ Script     │
│ └─ Custom    │  │ └─ Custom    │  │ └─ Custom    │
│   Behavior   │  │   Rendering  │  │   Bindings   │
└──────────────┘  └──────────────┘  └──────────────┘
```

## 📊 Memory Management

```
┌──────────────────────────────────┐
│  Memory Layout                    │
├──────────────────────────────────┤
│                                  │
│ ┌────────────────────────────┐  │
│ │ Entity Pool                 │  │
│ │ - Pre-allocated entities    │  │
│ │ - Reuse instead of alloc    │  │
│ │ - Reduce fragmentation      │  │
│ └────────────────────────────┘  │
│                                  │
│ ┌────────────────────────────┐  │
│ │ Component Storage           │  │
│ │ - SoA (Structure of Arrays) │  │
│ │ - Cache-friendly layout     │  │
│ │ - SIMD-optimized            │  │
│ └────────────────────────────┘  │
│                                  │
│ ┌────────────────────────────┐  │
│ │ Asset Cache                 │  │
│ │ - Loaded meshes             │  │
│ │ - Textures                  │  │
│ │ - Materials                 │  │
│ │ - LRU eviction              │  │
│ └────────────────────────────┘  │
│                                  │
│ ┌────────────────────────────┐  │
│ │ Temporary Buffers           │  │
│ │ - GPU transfer buffers      │  │
│ │ - Staging buffers           │  │
│ │ - Frame scratch space       │  │
│ └────────────────────────────┘  │
│                                  │
└──────────────────────────────────┘
```

## 🎯 Performance Optimization Strategies

### 1. Object Pooling
```typescript
// Instead of:
entities.push(new Entity())

// Use:
const entity = entityPool.get()
```

### 2. Spatial Partitioning
```
World Space
├─ Quadtree (2D)
│  ├─ Cell(0,0)
│  ├─ Cell(1,0)
│  ├─ Cell(0,1)
│  └─ Cell(1,1)
└─ Octree (3D)
   ├─ Octant(0)
   ├─ Octant(1)
   └─ ...
```

### 3. Level of Detail (LOD)
```
Distance < 10m   → Full detail (100k polys)
Distance < 50m   → Medium detail (50k polys)
Distance < 200m  → Low detail (10k polys)
Distance >= 200m → Hidden
```

### 4. Batching
```
❌ Without batching:
Frame 1: Draw Mesh 1 (10k polys)
Frame 1: Draw Mesh 2 (10k polys)
Frame 1: Draw Mesh 3 (10k polys)
Total: 3 draw calls

✅ With batching:
Frame 1: Draw Combined Mesh (30k polys)
Total: 1 draw call
```

### 5. Dirty Flags
```
Transform {
  isDirty: boolean
  
  setPosition(x, y, z) {
    this.position = {x, y, z}
    this.isDirty = true  // Mark for update
  }
  
  updateMatrix() {
    if (this.isDirty) {
      // Recalculate transformation matrix
      this.isDirty = false
    }
  }
}
```

## 🔍 Debugging Architecture

```
┌─────────────────────────────┐
│  Console Panel              │
│ - Real-time logging         │
│ - Debug output              │
│ - Warning/Error tracking    │
└─────────────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  Logger System              │
│ - DEBUG, INFO, WARN, ERROR  │
│ - Log history (1000 entries)│
│ - Filtering by level        │
└─────────────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  Performance Monitor        │
│ - FPS tracking              │
│ - Frame time measurements   │
│ - System profiling          │
└─────────────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  Inspector Panel            │
│ - Entity inspection         │
│ - Component data editing    │
│ - Live preview              │
└─────────────────────────────┘
```
