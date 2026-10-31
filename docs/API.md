# API Reference - Linden Engine

## Engine Core

### LindenEngine Class

```typescript
class LindenEngine {
  // Initialization
  constructor(config: EngineConfig)
  async initialize(): Promise<boolean>

  // Lifecycle
  start(): void
  pause(): void
  resume(): void
  stop(): void
  dispose(): void

  // Getters
  getWorld(): World | null
  getRenderer(): Renderer | null
  getPerformanceMonitor(): PerformanceMonitor
  getState(): EngineState

  // Events
  on(eventName: string, callback: Function): void
  off(eventName: string, callback: Function): void
  emit(eventName: string, data?: any): void

  // Static
  static getInstance(): LindenEngine | null
}
```

#### Configuration

```typescript
interface EngineConfig {
  canvas: HTMLCanvasElement
  width?: number
  height?: number
  pixelRatio?: number
  useWebGPU?: boolean
  enableVSync?: boolean
  targetFPS?: number
}

enum EngineState {
  IDLE = 'idle',
  INITIALIZING = 'initializing',
  RUNNING = 'running',
  PAUSED = 'paused',
  STOPPED = 'stopped',
  ERROR = 'error',
}
```

## Entity Component System (ECS)

### Entity Class

```typescript
class Entity {
  id: string
  name: string
  isActive: boolean

  // Component Management
  addComponent<T extends Component>(component: T): T
  getComponent<T extends Component>(name: string): T | undefined
  hasComponent(name: string): boolean
  removeComponent(name: string): boolean
  getComponents(): Component[]

  // Transform
  getTransform(): Transform

  // Utilities
  clone(): Entity
  serialize(): Record<string, any>
  static deserialize(data: Record<string, any>): Entity
}
```

### Component Class

```typescript
abstract class Component {
  name: string
  protected entityId: string
  protected isEnabled: boolean

  // Lifecycle
  onAttach(entityId: string): void
  onDetach(): void
  onUpdate(deltaTime: number): void
  onDestroy(): void

  // Enable/Disable
  setEnabled(enabled: boolean): void
  getEnabled(): boolean

  // Utilities
  abstract clone(): Component
  getEntityId(): string
}
```

### Transform Component

```typescript
class Transform extends Component {
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number }
  scale: { x: number; y: number; z: number }
  parent: string | null
  children: string[]

  setPosition(x: number, y: number, z: number): void
  setRotation(x: number, y: number, z: number): void
  setScale(x: number, y: number, z: number): void
  addChild(childId: string): void
  removeChild(childId: string): void
}
```

### World Class

```typescript
class World {
  // Entity Management
  addEntity(entity: Entity): Entity
  getEntity(id: string): Entity | undefined
  getEntities(): Entity[]
  removeEntity(id: string): boolean
  getEntitiesWithComponents(...componentNames: string[]): Entity[]

  // System Management
  addSystem(system: System): System
  getSystem(name: string): System | undefined
  removeSystem(name: string): boolean

  // Lifecycle
  initialize(): void
  start(): void
  stop(): void
  update(): void
  clear(): void

  // Serialization
  serialize(): Record<string, any>
}
```

### System Class

```typescript
abstract class System {
  name: string
  protected world: World | null

  // Lifecycle
  abstract initialize(): void
  abstract update(deltaTime: number): void
  abstract shutdown(): void

  // Control
  setWorld(world: World): void
  setEnabled(enabled: boolean): void
  isSystemEnabled(): boolean

  // Utilities
  protected getEntitiesWithComponents(...componentNames: string[]): Entity[]
  protected getEntityWithComponents(...componentNames: string[]): Entity | undefined
}
```

## Rendering

### Renderer Class

```typescript
class Renderer {
  constructor(canvas: HTMLCanvasElement, config?: Partial<RendererConfig>)

  async initialize(): Promise<boolean>
  render(): void
  resize(width: number, height: number): void
  dispose(): void
}
```

### Camera Component

