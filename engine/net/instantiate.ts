import type { World } from '../ecs/World'
import type { Entity } from '../ecs/Entity'
import { SceneSerializer, type SerializedEntity } from '../scene/serializer'

/**
 * Runtime copies of an entity subtree (multiplayer avatars and ctx.net.spawn). A template is
 * captured once as stored data; every copy gets ids derived from its root id, so all clients
 * create the same ids for the same networked entity.
 */

export interface EntityTemplate {
  name: string
  rootId: string
  /** Root first, then descendants in hierarchy order */
  entities: SerializedEntity[]
}

function subtree(world: World, root: Entity): Entity[] {
  const inside = new Set([root.id])
  const out: Entity[] = []
  for (const e of world.getEntitiesInHierarchyOrder()) {
    if (e.id === root.id) out.push(e)
    else if (e.parentId && inside.has(e.parentId)) {
      inside.add(e.id)
      out.push(e)
    }
  }
  return out
}

export function captureTemplate(world: World, root: Entity): EntityTemplate {
  return { name: root.name, rootId: root.id, entities: subtree(world, root).map((e) => SceneSerializer.serializeEntity(e)) }
}

/** Id of a template entity inside the copy whose root is `rootId` */
export function copyEntityId(rootId: string, tpl: EntityTemplate, oldId: string): string {
  return oldId === tpl.rootId ? rootId : `${rootId}/${oldId}`
}

type Vec3 = { x: number; y: number; z: number }

/** Add a copy of the template to the world as a root entity; returns its entities, root first */
export function instantiateTemplate(world: World, tpl: EntityTemplate, rootId: string, opts: { name?: string; position?: Vec3; rotation?: Vec3 } = {}): Entity[] {
  const ids = new Map(tpl.entities.map((e) => [e.id, copyEntityId(rootId, tpl, e.id)]))
  const created: Entity[] = []
  for (const data of tpl.entities) {
    const copy: SerializedEntity = structuredClone(data)
    copy.id = ids.get(data.id)!
    copy.parentId = data.id === tpl.rootId ? null : (data.parentId && ids.get(data.parentId)) || null
    if (data.id === tpl.rootId) {
      copy.active = true
      if (opts.name) copy.name = opts.name
    }
    // References between entities of the template point at the copies
    for (const comp of copy.components) {
      for (const [key, val] of Object.entries(comp.data ?? {})) {
        if (typeof val === 'string' && ids.has(val)) comp.data[key] = ids.get(val)
      }
    }
    created.push(SceneSerializer.addEntity(world, copy))
  }
  const root = created[0]
  const t = root.getTransform()
  if (opts.position) t.position = { x: opts.position.x, y: opts.position.y, z: opts.position.z }
  if (opts.rotation) t.rotation = { x: opts.rotation.x, y: opts.rotation.y, z: opts.rotation.z }
  return created
}
