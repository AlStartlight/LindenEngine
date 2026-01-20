/**
 * Blueprint Visual Scripting System (UE5 Blueprints-like)
 * 
 * Sistem visual scripting berbasis node yang memungkinkan game designer
 * membuat game logic tanpa coding, mirip dengan Blueprint di Unreal Engine 5.
 */

import { nanoid } from '../utils/index'

// ==================== DATA TYPES ====================

/**
 * Blueprint Pin Types
 */
export enum BlueprintPinType {
  // Execution
  EXEC = 'exec',
  
  // Primitives
  BOOLEAN = 'boolean',
  INTEGER = 'integer',
  FLOAT = 'float',
  STRING = 'string',
  
  // Structures
  VECTOR2 = 'vector2',
  VECTOR3 = 'vector3',
  ROTATOR = 'rotator',
  TRANSFORM = 'transform',
  COLOR = 'color',
  
  // References
  OBJECT = 'object',
  ACTOR = 'actor',
  COMPONENT = 'component',
  CLASS = 'class',
  
  // Collections
  ARRAY = 'array',
  MAP = 'map',
  SET = 'set',
  
  // Special
  WILDCARD = 'wildcard',
  DELEGATE = 'delegate',
  ENUM = 'enum',
}

/**
 * Node execution context
 */
export interface ExecutionContext {
  deltaTime: number
  currentActor: any
  world: any
  variables: Map<string, any>
  callStack: string[]
}

// ==================== PIN SYSTEM ====================

export enum PinDirection {
  INPUT = 'input',
  OUTPUT = 'output',
}

/**
 * Blueprint Pin
 */
export interface BlueprintPin {
  id: string
  name: string
  displayName: string
  direction: PinDirection
  type: BlueprintPinType
  subType?: BlueprintPinType // For array element type
  defaultValue?: any
  connectedTo: string[] // Can have multiple connections for output exec
  isArray: boolean
  nodeId: string
}

/**
 * Blueprint Connection
 */
export interface BlueprintConnection {
  id: string
  sourceNodeId: string
  sourcePinId: string
  targetNodeId: string
  targetPinId: string
}

// ==================== NODE SYSTEM ====================

export enum NodeCategory {
  EVENT = 'Event',
  FLOW_CONTROL = 'Flow Control',
  VARIABLE = 'Variable',
  FUNCTION = 'Function',
  MATH = 'Math',
  STRING = 'String',
  ARRAY = 'Array',
  ACTOR = 'Actor',
  COMPONENT = 'Component',
  INPUT = 'Input',
  DEBUG = 'Debug',
  UTILITY = 'Utility',
  CUSTOM = 'Custom',
}

/**
 * Base Blueprint Node
 */
export abstract class BlueprintNode {
  public id: string
  public name: string
  public displayName: string
  public category: NodeCategory
  public description: string = ''
  public position: { x: number; y: number } = { x: 0, y: 0 }
  public inputPins: BlueprintPin[] = []
  public outputPins: BlueprintPin[] = []
  public isCompact: boolean = false
  public isPure: boolean = false // Pure nodes don't have exec pins
  public color: string = '#4a5568'

  constructor(name: string, displayName: string, category: NodeCategory) {
    this.id = nanoid()
    this.name = name
    this.displayName = displayName
    this.category = category
  }

  /**
   * Add input exec pin
   */
  protected addExecInput(name: string = 'Execute'): BlueprintPin {
    return this.addInputPin(name, BlueprintPinType.EXEC)
  }

  /**
   * Add output exec pin
   */
  protected addExecOutput(name: string = 'Then'): BlueprintPin {
    return this.addOutputPin(name, BlueprintPinType.EXEC)
  }

  /**
   * Add input pin
   */
  protected addInputPin(
    name: string,
    type: BlueprintPinType,
    defaultValue?: any,
    displayName?: string
  ): BlueprintPin {
    const pin: BlueprintPin = {
      id: nanoid(),
      name,
      displayName: displayName || name,
      direction: PinDirection.INPUT,
      type,
      defaultValue,
      connectedTo: [],
      isArray: false,
      nodeId: this.id,
    }
    this.inputPins.push(pin)
    return pin
  }

