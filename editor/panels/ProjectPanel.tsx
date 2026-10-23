import React, { useState } from 'react'
import { useEditorStore } from '../store/editorStore'
import { instantiatePrefabCommand } from '../commands/prefabAndEventCommands'
import type { PrefabAsset } from '../../engine/scene/prefab'

export interface ProjectAssetItem {
  id: string
  name: string
  type: 'folder' | 'prefab' | 'scene' | 'material' | 'asset'
  path: string
  data?: any
}

export const ProjectPanel: React.FC = () => {
  const { world, executeCommand, selectEntity } = useEditorStore()

  const [currentFolder, setCurrentFolder] = useState<string>('assets')
  const [assets, setAssets] = useState<ProjectAssetItem[]>([
    { id: '1', name: 'prefabs', type: 'folder', path: 'assets/prefabs' },
    { id: '2', name: 'scenes', type: 'folder', path: 'assets/scenes' },
    { id: '3', name: 'materials', type: 'folder', path: 'assets/materials' },
    { id: '4', name: 'scripts', type: 'folder', path: 'assets/scripts' },
  ])

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

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

    // Add to project assets
    const newAsset: ProjectAssetItem = {
      id: String(Date.now()),
      name: prefabFileName,
      type: 'prefab',
      path: prefabPath,
      data: prefabAsset,
    }

    setAssets((prev) => [...prev, newAsset])

    // Convert entity in scene to prefab instance (blue)
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

    // Count existing instances with this name
    const baseName = asset.name.replace(/\.lprefab$/, '')
    const existingCount = world.getEntities().filter((e) => e.name.startsWith(baseName)).length
    const instanceName = existingCount === 0 ? baseName : `${baseName} (${existingCount})`

    executeCommand(instantiatePrefabCommand(asset.data, asset.path, instanceName))
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
      <div className="w-48 border-r border-gray-700/50 bg-[#121b33] p-2 flex flex-col gap-1">
        <div className="text-[11px] font-semibold text-gray-400 uppercase mb-1">Folders</div>
        {['assets', 'assets/prefabs', 'assets/scenes', 'assets/materials', 'assets/scripts'].map((f) => (
          <div
            key={f}
            className={`px-2 py-1 rounded cursor-pointer flex items-center gap-1.5 ${
              currentFolder === f ? 'bg-blue-600 text-white font-medium' : 'hover:bg-white/5 text-gray-300'
            }`}
            onClick={() => setCurrentFolder(f)}
          >
            <span>📁</span>
            <span className="truncate">{f.split('/').pop()}</span>
          </div>
        ))}
      </div>

      {/* Right asset grid */}
      <div className="flex-1 p-3 overflow-y-auto">
        <div className="flex items-center justify-between pb-2 mb-3 border-b border-gray-700/40 text-gray-400">
          <span>{currentFolder}</span>
          <button
            className="px-2 py-0.5 bg-blue-700 hover:bg-blue-600 text-white rounded text-[11px]"
            onClick={(e) => {
              e.stopPropagation()
              setContextMenu({ x: e.clientX, y: e.clientY })
            }}
          >
            + Create ▾
          </button>
        </div>

        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-3">
          {assets.map((asset) => (
            <div
              key={asset.id}
              className="flex flex-col items-center p-2 rounded hover:bg-white/5 cursor-pointer text-center group border border-transparent hover:border-gray-700/60"
              draggable={asset.type === 'prefab'}
              onDragStart={(e) => handleDragPrefabStart(e, asset)}
              onDoubleClick={() => {
                if (asset.type === 'folder') {
                  setCurrentFolder(asset.path)
                } else if (asset.type === 'prefab') {
                  handleInstantiatePrefab(asset)
                }
              }}
            >
              <div className="text-3xl mb-1">
                {asset.type === 'folder' && '📁'}
                {asset.type === 'prefab' && '📦'}
                {asset.type === 'scene' && '🎬'}
                {asset.type === 'material' && '🎨'}
                {asset.type === 'asset' && '📄'}
              </div>
              <span className={`text-[11px] truncate w-full ${asset.type === 'prefab' ? 'text-blue-400' : 'text-gray-300'}`}>
                {asset.name}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Context Create Menu */}
      {contextMenu && (
        <div
          className="fixed bg-[#16213e] border border-gray-700/80 rounded shadow-2xl z-50 min-w-44 py-1 text-xs text-gray-200"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-blue-600/50"
            onClick={() => {
              const name = window.prompt('Folder name:')
              if (name) {
                setAssets((prev) => [
                  ...prev,
                  { id: String(Date.now()), name, type: 'folder', path: `${currentFolder}/${name}` },
                ])
              }
              setContextMenu(null)
            }}
          >
            Folder
          </button>
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-blue-600/50"
            onClick={() => handleCreatePrefabVariant('Door')}
          >
            Prefab Variant
          </button>
          <div className="relative group">
            <button className="w-full text-left px-3 py-1.5 hover:bg-blue-600/50 flex items-center justify-between">
              <span>Game</span>
              <span>▶</span>
            </button>
            <div className="hidden group-hover:block absolute left-full top-0 bg-[#16213e] border border-gray-700/80 rounded shadow-2xl min-w-36 py-1">
              <button
                className="w-full text-left px-3 py-1 hover:bg-blue-600/50"
                onClick={() => handleCreateDataAsset('WeaponData')}
              >
                Weapon Data
              </button>
            </div>
          </div>
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-blue-600/50"
            onClick={() => {
              setAssets((prev) => [
                ...prev,
                { id: String(Date.now()), name: 'New Material.mat', type: 'material', path: `${currentFolder}/New Material.mat` },
              ])
              setContextMenu(null)
            }}
          >
            Material
          </button>
        </div>
      )}
    </div>
  )
}

export default ProjectPanel
