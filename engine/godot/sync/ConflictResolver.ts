/**
 * Conflict Resolver for Live Sync
 * Tracks property revisions and detects / resolves simultaneous edits.
 */

import { SyncMessage } from './DiffEngine'

export type ConflictStrategy = 'ask' | 'linden-wins' | 'godot-wins'

export interface ConflictRecord {
  id: string
  entityId: string
  path: string
  localValue: any
  remoteValue: any
  baseRev: number
  localRev: number
  remoteRev: number
  resolved: boolean
  chosenValue?: any
}

export class ConflictResolver {
  // Key: entityId:path -> current revision
  private propertyRevisions: Map<string, number> = new Map()
  private pendingConflicts: Map<string, ConflictRecord> = new Map()

  constructor(public strategy: ConflictStrategy = 'ask') {}

  getRevision(entityId: string, path: string): number {
    const key = `${entityId}:${path}`
    return this.propertyRevisions.get(key) ?? 0
  }

  setRevision(entityId: string, path: string, rev: number): void {
    const key = `${entityId}:${path}`
    this.propertyRevisions.set(key, rev)
  }

  /**
   * Process incoming change against current local state
   */
  processIncomingChange(
    localChange: { entityId: string; path: string; value: any; rev: number },
    remoteMsg: SyncMessage
  ): {
    status: 'accepted' | 'conflict' | 'ignored'
    finalValue?: any
    conflict?: ConflictRecord
  } {
    const entityId = remoteMsg.linden_id || localChange.entityId
    const path = remoteMsg.path || localChange.path
    const key = `${entityId}:${path}`
    const currentRev = this.getRevision(entityId, path)

    // Concurrent edit detected: same property modified based on same revision
    if (
      localChange.rev === remoteMsg.rev &&
      JSON.stringify(localChange.value) !== JSON.stringify(remoteMsg.value)
    ) {
      const conflict: ConflictRecord = {
        id: `${key}:${localChange.rev}`,
        entityId,
        path,
        localValue: localChange.value,
        remoteValue: remoteMsg.value,
        baseRev: currentRev,
        localRev: localChange.rev,
        remoteRev: remoteMsg.rev,
        resolved: false,
      }

      this.pendingConflicts.set(conflict.id, conflict)

      if (this.strategy === 'linden-wins') {
        conflict.resolved = true
        conflict.chosenValue = localChange.value
        this.setRevision(entityId, path, localChange.rev + 1)
        return { status: 'accepted', finalValue: localChange.value, conflict }
      } else if (this.strategy === 'godot-wins') {
        conflict.resolved = true
        conflict.chosenValue = remoteMsg.value
        this.setRevision(entityId, path, remoteMsg.rev + 1)
        return { status: 'accepted', finalValue: remoteMsg.value, conflict }
      }

      // 'ask' mode: do not overwrite silently!
      return { status: 'conflict', conflict }
    }

    // Remote has higher revision
    if ((remoteMsg.rev ?? 0) > currentRev) {
      this.setRevision(entityId, path, remoteMsg.rev ?? currentRev + 1)
      return { status: 'accepted', finalValue: remoteMsg.value }
    }

    return { status: 'ignored' }
  }

  resolveConflict(conflictId: string, choice: 'linden' | 'godot' | any): ConflictRecord | null {
    const conflict = this.pendingConflicts.get(conflictId)
    if (!conflict) return null

    conflict.resolved = true
    if (choice === 'linden') {
      conflict.chosenValue = conflict.localValue
    } else if (choice === 'godot') {
      conflict.chosenValue = conflict.remoteValue
    } else {
      conflict.chosenValue = choice
    }

    const nextRev = Math.max(conflict.localRev, conflict.remoteRev) + 1
    this.setRevision(conflict.entityId, conflict.path, nextRev)
    this.pendingConflicts.delete(conflictId)
    return conflict
  }

  getPendingConflicts(): ConflictRecord[] {
    return Array.from(this.pendingConflicts.values()).filter((c) => !c.resolved)
  }
}
