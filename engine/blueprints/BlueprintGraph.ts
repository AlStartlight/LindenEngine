/**
 * Blueprint Graph - Container untuk visual scripting
 * 
 * Blueprint Graph mengelola semua node dan koneksi dalam satu Blueprint,
 * serta menyediakan runtime execution engine.
 */

import { nanoid } from '../utils/index'
import {
  BlueprintNode,
  BlueprintConnection,
  BlueprintPinType,
  PinDirection,
  NodeCategory,
  ExecutionContext,
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
} from './BlueprintNode'

// ==================== VARIABLE SYSTEM ====================

/**
 * Blueprint Variable Definition
 */
export interface BlueprintVariable {
  id: string
  name: string
  type: BlueprintPinType
  defaultValue: any
  isExposed: boolean // Exposed to editor
  isReplicated: boolean // Network replication
  category: string
  tooltip: string
}

// ==================== FUNCTION SYSTEM ====================

/**
 * Blueprint Function Definition
 */
export interface BlueprintFunction {
  id: string
  name: string
  description: string
  category: string
  inputs: { name: string; type: BlueprintPinType; defaultValue?: any }[]
  outputs: { name: string; type: BlueprintPinType }[]
  nodes: BlueprintNode[]
  connections: BlueprintConnection[]
  isPure: boolean
  isStatic: boolean
}

// ==================== MACRO SYSTEM ====================

/**
 * Blueprint Macro - Reusable node collection
 */
export interface BlueprintMacro {
  id: string
  name: string
  description: string
  inputs: { name: string; type: BlueprintPinType }[]
  outputs: { name: string; type: BlueprintPinType }[]
  nodes: BlueprintNode[]
  connections: BlueprintConnection[]
}

// ==================== BLUEPRINT GRAPH ====================

/**
 * Blueprint Graph - Main container
 */
export class BlueprintGraph {
  public id: string
  public name: string
  public description: string = ''
  
  // Event Graph (main graph)
  public nodes: Map<string, BlueprintNode> = new Map()
  public connections: BlueprintConnection[] = []
  
  // Variables
  public variables: Map<string, BlueprintVariable> = new Map()
  
  // Functions
  public functions: Map<string, BlueprintFunction> = new Map()
  
  // Macros
  public macros: Map<string, BlueprintMacro> = new Map()
  
  // Runtime state
  private isExecuting: boolean = false
  private pendingDelays: Map<string, { remaining: number; nextNodeId: string }> = new Map()
  private executionContext: ExecutionContext | null = null

  constructor(name: string = 'New Blueprint') {
    this.id = nanoid()
    this.name = name
  }

  // ==================== NODE MANAGEMENT ====================

  /**
   * Create node by type
   */
  createNode(nodeType: string): BlueprintNode | null {
    const nodeConstructors: Record<string, new () => BlueprintNode> = {
      // Events
      'EventBeginPlay': EventBeginPlay,
      'EventTick': EventTick,
      'EventInputAction': EventInputAction,
      'EventOnOverlapBegin': EventOnOverlapBegin,
      
      // Flow Control
      'Branch': BranchNode,
      'Sequence': SequenceNode,
      'ForLoop': ForLoopNode,
      'ForEachLoop': ForEachLoopNode,
      'WhileLoop': WhileLoopNode,
      'Delay': DelayNode,
      'Gate': GateNode,
      
      // Variables
      'GetVariable': GetVariableNode,
      'SetVariable': SetVariableNode,
      
      // Math
      'Add': MathAddNode,
      'Subtract': MathSubtractNode,
      'Multiply': MathMultiplyNode,
      'Divide': MathDivideNode,
      'Clamp': MathClampNode,
      'Lerp': MathLerpNode,
      'RandomFloat': RandomFloatNode,
      
      // Comparison
      'Equal': CompareEqualNode,
      'Greater': CompareGreaterNode,
      'Less': CompareLessNode,
      
      // Actions
      'PrintString': PrintStringNode,
      'SpawnActor': SpawnActorNode,
      'DestroyActor': DestroyActorNode,
      'SetActorLocation': SetActorLocationNode,
      'GetActorLocation': GetActorLocationNode,
      'AddMovementInput': AddMovementInputNode,
      'PlaySound': PlaySoundNode,
      
      // Input
      'GetAxisValue': GetAxisValueNode,
      'IsInputKeyDown': IsInputKeyDownNode,
    }

    const Constructor = nodeConstructors[nodeType]
    if (!Constructor) {
      console.warn(`Unknown blueprint node type: ${nodeType}`)
      return null
    }

    const node = new Constructor()
    this.addNode(node)
    return node
  }

