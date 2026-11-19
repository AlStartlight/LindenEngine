import { Component } from '../ecs/Component'
import type { CharacterMovement } from '../movement/CharacterMovement'
import type { AnimationPlayer } from './AnimationPlayer'

export type LocomotionState =
  | 'idle'
  | 'walk'
  | 'run'
  | 'jump'
  | 'fall'
  | 'land'
  | 'crouch_idle'
  | 'crouch_walk'
  | 'attack'

export class CharacterAnimator extends Component {
  public clipIdle = 'Idle'
  public clipWalk = 'Walk'
  public clipRun = 'Run'
  public clipJump = 'Jump_Start'
  public clipFall = 'Fall'
  public clipLand = 'Land'
  public clipCrouchIdle = 'Crouch_Idle'
  public clipCrouchWalk = 'Crouch_Walk'
  public clipAttack = 'Attack'

  public fadeDuration = 0.2
  public walkThreshold = 0.15
  public runThreshold = 5.0
  public syncPlaybackSpeed = true
  public baseWalkSpeed = 3.5
  public baseRunSpeed = 7.0

  // Runtime states
  _currentState: LocomotionState = 'idle'
  _wasGrounded = true
  _landingTimer = 0
  _actionTimer = 0
  _actionPlaying = false

  constructor() {
    super('CharacterAnimator')
  }

  get currentState(): LocomotionState {
    return this._currentState
  }

  /** Trigger a one-shot action (e.g. Attack) that overrides locomotion until done */
  playAction(name: string, player: AnimationPlayer, duration = 0.6): void {
    if (!player.getClipNames().includes(name)) return
    this._actionPlaying = true
    this._actionTimer = duration
    this._currentState = 'attack'
    player.play(name, { loop: false, fade: this.fadeDuration * 0.5 })
  }

  /**
   * Advance locomotion state based on CharacterMovement telemetry.
   * Cross-fades AnimationPlayer clips smoothly and scales playback speed.
   */
  updateLocomotion(movement: CharacterMovement, player: AnimationPlayer, dt: number): void {
    if (this._actionPlaying) {
      this._actionTimer -= dt
      if (this._actionTimer <= 0) {
        this._actionPlaying = false
      } else {
        return
      }
    }

    const availableClips = player.getClipNames()
    if (availableClips.length === 0) return

    if (movement._attacking) {
      movement._attacking = false
      if (availableClips.includes(this.clipAttack)) {
        this.playAction(this.clipAttack, player)
        return
      }
    }

    const grounded = movement.isGrounded
    const speed = movement.speed
    const vy = movement.velocity.y
    const crouching = movement.isCrouching
    const sprinting = movement.isSprinting

    // Detect landing event
    if (!this._wasGrounded && grounded) {
      if (availableClips.includes(this.clipLand)) {
        this._landingTimer = 0.2
      }
    }
    this._wasGrounded = grounded

    let targetState: LocomotionState = 'idle'
    let targetClip = this.clipIdle
    let loop = true

    if (this._landingTimer > 0) {
      this._landingTimer -= dt
      if (this._landingTimer > 0) {
        targetState = 'land'
        targetClip = this.clipLand
        loop = false
      }
    }
    if (targetState !== 'land') {
      if (!grounded) {
        if (vy > 0.5 && availableClips.includes(this.clipJump)) {
          targetState = 'jump'
          targetClip = this.clipJump
          loop = false
        } else {
          targetState = 'fall'
          targetClip = availableClips.includes(this.clipFall) ? this.clipFall : this.clipJump
          loop = true
        }
      } else if (crouching) {
        if (speed > this.walkThreshold && availableClips.includes(this.clipCrouchWalk)) {
          targetState = 'crouch_walk'
          targetClip = this.clipCrouchWalk
        } else {
          targetState = 'crouch_idle'
          targetClip = availableClips.includes(this.clipCrouchIdle) ? this.clipCrouchIdle : this.clipIdle
        }
      } else {
        if (speed < this.walkThreshold) {
          targetState = 'idle'
          targetClip = this.clipIdle
        } else if (sprinting || speed >= this.runThreshold) {
          targetState = 'run'
          targetClip = availableClips.includes(this.clipRun) ? this.clipRun : this.clipWalk
        } else {
          targetState = 'walk'
          targetClip = this.clipWalk
        }
      }
    }

    // Fallback if targetClip doesn't exist
    if (!availableClips.includes(targetClip)) {
      targetClip = availableClips[0]
    }

    // State transition
    if (this._currentState !== targetState || player.currentAnimation !== targetClip) {
      this._currentState = targetState
      player.play(targetClip, { loop, fade: this.fadeDuration })
    }

    // Anti-foot-sliding dynamic speed sync
    if (this.syncPlaybackSpeed) {
      if (targetState === 'walk') {
        const factor = speed / Math.max(0.1, this.baseWalkSpeed)
        player.playbackSpeed = Math.min(2.5, Math.max(0.5, factor))
      } else if (targetState === 'run') {
        const factor = speed / Math.max(0.1, this.baseRunSpeed)
        player.playbackSpeed = Math.min(2.5, Math.max(0.7, factor))
      } else if (targetState === 'crouch_walk') {
        const factor = speed / Math.max(0.1, this.baseWalkSpeed * 0.5)
        player.playbackSpeed = Math.min(2.0, Math.max(0.5, factor))
      } else {
        player.playbackSpeed = 1.0
      }
    } else {
      player.playbackSpeed = 1.0
    }
  }

  clone(): CharacterAnimator {
    const c = new CharacterAnimator()
    c.clipIdle = this.clipIdle
    c.clipWalk = this.clipWalk
    c.clipRun = this.clipRun
    c.clipJump = this.clipJump
    c.clipFall = this.clipFall
    c.clipLand = this.clipLand
    c.clipCrouchIdle = this.clipCrouchIdle
    c.clipCrouchWalk = this.clipCrouchWalk
    c.clipAttack = this.clipAttack
    c.fadeDuration = this.fadeDuration
    c.walkThreshold = this.walkThreshold
    c.runThreshold = this.runThreshold
    c.syncPlaybackSpeed = this.syncPlaybackSpeed
    c.baseWalkSpeed = this.baseWalkSpeed
    c.baseRunSpeed = this.baseRunSpeed
    c.isEnabled = this.isEnabled
    return c
  }
}
