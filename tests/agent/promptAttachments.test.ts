import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TurnTracker, splitPrompt, turnsFromMessages } from '../../electron/agent/TurnTracker'
import { attachmentNote } from '../../electron/agent/referenceImages'
import { resolveAssetRequest } from '../../electron/assets/AssetProtocol'
import { projectAssetUrl } from '../../shared/assetProtocol'
import type { AgentEvent } from '../../shared/agentTypes'

/** The prompt text AgentHost sends: user text + context + reference images (+ Blender guide) */
const sent = (text: string, refs: string[], blender = false) =>
  `${text}\n\n<editor-context>\n{\n  "sceneName": "Main"\n}\n</editor-context>${attachmentNote(refs)}${blender ? '\n\n<blender-mode>\n# Mode Blender 3D\n</blender-mode>' : ''}`

describe('reference images of a sent prompt', () => {
  it('are read back from the prompt, with or without the Blender block', () => {
    expect(splitPrompt(sent('buat kapal', ['references/a.jpg', 'references/b-2.webp', 'references/c.png']))).toEqual({
      prompt: 'buat kapal',
      attachments: ['references/a.jpg', 'references/b-2.webp', 'references/c.png'],
    })
    expect(splitPrompt(sent('tambah planet', ['references/x-3.jpg'], true))).toEqual({ prompt: 'tambah planet', attachments: ['references/x-3.jpg'] })
    expect(splitPrompt(sent('tanpa gambar', []))).toEqual({ prompt: 'tanpa gambar' })
    // A list the user typed is not an attachment
    expect(splitPrompt('- references/fake.png').attachments).toBeUndefined()
  })

  it('stay on every turn of a session, live and from history (second prompt too)', () => {
    const events: AgentEvent[] = []
    const tracker = new TurnTracker((e) => events.push(e))
    tracker.watch('s')
    const enqueue = (id: string, text: string) =>
      tracker.handle({ type: 'session.inbox.enqueued', created: 1, data: { sessionID: 's', inboxID: id, item: { type: 'user', payload: { text } } } })
    enqueue('in_1', sent('pertama', ['references/a.jpg', 'references/b.jpg', 'references/c.jpg']))
    tracker.handle({ type: 'session.idle', created: 2, data: { sessionID: 's' } })
    enqueue('in_2', sent('kedua', ['references/d.jpg'], true))
    const started = events.filter((e) => e.type === 'turn_started') as any[]
    expect(started.map((e) => e.data.attachments)).toEqual([['references/a.jpg', 'references/b.jpg', 'references/c.jpg'], ['references/d.jpg']])
    tracker.dispose()

    const turns = turnsFromMessages('s', [
      { type: 'user', id: 'u1', text: sent('pertama', ['references/a.jpg', 'references/b.jpg', 'references/c.jpg']) },
      { type: 'user', id: 'u2', text: sent('kedua', ['references/d.jpg'], true) },
    ])
    expect(turns.map((t) => [t.prompt, t.attachments])).toEqual([
      ['pertama', ['references/a.jpg', 'references/b.jpg', 'references/c.jpg']],
      ['kedua', ['references/d.jpg']],
    ])
  })

  it('can be shown in the panel through linden-asset://, but nothing else in references/', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-ref-protocol-'))
    try {
      fs.mkdirSync(path.join(root, 'references'))
      fs.writeFileSync(path.join(root, 'references/kapal 1.jpg'), 'x')
      fs.writeFileSync(path.join(root, 'references/notes.txt'), 'x')
      fs.writeFileSync(path.join(root, 'secret.png'), 'x')
      const ok = resolveAssetRequest(projectAssetUrl('references/kapal 1.jpg'), root)
      expect(ok.status).toBe(200)
      expect(ok.headers['Content-Type']).toBe('image/jpeg')
      expect(resolveAssetRequest(projectAssetUrl('references/notes.txt'), root).status).toBe(403)
      expect(resolveAssetRequest(projectAssetUrl('secret.png'), root).status).toBe(403)
      expect(resolveAssetRequest(projectAssetUrl('references/../secret.png'), root).status).toBe(403)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
