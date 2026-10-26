import { AgentEvent, AgentPart, AgentTurn, AgentTurnEvent } from '../../shared/agentTypes'
import { applyTurnEvent } from '../../shared/agentTurnReducer'

type OpenCodeEvent = { type: string; created?: number; data?: any }

/** Distributes Omit over a union so each turn event keeps its own data shape */
type TurnEventInput = AgentTurnEvent extends infer E ? (E extends AgentTurnEvent ? Omit<E, 'seq' | 'turnId'> : never) : never

const MAX_OUTPUT_CHARS = 4000
const EDITOR_CONTEXT_RE = /\n*<editor-context>[\s\S]*<\/editor-context>\s*$/

type Tokens = { input: number; output: number; reasoning: number }
const ZERO_TOKENS: Tokens = { input: 0, output: 0, reasoning: 0 }

interface PendingAppend {
  sessionId: string
  kind: 'reasoning' | 'text'
  delta: string
  at: number
  childSessionId?: string
}

/**
 * Turns the OpenCode v2 event stream into Linden turn events (see
 * docs/specs/SPEC-Agent-Live-Progress-Thinking.md). Keeps the running and last turn of
 * every watched session so a panel that opens late can start from a snapshot, folds
 * sub-agent (child session) activity into the parent turn, and coalesces streaming
 * deltas so IPC traffic stays bounded.
 */
