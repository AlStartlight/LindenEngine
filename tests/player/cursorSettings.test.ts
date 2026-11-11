import { describe, it, expect } from 'vitest'
import { DEFAULT_CURSOR, cursorCss, normalizeCursorSettings, shouldLockPointer } from '../../shared/cursorSettings'

describe('normalizeCursorSettings', () => {
  it('defaults to auto/default when the project has no cursor section', () => {
    expect(normalizeCursorSettings(undefined)).toEqual(DEFAULT_CURSOR)
    expect(normalizeCursorSettings(null)).toEqual(DEFAULT_CURSOR)
    expect(normalizeCursorSettings('locked')).toEqual(DEFAULT_CURSOR)
  })

  it('keeps valid values and drops unknown ones', () => {
    expect(normalizeCursorSettings({ mode: 'visible', style: 'crosshair' })).toEqual({ mode: 'visible', style: 'crosshair', hotspot: [0, 0] })
    expect(normalizeCursorSettings({ mode: 'spin', style: 'banana' })).toEqual(DEFAULT_CURSOR)
  })

  it('falls back to the arrow when custom has no image', () => {
    expect(normalizeCursorSettings({ style: 'custom' }).style).toBe('default')
    expect(normalizeCursorSettings({ style: 'custom', image: '  ' }).style).toBe('default')
  })

  it('clamps the hotspot to the 128px browser limit', () => {
    const s = normalizeCursorSettings({ style: 'custom', image: 'assets/ui/aim.png', hotspot: [16.4, 500] })
    expect(s).toEqual({ mode: 'auto', style: 'custom', image: 'assets/ui/aim.png', hotspot: [16, 127] })
    expect(normalizeCursorSettings({ hotspot: [-3, 'x'] }).hotspot).toEqual([0, 0])
  })
})

describe('cursorCss', () => {
  it('maps keyword shapes straight through', () => {
    expect(cursorCss(normalizeCursorSettings({ style: 'pointer' }))).toBe('pointer')
  })

  it('hides the cursor in hidden mode whatever the shape', () => {
    expect(cursorCss(normalizeCursorSettings({ mode: 'hidden', style: 'crosshair' }))).toBe('none')
  })

  it('builds url() with hotspot and a fallback for custom images', () => {
    const s = normalizeCursorSettings({ style: 'custom', image: 'assets/ui/aim.png', hotspot: [16, 16] })
    expect(cursorCss(s, (p) => `https://game.test/${p}`)).toBe('url("https://game.test/assets/ui/aim.png") 16 16, default')
  })

  it('escapes quotes in the resolved url', () => {
    const s = normalizeCursorSettings({ style: 'custom', image: 'assets/a"b.png' })
    expect(cursorCss(s)).toBe('url("assets/a\\"b.png") 0 0, default')
  })
})

describe('shouldLockPointer', () => {
  it('auto locks only for mouse-look games (previous behaviour)', () => {
    expect(shouldLockPointer(DEFAULT_CURSOR, true)).toBe(true)
    expect(shouldLockPointer(DEFAULT_CURSOR, false)).toBe(false)
  })

  it('locked always locks; visible and hidden never do', () => {
    expect(shouldLockPointer(normalizeCursorSettings({ mode: 'locked' }), false)).toBe(true)
    expect(shouldLockPointer(normalizeCursorSettings({ mode: 'visible' }), true)).toBe(false)
    expect(shouldLockPointer(normalizeCursorSettings({ mode: 'hidden' }), true)).toBe(false)
  })
})
