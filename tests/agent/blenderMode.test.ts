import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentHost } from '../../electron/agent/AgentHost'
import { turnsFromMessages } from '../../electron/agent/TurnTracker'
import { blenderTurnActive, blenderTurnSession, endBlenderTurn } from '../../electron/agent/blenderMode'
import { setBlenderStatusForTest } from '../../electron/bridge/blenderDetect'
import { permissionTitle } from '../../editor/agent/permissionFormat'
import { useAgentStore } from '../../editor/agent/agentStore'
import { checkSeparateProcess } from '../../scripts/check-licenses.mjs'
import type { AgentEvent } from '../../shared/agentTypes'

/** AgentHost with a fake OpenCode client that records the prompts it gets */
function hostWithFakeClient(projectPath: string) {
  const host = AgentHost.getInstance() as any
  const prompts: string[] = []
  host.client = {
    session: {
      switchAgent: async () => {},
      prompt: async (input: any) => {
        prompts.push(input.text)
        return { id: 'msg_1' }
      },
      instructions: { entry: { put: async () => {} } },
      interrupt: async () => {},
    },
  }
  host.projectPath = projectPath
  host.tracker.watch('ses_b')
  const events: AgentEvent[] = []
  host.setEventSender((e: AgentEvent) => events.push(e))
  return { host: host as AgentHost & Record<string, any>, prompts, events }
}

describe('Blender 3D per-turn mode in AgentHost', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-blender-mode-'))
    setBlenderStatusForTest({ found: true, path: '/fake/blender', version: '4.2.3', source: 'manual' })
  })
  afterEach(() => {
    endBlenderTurn()
    setBlenderStatusForTest(null)
    const host = AgentHost.getInstance() as any
    host.client = null
    host.projectPath = null
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('sends the prompt unchanged and keeps the mode off when the box is not checked', async () => {
    const { host, prompts } = hostWithFakeClient(dir)
    await host.submitPrompt({ sessionId: 'ses_b', prompt: 'buat meja', context: { sceneName: 'Main' } })
    expect(prompts[0]).toBe('buat meja\n\n<editor-context>\n{\n  "sceneName": "Main"\n}\n</editor-context>')
    expect(blenderTurnActive()).toBe(false)
  })

  it('appends the Blender guide and turns the mode on for that turn only', async () => {
    const { host, prompts } = hostWithFakeClient(dir)
    await host.submitPrompt({ sessionId: 'ses_b', prompt: 'buat mug', useBlender: true })
    expect(prompts[0].startsWith('buat mug\n\n<blender-mode>\n# Mode Blender 3D')).toBe(true)
    expect(prompts[0].endsWith('</blender-mode>')).toBe(true)
    expect(blenderTurnSession()).toBe('ses_b')

    host.emitEvent({ type: 'turn_ended', sessionId: 'ses_b', turnId: 't', seq: 9, data: { phase: 'done', endedAt: 1 } })
    expect(blenderTurnActive()).toBe(false)

    // The next prompt without the box does not inherit it
    await host.submitPrompt({ sessionId: 'ses_b', prompt: 'buat mug', useBlender: true })
    await host.submitPrompt({ sessionId: 'ses_b', prompt: 'lagi' })
    expect(prompts[2]).toBe('lagi')
    expect(blenderTurnActive()).toBe(false)
  })

  it('switches the mode off again when the prompt cannot be sent', async () => {
    const { host } = hostWithFakeClient(dir)
    host.client.session.prompt = async () => {
      throw new Error('server down')
    }
    await expect(host.submitPrompt({ sessionId: 'ses_b', prompt: 'x', useBlender: true })).rejects.toThrow('server down')
    expect(blenderTurnActive()).toBe(false)
  })

  it('ignores the box when Blender is not detected', async () => {
    setBlenderStatusForTest({ found: false })
    const { host, prompts } = hostWithFakeClient(dir)
    await host.submitPrompt({ sessionId: 'ses_b', prompt: 'buat mug', useBlender: true })
    expect(prompts[0]).toBe('buat mug')
    expect(blenderTurnActive()).toBe(false)
  })

  it('routes a Blender script permission through the panel and resolves it locally', async () => {
    const { host, events } = hostWithFakeClient(dir)
    host.activeSessionId = 'ses_b'
    const answer = host.requestToolPermission({ action: 'blender_script', message: 'm', resources: ['Vas'], code: 'import bpy' })
    const req = events.find((e) => e.type === 'permission_requested')!.data as any
    expect(req).toMatchObject({ sessionId: 'ses_b', action: 'blender_script', resources: ['Vas'], code: 'import bpy' })
    await host.replyPermission(req.id, true)
    expect(await answer).toBe(true)
    expect(events.filter((e) => e.type === 'permission_resolved')).toEqual([{ type: 'permission_resolved', sessionId: 'ses_b', data: { id: req.id } }])
  })

  it('refuses an unanswered Blender script permission when the turn ends or is aborted', async () => {
    const { host } = hostWithFakeClient(dir)
    host.activeSessionId = 'ses_b'
    const ended = host.requestToolPermission({ action: 'blender_script', message: 'm', resources: ['A'], code: 'x' })
    host.emitEvent({ type: 'turn_ended', sessionId: 'ses_b', turnId: 't', seq: 2, data: { phase: 'interrupted', endedAt: 1 } })
    expect(await ended).toBe(false)
    const aborted = host.requestToolPermission({ action: 'blender_script', message: 'm', resources: ['B'], code: 'x' })
    await host.abortPrompt('ses_b')
    expect(await aborted).toBe(false)
  })
})

