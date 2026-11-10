/**
 * Blender integration: status of the user's own Blender install (run as a separate process only;
 * see blender-bridge/README.md for the licence boundary).
 */

export type BlenderSource = 'env' | 'settings' | 'path' | 'common' | 'manual'

export interface BlenderStatus {
  found: boolean
  /** Executable that is spawned (macOS: .../Blender.app/Contents/MacOS/Blender) */
  path?: string
  /** "4.2.3" */
  version?: string
  source?: BlenderSource
  /** Why no usable Blender was found (Indonesian, shown in the UI) */
  reason?: string
}

/** Minimum supported Blender version (LTS with --offline-mode and the 4.x glTF exporter) */
export const BLENDER_MIN_VERSION = { major: 4, minor: 2 } as const
