import React, { useEffect, useState } from 'react'
import { AgentDiffItem, AgentPart, AgentTurn, AgentTurnPhase } from '../../shared/agentTypes'
import { isTurnRunning } from '../../shared/agentTurnReducer'

const PHASE_LABEL: Record<AgentTurnPhase, string> = {
  queued: 'Mengantre…',
  waiting_model: 'Menunggu model…',
  thinking: 'Berpikir…',
  writing: 'Menulis…',
  tool: 'Menjalankan',
  retrying: 'Mencoba ulang',
  done: 'Selesai',
  failed: 'Gagal',
  interrupted: 'Dihentikan',
}

export function phaseLabel(turn: Pick<AgentTurn, 'phase' | 'phaseDetail'>): string {
  const base = PHASE_LABEL[turn.phase]
  if ((turn.phase === 'tool' || turn.phase === 'retrying') && turn.phaseDetail) return `${base} ${turn.phaseDetail}…`
  return base
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 100) / 10)
  if (s < 60) return `${s.toLocaleString('id-ID', { maximumFractionDigits: 1 })} dtk`
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })}k` : String(n)
}

/** One-line summary of a tool call's arguments */
export function summarizeToolInput(input: unknown): string {
  if (input == null) return ''
  if (typeof input === 'string') return input.split('\n')[0]
  const o = input as Record<string, any>
  if (typeof o.code === 'string') {
    const line = o.code.split('\n').find((l: string) => /tools\.\w+\.\w+\(/.test(l)) ?? o.code.split('\n')[0]
    return line.trim()
  }
  if (typeof o.command === 'string') return o.command
  const parts: string[] = []
  if (o.scenePath) parts.push(o.scenePath)
  if (o.scriptPath) parts.push(o.scriptPath)
  if (o.path || o.pattern) parts.push(o.path || o.pattern)
  if (Array.isArray(o.entities)) parts.push(`${o.entities.length} entity`)
  return parts.join(' · ')
}

/** Ticks once a second while `active`, so elapsed times stay current */
function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

const ReasoningView: React.FC<{ part: Extract<AgentPart, { kind: 'reasoning' }>; live: boolean }> = ({ part, live }) => {
  const ended = part.endedAt !== undefined
  // Open while streaming, folded once the model is done thinking (until the user opens it)
  const [open, setOpen] = useState<boolean | null>(null)
  const isOpen = open ?? !ended
  const now = useNow(!ended && live)
  const duration = (part.endedAt ?? now) - part.startedAt

  return (
    <div className="text-[11px]">
      <button onClick={() => setOpen(!isOpen)} className="flex items-center gap-1 text-gray-400 hover:text-gray-200">
        <span className="w-3 inline-block">{isOpen ? '▾' : '▸'}</span>
        <span className={ended ? '' : 'animate-pulse'}>{ended ? 'Berpikir' : 'Berpikir…'}</span>
        <span className="text-gray-500">· {formatDuration(duration)}</span>
      </button>
      {isOpen && part.text && (
        <div className="mt-1 ml-4 pl-2 border-l border-gray-600/60 text-gray-400 italic whitespace-pre-wrap [overflow-wrap:anywhere] leading-relaxed max-h-64 overflow-y-auto">
          {part.text}
        </div>
      )}
    </div>
  )
}

const ToolView: React.FC<{
  part: Extract<AgentPart, { kind: 'tool' }>
  diffs: AgentDiffItem[]
  onRejectDiff: (id: string) => void
}> = ({ part, diffs, onRejectDiff }) => {
  const [open, setOpen] = useState(false)
  const summary = summarizeToolInput(part.input)
  const dot =
    part.status === 'running' ? 'bg-blue-400 animate-ping' : part.status === 'failed' ? 'bg-red-400' : 'bg-emerald-400'
  const statusText = part.status === 'running' ? 'berjalan…' : part.status === 'failed' ? 'gagal' : 'selesai'

  return (
    <div className="text-[11px]">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 text-left hover:bg-white/5 rounded px-1 py-0.5">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
        <span className="font-mono text-gray-200 shrink-0">{part.tool}</span>
        <span className="text-gray-500 truncate flex-1">{summary}</span>
        <span className={part.status === 'failed' ? 'text-red-400' : 'text-gray-500'}>{statusText}</span>
        <span className="text-gray-500 w-3">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="ml-4 mt-1 space-y-1">
          {part.input !== undefined && (
            <pre className="bg-black/30 rounded p-1.5 text-[10px] text-gray-300 whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
              {typeof (part.input as any)?.code === 'string' ? (part.input as any).code : JSON.stringify(part.input, null, 2)}
            </pre>
          )}
          {(part.output || part.error) && (
            <pre
              className={`rounded p-1.5 text-[10px] whitespace-pre-wrap break-all max-h-48 overflow-y-auto ${
                part.error ? 'bg-red-500/10 text-red-300' : 'bg-black/20 text-gray-400'
              }`}
            >
              {part.error ?? part.output}
            </pre>
          )}
        </div>
      )}
      {diffs.map((diff) => (
        <DiffRow key={diff.id} diff={diff} onReject={onRejectDiff} />
      ))}
    </div>
  )
}

const DiffRow: React.FC<{ diff: AgentDiffItem; onReject: (id: string) => void }> = ({ diff, onReject }) => (
  <div className="ml-4 mt-1 flex items-center gap-2 text-[11px] text-gray-400">
    <span className="text-gray-600">└</span>
    <span className="font-mono text-blue-300 truncate">{diff.file}</span>
    <span className="text-[10px] uppercase px-1 rounded bg-emerald-500/15 text-emerald-300">{diff.action}</span>
    {diff.status === 'rejected' ? (
      <span className="text-gray-500">dikembalikan</span>
    ) : (
      <button onClick={() => onReject(diff.id)} className="text-red-300 hover:text-red-200">
        Tolak
      </button>
    )}
  </div>
)

export const TurnView: React.FC<{
  turn: AgentTurn
  diffs: AgentDiffItem[]
  onRejectDiff: (id: string) => void
}> = ({ turn, diffs, onRejectDiff }) => {
  const live = isTurnRunning(turn)
  const placed = new Set<string>()
  const diffsFor = (toolId: string) => {
    const list = diffs.filter((d) => d.toolPartId === toolId)
    list.forEach((d) => placed.add(d.id))
    return list
  }
  const lastTextId = [...turn.parts].reverse().find((p) => p.kind === 'text')?.id

  const body = turn.parts.map((part) => {
    const nested = part.childSessionId ? 'ml-3 pl-2 border-l border-indigo-500/30' : ''
    if (part.kind === 'reasoning') {
      return (
        <div key={part.id} className={nested}>
          <ReasoningView part={part} live={live} />
        </div>
      )
    }
    if (part.kind === 'tool') {
      return (
        <div key={part.id} className={nested}>
          <ToolView part={part} diffs={diffsFor(part.id)} onRejectDiff={onRejectDiff} />
        </div>
      )
    }
    if (!part.text) return null
    return (
      <div key={part.id} className={`text-xs text-gray-200 whitespace-pre-wrap [overflow-wrap:anywhere] leading-relaxed ${nested}`}>
        {part.text}
        {live && part.id === lastTextId && turn.phase === 'writing' && (
          <span className="inline-block w-1.5 h-3 ml-0.5 bg-gray-300 animate-pulse align-middle" />
        )}
      </div>
    )
  })
  // Diffs we could not attribute to a tool call go at the end of their turn
  const unplaced = diffs.filter((d) => !placed.has(d.id))

  return (
    <div className="space-y-2 min-w-0">
      {turn.prompt && (
        <div className="flex justify-end">
          <div className="max-w-[92%] min-w-0 rounded-xl rounded-br-none px-3 py-2 text-xs leading-relaxed bg-blue-600 text-white whitespace-pre-wrap [overflow-wrap:anywhere]">
            {turn.prompt}
          </div>
        </div>
      )}
      <div className="space-y-1.5">
        {body}
        {unplaced.map((diff) => (
          <DiffRow key={diff.id} diff={diff} onReject={onRejectDiff} />
        ))}
        {turn.phase === 'failed' && (
          <div className="p-2 bg-red-500/10 border border-red-500/40 rounded text-[11px] text-red-300 [overflow-wrap:anywhere]">
            Gagal{turn.error ? `: ${turn.error}` : ''}
          </div>
        )}
        {turn.phase === 'interrupted' && <div className="text-[11px] text-gray-500 italic">Dihentikan.</div>}
      </div>
    </div>
  )
}

/** Live status line for the running turn: phase, elapsed time, tokens */
export const TurnStatusBar: React.FC<{ turn: AgentTurn; onStop: () => void }> = ({ turn, onStop }) => {
  const now = useNow(true)
  return (
    <div className="px-3 py-1.5 bg-[#0f3460]/60 border-t border-gray-700/40 flex items-center gap-2 text-[11px] text-gray-300">
      <span
        className={`w-1.5 h-1.5 rounded-full ${turn.phase === 'retrying' ? 'bg-amber-400' : 'bg-blue-400'} animate-pulse`}
      />
      <span className="truncate flex-1" title={phaseLabel(turn)}>
        {phaseLabel(turn)}
      </span>
      <span className="text-gray-500 tabular-nums">{formatDuration(now - turn.startedAt)}</span>
      {turn.tokens && (
        <span className="text-gray-500 tabular-nums" title="Token masuk / keluar">
          {formatTokens(turn.tokens.input)} / {formatTokens(turn.tokens.output)}
        </span>
      )}
      <button onClick={onStop} className="px-2 py-0.5 bg-red-600/80 hover:bg-red-500 text-white rounded">
        Stop
      </button>
    </div>
  )
}