```typescript
class Camera extends Component {
  fov: number
  aspect: number
  near: number
  far: number
  isActive: boolean
  backgroundColor: { r: number; g: number; b: number; a: number }

  getProjectionMatrix(): Float32Array
  clone(): Camera
}
```

### Light Component

```typescript
enum LightType {
  DIRECTIONAL = 'directional',
  POINT = 'point',
  SPOT = 'spot',
}

class Light extends Component {
  type: LightType
  color: { r: number; g: number; b: number }
  intensity: number
  range: number
  castShadow: boolean

  clone(): Light
}
```

### MeshRenderer Component

```typescript
class MeshRenderer extends Component {
  meshId: string
  materialId: string
  castShadow: boolean
  receiveShadow: boolean
  isVisible: boolean

  clone(): MeshRenderer
}
```

## Physics

### RigidBody Component

```typescript
class RigidBody extends Component {
  mass: number
  isStatic: boolean
  useGravity: boolean
  velocity: { x: number; y: number; z: number }
  angularVelocity: { x: number; y: number; z: number }
  drag: number
  angularDrag: number

  applyForce(force: { x: number; y: number; z: number }, deltaTime: number): void
  clone(): RigidBody
}
```

### Collider Component

```typescript
enum ColliderType {
  BOX = 'box',
  SPHERE = 'sphere',
  CAPSULE = 'capsule',
  MESH = 'mesh',
}

class Collider extends Component {
  type: ColliderType
  isTrigger: boolean
  size: { x: number; y: number; z: number }
  offset: { x: number; y: number; z: number }
  radius: number

  clone(): Collider
}
```

### Joint Component

One per entity; connects its `Rigidbody` to another entity's body, or to the world when
`connectedEntity` is empty. Simulated by Rapier in `GameSimulation` (play, editor and headless).

```typescript
class Joint extends Component {
  type: 'fixed' | 'hinge' | 'ball' | 'slider'
  connectedEntity: string             // entity id; '' = world
  anchor: { x: number; y: number; z: number }           // local to this entity
  autoConnectAnchor: boolean          // true: connected anchor keeps the placed poses
  connectedAnchor: { x: number; y: number; z: number }
  axis: { x: number; y: number; z: number }             // hinge axis / slider direction (local)
  limits: { enabled: boolean; min: number; max: number } // hinge degrees, slider meters
  motor: { enabled: boolean; targetVelocity: number; maxForce: number } // °/s or m/s
  breakForce: number                  // N; 0 = unbreakable
  onBreak: EventField
}
```

