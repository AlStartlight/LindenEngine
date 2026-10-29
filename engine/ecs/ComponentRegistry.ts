import { Component, Transform } from './Component'
import { MeshRenderer, Camera, Light, LightType } from '../renderer/Components'
import { Water } from '../environment/Water'
import { ParticleEmitter } from '../vfx/ParticleEmitter'
import { DEFAULT_PARTICLE_VALUES as PD, PARTICLE_PRESETS } from '../vfx/presets'
import { Rigidbody, BoxCollider, SphereCollider, CapsuleCollider, MeshCollider, CharacterController, Joint } from '../physics/components'
import { TimerComponent } from '../time/Timer'
import { Script, HtmlUI } from '../scripting/ScriptComponents'
import { CharacterMovement } from '../movement/CharacterMovement'
import { ModelComponent } from '../model/ModelComponent'
import { PRIMITIVE_KINDS } from '../renderer/primitives'

export type PropertyKind =
  | 'number'
  | 'int'
  | 'boolean'
  | 'string'
  | 'color'
  | 'vector2'
  | 'vector3'
  | 'enum'
  | 'entityRef'
  | 'assetRef'
  | 'layerMask'
  | 'event'
  | 'array'
  | 'json'
  | 'material'

export interface PropertySchema {
  name: string
  label?: string
  kind: PropertyKind
  default: unknown
  min?: number
  max?: number
  step?: number
  options?: string[]
  assetType?: string
  tooltip?: string
  hideInInspector?: boolean
}

export interface ComponentDefinition {
  type: string
  menuPath: string
  icon?: string
  properties: PropertySchema[]
  requires?: string[]
  disallowMultiple?: boolean
  create: () => Component
}

class RegistryManager {
  private definitions: Map<string, ComponentDefinition> = new Map()

  register(def: ComponentDefinition): void {
    this.definitions.set(def.type, def)
  }

  get(type: string): ComponentDefinition | undefined {
    return this.definitions.get(type)
  }

  getAll(): ComponentDefinition[] {
    return Array.from(this.definitions.values())
  }

  /**
   * Fuzzy / prefix search for Add Component dialog
   */
  search(query: string): ComponentDefinition[] {
    const q = query.toLowerCase().trim()
    if (!q) {
      return this.getAll().sort((a, b) => a.menuPath.localeCompare(b.menuPath))
    }

    const words = q.split(/\s+/).filter(Boolean)

    const matches = this.getAll().filter((def) => {
      const typeLower = def.type.toLowerCase()
      const menuLower = def.menuPath.toLowerCase()

      // Match all search words
      return words.every((word) => typeLower.includes(word) || menuLower.includes(word))
    })

    // Sort by relevance: startsWith gets higher priority
    return matches.sort((a, b) => {
      const aType = a.type.toLowerCase()
      const bType = b.type.toLowerCase()
      const aStarts = aType.startsWith(q)
      const bStarts = bType.startsWith(q)
      if (aStarts && !bStarts) return -1
      if (!aStarts && bStarts) return 1
      return aType.localeCompare(bType)
    })
  }
}

export const ComponentRegistry = new RegistryManager()

// Register default built-in components
ComponentRegistry.register({
  type: 'Transform',
  menuPath: 'Core/Transform',
  icon: 'Move',
  disallowMultiple: true,
  create: () => new Transform(),
  properties: [
    { name: 'position', label: 'Position', kind: 'vector3', default: { x: 0, y: 0, z: 0 } },
    { name: 'rotation', label: 'Rotation', kind: 'vector3', default: { x: 0, y: 0, z: 0 } },
    { name: 'scale', label: 'Scale', kind: 'vector3', default: { x: 1, y: 1, z: 1 } },
  ],
})

