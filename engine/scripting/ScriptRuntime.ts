import type { World } from '../ecs/World'
import type { Entity } from '../ecs/Entity'
import type { Script } from './ScriptComponents'
import { Input } from '../input/InputActions'
import { Physics } from '../physics/components'
import { isValidScriptSrc } from '../../shared/playProtocol'
import { NULL_TOUCH, type TouchApi } from '../input/TouchApi'
import type { ParticleEmitter } from '../vfx/ParticleEmitter'

type Vec3 = { x: number; y: number; z: number }

/** UI access for scripts; implemented by HtmlUiLayer in the browser, stubbed headless */
export interface HtmlUiApi {
  root(entityId?: string): HTMLElement | null
  query<T extends Element = Element>(selector: string): T | null
  queryAll<T extends Element = Element>(selector: string): T[]
  bind(selector: string, getter: () => string | number | boolean | null | undefined): () => void
  on(selector: string, event: string, handler: (e: Event) => void): () => void
  show(selector: string): void
  hide(selector: string): void
}

export interface TimeInfo {
  deltaTime: number
  time: number
  frameCount: number
  timeScale: number
}

export interface ScriptPhysicsApi {
  raycast: typeof Physics.raycast
  setLinearVelocity(v: Vec3): void
  getLinearVelocity(): Vec3 | null
  applyImpulse(v: Vec3): void
  /** Continuous force in newtons for the next fixed step; call it every onFixedUpdate */
  addForce(v: Vec3): void
  addTorque(v: Vec3): void
  setAngularVelocity(v: Vec3): void
  getAngularVelocity(): Vec3 | null
  /** Drive this entity's hinge (degrees/s) or slider (m/s) Joint */
  setMotor(targetVelocity: number, maxForce?: number): void
  /** Teleport this entity's body (and Transform) */
  setPosition(v: Vec3): void
}

/** Particle effects. Visual only: calls are harmless no-ops in headless play */
export interface VfxApi {
  /** Start the ParticleEmitter on `entity` (default: this script's entity) */
  play(entity?: Entity): void
  stop(entity?: Entity, opts?: { clear?: boolean }): void
  /** Emit `count` particles at once */
  burst(count: number, entity?: Entity): void
  /**
   * Create a temporary entity with a ParticleEmitter preset at `position` (world space, or local to
   * `parent`). Non-looping presets are destroyed when done unless autoDestroy is false.
   */
  spawn(
    preset: string,
    position: Vec3,
    opts?: { parent?: Entity; autoDestroy?: boolean; overrides?: Record<string, unknown> }
  ): Entity
}

export interface GameScriptContext {
  entity: Entity
  world: World
  input: typeof Input
  time: TimeInfo
  physics: ScriptPhysicsApi
  ui: HtmlUiApi
  three: any
  object3D: any
  /** The entity's CharacterMovement (state, addImpulse, teleport), or null */
  readonly movement: any
  /** On-screen touch buttons: show/hide, label, badge, cooldown, layout (no-op on desktop) */
  touch: TouchApi
  vfx: VfxApi
  scene: {
    find(name: string): Entity | null
    findByTag(tag: string): Entity[]
    load(path: string): Promise<void>
  }
  emit(eventName: string, data?: unknown): void
  on(eventName: string, handler: (data: unknown) => void): () => void
  log: (...args: unknown[]) => void
}

export type ScriptPhase =
  | 'load'
  | 'init'
  | 'fixedUpdate'
  | 'update'
  | 'lateUpdate'
  | 'event'
  | 'collision'
  | 'destroy'

export interface ScriptErrorInfo {
  entityId: string
  entityName: string
  src: string
  phase: ScriptPhase
  error: unknown
}

export interface ScriptRuntimeOptions {
  world: World
  /** Import the compiled module for a scripts/... source path */
  loadModule: (src: string) => Promise<any>
  onError?: (info: ScriptErrorInfo) => void
  createUi?: (entity: Entity) => HtmlUiApi
  getObject3D?: (entityId: string) => any
  three?: any
  loadScene?: (path: string) => Promise<void>
  log?: (...args: unknown[]) => void
  touch?: TouchApi
}

interface ScriptInstance {
  entity: Entity
  component: Script
  src: string
  script: any
  ctx: GameScriptContext
  enabled: boolean
  unsubscribers: (() => void)[]
}

const COLLIDER_TYPES = ['BoxCollider', 'SphereCollider', 'CapsuleCollider', 'MeshCollider']
const COLLISION_HOOKS = ['onTriggerEnter', 'onTriggerExit', 'onCollisionEnter', 'onCollisionExit'] as const

export const NULL_UI: HtmlUiApi = {
  root: () => null,
  query: () => null,
  queryAll: () => [],
  bind: () => () => {},
  on: () => () => {},
  show: () => {},
  hide: () => {},
}

