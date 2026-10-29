import React, { useState, useEffect, useRef } from 'react'
import { useEditorStore } from '../store/editorStore'
import { ComponentRegistry, PropertySchema } from '../../engine/ecs/ComponentRegistry'
import {
  setPropertyCommand,
  setTagsCommand,
  setLayerCommand,
  addComponentCommand,
  removeComponentCommand,
  resetComponentCommand,
  pasteComponentValuesCommand,
} from '../commands/entityCommands'
import {
  revertPrefabOverridesCommand,
  addEventListenerCommand,
  removeEventListenerCommand,
} from '../commands/prefabAndEventCommands'

export const InspectorPanel: React.FC = () => {
  const {
    world,
    selectedEntityIds,
    executeCommand,
    projectSettings,
    addProjectTag,
    playState,
  } = useEditorStore()

  const [copiedComponentData, setCopiedComponentData] = useState<{ type: string; data: any } | null>(null)
  const [showAddComponent, setShowAddComponent] = useState(false)
  const [addSearchQuery, setAddSearchQuery] = useState('')
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false)
  const [componentFoldouts, setComponentFoldouts] = useState<Record<string, boolean>>({})

  // Multi-select or single entity
  const entities = selectedEntityIds.map((id) => world.getEntity(id)).filter(Boolean) as any[]
  const primaryEntity = entities[0]

  if (entities.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500 text-sm">
        Select a GameObject to inspect
      </div>
    )
  }

  const isMulti = entities.length > 1
  const isPrefab = Boolean(primaryEntity.prefab)

  const toggleFoldout = (compName: string) => {
    setComponentFoldouts((prev) => ({
      ...prev,
      [compName]: prev[compName] !== undefined ? !prev[compName] : false,
    }))
  }

  const isFolded = (compName: string) => componentFoldouts[compName] === false

  // Handle Layer change with child prompt
  const handleLayerChange = (newLayer: number) => {
    let applyToChildren = false
    if (primaryEntity.childIds.length > 0) {
      applyToChildren = window.confirm('Do you want to set layer to child objects too?')
    }
    for (const ent of entities) {
      executeCommand(setLayerCommand(ent.id, newLayer, applyToChildren))
    }
  }

  // Handle Tag addition
  const handleAddTag = (tag: string) => {
    if (tag === '__NEW_TAG__') {
      const newTag = window.prompt('Enter new Tag name:')
      if (newTag) {
        addProjectTag(newTag)
        for (const ent of entities) {
          const next = Array.from(new Set([...ent.tags, newTag]))
          executeCommand(setTagsCommand(ent.id, next))
        }
      }
    } else {
      for (const ent of entities) {
        const next = Array.from(new Set([...ent.tags, tag]))
        executeCommand(setTagsCommand(ent.id, next))
      }
    }
    setTagDropdownOpen(false)
  }

  // Handle Tag removal
  const handleRemoveTag = (tag: string) => {
    for (const ent of entities) {
      const next = ent.tags.filter((t: string) => t !== tag)
      executeCommand(setTagsCommand(ent.id, next))
    }
  }

  return (
    <div className="flex flex-col h-full bg-[#16213e] text-gray-200 text-xs overflow-y-auto">
      {/* Prefab banner */}
      {isPrefab && (
        <div className="bg-blue-900/60 border-b border-blue-500/50 px-3 py-1.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-blue-300 font-semibold">
            <span>📦</span>
            <span>Prefab Instance</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-2 py-0.5 bg-blue-700 hover:bg-blue-600 text-white rounded text-[11px]"
              onClick={() => {
                // Revert All
                const asset = {
                  format: 'linden-prefab',
                  version: 1,
                  root: primaryEntity.id,
                  entities: [primaryEntity.serialize()],
                } as any
                executeCommand(revertPrefabOverridesCommand(primaryEntity.id, asset))
              }}
            >
              Revert All
            </button>
          </div>
        </div>
      )}

      {/* GameObject Header */}
      <div className="p-3 border-b border-gray-700/50 space-y-2.5 bg-[#121b33]">
        <div className="flex items-center gap-2">
          {/* Active Checkbox */}
          <input
            type="checkbox"
            checked={entities.every((e) => e.active)}
            onChange={(e) => {
              const val = e.target.checked
              for (const ent of entities) {
                executeCommand(setPropertyCommand(ent.id, 'Entity', 'active', val))
              }
            }}
            className="rounded bg-gray-800 border-gray-600 text-blue-600 focus:ring-0"
          />

          {/* Name input */}
          <input
            type="text"
            value={isMulti ? (entities.every((e) => e.name === primaryEntity.name) ? primaryEntity.name : '—') : primaryEntity.name}
            onChange={(e) => {
              const val = e.target.value
              for (const ent of entities) {
                executeCommand(setPropertyCommand(ent.id, 'Entity', 'name', val))
              }
            }}
            className="flex-1 bg-black/40 border border-gray-700 rounded px-2 py-1 font-medium text-white focus:outline-none focus:border-blue-500"
          />

          {/* Static checkbox */}
          <label className="flex items-center gap-1 text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={entities.every((e) => e.isStatic)}
              onChange={(e) => {
                const val = e.target.checked
                for (const ent of entities) {
                  executeCommand(setPropertyCommand(ent.id, 'Entity', 'isStatic', val))
                }
              }}
              className="rounded bg-gray-800 border-gray-600 text-blue-600 focus:ring-0"
            />
            <span>Static</span>
          </label>
        </div>

        {/* Tags Row */}
        <div className="flex items-center gap-2">
          <span className="w-12 text-gray-400">Tag</span>
          <div className="flex-1 flex flex-wrap items-center gap-1.5 relative">
            {/* Display chips for primaryEntity or common tags */}
            {projectSettings.tags.map((tag) => {
              const count = entities.filter((e) => e.hasTag(tag)).length
              if (count === 0) return null
              const isPartial = count < entities.length
              return (
                <span
                  key={tag}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-900/60 border border-blue-500/40 text-blue-200 text-[11px] ${
                    isPartial ? 'opacity-50' : ''
                  }`}
                >
                  <span>{tag}</span>
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    className="hover:text-red-400 text-gray-400"
                  >
                    ×
                  </button>
                </span>
              )
            })}

            {/* + Button for Tags */}
            <div className="relative">
              <button
                className="px-1.5 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-gray-300 text-[11px]"
                onClick={() => setTagDropdownOpen(!tagDropdownOpen)}
              >
                +
              </button>

              {tagDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 bg-[#16213e] border border-gray-700 rounded shadow-xl z-50 min-w-36 py-1">
                  {projectSettings.tags.map((t) => (
                    <button
                      key={t}
                      className="w-full text-left px-3 py-1 hover:bg-blue-600/50 text-gray-200"
                      onClick={() => handleAddTag(t)}
                    >
                      {t}
                    </button>
                  ))}
                  <div className="border-t border-gray-700 my-1" />
                  <button
                    className="w-full text-left px-3 py-1 hover:bg-blue-600/50 text-blue-400 font-semibold"
                    onClick={() => handleAddTag('__NEW_TAG__')}
                  >
                    + Add Tag...
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Layer Row */}
        <div className="flex items-center gap-2">
          <span className="w-12 text-gray-400">Layer</span>
          <select
            value={primaryEntity.layer}
            onChange={(e) => handleLayerChange(Number(e.target.value))}
            className="flex-1 bg-black/40 border border-gray-700 rounded px-2 py-1 text-gray-200 focus:outline-none focus:border-blue-500"
          >
            {projectSettings.layers.map((lName, idx) => (
              <option key={idx} value={idx}>
                {lName || `Layer ${idx}`}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Components List */}
      <div className="p-2 space-y-2 flex-1">
        {primaryEntity.getComponents().map((comp: any) => {
          const compDef = ComponentRegistry.get(comp.name)
          const folded = isFolded(comp.name)

          return (
            <div
              key={comp.name}
              className="bg-[#121b33] border border-gray-700/60 rounded overflow-hidden"
            >
              {/* Component Card Header */}
              <div className="flex items-center justify-between px-2.5 py-1.5 bg-[#0f172a] border-b border-gray-700/40 select-none">
                <div
                  className="flex items-center gap-2 cursor-pointer flex-1"
                  onClick={() => toggleFoldout(comp.name)}
                >
                  <span className="text-[10px] text-gray-400">{folded ? '▶' : '▼'}</span>
                  <input
                    type="checkbox"
                    checked={comp.isEnabled ?? true}
                    onChange={(e) => {
                      e.stopPropagation()
                      const val = e.target.checked
                      for (const ent of entities) {
                        executeCommand(setPropertyCommand(ent.id, comp.name, 'isEnabled', val))
                      }
                    }}
                    className="rounded bg-gray-800 border-gray-600 text-blue-600 focus:ring-0"
                  />
                  <span className="font-semibold text-gray-200">{comp.name}</span>
                </div>

                {/* Component Menu ⋮ */}
                <div className="relative group">
                  <button className="px-1 text-gray-400 hover:text-white">⋮</button>
                  <div className="hidden group-hover:block absolute right-0 top-full mt-1 bg-[#16213e] border border-gray-700 rounded shadow-2xl z-50 min-w-36 py-1">
                    <button
                      className="w-full text-left px-3 py-1 hover:bg-blue-600/50"
                      onClick={() => {
                        for (const ent of entities) {
                          executeCommand(resetComponentCommand(ent.id, comp.name))
                        }
                      }}
                    >
                      Reset
                    </button>
                    {comp.name !== 'Transform' && (
                      <button
                        className="w-full text-left px-3 py-1 hover:bg-red-600/50 text-red-300"
                        onClick={() => {
                          for (const ent of entities) {
                            executeCommand(removeComponentCommand(ent.id, comp.name))
                          }
                        }}
                      >
                        Remove Component
                      </button>
                    )}
                    <button
                      className="w-full text-left px-3 py-1 hover:bg-blue-600/50"
                      onClick={() => setCopiedComponentData({ type: comp.name, data: JSON.parse(JSON.stringify(comp)) })}
                    >
                      Copy Component
                    </button>
                    {copiedComponentData && copiedComponentData.type === comp.name && (
                      <button
                        className="w-full text-left px-3 py-1 hover:bg-blue-600/50 text-green-300"
                        onClick={() => {
                          for (const ent of entities) {
                            executeCommand(pasteComponentValuesCommand(ent.id, comp.name, copiedComponentData.data))
                          }
                        }}
                      >
                        Paste Component Values
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Component Properties */}
              {!folded && (
                <div className="p-2.5 space-y-2">
                  {compDef?.properties.map((propSchema) => (
                    <PropertyFieldRow
                      key={propSchema.name}
                      schema={propSchema}
                      componentType={comp.name}
                      entities={entities}
                      primaryEntity={primaryEntity}
                      executeCommand={executeCommand}
                      world={world}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {/* Add Component Button */}
        <div className="pt-2 relative">
          <button
            className="w-full py-2 bg-blue-700 hover:bg-blue-600 text-white font-medium rounded transition-colors shadow"
            onClick={() => setShowAddComponent(!showAddComponent)}
          >
            Add Component
          </button>

          {showAddComponent && (
            <div className="absolute bottom-full left-0 right-0 mb-1 bg-[#16213e] border border-gray-700 rounded-lg shadow-2xl z-50 p-2 max-h-72 flex flex-col">
              <input
                type="text"
                placeholder="Search components..."
                value={addSearchQuery}
                onChange={(e) => setAddSearchQuery(e.target.value)}
                autoFocus
                className="w-full bg-black/40 border border-gray-700 rounded px-2.5 py-1.5 text-white mb-2 focus:outline-none focus:border-blue-500"
              />
              <div className="flex-1 overflow-y-auto space-y-1">
                {ComponentRegistry.search(addSearchQuery).map((def) => (
                  <button
                    key={def.type}
                    className="w-full text-left px-3 py-1.5 hover:bg-blue-600/50 rounded flex items-center justify-between text-gray-200"
                    onClick={() => {
                      for (const ent of entities) {
                        executeCommand(addComponentCommand(ent.id, def.type))
                      }
                      setShowAddComponent(false)
                      setAddSearchQuery('')
                    }}
                  >
                    <span>{def.type}</span>
                    <span className="text-[10px] text-gray-500">{def.menuPath}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Property Field Row Component
 */
const PropertyFieldRow: React.FC<{
  schema: PropertySchema
  componentType: string
  entities: any[]
  primaryEntity: any
  executeCommand: any
  world: any
}> = ({ schema, componentType, entities, primaryEntity, executeCommand, world }) => {
  const comp = primaryEntity.getComponent(componentType)
  const rawValue = comp ? (comp as any)[schema.name] : undefined

  // Check if all entities have the same value
  const isMixed =
    entities.length > 1 &&
    !entities.every((ent) => {
      const c = ent.getComponent(componentType)
      return JSON.stringify(c?.[schema.name]) === JSON.stringify(rawValue)
    })

  // Scrub handler for labels
  const handleScrub = (delta: number) => {
    let next = (Number(rawValue) || 0) + delta * (schema.step || 0.1)
    if (schema.min !== undefined) next = Math.max(schema.min, next)
    if (schema.max !== undefined) next = Math.min(schema.max, next)
    for (const ent of entities) {
      executeCommand(
        setPropertyCommand(
          ent.id,
          componentType,
          schema.name,
          next,
          undefined,
          `scrub:${ent.id}:${componentType}:${schema.name}`
        )
      )
    }
  }

  // Label drag scrubbing
  const labelRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = labelRef.current
    if (!el || (schema.kind !== 'number' && schema.kind !== 'int')) return

    let startX = 0
    let isDragging = false

    const onMouseDown = (e: MouseEvent) => {
      startX = e.clientX
      isDragging = true
      document.body.style.cursor = 'ew-resize'
      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return
      const dx = e.clientX - startX
      if (Math.abs(dx) > 0) {
        handleScrub(dx > 0 ? 1 : -1)
        startX = e.clientX
      }
    }

    const onMouseUp = () => {
      isDragging = false
      document.body.style.cursor = 'default'
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    el.addEventListener('mousedown', onMouseDown)
    return () => {
      el.removeEventListener('mousedown', onMouseDown)
    }
  }, [rawValue])

  // Event field rendering
  if (schema.kind === 'event') {
    const eventField = rawValue
    const listeners = eventField?.listeners || []

    return (
      <div className="space-y-1 pt-1">
        <div className="flex items-center justify-between text-gray-300 font-medium">
          <span>{schema.label || schema.name}</span>
          <button
            className="px-1.5 py-0.5 bg-blue-700 hover:bg-blue-600 rounded text-[10px] text-white"
            onClick={() => {
              const defaultTarget = world.getEntities()[0]?.id || ''
              executeCommand(
                addEventListenerCommand(primaryEntity.id, componentType, schema.name, {
                  targetId: defaultTarget,
                  component: '',
                  method: '',
                  mode: 'runtime',
                })
              )
            }}
          >
            +
          </button>
        </div>

        <div className="bg-black/30 rounded border border-gray-800 p-1.5 space-y-1.5">
          {listeners.length === 0 ? (
            <div className="text-gray-500 text-[10px] italic py-1 text-center">
              No listeners attached
            </div>
          ) : (
            listeners.map((listener: any, idx: number) => {
              return (
                <div key={idx} className="flex items-center gap-1.5 bg-gray-900/50 p-1 rounded">
                  {/* Target Entity Select */}
                  <select
                    value={listener.targetId}
                    onChange={(e) => {
                      const newTargetId = e.target.value
                      listener.targetId = newTargetId
                      executeCommand(
                        setPropertyCommand(primaryEntity.id, componentType, `${schema.name}.listeners`, [
                          ...listeners,
                        ])
                      )
                    }}
                    className="w-28 bg-black/50 border border-gray-700 rounded px-1 py-0.5 text-[10px]"
                  >
                    {world.getEntities().map((e: any) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>

                  {/* Method / Custom Event Select */}
                  <select
                    value={`${listener.component}:${listener.method}`}
                    onChange={(e) => {
                      const [c, m] = e.target.value.split(':')
                      listener.component = c
                      listener.method = m
                      executeCommand(
                        setPropertyCommand(primaryEntity.id, componentType, `${schema.name}.listeners`, [
                          ...listeners,
                        ])
                      )
                    }}
                    className="flex-1 bg-black/50 border border-gray-700 rounded px-1 py-0.5 text-[10px]"
                  >
                    <option value=":">— Select —</option>
                    <optgroup label="Component">
                      <option value="Door:open">Door.open</option>
                      <option value="Alarm:ring">Alarm.ring</option>
                    </optgroup>
                  </select>

                  <button
                    className="text-red-400 hover:text-red-300 px-1"
                    onClick={() => {
                      executeCommand(
                        removeEventListenerCommand(primaryEntity.id, componentType, schema.name, idx)
                      )
                    }}
                  >
                    −
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>
    )
  }

  // Vector3 field rendering
  if (schema.kind === 'vector3') {
    const val = rawValue || { x: 0, y: 0, z: 0 }
    return (
      <div className="flex items-center gap-2">
        <span className="w-24 text-gray-400 truncate">{schema.label || schema.name}</span>
        <div className="flex-1 grid grid-cols-3 gap-1">
          {['x', 'y', 'z'].map((axis, i) => {
            const axisColor = i === 0 ? 'text-red-400' : i === 1 ? 'text-green-400' : 'text-blue-400'
            const axisVal = Array.isArray(val) ? val[i] : val[axis]
            return (
              <div key={axis} className="flex items-center bg-black/40 border border-gray-700 rounded px-1">
                <span className={`text-[10px] font-bold ${axisColor} mr-1`}>{axis.toUpperCase()}</span>
                <input
                  type="number"
                  step={0.1}
                  value={isMixed ? '' : Number(axisVal?.toFixed?.(2) ?? axisVal ?? 0)}
                  placeholder={isMixed ? '—' : undefined}
                  onChange={(e) => {
                    const num = parseFloat(e.target.value) || 0
                    for (const ent of entities) {
                      const cur = ent.getProperty ? ent.getProperty(componentType, schema.name) : ent.getComponent(componentType)?.[schema.name]
                      let nextVal: any
                      if (Array.isArray(cur)) {
                        nextVal = [...cur]
                        nextVal[i] = num
                      } else {
                        nextVal = { ...cur, [axis]: num }
                      }
                      executeCommand(
                        setPropertyCommand(
                          ent.id,
                          componentType,
                          schema.name,
                          nextVal,
                          undefined,
                          `setProp:${ent.id}:${componentType}:${schema.name}`
                        )
                      )
                    }
                  }}
                  className="w-full bg-transparent border-0 text-white text-xs focus:ring-0 p-0.5"
                />
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // Number / Int field with scrub and slider
  if (schema.kind === 'number' || schema.kind === 'int') {
    const hasMinMax = schema.min !== undefined && schema.max !== undefined
    return (
      <div className="flex items-center gap-2">
        <span
          ref={labelRef}
          className="w-24 text-gray-400 truncate cursor-ew-resize hover:text-white select-none"
        >
          {schema.label || schema.name}
        </span>
        {hasMinMax ? (
          <div className="flex-1 flex items-center gap-2">
            <input
              type="range"
              min={schema.min}
              max={schema.max}
              step={schema.step || 0.1}
              value={Number(rawValue) || 0}
              onChange={(e) => {
                const val = parseFloat(e.target.value)
                for (const ent of entities) {
                  executeCommand(
                    setPropertyCommand(
                      ent.id,
                      componentType,
                      schema.name,
                      val,
                      undefined,
                      `setProp:${ent.id}:${componentType}:${schema.name}`
                    )
                  )
                }
              }}
              className="flex-1 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
            <span className="w-10 text-right font-mono text-gray-300">
              {Number(rawValue)?.toFixed?.(1) ?? rawValue}
            </span>
          </div>
        ) : (
          <input
            type="number"
            step={schema.step || 0.1}
            value={isMixed ? '' : Number(rawValue) ?? 0}
            placeholder={isMixed ? '—' : undefined}
            onChange={(e) => {
              let val = parseFloat(e.target.value) || 0
              if (schema.min !== undefined) val = Math.max(schema.min, val)
              if (schema.max !== undefined) val = Math.min(schema.max, val)
              for (const ent of entities) {
                executeCommand(
                  setPropertyCommand(
                    ent.id,
                    componentType,
                    schema.name,
                    val,
                    undefined,
                    `setProp:${ent.id}:${componentType}:${schema.name}`
                  )
                )
              }
            }}
            className="flex-1 bg-black/40 border border-gray-700 rounded px-2 py-0.5 text-white"
          />
        )}
      </div>
    )
  }

  // Boolean checkbox
  if (schema.kind === 'boolean') {
    return (
      <div className="flex items-center gap-2">
        <span className="w-24 text-gray-400 truncate">{schema.label || schema.name}</span>
        <input
          type="checkbox"
          checked={Boolean(rawValue)}
          onChange={(e) => {
            const val = e.target.checked
            for (const ent of entities) {
              executeCommand(setPropertyCommand(ent.id, componentType, schema.name, val))
            }
          }}
          className="rounded bg-gray-800 border-gray-600 text-blue-600 focus:ring-0"
        />
      </div>
    )
  }

  // Color picker
  if (schema.kind === 'color') {
    return (
      <div className="flex items-center gap-2">
        <span className="w-24 text-gray-400 truncate">{schema.label || schema.name}</span>
        <div className="flex-1 flex items-center gap-2">
          <input
            type="color"
            value={rawValue || '#ffffff'}
            onChange={(e) => {
              const val = e.target.value
              for (const ent of entities) {
                executeCommand(setPropertyCommand(ent.id, componentType, schema.name, val))
              }
            }}
            className="w-8 h-6 bg-transparent border-0 cursor-pointer rounded"
          />
          <span className="font-mono text-gray-300">{rawValue || '#ffffff'}</span>
        </div>
      </div>
    )
  }

  // Enum select
  if (schema.kind === 'enum' && schema.options) {
    return (
      <div className="flex items-center gap-2">
        <span className="w-24 text-gray-400 truncate">{schema.label || schema.name}</span>
        <select
          value={rawValue}
          onChange={(e) => {
            const val = e.target.value
            for (const ent of entities) {
              executeCommand(setPropertyCommand(ent.id, componentType, schema.name, val))
            }
          }}
          className="flex-1 bg-black/40 border border-gray-700 rounded px-2 py-0.5 text-white"
        >
          {schema.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>
    )
  }

  if (schema.kind === 'json') {
    return (
      <JsonPropertyField
        label={schema.label || schema.name}
        value={isMixed ? undefined : rawValue}
        onCommit={(val) => {
          for (const ent of entities) {
            executeCommand(setPropertyCommand(ent.id, componentType, schema.name, val))
          }
        }}
      />
    )
  }

  // Fallback text input
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 text-gray-400 truncate">{schema.label || schema.name}</span>
      <input
        type="text"
        value={isMixed ? '' : String(rawValue ?? '')}
        placeholder={isMixed ? '—' : undefined}
        onChange={(e) => {
          const val = e.target.value
          for (const ent of entities) {
            executeCommand(setPropertyCommand(ent.id, componentType, schema.name, val))
          }
        }}
        className="flex-1 bg-black/40 border border-gray-700 rounded px-2 py-0.5 text-white"
      />
    </div>
  )
}

/** JSON editor that only commits valid objects, on blur */
const JsonPropertyField: React.FC<{
  label: string
  value: unknown
  onCommit: (value: Record<string, unknown>) => void
}> = ({ label, value, onCommit }) => {
  const serialized = value === undefined ? '' : JSON.stringify(value ?? {}, null, 2)
  const [text, setText] = useState(serialized)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setText(serialized)
    setError(null)
  }, [serialized])

  return (
    <div className="flex flex-col gap-1">
      <span className="text-gray-400 truncate">{label}</span>
      <textarea
        value={text}
        rows={Math.min(8, Math.max(2, text.split('\n').length))}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          try {
            const parsed = text.trim() ? JSON.parse(text) : {}
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              throw new Error('Harus berupa objek JSON')
            }
            setError(null)
            if (JSON.stringify(parsed) !== JSON.stringify(value ?? {})) onCommit(parsed)
          } catch (err: any) {
            setError(err.message)
          }
        }}
        className="w-full bg-black/40 border border-gray-700 rounded px-2 py-1 text-white font-mono text-[11px]"
      />
      {error && <span className="text-red-400 text-[10px]">{error}</span>}
    </div>
  )
}

export default InspectorPanel
