# 🎮 Linden Engine - Hybrid Architecture Design
## Unity + Unreal Engine 5 Combined Features

---

## 📐 1. Vision Statement

**Linden Engine** adalah game engine hybrid yang menggabungkan:
- **Unity**: Kemudahan penggunaan, workflow yang intuitif, komponen-based design
- **Unreal Engine 5**: Power, visual fidelity, Blueprints, Nanite, Lumen-like features

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        LINDEN ENGINE ARCHITECTURE                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                         EDITOR LAYER                                 │   │
│   │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │   │
│   │  │ Scene    │ │ Material │ │Blueprint │ │Sequencer │ │ Terrain  │  │   │
│   │  │ Viewport │ │ Editor   │ │ Editor   │ │ Timeline │ │ Editor   │  │   │
│   │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                         RUNTIME LAYER                                │   │
│   │  ┌──────────────────────────────────────────────────────────────┐   │   │
│   │  │                     HYBRID ECS SYSTEM                         │   │   │
│   │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │   │   │
│   │  │  │ Entity      │  │ Components  │  │ Systems             │   │   │   │
│   │  │  │ (Actor)     │  │ (Data)      │  │ (Logic Processing)  │   │   │   │
│   │  │  └─────────────┘  └─────────────┘  └─────────────────────┘   │   │   │
│   │  └──────────────────────────────────────────────────────────────┘   │   │
│   │                                                                      │   │
│   │  ┌───────────────┐ ┌───────────────┐ ┌───────────────────────────┐  │   │
│   │  │ Rendering     │ │ Physics       │ │ Audio/Input/Network      │  │   │
│   │  │ Pipeline      │ │ Engine        │ │ Subsystems               │  │   │
│   │  └───────────────┘ └───────────────┘ └───────────────────────────┘  │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                       RESOURCE LAYER                                 │   │
│   │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │   │
│   │  │ Asset    │ │ Shader   │ │ Audio    │ │ Script   │ │ Config   │  │   │
│   │  │ Manager  │ │ Manager  │ │ Manager  │ │ Manager  │ │ Manager  │  │   │
│   │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📦 2. Core Architecture - Hybrid ECS

### 2.1 Entity System (Unity GameObject + UE5 Actor)

```typescript
// Linden menggunakan Entity sebagai basis seperti Unity,
// tapi dengan fitur Actor dari Unreal (ticking, lifecycle events)

Entity {
  // Unity-like
  - components: Map<ComponentType, Component>
  - transform: Transform
  - isActive: boolean
  - tag: string
  - layer: number
  
  // Unreal-like  
  - tickEnabled: boolean
  - beginPlay(): void
  - tick(deltaTime): void
  - endPlay(): void
  - replicates: boolean  // Networking
}
```

### 2.2 Component System (Unity Component + UE5 ActorComponent)

