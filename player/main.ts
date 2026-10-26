import * as THREE from 'three'
import { LindenPlayer } from './player'
import { Input } from '../engine/input/InputActions'
import { Physics } from '../engine/physics/components'
import { Tween, Easing } from '../engine/time/Tween'
import { formatScriptError } from '../engine/scripting/ScriptRuntime'
import { isEmbeddedInEditor, postToEditor, onEditorMessage, forwardConsoleToEditor, installFocusRelease } from './frameChannel'
import { mapScriptErrorLocation, resetSourceMapCache } from './errorMapping'
import type { EditorToGameMessage } from '../shared/playProtocol'

// Compiled game scripts import 'three' and 'linden' from these globals (see electron/play/ScriptCompiler.ts)
;(globalThis as any).__LINDEN_THREE__ = THREE
;(globalThis as any).__LINDEN_API__ = { Input, Physics, Tween, Easing }

/** In the editor's Game Frame the scene comes from the editor (unsaved changes included) */
function waitForEditorInit(): Promise<Extract<EditorToGameMessage, { type: 'linden:init' }>> {
  return new Promise((resolve) => {
    const off = onEditorMessage((msg) => {
      if (msg.type === 'linden:init') {
        off()
        resolve(msg)
      }
    })
    postToEditor({ type: 'linden:ready' })
  })
}

window.addEventListener('DOMContentLoaded', async () => {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement
  if (!canvas) {
    console.error('Canvas #game-canvas tidak ditemukan di DOM')
    return
  }

  // Config comes from data attributes (inline <script> is blocked by the Game Frame CSP)
  const dataset = document.body.dataset
  const legacy = window as any
  const webgpuRequired = (dataset.webgpuRequired ?? String(legacy.__LINDEN_WEBGPU_REQUIRED__ ?? false)) === 'true'
  const canvasMode = (dataset.canvasMode || legacy.__LINDEN_CANVAS_MODE__ || 'responsive') as any
  let embeddedData = legacy.__LINDEN_GAME_DATA__

  const embedded = isEmbeddedInEditor()
  if (embedded) {
    forwardConsoleToEditor()
    installFocusRelease()
    const init = await waitForEditorInit()
    embeddedData = { project: init.projectConfig ?? {}, scene: init.scene }
    document.getElementById('start-audio-btn')?.remove()
  }

  const player = new LindenPlayer({
    canvas,
    webgpuRequired,
    canvasMode,
    embeddedData,
    onScriptError: async (info) => {
      const source = (await mapScriptErrorLocation(info.error)) ?? undefined
      const message = formatScriptError(info)
      if (embedded) {
        const err = info.error as any
        postToEditor({ type: 'linden:log', level: 'error', args: [message, ...(err?.stack ? [String(err.stack)] : [])], source })
      } else {
        console.error(`[Linden] ${message}`, source ? `(${source.file}:${source.line}:${source.col})` : '', info.error)
      }
    },
    onWarning: (message) => {
      if (embedded) postToEditor({ type: 'linden:log', level: 'warn', args: [message] })
      else console.warn(`[Linden] ${message}`)
    },
    onInfo: embedded ? (message) => postToEditor({ type: 'linden:log', level: 'info', args: [message] }) : undefined,
    onStats: embedded ? (stats) => postToEditor({ type: 'linden:stats', ...stats }) : undefined,
    onStarted: embedded ? () => postToEditor({ type: 'linden:started' }) : undefined,
  })

  if (embedded) {
    onEditorMessage((msg) => {
      if (msg.type === 'linden:pause') player.pause()
      else if (msg.type === 'linden:resume') player.resume()
      else if (msg.type === 'linden:step') player.step()
      else if (msg.type === 'linden:setTimeScale') player.setTimeScale(msg.value)
      else if (msg.type === 'linden:reloadScripts') {
        resetSourceMapCache()
        player.reloadScripts(msg.version)
      } else if (msg.type === 'linden:reloadUi') player.reloadUi(msg.files)
    })
    player.initAudio()
  }

  // Audio start trigger
  const startBtn = document.getElementById('start-audio-btn')
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      player.initAudio()
      startBtn.style.display = 'none'
    })
  }

  try {
    await player.start()
  } catch (err: any) {
    if (embedded) postToEditor({ type: 'linden:fatal', message: err?.message ?? String(err), stack: err?.stack })
  }
})
