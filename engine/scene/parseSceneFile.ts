import { SceneFile, SceneFileSchema, SceneFileV1Schema, SCENE_FORMAT, SCENE_VERSION } from './SceneSchema'
import { migrateSceneV1ToV2 } from './migrations'

export type SceneLoadErrorCode =
  | 'INVALID_JSON'
  | 'NOT_A_SCENE'
  | 'UNSUPPORTED_VERSION'
  | 'SCHEMA_INVALID'
  | 'FILE_TOO_LARGE'
  | 'READ_FAILED'

export type ParseResult =
  | { ok: true; scene: SceneFile; migratedFrom?: 1 }
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

  const issue = (err: { issues: { path: PropertyKey[]; message: string }[] }): ParseResult => {
    const firstIssue = err.issues[0]
    const pathStr = firstIssue.path.length > 0 ? firstIssue.path.join('.') : 'root'
    return {
      ok: false,
      code: 'SCHEMA_INVALID',
      message: `Isi scene tidak valid: ${pathStr} — ${firstIssue.message}.`,
    }
  }

  // v1: validate in its own schema, then migrate (1 m primitives, entities + components)
  if (record.version === 1) {
    const v1 = SceneFileV1Schema.safeParse(raw)
    if (!v1.success) return issue(v1.error)
    const migrated = SceneFileSchema.safeParse(migrateSceneV1ToV2(v1.data))
    if (!migrated.success) return issue(migrated.error)
    return { ok: true, scene: migrated.data, migratedFrom: 1 }
  }

  const result = SceneFileSchema.safeParse(raw)
  if (!result.success) return issue(result.error)

  return {
    ok: true,
    scene: result.data,
  }
}
