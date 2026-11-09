import { z } from 'zod'
import { MaterialSpecSchema } from '../materials/MaterialSpec'
import { isValidFactorySrc } from '../../shared/modelFactory'

/**
 * A Model describes an object as a hierarchy of parts (1 unit = 1 meter, Y up, the model origin is
 * the point that rests on the ground). Each part has a local transform, a material and one shape.
 * Alternatively `src` points at an imported glTF/GLB/OBJ in assets/, or `factory` at a procedural
 * factory in models/ (TypeScript exporting create<Name>Model(): THREE.Group, e.g. from img2threejs).
 */

const Num = z.number().finite()
// Typed explicitly: with `strict: false` (tsconfig.electron.json) zod infers tuple elements as optional
const Vec2 = z.tuple([Num, Num]) as unknown as z.ZodType<[number, number]>
const Vec3 = z.tuple([Num, Num, Num]) as unknown as z.ZodType<[number, number, number]>
const Pos = z.number().positive().finite()

const shapes = [
  z.object({
    type: z.literal('roundedBox'),
    /** Full size in meters [width x, height y, depth z] */
    size: Vec3,
    /** Edge radius in meters; default 8% of the smallest side (max 2 cm), 0 = sharp box */
    radius: z.number().min(0).optional(),
    segments: z.number().int().min(1).max(8).optional(),
  }),
  z.object({
    type: z.literal('sphere'),
    radius: Pos,
    widthSegments: z.number().int().min(8).max(128).optional(),
    heightSegments: z.number().int().min(6).max(64).optional(),
  }),
  z.object({
    type: z.literal('capsule'),
    radius: Pos,
    /** Length of the straight middle section (total height = length + 2 * radius) */
    length: z.number().min(0),
    radialSegments: z.number().int().min(8).max(64).optional(),
  }),
  z.object({
    type: z.literal('cylinder'),
    radiusTop: z.number().min(0),
    radiusBottom: z.number().min(0),
    height: Pos,
    radialSegments: z.number().int().min(6).max(128).optional(),
    /** Rounded rim radius in meters; default 5% of the smallest dimension (max 1 cm) */
    bevel: z.number().min(0).optional(),
    openEnded: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('cone'),
    radius: Pos,
    height: Pos,
    radialSegments: z.number().int().min(6).max(128).optional(),
  }),
  z.object({
    type: z.literal('torus'),
    /** Distance from center to the middle of the tube */
    radius: Pos,
    tube: Pos,
    radialSegments: z.number().int().min(6).max(64).optional(),
    tubularSegments: z.number().int().min(8).max(256).optional(),
    /** Radians, default full circle */
    arc: z.number().positive().max(Math.PI * 2).optional(),
  }),
  z.object({
    type: z.literal('lathe'),
    /** Profile [radius, y] from bottom to top, revolved around Y (vase, bottle, lamp shade) */
    points: z.array(Vec2).min(2).max(256),
    segments: z.number().int().min(6).max(256).optional(),
    /** Wall thickness in meters: adds the inner wall and the rim, making a hollow vessel */
    thickness: z.number().min(0).optional(),
    /** Close the bottom with a disk (the outside of a vessel) */
    capBottom: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('extrude'),
    /** Outline [x, y] in the XY plane, counter-clockwise; extruded along +Z and centered on it */
    shape: z.array(Vec2).min(3).max(512),
    holes: z.array(z.array(Vec2).min(3)).optional(),
    depth: Pos,
    /** Bevel size in meters; default 2 mm (0 = sharp) */
    bevel: z.number().min(0).optional(),
    bevelSegments: z.number().int().min(1).max(8).optional(),
    /** Round the outline corners with this radius (meters) */
    cornerRadius: z.number().min(0).optional(),
  }),
  z.object({
    type: z.literal('tube'),
    /** Spline control points (Catmull-Rom) */
    path: z.array(Vec3).min(2).max(256),
    radius: Pos,
    tubularSegments: z.number().int().min(4).max(512).optional(),
    radialSegments: z.number().int().min(4).max(64).optional(),
    closed: z.boolean().optional(),
    /** Close both ends with hemispheres (cables, handles) */
    capped: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('plane'),
    /** [width x, depth z], horizontal and facing +Y */
    size: Vec2,
    segments: z.number().int().min(1).max(256).optional(),
    displacement: z
      .object({
        /** Max height offset in meters */
        amplitude: z.number(),
        /** Feature size in meters */
        scale: Pos,
        seed: z.number().int().optional(),
      })
      .optional(),
  }),
] as const

export const PartShapeSchema = z.discriminatedUnion('type', shapes)

