import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { LINDEN_AGENT_ROLES } from '../../electron/agent/lindenRoles'

/**
 * The engine's compiled-in role catalog must match the portable contract shipped
 * for DeepSeek Harness and custom agents (integrations/dsh/agents.json).
 */
describe('linden role catalog parity', () => {
  const repo = path.resolve(__dirname, '../..')
  const shipped = JSON.parse(fs.readFileSync(path.join(repo, 'integrations/dsh/agents.json'), 'utf8'))

  it('declares the same five roles in the same roster order', () => {
    const shippedIds = shipped.agents.map((a: any) => a.id)
    const engineIds = LINDEN_AGENT_ROLES.map((r) => r.id)
    expect(engineIds).toEqual(shippedIds)
    expect(engineIds).toHaveLength(5)
  })

  it('gives every role the same tool scope in both files', () => {
    for (const role of LINDEN_AGENT_ROLES) {
      const shippedRole = shipped.agents.find((a: any) => a.id === role.id)
      expect(shippedRole, role.id).toBeTruthy()
      expect([...role.tools].sort(), role.id).toEqual([...shippedRole.tools].sort())
      expect(role.order).toBe(shippedRole.order)
    }
  })

  it('never grants QA a writing tool', () => {
    const qa = LINDEN_AGENT_ROLES.find((r) => r.id === 'linden-qa-physics-tester')!
    for (const forbidden of ['scene_apply', 'script_write', 'ui_write', 'input_actions', 'asset_placeholder']) {
      expect(qa.tools).not.toContain(forbidden)
    }
  })
})
