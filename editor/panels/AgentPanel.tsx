import React, { useState, useEffect, useRef } from 'react'
import { TurnView, TurnStatusBar } from '../agent/TurnView'
import { PermissionCard } from '../agent/PermissionCard'
import { isTurnRunning } from '../../shared/agentTurnReducer'
import { useAgentStore } from '../agent/agentStore'
import { useEditorStore } from '../store/editorStore'
import { Icons } from '../ui/Icons'
import { PromptTemplate } from '../../shared/agentTypes'

export const AgentPanel: React.FC = () => {
  const {
    status,
    providers,
    selectedProvider,
    selectedModel,
    sessions,
    currentSessionId,
    turns,
    pendingDiffs,
    permissionQueue,
    mode,
    isGenerating,
    error,
    templates,
    init,
    startAgent,
    stopAgent,
    setModel,
    createSession,
    selectSession,
    deleteSession,
    sendPrompt,
    abortPrompt,
    applyDiff,
    rejectDiff,
    replyPermission,
    setMode,
  } = useAgentStore()

  const { projectPath, sceneName, selectedEntityIds } = useEditorStore()

  const [inputPrompt, setInputPrompt] = useState('')
  const [includeContext, setIncludeContext] = useState(true)
  const [showTemplatesModal, setShowTemplatesModal] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Follow new output only while the user is at the bottom; scrolling up pauses it
  const [stickToBottom, setStickToBottom] = useState(true)

  useEffect(() => {
    init(projectPath || undefined)
  }, [projectPath])

  useEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom) el.scrollTop = el.scrollHeight
  }, [turns, pendingDiffs, stickToBottom])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    setStickToBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 24)
  }

  const runningTurn = turns.length > 0 && isTurnRunning(turns[turns.length - 1]) ? turns[turns.length - 1] : null

  const handleSend = () => {
    const text = inputPrompt.trim()
    if (!text || isGenerating) return

    const context = includeContext
      ? {
          sceneName,
          selectedEntityIds,
        }
      : undefined

    sendPrompt(text, context)
    setInputPrompt('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleUseTemplate = (tmpl: PromptTemplate) => {
    setInputPrompt(tmpl.prompt)
    setShowTemplatesModal(false)
  }

  return (
    <div className="flex flex-col h-full min-w-0 bg-[#16213e] text-gray-200 select-none overflow-hidden text-xs">
      {/* Panel Header */}
      <div className="px-3 py-2.5 bg-[#0f3460] border-b border-gray-700/60 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="w-5 h-5 rounded bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold">
            AI
          </div>
          <span className="font-semibold text-white">Linden Agent</span>
          <span
            className={`w-2 h-2 rounded-full ${
              status?.running ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'
            }`}
            title={status?.running ? `OpenCode aktif di port ${status.port}` : 'OpenCode Offline'}
          />
        </div>

        {/* Mode Toggle */}
        <div className="flex bg-[#1a1a2e] rounded p-0.5 border border-gray-700/60">
          <button
            onClick={() => setMode('plan')}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
              mode === 'plan' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Plan
          </button>
          <button
            onClick={() => setMode('build')}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
              mode === 'build' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Build
          </button>
        </div>
      </div>

      {/* Provider & Session Subheader */}
      <div className="px-3 py-2 bg-[#16213e] border-b border-gray-700/40 flex flex-wrap items-center justify-between gap-2">
        {/* Model Select */}
        <div className="flex items-center space-x-1 flex-1 min-w-[140px]">
          <select
            value={selectedModel}
            onChange={(e) => {
              const modelId = e.target.value
              const prov = providers.find((p) => p.models.some((m) => m.id === modelId))
              if (prov) setModel(prov.id, modelId)
            }}
            className="w-full bg-[#1a1a2e] border border-gray-700/60 rounded px-2 py-1 text-[11px] text-gray-300 focus:outline-none focus:border-blue-500"
          >
            {providers.flatMap((p) =>
              p.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {p.name} / {m.name}
                </option>
              ))
            )}
            {providers.length === 0 && (
              <option value="default">Default AI Model</option>
            )}
          </select>
        </div>

        {/* Sessions Dropdown */}
        <div className="flex items-center space-x-1">
          <select
            value={currentSessionId || ''}
            onChange={(e) => selectSession(e.target.value)}
            className="max-w-[110px] bg-[#1a1a2e] border border-gray-700/60 rounded px-1.5 py-1 text-[11px] text-gray-300 focus:outline-none"
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
            {sessions.length === 0 && <option value="">Sesi Baru</option>}
          </select>
          <button
            onClick={() => createSession('Sesi Baru')}
            className="p-1 bg-white/5 hover:bg-white/10 text-gray-300 rounded border border-gray-700/50"
            title="Buat Sesi Baru"
          >
            <Icons.Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {!status?.running && status?.error && (
        <div className="m-2 p-2.5 bg-red-500/10 border border-red-500/40 rounded-lg text-[11px] text-red-300 flex flex-col gap-2 [overflow-wrap:anywhere]">
          <span>{status.error}</span>
          {projectPath && (
            <button
              onClick={() => startAgent(projectPath)}
              className="self-end px-2 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded"
            >
              Coba lagi
            </button>
          )}
        </div>
      )}

      {/* Permission queue: answer the oldest request first */}
      {permissionQueue.length > 0 && (
        <PermissionCard
          request={permissionQueue[0]}
          position={1}
          total={permissionQueue.length}
          projectPath={projectPath}
          onReply={replyPermission}
        />
      )}

      {/* Turn timeline */}
      <div className="flex-1 relative overflow-hidden">
        <div ref={scrollRef} onScroll={handleScroll} className="h-full overflow-y-auto p-3 space-y-4">
          {turns.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center p-4 text-gray-400">
              <div className="w-12 h-12 rounded-2xl bg-blue-500/10 text-blue-400 flex items-center justify-center text-2xl mb-3 border border-blue-500/20">
                ⚡
              </div>
              <h3 className="font-semibold text-sm text-gray-200 mb-1">Prompt-to-Game AI</h3>
              <p className="text-[11px] text-gray-400 max-w-[240px] mb-4">
                Ketik prompt bahasa natural untuk membuat game, entity, komponen, atau script TypeScript.
              </p>
              <button
                onClick={() => setShowTemplatesModal(true)}
                className="px-3 py-1.5 bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 rounded border border-blue-500/40 text-xs flex items-center space-x-1.5"
              >
                <span>✨ Mulai dari Template Game</span>
              </button>
            </div>
          )}

          {turns.map((turn) => (
            <TurnView
              key={turn.id}
              turn={turn}
              diffs={pendingDiffs.filter((d) => d.turnId === turn.id || (!d.turnId && turn === turns[turns.length - 1]))}
              onRejectDiff={rejectDiff}
            />
          ))}

          {error && (
            <div className="p-2 bg-red-500/10 border border-red-500/40 rounded text-[11px] text-red-300 [overflow-wrap:anywhere]">{error}</div>
          )}
        </div>

        {!stickToBottom && (
          <button
            onClick={() => setStickToBottom(true)}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-[11px] shadow-lg"
          >
            ↓ Terbaru
          </button>
        )}
      </div>

      {runningTurn && <TurnStatusBar turn={runningTurn} onStop={abortPrompt} />}

      {/* Context Chips & Controls */}
      <div className="px-3 py-1.5 bg-[#0f3460]/40 border-t border-gray-700/40 flex items-center justify-between">
        <label className="flex items-center space-x-1.5 cursor-pointer text-[11px] text-gray-400 hover:text-gray-200">
          <input
            type="checkbox"
            checked={includeContext}
            onChange={(e) => setIncludeContext(e.target.checked)}
            className="rounded bg-[#1a1a2e] border-gray-600 text-blue-500 focus:ring-0 w-3 h-3"
          />
          <span>Konteks Scene: <strong>{sceneName}</strong></span>
        </label>

        <button
          onClick={() => setShowTemplatesModal(true)}
          className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center space-x-1"
        >
          <span>Template</span>
        </button>
      </div>

      {/* Input Box */}
      <div className="p-3 bg-[#0f3460]/70 border-t border-gray-700/60">
        <div className="relative flex flex-col bg-[#16213e] border border-gray-700/80 rounded-xl overflow-hidden focus-within:border-blue-500/80 transition-colors">
          <textarea
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              mode === 'plan'
                ? 'Tanyakan arsitektur atau ide game (Mode Plan)...'
                : 'Ketik prompt (mis: buat platformer 2D dengan koin)...'
            }
            rows={2}
            className="w-full bg-transparent p-2.5 text-xs text-white placeholder-gray-500 focus:outline-none resize-none leading-relaxed"
          />

          <div className="flex items-center justify-between px-2.5 py-1.5 bg-[#1a1a2e]/60 border-t border-gray-800/80">
            <span className="text-[10px] text-gray-500">
              Shift+Enter untuk baris baru
            </span>

            {isGenerating ? (
              <button
                onClick={abortPrompt}
                className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white rounded-md text-[11px] font-medium flex items-center space-x-1"
              >
                <span>Berhenti</span>
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!inputPrompt.trim()}
                className={`px-3 py-1 rounded-md text-[11px] font-medium flex items-center space-x-1 ${
                  inputPrompt.trim()
                    ? 'bg-blue-600 hover:bg-blue-500 text-white'
                    : 'bg-gray-700 text-gray-400 cursor-not-allowed'
                }`}
              >
                <span>Kirim</span>
                <Icons.Play className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Prompt Templates Modal */}
      {showTemplatesModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#16213e] border border-gray-700 rounded-xl shadow-2xl max-w-xl w-full max-h-[80vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-[#0f3460] border-b border-gray-700/60">
              <h3 className="font-semibold text-sm text-white flex items-center space-x-2">
                <span>✨ Template Game Cepat</span>
              </h3>
              <button
                onClick={() => setShowTemplatesModal(false)}
                className="text-gray-400 hover:text-white"
              >
                <Icons.Close className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {templates.map((tmpl) => (
                <div
                  key={tmpl.id}
                  onClick={() => handleUseTemplate(tmpl)}
                  className="p-3 bg-[#1f293d]/80 hover:bg-blue-900/20 border border-gray-700/60 hover:border-blue-500/50 rounded-lg cursor-pointer transition-all flex flex-col gap-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white text-xs">{tmpl.title}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono">
                      {tmpl.dimension}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-400 leading-normal">{tmpl.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
