/**
 * Animation System - State Machine (Unity Animator + UE5 Animation Blueprint)
 * 
 * Sistem animasi dengan state machine, blend spaces, dan animation layers
 * yang menggabungkan kemudahan Unity Animator dengan kekuatan UE5 Anim Blueprint.
 */

import { nanoid } from '../utils/index'

// ==================== TYPES ====================

export interface Vector2 {
  x: number
  y: number
}

// ==================== ANIMATION CLIP ====================

/**
 * Animation Clip - Single animation
 */
export interface AnimationClip {
  id: string
  name: string
  path: string
  duration: number
  frameRate: number
  isLooping: boolean
  // Additive blending
  isAdditive: boolean
  // Root motion
  hasRootMotion: boolean
  rootMotionBoneIndex?: number
}

/**
 * Animation Event - Trigger pada frame tertentu
 */
export interface AnimationEvent {
  id: string
  time: number
  functionName: string
  intParameter?: number
  floatParameter?: number
  stringParameter?: string
  objectParameter?: any
}

// ==================== STATE MACHINE ====================

/**
 * State Machine Parameter
 */
export enum ParameterType {
  FLOAT = 'float',
  INT = 'int',
  BOOL = 'bool',
  TRIGGER = 'trigger',
}

export interface AnimatorParameter {
  id: string
  name: string
  type: ParameterType
  defaultValue: number | boolean
}

/**
 * Transition Condition
 */
export enum ConditionMode {
  IF_TRUE = 'ifTrue',
  IF_FALSE = 'ifFalse',
  GREATER = 'greater',
  LESS = 'less',
  EQUALS = 'equals',
  NOT_EQUALS = 'notEquals',
}

export interface TransitionCondition {
  parameterId: string
  mode: ConditionMode
  threshold?: number
}

/**
 * Animation State Transition
 */
export interface StateTransition {
  id: string
  sourceStateId: string
  destinationStateId: string
  conditions: TransitionCondition[]
  hasExitTime: boolean
  exitTime: number // 0-1 normalized
  hasFixedDuration: boolean
  transitionDuration: number
  transitionOffset: number
  interruptionSource: 'none' | 'current' | 'next' | 'both'
}

/**
 * Animation State Motion Type
 */
export enum MotionType {
  CLIP = 'clip',
  BLEND_TREE = 'blendTree',
}

/**
 * Animation State
 */
export interface AnimationState {
  id: string
  name: string
  motionType: MotionType
  clipId?: string
  blendTreeId?: string
  speed: number
  speedMultiplierParameter?: string
  cycleOffset: number
  cycleOffsetParameter?: string
  mirror: boolean
  mirrorParameter?: string
  writeDefaultValues: boolean
  transitions: StateTransition[]
  behaviours: string[] // Script IDs
  position: { x: number; y: number } // Editor position
}

/**
 * State Machine Layer
 */
export interface AnimatorLayer {
  id: string
  name: string
  weight: number
  blendingMode: 'override' | 'additive'
  states: AnimationState[]
  defaultStateId: string
  avatarMask?: string
  isSyncedToOtherLayer: boolean
  syncedLayerIndex?: number
}

// ==================== BLEND TREES ====================

/**
 * Blend Tree Type
 */
export enum BlendTreeType {
  SIMPLE_1D = 'simple1D',
  SIMPLE_2D = 'simple2D',
  FREEFORM_2D = 'freeform2D',
  FREEFORM_CARTESIAN_2D = 'freeformCartesian2D',
  DIRECT = 'direct',
}

/**
 * Blend Tree Child Motion
 */
export interface BlendTreeChild {
  motion: AnimationClip | BlendTree
  threshold: number // For 1D
  position: Vector2 // For 2D
  directBlendParameter?: string // For Direct
  timeScale: number
  cycleOffset: number
  mirror: boolean
}

/**
 * Blend Tree (Blend Space in UE5)
 */
export interface BlendTree {
  id: string
  name: string
  type: BlendTreeType
  blendParameter: string
  blendParameterY?: string // For 2D
  children: BlendTreeChild[]
  minThreshold: number
  maxThreshold: number
  useAutomaticThresholds: boolean
}

