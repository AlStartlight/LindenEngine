/**
 * Virtual Camera System (Unity Cinemachine-like)
 * 
 * Sistem kamera virtual yang mudah digunakan dengan berbagai mode
 * seperti Follow, LookAt, Dolly, dll.
 */

import { nanoid } from '../utils/index'

// ==================== TYPES ====================

export interface Vector3 {
  x: number
  y: number
  z: number
}

export interface Quaternion {
  x: number
  y: number
  z: number
  w: number
}

// ==================== BODY MODES ====================

/**
 * Body Mode - Cara kamera mengikuti target
 */
export enum BodyMode {
  DO_NOTHING = 'doNothing',
  THIRD_PERSON_FOLLOW = 'thirdPersonFollow',
  FRAMING_TRANSPOSER = 'framingTransposer',
  ORBITAL_TRANSPOSER = 'orbitalTransposer',
  TRACKED_DOLLY = 'trackedDolly',
  HARD_LOCK_TO_TARGET = 'hardLockToTarget',
}

/**
 * Aim Mode - Cara kamera mengarah
 */
export enum AimMode {
  DO_NOTHING = 'doNothing',
  COMPOSER = 'composer',
  GROUP_COMPOSER = 'groupComposer',
  HARD_LOOK_AT = 'hardLookAt',
  POV = 'pov',
  SAME_AS_FOLLOW_TARGET = 'sameAsFollowTarget',
}

// ==================== NOISE SYSTEM ====================

/**
 * Noise Profile - Untuk camera shake
 */
export interface NoiseProfile {
  id: string
  name: string
  amplitudeGain: number
  frequencyGain: number
  // Perlin noise parameters
  positionNoise: {
    x: { amplitude: number; frequency: number }
    y: { amplitude: number; frequency: number }
    z: { amplitude: number; frequency: number }
  }
  rotationNoise: {
    x: { amplitude: number; frequency: number }
    y: { amplitude: number; frequency: number }
    z: { amplitude: number; frequency: number }
  }
}

/**
 * Built-in noise profiles
 */
export const NoiseProfiles: Record<string, NoiseProfile> = {
  HandheldNormal: {
    id: 'handheld-normal',
    name: 'Handheld Normal',
    amplitudeGain: 1,
    frequencyGain: 1,
    positionNoise: {
      x: { amplitude: 0.05, frequency: 0.5 },
      y: { amplitude: 0.05, frequency: 0.3 },
      z: { amplitude: 0.05, frequency: 0.4 },
    },
    rotationNoise: {
      x: { amplitude: 0.5, frequency: 0.3 },
      y: { amplitude: 0.5, frequency: 0.2 },
      z: { amplitude: 0.3, frequency: 0.1 },
    },
  },
  Shake: {
    id: 'shake',
    name: 'Camera Shake',
    amplitudeGain: 1,
    frequencyGain: 1,
    positionNoise: {
      x: { amplitude: 0.1, frequency: 25 },
      y: { amplitude: 0.1, frequency: 25 },
      z: { amplitude: 0.05, frequency: 25 },
    },
    rotationNoise: {
      x: { amplitude: 1, frequency: 25 },
      y: { amplitude: 1, frequency: 25 },
      z: { amplitude: 0.5, frequency: 25 },
    },
  },
  Explosion: {
    id: 'explosion',
    name: 'Explosion',
    amplitudeGain: 1,
    frequencyGain: 1,
    positionNoise: {
      x: { amplitude: 0.3, frequency: 30 },
      y: { amplitude: 0.3, frequency: 30 },
      z: { amplitude: 0.2, frequency: 30 },
    },
    rotationNoise: {
      x: { amplitude: 3, frequency: 30 },
      y: { amplitude: 3, frequency: 30 },
      z: { amplitude: 2, frequency: 30 },
    },
  },
}

// ==================== VIRTUAL CAMERA ====================

