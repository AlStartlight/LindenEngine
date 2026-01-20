# Best Practices & Performance Guide

## 🎯 Design Patterns

### 1. Proper Component Usage

❌ **Bad: Large monolithic component**
```typescript
class PlayerComponent extends Component {
  health: number
  armor: number
  weapons: Weapon[]
  position: Vector3
  velocity: Vector3
  speed: number
  jumpForce: number
  // ... 100+ properties
}
```

✅ **Good: Composition with multiple components**
```typescript
entity.addComponent(new Health(100, 100))
entity.addComponent(new Armor(50))
entity.addComponent(new Inventory([weapon1, weapon2]))
entity.addComponent(new Transform())
entity.addComponent(new Movement(5))
entity.addComponent(new JumpAbility(10))
```

### 2. System Queries

❌ **Bad: Iterating all entities**
```typescript
update(deltaTime: number) {
  for (const entity of this.world.getEntities()) {
    if (entity.hasComponent('RigidBody') && entity.hasComponent('Transform')) {
      // Process
    }
  }
}
```

✅ **Good: Query specific entities**
```typescript
update(deltaTime: number) {
  const entities = this.getEntitiesWithComponents('RigidBody', 'Transform')
  for (const entity of entities) {
    // Process
  }
}
```

### 3. Event-Driven Architecture

❌ **Bad: Polling**
```typescript
onUpdate() {
  if (this.isAlive && this.health <= 0) {
    this.die()
  }
}
```

✅ **Good: Event-based**
```typescript
constructor() {
  this.health.on('depleted', () => this.die())
}
```

## 📊 Performance Optimization

### 1. Object Pooling

```typescript
class EntityPool {
  private available: Entity[] = []
  private inUse: Set<Entity> = new Set()

  acquire(name: string): Entity {
    let entity = this.available.pop()
    if (!entity) {
      entity = new Entity(name)
    }
    entity.isActive = true
    this.inUse.add(entity)
    return entity
  }

  release(entity: Entity): void {
    entity.isActive = false
    this.inUse.delete(entity)
    this.available.push(entity)
  }

  size(): number {
    return this.inUse.size
  }
}
```

### 2. Spatial Partitioning (Quadtree)

```typescript
class Quadtree {
  private maxObjects = 10
  private maxLevels = 4
  private level: number
  private bounds: AABB
  private objects: Entity[] = []
  private children: Quadtree[] = []

  retrieve(target: AABB): Entity[] {
    const candidates: Entity[] = []
    this.getOverlapping(target, candidates)
    return candidates
  }

  private getOverlapping(target: AABB, result: Entity[]) {
    if (!this.bounds.overlaps(target)) return

    for (const obj of this.objects) {
      if (target.overlaps(obj.getBounds())) {
        result.push(obj)
      }
    }

    for (const child of this.children) {
      child.getOverlapping(target, result)
    }
  }
}
```

### 3. Level of Detail (LOD)

```typescript
class LODManager {
  updateLOD(entity: Entity, cameraPosition: Vector3): void {
    const distance = Vector3Utils.distance(
      entity.getTransform().position,
      cameraPosition
    )

    const renderer = entity.getComponent<MeshRenderer>('MeshRenderer')
    if (!renderer) return

    if (distance < 10) {
      renderer.meshId = 'model_high_detail'
    } else if (distance < 50) {
      renderer.meshId = 'model_medium_detail'
    } else if (distance < 200) {
      renderer.meshId = 'model_low_detail'
    } else {
      renderer.isVisible = false
    }
  }
}
```

### 4. Frustum Culling

```typescript
class FrustumCuller {
  private frustum: Frustum

  updateFrustum(camera: Camera): void {
    // Update frustum based on camera
  }

  isCulled(entity: Entity): boolean {
    const bounds = entity.getComponent<Renderer>('MeshRenderer')?.getBounds()
    if (!bounds) return true
    return !this.frustum.intersects(bounds)
  }

  cull(entities: Entity[]): Entity[] {
    return entities.filter((e) => !this.isCulled(e))
  }
}
```

### 5. Dirty Flag Pattern

```typescript
class TransformCache {
  private matrix: Matrix4 | null = null
  private isDirty = true

  setPosition(x: number, y: number, z: number): void {
    this.position = { x, y, z }
    this.isDirty = true
  }

  getMatrix(): Matrix4 {
    if (this.isDirty) {
      this.matrix = this.calculateMatrix()
      this.isDirty = false
    }
    return this.matrix!
  }

  private calculateMatrix(): Matrix4 {
    // Heavy calculation
    return new Matrix4()
  }
}
```

## 🛡️ Memory Management

### 1. Memory Monitoring

```typescript
class MemoryMonitor {
  private samples: number[] = []
  private maxSamples = 100

  update(): void {
    if (performance.memory) {
      this.samples.push(performance.memory.usedJSHeapSize)
      if (this.samples.length > this.maxSamples) {
        this.samples.shift()
      }
    }
  }

  getAverageMemory(): number {
    if (this.samples.length === 0) return 0
    const sum = this.samples.reduce((a, b) => a + b, 0)
    return sum / this.samples.length
  }

  getMemoryTrend(): 'increasing' | 'stable' | 'decreasing' {
    if (this.samples.length < 2) return 'stable'
    const recent = this.samples.slice(-10)
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length
    const first = recent[0]
    const last = recent[recent.length - 1]

    if (last > first * 1.1) return 'increasing'
    if (last < first * 0.9) return 'decreasing'
    return 'stable'
  }
}
```

### 2. Asset Cache Management

