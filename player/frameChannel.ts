import { GameToEditorMessage, EditorToGameMessage, parseEditorToGame } from '../shared/playProtocol'

/**
 * Game-side end of the editor <-> Game Frame channel. Used by the Linden player when it
 * runs inside the editor viewport, and by the HTML Game bridge.
 */

export function isEmbeddedInEditor(): boolean {
  try {
    return window.parent !== window && new URLSearchParams(location.search).get('embedded') === '1'
  } catch {
    return false
  }
}

export function postToEditor(msg: GameToEditorMessage): void {
  // The editor origin is http://localhost (dev) or file:// (packaged); it validates event.source instead
  window.parent.postMessage(msg, '*')
}

export function onEditorMessage(handler: (msg: EditorToGameMessage) => void): () => void {
  const listener = (event: MessageEvent) => {
    if (event.source !== window.parent) return
    const msg = parseEditorToGame(event.data)
    if (msg) handler(msg)
  }
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}

function stringifyArg(arg: unknown): string {
  if (typeof arg === 'string') return arg
  if (arg instanceof Error) return arg.stack || `${arg.name}: ${arg.message}`
  try {
    const s = JSON.stringify(arg)
    return s === undefined ? String(arg) : s
  } catch {
    return String(arg)
  }
}

/** Mirror console output and uncaught errors to the editor Console panel */
export function forwardConsoleToEditor(): void {
  const levels = ['log', 'info', 'warn', 'error'] as const
  for (const level of levels) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      original(...args)
      try {
        postToEditor({ type: 'linden:log', level, args: args.slice(0, 50).map((a) => stringifyArg(a).slice(0, 4000)) })
      } catch {
        // never let logging break the game
      }
    }
  }
  window.addEventListener('error', (e) => {
    postToEditor({ type: 'linden:log', level: 'error', args: [e.error?.stack || e.message || 'Error'] })
  })
  window.addEventListener('unhandledrejection', (e) => {
    postToEditor({ type: 'linden:log', level: 'error', args: [`Unhandled rejection: ${stringifyArg(e.reason)}`] })
  })
}

/** Shift+F1 hands keyboard focus (and pointer lock) back to the editor */
export function installFocusRelease(): void {
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'F1' && e.shiftKey) {
        e.preventDefault()
        document.exitPointerLock?.()
        postToEditor({ type: 'linden:releaseFocus' })
      }
    },
    true
  )
}