/**
 * Virtual Camera Settings
 */
export interface VirtualCameraSettings {
  // Field of View
  fov: number
  nearClip: number
  farClip: number
  
  // Third Person Follow
  followOffset: Vector3
  damping: Vector3
  
  // Framing Transposer
  screenX: number
  screenY: number
  cameraDistance: number
  deadZoneWidth: number
  deadZoneHeight: number
  softZoneWidth: number
  softZoneHeight: number
  
  // Composer
  trackedObjectOffset: Vector3
  lookaheadTime: number
  lookaheadSmoothing: number
  horizontalDamping: number
  verticalDamping: number
  
  // Noise
  noiseProfile: NoiseProfile | null
  noiseAmplitude: number
  noiseFrequency: number
}

/**
 * Default settings
 */
const defaultSettings: VirtualCameraSettings = {
  fov: 60,
  nearClip: 0.1,
  farClip: 1000,
  followOffset: { x: 0, y: 2, z: -5 },
  damping: { x: 1, y: 1, z: 1 },
  screenX: 0.5,
  screenY: 0.5,
  cameraDistance: 10,
  deadZoneWidth: 0.1,
  deadZoneHeight: 0.1,
  softZoneWidth: 0.8,
  softZoneHeight: 0.8,
  trackedObjectOffset: { x: 0, y: 0, z: 0 },
  lookaheadTime: 0,
  lookaheadSmoothing: 10,
  horizontalDamping: 0.5,
  verticalDamping: 0.5,
  noiseProfile: null,
  noiseAmplitude: 1,
  noiseFrequency: 1,
}

/**
 * Virtual Camera - Kamera virtual yang bisa di-blend
 */
export class VirtualCamera {
  public id: string
  public name: string
  public priority: number = 10
  public isActive: boolean = true
  
  // Modes
  public bodyMode: BodyMode = BodyMode.THIRD_PERSON_FOLLOW
  public aimMode: AimMode = AimMode.COMPOSER
  
  // Targets
  public followTarget: string | null = null // Entity ID
  public lookAtTarget: string | null = null // Entity ID
  
  // Settings
  public settings: VirtualCameraSettings
  
  // Current state
  public position: Vector3 = { x: 0, y: 0, z: 0 }
  public rotation: Quaternion = { x: 0, y: 0, z: 0, w: 1 }
  
  // Internal state
  private velocity: Vector3 = { x: 0, y: 0, z: 0 }
  private noiseTime: number = 0

  constructor(name: string = 'Virtual Camera') {
    this.id = nanoid()
    this.name = name
    this.settings = { ...defaultSettings }
  }

  /**
   * Update camera
   */
  update(deltaTime: number, followTargetPos: Vector3 | null, lookAtTargetPos: Vector3 | null): void {
    // Update body (position)
    this.updateBody(deltaTime, followTargetPos)
    
    // Update aim (rotation)
    this.updateAim(deltaTime, lookAtTargetPos)
    
    // Apply noise
    this.applyNoise(deltaTime)
  }

  /**
   * Update body position
   */
  private updateBody(deltaTime: number, targetPos: Vector3 | null): void {
    if (!targetPos) return

    switch (this.bodyMode) {
      case BodyMode.THIRD_PERSON_FOLLOW:
        this.updateThirdPersonFollow(deltaTime, targetPos)
        break
      case BodyMode.FRAMING_TRANSPOSER:
        this.updateFramingTransposer(deltaTime, targetPos)
        break
      case BodyMode.HARD_LOCK_TO_TARGET:
        this.position = { ...targetPos }
        this.position.x += this.settings.followOffset.x
        this.position.y += this.settings.followOffset.y
        this.position.z += this.settings.followOffset.z
        break
    }
  }

