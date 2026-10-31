import { Component } from '../ecs/Component'
import { EventField } from '../events/EventField'
import type { CurveKey, EmitterShape, GradientKey, ParticleConfig, Range } from './ParticleSim'
import { DEFAULT_PARTICLE_VALUES, presetValues, type ParticleBlending, type ParticlePresetName } from './presets'

type Vec3 = { x: number; y: number; z: number }

export type EmitterCommand = { kind: 'play' } | { kind: 'stop'; clear: boolean } | { kind: 'burst'; count: number }

/**
 * Particle VFX (fire, smoke, sparks...). Visual only: SceneBridge simulates and draws it, headless
 * play never does, so gameplay must not depend on particles. Setting `preset` overwrites the
 * fields below with that preset's values; fields set afterwards (scene data, Inspector) win.
 */
export class ParticleEmitter extends Component {
  declare preset: ParticlePresetName
  public playOnStart: boolean = true
  public loop: boolean = DEFAULT_PARTICLE_VALUES.loop
  public duration: number = DEFAULT_PARTICLE_VALUES.duration
  public rate: number = DEFAULT_PARTICLE_VALUES.rate
  public bursts: { time: number; count: number }[] = []
  public maxParticles: number = DEFAULT_PARTICLE_VALUES.maxParticles
  public shape: EmitterShape = DEFAULT_PARTICLE_VALUES.shape
  public shapeSize: Vec3 = { ...DEFAULT_PARTICLE_VALUES.shapeSize }
  public coneAngle: number = DEFAULT_PARTICLE_VALUES.coneAngle
  public lifetime: Range = { ...DEFAULT_PARTICLE_VALUES.lifetime }
  public speed: Range = { ...DEFAULT_PARTICLE_VALUES.speed }
  public gravity: number = DEFAULT_PARTICLE_VALUES.gravity
  public drag: number = DEFAULT_PARTICLE_VALUES.drag
  public size: CurveKey[] = DEFAULT_PARTICLE_VALUES.size.map((k) => ({ ...k }))
  public color: GradientKey[] = DEFAULT_PARTICLE_VALUES.color.map((k) => ({ ...k }))
  public blending: ParticleBlending = DEFAULT_PARTICLE_VALUES.blending
  /** soft | spark | smoke | square, or a project texture path (assets/...) */
  public texture: string = DEFAULT_PARTICLE_VALUES.texture
  /** world: particles stay where they were emitted (trails); local: they move with the entity */
  public space: 'world' | 'local' = DEFAULT_PARTICLE_VALUES.space
  /** 0 = different every play; fixed seed = same pattern every time */
  public seed: number = 0
  public light = { ...DEFAULT_PARTICLE_VALUES.light }
  /** Non-looping emitter finished: no more emission and the last particle died */
  public onFinished = new EventField()

  // Runtime state (underscore: not serialized)
  _preset: ParticlePresetName = 'custom'
  /** Script commands for the renderer (SceneBridge); only queued while one is attached */
  _commands: EmitterCommand[] = []
  _attached = false

  constructor() {
    super('ParticleEmitter')
    // Own enumerable accessor so the serializer saves it; World.addComponent applies `preset`
    // before the other saved fields, which then override the preset's values
    Object.defineProperty(this, 'preset', {
      enumerable: true,
      configurable: true,
      get: () => this._preset,
      set: (name: ParticlePresetName) => this.applyPreset(name),
    })
  }

  applyPreset(name: ParticlePresetName): void {
    this._preset = name
    if (name === 'custom') return
    Object.assign(this, presetValues(name))
  }

  play(): void {
    if (this._attached) this._commands.push({ kind: 'play' })
  }

  stop(opts: { clear?: boolean } = {}): void {
    if (this._attached) this._commands.push({ kind: 'stop', clear: !!opts.clear })
  }

  burst(count: number): void {
    if (this._attached) this._commands.push({ kind: 'burst', count })
  }

  /** Simulation settings, validated and clamped to the quality cap */
  toConfig(maxParticlesCap = Infinity): ParticleConfig {
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
    const range = (r: Range | undefined, d: Range): Range => {
      const min = num(r?.min, d.min)
      const max = num(r?.max, d.max)
      return { min: Math.min(min, max), max: Math.max(min, max) }
    }
    const keys = <T extends { t: number }>(arr: T[] | undefined, d: T[]): T[] =>
      (Array.isArray(arr) && arr.length > 0 ? arr : d).filter((k) => k && Number.isFinite(k.t)).sort((a, b) => a.t - b.t)
    const d = DEFAULT_PARTICLE_VALUES
    return {
      loop: this.loop !== false,
      duration: Math.max(num(this.duration, d.duration), 0.01),
      rate: Math.max(num(this.rate, d.rate), 0),
      bursts: (Array.isArray(this.bursts) ? this.bursts : []).filter((b) => b && Number.isFinite(b.time) && b.count > 0),
      maxParticles: Math.max(1, Math.min(Math.floor(num(this.maxParticles, d.maxParticles)), maxParticlesCap)),
      shape: (['point', 'sphere', 'box', 'cone'] as const).includes(this.shape) ? this.shape : d.shape,
      shapeSize: { x: num(this.shapeSize?.x, 0), y: num(this.shapeSize?.y, 0), z: num(this.shapeSize?.z, 0) },
      coneAngle: num(this.coneAngle, d.coneAngle),
      lifetime: range(this.lifetime, d.lifetime),
      speed: range(this.speed, d.speed),
      gravity: num(this.gravity, 0),
      drag: Math.max(num(this.drag, 0), 0),
      size: keys(this.size, d.size),
      color: keys(this.color, d.color),
      seed: Math.floor(num(this.seed, 0)),
    }
  }

  clone(): ParticleEmitter {
    const c = new ParticleEmitter()
    c._preset = this._preset
    c.playOnStart = this.playOnStart
    c.loop = this.loop
    c.duration = this.duration
    c.rate = this.rate
    c.bursts = this.bursts.map((b) => ({ ...b }))
    c.maxParticles = this.maxParticles
    c.shape = this.shape
    c.shapeSize = { ...this.shapeSize }
    c.coneAngle = this.coneAngle
    c.lifetime = { ...this.lifetime }
    c.speed = { ...this.speed }
    c.gravity = this.gravity
    c.drag = this.drag
    c.size = this.size.map((k) => ({ ...k }))
    c.color = this.color.map((k) => ({ ...k }))
    c.blending = this.blending
    c.texture = this.texture
    c.space = this.space
    c.seed = this.seed
    c.light = { ...this.light }
    c.onFinished = this.onFinished.clone()
    return c
  }
}
