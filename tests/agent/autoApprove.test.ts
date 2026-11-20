import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  AgentHost,
  SESSION_PERMISSIONS_MANUAL,
  SESSION_PERMISSIONS_AUTO,
  SESSION_PERMISSIONS,
} from '../../electron/agent/AgentHost'
import { useAgentStore } from '../../editor/agent/agentStore'
import { AgentPermissionRequest } from '../../shared/agentTypes'

describe('Agent Auto Approve Rulesets', () => {
  it('defines manual permissions with default ask effect', () => {
    expect(SESSION_PERMISSIONS_MANUAL[0]).toEqual({ action: '*', resource: '*', effect: 'ask' })
    expect(SESSION_PERMISSIONS).toEqual(SESSION_PERMISSIONS_MANUAL)
  })

  it('defines autonomous permissions with allow effect for actions', () => {
    expect(SESSION_PERMISSIONS_AUTO[0]).toEqual({ action: '*', resource: '*', effect: 'allow' })
  })

  it('preserves security deny rules in both manual and auto rulesets', () => {
    for (const ruleset of [SESSION_PERMISSIONS_MANUAL, SESSION_PERMISSIONS_AUTO]) {
      const denied = ruleset.filter((r) => r.action === '*' && r.effect === 'deny').map((r) => r.resource)
      expect(denied).toContain('/tmp')
      expect(denied).toContain('/tmp/*')
      expect(ruleset.at(-1)).toEqual({ action: 'external_directory', resource: '*', effect: 'deny' })
    }
  })
})

