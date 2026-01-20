/**
 * Cinematic System - Sequencer + Virtual Camera (UE5 Sequencer + Unity Cinemachine)
 * 
 * Sistem cinematic yang menggabungkan kekuatan Sequencer dari UE5
 * dengan kemudahan Cinemachine dari Unity.
 */

import { nanoid } from '../utils/index'

// ==================== DATA TYPES ====================

/**
 * Keyframe Interpolation
 */
export enum KeyframeInterpolation {
  CONSTANT = 'constant',
  LINEAR = 'linear',
  CUBIC = 'cubic',
  EASE_IN = 'easeIn',
  EASE_OUT = 'easeOut',
  EASE_IN_OUT = 'easeInOut',
}

/**
 * Track Type
 */
export enum TrackType {
  TRANSFORM = 'transform',
  ANIMATION = 'animation',
  AUDIO = 'audio',
  EVENT = 'event',
  CAMERA = 'camera',
  VISIBILITY = 'visibility',
  PROPERTY = 'property',
  MATERIAL = 'material',
  PARTICLE = 'particle',
}

// ==================== KEYFRAME SYSTEM ====================

/**
 * Keyframe - Titik waktu dengan nilai
 */
export interface Keyframe<T = any> {
  id: string
  time: number // dalam detik
  value: T
  interpolation: KeyframeInterpolation
  tangentIn?: number
  tangentOut?: number
}

/**
 * Create keyframe helper
 */
export function createKeyframe<T>(
  time: number,
  value: T,
  interpolation: KeyframeInterpolation = KeyframeInterpolation.LINEAR
): Keyframe<T> {
  return {
    id: nanoid(),
    time,
    value,
    interpolation,
  }
}

// ==================== TRACK SYSTEM ====================

/**
 * Base Track - Track dasar untuk semua jenis track
 */
export abstract class SequencerTrack {
  public id: string
  public name: string
  public type: TrackType
  public keyframes: Keyframe[] = []
  public isEnabled: boolean = true
  public isMuted: boolean = false
  public isLocked: boolean = false
  public color: string = '#4a5568'

  constructor(name: string, type: TrackType) {
    this.id = nanoid()
    this.name = name
    this.type = type
  }

  /**
   * Add keyframe
   */
  addKeyframe<T>(time: number, value: T, interpolation?: KeyframeInterpolation): Keyframe<T> {
    const keyframe = createKeyframe(time, value, interpolation)
    this.keyframes.push(keyframe)
    this.sortKeyframes()
    return keyframe
  }

  /**
   * Remove keyframe
   */
  removeKeyframe(keyframeId: string): boolean {
    const index = this.keyframes.findIndex(k => k.id === keyframeId)
    if (index !== -1) {
      this.keyframes.splice(index, 1)
      return true
    }
    return false
  }

  /**
   * Sort keyframes by time
   */
  private sortKeyframes(): void {
    this.keyframes.sort((a, b) => a.time - b.time)
  }

  /**
   * Get value at time (interpolated)
   */
  abstract getValueAtTime(time: number): any

  /**
   * Interpolate between two values
   */
  protected interpolate(
    a: number,
    b: number,
    t: number,
    interpolation: KeyframeInterpolation
  ): number {
    switch (interpolation) {
      case KeyframeInterpolation.CONSTANT:
        return a
      case KeyframeInterpolation.LINEAR:
        return a + (b - a) * t
      case KeyframeInterpolation.EASE_IN:
        return a + (b - a) * (t * t)
      case KeyframeInterpolation.EASE_OUT:
        return a + (b - a) * (1 - (1 - t) * (1 - t))
      case KeyframeInterpolation.EASE_IN_OUT:
        return a + (b - a) * (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
      case KeyframeInterpolation.CUBIC:
        return a + (b - a) * (t * t * (3 - 2 * t))
      default:
        return a + (b - a) * t
    }
  }

  /**
   * Find surrounding keyframes
   */
  protected findSurroundingKeyframes(time: number): { prev: Keyframe | null; next: Keyframe | null } {
    let prev: Keyframe | null = null
    let next: Keyframe | null = null

    for (const keyframe of this.keyframes) {
      if (keyframe.time <= time) {
        prev = keyframe
      } else {
        next = keyframe
        break
      }
    }

    return { prev, next }
  }

  /**
   * Serialize track
   */
  serialize(): Record<string, any> {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      keyframes: this.keyframes,
      isEnabled: this.isEnabled,
      isMuted: this.isMuted,
      isLocked: this.isLocked,
      color: this.color,
    }
  }
}

