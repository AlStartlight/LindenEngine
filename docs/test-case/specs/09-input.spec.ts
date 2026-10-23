import { test, expect } from '@playwright/test'
import { InputManager } from '../../../engine/input/InputActions'
import { mulberry32, randFloat, randInt, tcId } from './_helpers'

// 400 cases: 160 WASD combos x deadzones, 200 stick/deadzone samples, 40 button lifecycles
const KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD'] as const

function moveWithDeadzone(deadzone: number) {
  const input = new InputManager()
  input.registerAction({
    name: 'Move',
    type: 'vector2',
    composite: { up: 'Keyboard/KeyW', down: 'Keyboard/KeyS', left: 'Keyboard/KeyA', right: 'Keyboard/KeyD' },
    bindings: ['Gamepad/LeftStick'],
    deadzone,
  })
  return input
}

test.describe('InputManager (Input Actions)', () => {
  let n = 0

  for (let mask = 0; mask < 16; mask++) {
    const held = KEYS.filter((_, i) => mask & (1 << i))
    for (let d = 0; d < 10; d++) {
      const deadzone = d / 10
      test(`${tcId('INP', ++n)} Move with [${held.join('+') || 'none'}] and deadzone ${deadzone}`, () => {
        const input = moveWithDeadzone(deadzone)
        for (const k of held) input.setBindingDown(`Keyboard/${k}`)
        let x = (held.includes('KeyD') ? 1 : 0) - (held.includes('KeyA') ? 1 : 0)
        let y = (held.includes('KeyW') ? 1 : 0) - (held.includes('KeyS') ? 1 : 0)
        const mag = Math.hypot(x, y)
        if (mag <= deadzone) { x = 0; y = 0 } else if (mag > 1) { x /= mag; y /= mag }
        const v = input.getVector('Move')
        expect(v.x).toBeCloseTo(x, 9)
        expect(v.y).toBeCloseTo(y, 9)
        expect(Math.hypot(v.x, v.y)).toBeLessThanOrEqual(1 + 1e-9)
      })
    }
  }

  for (let s = 0; s < 200; s++) {
    const rng = mulberry32(13000 + s)
    const sx = randFloat(rng, -1.5, 1.5)
    const sy = randFloat(rng, -1.5, 1.5)
    test(`${tcId('INP', ++n)} left stick (${sx.toFixed(3)}, ${sy.toFixed(3)}) respects deadzone 0.2 and unit clamp`, () => {
      const input = moveWithDeadzone(0.2)
      input.setAxisValue('Gamepad/LeftStickX', sx)
      input.setAxisValue('Gamepad/LeftStickY', sy)
      const mag = Math.hypot(sx, sy)
      const v = input.getVector('Move')
      if (mag <= 0.2) {
        expect(v).toEqual({ x: 0, y: 0 })
      } else {
        const k = mag > 1 ? 1 / mag : 1
        expect(v.x).toBeCloseTo(sx * k, 9)
        expect(v.y).toBeCloseTo(sy * k, 9)
      }
    })
  }

  for (let s = 0; s < 40; s++) {
    const rng = mulberry32(14000 + s)
    const frames = Array.from({ length: randInt(rng, 5, 30) }, () => rng() < 0.5)
    test(`${tcId('INP', ++n)} Jump just-pressed/released over ${frames.length} frames (seed ${s})`, () => {
      const input = new InputManager()
      let prev = false
      for (const down of frames) {
        if (down) input.setBindingDown('Keyboard/Space')
        else input.setBindingUp('Keyboard/Space')
        input.update()
        expect(input.isActionPressed('Jump')).toBe(down)
        expect(input.isActionJustPressed('Jump')).toBe(down && !prev)
        expect(input.isActionJustReleased('Jump')).toBe(!down && prev)
        prev = down
      }
    })
  }
})
