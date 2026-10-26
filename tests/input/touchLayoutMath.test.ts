import { describe, it, expect } from 'vitest'
import { touchScale, buttonRect, findLayoutIssues, placeButton, DEVICE_PRESETS } from '../../engine/input/touchLayoutMath'
import { cloneDefaultTouch } from '../../engine/input/defaultInput'
import { resolveTouchLayout } from '../../engine/input/normalizeActions'

describe('touch layout math', () => {
  it('scales with the shorter screen side, clamped', () => {
    expect(touchScale({ scale: 'auto' }, { width: 568, height: 320 })).toBeCloseTo(0.82, 2)
    expect(touchScale({ scale: 'auto' }, { width: 852, height: 390 })).toBe(1)
    expect(touchScale({ scale: 'auto' }, { width: 1366, height: 1024 })).toBe(1.5)
    expect(touchScale({ scale: 1.25 }, { width: 100, height: 100 })).toBe(1.25)
  })

  it('places buttons from anchors in px and %', () => {
    const vp = { width: 800, height: 400 }
    expect(buttonRect({ id: 'a', action: 'Jump', anchor: 'bottom-right', x: 20, y: 10, size: 60 }, vp, 1)).toMatchObject({ x: 720, y: 330, size: 60 })
    expect(buttonRect({ id: 'b', action: 'Jump', anchor: 'top-left', x: 10, y: 10, unit: '%', size: 40 }, vp, 2)).toMatchObject({ x: 80, y: 40, size: 80 })
    expect(buttonRect({ id: 'c', action: 'Jump', anchor: 'bottom-center', x: 0, y: 0, size: 50 }, vp, 1)).toMatchObject({ x: 375, y: 350 })
    // small buttons get a 44 px touch area
    expect(buttonRect({ id: 'd', action: 'Jump', size: 30 }, vp, 1).hitSize).toBe(44)
  })

  it('the default layout has no overlap or off-screen buttons on any preset device', () => {
    const issues = findLayoutIssues(resolveTouchLayout(cloneDefaultTouch()), DEVICE_PRESETS).filter((i) => i.kind === 'overlap' || i.kind === 'offscreen')
    expect(issues).toEqual([])
  })

  it('reports overlaps, off-screen, joystick coverage and vector2 actions', () => {
    const layout = resolveTouchLayout({
      ...cloneDefaultTouch(),
      buttons: [
        { id: 'A', action: 'Jump', anchor: 'bottom-right', x: 20, y: 20, size: 70 },
        { id: 'B', action: 'Attack', anchor: 'bottom-right', x: 30, y: 30, size: 70 },
        { id: 'Far', action: 'Jump', anchor: 'top-left', x: 3000, y: 10, size: 50 },
        { id: 'Stick', action: 'Jump', anchor: 'bottom-left', x: 40, y: 40, size: 128 },
        { id: 'Mv', action: 'Move', anchor: 'top-right', x: 10, y: 10, size: 50 },
      ],
    })
    const kinds = new Set(findLayoutIssues(layout, DEVICE_PRESETS, { Move: 'vector2' }).map((i) => `${i.kind}:${i.buttons.join('+')}`))
    expect(kinds.has('overlap:A+B')).toBe(true)
    expect(kinds.has('offscreen:Far')).toBe(true)
    expect(kinds.has('joystick:Stick')).toBe(true)
    expect(kinds.has('vector-action:Mv')).toBe(true)
  })

  it('placeButton finds a free slot next to the default buttons', () => {
    const layout = resolveTouchLayout(cloneDefaultTouch())
    const placed = placeButton(layout, { id: 'Dash', action: 'Dash', size: 52 }, 'secondary')
    const issues = findLayoutIssues({ ...layout, buttons: [...layout.buttons, placed] }).filter(
      (i) => (i.kind === 'overlap' || i.kind === 'offscreen') && i.buttons.includes('Dash')
    )
    expect(issues).toEqual([])
  })
})
