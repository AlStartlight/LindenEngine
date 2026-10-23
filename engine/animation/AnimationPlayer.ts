/**
 * AnimationPlayer Node (GF-08)
 * Property track animation system with keyframe interpolation and playback controls.
 */

import { Node, Node2D, Node3D } from '../scene/Node'

export interface Keyframe<T = any> {
  time: number // in seconds
  value: T
  interpolation?: 'linear' | 'discrete'
}

export interface AnimationTrack {
  property: string // e.g. "position.x", "position", "modulate"
  keyframes: Keyframe[]
}

export interface AnimationClip {
  name: string
  length: number // seconds
  loop: boolean
  tracks: AnimationTrack[]
}

export class AnimationPlayer extends Node {
  private clips: Map<string, AnimationClip> = new Map()
  public currentAnimation: string | null = null
  public currentTime: number = 0
  public playbackSpeed: number = 1.0
  public isPlaying: boolean = false
  public targetNode: Node | null = null

  constructor(name: string = 'AnimationPlayer', id?: string) {
    super(name, id)
  }

  addClip(clip: AnimationClip): void {
    this.clips.set(clip.name, clip)
  }

  getClip(name: string): AnimationClip | undefined {
    return this.clips.get(name)
  }

  play(name: string): void {
    if (!this.clips.has(name)) {
      console.warn(`[AnimationPlayer] Clip "${name}" not found`)
      return
    }
    this.currentAnimation = name
    this.currentTime = 0
    this.isPlaying = true
  }

  pause(): void {
    this.isPlaying = false
  }

  stop(): void {
    this.isPlaying = false
    this.currentTime = 0
  }

  seek(time: number): void {
    this.currentTime = time
    this.applyCurrentFrame()
  }

  advance(delta: number): void {
    if (!this.isPlaying || !this.currentAnimation) return

    const clip = this.clips.get(this.currentAnimation)
    if (!clip) return

    this.currentTime += delta * this.playbackSpeed

    if (this.currentTime >= clip.length) {
      if (clip.loop) {
        this.currentTime = this.currentTime % clip.length
      } else {
        this.currentTime = clip.length
        this.isPlaying = false
      }
    }

    this.applyCurrentFrame()
  }

  _process(delta: number): void {
    this.advance(delta)
  }

  private applyCurrentFrame(): void {
    if (!this.currentAnimation) return
    const clip = this.clips.get(this.currentAnimation)
    if (!clip) return

    const target = this.targetNode || this.getParent()
    if (!target) return

    for (const track of clip.tracks) {
      const val = this.sampleTrack(track, this.currentTime)
      this.setProperty(target, track.property, val)
    }
  }

  sampleTrack(track: AnimationTrack, time: number): any {
    const kfs = track.keyframes
    if (kfs.length === 0) return undefined
    if (kfs.length === 1 || time <= kfs[0].time) return kfs[0].value
    if (time >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].value

    // Find bounding keyframes
    let prev = kfs[0]
    let next = kfs[1]
    for (let i = 0; i < kfs.length - 1; i++) {
      if (time >= kfs[i].time && time <= kfs[i + 1].time) {
        prev = kfs[i]
        next = kfs[i + 1]
        break
      }
    }

    if (prev.interpolation === 'discrete') {
      return prev.value
    }

    const t = (time - prev.time) / (next.time - prev.time)
    return this.interpolateValues(prev.value, next.value, t)
  }

  private interpolateValues(a: any, b: any, t: number): any {
    if (typeof a === 'number' && typeof b === 'number') {
      return a + (b - a) * t
    }
    if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
      const res: Record<string, any> = {}
      for (const k of Object.keys(a)) {
        if (typeof a[k] === 'number' && typeof b[k] === 'number') {
          res[k] = a[k] + (b[k] - a[k]) * t
        } else {
          res[k] = a[k]
        }
      }
      return res
    }
    // Color interpolation e.g. #000000 -> #ffffff
    if (typeof a === 'string' && typeof b === 'string' && a.startsWith('#') && b.startsWith('#')) {
      const c1 = parseInt(a.slice(1), 16)
      const c2 = parseInt(b.slice(1), 16)
      const r1 = (c1 >> 16) & 255, g1 = (c1 >> 8) & 255, b1 = c1 & 255
      const r2 = (c2 >> 16) & 255, g2 = (c2 >> 8) & 255, b2 = c2 & 255
      const r = Math.round(r1 + (r2 - r1) * t)
      const g = Math.round(g1 + (g2 - g1) * t)
      const bl = Math.round(b1 + (b2 - b1) * t)
      return `#${((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1)}`
    }
    return a
  }

  private setProperty(target: any, path: string, val: any): void {
    const parts = path.split('.')
    let curr = target
    for (let i = 0; i < parts.length - 1; i++) {
      if (!curr[parts[i]]) curr[parts[i]] = {}
      curr = curr[parts[i]]
    }
    curr[parts[parts.length - 1]] = val
  }
}