// ==================== ANIMATOR CONTROLLER ====================

/**
 * Animator Controller - Main animation asset
 */
export class AnimatorController {
  public id: string
  public name: string
  public parameters: AnimatorParameter[] = []
  public layers: AnimatorLayer[] = []
  public clips: Map<string, AnimationClip> = new Map()
  public blendTrees: Map<string, BlendTree> = new Map()

  constructor(name: string = 'New Animator Controller') {
    this.id = nanoid()
    this.name = name
    
    // Create default layer
    this.addLayer('Base Layer')
  }

  // ==================== PARAMETERS ====================

  /**
   * Add parameter
   */
  addParameter(name: string, type: ParameterType, defaultValue: number | boolean = 0): AnimatorParameter {
    const param: AnimatorParameter = {
      id: nanoid(),
      name,
      type,
      defaultValue,
    }
    this.parameters.push(param)
    return param
  }

  /**
   * Remove parameter
   */
  removeParameter(parameterId: string): boolean {
    const index = this.parameters.findIndex(p => p.id === parameterId)
    if (index !== -1) {
      this.parameters.splice(index, 1)
      return true
    }
    return false
  }

  /**
   * Get parameter by name
   */
  getParameter(name: string): AnimatorParameter | undefined {
    return this.parameters.find(p => p.name === name)
  }

  // ==================== LAYERS ====================

  /**
   * Add layer
   */
  addLayer(name: string): AnimatorLayer {
    const layer: AnimatorLayer = {
      id: nanoid(),
      name,
      weight: 1,
      blendingMode: 'override',
      states: [],
      defaultStateId: '',
      isSyncedToOtherLayer: false,
    }
    this.layers.push(layer)
    return layer
  }

  /**
   * Remove layer
   */
  removeLayer(layerId: string): boolean {
    if (this.layers.length <= 1) return false // Keep at least one layer
    const index = this.layers.findIndex(l => l.id === layerId)
    if (index !== -1) {
      this.layers.splice(index, 1)
      return true
    }
    return false
  }

  /**
   * Get layer
   */
  getLayer(layerId: string): AnimatorLayer | undefined {
    return this.layers.find(l => l.id === layerId)
  }

  // ==================== STATES ====================

  /**
   * Add state to layer
   */
  addState(layerId: string, name: string, clipId?: string): AnimationState | null {
    const layer = this.getLayer(layerId)
    if (!layer) return null

    const state: AnimationState = {
      id: nanoid(),
      name,
      motionType: MotionType.CLIP,
      clipId,
      speed: 1,
      cycleOffset: 0,
      mirror: false,
      writeDefaultValues: true,
      transitions: [],
      behaviours: [],
      position: { x: 200 + layer.states.length * 200, y: 100 },
    }

    layer.states.push(state)

    // Set as default if first state
    if (layer.states.length === 1) {
      layer.defaultStateId = state.id
    }

    return state
  }

  /**
   * Remove state
   */
  removeState(layerId: string, stateId: string): boolean {
    const layer = this.getLayer(layerId)
    if (!layer) return false

    const index = layer.states.findIndex(s => s.id === stateId)
    if (index === -1) return false

    // Remove transitions to this state
    for (const state of layer.states) {
      state.transitions = state.transitions.filter(t => t.destinationStateId !== stateId)
    }

    layer.states.splice(index, 1)

    // Update default state if needed
    if (layer.defaultStateId === stateId) {
      layer.defaultStateId = layer.states[0]?.id || ''
    }

    return true
  }

  /**
   * Get state
   */
  getState(layerId: string, stateId: string): AnimationState | undefined {
    const layer = this.getLayer(layerId)
    return layer?.states.find(s => s.id === stateId)
  }

  // ==================== TRANSITIONS ====================

  /**
   * Add transition between states
   */
  addTransition(
    layerId: string,
    sourceStateId: string,
    destinationStateId: string
  ): StateTransition | null {
    const layer = this.getLayer(layerId)
    if (!layer) return null

    const sourceState = layer.states.find(s => s.id === sourceStateId)
    if (!sourceState) return null

    const transition: StateTransition = {
      id: nanoid(),
      sourceStateId,
      destinationStateId,
      conditions: [],
      hasExitTime: true,
      exitTime: 0.9,
      hasFixedDuration: true,
      transitionDuration: 0.25,
      transitionOffset: 0,
      interruptionSource: 'none',
    }

    sourceState.transitions.push(transition)
    return transition
  }

