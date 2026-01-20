/**
 * Material Editor Panel - Node-based material editor UI (UE5/Unity style)
 */

import React, { useState, useRef, useCallback, useEffect } from 'react'
import {
  MaterialGraph,
  MaterialNode,
  MaterialConnection,
  MaterialDataType,
  NodeCategory,
  PinDirection,
  createBasicLitMaterial,
} from '../../engine/materials'

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

interface ConnectionDragState {
  isDragging: boolean
  sourceNodeId: string | null
  sourcePinId: string | null
  sourcePinType: MaterialDataType | null
  mousePos: NodePosition
}

// ==================== COLOR UTILS ====================

const getPinColor = (dataType: MaterialDataType): string => {
  switch (dataType) {
    case MaterialDataType.FLOAT:
      return '#9f7aea' // Purple
    case MaterialDataType.FLOAT2:
      return '#48bb78' // Green
    case MaterialDataType.FLOAT3:
      return '#f6e05e' // Yellow
    case MaterialDataType.FLOAT4:
      return '#fc8181' // Red
    case MaterialDataType.TEXTURE2D:
      return '#ed8936' // Orange
    case MaterialDataType.BOOLEAN:
      return '#e53e3e' // Red
    default:
      return '#718096' // Gray
  }
}

const getNodeColor = (category: NodeCategory): string => {
  switch (category) {
    case NodeCategory.INPUT:
      return '#4299e1' // Blue
    case NodeCategory.OUTPUT:
      return '#e53e3e' // Red
    case NodeCategory.MATH:
      return '#48bb78' // Green
    case NodeCategory.VECTOR:
      return '#9f7aea' // Purple
    case NodeCategory.TEXTURE:
      return '#ed8936' // Orange
    case NodeCategory.UTILITY:
      return '#38b2ac' // Teal
    case NodeCategory.CONSTANT:
      return '#667eea' // Indigo
    case NodeCategory.PARAMETER:
      return '#f6ad55' // Orange
    default:
      return '#718096' // Gray
  }
}

// ==================== NODE COMPONENT ====================

interface MaterialNodeComponentProps {
  node: MaterialNode
  isSelected: boolean
  onSelect: (nodeId: string) => void
  onDragStart: (nodeId: string, e: React.MouseEvent) => void
  onPinDragStart: (nodeId: string, pinId: string, direction: PinDirection, dataType: MaterialDataType, e: React.MouseEvent) => void
  onPinDrop: (nodeId: string, pinId: string) => void
}

