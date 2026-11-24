import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { ToolDefinition, ToolResult } from './index'
import type { AgentDiffItem } from '../../../shared/agentTypes'

/**
 * Time-travel snapshots (SPEC-DSH-MCP-Agent-Integration P4).
 *
 * A snapshot copies the project's text sources (scenes, scripts, ui, web and
 * project.linden.json) under `.linden/snapshots/<id>/`, which is git-ignored and
 * bounded. restore() writes them back as ordinary files and reports a diff per
 * file, taking a "before restore" snapshot first so a restore is itself undoable.
 */

const SNAPSHOT_DIR = '.linden/snapshots'
const INCLUDE_DIRS = ['scenes', 'scripts', 'ui', 'web']
const INCLUDE_FILES = ['project.linden.json']
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_TOTAL_BYTES = 20 * 1024 * 1024
const MAX_SNAPSHOTS = 20

interface SnapshotFile {
  path: string
  size: number
  sha256: string
}

interface SnapshotMeta {
  id: string
  label?: string
  note?: string
  createdAt: string
  projectName?: string
  files: SnapshotFile[]
  totalBytes: number
  truncated?: boolean
}

function safeJoin(projectPath: string, rel: string): string {
  const base = path.resolve(projectPath)
  const full = path.resolve(projectPath, rel)
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error(`Path di luar proyek: ${rel}`)
  return full
}

function safeId(id: string): string {
  if (!/^snap_[A-Za-z0-9_-]+$/.test(id)) throw new Error(`ID snapshot tidak valid: ${id}`)
  return id
}

function collectFiles(projectPath: string): { files: { rel: string; size: number }[]; truncated: boolean } {
  const out: { rel: string; size: number }[] = []
  let total = 0
  let truncated = false

  const add = (rel: string) => {
    const full = safeJoin(projectPath, rel)
    let stat: fs.Stats
    try {
      stat = fs.statSync(full)
    } catch {
      return
    }
    if (!stat.isFile()) return
    if (stat.size > MAX_FILE_BYTES) {
      truncated = true
      return
    }
    if (total + stat.size > MAX_TOTAL_BYTES) {
      truncated = true
      return
    }
    total += stat.size
    out.push({ rel: rel.replace(/\\/g, '/'), size: stat.size })
  }

  const walk = (relDir: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(safeJoin(projectPath, relDir), { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const rel = `${relDir}/${entry.name}`
      if (entry.isDirectory()) walk(rel)
      else if (entry.isFile()) add(rel)
    }
  }

  for (const dir of INCLUDE_DIRS) walk(dir)
  for (const file of INCLUDE_FILES) add(file)
  return { files: out, truncated }
}

function readMeta(projectPath: string, id: string): SnapshotMeta {
  const file = safeJoin(projectPath, `${SNAPSHOT_DIR}/${safeId(id)}/meta.json`)
  if (!fs.existsSync(file)) throw new Error(`Snapshot ${id} tidak ditemukan`)
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as SnapshotMeta
}

function listMetas(projectPath: string): SnapshotMeta[] {
  const dir = path.join(projectPath, SNAPSHOT_DIR)
  if (!fs.existsSync(dir)) return []
  const metas: SnapshotMeta[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('snap_')) continue
    try {
      metas.push(readMeta(projectPath, entry.name))
    } catch {
      // A half-written snapshot is ignored
    }
  }
  return metas.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

function projectName(projectPath: string): string | undefined {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(projectPath, 'project.linden.json'), 'utf-8'))
    return typeof config?.name === 'string' ? config.name : undefined
  } catch {
    return undefined
  }
}

function prune(projectPath: string): void {
  const metas = listMetas(projectPath)
  for (const meta of metas.slice(MAX_SNAPSHOTS)) {
    fs.rmSync(path.join(projectPath, SNAPSHOT_DIR, meta.id), { recursive: true, force: true })
  }
}

/** Create a snapshot; also used internally before a restore */
export function createSnapshot(projectPath: string, label?: string, note?: string): SnapshotMeta {
  const { files, truncated } = collectFiles(projectPath)
  const id = `snap_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`
  const dir = path.join(projectPath, SNAPSHOT_DIR, id)
  fs.mkdirSync(path.join(dir, 'files'), { recursive: true })

  const recorded: SnapshotFile[] = []
  let totalBytes = 0
  for (const file of files) {
    const from = safeJoin(projectPath, file.rel)
    const to = path.join(dir, 'files', file.rel)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(from)).digest('hex')
    recorded.push({ path: file.rel, size: file.size, sha256 })
    totalBytes += file.size
  }

  const meta: SnapshotMeta = {
    id,
    ...(label ? { label } : {}),
    ...(note ? { note } : {}),
    createdAt: new Date().toISOString(),
    projectName: projectName(projectPath),
    files: recorded,
    totalBytes,
    ...(truncated ? { truncated } : {}),
  }
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8')
  prune(projectPath)
  return meta
}

