import { z } from 'zod'

/**
 * `.lscene` schemas. v2 (entities + components + settings) is the only format the engine, the
 * editor and the agent write; v1 (objects + camera, the first editor format) is still read and
 * migrated by migrations.ts.
 */

export const SCENE_FORMAT = 'linden-scene'
export const SCENE_VERSION = 2
export const MAX_SCENE_BYTES = 50 * 1024 * 1024

// Typed explicitly: with `strict: false` (tsconfig.electron.json) zod infers tuple elements as optional
const Vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]) as unknown as z.ZodType<[number, number, number]>
const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/)

export const PrimitiveKindV1 = z.enum(['box', 'sphere', 'cylinder', 'torus', 'cone', 'plane'])

export const SceneObjectV1Schema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().max(256),
  parentId: z.string().nullable().default(null),
  kind: z.literal('primitive'),
  primitive: PrimitiveKindV1,
  transform: z.object({
    position: Vec3,
    rotation: Vec3,
    scale: Vec3,
  }),
  material: z.object({
    color: HexColor,
    roughness: z.number().min(0).max(1),
    metalness: z.number().min(0).max(1),
  }),
  castShadow: z.boolean().default(true),
  receiveShadow: z.boolean().default(true),
  visible: z.boolean().default(true),
})

export const SceneFileV1Schema = z
  .object({
    format: z.literal(SCENE_FORMAT),
    version: z.literal(1),
    name: z.string().min(1).max(256),
    camera: z.object({
      position: Vec3,
      target: Vec3,
    }),
    objects: z.array(SceneObjectV1Schema).max(10_000),
  })
  .superRefine((scene, ctx) => {
    const seenIds = new Set<string>()
    const idMap = new Map<string, z.infer<typeof SceneObjectV1Schema>>()

    // Check unique ids
    for (let i = 0; i < scene.objects.length; i++) {
      const obj = scene.objects[i]
      if (seenIds.has(obj.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate object id: "${obj.id}"`,
          path: ['objects', i, 'id'],
        })
      }
      seenIds.add(obj.id)
      idMap.set(obj.id, obj)
    }

    // Check parentId references and cycles
    for (let i = 0; i < scene.objects.length; i++) {
      const obj = scene.objects[i]
      if (obj.parentId !== null) {
        if (obj.parentId === obj.id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Object "${obj.id}" cannot have itself as parent`,
            path: ['objects', i, 'parentId'],
          })
          continue
        }

        if (!idMap.has(obj.parentId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Object "${obj.id}" references non-existent parent "${obj.parentId}"`,
            path: ['objects', i, 'parentId'],
          })
          continue
        }

        // Cycle detection
        let curr: string | null = obj.parentId
        const visited = new Set<string>([obj.id])
        while (curr) {
          if (visited.has(curr)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Parent cycle detected involving object "${obj.id}" and parent "${curr}"`,
              path: ['objects', i, 'parentId'],
            })
            break
          }
          visited.add(curr)
          const parentObj = idMap.get(curr)
          if (!parentObj || parentObj.parentId === null) {
            break
          }
          curr = parentObj.parentId
        }
      }
    }
  })

export type SceneFileV1 = z.infer<typeof SceneFileV1Schema>
export type SceneObjectDataV1 = SceneFileV1['objects'][number]
export type PrimitiveKindV1Type = z.infer<typeof PrimitiveKindV1>

// ---- v2 -------------------------------------------------------------------

export const SerializedComponentSchema = z.object({
  type: z.string().min(1).max(128),
  data: z.record(z.string(), z.any()).default({}),
})

export const SerializedEntitySchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().max(256),
  active: z.boolean().default(true),
  static: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
  layer: z.number().int().default(0),
  parentId: z.string().nullable().default(null),
  prefab: z.any().optional(),
  components: z.array(SerializedComponentSchema).max(256),
})

export const SceneFileSchema = z
  .object({
    format: z.literal(SCENE_FORMAT),
    version: z.literal(2),
    name: z.string().min(1).max(256),
    /** Validated leniently by normalizeSceneSettings (SceneSettings.ts) */
    settings: z.record(z.string(), z.unknown()).optional(),
    entities: z.array(SerializedEntitySchema).max(10_000),
  })
  .superRefine((scene, ctx) => {
    const ids = new Map<string, number>()
    scene.entities.forEach((e, i) => {
      if (ids.has(e.id)) ctx.addIssue({ code: 'custom', message: `Duplicate entity id: "${e.id}"`, path: ['entities', i, 'id'] })
      ids.set(e.id, i)
    })
    const byId = new Map(scene.entities.map((e) => [e.id, e]))
    scene.entities.forEach((e, i) => {
      if (e.parentId === null) return
      if (e.parentId === e.id || !byId.has(e.parentId)) {
        ctx.addIssue({ code: 'custom', message: `Entity "${e.id}" references invalid parent "${e.parentId}"`, path: ['entities', i, 'parentId'] })
        return
      }
      const seen = new Set<string>([e.id])
      let cur: string | null = e.parentId
      while (cur) {
        if (seen.has(cur)) {
          ctx.addIssue({ code: 'custom', message: `Parent cycle detected involving entity "${e.id}"`, path: ['entities', i, 'parentId'] })
          break
        }
        seen.add(cur)
        cur = byId.get(cur)?.parentId ?? null
      }
    })
  })

export type SceneFile = z.infer<typeof SceneFileSchema>