  /**
   * Add output pin
   */
  protected addOutputPin(
    name: string,
    type: BlueprintPinType,
    displayName?: string
  ): BlueprintPin {
    const pin: BlueprintPin = {
      id: nanoid(),
      name,
      displayName: displayName || name,
      direction: PinDirection.OUTPUT,
      type,
      connectedTo: [],
      isArray: false,
      nodeId: this.id,
    }
    this.outputPins.push(pin)
    return pin
  }

  /**
   * Get pin by ID
   */
  getPin(pinId: string): BlueprintPin | undefined {
    return [...this.inputPins, ...this.outputPins].find(p => p.id === pinId)
  }

  /**
   * Execute node logic
   */
  abstract execute(context: ExecutionContext, inputs: Map<string, any>): Map<string, any>

  /**
   * Get next exec node
   */
  getNextExecPin(): BlueprintPin | undefined {
    return this.outputPins.find(p => p.type === BlueprintPinType.EXEC)
  }

  /**
   * Serialize
   */
  serialize(): Record<string, any> {
    return {
      id: this.id,
      type: this.constructor.name,
      name: this.name,
      displayName: this.displayName,
      category: this.category,
      position: this.position,
      inputPins: this.inputPins,
      outputPins: this.outputPins,
      isPure: this.isPure,
    }
  }
}

// ==================== EVENT NODES ====================

/**
 * Begin Play Event - Called when game starts
 */
export class EventBeginPlay extends BlueprintNode {
  constructor() {
    super('EventBeginPlay', 'Event Begin Play', NodeCategory.EVENT)
    this.color = '#e53e3e'
    this.description = 'Called when the game starts or when the actor is spawned'
    this.addExecOutput()
  }

  execute(context: ExecutionContext, _inputs: Map<string, any>): Map<string, any> {
    return new Map()
  }
}

/**
 * Tick Event - Called every frame
 */
export class EventTick extends BlueprintNode {
  constructor() {
    super('EventTick', 'Event Tick', NodeCategory.EVENT)
    this.color = '#e53e3e'
    this.description = 'Called every frame'
    this.addExecOutput()
    this.addOutputPin('Delta Seconds', BlueprintPinType.FLOAT)
  }

  execute(context: ExecutionContext, _inputs: Map<string, any>): Map<string, any> {
    const outputs = new Map<string, any>()
    outputs.set('Delta Seconds', context.deltaTime)
    return outputs
  }
}

/**
 * Input Action Event
 */
export class EventInputAction extends BlueprintNode {
  public actionName: string = 'Jump'

  constructor() {
    super('EventInputAction', 'Input Action', NodeCategory.EVENT)
    this.color = '#e53e3e'
    this.description = 'Called when an input action is triggered'
    this.addExecOutput('Pressed')
    this.addExecOutput('Released')
  }

  execute(context: ExecutionContext, _inputs: Map<string, any>): Map<string, any> {
    return new Map()
  }
}

/**
 * On Overlap Begin Event
 */
export class EventOnOverlapBegin extends BlueprintNode {
  constructor() {
    super('EventOnOverlapBegin', 'On Overlap Begin', NodeCategory.EVENT)
    this.color = '#e53e3e'
    this.description = 'Called when another actor overlaps this actor'
    this.addExecOutput()
    this.addOutputPin('Other Actor', BlueprintPinType.ACTOR)
    this.addOutputPin('Other Component', BlueprintPinType.COMPONENT)
  }

  execute(context: ExecutionContext, _inputs: Map<string, any>): Map<string, any> {
    return new Map()
  }
}

// ==================== FLOW CONTROL NODES ====================

/**
 * Branch Node (If/Else)
 */
