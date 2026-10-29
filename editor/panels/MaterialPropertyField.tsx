import React, { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { MATERIAL_PRESETS, resolveMaterialSpec } from '../../engine/materials/presets'
import { MaterialSpec } from '../../engine/materials/MaterialSpec'
import { createMaterial, disposeMaterial } from '../../engine/materials/createMaterial'

/**
 * Inspector editor for MeshRenderer.material: preset dropdown, a small rendered preview and
 * sliders for the PBR parameters. Edits are stored as overrides on top of the preset.
 */

interface Props {
  label: string
  value: Record<string, any> | undefined
  /** Legacy flat fields of the MeshRenderer, shown when no preset is set */
  legacy: { color?: string; roughness?: number; metalness?: number }
  onCommit: (value: Record<string, any>, mergeKey?: string) => void
}

type SliderKey = 'roughness' | 'metalness' | 'clearcoat' | 'clearcoatRoughness' | 'transmission' | 'ior' | 'thickness' | 'sheen' | 'iridescence' | 'anisotropy' | 'opacity' | 'emissiveIntensity' | 'tileSize'

const SLIDERS: { key: SliderKey; label: string; min: number; max: number; step: number }[] = [
  { key: 'roughness', label: 'Roughness', min: 0, max: 1, step: 0.01 },
  { key: 'metalness', label: 'Metalness', min: 0, max: 1, step: 0.01 },
  { key: 'clearcoat', label: 'Clearcoat', min: 0, max: 1, step: 0.01 },
  { key: 'clearcoatRoughness', label: 'Coat Rough.', min: 0, max: 1, step: 0.01 },
  { key: 'transmission', label: 'Transmission', min: 0, max: 1, step: 0.01 },
  { key: 'ior', label: 'IOR', min: 1, max: 2.333, step: 0.01 },
  { key: 'thickness', label: 'Thickness (m)', min: 0, max: 0.5, step: 0.001 },
  { key: 'sheen', label: 'Sheen', min: 0, max: 1, step: 0.01 },
  { key: 'iridescence', label: 'Iridescence', min: 0, max: 1, step: 0.01 },
  { key: 'anisotropy', label: 'Anisotropy', min: 0, max: 1, step: 0.01 },
  { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.01 },
  { key: 'emissiveIntensity', label: 'Emissive', min: 0, max: 20, step: 0.1 },
  { key: 'tileSize', label: 'Tile Size (m)', min: 0.02, max: 4, step: 0.01 },
]

const CATEGORIES = [...new Set(MATERIAL_PRESETS.map((p) => p.category))]

// One shared WebGL context renders every preview sphere, copied into each field's 2D canvas
let previewRig: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; mesh: THREE.Mesh } | null = null

function getPreviewRig() {
  if (previewRig) return previewRig
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setSize(96, 96, false)
  renderer.toneMapping = THREE.AgXToneMapping
  renderer.outputColorSpace = THREE.SRGBColorSpace
  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  pmrem.dispose()
  const key = new THREE.DirectionalLight(0xffffff, 2)
  key.position.set(2, 3, 2)
  scene.add(key)
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 10)
  camera.position.set(0, 0, 2.2)
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 48, 32))
  // UVs in meters like Model parts: 1 m sphere shows ~1/tileSize pattern tiles
  scene.add(mesh)
  previewRig = { renderer, scene, camera, mesh }
  return previewRig
}

function renderPreview(target: HTMLCanvasElement, spec: MaterialSpec): void {
  try {
    const rig = getPreviewRig()
    const mat = createMaterial(spec)
    rig.mesh.material = mat
    rig.renderer.render(rig.scene, rig.camera)
    const ctx = target.getContext('2d')
    if (ctx) {
      ctx.clearRect(0, 0, target.width, target.height)
      ctx.drawImage(rig.renderer.domElement, 0, 0, target.width, target.height)
    }
    disposeMaterial(mat)
  } catch {
    // No WebGL (tests, headless): the preview stays empty
  }
}

export const MaterialPropertyField: React.FC<Props> = ({ label, value, legacy, onCommit }) => {
  const material = value ?? {}
  const preset: string = material.preset ?? ''
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const effective = useMemo<MaterialSpec>(() => {
    const base: MaterialSpec = preset ? {} : { color: legacy.color, roughness: legacy.roughness, metalness: legacy.metalness }
    return resolveMaterialSpec({ ...base, ...material }).spec
  }, [JSON.stringify(material), legacy.color, legacy.roughness, legacy.metalness])

  useEffect(() => {
    if (canvasRef.current) renderPreview(canvasRef.current, effective)
  }, [JSON.stringify(effective)])

  const overrides = Object.keys(material).filter((k) => k !== 'preset')
  const set = (key: string, val: unknown, merge = true) => onCommit({ ...material, [key]: val }, merge ? `material:${key}` : undefined)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="w-24 text-gray-400 truncate">{label}</span>
        <select
          value={preset}
          onChange={(e) => onCommit(e.target.value ? { preset: e.target.value } : {})}
          className="flex-1 bg-black/40 border border-gray-700 rounded px-2 py-0.5 text-white"
          title="Preset material PBR"
        >
          <option value="">Custom (Color / Roughness / Metalness)</option>
          {CATEGORIES.map((cat) => (
            <optgroup key={cat} label={cat}>
              {MATERIAL_PRESETS.filter((p) => p.category === cat).map((p) => (
                <option key={p.id} value={p.id} title={p.description}>
                  {p.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="flex gap-2 items-start">
        <canvas ref={canvasRef} width={72} height={72} className="w-[72px] h-[72px] rounded bg-black/40 border border-gray-700 shrink-0" />
        <div className="flex-1 flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="w-24 text-gray-400 truncate">Color</span>
            <input type="color" value={effective.color ?? '#ffffff'} onChange={(e) => set('color', e.target.value)} className="w-8 h-5 bg-transparent border-0 cursor-pointer" />
            <span className="font-mono text-gray-400 text-[10px]">{effective.color}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-24 text-gray-400 truncate">Emissive</span>
            <input type="color" value={effective.emissive ?? '#000000'} onChange={(e) => set('emissive', e.target.value)} className="w-8 h-5 bg-transparent border-0 cursor-pointer" />
          </div>
          {overrides.length > 0 && (
            <button
              className="self-start text-[10px] text-blue-300 hover:text-blue-200"
              onClick={() => onCommit(preset ? { preset } : {})}
              title={`Override: ${overrides.join(', ')}`}
            >
              Reset {overrides.length} override
            </button>
          )}
        </div>
      </div>

      {SLIDERS.map((s) => {
        const v = effective[s.key] as number | undefined
        const overridden = material[s.key] !== undefined
        return (
          <div key={s.key} className="flex items-center gap-2">
            <span className={`w-24 truncate ${overridden ? 'text-blue-300' : 'text-gray-400'}`}>{s.label}</span>
            <input
              type="range"
              min={s.min}
              max={s.max}
              step={s.step}
              value={v ?? (s.key === 'ior' ? 1.5 : s.key === 'opacity' ? 1 : s.key === 'tileSize' ? 1 : 0)}
              onChange={(e) => set(s.key, Number(e.target.value))}
              className="flex-1 accent-blue-500"
            />
            <span className="w-10 text-right font-mono text-gray-300 text-[10px]">{v === undefined ? '—' : Number(v.toFixed(3))}</span>
          </div>
        )
      })}
    </div>
  )
}
