import type { GodotSceneIR, GodotNodeIR, GodotValue } from '../../shared/godotBridgeTypes'

export interface MappedSceneResult {
  sceneData: {
    format: 'linden-scene'
    version: 2
    name: string
    settings: {
      ambientColor: string
      skybox: string | null
    }
    entities: any[]
  }
  stats: {
    native: number
    passthrough: number
    skipped: number
    error: number
    typeCounts: Record<string, { total: number; native: number; passthrough: number }>
  }
}

const NATIVE_3D_TYPES = new Set([
  'Node3D',
  'Camera3D',
  'DirectionalLight3D',
  'OmniLight3D',
  'SpotLight3D',
  'MeshInstance3D',
  'RigidBody3D',
  'StaticBody3D',
  'CollisionShape3D',
  'CSGBox3D',
  'CSGSphere3D',
  'CSGCylinder3D',
])

const NATIVE_2D_TYPES = new Set([
  'Node2D',
  'Sprite2D',
  'CollisionShape2D',
  'RigidBody2D',
  'StaticBody2D',
])

function decomposeTransform3D(t3d: any): {
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
} {
  const origin: [number, number, number] = [0, 0, 0]
  if (t3d.origin && Array.isArray(t3d.origin)) {
    origin[0] = t3d.origin[0] ?? 0
    origin[1] = t3d.origin[1] ?? 0
    origin[2] = t3d.origin[2] ?? 0
  }

  const b = t3d.basis
  if (!b || !Array.isArray(b) || b.length < 9) {
    return { position: origin, rotation: [0, 0, 0], scale: [1, 1, 1] }
  }

  // Column vectors from basis:
  // b[0], b[1], b[2] is row 0 or row-major
  // Standard Godot: basis has 3 Vector3 rows (x, y, z)
  const bx = [b[0], b[3], b[6]]
  const by = [b[1], b[4], b[7]]
  const bz = [b[2], b[5], b[8]]

  const sx = Math.hypot(bx[0], bx[1], bx[2]) || 1
  const sy = Math.hypot(by[0], by[1], by[2]) || 1
  const sz = Math.hypot(bz[0], bz[1], bz[2]) || 1

  // Rotation Euler YXZ in degrees
  const r12 = -b[5] / sz
  let rotX = 0
  let rotY = 0
  let rotZ = 0

  if (Math.abs(r12) < 0.99999) {
    rotX = Math.asin(Math.max(-1, Math.min(1, r12)))
    rotY = Math.atan2(b[2] / sz, b[8] / sz)
    rotZ = Math.atan2(b[3] / sx, b[4] / sy)
  } else {
    rotX = (Math.PI / 2) * Math.sign(r12)
    rotY = Math.atan2(-b[1] / sy, b[0] / sx)
    rotZ = 0
  }

  const toDeg = 180 / Math.PI
  return {
    position: origin,
    rotation: [rotX * toDeg, rotY * toDeg, rotZ * toDeg],
    scale: [sx, sy, sz],
  }
}

