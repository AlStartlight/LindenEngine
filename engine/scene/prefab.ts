/**
 * Prefab System - Instanced scenes with overrides and variants (Godot PackedScene model with Unity UX)
 */

export interface PropertyOverride {
  target: string // 'root' or stable internal entity ID inside prefab
  component: string
  path: string
  value: unknown
}

export interface RemovedComponentRef {
  target: string
  type: string
}

export interface PrefabLink {
  asset: string // relative project path, e.g. "assets/prefabs/Door.lprefab"
  overrides: PropertyOverride[]
  addedComponents?: any[]
  removedComponents?: RemovedComponentRef[]
  addedChildren?: any[]
}

export interface PrefabAsset {
  format: 'linden-prefab'
  version: 1
  basePrefab?: string // Prefab Variant (inherited scene)
  root: string // Root entity ID
  entities: any[] // Serialized entities
}

/**
 * Generate stable child entity ID inside prefab instance:
 * hash(instanceRootId + ':' + prefabEntityId)
 */
export function generatePrefabChildId(instanceRootId: string, prefabEntityId: string): string {
  // Simple deterministic hash
  let str = `${instanceRootId}:${prefabEntityId}`
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  const hex = (h >>> 0).toString(16).padStart(8, '0')
  return `pfb-${hex}-${prefabEntityId.slice(0, 8)}`
}

/**
 * Check for cyclic prefab inheritance or nesting.
 * Throws an Error with message 'PREFAB_CYCLE' if a cycle is detected.
 */
export function checkPrefabCycle(
  targetAsset: string,
  chain: string[],
  loadAsset: (path: string) => PrefabAsset | null
): void {
  if (chain.includes(targetAsset)) {
    throw new Error(`PREFAB_CYCLE: Cycle detected involving prefab "${targetAsset}"`)
  }

  const asset = loadAsset(targetAsset)
  if (!asset) return

  const nextChain = [...chain, targetAsset]

  // Check basePrefab for variants
  if (asset.basePrefab) {
    if (nextChain.includes(asset.basePrefab)) {
      throw new Error(`PREFAB_CYCLE: Cycle detected involving basePrefab "${asset.basePrefab}"`)
    }
    checkPrefabCycle(asset.basePrefab, nextChain, loadAsset)
  }

  // Check nested prefabs in entities
  if (Array.isArray(asset.entities)) {
    for (const ent of asset.entities) {
      if (ent.prefab && ent.prefab.asset) {
        if (nextChain.includes(ent.prefab.asset)) {
          throw new Error(`PREFAB_CYCLE: Cycle detected involving nested prefab "${ent.prefab.asset}"`)
        }
        checkPrefabCycle(ent.prefab.asset, nextChain, loadAsset)
      }
    }
  }
}