const MaterialNodeComponent: React.FC<MaterialNodeComponentProps> = ({
  node,
  isSelected,
  onSelect,
  onDragStart,
  onPinDragStart,
  onPinDrop,
}) => {
  const headerColor = getNodeColor(node.category)

  return (
    <div
      className={`absolute bg-gray-800 rounded-lg shadow-lg min-w-[180px] select-none ${
        isSelected ? 'ring-2 ring-blue-500' : ''
      }`}
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
        className="px-3 py-2 rounded-t-lg cursor-move text-white text-sm font-medium"
        style={{ backgroundColor: headerColor }}
        onMouseDown={(e) => onDragStart(node.id, e)}
      >
        {node.name}
      </div>

      {/* Body */}
      <div className="p-2 flex">
        {/* Input Pins */}
        <div className="flex-1">
          {node.inputPins.map((pin) => (
            <div
              key={pin.id}
              className="flex items-center py-1 cursor-pointer"
              onMouseUp={() => onPinDrop(node.id, pin.id)}
            >
              <div
                className="w-3 h-3 rounded-full border-2 mr-2 hover:scale-125 transition-transform"
                style={{
                  backgroundColor: pin.connectedTo ? getPinColor(pin.dataType) : 'transparent',
                  borderColor: getPinColor(pin.dataType),
                }}
                onMouseDown={(e) => {
                  e.stopPropagation()
                  onPinDragStart(node.id, pin.id, PinDirection.INPUT, pin.dataType, e)
                }}
              />
              <span className="text-xs text-gray-300">{pin.name}</span>
            </div>
          ))}
        </div>

        {/* Output Pins */}
        <div className="flex-1">
          {node.outputPins.map((pin) => (
            <div
              key={pin.id}
              className="flex items-center justify-end py-1 cursor-pointer"
            >
              <span className="text-xs text-gray-300">{pin.name}</span>
              <div
                className="w-3 h-3 rounded-full border-2 ml-2 hover:scale-125 transition-transform"
                style={{
                  backgroundColor: getPinColor(pin.dataType),
                  borderColor: getPinColor(pin.dataType),
                }}
                onMouseDown={(e) => {
                  e.stopPropagation()
                  onPinDragStart(node.id, pin.id, PinDirection.OUTPUT, pin.dataType, e)
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Footer - Category */}
      <div className="px-3 py-1 text-xs text-gray-500 border-t border-gray-700">
        {node.category}
      </div>
    </div>
  )
}

// ==================== CONNECTION COMPONENT ====================

interface ConnectionLineProps {
  startX: number
  startY: number
  endX: number
  endY: number
  color: string
  isTemp?: boolean
}

const ConnectionLine: React.FC<ConnectionLineProps> = ({
  startX,
  startY,
  endX,
  endY,
  color,
  isTemp = false,
}) => {
  const midX = (startX + endX) / 2
  const path = `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`

  return (
    <path
      d={path}
      stroke={color}
      strokeWidth={isTemp ? 2 : 3}
      fill="none"
      strokeDasharray={isTemp ? '5,5' : 'none'}
      className={isTemp ? 'opacity-50' : ''}
    />
  )
}

// ==================== NODE PALETTE ====================

interface NodePaletteProps {
  onCreateNode: (nodeType: string) => void
}

const NodePalette: React.FC<NodePaletteProps> = ({ onCreateNode }) => {
  const nodeTypes = [
    { category: 'Input', nodes: ['TextureSample', 'UV', 'VertexColor', 'WorldPosition', 'Normal', 'Time'] },
    { category: 'Constants', nodes: ['Constant', 'Constant2', 'Constant3', 'Constant4', 'Parameter'] },
    { category: 'Math', nodes: ['Add', 'Subtract', 'Multiply', 'Divide', 'Power', 'Lerp', 'Clamp', 'Sin', 'Cos', 'Abs', 'OneMinus'] },
    { category: 'Vector', nodes: ['Normalize', 'Dot', 'Cross', 'ComponentMask', 'Append'] },
    { category: 'Utility', nodes: ['Fresnel', 'Panner', 'Rotator'] },
  ]

  const handleDragStart = (e: React.DragEvent, nodeType: string) => {
    e.dataTransfer.setData('nodeType', nodeType)
    e.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <div className="w-48 bg-gray-900 border-r border-gray-700 overflow-y-auto">
      <div className="p-2 text-sm font-medium text-gray-300 border-b border-gray-700">
        Node Palette
      </div>
      {nodeTypes.map((group) => (
        <div key={group.category} className="p-2">
          <div className="text-xs text-gray-500 uppercase mb-1">{group.category}</div>
          {group.nodes.map((nodeType) => (
            <button
              key={nodeType}
              className="w-full text-left px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 rounded cursor-grab active:cursor-grabbing"
              onClick={() => onCreateNode(nodeType)}
              draggable
              onDragStart={(e) => handleDragStart(e, nodeType)}
            >
              {nodeType}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

// ==================== PROPERTIES PANEL ====================

interface PropertiesPanelProps {
  selectedNode: MaterialNode | null
  graph: MaterialGraph
  onUpdate: () => void
}

const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  selectedNode,
  graph,
  onUpdate,
}) => {
  if (!selectedNode) {
    return (
      <div className="w-64 bg-gray-900 border-l border-gray-700 p-4">
        <div className="text-gray-500 text-sm">No node selected</div>
        <div className="mt-4 text-xs text-gray-600">
          <p>Material: {graph.name}</p>
          <p>Blend Mode: {graph.blendMode}</p>
          <p>Shading: {graph.shadingModel}</p>
          <p>Nodes: {graph.nodes.size}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-64 bg-gray-900 border-l border-gray-700 p-4 overflow-y-auto">
      <div className="text-sm font-medium text-white mb-4">{selectedNode.name}</div>
      
      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-400">Category</label>
          <div className="text-sm text-gray-300">{selectedNode.category}</div>
        </div>

        <div>
          <label className="text-xs text-gray-400">Position</label>
          <div className="flex gap-2">
            <input
              type="number"
              value={Math.round(selectedNode.position.x)}
              onChange={(e) => {
                selectedNode.position.x = Number(e.target.value)
                onUpdate()
              }}
              className="w-20 bg-gray-800 text-gray-300 text-xs px-2 py-1 rounded"
            />
            <input
              type="number"
              value={Math.round(selectedNode.position.y)}
              onChange={(e) => {
                selectedNode.position.y = Number(e.target.value)
                onUpdate()
              }}
              className="w-20 bg-gray-800 text-gray-300 text-xs px-2 py-1 rounded"
            />
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-400">Input Pins</label>
          {selectedNode.inputPins.map((pin) => (
            <div key={pin.id} className="flex items-center justify-between py-1">
              <span className="text-xs text-gray-300">{pin.name}</span>
              <span
                className="text-xs px-1 rounded"
                style={{ color: getPinColor(pin.dataType) }}
              >
                {pin.dataType}
              </span>
            </div>
          ))}
        </div>

        <div>
          <label className="text-xs text-gray-400">Output Pins</label>
          {selectedNode.outputPins.map((pin) => (
            <div key={pin.id} className="flex items-center justify-between py-1">
              <span className="text-xs text-gray-300">{pin.name}</span>
              <span
                className="text-xs px-1 rounded"
                style={{ color: getPinColor(pin.dataType) }}
              >
                {pin.dataType}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ==================== MAIN MATERIAL EDITOR ====================

export const MaterialEditor: React.FC = () => {
  const [graph, setGraph] = useState<MaterialGraph>(() => createBasicLitMaterial())
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    nodeId: null,
    startPos: { x: 0, y: 0 },
    offset: { x: 0, y: 0 },
  })
  const [connectionDrag, setConnectionDrag] = useState<ConnectionDragState>({
    isDragging: false,
    sourceNodeId: null,
    sourcePinId: null,
    sourcePinType: null,
    mousePos: { x: 0, y: 0 },
  })
  const [viewOffset, setViewOffset] = useState<NodePosition>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [, forceUpdate] = useState({})

  const canvasRef = useRef<HTMLDivElement>(null)

  // Create node
  const handleCreateNode = useCallback((nodeType: string) => {
    const node = graph.createNode(nodeType)
    if (node) {
      node.position = {
        x: 200 + Math.random() * 200,
        y: 100 + Math.random() * 200,
      }
      forceUpdate({})
    }
  }, [graph])

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
    direction: PinDirection,
    dataType: MaterialDataType,
    e: React.MouseEvent
  ) => {
    if (direction === PinDirection.OUTPUT) {
      setConnectionDrag({
        isDragging: true,
        sourceNodeId: nodeId,
        sourcePinId: pinId,
        sourcePinType: dataType,
        mousePos: { x: e.clientX, y: e.clientY },
      })
    }
  }, [])

  // Pin drop
  const handlePinDrop = useCallback((targetNodeId: string, targetPinId: string) => {
    if (connectionDrag.isDragging && connectionDrag.sourceNodeId && connectionDrag.sourcePinId) {
      graph.connect(
        connectionDrag.sourceNodeId,
        connectionDrag.sourcePinId,
        targetNodeId,
        targetPinId
      )
      forceUpdate({})
    }
    setConnectionDrag({
      isDragging: false,
      sourceNodeId: null,
      sourcePinId: null,
      sourcePinType: null,
      mousePos: { x: 0, y: 0 },
    })
  }, [connectionDrag, graph])

  // Mouse move
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragState.isDragging && dragState.nodeId) {
      const node = graph.getNode(dragState.nodeId)
      if (node) {
        node.position = {
          x: dragState.offset.x + (e.clientX - dragState.startPos.x) / zoom,
          y: dragState.offset.y + (e.clientY - dragState.startPos.y) / zoom,
        }
        forceUpdate({})
      }
    }

    if (connectionDrag.isDragging) {
      setConnectionDrag(prev => ({
        ...prev,
        mousePos: { x: e.clientX, y: e.clientY },
      }))
    }
  }, [dragState, connectionDrag, graph, zoom])

  // Mouse up
  const handleMouseUp = useCallback(() => {
    setDragState({
      isDragging: false,
      nodeId: null,
      startPos: { x: 0, y: 0 },
      offset: { x: 0, y: 0 },
    })
    setConnectionDrag({
      isDragging: false,
      sourceNodeId: null,
      sourcePinId: null,
      sourcePinType: null,
      mousePos: { x: 0, y: 0 },
    })
  }, [])

  // Compile shader
  const handleCompile = useCallback(() => {
    const result = graph.compile()
    if (result.success) {
      console.log('Shader compiled successfully!')
      console.log('Vertex Shader:', result.vertexShader)
      console.log('Fragment Shader:', result.fragmentShader)
    } else {
      console.error('Compilation errors:', result.errors)
    }
  }, [graph])

  // Delete selected node
  const handleDeleteSelected = useCallback(() => {
    if (selectedNodeId) {
      graph.removeNode(selectedNodeId)
      setSelectedNodeId(null)
      forceUpdate({})
    }
  }, [selectedNodeId, graph])

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

  const selectedNode = selectedNodeId ? graph.getNode(selectedNodeId) || null : null

  // Calculate connection positions
  const getConnectionPath = (conn: MaterialConnection): { startX: number; startY: number; endX: number; endY: number; color: string } | null => {
    const sourceNode = graph.getNode(conn.sourceNodeId)
    const targetNode = graph.getNode(conn.targetNodeId)
    if (!sourceNode || !targetNode) return null

    const sourcePin = sourceNode.outputPins.find(p => p.id === conn.sourcePinId)
    const targetPin = targetNode.inputPins.find(p => p.id === conn.targetPinId)
    if (!sourcePin || !targetPin) return null

    const sourcePinIndex = sourceNode.outputPins.indexOf(sourcePin)
    const targetPinIndex = targetNode.inputPins.indexOf(targetPin)

    return {
      startX: sourceNode.position.x + 180,
      startY: sourceNode.position.y + 50 + sourcePinIndex * 24,
      endX: targetNode.position.x,
      endY: targetNode.position.y + 50 + targetPinIndex * 24,
      color: getPinColor(sourcePin.dataType),
    }
  }

  // Handle drop from palette
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const nodeType = e.dataTransfer.getData('nodeType')
    if (nodeType) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (rect) {
        const node = graph.createNode(nodeType)
        if (node) {
          node.position = {
            x: (e.clientX - rect.left) / zoom,
            y: (e.clientY - rect.top) / zoom,
          }
          forceUpdate({})
        }
      }
    }
  }, [graph, zoom])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  return (
    <div className="flex h-full bg-gray-900">
      {/* Node Palette */}
      <NodePalette onCreateNode={handleCreateNode} />

      {/* Canvas */}
      <div
        ref={canvasRef}
        className="flex-1 relative overflow-hidden"
        style={{
          backgroundImage: 'radial-gradient(circle, #374151 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={() => setSelectedNodeId(null)}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        {/* Toolbar */}
        <div className="absolute top-2 left-2 z-50 flex gap-2">
          <button
            className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
            onClick={handleCompile}
          >
            Compile
          </button>
          <button
            className="px-3 py-1 bg-gray-700 text-white text-sm rounded hover:bg-gray-600"
            onClick={() => {
              setGraph(createBasicLitMaterial())
              setSelectedNodeId(null)
            }}
          >
            New
          </button>
          <span className="px-2 py-1 bg-gray-800 text-gray-400 text-sm rounded">
            {graph.name}
          </span>
        </div>

        {/* Connections SVG */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          {/* Existing connections */}
          {graph.connections.map((conn) => {
            const pathData = getConnectionPath(conn)
            if (!pathData) return null
            return (
              <ConnectionLine
                key={conn.id}
                startX={pathData.startX}
                startY={pathData.startY}
                endX={pathData.endX}
                endY={pathData.endY}
                color={pathData.color}
              />
            )
          })}

          {/* Dragging connection */}
          {connectionDrag.isDragging && connectionDrag.sourceNodeId && (
            <ConnectionLine
              startX={
                (graph.getNode(connectionDrag.sourceNodeId)?.position.x || 0) + 180
              }
              startY={
                (graph.getNode(connectionDrag.sourceNodeId)?.position.y || 0) + 50
              }
              endX={connectionDrag.mousePos.x - (canvasRef.current?.getBoundingClientRect().left || 0)}
              endY={connectionDrag.mousePos.y - (canvasRef.current?.getBoundingClientRect().top || 0)}
              color={connectionDrag.sourcePinType ? getPinColor(connectionDrag.sourcePinType) : '#718096'}
              isTemp
            />
          )}
        </svg>

        {/* Nodes */}
        {Array.from(graph.nodes.values()).map((node) => (
          <MaterialNodeComponent
            key={node.id}
            node={node}
            isSelected={node.id === selectedNodeId}
            onSelect={setSelectedNodeId}
            onDragStart={handleNodeDragStart}
            onPinDragStart={handlePinDragStart}
            onPinDrop={handlePinDrop}
          />
        ))}

        {/* Info overlay */}
        <div className="absolute bottom-2 left-2 text-xs text-gray-600">
          Nodes: {graph.nodes.size} | Connections: {graph.connections.length}
        </div>
      </div>

      {/* Properties Panel */}
      <PropertiesPanel
        selectedNode={selectedNode}
        graph={graph}
        onUpdate={() => forceUpdate({})}
      />
    </div>
  )
}

export default MaterialEditor