export class TurnTracker {
  /** Root sessions we report on */
  private roots = new Set<string>()
  /** Child session id -> root session id */
  private children = new Map<string, string>()
  /** Latest turn per root session (running or last finished) */
  private turns = new Map<string, AgentTurn>()
  private pending = new Map<string, PendingAppend>()
  /** OpenCode reports cumulative session usage; per-turn usage is measured from these */
  private sessionTokens = new Map<string, Tokens>()
  private turnBaseline = new Map<string, Tokens>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private emit: (ev: AgentEvent) => void,
    private throttleMs = 50
  ) {}

  /** Start reporting on a session; pass its current token totals when resuming one */
  watch(sessionId: string, tokens?: Partial<Tokens>): void {
    this.roots.add(sessionId)
    if (tokens) this.sessionTokens.set(sessionId, { ...ZERO_TOKENS, ...tokens })
  }

  unwatch(sessionId: string): void {
    this.roots.delete(sessionId)
    this.turns.delete(sessionId)
    for (const [child, root] of this.children) if (root === sessionId) this.children.delete(child)
  }

  isWatched(sessionId: string): boolean {
    return this.rootOf(sessionId) !== undefined
  }

  snapshot(sessionId: string): AgentTurn | null {
    this.flush()
    return this.turns.get(sessionId) ?? null
  }

  /** Id of the tool call currently running in a session's turn (for attributing diffs) */
  runningToolPartId(sessionId: string): string | undefined {
    const turn = this.turns.get(sessionId)
    const tools = turn?.parts.filter((p) => p.kind === 'tool' && p.status === 'running') ?? []
    return tools[tools.length - 1]?.id
  }

  currentTurnId(sessionId: string): string | undefined {
    return this.turns.get(sessionId)?.id
  }

  /** Returns true when the event belonged to a watched session */
  handle(ev: OpenCodeEvent): boolean {
    const d = ev.data ?? {}
    const at = ev.created ?? Date.now()

    if (ev.type === 'session.created' && d.parentID) {
      const root = this.rootOf(d.parentID)
      if (root) this.children.set(d.sessionID, root)
      return !!root
    }

    const sessionId: string | undefined = d.sessionID
    if (!sessionId) return false
    const root = this.rootOf(sessionId)
    if (!root) return false
    const child = root === sessionId ? undefined : sessionId

    // Sub-agent sessions contribute parts only; their lifecycle does not end the parent turn
    if (child && !ev.type.startsWith('session.reasoning.') && !ev.type.startsWith('session.text.') && !ev.type.startsWith('session.tool.')) {
      return true
    }

    switch (ev.type) {
      case 'session.inbox.enqueued':
        if (d.item?.type === 'user') {
          const prompt = String(d.item.payload?.text ?? '').replace(EDITOR_CONTEXT_RE, '')
          this.startTurn(root, d.inboxID, prompt, at)
        }
        break
      case 'session.execution.started':
        this.ensureTurn(root, at)
        this.send({ type: 'turn_phase', sessionId: root, data: { phase: 'waiting_model' } })
        break
      case 'session.step.started':
        this.send({ type: 'turn_phase', sessionId: root, data: { phase: 'waiting_model', detail: d.model?.id } })
        break
      case 'session.retry.scheduled':
        this.send({
          type: 'turn_phase',
          sessionId: root,
          data: { phase: 'retrying', detail: `percobaan ${d.attempt ?? '?'}${d.error?.message ? ` · ${d.error.message}` : ''}` },
        })
        break
      case 'session.reasoning.started':
        this.send({ type: 'part_upsert', sessionId: root, data: { kind: 'reasoning', id: partId(d, 'r'), startedAt: at, childSessionId: child } })
        if (!child) this.send({ type: 'turn_phase', sessionId: root, data: { phase: 'thinking' } })
        break
      case 'session.reasoning.delta':
        this.append(root, partId(d, 'r'), 'reasoning', d.delta ?? '', at, child)
        break
      case 'session.reasoning.ended':
        this.send({ type: 'part_upsert', sessionId: root, data: { kind: 'reasoning', id: partId(d, 'r'), endedAt: at } })
        break
      case 'session.text.started':
        this.send({ type: 'part_upsert', sessionId: root, data: { kind: 'text', id: partId(d, 't'), childSessionId: child } })
        if (!child) this.send({ type: 'turn_phase', sessionId: root, data: { phase: 'writing' } })
        break
      case 'session.text.delta':
        this.append(root, partId(d, 't'), 'text', d.delta ?? '', at, child)
        break
      case 'session.text.ended':
        // The final text is authoritative; replaces whatever the deltas accumulated
        if (typeof d.text === 'string') {
          this.send({ type: 'part_upsert', sessionId: root, data: { kind: 'text', id: partId(d, 't'), text: d.text } })
        }
        break
      case 'session.tool.input.started':
        this.send({ type: 'part_upsert', sessionId: root, data: { kind: 'tool', id: d.id, tool: d.name, status: 'running', childSessionId: child } })
        if (!child) this.send({ type: 'turn_phase', sessionId: root, data: { phase: 'tool', detail: d.name } })
        break
      case 'session.tool.called':
        this.send({ type: 'part_upsert', sessionId: root, data: { kind: 'tool', id: d.id, input: d.input } })
        break
      case 'session.tool.progress': {
        // Code mode runs one "execute" call that reports the real tools it invokes
        const names = (d.metadata?.toolCalls ?? []).map((t: any) => t.tool).filter(Boolean)
        if (names.length > 0) {
          const tool = [...new Set(names)].join(', ')
          this.send({ type: 'part_upsert', sessionId: root, data: { kind: 'tool', id: d.id, tool } })
          if (!child) this.send({ type: 'turn_phase', sessionId: root, data: { phase: 'tool', detail: tool } })
        }
        break
      }
      case 'session.tool.success':
        this.send({
          type: 'part_upsert',
          sessionId: root,
          data: { kind: 'tool', id: d.id, status: 'completed', output: contentText(d.content) },
        })
        break
      case 'session.tool.failed':
        this.send({
          type: 'part_upsert',
          sessionId: root,
          data: { kind: 'tool', id: d.id, status: 'failed', error: d.error?.message ?? 'Tool gagal' },
        })
        break
      case 'session.usage.updated': {
        if (!d.tokens || child) break
        const totals: Tokens = { input: d.tokens.input ?? 0, output: d.tokens.output ?? 0, reasoning: d.tokens.reasoning ?? 0 }
        this.sessionTokens.set(root, totals)
        const base = this.turnBaseline.get(root) ?? ZERO_TOKENS
        this.send({
          type: 'turn_usage',
          sessionId: root,
          data: { input: totals.input - base.input, output: totals.output - base.output, reasoning: totals.reasoning - base.reasoning },
        })
        break
      }
      case 'session.execution.succeeded':
      case 'session.execution.failed':
      case 'session.execution.interrupted': {
        const phase =
          ev.type === 'session.execution.succeeded' ? 'done' : ev.type === 'session.execution.failed' ? 'failed' : 'interrupted'
        this.send({ type: 'turn_ended', sessionId: root, data: { phase, endedAt: at, error: d.error?.message } })
        break
      }
      default:
        return true
    }
    return true
  }

  /** Send buffered deltas now (also called before any non-delta event to keep order) */
  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    const pending = [...this.pending.entries()]
    this.pending.clear()
    for (const [id, p] of pending) {
      this.dispatch({
        type: 'part_append',
        sessionId: p.sessionId,
        data: { id, kind: p.kind, delta: p.delta, at: p.at, childSessionId: p.childSessionId },
      })
    }
  }

  dispose(): void {
    this.flush()
    this.roots.clear()
    this.children.clear()
    this.turns.clear()
  }

  private rootOf(sessionId: string): string | undefined {
    if (this.roots.has(sessionId)) return sessionId
    return this.children.get(sessionId)
  }

  private startTurn(sessionId: string, turnId: string, prompt: string, at: number): void {
    this.flush()
    const current = this.turns.get(sessionId)
    if (current?.id === turnId) return
    this.turnBaseline.set(sessionId, this.sessionTokens.get(sessionId) ?? ZERO_TOKENS)
    const ev: AgentTurnEvent = { type: 'turn_started', sessionId, turnId, seq: 1, data: { prompt, startedAt: at } }
    this.turns.set(sessionId, applyTurnEvent([], ev)[0])
    this.emit(ev)
  }

  /** Execution can start before we saw the prompt (e.g. watch() after enqueue) */
  private ensureTurn(sessionId: string, at: number): void {
    const current = this.turns.get(sessionId)
    if (!current || current.phase === 'done' || current.phase === 'failed' || current.phase === 'interrupted') {
      this.startTurn(sessionId, `turn_${at}`, '', at)
    }
  }

  private append(sessionId: string, id: string, kind: 'reasoning' | 'text', delta: string, at: number, childSessionId?: string): void {
    if (!delta) return
    const existing = this.pending.get(id)
    if (existing) {
      existing.delta += delta
    } else {
      this.pending.set(id, { sessionId, kind, delta, at, childSessionId })
    }
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), this.throttleMs)
  }

  private send(ev: TurnEventInput): void {
    this.flush()
    this.dispatch(ev)
  }

  private dispatch(ev: TurnEventInput): void {
    const turn = this.turns.get(ev.sessionId)
    if (!turn) return
    const full = { ...ev, turnId: turn.id, seq: turn.seq + 1 } as AgentTurnEvent
    this.turns.set(ev.sessionId, applyTurnEvent([turn], full)[0])
    this.emit(full)
  }
}

