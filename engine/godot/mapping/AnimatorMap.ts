/**
 * Animator and Sequencer Mapping to Godot AnimationTree / AnimationPlayer
 */

export interface AnimatorState {
  name: string
  animationClip?: string
  speed?: number
  loop?: boolean
}

export interface AnimatorTransition {
  fromState: string
  toState: string
  hasExitTime?: boolean
  exitTime?: number
  conditions?: Array<{
    parameter: string
    operator: 'greater' | 'less' | 'equal' | 'notEqual'
    threshold: number | string | boolean
  }>
}

export interface AnimatorParameter {
  name: string
  type: 'float' | 'int' | 'bool' | 'trigger'
  defaultValue: any
}

export interface SequencerTrack {
  name: string
  type: 'transform' | 'animation' | 'audio' | 'event'
  targetEntityId?: string
  keyframes: Array<{ time: number; value: any }>
}

export class AnimatorMap {
  /**
   * Generates Godot sub_resources for AnimationTree and AnimationNodeStateMachine
   */
  static toGodotAnimationTree(
    treeId: string,
    states: AnimatorState[],
    transitions: AnimatorTransition[],
    parameters: AnimatorParameter[]
  ): {
    subResources: Array<{ type: string; id: string; properties: Record<string, any> }>
    treeNodeProperties: Record<string, any>
  } {
    const subResources: Array<{ type: string; id: string; properties: Record<string, any> }> = []

    // 1. State machine nodes
    const smId = `AnimationNodeStateMachine_${treeId}`
    const smProperties: Record<string, any> = {
      states: states.map((s) => s.name),
      transitions: transitions.map((t) => ({
        from: t.fromState,
        to: t.toState,
        conditions: t.conditions ?? [],
      })),
    }

    subResources.push({
      type: 'AnimationNodeStateMachine',
      id: smId,
      properties: smProperties,
    })

    const treeNodeProperties: Record<string, any> = {
      tree_root: { toString: () => `SubResource("${smId}")` },
      anim_player: { toString: () => `NodePath("../AnimationPlayer")` },
      active: true,
    }

    return { subResources, treeNodeProperties }
  }

  /**
   * Converts cutscene sequencer tracks to Godot AnimationPlayer track data
   */
  static toGodotAnimationPlayer(
    animName: string,
    tracks: SequencerTrack[],
    duration: number = 5.0
  ): {
    subResources: Array<{ type: string; id: string; properties: Record<string, any> }>
    playerProperties: Record<string, any>
  } {
    const animId = `Animation_${animName}`
    const animProperties: Record<string, any> = {
      length: duration,
      loop_mode: 0,
      tracks: tracks.map((track, idx) => ({
        index: idx,
        type: track.type === 'event' ? 'method' : track.type,
        path: track.name,
        keys: track.keyframes,
      })),
    }

    return {
      subResources: [
        {
          type: 'Animation',
          id: animId,
          properties: animProperties,
        },
      ],
      playerProperties: {
        autoplay: animName,
      },
    }
  }
}
