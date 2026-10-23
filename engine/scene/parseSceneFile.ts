import { SceneFile, SceneFileSchema, SCENE_FORMAT, SCENE_VERSION } from './SceneSchema'

export type SceneLoadErrorCode =
  | 'INVALID_JSON'
  | 'NOT_A_SCENE'
  | 'UNSUPPORTED_VERSION'
  | 'SCHEMA_INVALID'
  | 'FILE_TOO_LARGE'
  | 'READ_FAILED'

export type ParseResult =
  | { ok: true; scene: SceneFile }
  | { ok: false; code: SceneLoadErrorCode; message: string }

export function parseSceneFile(content: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return {
      ok: false,
      code: 'INVALID_JSON',
      message: 'File bukan JSON yang valid.',
    }
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      code: 'NOT_A_SCENE',
      message: 'File ini bukan scene Linden Engine.',
    }
  }

  const record = raw as Record<string, unknown>

  if (record.format !== SCENE_FORMAT) {
    return {
      ok: false,
      code: 'NOT_A_SCENE',
      message: 'File ini bukan scene Linden Engine.',
    }
  }

  if (typeof record.version === 'number' && record.version > SCENE_VERSION) {
    return {
      ok: false,
      code: 'UNSUPPORTED_VERSION',
      message: `Scene dibuat dengan versi engine yang lebih baru (v${record.version}).`,
    }
  }

  const result = SceneFileSchema.safeParse(raw)
  if (!result.success) {
    const firstIssue = result.error.issues[0]
    const pathStr = firstIssue.path.length > 0 ? firstIssue.path.join('.') : 'root'
    return {
      ok: false,
      code: 'SCHEMA_INVALID',
      message: `Isi scene tidak valid: ${pathStr} — ${firstIssue.message}.`,
    }
  }

  return {
    ok: true,
    scene: result.data,
  }
}