`breakForce` is compared with an estimate (jointed body's mass × |acceleration − gravity|) because
Rapier's JS API does not expose joint impulses. Limits and motors apply to hinge and slider joints.
A slider assumes both bodies share their orientation.

`Rigidbody.ccd` enables continuous collision detection; `Rigidbody.mass` sets the body mass (kg).

### Water Component (`engine/environment/Water.ts`)

```typescript
class Water extends Component {
  size: { x: number; y: number }      // meters along local X and Z, surface at the entity's Y
  color: string
  distortion: number
  waveSpeed: number                   // WebGL and plain surfaces; WebGPU uses a fixed speed
  reflections: boolean                // off on the Low quality profile
  buoyancy: boolean
  density: number                     // kg/m³
  linearDrag: number
  angularDrag: number
}
```

Rendering: `Water` (WebGL) or `WaterMesh` (WebGPU) from three's addons, or an animated plane on
Low. Buoyancy (`engine/physics/buoyancy.ts`): `F = density · g · colliderVolume · submerged`, where
`submerged` is the share of the body's AABB below the surface; plus drag while submerged. Scripts get
`onEnterWater(water)` / `onExitWater(water)` and the events `water:enter` / `water:exit`;
`CharacterMovement.inWater` is true while a character's centre is under water.

## Effects

### ParticleEmitter Component (`engine/vfx`)

Visual only: `SceneBridge` simulates and draws it; headless play does not.

```typescript
class ParticleEmitter extends Component {
  preset: 'custom' | 'fire' | 'smoke' | 'sparks' | 'explosion' | 'magic' | 'rain' | 'splash'
  playOnStart: boolean
  loop: boolean
  duration: number
  rate: number                        // particles per second
  bursts: { time: number; count: number }[]
  maxParticles: number                // capped per quality profile (200 / 1000 / 2000)
  shape: 'point' | 'sphere' | 'box' | 'cone'   // cones and boxes emit along local +Y
  shapeSize: { x: number; y: number; z: number }
  coneAngle: number
  lifetime: { min: number; max: number }
  speed: { min: number; max: number }
  gravity: number                     // × world gravity; negative rises
  drag: number
  size: { t: number; v: number }[]    // over normalized lifetime
  color: { t: number; color: string; alpha: number }[]
  blending: 'additive' | 'normal'
  texture: string                     // soft | spark | smoke | square | assets/...
  space: 'world' | 'local'
  seed: number                        // 0 = random per play
  light: { enabled: boolean; color: string; intensity: number; flicker: number }
  onFinished: EventField
}
```

Setting `preset` overwrites the fields with the preset's values; `World.addComponent` applies
`preset` before the other data fields, so saved tweaks survive a reload.

## Scripting

### IGameScript Interface

```typescript
interface IGameScript {
  onInit?(context: ScriptContext): void | Promise<void>
  onUpdate?(deltaTime: number): void
  onFixedUpdate?(deltaTime: number): void
  onDestroy?(): void
  onReload?(context: ScriptContext): void | Promise<void>
  onEvent?(eventName: string, data: any): void
  [key: string]: any
}
```

### ScriptContext Interface

```typescript
interface ScriptContext {
  entity: Entity
  deltaTime: number
  input: InputManager
  world: any
  time: TimeManager
  physics: {
    raycast, setLinearVelocity, getLinearVelocity, applyImpulse, setPosition,
    addForce(v): void            // lasts one fixed step; call in onFixedUpdate
    addTorque(v): void
    setAngularVelocity(v): void
    getAngularVelocity(): Vec3 | null
    setMotor(targetVelocity: number, maxForce?: number): void   // this entity's Joint
  }
  vfx: {
    play(entity?): void
    stop(entity?, opts?: { clear?: boolean }): void
    burst(count: number, entity?): void
    spawn(preset: string, position: Vec3, opts?: { parent?; autoDestroy?; overrides? }): Entity
  }
}
```

Hooks besides the lifecycle: `onJointBreak(force)`, `onEnterWater(water)`, `onExitWater(water)`.

### ScriptComponent Class

```typescript
class ScriptComponent extends Component {
  constructor(scriptPath: string)

  async loadScript(context: ScriptContext): Promise<void>
  async reloadScript(context: ScriptContext): Promise<void>
  callMethod(methodName: string, ...args: any[]): any
  getProperty(propertyName: string): any
  setProperty(propertyName: string, value: any): void
  getExposedMethods(): string[]
  clone(): ScriptComponent
}
```

### ScriptManager Class

```typescript
class ScriptManager {
  setContext(context: ScriptContext): void
  registerScript(entityId: string, script: ScriptComponent): void
  unregisterScript(entityId: string): void
  setHotReloadEnabled(enabled: boolean): void
  watchScripts(): void
  async reloadAllScripts(): Promise<void>
  async reloadScript(entityId: string): Promise<void>
}
```

## Utilities

### Vector3Utils

```typescript
namespace Vector3Utils {
  zero(): Vector3
  one(): Vector3
  forward(): Vector3
  right(): Vector3
  up(): Vector3

  add(a: Vector3, b: Vector3): Vector3
  subtract(a: Vector3, b: Vector3): Vector3
  multiply(v: Vector3, scalar: number): Vector3
  magnitude(v: Vector3): number
  normalize(v: Vector3): Vector3
  distance(a: Vector3, b: Vector3): number
  dot(a: Vector3, b: Vector3): number
  cross(a: Vector3, b: Vector3): Vector3
}
```

### Logger Class

```typescript
enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

class Logger {
  static setLevel(level: LogLevel): void
  static debug(message: string, ...args: any[]): void
  static info(message: string, ...args: any[]): void
  static warn(message: string, ...args: any[]): void
  static error(message: string, ...args: any[]): void
  static getHistory(limit?: number): Array<any>
  static clear(): void
}
```

### PerformanceMonitor Class

```typescript
class PerformanceMonitor {
  start(): void
  markFrame(): void
  getFPS(): number
  getElapsedTime(): number
  startMeasure(label: string): void
  endMeasure(label: string): number
  getAverageTime(label: string): number
  printStats(): void
  reset(): void
}
```

## Events

### Built-in Engine Events

```typescript
// When engine state changes
'stateChanged': (data: { state: EngineState }) => void

// When window is resized
'resize': (data: { width: number; height: number }) => void

// Custom events
engine.emit('customEvent', data)
```

## Examples

### Complete Game World Setup

```typescript
import { LindenEngine } from '@engine/core/Engine'
import { Entity } from '@engine/ecs/Entity'
import { Camera, Light } from '@engine/renderer/Components'

// Initialize engine
const engine = new LindenEngine({
  canvas: document.getElementById('viewport')!,
  width: 1920,
  height: 1080,
  useWebGPU: true,
})

await engine.initialize()

// Get world
const world = engine.getWorld()!

// Create camera entity
const cameraEntity = new Entity('Main Camera')
const camera = cameraEntity.addComponent(new Camera())
camera.fov = 45
world.addEntity(cameraEntity)

// Create light entity
const lightEntity = new Entity('Directional Light')
const light = lightEntity.addComponent(new Light())
light.intensity = 1
world.addEntity(lightEntity)

// Listen for events
engine.on('stateChanged', (data) => {
  console.log('Engine state changed:', data.state)
})

engine.on('resize', (data) => {
  console.log('Window resized:', data.width, data.height)
})

// Start engine
engine.start()
```

### Creating Custom System

```typescript
import { System } from '@engine/ecs/World'
import { Entity } from '@engine/ecs/Entity'

class CustomSystem extends System {
  constructor() {
    super('CustomSystem')
  }

  initialize(): void {
    console.log('CustomSystem initialized')
  }

  update(deltaTime: number): void {
    // Get all entities with specific components
    const entities = this.getEntitiesWithComponents('Transform', 'RigidBody')

    for (const entity of entities) {
      // Process entities
    }
  }

  shutdown(): void {
    console.log('CustomSystem shutdown')
  }
}

// Add to engine
const system = new CustomSystem()
world.addSystem(system)
```

### Creating Custom Script

```typescript
import { IGameScript, ScriptContext } from '@engine/scripting/ScriptSystem'

export default class MyScript implements IGameScript {
  private speed = 5

  async onInit(context: ScriptContext) {
    console.log('Script initialized:', context.entity.name)
  }

  onUpdate(deltaTime: number) {
    // Update every frame
    const transform = this.getTransform()
    transform.position.x += this.speed * deltaTime
  }

  onDestroy() {
    console.log('Script destroyed')
  }

  // Custom methods
  setSpeed(speed: number) {
    this.speed = speed
  }

  getSpeed() {
    return this.speed
  }

  private getTransform() {
    // Implementation
    return { position: { x: 0, y: 0, z: 0 } }
  }
}
```

### Performance Monitoring

```typescript
const monitor = engine.getPerformanceMonitor()

monitor.startMeasure('physics')
// ... physics code
const elapsedPhysics = monitor.endMeasure('physics')

monitor.startMeasure('rendering')
// ... render code
const elapsedRender = monitor.endMeasure('rendering')

console.log('Physics:', elapsedPhysics, 'ms')
console.log('Rendering:', elapsedRender, 'ms')
console.log('FPS:', monitor.getFPS())

monitor.printStats()
```
