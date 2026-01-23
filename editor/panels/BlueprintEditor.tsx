/**
 * Blueprint Editor Panel - Visual Scripting Editor UI (UE5 style)
 */

import React, { useState, useRef, useCallback, useEffect } from 'react'
import {
  BlueprintGraph,
  BlueprintNode,
  BlueprintPin,
  BlueprintPinType,
  NodeCategory,
} from '../../engine/blueprints'
import { useHistory, useUndoRedoShortcuts } from '../hooks/useHistory'

// ==================== TYPES ====================

interface NodePosition {
  x: number
  y: number
}

interface DragState {
  isDragging: boolean
  nodeId: string | null
  startPos: NodePosition
  offset: NodePosition
}

interface WireDragState {
  isDragging: boolean
  sourceNodeId: string | null
  sourcePinId: string | null
  isExecPin: boolean
  mousePos: NodePosition
}

// ==================== COLOR UTILS ====================

const getPinTypeColor = (pinType: BlueprintPinType): string => {
  switch (pinType) {
    case BlueprintPinType.EXEC:
      return '#ffffff' // White
    case BlueprintPinType.BOOLEAN:
      return '#e53e3e' // Red
    case BlueprintPinType.INTEGER:
      return '#38b2ac' // Teal
    case BlueprintPinType.FLOAT:
      return '#48bb78' // Green
    case BlueprintPinType.STRING:
      return '#f56565' // Pink/Red
    case BlueprintPinType.VECTOR3:
      return '#f6e05e' // Yellow
    case BlueprintPinType.ROTATOR:
      return '#9f7aea' // Purple
    case BlueprintPinType.OBJECT:
      return '#4299e1' // Blue
    case BlueprintPinType.ARRAY:
      return '#ed8936' // Orange
    default:
      return '#718096' // Gray
  }
}

const getNodeCategoryColor = (category: NodeCategory): string => {
  switch (category) {
    case NodeCategory.EVENT:
      return '#e53e3e' // Red
    case NodeCategory.FUNCTION:
      return '#4299e1' // Blue
    case NodeCategory.FLOW_CONTROL:
      return '#718096' // Gray
    case NodeCategory.VARIABLE:
      return '#48bb78' // Green
    case NodeCategory.MATH:
      return '#38b2ac' // Teal
    case NodeCategory.INPUT:
      return '#f6e05e' // Yellow
    case NodeCategory.DEBUG:
      return '#9f7aea' // Purple
    case NodeCategory.CUSTOM:
      return '#ed8936' // Orange
    default:
      return '#718096'
  }
}

// ==================== PIN COMPONENT ====================

interface PinComponentProps {
  pin: BlueprintPin
  nodeId: string
  isInput: boolean
  onDragStart: (nodeId: string, pinId: string, isExec: boolean, e: React.MouseEvent) => void
  onDrop: (nodeId: string, pinId: string) => void
}

const PinComponent: React.FC<PinComponentProps> = ({
  pin,
  nodeId,
  isInput,
  onDragStart,
  onDrop,
}) => {
  const isExec = pin.type === BlueprintPinType.EXEC
  const color = getPinTypeColor(pin.type)
  const isConnected = pin.connectedTo && pin.connectedTo.length > 0

  return (
    <div
      className={`flex items-center py-1 cursor-pointer ${isInput ? '' : 'flex-row-reverse'}`}
      onMouseUp={() => onDrop(nodeId, pin.id)}
    >
      {/* Pin visual */}
      <div
        className={`relative ${isInput ? 'mr-2' : 'ml-2'}`}
        onMouseDown={(e) => {
          e.stopPropagation()
          onDragStart(nodeId, pin.id, isExec, e)
        }}
      >
        {isExec ? (
          // Exec pin - arrow shape
          <div
            className={`w-4 h-4 transition-transform hover:scale-125 ${
              isConnected ? '' : 'opacity-60'
            }`}
            style={{
              clipPath: 'polygon(0 0, 100% 50%, 0 100%)',
              backgroundColor: color,
            }}
          />
        ) : (
          // Data pin - circle
          <div
            className={`w-3 h-3 rounded-full border-2 transition-transform hover:scale-125`}
            style={{
              backgroundColor: isConnected ? color : 'transparent',
              borderColor: color,
            }}
          />
        )}
      </div>

      {/* Pin name */}
      <span className="text-xs text-gray-300">{pin.name}</span>
    </div>
  )
}