export const ModelPartSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(128).optional(),
  /** Another part id; this part's transform is relative to it */
  parent: z.string().optional(),
  shape: PartShapeSchema,
  position: Vec3.optional(),
  /** Degrees XYZ */
  rotation: Vec3.optional(),
  scale: Vec3.optional(),
  /** Preset id shorthand ("wood_teak") or a full material spec */
  material: z.union([z.string(), MaterialSpecSchema]).optional(),
  /** Part id this part must touch (validator reports a gap); default: touching any part is enough */
  attachTo: z.string().optional(),
  /** Intended to sit inside / intersect another part (water in a glass, a bulb in a shade) */
  allowOverlap: z.boolean().optional(),
  castShadow: z.boolean().optional(),
  receiveShadow: z.boolean().optional(),
  /**
   * Effective density in kg/m³ instead of the material's (a part modelled solid that is hollow in
   * reality: a car body, a fridge, a cabinet). Used for mass, center of mass and colliders.
   */
  density: z.number().positive().max(30_000).optional(),
})

export const ModelInstanceSchema = z.object({
  position: Vec3,
  rotation: Vec3.optional(),
  scale: Vec3.optional(),
})

export const ModelSpecSchema = z
  .object({
    parts: z.array(ModelPartSchema).max(512).default([]),
    /** glTF/GLB/OBJ in assets/ instead of parts */
    src: z.string().optional(),
    /** Merge parts that share a material into one mesh (static objects) */
    merge: z.boolean().default(true),
    /** Every copy of the whole model (the first included), drawn with GPU instancing (trees, stadium seats) */
    instances: z.array(ModelInstanceSchema).max(10_000).optional(),
    /**
     * Collider generated for physics when the entity has no collider of its own. compound = one
     * collider per part (keeps concave shapes such as a table open underneath, mass per part)
     */
    collider: z.enum(['none', 'box', 'convexHull', 'compound']).default('none'),
    /** Key in realWorldDimensions used by the validator to check the scale (e.g. "chair") */
    category: z.string().optional(),
    /** Where the object rests: floor = lowest point at y 0 */
    placement: z.enum(['floor', 'wall', 'ceiling', 'free']).default('floor'),
    /** Name of the glTF animation clip to play */
    animation: z.string().optional(),
    /** models/<x>.ts exporting create<Name>Model(options): THREE.Group, instead of parts or src */
    factory: z.string().optional(),
    /** Export to call; default the only create<Name>Model export */
    factoryExport: z.string().regex(/^[A-Za-z_$][\w$]*$/).optional(),
    /** Passed to the factory (castShadow/receiveShadow come from the component) */
    factoryOptions: z
      .object({
        textureSize: z.number().int().min(64).max(4096).optional(),
        textureAnisotropy: z.number().int().min(1).max(16).optional(),
        qualityPriority: z.enum(['reference-fidelity', 'balanced']).optional(),
      })
      .optional(),
    /**
     * Normalisation applied to the factory's group, written by linden_model_build: factories use
     * relative units and their own origin; Linden needs meters with the model resting at y 0.
     */
    fit: z.object({ scale: Pos, offset: Vec3 }).optional(),
  })
  .superRefine((m, ctx) => {
    const sources = [m.parts.length > 0, !!m.src, !!m.factory].filter(Boolean).length
    if (sources === 0) {
      ctx.addIssue({ code: 'custom', message: 'Model butuh "parts", "src" atau "factory"', path: ['parts'] })
    }
    if (m.factory && (m.src || m.parts.length > 0)) {
      ctx.addIssue({ code: 'custom', message: '"factory" tidak boleh digabung dengan "parts" atau "src"', path: ['factory'] })
    }
    if (m.factory !== undefined && !isValidFactorySrc(m.factory)) {
      ctx.addIssue({ code: 'custom', message: `factory harus file .ts/.js di dalam models/ (dapat: ${m.factory})`, path: ['factory'] })
    }
    const ids = new Set<string>()
    m.parts.forEach((p, i) => {
      if (ids.has(p.id)) ctx.addIssue({ code: 'custom', message: `id part duplikat "${p.id}"`, path: ['parts', i, 'id'] })
      ids.add(p.id)
    })
    m.parts.forEach((p, i) => {
      for (const key of ['parent', 'attachTo'] as const) {
        const ref = p[key]
        if (ref !== undefined && (!ids.has(ref) || ref === p.id)) {
          ctx.addIssue({ code: 'custom', message: `${key} "${ref}" bukan id part lain`, path: ['parts', i, key] })
        }
      }
    })
    // Parent cycles
    const byId = new Map(m.parts.map((p) => [p.id, p]))
    for (const p of m.parts) {
      const seen = new Set<string>([p.id])
      let cur = p.parent
      while (cur) {
        if (seen.has(cur)) {
          ctx.addIssue({ code: 'custom', message: `parent part "${p.id}" membentuk siklus`, path: ['parts'] })
          break
        }
        seen.add(cur)
        cur = byId.get(cur)?.parent
      }
    }
  })

export type ModelSpec = z.infer<typeof ModelSpecSchema>
export type ModelPart = z.infer<typeof ModelPartSchema>
export type PartShape = z.infer<typeof PartShapeSchema>
