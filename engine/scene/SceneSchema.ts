import { z } from 'zod'

export const SCENE_FORMAT = 'linden-scene'
export const SCENE_VERSION = 1
export const MAX_SCENE_BYTES = 50 * 1024 * 1024

const Vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])
const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/)

export const PrimitiveKind = z.enum(['box', 'sphere', 'cylinder', 'torus', 'cone', 'plane'])

export const SceneObjectSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().max(256),
  parentId: z.string().nullable().default(null),
  kind: z.literal('primitive'),
  primitive: PrimitiveKind,
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

export const SceneFileSchema = z
  .object({
    format: z.literal(SCENE_FORMAT),
    version: z.number().int().min(1),
    name: z.string().min(1).max(256),
    camera: z.object({
      position: Vec3,
      target: Vec3,
    }),
    objects: z.array(SceneObjectSchema).max(10_000),
  })
  .superRefine((scene, ctx) => {
    const seenIds = new Set<string>()
    const idMap = new Map<string, z.infer<typeof SceneObjectSchema>>()

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

export type SceneFile = z.infer<typeof SceneFileSchema>
export type SceneObjectData = SceneFile['objects'][number]
export type PrimitiveKindType = z.infer<typeof PrimitiveKind>
