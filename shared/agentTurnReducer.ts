import { AgentPart, AgentTurn, AgentTurnEvent, ENDED_TURN_PHASES } from './agentTypes'

/**
 * Apply one turn event to a session's turn list. Pure and shared by the main process
 * (live snapshot) and the renderer (panel state). Events whose seq is not newer than the
 * turn's seq were already applied (e.g. included in a snapshot) and are ignored.
 */
export function applyTurnEvent(turns: AgentTurn[], ev: AgentTurnEvent): AgentTurn[] {
  if (ev.type === 'turn_started') {
    if (turns.some((t) => t.id === ev.turnId)) return turns
    const started: AgentTurn = {
      id: ev.turnId,
      sessionId: ev.sessionId,
      prompt: ev.data.prompt,
      phase: 'queued',
      parts: [],
      startedAt: ev.data.startedAt,
      seq: ev.seq,
    }
    return [...turns.filter((t) => !t.optimistic), started]
  }

  const idx = turns.findIndex((t) => t.id === ev.turnId)
  if (idx === -1 || ev.seq <= turns[idx].seq) return turns
  const next = applyToTurn({ ...turns[idx], seq: ev.seq }, ev)
  const copy = turns.slice()
  copy[idx] = next
  return copy
}

function applyToTurn(turn: AgentTurn, ev: AgentTurnEvent): AgentTurn {
  switch (ev.type) {
    case 'turn_phase':
      return { ...turn, phase: ev.data.phase, phaseDetail: ev.data.detail }
    case 'part_upsert':
      return { ...turn, parts: upsertPart(turn.parts, ev.data) }
    case 'part_append': {
      const i = turn.parts.findIndex((p) => p.id === ev.data.id)
      if (i === -1) {
        const created: AgentPart =
          ev.data.kind === 'reasoning'
            ? { kind: 'reasoning', id: ev.data.id, text: ev.data.delta, startedAt: ev.data.at, childSessionId: ev.data.childSessionId }
            : { kind: 'text', id: ev.data.id, text: ev.data.delta, childSessionId: ev.data.childSessionId }
        return { ...turn, parts: [...turn.parts, created] }
      }
      const parts = turn.parts.slice()
      const part = parts[i] as Extract<AgentPart, { text: string }>
      parts[i] = { ...part, text: part.text + ev.data.delta }
      return { ...turn, parts }
    }
    case 'turn_usage':
      return { ...turn, tokens: ev.data }
    case 'turn_ended':
      return { ...turn, phase: ev.data.phase, phaseDetail: undefined, endedAt: ev.data.endedAt, error: ev.data.error }
    default:
      return turn
  }
}

/** Merge fields into the part with the same id, or append a new part */
function upsertPart(parts: AgentPart[], patch: Partial<AgentPart> & { id: string; kind: AgentPart['kind'] }): AgentPart[] {
  const i = parts.findIndex((p) => p.id === patch.id)
  if (i === -1) {
    const base: any =
      patch.kind === 'tool' ? { status: 'running', tool: 'tool' } : patch.kind === 'reasoning' ? { text: '', startedAt: Date.now() } : { text: '' }
    return [...parts, { ...base, ...patch } as AgentPart]
  }
  const copy = parts.slice()
  copy[i] = { ...copy[i], ...patch } as AgentPart
  return copy
}

export function isTurnRunning(turn: AgentTurn | undefined): boolean {
  return !!turn && !ENDED_TURN_PHASES.has(turn.phase)
}