export class BranchNode extends BlueprintNode {
  constructor() {
    super('Branch', 'Branch', NodeCategory.FLOW_CONTROL)
    this.color = '#718096'
    this.description = 'If/Else conditional branch'
    this.addExecInput()
    this.addInputPin('Condition', BlueprintPinType.BOOLEAN, false)
    this.addExecOutput('True')
    this.addExecOutput('False')
  }

  execute(context: ExecutionContext, inputs: Map<string, any>): Map<string, any> {
    const condition = inputs.get('Condition') ?? false
    const outputs = new Map<string, any>()
    outputs.set('_execPin', condition ? 'True' : 'False')
    return outputs
  }
}

/**
 * Sequence Node
 */
export class SequenceNode extends BlueprintNode {
  private outputCount: number = 2

  constructor() {
    super('Sequence', 'Sequence', NodeCategory.FLOW_CONTROL)
    this.color = '#718096'
    this.description = 'Execute multiple outputs in sequence'
    this.addExecInput()
    this.addExecOutput('Then 0')
    this.addExecOutput('Then 1')
  }

  addOutput(): void {
    this.outputCount++
    this.addExecOutput(`Then ${this.outputCount - 1}`)
  }

  execute(context: ExecutionContext, _inputs: Map<string, any>): Map<string, any> {
    const outputs = new Map<string, any>()
    outputs.set('_execSequence', true)
    return outputs
  }
}

/**
 * For Loop Node
 */
export class ForLoopNode extends BlueprintNode {
  constructor() {
    super('ForLoop', 'For Loop', NodeCategory.FLOW_CONTROL)
    this.color = '#718096'
    this.description = 'Loop from First Index to Last Index'
    this.addExecInput()
    this.addInputPin('First Index', BlueprintPinType.INTEGER, 0)
    this.addInputPin('Last Index', BlueprintPinType.INTEGER, 10)
    this.addExecOutput('Loop Body')
    this.addOutputPin('Index', BlueprintPinType.INTEGER)
    this.addExecOutput('Completed')
  }

  execute(context: ExecutionContext, inputs: Map<string, any>): Map<string, any> {
    const firstIndex = inputs.get('First Index') ?? 0
    const lastIndex = inputs.get('Last Index') ?? 10
    const outputs = new Map<string, any>()
    outputs.set('_loopRange', { first: firstIndex, last: lastIndex })
    return outputs
  }
}

/**
 * For Each Loop Node
 */
export class ForEachLoopNode extends BlueprintNode {
  constructor() {
    super('ForEachLoop', 'For Each Loop', NodeCategory.FLOW_CONTROL)
    this.color = '#718096'
    this.description = 'Loop through each element in an array'
    this.addExecInput()
    this.addInputPin('Array', BlueprintPinType.ARRAY)
    this.addExecOutput('Loop Body')
    this.addOutputPin('Array Element', BlueprintPinType.WILDCARD)
    this.addOutputPin('Array Index', BlueprintPinType.INTEGER)
    this.addExecOutput('Completed')
  }

  execute(context: ExecutionContext, inputs: Map<string, any>): Map<string, any> {
    const array = inputs.get('Array') ?? []
    const outputs = new Map<string, any>()
    outputs.set('_forEachArray', array)
    return outputs
  }
}

/**
 * While Loop Node
 */
export class WhileLoopNode extends BlueprintNode {
  constructor() {
    super('WhileLoop', 'While Loop', NodeCategory.FLOW_CONTROL)
    this.color = '#718096'
    this.description = 'Loop while condition is true'
    this.addExecInput()
    this.addInputPin('Condition', BlueprintPinType.BOOLEAN, true)
    this.addExecOutput('Loop Body')
    this.addExecOutput('Completed')
  }

  execute(context: ExecutionContext, inputs: Map<string, any>): Map<string, any> {
    const condition = inputs.get('Condition') ?? true
    const outputs = new Map<string, any>()
    outputs.set('_whileCondition', condition)
    return outputs
  }
}

/**
 * Delay Node
 */
