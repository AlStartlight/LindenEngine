/**
 * Component Mapping between Linden ECS and Godot Scene Nodes
 */

import { World } from '../../ecs/World'
import { Entity } from '../../ecs/Entity'
import { Transform } from '../../ecs/Component'
import { MeshRenderer, Camera, Light, LightType } from '../../renderer/Components'
import { Rigidbody, BoxCollider, SphereCollider, CapsuleCollider } from '../../physics/components'
import { BlueprintComponent } from '../../blueprints/BlueprintComponent'
import { GodotPassthroughComponent } from './GodotPassthroughComponent'
import { MaterialMap } from './MaterialMap'
import { CompatReport } from '../report/CompatReport'
import { TscnDocument, TscnNode, TscnSubResource } from '../tscn/TscnParser'
import { sanitizeNodeName } from '../tscn/TscnWriter'
import {
  eulerDegreesToTransform3D,
  transform3DToEulerDegrees,
  GodotSubResource,
  GodotExtResource,
  Transform3DValue,
} from '../tscn/Variant'

export class ComponentMap {
  /**
   * Export Linden World to TscnDocument
   */
  static exportWorld(world: World, report: CompatReport): TscnDocument {
    const doc: TscnDocument = {
      descriptor: {
        type: 'gd_scene',
        attributes: { load_steps: 1, format: 3 },
      },
      extResources: [],
      subResources: [],
      nodes: [],
      connections: [],
    }

    const allEntities = world.getEntities()
    if (allEntities.length === 0) {
      // Empty scene default root
      doc.nodes.push({
        name: 'Root',
        type: 'Node3D',
        properties: {},
      })
      return doc
    }

    // Map of entity id to Godot node path
    const entityPathMap = new Map<string, string>()

    // Determine roots and hierarchy
    const rootEntities = world.getRootEntities()
    const entitiesToProcess = rootEntities.length > 0 ? rootEntities : allEntities.filter((e: Entity) => !e.parentId)

    // Fallback: if no root entities detected, use all entities
    const processList = entitiesToProcess.length > 0 ? entitiesToProcess : allEntities

    let isRoot = true
    const subResCounter = { id: 1 }

    const processEntity = (entity: Entity, parentGodotPath: string | null) => {
      const nodePath = ComponentMap.exportEntity(
        entity,
        parentGodotPath,
        doc,
        report,
        isRoot,
        subResCounter
      )
      isRoot = false
      entityPathMap.set(entity.id, nodePath)

      // Process children
      for (const childId of entity.childIds) {
        const child = world.getEntity(childId)
        if (child) {
          processEntity(child, nodePath)
        }
      }
    }

    for (const root of processList) {
      processEntity(root, null)
    }

    // Update load_steps count
    doc.descriptor.attributes.load_steps = doc.extResources.length + doc.subResources.length + 1

    return doc
  }

