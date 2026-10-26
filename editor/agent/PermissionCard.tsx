import React, { useLayoutEffect, useRef, useState } from 'react'
import { AgentPermissionRequest } from '../../shared/agentTypes'
import { permissionLines, permissionTitle } from './permissionFormat'

/** Collapsed height: about three lines of 11px text (leading 1.5) */
const COLLAPSED_MAX_HEIGHT = '4.5rem'

/**
 * Permission prompt for the head of the queue. Long commands and paths wrap anywhere
 * (they never widen the panel), the detail list is capped at three lines with a
 * "show all" toggle, and every line carries its full value as a tooltip.
 */
export const PermissionCard: React.FC<{
  request: AgentPermissionRequest
  position: number
  total: number
  projectPath?: string | null
  onReply: (allow: boolean) => void
}> = ({ request, position, total, projectPath, onReply }) => {
  const lines = permissionLines(request, projectPath)
  const isShell = request.action === 'shell'
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const detailRef = useRef<HTMLDivElement>(null)

  // New request: start collapsed and re-measure whether the toggle is needed
  useLayoutEffect(() => {
    setExpanded(false)
  }, [request.id])

  useLayoutEffect(() => {
    const el = detailRef.current
    if (el && !expanded) setOverflowing(el.scrollHeight > el.clientHeight + 1)
  }, [request.id, expanded, lines.length])

  return (
    <div
      role="alertdialog"
      aria-label={permissionTitle(request.action)}
      className="m-2 p-2.5 bg-amber-500/10 border border-amber-500/40 rounded-lg flex flex-col gap-1.5 min-w-0 max-h-[40%] overflow-y-auto"
    >
      <div className="flex items-start gap-1.5 text-amber-300 font-semibold text-[11px] min-w-0">
        <span aria-hidden>⚠️</span>
        <span className="flex-1 min-w-0 [overflow-wrap:anywhere]">Izin diperlukan: {permissionTitle(request.action)}</span>
        {total > 1 && (
          <span className="shrink-0 px-1.5 rounded-full bg-amber-500/20 text-amber-200 font-normal" title={`${total} permintaan izin menunggu`}>
            {position} dari {total}
          </span>
        )}
      </div>

      {request.message && (
        <p className="text-[11px] leading-normal text-gray-300 whitespace-pre-wrap [overflow-wrap:anywhere]">{request.message}</p>
      )}

      {lines.length > 0 && (
        <div
          ref={detailRef}
          className={`text-[11px] leading-normal rounded min-w-0 ${isShell ? 'bg-black/30 p-1.5 font-mono text-gray-200' : 'text-gray-300'} ${
            expanded ? 'max-h-48 overflow-y-auto' : 'overflow-hidden'
          }`}
          style={expanded ? undefined : { maxHeight: COLLAPSED_MAX_HEIGHT }}
        >
          {lines.map((line, i) => (
            <div key={`${i}:${line.full}`} title={line.full} className="flex items-start gap-1.5 min-w-0">
              {!isShell && <span className="text-gray-500 shrink-0">•</span>}
              <span className={`flex-1 min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] ${isShell ? '' : 'font-mono'}`}>
                {isShell && <span className="text-gray-500 select-none">$ </span>}
                {line.text}
              </span>
              {line.change && <span className="shrink-0 text-gray-500">{line.change}</span>}
            </div>
          ))}
        </div>
      )}

      {(overflowing || expanded) && (
        <button onClick={() => setExpanded(!expanded)} className="self-start text-[11px] text-amber-300 hover:text-amber-200">
          {expanded ? 'Tampilkan lebih sedikit' : `Tampilkan semua${lines.length > 1 ? ` (${lines.length})` : ''}`}
        </button>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 pt-0.5">
        <button
          onClick={() => onReply(false)}
          className="px-2 py-1 bg-red-600/30 hover:bg-red-600/50 text-red-200 rounded text-[11px]"
        >
          Tolak
        </button>
        <button
          onClick={() => onReply(true)}
          className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[11px] font-medium"
        >
          Izinkan
        </button>
      </div>
    </div>
  )
}
