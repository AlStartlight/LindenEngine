import React, { useEffect, useState } from 'react'
import { useEditorStore } from '../store/editorStore'
import { setSceneSettingsCommand } from '../commands/entityCommands'
import type { SceneSettings } from '../../engine/scene/SceneSettings'
import type { AssetEntry } from '../../shared/assetProtocol'

/**
 * Render settings of the open scene: environment (IBL), background, tone mapping, exposure, fog,
 * shadows, sun and post-processing. Same values the player and the web export use.
 */

const Row: React.FC<{ label: string; title?: string; children: React.ReactNode }> = ({ label, title, children }) => (
  <div className="flex items-center gap-2" title={title}>
    <span className="w-28 text-gray-400 truncate">{label}</span>
    <div className="flex-1 flex items-center gap-2 min-w-0">{children}</div>
  </div>
)

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="border-b border-gray-700/50 pb-3 mb-3">
    <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">{title}</div>
    <div className="flex flex-col gap-1.5">{children}</div>
  </div>
)

const Slider: React.FC<{ value: number; min: number; max: number; step: number; onChange: (v: number) => void }> = ({ value, min, max, step, onChange }) => (
  <>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 accent-blue-500" />
    <span className="w-10 text-right font-mono text-gray-300 text-[10px]">{Number(value.toFixed(3))}</span>
  </>
)

const selectClass = 'flex-1 bg-black/40 border border-gray-700 rounded px-2 py-0.5 text-white min-w-0'