  /**
   * Add node
   */
  addNode(node: BlueprintNode): void {
    this.nodes.set(node.id, node)
  }

  /**
   * Remove node
   */
  removeNode(nodeId: string): boolean {
    // Remove all connections
    this.connections = this.connections.filter(
      conn => conn.sourceNodeId !== nodeId && conn.targetNodeId !== nodeId
    )
    return this.nodes.delete(nodeId)
  }

  /**
   * Get node
   */
  getNode(nodeId: string): BlueprintNode | undefined {
    return this.nodes.get(nodeId)
  }

  /**
   * Get all nodes
   */
  getAllNodes(): BlueprintNode[] {
    return Array.from(this.nodes.values())
  }

  /**
   * Get event nodes
   */
  getEventNodes(): BlueprintNode[] {
    return this.getAllNodes().filter(n => n.category === NodeCategory.EVENT)
  }

  // ==================== CONNECTION MANAGEMENT ====================

  /**
   * Connect pins
   */
  connect(
    sourceNodeId: string,
    sourcePinId: string,
    targetNodeId: string,
    targetPinId: string
  ): BlueprintConnection | null {
    const sourceNode = this.nodes.get(sourceNodeId)
    const targetNode = this.nodes.get(targetNodeId)

    if (!sourceNode || !targetNode) {
      console.warn('Source or target node not found')
      return null
    }

    const sourcePin = sourceNode.outputPins.find(p => p.id === sourcePinId)
    const targetPin = targetNode.inputPins.find(p => p.id === targetPinId)

    if (!sourcePin || !targetPin) {
      console.warn('Source or target pin not found')
      return null
    }

    // Check type compatibility
    if (!this.areTypesCompatible(sourcePin.type, targetPin.type)) {
      console.warn(`Incompatible types: ${sourcePin.type} -> ${targetPin.type}`)
      return null
    }

    // For data pins, remove existing connections to target
    if (targetPin.type !== BlueprintPinType.EXEC) {
      this.disconnectTargetPin(targetNodeId, targetPinId)
    }

    // Create connection
    const connection: BlueprintConnection = {
      id: nanoid(),
      sourceNodeId,
      sourcePinId,
      targetNodeId,
      targetPinId,
    }

    this.connections.push(connection)
    sourcePin.connectedTo.push(targetPinId)
    targetPin.connectedTo.push(sourcePinId)

    return connection
  }

  /**
   * Disconnect target pin
   */
  disconnectTargetPin(nodeId: string, pinId: string): void {
    const connectionsToRemove = this.connections.filter(
      c => c.targetNodeId === nodeId && c.targetPinId === pinId
    )

    for (const conn of connectionsToRemove) {
      this.removeConnection(conn.id)
    }
  }

  /**
   * Remove connection
   */
  removeConnection(connectionId: string): boolean {
    const index = this.connections.findIndex(c => c.id === connectionId)
    if (index === -1) return false

    const conn = this.connections[index]
    
    // Update pin connections
    const sourceNode = this.nodes.get(conn.sourceNodeId)
    const targetNode = this.nodes.get(conn.targetNodeId)
    
    if (sourceNode) {
      const sourcePin = sourceNode.outputPins.find(p => p.id === conn.sourcePinId)
      if (sourcePin) {
        sourcePin.connectedTo = sourcePin.connectedTo.filter(id => id !== conn.targetPinId)
      }
    }
    
    if (targetNode) {
      const targetPin = targetNode.inputPins.find(p => p.id === conn.targetPinId)
      if (targetPin) {
        targetPin.connectedTo = targetPin.connectedTo.filter(id => id !== conn.sourcePinId)
      }
    }

    this.connections.splice(index, 1)
    return true
  }