export function mapGodotSceneIR(sceneIR: GodotSceneIR): MappedSceneResult {
  const entities: any[] = []
  const stats = {
    native: 0,
    passthrough: 0,
    skipped: 0,
    error: 0,
    typeCounts: {} as Record<string, { total: number; native: number; passthrough: number }>,
  }

  const pathToId = new Map<string, string>()

  const sceneName = sceneIR.path
    ? sceneIR.path.split('/').pop()?.replace(/\.tscn$/, '') || 'Scene'
    : 'Scene'

  for (let i = 0; i < sceneIR.nodes.length; i++) {
    const node = sceneIR.nodes[i]
    const id = `godot-node-${i}-${node.name}`
    pathToId.set(node.path, id)

    // Determine parent ID
    let parentId: string | null = null
    if (node.path !== '.') {
      const lastSlash = node.path.lastIndexOf('/')
      const parentPath = lastSlash === -1 ? '.' : node.path.slice(0, lastSlash)
      parentId = pathToId.get(parentPath) || null
    }

    const type = node.type || 'Node'
    if (!stats.typeCounts[type]) {
      stats.typeCounts[type] = { total: 0, native: 0, passthrough: 0 }
    }
    stats.typeCounts[type].total++

    const isNative = NATIVE_3D_TYPES.has(type) || NATIVE_2D_TYPES.has(type)
    if (isNative) {
      stats.native++
      stats.typeCounts[type].native++
    } else {
      stats.passthrough++
      stats.typeCounts[type].passthrough++
    }

    // Components
    const components: any[] = []

    // 1. Transform component
    let transform = {
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
    }

    if (node.props['transform']) {
      transform = decomposeTransform3D(node.props['transform'])
    } else if (node.props['position'] && typeof node.props['position'] === 'object') {
      const p = node.props['position'] as any
      if (p.$t === 'Vector2' && Array.isArray(p.v)) {
        transform.position = [p.v[0] ?? 0, -(p.v[1] ?? 0), 0]
      } else if (p.$t === 'Vector3' && Array.isArray(p.v)) {
        transform.position = [p.v[0] ?? 0, p.v[1] ?? 0, p.v[2] ?? 0]
      }
    }

    components.push({
      type: 'Transform',
      data: {
        position: transform.position,
        rotation: transform.rotation,
        scale: transform.scale,
      },
    })

    // 2. Specific Native Components
    if (type === 'Camera3D') {
      components.push({
        type: 'Camera',
        data: {
          fov: typeof node.props['fov'] === 'number' ? node.props['fov'] : 75,
          near: typeof node.props['near'] === 'number' ? node.props['near'] : 0.05,
          far: typeof node.props['far'] === 'number' ? node.props['far'] : 4000,
        },
      })
    } else if (type === 'DirectionalLight3D' || type === 'OmniLight3D' || type === 'SpotLight3D') {
      const lightType =
        type === 'DirectionalLight3D' ? 'directional' : type === 'SpotLight3D' ? 'spot' : 'point'
      components.push({
        type: 'Light',
        data: {
          type: lightType,
          intensity: typeof node.props['light_energy'] === 'number' ? node.props['light_energy'] : 1,
        },
      })
    } else if (type === 'CSGBox3D' || type === 'CSGSphere3D' || type === 'CSGCylinder3D') {
      const primitive = type === 'CSGSphere3D' ? 'sphere' : type === 'CSGCylinder3D' ? 'cylinder' : 'box'
      components.push({
        type: 'MeshRenderer',
        data: {
          primitive,
          color: '#3b82f6',
          roughness: 0.5,
          metalness: 0.1,
          castShadow: true,
          receiveShadow: true,
          isVisible: true,
        },
      })
    } else if (type === 'MeshInstance3D') {
      components.push({
        type: 'MeshRenderer',
        data: {
          primitive: 'box',
          color: '#3b82f6',
          roughness: 0.5,
          metalness: 0.1,
          castShadow: true,
          receiveShadow: true,
          isVisible: true,
        },
      })
    } else if (type === 'RigidBody3D' || type === 'StaticBody3D') {
      components.push({
        type: 'Rigidbody',
        data: {
          mass: type === 'StaticBody3D' ? 0 : typeof node.props['mass'] === 'number' ? node.props['mass'] : 1,
          useGravity: type !== 'StaticBody3D',
        },
      })
    } else if (type === 'CollisionShape3D') {
      components.push({
        type: 'BoxCollider',
        data: {
          size: { x: 1, y: 1, z: 1 },
        },
      })
    }

    // 3. Passthrough Component (for unmapped/control/UI nodes)
    if (!isNative) {
      components.push({
        type: 'GodotPassthrough',
        data: {
          rawType: type,
          rawProperties: node.props,
        },
      })
    }

    // 4. Prefab Instance (if node is an instance of another scene)
    let prefab: any = undefined
    if (node.instance) {
      const relScene = node.instance.replace(/^res:\/\//, '').replace(/\.tscn$/, '.lscene')
      prefab = {
        source: `scenes/${relScene}`,
      }
    }

    entities.push({
      id,
      name: node.name,
      active: true,
      static: type === 'StaticBody3D',
      tags: node.groups || [],
      layer: 0,
      parentId,
      prefab,
      components,
    })
  }

  return {
    sceneData: {
      format: 'linden-scene',
      version: 2,
      name: sceneName,
      settings: {
        ambientColor: '#666666',
        skybox: null,
      },
      entities,
    },
    stats,
  }
}
