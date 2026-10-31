import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { syncProjectAgentsMd, PROMPT_TITLE } from '../../electron/agent/projectAgentFiles'

const v1 = `${PROMPT_TITLE}\n\nold rules\n`
const v2 = `${PROMPT_TITLE}\n\nold rules\nnew EditableMesh rules\n`

describe('syncProjectAgentsMd', () => {
  let dir: string
  const agentsMd = () => fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8')
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-agentsmd-'))
  })

  it('creates AGENTS.md in a new project', () => {
    expect(syncProjectAgentsMd(dir, v1)).toBe('created')
    expect(agentsMd()).toBe(v1)
    expect(syncProjectAgentsMd(dir, v1)).toBe('current')
  })

  it('updates an untouched copy when the engine prompt changes', () => {
    syncProjectAgentsMd(dir, v1)
    expect(syncProjectAgentsMd(dir, v2)).toBe('updated')
    expect(agentsMd()).toBe(v2)
  })

  it('keeps a copy the user edited', () => {
    syncProjectAgentsMd(dir, v1)
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), v1 + '\nMy own rule\n')
    expect(syncProjectAgentsMd(dir, v2)).toBe('user-edited')
    expect(agentsMd()).toContain('My own rule')
  })

  it('replaces a copy from an older Linden without a hash, keeping a backup', () => {
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), v1)
    expect(syncProjectAgentsMd(dir, v2)).toBe('updated')
    expect(agentsMd()).toBe(v2)
    expect(fs.readFileSync(path.join(dir, '.linden/agent/AGENTS.md.prev'), 'utf-8')).toBe(v1)
    // From now on the hash is recorded, so a later engine update applies too
    expect(syncProjectAgentsMd(dir, v2 + 'more\n')).toBe('updated')
  })

  it('leaves a hand-written AGENTS.md without a hash alone', () => {
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# My project notes\n')
    expect(syncProjectAgentsMd(dir, v2)).toBe('user-edited')
    expect(agentsMd()).toBe('# My project notes\n')
  })
})
