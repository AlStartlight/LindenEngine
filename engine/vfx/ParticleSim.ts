import { mulberry32 } from '../utils/random'

type Vec3 = { x: number; y: number; z: number }
export type Range = { min: number; max: number }
export type EmitterShape = 'point' | 'sphere' | 'box' | 'cone'
export type CurveKey = { t: number; v: number }
export type GradientKey = { t: number; color: string; alpha: number }

/** Everything ParticleSim needs; ParticleEmitter fields after preset and validation */
export interface ParticleConfig {
  loop: boolean
  duration: number
  rate: number
  bursts: { time: number; count: number }[]
  maxParticles: number
  shape: EmitterShape
  shapeSize: Vec3
  coneAngle: number
  lifetime: Range
  speed: Range
  gravity: number
  drag: number
  size: CurveKey[]
  color: GradientKey[]
  seed: number
}

/** Emitter pose: spawn origin and orientation (world space emitters) */
export interface Pose {
  position: Vec3
  quaternion: { x: number; y: number; z: number; w: number }
}

const IDENTITY: Pose = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } }
const GRAVITY = 9.81

/**
 * CPU particle simulation with struct-of-arrays storage. No three.js: it runs in tests and could
 * run in a worker. Alive particles are packed at [0, count); dead ones are swap-removed.
 */
export class ParticleSim {
  readonly capacity: number
  count = 0
  /** Seconds into the current loop */
  time = 0
  playing = false
  readonly px: Float32Array
  readonly py: Float32Array
  readonly pz: Float32Array
  readonly vx: Float32Array
  readonly vy: Float32Array
  readonly vz: Float32Array
  readonly age: Float32Array
  readonly life: Float32Array
  /** Per-particle size multiplier (0.75..1.25) so particles are not identical */
  readonly sizeJitter: Float32Array
  private emitAccum = 0
  private random: () => number
  private started = false
  private finishedReported = false

  constructor(readonly config: ParticleConfig, capacity = config.maxParticles) {
    this.capacity = Math.max(1, Math.floor(capacity))
    const n = this.capacity
    this.px = new Float32Array(n)
    this.py = new Float32Array(n)
    this.pz = new Float32Array(n)
    this.vx = new Float32Array(n)
    this.vy = new Float32Array(n)
    this.vz = new Float32Array(n)
    this.age = new Float32Array(n)
    this.life = new Float32Array(n)
    this.sizeJitter = new Float32Array(n)
    this.random = mulberry32(config.seed || Math.floor(Math.random() * 2 ** 31))
  }

  play(): void {
    this.playing = true
    this.started = true
    this.finishedReported = false
    this.time = 0
    this.emitAccum = 0
  }

  stop(clear = false): void {
    this.playing = false
    if (clear) this.count = 0
  }

  /** Spawn n particles now (ignores rate and duration) */
  burst(n: number, pose: Pose = IDENTITY): void {
    this.started = true
    this.finishedReported = false
    this.spawn(Math.max(0, Math.floor(n)), pose)
  }

  /**
   * Advance by dt seconds. Returns true once when a non-looping emitter has stopped and its
   * last particle died (ParticleEmitter.onFinished).
   */
  step(dt: number, pose: Pose = IDENTITY): boolean {
    if (dt <= 0) return false
    if (this.playing) this.emit(dt, pose)
    this.integrate(dt)
    if (this.started && !this.playing && this.count === 0 && !this.finishedReported) {
      this.finishedReported = true
      return true
    }
    return false
  }

  private emit(dt: number, pose: Pose): void {
    const cfg = this.config
    const duration = Math.max(cfg.duration, 1e-3)
    let remaining = dt
    // Split the step at loop boundaries so bursts and rate stay exact across the wrap
    while (remaining > 0 && this.playing) {
      const start = this.time
      const span = Math.min(remaining, duration - start)
      const end = start + span
      for (const b of cfg.bursts) {
        if (b.time >= start && b.time < end) this.spawn(b.count, pose)
      }
      this.emitAccum += cfg.rate * span
      const n = Math.floor(this.emitAccum)
      this.emitAccum -= n
      this.spawn(n, pose)
      this.time = end
      remaining -= span
      if (this.time >= duration - 1e-9) {
        if (cfg.loop) this.time = 0
        else this.playing = false
      }
    }
  }

  private spawn(n: number, pose: Pose): void {
    const cfg = this.config
    const q = pose.quaternion
    for (let k = 0; k < n && this.count < this.capacity; k++) {
      const i = this.count++
      const { offset, dir } = this.sampleShape()
      const o = rotate(offset, q)
      const d = rotate(dir, q)
      const speed = lerp(cfg.speed.min, cfg.speed.max, this.random())
      this.px[i] = pose.position.x + o.x
      this.py[i] = pose.position.y + o.y
      this.pz[i] = pose.position.z + o.z
      this.vx[i] = d.x * speed
      this.vy[i] = d.y * speed
      this.vz[i] = d.z * speed
      this.age[i] = 0
      this.life[i] = Math.max(lerp(cfg.lifetime.min, cfg.lifetime.max, this.random()), 1e-3)
      this.sizeJitter[i] = 0.75 + this.random() * 0.5
    }
  }