export const SceneSettingsPanel: React.FC = () => {
  const { world, executeCommand } = useEditorStore()
  const [settings, setSettings] = useState<SceneSettings>(() => world.getSceneSettings())
  const [environments, setEnvironments] = useState<string[]>([])

  useEffect(() => {
    setSettings(world.getSceneSettings())
    return world.events.on('sceneSettingsChanged', (s: SceneSettings) => setSettings({ ...s }))
  }, [world])

  useEffect(() => {
    window.electronAPI?.listAssets?.().then((list: AssetEntry[]) => setEnvironments(list.filter((a) => a.kind === 'environment').map((a) => a.path)), () => {})
  }, [])

  const set = (patch: Partial<SceneSettings>, mergeKey?: string) => executeCommand(setSceneSettingsCommand(patch, mergeKey))
  const s = settings

  return (
    <div className="h-full overflow-y-auto p-3 text-xs text-gray-200">
      <Section title="Environment (IBL)">
        <Row label="Environment" title="Pencahayaan image-based: RoomEnvironment prosedural atau HDR/EXR dari assets/">
          <select value={s.environment} onChange={(e) => set({ environment: e.target.value })} className={selectClass}>
            <option value="room">Room (prosedural)</option>
            <option value="none">None</option>
            {environments.map((p) => (
              <option key={p} value={p}>
                {p.replace(/^assets\//, '')}
              </option>
            ))}
            {!['room', 'none', ...environments].includes(s.environment) && <option value={s.environment}>{s.environment}</option>}
          </select>
        </Row>
        <Row label="Intensity">
          <Slider value={s.environmentIntensity} min={0} max={4} step={0.05} onChange={(v) => set({ environmentIntensity: v }, 'scene:envIntensity')} />
        </Row>
        <Row label="Background" title="null = HDR bila environment berupa file, selain itu warna default">
          <select
            value={s.skybox === null ? 'auto' : s.skybox.startsWith('#') ? 'color' : s.skybox}
            onChange={(e) => set({ skybox: e.target.value === 'auto' ? null : e.target.value === 'color' ? '#1a1d26' : e.target.value })}
            className={selectClass}
          >
            <option value="auto">Auto</option>
            <option value="environment">Environment</option>
            <option value="color">Warna</option>
            {environments.map((p) => (
              <option key={p} value={p}>
                {p.replace(/^assets\//, '')}
              </option>
            ))}
          </select>
          {s.skybox?.startsWith('#') && <input type="color" value={s.skybox} onChange={(e) => set({ skybox: e.target.value }, 'scene:skyColor')} className="w-8 h-5 bg-transparent border-0" />}
        </Row>
        <Row label="BG Blur">
          <Slider value={s.backgroundBlurriness} min={0} max={1} step={0.01} onChange={(v) => set({ backgroundBlurriness: v }, 'scene:bgBlur')} />
        </Row>
        <Row label="Ambient">
          <input type="color" value={s.ambientColor} onChange={(e) => set({ ambientColor: e.target.value }, 'scene:ambientColor')} className="w-8 h-5 bg-transparent border-0" />
          <Slider value={s.ambientIntensity} min={0} max={2} step={0.01} onChange={(v) => set({ ambientIntensity: v }, 'scene:ambient')} />
        </Row>
      </Section>

      <Section title="Kamera & Tone Mapping">
        <Row label="Tone Mapping">
          <select value={s.toneMapping} onChange={(e) => set({ toneMapping: e.target.value as SceneSettings['toneMapping'] })} className={selectClass}>
            <option value="agx">AgX</option>
            <option value="aces">ACES Filmic</option>
            <option value="neutral">Khronos Neutral</option>
            <option value="reinhard">Reinhard</option>
            <option value="linear">Linear</option>
            <option value="none">None</option>
          </select>
        </Row>
        <Row label="Exposure">
          <Slider value={s.exposure} min={0.1} max={4} step={0.01} onChange={(v) => set({ exposure: v }, 'scene:exposure')} />
        </Row>
      </Section>

      <Section title="Matahari & Bayangan">
        <Row label="Sun">
          <input type="checkbox" checked={s.sun.enabled} onChange={(e) => set({ sun: { ...s.sun, enabled: e.target.checked } })} />
          <input type="color" value={s.sun.color} onChange={(e) => set({ sun: { ...s.sun, color: e.target.value } }, 'scene:sunColor')} className="w-8 h-5 bg-transparent border-0" />
          <Slider value={s.sun.intensity} min={0} max={10} step={0.05} onChange={(v) => set({ sun: { ...s.sun, intensity: v } }, 'scene:sun')} />
        </Row>
        {(['X', 'Y', 'Z'] as const).map((axis, i) => (
          <Row key={axis} label={`Sun dir ${axis}`}>
            <Slider
              value={s.sun.direction[i]}
              min={i === 1 ? 0.05 : -1}
              max={1}
              step={0.01}
              onChange={(v) => {
                const direction = [...s.sun.direction] as [number, number, number]
                direction[i] = v
                set({ sun: { ...s.sun, direction } }, `scene:sunDir${axis}`)
              }}
            />
          </Row>
        ))}
        <Row label="Shadow Quality" title="Ukuran shadow map; dibatasi profil kualitas proyek">
          <select value={s.shadowQuality} onChange={(e) => set({ shadowQuality: e.target.value as SceneSettings['shadowQuality'] })} className={selectClass}>
            <option value="off">Off</option>
            <option value="low">Low (1024)</option>
            <option value="medium">Medium (2048)</option>
            <option value="high">High (4096)</option>
          </select>
        </Row>
      </Section>

      <Section title="Fog">
        <Row label="Enabled">
          <input type="checkbox" checked={s.fog.enabled} onChange={(e) => set({ fog: { ...s.fog, enabled: e.target.checked } })} />
          <select value={s.fog.type} onChange={(e) => set({ fog: { ...s.fog, type: e.target.value as 'linear' | 'exp2' } })} className={selectClass}>
            <option value="exp2">Exponential</option>
            <option value="linear">Linear</option>
          </select>
          <input type="color" value={s.fog.color} onChange={(e) => set({ fog: { ...s.fog, color: e.target.value } }, 'scene:fogColor')} className="w-8 h-5 bg-transparent border-0" />
        </Row>
        {s.fog.type === 'exp2' ? (
          <Row label="Density">
            <Slider value={s.fog.density} min={0} max={0.2} step={0.001} onChange={(v) => set({ fog: { ...s.fog, density: v } }, 'scene:fogDensity')} />
          </Row>
        ) : (
          <>
            <Row label="Near (m)">
              <Slider value={s.fog.near} min={0} max={200} step={0.5} onChange={(v) => set({ fog: { ...s.fog, near: v } }, 'scene:fogNear')} />
            </Row>
            <Row label="Far (m)">
              <Slider value={s.fog.far} min={1} max={1000} step={1} onChange={(v) => set({ fog: { ...s.fog, far: v } }, 'scene:fogFar')} />
            </Row>
          </>
        )}
      </Section>

      <Section title="Post-processing">
        <Row label="Enabled" title="Dimatikan otomatis pada profil kualitas Low (mobile)">
          <input type="checkbox" checked={s.postFx.enabled} onChange={(e) => set({ postFx: { ...s.postFx, enabled: e.target.checked } })} />
        </Row>
        <Row label="Ambient Occlusion">
          <input type="checkbox" checked={s.postFx.ao} onChange={(e) => set({ postFx: { ...s.postFx, ao: e.target.checked } })} />
          <Slider value={s.postFx.aoIntensity} min={0} max={2} step={0.05} onChange={(v) => set({ postFx: { ...s.postFx, aoIntensity: v } }, 'scene:ao')} />
        </Row>
        <Row label="Bloom">
          <input type="checkbox" checked={s.postFx.bloom} onChange={(e) => set({ postFx: { ...s.postFx, bloom: e.target.checked } })} />
          <Slider value={s.postFx.bloomStrength} min={0} max={2} step={0.05} onChange={(v) => set({ postFx: { ...s.postFx, bloomStrength: v } }, 'scene:bloom')} />
        </Row>
        <Row label="Bloom Threshold">
          <Slider value={s.postFx.bloomThreshold} min={0} max={5} step={0.05} onChange={(v) => set({ postFx: { ...s.postFx, bloomThreshold: v } }, 'scene:bloomThreshold')} />
        </Row>
        <Row label="Anti-aliasing">
          <select value={s.postFx.antialias} onChange={(e) => set({ postFx: { ...s.postFx, antialias: e.target.value as 'smaa' | 'fxaa' | 'none' } })} className={selectClass}>
            <option value="smaa">SMAA</option>
            <option value="fxaa">FXAA</option>
            <option value="none">None (MSAA renderer)</option>
          </select>
        </Row>
      </Section>
    </div>
  )
}