```
┌─────────────────────────────────────────────────────────────────┐
│                    COMPONENT HIERARCHY                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                      ┌──────────────┐                           │
│                      │  Component   │                           │
│                      │   (Base)     │                           │
│                      └──────┬───────┘                           │
│              ┌──────────────┼──────────────┐                    │
│              │              │              │                    │
│     ┌────────▼────────┐ ┌───▼────┐ ┌──────▼──────┐             │
│     │ SceneComponent  │ │ Data   │ │ Behaviour   │             │
│     │ (has transform) │ │ Comps  │ │ (scripting) │             │
│     └────────┬────────┘ └────────┘ └─────────────┘             │
│              │                                                   │
│    ┌─────────┼─────────┬─────────────┐                         │
│    │         │         │             │                         │
│ ┌──▼───┐ ┌───▼───┐ ┌───▼───┐  ┌─────▼─────┐                   │
│ │Mesh  │ │Light  │ │Camera │  │Primitive  │                   │
│ │Comp  │ │Comp   │ │Comp   │  │Component  │                   │
│ └──────┘ └───────┘ └───────┘  └───────────┘                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🎨 3. Material System (UE5 Material Editor + Unity Shader Graph)

### 3.1 Node-Based Material Graph

```
┌─────────────────────────────────────────────────────────────────┐
│                    MATERIAL GRAPH SYSTEM                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐    │
│  │ Texture      │────►│ Multiply     │────►│              │    │
│  │ Sample       │     │ Node         │     │   Material   │    │
│  └──────────────┘     └──────────────┘  ┌─►│   Output     │    │
│                                         │  │              │    │
│  ┌──────────────┐     ┌──────────────┐  │  │  - Albedo    │    │
│  │ Normal Map   │────►│ Normal       │──┘  │  - Normal    │    │
│  │              │     │ Unpack       │     │  - Metallic  │    │
│  └──────────────┘     └──────────────┘     │  - Roughness │    │
│                                            │  - Emissive  │    │
│  ┌──────────────┐                          │  - AO        │    │
│  │ Constant     │──────────────────────────│              │    │
│  │ (Metallic)   │                          └──────────────┘    │
│  └──────────────┘                                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Material Node Types

| Category | Nodes | Description |
|----------|-------|-------------|
| **Input** | TextureSample, Constant, Parameter, VertexColor | Data sources |
| **Math** | Add, Multiply, Lerp, Power, Clamp | Mathematical operations |
| **Vector** | ComponentMask, Append, Normalize, Dot | Vector manipulations |
| **Utility** | Time, Fresnel, Panner, Rotator | Special effects |
| **Output** | MaterialOutput, CustomOutput | Final outputs |

---

## 🔵 4. Visual Scripting - Blueprint System (UE5-like)

### 4.1 Blueprint Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    BLUEPRINT SYSTEM                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    EVENT GRAPH                             │  │
│  │                                                            │  │
│  │  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌────────┐ │  │
│  │  │ Event   │───►│ Branch  │───►│ ForEach │───►│ Action │ │  │
│  │  │ BeginPlay│   │ (if)    │    │ Loop    │    │ Node   │ │  │
│  │  └─────────┘    └────┬────┘    └─────────┘    └────────┘ │  │
│  │                      │                                    │  │
│  │                      ▼                                    │  │
│  │                 ┌─────────┐                               │  │
│  │                 │ Set     │                               │  │
│  │                 │ Variable│                               │  │
│  │                 └─────────┘                               │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    VARIABLES                               │  │
│  │  • Health: Float = 100                                    │  │
│  │  • Speed: Float = 5.0                                     │  │
│  │  • IsAlive: Boolean = true                                │  │
│  │  • TargetActor: Actor Reference                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Node Categories

| Category | Examples | Execution Type |
|----------|----------|----------------|
| **Events** | BeginPlay, Tick, OnCollision | Entry Points |
| **Flow Control** | Branch, ForLoop, Sequence | Control Flow |
| **Variables** | Get, Set, Increment | Data Access |
| **Functions** | Math, String, Array ops | Pure/Impure |
| **Actions** | SpawnActor, PlaySound, ApplyDamage | Game Actions |

---

## 🎬 5. Cinematic System (UE5 Sequencer + Unity Cinemachine)

### 5.1 Sequencer Timeline