  /** Spawn offset and unit direction in emitter space (+Y is "up/forward" for cones and boxes) */
  private sampleShape(): { offset: Vec3; dir: Vec3 } {
    const cfg = this.config
    const r = this.random
    switch (cfg.shape) {
      case 'sphere': {
        const dir = randomUnit(r)
        const radius = cfg.shapeSize.x * Math.cbrt(r())
        return { offset: { x: dir.x * radius, y: dir.y * radius, z: dir.z * radius }, dir }
      }
      case 'box':
        return {
          offset: { x: (r() - 0.5) * cfg.shapeSize.x, y: (r() - 0.5) * cfg.shapeSize.y, z: (r() - 0.5) * cfg.shapeSize.z },
          dir: { x: 0, y: 1, z: 0 },
        }
      case 'cone': {
        const angle = (Math.min(Math.max(cfg.coneAngle, 0), 180) * Math.PI) / 180
        // Uniform over the spherical cap around +Y
        const cosT = 1 - r() * (1 - Math.cos(angle))
        const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT))
        const phi = r() * Math.PI * 2
        const radius = cfg.shapeSize.x * Math.sqrt(r())
        const a = r() * Math.PI * 2
        return {
          offset: { x: Math.cos(a) * radius, y: 0, z: Math.sin(a) * radius },
          dir: { x: sinT * Math.cos(phi), y: cosT, z: sinT * Math.sin(phi) },
        }
      }
      case 'point':
      default:
        return { offset: { x: 0, y: 0, z: 0 }, dir: randomUnit(r) }
    }
  }

  private integrate(dt: number): void {
    const g = GRAVITY * this.config.gravity * dt
    const damp = Math.max(0, 1 - this.config.drag * dt)
    let i = 0
    while (i < this.count) {
      this.age[i] += dt
      if (this.age[i] >= this.life[i]) {
        this.kill(i)
        continue
      }
      this.vy[i] -= g
      this.vx[i] *= damp
      this.vy[i] *= damp
      this.vz[i] *= damp
      this.px[i] += this.vx[i] * dt
      this.py[i] += this.vy[i] * dt
      this.pz[i] += this.vz[i] * dt
      i++
    }
  }

  private kill(i: number): void {
    const last = --this.count
    if (i === last) return
    this.px[i] = this.px[last]
    this.py[i] = this.py[last]
    this.pz[i] = this.pz[last]
    this.vx[i] = this.vx[last]
    this.vy[i] = this.vy[last]
    this.vz[i] = this.vz[last]
    this.age[i] = this.age[last]
    this.life[i] = this.life[last]
    this.sizeJitter[i] = this.sizeJitter[last]
  }
}

/** Piecewise-linear curve over normalized lifetime */
export function sampleCurve(keys: CurveKey[], t: number): number {
  if (keys.length === 0) return 1
  if (t <= keys[0].t) return keys[0].v
  for (let k = 1; k < keys.length; k++) {
    if (t <= keys[k].t) {
      const a = keys[k - 1]
      const b = keys[k]
      return lerp(a.v, b.v, (t - a.t) / Math.max(b.t - a.t, 1e-6))
    }
  }
  return keys[keys.length - 1].v
}

export type Rgba = { r: number; g: number; b: number; a: number }
type ParsedKey = { t: number; r: number; g: number; b: number; a: number }

/** Colour keys pre-parsed to linear 0..1 floats, the space three expects for instance colours */
export function parseGradient(keys: GradientKey[]): ParsedKey[] {
  return keys.map((k) => {
    const hex = /^#[0-9a-f]{6}$/i.test(k.color) ? k.color : '#ffffff'
    const n = parseInt(hex.slice(1), 16)
    const alpha = Number.isFinite(k.alpha) ? k.alpha : 1
    return { t: k.t, r: srgbToLinear(((n >> 16) & 255) / 255), g: srgbToLinear(((n >> 8) & 255) / 255), b: srgbToLinear((n & 255) / 255), a: alpha }
  })
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

export function sampleGradient(keys: ParsedKey[], t: number, out: Rgba): Rgba {
  if (keys.length === 0) {
    out.r = out.g = out.b = out.a = 1
    return out
  }
  let a = keys[0]
  let b = keys[keys.length - 1]
  if (t <= a.t) b = a
  else if (t >= b.t) a = b
  else {
    for (let k = 1; k < keys.length; k++) {
      if (t <= keys[k].t) {
        a = keys[k - 1]
        b = keys[k]
        break
      }
    }
  }
  const f = b === a ? 0 : (t - a.t) / Math.max(b.t - a.t, 1e-6)
  out.r = lerp(a.r, b.r, f)
  out.g = lerp(a.g, b.g, f)
  out.b = lerp(a.b, b.b, f)
  out.a = lerp(a.a, b.a, f)
  return out
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function randomUnit(r: () => number): Vec3 {
  const z = r() * 2 - 1
  const phi = r() * Math.PI * 2
  const s = Math.sqrt(1 - z * z)
  return { x: s * Math.cos(phi), y: z, z: s * Math.sin(phi) }
}

function rotate(v: Vec3, q: { x: number; y: number; z: number; w: number }): Vec3 {
  // v' = v + 2w(q × v) + 2 q × (q × v)
  const tx = 2 * (q.y * v.z - q.z * v.y)
  const ty = 2 * (q.z * v.x - q.x * v.z)
  const tz = 2 * (q.x * v.y - q.y * v.x)
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  }
}
