/**
 * Shared shapes for the MCP agent bridge (SPEC-DSH-MCP-Agent-Integration).
 * No tokens or secrets belong in these types: they cross into tool results and
 * eventually into the renderer.
 */

import type { AgentBridgeStatus } from '../../shared/agentTypes'

export type LindenBridgeStatus = AgentBridgeStatus
export type LindenClientView = AgentBridgeStatus['clients'][number]
export type LindenLockView = AgentBridgeStatus['locks'][number]

export interface LindenCallContext {
  /** Bridge client that made the call, e.g. "opencode" or "linden-qa-physics-tester" */
  clientId: string
  /** Role id from lindenRoles.ts, or "director" for the full-access token */
  role: string
  sessionId?: string
  turnId?: string
  requestId: string | number
}
