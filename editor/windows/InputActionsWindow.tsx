import React, { useState } from 'react'
import { useEditorStore } from '../store/editorStore'
import { Input, InputActionDef } from '../../engine/input/InputActions'

export const InputActionsWindow: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { projectSettings, setProjectSettings } = useEditorStore()
  const [actions, setActions] = useState<InputActionDef[]>(projectSettings.inputActions || [])
  const [selectedActionIndex, setSelectedActionIndex] = useState<number>(0)
  const [listeningTarget, setListeningTarget] = useState<{ actionIdx: number; bindingIdx?: number; compositeKey?: string } | null>(null)

  const selectedAction = actions[selectedActionIndex]

  const updateActions = (newActions: InputActionDef[]) => {
    setActions(newActions)
    setProjectSettings({ inputActions: newActions })
    Input.loadActions(newActions)
  }

  const handleAddAction = () => {
    const newName = `Action_${actions.length + 1}`
    const newAction: InputActionDef = {
      name: newName,
      type: 'button',
      bindings: ['Keyboard/Space'],
    }
    const next = [...actions, newAction]
    updateActions(next)
    setSelectedActionIndex(next.length - 1)
  }

  const handleStartListen = (actionIdx: number, bindingIdx?: number, compositeKey?: string) => {
    setListeningTarget({ actionIdx, bindingIdx, compositeKey })
    Input.listenNextInput((capturedBinding) => {
      const nextActions = JSON.parse(JSON.stringify(actions))
      const act = nextActions[actionIdx]
      if (compositeKey && act.composite) {
        act.composite[compositeKey] = capturedBinding
      } else if (bindingIdx !== undefined && act.bindings) {
        act.bindings[bindingIdx] = capturedBinding
      } else {
        if (!act.bindings) act.bindings = []
        act.bindings.push(capturedBinding)
      }
      updateActions(nextActions)
      setListeningTarget(null)
    })
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-6 select-none">
      <div className="bg-[#16213e] border border-gray-700/80 rounded-xl shadow-2xl w-full max-w-3xl h-[520px] flex flex-col overflow-hidden text-xs text-gray-200">
        {/* Title bar */}
        <div className="h-9 px-4 bg-[#0f172a] border-b border-gray-700/60 flex items-center justify-between">
          <span className="font-semibold text-gray-100 flex items-center gap-2">
            <span>🎮</span> Input Actions
          </span>
          <button
            onClick={onClose}
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Body (2 columns) */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Actions list */}
          <div className="w-56 border-r border-gray-700/50 bg-[#121b33] p-2.5 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-gray-400 uppercase text-[10px]">Actions</span>
              <button
                className="px-2 py-0.5 bg-blue-700 hover:bg-blue-600 rounded text-white text-[11px]"
                onClick={handleAddAction}
              >
                +
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1">
              {actions.map((act, i) => (
                <div
                  key={act.name}
                  onClick={() => setSelectedActionIndex(i)}
                  className={`px-2.5 py-1.5 rounded cursor-pointer flex items-center justify-between ${
                    selectedActionIndex === i ? 'bg-blue-600 text-white font-medium' : 'hover:bg-white/5 text-gray-300'
                  }`}
                >
                  <span className="truncate">{act.name}</span>
                  <span className="text-[10px] text-gray-400 capitalize">{act.type}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Action configuration */}
          <div className="flex-1 p-4 overflow-y-auto space-y-4">
            {selectedAction ? (
              <>
                <div className="space-y-3 bg-[#121b33] p-3 rounded-lg border border-gray-700/40">
                  <div className="flex items-center gap-3">
                    <span className="w-20 text-gray-400">Name</span>
                    <input
                      type="text"
                      value={selectedAction.name}
                      onChange={(e) => {
                        const next = [...actions]
                        next[selectedActionIndex].name = e.target.value
                        updateActions(next)
                      }}
                      className="flex-1 bg-black/40 border border-gray-700 rounded px-2 py-1 text-white"
                    />
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="w-20 text-gray-400">Action Type</span>
                    <select
                      value={selectedAction.type}
                      onChange={(e) => {
                        const next = [...actions]
                        next[selectedActionIndex].type = e.target.value as any
                        updateActions(next)
                      }}
                      className="flex-1 bg-black/40 border border-gray-700 rounded px-2 py-1 text-white"
                    >
                      <option value="button">Button</option>
                      <option value="axis">Axis</option>
                      <option value="vector2">Vector2</option>
                    </select>
                  </div>

                  {selectedAction.type === 'vector2' && (
                    <div className="flex items-center gap-3">
                      <span className="w-20 text-gray-400">Deadzone</span>
                      <input
                        type="number"
                        step={0.05}
                        min={0}
                        max={1}
                        value={selectedAction.deadzone ?? 0.2}
                        onChange={(e) => {
                          const next = [...actions]
                          next[selectedActionIndex].deadzone = parseFloat(e.target.value) || 0
                          updateActions(next)
                        }}
                        className="w-24 bg-black/40 border border-gray-700 rounded px-2 py-1 text-white"
                      />
                    </div>
                  )}
                </div>

                {/* Composite bindings for Vector2 */}
                {selectedAction.type === 'vector2' && (
                  <div className="space-y-2 bg-[#121b33] p-3 rounded-lg border border-gray-700/40">
                    <div className="font-semibold text-gray-400 uppercase text-[10px] mb-2">
                      2D Vector Composite (WASD / D-Pad)
                    </div>
                    {['up', 'down', 'left', 'right'].map((dir) => {
                      const currentBinding = selectedAction.composite?.[dir as keyof typeof selectedAction.composite] || ''
                      const isListening =
                        listeningTarget?.actionIdx === selectedActionIndex &&
                        listeningTarget?.compositeKey === dir

                      return (
                        <div key={dir} className="flex items-center gap-3">
                          <span className="w-16 capitalize text-gray-400">{dir}</span>
                          <span className="flex-1 font-mono text-gray-300 bg-black/30 px-2 py-1 rounded border border-gray-800">
                            {currentBinding || 'None'}
                          </span>
                          <button
                            className={`px-3 py-1 rounded text-white font-medium ${
                              isListening ? 'bg-amber-600 animate-pulse' : 'bg-blue-700 hover:bg-blue-600'
                            }`}
                            onClick={() => handleStartListen(selectedActionIndex, undefined, dir)}
                          >
                            {isListening ? 'Listening...' : 'Listen'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Direct bindings list */}
                <div className="space-y-2 bg-[#121b33] p-3 rounded-lg border border-gray-700/40">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-gray-400 uppercase text-[10px]">Bindings</span>
                    <button
                      className="px-2 py-0.5 bg-blue-700 hover:bg-blue-600 text-white rounded text-[11px]"
                      onClick={() => {
                        const next = [...actions]
                        if (!next[selectedActionIndex].bindings) next[selectedActionIndex].bindings = []
                        next[selectedActionIndex].bindings!.push('Keyboard/Space')
                        updateActions(next)
                      }}
                    >
                      + Add Binding
                    </button>
                  </div>

                  {(selectedAction.bindings || []).map((b, bIdx) => {
                    const isListening =
                      listeningTarget?.actionIdx === selectedActionIndex &&
                      listeningTarget?.bindingIdx === bIdx

                    return (
                      <div key={bIdx} className="flex items-center gap-3">
                        <span className="flex-1 font-mono text-gray-300 bg-black/30 px-2.5 py-1 rounded border border-gray-800">
                          {b}
                        </span>
                        <button
                          className={`px-3 py-1 rounded text-white font-medium ${
                            isListening ? 'bg-amber-600 animate-pulse' : 'bg-blue-700 hover:bg-blue-600'
                          }`}
                          onClick={() => handleStartListen(selectedActionIndex, bIdx)}
                        >
                          {isListening ? 'Listening...' : 'Listen'}
                        </button>
                        <button
                          className="px-2 py-1 text-red-400 hover:text-red-300"
                          onClick={() => {
                            const next = [...actions]
                            next[selectedActionIndex].bindings!.splice(bIdx, 1)
                            updateActions(next)
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <div className="text-gray-500 text-center py-10">Select an action on the left</div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="h-10 px-4 bg-[#0f172a] border-t border-gray-700/60 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
