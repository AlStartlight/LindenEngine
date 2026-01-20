import React, { useState } from 'react'

interface HierarchyItem {
  id: string
  name: string
  type: string
  children?: HierarchyItem[]
}

interface HierarchyPanelProps {
  selectedObjectId?: string | null
  onSelectObject?: (id: string) => void
}

// Sample hierarchy data
const sampleHierarchy: HierarchyItem[] = [
  {
    id: 'cube-1',
    name: 'Cube',
    type: 'Mesh',
    children: [],
  },
  {
    id: 'sphere-1',
    name: 'Sphere',
    type: 'Mesh',
    children: [],
  },
  {
    id: 'cylinder-1',
    name: 'Cylinder',
    type: 'Mesh',
    children: [],
  },
  {
    id: 'torus-1',
    name: 'Torus',
    type: 'Mesh',
    children: [],
  },
  {
    id: 'cone-1',
    name: 'Cone',
    type: 'Mesh',
    children: [],
  },
  {
    id: 'lights',
    name: 'Lights',
    type: 'Group',
    children: [
      { id: 'directional-light', name: 'Directional Light', type: 'Light' },
      { id: 'ambient-light', name: 'Ambient Light', type: 'Light' },
      { id: 'hemisphere-light', name: 'Hemisphere Light', type: 'Light' },
    ],
  },
]

export const HierarchyPanel: React.FC<HierarchyPanelProps> = ({
  selectedObjectId,
  onSelectObject,
}) => {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set(['lights']))
  const [searchQuery, setSearchQuery] = useState('')

  const toggleExpand = (id: string) => {
    const newExpanded = new Set(expandedItems)
    if (newExpanded.has(id)) {
      newExpanded.delete(id)
    } else {
      newExpanded.add(id)
    }
    setExpandedItems(newExpanded)
  }

  const getIcon = (type: string) => {
    switch (type) {
      case 'Mesh':
        return '◼'
      case 'Light':
        return '☀'
      case 'Camera':
        return '📷'
      case 'Group':
        return '📁'
      default:
        return '○'
    }
  }

  const renderItem = (item: HierarchyItem, depth: number = 0) => {
    const isExpanded = expandedItems.has(item.id)
    const hasChildren = item.children && item.children.length > 0
    const isSelected = selectedObjectId === item.id

    // Filter by search
    if (searchQuery && !item.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      if (!hasChildren) return null
    }

    return (
      <div key={item.id}>
        <div
          className={`flex items-center px-2 py-1 cursor-pointer transition-colors ${
            isSelected
              ? 'bg-blue-600/50 text-white'
              : 'hover:bg-white/5 text-gray-300'
          }`}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          onClick={() => onSelectObject?.(item.id)}
        >
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                toggleExpand(item.id)
              }}
              className="mr-1 w-4 text-center text-xs text-gray-500 hover:text-white"
            >
              {isExpanded ? '▼' : '▶'}
            </button>
          ) : (
            <span className="mr-1 w-4" />
          )}

          <span className="mr-2 text-xs">{getIcon(item.type)}</span>
          <span className="text-sm truncate">{item.name}</span>
        </div>

        {isExpanded && hasChildren && (
          <div>
            {item.children!.map((child) => renderItem(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-2">
        <input
          type="text"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-black/30 border border-gray-700/50 rounded px-2 py-1 text-sm outline-none focus:border-blue-500"
        />
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-auto">
        {sampleHierarchy.map((item) => renderItem(item))}
      </div>

      {/* Actions */}
      <div className="p-2 border-t border-gray-700/50">
        <div className="flex gap-1">
          <button className="flex-1 px-2 py-1 text-xs bg-blue-600/50 hover:bg-blue-600 rounded transition-colors">
            + Add
          </button>
          <button className="px-2 py-1 text-xs bg-red-600/30 hover:bg-red-600 rounded transition-colors">
            🗑
          </button>
        </div>
      </div>
    </div>
  )
}

export default HierarchyPanel