  /**
   * Add condition to transition
   */
  addCondition(
    layerId: string,
    stateId: string,
    transitionId: string,
    parameterId: string,
    mode: ConditionMode,
    threshold?: number
  ): TransitionCondition | null {
    const state = this.getState(layerId, stateId)
    if (!state) return null

    const transition = state.transitions.find(t => t.id === transitionId)
    if (!transition) return null

    const condition: TransitionCondition = {
      parameterId,
      mode,
      threshold,
    }

    transition.conditions.push(condition)
    return condition
  }

  // ==================== BLEND TREES ====================

  /**
   * Create blend tree
   */
  createBlendTree(name: string, type: BlendTreeType, parameterName: string): BlendTree {
    const blendTree: BlendTree = {
      id: nanoid(),
      name,
      type,
      blendParameter: parameterName,
      children: [],
      minThreshold: 0,
      maxThreshold: 1,
      useAutomaticThresholds: true,
    }

    this.blendTrees.set(blendTree.id, blendTree)
    return blendTree
  }

  /**
   * Add child motion to blend tree
   */
  addBlendTreeChild(
    blendTreeId: string,
    motion: AnimationClip | BlendTree,
    threshold: number = 0,
    position: Vector2 = { x: 0, y: 0 }
  ): BlendTreeChild | null {
    const blendTree = this.blendTrees.get(blendTreeId)
    if (!blendTree) return null

    const child: BlendTreeChild = {
      motion,
      threshold,
      position,
      timeScale: 1,
      cycleOffset: 0,
      mirror: false,
    }

    blendTree.children.push(child)
    return child
  }

  // ==================== CLIPS ====================

  /**
   * Add animation clip
   */
  addClip(clip: AnimationClip): void {
    this.clips.set(clip.id, clip)
  }

  /**
   * Get clip
   */
  getClip(clipId: string): AnimationClip | undefined {
    return this.clips.get(clipId)
  }

  // ==================== SERIALIZATION ====================

  /**
   * Serialize
   */
  serialize(): Record<string, any> {
    return {
      id: this.id,
      name: this.name,
      parameters: this.parameters,
      layers: this.layers,
      clips: Array.from(this.clips.entries()),
      blendTrees: Array.from(this.blendTrees.entries()),
    }
  }

  /**
   * Deserialize
   */
  static deserialize(data: Record<string, any>): AnimatorController {
    const controller = new AnimatorController(data.name)
    controller.id = data.id
    controller.parameters = data.parameters || []
    controller.layers = data.layers || []
    
    for (const [id, clip] of data.clips || []) {
      controller.clips.set(id, clip)
    }
    
    for (const [id, blendTree] of data.blendTrees || []) {
      controller.blendTrees.set(id, blendTree)
    }
    
    return controller
  }
}

// ==================== ANIMATOR (RUNTIME) ====================

/**
 * Animator State Info - Runtime state information
 */
export interface AnimatorStateInfo {
  stateId: string
  stateName: string
  normalizedTime: number // 0-1, wraps for looping
  length: number
  speed: number
  isLooping: boolean
  isTransitioning: boolean
  transitionProgress: number
}

/**
 * Animator - Runtime component
 */
export class Animator {
  public controller: AnimatorController | null = null
  public parameters: Map<string, number | boolean> = new Map()
  
  // Runtime state per layer
  private layerStates: Map<string, {
    currentStateId: string
    normalizedTime: number
    nextStateId?: string
    transitionTime?: number
    transitionDuration?: number
  }> = new Map()
  
  // Callbacks
  public onStateEnter: ((layerIndex: number, stateInfo: AnimatorStateInfo) => void) | null = null
  public onStateExit: ((layerIndex: number, stateInfo: AnimatorStateInfo) => void) | null = null
  public onAnimationEvent: ((eventName: string, params: any) => void) | null = null