  /**
   * Third person follow
   */
  private updateThirdPersonFollow(deltaTime: number, targetPos: Vector3): void {
    const targetCamPos = {
      x: targetPos.x + this.settings.followOffset.x,
      y: targetPos.y + this.settings.followOffset.y,
      z: targetPos.z + this.settings.followOffset.z,
    }

    // Smooth follow with damping
    const dampX = Math.exp(-this.settings.damping.x * deltaTime)
    const dampY = Math.exp(-this.settings.damping.y * deltaTime)
    const dampZ = Math.exp(-this.settings.damping.z * deltaTime)

    this.position.x = this.lerp(this.position.x, targetCamPos.x, 1 - dampX)
    this.position.y = this.lerp(this.position.y, targetCamPos.y, 1 - dampY)
    this.position.z = this.lerp(this.position.z, targetCamPos.z, 1 - dampZ)
  }

  /**
   * Framing transposer
   */
  private updateFramingTransposer(deltaTime: number, targetPos: Vector3): void {
    // Calculate desired position based on screen position
    const desiredPos = {
      x: targetPos.x - this.settings.cameraDistance * Math.sin(0),
      y: targetPos.y + this.settings.cameraDistance * 0.3,
      z: targetPos.z - this.settings.cameraDistance * Math.cos(0),
    }

    // Apply damping
    const damp = Math.exp(-this.settings.horizontalDamping * deltaTime)
    this.position.x = this.lerp(this.position.x, desiredPos.x, 1 - damp)
    this.position.y = this.lerp(this.position.y, desiredPos.y, 1 - damp)
    this.position.z = this.lerp(this.position.z, desiredPos.z, 1 - damp)
  }

  /**
   * Update aim rotation
   */
  private updateAim(deltaTime: number, targetPos: Vector3 | null): void {
    if (!targetPos) return

    switch (this.aimMode) {
      case AimMode.HARD_LOOK_AT:
        this.lookAt(targetPos)
        break
      case AimMode.COMPOSER:
        this.composerLookAt(deltaTime, targetPos)
        break
    }
  }

  /**
   * Look at target
   */
  private lookAt(targetPos: Vector3): void {
    const dir = {
      x: targetPos.x - this.position.x + this.settings.trackedObjectOffset.x,
      y: targetPos.y - this.position.y + this.settings.trackedObjectOffset.y,
      z: targetPos.z - this.position.z + this.settings.trackedObjectOffset.z,
    }

    // Normalize
    const length = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z)
    if (length > 0) {
      dir.x /= length
      dir.y /= length
      dir.z /= length
    }

    // Calculate rotation quaternion (simplified)
    const pitch = Math.asin(-dir.y)
    const yaw = Math.atan2(dir.x, dir.z)

    // Convert to quaternion
    const cy = Math.cos(yaw * 0.5)
    const sy = Math.sin(yaw * 0.5)
    const cp = Math.cos(pitch * 0.5)
    const sp = Math.sin(pitch * 0.5)

