import type { CurveKey, EmitterShape, GradientKey, Range } from './ParticleSim'

export const PARTICLE_PRESETS = ['fire', 'smoke', 'sparks', 'explosion', 'magic', 'rain', 'splash'] as const
export type ParticlePresetName = (typeof PARTICLE_PRESETS)[number] | 'custom'

export type ParticleBlending = 'additive' | 'normal'
export type ParticleTexture = 'soft' | 'spark' | 'smoke' | 'square'

/** The ParticleEmitter fields a preset sets */
export interface ParticlePresetValues {
  loop: boolean
  duration: number
  rate: number
  bursts: { time: number; count: number }[]
  maxParticles: number
  shape: EmitterShape
  shapeSize: { x: number; y: number; z: number }
  coneAngle: number
  lifetime: Range
  speed: Range
  gravity: number
  drag: number
  size: CurveKey[]
  color: GradientKey[]
  blending: ParticleBlending
  texture: ParticleTexture | string
  space: 'world' | 'local'
  light: { enabled: boolean; color: string; intensity: number; flicker: number }
}

const NO_LIGHT = { enabled: false, color: '#ffaa55', intensity: 2, flicker: 0 }

/** Values of a freshly added emitter ('custom') */
export const DEFAULT_PARTICLE_VALUES: ParticlePresetValues = {
  loop: true,
  duration: 2,
  rate: 30,
  bursts: [],
  maxParticles: 500,
  shape: 'cone',
  shapeSize: { x: 0.2, y: 0.2, z: 0.2 },
  coneAngle: 20,
  lifetime: { min: 0.8, max: 1.2 },
  speed: { min: 1, max: 2 },
  gravity: 0,
  drag: 0,
  size: [
    { t: 0, v: 0.2 },
    { t: 1, v: 0.2 },
  ],
  color: [
    { t: 0, color: '#ffffff', alpha: 1 },
    { t: 1, color: '#ffffff', alpha: 0 },
  ],
  blending: 'additive',
  texture: 'soft',
  space: 'world',
  light: NO_LIGHT,
}

