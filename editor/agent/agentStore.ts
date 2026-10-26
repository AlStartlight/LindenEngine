import { create } from 'zustand'
import {
  AgentStatus,
  AgentProviderInfo,
  AgentSessionInfo,
  AgentDiffItem,
  AgentPermissionRequest,
  AgentMode,
  AgentEvent,
  AgentTurn,
  PromptTemplate,
} from '../../shared/agentTypes'
import { applyTurnEvent, isTurnRunning } from '../../shared/agentTurnReducer'
import { invokeIpc } from '../project/ipc'

interface AgentState {
  status: AgentStatus | null
  providers: AgentProviderInfo[]
  selectedProvider: string
  selectedModel: string
  sessions: AgentSessionInfo[]
  currentSessionId: string | null
  /** Turns of the current session, oldest first */
  turns: AgentTurn[]
  pendingDiffs: AgentDiffItem[]
  /** Permission prompts waiting for an answer, oldest first; the card shows the first */
  permissionQueue: AgentPermissionRequest[]
  mode: AgentMode
  /** True while the last turn of the current session has not ended */
  isGenerating: boolean
  error: string | null
  templates: PromptTemplate[]
  /** Project the agent was initialised for, so re-mounting the panel does not restart it */
  initializedFor: string | null

  handleEvent: (event: AgentEvent) => void
  init: (projectPath?: string) => Promise<void>
  refreshStatus: () => Promise<void>
  startAgent: (projectPath: string) => Promise<void>
  stopAgent: () => Promise<void>
  loadProviders: () => Promise<void>
  setModel: (providerId: string, modelId: string) => Promise<void>
  loadSessions: (options?: { select?: boolean }) => Promise<void>
  createSession: (title?: string) => Promise<void>
  selectSession: (sessionId: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  sendPrompt: (prompt: string, context?: any) => Promise<void>
  abortPrompt: () => Promise<void>
  applyDiff: (diffId: string) => Promise<void>
  rejectDiff: (diffId: string) => Promise<void>
  replyPermission: (allow: boolean) => Promise<void>
  setMode: (mode: AgentMode) => void
  loadTemplates: () => Promise<void>
}

const electronApi = () => (typeof window !== 'undefined' ? window.electronAPI : undefined)

const withTurns = (turns: AgentTurn[]) => ({ turns, isGenerating: isTurnRunning(turns[turns.length - 1]) })

/**
 * Merge freshly fetched turns with what live events already applied: for the same
 * turn the copy with the higher seq has seen more events and wins.
 */
export function mergeTurns(fetched: AgentTurn[], local: AgentTurn[]): AgentTurn[] {
  const merged = fetched.map((t) => {
    const l = local.find((x) => x.id === t.id)
    return l && l.seq > t.seq ? l : t
  })
  for (const l of local) {
    if (!merged.some((t) => t.id === l.id) && !(l.optimistic && merged.length > 0)) merged.push(l)
  }
  return merged
}

export const useAgentStore = create<AgentState>((set, get) => ({
  status: null,
  providers: [],
  selectedProvider: '',
  selectedModel: '',
  sessions: [],
  currentSessionId: null,
  turns: [],
  pendingDiffs: [],
  permissionQueue: [],
  mode: 'build',
  isGenerating: false,
  error: null,
  templates: [],
  initializedFor: null,

  handleEvent: (event: AgentEvent) => {
    switch (event.type) {
      case 'status_changed':
        set({ status: event.data })
        return
      case 'diff_proposed':
        set((s) => ({ pendingDiffs: [...s.pendingDiffs.filter((d) => d.id !== event.data.id), event.data] }))
        return
      case 'permission_requested':
        set((s) => ({
          permissionQueue: s.permissionQueue.some((r) => r.id === event.data.id)
            ? s.permissionQueue
            : [...s.permissionQueue, event.data],
        }))
        return
      case 'permission_resolved':
        set((s) => ({ permissionQueue: s.permissionQueue.filter((r) => r.id !== event.data.id) }))
        return
      case 'error':
        set({ error: event.data.message })
        return
    }

    // Turn events
    const { currentSessionId, turns, sessions } = get()
    if (event.type === 'turn_ended') {
      // Requests of a finished turn can no longer be answered
      set((s) => ({ permissionQueue: s.permissionQueue.filter((r) => r.sessionId !== event.sessionId) }))
    }
    if (event.sessionId === currentSessionId) {
      set(withTurns(applyTurnEvent(turns, event)))
      return
    }
    // A prompt started elsewhere (e.g. the New Project wizard): follow it unless the
    // session on screen is busy
    if (event.type === 'turn_started' && !isTurnRunning(turns[turns.length - 1])) {
      set({ currentSessionId: event.sessionId, pendingDiffs: [], error: null, ...withTurns(applyTurnEvent([], event)) })
      if (!sessions.some((s) => s.id === event.sessionId)) get().loadSessions({ select: false })
      // Pull earlier turns of that session without losing events applied meanwhile
      get().selectSession(event.sessionId)
    }
  },

  init: async (projectPath?: string) => {
    if (!electronApi()) return
    if (projectPath && get().initializedFor === projectPath) return
    // Sessions, turns and prompts belong to one project folder; never carry them over
    set({
      initializedFor: projectPath ?? null,
      sessions: [],
      currentSessionId: null,
      pendingDiffs: [],
      permissionQueue: [],
      error: null,
      ...withTurns([]),
    })

    await get().refreshStatus()
    // Providers and sessions come from the running OpenCode server, so start it first
    if (projectPath && !get().status?.running) {
      await get().startAgent(projectPath)
    }
    await get().loadProviders()
    await get().loadSessions()
    await get().loadTemplates()
  },

  refreshStatus: async () => {
    const api = electronApi()
    if (api?.agentGetStatus) {
      const status = await invokeIpc<AgentStatus>(() => api.agentGetStatus!())
      set({ status })
    }
  },

  startAgent: async (projectPath: string) => {
    const api = electronApi()
    if (api?.agentStart) {
      const status = await invokeIpc<AgentStatus>(() => api.agentStart!(projectPath))
      set({ status })
    }
  },

  stopAgent: async () => {
    const api = electronApi()
    if (api?.agentStop) {
      await invokeIpc(() => api.agentStop!())
      await get().refreshStatus()
    }
    set({ initializedFor: null, sessions: [], currentSessionId: null, permissionQueue: [], pendingDiffs: [], ...withTurns([]) })
  },

  loadProviders: async () => {
    const api = electronApi()
    if (api?.agentGetProviders) {
      const providers = (await invokeIpc<AgentProviderInfo[]>(() => api.agentGetProviders!())) || []
      // Main lists OpenCode's default provider first; keep its default model selected
      const status = get().status
      const provider = providers.find((p) => p.id === status?.activeProvider) || providers[0]
      const model = provider?.models.find((m) => m.id === status?.activeModel) || provider?.models[0]
      set({
        providers,
        selectedProvider: provider?.id || '',
        selectedModel: model?.id || '',
      })
    }
  },

  setModel: async (providerId: string, modelId: string) => {
    const api = electronApi()
    set({ selectedProvider: providerId, selectedModel: modelId })
    if (api?.agentSetModel) {
      await invokeIpc(() => api.agentSetModel!(providerId, modelId))
    }
  },

  loadSessions: async (options = { select: true }) => {
    const api = electronApi()
    if (!api?.agentListSessions) return
    const sessions = (await invokeIpc<AgentSessionInfo[]>(() => api.agentListSessions!())) || []
    set({ sessions })
    if (!options.select || get().currentSessionId) return
    if (sessions[0] && get().status?.running) {
      await get().selectSession(sessions[0].id)
    }
  },

  createSession: async (title?: string) => {
    const api = electronApi()
    if (api?.agentCreateSession) {
      const newSession = await invokeIpc<AgentSessionInfo>(() => api.agentCreateSession!(title))
      set((state) => ({
        sessions: [newSession, ...state.sessions],
        currentSessionId: newSession.id,
        pendingDiffs: [],
        error: null,
        ...withTurns([]),
      }))
    }
  },

  selectSession: async (sessionId: string) => {
    if (get().currentSessionId !== sessionId) {
      set({ currentSessionId: sessionId, pendingDiffs: [], error: null, ...withTurns([]) })
    }
    const api = electronApi()
    if (!api?.agentGetSessionTurns) return
    const fetched = (await invokeIpc<AgentTurn[]>(() => api.agentGetSessionTurns!(sessionId))) || []
    if (get().currentSessionId !== sessionId) return
    set(withTurns(mergeTurns(fetched, get().turns)))
  },

  deleteSession: async (sessionId: string) => {
    const api = electronApi()
    if (api?.agentDeleteSession) {
      await invokeIpc(() => api.agentDeleteSession!(sessionId))
      const wasCurrent = get().currentSessionId === sessionId
      const remaining = get().sessions.filter((s) => s.id !== sessionId)
      set({ sessions: remaining })
      if (wasCurrent) {
        set({ currentSessionId: null, ...withTurns([]) })
        if (remaining[0]) await get().selectSession(remaining[0].id)
      }
    }
  },

  sendPrompt: async (prompt: string, context?: any) => {
    const api = electronApi()
    if (!api?.agentSubmitPrompt) return

    let sessionId = get().currentSessionId
    if (!sessionId) {
      await get().createSession()
      sessionId = get().currentSessionId
    }
    if (!sessionId) return

    // Placeholder until the server's turn_started replaces it
    const optimistic: AgentTurn = {
      id: `local_${Date.now()}`,
      sessionId,
      prompt,
      phase: 'queued',
      parts: [],
      startedAt: Date.now(),
      seq: 0,
      optimistic: true,
    }
    set((state) => ({ error: null, ...withTurns([...state.turns, optimistic]) }))

    try {
      await invokeIpc(() =>
        api.agentSubmitPrompt!({
          sessionId,
          prompt,
          mode: get().mode,
          context,
        })
      )
    } catch (e: any) {
      set((state) => ({ error: e?.message || String(e), ...withTurns(state.turns.filter((t) => !t.optimistic)) }))
    }
  },

  abortPrompt: async () => {
    const api = electronApi()
    const { currentSessionId } = get()
    if (api?.agentAbortPrompt && currentSessionId) {
      // The turn ends through its turn_ended(interrupted) event
      await invokeIpc(() => api.agentAbortPrompt!(currentSessionId))
    }
  },

  applyDiff: async (diffId: string) => {
    const api = electronApi()
    if (api?.agentApplyDiff) {
      await invokeIpc(() => api.agentApplyDiff!(diffId))
      set((state) => ({
        pendingDiffs: state.pendingDiffs.map((d) => (d.id === diffId ? { ...d, status: 'applied' } : d)),
      }))
    }
  },

  rejectDiff: async (diffId: string) => {
    const api = electronApi()
    if (api?.agentRejectDiff) {
      await invokeIpc(() => api.agentRejectDiff!(diffId))
      set((state) => ({
        pendingDiffs: state.pendingDiffs.map((d) => (d.id === diffId ? { ...d, status: 'rejected' } : d)),
      }))
    }
  },

  replyPermission: async (allow: boolean) => {
    const api = electronApi()
    const [head] = get().permissionQueue
    if (!head) return
    // Drop it right away so the next request in the queue shows without waiting for IPC
    set((s) => ({ permissionQueue: s.permissionQueue.filter((r) => r.id !== head.id) }))
    if (api?.agentReplyPermission) {
      await invokeIpc(() => api.agentReplyPermission!(head.id, allow))
    }
  },

  setMode: (mode: AgentMode) => {
    set({ mode })
  },

  loadTemplates: async () => {
    const api = electronApi()
    if (api?.agentGetTemplates) {
      const templates = (await invokeIpc<PromptTemplate[]>(() => api.agentGetTemplates!())) || []
      set({ templates })
    }
  },
}))