/**
 * Runs gameplay scripts (IGameScript-shaped classes) attached through the Script component.
 * One failing script is disabled and reported; the rest of the game keeps running.
 */
export class ScriptRuntime {
  private instances: ScriptInstance[] = []
  private listeners = new Map<string, Set<(data: unknown) => void>>()
  readonly time: TimeInfo = { deltaTime: 0, time: 0, frameCount: 0, timeScale: 1 }
  readonly errors: ScriptErrorInfo[] = []
  /** Entities made by ctx.vfx.spawn, destroyed once their effect has played out */
  private vfxDeadlines: { id: string; at: number }[] = []

  private offEntityRemoved: () => void

  constructor(private options: ScriptRuntimeOptions) {
    // Scripts on destroyed entities (e.g. a collected coin) stop and get onDestroy
    this.offEntityRemoved = options.world.events.on('entityRemoved', (entity: Entity) => this.destroyFor(entity.id))
  }

  private destroyFor(entityId: string): void {
    const gone = this.instances.filter((i) => i.entity.id === entityId)
    if (gone.length === 0) return
    this.instances = this.instances.filter((i) => i.entity.id !== entityId)
    for (const inst of gone) this.destroyInstance(inst)
  }

  private destroyInstance(inst: ScriptInstance): void {
    inst.unsubscribers.forEach((fn) => fn())
    const wasEnabled = inst.enabled
    inst.enabled = false
    if (wasEnabled && typeof inst.script.onDestroy === 'function') {
      try {
        inst.script.onDestroy()
      } catch (error) {
        this.options.onError?.({ entityId: inst.entity.id, entityName: inst.entity.name, src: inst.src, phase: 'destroy', error })
      }
    }
  }

  get count(): number {
    return this.instances.length
  }

  get activeCount(): number {
    return this.instances.filter((i) => i.enabled).length
  }

  async loadAll(): Promise<void> {
    const { world } = this.options
    for (const entity of world.getEntities()) {
      const comp = entity.getComponent<Script>('Script')
      if (!comp || !comp.getEnabled() || !entity.active || !comp.src) continue
      await this.loadOne(entity, comp)
    }
    // onInit runs after every script is instantiated so scripts can find each other
    for (const inst of [...this.instances]) {
      if (typeof inst.script.onInit === 'function') {
        await this.invokeAsync(inst, 'init', () => inst.script.onInit(inst.ctx))
      }
    }
  }

  private async loadOne(entity: Entity, comp: Script): Promise<void> {
    const inst = await this.instantiate(entity, comp)
    if (inst) this.instances.push(inst)
  }

  /** Import + construct a script; null (and an error report) when it can't be created */
  private async instantiate(entity: Entity, comp: Script): Promise<ScriptInstance | null> {
    const src = comp.src
    const base = { entityId: entity.id, entityName: entity.name, src }
    if (!isValidScriptSrc(src)) {
      this.report({ ...base, phase: 'load', error: new Error(`Path script tidak valid: "${src}" (harus di dalam scripts/, .ts/.js)`) })
      return null
    }

    let mod: any
    try {
      mod = await this.options.loadModule(src)
    } catch (error) {
      this.report({ ...base, phase: 'load', error })
      return null
    }

    const exported = mod?.default
    let script: any
    try {
      if (typeof exported === 'function') {
        script = new exported()
      } else if (exported && typeof exported === 'object') {
        script = Object.create(exported)
      } else {
        throw new Error(`Script "${src}" tidak punya export default class`)
      }
      if (comp.props && typeof comp.props === 'object') Object.assign(script, comp.props)
    } catch (error) {
      this.report({ ...base, phase: 'load', error })
      return null
    }

    const unsubscribers: (() => void)[] = []
    const inst: ScriptInstance = {
      entity,
      component: comp,
      src,
      script,
      ctx: this.createContext(entity, unsubscribers),
      enabled: true,
      unsubscribers,
    }
    this.wireCollisionHooks(inst)
    return inst
  }