export const PARTICLE_PRESET_VALUES: Record<(typeof PARTICLE_PRESETS)[number], ParticlePresetValues> = {
  fire: {
    ...DEFAULT_PARTICLE_VALUES,
    rate: 60,
    maxParticles: 300,
    shape: 'cone',
    shapeSize: { x: 0.25, y: 0, z: 0 },
    coneAngle: 12,
    lifetime: { min: 0.5, max: 0.9 },
    speed: { min: 0.8, max: 1.6 },
    gravity: -0.15,
    drag: 0.5,
    size: [
      { t: 0, v: 0.45 },
      { t: 0.4, v: 0.35 },
      { t: 1, v: 0.05 },
    ],
    color: [
      { t: 0, color: '#fff2a8', alpha: 0.9 },
      { t: 0.35, color: '#ff8a1f', alpha: 0.8 },
      { t: 1, color: '#7a1500', alpha: 0 },
    ],
    blending: 'additive',
    texture: 'soft',
    light: { enabled: true, color: '#ff8c3a', intensity: 6, flicker: 0.25 },
  },
  smoke: {
    ...DEFAULT_PARTICLE_VALUES,
    rate: 12,
    maxParticles: 120,
    shape: 'cone',
    shapeSize: { x: 0.3, y: 0, z: 0 },
    coneAngle: 15,
    lifetime: { min: 2.5, max: 4 },
    speed: { min: 0.4, max: 0.8 },
    gravity: -0.05,
    drag: 0.3,
    size: [
      { t: 0, v: 0.4 },
      { t: 1, v: 1.8 },
    ],
    color: [
      { t: 0, color: '#6b6b6b', alpha: 0 },
      { t: 0.15, color: '#5c5c5c', alpha: 0.45 },
      { t: 1, color: '#9a9a9a', alpha: 0 },
    ],
    blending: 'normal',
    texture: 'smoke',
  },
  sparks: {
    ...DEFAULT_PARTICLE_VALUES,
    rate: 40,
    maxParticles: 200,
    shape: 'cone',
    shapeSize: { x: 0.05, y: 0, z: 0 },
    coneAngle: 35,
    lifetime: { min: 0.4, max: 0.9 },
    speed: { min: 3, max: 6 },
    gravity: 1,
    drag: 0.4,
    size: [
      { t: 0, v: 0.06 },
      { t: 1, v: 0.02 },
    ],
    color: [
      { t: 0, color: '#fff7c2', alpha: 1 },
      { t: 0.5, color: '#ffb02e', alpha: 1 },
      { t: 1, color: '#ff4d00', alpha: 0 },
    ],
    blending: 'additive',
    texture: 'spark',
  },
  explosion: {
    ...DEFAULT_PARTICLE_VALUES,
    loop: false,
    duration: 0.2,
    rate: 0,
    bursts: [{ time: 0, count: 120 }],
    maxParticles: 160,
    shape: 'sphere',
    shapeSize: { x: 0.3, y: 0.3, z: 0.3 },
    lifetime: { min: 0.5, max: 1.1 },
    speed: { min: 3, max: 9 },
    gravity: 0.2,
    drag: 2.5,
    size: [
      { t: 0, v: 0.5 },
      { t: 0.3, v: 1.1 },
      { t: 1, v: 1.4 },
    ],
    color: [
      { t: 0, color: '#fffbe0', alpha: 1 },
      { t: 0.2, color: '#ffb340', alpha: 0.9 },
      { t: 0.6, color: '#c2380e', alpha: 0.5 },
      { t: 1, color: '#2a1a14', alpha: 0 },
    ],
    blending: 'additive',
    texture: 'soft',
    light: { enabled: true, color: '#ffb35c', intensity: 30, flicker: 0.1 },
  },
  magic: {
    ...DEFAULT_PARTICLE_VALUES,
    rate: 35,
    maxParticles: 200,
    shape: 'sphere',
    shapeSize: { x: 0.6, y: 0.6, z: 0.6 },
    lifetime: { min: 1, max: 1.8 },
    speed: { min: 0.1, max: 0.4 },
    gravity: -0.08,
    drag: 0.2,
    size: [
      { t: 0, v: 0 },
      { t: 0.2, v: 0.12 },
      { t: 1, v: 0 },
    ],
    color: [
      { t: 0, color: '#c58bff', alpha: 1 },
      { t: 0.5, color: '#6fd3ff', alpha: 0.9 },
      { t: 1, color: '#ffffff', alpha: 0 },
    ],
    blending: 'additive',
    texture: 'spark',
  },
  rain: {
    ...DEFAULT_PARTICLE_VALUES,
    rate: 400,
    maxParticles: 1500,
    shape: 'box',
    shapeSize: { x: 20, y: 0, z: 20 },
    lifetime: { min: 1.2, max: 1.2 },
    speed: { min: -12, max: -10 },
    gravity: 0,
    size: [
      { t: 0, v: 0.04 },
      { t: 1, v: 0.04 },
    ],
    color: [
      { t: 0, color: '#bcd4e6', alpha: 0.6 },
      { t: 1, color: '#bcd4e6', alpha: 0.6 },
    ],
    blending: 'normal',
    texture: 'spark',
  },
  splash: {
    ...DEFAULT_PARTICLE_VALUES,
    loop: false,
    duration: 0.1,
    rate: 0,
    bursts: [{ time: 0, count: 40 }],
    maxParticles: 60,
    shape: 'cone',
    shapeSize: { x: 0.2, y: 0, z: 0 },
    coneAngle: 30,
    lifetime: { min: 0.5, max: 0.9 },
    speed: { min: 2, max: 4 },
    gravity: 1,
    size: [
      { t: 0, v: 0.1 },
      { t: 1, v: 0.04 },
    ],
    color: [
      { t: 0, color: '#e8f6ff', alpha: 0.9 },
      { t: 1, color: '#9fd0f0', alpha: 0 },
    ],
    blending: 'normal',
    texture: 'soft',
  },
}

/** Deep copy so emitters never share the preset's arrays and objects */
export function presetValues(name: string): ParticlePresetValues {
  const src = (PARTICLE_PRESET_VALUES as Record<string, ParticlePresetValues>)[name] ?? DEFAULT_PARTICLE_VALUES
  return JSON.parse(JSON.stringify(src))
}