ComponentRegistry.register({
  type: 'MeshRenderer',
  menuPath: 'Rendering/Mesh Renderer',
  icon: 'Box',
  disallowMultiple: true,
  create: () => new MeshRenderer(),
  properties: [
    { name: 'primitive', label: 'Primitive', kind: 'enum', default: 'box', options: [...PRIMITIVE_KINDS], tooltip: 'Ukuran 1 m (capsule Ø1×2 m)' },
    { name: 'material', label: 'Material', kind: 'material', default: {}, tooltip: 'Preset PBR + override; kosong = pakai Color/Roughness/Metalness' },
    { name: 'color', label: 'Color', kind: 'color', default: '#3b82f6' },
    { name: 'roughness', label: 'Roughness', kind: 'number', default: 0.5, min: 0, max: 1, step: 0.05 },
    { name: 'metalness', label: 'Metalness', kind: 'number', default: 0.1, min: 0, max: 1, step: 0.05 },
    { name: 'size', label: 'Mesh Size', kind: 'vector3', default: { x: 1, y: 1, z: 1 }, hideInInspector: true, tooltip: 'Skala mesh saja (tidak diwarisi child); dipakai migrasi scene v1' },
    { name: 'castShadow', label: 'Cast Shadows', kind: 'boolean', default: true },
    { name: 'receiveShadow', label: 'Receive Shadows', kind: 'boolean', default: true },
    { name: 'isVisible', label: 'Visible', kind: 'boolean', default: true },
  ],
})

ComponentRegistry.register({
  type: 'Model',
  menuPath: 'Rendering/Model',
  icon: 'Box',
  disallowMultiple: true,
  create: () => new ModelComponent(),
  properties: [
    { name: 'src', label: 'Model File', kind: 'assetRef', assetType: 'model', default: '', tooltip: 'assets/*.glb|gltf|obj; kosong = pakai parts' },
    { name: 'parts', label: 'Parts', kind: 'json', default: [], tooltip: 'Daftar part (roundedBox, lathe, extrude, tube, ...); lihat linden_model_build' },
    { name: 'category', label: 'Category', kind: 'string', default: '', tooltip: 'Kunci tabel ukuran nyata, mis. chair' },
    { name: 'placement', label: 'Placement', kind: 'enum', default: 'floor', options: ['floor', 'wall', 'ceiling', 'free'] },
    { name: 'merge', label: 'Merge Static Parts', kind: 'boolean', default: true },
    { name: 'collider', label: 'Auto Collider', kind: 'enum', default: 'none', options: ['none', 'box', 'convexHull'] },
    { name: 'animation', label: 'Animation Clip', kind: 'string', default: '' },
    { name: 'instances', label: 'Instances', kind: 'json', default: [], hideInInspector: true },
    { name: 'castShadow', label: 'Cast Shadows', kind: 'boolean', default: true },
    { name: 'receiveShadow', label: 'Receive Shadows', kind: 'boolean', default: true },
  ],
})

ComponentRegistry.register({
  type: 'Camera',
  menuPath: 'Rendering/Camera',
  icon: 'Camera',
  disallowMultiple: true,
  create: () => new Camera(),
  properties: [
    { name: 'fov', label: 'Field of View', kind: 'number', default: 60, min: 10, max: 120, step: 1 },
    { name: 'near', label: 'Near Clip', kind: 'number', default: 0.1, min: 0.01, max: 10, step: 0.1 },
    { name: 'far', label: 'Far Clip', kind: 'number', default: 1000, min: 10, max: 10000, step: 10 },
    { name: 'isActive', label: 'Active', kind: 'boolean', default: true },
  ],
})

ComponentRegistry.register({
  type: 'Light',
  menuPath: 'Rendering/Light',
  icon: 'Sun',
  disallowMultiple: false,
  create: () => new Light(),
  properties: [
    { name: 'type', label: 'Type', kind: 'enum', default: LightType.DIRECTIONAL, options: [LightType.DIRECTIONAL, LightType.POINT, LightType.SPOT] },
    { name: 'color', label: 'Color', kind: 'color', default: '#ffffff' },
    { name: 'intensity', label: 'Intensity', kind: 'number', default: 1, min: 0, max: 500, step: 0.1, tooltip: 'Directional: ~2-4 seperti matahari; point/spot: candela (bohlam 60 W ≈ 65)' },
    { name: 'range', label: 'Range', kind: 'number', default: 10, min: 0.1, max: 100, step: 0.5 },
    { name: 'castShadow', label: 'Cast Shadows', kind: 'boolean', default: true },
  ],
})