function partId(d: any, kind: 'r' | 't'): string {
  return `${d.assistantMessageID}:${kind}${d.ordinal ?? 0}`
}

function contentText(content: any): string {
  const text = Array.isArray(content) ? content.map((c: any) => c?.text ?? '').join('\n') : String(content ?? '')
  return text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}…` : text
}

/**
 * Rebuild turns from OpenCode's stored messages (GET /api/session/:id/message, oldest first)
 */
export function turnsFromMessages(sessionId: string, messages: any[]): AgentTurn[] {
  const turns: AgentTurn[] = []
  let turn: AgentTurn | null = null
  for (const m of messages) {
    if (m.type === 'user') {
      if (turn) turns.push(turn)
      turn = {
        id: m.id,
        sessionId,
        prompt: String(m.text ?? '').replace(EDITOR_CONTEXT_RE, ''),
        phase: 'done',
        parts: [],
        startedAt: m.time?.created ?? 0,
        seq: 0,
      }
      continue
    }
    if (!turn) continue
    if (m.type === 'assistant') {
      ;(m.content ?? []).forEach((c: any, i: number) => {
        const id = `${m.id}:${i}`
        if (c.type === 'reasoning') {
          turn!.parts.push({ kind: 'reasoning', id, text: c.text ?? '', startedAt: c.time?.created ?? 0, endedAt: c.time?.completed ?? c.time?.created ?? 0 })
        } else if (c.type === 'text') {
          turn!.parts.push({ kind: 'text', id, text: c.text ?? '' })
        } else if (c.type === 'tool') {
          const st = c.state ?? {}
          const inner = (st.metadata?.toolCalls ?? []).map((t: any) => t.tool).filter(Boolean)
          turn!.parts.push({
            kind: 'tool',
            id: c.id ?? id,
            tool: inner.length > 0 ? [...new Set(inner)].join(', ') : c.name ?? 'tool',
            input: st.input,
            status: st.status === 'completed' ? 'completed' : st.status === 'running' || st.status === 'pending' ? 'running' : 'failed',
            output: st.content ? contentText(st.content) : undefined,
            error: st.error?.message,
          })
        }
      })
      if (m.tokens) {
        const t = turn.tokens ?? { input: 0, output: 0, reasoning: 0 }
        turn.tokens = { input: t.input + (m.tokens.input ?? 0), output: t.output + (m.tokens.output ?? 0), reasoning: t.reasoning + (m.tokens.reasoning ?? 0) }
      }
      turn.endedAt = m.time?.completed ?? turn.endedAt
    } else if (m.type === 'idle') {
      turn.phase = m.outcome === 'failed' ? 'failed' : m.outcome === 'interrupted' ? 'interrupted' : 'done'
      turn.endedAt = m.time?.created ?? turn.endedAt
    }
  }
  if (turn) turns.push(turn)
  return turns
}
