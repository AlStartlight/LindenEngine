/**
 * Game mouse cursor (project.linden.json "cursor"): whether the cursor is shown over the game and
 * what it looks like. Read by the player (Play, Game Frame, web export) and edited in Project Settings.
 */

/**
 * - auto: current behaviour — the cursor is shown, and a click locks it when an action is bound to Mouse/Delta
 * - visible: always shown, never locked (point & click, strategy, UI-heavy games). Mouse/Delta stays 0.
 * - hidden: hidden over the game but not locked (games that draw their own cursor)
 * - locked: a click locks and hides it (first person); Esc releases it
 */
export type CursorMode = 'auto' | 'visible' | 'hidden' | 'locked'

/** CSS cursor keywords offered in Project Settings, plus 'custom' (an image from the project's assets) */
export const CURSOR_STYLES = [
  'default',
  'pointer',
  'crosshair',
  'move',
  'grab',
  'grabbing',
  'text',
  'help',
  'wait',
  'not-allowed',
  'custom',
] as const
export type CursorStyle = (typeof CURSOR_STYLES)[number]

export interface CursorSettings {
  mode: CursorMode
  style: CursorStyle
  /** Project-relative image path (PNG/SVG/CUR), used when style is 'custom'. Browsers cap it at 128×128 px. */
  image?: string
  /** Click point inside the custom image, in pixels from the top-left */
  hotspot: [number, number]
}

export const DEFAULT_CURSOR: CursorSettings = { mode: 'auto', style: 'default', hotspot: [0, 0] }

const MODES: readonly CursorMode[] = ['auto', 'visible', 'hidden', 'locked']

function clampHotspot(v: unknown): number {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(127, Math.max(0, n)) : 0
}

/** Accepts anything from project.linden.json and returns valid settings (missing/invalid fields fall back to defaults) */
export function normalizeCursorSettings(raw: unknown): CursorSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const mode = MODES.includes(r.mode as CursorMode) ? (r.mode as CursorMode) : DEFAULT_CURSOR.mode
  let style = CURSOR_STYLES.includes(r.style as CursorStyle) ? (r.style as CursorStyle) : DEFAULT_CURSOR.style
  const image = typeof r.image === 'string' && r.image.trim() ? r.image.trim() : undefined
  if (style === 'custom' && !image) style = 'default'
  const hs = Array.isArray(r.hotspot) ? r.hotspot : []
  const out: CursorSettings = { mode, style, hotspot: [clampHotspot(hs[0]), clampHotspot(hs[1])] }
  if (image) out.image = image
  return out
}

/** CSS `cursor` value for the game canvas while the pointer is not locked */
export function cursorCss(settings: CursorSettings, resolveUrl: (rel: string) => string = (p) => p): string {
  if (settings.mode === 'hidden') return 'none'
  if (settings.style === 'custom' && settings.image) {
    const url = resolveUrl(settings.image).replace(/["\\\n]/g, (c) => (c === '\n' ? '' : `\\${c}`))
    return `url("${url}") ${settings.hotspot[0]} ${settings.hotspot[1]}, default`
  }
  return settings.style === 'custom' ? 'default' : settings.style
}

/** Whether a click on the game should lock the pointer */
export function shouldLockPointer(settings: CursorSettings, usesMouseLook: boolean): boolean {
  if (settings.mode === 'locked') return true
  if (settings.mode === 'auto') return usesMouseLook
  return false
}
