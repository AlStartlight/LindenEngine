import React, { useState } from 'react'
import { Icons } from '../ui/Icons'

export interface OutputPanelProps {
  logs?: string[]
  onClearLogs?: () => void
}

export const OutputPanel: React.FC<OutputPanelProps> = ({
  logs = [],
  onClearLogs,
}) => {
  const [filter, setFilter] = useState<'all' | 'errors' | 'warnings'>('all')

  const filteredLogs = logs.filter((line) => {
    if (filter === 'errors') return line.toLowerCase().includes('error') || line.toLowerCase().includes('failed')
    if (filter === 'warnings') return line.toLowerCase().includes('warn')
    return true
  })

  return (
    <div className="flex flex-col h-full bg-[#16213e] text-gray-200 select-text">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-700/50 bg-[#0f3460]/40 text-xs">
        <div className="flex items-center space-x-2">
          <span className="font-semibold text-gray-300">Build & Export Output</span>
          <span className="text-[11px] text-gray-400">({logs.length} baris)</span>
        </div>

        <div className="flex items-center space-x-2">
          <div className="flex items-center bg-[#16213e] rounded p-0.5 border border-gray-700/60 text-[11px]">
            <button
              onClick={() => setFilter('all')}
              className={`px-2 py-0.5 rounded transition ${
                filter === 'all' ? 'bg-blue-600 text-white font-medium' : 'text-gray-400 hover:text-white'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilter('warnings')}
              className={`px-2 py-0.5 rounded transition ${
                filter === 'warnings' ? 'bg-amber-600 text-white font-medium' : 'text-gray-400 hover:text-white'
              }`}
            >
              Warnings
            </button>
            <button
              onClick={() => setFilter('errors')}
              className={`px-2 py-0.5 rounded transition ${
                filter === 'errors' ? 'bg-rose-600 text-white font-medium' : 'text-gray-400 hover:text-white'
              }`}
            >
              Errors
            </button>
          </div>

          {onClearLogs && (
            <button
              onClick={onClearLogs}
              className="p-1 text-gray-400 hover:text-white rounded hover:bg-white/10"
              title="Clear output"
            >
              <Icons.Trash className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Log view */}
      <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px] space-y-1 bg-black/40">
        {filteredLogs.length > 0 ? (
          filteredLogs.map((line, idx) => {
            const isErr = line.toLowerCase().includes('error') || line.toLowerCase().includes('failed')
            const isWarn = line.toLowerCase().includes('warn')
            return (
              <div
                key={idx}
                className={isErr ? 'text-rose-400' : isWarn ? 'text-amber-400' : 'text-gray-300'}
              >
                {line}
              </div>
            )
          })
        ) : (
          <div className="text-gray-500 italic p-2">Tidak ada log output saat ini.</div>
        )}
      </div>
    </div>
  )
}