// ==================== SPECIFIC TRACKS ====================

/**
 * Transform Track - Animasi posisi, rotasi, scale
 */
export class TransformTrack extends SequencerTrack {
  public targetId: string = ''
  public property: 'position' | 'rotation' | 'scale' = 'position'
  public axis: 'x' | 'y' | 'z' | 'all' = 'all'

  constructor(name: string = 'Transform') {
    super(name, TrackType.TRANSFORM)
    this.color = '#4299e1'
  }

  getValueAtTime(time: number): { x: number; y: number; z: number } {
    const { prev, next } = this.findSurroundingKeyframes(time)

    if (!prev) {
      return next?.value || { x: 0, y: 0, z: 0 }
    }
    if (!next || prev === next) {
      return prev.value
    }

    const t = (time - prev.time) / (next.time - prev.time)
    
    return {
      x: this.interpolate(prev.value.x, next.value.x, t, prev.interpolation),
      y: this.interpolate(prev.value.y, next.value.y, t, prev.interpolation),
      z: this.interpolate(prev.value.z, next.value.z, t, prev.interpolation),
    }
  }
}

/**
 * Animation Track - Trigger animasi
 */
export class AnimationTrack extends SequencerTrack {
  public targetId: string = ''

  constructor(name: string = 'Animation') {
    super(name, TrackType.ANIMATION)
    this.color = '#48bb78'
  }

  getValueAtTime(time: number): { clipName: string; weight: number } | null {
    const { prev } = this.findSurroundingKeyframes(time)
    return prev?.value || null
  }
}

/**
 * Audio Track - Play audio
 */
export class AudioTrack extends SequencerTrack {
  public audioClipPath: string = ''
  public volume: number = 1.0
  public loop: boolean = false

  constructor(name: string = 'Audio') {
    super(name, TrackType.AUDIO)
    this.color = '#ed8936'
  }

  getValueAtTime(time: number): { playing: boolean; volume: number } {
    const { prev } = this.findSurroundingKeyframes(time)
    if (!prev) return { playing: false, volume: 0 }
    
    return {
      playing: time >= prev.time,
      volume: prev.value?.volume || this.volume,
    }
  }
}

/**
 * Event Track - Trigger events
 */
export class EventTrack extends SequencerTrack {
  constructor(name: string = 'Events') {
    super(name, TrackType.EVENT)
    this.color = '#e53e3e'
  }

  getValueAtTime(time: number): { eventName: string; params: any } | null {
    // Events hanya trigger sekali di waktu tertentu
    for (const keyframe of this.keyframes) {
      if (Math.abs(keyframe.time - time) < 0.016) { // ~1 frame
        return keyframe.value
      }
    }
    return null
  }

  /**
   * Get events between two times
   */
  getEventsBetween(startTime: number, endTime: number): Keyframe[] {
    return this.keyframes.filter(k => k.time > startTime && k.time <= endTime)
  }
}

/**
 * Camera Track - Camera cuts and blends
 */
export class CameraTrack extends SequencerTrack {
  constructor(name: string = 'Camera') {
    super(name, TrackType.CAMERA)
    this.color = '#9f7aea'
  }

  getValueAtTime(time: number): { cameraId: string; blendTime: number } | null {
    const { prev, next } = this.findSurroundingKeyframes(time)
    
    if (!prev) return null
    
    return {
      cameraId: prev.value.cameraId,
      blendTime: prev.value.blendTime || 0,
    }
  }
}

/**
 * Property Track - Animate any property
 */
