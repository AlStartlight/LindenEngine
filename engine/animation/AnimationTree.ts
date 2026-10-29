/**
 * AnimationTree Node (GF-09)
 * Animation state machine and blend tree.
 */

import { Node } from '../scene/Node'

export interface AnimationState {
  name: string
  clipName: string
  speed?: number
}

export interface StateTransition {
  from: string
  to: string
  condition?: (params: Record<string, any>) => boolean
  fadeTime?: number
}

export class AnimationTree extends Node {
  public states: Map<string, AnimationState> = new Map()
  public transitions: StateTransition[] = []
  public currentState: string | null = null
  public parameters: Record<string, any> = {}

  constructor(name: string = 'AnimationTree', id?: string) {
    super(name, id)
  }

  addState(state: AnimationState): void {
    this.states.set(state.name, state)
    if (!this.currentState) {
      this.currentState = state.name
    }
  }

  addTransition(transition: StateTransition): void {
    this.transitions.push(transition)
  }

  setParameter(param: string, value: any): void {
    this.parameters[param] = value
    this.checkTransitions()
  }

  getParameter(param: string): any {
    return this.parameters[param]
  }

  checkTransitions(): void {
    if (!this.currentState) return

    for (const tr of this.transitions) {
      if (tr.from === this.currentState && tr.condition) {
        if (tr.condition(this.parameters)) {
          this.currentState = tr.to
          break
        }
      }
    }
  }
}
