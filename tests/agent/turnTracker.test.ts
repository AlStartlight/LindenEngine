import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { TurnTracker, turnsFromMessages } from '../../electron/agent/TurnTracker'
import { applyTurnEvent, isTurnRunning } from '../../shared/agentTurnReducer'
import { mergeTurns } from '../../editor/agent/agentStore'
import { isAgentSceneForOpenScene } from '../../editor/agent/agentSceneSync'
import { summarizeToolInput, phaseLabel } from '../../editor/agent/TurnView'
import { AgentEvent, AgentTurn, AgentTurnEvent } from '../../shared/agentTypes'

const FIXTURES = path.resolve(__dirname, '../fixtures/agent')
const readEvents = (name: string) =>
  fs
    .readFileSync(path.join(FIXTURES, name), 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))

function replay(file: string) {
  const events = readEvents(file)
  const sessionId = events.find((e) => e.data?.sessionID)!.data.sessionID
  const emitted: AgentEvent[] = []
  const tracker = new TurnTracker((e) => emitted.push(e), 0)
  tracker.watch(sessionId)
  for (const e of events) tracker.handle(e)
  tracker.flush()
  const turnEvents = emitted.filter((e): e is AgentTurnEvent => 'turnId' in e)
  const turns = turnEvents.reduce<AgentTurn[]>((acc, e) => applyTurnEvent(acc, e), [])
  return { tracker, sessionId, emitted: turnEvents, turns }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('TurnTracker with a recorded OpenCode turn (reasoning + code-mode tool)', () => {
  const { tracker, sessionId, emitted, turns } = replay('turn-reasoning-tool.jsonl')

  it('builds one finished turn with reasoning, the real tool name and the final text', () => {
    expect(turns).toHaveLength(1)
    const turn = turns[0]
    expect(turn.phase).toBe('done')
    expect(turn.prompt).toMatch(/project_info/)

    const kinds = turn.parts.map((p) => p.kind)
    expect(kinds[0]).toBe('reasoning')
    expect(kinds).toContain('tool')
    expect(kinds.at(-1)).toBe('text')

    const reasoning = turn.parts[0] as any
    expect(reasoning.text.length).toBeGreaterThan(10)
    expect(reasoning.endedAt).toBeGreaterThanOrEqual(reasoning.startedAt)

    const tool = turn.parts.find((p) => p.kind === 'tool') as any
    expect(tool.tool).toBe('linden.project_info')
    expect(tool.status).toBe('completed')
    expect(tool.output).toMatch(/ZebraQuest/)
    expect((turn.parts.at(-1) as any).text).toMatch(/ZebraQuest/)
  })

  it('reports phases in order and numbers events without gaps', () => {
    const phases = emitted.filter((e) => e.type === 'turn_phase').map((e: any) => e.data.phase)
    expect(phases[0]).toBe('waiting_model')
    expect(phases).toContain('thinking')
    expect(phases).toContain('tool')
    expect(phases.indexOf('thinking')).toBeLessThan(phases.lastIndexOf('writing'))
    expect(emitted.map((e) => e.seq)).toEqual(emitted.map((_, i) => i + 1))
    expect(emitted.at(-1)!.type).toBe('turn_ended')
  })

  it('keeps a snapshot equal to the renderer-side reduction', () => {
    expect(tracker.snapshot(sessionId)).toEqual(turns[0])
  })

  it('ignores replayed events (same seq) so a snapshot plus live events never duplicates text', () => {
    const again = emitted.reduce<AgentTurn[]>((acc, e) => applyTurnEvent(acc, e), turns)
    expect(again).toEqual(turns)
  })
})

describe('TurnTracker with a recorded provider outage', () => {
  it('surfaces each retry and ends the turn as failed with the provider error', () => {
    const { emitted, turns } = replay('turn-retry-failed.jsonl')
    const retries = emitted.filter((e) => e.type === 'turn_phase' && (e as any).data.phase === 'retrying')
    expect(retries.length).toBeGreaterThanOrEqual(5)
    expect((retries[0] as any).data.detail).toMatch(/percobaan 2 · .*unavailable/i)
    expect(turns[0].phase).toBe('failed')
    expect(turns[0].error).toMatch(/unavailable/i)
    expect(isTurnRunning(turns[0])).toBe(false)
  })
})

describe('TurnTracker streaming and sessions', () => {
  const base = (type: string, data: any, created = 1000) => ({ type, created, data: { sessionID: 's1', ...data } })

  function started(throttleMs = 50) {
    const emitted: AgentEvent[] = []
    const tracker = new TurnTracker((e) => emitted.push(e), throttleMs)
    tracker.watch('s1')
    tracker.handle(base('session.inbox.enqueued', { inboxID: 'u1', item: { type: 'user', payload: { text: 'buat game\n\n<editor-context>\n{"a":1}\n</editor-context>' } } }))
    tracker.handle(base('session.execution.started', {}))
    return { emitted, tracker }
  }

  it('strips the editor context from the prompt', () => {
    const { emitted } = started()
    expect((emitted[0] as any).data.prompt).toBe('buat game')
  })

  it('coalesces 1000 deltas into a few IPC events with identical text', () => {
    vi.useFakeTimers()
    const { emitted, tracker } = started(50)
    tracker.handle(base('session.text.started', { assistantMessageID: 'a1', ordinal: 0 }))
    for (let i = 0; i < 1000; i++) tracker.handle(base('session.text.delta', { assistantMessageID: 'a1', ordinal: 0, delta: 'x' }))
    vi.advanceTimersByTime(60)
    const appends = emitted.filter((e) => e.type === 'part_append')
    expect(appends.length).toBeLessThanOrEqual(3)
    expect(appends.map((e: any) => e.data.delta).join('')).toBe('x'.repeat(1000))
    expect((tracker.snapshot('s1')!.parts[0] as any).text).toBe('x'.repeat(1000))
  })

  it('flushes buffered text before the next non-delta event to keep order', () => {
    const { emitted, tracker } = started(10_000)
    tracker.handle(base('session.text.delta', { assistantMessageID: 'a1', ordinal: 0, delta: 'Hai' }))
    tracker.handle(base('session.tool.input.started', { assistantMessageID: 'a1', id: 'c1', name: 'execute' }))
    const types = emitted.map((e) => e.type)
    expect(types.indexOf('part_append')).toBeLessThan(types.lastIndexOf('part_upsert'))
  })

  it('folds sub-agent sessions into the parent turn without ending it', () => {
    const { emitted, tracker } = started()
    tracker.handle({ type: 'session.created', data: { sessionID: 'child', parentID: 's1' } })
    tracker.handle({ type: 'session.tool.input.started', data: { sessionID: 'child', assistantMessageID: 'c', id: 'k1', name: 'glob' } })
    tracker.handle({ type: 'session.execution.succeeded', data: { sessionID: 'child' } })
    const turn = tracker.snapshot('s1')!
    expect(turn.parts[0]).toMatchObject({ kind: 'tool', tool: 'glob', childSessionId: 'child' })
    expect(isTurnRunning(turn)).toBe(true)
    expect(emitted.some((e) => e.type === 'turn_ended')).toBe(false)
  })

  it('ignores sessions it does not watch', () => {
    const emitted: AgentEvent[] = []
    const tracker = new TurnTracker((e) => emitted.push(e), 0)
    expect(tracker.handle(base('session.execution.started', {}))).toBe(false)
    expect(emitted).toHaveLength(0)
  })

  it('reports per-turn token usage from cumulative session totals', () => {
    const emitted: AgentEvent[] = []
    const tracker = new TurnTracker((e) => emitted.push(e), 0)
    tracker.watch('s1', { input: 1000, output: 100, reasoning: 0 })
    tracker.handle(base('session.inbox.enqueued', { inboxID: 'u2', item: { type: 'user', payload: { text: 'lagi' } } }))
    tracker.handle(base('session.usage.updated', { tokens: { input: 1500, output: 160, reasoning: 0 } }))
    expect(tracker.snapshot('s1')!.tokens).toEqual({ input: 500, output: 60, reasoning: 0 })
  })

  it('attributes diffs to the running tool call', () => {
    const { tracker } = started()
    tracker.handle(base('session.tool.input.started', { assistantMessageID: 'a1', id: 'c9', name: 'execute' }))
    expect(tracker.runningToolPartId('s1')).toBe('c9')
    tracker.handle(base('session.tool.success', { assistantMessageID: 'a1', id: 'c9', content: [] }))
    expect(tracker.runningToolPartId('s1')).toBeUndefined()
  })
})

describe('turnsFromMessages (session history)', () => {
  it('rebuilds reasoning, the code-mode tool and the text from stored messages', () => {
    const stored = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'messages-reasoning-tool.json'), 'utf-8'))
    const turns = turnsFromMessages('s', stored.data)
    expect(turns).toHaveLength(1)
    const kinds = turns[0].parts.map((p) => p.kind)
    expect(kinds).toEqual(['reasoning', 'tool', 'text'])
    expect(turns[0].parts[1]).toMatchObject({ tool: 'linden.project_info', status: 'completed' })
    expect(turns[0].phase).toBe('done')
  })
})

