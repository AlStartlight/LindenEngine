import React, { useRef, useEffect, useState, useMemo } from 'react'
import { Icons } from '../ui/Icons'
import { useEditorStore } from '../store/editorStore'
import { useI18n } from '../i18n/translations'

export interface ConsoleMessage {
  type: string
  message: string
  time: Date
  details?: string
}

export interface ConsolePanelProps {
  messages?: ConsoleMessage[]
  onClearMessages?: () => void
  onExecuteCommand?: (cmd: string) => void
}

export const ConsolePanel: React.FC<ConsolePanelProps> = ({
  messages = [],
  onClearMessages,
  onExecuteCommand,
}) => {
  const { t } = useI18n()
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [filterType, setFilterType] = useState<'all' | 'error' | 'warn' | 'info'>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [isCollapsed, setIsCollapsed] = useState<boolean>(true)
  const [autoScroll, setAutoScroll] = useState<boolean>(true)
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(new Set())
  const [commandHistory, setCommandHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState<number>(-1)
  const [commandText, setCommandText] = useState<string>('')
  const [localCleared, setLocalCleared] = useState<boolean>(false)

  const { world, playState, startPlay, stopPlay } = useEditorStore()

  // Reset local clear if new messages arrive after clear
  const effectiveMessages = localCleared ? [] : messages

  // Counts by severity
  const counts = useMemo(() => {
    let error = 0
    let warn = 0
    let info = 0
    for (const m of effectiveMessages) {
      if (m.type === 'error') error++
      else if (m.type === 'warn') warn++
      else info++
    }
    return { all: effectiveMessages.length, error, warn, info }
  }, [effectiveMessages])

  // Filter and collapse messages
  const displayItems = useMemo(() => {
    let filtered = effectiveMessages.map((m, originalIndex) => ({ ...m, originalIndex }))

    // Type filter
    if (filterType !== 'all') {
      filtered = filtered.filter((m) => m.type === filterType)
    }

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      filtered = filtered.filter(
        (m) => m.message.toLowerCase().includes(q) || (m.details && m.details.toLowerCase().includes(q))
      )
    }

    if (!isCollapsed) {
      return filtered.map((m) => ({ ...m, count: 1 }))
    }

    // Collapse consecutive identical messages
    const collapsed: Array<ConsoleMessage & { originalIndex: number; count: number }> = []
    for (const item of filtered) {
      const last = collapsed[collapsed.length - 1]
      if (last && last.type === item.type && last.message === item.message) {
        last.count++
        last.time = item.time
      } else {
        collapsed.push({ ...item, count: 1 })
      }
    }
    return collapsed
  }, [effectiveMessages, filterType, searchQuery, isCollapsed])

  // Auto-scroll to bottom when new messages arrive if autoScroll is enabled
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [displayItems, autoScroll])

  const handleClear = () => {
    setLocalCleared(true)
    onClearMessages?.()
    setExpandedIndices(new Set())
  }

  const handleCopyAll = () => {
    const text = displayItems
      .map(
        (m) =>
          `[${m.time.toLocaleTimeString()}] [${m.type.toUpperCase()}] ${m.message}${
            m.count > 1 ? ` (x${m.count})` : ''
          }${m.details ? `\n${m.details}` : ''}`
      )
      .join('\n')
    navigator.clipboard?.writeText(text)
  }

  const toggleExpand = (idx: number) => {
    setExpandedIndices((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const handleRunCommand = (cmd: string) => {
    const trimmed = cmd.trim()
    if (!trimmed) return

    setCommandHistory((prev) => [...prev, trimmed])
    setHistoryIndex(-1)
    setCommandText('')

    if (onExecuteCommand) {
      onExecuteCommand(trimmed)
      return
    }

    // Built-in basic terminal command interpreter
    const [action, ...args] = trimmed.split(' ')
    switch (action.toLowerCase()) {
      case 'clear':
        handleClear()
        break
      case 'help':
        effectiveMessages.push({
          type: 'info',
          message: 'Commands: clear, help, stats, entities, play, stop',
          time: new Date(),
        })
        setLocalCleared(false)
        break
      case 'stats':
        effectiveMessages.push({
          type: 'info',
          message: `Scene Entities: ${world.getEntities().length} | Play State: ${playState}`,
          time: new Date(),
        })
        setLocalCleared(false)
        break
      case 'entities': {
        const ents = world.getEntities().map((e) => e.name).join(', ')
        effectiveMessages.push({
          type: 'info',
          message: `Entities (${world.getEntities().length}): ${ents || 'None'}`,
          time: new Date(),
        })
        setLocalCleared(false)
        break
      }
      case 'play':
        if (playState === 'stopped') startPlay()
        break
      case 'stop':
        if (playState !== 'stopped') stopPlay()
        break
      default:
        effectiveMessages.push({
          type: 'warn',
          message: `Unknown command "${action}". Type "help" for available commands.`,
          time: new Date(),
        })
        setLocalCleared(false)
        break
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleRunCommand(commandText)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (commandHistory.length === 0) return
      const nextIdx = historyIndex === -1 ? commandHistory.length - 1 : Math.max(0, historyIndex - 1)
      setHistoryIndex(nextIdx)
      setCommandText(commandHistory[nextIdx])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIndex === -1) return
      const nextIdx = historyIndex + 1
      if (nextIdx >= commandHistory.length) {
        setHistoryIndex(-1)
        setCommandText('')
      } else {
        setHistoryIndex(nextIdx)
        setCommandText(commandHistory[nextIdx])
      }
    }
  }

  const getMessageColor = (type: string): string => {
    switch (type) {
      case 'error':
        return 'text-red-400'
      case 'warn':
        return 'text-yellow-400'
      case 'success':
        return 'text-green-400'
      case 'info':
      default:
        return 'text-gray-300'
    }
  }

  const getMessageIcon = (type: string): React.ReactNode => {
    switch (type) {
      case 'error':
        return <span className="text-red-400 font-bold">✕</span>
      case 'warn':
        return <span className="text-amber-400 font-bold">⚠</span>
      case 'success':
        return <span className="text-emerald-400 font-bold">✓</span>
      case 'info':
      default:
        return <span className="text-blue-400 font-bold">ℹ</span>
    }
  }

  return (
    <div className="flex flex-col h-full bg-[#16213e] text-xs select-none">
      {/* Console Toolbar */}
      <div className="flex items-center justify-between gap-3 px-3 py-1.5 border-b border-gray-700/50 bg-[#141e38]">
        {/* Severity Filter Buttons */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setFilterType('all')}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
              filterType === 'all' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            {t('console.filter_all')} <span className="opacity-70 text-[10px]">({counts.all})</span>
          </button>
          <button
            onClick={() => setFilterType('error')}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors flex items-center gap-1 ${
              filterType === 'error'
                ? 'bg-red-600 text-white'
                : counts.error > 0
                ? 'text-red-400 hover:bg-red-950/40'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <span>{t('console.errors')}</span>
            <span
              className={`px-1 py-0.2 rounded text-[10px] font-bold ${
                filterType === 'error' ? 'bg-red-800' : 'bg-red-950/60 text-red-300'
              }`}
            >
              {counts.error}
            </span>
          </button>
          <button
            onClick={() => setFilterType('warn')}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors flex items-center gap-1 ${
              filterType === 'warn'
                ? 'bg-amber-600 text-white'
                : counts.warn > 0
                ? 'text-yellow-400 hover:bg-amber-950/40'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <span>{t('console.warnings')}</span>
            <span
              className={`px-1 py-0.2 rounded text-[10px] font-bold ${
                filterType === 'warn' ? 'bg-amber-800' : 'bg-amber-950/60 text-yellow-300'
              }`}
            >
              {counts.warn}
            </span>
          </button>
          <button
            onClick={() => setFilterType('info')}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
              filterType === 'info' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            {t('console.logs')} <span className="opacity-70 text-[10px]">({counts.info})</span>
          </button>
        </div>

        {/* Search, Clear & Options */}
        <div className="flex items-center gap-2">
          {/* Search Box */}
          <div className="relative">
            <Icons.Search className="w-3.5 h-3.5 text-gray-400 absolute left-2 top-1.5 pointer-events-none" />
            <input
              type="text"
              placeholder={t('console.search_placeholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-black/30 border border-gray-700/60 rounded pl-7 pr-2 py-0.5 text-[11px] text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 w-32 focus:w-44 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-1.5 top-1 text-gray-400 hover:text-white text-xs"
              >
                ✕
              </button>
            )}
          </div>

          {/* Collapse Toggle */}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className={`px-2 py-0.5 rounded text-[11px] border transition-colors ${
              isCollapsed
                ? 'bg-blue-600/30 border-blue-500/60 text-blue-200'
                : 'bg-black/20 border-gray-700/50 text-gray-400 hover:text-white'
            }`}
            title="Collapse consecutive duplicate messages"
          >
            Collapse
          </button>

          {/* Auto-scroll Toggle */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-2 py-0.5 rounded text-[11px] border transition-colors ${
              autoScroll
                ? 'bg-blue-600/30 border-blue-500/60 text-blue-200'
                : 'bg-black/20 border-gray-700/50 text-gray-400 hover:text-white'
            }`}
            title="Auto-scroll to bottom on new messages"
          >
            Auto-scroll
          </button>

          {/* Copy All Button */}
          <button
            onClick={handleCopyAll}
            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white border border-gray-700/50"
            title="Copy logs to clipboard"
          >
            <Icons.Copy className="w-3.5 h-3.5" />
          </button>

          {/* Clear Button */}
          <button
            onClick={handleClear}
            className="px-2 py-0.5 rounded bg-red-600/20 hover:bg-red-600/40 text-red-300 border border-red-500/30 text-[11px] font-medium"
            title="Clear all console logs"
          >
            {t('console.clear')}
          </button>
        </div>
      </div>

      {/* Console Message List */}
      <div ref={scrollRef} className="flex-1 overflow-auto p-2 font-mono text-xs space-y-0.5">
        {displayItems.length === 0 ? (
          <div className="text-gray-500 text-center py-8">
            <Icons.Terminal className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-xs">No console messages</p>
          </div>
        ) : (
          displayItems.map((msg, idx) => {
            const isExpanded = expandedIndices.has(idx)
            return (
              <div
                key={idx}
                onClick={() => toggleExpand(idx)}
                className={`flex flex-col px-2 py-1 rounded transition-colors cursor-pointer ${
                  msg.type === 'error'
                    ? 'hover:bg-red-950/20 border-l-2 border-red-500'
                    : msg.type === 'warn'
                    ? 'hover:bg-yellow-950/20 border-l-2 border-amber-500'
                    : 'hover:bg-white/[0.04] border-l-2 border-transparent'
                }`}
              >
                <div className={`flex items-start gap-2 ${getMessageColor(msg.type)}`}>
                  <span className="shrink-0 pt-0.5">{getMessageIcon(msg.type)}</span>
                  <span className="text-gray-500 shrink-0 select-none text-[10px] pt-0.5 font-sans">
                    [{msg.time.toLocaleTimeString()}]
                  </span>
                  <span className="break-all flex-1">{msg.message}</span>

                  {msg.count > 1 && (
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-gray-700 text-white shrink-0 font-sans shadow-xs">
                      ×{msg.count}
                    </span>
                  )}
                </div>

                {/* Details view for multiline error stack or detail payload */}
                {isExpanded && msg.details && (
                  <div className="mt-1 pl-6 text-[11px] text-gray-400 bg-black/40 p-2 rounded border border-gray-700/60 whitespace-pre-wrap font-mono">
                    {msg.details}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Terminal Command Input */}
      <div className="p-2 border-t border-gray-700/50 bg-[#121b33]">
        <div className="flex items-center gap-2 bg-black/40 border border-gray-700/60 rounded px-2 py-1">
          <Icons.Terminal className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Enter command... (help, clear, stats, entities)"
            value={commandText}
            onChange={(e) => setCommandText(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-xs text-white placeholder-gray-500 outline-none font-mono"
          />
          {commandText && (
            <button
              onClick={() => handleRunCommand(commandText)}
              className="text-[10px] bg-blue-600 hover:bg-blue-500 text-white px-2 py-0.5 rounded font-sans"
            >
              Run
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default ConsolePanel