  /**
   * Initialize with controller
   */
  initialize(controller: AnimatorController): void {
    this.controller = controller
    this.parameters.clear()
    this.layerStates.clear()

    // Initialize parameters
    for (const param of controller.parameters) {
      this.parameters.set(param.name, param.defaultValue)
    }

    // Initialize layer states
    for (const layer of controller.layers) {
      this.layerStates.set(layer.id, {
        currentStateId: layer.defaultStateId,
        normalizedTime: 0,
      })
    }
  }

  // ==================== PARAMETER ACCESS ====================

  /**
   * Set float parameter
   */
  setFloat(name: string, value: number): void {
    this.parameters.set(name, value)
  }

  /**
   * Get float parameter
   */
  getFloat(name: string): number {
    return (this.parameters.get(name) as number) || 0
  }

  /**
   * Set int parameter
   */
  setInteger(name: string, value: number): void {
    this.parameters.set(name, Math.floor(value))
  }

  /**
   * Get int parameter
   */
  getInteger(name: string): number {
    return Math.floor((this.parameters.get(name) as number) || 0)
  }

  /**
   * Set bool parameter
   */
  setBool(name: string, value: boolean): void {
    this.parameters.set(name, value)
  }

  /**
   * Get bool parameter
   */
  getBool(name: string): boolean {
    return this.parameters.get(name) as boolean || false
  }

  /**
   * Set trigger
   */
  setTrigger(name: string): void {
    this.parameters.set(name, true)
  }

  /**
   * Reset trigger
   */
  resetTrigger(name: string): void {
    this.parameters.set(name, false)
  }

  // ==================== STATE ACCESS ====================

  /**
   * Get current state info
   */
  getCurrentAnimatorStateInfo(layerIndex: number = 0): AnimatorStateInfo | null {
    if (!this.controller || layerIndex >= this.controller.layers.length) return null

    const layer = this.controller.layers[layerIndex]
    const layerState = this.layerStates.get(layer.id)
    if (!layerState) return null

    const state = layer.states.find(s => s.id === layerState.currentStateId)
    if (!state) return null

    const clip = state.clipId ? this.controller.getClip(state.clipId) : null

    return {
      stateId: state.id,
      stateName: state.name,
      normalizedTime: layerState.normalizedTime,
      length: clip?.duration || 0,
      speed: state.speed,
      isLooping: clip?.isLooping || false,
      isTransitioning: !!layerState.nextStateId,
      transitionProgress: layerState.transitionDuration 
        ? (layerState.transitionTime || 0) / layerState.transitionDuration 
        : 0,
    }
  }

  /**
   * Play state directly
   */
  play(stateName: string, layerIndex: number = 0, normalizedTime: number = 0): void {
    if (!this.controller || layerIndex >= this.controller.layers.length) return

    const layer = this.controller.layers[layerIndex]
    const state = layer.states.find(s => s.name === stateName)
    if (!state) return

    const layerState = this.layerStates.get(layer.id)
    if (layerState) {
      layerState.currentStateId = state.id
      layerState.normalizedTime = normalizedTime
      layerState.nextStateId = undefined
      layerState.transitionTime = undefined
      layerState.transitionDuration = undefined
    }
  }

  /**
   * Crossfade to state
   */
  crossFade(stateName: string, transitionDuration: number, layerIndex: number = 0): void {
    if (!this.controller || layerIndex >= this.controller.layers.length) return

    const layer = this.controller.layers[layerIndex]
    const state = layer.states.find(s => s.name === stateName)
    if (!state) return

    const layerState = this.layerStates.get(layer.id)
    if (layerState) {
      layerState.nextStateId = state.id
      layerState.transitionTime = 0
      layerState.transitionDuration = transitionDuration
    }
  }

  // ==================== UPDATE ====================

  /**
   * Update animator
   */
  update(deltaTime: number): void {
    if (!this.controller) return

    for (let layerIndex = 0; layerIndex < this.controller.layers.length; layerIndex++) {
      this.updateLayer(layerIndex, deltaTime)
    }

    // Reset triggers after update
    for (const param of this.controller.parameters) {
      if (param.type === ParameterType.TRIGGER) {
        this.parameters.set(param.name, false)
      }
    }
  }