```
┌─────────────────────────────────────────────────────────────────┐
│                    SEQUENCER TIMELINE                            │
├─────────────────────────────────────────────────────────────────┤
│ Time: 0s      5s       10s      15s      20s      25s     30s  │
│ ──────────────────────────────────────────────────────────────  │
│                                                                  │
│ ┌─ Camera Track ─────────────────────────────────────────────┐  │
│ │ [CameraA]═══════╗    [CameraB]════════╗    [CameraC]═════  │  │
│ │                  ╚═══╝                  ╚═══╝               │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│ ┌─ Actor: Player ────────────────────────────────────────────┐  │
│ │ Transform ◆───────◆───────────◆──────────────────◆         │  │
│ │ Animation     [Walk]═════[Run]════════[Jump]═══════        │  │
│ │ Visibility    ████████████████████████░░░░░░░░░░░░░        │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│ ┌─ Actor: Enemy ─────────────────────────────────────────────┐  │
│ │ Transform            ◆────────────◆───────────────◆        │  │
│ │ Animation                [Idle]══════════[Attack]══        │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│ ┌─ Audio Track ──────────────────────────────────────────────┐  │
│ │ Music    [Ambient]═════════════╗  [Battle]════════════     │  │
│ │ SFX              [Footsteps]═══╝        [Explosion]        │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│ ┌─ Event Track ──────────────────────────────────────────────┐  │
│ │         ▲ StartDialog    ▲ TriggerExplosion   ▲ EndScene   │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Virtual Camera System (Cinemachine-like)

```
┌─────────────────────────────────────────────────────────────────┐
│               VIRTUAL CAMERA SYSTEM                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                   CAMERA BRAIN                              │ │
│  │  • Active Camera: VCam_Player                              │ │
│  │  • Blend Time: 0.5s                                        │ │
│  │  • Blend Style: EaseInOut                                  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                          │                                       │
│         ┌────────────────┼────────────────┐                     │
│         ▼                ▼                ▼                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ VCam_Player │  │ VCam_Dialog │  │ VCam_Action │             │
│  │ Priority:10 │  │ Priority:15 │  │ Priority:20 │             │
│  │             │  │             │  │             │             │
│  │ Body:       │  │ Body:       │  │ Body:       │             │
│  │  ThirdPerson│  │  Framing    │  │  Dolly      │             │
│  │             │  │             │  │             │             │
│  │ Aim:        │  │ Aim:        │  │ Aim:        │             │
│  │  Composer   │  │  GroupComp  │  │  POV        │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🎭 6. Animation System (Unity Animator + UE5 Animation Blueprint)

### 6.1 Animation State Machine

