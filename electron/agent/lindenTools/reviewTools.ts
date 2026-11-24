import fs from 'node:fs'
import path from 'node:path'
import type { ToolDefinition } from './index'

/**
 * Review gate (SPEC-DSH-MCP-Agent-Integration P4).
 *
 * A shared, per-project review record any agent can request and an independent
 * agent can verdict. It is not "Raft consensus": it is one review artifact, a
 * configurable quorum (default 1), and an optional hard gate on browser export
 * (`project.linden.json` → `agentReview.required`). The engine enforces only what
 * the project asked for.
 */

export interface ReviewVerdictRecord {
  role: string
  clientId: string
  verdict: 'approve' | 'reject'
  note?: string
  at: string
}

export interface ReviewState {
  status: 'idle' | 'requested' | 'approved' | 'rejected'
  target?: string
  requestedBy?: string
  requestedAt?: string
  quorum: number
  verdicts: ReviewVerdictRecord[]
}

const REVIEW_DIR = '.linden/agents'
const REVIEW_FILE = 'review.json'

const emptyState = (): ReviewState => ({ status: 'idle', quorum: 1, verdicts: [] })

export function readReview(projectPath: string): ReviewState {
  try {
    const raw = fs.readFileSync(path.join(projectPath, REVIEW_DIR, REVIEW_FILE), 'utf-8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return emptyState()
    return {
      status: ['idle', 'requested', 'approved', 'rejected'].includes(parsed.status) ? parsed.status : 'idle',
      ...(typeof parsed.target === 'string' ? { target: parsed.target } : {}),
      ...(typeof parsed.requestedBy === 'string' ? { requestedBy: parsed.requestedBy } : {}),
      ...(typeof parsed.requestedAt === 'string' ? { requestedAt: parsed.requestedAt } : {}),
      quorum: Number.isFinite(parsed.quorum) ? Math.max(1, Math.min(5, Math.round(parsed.quorum))) : 1,
      verdicts: Array.isArray(parsed.verdicts)
        ? parsed.verdicts.filter((v: any) => v && (v.verdict === 'approve' || v.verdict === 'reject') && typeof v.role === 'string')
        : [],
    }
  } catch {
    return emptyState()
  }
}

function writeReview(projectPath: string, state: ReviewState): void {
  const dir = path.join(projectPath, REVIEW_DIR)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, REVIEW_FILE), JSON.stringify(state, null, 2), 'utf-8')
}

/**
 * Reason export is blocked, or null when the project does not require review or
 * the current review is approved.
 */
export function reviewBlocksExport(projectPath: string): string | null {
  let required = false
  try {
    const config = JSON.parse(fs.readFileSync(path.join(projectPath, 'project.linden.json'), 'utf-8'))
    required = config?.agentReview?.required === true
  } catch {
    return null
  }
  if (!required) return null
  const review = readReview(projectPath)
  if (review.status === 'approved') return null
  return (
    `LINDEN_E_REVIEW: proyek ini mewajibkan review agent sebelum export (agentReview.required=true). ` +
    `Status sekarang: ${review.status}. Minta review dengan linden_review_gate {action:"request"}, ` +
    'lalu agent lain memberi verdict approve.'
  )
}

function summarize(state: ReviewState) {
  const approvals = [...new Set(state.verdicts.filter((v) => v.verdict === 'approve').map((v) => v.role))]
  const rejections = [...new Set(state.verdicts.filter((v) => v.verdict === 'reject').map((v) => v.role))]
  return { approvals, rejections, quorum: state.quorum }
}

export const REVIEW_TOOLS: Record<string, ToolDefinition> = {
  linden_review_gate: {
    name: 'linden_review_gate',
    description:
      'Review gate bersama antar agent: action "request" meminta review untuk target tertentu, "verdict" memberi approve/reject ' +
      '(requester tidak boleh menyetujui review-nya sendiri), "status" membaca keadaan. Quorum default 1 reviewer independen. ' +
      'Bila project.linden.json punya agentReview.required=true, linden_export_web menolak sampai status approved.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['request', 'verdict', 'status'] },
        target: { type: 'string', description: 'Apa yang direview, mis. "scenes/Main.lscene" atau "boss fight patch"' },
        note: { type: 'string' },
        verdict: { type: 'string', enum: ['approve', 'reject'] },
        quorum: { type: 'number', description: 'Jumlah approve independen yang dibutuhkan (1-5, default 1)' },
      },
      required: ['action'],
    },
    async execute(
      projectPath: string,
      args: { action: 'request' | 'verdict' | 'status'; target?: string; note?: string; verdict?: 'approve' | 'reject'; quorum?: number },
      options
    ) {
      try {
        const role = options?.agent?.role || 'unknown'
        const clientId = options?.agent?.clientId || 'unknown'
        const state = readReview(projectPath)

        if (args.action === 'status') {
          return { success: true, data: { projectPath, review: state, ...summarize(state) } }
        }

        if (args.action === 'request') {
          if (!args.target || !args.target.trim()) return { success: false, error: 'action "request" membutuhkan "target"' }
          const next: ReviewState = {
            status: 'requested',
            target: args.target.trim(),
            requestedBy: role,
            requestedAt: new Date().toISOString(),
            quorum: Math.max(1, Math.min(5, Math.round(args.quorum ?? 1))),
            verdicts: [],
          }
          writeReview(projectPath, next)
          return { success: true, data: { review: next, message: 'Review diminta; agent lain harus memberi verdict approve.' } }
        }

        // verdict
        if (!args.verdict) return { success: false, error: 'action "verdict" membutuhkan "verdict": approve | reject' }
        if (state.status !== 'requested') {
          return { success: false, error: `Tidak ada review aktif (status: ${state.status}); panggil action "request" dulu` }
        }
        if (state.requestedBy === role) {
          return { success: false, error: `Role ${role} tidak boleh memberi verdict untuk review yang ia minta sendiri` }
        }
        if (state.verdicts.some((v) => v.role === role)) {
          return { success: false, error: `Role ${role} sudah memberi verdict untuk review ini` }
        }

        const verdicts: ReviewVerdictRecord[] = [
          ...state.verdicts,
          {
            role,
            clientId,
            verdict: args.verdict,
            ...(args.note ? { note: args.note } : {}),
            at: new Date().toISOString(),
          },
        ]
        const approvals = [...new Set(verdicts.filter((v) => v.verdict === 'approve').map((v) => v.role))]
        const rejected = verdicts.some((v) => v.verdict === 'reject')
        const status: ReviewState['status'] = rejected ? 'rejected' : approvals.length >= state.quorum ? 'approved' : 'requested'
        const next: ReviewState = { ...state, verdicts, status }
        writeReview(projectPath, next)

        return {
          success: true,
          data: {
            review: next,
            ...summarize(next),
            message: status === 'approved' ? 'Review disetujui.' : status === 'rejected' ? 'Review ditolak.' : 'Menunggu verdict lain.',
          },
        }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },
}