// ==================== NODE COMPONENT ====================

interface BlueprintNodeComponentProps {
  node: BlueprintNode
  isSelected: boolean
  onSelect: (nodeId: string) => void
  onDragStart: (nodeId: string, e: React.MouseEvent) => void
  onPinDragStart: (nodeId: string, pinId: string, isExec: boolean, e: React.MouseEvent) => void
  onPinDrop: (nodeId: string, pinId: string) => void
}

const BlueprintNodeComponent: React.FC<BlueprintNodeComponentProps> = ({
  node,
  isSelected,
  onSelect,
  onDragStart,
  onPinDragStart,
  onPinDrop,
}) => {
  const headerColor = getNodeCategoryColor(node.category)
  const isPure = node.isPure

  return (
    <div
      className={`absolute rounded-lg shadow-xl min-w-[200px] select-none ${
        isSelected ? 'ring-2 ring-yellow-400' : ''
      } ${isPure ? 'bg-gray-700' : 'bg-gray-800'}`}
      style={{
        left: node.position.x,
        top: node.position.y,
        zIndex: isSelected ? 100 : 10,
      }}
      onClick={(e) => {
        e.stopPropagation()
        onSelect(node.id)
      }}
    >
      {/* Header */}
      <div
        className="px-3 py-2 rounded-t-lg cursor-move flex items-center gap-2"
        style={{
          background: isPure
            ? `linear-gradient(135deg, ${headerColor}88, ${headerColor}44)`
            : `linear-gradient(135deg, ${headerColor}, ${headerColor}aa)`,
        }}
        onMouseDown={(e) => onDragStart(node.id, e)}
      >
        {/* Category icon */}
        <div className="text-white text-xs opacity-70">
          {node.category === NodeCategory.EVENT && '⚡'}
          {node.category === NodeCategory.FUNCTION && 'ƒ'}
          {node.category === NodeCategory.FLOW_CONTROL && '↔'}
          {node.category === NodeCategory.VARIABLE && '📦'}
          {node.category === NodeCategory.MATH && '∑'}
          {node.category === NodeCategory.INPUT && '🎮'}
          {node.category === NodeCategory.DEBUG && '▶'}
        </div>
        <span className="text-white text-sm font-medium">{node.name}</span>
        {isPure && (
          <span className="text-xs text-green-300 ml-auto">[Pure]</span>
        )}
      </div>

      {/* Body with pins */}
      <div className="p-2 flex">
        {/* Input Pins */}
        <div className="flex-1 min-w-[80px]">
          {node.inputPins.map((pin) => (
            <PinComponent
              key={pin.id}
              pin={pin}
              nodeId={node.id}
              isInput={true}
              onDragStart={onPinDragStart}
              onDrop={onPinDrop}
            />
          ))}
        </div>

        {/* Output Pins */}
        <div className="flex-1 min-w-[80px]">
          {node.outputPins.map((pin) => (
            <PinComponent
              key={pin.id}
              pin={pin}
              nodeId={node.id}
              isInput={false}
              onDragStart={onPinDragStart}
              onDrop={onPinDrop}
            />
          ))}
        </div>
      </div>

      {/* Description tooltip */}
      {node.description && (
        <div className="px-3 py-1 text-xs text-yellow-400 bg-yellow-900 bg-opacity-30 rounded-b-lg">
          💬 {node.description}
        </div>
      )}
    </div>
  )
}

// ==================== WIRE COMPONENT ====================

interface WireProps {
  startX: number
  startY: number
  endX: number
  endY: number
  isExec: boolean
  color: string
  isTemp?: boolean
}

