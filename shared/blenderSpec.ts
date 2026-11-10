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

export const BLENDER_PRIMITIVES = ['cube', 'uv_sphere', 'cylinder', 'cone', 'torus', 'plane'] as const

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
])

const ColorSchema = z.union([
  z.string().regex(/^#[0-9a-fA-F]{6}$/, 'warna hex #rrggbb'),
  z.tuple([finite.min(0).max(1), finite.min(0).max(1), finite.min(0).max(1)]),
])

const MaterialSchema = z
  .object({
    baseColor: ColorSchema,
    metallic: finite.min(0).max(1).optional(),
    roughness: finite.min(0).max(1).optional(),
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
    material: MaterialSchema.optional(),
    smooth: z.boolean().optional(),
    uv: z.enum(['smart', 'none']).optional(),
    cutter: z.boolean().optional(),
  })
  .strict()

/** Rough upper bound of the face multiplication a modifier stack can cause */
function stackFactor(mods: z.infer<typeof ModifierSchema>[] = []): number {
  let f = 1
  for (const m of mods) {
    if (m.type === 'subdivision') f *= 4 ** m.levels
    else if (m.type === 'array') f *= m.count
    else if (m.type === 'mirror') f *= 2 ** m.axes.length
    else if (m.type === 'bevel') f *= 1 + (m.segments ?? 1)
  }
  return f
}

/** Highest stack factor summed over all objects; above this a spec could produce millions of faces */
export const BLENDER_MAX_STACK = 4096

export const BlenderSpecSchema = z
  .object({
    objects: z.array(ObjectSchema).min(1).max(64),
    ground: z.boolean().optional(),
    join: z.boolean().optional(),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const names = new Set<string>()
    spec.objects.forEach((o, i) => {
      if (names.has(o.name)) ctx.addIssue({ code: 'custom', path: ['objects', i, 'name'], message: `nama "${o.name}" dipakai lebih dari sekali` })
      names.add(o.name)
    })
    spec.objects.forEach((o, i) => {
      o.modifiers?.forEach((m, j) => {
        if (m.type !== 'boolean') return
        if (m.with === o.name) ctx.addIssue({ code: 'custom', path: ['objects', i, 'modifiers', j, 'with'], message: 'boolean tidak boleh memakai objek itu sendiri' })
        else if (!names.has(m.with)) ctx.addIssue({ code: 'custom', path: ['objects', i, 'modifiers', j, 'with'], message: `objek "${m.with}" tidak ada di spec` })
      })
    })
    if (spec.objects.every((o) => o.cutter)) ctx.addIssue({ code: 'custom', path: ['objects'], message: 'minimal satu objek bukan cutter' })
    const load = spec.objects.reduce((sum, o) => sum + stackFactor(o.modifiers), 0)
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