    this.rotation = {
      x: sp * cy,
      y: sy * cp,
      z: -sy * sp,
      w: cy * cp,
    }
  }

  /**
   * Composer look at with damping
   */
  private composerLookAt(deltaTime: number, targetPos: Vector3): void {
    // Calculate target rotation
    const targetRotation = { ...this.rotation }
    this.lookAt(targetPos)
    const desiredRotation = { ...this.rotation }
    this.rotation = targetRotation

    // Smoothly interpolate
    const damp = Math.exp(-this.settings.horizontalDamping * 5 * deltaTime)
    this.rotation = this.slerpQuaternion(this.rotation, desiredRotation, 1 - damp)
  }

  /**
   * Apply camera noise
   */
  private applyNoise(deltaTime: number): void {
    if (!this.settings.noiseProfile) return

    this.noiseTime += deltaTime * this.settings.noiseFrequency * this.settings.noiseProfile.frequencyGain

    const profile = this.settings.noiseProfile
    const amp = this.settings.noiseAmplitude * profile.amplitudeGain

    // Apply position noise
    this.position.x += this.perlinNoise(this.noiseTime * profile.positionNoise.x.frequency) * profile.positionNoise.x.amplitude * amp
    this.position.y += this.perlinNoise(this.noiseTime * profile.positionNoise.y.frequency + 100) * profile.positionNoise.y.amplitude * amp
    this.position.z += this.perlinNoise(this.noiseTime * profile.positionNoise.z.frequency + 200) * profile.positionNoise.z.amplitude * amp
  }

  /**
   * Simple perlin-like noise
   */
  private perlinNoise(t: number): number {
    return Math.sin(t * 1.0) * 0.5 + 
           Math.sin(t * 2.3) * 0.3 + 
           Math.sin(t * 4.7) * 0.2
  }

  /**
   * Lerp helper
   */
  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
  }

  /**
   * Slerp quaternion
   */
  private slerpQuaternion(a: Quaternion, b: Quaternion, t: number): Quaternion {
    // Simplified slerp (would use proper implementation in production)
    return {
      x: this.lerp(a.x, b.x, t),
      y: this.lerp(a.y, b.y, t),
      z: this.lerp(a.z, b.z, t),
      w: this.lerp(a.w, b.w, t),
    }
  }

  /**
   * Start camera shake
   */
  shakeCamera(profileName: string, amplitude: number = 1, duration: number = 0.5): void {
    const profile = NoiseProfiles[profileName]
    if (profile) {
      this.settings.noiseProfile = profile
      this.settings.noiseAmplitude = amplitude
      
      // Auto-stop after duration
      setTimeout(() => {
        this.settings.noiseProfile = null
      }, duration * 1000)
    }
  }

  /**
   * Serialize
   */
  serialize(): Record<string, any> {
    return {
      id: this.id,
      name: this.name,
      priority: this.priority,
      isActive: this.isActive,
      bodyMode: this.bodyMode,
      aimMode: this.aimMode,
      followTarget: this.followTarget,
      lookAtTarget: this.lookAtTarget,
      settings: this.settings,
      position: this.position,
      rotation: this.rotation,
    }
  }
}

// ==================== CAMERA BRAIN ====================

export enum BlendStyle {
  CUT = 'cut',
  EASE_IN_OUT = 'easeInOut',
  EASE_IN = 'easeIn',
  EASE_OUT = 'easeOut',
  LINEAR = 'linear',
  HARD_IN = 'hardIn',
  HARD_OUT = 'hardOut',
}

/**
 * Camera Blend
 */
interface CameraBlend {
  fromCamera: VirtualCamera
  toCamera: VirtualCamera
  duration: number
  style: BlendStyle
  elapsed: number
}

/**
 * Camera Brain - Manages virtual cameras and blending
 */
export class CameraBrain {
  public id: string
  public virtualCameras: VirtualCamera[] = []
  
  // Current state
  public activeCamera: VirtualCamera | null = null
  public position: Vector3 = { x: 0, y: 0, z: 0 }
  public rotation: Quaternion = { x: 0, y: 0, z: 0, w: 1 }
  public fov: number = 60
  
  // Blending
  public defaultBlendTime: number = 0.5
  public defaultBlendStyle: BlendStyle = BlendStyle.EASE_IN_OUT
  private currentBlend: CameraBlend | null = null

  constructor() {
    this.id = nanoid()
  }

  /**
   * Add virtual camera
   */
  addVirtualCamera(camera: VirtualCamera): void {
    this.virtualCameras.push(camera)
    this.updateActiveCamera()
  }

  /**
   * Remove virtual camera
   */
  removeVirtualCamera(cameraId: string): boolean {
    const index = this.virtualCameras.findIndex(c => c.id === cameraId)
    if (index !== -1) {
      this.virtualCameras.splice(index, 1)
      this.updateActiveCamera()
      return true
    }
    return false
  }