  /**
   * Export single entity to Godot Node in TscnDocument
   */
  static exportEntity(
    entity: Entity,
    parentGodotPath: string | null,
    doc: TscnDocument,
    report: CompatReport,
    isSceneRoot: boolean = false,
    counter: { id: number } = { id: 1 }
  ): string {
    const { sanitized, original } = sanitizeNodeName(entity.name)
    const nodeName = sanitized

    // Relative parent path in .tscn:
    // Root has no parent attribute.
    // Immediate children of root have parent="."
    // Children of children have parent="ParentName" or relative path
    let parentAttr: string | undefined = undefined
    let currentGodotPath = nodeName

    if (!isSceneRoot) {
      if (parentGodotPath === null || parentGodotPath === '.') {
        parentAttr = '.'
      } else {
        parentAttr = parentGodotPath
      }
      currentGodotPath = parentGodotPath && parentGodotPath !== '.' ? `${parentGodotPath}/${nodeName}` : nodeName
    } else {
      currentGodotPath = '.'
    }

    const properties: Record<string, any> = {}

    // Metadata
    properties['metadata/linden_id'] = entity.id
    properties['metadata/linden_name'] = original

    // Transform
    const transform = entity.getTransform()
    const t3d = eulerDegreesToTransform3D(
      transform.position,
      transform.rotation,
      transform.scale
    )
    properties['transform'] = t3d

    // Check for Passthrough Component (preserves unmapped Godot types)
    const passthrough = entity.getComponent<GodotPassthroughComponent>('GodotPassthrough')
    if (passthrough) {
      const node: TscnNode = {
        name: nodeName,
        type: passthrough.rawType || 'Node3D',
        parent: parentAttr,
        properties: {
          ...passthrough.rawProperties,
          ...properties,
        },
      }
      doc.nodes.push(node)
      report.recordConverted()
      return isSceneRoot ? '.' : nodeName
    }

    // Determine primary node type from components
    let nodeType = 'Node3D'
    const meshRenderer = entity.getComponent<MeshRenderer>('MeshRenderer')
    const camera = entity.getComponent<Camera>('Camera')
    const light = entity.getComponent<Light>('Light')
    const rigidbody = entity.getComponent<Rigidbody>('Rigidbody') || entity.getComponent<any>('RigidBody')
    const boxCollider = entity.getComponent<BoxCollider>('BoxCollider')
    const sphereCollider = entity.getComponent<SphereCollider>('SphereCollider')
    const capsuleCollider = entity.getComponent<CapsuleCollider>('CapsuleCollider')
    const blueprint = entity.getComponent<BlueprintComponent>('Blueprint')

    if (light) {
      if (light.type === LightType.POINT || (light.type as any) === 'point') {
        nodeType = 'OmniLight3D'
        properties['light_energy'] = light.intensity
        properties['omni_range'] = light.range
      } else if (light.type === LightType.DIRECTIONAL || (light.type as any) === 'directional') {
        nodeType = 'DirectionalLight3D'
        properties['light_energy'] = light.intensity
      } else if (light.type === LightType.SPOT || (light.type as any) === 'spot') {
        nodeType = 'SpotLight3D'
        properties['light_energy'] = light.intensity
        properties['spot_range'] = light.range
      }
      if (light.color) {
        properties['light_color'] = {
          r: light.color.r,
          g: light.color.g,
          b: light.color.b,
          a: 1,
        }
      }
    } else if (camera) {
      nodeType = 'Camera3D'
      properties['fov'] = camera.fov
      properties['near'] = camera.near
      properties['far'] = camera.far
    } else if (rigidbody) {
      nodeType = 'RigidBody3D'
      properties['mass'] = rigidbody.mass
      properties['gravity_scale'] = rigidbody.useGravity ? 1 : 0
    } else if (meshRenderer) {
      nodeType = 'MeshInstance3D'
      // Create mesh sub_resource
      const meshSubId = `Mesh_${counter.id++}`
      const primitive = (meshRenderer as any).primitive || 'box'
      let meshType = 'BoxMesh'
      let meshProps: Record<string, any> = {}

      if (primitive === 'box') {
        meshType = 'BoxMesh'
        meshProps = { size: { x: 1, y: 1, z: 1 } }
      } else if (primitive === 'sphere') {
        meshType = 'SphereMesh'
        meshProps = { radius: 0.5, height: 1 }
      } else if (primitive === 'cylinder') {
        meshType = 'CylinderMesh'
        meshProps = { top_radius: 0.5, bottom_radius: 0.5, height: 2 }
      } else if (primitive === 'plane') {
        meshType = 'PlaneMesh'
        meshProps = { size: { x: 2, y: 2 } }
      } else if (primitive === 'capsule') {
        meshType = 'CapsuleMesh'
        meshProps = { radius: 0.5, height: 2 }
      }

      // Material sub_resource
      const matSubId = `StandardMaterial3D_${counter.id++}`
      const matProps = MaterialMap.toGodotStandardMaterial({
        color: (meshRenderer as any).color,
        roughness: (meshRenderer as any).roughness,
        metallic: (meshRenderer as any).metalness ?? (meshRenderer as any).metallic,
      })

      doc.subResources.push({
        type: 'StandardMaterial3D',
        id: matSubId,
        properties: matProps,
      })

      meshProps['material'] = new GodotSubResource(matSubId)

      doc.subResources.push({
        type: meshType,
        id: meshSubId,
        properties: meshProps,
      })

      properties['mesh'] = new GodotSubResource(meshSubId)
    }

    if (blueprint) {
      report.addInfo(`Blueprint attached to ${entity.name}`, { entityId: entity.id, nodeName })
    }

    const mainNode: TscnNode = {
      name: nodeName,
      type: nodeType,
      parent: parentAttr,
      properties,
    }
    doc.nodes.push(mainNode)
    report.recordConverted()

    // If collider is present, create a child CollisionShape3D node
    const collider = boxCollider || sphereCollider || capsuleCollider
    if (collider) {
      const colShapeSubId = `Shape_${counter.id++}`
      let shapeType = 'BoxShape3D'
      let shapeProps: Record<string, any> = {}

      if (boxCollider) {
        shapeType = 'BoxShape3D'
        shapeProps = { size: boxCollider.size || { x: 1, y: 1, z: 1 } }
      } else if (sphereCollider) {
        shapeType = 'SphereShape3D'
        shapeProps = { radius: sphereCollider.radius || 0.5 }
      } else if (capsuleCollider) {
        shapeType = 'CapsuleShape3D'
        shapeProps = { radius: capsuleCollider.radius || 0.5, height: capsuleCollider.height || 2 }
      }

      doc.subResources.push({
        type: shapeType,
        id: colShapeSubId,
        properties: shapeProps,
      })

      const colNodeParent = isSceneRoot ? '.' : nodeName
      doc.nodes.push({
        name: `${nodeName}_Collision`,
        type: 'CollisionShape3D',
        parent: colNodeParent,
        properties: {
          shape: new GodotSubResource(colShapeSubId),
        },
      })
      report.recordConverted()
    }

    return isSceneRoot ? '.' : nodeName
  }

