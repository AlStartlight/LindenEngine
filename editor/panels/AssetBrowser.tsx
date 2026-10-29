import React, { useCallback, useEffect, useState } from 'react'
import * as THREE from 'three'
import { useEditorStore } from '../store/editorStore'
import { AssetLoader } from '../../engine/assets/AssetLoader'
import { AssetEntry, projectAssetUrl } from '../../shared/assetProtocol'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { createEntityWithComponentsCommand } from '../commands/entityCommands'

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
  const icon = { model: '◆', environment: '◐', texture: '▦', audio: '♪', other: '•' }[asset.kind]
  return (
    <div className="w-full aspect-[4/3] rounded bg-black/40 border border-gray-700 flex items-center justify-center overflow-hidden">
      {src && !failed ? <img src={src} alt="" className="w-full h-full object-contain" draggable={false} /> : <span className="text-2xl text-gray-500">{failed ? '!' : icon}</span>}
    </div>
  )
}

export const AssetBrowser: React.FC = () => {
  const { executeCommand, projectPath } = useEditorStore()
  const [assets, setAssets] = useState<AssetEntry[]>([])
  const [filter, setFilter] = useState<'all' | AssetEntry['kind']>('all')
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    const api = window.electronAPI
    if (!api?.listAssets) {
      setError('Daftar aset hanya tersedia di aplikasi desktop')
      return
    }
    api.listAssets().then(
      (list: AssetEntry[]) => {
        setAssets(list)
        setError(null)
      },
      (err: any) => setError(String(err?.message ?? err))
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

  const shown = assets.filter((a) => filter === 'all' || a.kind === filter)
  return (
    <div className="h-full flex flex-col text-xs text-gray-200">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-gray-700/50">
        <span className="text-gray-400">assets/</span>
        <select value={filter} onChange={(e) => setFilter(e.target.value as any)} className="bg-black/40 border border-gray-700 rounded px-1 py-0.5">
          <option value="all">Semua</option>
          <option value="model">Model</option>
          <option value="environment">HDR</option>
          <option value="texture">Tekstur</option>
          <option value="audio">Audio</option>
        </select>
        <div className="flex-1" />
        <button onClick={refresh} className="px-2 py-0.5 rounded hover:bg-white/10 text-gray-300" title="Muat ulang daftar aset">
          ↻
        </button>
      </div>
      {error && <div className="p-3 text-gray-400">{error}</div>}
      {!error && shown.length === 0 && <div className="p-3 text-gray-500">Belum ada aset. Impor model/HDR lewat AI Agent (linden_asset_import) atau salin ke folder assets/.</div>}
      <div className="flex-1 overflow-y-auto p-2 grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))' }}>
        {shown.map((a) => (
          <div key={a.path} className="flex flex-col gap-1 group" title={`${a.path} (${(a.size / 1024).toFixed(0)} KB)`}>
            <Thumb asset={a} />
            <div className="truncate text-[11px]">{a.path.split('/').pop()}</div>
            {a.kind === 'model' && (
              <button onClick={() => addToScene(a)} className="text-[10px] text-blue-300 hover:text-blue-200 text-left opacity-0 group-hover:opacity-100">
                + Tambah ke scene
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default AssetBrowser
