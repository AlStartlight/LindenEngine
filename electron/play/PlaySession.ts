import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { GameSession } from './GameProtocol'
import { compileScripts } from './ScriptCompiler'
import { ensurePlayerRuntime } from './playerRuntime'
import { GAME_ORIGIN, PlayFileChange, PlayStartResult, isValidUiSrc } from '../../shared/playProtocol'
import type { LindenProjectConfig } from '../../shared/types/project'

/**
 * Play sessions: one per press of Play. A session pins the project root, compiled scripts
 * and runtime the linden-game:// protocol may serve; stopping it makes every URL 404.
 */

const sessions = new Map<string, GameSession & { watcher?: fs.FSWatcher }>()

export function getPlaySession(id: string): GameSession | undefined {
  return sessions.get(id)
}

export function readProjectConfig(projectRoot: string): Partial<LindenProjectConfig> {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectRoot, 'project.linden.json'), 'utf-8'))
  } catch {
    return {}
  }
}

/** Validate html.entry: a project-relative .html file that exists, outside dot folders */
export function resolveHtmlEntry(projectRoot: string, entry: unknown): { entry: string } | { error: string } {
  if (!isValidUiSrc(entry)) {
    return { error: `html.entry tidak valid: ${JSON.stringify(entry)} (contoh: "web/index.html")` }
  }
  const full = path.join(projectRoot, entry)
  if (!fs.existsSync(full)) return { error: `File entry HTML Game tidak ditemukan: ${entry}` }
  return { entry: entry.replace(/\\/g, '/') }
}

export interface StartPlayOptions {
  projectPath: string
  /** Writable cache (userData/play-cache) for compiled scripts and the dev runtime */
  cacheRoot: string
  preferSourceRuntime: boolean
  /** Project files of a running session changed: HTML Game reload, recompiled scripts, or UI fragments */
  onFilesChanged?: (change: PlayFileChange) => void
}

export async function startPlaySession(opts: StartPlayOptions): Promise<PlayStartResult> {
  if (!opts.projectPath || !fs.existsSync(opts.projectPath)) {
    return { status: 'error', message: 'Folder proyek tidak ditemukan' }
  }
  const projectRoot = fs.realpathSync(opts.projectPath)
  const config = readProjectConfig(projectRoot)
  const mode = config.runtime === 'html' ? 'html' : 'scene'

  let runtimeDir: string
  try {
    runtimeDir = await ensurePlayerRuntime({ preferSource: opts.preferSourceRuntime, cacheDir: path.join(opts.cacheRoot, 'runtime') })
  } catch (err: any) {
    return { status: 'error', message: err.message }
  }

  const id = crypto.randomUUID()
  const projectKey = crypto.createHash('sha1').update(projectRoot).digest('hex').slice(0, 16)
  const allowNetwork = [...(config.play?.allowNetwork ?? []), ...(mode === 'html' ? config.html?.allowNetwork ?? [] : [])]
  const base: GameSession = {
    id,
    projectRoot,
    mode,
    runtimeDir,
    compiledDir: null,
    injectBridge: config.html?.injectBridge !== false,
    allowNetwork,
    projectConfig: { name: config.name, input: config.input ?? {} },
  }

  if (mode === 'scene') {
    const compiledDir = path.join(opts.cacheRoot, 'projects', projectKey, 'game-scripts')
    const compiled = await compileScripts(projectRoot, compiledDir, { sourcemap: true })
    if (!compiled.ok) {
      return { status: 'error', message: 'Kompilasi script gagal', errors: compiled.errors }
    }
    const session: GameSession & { watcher?: fs.FSWatcher } = { ...base, compiledDir }
    if (opts.onFilesChanged) session.watcher = watchSceneProject(projectRoot, id, compiledDir, opts.onFilesChanged)
    sessions.set(id, session)
    return { status: 'ok', sessionId: id, mode, url: `${GAME_ORIGIN}/${id}/index.html?embedded=1` }
  }

  const resolved = resolveHtmlEntry(projectRoot, config.html?.entry)
  if ('error' in resolved) return { status: 'error', message: resolved.error }

  const session: GameSession & { watcher?: fs.FSWatcher } = { ...base, htmlEntry: resolved.entry }
  if (opts.onFilesChanged) {
    const watchDir = path.dirname(path.join(projectRoot, resolved.entry))
    let timer: ReturnType<typeof setTimeout> | null = null
    try {
      session.watcher = fs.watch(watchDir, { recursive: true }, () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => opts.onFilesChanged!({ sessionId: id, kind: 'reload' }), 300)
      })
    } catch {
      // Live reload is a convenience; Play works without it
    }
  }
  sessions.set(id, session)
  const entryUrl = resolved.entry.split('/').map(encodeURIComponent).join('/')
  return { status: 'ok', sessionId: id, mode, url: `${GAME_ORIGIN}/${id}/${entryUrl}?embedded=1` }
}