```
┌─────────────────────────────────────────────────────────────────┐
│               ANIMATION STATE MACHINE                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│           ┌────────────────────────────────────┐                │
│           │          STATE MACHINE             │                │
│           └────────────────────────────────────┘                │
│                           │                                      │
│     ┌─────────────────────┼─────────────────────┐               │
│     ▼                     ▼                     ▼               │
│ ┌────────┐  Speed>0.1  ┌────────┐  IsJump   ┌────────┐         │
│ │  Idle  │────────────►│  Walk  │──────────►│  Jump  │         │
│ │        │◄────────────│        │           │        │         │
│ └────────┘  Speed<0.1  └────┬───┘           └───┬────┘         │
│     │                       │ Speed>5            │ Grounded    │
│     │                       ▼                    ▼              │
│     │                  ┌────────┐           ┌────────┐         │
│     │                  │  Run   │           │  Land  │         │
│     │◄─────────────────│        │           │        │         │
│     │     Speed<0.1    └────────┘           └────────┘         │
│                                                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │ BLEND SPACES                                             │   │
│   │ ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │   │
│   │ │ Locomotion  │  │ Aim Offset  │  │ Additive    │       │   │
│   │ │ 2D BlendSp  │  │ Look at     │  │ Breathing   │       │   │
│   │ └─────────────┘  └─────────────┘  └─────────────┘       │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 Animation Blueprint Features

| Feature | Unity Equivalent | UE5 Equivalent | Linden Implementation |
|---------|------------------|----------------|----------------------|
| State Machine | Animator Controller | Anim Blueprint | AnimatorController |
| Blend Trees | Blend Tree | Blend Spaces | BlendSpace2D |
| IK | Animation Rigging | Control Rig | IKSystem |
| Layers | Animator Layers | Anim Layers | AnimationLayer |
| Events | Animation Events | Anim Notifies | AnimationEvent |

---

## 🔧 7. Plugin System

### 7.1 Plugin Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    PLUGIN SYSTEM                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    PLUGIN MANAGER                          │  │
│  │  • Load/Unload plugins at runtime                         │  │
│  │  • Dependency resolution                                   │  │
│  │  • Version compatibility checking                         │  │
│  │  • Hot-reload support                                      │  │
│  └───────────────────────────────────────────────────────────┘  │
│                          │                                       │
│     ┌────────────────────┼────────────────────┐                 │
│     ▼                    ▼                    ▼                 │
│ ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│ │ Editor       │  │ Runtime      │  │ Asset        │           │
│ │ Plugins      │  │ Plugins      │  │ Plugins      │           │
│ │              │  │              │  │              │           │
│ │ • Panels     │  │ • Systems    │  │ • Importers  │           │
│ │ • Tools      │  │ • Components │  │ • Exporters  │           │
│ │ • Inspectors │  │ • Services   │  │ • Converters │           │
│ └──────────────┘  └──────────────┘  └──────────────┘           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📁 8. Project Structure

```
LindenEngine/
├── engine/                     # Core Engine
│   ├── core/                   # Engine core
│   │   └── Engine.ts
│   ├── ecs/                    # Entity Component System
│   │   ├── Entity.ts
│   │   ├── Component.ts
│   │   └── World.ts
│   ├── renderer/               # Rendering system
│   ├── physics/                # Physics system
│   ├── animation/              # Animation system (NEW)
│   │   ├── AnimatorController.ts
│   │   ├── AnimationState.ts
│   │   ├── BlendSpace.ts
│   │   └── IKSystem.ts
│   ├── materials/              # Material system (NEW)
│   │   ├── MaterialGraph.ts
│   │   ├── MaterialNode.ts
│   │   └── nodes/
│   ├── blueprints/             # Visual scripting (NEW)
│   │   ├── Blueprint.ts
│   │   ├── BlueprintNode.ts
│   │   └── nodes/
│   ├── cinematic/              # Cinematic system (NEW)
│   │   ├── Sequencer.ts
│   │   ├── VirtualCamera.ts
│   │   └── CameraBrain.ts
│   ├── scripting/              # TypeScript scripting
│   ├── assets/                 # Asset management
│   └── utils/                  # Utilities
│
├── editor/                     # Editor UI
│   ├── EditorLayout.tsx
│   ├── viewport/
│   │   └── SceneViewport.tsx
│   ├── panels/
│   │   ├── HierarchyPanel.tsx
│   │   ├── InspectorPanel.tsx
│   │   ├── ConsolePanel.tsx
│   │   ├── AssetBrowser.tsx
│   │   ├── MaterialEditor.tsx      # (NEW)
│   │   ├── BlueprintEditor.tsx     # (NEW)
│   │   └── SequencerPanel.tsx      # (NEW)
│   └── ui/
│
├── plugins/                    # Plugin ecosystem
└── docs/                       # Documentation
```

---

## 🚀 9. Implementation Priority

### Phase 1: Core Systems ✅
- [x] ECS Architecture
- [x] Basic Rendering
- [x] Editor Layout

### Phase 2: Material System ✅
- [x] MaterialGraph core
- [x] Node system (50+ node types)
- [x] Material Editor UI (React)
- [x] Shader compilation (GLSL)

### Phase 3: Blueprint System ✅
- [x] Blueprint runtime
- [x] Node execution engine
- [x] Blueprint Editor UI
- [x] Variable system

### Phase 4: Animation System ✅
- [x] State Machine
- [x] Blend Spaces / Blend Trees
- [x] Animation Layers
- [x] Animator Editor UI

### Phase 5: Cinematic System ✅
- [x] Sequencer Timeline
- [x] Virtual Cameras (Cinemachine-like)
- [x] Camera Brain & Blending
- [x] Track types (Transform, Animation, Audio, Event, Camera, Property)
- [x] Sequencer Editor UI

---

## 📂 10. Project Structure

```
linden-engine/
├── engine/                      # Core engine systems
│   ├── materials/               # Material/Shader system
│   │   ├── MaterialNode.ts      # 50+ node types for material graph
│   │   ├── MaterialGraph.ts     # Graph container & shader compiler
│   │   └── index.ts
│   ├── blueprints/              # Visual scripting system
│   │   ├── BlueprintNode.ts     # 40+ blueprint node types
│   │   ├── BlueprintGraph.ts    # Execution engine & runtime
│   │   └── index.ts
│   ├── cinematic/               # Cinematic/Sequencer system
│   │   ├── Sequencer.ts         # Timeline tracks & keyframes
│   │   ├── VirtualCamera.ts     # Camera brain & blending
│   │   └── index.ts
│   └── animation/               # Animation state machine
│       ├── AnimatorController.ts # States, transitions, blend trees
│       └── index.ts
├── editor/                      # Editor UI components
│   └── panels/                  # Editor panels
│       ├── MaterialEditor.tsx   # Node-based material editor
│       ├── BlueprintEditor.tsx  # Visual scripting editor
│       ├── SequencerEditor.tsx  # Timeline cinematic editor
│       ├── AnimatorEditor.tsx   # Animation state machine editor
│       └── index.ts
├── src/                         # Main application source
└── ARCHITECTURE.md              # This document
```

---

## 🎨 11. Editor UI System

### 11.1 Material Editor (UE5 Material Editor + Unity Shader Graph)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Material Editor - BasicLitMaterial                            [Compile] │
├──────────────┬──────────────────────────────────────────┬───────────────┤
│ Node Palette │                                          │  Properties   │
│              │     ┌─────────┐      ┌─────────┐        │               │
│ ▼ Input      │     │ Texture │──────│  Lerp   │        │ Selected:     │
│   TextureSamp│     │ Sample  │      │         │───┐    │ Lerp          │
│   UV         │     └─────────┘      └─────────┘   │    │               │
│   Normal     │                                    │    │ Category:     │
│              │     ┌─────────┐      ┌─────────┐   │    │ Math          │
│ ▼ Constants  │     │Constant │──────│Multiply │───│    │               │
│   Float      │     │  (0.5)  │      │         │   │    │ Inputs:       │
│   Vector3    │     └─────────┘      └─────────┘   │    │ - A (Float3)  │
│              │                                    │    │ - B (Float3)  │
│ ▼ Math       │                      ┌─────────────▼┐   │ - Alpha       │
│   Add        │                      │   Material   │   │               │
│   Multiply   │                      │   Output     │   │ Outputs:      │
│   Lerp       │                      │              │   │ - Result      │
│              │                      └──────────────┘   │               │
└──────────────┴──────────────────────────────────────────┴───────────────┘
```