  /**
   * Update single layer
   */
  private updateLayer(layerIndex: number, deltaTime: number): void {
    if (!this.controller) return

    const layer = this.controller.layers[layerIndex]
    const layerState = this.layerStates.get(layer.id)
    if (!layerState) return

    const currentState = layer.states.find(s => s.id === layerState.currentStateId)
    if (!currentState) return

    const clip = currentState.clipId ? this.controller.getClip(currentState.clipId) : null
    const duration = clip?.duration || 1

    // Update time
    layerState.normalizedTime += (deltaTime * currentState.speed) / duration

    // Handle looping
    if (clip?.isLooping) {
      layerState.normalizedTime = layerState.normalizedTime % 1
    }

    // Handle transitions in progress
    if (layerState.nextStateId && layerState.transitionDuration) {
      layerState.transitionTime = (layerState.transitionTime || 0) + deltaTime

      if (layerState.transitionTime >= layerState.transitionDuration) {
        // Transition complete
        layerState.currentStateId = layerState.nextStateId
        layerState.normalizedTime = 0
        layerState.nextStateId = undefined
        layerState.transitionTime = undefined
        layerState.transitionDuration = undefined
      }
    } else {
      // Check for transitions
      this.checkTransitions(layer, currentState, layerState)
    }
  }

  /**
   * Check transition conditions
   */
  private checkTransitions(
    layer: AnimatorLayer,
    currentState: AnimationState,
    layerState: any
  ): void {
    for (const transition of currentState.transitions) {
      // Check exit time
      if (transition.hasExitTime && layerState.normalizedTime < transition.exitTime) {
        continue
      }

      // Check conditions
      let allConditionsMet = true
      for (const condition of transition.conditions) {
        if (!this.checkCondition(condition)) {
          allConditionsMet = false
          break
        }
      }

      if (allConditionsMet) {
        // Start transition
        layerState.nextStateId = transition.destinationStateId
        layerState.transitionTime = 0
        layerState.transitionDuration = transition.transitionDuration
        break
      }
    }
  }

  /**
   * Check single condition
   */
  private checkCondition(condition: TransitionCondition): boolean {
    if (!this.controller) return false

    const param = this.controller.parameters.find(p => p.id === condition.parameterId)
    if (!param) return false

    const value = this.parameters.get(param.name)

    switch (condition.mode) {
      case ConditionMode.IF_TRUE:
        return value === true
      case ConditionMode.IF_FALSE:
        return value === false
      case ConditionMode.GREATER:
        return (value as number) > (condition.threshold || 0)
      case ConditionMode.LESS:
        return (value as number) < (condition.threshold || 0)
      case ConditionMode.EQUALS:
        return value === condition.threshold
      case ConditionMode.NOT_EQUALS:
        return value !== condition.threshold
      default:
        return false
    }
  }

  // ==================== BLEND TREE EVALUATION ====================

  /**
   * Evaluate blend tree
   */
  evaluateBlendTree(blendTreeId: string): { clips: { clipId: string; weight: number }[] } {
    if (!this.controller) return { clips: [] }

    const blendTree = this.controller.blendTrees.get(blendTreeId)
    if (!blendTree) return { clips: [] }

    const paramValue = this.getFloat(blendTree.blendParameter)
    const paramValueY = blendTree.blendParameterY 
      ? this.getFloat(blendTree.blendParameterY) 
      : 0

    const clips: { clipId: string; weight: number }[] = []

    switch (blendTree.type) {
      case BlendTreeType.SIMPLE_1D:
        this.evaluateBlendTree1D(blendTree, paramValue, clips)
        break
      case BlendTreeType.SIMPLE_2D:
      case BlendTreeType.FREEFORM_2D:
        this.evaluateBlendTree2D(blendTree, paramValue, paramValueY, clips)
        break
    }

    return { clips }
  }

