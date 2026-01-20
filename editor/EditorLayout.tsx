import React, { useState, useEffect, useCallback } from 'react'
import * as THREE from 'three'
import { SceneViewport } from './viewport/SceneViewport'
import { HierarchyPanel } from './panels/HierarchyPanel'
import { InspectorPanel } from './panels/InspectorPanel'
import { AssetBrowser } from './panels/AssetBrowser'
import { Toolbar } from './ui/Toolbar'
import { ConsolePanel } from './panels/ConsolePanel'
import { BlueprintEditor } from './panels/BlueprintEditor'
import { MaterialEditor } from './panels/MaterialEditor'
import { AnimatorEditor } from './panels/AnimatorEditor'
import { SequencerEditor } from './panels/SequencerEditor'

type EditorPanel = 'viewport' | 'blueprint' | 'material' | 'animator' | 'sequencer'

interface SelectedObjectInfo {
  id: string
  name: string
  type: string
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number }
  scale: { x: number; y: number; z: number }
}

export const EditorLayout: React.FC = () => {
  const [selectedObject, setSelectedObject] = useState<SelectedObjectInfo | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [showConsole, setShowConsole] = useState(true)
  const [showAssetBrowser, setShowAssetBrowser] = useState(true)
  const [consoleMessages, setConsoleMessages] = useState<Array<{ type: string; message: string; time: Date }>>([])
  const [activePanel, setActivePanel] = useState<EditorPanel>('viewport')
  // Handle object selection from viewport
  const handleSelectObject = useCallback((object: THREE.Object3D | null) => {
    if (object) {
      const euler = new THREE.Euler().setFromQuaternion(object.quaternion)
      setSelectedObject({
        id: object.userData.id || object.uuid,
        name: object.userData.name || object.name || 'Object',
        type: object.userData.type || object.type,
        position: {
          x: parseFloat(object.position.x.toFixed(3)),
          y: parseFloat(object.position.y.toFixed(3)),
          z: parseFloat(object.position.z.toFixed(3)),
        },
        rotation: {
          x: parseFloat(THREE.MathUtils.radToDeg(euler.x).toFixed(1)),
          y: parseFloat(THREE.MathUtils.radToDeg(euler.y).toFixed(1)),
          z: parseFloat(THREE.MathUtils.radToDeg(euler.z).toFixed(1)),
        },
        scale: {
          x: parseFloat(object.scale.x.toFixed(3)),
          y: parseFloat(object.scale.y.toFixed(3)),
          z: parseFloat(object.scale.z.toFixed(3)),
        },
      })
      
      addConsoleMessage('info', `Selected: ${object.userData.name || object.name || 'Object'}`)
    } else {
      setSelectedObject(null)
    }
  }, [])

  const addConsoleMessage = (type: string, message: string) => {
    setConsoleMessages(prev => [...prev.slice(-99), { type, message, time: new Date() }])
  }

  const handlePlay = () => {
    setIsPlaying(!isPlaying)
    addConsoleMessage('info', isPlaying ? 'Stopped play mode' : 'Started play mode')
  }

  const handleStop = () => {
    setIsPlaying(false)
    addConsoleMessage('info', 'Stopped')
  }

  const handlePause = () => {
    addConsoleMessage('info', 'Paused')
  }

  // Log initialization
  useEffect(() => {
    addConsoleMessage('info', 'Linden Engine Editor initialized')
    addConsoleMessage('info', 'Three.js renderer ready')
    addConsoleMessage('info', 'Use W/E/R keys to switch transform modes')
  }, [])

  return (
    <div className="flex flex-col h-screen bg-[#1a1a2e] text-white overflow-hidden">
      {/* Toolbar */}
      <Toolbar
        isPlaying={isPlaying}
        onPlay={handlePlay}
        onStop={handleStop}
        onPause={handlePause}
        onOpenBlueprintEditor={() => setActivePanel('blueprint')}
        onOpenMaterialEditor={() => setActivePanel('material')}
        onOpenAnimatorEditor={() => setActivePanel('animator')}
        onOpenSequencerEditor={() => setActivePanel('sequencer')}
      />

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel - Hierarchy */}
        <div className="w-64 border-r border-gray-700/50 bg-[#16213e] flex flex-col">
          <div className="p-2 border-b border-gray-700/50 bg-[#0f3460]">
            <h2 className="text-sm font-semibold text-gray-200">Hierarchy</h2>
          </div>
          <div className="flex-1 overflow-auto p-2">
            <HierarchyPanel
              selectedObjectId={selectedObject?.id || null}
              onSelectObject={(id) => {
                addConsoleMessage('info', `Selected object ID: ${id}`)
              }}
            />
          </div>
        </div>

        {/* Center - Viewport & Asset Browser */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Main Viewport or Editor Panel */}
          <div className="flex-1 relative">
            {/* Panel Tabs */}
            <div className="absolute top-0 left-0 right-0 z-10 flex bg-[#0f3460] border-b border-gray-700/50">
              <button
                onClick={() => setActivePanel('viewport')}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activePanel === 'viewport'
                    ? 'bg-[#16213e] text-white border-t-2 border-blue-500'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                🎮 Scene
              </button>
              <button
                onClick={() => setActivePanel('blueprint')}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activePanel === 'blueprint'
                    ? 'bg-[#16213e] text-white border-t-2 border-cyan-500'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                📝 Blueprint
              </button>
              <button
                onClick={() => setActivePanel('material')}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activePanel === 'material'
                    ? 'bg-[#16213e] text-white border-t-2 border-green-500'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                🎨 Material
              </button>
              <button
                onClick={() => setActivePanel('animator')}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activePanel === 'animator'
                    ? 'bg-[#16213e] text-white border-t-2 border-orange-500'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                🎬 Animator
              </button>
              <button
                onClick={() => setActivePanel('sequencer')}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activePanel === 'sequencer'
                    ? 'bg-[#16213e] text-white border-t-2 border-purple-500'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                🎥 Sequencer
              </button>
            </div>

            {/* Panel Content */}
            <div className="absolute inset-0 pt-10">
              {activePanel === 'viewport' && (
                <SceneViewport
                  onSelectObject={handleSelectObject}
                  selectedObjectId={selectedObject?.id}
                />
              )}
              {activePanel === 'blueprint' && <BlueprintEditor />}
              {activePanel === 'material' && <MaterialEditor />}
              {activePanel === 'animator' && <AnimatorEditor />}
              {activePanel === 'sequencer' && <SequencerEditor />}
            </div>
          </div>

          {/* Bottom - Asset Browser / Console */}
          {(showAssetBrowser || showConsole) && (
            <div className="h-56 border-t border-gray-700/50 bg-[#16213e] flex flex-col">
              {/* Tabs */}
              <div className="flex border-b border-gray-700/50 bg-[#0f3460]">
                <button
                  onClick={() => { setShowAssetBrowser(true); setShowConsole(false); }}
                  className={`px-4 py-2 text-sm font-medium ${
                    showAssetBrowser && !showConsole
                      ? 'bg-[#16213e] text-white border-t-2 border-blue-500'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Assets
                </button>
                <button
                  onClick={() => { setShowConsole(true); setShowAssetBrowser(false); }}
                  className={`px-4 py-2 text-sm font-medium ${
                    showConsole && !showAssetBrowser
                      ? 'bg-[#16213e] text-white border-t-2 border-blue-500'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Console
                </button>
                <button
                  onClick={() => { setShowAssetBrowser(true); setShowConsole(true); }}
                  className={`px-4 py-2 text-sm font-medium ${
                    showAssetBrowser && showConsole
                      ? 'bg-[#16213e] text-white border-t-2 border-blue-500'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Both
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => { setShowAssetBrowser(false); setShowConsole(false); }}
                  className="px-3 py-2 text-gray-400 hover:text-white"
                >
                  ✕
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 flex overflow-hidden">
                {showAssetBrowser && (
                  <div className={`${showConsole ? 'w-1/2 border-r border-gray-700/50' : 'flex-1'} overflow-auto`}>
                    <AssetBrowser />
                  </div>
                )}
                {showConsole && (
                  <div className={`${showAssetBrowser ? 'w-1/2' : 'flex-1'} overflow-auto`}>
                    <ConsolePanel messages={consoleMessages} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right panel - Inspector */}
        <div className="w-80 border-l border-gray-700/50 bg-[#16213e] flex flex-col">
          <div className="p-2 border-b border-gray-700/50 bg-[#0f3460]">
            <h2 className="text-sm font-semibold text-gray-200">Inspector</h2>
          </div>
          <div className="flex-1 overflow-auto">
            {selectedObject ? (
              <ObjectInspector 
                object={selectedObject} 
                onOpenBlueprintEditor={() => setActivePanel('blueprint')}
              />
            ) : (
              <div className="p-4 text-gray-500 text-sm text-center">
                Select an object to view its properties
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="h-7 border-t border-gray-700/50 bg-[#0f3460] px-4 flex items-center justify-between text-xs">
        <div className="flex items-center gap-4">
          <span className="text-green-400">● Ready</span>
          <span className="text-gray-400">
            {selectedObject ? `Selected: ${selectedObject.name}` : 'No selection'}
          </span>
        </div>
        <div className="flex items-center gap-4 text-gray-400">
          <span>Linden Engine v0.1.0</span>
        </div>
      </div>
    </div>
  )
}

// Object Inspector Component
interface ObjectInspectorProps {
  object: SelectedObjectInfo
  onOpenBlueprintEditor?: () => void
}

const ObjectInspector: React.FC<ObjectInspectorProps> = ({ object, onOpenBlueprintEditor }) => {
  const [showAddComponent, setShowAddComponent] = useState(false)
  const [components, setComponents] = useState<string[]>(['Transform'])

  const handleAddComponent = (componentName: string) => {
    if (!components.includes(componentName)) {
      setComponents([...components, componentName])
    }
    setShowAddComponent(false)
  }

  return (
    <div className="p-3 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 pb-2 border-b border-gray-700/50">
        <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center text-sm">
          {object.type === 'Mesh' ? '◼' : '○'}
        </div>
        <div>
          <div className="font-medium">{object.name}</div>
          <div className="text-xs text-gray-400">{object.type}</div>
        </div>
      </div>

      {/* Transform Section */}
      <div>
        <div className="text-xs font-semibold text-gray-400 uppercase mb-2">Transform</div>
        
        <div className="space-y-2">
          <VectorInput label="Position" value={object.position} color="blue" />
          <VectorInput label="Rotation" value={object.rotation} color="green" />
          <VectorInput label="Scale" value={object.scale} color="yellow" />
        </div>
      </div>

      {/* Blueprint Component Section */}
      {components.includes('Blueprint') && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold text-gray-400 uppercase">Blueprint</div>
            <button 
              className="text-xs text-red-400 hover:text-red-300"
              onClick={() => setComponents(components.filter(c => c !== 'Blueprint'))}
            >
              ✕
            </button>
          </div>
          <div className="bg-black/30 rounded p-2 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Graph:</span>
              <span className="text-cyan-400">PlayerController</span>
            </div>
            <button
              className="w-full px-3 py-1.5 bg-cyan-700 hover:bg-cyan-600 text-white text-xs rounded transition-colors"
              onClick={onOpenBlueprintEditor}
            >
              📝 Edit Blueprint
            </button>
          </div>
        </div>
      )}

      {/* Material Section */}
      <div>
        <div className="text-xs font-semibold text-gray-400 uppercase mb-2">Material</div>
        <div className="bg-black/30 rounded p-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">Type:</span>
            <span>Standard Material</span>
          </div>
        </div>
      </div>

      {/* Add Component Button */}
      <div className="relative">
        <button
          className="w-full px-3 py-2 bg-green-700 hover:bg-green-600 text-white text-sm rounded transition-colors"
          onClick={() => setShowAddComponent(!showAddComponent)}
        >
          + Add Component
        </button>
        
        {showAddComponent && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-[#16213e] border border-gray-700/50 rounded shadow-xl z-50">
            <button
              className="w-full px-3 py-2 text-left text-sm hover:bg-blue-600/50 flex items-center gap-2"
              onClick={() => handleAddComponent('Blueprint')}
            >
              <span className="text-cyan-400">📝</span> Blueprint
            </button>
            <button
              className="w-full px-3 py-2 text-left text-sm hover:bg-blue-600/50 flex items-center gap-2"
              onClick={() => handleAddComponent('MeshRenderer')}
            >
              <span className="text-green-400">🎨</span> Mesh Renderer
            </button>
            <button
              className="w-full px-3 py-2 text-left text-sm hover:bg-blue-600/50 flex items-center gap-2"
              onClick={() => handleAddComponent('Collider')}
            >
              <span className="text-yellow-400">📦</span> Collider
            </button>
            <button
              className="w-full px-3 py-2 text-left text-sm hover:bg-blue-600/50 flex items-center gap-2"
              onClick={() => handleAddComponent('Rigidbody')}
            >
              <span className="text-orange-400">⚙️</span> Rigidbody
            </button>
            <button
              className="w-full px-3 py-2 text-left text-sm hover:bg-blue-600/50 flex items-center gap-2"
              onClick={() => handleAddComponent('AudioSource')}
            >
              <span className="text-purple-400">🔊</span> Audio Source
            </button>
            <button
              className="w-full px-3 py-2 text-left text-sm hover:bg-blue-600/50 flex items-center gap-2"
              onClick={() => handleAddComponent('Animator')}
            >
              <span className="text-red-400">🎬</span> Animator
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// Vector Input Component
interface VectorInputProps {
  label: string
  value: { x: number; y: number; z: number }
  color: 'blue' | 'green' | 'yellow'
}

const VectorInput: React.FC<VectorInputProps> = ({ label, value, color }) => {
  const colors = {
    blue: 'text-blue-400',
    green: 'text-green-400',
    yellow: 'text-yellow-400',
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-16">{label}</span>
      <div className="flex-1 flex gap-1">
        <div className="flex-1 bg-black/30 rounded px-2 py-1 flex items-center">
          <span className={`text-xs mr-1 ${colors[color]}`}>X</span>
          <input
            type="number"
            value={value.x}
            className="w-full bg-transparent text-xs text-right outline-none"
            readOnly
          />
        </div>
        <div className="flex-1 bg-black/30 rounded px-2 py-1 flex items-center">
          <span className={`text-xs mr-1 ${colors[color]}`}>Y</span>
          <input
            type="number"
            value={value.y}
            className="w-full bg-transparent text-xs text-right outline-none"
            readOnly
          />
        </div>
        <div className="flex-1 bg-black/30 rounded px-2 py-1 flex items-center">
          <span className={`text-xs mr-1 ${colors[color]}`}>Z</span>
          <input
            type="number"
            value={value.z}
            className="w-full bg-transparent text-xs text-right outline-none"
            readOnly
          />
        </div>
      </div>
    </div>
  )
}

export default EditorLayout