### 11.2 Blueprint Editor (UE5 Blueprints Style)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Blueprint - PlayerController                    [▶ Execute] [Validate]  │
├──────────────────┬────────────────────────────────────────┬─────────────┤
│ Node Palette     │                                        │ Variables   │
│ 🔍 Search...     │   ┌──────────┐      ┌──────────┐      │             │
│                  │   │⚡BeginPlay│════▶│▶ Print   │      │ Health: 100 │
│ ▼ Events        │   │  (Event) │      │ "Hello"  │      │ Name: "..." │
│   ⚡ BeginPlay   │   └──────────┘      └──────────┘      │ IsAlive: ✓  │
│   ⚡ Tick        │                                        │             │
│                  │   ┌──────────┐      ┌──────────┐      │             │
│ ▼ Flow Control  │   │⚡ Tick    │════▶│  Branch  │═══▶  │ [+ Add]     │
│   ↔ Branch      │   │          │      │ condition│      │             │
│   ↔ Sequence    │   └──────────┘      └─────┬────┘      │             │
│   ↔ ForLoop     │                           │           │             │
│                  │                      ┌────▼────┐      │             │
│ ▼ Actions       │                      │ SetPos  │      │             │
│   ▶ Print       │                      │ x,y,z   │      │             │
│   ▶ SetLocation │                      └─────────┘      │             │
└──────────────────┴────────────────────────────────────────┴─────────────┘
```

### 11.3 Sequencer Editor (UE5 Sequencer Style)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [▶] [⏸] [⏹] [⏮] [⏭]  00:03.25 / 00:10.00   Zoom: 100%  │
├─────────────────────────────────────────────────────────────────────────┤
│              │ 0s      2s      4s      6s      8s     10s │ Properties │
├──────────────┼────────────────────────────────────────────┤            │
│ 📷 Camera    │ ◆━━━━━━━◆━━━━━━━━━━━◆                     │ Time: 3.0s │
│ [M][L]       │         ▼                                  │            │
├──────────────┼────────────────────────────────────────────┤ Interp:    │
│ 📐 Player    │ ◆━━━━━━━━━━━━◆━━━━━━━━━━━◆                │ [Cubic ▼]  │
│ [M][L]       │                                            │            │
├──────────────┼────────────────────────────────────────────┤ Value:     │
│ 🎬 Animation │ ◆──◆━━━━━━━━━━━━━━━━━━━◆─◆                │ {...}      │
│ [M][L]       │Idle│Walk              │Run│                │            │
├──────────────┼────────────────────────────────────────────┤            │
│ ⚡ Events    │ ◆                     ◆                 ◆ │            │
│ [M][L]       │Start              Halfway              End │            │
├──────────────┼────────────────────────────────────────────┤            │
│ [+ Add Track]│                                            │            │
└──────────────┴────────────────────────────────────────────┴────────────┘
```

