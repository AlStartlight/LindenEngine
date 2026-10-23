/**
 * DiffEngine for Live Sync
 * Computes minimal change payloads between scene states.
 */

export interface SyncMessage {
  v: number
  type:
    | 'hello'
    | 'snapshot'
    | 'node_added'
    | 'node_removed'
    | 'node_reparented'
    | 'property_changed'
    | 'ack'
    | 'conflict'
    | 'error'
  token?: string
  linden_id?: string
  path?: string
  value?: any
  rev?: number
  origin?: 'linden' | 'godot'
  details?: any
}

export interface EntitySnapshot {
  id: string
  name: string
  parentId: string | null
  transform: {
    position: { x: number; y: number; z: number }
    rotation: { x: number; y: number; z: number }
    scale: { x: number; y: number; z: number }
  }
  properties: Record<string, any>
}

export class DiffEngine {
  private revCounter: number = 1
  private previousSnapshots: Map<string, EntitySnapshot> = new Map()

  constructor() {}

  getNextRev(): number {
    return this.revCounter++
  }

  setPreviousState(snapshots: EntitySnapshot[]): void {
    this.previousSnapshots.clear()
    for (const snap of snapshots) {
      this.previousSnapshots.set(snap.id, JSON.parse(JSON.stringify(snap)))
    }
  }

  /**
   * Compare current entities against previous snapshot to produce diff messages
   */
  computeDiff(
    currentSnapshots: EntitySnapshot[],
    token: string,
    origin: 'linden' | 'godot' = 'linden'
  ): SyncMessage[] {
    const messages: SyncMessage[] = []
    const currentMap = new Map<string, EntitySnapshot>()

    for (const curr of currentSnapshots) {
      currentMap.set(curr.id, curr)
      const prev = this.previousSnapshots.get(curr.id)

      if (!prev) {
        // Node added
        messages.push({
          v: 1,
          type: 'node_added',
          token,
          linden_id: curr.id,
          value: curr,
          rev: this.getNextRev(),
          origin,
        })
      } else {
        // Check reparent
        if (curr.parentId !== prev.parentId) {
          messages.push({
            v: 1,
            type: 'node_reparented',
            token,
            linden_id: curr.id,
            path: 'parentId',
            value: curr.parentId,
            rev: this.getNextRev(),
            origin,
          })
        }

        // Check position
        if (
          curr.transform.position.x !== prev.transform.position.x ||
          curr.transform.position.y !== prev.transform.position.y ||
          curr.transform.position.z !== prev.transform.position.z
        ) {
          messages.push({
            v: 1,
            type: 'property_changed',
            token,
            linden_id: curr.id,
            path: 'transform.position',
            value: { ...curr.transform.position },
            rev: this.getNextRev(),
            origin,
          })
        }

        // Check rotation
        if (
          curr.transform.rotation.x !== prev.transform.rotation.x ||
          curr.transform.rotation.y !== prev.transform.rotation.y ||
          curr.transform.rotation.z !== prev.transform.rotation.z
        ) {
          messages.push({
            v: 1,
            type: 'property_changed',
            token,
            linden_id: curr.id,
            path: 'transform.rotation',
            value: { ...curr.transform.rotation },
            rev: this.getNextRev(),
            origin,
          })
        }

        // Check scale
        if (
          curr.transform.scale.x !== prev.transform.scale.x ||
          curr.transform.scale.y !== prev.transform.scale.y ||
          curr.transform.scale.z !== prev.transform.scale.z
        ) {
          messages.push({
            v: 1,
            type: 'property_changed',
            token,
            linden_id: curr.id,
            path: 'transform.scale',
            value: { ...curr.transform.scale },
            rev: this.getNextRev(),
            origin,
          })
        }

        // Check other properties
        const allKeys = Array.from(
          new Set([...Object.keys(prev.properties || {}), ...Object.keys(curr.properties || {})])
        )
        for (const k of allKeys) {
          const prevVal = prev.properties ? prev.properties[k] : undefined
          const currVal = curr.properties ? curr.properties[k] : undefined
          if (JSON.stringify(prevVal) !== JSON.stringify(currVal)) {
            messages.push({
              v: 1,
              type: 'property_changed',
              token,
              linden_id: curr.id,
              path: k,
              value: currVal,
              rev: this.getNextRev(),
              origin,
            })
          }
        }
      }
    }

    // Check removed nodes
    for (const [prevId] of this.previousSnapshots) {
      if (!currentMap.has(prevId)) {
        messages.push({
          v: 1,
          type: 'node_removed',
          token,
          linden_id: prevId,
          rev: this.getNextRev(),
          origin,
        })
      }
    }

    // Update state to current
    this.setPreviousState(currentSnapshots)

    return messages
  }
}