  /**
   * Get virtual camera by ID
   */
  getVirtualCamera(cameraId: string): VirtualCamera | undefined {
    return this.virtualCameras.find(c => c.id === cameraId)
  }

  /**
   * Set camera priority (triggers blend if needed)
   */
  setCameraPriority(cameraId: string, priority: number): void {
    const camera = this.getVirtualCamera(cameraId)
    if (camera) {
      camera.priority = priority
      this.updateActiveCamera()
    }
  }

  /**
   * Update active camera based on priority
   */
  private updateActiveCamera(): void {
    const activeCameras = this.virtualCameras
      .filter(c => c.isActive)
      .sort((a, b) => b.priority - a.priority)

    const newActiveCamera = activeCameras[0] || null

    if (newActiveCamera && newActiveCamera !== this.activeCamera) {
      this.blendTo(newActiveCamera)
    }
  }

  /**
   * Blend to camera
   */
  blendTo(
    camera: VirtualCamera,
    duration: number = this.defaultBlendTime,
    style: BlendStyle = this.defaultBlendStyle
  ): void {
    if (!this.activeCamera) {
      // No previous camera, just cut
      this.activeCamera = camera
      this.position = { ...camera.position }
      this.rotation = { ...camera.rotation }
      this.fov = camera.settings.fov
      return
    }

    if (style === BlendStyle.CUT || duration <= 0) {
      // Instant cut
      this.activeCamera = camera
      this.currentBlend = null
      return
    }

    // Start blend
    this.currentBlend = {
      fromCamera: this.activeCamera,
      toCamera: camera,
      duration,
      style,
      elapsed: 0,
    }

    this.activeCamera = camera
  }

  /**
   * Update brain
   */
  update(deltaTime: number, getTargetPosition: (targetId: string) => Vector3 | null): void {
    // Update all virtual cameras
    for (const camera of this.virtualCameras) {
      if (!camera.isActive) continue

      const followPos = camera.followTarget ? getTargetPosition(camera.followTarget) : null
      const lookAtPos = camera.lookAtTarget ? getTargetPosition(camera.lookAtTarget) : null

      camera.update(deltaTime, followPos, lookAtPos)
    }

    // Update blend
    if (this.currentBlend) {
      this.currentBlend.elapsed += deltaTime

      const t = Math.min(this.currentBlend.elapsed / this.currentBlend.duration, 1)
      const easedT = this.applyBlendCurve(t, this.currentBlend.style)

      // Blend position
      this.position = {
        x: this.lerp(this.currentBlend.fromCamera.position.x, this.currentBlend.toCamera.position.x, easedT),
        y: this.lerp(this.currentBlend.fromCamera.position.y, this.currentBlend.toCamera.position.y, easedT),
        z: this.lerp(this.currentBlend.fromCamera.position.z, this.currentBlend.toCamera.position.z, easedT),
      }

      // Blend rotation (slerp)
      this.rotation = this.slerpQuaternion(
        this.currentBlend.fromCamera.rotation,
        this.currentBlend.toCamera.rotation,
        easedT
      )

      // Blend FOV
      this.fov = this.lerp(
        this.currentBlend.fromCamera.settings.fov,
        this.currentBlend.toCamera.settings.fov,
        easedT
      )

      // Check if blend complete
      if (t >= 1) {
        this.currentBlend = null
      }
    } else if (this.activeCamera) {
      // No blend, just use active camera
      this.position = { ...this.activeCamera.position }
      this.rotation = { ...this.activeCamera.rotation }
      this.fov = this.activeCamera.settings.fov
    }
  }

  /**
   * Apply blend curve
   */
  private applyBlendCurve(t: number, style: BlendStyle): number {
    switch (style) {
      case BlendStyle.LINEAR:
        return t
      case BlendStyle.EASE_IN:
        return t * t
      case BlendStyle.EASE_OUT:
        return 1 - (1 - t) * (1 - t)
      case BlendStyle.EASE_IN_OUT:
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
      case BlendStyle.HARD_IN:
        return t * t * t
      case BlendStyle.HARD_OUT:
        return 1 - Math.pow(1 - t, 3)
      default:
        return t
    }
  }

