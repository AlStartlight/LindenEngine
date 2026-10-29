import { expect } from '@playwright/test'
import { InputManager } from '../../../engine/input/InputActions'
import type { Case } from '../lib/define'
import { freshStore, state } from '../lib/store'
import { mulberry32, randFloat, randInt, seedOf, quiet } from '../lib/util'

// Window menu + Input Actions — 60.000 cases
//    5.000 Window menu opens a named window and closes it again
//    5.004 Editor tab switches: 9 (from, to) pairs x 556 sessions, (Scene/Bridge/Godot) from any tab to any tab
//    1.600 Move action: 16 WASD combinations x 100 deadzones
//   20.000 left stick samples respect deadzone 0.2 and the unit circle (one seed each)
//   15.000 Jump just-pressed / just-released over random frames (one seed each)
//   13.396 getAxis(negative, positive) for random action pairs and held keys (one seed each)
export const COUNT = 60_000

const WINDOWS = ['InputActions', 'ProjectSettings', 'BuildSettings', 'Preferences', 'UndoHistory'] as const
const PANELS = ['viewport', 'bridge', 'godot'] as const
const KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD'] as const

function moveInput(deadzone: number) {
  const input = quiet(() => new InputManager())
  input.registerAction({ name: 'Move', type: 'vector2', composite: { up: 'Keyboard/KeyW', down: 'Keyboard/KeyS', left: 'Keyboard/KeyA', right: 'Keyboard/KeyD' }, bindings: ['Gamepad/LeftStick'], deadzone })
  return input
}

export function* cases(): Generator<Case> {
  for (const win of WINDOWS) {
    for (let v = 0; v < 1_000; v++) {
      yield { title: `Window menu opens ${win} (session ${v}) and closes it`, run: () => {
        freshStore()
        state().setActiveWindow(`${win}`)
        expect(state().activeWindow).toBe(win)
        state().setActiveWindow(null)
        expect(state().activeWindow).toBeNull()
      } }
    }
  }

  for (const from of PANELS) {
    for (const to of PANELS) {
      for (let v = 0; v < 556; v++) {
        yield { title: `Editor tab switch ${from} -> ${to} (session ${v})`, run: () => {
          freshStore()
          state().setActiveEditorPanel(from)
          state().setActiveEditorPanel(to)
          expect(state().activeEditorPanel).toBe(to)
        } }
      }
    }
  }
  for (let mask = 0; mask < 16; mask++) {
    const held = KEYS.filter((_, i) => mask & (1 << i))
    for (let d = 0; d < 100; d++) {
      const deadzone = d / 100
      yield { title: `Move with [${held.join('+') || 'none'}] at deadzone ${deadzone}`, run: () => {
        const input = moveInput(deadzone)
        for (const k of held) input.setBindingDown(`Keyboard/${k}`)
        let x = (held.includes('KeyD') ? 1 : 0) - (held.includes('KeyA') ? 1 : 0)
        let y = (held.includes('KeyW') ? 1 : 0) - (held.includes('KeyS') ? 1 : 0)
        const mag = Math.hypot(x, y)
        if (mag <= deadzone) { x = 0; y = 0 } else if (mag > 1) { x /= mag; y /= mag }
        const v = input.getVector('Move')
        expect(v.x).toBeCloseTo(x, 12)
        expect(v.y).toBeCloseTo(y, 12)
      } }
    }
  }

  for (let s = 0; s < 20_000; s++) {
    const seed = seedOf(1001, s)
    yield { title: `left stick sample respects deadzone 0.2 and unit clamp seed=${s}`, run: () => {
      const rng = mulberry32(seed)
      const sx = randFloat(rng, -1.5, 1.5)
      const sy = randFloat(rng, -1.5, 1.5)
      const input = moveInput(0.2)
      input.setAxisValue('Gamepad/LeftStickX', sx)
      input.setAxisValue('Gamepad/LeftStickY', sy)
      const mag = Math.hypot(sx, sy)
      const v = input.getVector('Move')
      if (mag <= 0.2) expect(v).toEqual({ x: 0, y: 0 })
      else {
        const k = mag > 1 ? 1 / mag : 1
        expect(v.x).toBeCloseTo(sx * k, 12)
        expect(v.y).toBeCloseTo(sy * k, 12)
      }
    } }
  }

  for (let s = 0; s < 15_000; s++) {
    const seed = seedOf(1002, s)
    yield { title: `Jump just-pressed / just-released over random frames seed=${s}`, run: () => {
      const rng = mulberry32(seed)
      const input = quiet(() => new InputManager())
      let prev = false
      for (let f = randInt(rng, 3, 40); f > 0; f--) {
        const down = rng() < 0.5
        if (down) input.setBindingDown(rng() < 0.5 ? 'Keyboard/Space' : 'Gamepad/ButtonSouth')
        else { input.setBindingUp('Keyboard/Space'); input.setBindingUp('Gamepad/ButtonSouth') }
        input.update()
        const now = input.isActionPressed('Jump')
        expect(input.isActionJustPressed('Jump')).toBe(now && !prev)
        expect(input.isActionJustReleased('Jump')).toBe(!now && prev)
        prev = now
      }
    } }
  }

  for (let s = 0; s < 13_396; s++) {
    const seed = seedOf(1003, s)
    yield { title: `getAxis(negative, positive) for held keys seed=${s}`, run: () => {
      const rng = mulberry32(seed)
      const input = quiet(() => new InputManager())
      const neg = `Left${randInt(rng, 0, 99)}`
      const pos = `Right${randInt(rng, 100, 199)}`
      input.registerAction({ name: neg, type: 'button', bindings: ['Keyboard/ArrowLeft'] })
      input.registerAction({ name: pos, type: 'button', bindings: ['Keyboard/ArrowRight'] })
      const l = rng() < 0.5
      const r = rng() < 0.5
      if (l) input.setBindingDown('Keyboard/ArrowLeft')
      if (r) input.setBindingDown('Keyboard/ArrowRight')
      input.update()
      expect(input.getAxis(neg, pos)).toBe((r ? 1 : 0) - (l ? 1 : 0))
    } }
  }
}