export class PropertyTrack extends SequencerTrack {
  public targetId: string = ''
  public propertyPath: string = '' // e.g., "material.opacity"

  constructor(name: string = 'Property') {
    super(name, TrackType.PROPERTY)
    this.color = '#38b2ac'
  }

  getValueAtTime(time: number): number {
    const { prev, next } = this.findSurroundingKeyframes(time)

    if (!prev) return next?.value || 0
    if (!next || prev === next) return prev.value

    const t = (time - prev.time) / (next.time - prev.time)
    return this.interpolate(prev.value, next.value, t, prev.interpolation)
  }
}

// ==================== BINDING SYSTEM ====================

/**
 * Binding - Hubungan antara track dan target object
 */
export interface SequencerBinding {
  id: string
  trackId: string
  targetId: string
  targetType: 'entity' | 'camera' | 'audio' | 'light'
  propertyPath?: string
}

// ==================== SEQUENCE ====================

/**
 * Sequence - Container untuk tracks
 */
export class Sequence {
  public id: string
  public name: string
  public duration: number = 10 // dalam detik
  public frameRate: number = 30
  public tracks: SequencerTrack[] = []
  public bindings: SequencerBinding[] = []
  
  // Playback state
  public isLooping: boolean = false
  public playbackSpeed: number = 1.0

  constructor(name: string = 'New Sequence') {
    this.id = nanoid()
    this.name = name
  }

  /**
   * Add track
   */
  addTrack(track: SequencerTrack): void {
    this.tracks.push(track)
  }

  /**
   * Remove track
   */
  removeTrack(trackId: string): boolean {
    const index = this.tracks.findIndex(t => t.id === trackId)
    if (index !== -1) {
      this.tracks.splice(index, 1)
      // Remove bindings
      this.bindings = this.bindings.filter(b => b.trackId !== trackId)
      return true
    }
    return false
  }

  /**
   * Get track by ID
   */
  getTrack(trackId: string): SequencerTrack | undefined {
    return this.tracks.find(t => t.id === trackId)
  }

  /**
   * Create binding
   */
  createBinding(
    trackId: string,
    targetId: string,
    targetType: SequencerBinding['targetType'],
    propertyPath?: string
  ): SequencerBinding {
    const binding: SequencerBinding = {
      id: nanoid(),
      trackId,
      targetId,
      targetType,
      propertyPath,
    }
    this.bindings.push(binding)
    return binding
  }

  /**
   * Serialize sequence
   */
  serialize(): Record<string, any> {
    return {
      id: this.id,
      name: this.name,
      duration: this.duration,
      frameRate: this.frameRate,
      tracks: this.tracks.map(t => t.serialize()),
      bindings: this.bindings,
      isLooping: this.isLooping,
      playbackSpeed: this.playbackSpeed,
    }
  }
}

// ==================== SEQUENCER PLAYER ====================

export enum PlaybackState {
  STOPPED = 'stopped',
  PLAYING = 'playing',
  PAUSED = 'paused',
  SCRUBBING = 'scrubbing',
}

/**
 * Sequencer Player - Playback controller
 */
export class SequencerPlayer {
  public sequence: Sequence | null = null
  public currentTime: number = 0
  public state: PlaybackState = PlaybackState.STOPPED
  
  // Callbacks
  public onTimeUpdate: ((time: number) => void) | null = null
  public onStateChange: ((state: PlaybackState) => void) | null = null
  public onComplete: (() => void) | null = null
  public onEvent: ((eventName: string, params: any) => void) | null = null

  private lastUpdateTime: number = 0
  private eventsFired: Set<string> = new Set()

  /**
   * Load sequence
   */
  loadSequence(sequence: Sequence): void {
    this.sequence = sequence
    this.currentTime = 0
    this.state = PlaybackState.STOPPED
    this.eventsFired.clear()
  }

  /**
   * Play
   */
  play(): void {
    if (!this.sequence) return
    
    if (this.currentTime >= this.sequence.duration) {
      this.currentTime = 0
    }
    
    this.state = PlaybackState.PLAYING
    this.lastUpdateTime = performance.now()
    this.onStateChange?.(this.state)
  }

