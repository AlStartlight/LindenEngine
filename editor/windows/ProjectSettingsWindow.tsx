import React, { useState } from 'react'
import { useEditorStore } from '../store/editorStore'

type TabType = 'tags_layers' | 'physics' | 'graphics' | 'time' | 'services'

export const ProjectSettingsWindow: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const {
    world,
    projectSettings,
    addProjectTag,
    removeProjectTag,
    setProjectLayers,
    setCollisionMatrixCell,
    saveGraphicsSettings,
  } = useEditorStore()

  const [activeTab, setActiveTab] = useState<TabType>('tags_layers')
  const [newTagInput, setNewTagInput] = useState('')
  const [fixedTimestep, setFixedTimestep] = useState('0.02')

  const handleDeleteTag = (tag: string) => {
    const count = world.findByTag(tag).length
    if (count > 0) {
      const proceed = window.confirm(
        `Tag "${tag}" is currently used by ${count} object(s). Remove it anyway?`
      )
      if (!proceed) return
    }
    removeProjectTag(tag)
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-6 select-none">
      <div className="bg-[#16213e] border border-gray-700/80 rounded-xl shadow-2xl w-full max-w-4xl h-[600px] flex flex-col overflow-hidden text-xs text-gray-200">
        {/* Title bar */}
        <div className="h-9 px-4 bg-[#0f172a] border-b border-gray-700/60 flex items-center justify-between">
          <span className="font-semibold text-gray-100 flex items-center gap-2">
            <span>⚙️</span> Project Settings
          </span>
          <button
            onClick={onClose}
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Body (2 columns: tabs on left, content on right) */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left tabs */}
          <div className="w-48 border-r border-gray-700/50 bg-[#121b33] p-2 space-y-1">
            <button
              onClick={() => setActiveTab('tags_layers')}
              className={`w-full text-left px-3 py-1.5 rounded transition-colors ${
                activeTab === 'tags_layers' ? 'bg-blue-600 text-white font-medium' : 'text-gray-400 hover:bg-white/5'
              }`}
            >
              Tags and Layers
            </button>
            <button
              onClick={() => setActiveTab('physics')}
              className={`w-full text-left px-3 py-1.5 rounded transition-colors ${
                activeTab === 'physics' ? 'bg-blue-600 text-white font-medium' : 'text-gray-400 hover:bg-white/5'
              }`}
            >
              Physics (Collision Matrix)
            </button>
            <button
              onClick={() => setActiveTab('graphics')}
              className={`w-full text-left px-3 py-2 rounded-md transition-colors ${
                activeTab === 'graphics' ? 'bg-blue-600 text-white font-medium' : 'text-gray-400 hover:bg-white/5'
              }`}
            >
              Graphics (Quality)
            </button>
            <button
              onClick={() => setActiveTab('time')}
              className={`w-full text-left px-3 py-1.5 rounded transition-colors ${
                activeTab === 'time' ? 'bg-blue-600 text-white font-medium' : 'text-gray-400 hover:bg-white/5'
              }`}
            >
              Time
            </button>
            <button
              onClick={() => setActiveTab('services')}
              className={`w-full text-left px-3 py-1.5 rounded transition-colors ${
                activeTab === 'services' ? 'bg-blue-600 text-white font-medium' : 'text-gray-400 hover:bg-white/5'
              }`}
            >
              Services (Autoload)
            </button>
          </div>

          {/* Right tab content */}
          <div className="flex-1 p-5 overflow-y-auto">
            {/* Tags & Layers */}
            {activeTab === 'tags_layers' && (
              <div className="space-y-6">
                {/* Tags section */}
                <div className="space-y-2">
                  <h3 className="font-semibold text-gray-300 text-sm">Tags</h3>
                  <div className="bg-[#121b33] border border-gray-700/50 rounded-lg p-3 space-y-2">
                    <div className="flex flex-wrap gap-2 mb-3">
                      {projectSettings.tags.map((tag) => (
                        <div
                          key={tag}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-900/60 border border-blue-500/40 text-blue-200"
                        >
                          <span>{tag}</span>
                          <button
                            onClick={() => handleDeleteTag(tag)}
                            className="hover:text-red-400 text-gray-400 text-xs"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Add new tag..."
                        value={newTagInput}
                        onChange={(e) => setNewTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newTagInput.trim()) {
                            addProjectTag(newTagInput.trim())
                            setNewTagInput('')
                          }
                        }}
                        className="flex-1 bg-black/40 border border-gray-700 rounded px-2.5 py-1 text-white"
                      />
                      <button
                        className="px-3 py-1 bg-blue-700 hover:bg-blue-600 text-white rounded font-medium"
                        onClick={() => {
                          if (newTagInput.trim()) {
                            addProjectTag(newTagInput.trim())
                            setNewTagInput('')
                          }
                        }}
                      >
                        Add Tag
                      </button>
                    </div>
                  </div>
                </div>

                {/* Layers section */}
                <div className="space-y-2">
                  <h3 className="font-semibold text-gray-300 text-sm">Layers (32 Layers)</h3>
                  <div className="bg-[#121b33] border border-gray-700/50 rounded-lg p-3 grid grid-cols-2 gap-2">
                    {Array.from({ length: 32 }).map((_, idx) => {
                      const isBuiltin = idx <= 5
                      const layerVal = projectSettings.layers[idx] || ''
                      return (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="w-16 text-gray-500 font-mono text-right">Layer {idx}:</span>
                          <input
                            type="text"
                            value={layerVal}
                            disabled={isBuiltin && idx !== 3}
                            onChange={(e) => {
                              const next = [...projectSettings.layers]
                              next[idx] = e.target.value
                              setProjectLayers(next)
                            }}
                            className={`flex-1 bg-black/40 border border-gray-700 rounded px-2 py-0.5 text-white ${
                              isBuiltin && idx !== 3 ? 'opacity-60 cursor-not-allowed' : ''
                            }`}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Physics: Layer Collision Matrix */}
            {activeTab === 'physics' && (
              <div className="space-y-4">
                <h3 className="font-semibold text-gray-300 text-sm">Layer Collision Matrix (16 Layers)</h3>
                <p className="text-gray-400 text-xs">
                  Configure which layers collide with each other in the Rapier 3D physics engine.
                </p>

                <div className="overflow-x-auto bg-[#121b33] border border-gray-700/50 rounded-lg p-3">
                  <table className="border-collapse">
                    <thead>
                      <tr>
                        <th className="p-1"></th>
                        {Array.from({ length: 16 }).map((_, col) => {
                          const name = projectSettings.layers[col] || `L${col}`
                          return (
                            <th key={col} className="p-1 text-center font-normal text-gray-400 w-7">
                              <span
                                className="inline-block transform -rotate-45 origin-bottom-left text-[10px] truncate max-w-16"
                                title={name}
                              >
                                {name}
                              </span>
                            </th>
                          )
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: 16 }).map((_, row) => {
                        const rowName = projectSettings.layers[row] || `Layer ${row}`
                        return (
                          <tr key={row} className="hover:bg-white/5">
                            <td className="p-1 text-right text-gray-300 font-medium truncate max-w-28 pr-2">
                              {rowName}
                            </td>
                            {Array.from({ length: 16 }).map((_, col) => {
                              if (col < row) {
                                return <td key={col} className="p-1 text-center text-gray-700">·</td>
                              }
                              const isChecked = projectSettings.collisionMatrix[row]?.[col] ?? true
                              return (
                                <td key={col} className="p-1 text-center">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) => setCollisionMatrixCell(row, col, e.target.checked)}
                                    className="rounded bg-gray-800 border-gray-600 text-blue-600 focus:ring-0 cursor-pointer"
                                  />
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Time Settings */}
            {activeTab === 'graphics' && (
              <div className="space-y-4">
                <h3 className="font-semibold text-gray-300 text-sm">Graphics</h3>
                <div className="bg-[#121b33] border border-gray-700/50 rounded-lg p-3 space-y-3 max-w-md">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-gray-300">Quality Profile</span>
                    <select
                      value={projectSettings.quality ?? 'medium'}
                      onChange={(e) => saveGraphicsSettings({ quality: e.target.value as 'low' | 'medium' | 'high' })}
                      className="bg-black/40 border border-gray-700 rounded px-2 py-1 text-white"
                    >
                      <option value="low">Low (mobile)</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>
                  <p className="text-gray-500 leading-relaxed">
                    Low: tanpa post-processing, shadow map 1024, kaca/air tanpa refraksi (transparansi biasa), pixel ratio 1.
                    Medium: shadow map maks 2048. High: shadow map maks 4096, pixel ratio 2. Berlaku di editor, Play dan web export;
                    setting per scene ada di tab Scene.
                  </p>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-gray-300">Renderer</span>
                    <select
                      value={projectSettings.renderer ?? 'webgl'}
                      onChange={(e) => saveGraphicsSettings({ renderer: e.target.value as 'webgl' | 'webgpu' })}
                      className="bg-black/40 border border-gray-700 rounded px-2 py-1 text-white"
                    >
                      <option value="webgl">WebGL2</option>
                      <option value="webgpu">WebGPU (fallback WebGL2)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'time' && (
              <div className="space-y-4">
                <h3 className="font-semibold text-gray-300 text-sm">Time Settings</h3>
                <div className="bg-[#121b33] border border-gray-700/50 rounded-lg p-3 space-y-3 max-w-md">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-300">Fixed Timestep (s)</span>
                    <input
                      type="number"
                      step={0.005}
                      value={fixedTimestep}
                      onChange={(e) => setFixedTimestep(e.target.value)}
                      className="w-24 bg-black/40 border border-gray-700 rounded px-2 py-1 text-white"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-300">Maximum Allowed Timestep</span>
                    <span className="font-mono text-gray-400">0.333333</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-300">Time Scale</span>
                    <span className="font-mono text-gray-400">1.0</span>
                  </div>
                </div>
              </div>
            )}

            {/* Services */}
            {activeTab === 'services' && (
              <div className="space-y-4">
                <h3 className="font-semibold text-gray-300 text-sm">Persistent Services (Autoload)</h3>
                <p className="text-gray-400 text-xs">
                  Services initialized under DontDestroyOnLoad before the first scene loads.
                </p>
                <div className="bg-[#121b33] border border-gray-700/50 rounded-lg p-3 space-y-2">
                  <div className="text-gray-500 text-center py-4">No persistent services configured</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="h-10 px-4 bg-[#0f172a] border-t border-gray-700/60 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
