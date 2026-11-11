import { DEFAULT_CURSOR, cursorCss, normalizeCursorSettings, shouldLockPointer, type CursorSettings } from '../shared/cursorSettings'

/** The bits of the canvas/document the controller touches (narrow so tests can pass fakes) */
export interface CursorCanvas {
  style: { cursor: string }
  requestPointerLock?: () => unknown
  addEventListener(type: 'click', fn: () => void): void
  removeEventListener(type: 'click', fn: () => void): void
}

export interface CursorDocument {
  pointerLockElement: unknown
  exitPointerLock?: () => void
  addEventListener(type: 'pointerlockchange', fn: () => void): void
  removeEventListener(type: 'pointerlockchange', fn: () => void): void
}

export interface CursorControllerOptions {
  canvas: CursorCanvas
  document: CursorDocument
  resolveUrl: (path: string) => string
  /** True when an input action reads Mouse/Delta (mouse look) */
  usesMouseLook: () => boolean
  /** Touch devices: never request a lock on click (the guard still runs) */
  touch?: boolean
  warn?: (message: string) => void
}

const MODE_LABEL: Record<CursorSettings['mode'], string> = {
  auto: 'Auto',
  visible: 'Selalu tampil',
  hidden: 'Disembunyikan',
  locked: 'Dikunci (FPS)',
}

/**
 * Applies the project's cursor settings to the game canvas: shape, lock-on-click, and a guard that
 * releases any pointer lock the mode doesn't allow (e.g. a script calling requestPointerLock while
 * the cursor is set to "Selalu tampil"). Settings can change while the game runs (linden:cursor).
 */
export class CursorController {
  private settings: CursorSettings = DEFAULT_CURSOR
  private warned = false
  private readonly onClick = () => {
    if (this.opts.touch || !this.lockAllowed()) return
    if (this.opts.document.pointerLockElement !== this.opts.canvas) this.opts.canvas.requestPointerLock?.()
  }
  private readonly onLockChange = () => {
    if (!this.opts.document.pointerLockElement || this.lockAllowed()) return
    this.opts.document.exitPointerLock?.()
    if (!this.warned) {
      this.warned = true
      this.opts.warn?.(`Cursor diset "${MODE_LABEL[this.settings.mode]}" di Project Settings, pointer lock dilepas.`)
    }
  }

  constructor(private readonly opts: CursorControllerOptions) {
    opts.canvas.addEventListener('click', this.onClick)
    opts.document.addEventListener('pointerlockchange', this.onLockChange)
  }

  get current(): CursorSettings {
    return this.settings
  }

  lockAllowed(): boolean {
    return shouldLockPointer(this.settings, this.opts.usesMouseLook())
  }

  /** Apply settings from project.linden.json or a live linden:cursor update */
  apply(raw: unknown): void {
    this.settings = normalizeCursorSettings(raw)
    this.opts.canvas.style.cursor = cursorCss(this.settings, this.opts.resolveUrl)
    // Switched to a mode that must not lock while locked: release now, without waiting for Esc
    if (this.opts.document.pointerLockElement && !this.lockAllowed()) this.opts.document.exitPointerLock?.()
  }

  dispose(): void {
    this.opts.canvas.removeEventListener('click', this.onClick)
    this.opts.document.removeEventListener('pointerlockchange', this.onLockChange)
  }
}