  /**
   * Import Godot TscnDocument into Linden World
   */
  static importWorld(doc: TscnDocument, report: CompatReport): World {
    const world = new World()
    const nodeMap = new Map<string, Entity>()

    // SubResource lookup
    const subResMap = new Map<string, TscnSubResource>()
    for (const sub of doc.subResources) {
      subResMap.set(sub.id, sub)
    }

    for (let i = 0; i < doc.nodes.length; i++) {
      const node = doc.nodes[i]
      ComponentMap.importNode(node, world, nodeMap, subResMap, report, i === 0)
    }

    return world
  }

  /**
   * Import single Godot Node into Linden Entity
   */
  static importNode(
    node: TscnNode,
    world: World,
    nodeMap: Map<string, Entity>,
    subResMap: Map<string, TscnSubResource>,
    report: CompatReport,
    isRoot: boolean
  ): Entity {
    const lindenId = node.properties['metadata/linden_id']
    const lindenName = node.properties['metadata/linden_name'] || node.name

    let parentId: string | null = null
    if (!isRoot && node.parent) {
      if (node.parent === '.') {
        // Child of root
        const rootEntity = world.getRootEntities()[0]
        if (rootEntity) parentId = rootEntity.id
      } else {
        const parentEntity = nodeMap.get(node.parent)
        if (parentEntity) parentId = parentEntity.id
      }
    }

    const entity = world.createEntity(lindenName, parentId, undefined, typeof lindenId === 'string' ? lindenId : undefined)
    nodeMap.set(node.name, entity)

    if (node.instancePath || (node.instance && typeof node.instance === 'string')) {
      const src = (node.instancePath || node.instance) as string
      ;(entity as any).prefab = {
        source: src.replace(/^res:\/\//, 'scenes/').replace(/\.tscn$/, '.lscene'),
      }
    }

    // Transform
    const transformProp = node.properties['transform']
    if (transformProp && transformProp.basis && transformProp.origin) {
      const decomposed = transform3DToEulerDegrees(transformProp as Transform3DValue)
      const t = entity.getTransform()
      t.setPosition(decomposed.position.x, decomposed.position.y, decomposed.position.z)
      t.setRotation(decomposed.rotation.x, decomposed.rotation.y, decomposed.rotation.z)
      t.setScale(decomposed.scale.x, decomposed.scale.y, decomposed.scale.z)
    }

    const type = node.type || 'Node3D'

    // Node Type Mapping
    switch (type) {
      case 'Node3D':
        // Default node, transform is already set
        break

      case 'Camera3D': {
        const cam = new Camera()
        if (node.properties['fov'] !== undefined) cam.fov = Number(node.properties['fov'])
        if (node.properties['near'] !== undefined) cam.near = Number(node.properties['near'])
        if (node.properties['far'] !== undefined) cam.far = Number(node.properties['far'])
        entity.addComponent(cam)
        break
      }

      case 'OmniLight3D': {
        const light = new Light(LightType.POINT)
        if (node.properties['light_energy'] !== undefined) light.intensity = Number(node.properties['light_energy'])
        if (node.properties['omni_range'] !== undefined) light.range = Number(node.properties['omni_range'])
        if (node.properties['light_color']) {
          light.color = {
            r: node.properties['light_color'].r ?? 1,
            g: node.properties['light_color'].g ?? 1,
            b: node.properties['light_color'].b ?? 1,
          }
        }
        entity.addComponent(light)
        break
      }

      case 'DirectionalLight3D': {
        const light = new Light(LightType.DIRECTIONAL)
        if (node.properties['light_energy'] !== undefined) light.intensity = Number(node.properties['light_energy'])
        if (node.properties['light_color']) {
          light.color = {
            r: node.properties['light_color'].r ?? 1,
            g: node.properties['light_color'].g ?? 1,
            b: node.properties['light_color'].b ?? 1,
          }
        }
        entity.addComponent(light)
        break
      }

      case 'SpotLight3D': {
        const light = new Light(LightType.SPOT)
        if (node.properties['light_energy'] !== undefined) light.intensity = Number(node.properties['light_energy'])
        if (node.properties['spot_range'] !== undefined) light.range = Number(node.properties['spot_range'])
        if (node.properties['light_color']) {
          light.color = {
            r: node.properties['light_color'].r ?? 1,
            g: node.properties['light_color'].g ?? 1,
            b: node.properties['light_color'].b ?? 1,
          }
        }
        entity.addComponent(light)
        break
      }

      case 'MeshInstance3D': {
        const meshRenderer = new MeshRenderer()
        const meshRef = node.properties['mesh']
        if (meshRef instanceof GodotSubResource) {
          const sub = subResMap.get(meshRef.id)
          if (sub) {
            if (sub.type === 'BoxMesh') (meshRenderer as any).primitive = 'box'
            else if (sub.type === 'SphereMesh') (meshRenderer as any).primitive = 'sphere'
            else if (sub.type === 'CylinderMesh') (meshRenderer as any).primitive = 'cylinder'
            else if (sub.type === 'PlaneMesh') (meshRenderer as any).primitive = 'plane'
            else if (sub.type === 'CapsuleMesh') (meshRenderer as any).primitive = 'capsule'

            // Check material
            const matRef = sub.properties['material']
            if (matRef instanceof GodotSubResource) {
              const matSub = subResMap.get(matRef.id)
              if (matSub && matSub.type === 'StandardMaterial3D') {
                const matData = MaterialMap.fromGodotStandardMaterial(matSub.properties)
                ;(meshRenderer as any).color = matData.color
                ;(meshRenderer as any).roughness = matData.roughness
                ;(meshRenderer as any).metalness = matData.metallic
              }
            }
          }
        }
        entity.addComponent(meshRenderer)
        break
      }

      case 'RigidBody3D': {
        const rb = new Rigidbody()
        if (node.properties['mass'] !== undefined) rb.mass = Number(node.properties['mass'])
        if (node.properties['gravity_scale'] !== undefined) rb.useGravity = Number(node.properties['gravity_scale']) > 0
        entity.addComponent(rb)
        break
      }

      case 'StaticBody3D': {
        const rb = new Rigidbody()
        rb.mass = 0
        rb.useGravity = false
        entity.addComponent(rb)
        break
      }

      case 'CSGBox3D': {
        const meshRenderer = new MeshRenderer()
        ;(meshRenderer as any).primitive = 'box'
        if (node.properties['size'] && typeof node.properties['size'] === 'object') {
          const s = node.properties['size']
          const t = entity.getTransform()
          t.setScale(s.x ?? 1, s.y ?? 1, s.z ?? 1)
        }
        if (node.properties['material'] instanceof GodotSubResource) {
          const matSub = subResMap.get(node.properties['material'].id)
          if (matSub && matSub.type === 'StandardMaterial3D') {
            const matData = MaterialMap.fromGodotStandardMaterial(matSub.properties)
            ;(meshRenderer as any).color = matData.color
            ;(meshRenderer as any).roughness = matData.roughness
            ;(meshRenderer as any).metalness = matData.metallic
          }
        }
        entity.addComponent(meshRenderer)
        break
      }

      case 'CSGSphere3D': {
        const meshRenderer = new MeshRenderer()
        ;(meshRenderer as any).primitive = 'sphere'
        if (node.properties['radius'] !== undefined) {
          const r = Number(node.properties['radius']) * 2
          entity.getTransform().setScale(r, r, r)
        }
        entity.addComponent(meshRenderer)
        break
      }

      case 'CSGCylinder3D': {
        const meshRenderer = new MeshRenderer()
        ;(meshRenderer as any).primitive = 'cylinder'
        const r = Number(node.properties['radius'] ?? 0.5) * 2
        const h = Number(node.properties['height'] ?? 2)
        entity.getTransform().setScale(r, h, r)
        entity.addComponent(meshRenderer)
        break
      }

      case 'CollisionShape3D': {
        const shapeRef = node.properties['shape']
        if (shapeRef instanceof GodotSubResource) {
          const sub = subResMap.get(shapeRef.id)
          if (sub) {
            if (sub.type === 'BoxShape3D') {
              const col = new BoxCollider()
              if (sub.properties['size']) col.size = sub.properties['size']
              entity.addComponent(col)
            } else if (sub.type === 'SphereShape3D') {
              const col = new SphereCollider()
              if (sub.properties['radius'] !== undefined) col.radius = Number(sub.properties['radius'])
              entity.addComponent(col)
            } else if (sub.type === 'CapsuleShape3D') {
              const col = new CapsuleCollider()
              if (sub.properties['radius'] !== undefined) col.radius = Number(sub.properties['radius'])
              if (sub.properties['height'] !== undefined) col.height = Number(sub.properties['height'])
              entity.addComponent(col)
            }
          }
        }
        break
      }

      default: {
        // Unknown Godot node -> GodotPassthroughComponent (UT-09)
        const passthrough = new GodotPassthroughComponent(type, node.properties)
        entity.addComponent(passthrough)
        report.recordSkipped(
          entity.id,
          node.name,
          type,
          `Unknown node type "${type}" imported as GodotPassthroughComponent`
        )
        break
      }
    }

    report.recordConverted()
    return entity
  }
}
