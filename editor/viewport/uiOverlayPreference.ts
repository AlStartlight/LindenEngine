/**
 * Editor-only preference: whether HtmlUI overlays are drawn over the viewport / Game Frame.
 * Stored per project in localStorage (never in project.linden.json); storage failures fall
 * back to visible so the editor works in private windows or with blocked site data.
 */

const KEY_PREFIX = 'linden:uiOverlayVisible:'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function uiOverlayKey(projectPath: string): string {
  return KEY_PREFIX + projectPath
}

export function loadUiOverlayVisible(projectPath: string | null, storage: StorageLike | null = defaultStorage()): boolean {
  if (!projectPath || !storage) return true
  try {
    return storage.getItem(uiOverlayKey(projectPath)) !== 'false'
  } catch {
    return true
  }
}

export function saveUiOverlayVisible(projectPath: string | null, visible: boolean, storage: StorageLike | null = defaultStorage()): void {
  if (!projectPath || !storage) return
  try {
    storage.setItem(uiOverlayKey(projectPath), String(visible))
  } catch {
    // Preference only; ignore quota/blocked storage
  }
}