const Wire: React.FC<WireProps> = ({
  startX,
  startY,
  endX,
  endY,
  isExec,
  color,
  isTemp = false,
}) => {
  // Calculate bezier control points
  const dx = Math.abs(endX - startX)
  const controlOffset = Math.min(dx * 0.5, 100)

  const path = `M ${startX} ${startY} 
                C ${startX + controlOffset} ${startY}, 
                  ${endX - controlOffset} ${endY}, 
                  ${endX} ${endY}`

  return (
    <>
      {/* Shadow */}
      <path
        d={path}
        stroke="black"
        strokeWidth={isExec ? 4 : 3}
        fill="none"
        opacity={0.3}
        strokeLinecap="round"
      />
      {/* Main wire */}
      <path
        d={path}
        stroke={color}
        strokeWidth={isExec ? 3 : 2}
        fill="none"
        strokeDasharray={isTemp ? '8,4' : 'none'}
        className={isTemp ? 'opacity-70' : ''}
        strokeLinecap="round"
      />
      {/* Glow effect for exec wires */}
      {isExec && !isTemp && (
        <path
          d={path}
          stroke={color}
          strokeWidth={6}
          fill="none"
          opacity={0.2}
          strokeLinecap="round"
        />
      )}
    </>
  )
}

// ==================== NODE PALETTE ====================

interface NodePaletteProps {
  onCreateNode: (nodeType: string) => void
  searchQuery: string
  onSearchChange: (query: string) => void
}