  /**
   * Hot reload: re-import every attached script (the loader is expected to bust its module cache),
   * carry the old instance's fields over, then call onReload(ctx) or onInit(ctx).
   * A script that fails to load keeps its previous version running.
   */
  async reload(): Promise<{ reloaded: number; failed: number }> {
    const previous = new Map(this.instances.map((i) => [i.entity.id, i]))
    const next: ScriptInstance[] = []
    const fresh: { inst: ScriptInstance; prev?: ScriptInstance }[] = []
    let failed = 0

    for (const entity of this.options.world.getEntities()) {
      const comp = entity.getComponent<Script>('Script')
      const prev = previous.get(entity.id)
      if (!comp || !comp.getEnabled() || !entity.active || !comp.src) {
        if (prev) this.destroyInstance(prev)
        continue
      }
      const inst = await this.instantiate(entity, comp)
      if (!inst) {
        failed++
        if (prev) next.push(prev)
        continue
      }
      if (prev) {
        // Keep runtime state (score, timers...) across the swap; methods come from the new class
        for (const key of Object.keys(prev.script)) {
          if (typeof prev.script[key] !== 'function') inst.script[key] = prev.script[key]
        }
        this.destroyInstance(prev)
      }
      next.push(inst)
      fresh.push({ inst, prev })
    }

    this.instances = next
    for (const { inst, prev } of fresh) {
      if (prev && typeof inst.script.onReload === 'function') {
        await this.invokeAsync(inst, 'init', () => inst.script.onReload(inst.ctx))
      } else if (typeof inst.script.onInit === 'function') {
        await this.invokeAsync(inst, 'init', () => inst.script.onInit(inst.ctx))
      }
    }
    return { reloaded: fresh.length, failed }
  }

  private createContext(entity: Entity, disposables: (() => void)[]): GameScriptContext {
    // Subscriptions made through ctx are released when the instance is destroyed or reloaded
    const track = (off: () => void) => {
      disposables.push(off)
      return off
    }
    const baseUi = this.options.createUi?.(entity) ?? NULL_UI
    const ui: HtmlUiApi = {
      ...baseUi,
      bind: (selector, getter) => track(baseUi.bind(selector, getter)),
      on: (selector, event, handler) => track(baseUi.on(selector, event, handler)),
    }
    const { world } = this.options
    const backend = () => Physics.getBackend()
    const log = this.options.log ?? ((...args: unknown[]) => console.log(`[${entity.name}]`, ...args))
    return {
      entity,
      world,
      input: Input,
      time: this.time,
      physics: {
        raycast: (...args: Parameters<typeof Physics.raycast>) => Physics.raycast(...args),
        setLinearVelocity: (v) => backend()?.setLinearVelocity?.(entity.id, v),
        getLinearVelocity: () => backend()?.getLinearVelocity?.(entity.id) ?? null,
        applyImpulse: (v) => backend()?.applyImpulse?.(entity.id, v),
        addForce: (v) => backend()?.addForce?.(entity.id, v),
        addTorque: (v) => backend()?.addTorque?.(entity.id, v),
        setAngularVelocity: (v) => backend()?.setAngularVelocity?.(entity.id, v),
        getAngularVelocity: () => backend()?.getAngularVelocity?.(entity.id) ?? null,
        setMotor: (targetVelocity, maxForce) => {
          backend()?.setJointMotor?.(entity.id, targetVelocity, maxForce)
        },
        setPosition: (v) => {
          backend()?.setTranslation?.(entity.id, v)
          const t = entity.getTransform()
          t.position = { x: v.x, y: v.y, z: v.z }
        },
      },
      ui,
      three: this.options.three,
      object3D: null,
      touch: this.options.touch ?? NULL_TOUCH,
      vfx: this.createVfx(entity),
      get movement() {
        return entity.getComponent('CharacterMovement') ?? null
      },
      scene: {
        find: (name) => world.getEntities().find((e) => e.name === name) ?? null,
        findByTag: (tag) => world.findByTag(tag),
        load: async (path) => {
          if (!this.options.loadScene) throw new Error('scene.load tidak tersedia di runtime ini')
          await this.options.loadScene(path)
        },
      },
      emit: (eventName, data) => this.emit(eventName, data),
      on: (eventName, handler) => {
        if (!this.listeners.has(eventName)) this.listeners.set(eventName, new Set())
        this.listeners.get(eventName)!.add(handler)
        return track(() => {
          this.listeners.get(eventName)?.delete(handler)
        })
      },
      log,
    }
  }

  private createVfx(self: Entity): VfxApi {
    const { world } = this.options
    const emitter = (entity?: Entity) => (entity ?? self).getComponent('ParticleEmitter') as ParticleEmitter | undefined
    return {
      play: (entity) => emitter(entity)?.play(),
      stop: (entity, opts) => emitter(entity)?.stop(opts),
      burst: (count, entity) => emitter(entity)?.burst(count),
      spawn: (preset, position, opts = {}) => {
        const fx = world.createEntity(`vfx:${preset}`, opts.parent?.id ?? null)
        fx.getTransform().position = { x: position.x, y: position.y, z: position.z }
        // preset first: it fills the fields the overrides then change
        const comp = world.addComponent(fx.id, 'ParticleEmitter', { preset, ...opts.overrides }) as unknown as ParticleEmitter
        if (opts.autoDestroy !== false && !comp.loop) {
          const cfg = comp.toConfig()
          this.vfxDeadlines.push({ id: fx.id, at: this.time.time + cfg.duration + cfg.lifetime.max + 0.1 })
        }
        return fx
      },
    }
  }