ComponentRegistry.register({
  type: 'Rigidbody',
  menuPath: 'Physics/Rigidbody',
  icon: 'Shield',
  disallowMultiple: true,
  create: () => new Rigidbody(),
  properties: [
    { name: 'bodyType', label: 'Body Type', kind: 'enum', default: 'dynamic', options: ['dynamic', 'kinematic', 'static'] },
    { name: 'mass', label: 'Mass', kind: 'number', default: 1, min: 0.001, max: 10000, step: 0.1 },
    { name: 'drag', label: 'Drag', kind: 'number', default: 0, min: 0, max: 100, step: 0.05 },
    { name: 'angularDrag', label: 'Angular Drag', kind: 'number', default: 0.05, min: 0, max: 100, step: 0.05 },
    { name: 'useGravity', label: 'Use Gravity', kind: 'boolean', default: true },
    { name: 'freezePosition', label: 'Freeze Position', kind: 'vector3', default: { x: false, y: false, z: false } },
    { name: 'freezeRotation', label: 'Freeze Rotation', kind: 'vector3', default: { x: false, y: false, z: false } },
    { name: 'ccd', label: 'Continuous Collision', kind: 'boolean', default: false, tooltip: 'Untuk benda cepat (peluru) agar tidak menembus dinding tipis' },
  ],
})

ComponentRegistry.register({
  type: 'Joint',
  menuPath: 'Physics/Joint',
  icon: 'Link',
  disallowMultiple: true,
  create: () => new Joint(),
  properties: [
    { name: 'type', label: 'Type', kind: 'enum', default: 'hinge', options: ['fixed', 'hinge', 'ball', 'slider'] },
    { name: 'connectedEntity', label: 'Connected Entity', kind: 'string', default: '', tooltip: 'ID entity tujuan; kosong = terpasang ke world' },
    { name: 'anchor', label: 'Anchor', kind: 'vector3', default: { x: 0, y: 0, z: 0 }, tooltip: 'Titik sambungan (lokal entity ini)' },
    { name: 'autoConnectAnchor', label: 'Auto Connected Anchor', kind: 'boolean', default: true },
    { name: 'connectedAnchor', label: 'Connected Anchor', kind: 'vector3', default: { x: 0, y: 0, z: 0 } },
    { name: 'axis', label: 'Axis', kind: 'vector3', default: { x: 0, y: 1, z: 0 }, tooltip: 'Sumbu engsel / arah slider (lokal)' },
    { name: 'limits', label: 'Limits', kind: 'json', default: { enabled: false, min: -45, max: 45 }, tooltip: 'Hinge: derajat, slider: meter' },
    { name: 'motor', label: 'Motor', kind: 'json', default: { enabled: false, targetVelocity: 0, maxForce: 100 }, tooltip: 'Hinge: derajat/detik, slider: m/detik' },
    { name: 'breakForce', label: 'Break Force', kind: 'number', default: 0, min: 0, max: 1e6, step: 10, tooltip: 'Newton; 0 = tidak bisa putus' },
    { name: 'onBreak', label: 'On Break', kind: 'event', default: [] },
  ],
})

ComponentRegistry.register({
  type: 'BoxCollider',
  menuPath: 'Physics/Box Collider',
  icon: 'Box',
  create: () => new BoxCollider(),
  properties: [
    { name: 'center', label: 'Center', kind: 'vector3', default: { x: 0, y: 0, z: 0 } },
    { name: 'size', label: 'Size', kind: 'vector3', default: { x: 1, y: 1, z: 1 } },
    { name: 'isTrigger', label: 'Is Trigger', kind: 'boolean', default: false },
    { name: 'onTriggerEnter', label: 'On Trigger Enter', kind: 'event', default: [] },
    { name: 'onTriggerExit', label: 'On Trigger Exit', kind: 'event', default: [] },
    { name: 'onCollisionEnter', label: 'On Collision Enter', kind: 'event', default: [] },
    { name: 'onCollisionExit', label: 'On Collision Exit', kind: 'event', default: [] },
  ],
})

ComponentRegistry.register({
  type: 'SphereCollider',
  menuPath: 'Physics/Sphere Collider',
  icon: 'Circle',
  create: () => new SphereCollider(),
  properties: [
    { name: 'center', label: 'Center', kind: 'vector3', default: { x: 0, y: 0, z: 0 } },
    { name: 'radius', label: 'Radius', kind: 'number', default: 0.5, min: 0.01, max: 100, step: 0.05 },
    { name: 'isTrigger', label: 'Is Trigger', kind: 'boolean', default: false },
    { name: 'onTriggerEnter', label: 'On Trigger Enter', kind: 'event', default: [] },
    { name: 'onTriggerExit', label: 'On Trigger Exit', kind: 'event', default: [] },
    { name: 'onCollisionEnter', label: 'On Collision Enter', kind: 'event', default: [] },
    { name: 'onCollisionExit', label: 'On Collision Exit', kind: 'event', default: [] },
  ],
})

