import React, { useCallback, useEffect, useState, useMemo } from 'react'
import * as THREE from 'three'
import { useEditorStore } from '../store/editorStore'
import { useI18n } from '../i18n/translations'
import { AssetLoader } from '../../engine/assets/AssetLoader'
import { AssetEntry, projectAssetUrl } from '../../shared/assetProtocol'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { createEntityWithComponentsCommand } from '../commands/entityCommands'
import { Icons } from '../ui/Icons'

/**
 * Files in the project's assets/ folder with thumbnails: glb/gltf/obj models are rendered, HDR/EXR
 * environments are shown tone-mapped, images as themselves. Models can be added to the scene.
 */

const THUMB_W = 128
const THUMB_H = 96
const thumbCache = new Map<string, Promise<string>>()

let rig: { renderer: THREE.WebGLRenderer; loader: AssetLoader; room: THREE.Texture } | null = null

function getRig() {
  if (rig) return rig
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setSize(THUMB_W, THUMB_H, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.AgXToneMapping
  const loader = new AssetLoader({ resolveUrl: projectAssetUrl, decoderPath: new URL('decoders/', document.baseURI).href, renderer })
  const pmrem = new THREE.PMREMGenerator(renderer)
  const room = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  pmrem.dispose()
  rig = { renderer, loader, room }
  return rig
}

async function renderModelThumb(path: string): Promise<string> {
  const { renderer, loader, room } = getRig()
  const { root } = await loader.loadModel(path)
  const scene = new THREE.Scene()
  scene.environment = room
  const key = new THREE.DirectionalLight(0xffffff, 2.5)
  key.position.set(2, 3, 2)
  scene.add(key, root)
  const box = new THREE.Box3().setFromObject(root)
  const sphere = box.getBoundingSphere(new THREE.Sphere())
  const camera = new THREE.PerspectiveCamera(30, THUMB_W / THUMB_H, 0.001, 1000)
  const dist = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(15))) * 1.05
  camera.position.copy(sphere.center).add(new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(dist))
  camera.near = dist / 100
  camera.far = dist * 10
  camera.lookAt(sphere.center)
  camera.updateProjectionMatrix()
  renderer.setClearColor(0x000000, 0)
  renderer.render(scene, camera)
  return renderer.domElement.toDataURL('image/png')
}

async function renderEnvThumb(path: string): Promise<string> {
  const { renderer, loader } = getRig()
  const tex = await loader.loadEnvironment(path)
  const scene = new THREE.Scene()
  scene.background = tex
  const camera = new THREE.PerspectiveCamera(80, THUMB_W / THUMB_H, 0.1, 10)
  camera.lookAt(0, 0.1, -1)
  renderer.render(scene, camera)
  return renderer.domElement.toDataURL('image/png')
}

function thumbnail(asset: AssetEntry): Promise<string> | null {
  if (asset.kind === 'texture' && !/\.ktx2$/i.test(asset.path)) return Promise.resolve(projectAssetUrl(asset.path))
  if (asset.kind !== 'model' && asset.kind !== 'environment') return null
  let p = thumbCache.get(asset.path)
  if (!p) {
    p = asset.kind === 'model' ? renderModelThumb(asset.path) : renderEnvThumb(asset.path)
    thumbCache.set(asset.path, p)
  }
  return p
}