  /**
   * Check type compatibility
   */
  private areTypesCompatible(source: BlueprintPinType, target: BlueprintPinType): boolean {
    if (source === target) return true
    if (source === BlueprintPinType.WILDCARD || target === BlueprintPinType.WILDCARD) return true
    
    // Numeric conversions
    const numericTypes = [BlueprintPinType.FLOAT, BlueprintPinType.INTEGER]
    if (numericTypes.includes(source) && numericTypes.includes(target)) return true

    return false
  }

  // ==================== VARIABLE MANAGEMENT ====================

  /**
   * Add variable
   */
  addVariable(
    name: string,
    type: BlueprintPinType,
    defaultValue: any = null
  ): BlueprintVariable {
    const variable: BlueprintVariable = {
      id: nanoid(),
      name,
      type,
      defaultValue,
      isExposed: false,
      isReplicated: false,
      category: 'Default',
      tooltip: '',
    }
    this.variables.set(variable.id, variable)
    return variable
  }

  /**
   * Remove variable
   */
  removeVariable(variableId: string): boolean {
    return this.variables.delete(variableId)
  }

  /**
   * Get variable
   */
  getVariable(variableId: string): BlueprintVariable | undefined {
    return this.variables.get(variableId)
  }

  /**
   * Get variable by name
   */
  getVariableByName(name: string): BlueprintVariable | undefined {
    return Array.from(this.variables.values()).find(v => v.name === name)
  }

  // ==================== EXECUTION ENGINE ====================

  /**
   * Initialize execution context
   */
  initializeContext(actor: any, world: any): ExecutionContext {
    const context: ExecutionContext = {
      deltaTime: 0,
      currentActor: actor,
      world,
      variables: new Map(),
      callStack: [],
    }

    // Initialize variables with default values
    for (const variable of this.variables.values()) {
      context.variables.set(variable.name, variable.defaultValue)
    }

    this.executionContext = context
    return context
  }

  /**
   * Execute BeginPlay event
   */
  executeBeginPlay(): void {
    if (!this.executionContext) return

    const beginPlayNodes = this.getAllNodes().filter(n => n instanceof EventBeginPlay)
    for (const node of beginPlayNodes) {
      this.executeFromNode(node)
    }
  }

  /**
   * Execute Tick event
   */
  executeTick(deltaTime: number): void {
    if (!this.executionContext) return
    this.executionContext.deltaTime = deltaTime

    // Process delays
    this.processDelays(deltaTime)

    // Execute tick events
    const tickNodes = this.getAllNodes().filter(n => n instanceof EventTick)
    for (const node of tickNodes) {
      this.executeFromNode(node)
    }
  }

  /**
   * Process pending delays
   */
  private processDelays(deltaTime: number): void {
    const completedDelays: string[] = []

    for (const [id, delay] of this.pendingDelays) {
      delay.remaining -= deltaTime
      if (delay.remaining <= 0) {
        completedDelays.push(id)
        const nextNode = this.nodes.get(delay.nextNodeId)
        if (nextNode) {
          this.executeFromNode(nextNode)
        }
      }
    }

    for (const id of completedDelays) {
      this.pendingDelays.delete(id)
    }
  }