describe('mergeTurns', () => {
  const turn = (id: string, seq: number, extra: Partial<AgentTurn> = {}): AgentTurn => ({
    id, sessionId: 's', prompt: '', phase: 'tool', parts: [], startedAt: 0, seq, ...extra,
  })

  it('keeps the copy that has seen more events and drops a superseded optimistic turn', () => {
    const merged = mergeTurns([turn('a', 0, { phase: 'done' }), turn('b', 5)], [turn('b', 7), turn('local', 0, { optimistic: true })])
    expect(merged.map((t) => [t.id, t.seq])).toEqual([['a', 0], ['b', 7]])
  })
})

describe('editor helpers', () => {
  it('matches the agent scene file to the open scene', () => {
    expect(isAgentSceneForOpenScene('/p/game', 'scenes/Main.lscene', '/p/game/scenes/Main.lscene')).toBe(true)
    expect(isAgentSceneForOpenScene('C:\\p\\game', 'scenes/Main.lscene', 'C:\\p\\game\\scenes\\Main.lscene')).toBe(true)
    expect(isAgentSceneForOpenScene('/p/game', 'scenes/Other.lscene', '/p/game/scenes/Main.lscene')).toBe(false)
    expect(isAgentSceneForOpenScene('/p/game', 'scenes/Main.lscene', null)).toBe(false)
  })

  it('summarizes tool input and phases', () => {
    expect(summarizeToolInput({ code: 'const r = 1\nconst x = await tools.linden.scene_apply({})' })).toBe('const x = await tools.linden.scene_apply({})')
    expect(summarizeToolInput({ command: 'ls -la' })).toBe('ls -la')
    expect(summarizeToolInput({ scenePath: 'scenes/Main.lscene', entities: [1, 2] })).toBe('scenes/Main.lscene · 2 entity')
    expect(phaseLabel({ phase: 'tool', phaseDetail: 'linden.scene_apply' })).toBe('Menjalankan linden.scene_apply…')
    expect(phaseLabel({ phase: 'waiting_model' })).toBe('Menunggu model…')
  })
})
