import { z } from 'zod'

/**
 * Per-scene render settings stored in `.lscene` v2 under `settings`. Shared by the editor viewport,
 * the player and the web export so a scene looks the same everywhere (engine/renderer/sceneFactory.ts).
 * Unknown keys (e.g. touchLayout) pass through untouched.
 */

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/)

export const ToneMappingKind = z.enum(['none', 'linear', 'reinhard', 'aces', 'agx', 'neutral'])
export const ShadowQuality = z.enum(['off', 'low', 'medium', 'high'])
export const QualityProfile = z.enum(['low', 'medium', 'high'])

export const PostFxSchema = z.object({
  enabled: z.boolean().default(false),
  ao: z.boolean().default(true),
  aoIntensity: z.number().min(0).max(4).default(1),
  bloom: z.boolean().default(false),
  bloomStrength: z.number().min(0).max(3).default(0.4),
  bloomThreshold: z.number().min(0).max(10).default(0.9),
  bloomRadius: z.number().min(0).max(1).default(0.4),
  antialias: z.enum(['none', 'fxaa', 'smaa']).default('smaa'),
})

export const FogSchema = z.object({
  enabled: z.boolean().default(false),
  color: HexColor.default('#c8d2dc'),
  /** 'exp2' uses density; 'linear' uses near/far */
  type: z.enum(['linear', 'exp2']).default('exp2'),
  near: z.number().min(0).default(10),
  far: z.number().min(0).default(120),
  density: z.number().min(0).max(1).default(0.015),
})

export const SceneSettingsSchema = z
  .object({
    ambientColor: HexColor.default('#666666'),
    ambientIntensity: z.number().min(0).max(10).default(0.3),
    /**
     * Background: null = environment-aware default, '#rrggbb' = solid color,
     * 'environment' = show the environment map, 'assets/sky.hdr' = that HDR/EXR as background.
     */
    skybox: z.string().nullable().default(null),
    /** 'room' (procedural RoomEnvironment), 'none', or an assets/ path to a .hdr/.exr */
    environment: z.string().default('room'),
    environmentIntensity: z.number().min(0).max(10).default(1),
    /** Background blur when the environment map is shown as background */
    backgroundBlurriness: z.number().min(0).max(1).default(0),
    toneMapping: ToneMappingKind.default('agx'),
    exposure: z.number().min(0.01).max(10).default(1),
    fog: FogSchema.default(FogSchema.parse({})),
    shadowQuality: ShadowQuality.default('medium'),
    /** Default sun used when the scene has no directional Light */
    sun: z
      .object({
        enabled: z.boolean().default(true),
        color: HexColor.default('#fff4e5'),
        intensity: z.number().min(0).max(20).default(2.5),
        /** Direction the light comes FROM (normalized at runtime) */
        direction: (z.tuple([z.number(), z.number(), z.number()]) as unknown as z.ZodType<[number, number, number]>).default([0.5, 1, 0.35]),
      })
      .default({ enabled: true, color: '#fff4e5', intensity: 2.5, direction: [0.5, 1, 0.35] }),
    postFx: PostFxSchema.default(PostFxSchema.parse({})),
  })
  .passthrough()

export type SceneSettings = z.infer<typeof SceneSettingsSchema>
export type ToneMappingKindType = z.infer<typeof ToneMappingKind>
export type ShadowQualityType = z.infer<typeof ShadowQuality>
export type QualityProfileType = z.infer<typeof QualityProfile>

export const DEFAULT_SCENE_SETTINGS: SceneSettings = SceneSettingsSchema.parse({})

/**
 * Lenient: invalid fields fall back to their default instead of rejecting the whole scene,
 * so an old or hand-edited scene still opens. Returns the warnings for the Console.
 */
export function normalizeSceneSettings(raw: unknown): { settings: SceneSettings; warnings: string[] } {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {}
  const warnings: string[] = []
  for (let attempt = 0; attempt < 32; attempt++) {
    const res = SceneSettingsSchema.safeParse(input)
    if (res.success) return { settings: res.data, warnings }
    const key = res.error.issues[0]?.path[0]
    if (typeof key !== 'string' || !(key in input)) break
    warnings.push(`settings.${res.error.issues[0].path.join('.')} tidak valid (${res.error.issues[0].message}); memakai default`)
    delete input[key]
  }
  return { settings: SceneSettingsSchema.parse({}), warnings }
}

/**
 * Project-wide quality profile (project.linden.json `quality`). Caps what a scene may ask for so the
 * same scene stays fast on weak devices.
 */
export interface QualityCaps {
  postFx: boolean
  shadowMapSize: number
  transmission: boolean
  maxPixelRatio: number
  /** Water reflection/refraction pass (renders the scene a second time) */
  waterReflections: boolean
  /** Upper bound for ParticleEmitter.maxParticles */
  maxParticlesPerEmitter: number
  /** ParticleEmitter.light (a PointLight per emitter) */
  particleLights: boolean
}

export const QUALITY_CAPS: Record<QualityProfileType, QualityCaps> = {
  low: { postFx: false, shadowMapSize: 1024, transmission: false, maxPixelRatio: 1, waterReflections: false, maxParticlesPerEmitter: 200, particleLights: false },
  medium: { postFx: true, shadowMapSize: 2048, transmission: true, maxPixelRatio: 1.5, waterReflections: true, maxParticlesPerEmitter: 1000, particleLights: true },
  high: { postFx: true, shadowMapSize: 4096, transmission: true, maxPixelRatio: 2, waterReflections: true, maxParticlesPerEmitter: 2000, particleLights: true },
}

export const SHADOW_MAP_SIZE: Record<ShadowQualityType, number> = { off: 0, low: 1024, medium: 2048, high: 4096 }

export function resolveQuality(raw: unknown): QualityProfileType {
  const r = QualityProfile.safeParse(raw)
  return r.success ? r.data : 'medium'
}
