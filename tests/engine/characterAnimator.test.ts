import { describe, it, expect, beforeEach } from 'vitest'
import * as THREE from 'three'
import { CharacterAnimator } from '../../engine/animation/CharacterAnimator'
import { AnimationPlayer } from '../../engine/animation/AnimationPlayer'
import { CharacterMovement } from '../../engine/movement/CharacterMovement'

function makeMockPlayer(clipNames: string[]): AnimationPlayer {
  const player = new AnimationPlayer('TestPlayer')
  const root = new THREE.Group()
  const clips = clipNames.map((name) => new THREE.AnimationClip(name, 1.0, []))
  player.attachMixer(root, clips)
  return player
}

describe('CharacterAnimator', () => {
  let animator: CharacterAnimator
  let movement: CharacterMovement
  let player: AnimationPlayer

  beforeEach(() => {
    animator = new CharacterAnimator()
    movement = new CharacterMovement()
    player = makeMockPlayer([
      'Idle',
      'Walk',
      'Run',
      'Jump_Start',
      'Fall',
      'Land',
      'Crouch_Idle',
      'Crouch_Walk',
      'Attack',
    ])
  })

  it('starts at idle when character is stationary and grounded', () => {
    movement._grounded = true
    movement._velocity = { x: 0, y: 0, z: 0 }
    animator.updateLocomotion(movement, player, 0.016)

    expect(animator.currentState).toBe('idle')
    expect(player.currentAnimation).toBe('Idle')
    expect(player.playbackSpeed).toBe(1.0)
  })

  it('transitions to walk when moving above walkThreshold', () => {
    movement._grounded = true
    movement._velocity = { x: 2.0, y: 0, z: 0 }
    animator.updateLocomotion(movement, player, 0.016)

    expect(animator.currentState).toBe('walk')
    expect(player.currentAnimation).toBe('Walk')
    // Playback speed scaled to velocity (2.0 / 3.5 ≈ 0.57)
    expect(player.playbackSpeed).toBeCloseTo(2.0 / 3.5, 1)
  })

  it('transitions to run when speed exceeds runThreshold or sprinting', () => {
    movement._grounded = true
    movement._velocity = { x: 6.0, y: 0, z: 0 }
    animator.updateLocomotion(movement, player, 0.016)

    expect(animator.currentState).toBe('run')
    expect(player.currentAnimation).toBe('Run')

    // Or when sprinting at lower speed
    movement._velocity = { x: 3.0, y: 0, z: 0 }
    movement._sprinting = true
    animator.updateLocomotion(movement, player, 0.016)

    expect(animator.currentState).toBe('run')
    expect(player.currentAnimation).toBe('Run')
  })

  it('transitions to jump when airborne moving upwards, and fall when falling', () => {
    movement._grounded = false
    movement._velocity = { x: 0, y: 3.0, z: 0 }
    animator.updateLocomotion(movement, player, 0.016)

    expect(animator.currentState).toBe('jump')
    expect(player.currentAnimation).toBe('Jump_Start')

    // Falling downward
    movement._velocity = { x: 0, y: -2.0, z: 0 }
    animator.updateLocomotion(movement, player, 0.016)

    expect(animator.currentState).toBe('fall')
    expect(player.currentAnimation).toBe('Fall')
  })

  it('transitions to land when transitioning from airborne to grounded', () => {
    // Airborne
    movement._grounded = false
    movement._velocity = { x: 0, y: -4.0, z: 0 }
    animator.updateLocomotion(movement, player, 0.016)
    expect(animator.currentState).toBe('fall')

    // Touches ground
    movement._grounded = true
    movement._velocity = { x: 0, y: 0, z: 0 }
    animator.updateLocomotion(movement, player, 0.016)

    expect(animator.currentState).toBe('land')
    expect(player.currentAnimation).toBe('Land')

    // After landing timer expires, returns to idle
    animator.updateLocomotion(movement, player, 0.25)
    expect(animator.currentState).toBe('idle')
    expect(player.currentAnimation).toBe('Idle')
  })

  it('handles crouch idle and crouch walk', () => {
    movement._grounded = true
    movement._crouching = true
    movement._velocity = { x: 0, y: 0, z: 0 }
    animator.updateLocomotion(movement, player, 0.016)

    expect(animator.currentState).toBe('crouch_idle')
    expect(player.currentAnimation).toBe('Crouch_Idle')

    // Moving while crouching
    movement._velocity = { x: 1.5, y: 0, z: 0 }
    animator.updateLocomotion(movement, player, 0.016)

    expect(animator.currentState).toBe('crouch_walk')
    expect(player.currentAnimation).toBe('Crouch_Walk')
  })

  it('triggers attack action and locks locomotion until finished', () => {
    movement._grounded = true
    movement._velocity = { x: 2.0, y: 0, z: 0 }
    movement._attacking = true

    animator.updateLocomotion(movement, player, 0.016)

    expect(animator.currentState).toBe('attack')
    expect(player.currentAnimation).toBe('Attack')

    // Locomotion is locked during attack
    animator.updateLocomotion(movement, player, 0.1)
    expect(animator.currentState).toBe('attack')

    // After attack duration completes, returns to movement
    animator.updateLocomotion(movement, player, 0.6)
    expect(animator.currentState).toBe('walk')
    expect(player.currentAnimation).toBe('Walk')
  })

  it('clones cleanly with all properties preserved', () => {
    animator.walkThreshold = 0.25
    animator.runThreshold = 8.0
    const copy = animator.clone()

    expect(copy.walkThreshold).toBe(0.25)
    expect(copy.runThreshold).toBe(8.0)
    expect(copy.clipIdle).toBe(animator.clipIdle)
    expect(copy.clipWalk).toBe(animator.clipWalk)
  })
})
