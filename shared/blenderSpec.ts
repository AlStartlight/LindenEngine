import { z } from 'zod'

/**
 * Declarative model spec that blender-bridge/runner.py turns into a .glb (linden_blender_build).
 * Axes are Blender's: Z is up, meters, rotations in degrees. The glTF exporter converts to Y-up.
 * The runner validates again on its side; this schema is the contract the agent sees.
 */

const finite = z.number().finite()
const positive = (max: number) => finite.positive().max(max)
const vec3 = z.tuple([finite.min(-1000).max(1000), finite.min(-1000).max(1000), finite.min(-1000).max(1000)])
const scale3 = z.tuple([positive(1000), positive(1000), positive(1000)])

export const BLENDER_PRIMITIVES = ['cube', 'uv_sphere', 'cylinder', 'cone', 'torus', 'plane', 'lathe'] as const

/** A profile point of the lathe primitive: [radius, height] in meters, revolved around Blender Z */
const ProfilePointSchema = z.tuple([finite.min(0).max(100), finite.min(-100).max(100)])

const ParamsSchema = z
  .object({
    size: positive(100),
    radius: positive(100),
    radius1: finite.min(0).max(100),
    radius2: finite.min(0).max(100),
    depth: positive(100),
    segments: z.number().int().min(3).max(256),
    rings: z.number().int().min(3).max(128),
    vertices: z.number().int().min(3).max(256),
    majorRadius: positive(100),
    minorRadius: positive(100),
    majorSegments: z.number().int().min(3).max(256),
    minorSegments: z.number().int().min(3).max(128),
    /** Lathe only: 2..128 [radius, z] points (a closed vase profile returns to the axis at z=0) */
    profile: z.array(ProfilePointSchema).min(2).max(128),
    /** Lathe only: Catmull-Rom smoothing between profile points (default 3) */
    profileSubdivisions: z.number().int().min(1).max(8),
  })
  .partial()
  .strict()

const ModifierSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bevel'), width: positive(10), segments: z.number().int().min(1).max(8).optional(), limit: z.enum(['angle', 'none']).optional() }).strict(),
  z.object({ type: z.literal('subdivision'), levels: z.number().int().min(1).max(3) }).strict(),
  z.object({ type: z.literal('solidify'), thickness: finite.min(-10).max(10).refine((v) => v !== 0, 'thickness tidak boleh 0') }).strict(),
  z.object({ type: z.literal('array'), count: z.number().int().min(2).max(64), offset: vec3 }).strict(),
  z.object({ type: z.literal('mirror'), axes: z.array(z.enum(['x', 'y', 'z'])).min(1).max(3) }).strict(),
  z.object({ type: z.literal('boolean'), operation: z.enum(['difference', 'union', 'intersect']), with: z.string() }).strict(),
  z.object({ type: z.literal('weightedNormal'), weight: finite.min(0).max(100).optional() }).strict(),
])

