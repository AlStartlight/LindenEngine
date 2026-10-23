/**
 * Persistent ID Mapping System (FR-05, TC-TR-19)
 * Maps Unity GUIDs and Godot UIDs to Linden UUIDs deterministically.
 */

export interface IdMapRecord {
  lindenUuid: string
  unityGuid?: string
  godotUid?: string
  sourcePath?: string
}

export class IdMap {
  private records: Map<string, IdMapRecord> = new Map() // lindenUuid -> record
  private unityToUuid: Map<string, string> = new Map()
  private godotToUuid: Map<string, string> = new Map()

  register(record: IdMapRecord): void {
    this.records.set(record.lindenUuid, record)
    if (record.unityGuid) {
      this.unityToUuid.set(record.unityGuid, record.lindenUuid)
    }
    if (record.godotUid) {
      this.godotToUuid.set(record.godotUid, record.lindenUuid)
    }
  }

  getUuidByUnityGuid(guid: string): string | undefined {
    return this.unityToUuid.get(guid)
  }

  getUuidByGodotUid(uid: string): string | undefined {
    return this.godotToUuid.get(uid)
  }

  getRecord(uuid: string): IdMapRecord | undefined {
    return this.records.get(uuid)
  }

  /**
   * Deterministically derive a 32-character hex Unity GUID from a Linden UUID
   */
  getOrCreateUnityGuid(uuid: string): string {
    const existing = this.records.get(uuid)
    if (existing?.unityGuid) return existing.unityGuid

    let hash = 0
    for (let i = 0; i < uuid.length; i++) {
      hash = (hash << 5) - hash + uuid.charCodeAt(i)
      hash |= 0
    }

    const hexBase = Math.abs(hash).toString(16).padStart(8, '0')
    const cleanUuid = uuid.replace(/[^a-f0-9]/gi, '').padEnd(32, '0').slice(0, 24)
    const guid = (hexBase + cleanUuid).toLowerCase().slice(0, 32)

    this.register({ lindenUuid: uuid, unityGuid: guid })
    return guid
  }

  /**
   * Deterministically derive a Godot uid:// string
   */
  getOrCreateGodotUid(uuid: string): string {
    const existing = this.records.get(uuid)
    if (existing?.godotUid) return existing.godotUid

    const guid = this.getOrCreateUnityGuid(uuid)
    const godotUid = `uid://${guid.slice(0, 13)}`
    this.register({ lindenUuid: uuid, godotUid })
    return godotUid
  }

  toJSON(): string {
    const arr = Array.from(this.records.values())
    return JSON.stringify(arr, null, 2)
  }

  static fromJSON(json: string): IdMap {
    const map = new IdMap()
    try {
      const arr: IdMapRecord[] = JSON.parse(json)
      for (const r of arr) {
        map.register(r)
      }
    } catch {}
    return map
  }
}