/**
 * Hot reload for scene projects: scripts/ changes are recompiled (one compile at a time) and
 * announced with a new version; ui/ changes are forwarded as a list of fragments.
 */
function watchSceneProject(
  projectRoot: string,
  sessionId: string,
  compiledDir: string,
  notify: (change: PlayFileChange) => void
): fs.FSWatcher | undefined {
  let scriptTimer: ReturnType<typeof setTimeout> | null = null
  let uiTimer: ReturnType<typeof setTimeout> | null = null
  const uiFiles = new Set<string>()
  let compiling: Promise<void> = Promise.resolve()

  const recompile = () => {
    compiling = compiling.then(async () => {
      if (!sessions.has(sessionId)) return
      const res = await compileScripts(projectRoot, compiledDir, { sourcemap: true })
      if (!sessions.has(sessionId) || res.cached) return
      if (res.ok) notify({ sessionId, kind: 'scripts', version: Date.now().toString(36) })
      else notify({ sessionId, kind: 'scripts', errors: res.errors })
    })
  }

  try {
    return fs.watch(projectRoot, { recursive: true }, (_event, filename) => {
      if (!filename) return
      const rel = filename.toString().split(path.sep).join('/')
      if (rel.startsWith('scripts/') && /\.(ts|mts|js|mjs)$/.test(rel)) {
        if (scriptTimer) clearTimeout(scriptTimer)
        scriptTimer = setTimeout(recompile, 250)
      } else if (isValidUiSrc(rel)) {
        uiFiles.add(rel)
        if (uiTimer) clearTimeout(uiTimer)
        uiTimer = setTimeout(() => {
          const files = [...uiFiles]
          uiFiles.clear()
          if (sessions.has(sessionId)) notify({ sessionId, kind: 'ui', files })
        }, 200)
      }
    })
  } catch {
    // Hot reload is a convenience; Play works without it
    return undefined
  }
}

export function stopPlaySession(id: string): boolean {
  const session = sessions.get(id)
  if (!session) return false
  session.watcher?.close()
  sessions.delete(id)
  return true
}

export function stopAllPlaySessions(): void {
  for (const id of [...sessions.keys()]) stopPlaySession(id)
}

/** Read an HtmlUI fragment for the editor's edit-mode preview */
export function readUiFragment(projectPath: string, src: unknown): { status: 'ok'; html: string } | { status: 'error'; message: string } {
  if (!isValidUiSrc(src)) return { status: 'error', message: 'Path UI tidak valid' }
  const root = fs.realpathSync(projectPath)
  const full = path.resolve(root, src)
  if (!full.startsWith(root + path.sep) || !fs.existsSync(full)) return { status: 'error', message: `${src} tidak ditemukan` }
  const real = fs.realpathSync(full)
  if (!real.startsWith(root + path.sep)) return { status: 'error', message: 'Path UI keluar dari proyek' }
  return { status: 'ok', html: fs.readFileSync(real, 'utf-8').slice(0, 512 * 1024) }
}
