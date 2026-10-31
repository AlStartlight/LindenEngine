import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** First line of the bundled prompt; marks an AGENTS.md that Linden wrote */
export const PROMPT_TITLE = '# Linden Engine AI Agent System Instructions'
/** Hash of the AGENTS.md content Linden last wrote, to tell our copy from a user's edits */
const STATE_FILE = '.linden/agent/agents-md.json'
/** Backup of an older AGENTS.md replaced without a recorded hash */
const BACKUP_FILE = '.linden/agent/AGENTS.md.prev'

export type AgentsMdSync = 'created' | 'updated' | 'current' | 'user-edited'

const sha = (text: string) => crypto.createHash('sha256').update(text).digest('hex')

function readState(projectPath: string): string | null {
  try {
    const hash = JSON.parse(fs.readFileSync(path.join(projectPath, STATE_FILE), 'utf-8')).hash
    return typeof hash === 'string' ? hash : null
  } catch {
    return null
  }
}

function write(projectPath: string, file: string, prompt: string): void {
  fs.writeFileSync(file, prompt, 'utf-8')
  const state = path.join(projectPath, STATE_FILE)
  fs.mkdirSync(path.dirname(state), { recursive: true })
  fs.writeFileSync(state, JSON.stringify({ hash: sha(prompt) }, null, 2), 'utf-8')
}

/**
 * Keep the project's AGENTS.md in step with the engine's agent prompt, so agents in older projects
 * learn new engine features. A copy the user edited is left alone.
 */
export function syncProjectAgentsMd(projectPath: string, prompt: string): AgentsMdSync {
  const file = path.join(projectPath, 'AGENTS.md')
  if (!fs.existsSync(file)) {
    write(projectPath, file, prompt)
    return 'created'
  }
  const current = fs.readFileSync(file, 'utf-8')
  if (current === prompt) {
    if (readState(projectPath) !== sha(prompt)) write(projectPath, file, prompt)
    return 'current'
  }
  const recorded = readState(projectPath)
  if (recorded !== null) {
    if (recorded !== sha(current)) return 'user-edited'
    write(projectPath, file, prompt)
    return 'updated'
  }
  // Written by a Linden version that kept no hash: replace our own copy, keep a backup just in case
  if (!current.startsWith(PROMPT_TITLE)) return 'user-edited'
  const backup = path.join(projectPath, BACKUP_FILE)
  fs.mkdirSync(path.dirname(backup), { recursive: true })
  fs.writeFileSync(backup, current, 'utf-8')
  write(projectPath, file, prompt)
  return 'updated'
}