  /**
   * Pause
   */
  pause(): void {
    this.state = PlaybackState.PAUSED
    this.onStateChange?.(this.state)
  }

  /**
   * Stop
   */
  stop(): void {
    this.currentTime = 0
    this.state = PlaybackState.STOPPED
    this.eventsFired.clear()
    this.onStateChange?.(this.state)
    this.onTimeUpdate?.(0)
  }

  /**
   * Seek to time
   */
  seek(time: number): void {
    if (!this.sequence) return
    
    this.currentTime = Math.max(0, Math.min(time, this.sequence.duration))
    this.eventsFired.clear()
    this.onTimeUpdate?.(this.currentTime)
  }

  /**
   * Update (call every frame)
   */
  update(): void {
    if (!this.sequence || this.state !== PlaybackState.PLAYING) return

    const now = performance.now()
    const deltaTime = (now - this.lastUpdateTime) / 1000 * this.sequence.playbackSpeed
    this.lastUpdateTime = now

    const previousTime = this.currentTime
    this.currentTime += deltaTime

    // Fire events
    for (const track of this.sequence.tracks) {
      if (track instanceof EventTrack && track.isEnabled && !track.isMuted) {
        const events = track.getEventsBetween(previousTime, this.currentTime)
        for (const event of events) {
          if (!this.eventsFired.has(event.id)) {
            this.eventsFired.add(event.id)
            this.onEvent?.(event.value.eventName, event.value.params)
          }
        }
      }
    }

    // Check if completed
    if (this.currentTime >= this.sequence.duration) {
      if (this.sequence.isLooping) {
        this.currentTime = 0
        this.eventsFired.clear()
      } else {
        this.currentTime = this.sequence.duration
        this.state = PlaybackState.STOPPED
        this.onComplete?.()
        this.onStateChange?.(this.state)
      }
    }

    this.onTimeUpdate?.(this.currentTime)
  }

  /**
   * Get all track values at current time
   */
  evaluate(): Map<string, any> {
    const values = new Map<string, any>()
    
    if (!this.sequence) return values

    for (const track of this.sequence.tracks) {
      if (!track.isEnabled || track.isMuted) continue
      
      const value = track.getValueAtTime(this.currentTime)
      if (value !== null) {
        values.set(track.id, value)
      }
    }

    return values
  }

  /**
   * Apply values to bound objects
   */
  applyToBindings(world: any): void {
    if (!this.sequence) return

    const values = this.evaluate()

    for (const binding of this.sequence.bindings) {
      const value = values.get(binding.trackId)
      if (value === undefined) continue

      // Get target object from world
      const target = this.getTarget(world, binding)
      if (!target) continue

      // Apply value based on track type
      const track = this.sequence.getTrack(binding.trackId)
      if (!track) continue

      this.applyValue(target, track, value, binding.propertyPath)
    }
  }

  private getTarget(world: any, binding: SequencerBinding): any {
    // Implement based on your world/entity system
    return world?.getEntity?.(binding.targetId)
  }

  private applyValue(target: any, track: SequencerTrack, value: any, propertyPath?: string): void {
    if (!target) return

    switch (track.type) {
      case TrackType.TRANSFORM:
        if (target.transform) {
          const transformTrack = track as TransformTrack
          if (transformTrack.property === 'position') {
            target.transform.position = value
          } else if (transformTrack.property === 'rotation') {
            target.transform.rotation = value
          } else if (transformTrack.property === 'scale') {
            target.transform.scale = value
          }
        }
        break

      case TrackType.PROPERTY:
        if (propertyPath) {
          this.setNestedProperty(target, propertyPath, value)
        }
        break

      case TrackType.VISIBILITY:
        target.isActive = value
        break
    }
  }

  private setNestedProperty(obj: any, path: string, value: any): void {
    const parts = path.split('.')
    let current = obj
    
    for (let i = 0; i < parts.length - 1; i++) {
      if (current[parts[i]] === undefined) return
      current = current[parts[i]]
    }
    
    current[parts[parts.length - 1]] = value
  }
}