  /**
   * Lerp helper
   */
  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
  }

  /**
   * Slerp quaternion (simplified)
   */
  private slerpQuaternion(a: Quaternion, b: Quaternion, t: number): Quaternion {
    return {
      x: this.lerp(a.x, b.x, t),
      y: this.lerp(a.y, b.y, t),
      z: this.lerp(a.z, b.z, t),
      w: this.lerp(a.w, b.w, t),
    }
  }

  /**
   * Get view matrix (for rendering)
   */
  getViewMatrix(): Float32Array {
    // Simplified view matrix calculation
    // In production, use proper matrix math library
    return new Float32Array(16)
  }

  /**
   * Serialize
   */
  serialize(): Record<string, any> {
    return {
      id: this.id,
      virtualCameras: this.virtualCameras.map(c => c.serialize()),
      defaultBlendTime: this.defaultBlendTime,
      defaultBlendStyle: this.defaultBlendStyle,
    }
  }
}

// ==================== CAMERA DOLLY ====================

/**
 * Dolly Point
 */
export interface DollyPoint {
  position: Vector3
  rotation?: Quaternion
  roll?: number
}

/**
 * Dolly Track - Path untuk kamera
 */
export class DollyTrack {
  public id: string
  public name: string
  public points: DollyPoint[] = []
  public isLooped: boolean = false

  constructor(name: string = 'Dolly Track') {
    this.id = nanoid()
    this.name = name
  }

  /**
   * Add point
   */
  addPoint(point: DollyPoint): void {
    this.points.push(point)
  }

  /**
   * Remove point
   */
  removePoint(index: number): boolean {
    if (index >= 0 && index < this.points.length) {
      this.points.splice(index, 1)
      return true
    }
    return false
  }

  /**
   * Get position on track (0-1)
   */
  getPositionOnTrack(t: number): Vector3 {
    if (this.points.length === 0) return { x: 0, y: 0, z: 0 }
    if (this.points.length === 1) return { ...this.points[0].position }

    // Handle looping
    if (this.isLooped) {
      t = t % 1
      if (t < 0) t += 1
    } else {
      t = Math.max(0, Math.min(1, t))
    }

    // Find segment
    const totalPoints = this.isLooped ? this.points.length : this.points.length - 1
    const segmentLength = 1 / totalPoints
    const segment = Math.floor(t / segmentLength)
    const localT = (t - segment * segmentLength) / segmentLength

    const p0 = this.points[segment % this.points.length]
    const p1 = this.points[(segment + 1) % this.points.length]

    // Catmull-Rom interpolation (simplified to linear for now)
    return {
      x: p0.position.x + (p1.position.x - p0.position.x) * localT,
      y: p0.position.y + (p1.position.y - p0.position.y) * localT,
      z: p0.position.z + (p1.position.z - p0.position.z) * localT,
    }
  }

  /**
   * Get total length of track
   */
  getTotalLength(): number {
    let length = 0
    for (let i = 0; i < this.points.length - 1; i++) {
      const p0 = this.points[i].position
      const p1 = this.points[i + 1].position
      const dx = p1.x - p0.x
      const dy = p1.y - p0.y
      const dz = p1.z - p0.z
      length += Math.sqrt(dx * dx + dy * dy + dz * dz)
    }
    if (this.isLooped && this.points.length > 1) {
      const p0 = this.points[this.points.length - 1].position
      const p1 = this.points[0].position
      const dx = p1.x - p0.x
      const dy = p1.y - p0.y
      const dz = p1.z - p0.z
      length += Math.sqrt(dx * dx + dy * dy + dz * dz)
    }
    return length
  }
}