describe('AgentHost Auto Approve Logic', () => {
  let host: AgentHost

  beforeEach(async () => {
    host = AgentHost.getInstance()
    ;(host as any).client = null
    ;(host as any).activeSessionId = null
    ;(host as any).pendingPermissions.clear()
    ;(host as any).localPermissions.clear()
    await host.setAutoApprove(false)
  })

  it('reports effective permissions based on autoApprove state', async () => {
    expect(host.getEffectivePermissions()).toBe(SESSION_PERMISSIONS_MANUAL)
    expect(host.getAutoApprove()).toBe(false)
    expect(host.getStatus().autoApprove).toBe(false)

    await host.setAutoApprove(true)
    expect(host.getEffectivePermissions()).toBe(SESSION_PERMISSIONS_AUTO)
    expect(host.getAutoApprove()).toBe(true)
    expect(host.getStatus().autoApprove).toBe(true)

    await host.setAutoApprove(false)
    expect(host.getEffectivePermissions()).toBe(SESSION_PERMISSIONS_MANUAL)
    expect(host.getAutoApprove()).toBe(false)
  })

  it('updates active session permissions in OpenCode when setAutoApprove is called', async () => {
    const updateSpy = vi.fn().mockResolvedValue({})
    const mockClient: any = {
      session: {
        update: updateSpy,
      },
      permission: {
        reply: vi.fn().mockResolvedValue({}),
      },
    }

    ;(host as any).client = mockClient
    ;(host as any).activeSessionId = 'session-main-1'

    await host.setAutoApprove(true)
    expect(updateSpy).toHaveBeenCalledWith({
      sessionID: 'session-main-1',
      permissions: SESSION_PERMISSIONS_AUTO,
    })

    await host.setAutoApprove(false)
    expect(updateSpy).toHaveBeenCalledWith({
      sessionID: 'session-main-1',
      permissions: SESSION_PERMISSIONS_MANUAL,
    })
  })

  it('flushes and auto-approves pending permissions when autoApprove is turned on', async () => {
    const replySpy = vi.fn().mockResolvedValue({})
    const mockClient: any = {
      session: {
        update: vi.fn().mockResolvedValue({}),
      },
      permission: {
        reply: replySpy,
      },
    }

    ;(host as any).client = mockClient
    ;(host as any).activeSessionId = 'session-main-1'

    // Add pending permissions
    const pending = (host as any).pendingPermissions as Map<string, AgentPermissionRequest>
    pending.clear()
    pending.set('perm-1', {
      id: 'perm-1',
      sessionId: 'session-main-1',
      action: 'bash',
      resources: ['echo hello'],
      timestamp: Date.now(),
    })
    pending.set('perm-2', {
      id: 'perm-2',
      sessionId: 'session-sub-99',
      action: 'edit',
      resources: ['src/App.tsx'],
      timestamp: Date.now(),
    })

    await host.setAutoApprove(true)

    expect(replySpy).toHaveBeenCalledWith({
      sessionID: 'session-main-1',
      requestID: 'perm-1',
      decision: 'always',
    })
    expect(replySpy).toHaveBeenCalledWith({
      sessionID: 'session-sub-99',
      requestID: 'perm-2',
      decision: 'always',
    })
    expect(pending.size).toBe(0)
  })

  it('uses decision: "always" for allow and "reject" for deny in replyPermission', async () => {
    const replySpy = vi.fn().mockResolvedValue({})
    ;(host as any).client = {
      permission: { reply: replySpy },
    }
    ;(host as any).activeSessionId = 'session-active'

    await host.replyPermission('req-allow', true, 'session-target')
    expect(replySpy).toHaveBeenCalledWith({
      sessionID: 'session-target',
      requestID: 'req-allow',
      decision: 'always',
    })

    await host.replyPermission('req-deny', false, 'session-target')
    expect(replySpy).toHaveBeenCalledWith({
      sessionID: 'session-target',
      requestID: 'req-deny',
      decision: 'reject',
    })
  })

  it('handles permission.asked by auto-approving sub-agent sessions without requiring watched session registration', async () => {
    const replySpy = vi.fn().mockResolvedValue({})
    ;(host as any).client = {
      permission: { reply: replySpy },
    }
    ;(host as any).activeSessionId = 'session-main'
    await host.setAutoApprove(true)

    const eventsEmitted: any[] = []
    const emitSpy = vi.spyOn(host as any, 'emitEvent').mockImplementation((ev) => eventsEmitted.push(ev))

    // Simulate event from a sub-agent session not tracked in tracker
    host.handleEvent({
      type: 'permission.asked',
      data: {
        id: 'perm-sub-1',
        sessionID: 'unwatched-sub-agent-session-42',
        action: 'write_file',
        resources: ['dist/bundle.js'],
      },
    })

    expect(replySpy).toHaveBeenCalledWith({
      sessionID: 'unwatched-sub-agent-session-42',
      requestID: 'perm-sub-1',
      decision: 'always',
    })

    // Should NOT emit permission_requested to UI
    expect(eventsEmitted.filter((e) => e.type === 'permission_requested')).toHaveLength(0)

    // Should NOT store in pendingPermissions
    const pending = (host as any).pendingPermissions as Map<string, AgentPermissionRequest>
    expect(pending.has('perm-sub-1')).toBe(false)

    emitSpy.mockRestore()
  })

  it('queues permission request when autoApprove is false and session is watched', async () => {
    await host.setAutoApprove(false)
    ;(host as any).client = { permission: { reply: vi.fn() } }

    const isWatchedSpy = vi.spyOn((host as any).tracker, 'isWatched').mockReturnValue(true)
    const eventsEmitted: any[] = []
    const emitSpy = vi.spyOn(host as any, 'emitEvent').mockImplementation((ev) => eventsEmitted.push(ev))

    host.handleEvent({
      type: 'permission.asked',
      data: {
        id: 'perm-manual-1',
        sessionID: 'session-watched',
        action: 'bash',
        resources: ['npm test'],
      },
    })

    const pending = (host as any).pendingPermissions as Map<string, AgentPermissionRequest>
    expect(pending.has('perm-manual-1')).toBe(true)
    expect(eventsEmitted.some((e) => e.type === 'permission_requested' && e.data.id === 'perm-manual-1')).toBe(true)

    isWatchedSpy.mockRestore()
    emitSpy.mockRestore()
  })
})