ComponentRegistry.register({
  type: 'CapsuleCollider',
  menuPath: 'Physics/Capsule Collider',
  icon: 'Pill',
  create: () => new CapsuleCollider(),
  properties: [
    { name: 'center', label: 'Center', kind: 'vector3', default: { x: 0, y: 0, z: 0 } },
    { name: 'radius', label: 'Radius', kind: 'number', default: 0.5, min: 0.01, max: 100, step: 0.05 },
    { name: 'height', label: 'Height', kind: 'number', default: 2, min: 0.01, max: 100, step: 0.1 },
    { name: 'isTrigger', label: 'Is Trigger', kind: 'boolean', default: false },
    { name: 'onTriggerEnter', label: 'On Trigger Enter', kind: 'event', default: [] },
    { name: 'onTriggerExit', label: 'On Trigger Exit', kind: 'event', default: [] },
    { name: 'onCollisionEnter', label: 'On Collision Enter', kind: 'event', default: [] },
    { name: 'onCollisionExit', label: 'On Collision Exit', kind: 'event', default: [] },
  ],
})

ComponentRegistry.register({
  type: 'MeshCollider',
  menuPath: 'Physics/Mesh Collider',
  icon: 'Box',
  create: () => new MeshCollider(),
  properties: [
    { name: 'convex', label: 'Convex', kind: 'boolean', default: false },
    { name: 'isTrigger', label: 'Is Trigger', kind: 'boolean', default: false },
  ],
})

ComponentRegistry.register({
  type: 'CharacterController',
  menuPath: 'Physics/Character Controller',
  icon: 'User',
  requires: ['CapsuleCollider'],
  disallowMultiple: true,
  create: () => new CharacterController(),
  properties: [
    { name: 'stepOffset', label: 'Step Offset', kind: 'number', default: 0.3, min: 0, max: 2, step: 0.05 },
    { name: 'slopeLimit', label: 'Slope Limit', kind: 'number', default: 45, min: 0, max: 90, step: 1 },
    { name: 'skinWidth', label: 'Skin Width', kind: 'number', default: 0.08, min: 0.001, max: 0.5, step: 0.01 },
  ],
})

ComponentRegistry.register({
  type: 'Water',
  menuPath: 'Environment/Water',
  icon: 'Waves',
  disallowMultiple: true,
  create: () => new Water(),
  properties: [
    { name: 'size', label: 'Size', kind: 'vector2', default: { x: 20, y: 20 }, tooltip: 'Lebar (X) dan panjang (Z) permukaan, meter' },
    { name: 'color', label: 'Color', kind: 'color', default: '#1e5f74' },
    { name: 'distortion', label: 'Distortion', kind: 'number', default: 3.7, min: 0, max: 20, step: 0.1 },
    { name: 'waveSpeed', label: 'Wave Speed', kind: 'number', default: 1, min: 0, max: 10, step: 0.1, tooltip: 'WebGPU memakai kecepatan tetap' },
    { name: 'reflections', label: 'Reflections', kind: 'boolean', default: true, tooltip: 'Mati otomatis di profil kualitas Low' },
    { name: 'buoyancy', label: 'Buoyancy', kind: 'boolean', default: true, tooltip: 'Benda dinamis mengapung' },
    { name: 'density', label: 'Density', kind: 'number', default: 1000, min: 1, max: 20000, step: 10, tooltip: 'kg/m³ (air tawar 1000, air laut 1025)' },
    { name: 'linearDrag', label: 'Linear Drag', kind: 'number', default: 4, min: 0, max: 20, step: 0.1, tooltip: 'Redaman saat terendam; makin besar makin cepat tenang' },
    { name: 'angularDrag', label: 'Angular Drag', kind: 'number', default: 2, min: 0, max: 20, step: 0.1 },
  ],
})