export class DelayNode extends BlueprintNode {
  constructor() {
    super('Delay', 'Delay', NodeCategory.FLOW_CONTROL)
    this.color = '#48bb78'
    this.description = 'Delay execution for specified duration'
    this.addExecInput()
    this.addInputPin('Duration', BlueprintPinType.FLOAT, 1.0)
    this.addExecOutput('Completed')
  }

  execute(context: ExecutionContext, inputs: Map<string, any>): Map<string, any> {
    const duration = inputs.get('Duration') ?? 1.0
    const outputs = new Map<string, any>()
    outputs.set('_delay', duration)
    return outputs
  }
}

/**
 * Gate Node
 */
export class GateNode extends BlueprintNode {
  private isOpen: boolean = false

  constructor() {
    super('Gate', 'Gate', NodeCategory.FLOW_CONTROL)
    this.color = '#718096'
    this.description = 'Gate that can be opened/closed'
    this.addExecInput('Enter')
    this.addExecInput('Open')
    this.addExecInput('Close')
    this.addExecInput('Toggle')
    this.addInputPin('Start Closed', BlueprintPinType.BOOLEAN, true)
    this.addExecOutput('Exit')
  }

  execute(context: ExecutionContext, inputs: Map<string, any>): Map<string, any> {
    const outputs = new Map<string, any>()
    outputs.set('_gateOpen', this.isOpen)
    return outputs
  }
}

// ==================== VARIABLE NODES ====================

/**
 * Get Variable Node
 */
export class GetVariableNode extends BlueprintNode {
  public variableName: string = 'MyVariable'
  public variableType: BlueprintPinType = BlueprintPinType.FLOAT

  constructor() {
    super('GetVariable', 'Get', NodeCategory.VARIABLE)
    this.color = '#38a169'
    this.isPure = true
    this.isCompact = true
    this.addOutputPin('Value', BlueprintPinType.WILDCARD)
  }

  setVariable(name: string, type: BlueprintPinType): void {
    this.variableName = name
    this.variableType = type
    this.displayName = `Get ${name}`
    if (this.outputPins.length > 0) {
      this.outputPins[0].type = type
    }
  }

  execute(context: ExecutionContext, _inputs: Map<string, any>): Map<string, any> {
    const outputs = new Map<string, any>()
    outputs.set('Value', context.variables.get(this.variableName))
    return outputs
  }
}

/**
 * Set Variable Node
 */
export class SetVariableNode extends BlueprintNode {
  public variableName: string = 'MyVariable'
  public variableType: BlueprintPinType = BlueprintPinType.FLOAT

  constructor() {
    super('SetVariable', 'Set', NodeCategory.VARIABLE)
    this.color = '#38a169'
    this.addExecInput()
    this.addInputPin('Value', BlueprintPinType.WILDCARD)
    this.addExecOutput()
    this.addOutputPin('Value', BlueprintPinType.WILDCARD)
  }

  setVariable(name: string, type: BlueprintPinType): void {
    this.variableName = name
    this.variableType = type
    this.displayName = `Set ${name}`
    this.inputPins.find(p => p.name === 'Value')!.type = type
    this.outputPins.find(p => p.name === 'Value')!.type = type
  }

  execute(context: ExecutionContext, inputs: Map<string, any>): Map<string, any> {
    const value = inputs.get('Value')
    context.variables.set(this.variableName, value)
    const outputs = new Map<string, any>()
    outputs.set('Value', value)
    return outputs
  }
}

// ==================== MATH NODES ====================

/**
 * Add Node
 */
export class MathAddNode extends BlueprintNode {
  constructor() {
    super('Add', 'Add', NodeCategory.MATH)
    this.color = '#48bb78'
    this.isPure = true
    this.isCompact = true
    this.addInputPin('A', BlueprintPinType.FLOAT, 0)
    this.addInputPin('B', BlueprintPinType.FLOAT, 0)
    this.addOutputPin('Result', BlueprintPinType.FLOAT)
  }

  execute(context: ExecutionContext, inputs: Map<string, any>): Map<string, any> {
    const a = inputs.get('A') ?? 0
    const b = inputs.get('B') ?? 0
    const outputs = new Map<string, any>()
    outputs.set('Result', a + b)
    return outputs
  }
}