const NodePalette: React.FC<NodePaletteProps> = ({
  onCreateNode,
  searchQuery,
  onSearchChange,
}) => {
  const nodeCategories = [
    {
      name: 'Events',
      color: '#e53e3e',
      nodes: ['EventBeginPlay', 'EventTick', 'EventInputAction', 'EventOnOverlapBegin'],
    },
    {
      name: 'Flow Control',
      color: '#718096',
      nodes: ['Branch', 'Sequence', 'ForLoop', 'WhileLoop', 'Delay', 'Gate'],
    },
    {
      name: 'Variables',
      color: '#48bb78',
      nodes: ['GetVariable', 'SetVariable'],
    },
    {
      name: 'Math',
      color: '#38b2ac',
      nodes: ['Add', 'Subtract', 'Multiply', 'Divide', 'RandomFloat', 'Clamp', 'Lerp'],
    },
    {
      name: 'Actions',
      color: '#9f7aea',
      nodes: ['PrintString', 'SetActorLocation', 'GetActorLocation', 'SpawnActor', 'DestroyActor'],
    },
    {
      name: 'Input',
      color: '#f6e05e',
      nodes: ['IsInputKeyDown', 'GetAxisValue'],
    },
  ]

  const filteredCategories = nodeCategories.map((cat) => ({
    ...cat,
    nodes: cat.nodes.filter((n) =>
      n.toLowerCase().includes(searchQuery.toLowerCase())
    ),
  })).filter((cat) => cat.nodes.length > 0)

  return (
    <div className="w-56 bg-gray-900 border-r border-gray-700 flex flex-col">
      {/* Search */}
      <div className="p-2 border-b border-gray-700">
        <input
          type="text"
          placeholder="Search nodes..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full bg-gray-800 text-gray-300 text-sm px-3 py-2 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Categories */}
      <div className="flex-1 overflow-y-auto">
        {filteredCategories.map((category) => (
          <div key={category.name} className="border-b border-gray-800">
            <div
              className="px-3 py-2 text-sm font-medium flex items-center gap-2"
              style={{ color: category.color }}
            >
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: category.color }}
              />
              {category.name}
            </div>
            <div className="px-2 pb-2">
              {category.nodes.map((nodeType) => (
                <button
                  key={nodeType}
                  className="w-full text-left px-3 py-1.5 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors cursor-grab active:cursor-grabbing"
                  onClick={() => onCreateNode(nodeType)}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('nodeType', nodeType)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                >
                  {nodeType}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Quick access */}
      <div className="p-2 border-t border-gray-700 bg-gray-850">
        <div className="text-xs text-gray-500 mb-2">Quick Actions</div>
        <div className="flex gap-1">
          <button
            className="flex-1 px-2 py-1 text-xs bg-red-900 text-red-300 rounded hover:bg-red-800"
            onClick={() => onCreateNode('EventBeginPlay')}
          >
            Event
          </button>
          <button
            className="flex-1 px-2 py-1 text-xs bg-gray-700 text-gray-300 rounded hover:bg-gray-600"
            onClick={() => onCreateNode('Branch')}
          >
            Branch
          </button>
          <button
            className="flex-1 px-2 py-1 text-xs bg-purple-900 text-purple-300 rounded hover:bg-purple-800"
            onClick={() => onCreateNode('PrintString')}
          >
            Print
          </button>
        </div>
      </div>
    </div>
  )
}

// ==================== VARIABLES PANEL ====================

interface VariablesPanelProps {
  graph: BlueprintGraph
  onCreateVariable: (name: string, type: string) => void
  onSelectVariable: (name: string) => void
}

const VariablesPanel: React.FC<VariablesPanelProps> = ({
  graph,
  onCreateVariable,
  onSelectVariable,
}) => {
  const [newVarName, setNewVarName] = useState('')
  const [newVarType, setNewVarType] = useState('Boolean')

  const varTypes = ['Boolean', 'Integer', 'Float', 'String', 'Vector3', 'Object']

  return (
    <div className="w-48 bg-gray-900 border-l border-gray-700 flex flex-col">
      <div className="p-2 text-sm font-medium text-gray-300 border-b border-gray-700">
        Variables
      </div>

      {/* Variable list */}
      <div className="flex-1 overflow-y-auto p-2">
        {Array.from(graph.variables.entries()).map(([id, variable]) => (
          <div
            key={id}
            className="flex items-center gap-2 p-2 hover:bg-gray-800 rounded cursor-grab active:cursor-grabbing"
            onClick={() => onSelectVariable(variable.name)}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('variableId', id)
              e.dataTransfer.setData('variableName', variable.name)
              e.dataTransfer.effectAllowed = 'copy'
            }}
          >
            <div
              className="w-2 h-2 rounded-full"
              style={{
                backgroundColor: getPinTypeColor(variable.type),
              }}
            />
            <span className="text-sm text-gray-300 truncate">{variable.name}</span>
          </div>
        ))}
      </div>

      {/* Add variable */}
      <div className="p-2 border-t border-gray-700 space-y-2">
        <input
          type="text"
          placeholder="Variable name"
          value={newVarName}
          onChange={(e) => setNewVarName(e.target.value)}
          className="w-full bg-gray-800 text-gray-300 text-xs px-2 py-1.5 rounded"
        />
        <select
          value={newVarType}
          onChange={(e) => setNewVarType(e.target.value)}
          className="w-full bg-gray-800 text-gray-300 text-xs px-2 py-1.5 rounded"
        >
          {varTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <button
          className="w-full px-2 py-1.5 bg-green-700 text-white text-xs rounded hover:bg-green-600"
          onClick={() => {
            if (newVarName) {
              onCreateVariable(newVarName, newVarType)
              setNewVarName('')
            }
          }}
        >
          + Add Variable
        </button>
      </div>
    </div>
  )
}

// ==================== MAIN BLUEPRINT EDITOR ====================

export const BlueprintEditor: React.FC = () => {
  const initialGraph = useCallback(() => {
    const g = new BlueprintGraph('PlayerController')
    
    // Create some sample nodes
    const beginPlay = g.createNode('EventBeginPlay')
    if (beginPlay) {
      beginPlay.position = { x: 100, y: 100 }
    }
    
    const print = g.createNode('PrintString')
    if (print) {
      print.position = { x: 400, y: 100 }
    }
    
    // Connect them
    if (beginPlay && print) {
      const execOut = beginPlay.outputPins.find(p => p.type === BlueprintPinType.EXEC)
      const execIn = print.inputPins.find(p => p.type === BlueprintPinType.EXEC)
      if (execOut && execIn) {
        g.connect(beginPlay.id, execOut.id, print.id, execIn.id)
      }
    }
    
    // Add some variables
    g.addVariable('Health', BlueprintPinType.INTEGER, 100)
    g.addVariable('PlayerName', BlueprintPinType.STRING, 'Player1')
    g.addVariable('IsAlive', BlueprintPinType.BOOLEAN, true)
    
    return JSON.stringify(g.serialize())
  }, [])

  const { state: graphState, setState: setGraphState, undo, redo, canUndo, canRedo } = useHistory(
    initialGraph()
  )

  const graphRef = useRef<BlueprintGraph>(BlueprintGraph.deserialize(JSON.parse(graphState)))

  // Update graph from history
  useEffect(() => {
    graphRef.current = BlueprintGraph.deserialize(JSON.parse(graphState))
    forceUpdate({})
  }, [graphState])

  // Register undo/redo keyboard shortcuts
  useUndoRedoShortcuts(undo, redo, canUndo, canRedo)

  const graph = graphRef.current

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    nodeId: null,
    startPos: { x: 0, y: 0 },
    offset: { x: 0, y: 0 },
  })
  const [wireDrag, setWireDrag] = useState<WireDragState>({
    isDragging: false,
    sourceNodeId: null,
    sourcePinId: null,
    isExecPin: false,
    mousePos: { x: 0, y: 0 },
  })
  const [, forceUpdate] = useState({})

  const canvasRef = useRef<HTMLDivElement>(null)

  // Save current state to history
  const saveHistory = useCallback(() => {
    setGraphState(JSON.stringify(graph.serialize()))
  }, [graph, setGraphState])

  // Create node
  const handleCreateNode = useCallback((nodeType: string) => {
    const node = graph.createNode(nodeType)
    if (node) {
      node.position = {
        x: 200 + Math.random() * 300,
        y: 100 + Math.random() * 200,
      }
      saveHistory()
    }
  }, [graph, saveHistory])

  // Node drag
  const handleNodeDragStart = useCallback((nodeId: string, e: React.MouseEvent) => {
    const node = graph.getNode(nodeId)
    if (!node) return

    setDragState({
      isDragging: true,
      nodeId,
      startPos: { x: e.clientX, y: e.clientY },
      offset: { x: node.position.x, y: node.position.y },
    })
  }, [graph])

  // Pin drag start
  const handlePinDragStart = useCallback((
    nodeId: string,
    pinId: string,
    isExec: boolean,
    e: React.MouseEvent
  ) => {
    setWireDrag({
      isDragging: true,
      sourceNodeId: nodeId,
      sourcePinId: pinId,
      isExecPin: isExec,
      mousePos: { x: e.clientX, y: e.clientY },
    })
  }, [])

  // Pin drop
  const handlePinDrop = useCallback((targetNodeId: string, targetPinId: string) => {
    if (wireDrag.isDragging && wireDrag.sourceNodeId && wireDrag.sourcePinId) {
      // Determine which is source and which is target
      const sourceNode = graph.getNode(wireDrag.sourceNodeId)
      const sourcePin = sourceNode?.outputPins.find(p => p.id === wireDrag.sourcePinId)
        || sourceNode?.inputPins.find(p => p.id === wireDrag.sourcePinId)

      if (sourcePin) {
        const isSourceOutput = sourceNode?.outputPins.includes(sourcePin)
        
        if (isSourceOutput) {
          graph.connect(wireDrag.sourceNodeId, wireDrag.sourcePinId, targetNodeId, targetPinId)
        } else {
          graph.connect(targetNodeId, targetPinId, wireDrag.sourceNodeId, wireDrag.sourcePinId)
        }
        forceUpdate({})
      }
    }
    setWireDrag({
      isDragging: false,
      sourceNodeId: null,
      sourcePinId: null,
      isExecPin: false,
      mousePos: { x: 0, y: 0 },
    })
  }, [wireDrag, graph])

  // Mouse move
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragState.isDragging && dragState.nodeId) {
      const node = graph.getNode(dragState.nodeId)
      if (node) {
        node.position = {
          x: dragState.offset.x + (e.clientX - dragState.startPos.x),
          y: dragState.offset.y + (e.clientY - dragState.startPos.y),
        }
        forceUpdate({})
      }
    }

    if (wireDrag.isDragging) {
      setWireDrag(prev => ({
        ...prev,
        mousePos: { x: e.clientX, y: e.clientY },
      }))
    }
  }, [dragState, wireDrag, graph])

  // Mouse up
  const handleMouseUp = useCallback(() => {
    if (dragState.isDragging) {
      saveHistory()
    }
    if (wireDrag.isDragging) {
      setWireDrag({
        isDragging: false,
        sourceNodeId: null,
        sourcePinId: null,
        isExecPin: false,
        mousePos: { x: 0, y: 0 },
      })
    }
    setDragState({
      isDragging: false,
      nodeId: null,
      startPos: { x: 0, y: 0 },
      offset: { x: 0, y: 0 },
    })
  }, [dragState.isDragging, wireDrag.isDragging, saveHistory])

  // Create variable
  const handleCreateVariable = useCallback((name: string, type: string) => {
    const typeMap: Record<string, BlueprintPinType> = {
      Boolean: BlueprintPinType.BOOLEAN,
      Integer: BlueprintPinType.INTEGER,
      Float: BlueprintPinType.FLOAT,
      String: BlueprintPinType.STRING,
      Vector3: BlueprintPinType.VECTOR3,
      Object: BlueprintPinType.OBJECT,
    }
    const defaultValues: Record<string, any> = {
      Boolean: false,
      Integer: 0,
      Float: 0.0,
      String: '',
      Vector3: { x: 0, y: 0, z: 0 },
      Object: null,
    }
    graph.addVariable(name, typeMap[type] || BlueprintPinType.OBJECT, defaultValues[type] ?? null)
    forceUpdate({})
  }, [graph])

  // Delete selected node
  const handleDeleteSelected = useCallback(() => {
    if (selectedNodeId) {
      graph.removeNode(selectedNodeId)
      setSelectedNodeId(null)
      forceUpdate({})
    }
  }, [selectedNodeId, graph])

  // Execute graph
  const handleExecute = useCallback(() => {
    console.log('Executing Blueprint: ' + graph.name)
    graph.executeBeginPlay()
  }, [graph])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        handleDeleteSelected()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleDeleteSelected])

  // Get wire path data
  const getWirePath = (conn: { sourceNodeId: string; sourcePinId: string; targetNodeId: string; targetPinId: string }) => {
    const sourceNode = graph.getNode(conn.sourceNodeId)
    const targetNode = graph.getNode(conn.targetNodeId)
    if (!sourceNode || !targetNode) return null

    const sourcePin = sourceNode.outputPins.find(p => p.id === conn.sourcePinId)
    const targetPin = targetNode.inputPins.find(p => p.id === conn.targetPinId)
    if (!sourcePin || !targetPin) return null

    const sourcePinIndex = sourceNode.outputPins.indexOf(sourcePin)
    const targetPinIndex = targetNode.inputPins.indexOf(targetPin)

    return {
      startX: sourceNode.position.x + 200,
      startY: sourceNode.position.y + 50 + sourcePinIndex * 28,
      endX: targetNode.position.x,
      endY: targetNode.position.y + 50 + targetPinIndex * 28,
      isExec: sourcePin.type === BlueprintPinType.EXEC,
      color: getPinTypeColor(sourcePin.type),
    }
  }

  // Handle drop from palette or variable panel
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const nodeType = e.dataTransfer.getData('nodeType')
    const variableId = e.dataTransfer.getData('variableId')
    const variableName = e.dataTransfer.getData('variableName')
    
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    if (nodeType) {
      const node = graph.createNode(nodeType)
      if (node) {
        node.position = { x, y }
        forceUpdate({})
      }
    } else if (variableId && variableName) {
      // Create GetVariable node for the variable
      // Use Ctrl/Cmd+drag to create SetVariable instead
      const isSet = e.ctrlKey || e.metaKey
      const node = graph.createNode(isSet ? 'SetVariable' : 'GetVariable')
      if (node) {
        node.position = { x, y }
        // TODO: Link node to variable
        forceUpdate({})
      }
    }
  }, [graph])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  return (
    <div className="flex h-full bg-gray-900">
      {/* Node Palette */}
      <NodePalette
        onCreateNode={handleCreateNode}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* Canvas */}
      <div
        ref={canvasRef}
        className="flex-1 relative overflow-auto"
        style={{
          backgroundImage: `
            linear-gradient(to right, #1f2937 1px, transparent 1px),
            linear-gradient(to bottom, #1f2937 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px',
          backgroundColor: '#111827',
        }}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onMouseLeave={handleMouseUp}
        onClick={() => setSelectedNodeId(null)}
      >
        {/* Toolbar */}
        <div className="absolute top-3 left-3 z-50 flex gap-2 bg-gray-800 bg-opacity-90 p-2 rounded-lg">
          <button
            className="px-4 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 flex items-center gap-1"
            onClick={handleExecute}
          >
            ▶ Execute
          </button>
          <button
            className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
            onClick={() => console.log('Blueprint validated:', graph.name)}
          >
            Validate
          </button>
          <div className="w-px bg-gray-600" />
          <button
            className={`px-3 py-1.5 text-sm rounded ${
              canUndo ? 'bg-gray-700 text-white hover:bg-gray-600' : 'bg-gray-800 text-gray-600 cursor-not-allowed'
            }`}
            onClick={undo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
          >
            ↶ Undo
          </button>
          <button
            className={`px-3 py-1.5 text-sm rounded ${
              canRedo ? 'bg-gray-700 text-white hover:bg-gray-600' : 'bg-gray-800 text-gray-600 cursor-not-allowed'
            }`}
            onClick={redo}
            disabled={!canRedo}
            title="Redo (Ctrl+Shift+Z)"
          >
            ↷ Redo
          </button>
          <div className="w-px bg-gray-600" />
          <span className="px-2 py-1.5 text-gray-400 text-sm">
            {graph.name}
          </span>
        </div>

        {/* Wires SVG */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          {/* Existing connections */}
          {graph.connections.map((conn) => {
            const pathData = getWirePath(conn)
            if (!pathData) return null
            return (
              <Wire
                key={conn.id}
                startX={pathData.startX}
                startY={pathData.startY}
                endX={pathData.endX}
                endY={pathData.endY}
                isExec={pathData.isExec}
                color={pathData.color}
              />
            )
          })}

          {/* Dragging wire */}
          {wireDrag.isDragging && wireDrag.sourceNodeId && (
            <Wire
              startX={
                (graph.getNode(wireDrag.sourceNodeId)?.position.x || 0) + 200
              }
              startY={
                (graph.getNode(wireDrag.sourceNodeId)?.position.y || 0) + 50
              }
              endX={wireDrag.mousePos.x - (canvasRef.current?.getBoundingClientRect().left || 0)}
              endY={wireDrag.mousePos.y - (canvasRef.current?.getBoundingClientRect().top || 0)}
              isExec={wireDrag.isExecPin}
              color={wireDrag.isExecPin ? '#ffffff' : '#718096'}
              isTemp
            />
          )}
        </svg>

        {/* Nodes */}
        {Array.from(graph.nodes.values()).map((node) => (
          <BlueprintNodeComponent
            key={node.id}
            node={node}
            isSelected={node.id === selectedNodeId}
            onSelect={setSelectedNodeId}
            onDragStart={handleNodeDragStart}
            onPinDragStart={handlePinDragStart}
            onPinDrop={handlePinDrop}
          />
        ))}

        {/* Execution indicator */}
        <div className="absolute bottom-3 left-3 flex items-center gap-2 bg-gray-800 bg-opacity-90 px-3 py-2 rounded-lg">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs text-gray-400">Ready</span>
          <span className="text-xs text-gray-600">|</span>
          <span className="text-xs text-gray-500">
            Nodes: {graph.nodes.size} • Connections: {graph.connections.length}
          </span>
        </div>
      </div>

      {/* Variables Panel */}
      <VariablesPanel
        graph={graph}
        onCreateVariable={handleCreateVariable}
        onSelectVariable={(name) => console.log('Selected variable:', name)}
      />
    </div>
  )
}

export default BlueprintEditor