```typescript
class AssetCache {
  private cache: Map<string, Asset> = new Map()
  private maxSize = 100 * 1024 * 1024 // 100MB
  private currentSize = 0

  set(key: string, asset: Asset): void {
    // Check if asset exists
    if (this.cache.has(key)) {
      return
    }

    // Evict LRU items if needed
    while (this.currentSize + asset.size > this.maxSize && this.cache.size > 0) {
      const oldest = this.getOldestAsset()!
      this.remove(oldest.key)
    }

    this.cache.set(key, asset)
    this.currentSize += asset.size
    asset.lastAccessed = Date.now()
  }

  get(key: string): Asset | undefined {
    const asset = this.cache.get(key)
    if (asset) {
      asset.lastAccessed = Date.now()
    }
    return asset
  }

  private getOldestAsset(): { key: string; asset: Asset } | null {
    let oldest: { key: string; asset: Asset } | null = null
    for (const [key, asset] of this.cache.entries()) {
      if (!oldest || asset.lastAccessed < oldest.asset.lastAccessed) {
        oldest = { key, asset }
      }
    }
    return oldest
  }

  private remove(key: string): void {
    const asset = this.cache.get(key)
    if (asset) {
      this.currentSize -= asset.size
      this.cache.delete(key)
    }
  }
}
```

## 🔄 Code Organization

### 1. Module Structure

```
engine/
├── core/
│   ├── Engine.ts          # Main engine class
│   └── Plugin.ts          # Plugin interface
├── ecs/
│   ├── Component.ts       # Base component class
│   ├── Entity.ts          # Entity class
│   ├── World.ts           # World & system classes
│   └── index.ts           # Export all
├── renderer/
│   ├── Renderer.ts        # Renderer abstraction
│   ├── Components.ts      # Renderer components
│   └── index.ts
└── utils/
    └── index.ts           # All utilities
```

### 2. Dependency Injection

```typescript
interface Services {
  engine: LindenEngine
  world: World
  renderer: Renderer
  scriptManager: ScriptManager
}

class MySystem extends System {
  constructor(private services: Services) {
    super('MySystem')
  }

  update(deltaTime: number): void {
    const camera = this.services.world.getEntity('camera')
    // Use services
  }
}
```

### 3. Lazy Loading

```typescript
class LazyAsset<T> {
  private asset: T | null = null
  private isLoading = false

  constructor(private loader: () => Promise<T>) {}

  async get(): Promise<T> {
    if (this.asset) return this.asset
    if (this.isLoading) return new Promise((resolve) => {
      // Wait for loading to complete
    })

    this.isLoading = true
    this.asset = await this.loader()
    this.isLoading = false
    return this.asset
  }
}
```

## 🧪 Testing

### 1. Unit Testing Systems

```typescript
describe('PhysicsSystem', () => {
  let system: PhysicsSystem
  let world: World

  beforeEach(() => {
    world = new World()
    system = new PhysicsSystem()
    world.addSystem(system)
  })

  it('should apply gravity', () => {
    const entity = new Entity('test')
    entity.addComponent(new RigidBody())
    world.addEntity(entity)

    system.update(0.016) // 60 FPS delta

    const rb = entity.getComponent<RigidBody>('RigidBody')
    expect(rb.velocity.y).toBeLessThan(0) // Velocity should decrease due to gravity
  })
})
```

### 2. Integration Testing

```typescript
describe('Engine', () => {
  let engine: LindenEngine

  beforeEach(async () => {
    engine = new LindenEngine({
      canvas: document.createElement('canvas'),
    })
    await engine.initialize()
  })

  it('should run game loop', async () => {
    const world = engine.getWorld()!
    const entity = new Entity('test')
    world.addEntity(entity)

    let updateCalled = false
    entity.addComponent(
      new (class extends Component {
        name = 'TestComponent'
        onUpdate() {
          updateCalled = true
        }
      })(),
    )

    engine.start()
    await new Promise((resolve) => setTimeout(resolve, 50))
    engine.stop()

    expect(updateCalled).toBe(true)
  })
})
```

## 📋 Code Style Guidelines

### 1. Naming Conventions

```typescript
// Classes: PascalCase
class PlayerController {}

// Functions/Variables: camelCase
function getPlayerHealth() {}
const playerSpeed = 5

// Constants: UPPER_SNAKE_CASE
const MAX_PLAYER_HEALTH = 100

// Private members: underscore prefix
class Entity {
  private _components: Map<string, Component> = new Map()
}

// Interfaces: prefix with I
interface IRenderable {
  render(): void
}
```

### 2. Comments

```typescript
/**
 * Calculate distance between two points
 * @param a First point
 * @param b Second point
 * @returns Distance in units
 */
function distance(a: Vector3, b: Vector3): number {
  // Implementation
}

// TODO: Implement collision response
// FIXME: Memory leak in script reload
// HACK: Temporary solution, needs refactor
```

### 3. Error Handling

```typescript
async loadScript(path: string): Promise<void> {
  try {
    const module = await import(path)
    this.script = new module.default()
  } catch (error) {
    Logger.error(`Failed to load script: ${path}`, error)
    throw new ScriptLoadError(path, error)
  }
}
```

## 🚀 Deployment

### 1. Build Optimization

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    minify: 'terser',
    target: 'ES2020',
    sourcemap: false, // Disable in production
    rollupOptions: {
      output: {
        manualChunks: {
          'three': ['three'],
          'ui': ['react', 'react-dom'],
          'engine': ['./engine'],
        }
      }
    }
  }
})
```

### 2. Asset Optimization

- Use WebP for textures
- Compress meshes with Draco
- Generate LOD meshes offline
- Pre-compile shaders

### 3. Performance Targets

- FPS: 60+ (desktop)
- Load time: < 3 seconds
- Memory: < 500MB
- Bundle size: < 10MB (gzipped)