const ColorSchema = z.union([
  z.string().regex(/^#[0-9a-fA-F]{6}$/, 'warna hex #rrggbb'),
  z.tuple([finite.min(0).max(1), finite.min(0).max(1), finite.min(0).max(1)]),
])

export const SCULPT_PRESETS = ['clay', 'stone', 'wood', 'fabric', 'hammered', 'organic', 'custom'] as const
export const SCULPT_LAYER_TYPES = ['noise', 'ridged', 'dents', 'wrinkles', 'grain', 'chips'] as const

const SculptLayerSchema = z
  .object({
    type: z.enum(SCULPT_LAYER_TYPES),
    /** Layer weight relative to the object's `sculpt.strength` */
    strength: finite.min(0).max(2).optional(),
    /** Detail frequency; 1 = the whole object, 24 = fine grain */
    scale: finite.min(0.5).max(200).optional(),
    detail: z.number().int().min(1).max(6).optional(),
    seed: z.number().int().min(0).max(999999).optional(),
  })
  .strict()

const SculptSchema = z
  .object({
    preset: z.enum(SCULPT_PRESETS).optional(),
    strength: finite.min(0).max(0.2).optional(),
    scale: finite.min(0.5).max(200).optional(),
    seed: z.number().int().min(0).max(999999).optional(),
    /** Simple-subdivision levels applied before the displacement (adds 4^levels faces) */
    subdivide: z.number().int().min(0).max(3).optional(),
    /** Collapse-decimate ratio 0..1 applied after sculpting when the mesh exceeds the budget */
    decimate: finite.min(0).max(1).optional(),
    layers: z.array(SculptLayerSchema).min(1).max(8).optional(),
  })
  .strict()
  .refine((s) => s.preset !== 'custom' || (s.layers?.length ?? 0) > 0, 'preset "custom" butuh layers')

export const TEXTURE_PATTERNS = ['noise', 'wood', 'marble', 'concrete', 'fabric', 'stone', 'brushed', 'rust'] as const

const TextureSchema = z
  .object({
    pattern: z.enum(TEXTURE_PATTERNS),
    /** Pattern repeats across the object (higher = finer detail) */
    scale: finite.min(0.05).max(64).optional(),
    /** 0 = flat palette, 1 = maximum tonal variation */
    contrast: finite.min(0).max(1).optional(),
    colorA: ColorSchema.optional(),
    colorB: ColorSchema.optional(),
    roughnessMin: finite.min(0).max(1).optional(),
    roughnessMax: finite.min(0).max(1).optional(),
    /** Height-detail strength that feeds the normal map */
    bump: finite.min(0).max(1).optional(),
    normalStrength: finite.min(0).max(4).optional(),
    resolution: z.union([z.literal(256), z.literal(512), z.literal(1024)]).optional(),
    seed: z.number().int().min(0).max(999999).optional(),
  })
  .strict()
  .refine((t) => (t.roughnessMin ?? 0) <= (t.roughnessMax ?? 1), 'roughnessMin harus <= roughnessMax')

const MaterialSchema = z
  .object({
    baseColor: ColorSchema,
    metallic: finite.min(0).max(1).optional(),
    roughness: finite.min(0).max(1).optional(),
    /** Glaze/lacquer layer (KHR_materials_clearcoat in the GLB) */
    clearcoat: finite.min(0).max(1).optional(),
    clearcoatRoughness: finite.min(0).max(1).optional(),
    /** Procedural PBR maps (albedo + roughness + tangent normal) baked into the GLB */
    texture: TextureSchema.optional(),
  })
  .strict()

/** Display-referred CDL grade, identical to the engine's `settings.colorGrade` */
const ColorGradePatchSchema = z
  .object({
    contrast: finite.min(0).max(4).optional(),
    saturation: finite.min(0).max(4).optional(),
    /** -1 cool .. +1 warm */
    temperature: finite.min(-1).max(1).optional(),
    /** -1 green .. +1 magenta */
    tint: finite.min(-1).max(1).optional(),
    lift: finite.min(-0.5).max(0.5).optional(),
    gamma: finite.min(0.1).max(4).optional(),
    gain: finite.min(0).max(4).optional(),
    vignette: finite.min(0).max(1).optional(),
  })
  .strict()

const GradeSchema = z
  .object({
    viewTransform: z.enum(['AgX', 'Filmic', 'Standard', 'Khronos PBR Neutral']).optional(),
    /** AgX/Filmic look name, e.g. "AgX - Medium High Contrast" */
    look: z.string().min(1).max(64).optional(),
    /** View exposure in stops (Blender color management, before view transform) */
    exposure: finite.min(-8).max(8).optional(),
    whiteBalance: z
      .object({ temperature: finite.min(2000).max(12000), tint: finite.min(-100).max(100) })
      .strict()
      .optional(),
    /** Applied to the saved preview PNGs and suggested to the engine scene settings */
    colorGrade: ColorGradePatchSchema.optional(),
  })
  .strict()

const PreviewSchema = z
  .object({
    /** cycles = path-traced photorealism (default), eevee = fast draft */
    engine: z.enum(['cycles', 'eevee']).optional(),
    samples: z.number().int().min(8).max(256).optional(),
    resolution: z.union([z.literal(256), z.literal(512), z.literal(768), z.literal(1024)]).optional(),
    /** Studio cyclorama floor + backdrop that receives contact shadows */
    backdrop: z.boolean().optional(),
  })
  .strict()

const ObjectSchema = z
  .object({
    name: z.string().regex(/^[A-Za-z0-9_-]{1,48}$/, 'nama 1-48 karakter: huruf, angka, _ atau -'),
    primitive: z.enum(BLENDER_PRIMITIVES),
    params: ParamsSchema.optional(),
    location: vec3.optional(),
    rotation: vec3.optional(),
    scale: scale3.optional(),
    modifiers: z.array(ModifierSchema).max(16).optional(),
    /** Procedural sculpting: subdivide, displace along normals, then decimate if needed */
    sculpt: SculptSchema.optional(),
    material: MaterialSchema.optional(),
    smooth: z.boolean().optional(),
    /** Auto-smooth angle in degrees: crisp bevels, smooth curves (Blender 4.1+). */
    smoothAngle: finite.min(0).max(180).optional(),
    /** Texture coordinates; lathe/turned objects default to a seam-free cylindrical unwrap */
    uv: z.enum(['smart', 'cylindrical', 'none']).optional(),
    cutter: z.boolean().optional(),
  })
  .strict()

/** Rough upper bound of the face multiplication a modifier/sculpt stack can cause */
function stackFactor(mods: z.infer<typeof ModifierSchema>[] = [], sculpt?: z.infer<typeof SculptSchema>): number {
  let f = 1
  for (const m of mods) {
    if (m.type === 'subdivision') f *= 4 ** m.levels
    else if (m.type === 'array') f *= m.count
    else if (m.type === 'mirror') f *= 2 ** m.axes.length
    else if (m.type === 'bevel') f *= 1 + (m.segments ?? 1)
  }
  if (sculpt?.subdivide) f *= 4 ** sculpt.subdivide
  return f
}

/** Highest stack factor summed over all objects; above this a spec could produce millions of faces */
export const BLENDER_MAX_STACK = 4096

export const RIG_TYPES = ['humanoid_biped', 'mechanical_biped', 'custom'] as const
export const LOCOMOTION_ACTIONS = ['idle', 'walk', 'run', 'jump', 'fall', 'land', 'crouch_idle', 'crouch_walk', 'attack'] as const

export const RigBoneMappingSchema = z
  .object({
    bone: z.string().min(1).max(64),
    objectName: z.string().min(1).max(64),
  })
  .strict()

export const CharacterRigSpecSchema = z
  .object({
    type: z.enum(RIG_TYPES).default('humanoid_biped'),
    height: positive(100).optional(),
    autoSkin: z.boolean().optional(),
    rigMapping: z.array(RigBoneMappingSchema).max(128).optional(),
    generateLocomotion: z.boolean().optional(),
    actions: z.array(z.string().min(1).max(32)).max(32).optional(),
  })
  .strict()

export type CharacterRigSpec = z.infer<typeof CharacterRigSpecSchema>

export const BlenderSpecSchema = z
  .object({
    objects: z.array(ObjectSchema).min(1).max(64),
    ground: z.boolean().optional(),
    join: z.boolean().optional(),
    rig: CharacterRigSpecSchema.optional(),
    /** Color management + CDL grade for the photoreal previews (and suggested engine settings) */
    grade: GradeSchema.optional(),
    /** Preview render quality (Cycles path tracing by default) */
    preview: PreviewSchema.optional(),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const names = new Set<string>()
    spec.objects.forEach((o, i) => {
      if (names.has(o.name)) ctx.addIssue({ code: 'custom', path: ['objects', i, 'name'], message: `nama "${o.name}" dipakai lebih dari sekali` })
      names.add(o.name)
    })
    spec.objects.forEach((o, i) => {
      if (o.primitive === 'lathe' && !o.params?.profile) {
        ctx.addIssue({ code: 'custom', path: ['objects', i, 'params', 'profile'], message: 'primitive lathe butuh params.profile [[radius,z],…]' })
      }
      o.modifiers?.forEach((m, j) => {
        if (m.type !== 'boolean') return
        if (m.with === o.name) ctx.addIssue({ code: 'custom', path: ['objects', i, 'modifiers', j, 'with'], message: 'boolean tidak boleh memakai objek itu sendiri' })
        else if (!names.has(m.with)) ctx.addIssue({ code: 'custom', path: ['objects', i, 'modifiers', j, 'with'], message: `objek "${m.with}" tidak ada di spec` })
      })
    })
    if (spec.objects.every((o) => o.cutter)) ctx.addIssue({ code: 'custom', path: ['objects'], message: 'minimal satu objek bukan cutter' })
    const load = spec.objects.reduce((sum, o) => sum + stackFactor(o.modifiers, o.sculpt), 0)
    if (load > BLENDER_MAX_STACK) {
      ctx.addIssue({ code: 'custom', path: ['objects'], message: `modifier terlalu berat (beban ${load} > ${BLENDER_MAX_STACK}); kurangi subdivision/array` })
    }
  })

export type BlenderSpec = z.infer<typeof BlenderSpecSchema>

/** Summary line runner.py prints on stdout: `LINDEN_RESULT:{json}` */
export interface BlenderRunResult {
  objects: number
  triangles: number
  bounds: { min: [number, number, number]; max: [number, number, number] }
  materials: string[]
  warnings: string[]
  animations?: string[]
  bones?: number
  /** Names of the PBR maps generated per material (albedo/roughness/normal) */
  textures?: string[]
  /** The color management + CDL grade applied to the previews */
  grade?: { viewTransform?: string; look?: string; exposure?: number; colorGrade?: Record<string, number> }
}

export const RESULT_MARKER = 'LINDEN_RESULT:'
export const ERROR_MARKER = 'LINDEN_ERROR:'

/** Last LINDEN_RESULT line of the runner's stdout, or null when missing or malformed */
export function parseBlenderResult(stdout: string): BlenderRunResult | null {
  const lines = stdout.split(/\r?\n/).filter((l) => l.startsWith(RESULT_MARKER))
  const last = lines[lines.length - 1]
  if (!last) return null
  try {
    const data = JSON.parse(last.slice(RESULT_MARKER.length))
    if (!data || typeof data.objects !== 'number' || typeof data.triangles !== 'number' || !data.bounds) return null
    return {
      objects: data.objects,
      triangles: data.triangles,
      bounds: data.bounds,
      materials: Array.isArray(data.materials) ? data.materials.map(String) : [],
      warnings: Array.isArray(data.warnings) ? data.warnings.map(String) : [],
      animations: Array.isArray(data.animations) ? data.animations.map(String) : undefined,
      bones: typeof data.bones === 'number' ? data.bones : undefined,
      textures: Array.isArray(data.textures) ? data.textures.map(String) : undefined,
      grade: data.grade && typeof data.grade === 'object' ? data.grade : undefined,
    }
  } catch {
    return null
  }
}

/** Message of the runner's LINDEN_ERROR line (stderr), if any */
export function parseBlenderError(stderr: string): string | null {
  const line = stderr
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.startsWith(ERROR_MARKER))
  return line ? line.slice(ERROR_MARKER.length).trim() : null
}