  /**
   * Execute from a node
   */
  private executeFromNode(startNode: BlueprintNode): void {
    if (!this.executionContext) return
    
    let currentNode: BlueprintNode | null = startNode
    const maxIterations = 10000 // Prevent infinite loops

    for (let i = 0; i < maxIterations && currentNode; i++) {
      // Get input values
      const inputs = this.collectInputs(currentNode)
      
      // Execute node
      const outputs = currentNode.execute(this.executionContext, inputs)
      
      // Handle special outputs
      if (outputs.has('_delay')) {
        const delay = outputs.get('_delay')
        const nextExecPin = currentNode.getNextExecPin()
        if (nextExecPin && nextExecPin.connectedTo.length > 0) {
          const nextConn = this.connections.find(
            c => c.sourcePinId === nextExecPin.id
          )
          if (nextConn) {
            this.pendingDelays.set(nanoid(), {
              remaining: delay,
              nextNodeId: nextConn.targetNodeId,
            })
          }
        }
        return
      }

      if (outputs.has('_execPin')) {
        // Branch: choose specific output
        const execPinName = outputs.get('_execPin')
        const execPin = currentNode.outputPins.find(
          p => p.type === BlueprintPinType.EXEC && p.name === execPinName
        )
        currentNode = this.getNextNodeFromPin(execPin)
      } else if (outputs.has('_execSequence')) {
        // Sequence: execute all outputs
        const execPins = currentNode.outputPins.filter(
          p => p.type === BlueprintPinType.EXEC
        )
        for (const pin of execPins) {
          const nextNode = this.getNextNodeFromPin(pin)
          if (nextNode) {
            this.executeFromNode(nextNode)
          }
        }
        return
      } else if (outputs.has('_loopRange')) {
        // For loop
        const range = outputs.get('_loopRange')
        const bodyPin = currentNode.outputPins.find(p => p.name === 'Loop Body')
        const completedPin = currentNode.outputPins.find(p => p.name === 'Completed')
        const indexPin = currentNode.outputPins.find(p => p.name === 'Index')
        
        for (let idx = range.first; idx <= range.last; idx++) {
          // Set index output
          if (indexPin) {
            this.executionContext.variables.set('_loopIndex', idx)
          }
          
          const bodyNode = this.getNextNodeFromPin(bodyPin)
          if (bodyNode) {
            this.executeFromNode(bodyNode)
          }
        }
        
        currentNode = this.getNextNodeFromPin(completedPin)
      } else {
        // Normal execution: follow first exec output
        const execPin = currentNode.getNextExecPin()
        currentNode = this.getNextNodeFromPin(execPin)
      }
    }
  }

  /**
   * Get next node from exec pin
   */
  private getNextNodeFromPin(pin: any): BlueprintNode | null {
    if (!pin || pin.connectedTo.length === 0) return null

    const conn = this.connections.find(c => c.sourcePinId === pin.id)
    if (!conn) return null

    return this.nodes.get(conn.targetNodeId) || null
  }

  /**
   * Collect input values for a node
   */
  private collectInputs(node: BlueprintNode): Map<string, any> {
    const inputs = new Map<string, any>()

    for (const inputPin of node.inputPins) {
      if (inputPin.type === BlueprintPinType.EXEC) continue

      // Find connection to this pin
      const conn = this.connections.find(
        c => c.targetNodeId === node.id && c.targetPinId === inputPin.id
      )

      if (conn) {
        // Get value from connected node
        const sourceNode = this.nodes.get(conn.sourceNodeId)
        if (sourceNode) {
          const sourcePin = sourceNode.outputPins.find(p => p.id === conn.sourcePinId)
          if (sourcePin) {
            // For pure nodes, execute them to get value
            if (sourceNode.isPure) {
              const sourceInputs = this.collectInputs(sourceNode)
              const outputs = sourceNode.execute(this.executionContext!, sourceInputs)
              inputs.set(inputPin.name, outputs.get(sourcePin.name))
            } else {
              // For impure nodes, get cached value
              inputs.set(inputPin.name, this.executionContext?.variables.get(`_output_${sourceNode.id}_${sourcePin.name}`))
            }
          }
        }
      } else {
        // Use default value
        inputs.set(inputPin.name, inputPin.defaultValue)
      }
    }

    return inputs
  }

  // ==================== SERIALIZATION ====================