  private wireCollisionHooks(inst: ScriptInstance): void {
    // object3D is resolved lazily: the bridge may create it after scripts load
    const getObject3D = this.options.getObject3D
    if (getObject3D) {
      Object.defineProperty(inst.ctx, 'object3D', { get: () => getObject3D(inst.entity.id) ?? null, configurable: true })
    }

    for (const type of COLLIDER_TYPES) {
      const collider: any = inst.entity.getComponent(type)
      if (!collider) continue
      for (const hook of COLLISION_HOOKS) {
        const field = collider[hook]
        if (!field || typeof field.on !== 'function') continue
        inst.unsubscribers.push(
          field.on((other: Entity) => {
            if (inst.enabled && typeof inst.script[hook] === 'function') {
              this.invoke(inst, 'collision', () => inst.script[hook](other))
            }
          })
        )
      }
    }
  }

  fixedUpdate(dt: number): void {
    for (const inst of this.instances) {
      if (inst.enabled && typeof inst.script.onFixedUpdate === 'function') {
        this.invoke(inst, 'fixedUpdate', () => inst.script.onFixedUpdate(dt))
      }
    }
  }

  update(dt: number): void {
    this.time.deltaTime = dt
    this.time.time += dt
    this.time.frameCount++
    if (this.vfxDeadlines.length > 0) {
      const now = this.time.time
      const due = this.vfxDeadlines.filter((d) => d.at <= now)
      this.vfxDeadlines = this.vfxDeadlines.filter((d) => d.at > now)
      for (const d of due) if (this.options.world.getEntity(d.id)) this.options.world.destroyEntity(d.id)
    }
    for (const inst of this.instances) {
      if (inst.enabled && inst.component.getEnabled() && typeof inst.script.onUpdate === 'function') {
        this.invoke(inst, 'update', () => inst.script.onUpdate(dt))
      }
    }
  }

  lateUpdate(dt: number): void {
    for (const inst of this.instances) {
      if (inst.enabled && typeof inst.script.onLateUpdate === 'function') {
        this.invoke(inst, 'lateUpdate', () => inst.script.onLateUpdate(dt))
      }
    }
  }

  /** Call a hook (e.g. onJump) on the scripts of one entity */
  notifyEntity(entityId: string, hook: string, ...args: unknown[]): void {
    for (const inst of this.instances) {
      if (inst.enabled && inst.entity.id === entityId && typeof inst.script[hook] === 'function') {
        this.invoke(inst, 'event', () => inst.script[hook](...args))
      }
    }
  }

  emit(eventName: string, data?: unknown): void {
    for (const handler of this.listeners.get(eventName) ?? []) {
      try {
        handler(data)
      } catch (error) {
        this.options.onError?.({ entityId: '', entityName: '', src: '', phase: 'event', error })
      }
    }
    for (const inst of this.instances) {
      if (inst.enabled && typeof inst.script.onEvent === 'function') {
        this.invoke(inst, 'event', () => inst.script.onEvent(eventName, data))
      }
    }
  }

  destroyAll(): void {
    const all = this.instances
    this.instances = []
    for (const inst of all) this.destroyInstance(inst)
    this.listeners.clear()
    this.offEntityRemoved()
  }

  private invoke(inst: ScriptInstance, phase: ScriptPhase, fn: () => unknown): void {
    try {
      const res = fn()
      if (res && typeof (res as Promise<unknown>).catch === 'function') {
        ;(res as Promise<unknown>).catch((error) => this.fail(inst, phase, error))
      }
    } catch (error) {
      this.fail(inst, phase, error)
    }
  }

  private async invokeAsync(inst: ScriptInstance, phase: ScriptPhase, fn: () => unknown): Promise<void> {
    try {
      await fn()
    } catch (error) {
      this.fail(inst, phase, error)
    }
  }

  private fail(inst: ScriptInstance, phase: ScriptPhase, error: unknown): void {
    if (!inst.enabled) return
    inst.enabled = false
    this.report({ entityId: inst.entity.id, entityName: inst.entity.name, src: inst.src, phase, error })
  }

  private report(info: ScriptErrorInfo): void {
    this.errors.push(info)
    this.options.onError?.(info)
  }
}

export function formatScriptError(info: ScriptErrorInfo): string {
  const err = info.error as any
  const msg = err?.message ?? String(err)
  const where = info.src ? `${info.src} (${info.entityName}, ${info.phase})` : info.phase
  return `${where}: ${msg}${info.phase === 'load' || info.phase === 'event' ? '' : ' — script dinonaktifkan'}`
}
