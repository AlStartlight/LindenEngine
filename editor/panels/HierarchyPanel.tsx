import React, { useState, useEffect } from 'react'
import { useEditorStore } from '../store/editorStore'
import {
  createEntityCommand,
  deleteEntityCommand,
  duplicateEntityCommand,
  setParentCommand,
} from '../commands/entityCommands'
import { unpackPrefabCommand } from '../commands/prefabAndEventCommands'

export interface HierarchyItem {
  id: string
  name: string
  type: string
  children?: HierarchyItem[]
}

export const sampleHierarchy: HierarchyItem[] = []

export interface HierarchyPanelProps {
  items?: HierarchyItem[]
  selectedObjectId?: string | null
  onSelectObject?: (id: string) => void
}

export const HierarchyPanel: React.FC<HierarchyPanelProps> = ({
  selectedObjectId: propSelectedId,
  onSelectObject: propOnSelect,
}) => {
  const {
    world,
    selectedEntityIds,
    selectEntity,
    executeCommand,
    projectRuntime,
  } = useEditorStore()

  const [searchQuery, setSearchQuery] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; targetId: string | null } | null>(null)
  const [draggedEntityId, setDraggedEntityId] = useState<string | null>(null)
  const [, setTick] = useState(0)

  // Re-render when world changes
  useEffect(() => {
    const rerender = () => setTick((t) => t + 1)
    const u1 = world.events.on('entityAdded', rerender)
    const u2 = world.events.on('entityRemoved', rerender)
    const u3 = world.events.on('parentChanged', rerender)
    const u4 = world.events.on('propertyChanged', rerender)
    const u5 = world.events.on('tagAdded', rerender)
    const u6 = world.events.on('tagRemoved', rerender)
    return () => {
      u1(); u2(); u3(); u4(); u5(); u6()
    }
  }, [world])

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Parse search
  const isTagSearch = searchQuery.trim().startsWith('t:')
  const searchTag = isTagSearch ? searchQuery.trim().slice(2).trim().toLowerCase() : ''
  const searchName = !isTagSearch ? searchQuery.trim().toLowerCase() : ''

  // Build match sets
  const matchingEntityIds = new Set<string>()
  const ancestorIds = new Set<string>()

  if (searchTag || searchName) {
    for (const ent of world.getEntities()) {
      let match = false
      if (isTagSearch) {
        match = ent.tags.some((t: string) => t.toLowerCase() === searchTag)
      } else {
        match = ent.name.toLowerCase().includes(searchName)
      }

      if (match) {
        matchingEntityIds.add(ent.id)
        // Mark ancestors
        let cur = ent.parentId ? world.getEntity(ent.parentId) : null
        while (cur) {
          ancestorIds.add(cur.id)
          cur = cur.parentId ? world.getEntity(cur.parentId) : null
        }
      }
    }
  }

  const handleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const multi = e.ctrlKey || e.metaKey || e.shiftKey
    selectEntity(id, multi)
    propOnSelect?.(id)
  }

  const handleContextMenu = (e: React.MouseEvent, id: string | null) => {
    e.preventDefault()
    e.stopPropagation()
    if (id) {
      selectEntity(id, false)
      propOnSelect?.(id)
    }
    setContextMenu({ x: e.clientX, y: e.clientY, targetId: id })
  }

  const handleCreate3DObject = (type: 'Cube' | 'Sphere' | 'Capsule' | 'Cylinder' | 'Plane') => {
    const entName = type
    const parentId = contextMenu?.targetId || null
    executeCommand(createEntityCommand(entName, parentId))
    const all = world.getEntities()
    const newest = all[all.length - 1]
    if (newest) {
      const prim = type.toLowerCase()
      executeCommand({
        label: `Add MeshRenderer (${type})`,
        do: (w) => {
          w.addComponent(newest.id, 'MeshRenderer', { primitive: prim })
          if (type === 'Cube') w.addComponent(newest.id, 'BoxCollider')
          else if (type === 'Sphere') w.addComponent(newest.id, 'SphereCollider')
          else if (type === 'Capsule') w.addComponent(newest.id, 'CapsuleCollider')
          else if (type === 'Plane') w.addComponent(newest.id, 'BoxCollider', { size: { x: 10, y: 0.1, z: 10 } })
        },
        undo: (w) => {
          w.removeComponent(newest.id, 'MeshRenderer')
          w.removeComponent(newest.id, 'BoxCollider')
          w.removeComponent(newest.id, 'SphereCollider')
          w.removeComponent(newest.id, 'CapsuleCollider')
        },
      })
    }
    setContextMenu(null)
  }

  const renderEntityTree = (entityId: string, depth = 0): React.ReactNode => {
    const entity = world.getEntity(entityId)
    if (!entity) return null

    // Search filtering
    if (searchTag || searchName) {
      if (!matchingEntityIds.has(entity.id) && !ancestorIds.has(entity.id)) {
        return null
      }
    }

    const isDirectMatch = (searchTag || searchName) ? matchingEntityIds.has(entity.id) : true
    const isAncestorOnly = (searchTag || searchName) ? (!isDirectMatch && ancestorIds.has(entity.id)) : false

    const isSelected = selectedEntityIds.includes(entity.id) || propSelectedId === entity.id
    const hasChildren = entity.childIds.length > 0
    const isExpanded = expandedIds.has(entity.id) || searchTag.length > 0 || searchName.length > 0
    const isPrefab = Boolean(entity.prefab)

    return (
      <div key={entity.id} className="select-none">
        <div
          className={`flex items-center gap-1.5 px-2 py-1 cursor-pointer transition-colors text-xs rounded ${
            isSelected
              ? 'bg-blue-600 text-white font-medium'
              : 'hover:bg-white/5 text-gray-300'
          } ${isAncestorOnly ? 'opacity-40 italic' : ''}`}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
          onClick={(e) => handleSelect(entity.id, e)}
          onContextMenu={(e) => handleContextMenu(e, entity.id)}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', entity.id)
            setDraggedEntityId(entity.id)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (draggedEntityId && draggedEntityId !== entity.id) {
              try {
                executeCommand(setParentCommand(draggedEntityId, entity.id))
              } catch (err: any) {
                console.error(err.message)
              }
            }
            setDraggedEntityId(null)
          }}
        >
          {/* Expand / Collapse Icon */}
          <span
            className="w-3 text-center text-[10px] text-gray-400 hover:text-white"
            onClick={(e) => hasChildren && toggleExpand(entity.id, e)}
          >
            {hasChildren ? (isExpanded ? '▼' : '▶') : ' '}
          </span>

          {/* Type / Prefab Icon */}
          <span className={isPrefab ? 'text-blue-400' : 'text-gray-400'}>
            {isPrefab ? '📦' : entity.getComponent('MeshRenderer') ? '◼' : '○'}
          </span>

          {/* Entity Name */}
          <span className={`truncate flex-1 ${isPrefab ? 'text-blue-400 font-semibold' : ''}`}>
            {entity.name}
          </span>
        </div>

        {/* Render Children */}
        {hasChildren && isExpanded && (
          <div>
            {entity.childIds.map((cId) => renderEntityTree(cId, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  const rootEntities = world.getRootEntities()

  if (projectRuntime === 'html') {
    return (
      <div className="p-4 text-xs text-gray-400 leading-relaxed">
        <div className="text-gray-200 font-semibold mb-1">HTML Game</div>
        Scene dikelola oleh kode game (project.linden.json → html.entry). Tekan Play untuk menjalankannya di viewport.
      </div>
    )
  }

  return (
    <div
      className="flex flex-col h-full bg-[#16213e] text-gray-200 text-xs"
      onClick={() => setContextMenu(null)}
      onContextMenu={(e) => handleContextMenu(e, null)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        if (draggedEntityId) {
          executeCommand(setParentCommand(draggedEntityId, null))
          setDraggedEntityId(null)
        }
      }}
    >
      {/* Search Header */}
      <div className="p-2 border-b border-gray-700/50 bg-[#121b33]">
        <input
          type="text"
          placeholder="Search by name or t:TagName..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-black/40 border border-gray-700 rounded px-2.5 py-1 text-white text-xs focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Tree Content */}
      <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
        {rootEntities.map((ent) => renderEntityTree(ent.id))}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-[#16213e] border border-gray-700/80 rounded shadow-2xl z-50 min-w-44 py-1 text-xs text-gray-200"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-blue-600/50 flex items-center gap-2"
            onClick={() => {
              executeCommand(createEntityCommand('GameObject', contextMenu.targetId))
              setContextMenu(null)
            }}
          >
            <span>Create Empty</span>
          </button>

          <div className="relative group">
            <button className="w-full text-left px-3 py-1.5 hover:bg-blue-600/50 flex items-center justify-between">
              <span>3D Object</span>
              <span>▶</span>
            </button>
            <div className="hidden group-hover:block absolute left-full top-0 bg-[#16213e] border border-gray-700/80 rounded shadow-2xl min-w-36 py-1">
              <button
                className="w-full text-left px-3 py-1 hover:bg-blue-600/50"
                onClick={() => handleCreate3DObject('Cube')}
              >
                Cube
              </button>
              <button
                className="w-full text-left px-3 py-1 hover:bg-blue-600/50"
                onClick={() => handleCreate3DObject('Sphere')}
              >
                Sphere
              </button>
              <button
                className="w-full text-left px-3 py-1 hover:bg-blue-600/50"
                onClick={() => handleCreate3DObject('Capsule')}
              >
                Capsule
              </button>
              <button
                className="w-full text-left px-3 py-1 hover:bg-blue-600/50"
                onClick={() => handleCreate3DObject('Cylinder')}
              >
                Cylinder
              </button>
              <button
                className="w-full text-left px-3 py-1 hover:bg-blue-600/50"
                onClick={() => handleCreate3DObject('Plane')}
              >
                Plane
              </button>
            </div>
          </div>

          <div className="border-t border-gray-700/60 my-1" />

          {contextMenu.targetId && (
            <>
              <button
                className="w-full text-left px-3 py-1.5 hover:bg-blue-600/50"
                onClick={() => {
                  executeCommand(duplicateEntityCommand(contextMenu.targetId!))
                  setContextMenu(null)
                }}
              >
                Duplicate (Ctrl+D)
              </button>
              <button
                className="w-full text-left px-3 py-1.5 hover:bg-red-600/50 text-red-300"
                onClick={() => {
                  executeCommand(deleteEntityCommand(contextMenu.targetId!))
                  setContextMenu(null)
                }}
              >
                Delete (Del)
              </button>
              {world.getEntity(contextMenu.targetId)?.prefab && (
                <button
                  className="w-full text-left px-3 py-1.5 hover:bg-blue-600/50 text-blue-300 border-t border-gray-700/60 mt-1"
                  onClick={() => {
                    executeCommand(unpackPrefabCommand(contextMenu.targetId!))
                    setContextMenu(null)
                  }}
                >
                  Unpack Prefab Completely
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default HierarchyPanel
