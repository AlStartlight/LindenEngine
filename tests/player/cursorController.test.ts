import { describe, it, expect, vi } from 'vitest'
import { CursorController } from '../../player/cursorController'
import { parseEditorToGame } from '../../shared/playProtocol'
import { buildPlayProjectConfig } from '../../editor/viewport/playProjectConfig'
import { useEditorStore } from '../../editor/store/editorStore'

/** Fake canvas + document that behave like the browser's pointer lock */
function setup(opts: { mouseLook?: boolean; touch?: boolean } = {}) {
  const listeners: Record<string, Array<() => void>> = {}
  const doc = {
    pointerLockElement: null as unknown,
    exitPointerLock: vi.fn(() => {
      doc.pointerLockElement = null
      listeners.pointerlockchange?.forEach((f) => f())
    }),
    addEventListener: (t: string, f: () => void) => (listeners[t] ??= []).push(f),
    removeEventListener: (t: string, f: () => void) => (listeners[t] = (listeners[t] ?? []).filter((g) => g !== f)),
  }
  const canvas = {
    style: { cursor: '' },
    requestPointerLock: vi.fn(() => lock(canvas)),
    addEventListener: (t: string, f: () => void) => (listeners[t] ??= []).push(f),
    removeEventListener: (t: string, f: () => void) => (listeners[t] = (listeners[t] ?? []).filter((g) => g !== f)),
  }
  /** Anything (the player or a game script) taking the lock */
  const lock = (el: unknown) => {
    doc.pointerLockElement = el
    listeners.pointerlockchange?.forEach((f) => f())
  }
  const click = () => listeners.click?.forEach((f) => f())
  const warn = vi.fn()
  const ctl = new CursorController({
    canvas,
    document: doc,
    resolveUrl: (p) => `https://game/${p}`,
    usesMouseLook: () => opts.mouseLook ?? true,
    touch: opts.touch,
    warn,
  })
  return { ctl, canvas, doc, click, lock, warn, listeners }
}

describe('CursorController', () => {
  it('"Selalu tampil" never locks on click, even in a mouse-look game (Dizzle)', () => {
    const { ctl, canvas, doc, click } = setup({ mouseLook: true })
    ctl.apply({ mode: 'visible', style: 'pointer' })
    click()
    expect(canvas.requestPointerLock).not.toHaveBeenCalled()
    expect(doc.pointerLockElement).toBeNull()
    expect(canvas.style.cursor).toBe('pointer')
  })

  it('releases a lock taken by a game script in visible mode and warns once', () => {
    const { ctl, doc, lock, warn } = setup()
    ctl.apply({ mode: 'visible' })
    lock({})
    expect(doc.exitPointerLock).toHaveBeenCalledTimes(1)
    expect(doc.pointerLockElement).toBeNull()
    lock({})
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('Selalu tampil')
  })

  it('hidden mode hides the cursor but does not lock', () => {
    const { ctl, canvas, click } = setup()
    ctl.apply({ mode: 'hidden', style: 'crosshair' })
    click()
    expect(canvas.style.cursor).toBe('none')
    expect(canvas.requestPointerLock).not.toHaveBeenCalled()
  })

  it('locked mode locks on click and keeps the lock', () => {
    const { ctl, canvas, doc, click } = setup({ mouseLook: false })
    ctl.apply({ mode: 'locked' })
    click()
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1)
    expect(doc.pointerLockElement).toBe(canvas)
    expect(doc.exitPointerLock).not.toHaveBeenCalled()
  })

  it('auto keeps the old behaviour: lock only with Mouse/Delta', () => {
    const withLook = setup({ mouseLook: true })
    withLook.ctl.apply(undefined)
    withLook.click()
    expect(withLook.canvas.requestPointerLock).toHaveBeenCalledTimes(1)

    const noLook = setup({ mouseLook: false })
    noLook.ctl.apply(undefined)
    noLook.click()
    expect(noLook.canvas.requestPointerLock).not.toHaveBeenCalled()
  })

  it('switching locked -> visible while locked releases right away (no Esc needed)', () => {
    const { ctl, canvas, doc, click } = setup()
    ctl.apply({ mode: 'locked' })
    click()
    expect(doc.pointerLockElement).toBe(canvas)
    ctl.apply({ mode: 'visible' })
    expect(doc.pointerLockElement).toBeNull()
    click()
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1)
  })

  it('touch devices never request a lock on click', () => {
    const { ctl, canvas, click } = setup({ touch: true })
    ctl.apply({ mode: 'locked' })
    click()
    expect(canvas.requestPointerLock).not.toHaveBeenCalled()
  })

  it('dispose removes its listeners', () => {
    const { ctl, listeners } = setup()
    ctl.dispose()
    expect(listeners.click).toEqual([])
    expect(listeners.pointerlockchange).toEqual([])
  })
})

describe('Play payload', () => {
  it('linden:init projectConfig carries the cursor setting (was dropped before)', () => {
    const settings = { ...useEditorStore.getState().projectSettings, cursor: { mode: 'visible' as const, style: 'pointer' as const, hotspot: [0, 0] as [number, number] } }
    const cfg = buildPlayProjectConfig('Dizzle', settings, { mode: 'auto', layout: '' })
    expect(cfg.cursor).toEqual({ mode: 'visible', style: 'pointer', hotspot: [0, 0] })
    expect(cfg.input.actions).toBe(settings.inputActions)
  })

  it('defaults the cursor when the project has none', () => {
    const cfg = buildPlayProjectConfig('X', useEditorStore.getState().projectSettings, { mode: 'auto', layout: '' })
    expect(cfg.cursor.mode).toBe('auto')
  })

  it('accepts linden:cursor and rejects invalid modes', () => {
    expect(parseEditorToGame({ type: 'linden:cursor', cursor: { mode: 'visible', style: 'pointer', hotspot: [0, 0] } })).not.toBeNull()
    expect(parseEditorToGame({ type: 'linden:cursor', cursor: { mode: 'grab', style: 'pointer', hotspot: [0, 0] } })).toBeNull()
  })
})
