import { describe, it, expect, beforeEach } from 'vitest'
import { permissionLines, permissionTitle, toProjectRelative } from '../../editor/agent/permissionFormat'
import { useAgentStore } from '../../editor/agent/agentStore'
import { AgentPermissionRequest } from '../../shared/agentTypes'

const req = (id: string, extra: Partial<AgentPermissionRequest> = {}): AgentPermissionRequest => ({
  id,
  sessionId: 's1',
  action: 'shell',
  resources: [],
  timestamp: 0,
  ...extra,
})

describe('permission formatting', () => {
  it('titles known actions and falls back for unknown ones', () => {
    expect(permissionTitle('shell')).toBe('Menjalankan perintah shell')
    expect(permissionTitle('edit')).toBe('Mengubah file')
    expect(permissionTitle('custom_tool')).toBe('Izin "custom_tool"')
  })

  it('shows project paths relative to the project, others unchanged', () => {
    expect(toProjectRelative('/p/game', '/p/game/scenes/Main.lscene')).toBe('scenes/Main.lscene')
    expect(toProjectRelative('/p/game/', '/p/game')).toBe('.')
    expect(toProjectRelative('C:\\p\\game', 'C:\\p\\game\\a.ts')).toBe('a.ts')
    expect(toProjectRelative('/p/game', '/p/gamex/a.ts')).toBe('/p/gamex/a.ts')
    expect(toProjectRelative(null, '/x')).toBe('/x')
  })

  it('keeps one line per resource with the full value for the tooltip', () => {
    const lines = permissionLines(req('a', { action: 'read', resources: ['/p/game/a.ts', '/etc/hosts'] }), '/p/game')
    expect(lines).toEqual([
      { text: 'a.ts', full: '/p/game/a.ts' },
      { text: '/etc/hosts', full: '/etc/hosts' },
    ])
    // Shell commands are never rewritten as paths
    expect(permissionLines(req('b', { resources: ['find /p/game -name x'] }), '/p/game')[0].text).toBe('find /p/game -name x')
  })

  it('uses per-file change summaries for edits', () => {
    const lines = permissionLines(
      req('c', { action: 'edit', resources: ['x'], files: [{ file: '/p/game/x.ts', additions: 4, deletions: 1 }] }),
      '/p/game'
    )
    expect(lines).toEqual([{ text: 'x.ts', full: '/p/game/x.ts', change: '+4 −1' }])
  })
})

describe('permission queue', () => {
  beforeEach(() => useAgentStore.setState({ permissionQueue: [] }))
  const emit = (event: any) => useAgentStore.getState().handleEvent(event)
  const ids = () => useAgentStore.getState().permissionQueue.map((r) => r.id)

  it('queues requests in arrival order without duplicates', () => {
    emit({ type: 'permission_requested', data: req('p1') })
    emit({ type: 'permission_requested', data: req('p2') })
    emit({ type: 'permission_requested', data: req('p1') })
    expect(ids()).toEqual(['p1', 'p2'])
  })

  it('answers the head first, then shows the next one', async () => {
    emit({ type: 'permission_requested', data: req('p1') })
    emit({ type: 'permission_requested', data: req('p2') })
    await useAgentStore.getState().replyPermission(true)
    expect(ids()).toEqual(['p2'])
  })

  it('drops requests OpenCode resolved itself and those of a finished turn', () => {
    emit({ type: 'permission_requested', data: req('p1') })
    emit({ type: 'permission_requested', data: req('p2') })
    emit({ type: 'permission_requested', data: req('p3', { sessionId: 's2' }) })
    emit({ type: 'permission_resolved', data: { id: 'p1' } })
    expect(ids()).toEqual(['p2', 'p3'])
    emit({ type: 'turn_ended', sessionId: 's1', turnId: 't', seq: 9, data: { phase: 'failed', endedAt: 0 } })
    expect(ids()).toEqual(['p3'])
  })
})
