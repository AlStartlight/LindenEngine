/**
 * Animator Editor Panel - Animation State Machine Editor UI (Unity style)
 */

import React, { useState, useRef, useCallback, useEffect } from 'react'
import {
  AnimatorController,
  AnimationState,
  StateTransition,
  AnimatorParameter,
  ParameterType,
  BlendTree,
  BlendTreeType,
  MotionType,
  createLocomotionController,
} from '../../engine/animation'

// ==================== TYPES ====================

interface NodePosition {
  x: number
  y: number
}

interface DragState {
  isDragging: boolean
  stateId: string | null
  startPos: NodePosition
  offset: NodePosition
}

interface TransitionDragState {
  isDragging: boolean
  sourceStateId: string | null
  mousePos: NodePosition
}

// ==================== CONSTANTS ====================

const STATE_WIDTH = 160
const STATE_HEIGHT = 50

// ==================== COLOR UTILS ====================

const getStateColor = (state: AnimationState, entryStateId: string | null): string => {
  if (state.id === entryStateId) {
    return '#ed8936' // Orange for entry state
  }
  if (state.blendTreeId) {
    return '#9f7aea' // Purple for blend trees
  }
  return '#4299e1' // Blue for normal states
}

// ==================== STATE NODE ====================

interface StateNodeProps {
  state: AnimationState
  isEntry: boolean
  isSelected: boolean
  transitions: StateTransition[]
  onSelect: () => void
  onDragStart: (e: React.MouseEvent) => void
  onTransitionDragStart: (e: React.MouseEvent) => void
  onTransitionDrop: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}

const StateNode: React.FC<StateNodeProps> = ({
  state,
  isEntry,
  isSelected,
  transitions,
  onSelect,
  onDragStart,
  onTransitionDragStart,
  onTransitionDrop,
  onContextMenu,
}) => {
  const color = getStateColor(state, isEntry ? state.id : null)

  return (
    <div
      className={`absolute rounded-lg shadow-lg select-none cursor-pointer ${
        isSelected ? 'ring-2 ring-yellow-400' : ''
      }`}
      style={{
        left: state.position.x,
        top: state.position.y,
        width: STATE_WIDTH,
        height: STATE_HEIGHT,
        backgroundColor: color,
      }}
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
      }}
      onContextMenu={(e) => {
        e.stopPropagation()
        e.preventDefault()
        onContextMenu?.(e)
      }}
      onMouseUp={onTransitionDrop}
    >
      {/* Header */}
      <div
        className="px-3 py-1.5 cursor-move flex items-center justify-between"
        onMouseDown={onDragStart}
      >
        <span className="text-white text-sm font-medium truncate">
          {state.name}
        </span>
        {isEntry && (
          <span className="text-xs bg-orange-700 px-1 rounded">Entry</span>
        )}
        {state.blendTreeId && (
          <span className="text-xs bg-purple-700 px-1 rounded">BT</span>
        )}
      </div>

      {/* Info */}
      <div className="px-3 pb-1.5 text-xs text-white text-opacity-70">
        {state.clipId || (state.blendTreeId ? 'Blend Tree' : 'No Motion')}
      </div>

      {/* Transition drag handle */}
      <div
        className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full cursor-crosshair hover:bg-yellow-300 transition-colors"
        title="Drag to create transition"
        onMouseDown={(e) => {
          e.stopPropagation()
          onTransitionDragStart(e)
        }}
      />

      {/* Entry indicator */}
      {isEntry && (
        <div className="absolute -left-8 top-1/2 -translate-y-1/2">
          <div className="w-6 h-0.5 bg-orange-400" />
          <div className="absolute right-0 -top-1 border-4 border-transparent border-l-orange-400" />
        </div>
      )}
    </div>
  )
}

// ==================== TRANSITION LINE ====================

interface TransitionLineProps {
  from: AnimationState
  to: AnimationState
  isSelected: boolean
  onClick: () => void
}