/**
 * Subtract Node
 */
export class MathSubtractNode extends BlueprintNode {
  constructor() {
    super('Subtract', 'Subtract', NodeCategory.MATH)
    this.color = '#48bb78'
    this.isPure = true
    this.isCompact = true
    this.addInputPin('A', BlueprintPinType.FLOAT, 0)
    this.addInputPin('B', BlueprintPinType.FLOAT, 0)
    this.addOutputPin('Result', BlueprintPinType.FLOAT)
  }

  execute(context: ExecutionContext, inputs: Map<string, any>): Map<string, any> {
    const a = inputs.get('A') ?? 0
    const b = inputs.get('B') ?? 0
    const outputs = new Map<string, any>()
    outputs.set('Result', a - b)
    return outputs
  }
}

/**
 * Multiply Node
 */
export class MathMultiplyNode extends BlueprintNode {
  constructor() {
    super('Multiply', 'Multiply', NodeCategory.MATH)
    this.color = '#48bb78'
    this.isPure = true
    this.isCompact = true
    this.addInputPin('A', BlueprintPinType.FLOAT, 1)
    this.addInputPin('B', BlueprintPinType.FLOAT, 1)
    this.addOutputPin('Result', BlueprintPinType.FLOAT)
  }

  execute(context: ExecutionContext, inputs: Map<string, any>): Map<string, any> {
    const a = inputs.get('A') ?? 1
    const b = inputs.get('B') ?? 1
    const outputs = new Map<string, any>()
    outputs.set('Result', a * b)
    return outputs
  }
}

/**
 * Divide Node
 */
export class MathDivideNode extends BlueprintNode {
  constructor() {
    super('Divide', 'Divide', NodeCategory.MATH)
    this.color = '#48bb78'
    this.isPure = true
    this.isCompact = true
    this.addInputPin('A', BlueprintPinType.FLOAT, 1)
    this.addInputPin('B', BlueprintPinType.FLOAT, 1)
    this.addOutputPin('Result', BlueprintPinType.FLOAT)
  }

  execute(context: ExecutionContext, inputs: Map<string, any>): Map<string, any> {
    const a = inputs.get('A') ?? 1
    const b = inputs.get('B') ?? 1
    const outputs = new Map<string, any>()
    outputs.set('Result', b !== 0 ? a / b : 0)
    return outputs
  }
}

/**
 * Clamp Node
 */
export class MathClampNode extends BlueprintNode {
  constructor() {
    super('Clamp', 'Clamp', NodeCategory.MATH)
    this.color = '#48bb78'
    this.isPure = true
    this.addInputPin('Value', BlueprintPinType.FLOAT, 0)
    this.addInputPin('Min', BlueprintPinType.FLOAT, 0)
    this.addInputPin('Max', BlueprintPinType.FLOAT, 1)
    this.addOutputPin('Result', BlueprintPinType.FLOAT)
  }

  execute(context: ExecutionContext, inputs: Map<string, any>): Map<string, any> {
    const value = inputs.get('Value') ?? 0
    const min = inputs.get('Min') ?? 0
    const max = inputs.get('Max') ?? 1
    const outputs = new Map<string, any>()
    outputs.set('Result', Math.max(min, Math.min(max, value)))
    return outputs
  }
}

/**
 * Lerp Node
 */
export class MathLerpNode extends BlueprintNode {
  constructor() {
    super('Lerp', 'Lerp', NodeCategory.MATH)
    this.color = '#48bb78'
    this.isPure = true
    this.addInputPin('A', BlueprintPinType.FLOAT, 0)
    this.addInputPin('B', BlueprintPinType.FLOAT, 1)
    this.addInputPin('Alpha', BlueprintPinType.FLOAT, 0.5)
    this.addOutputPin('Result', BlueprintPinType.FLOAT)
  }