describe('injected prompt blocks are hidden from the turn history', () => {
  it('strips editor context, reference images and the Blender guide at the end of a prompt', () => {
    const text = 'buat meja\n\n<editor-context>\n{"a":1}\n</editor-context>\n\n<reference-images>\n- references/a.png\n</reference-images>\n\n<blender-mode>\n# Mode\n</blender-mode>'
    const turns = turnsFromMessages('s', [{ type: 'user', id: 'u1', text }])
    expect(turns[0].prompt).toBe('buat meja')
    expect(turns[0].attachments).toEqual(['references/a.png'])
    expect(turnsFromMessages('s', [{ type: 'user', id: 'u2', text: 'pakai <blender-mode> nanti' }])[0].prompt).toBe('pakai <blender-mode> nanti')
  })
})

describe('agent panel plumbing', () => {
  it('sends useBlender at the top level of the prompt payload, not inside the context', async () => {
    const sent: any[] = []
    ;(globalThis as any).window = { electronAPI: { agentSubmitPrompt: async (o: any) => (sent.push(o), { messageId: 'm' }) } }
    try {
      useAgentStore.setState({ currentSessionId: 'ses_p', turns: [] } as any)
      await useAgentStore.getState().sendPrompt('buat vas', { sceneName: 'Main' }, [], { useBlender: true })
      await useAgentStore.getState().sendPrompt('buat vas', { sceneName: 'Main' }, [])
      expect(sent[0]).toMatchObject({ sessionId: 'ses_p', prompt: 'buat vas', context: { sceneName: 'Main' }, useBlender: true })
      expect(sent[1].useBlender).toBeUndefined()
    } finally {
      delete (globalThis as any).window
    }
  })

  it('titles the Blender script permission', () => {
    expect(permissionTitle('blender_script')).toBe('Menjalankan script Python di Blender')
  })
})

describe('blender-bridge licence boundary', () => {
  it('passes for the repo and catches a missing licence or an import from MIT code', () => {
    expect(checkSeparateProcess().violations).toEqual([])
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-gpl-boundary-'))
    try {
      fs.mkdirSync(path.join(base, 'blender-bridge'))
      fs.mkdirSync(path.join(base, 'electron'))
      expect(checkSeparateProcess(['blender-bridge'], base, ['electron']).violations[0]).toMatch(/LICENSE tidak ada/)
      fs.writeFileSync(path.join(base, 'blender-bridge/LICENSE'), '                    GNU GENERAL PUBLIC LICENSE\n')
      fs.writeFileSync(path.join(base, 'electron/ok.ts'), "const p = resolveAppResource('blender-bridge/runner.py', 'blender-bridge/runner.py')\n")
      expect(checkSeparateProcess(['blender-bridge'], base, ['electron']).violations).toEqual([])
      fs.writeFileSync(path.join(base, 'electron/bad.ts'), "import x from '../blender-bridge/runner.py'\n")
      expect(checkSeparateProcess(['blender-bridge'], base, ['electron']).violations[0]).toMatch(/bad\.ts meng-import blender-bridge/)
    } finally {
      fs.rmSync(base, { recursive: true, force: true })
    }
  })
})