const TransitionLine: React.FC<TransitionLineProps> = ({
  from,
  to,
  isSelected,
  onClick,
}) => {
  const startX = from.position.x + STATE_WIDTH
  const startY = from.position.y + STATE_HEIGHT / 2
  const endX = to.position.x
  const endY = to.position.y + STATE_HEIGHT / 2

  // Calculate control points for bezier curve
  const dx = endX - startX
  const controlOffset = Math.min(Math.abs(dx) * 0.5, 80)

  const midX = (startX + endX) / 2
  const midY = (startY + endY) / 2

  const path = `M ${startX} ${startY} 
                C ${startX + controlOffset} ${startY}, 
                  ${endX - controlOffset} ${endY}, 
                  ${endX} ${endY}`

  // Arrow head
  const angle = Math.atan2(endY - (endY - (endY - startY) * 0.25), endX - (endX - controlOffset))
  const arrowLength = 10
  const arrowAngle = Math.PI / 6

  return (
    <g className="cursor-pointer" onClick={onClick}>
      {/* Shadow */}
      <path
        d={path}
        stroke="black"
        strokeWidth={4}
        fill="none"
        opacity={0.2}
      />
      {/* Main line */}
      <path
        d={path}
        stroke={isSelected ? '#f6e05e' : '#ffffff'}
        strokeWidth={isSelected ? 3 : 2}
        fill="none"
      />
      {/* Arrow head */}
      <polygon
        points={`
          ${endX},${endY}
          ${endX - arrowLength * Math.cos(angle - arrowAngle)},${endY - arrowLength * Math.sin(angle - arrowAngle)}
          ${endX - arrowLength * Math.cos(angle + arrowAngle)},${endY - arrowLength * Math.sin(angle + arrowAngle)}
        `}
        fill={isSelected ? '#f6e05e' : '#ffffff'}
      />
      {/* Clickable area */}
      <path
        d={path}
        stroke="transparent"
        strokeWidth={12}
        fill="none"
      />
    </g>
  )
}

// ==================== PARAMETER PANEL ====================

interface ParameterPanelProps {
  parameters: AnimatorParameter[]
  onAddParameter: (name: string, type: ParameterType) => void
  onUpdateParameter: (name: string, value: any) => void
  onDeleteParameter: (name: string) => void
}

const ParameterPanel: React.FC<ParameterPanelProps> = ({
  parameters,
  onAddParameter,
  onUpdateParameter,
  onDeleteParameter,
}) => {
  const [newParamName, setNewParamName] = useState('')
  const [newParamType, setNewParamType] = useState<ParameterType>(ParameterType.FLOAT)

  return (
    <div className="w-56 bg-gray-900 border-r border-gray-700 flex flex-col">
      <div className="p-2 text-sm font-medium text-gray-300 border-b border-gray-700">
        Parameters
      </div>

      {/* Parameter list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {parameters.map((param) => (
          <div
            key={param.name}
            className="flex items-center gap-2 p-2 bg-gray-800 rounded hover:bg-gray-750"
          >
            {/* Type indicator */}
            <div className={`w-2 h-2 rounded-full ${
              param.type === ParameterType.FLOAT ? 'bg-green-400' :
              param.type === ParameterType.INT ? 'bg-blue-400' :
              param.type === ParameterType.BOOL ? 'bg-red-400' :
              'bg-yellow-400'
            }`} />

            {/* Name */}
            <span className="flex-1 text-sm text-gray-300 truncate">{param.name}</span>

            {/* Value input */}
            {param.type === ParameterType.BOOL ? (
              <input
                type="checkbox"
                checked={param.defaultValue as boolean}
                onChange={(e) => onUpdateParameter(param.name, e.target.checked)}
                className="w-4 h-4"
              />
            ) : param.type === ParameterType.TRIGGER ? (
              <button
                className="px-2 py-0.5 text-xs bg-yellow-600 text-white rounded hover:bg-yellow-500"
                onClick={() => onUpdateParameter(param.name, true)}
              >
                Trigger
              </button>
            ) : (
              <input
                type="number"
                value={param.defaultValue as number}
                onChange={(e) => onUpdateParameter(param.name, Number(e.target.value))}
                className="w-16 bg-gray-700 text-gray-300 text-xs px-2 py-1 rounded"
                step={param.type === ParameterType.FLOAT ? 0.1 : 1}
              />
            )}

            {/* Delete */}
            <button
              className="text-xs text-red-400 hover:text-red-300"
              onClick={() => onDeleteParameter(param.name)}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Add parameter */}
      <div className="p-2 border-t border-gray-700 space-y-2">
        <input
          type="text"
          placeholder="Parameter name"
          value={newParamName}
          onChange={(e) => setNewParamName(e.target.value)}
          className="w-full bg-gray-800 text-gray-300 text-xs px-2 py-1.5 rounded"
        />
        <div className="flex gap-2">
          <select
            value={newParamType}
            onChange={(e) => setNewParamType(e.target.value as ParameterType)}
            className="flex-1 bg-gray-800 text-gray-300 text-xs px-2 py-1.5 rounded"
          >
            <option value={ParameterType.FLOAT}>Float</option>
            <option value={ParameterType.INT}>Int</option>
            <option value={ParameterType.BOOL}>Bool</option>
            <option value={ParameterType.TRIGGER}>Trigger</option>
          </select>
          <button
            className="px-3 py-1.5 bg-green-700 text-white text-xs rounded hover:bg-green-600"
            onClick={() => {
              if (newParamName) {
                onAddParameter(newParamName, newParamType)
                setNewParamName('')
              }
            }}
          >
            +
          </button>
        </div>
      </div>
    </div>
  )
}