  execute(context: ExecutionContext, inputs: Map<string, any>): Map<string, any> {
    const a = inputs.get('A') ?? 0
    const b = inputs.get('B') ?? 1
    const alpha = inputs.get('Alpha') ?? 0.5
    const outputs = new Map<string, any>()
    outputs.set('Result', a + (b - a) * alpha)
    return outputs
  }
}

/**
 * Random Float Node
 */
export class RandomFloatNode extends BlueprintNode {
  constructor() {
    super('RandomFloat', 'Random Float', NodeCategory.MATH)
    this.color = '#48bb78'
    this.isPure = true
    this.addInputPin('Min', BlueprintPinType.FLOAT, 0)
    this.addInputPin('Max', BlueprintPinType.FLOAT, 1)
    this.addOutputPin('Result', BlueprintPinType.FLOAT)
  }

  execute(context: ExecutionContext, inputs: Map<string, any>): Map<string, any> {
    const min = inputs.get('Min') ?? 0
    const max = inputs.get('Max') ?? 1
    const outputs = new Map<string, any>()
    outputs.set('Result', min + Math.random() * (max - min))
    return outputs
  }
}

// ==================== COMPARISON NODES ====================

/**
 * Equal Node
 */
export class CompareEqualNode extends BlueprintNode {
  constructor() {
    super('Equal', 'Equal (==)', NodeCategory.MATH)
    this.color = '#48bb78'
    this.isPure = true
    this.isCompact = true
    this.addInputPin('A', BlueprintPinType.WILDCARD)
    this.addInputPin('B', BlueprintPinType.WILDCARD)
    this.addOutputPin('Result', BlueprintPinType.BOOLEAN)
  }

  execute(context: ExecutionContext, inputs: Map<string, any>): Map<string, any> {
    const a = inputs.get('A')
    const b = inputs.get('B')
    const outputs = new Map<string, any>()
    outputs.set('Result', a === b)
    return outputs
  }
}

/**
 * Greater Than Node
 */
export class CompareGreaterNode extends BlueprintNode {
  constructor() {
    super('Greater', 'Greater (>)', NodeCategory.MATH)
    this.color = '#48bb78'
    this.isPure = true
    this.isCompact = true
    this.addInputPin('A', BlueprintPinType.FLOAT, 0)
    this.addInputPin('B', BlueprintPinType.FLOAT, 0)
    this.addOutputPin('Result', BlueprintPinType.BOOLEAN)
  }

  execute(context: ExecutionContext, inputs: Map<string, any>): Map<string, any> {
    const a = inputs.get('A') ?? 0
    const b = inputs.get('B') ?? 0
    const outputs = new Map<string, any>()
    outputs.set('Result', a > b)
    return outputs
  }
}

/**
 * Less Than Node
 */
export class CompareLessNode extends BlueprintNode {
  constructor() {
    super('Less', 'Less (<)', NodeCategory.MATH)
    this.color = '#48bb78'
    this.isPure = true
    this.isCompact = true
    this.addInputPin('A', BlueprintPinType.FLOAT, 0)
    this.addInputPin('B', BlueprintPinType.FLOAT, 0)
    this.addOutputPin('Result', BlueprintPinType.BOOLEAN)
  }

  execute(context: ExecutionContext, inputs: Map<string, any>): Map<string, any> {
    const a = inputs.get('A') ?? 0
    const b = inputs.get('B') ?? 0
    const outputs = new Map<string, any>()
    outputs.set('Result', a < b)
    return outputs
  }
}

// ==================== ACTION NODES ====================

/**
 * Print String Node
 */
export class PrintStringNode extends BlueprintNode {
  constructor() {
    super('PrintString', 'Print String', NodeCategory.DEBUG)
    this.color = '#9f7aea'
    this.addExecInput()
    this.addInputPin('String', BlueprintPinType.STRING, 'Hello')
    this.addInputPin('Print to Screen', BlueprintPinType.BOOLEAN, true)
    this.addInputPin('Print to Log', BlueprintPinType.BOOLEAN, true)
    this.addInputPin('Duration', BlueprintPinType.FLOAT, 2.0)
    this.addInputPin('Color', BlueprintPinType.COLOR, { r: 0, g: 1, b: 1, a: 1 })
    this.addExecOutput()
  }