  /**
   * Serialize blueprint
   */
  serialize(): Record<string, any> {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      nodes: Array.from(this.nodes.values()).map(n => n.serialize()),
      connections: this.connections,
      variables: Array.from(this.variables.values()),
      functions: Array.from(this.functions.values()),
      macros: Array.from(this.macros.values()),
    }
  }

  /**
   * Deserialize blueprint
   */
  static deserialize(data: Record<string, any>): BlueprintGraph {
    const graph = new BlueprintGraph(data.name)
    graph.id = data.id
    graph.description = data.description || ''

    // Map class names to node type names
    const classNameToType: Record<string, string> = {
      // Event nodes
      'EventBeginPlay': 'EventBeginPlay',
      'EventTick': 'EventTick',
      'Tick': 'EventTick', // Backwards compatibility
      'EventInputAction': 'EventInputAction',
      'EventOnOverlapBegin': 'EventOnOverlapBegin',
      
      // Flow control nodes
      'BranchNode': 'Branch',
      'SequenceNode': 'Sequence',
      'ForLoopNode': 'ForLoop',
      'ForEachLoopNode': 'ForEachLoop',
      'WhileLoopNode': 'WhileLoop',
      'DelayNode': 'Delay',
      'GateNode': 'Gate',
      
      // Variable nodes
      'GetVariableNode': 'GetVariable',
      'SetVariableNode': 'SetVariable',
      
      // Math nodes
      'MathAddNode': 'Add',
      'MathSubtractNode': 'Subtract',
      'MathMultiplyNode': 'Multiply',
      'MathDivideNode': 'Divide',
      'MathClampNode': 'Clamp',
      'MathLerpNode': 'Lerp',
      'RandomFloatNode': 'RandomFloat',
      
      // Comparison nodes
      'CompareEqualNode': 'Equal',
      'CompareGreaterNode': 'Greater',
      'CompareLessNode': 'Less',
      
      // Action nodes
      'PrintStringNode': 'PrintString',
      'SpawnActorNode': 'SpawnActor',
      'DestroyActorNode': 'DestroyActor',
      'SetActorLocationNode': 'SetActorLocation',
      'GetActorLocationNode': 'GetActorLocation',
      'AddMovementInputNode': 'AddMovementInput',
      'PlaySoundNode': 'PlaySound',
      
      // Input nodes
      'GetAxisValueNode': 'GetAxisValue',
      'IsInputKeyDownNode': 'IsInputKeyDown',
    }

    // Recreate nodes
    for (const nodeData of data.nodes) {
      // Convert class name to node type if needed
      const nodeType = classNameToType[nodeData.type] || nodeData.type
      const node = graph.createNode(nodeType)
      if (node) {
        node.id = nodeData.id
        node.position = nodeData.position
      }
    }

    // Recreate connections
    graph.connections = data.connections || []

    // Recreate variables
    for (const varData of data.variables || []) {
      graph.variables.set(varData.id, varData)
    }

    return graph
  }
}

// ==================== PRESET BLUEPRINTS ====================

/**
 * Create simple movement blueprint
 */
export function createSimpleMovementBlueprint(): BlueprintGraph {
  const graph = new BlueprintGraph('Simple Movement')
  
  // Add speed variable
  graph.addVariable('MoveSpeed', BlueprintPinType.FLOAT, 300)
  
  // Create Event Tick
  const tickNode = graph.createNode('EventTick') as EventTick
  tickNode.position = { x: 0, y: 0 }
  
  // Create Get Axis Value
  const axisNode = graph.createNode('GetAxisValue') as GetAxisValueNode
  axisNode.position = { x: 200, y: 100 }
  
  // Create Multiply
  const multiplyNode = graph.createNode('Multiply') as MathMultiplyNode
  multiplyNode.position = { x: 400, y: 50 }
  
  // Create Add Movement Input
  const moveNode = graph.createNode('AddMovementInput') as AddMovementInputNode
  moveNode.position = { x: 600, y: 0 }
  
  // Connect execution
  const tickExec = tickNode.outputPins.find(p => p.type === BlueprintPinType.EXEC)
  const moveExec = moveNode.inputPins.find(p => p.type === BlueprintPinType.EXEC)
  if (tickExec && moveExec) {
    graph.connect(tickNode.id, tickExec.id, moveNode.id, moveExec.id)
  }
  
  return graph
}

/**
 * Create print hello world blueprint
 */
export function createHelloWorldBlueprint(): BlueprintGraph {
  const graph = new BlueprintGraph('Hello World')
  
  // Create Event Begin Play
  const beginPlayNode = graph.createNode('EventBeginPlay') as EventBeginPlay
  beginPlayNode.position = { x: 0, y: 0 }
  
  // Create Print String
  const printNode = graph.createNode('PrintString') as PrintStringNode
  printNode.position = { x: 300, y: 0 }
  
  // Set default string
  const stringPin = printNode.inputPins.find(p => p.name === 'String')
  if (stringPin) {
    stringPin.defaultValue = 'Hello, Linden Engine!'
  }
  
  // Connect
  const execOut = beginPlayNode.outputPins.find(p => p.type === BlueprintPinType.EXEC)
  const execIn = printNode.inputPins.find(p => p.type === BlueprintPinType.EXEC)
  if (execOut && execIn) {
    graph.connect(beginPlayNode.id, execOut.id, printNode.id, execIn.id)
  }
  
  return graph
}
