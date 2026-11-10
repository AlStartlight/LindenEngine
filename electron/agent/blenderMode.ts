/**
 * Per-turn "Blender 3D" flag. The agent panel's checkbox is sent with each prompt; AgentHost
 * turns it on for that prompt's turn and off when the turn ends, is aborted, or the next prompt
 * comes without it. The Blender tools refuse to run while it is off.
 */

let activeSession: string | null = null

export function beginBlenderTurn(sessionId: string): void {
  activeSession = sessionId
}

/** End the Blender turn (of `sessionId` only, when given) */
export function endBlenderTurn(sessionId?: string): void {
  if (sessionId === undefined || activeSession === sessionId) activeSession = null
}

export function blenderTurnActive(): boolean {
  return activeSession !== null
}

export function blenderTurnSession(): string | null {
  return activeSession
}

export const BLENDER_MODE_OFF_ERROR = 'Mode Blender 3D tidak aktif untuk prompt ini. Gunakan linden_model_build.'