// ==================== INSPECTOR PANEL ====================

interface InspectorPanelProps {
  selectedState: AnimationState | null
  selectedTransition: StateTransition | null
  parameters: AnimatorParameter[]
  onUpdateState: () => void
  onUpdateTransition: () => void
}

const InspectorPanel: React.FC<InspectorPanelProps> = ({
  selectedState,
  selectedTransition,
  parameters,
  onUpdateState,
  onUpdateTransition,
}) => {
  if (selectedTransition) {
    return (
      <div className="w-64 bg-gray-900 border-l border-gray-700 p-4 overflow-y-auto">
        <div className="text-sm font-medium text-white mb-4">Transition</div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-400">Duration</label>
            <input
              type="number"
              value={selectedTransition.transitionDuration}
              onChange={(e) => {
                selectedTransition.transitionDuration = Number(e.target.value)
                onUpdateTransition()
              }}
              step={0.1}
              className="w-full mt-1 bg-gray-800 text-gray-300 text-sm px-2 py-1.5 rounded"
            />
          </div>

          <div>
            <label className="text-xs text-gray-400">Offset</label>
            <input
              type="number"
              value={selectedTransition.transitionOffset}
              onChange={(e) => {
                selectedTransition.transitionOffset = Number(e.target.value)
                onUpdateTransition()
              }}
              step={0.1}
              className="w-full mt-1 bg-gray-800 text-gray-300 text-sm px-2 py-1.5 rounded"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={selectedTransition.hasExitTime}
              onChange={(e) => {
                selectedTransition.hasExitTime = e.target.checked
                onUpdateTransition()
              }}
            />
            <label className="text-xs text-gray-400">Has Exit Time</label>
          </div>

          {selectedTransition.hasExitTime && (
            <div>
              <label className="text-xs text-gray-400">Exit Time</label>
              <input
                type="number"
                value={selectedTransition.exitTime}
                onChange={(e) => {
                  selectedTransition.exitTime = Number(e.target.value)
                  onUpdateTransition()
                }}
                step={0.1}
                className="w-full mt-1 bg-gray-800 text-gray-300 text-sm px-2 py-1.5 rounded"
              />
            </div>
          )}

          <div>
            <label className="text-xs text-gray-400 mb-2 block">Conditions</label>
            {selectedTransition.conditions.map((cond, i) => (
              <div key={i} className="flex gap-1 mb-1 text-xs">
                <span className="text-gray-300">{cond.parameterId}</span>
                <span className="text-gray-500">{cond.mode}</span>
                <span className="text-green-400">{cond.threshold}</span>
              </div>
            ))}
            {selectedTransition.conditions.length === 0 && (
              <span className="text-xs text-gray-500">No conditions</span>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (selectedState) {
    return (
      <div className="w-64 bg-gray-900 border-l border-gray-700 p-4 overflow-y-auto">
        <div className="text-sm font-medium text-white mb-4">{selectedState.name}</div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-400">Clip ID</label>
            <input
              type="text"
              value={selectedState.clipId || ''}
              onChange={(e) => {
                selectedState.clipId = e.target.value
                onUpdateState()
              }}
              placeholder="Animation clip ID"
              className="w-full mt-1 bg-gray-800 text-gray-300 text-sm px-2 py-1.5 rounded"
            />
          </div>

          <div>
            <label className="text-xs text-gray-400">Speed</label>
            <input
              type="number"
              value={selectedState.speed}
              onChange={(e) => {
                selectedState.speed = Number(e.target.value)
                onUpdateState()
              }}
              step={0.1}
              className="w-full mt-1 bg-gray-800 text-gray-300 text-sm px-2 py-1.5 rounded"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={selectedState.mirror}
              onChange={(e) => {
                selectedState.mirror = e.target.checked
                onUpdateState()
              }}
            />
            <label className="text-xs text-gray-400">Mirror</label>
          </div>

          {selectedState.blendTreeId && (
            <div className="p-2 bg-purple-900 bg-opacity-30 rounded">
              <div className="text-xs text-purple-300 font-medium mb-1">Blend Tree</div>
              <div className="text-xs text-gray-400">
                ID: {selectedState.blendTreeId}
              </div>
            </div>
          )}

          <div>
            <label className="text-xs text-gray-400">Position</label>
            <div className="flex gap-2 mt-1">
              <input
                type="number"
                value={Math.round(selectedState.position.x)}
                onChange={(e) => {
                  selectedState.position.x = Number(e.target.value)
                  onUpdateState()
                }}
                className="w-20 bg-gray-800 text-gray-300 text-xs px-2 py-1 rounded"
              />
              <input
                type="number"
                value={Math.round(selectedState.position.y)}
                onChange={(e) => {
                  selectedState.position.y = Number(e.target.value)
                  onUpdateState()
                }}
                className="w-20 bg-gray-800 text-gray-300 text-xs px-2 py-1 rounded"
              />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-64 bg-gray-900 border-l border-gray-700 p-4">
      <div className="text-gray-500 text-sm">No selection</div>
      <div className="mt-4 text-xs text-gray-600">
        <p>Click a state or transition to edit</p>
        <p className="mt-2">Right-click to add states</p>
        <p className="mt-2">Drag from circle to create transition</p>
      </div>
    </div>
  )
}

// ==================== MAIN ANIMATOR EDITOR ====================

export const AnimatorEditor: React.FC = () => {
  // Create sample controller
  const [controller] = useState(() => createLocomotionController())

  const [selectedLayer, setSelectedLayer] = useState(0)
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null)
  const [selectedTransitionId, setSelectedTransitionId] = useState<string | null>(null)

  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    stateId: null,
    startPos: { x: 0, y: 0 },
    offset: { x: 0, y: 0 },
  })

  const [transitionDrag, setTransitionDrag] = useState<TransitionDragState>({
    isDragging: false,
    sourceStateId: null,
    mousePos: { x: 0, y: 0 },
  })

  const [, forceUpdate] = useState({})
  const canvasRef = useRef<HTMLDivElement>(null)

  const currentLayer = controller.layers[selectedLayer]
  const states = currentLayer?.states || []
  // Collect all transitions from all states
  const transitions: StateTransition[] = states.flatMap(s => s.transitions)

  // Find selected objects
  const selectedState = selectedStateId
    ? states.find(s => s.id === selectedStateId) || null
    : null
  const selectedTransition = selectedTransitionId
    ? transitions.find(t => t.id === selectedTransitionId) || null
    : null

  // State drag
  const handleStateDragStart = useCallback((stateId: string, e: React.MouseEvent) => {
    const state = states.find(s => s.id === stateId)
    if (!state) return

    setDragState({
      isDragging: true,
      stateId,
      startPos: { x: e.clientX, y: e.clientY },
      offset: { x: state.position.x, y: state.position.y },
    })
  }, [states])

  // Transition drag start
  const handleTransitionDragStart = useCallback((stateId: string, e: React.MouseEvent) => {
    setTransitionDrag({
      isDragging: true,
      sourceStateId: stateId,
      mousePos: { x: e.clientX, y: e.clientY },
    })
  }, [])

  // Transition drop
  const handleTransitionDrop = useCallback((targetStateId: string) => {
    if (transitionDrag.isDragging && transitionDrag.sourceStateId && transitionDrag.sourceStateId !== targetStateId && currentLayer) {
      controller.addTransition(currentLayer.id, transitionDrag.sourceStateId, targetStateId)
      forceUpdate({})
    }
    setTransitionDrag({
      isDragging: false,
      sourceStateId: null,
      mousePos: { x: 0, y: 0 },
    })
  }, [transitionDrag, currentLayer, controller])

  // Mouse move
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragState.isDragging && dragState.stateId) {
      const state = states.find(s => s.id === dragState.stateId)
      if (state) {
        state.position = {
          x: dragState.offset.x + (e.clientX - dragState.startPos.x),
          y: dragState.offset.y + (e.clientY - dragState.startPos.y),
        }
        forceUpdate({})
      }
    }

    if (transitionDrag.isDragging) {
      setTransitionDrag(prev => ({
        ...prev,
        mousePos: { x: e.clientX, y: e.clientY },
      }))
    }
  }, [dragState, transitionDrag, states])

  // Mouse up
  const handleMouseUp = useCallback(() => {
    setDragState({
      isDragging: false,
      stateId: null,
      startPos: { x: 0, y: 0 },
      offset: { x: 0, y: 0 },
    })
    setTransitionDrag({
      isDragging: false,
      sourceStateId: null,
      mousePos: { x: 0, y: 0 },
    })
  }, [])

  // Add state
  const handleAddState = useCallback((name: string) => {
    if (currentLayer) {
      const state = controller.addState(currentLayer.id, name)
      if (state) {
        state.position = {
          x: 200 + Math.random() * 200,
          y: 100 + Math.random() * 200,
        }
      }
      forceUpdate({})
    }
  }, [currentLayer, controller])

  // Delete selected
  const handleDeleteSelected = useCallback(() => {
    if (selectedStateId && currentLayer) {
      controller.removeState(currentLayer.id, selectedStateId)
      setSelectedStateId(null)
    }
    if (selectedTransitionId && currentLayer) {
      // Find the state that owns this transition and remove it
      for (const state of currentLayer.states) {
        const idx = state.transitions.findIndex(t => t.id === selectedTransitionId)
        if (idx !== -1) {
          state.transitions.splice(idx, 1)
          break
        }
      }
      setSelectedTransitionId(null)
    }
    forceUpdate({})
  }, [selectedStateId, selectedTransitionId, currentLayer, controller])

  // Parameter handlers
  const handleAddParameter = useCallback((name: string, type: ParameterType) => {
    controller.addParameter(name, type)
    forceUpdate({})
  }, [controller])

  const handleUpdateParameter = useCallback((name: string, value: any) => {
    const param = controller.parameters.find(p => p.name === name)
    if (param) {
      param.defaultValue = value
      forceUpdate({})
    }
  }, [controller])

  const handleDeleteParameter = useCallback((name: string) => {
    controller.parameters = controller.parameters.filter(p => p.name !== name)
    forceUpdate({})
  }, [controller])

  // Set as entry state
  const handleSetEntryState = useCallback((stateId: string) => {
    if (currentLayer) {
      currentLayer.defaultStateId = stateId
      forceUpdate({})
    }
  }, [currentLayer])

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; stateId?: string } | null>(null)

  // Context menu
  const handleContextMenu = useCallback((e: React.MouseEvent, stateId?: string) => {
    e.preventDefault()
    const rect = canvasRef.current?.getBoundingClientRect()
    if (rect) {
      setContextMenu({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        stateId,
      })
    }
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        handleDeleteSelected()
      }
      if (e.key === 'Escape') {
        setContextMenu(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleDeleteSelected])

  return (
    <div className="flex h-full bg-gray-900">
      {/* Parameters Panel */}
      <ParameterPanel
        parameters={controller.parameters}
        onAddParameter={handleAddParameter}
        onUpdateParameter={handleUpdateParameter}
        onDeleteParameter={handleDeleteParameter}
      />

      {/* Main Canvas */}
      <div className="flex-1 flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 bg-gray-800 border-b border-gray-700">
          <span className="text-sm text-gray-300">{controller.name}</span>
          <div className="w-px h-4 bg-gray-600 mx-2" />

          {/* Layer tabs */}
          {controller.layers.map((layer, i) => (
            <button
              key={layer.name}
              className={`px-3 py-1 text-xs rounded ${
                selectedLayer === i
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              }`}
              onClick={() => setSelectedLayer(i)}
            >
              {layer.name}
            </button>
          ))}

          <button
            className="px-3 py-1 text-xs bg-gray-700 text-gray-400 rounded hover:bg-gray-600"
            onClick={() => {
              const name = prompt('Layer name:')
              if (name) {
                controller.addLayer(name)
                forceUpdate({})
              }
            }}
          >
            + Layer
          </button>

          <div className="flex-1" />

          <button
            className="px-3 py-1 text-xs bg-red-700 text-white rounded hover:bg-red-600 disabled:opacity-50"
            onClick={handleDeleteSelected}
            disabled={!selectedStateId && !selectedTransitionId}
          >
            Delete Selected
          </button>

          <button
            className="px-3 py-1 text-xs bg-green-700 text-white rounded hover:bg-green-600"
            onClick={() => handleAddState(`State_${states.length + 1}`)}
          >
            + State
          </button>
        </div>

        {/* Canvas */}
        <div
          ref={canvasRef}
          className="flex-1 relative overflow-hidden"
          style={{
            backgroundImage: `
              radial-gradient(circle, #374151 1.5px, transparent 1.5px)
            `,
            backgroundSize: '30px 30px',
            backgroundColor: '#1f2937',
          }}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onContextMenu={(e) => handleContextMenu(e)}
          onClick={() => {
            setSelectedStateId(null)
            setSelectedTransitionId(null)
            setContextMenu(null)
          }}
        >
          {/* Transitions SVG */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            {/* Existing transitions */}
            {transitions.map((trans: StateTransition) => {
              const from = states.find(s => s.id === trans.sourceStateId)
              const to = states.find(s => s.id === trans.destinationStateId)
              if (!from || !to) return null
              return (
                <TransitionLine
                  key={trans.id}
                  from={from}
                  to={to}
                  isSelected={selectedTransitionId === trans.id}
                  onClick={() => {
                    setSelectedTransitionId(trans.id)
                    setSelectedStateId(null)
                  }}
                />
              )
            })}

            {/* Dragging transition */}
            {transitionDrag.isDragging && transitionDrag.sourceStateId && (
              <line
                x1={(states.find(s => s.id === transitionDrag.sourceStateId)?.position.x || 0) + STATE_WIDTH}
                y1={(states.find(s => s.id === transitionDrag.sourceStateId)?.position.y || 0) + STATE_HEIGHT / 2}
                x2={transitionDrag.mousePos.x - (canvasRef.current?.getBoundingClientRect().left || 0)}
                y2={transitionDrag.mousePos.y - (canvasRef.current?.getBoundingClientRect().top || 0)}
                stroke="#f6e05e"
                strokeWidth={2}
                strokeDasharray="5,5"
              />
            )}
          </svg>

          {/* States */}
          {states.map((state) => (
            <StateNode
              key={state.id}
              state={state}
              isEntry={currentLayer?.defaultStateId === state.id}
              isSelected={selectedStateId === state.id}
              transitions={transitions.filter((t: StateTransition) => t.sourceStateId === state.id)}
              onSelect={() => {
                setSelectedStateId(state.id)
                setSelectedTransitionId(null)
                setContextMenu(null)
              }}
              onDragStart={(e) => handleStateDragStart(state.id, e)}
              onTransitionDragStart={(e) => handleTransitionDragStart(state.id, e)}
              onTransitionDrop={() => handleTransitionDrop(state.id)}
              onContextMenu={(e) => handleContextMenu(e, state.id)}
            />
          ))}

          {/* Context Menu */}
          {contextMenu && (
            <div
              className="absolute bg-gray-800 rounded-lg shadow-xl border border-gray-600 py-1 z-50 min-w-[160px]"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={(e) => e.stopPropagation()}
            >
              {contextMenu.stateId ? (
                <>
                  <button
                    className="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700"
                    onClick={() => {
                      handleSetEntryState(contextMenu.stateId!)
                      setContextMenu(null)
                    }}
                  >
                    Set as Entry State
                  </button>
                  <button
                    className="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700"
                    onClick={() => {
                      setSelectedStateId(contextMenu.stateId!)
                      setContextMenu(null)
                    }}
                  >
                    Edit State
                  </button>
                  <hr className="border-gray-600 my-1" />
                  <button
                    className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-gray-700"
                    onClick={() => {
                      if (currentLayer) {
                        controller.removeState(currentLayer.id, contextMenu.stateId!)
                        forceUpdate({})
                      }
                      setContextMenu(null)
                    }}
                  >
                    Delete State
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700"
                    onClick={() => {
                      const name = prompt('Enter state name:')
                      if (name && currentLayer) {
                        const state = controller.addState(currentLayer.id, name)
                        if (state) {
                          state.position = { x: contextMenu.x, y: contextMenu.y }
                          forceUpdate({})
                        }
                      }
                      setContextMenu(null)
                    }}
                  >
                    Add State
                  </button>
                  <button
                    className="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700"
                    onClick={() => {
                      const name = prompt('Enter blend tree state name:')
                      if (name && currentLayer) {
                        const state = controller.addState(currentLayer.id, name)
                        if (state) {
                          state.position = { x: contextMenu.x, y: contextMenu.y }
                          // Create a blend tree and link it
                          const blendTree = controller.createBlendTree(name + '_BlendTree', BlendTreeType.SIMPLE_1D, 'Speed')
                          state.blendTreeId = blendTree.id
                          state.motionType = MotionType.BLEND_TREE
                          forceUpdate({})
                        }
                      }
                      setContextMenu(null)
                    }}
                  >
                    Add Blend Tree State
                  </button>
                </>
              )}
            </div>
          )}

          {/* Legend */}
          <div className="absolute bottom-3 left-3 bg-gray-800 bg-opacity-90 p-3 rounded-lg text-xs space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-orange-500" />
              <span className="text-gray-400">Entry State</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-blue-500" />
              <span className="text-gray-400">Normal State</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-purple-500" />
              <span className="text-gray-400">Blend Tree</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-teal-500" />
              <span className="text-gray-400">Any State</span>
            </div>
          </div>

          {/* Info */}
          <div className="absolute bottom-3 right-3 bg-gray-800 bg-opacity-90 px-3 py-2 rounded-lg text-xs text-gray-500">
            States: {states.length} • Transitions: {transitions.length}
          </div>
        </div>
      </div>

      {/* Inspector Panel */}
      <InspectorPanel
        selectedState={selectedState}
        selectedTransition={selectedTransition}
        parameters={controller.parameters}
        onUpdateState={() => forceUpdate({})}
        onUpdateTransition={() => forceUpdate({})}
      />
    </div>
  )
}

export default AnimatorEditor
