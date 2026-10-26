import { AgentEvent } from '../../shared/agentTypes'
import { useAgentStore } from './agentStore'

/**
 * The one place the renderer listens to agent events. Mounted by EditorLayout for the
 * open project (not by AgentPanel), so turns started while the panel is hidden, e.g. by
 * the New Project wizard, are not lost. Returns the unsubscribe function.
 */
export function subscribeAgentEvents(onEvent?: (event: AgentEvent) => void): () => void {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  if (!api?.onAgentEvent) return () => {}
  return api.onAgentEvent((event: AgentEvent) => {
    if (!event) return
    useAgentStore.getState().handleEvent(event)
    onEvent?.(event)
  })
}