/** Current review-gate state of a snapshot-less project (used by linden_export_web) */
export function latestSnapshotId(projectPath: string): string | null {
  return listMetas(projectPath)[0]?.id ?? null
}

export const SNAPSHOT_TOOLS: Record<string, ToolDefinition> = {
  linden_snapshot_create: {
    name: 'linden_snapshot_create',
    description:
      'Menyimpan snapshot proyek (scenes/, scripts/, ui/, web/, project.linden.json) ke .linden/snapshots untuk rollback. ' +
      'Snapshot menyimpan teks sumber, bukan aset biner besar. Maksimal 20 snapshot terakhir disimpan.',
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Nama singkat, mis. "sebelum refactor boss"' },
        note: { type: 'string' },
      },
    },
    async execute(projectPath: string, args: { label?: string; note?: string }) {
      try {
        const meta = createSnapshot(projectPath, args.label, args.note)
        return {
          success: true,
          data: { id: meta.id, label: meta.label, fileCount: meta.files.length, totalBytes: meta.totalBytes, createdAt: meta.createdAt, truncated: meta.truncated ?? false },
        }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },

  linden_snapshot_list: {
    name: 'linden_snapshot_list',
    description: 'Daftar snapshot proyek (terbaru dulu) beserta jumlah file dan ukurannya.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Default 20' },
      },
    },
    async execute(projectPath: string, args: { limit?: number }) {
      try {
        const metas = listMetas(projectPath).slice(0, Math.max(1, Math.min(args.limit ?? MAX_SNAPSHOTS, MAX_SNAPSHOTS)))
        return {
          success: true,
          data: {
            snapshots: metas.map((m) => ({
              id: m.id,
              label: m.label,
              note: m.note,
              createdAt: m.createdAt,
              fileCount: m.files.length,
              totalBytes: m.totalBytes,
            })),
          },
        }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },

  linden_snapshot_restore: {
    name: 'linden_snapshot_restore',
    description:
      'Mengembalikan file dari snapshot (scenes/scripts/ui/web/project.linden.json). Snapshot "before restore" dibuat otomatis ' +
      'sehingga restore bisa dibatalkan. File yang tidak ada di snapshot dibiarkan.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID snapshot dari linden_snapshot_list' },
      },
      required: ['id'],
    },
    async execute(projectPath: string, args: { id: string }, options): Promise<ToolResult> {
      try {
        const meta = readMeta(projectPath, args.id)
        const pre = createSnapshot(projectPath, `before restore ${meta.id}`)
        const restored: string[] = []
        const restoredBinary: string[] = []
        const skipped: string[] = []
        for (const file of meta.files) {
          const from = path.join(projectPath, SNAPSHOT_DIR, meta.id, 'files', file.path)
          if (!fs.existsSync(from)) {
            skipped.push(file.path)
            continue
          }
          const to = safeJoin(projectPath, file.path)
          const buffer = fs.readFileSync(from)
          const beforeBuffer = fs.existsSync(to) ? fs.readFileSync(to) : null
          fs.mkdirSync(path.dirname(to), { recursive: true })
          // Byte copy: web/ can hold images or fonts, which must not be decoded as UTF-8
          fs.writeFileSync(to, buffer)
          const textLike =
            /\.(ts|tsx|js|jsx|mjs|cjs|json|html?|css|svg|txt|md|lscene)$/i.test(file.path) || !buffer.includes(0)
          if (!textLike) {
            restoredBinary.push(file.path)
            continue
          }
          const diff: AgentDiffItem = {
            id: `diff_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            file: file.path,
            kind: file.path.startsWith('scenes/') ? 'scene' : file.path.startsWith('scripts/') ? 'script' : 'config',
            action: beforeBuffer ? 'modify' : 'create',
            description: `Restore ${file.path} dari snapshot ${meta.id}`,
            before: beforeBuffer ? beforeBuffer.toString('utf-8') : '',
            after: buffer.toString('utf-8'),
            status: 'applied',
          }
          options?.onDiff?.(diff)
          restored.push(file.path)
        }
        return {
          success: true,
          data: {
            id: meta.id,
            restored,
            restoredBinary,
            skipped,
            preRestoreId: pre.id,
            restoredCount: restored.length + restoredBinary.length,
          },
        }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },
}