  execute(context: ExecutionContext, inputs: Map<string, any>): Map<string, any> {
    const str = inputs.get('String') ?? 'Hello'
    const printToLog = inputs.get('Print to Log') ?? true
    
    if (printToLog) {
      console.log(`[Blueprint] ${str}`)
    }
    
    return new Map()
  }
}

/**
 * Spawn Actor Node
 */
export class SpawnActorNode extends BlueprintNode {
  constructor() {
    super('SpawnActor', 'Spawn Actor', NodeCategory.ACTOR)
    this.color = '#4299e1'
    this.addExecInput()
    this.addInputPin('Class', BlueprintPinType.CLASS)
    this.addInputPin('Transform', BlueprintPinType.TRANSFORM)
    this.addExecOutput()
    this.addOutputPin('Spawned Actor', BlueprintPinType.ACTOR)
  }

  execute(context: ExecutionContext, inputs: Map<string, any>): Map<string, any> {
    const outputs = new Map<string, any>()
    // Spawn logic would go here
    outputs.set('Spawned Actor', null)
    return outputs
  }
}

/**
 * Destroy Actor Node
 */
export class DestroyActorNode extends BlueprintNode {
  constructor() {
    super('DestroyActor', 'Destroy Actor', NodeCategory.ACTOR)
    this.color = '#e53e3e'
    this.addExecInput()
    this.addInputPin('Target', BlueprintPinType.ACTOR)
    this.addExecOutput()
  }

  execute(context: ExecutionContext, inputs: Map<string, any>): Map<string, any> {
    const target = inputs.get('Target')
    if (target && typeof target.destroy === 'function') {
      target.destroy()
    }
    return new Map()
  }
}

/**
 * Set Actor Location Node
 */
export class SetActorLocationNode extends BlueprintNode {
  constructor() {
    super('SetActorLocation', 'Set Actor Location', NodeCategory.ACTOR)
    this.color = '#4299e1'
    this.addExecInput()
    this.addInputPin('Target', BlueprintPinType.ACTOR)
    this.addInputPin('New Location', BlueprintPinType.VECTOR3, { x: 0, y: 0, z: 0 })
    this.addInputPin('Sweep', BlueprintPinType.BOOLEAN, false)
    this.addInputPin('Teleport', BlueprintPinType.BOOLEAN, false)
    this.addExecOutput()
  }

  execute(context: ExecutionContext, inputs: Map<string, any>): Map<string, any> {
    const target = inputs.get('Target')
    const location = inputs.get('New Location') ?? { x: 0, y: 0, z: 0 }
    
    if (target && target.transform) {
      target.transform.position = location
    }
    
    return new Map()
  }
}

/**
 * Get Actor Location Node
 */
export class GetActorLocationNode extends BlueprintNode {
  constructor() {
    super('GetActorLocation', 'Get Actor Location', NodeCategory.ACTOR)
    this.color = '#4299e1'
    this.isPure = true
    this.addInputPin('Target', BlueprintPinType.ACTOR)
    this.addOutputPin('Location', BlueprintPinType.VECTOR3)
  }

  execute(context: ExecutionContext, inputs: Map<string, any>): Map<string, any> {
    const target = inputs.get('Target')
    const outputs = new Map<string, any>()
    
    if (target && target.transform) {
      outputs.set('Location', target.transform.position)
    } else {
      outputs.set('Location', { x: 0, y: 0, z: 0 })
    }
    
    return outputs
  }
}

/**
 * Add Movement Input Node
 */
export class AddMovementInputNode extends BlueprintNode {
  constructor() {
    super('AddMovementInput', 'Add Movement Input', NodeCategory.ACTOR)
    this.color = '#4299e1'
    this.addExecInput()
    this.addInputPin('World Direction', BlueprintPinType.VECTOR3, { x: 1, y: 0, z: 0 })
    this.addInputPin('Scale Value', BlueprintPinType.FLOAT, 1.0)
    this.addExecOutput()
  }