### 11.4 Animator Editor (Unity Animator Style)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Animator - LocomotionController    [Base Layer] [Upper Body]            │
├──────────────────┬────────────────────────────────────────┬─────────────┤
│ Parameters       │                                        │ Inspector   │
│                  │        ┌────────────┐                  │             │
│ Speed    [0.5]   │  ━━━━▶│   Idle     │                  │ State: Walk │
│ IsJumping [  ]   │        │  (Entry)   │                  │             │
│ Jump     [Trig]  │        └─────┬──────┘                  │ Motion:     │
│                  │              │ Speed>0.1               │ walk_anim   │
│ [+ Add]          │              ▼                         │             │
│                  │        ┌────────────┐                  │ Speed: 1.0  │
│                  │        │   Walk     │◀───┐             │ Loop: ✓     │
│                  │        │            │    │             │             │
│                  │        └─────┬──────┘    │Speed<0.1    │ Transitions:│
│                  │              │ Speed>0.5 │             │ → Idle      │
│                  │              ▼           │             │ → Run       │
│                  │        ┌────────────┐    │             │             │
│                  │        │    Run     │────┘             │             │
│                  │        │ (BlendTree)│                  │             │
│                  │        └────────────┘                  │             │
│                  │                                        │             │
│                  │ ● Entry  ● Normal  ● BlendTree         │             │
└──────────────────┴────────────────────────────────────────┴─────────────┘
```

---

## 🔧 12. Feature Comparison

| Feature | Unity | Unreal Engine 5 | Linden Engine |
|---------|-------|-----------------|---------------|
| **Architecture** | Component-based | Actor-Component | Hybrid ECS |
| **Scripting** | C# | C++/Blueprints | TypeScript/Blueprints |
| **Material System** | Shader Graph | Material Editor | Node-based (50+ nodes) |
| **Animation** | Animator Controller | Animation Blueprint | State Machine + Blend Trees |
| **Cinematic** | Timeline + Cinemachine | Sequencer | Sequencer + Virtual Cameras |
| **Visual Scripting** | Visual Scripting | Blueprints | Blueprint System |
| **Rendering** | URP/HDRP | Deferred/Lumen | WebGPU/Deferred |

---

*Last Updated: January 2025*
