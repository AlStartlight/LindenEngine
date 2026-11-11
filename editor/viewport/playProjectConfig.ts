import type { ProjectSettingsState } from '../store/editorStore'
import { normalizeCursorSettings } from '../../shared/cursorSettings'

export interface PlayTouchOverrides {
  /** Game View touch toggle: 'auto' follows the project */
  mode: 'auto' | 'always' | 'never'
  /** '' = the project's initialLayout */
  layout: string
}

/**
 * projectConfig sent to the Game Frame in linden:init. Every project.linden.json field the player
 * reads (quality, renderer, input, cursor, ...) must be here, or Play silently falls back to defaults
 * while web export (which copies the whole file) behaves differently.
 */
export function buildPlayProjectConfig(projectName: string, settings: ProjectSettingsState, touch: PlayTouchOverrides) {
  return {
    name: projectName,
    collisionMatrix: settings.collisionMatrix,
    renderer: settings.renderer === 'webgpu' ? 'webgpu' : 'webgl',
    quality: settings.quality ?? 'medium',
    cursor: normalizeCursorSettings(settings.cursor),
    input: {
      actions: settings.inputActions,
      touch: {
        ...settings.touch,
        enabled: touch.mode === 'auto' ? settings.touch.enabled : touch.mode,
        initialLayout: touch.layout || settings.touch.initialLayout,
      },
    },
    tags: settings.tags,
    layers: settings.layers,
  }
}
