import React, { useState } from 'react'

interface Asset {
  id: string
  name: string
  type: 'folder' | 'mesh' | 'material' | 'texture' | 'script' | 'prefab' | 'scene'
  children?: Asset[]
}

const sampleAssets: Asset[] = [
  {
    id: 'models',
    name: 'Models',
    type: 'folder',
    children: [
      { id: 'cube-mesh', name: 'Cube.fbx', type: 'mesh' },
      { id: 'sphere-mesh', name: 'Sphere.fbx', type: 'mesh' },
      { id: 'character-mesh', name: 'Character.fbx', type: 'mesh' },
    ],
  },
  {
    id: 'materials',
    name: 'Materials',
    type: 'folder',
    children: [
      { id: 'metal-mat', name: 'Metal.mat', type: 'material' },
      { id: 'wood-mat', name: 'Wood.mat', type: 'material' },
      { id: 'glass-mat', name: 'Glass.mat', type: 'material' },
    ],
  },
  {
    id: 'textures',
    name: 'Textures',
    type: 'folder',
    children: [
      { id: 'diffuse-tex', name: 'Diffuse.png', type: 'texture' },
      { id: 'normal-tex', name: 'Normal.png', type: 'texture' },
      { id: 'roughness-tex', name: 'Roughness.png', type: 'texture' },
    ],
  },
  {
    id: 'scripts',
    name: 'Scripts',
    type: 'folder',
    children: [
      { id: 'player-script', name: 'PlayerController.ts', type: 'script' },
      { id: 'enemy-script', name: 'EnemyAI.ts', type: 'script' },
    ],
  },
  {
    id: 'prefabs',
    name: 'Prefabs',
    type: 'folder',
    children: [
      { id: 'player-prefab', name: 'Player.prefab', type: 'prefab' },
      { id: 'enemy-prefab', name: 'Enemy.prefab', type: 'prefab' },
    ],
  },
  {
    id: 'scenes',
    name: 'Scenes',
    type: 'folder',
    children: [
      { id: 'main-scene', name: 'MainScene.scene', type: 'scene' },
      { id: 'test-scene', name: 'TestScene.scene', type: 'scene' },
    ],
  },
]

export const AssetBrowser: React.FC = () => {
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(['models', 'materials', 'prefabs'])
  )
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [currentPath, setCurrentPath] = useState<string[]>(['Assets'])

  const toggleFolder = (id: string) => {
    const newExpanded = new Set(expandedFolders)
    if (newExpanded.has(id)) {
      newExpanded.delete(id)
    } else {
      newExpanded.add(id)
    }
    setExpandedFolders(newExpanded)
  }

  const getAssetIcon = (type: Asset['type']): string => {
    switch (type) {
      case 'folder':
        return '📁'
      case 'mesh':
        return '🎲'
      case 'material':
        return '🎨'
      case 'texture':
        return '🖼️'
      case 'script':
        return '📜'
      case 'prefab':
        return '📦'
      case 'scene':
        return '🌍'
      default:
        return '📄'
    }
  }

  const getAssetColor = (type: Asset['type']): string => {
    switch (type) {
      case 'folder':
        return 'text-yellow-400'
      case 'mesh':
        return 'text-blue-400'
      case 'material':
        return 'text-purple-400'
      case 'texture':
        return 'text-green-400'
      case 'script':
        return 'text-orange-400'
      case 'prefab':
        return 'text-cyan-400'
      case 'scene':
        return 'text-pink-400'
      default:
        return 'text-gray-400'
    }
  }

  const renderAssetTree = (asset: Asset, depth: number = 0) => {
    const isExpanded = expandedFolders.has(asset.id)
    const isSelected = selectedAsset === asset.id
    const hasChildren = asset.children && asset.children.length > 0

    return (
      <div key={asset.id}>
        <div
          className={`flex items-center px-2 py-1 cursor-pointer transition-colors ${
            isSelected ? 'bg-blue-600/30' : 'hover:bg-white/5'
          }`}
          style={{ paddingLeft: `${4 + depth * 12}px` }}
          onClick={() => {
            setSelectedAsset(asset.id)
            if (asset.type === 'folder') {
              toggleFolder(asset.id)
            }
          }}
          onDoubleClick={() => {
            if (asset.type === 'folder') {
              setCurrentPath([...currentPath, asset.name])
            }
          }}
        >
          {asset.type === 'folder' && (
            <span className="mr-1 text-xs text-gray-500 w-3">
              {hasChildren ? (isExpanded ? '▼' : '▶') : ''}
            </span>
          )}
          <span className={`mr-2 text-sm ${getAssetColor(asset.type)}`}>
            {getAssetIcon(asset.type)}
          </span>
          <span className="text-xs truncate">{asset.name}</span>
        </div>

        {isExpanded && hasChildren && (
          <div>
            {asset.children!.map((child) => renderAssetTree(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  const renderGridView = () => {
    const getAllAssets = (assets: Asset[]): Asset[] => {
      return assets.flatMap(a => a.children ? [a, ...getAllAssets(a.children)] : [a])
    }
    
    const flatAssets = getAllAssets(sampleAssets).filter(a => a.type !== 'folder')

    return (
      <div className="grid grid-cols-4 gap-2 p-2">
        {flatAssets.slice(0, 12).map((asset) => (
          <div
            key={asset.id}
            className={`flex flex-col items-center p-2 rounded cursor-pointer transition-colors ${
              selectedAsset === asset.id ? 'bg-blue-600/30' : 'hover:bg-white/10'
            }`}
            onClick={() => setSelectedAsset(asset.id)}
          >
            <div className={`text-2xl mb-1 ${getAssetColor(asset.type)}`}>
              {getAssetIcon(asset.type)}
            </div>
            <span className="text-xs text-center truncate w-full">{asset.name}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* Folder Tree (Left) */}
      <div className="w-40 border-r border-gray-700/50 overflow-auto">
        <div className="py-1">
          {sampleAssets.map((asset) => renderAssetTree(asset))}
        </div>
      </div>

      {/* Content Area (Right) */}
      <div className="flex-1 flex flex-col">
        {/* Breadcrumb & View Toggle */}
        <div className="flex items-center justify-between px-2 py-1 border-b border-gray-700/50 bg-black/20">
          <div className="flex items-center text-xs text-gray-400">
            {currentPath.map((p, i) => (
              <span key={i}>
                {i > 0 && <span className="mx-1">/</span>}
                <span className="hover:text-white cursor-pointer">{p}</span>
              </span>
            ))}
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1 rounded ${viewMode === 'grid' ? 'bg-blue-600/50' : 'hover:bg-white/10'}`}
              title="Grid View"
            >
              <span className="text-xs">⊞</span>
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1 rounded ${viewMode === 'list' ? 'bg-blue-600/50' : 'hover:bg-white/10'}`}
              title="List View"
            >
              <span className="text-xs">☰</span>
            </button>
          </div>
        </div>

        {/* Assets Display */}
        <div className="flex-1 overflow-auto">
          {viewMode === 'grid' ? renderGridView() : (
            <div className="p-1">
              {sampleAssets.map((asset) => renderAssetTree(asset))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default AssetBrowser