ComponentRegistry.register({
  type: 'ParticleEmitter',
  menuPath: 'Effects/Particle Emitter',
  icon: 'Sparkles',
  disallowMultiple: true,
  create: () => new ParticleEmitter(),
  properties: [
    { name: 'preset', label: 'Preset', kind: 'enum', default: 'custom', options: ['custom', ...PARTICLE_PRESETS], tooltip: 'Memilih preset mengisi ulang semua field di bawah' },
    { name: 'playOnStart', label: 'Play On Start', kind: 'boolean', default: true },
    { name: 'loop', label: 'Loop', kind: 'boolean', default: PD.loop },
    { name: 'duration', label: 'Duration', kind: 'number', default: PD.duration, min: 0.01, max: 60, step: 0.1 },
    { name: 'rate', label: 'Rate', kind: 'number', default: PD.rate, min: 0, max: 5000, step: 1, tooltip: 'Partikel per detik' },
    { name: 'bursts', label: 'Bursts', kind: 'json', default: [], tooltip: '[{ "time": 0, "count": 50 }]' },
    { name: 'maxParticles', label: 'Max Particles', kind: 'int', default: PD.maxParticles, min: 1, max: 2000, step: 10, tooltip: 'Dibatasi profil kualitas (Low 200, Medium 1000, High 2000)' },
    { name: 'shape', label: 'Shape', kind: 'enum', default: PD.shape, options: ['point', 'sphere', 'box', 'cone'] },
    { name: 'shapeSize', label: 'Shape Size', kind: 'vector3', default: PD.shapeSize, tooltip: 'sphere/cone: X = radius; box: ukuran' },
    { name: 'coneAngle', label: 'Cone Angle', kind: 'number', default: PD.coneAngle, min: 0, max: 180, step: 1 },
    { name: 'lifetime', label: 'Lifetime', kind: 'json', default: PD.lifetime, tooltip: '{ "min": 0.8, "max": 1.2 } detik' },
    { name: 'speed', label: 'Speed', kind: 'json', default: PD.speed, tooltip: '{ "min": 1, "max": 2 } m/detik' },
    { name: 'gravity', label: 'Gravity', kind: 'number', default: PD.gravity, min: -5, max: 5, step: 0.05, tooltip: 'Kali gravitasi dunia; negatif = naik (asap)' },
    { name: 'drag', label: 'Drag', kind: 'number', default: PD.drag, min: 0, max: 20, step: 0.1 },
    { name: 'size', label: 'Size Over Life', kind: 'json', default: PD.size, tooltip: '[{ "t": 0, "v": 0.2 }, { "t": 1, "v": 0 }] meter' },
    { name: 'color', label: 'Color Over Life', kind: 'json', default: PD.color, tooltip: '[{ "t": 0, "color": "#ffffff", "alpha": 1 }]' },
    { name: 'blending', label: 'Blending', kind: 'enum', default: PD.blending, options: ['additive', 'normal'] },
    { name: 'texture', label: 'Texture', kind: 'string', default: PD.texture, tooltip: 'soft, spark, smoke, square, atau assets/...png' },
    { name: 'space', label: 'Space', kind: 'enum', default: PD.space, options: ['world', 'local'] },
    { name: 'seed', label: 'Seed', kind: 'int', default: 0, min: 0, max: 2147483647, step: 1, tooltip: '0 = acak tiap play' },
    { name: 'light', label: 'Light', kind: 'json', default: PD.light, tooltip: 'PointLight ikut emitter (mati di profil Low)' },
    { name: 'onFinished', label: 'On Finished', kind: 'event', default: [] },
  ],
})

ComponentRegistry.register({
  type: 'Timer',
  menuPath: 'Gameplay/Timer',
  icon: 'Clock',
  create: () => new TimerComponent(),
  properties: [
    { name: 'waitTime', label: 'Wait Time', kind: 'number', default: 1, min: 0.01, max: 3600, step: 0.1 },
    { name: 'oneShot', label: 'One Shot', kind: 'boolean', default: false },
    { name: 'autoStart', label: 'Auto Start', kind: 'boolean', default: true },
    { name: 'onTimeout', label: 'On Timeout', kind: 'event', default: [] },
  ],
})

ComponentRegistry.register({
  type: 'Script',
  menuPath: 'Scripting/Script',
  icon: 'Code',
  disallowMultiple: true,
  create: () => new Script(),
  properties: [
    { name: 'src', label: 'Script', kind: 'assetRef', assetType: 'script', default: '', tooltip: 'scripts/PlayerController.ts' },
    { name: 'props', label: 'Properties', kind: 'json', default: {}, tooltip: 'Nilai awal field publik script (JSON)' },
  ],
})