const Thumb: React.FC<{ asset: AssetEntry }> = ({ asset }) => {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    thumbnail(asset)?.then(
      (url) => alive && setSrc(url),
      () => alive && setFailed(true)
    )
    return () => {
      alive = false
    }
  }, [asset.path])

  const icon = {
    model: <Icons.Box className="w-6 h-6 text-blue-400" />,
    environment: <Icons.Sparkles className="w-6 h-6 text-amber-400" />,
    texture: <Icons.Image className="w-6 h-6 text-purple-400" />,
    audio: <Icons.Volume2 className="w-6 h-6 text-emerald-400" />,
    other: <Icons.FileText className="w-6 h-6 text-gray-400" />,
  }[asset.kind]

  return (
    <div className="w-full aspect-[4/3] rounded bg-black/40 border border-gray-700/60 flex items-center justify-center overflow-hidden relative group-hover:border-blue-500/60 transition-colors">
      {src && !failed ? (
        <img src={src} alt="" className="w-full h-full object-contain" draggable={false} />
      ) : (
        <span className="opacity-70">{failed ? '!' : icon}</span>
      )}
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const AssetBrowser: React.FC = () => {
  const { t } = useI18n()
  const { executeCommand, projectPath } = useEditorStore()
  const [assets, setAssets] = useState<AssetEntry[]>([])
  const [filter, setFilter] = useState<'all' | AssetEntry['kind']>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [sortBy, setSortBy] = useState<'name' | 'size'>('name')
  const [selectedAssetPath, setSelectedAssetPath] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    const api = window.electronAPI
    if (!api?.listAssets) {
      setError('Daftar aset hanya tersedia di aplikasi desktop')
      return
    }
    setIsLoading(true)
    api.listAssets().then(
      (list: AssetEntry[]) => {
        setAssets(list)
        setError(null)
        setIsLoading(false)
      },
      (err: any) => {
        setError(String(err?.message ?? err))
        setIsLoading(false)
      }
    )
  }, [])

  useEffect(() => {
    thumbCache.clear()
    refresh()
  }, [projectPath, refresh])

  const addToScene = (asset: AssetEntry) => {
    const name = asset.path.split('/').pop()!.replace(/\.[^.]+$/, '')
    executeCommand(createEntityWithComponentsCommand(name, { Model: { src: asset.path, collider: 'box' } }))
  }

  const filteredAssets = useMemo(() => {
    let list = assets.filter((a) => filter === 'all' || a.kind === filter)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter((a) => a.path.toLowerCase().includes(q))
    }
    return list.sort((a, b) => {
      if (sortBy === 'name') {
        const nameA = a.path.split('/').pop() || a.path
        const nameB = b.path.split('/').pop() || b.path
        return nameA.localeCompare(nameB)
      }
      return (b.size || 0) - (a.size || 0)
    })
  }, [assets, filter, searchQuery, sortBy])

  const selectedAsset = useMemo(() => {
    return assets.find((a) => a.path === selectedAssetPath) || null
  }, [assets, selectedAssetPath])

  return (
    <div className="h-full flex flex-col text-xs text-gray-200 select-none bg-[#16213e]">
      {/* Top Filter & Search Bar */}
      <div className="flex items-center justify-between gap-3 px-3 py-1.5 border-b border-gray-700/50 bg-[#141e38]">
        {/* Category Filter Pills */}
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-gray-400 font-mono mr-1">assets/</span>
          {(['all', 'model', 'environment', 'texture', 'audio'] as const).map((kind) => {
            const labels: Record<string, string> = {
              all: 'All',
              model: '3D Models',
              environment: 'HDR',
              texture: 'Textures',
              audio: 'Audio',
            }
            const active = filter === kind
            return (
              <button
                key={kind}
                onClick={() => setFilter(kind)}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  active ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {labels[kind]}
              </button>
            )
          })}
        </div>

        {/* Right Search, Sort & Refresh Controls */}
        <div className="flex items-center gap-2">
          {/* Search Box */}
          <div className="relative">
            <Icons.Search className="w-3.5 h-3.5 text-gray-400 absolute left-2 top-1.5 pointer-events-none" />
            <input
              type="text"
              placeholder={t('assets.search_placeholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-black/30 border border-gray-700/60 rounded pl-7 pr-2 py-0.5 text-[11px] text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 w-32 focus:w-44 transition-all"
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

          {/* Sort Dropdown */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="bg-black/30 border border-gray-700/60 rounded px-2 py-0.5 text-[11px] text-gray-300 focus:outline-none"
          >
            <option value="name">Name (A-Z)</option>
            <option value="size">Size</option>
          </select>

          {/* Refresh Button */}
          <button
            onClick={refresh}
            className={`p-1 rounded hover:bg-white/10 text-gray-300 transition-colors ${isLoading ? 'animate-spin' : ''}`}
            title={t('assets.refresh')}
          >
            <Icons.RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Asset Grid */}
      <div className="flex-1 overflow-y-auto p-3">
        {error && (
          <div className="p-4 text-center text-gray-400 bg-red-950/20 rounded border border-red-800/40 my-2">
            <p className="font-semibold text-red-300 mb-1">Asset Loading Error</p>
            <p className="text-[11px]">{error}</p>
          </div>
        )}

        {!error && filteredAssets.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-2">
            <Icons.Box className="w-10 h-10 opacity-30 text-gray-400" />
            <p className="text-xs font-medium">{t('assets.no_assets')}</p>
            <p className="text-[11px] opacity-70">
              Import 3D models (.glb/.gltf), HDR, or textures into the <code className="text-gray-400">assets/</code> folder.
            </p>
          </div>
        )}

        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))' }}
        >
          {filteredAssets.map((a) => {
            const fileName = a.path.split('/').pop() || a.path
            const ext = fileName.includes('.') ? fileName.split('.').pop()!.toUpperCase() : ''
            const isSelected = selectedAssetPath === a.path

            return (
              <div
                key={a.path}
                className={`flex flex-col gap-1.5 p-2 rounded-lg cursor-pointer group border transition-all ${
                  isSelected
                    ? 'bg-blue-600/20 border-blue-500 shadow-sm'
                    : 'bg-white/[0.02] border-transparent hover:border-gray-700/60 hover:bg-white/[0.05]'
                }`}
                onClick={() => setSelectedAssetPath(a.path)}
                title={`${a.path} (${formatFileSize(a.size)})`}
              >
                <div className="relative">
                  <Thumb asset={a} />
                  {ext && (
                    <span className="absolute top-1 right-1 px-1 py-0.2 rounded text-[9px] font-mono font-bold bg-black/60 backdrop-blur-xs text-gray-300 border border-white/10">
                      {ext}
                    </span>
                  )}
                </div>

                <div className="flex flex-col min-w-0">
                  <div className="truncate text-[11px] font-medium text-gray-200 group-hover:text-white" title={fileName}>
                    {fileName}
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-gray-400 mt-0.5">
                    <span className="capitalize">{a.kind}</span>
                    <span>{formatFileSize(a.size)}</span>
                  </div>
                </div>

                {a.kind === 'model' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      addToScene(a)
                    }}
                    className="w-full mt-1 py-0.5 px-1.5 bg-blue-600/80 hover:bg-blue-500 text-white rounded text-[10px] font-medium text-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
                  >
                    + Add to Scene
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Asset Status & Inspector Footer */}
      <div className="px-3 py-1 border-t border-gray-700/50 bg-[#121b33] flex items-center justify-between text-[11px] text-gray-400">
        <span>{filteredAssets.length} asset{filteredAssets.length !== 1 ? 's' : ''}</span>
        {selectedAsset ? (
          <div className="flex items-center gap-3 truncate">
            <span className="truncate">
              Selected: <strong className="text-gray-200">{selectedAsset.path}</strong> ({formatFileSize(selectedAsset.size)})
            </span>
            <button
              onClick={() => navigator.clipboard?.writeText(selectedAsset.path)}
              className="text-[10px] hover:text-white px-1.5 py-0.5 rounded bg-white/5 border border-gray-700/40 flex items-center gap-1"
            >
              <Icons.Copy className="w-3 h-3" />
              <span>Copy Path</span>
            </button>
          </div>
        ) : (
          <span className="text-[10px] opacity-60">Click an asset to view details</span>
        )}
      </div>
    </div>
  )
}

export default AssetBrowser
