import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { attachmentNote, resolveAttachments, saveReferenceImage, sniffImage } from '../../electron/agent/referenceImages'
import { AgentHost } from '../../electron/agent/AgentHost'

const PNG = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'img2threejs', 'mug.png'))

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-refs-'))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('reference images', () => {
  it('sniffs formats from bytes', () => {
    expect(sniffImage(PNG)).toBe('png')
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg')
    expect(sniffImage(new Uint8Array(Buffer.from('RIFF0000WEBPVP8 ')))).toBe('webp')
    expect(sniffImage(new Uint8Array(Buffer.from('GIF89a......')))).toBeNull()
  })

  it('copies into references/ with unique names and refuses non-images', () => {
    expect(saveReferenceImage(dir, 'Kursi Jati.PNG', PNG)).toEqual({ path: 'references/kursi-jati.png', bytes: PNG.length, resized: false })
    expect(saveReferenceImage(dir, 'kursi jati.png', PNG).path).toBe('references/kursi-jati-2.png')
    // a JPEG named .png keeps its real extension
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])
    expect(saveReferenceImage(dir, 'photo.png', jpg).path).toBe('references/photo.jpg')
    expect(() => saveReferenceImage(dir, 'x.gif', new Uint8Array(Buffer.from('GIF89a......')))).toThrow(/png, jpg, webp/)
    expect(() => saveReferenceImage(path.join(dir, 'missing'), 'x.png', PNG)).toThrow(/proyek/)
  })

  it('uses the resizer for big images', () => {
    const res = saveReferenceImage(dir, 'big.png', PNG, () => ({ data: new Uint8Array([1, 2, 3]), ext: 'png' }))
    expect(res).toMatchObject({ resized: true, bytes: 3 })
  })

  it('accepts only existing references/ images back from the renderer', () => {
    saveReferenceImage(dir, 'a.png', PNG)
    expect(resolveAttachments(dir, ['references/a.png', 'references/../x.png', 'scenes/a.png', 'references/missing.png', 42])).toEqual(['references/a.png'])
    expect(attachmentNote(['references/a.png'])).toMatch(/references\/a\.png[\s\S]*bagian 7[\s\S]*linden_reference_view/)
    expect(attachmentNote(['references/a.png'])).not.toMatch(/img2threejs/)
    expect(attachmentNote([])).toBe('')
  })
})

describe('AgentHost prompt with attachments', () => {
  it('sends the images as file parts when the model sees images, and only the paths otherwise', async () => {
    saveReferenceImage(dir, 'mug.png', PNG)
    const host = AgentHost.getInstance() as any
    const sent: any[] = []
    const prev = { client: host.client, projectPath: host.projectPath, provider: host.activeProvider, model: host.activeModel }
    host.client = {
      session: {
        switchAgent: async () => ({}),
        prompt: async (input: any) => {
          sent.push(input)
          return { id: 'msg_1' }
        },
      },
    }
    host.projectPath = dir
    host.activeProvider = 'p'
    host.activeModel = 'vision'
    host.modelImageInput.set('p/vision', true)
    host.modelImageInput.set('p/text', false)
    host.tracker.watch('ses_img')
    host.instructedSessions.add('ses_img')
    try {
      await host.submitPrompt({ sessionId: 'ses_img', prompt: 'buat ini', attachments: ['references/mug.png', '../etc/passwd'] })
      expect(sent[0].text).toMatch(/references\/mug\.png/)
      expect(sent[0].files).toEqual([{ uri: pathToFileURL(path.join(dir, 'references/mug.png')).href, name: 'mug.png' }])

      host.activeModel = 'text'
      await host.submitPrompt({ sessionId: 'ses_img', prompt: 'buat ini', attachments: ['references/mug.png'] })
      expect(sent[1].files).toBeUndefined()
      expect(sent[1].text).toMatch(/references\/mug\.png/)
    } finally {
      host.client = prev.client
      host.projectPath = prev.projectPath
      host.activeProvider = prev.provider
      host.activeModel = prev.model
    }
  })
})