ComponentRegistry.register({
  type: 'HtmlUI',
  menuPath: 'UI/HTML UI',
  icon: 'Layout',
  disallowMultiple: true,
  create: () => new HtmlUI(),
  properties: [
    { name: 'src', label: 'HTML File', kind: 'assetRef', assetType: 'html', default: '', tooltip: 'ui/hud.html' },
    { name: 'mode', label: 'Mode', kind: 'enum', default: 'screen', options: ['screen', 'world'] },
    { name: 'zIndex', label: 'Z Index', kind: 'int', default: 0 },
    { name: 'pointerEvents', label: 'Capture Input', kind: 'boolean', default: false },
    { name: 'pixelSize', label: 'World Pixel Size', kind: 'number', default: 0.01, min: 0.0001, max: 1, step: 0.001 },
  ],
})

ComponentRegistry.register({
  type: 'CharacterMovement',
  menuPath: 'Gameplay/Character Movement',
  icon: 'Footprints',
  requires: ['CharacterController'],
  disallowMultiple: true,
  create: () => new CharacterMovement(),
  properties: [
    { name: 'mode', label: 'Mode', kind: 'enum', default: 'walk', options: ['walk', 'fly', 'topdown'] },
    { name: 'qeMode', label: 'Q/E', kind: 'enum', default: 'turn', options: ['turn', 'vertical', 'strafe'], tooltip: 'turn = putar, vertical = turun/naik, strafe = geser' },
    { name: 'walkSpeed', label: 'Walk Speed', kind: 'number', default: 4, min: 0, max: 50, step: 0.1 },
    { name: 'sprintSpeed', label: 'Sprint Speed', kind: 'number', default: 7, min: 0, max: 80, step: 0.1 },
    { name: 'crouchSpeed', label: 'Crouch Speed', kind: 'number', default: 2, min: 0, max: 50, step: 0.1 },
    { name: 'acceleration', label: 'Acceleration', kind: 'number', default: 30, min: 0.1, max: 500, step: 1 },
    { name: 'deceleration', label: 'Deceleration', kind: 'number', default: 40, min: 0.1, max: 500, step: 1 },
    { name: 'airControl', label: 'Air Control', kind: 'number', default: 0.4, min: 0, max: 1, step: 0.05 },
    { name: 'jumpHeight', label: 'Jump Height', kind: 'number', default: 1.2, min: 0, max: 20, step: 0.1 },
    { name: 'gravity', label: 'Gravity', kind: 'number', default: 20, min: 0, max: 100, step: 0.5 },
    { name: 'maxJumps', label: 'Max Jumps', kind: 'int', default: 1, min: 0, max: 5, step: 1 },
    { name: 'coyoteTime', label: 'Coyote Time', kind: 'number', default: 0.1, min: 0, max: 1, step: 0.01 },
    { name: 'jumpBuffer', label: 'Jump Buffer', kind: 'number', default: 0.1, min: 0, max: 1, step: 0.01 },
    { name: 'turnSpeed', label: 'Turn Speed (°/s)', kind: 'number', default: 180, min: 0, max: 1080, step: 5 },
    { name: 'lookSpeed', label: 'Look Speed (°/s)', kind: 'number', default: 180, min: 0, max: 1080, step: 5 },
    { name: 'orientToMovement', label: 'Face Movement', kind: 'boolean', default: true },
    { name: 'cameraRelative', label: 'Camera Relative', kind: 'boolean', default: true },
    { name: 'analogWalk', label: 'Analog Speed', kind: 'boolean', default: true },
    { name: 'lockAxis', label: 'Lock Axis (2D)', kind: 'enum', default: 'none', options: ['none', 'x', 'z'] },
    { name: 'moveAction', label: 'Move Action', kind: 'string', default: 'Move' },
    { name: 'turnAction', label: 'Turn Action', kind: 'string', default: 'Turn' },
    { name: 'verticalAction', label: 'Vertical Action', kind: 'string', default: 'Vertical' },
    { name: 'jumpAction', label: 'Jump Action', kind: 'string', default: 'Jump' },
    { name: 'sprintAction', label: 'Sprint Action', kind: 'string', default: 'Sprint' },
    { name: 'crouchAction', label: 'Crouch Action', kind: 'string', default: 'Crouch' },
    { name: 'lookAction', label: 'Look Action', kind: 'string', default: 'Look' },
  ],
})
