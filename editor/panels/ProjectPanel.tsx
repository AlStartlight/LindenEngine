import React, { useState, useMemo } from 'react'
import { useEditorStore } from '../store/editorStore'
import { instantiatePrefabCommand } from '../commands/prefabAndEventCommands'
import type { PrefabAsset } from '../../engine/scene/prefab'
import { Icons } from '../ui/Icons'

export interface ProjectAssetItem {
  id: string
  name: string
  type: 'folder' | 'prefab' | 'scene' | 'material' | 'asset' | 'script'
  path: string
  size?: number
  data?: any
}

export const ProjectPanel: React.FC = () => {
  const { world, executeCommand } = useEditorStore()

  const [currentFolder, setCurrentFolder] = useState<string>('assets')
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [sortBy, setSortBy] = useState<'name' | 'type'>('name')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')

  // Creation modal/inline prompt state
  const [createModal, setCreateModal] = useState<{
    type: 'folder' | 'prefab' | 'asset' | 'material' | 'scene'
    defaultValue: string
  } | null>(null)
  const [createInputValue, setCreateInputValue] = useState<string>('')

  // Rename modal state
  const [renameTarget, setRenameTarget] = useState<ProjectAssetItem | null>(null)
  const [renameInputValue, setRenameInputValue] = useState<string>('')

  const [assets, setAssets] = useState<ProjectAssetItem[]>([
    { id: '1', name: 'prefabs', type: 'folder', path: 'assets/prefabs' },
    { id: '2', name: 'scenes', type: 'folder', path: 'assets/scenes' },
    { id: '3', name: 'materials', type: 'folder', path: 'assets/materials' },
    { id: '4', name: 'scripts', type: 'folder', path: 'assets/scripts' },
    { id: '5', name: 'Player.lprefab', type: 'prefab', path: 'assets/prefabs/Player.lprefab', size: 4096, data: { format: 'linden-prefab', version: 1, root: 'root', entities: [] } },
    { id: '6', name: 'Main.lscene', type: 'scene', path: 'assets/scenes/Main.lscene', size: 12400 },
    { id: '7', name: 'DefaultMaterial.mat', type: 'material', path: 'assets/materials/DefaultMaterial.mat', size: 1024 },
  ])

  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    targetItem?: ProjectAssetItem
  } | null>(null)

  // Discovered folders
  const allFolders = useMemo(() => {
    const set = new Set<string>(['assets', 'assets/prefabs', 'assets/scenes', 'assets/materials', 'assets/scripts'])
    for (const a of assets) {
      if (a.type === 'folder') {
        set.add(a.path)
      } else {
        const parent = a.path.substring(0, a.path.lastIndexOf('/'))
        if (parent) set.add(parent)
      }
    }
    return Array.from(set).sort()
  }, [assets])

  // Items in current folder
  const currentItems = useMemo(() => {
    let items = assets.filter((a) => {
      // Direct child of current folder
      if (a.path === currentFolder) return false
      const parent = a.path.substring(0, a.path.lastIndexOf('/'))
      return parent === currentFolder
    })

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      items = assets.filter((a) => a.name.toLowerCase().includes(q))
    }

    return items.sort((a, b) => {
      // Folders always first in grid/list
      if (a.type === 'folder' && b.type !== 'folder') return -1
      if (a.type !== 'folder' && b.type === 'folder') return 1

      let cmp = 0
      if (sortBy === 'name') cmp = a.name.localeCompare(b.name)
      else if (sortBy === 'type') cmp = a.type.localeCompare(b.type)
      return sortOrder === 'asc' ? cmp : -cmp
    })
  }, [assets, currentFolder, searchQuery, sortBy, sortOrder])

  const selectedItem = useMemo(() => {
    return assets.find((a) => a.id === selectedAssetId) || null
  }, [assets, selectedAssetId])

  // Breadcrumbs parsing
  const breadcrumbs = useMemo(() => {
    const parts = currentFolder.split('/')
    const result: Array<{ name: string; path: string }> = []
    let acc = ''
    for (const p of parts) {
      acc = acc ? `${acc}/${p}` : p
      result.push({ name: p, path: acc })
    }
    return result
  }, [currentFolder])

  const handleCreatePrefabVariant = (baseAssetName: string = 'Door') => {
    const variantName = `${baseAssetName}Variant`
    const newAsset: ProjectAssetItem = {
      id: String(Date.now()),
      name: `${variantName}.lprefab`,
      type: 'prefab',
      path: `${currentFolder}/${variantName}.lprefab`,
      data: {
        format: 'linden-prefab',
        version: 1,
        basePrefab: `${currentFolder}/${baseAssetName}.lprefab`,
        root: 'root',
        entities: [],
      },
    }
    setAssets((prev) => [...prev, newAsset])
    setContextMenu(null)
  }

  const handleCreateDataAsset = (typeName: string = 'WeaponData') => {
    const newAsset: ProjectAssetItem = {
      id: String(Date.now()),
      name: `${typeName}.lasset`,
      type: 'asset',
      path: `${currentFolder}/${typeName}.lasset`,
      data: {
        format: 'linden-asset',
        version: 1,
        type: typeName,
        id: String(Date.now()),
        name: typeName,
        data: { damage: 10 },
      },
    }
    setAssets((prev) => [...prev, newAsset])
    setContextMenu(null)
  }

  const handleConfirmCreate = () => {
    if (!createModal || !createInputValue.trim()) return
    const name = createInputValue.trim()
    const path = `${currentFolder}/${name}`

    let newAsset: ProjectAssetItem
    switch (createModal.type) {
      case 'folder':
        newAsset = { id: String(Date.now()), name, type: 'folder', path }
        break
      case 'prefab': {
        const pName = name.endsWith('.lprefab') ? name : `${name}.lprefab`
        newAsset = {
          id: String(Date.now()),
          name: pName,
          type: 'prefab',
          path: `${currentFolder}/${pName}`,
          data: { format: 'linden-prefab', version: 1, root: 'root', entities: [] },
        }
        break
      }
      case 'material': {
        const mName = name.endsWith('.mat') ? name : `${name}.mat`
        newAsset = {
          id: String(Date.now()),
          name: mName,
          type: 'material',
          path: `${currentFolder}/${mName}`,
        }
        break
      }
      case 'scene': {
        const sName = name.endsWith('.lscene') ? name : `${name}.lscene`
        newAsset = {
          id: String(Date.now()),
          name: sName,
          type: 'scene',
          path: `${currentFolder}/${sName}`,
        }
        break
      }
      case 'asset':
      default: {
        const aName = name.endsWith('.lasset') ? name : `${name}.lasset`
        newAsset = {
          id: String(Date.now()),
          name: aName,
          type: 'asset',
          path: `${currentFolder}/${aName}`,
          data: { format: 'linden-asset', version: 1, type: name, id: String(Date.now()) },
        }
        break
      }
    }

    setAssets((prev) => [...prev, newAsset])
    setCreateModal(null)
    setCreateInputValue('')
  }

  const handleConfirmRename = () => {
    if (!renameTarget || !renameInputValue.trim()) return
    const newName = renameInputValue.trim()
    const parent = renameTarget.path.substring(0, renameTarget.path.lastIndexOf('/'))
    const newPath = `${parent}/${newName}`

    setAssets((prev) =>
      prev.map((item) => (item.id === renameTarget.id ? { ...item, name: newName, path: newPath } : item))
    )
    setRenameTarget(null)
    setRenameInputValue('')
  }

  const handleDeleteItem = (item: ProjectAssetItem) => {
    setAssets((prev) => prev.filter((a) => a.id !== item.id && !a.path.startsWith(`${item.path}/`)))
    if (selectedAssetId === item.id) setSelectedAssetId(null)
    setContextMenu(null)
  }

  const handleDuplicateItem = (item: ProjectAssetItem) => {
    const ext = item.name.includes('.') ? item.name.substring(item.name.lastIndexOf('.')) : ''
    const base = item.name.includes('.') ? item.name.substring(0, item.name.lastIndexOf('.')) : item.name
    const copyName = `${base}Copy${ext}`
    const copyPath = `${currentFolder}/${copyName}`

    const newItem: ProjectAssetItem = {
      ...item,
      id: String(Date.now()),
      name: copyName,
      path: copyPath,
    }
    setAssets((prev) => [...prev, newItem])
    setContextMenu(null)
  }

  // Handle drop of entity from Hierarchy to Project folder to create .lprefab
  const handleDropOnProject = (e: React.DragEvent) => {
    e.preventDefault()
    const entityId = e.dataTransfer.getData('text/plain')
    if (!entityId) return

    const ent = world.getEntity(entityId)
    if (!ent) return

    const prefabAsset: PrefabAsset = {
      format: 'linden-prefab',
      version: 1,
      root: ent.id,
      entities: [ent.serialize()],
    }

    const prefabFileName = `${ent.name}.lprefab`
    const prefabPath = `${currentFolder}/${prefabFileName}`

    const newAsset: ProjectAssetItem = {
      id: String(Date.now()),
      name: prefabFileName,
      type: 'prefab',
      path: prefabPath,
      data: prefabAsset,
    }

    setAssets((prev) => [...prev, newAsset])

    ent.prefab = {
      asset: prefabPath,
      overrides: [],
    }
  }

  const handleDragPrefabStart = (e: React.DragEvent, asset: ProjectAssetItem) => {
    if (asset.type === 'prefab') {
      e.dataTransfer.setData('application/linden-prefab', JSON.stringify(asset.data || {}))
      e.dataTransfer.setData('application/linden-prefab-path', asset.path)
    }
  }

  const handleInstantiatePrefab = (asset: ProjectAssetItem) => {
    if (asset.type !== 'prefab' || !asset.data) return

    const baseName = asset.name.replace(/\.lprefab$/, '')
    const existingCount = world.getEntities().filter((e) => e.name.startsWith(baseName)).length
    const instanceName = existingCount === 0 ? baseName : `${baseName} (${existingCount})`

    executeCommand(instantiatePrefabCommand(asset.data, asset.path, instanceName))
  }

  const getItemIcon = (type: ProjectAssetItem['type']) => {
    switch (type) {
      case 'folder':
        return <Icons.Folder className="w-5 h-5 text-amber-400" />
      case 'prefab':
        return <Icons.Box className="w-5 h-5 text-blue-400" />
      case 'scene':
        return <Icons.Play className="w-5 h-5 text-emerald-400" />
      case 'material':
        return <Icons.Sparkles className="w-5 h-5 text-purple-400" />
      case 'script':
        return <Icons.FileCode className="w-5 h-5 text-cyan-400" />
      case 'asset':
      default:
        return <Icons.FileText className="w-5 h-5 text-gray-300" />
    }
  }

  return (
    <div
      className="flex h-full bg-[#16213e] text-gray-200 text-xs overflow-hidden select-none"
      onClick={() => setContextMenu(null)}
      onContextMenu={(e) => {
        e.preventDefault()
        setContextMenu({ x: e.clientX, y: e.clientY })
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDropOnProject}
    >
      {/* Left folder tree */}
      <div className="w-52 border-r border-gray-700/50 bg-[#121b33] flex flex-col shrink-0">
        <div className="px-3 py-2 border-b border-gray-700/40 text-[11px] font-semibold text-gray-400 uppercase tracking-wider flex items-center justify-between">
          <span>Folders</span>
          <button
            onClick={() => {
              setCreateModal({ type: 'folder', defaultValue: 'NewFolder' })
              setCreateInputValue('NewFolder')
            }}
            className="hover:text-white p-0.5 rounded hover:bg-white/10"
            title="Create Folder"
          >
            <Icons.Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
          {allFolders.map((f) => {
            const depth = f.split('/').length - 1
            const label = f.split('/').pop() || f
            const isSelected = currentFolder === f
            const count = assets.filter((a) => a.path.startsWith(`${f}/`) && !a.path.replace(`${f}/`, '').includes('/')).length

            return (
              <div
                key={f}
                className={`px-2 py-1.5 rounded cursor-pointer flex items-center gap-1.5 transition-colors group ${
                  isSelected ? 'bg-blue-600 text-white font-medium' : 'hover:bg-white/5 text-gray-300'
                }`}
                style={{ paddingLeft: `${Math.max(8, depth * 12 + 8)}px` }}
                onClick={() => setCurrentFolder(f)}
              >
                <Icons.Folder className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-white' : 'text-amber-400'}`} />
                <span className="truncate flex-1 text-[11px]">{label}</span>
                {count > 0 && (
                  <span
                    className={`text-[10px] px-1 rounded ${
                      isSelected ? 'bg-blue-700 text-white' : 'text-gray-400 group-hover:text-gray-300'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Main Content Pane */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Navigation, Breadcrumb & Action Toolbar */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-700/50 bg-[#141e38] gap-3">
          {/* Breadcrumbs */}
          <div className="flex items-center gap-1 overflow-x-auto text-[11px]">
            {breadcrumbs.map((crumb, idx) => (
              <React.Fragment key={crumb.path}>
                {idx > 0 && <span className="text-gray-500">/</span>}
                <button
                  onClick={() => setCurrentFolder(crumb.path)}
                  className={`hover:text-blue-400 transition-colors font-medium ${
                    idx === breadcrumbs.length - 1 ? 'text-white' : 'text-gray-400'
                  }`}
                >
                  {crumb.name}
                </button>
              </React.Fragment>
            ))}
          </div>

          {/* Search, View Toggles & Actions */}
          <div className="flex items-center gap-2">
            {/* Search Input */}
            <div className="relative">
              <Icons.Search className="w-3.5 h-3.5 text-gray-400 absolute left-2 top-1.5 pointer-events-none" />
              <input
                type="text"
                placeholder="Search project..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-black/30 border border-gray-700/60 rounded pl-7 pr-2 py-0.5 text-[11px] text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 w-36 focus:w-48 transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-1.5 top-1 text-gray-400 hover:text-white text-xs"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Sort Toggle */}
            <button
              onClick={() => {
                if (sortBy === 'name') setSortBy('type')
                else {
                  setSortBy('name')
                  setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
                }
              }}
              className="px-2 py-0.5 rounded bg-black/20 hover:bg-white/10 border border-gray-700/50 text-[11px] text-gray-300 flex items-center gap-1"
              title={`Sort by ${sortBy} (${sortOrder})`}
            >
              <span>{sortBy === 'name' ? 'Name' : 'Type'}</span>
              <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>
            </button>

            {/* Grid / List View Toggle */}
            <div className="flex items-center rounded bg-black/20 border border-gray-700/50 p-0.5">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1 rounded ${viewMode === 'grid' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                title="Grid View"
              >
                <Icons.Grid className="w-3 h-3" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1 rounded ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                title="List View"
              >
                <Icons.List className="w-3 h-3" />
              </button>
            </div>

            {/* Create Dropdown Trigger */}
            <button
              className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-[11px] font-medium flex items-center gap-1 shadow"
              onClick={(e) => {
                e.stopPropagation()
                setContextMenu({ x: e.clientX, y: e.clientY })
              }}
            >
              <Icons.Plus className="w-3 h-3" />
              <span>Create</span>
            </button>
          </div>
        </div>

        {/* Assets Container */}
        <div className="flex-1 p-3 overflow-y-auto">
          {currentItems.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-2">
              <Icons.Folder className="w-8 h-8 opacity-40 text-gray-400" />
              <p className="text-xs">No items in this folder</p>
              <p className="text-[11px] opacity-60">Click "+ Create" or drag items from hierarchy</p>
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
              {currentItems.map((asset) => {
                const isSelected = selectedAssetId === asset.id
                return (
                  <div
                    key={asset.id}
                    className={`flex flex-col items-center p-2.5 rounded-lg cursor-pointer text-center group border transition-all ${
                      isSelected
                        ? 'bg-blue-600/20 border-blue-500 shadow-sm'
                        : 'bg-white/[0.02] border-transparent hover:border-gray-700/60 hover:bg-white/[0.06]'
                    }`}
                    draggable={asset.type === 'prefab'}
                    onDragStart={(e) => handleDragPrefabStart(e, asset)}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedAssetId(asset.id)
                    }}
                    onDoubleClick={() => {
                      if (asset.type === 'folder') {
                        setCurrentFolder(asset.path)
                      } else if (asset.type === 'prefab') {
                        handleInstantiatePrefab(asset)
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setSelectedAssetId(asset.id)
                      setContextMenu({ x: e.clientX, y: e.clientY, targetItem: asset })
                    }}
                  >
                    <div className="w-12 h-12 rounded-md bg-black/30 border border-gray-700/40 flex items-center justify-center mb-1.5 shadow-inner group-hover:scale-105 transition-transform">
                      {getItemIcon(asset.type)}
                    </div>
                    <span
                      className={`text-[11px] truncate w-full font-medium ${
                        isSelected ? 'text-white' : asset.type === 'prefab' ? 'text-blue-300' : 'text-gray-300'
                      }`}
                      title={asset.name}
                    >
                      {asset.name}
                    </span>
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">{asset.type}</span>
                  </div>
                )
              })}
            </div>
          ) : (
            /* List View */
            <div className="divide-y divide-gray-700/30">
              <div className="flex items-center px-3 py-1 text-[10px] text-gray-500 font-semibold uppercase tracking-wider">
                <span className="flex-1">Name</span>
                <span className="w-24 text-center">Type</span>
                <span className="w-28 text-right">Path</span>
              </div>
              {currentItems.map((asset) => {
                const isSelected = selectedAssetId === asset.id
                return (
                  <div
                    key={asset.id}
                    className={`flex items-center px-3 py-1.5 rounded cursor-pointer transition-colors ${
                      isSelected ? 'bg-blue-600 text-white font-medium' : 'hover:bg-white/5 text-gray-300'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedAssetId(asset.id)
                    }}
                    onDoubleClick={() => {
                      if (asset.type === 'folder') {
                        setCurrentFolder(asset.path)
                      } else if (asset.type === 'prefab') {
                        handleInstantiatePrefab(asset)
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setSelectedAssetId(asset.id)
                      setContextMenu({ x: e.clientX, y: e.clientY, targetItem: asset })
                    }}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {getItemIcon(asset.type)}
                      <span className="truncate text-xs">{asset.name}</span>
                    </div>
                    <span className="w-24 text-center text-[11px] opacity-70 uppercase">{asset.type}</span>
                    <span className="w-28 text-right text-[10px] opacity-50 truncate">{asset.path}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Status / Selection Footer */}
        <div className="px-3 py-1 border-t border-gray-700/50 bg-[#121b33] flex items-center justify-between text-[11px] text-gray-400">
          <span>{currentItems.length} item{currentItems.length !== 1 ? 's' : ''}</span>
          {selectedItem && (
            <span className="truncate">
              Selected: <strong className="text-gray-200">{selectedItem.name}</strong> ({selectedItem.type})
            </span>
          )}
        </div>
      </div>

      {/* Non-blocking Creation Modal */}
      {createModal && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4"
          onClick={() => setCreateModal(null)}
        >
          <div
            className="bg-[#16213e] border border-gray-700/80 rounded-lg shadow-2xl p-4 w-80 max-w-full text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-white mb-2 capitalize">New {createModal.type}</h3>
            <p className="text-[11px] text-gray-400 mb-3">Enter the name for the new {createModal.type}:</p>
            <input
              type="text"
              autoFocus
              value={createInputValue}
              onChange={(e) => setCreateInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmCreate()
                if (e.key === 'Escape') setCreateModal(null)
              }}
              className="w-full bg-black/40 border border-gray-700 rounded px-2.5 py-1.5 text-xs text-white outline-none focus:border-blue-500 mb-4"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setCreateModal(null)}
                className="px-3 py-1 rounded hover:bg-white/10 text-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmCreate}
                className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium shadow"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {renameTarget && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4"
          onClick={() => setRenameTarget(null)}
        >
          <div
            className="bg-[#16213e] border border-gray-700/80 rounded-lg shadow-2xl p-4 w-80 max-w-full text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-white mb-2">Rename Item</h3>
            <input
              type="text"
              autoFocus
              value={renameInputValue}
              onChange={(e) => setRenameInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmRename()
                if (e.key === 'Escape') setRenameTarget(null)
              }}
              className="w-full bg-black/40 border border-gray-700 rounded px-2.5 py-1.5 text-xs text-white outline-none focus:border-blue-500 mb-4"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setRenameTarget(null)}
                className="px-3 py-1 rounded hover:bg-white/10 text-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRename}
                className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium shadow"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-[#16213e] border border-gray-700/80 rounded-md shadow-2xl z-50 min-w-44 py-1 text-xs text-gray-200 backdrop-blur-sm"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.targetItem ? (
            /* Context menu for specific item */
            <>
              <div className="px-3 py-1 text-[10px] text-gray-400 font-semibold truncate border-b border-gray-700/40 mb-1">
                {contextMenu.targetItem.name}
              </div>
              {contextMenu.targetItem.type === 'prefab' && (
                <button
                  className="w-full text-left px-3 py-1.5 hover:bg-blue-600/50 flex items-center gap-2"
                  onClick={() => {
                    handleInstantiatePrefab(contextMenu.targetItem!)
                    setContextMenu(null)
                  }}
                >
                  <Icons.Plus className="w-3.5 h-3.5" />
                  <span>Instantiate in Scene</span>
                </button>
              )}
              <button
                className="w-full text-left px-3 py-1.5 hover:bg-blue-600/50 flex items-center gap-2"
                onClick={() => handleDuplicateItem(contextMenu.targetItem!)}
              >
                <Icons.Copy className="w-3.5 h-3.5" />
                <span>Duplicate</span>
              </button>
              <button
                className="w-full text-left px-3 py-1.5 hover:bg-blue-600/50 flex items-center gap-2"
                onClick={() => {
                  setRenameTarget(contextMenu.targetItem!)
                  setRenameInputValue(contextMenu.targetItem!.name)
                  setContextMenu(null)
                }}
              >
                <span>✎</span>
                <span>Rename</span>
              </button>
              <button
                className="w-full text-left px-3 py-1.5 hover:bg-blue-600/50 flex items-center gap-2"
                onClick={() => {
                  navigator.clipboard?.writeText(contextMenu.targetItem!.path)
                  setContextMenu(null)
                }}
              >
                <Icons.Copy className="w-3.5 h-3.5" />
                <span>Copy Path</span>
              </button>
              <div className="border-t border-gray-700/40 my-1" />
              <button
                className="w-full text-left px-3 py-1.5 hover:bg-red-600/50 text-red-300 flex items-center gap-2"
                onClick={() => handleDeleteItem(contextMenu.targetItem!)}
              >
                <Icons.Trash className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
            </>
          ) : (
            /* Context menu for empty canvas area */
            <>
              <button
                className="w-full text-left px-3 py-1.5 hover:bg-blue-600/50 flex items-center gap-2"
                onClick={() => {
                  setCreateModal({ type: 'folder', defaultValue: 'NewFolder' })
                  setCreateInputValue('NewFolder')
                  setContextMenu(null)
                }}
              >
                <Icons.Folder className="w-3.5 h-3.5 text-amber-400" />
                <span>New Folder</span>
              </button>
              <button
                className="w-full text-left px-3 py-1.5 hover:bg-blue-600/50 flex items-center gap-2"
                onClick={() => {
                  setCreateModal({ type: 'prefab', defaultValue: 'NewPrefab' })
                  setCreateInputValue('NewPrefab')
                  setContextMenu(null)
                }}
              >
                <Icons.Box className="w-3.5 h-3.5 text-blue-400" />
                <span>New Prefab</span>
              </button>
              <button
                className="w-full text-left px-3 py-1.5 hover:bg-blue-600/50 flex items-center gap-2"
                onClick={() => handleCreatePrefabVariant('Door')}
              >
                <Icons.Box className="w-3.5 h-3.5 text-indigo-400" />
                <span>Prefab Variant</span>
              </button>
              <button
                className="w-full text-left px-3 py-1.5 hover:bg-blue-600/50 flex items-center gap-2"
                onClick={() => {
                  setCreateModal({ type: 'material', defaultValue: 'NewMaterial' })
                  setCreateInputValue('NewMaterial')
                  setContextMenu(null)
                }}
              >
                <Icons.Sparkles className="w-3.5 h-3.5 text-purple-400" />
                <span>New Material</span>
              </button>
              <button
                className="w-full text-left px-3 py-1.5 hover:bg-blue-600/50 flex items-center gap-2"
                onClick={() => handleCreateDataAsset('WeaponData')}
              >
                <Icons.FileText className="w-3.5 h-3.5 text-cyan-400" />
                <span>New Data Asset</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default ProjectPanel
