/**
 * linden bridge for HTML Games (project runtime 'html'). Injected as the first <head> script
 * of the game's entry page, in the editor Game Frame and in the web export.
 *
 * - Embedded in the editor: forwards console/errors, reports FPS (and triangles for renderers
 *   registered with linden.registerRenderer), and implements Pause/Step by owning
 *   requestAnimationFrame and freezing performance.now() while paused.
 * - Everywhere: window.linden.input exposes the project's Input Actions.
 */
import { InputManager, TouchConfig } from '../engine/input/InputActions'
import { normalizeTouchConfig } from '../engine/input/normalizeActions'
import { TouchControls } from './touchControls'
import { createTouchApi } from './touchApi'
import { isEmbeddedInEditor, postToEditor, onEditorMessage, forwardConsoleToEditor, installFocusRelease } from './frameChannel'

interface RendererLike {
  info?: { render?: { triangles?: number; calls?: number } }
}

const input = new InputManager()
const renderers = new Set<RendererLike>()
const pauseListeners = new Set<(paused: boolean) => void>()
let paused = false

let projectTouch: unknown
let touchControls: TouchControls | null = null
const touchApi = createTouchApi(() => touchControls, (msg) => console.warn(`[linden.touch] ${msg}`))

const linden = {
  version: 1,
  input,
  /**
   * Opt-in Linden joystick + buttons for HTML Games: linden.touch.mount() uses project input.touch;
   * show/hide/setLabel/setBadge/setCooldown/setLayout work like ctx.touch in scene games.
   */
  touch: Object.defineProperties(
    {
    mount(config?: Partial<TouchConfig>) {
      touchControls?.destroy()
      const normalized = normalizeTouchConfig(config ?? projectTouch, input.getActions())
      normalized.warnings.forEach((w) => console.warn(`[linden.touch] ${w}`))
      touchControls = new TouchControls({
        container: document.body,
        config: { ...normalized.config, enabled: 'always' },
        input,
        // HTML Games ship their own files next to the page: assets resolve against it
        resolveAsset: (p) => new URL(p, document.baseURI).href,
      })
      return touchControls
    },
    unmount() {
      touchControls?.destroy()
      touchControls = null
    },
    },
    // active/layout stay live getters
    Object.getOwnPropertyDescriptors(touchApi)
  ),
  get paused() {
    return paused
  },
  /** Lets the editor show triangle/draw-call stats for a three.js WebGLRenderer */
  registerRenderer(renderer: RendererLike) {
    renderers.add(renderer)
  },
  onPause(cb: (paused: boolean) => void) {
    pauseListeners.add(cb)
    return () => pauseListeners.delete(cb)
  },
}
;(window as any).linden = linden

// Input actions: project.json sits next to this script (served by Play, written by the web export)
const bridgeSrc = (document.currentScript as HTMLScriptElement | null)?.src
if (bridgeSrc) {
  fetch(new URL('project.json', bridgeSrc).href)
    .then((res) => (res.ok ? res.json() : null))
    .then((project) => {
      const actions = project?.input?.actions
      if (Array.isArray(actions) && actions.length > 0) input.loadActions(actions)
      projectTouch = project?.input?.touch
    })
    .catch(() => {})
}

// Keep "just pressed" state in step with the page's frames
function inputTick() {
  input.update()
  nativeRaf(inputTick)
}
const nativeRaf = window.requestAnimationFrame.bind(window)
nativeRaf(inputTick)

if (isEmbeddedInEditor()) {
  forwardConsoleToEditor()
  installFocusRelease()

  // --- Virtual clock: performance.now() and rAF timestamps stop while paused ---
  const nativeNow = performance.now.bind(performance)
  let pausedTotal = 0
  let pauseStartedAt = 0
  const now = () => nativeNow() - pausedTotal - (paused ? nativeNow() - pauseStartedAt : 0)
  performance.now = now

  // --- rAF pump: callbacks only run while playing (or once per Step) ---
  let nextId = 1
  let pending = new Map<number, FrameRequestCallback>()
  let stepsRequested = 0
  let frames = 0
  let windowStart = nativeNow()
  let worstFrame = 0

  const pump = () => {
    nativeRaf(pump)
    if (paused) {
      if (stepsRequested === 0) return
      stepsRequested--
      pausedTotal -= 1000 / 60 // advance the virtual clock by one frame
    }
    const started = nativeNow()
    const ts = now()
    const callbacks = pending
    pending = new Map()
    callbacks.forEach((cb) => {
      try {
        cb(ts)
      } catch (err) {
        console.error(err)
      }
    })
    frames++
    worstFrame = Math.max(worstFrame, nativeNow() - started)
    const elapsed = nativeNow() - windowStart
    if (elapsed >= 500) {
      let triangles: number | undefined
      let drawCalls: number | undefined
      for (const r of renderers) {
        triangles = (triangles ?? 0) + (r.info?.render?.triangles ?? 0)
        drawCalls = (drawCalls ?? 0) + (r.info?.render?.calls ?? 0)
      }
      postToEditor({ type: 'linden:stats', fps: Math.round((frames * 1000) / elapsed), frameMs: Math.round(worstFrame * 10) / 10, triangles, drawCalls })
      frames = 0
      worstFrame = 0
      windowStart = nativeNow()
    }
  }
  window.requestAnimationFrame = (cb: FrameRequestCallback) => {
    const id = nextId++
    pending.set(id, cb)
    return id
  }
  window.cancelAnimationFrame = (id: number) => {
    pending.delete(id)
  }
  nativeRaf(pump)

  // --- Audio follows pause state ---
  const audioContexts = new Set<AudioContext>()
  const NativeAudioContext = window.AudioContext
  if (NativeAudioContext) {
    ;(window as any).AudioContext = class extends NativeAudioContext {
      constructor(...args: ConstructorParameters<typeof AudioContext>) {
        super(...args)
        audioContexts.add(this)
      }
    }
  }

  const setPaused = (value: boolean) => {
    if (paused === value) return
    if (value) pauseStartedAt = nativeNow()
    else pausedTotal += nativeNow() - pauseStartedAt
    paused = value
    audioContexts.forEach((ctx) => (value ? ctx.suspend() : ctx.resume()).catch(() => {}))
    document.querySelectorAll('video, audio').forEach((el) => {
      const media = el as HTMLMediaElement
      if (value && !media.paused) {
        media.dataset.lindenPaused = '1'
        media.pause()
      } else if (!value && media.dataset.lindenPaused) {
        delete media.dataset.lindenPaused
        media.play().catch(() => {})
      }
    })
    pauseListeners.forEach((cb) => cb(value))
  }

  onEditorMessage((msg) => {
    if (msg.type === 'linden:pause') setPaused(true)
    else if (msg.type === 'linden:resume') setPaused(false)
    else if (msg.type === 'linden:step') stepsRequested++
  })

  const announce = () => {
    postToEditor({ type: 'linden:ready' })
    postToEditor({ type: 'linden:started' })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', announce)
  else announce()
}