  /**
   * Evaluate 1D blend tree
   */
  private evaluateBlendTree1D(
    blendTree: BlendTree,
    paramValue: number,
    clips: { clipId: string; weight: number }[]
  ): void {
    // Sort children by threshold
    const sortedChildren = [...blendTree.children].sort((a, b) => a.threshold - b.threshold)

    for (let i = 0; i < sortedChildren.length; i++) {
      const child = sortedChildren[i]
      const prevChild = sortedChildren[i - 1]
      const nextChild = sortedChildren[i + 1]

      let weight = 0

      if (!prevChild && paramValue <= child.threshold) {
        weight = 1
      } else if (!nextChild && paramValue >= child.threshold) {
        weight = 1
      } else if (prevChild && nextChild) {
        if (paramValue >= prevChild.threshold && paramValue <= child.threshold) {
          weight = (paramValue - prevChild.threshold) / (child.threshold - prevChild.threshold)
        } else if (paramValue >= child.threshold && paramValue <= nextChild.threshold) {
          weight = 1 - (paramValue - child.threshold) / (nextChild.threshold - child.threshold)
        }
      }

      if (weight > 0 && 'id' in child.motion) {
        clips.push({ clipId: child.motion.id, weight })
      }
    }
  }

  /**
   * Evaluate 2D blend tree (simplified)
   */
  private evaluateBlendTree2D(
    blendTree: BlendTree,
    paramX: number,
    paramY: number,
    clips: { clipId: string; weight: number }[]
  ): void {
    // Calculate weights based on distance
    let totalWeight = 0
    const weights: number[] = []

    for (const child of blendTree.children) {
      const dx = paramX - child.position.x
      const dy = paramY - child.position.y
      const distance = Math.sqrt(dx * dx + dy * dy)
      const weight = Math.max(0, 1 - distance)
      weights.push(weight)
      totalWeight += weight
    }

    // Normalize and add to clips
    for (let i = 0; i < blendTree.children.length; i++) {
      const child = blendTree.children[i]
      const normalizedWeight = totalWeight > 0 ? weights[i] / totalWeight : 0

      if (normalizedWeight > 0 && 'id' in child.motion) {
        clips.push({ clipId: child.motion.id, weight: normalizedWeight })
      }
    }
  }
}

// ==================== PRESET CONTROLLERS ====================

/**
 * Create locomotion controller
 */
export function createLocomotionController(): AnimatorController {
  const controller = new AnimatorController('Locomotion Controller')
  
  // Add parameters
  controller.addParameter('Speed', ParameterType.FLOAT, 0)
  controller.addParameter('IsGrounded', ParameterType.BOOL, true)
  controller.addParameter('Jump', ParameterType.TRIGGER, false)
  
  // Get base layer
  const baseLayer = controller.layers[0]
  
  // Add states
  const idleState = controller.addState(baseLayer.id, 'Idle')
  const walkState = controller.addState(baseLayer.id, 'Walk')
  const runState = controller.addState(baseLayer.id, 'Run')
  const jumpState = controller.addState(baseLayer.id, 'Jump')
  
  if (idleState && walkState && runState && jumpState) {
    // Idle -> Walk
    const speedParam = controller.getParameter('Speed')
    if (speedParam) {
      const idleToWalk = controller.addTransition(baseLayer.id, idleState.id, walkState.id)
      if (idleToWalk) {
        controller.addCondition(baseLayer.id, idleState.id, idleToWalk.id, speedParam.id, ConditionMode.GREATER, 0.1)
      }
      
      // Walk -> Idle
      const walkToIdle = controller.addTransition(baseLayer.id, walkState.id, idleState.id)
      if (walkToIdle) {
        controller.addCondition(baseLayer.id, walkState.id, walkToIdle.id, speedParam.id, ConditionMode.LESS, 0.1)
      }
      
      // Walk -> Run
      const walkToRun = controller.addTransition(baseLayer.id, walkState.id, runState.id)
      if (walkToRun) {
        controller.addCondition(baseLayer.id, walkState.id, walkToRun.id, speedParam.id, ConditionMode.GREATER, 0.5)
      }
      
      // Run -> Walk
      const runToWalk = controller.addTransition(baseLayer.id, runState.id, walkState.id)
      if (runToWalk) {
        controller.addCondition(baseLayer.id, runState.id, runToWalk.id, speedParam.id, ConditionMode.LESS, 0.5)
      }
    }
  }
  
  return controller
}
