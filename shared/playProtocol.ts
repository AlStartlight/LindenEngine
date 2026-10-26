import { z } from 'zod'

/**
 * Messages between the editor and the Game Frame (the sandboxed iframe that runs
 * LindenPlayer or an HTML Game during Play). Validated on both sides because the
 * frame runs project code.
 */

export const GAME_SCHEME = 'linden-game'
export const GAME_HOST = 'play'
export const GAME_ORIGIN = `${GAME_SCHEME}://${GAME_HOST}`

/** Compiled scripts are served/written here so they never shadow a project's own scripts/*.js */
export const COMPILED_SCRIPTS_DIR = 'game-scripts'

const SourceLocation = z.object({ file: z.string(), line: z.number(), col: z.number() })

export const EditorToGameSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('linden:init'),
    mode: z.enum(['scene', 'html']),
    scene: z.string().optional(),
    projectConfig: z.record(z.string(), z.any()).optional(),
  }),
  z.object({ type: z.literal('linden:pause') }),
  z.object({ type: z.literal('linden:resume') }),
  z.object({ type: z.literal('linden:step') }),
  z.object({ type: z.literal('linden:setTimeScale'), value: z.number().min(0).max(10) }),
  /** Scripts were recompiled; re-import them with ?v=<version> */
  z.object({ type: z.literal('linden:reloadScripts'), version: z.string().regex(/^[\w-]+$/) }),
  /** HtmlUI fragments changed on disk (project-relative paths) */
  z.object({ type: z.literal('linden:reloadUi'), files: z.array(z.string()).max(200) }),
])

export const GameToEditorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('linden:ready') }),
  z.object({ type: z.literal('linden:started') }),
  z.object({
    type: z.literal('linden:log'),
    level: z.enum(['log', 'info', 'warn', 'error']),
    args: z.array(z.string()).max(50),
    source: SourceLocation.optional(),
  }),
  z.object({
    type: z.literal('linden:stats'),
    fps: z.number(),
    frameMs: z.number(),
    triangles: z.number().optional(),
    drawCalls: z.number().optional(),
    renderer: z.enum(['webgpu', 'webgl2']).optional(),
  }),
  z.object({ type: z.literal('linden:fatal'), message: z.string(), stack: z.string().optional() }),
  z.object({ type: z.literal('linden:releaseFocus') }),
])

export type EditorToGameMessage = z.infer<typeof EditorToGameSchema>
export type GameToEditorMessage = z.infer<typeof GameToEditorSchema>

export function parseEditorToGame(data: unknown): EditorToGameMessage | null {
  const res = EditorToGameSchema.safeParse(data)
  return res.success ? res.data : null
}

export function parseGameToEditor(data: unknown): GameToEditorMessage | null {
  const res = GameToEditorSchema.safeParse(data)
  return res.success ? res.data : null
}

/** Main process -> editor: project files of a running Play session changed */
export type PlayFileChange =
  | { sessionId: string; kind: 'reload' }
  | { sessionId: string; kind: 'scripts'; version?: string; errors?: { file?: string; line?: number; col?: number; message: string }[] }
  | { sessionId: string; kind: 'ui'; files: string[] }

/** Result of preparing a Play session in the main process */
export interface PlayStartResult {
  status: 'ok' | 'error'
  sessionId?: string
  url?: string
  mode?: 'scene' | 'html'
  errors?: { file?: string; line?: number; col?: number; message: string }[]
  message?: string
}

/** 'scripts/ai/Enemy.ts' -> 'game-scripts/ai/Enemy.js' */
export function compiledScriptPath(src: string): string {
  const rel = src.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/^scripts\//, '')
  return `${COMPILED_SCRIPTS_DIR}/${rel.replace(/\.(ts|tsx|mts|js|mjs)$/, '')}.js`
}

/** Script sources must stay inside scripts/ and be TS/JS modules */
export function isValidScriptSrc(src: unknown): src is string {
  if (typeof src !== 'string' || !src) return false
  const norm = src.replace(/\\/g, '/')
  if (!norm.startsWith('scripts/') || norm.split('/').some((seg) => seg === '..' || seg === '')) return false
  return /\.(ts|js|mjs)$/.test(norm) && !norm.endsWith('.d.ts')
}

/** HTML UI fragments must stay inside the project and be .html files */
export function isValidUiSrc(src: unknown): src is string {
  if (typeof src !== 'string' || !src) return false
  const norm = src.replace(/\\/g, '/')
  if (norm.startsWith('/') || /^[a-zA-Z]:/.test(norm)) return false
  if (norm.split('/').some((seg) => seg === '..' || seg === '' || seg.startsWith('.'))) return false
  return /\.html?$/.test(norm)
}
