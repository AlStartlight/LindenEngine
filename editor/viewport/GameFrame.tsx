import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditorStore, PlaySessionInfo } from '../store/editorStore'
import { SceneSerializer } from '../../engine/scene/serializer'
import { parseGameToEditor, EditorToGameMessage } from '../../shared/playProtocol'

export interface GameFrameStats {
  fps: number
  frameMs: number
  triangles?: number
  drawCalls?: number
  renderer?: 'webgpu' | 'webgl2'
}

type AspectId = 'free' | '16:9' | '4:3' | '9:16'
const ASPECTS: { id: AspectId; label: string; ratio: number | null }[] = [
  { id: 'free', label: 'Free', ratio: null },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '9:16', label: '9:16 Mobile', ratio: 9 / 16 },
]

interface GameFrameProps {
  session: PlaySessionInfo
  onConsole?: (type: 'info' | 'warn' | 'error', message: string) => void
  onStats?: (stats: GameFrameStats) => void
}

/**
 * Runs the game for Play inside a sandboxed, cross-origin iframe (linden-game://), so game code
 * can't reach window.electronAPI. Scene mode receives the editor's current (possibly unsaved)
 * scene through postMessage; HTML Game mode loads the project's own entry page.
 */
export const GameFrame: React.FC<GameFrameProps> = ({ session, onConsole, onStats }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const [aspect, setAspect] = useState<AspectId>('free')
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [loading, setLoading] = useState(true)
  /** Set when the game never reports back (runtime failed to load, stale session...) */
  const [stalled, setStalled] = useState(false)
  /** Touch controls in the Game View: 'auto' follows the project, 'always' lets you test them with the mouse */
  const [touchMode, setTouchMode] = useState<'auto' | 'always' | 'never'>('auto')
  const touchModeRef = useRef(touchMode)
  touchModeRef.current = touchMode
  /** Touch layout to start with ('' = the project's initialLayout) */
  const [touchLayout, setTouchLayout] = useState('')
  const touchLayoutRef = useRef(touchLayout)
  touchLayoutRef.current = touchLayout
  const touchLayouts = useEditorStore((s) => s.projectSettings.touch.layouts)
  const layoutNames = useMemo(() => ['default', ...Object.keys(touchLayouts ?? {})], [touchLayouts])
  const playState = useEditorStore((s) => s.playState)
  const stepNonce = useEditorStore((s) => s.playStepNonce)

  const post = useCallback((msg: EditorToGameMessage) => {
    iframeRef.current?.contentWindow?.postMessage(msg, '*')
  }, [])

  // Messages from the game; only trusted when they come from our iframe
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return
      const msg = parseGameToEditor(event.data)
      if (!msg) return
      switch (msg.type) {
        case 'linden:ready': {
          const state = useEditorStore.getState()
          if (session.mode === 'scene') {
            const { projectSettings, projectName, world, sceneName } = state
            post({
              type: 'linden:init',
              mode: 'scene',
              scene: SceneSerializer.serialize(world, sceneName),
              projectConfig: {
                name: projectName,
                collisionMatrix: projectSettings.collisionMatrix,
                renderer: (projectSettings as { renderer?: string }).renderer === 'webgpu' ? 'webgpu' : 'webgl',
                input: {
                  actions: projectSettings.inputActions,
                  touch: {
                    ...projectSettings.touch,
                    enabled: touchModeRef.current === 'auto' ? projectSettings.touch.enabled : touchModeRef.current,
                    initialLayout: touchLayoutRef.current || projectSettings.touch.initialLayout,
                  },
                },
                tags: projectSettings.tags,
                layers: projectSettings.layers,
              },
            })
          }
          if (state.playState === 'paused') post({ type: 'linden:pause' })
          break
        }
        case 'linden:started':
          setLoading(false)
          setStalled(false)
          break
        case 'linden:log': {
          const type = msg.level === 'error' ? 'error' : msg.level === 'warn' ? 'warn' : 'info'
          const where = msg.source ? ` (${msg.source.file}:${msg.source.line}:${msg.source.col})` : ''
          onConsole?.(type, `[Game] ${msg.args.join(' ')}${where}`)
          break
        }
        case 'linden:stats':
          onStats?.(msg)
          break
        case 'linden:fatal':
          setLoading(false)
          onConsole?.('error', `[Game] Gagal memulai: ${msg.message}`)
          break
        case 'linden:releaseFocus':
          iframeRef.current.blur()
          areaRef.current?.focus()
          onConsole?.('info', 'Fokus keyboard dikembalikan ke editor (Shift+F1)')
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [session, post, onConsole, onStats])

  // Pause / resume follow the toolbar
  useEffect(() => {
    if (playState === 'paused') post({ type: 'linden:pause' })
    else if (playState === 'playing') post({ type: 'linden:resume' })
  }, [playState, post])

  const lastStep = useRef(stepNonce)
  useEffect(() => {
    if (stepNonce !== lastStep.current) {
      lastStep.current = stepNonce
      post({ type: 'linden:step' })
    }
  }, [stepNonce, post])

  // Hot reload: HTML Games reload the page; scene games swap scripts/UI without restarting
  useEffect(() => {
    const off = window.electronAPI?.onPlayFileChanged?.((change) => {
      if (change.sessionId !== session.id) return
      if (change.kind === 'reload') {
        setLoading(true)
        setReloadKey((k) => k + 1)
        onConsole?.('info', '[Game] File berubah, memuat ulang game')
      } else if (change.kind === 'scripts') {
        if (change.errors?.length) {
          onConsole?.('error', '[Game] Hot reload dibatalkan, kompilasi script gagal (game tetap memakai versi lama):')
          for (const e of change.errors) {
            onConsole?.('error', `${e.file ? `${e.file}${e.line ? `:${e.line}${e.col ? `:${e.col}` : ''}` : ''}: ` : ''}${e.message}`)
          }
        } else if (change.version) {
          post({ type: 'linden:reloadScripts', version: change.version })
        }
      } else if (change.kind === 'ui') {
        post({ type: 'linden:reloadUi', files: change.files })
      }
    })
    return () => off?.()
  }, [session.id, onConsole, post])

  // Letterbox the frame inside the viewport for fixed aspect ratios
  useEffect(() => {
    const area = areaRef.current
    if (!area) return
    const ratio = ASPECTS.find((a) => a.id === aspect)?.ratio ?? null
    const update = () => {
      if (!ratio) {
        setFrameSize(null)
        return
      }
      const w = area.clientWidth
      const h = area.clientHeight
      const width = Math.min(w, h * ratio)
      setFrameSize({ width: Math.floor(width), height: Math.floor(width / ratio) })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(area)
    return () => ro.disconnect()
  }, [aspect])

  // Focus the game as soon as it is shown so keyboard input works without an extra click
  useEffect(() => {
    iframeRef.current?.focus()
  }, [reloadKey])

  // A game that never answers would otherwise leave an empty frame with no explanation
  useEffect(() => {
    setStalled(false)
    if (!loading) return
    const timer = setTimeout(() => {
      setStalled(true)
      onConsole?.('error', '[Game] Game tidak merespons dalam 10 detik. Buka DevTools (frame linden-game://) untuk melihat error, atau tekan Reload.')
    }, 10000)
    return () => clearTimeout(timer)
  }, [loading, reloadKey, onConsole])

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-black">
      <div className="flex items-center justify-end gap-1.5 px-2 h-7 shrink-0 overflow-hidden whitespace-nowrap bg-[#11111d] border-b border-gray-800 text-[11px] text-gray-300">
        <span className="mr-auto text-blue-300 font-medium">Game</span>
        <select
          value={touchMode}
          onChange={(e) => {
            setTouchMode(e.target.value as typeof touchMode)
            setLoading(true)
            setReloadKey((k) => k + 1)
          }}
          className="bg-transparent text-gray-200 px-1 py-0.5 rounded hover:bg-white/10 outline-none"
          title="Kontrol sentuh (joystick + tombol). On = uji dengan mouse"
        >
          <option value="auto" className="bg-gray-900">Sentuh: Auto</option>
          <option value="always" className="bg-gray-900">Sentuh: On</option>
          <option value="never" className="bg-gray-900">Sentuh: Off</option>
        </select>
        {touchMode !== 'never' && layoutNames.length > 1 && (
          <select
            value={touchLayout}
            onChange={(e) => {
              setTouchLayout(e.target.value)
              setLoading(true)
              setReloadKey((k) => k + 1)
            }}
            className="bg-transparent text-gray-200 px-1 py-0.5 rounded hover:bg-white/10 outline-none"
            title="Layout kontrol sentuh awal"
          >
            <option value="" className="bg-gray-900">Layout: proyek</option>
            {layoutNames.map((n) => (
              <option key={n} value={n} className="bg-gray-900">
                Layout: {n}
              </option>
            ))}
          </select>
        )}
        <select
          value={aspect}
          onChange={(e) => {
            const next = e.target.value as AspectId
            setAspect(next)
            // Portrait mobile preview turns the on-screen controls on
            if (next === '9:16' && touchMode === 'auto') {
              setTouchMode('always')
              setLoading(true)
              setReloadKey((k) => k + 1)
            }
          }}
          className="bg-transparent text-gray-200 px-1 py-0.5 rounded hover:bg-white/10 outline-none"
          title="Rasio aspek Game View"
        >
          {ASPECTS.map((a) => (
            <option key={a.id} value={a.id} className="bg-gray-900">
              {a.label}
            </option>
          ))}
        </select>
        <div className="w-px h-4 bg-gray-700/60" />
        <button
          className="px-2 py-0.5 rounded hover:bg-white/10"
          onClick={() => {
            setLoading(true)
            setReloadKey((k) => k + 1)
          }}
          title="Muat ulang game"
        >
          Reload
        </button>
        <button
          className="px-2 py-0.5 rounded hover:bg-white/10"
          onClick={() => window.electronAPI?.playOpenDevTools?.()}
          title="Buka DevTools (pilih frame linden-game:// di konteks console)"
        >
          DevTools
        </button>
        <span className="px-1 text-gray-500" title="Lepas fokus keyboard/mouse dari game">
          Shift+F1
        </span>
      </div>
      <div
        ref={areaRef}
        tabIndex={-1}
        className="relative flex-1 flex items-center justify-center overflow-hidden outline-none"
      >
        <iframe
          key={reloadKey}
          ref={iframeRef}
          title="Game"
          src={session.url}
          sandbox="allow-scripts allow-same-origin allow-pointer-lock"
          allow="gamepad; fullscreen; autoplay; xr-spatial-tracking"
          className="block border-0 bg-black"
          style={frameSize ? { width: frameSize.width, height: frameSize.height } : { width: '100%', height: '100%' }}
          onLoad={() => session.mode === 'html' && setLoading(false)}
        />
        {loading && !stalled && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-xs text-gray-400">
            Memuat game…
          </div>
        )}
        {stalled && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0f172a]/90 text-xs text-gray-300 text-center px-6">
            <div className="text-red-400 font-semibold text-sm">Game tidak merespons</div>
            <div>Runtime gagal dimuat atau sesi Play sudah berakhir. Detail ada di Console / DevTools.</div>
            <div className="flex gap-2 mt-1">
              <button
                className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white"
                onClick={() => {
                  setLoading(true)
                  setReloadKey((k) => k + 1)
                }}
              >
                Reload
              </button>
              <button className="px-3 py-1 rounded bg-white/10 hover:bg-white/20" onClick={() => window.electronAPI?.playOpenDevTools?.()}>
                DevTools
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default GameFrame
