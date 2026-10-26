import fs from 'node:fs'
import path from 'node:path'
import { mimeTypeFor } from '../../shared/mime'
import { GAME_HOST, GAME_SCHEME } from '../../shared/playProtocol'

/**
 * linden-game://play/<sessionId>/<path> — serves a Play session to the viewport's Game Frame.
 * Kept free of Electron imports so routing and path guards are unit-testable.
 */

export interface GameSession {
  id: string
  /** Real path of the project root */
  projectRoot: string
  mode: 'scene' | 'html'
  runtimeDir: string
  /** Directory with compiled scripts, served at game-scripts/ */
  compiledDir: string | null
  /** Project-relative entry page for mode 'html' */
  htmlEntry?: string
  injectBridge: boolean
  allowNetwork: string[]
  /** Served at __linden/project.json for the HTML Game bridge (input actions) */
  projectConfig: Record<string, unknown>
}

export interface GameResponse {
  status: number
  headers: Record<string, string>
  body?: string | Buffer
  filePath?: string
}

const SAFE_ORIGIN = /^(https?|wss?):\/\/[a-z0-9.-]+(:\d+)?$/i

/**
 * Scene mode runs only Linden's runtime + compiled scripts, so inline script is refused.
 * HTML Games are entirely project code (often inline <script>/import maps); their isolation
 * comes from the separate origin, so inline is allowed and opted-in origins may serve code/assets.
 */
export function buildGameCsp(allowNetwork: string[] = [], mode: 'scene' | 'html' = 'scene'): string {
  const origins = allowNetwork.filter((o) => SAFE_ORIGIN.test(o))
  const extra = origins.length ? ` ${origins.join(' ')}` : ''
  const assets = mode === 'html' ? extra : ''
  return [
    "default-src 'self'",
    mode === 'html' ? `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${assets}` : "script-src 'self' 'wasm-unsafe-eval'",
    `style-src 'self' 'unsafe-inline'${assets}`,
    `img-src 'self' data: blob:${assets}`,
    `media-src 'self' data: blob:${assets}`,
    `font-src 'self' data:${assets}`,
    `connect-src 'self' data: blob:${extra}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ')
}

/** Errors render as a dark page inside the Game View instead of black-on-white text */
function text(status: number, body: string): GameResponse {
  const escaped = body.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" },
    body: `<!doctype html><html><head><meta charset="utf-8"><title>${status}</title><style>html,body{margin:0;height:100%;background:#0f172a;color:#cbd5e1;font:13px system-ui,sans-serif;display:flex;align-items:center;justify-content:center;text-align:center}b{color:#f87171;display:block;font-size:15px;margin-bottom:6px}</style></head><body><div><b>${status}</b>${escaped}<br><small>Tekan Stop lalu Play lagi.</small></div></body></html>`,
  }
}

/** Resolve rel inside root, refusing traversal, dot-segments and symlinks that leave root */
export function safeJoin(root: string, rel: string): string | null {
  const segments = rel.split('/').filter(Boolean)
  if (segments.some((s) => s === '..' || s.startsWith('.') || s.includes('\\') || s.includes('\0'))) return null
  const candidate = path.resolve(root, ...segments)
  if (candidate !== root && !candidate.startsWith(root + path.sep)) return null
  if (!fs.existsSync(candidate)) return candidate // caller reports 404
  const real = fs.realpathSync(candidate)
  const realRoot = fs.realpathSync(root)
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null
  return real
}

function fileResponse(filePath: string | null, csp: string): GameResponse {
  if (!filePath) return text(403, 'Forbidden')
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return text(404, 'Not Found')
  return {
    status: 200,
    headers: { 'Content-Type': mimeTypeFor(filePath), 'Content-Security-Policy': csp, 'Cache-Control': 'no-store' },
    filePath,
  }
}

function htmlResponse(html: string, csp: string): GameResponse {
  return {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp, 'Cache-Control': 'no-store' },
    body: html,
  }
}

/** Insert a classic script as the first thing in <head> so it runs before the game's modules */
export function injectHeadScript(html: string, src: string): string {
  const tag = `<script src="${src}"></script>`
  const head = /<head(\s[^>]*)?>/i.exec(html)
  if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length)
  const htmlTag = /<html(\s[^>]*)?>/i.exec(html)
  if (htmlTag) return html.slice(0, htmlTag.index + htmlTag[0].length) + `<head>${tag}</head>` + html.slice(htmlTag.index + htmlTag[0].length)
  return tag + html
}

export function renderPlayerTemplate(template: string, appName: string): string {
  const escaped = appName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  return template
    .replace(/\{\{APP_NAME\}\}/g, () => escaped)
    .replace(/\{\{LOADING_COLOR\}\}/g, '#0f172a')
    .replace(/\{\{WEBGPU_REQUIRED\}\}/g, 'false')
    .replace(/\{\{CANVAS_MODE\}\}/g, 'responsive')
    .replace(/src="game\.js"/, 'src="__linden/runtime/game.js"')
}

export function resolveGameRequest(rawUrl: string, getSession: (id: string) => GameSession | undefined): GameResponse {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return text(400, 'Bad Request')
  }
  if (url.protocol !== `${GAME_SCHEME}:` || url.hostname !== GAME_HOST) return text(404, 'Not Found')

  let parts: string[]
  try {
    parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  } catch {
    return text(400, 'Bad Request')
  }
  const session = parts.length > 0 ? getSession(parts[0]) : undefined
  if (!session) return text(404, 'Play session tidak aktif')

  const rel = parts.slice(1).join('/')
  const csp = buildGameCsp(session.allowNetwork, session.mode)

  if (rel.startsWith('__linden/')) {
    const sub = rel.slice('__linden/'.length)
    if (sub === 'bridge.js') return fileResponse(path.join(session.runtimeDir, 'linden-bridge.js'), csp)
    if (sub === 'project.json') {
      return { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(session.projectConfig) }
    }
    if (sub.startsWith('runtime/')) {
      const file = sub.slice('runtime/'.length)
      if (file === 'index.html') return text(404, 'Not Found')
      return fileResponse(safeJoin(session.runtimeDir, file), csp)
    }
    return text(404, 'Not Found')
  }

  if (session.mode === 'scene') {
    if (rel === '' || rel === 'index.html') {
      const template = fs.readFileSync(path.join(session.runtimeDir, 'index.html'), 'utf-8')
      return htmlResponse(renderPlayerTemplate(template, String(session.projectConfig.name ?? 'Linden Game')), csp)
    }
    if (rel.startsWith('game-scripts/')) {
      if (!session.compiledDir) return text(404, 'Not Found')
      return fileResponse(safeJoin(session.compiledDir, rel.slice('game-scripts/'.length)), csp)
    }
  }

  const filePath = safeJoin(session.projectRoot, rel)
  if (session.mode === 'html' && session.injectBridge && filePath && rel === session.htmlEntry && fs.existsSync(filePath)) {
    const html = fs.readFileSync(filePath, 'utf-8')
    return htmlResponse(injectHeadScript(html, `/${session.id}/__linden/bridge.js`), csp)
  }
  return fileResponse(filePath, csp)
}