  execute(context: ExecutionContext, inputs: Map<string, any>): Map<string, any> {
    const direction = inputs.get('World Direction') ?? { x: 1, y: 0, z: 0 }
    const scale = inputs.get('Scale Value') ?? 1.0
    
    // Add movement to current actor
    if (context.currentActor && context.currentActor.transform) {
      context.currentActor.transform.position.x += direction.x * scale * context.deltaTime
      context.currentActor.transform.position.y += direction.y * scale * context.deltaTime
      context.currentActor.transform.position.z += direction.z * scale * context.deltaTime
    }
    
    return new Map()
  }
}

/**
 * Play Sound Node
 */
export class PlaySoundNode extends BlueprintNode {
  constructor() {
    super('PlaySound', 'Play Sound at Location', NodeCategory.UTILITY)
    this.color = '#ed8936'
    this.addExecInput()
    this.addInputPin('Sound', BlueprintPinType.OBJECT)
    this.addInputPin('Location', BlueprintPinType.VECTOR3, { x: 0, y: 0, z: 0 })
    this.addInputPin('Volume', BlueprintPinType.FLOAT, 1.0)
    this.addInputPin('Pitch', BlueprintPinType.FLOAT, 1.0)
    this.addExecOutput()
  }

  execute(context: ExecutionContext, inputs: Map<string, any>): Map<string, any> {
    // Sound playback would go here
    return new Map()
  }
}

// ==================== INPUT NODES ====================

/**
 * Get Axis Value Node
 */
export class GetAxisValueNode extends BlueprintNode {
  public axisName: string = 'MoveForward'

  constructor() {
    super('GetAxisValue', 'Get Axis Value', NodeCategory.INPUT)
    this.color = '#ed64a6'
    this.isPure = true
    this.addOutputPin('Axis Value', BlueprintPinType.FLOAT)
  }

  execute(context: ExecutionContext, _inputs: Map<string, any>): Map<string, any> {
    const outputs = new Map<string, any>()
    // Would get from input system
    outputs.set('Axis Value', 0)
    return outputs
  }
}

/**
 * Is Input Key Down Node
 */
export class IsInputKeyDownNode extends BlueprintNode {
  public keyName: string = 'SpaceBar'

  constructor() {
    super('IsInputKeyDown', 'Is Input Key Down', NodeCategory.INPUT)
    this.color = '#ed64a6'
    this.isPure = true
    this.addOutputPin('Is Down', BlueprintPinType.BOOLEAN)
  }

  execute(context: ExecutionContext, _inputs: Map<string, any>): Map<string, any> {
    const outputs = new Map<string, any>()
    // Would check input system
    outputs.set('Is Down', false)
    return outputs
  }
}

// ==================== NODE TYPE REGISTRY ====================

/**
 * Node type registry for factory pattern
 */
export const BlueprintNodeTypes = {
  // Event Nodes
  EventBeginPlay,
  EventTick,
  EventInputAction,
  EventOnOverlapBegin,
  // Flow Control Nodes
  BranchNode,
  SequenceNode,
  ForLoopNode,
  ForEachLoopNode,
  WhileLoopNode,
  DelayNode,
  GateNode,
  // Variable Nodes
  GetVariableNode,
  SetVariableNode,
  // Math Nodes
  MathAddNode,
  MathSubtractNode,
  MathMultiplyNode,
  MathDivideNode,
  MathClampNode,
  MathLerpNode,
  RandomFloatNode,
  // Comparison Nodes
  CompareEqualNode,
  CompareGreaterNode,
  CompareLessNode,
  // Action Nodes
  PrintStringNode,
  SpawnActorNode,
  DestroyActorNode,
  SetActorLocationNode,
  GetActorLocationNode,
  AddMovementInputNode,
  PlaySoundNode,
  // Input Nodes
  GetAxisValueNode,
  IsInputKeyDownNode,
} as const

export type BlueprintNodeTypeName = keyof typeof BlueprintNodeTypes
