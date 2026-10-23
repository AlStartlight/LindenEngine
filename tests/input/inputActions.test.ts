import { describe, it, expect, vi } from 'vitest'
import { InputManager } from '../../engine/input/InputActions'

describe('F1.4: Input Actions (TC-F14-01 to TC-F14-05)', () => {
  it('TC-F14-01: Keydown Space on frame N, keyup on N+3 updates justPressed, pressed, justReleased per frame', () => {
    const input = new InputManager()

    // Frame N: Key down
    input.setBindingDown('Keyboard/Space')
    input.update()
    expect(input.isActionJustPressed('Jump')).toBe(true)
    expect(input.isActionPressed('Jump')).toBe(true)
    expect(input.isActionJustReleased('Jump')).toBe(false)

    // Frame N+1: Key still held
    input.update()
    expect(input.isActionJustPressed('Jump')).toBe(false)
    expect(input.isActionPressed('Jump')).toBe(true)
    expect(input.isActionJustReleased('Jump')).toBe(false)

    // Frame N+2: Key still held
    input.update()
    expect(input.isActionJustPressed('Jump')).toBe(false)
    expect(input.isActionPressed('Jump')).toBe(true)
    expect(input.isActionJustReleased('Jump')).toBe(false)

    // Frame N+3: Key up
    input.setBindingUp('Keyboard/Space')
    input.update()
    expect(input.isActionJustPressed('Jump')).toBe(false)
    expect(input.isActionPressed('Jump')).toBe(false)
    expect(input.isActionJustReleased('Jump')).toBe(true)

    // Frame N+4: Key stays up
    input.update()
    expect(input.isActionJustPressed('Jump')).toBe(false)
    expect(input.isActionPressed('Jump')).toBe(false)
    expect(input.isActionJustReleased('Jump')).toBe(false)
  })

  it('TC-F14-02: Holding W and D yields normalized vector (approx 0.707, 0.707)', () => {
    const input = new InputManager()

    input.setBindingDown('Keyboard/KeyW')
    input.setBindingDown('Keyboard/KeyD')
    input.update()

    const vec = input.getVector('Move')
    expect(vec.x).toBeCloseTo(0.7071, 3)
    expect(vec.y).toBeCloseTo(0.7071, 3)
  })

  it('TC-F14-03: Left stick (0.1, 0) with deadzone 0.2 returns (0, 0)', () => {
    const input = new InputManager()

    input.setAxisValue('Gamepad/LeftStickX', 0.1)
    input.setAxisValue('Gamepad/LeftStickY', 0)
    input.update()

    const vec = input.getVector('Move')
    expect(vec.x).toBe(0)
    expect(vec.y).toBe(0)
  })

  it('TC-F14-04: Two bindings pressed together, releasing one keeps action pressed until both release', () => {
    const input = new InputManager()

    input.setBindingDown('Keyboard/Space')
    input.setBindingDown('Gamepad/ButtonSouth')
    input.update()
    expect(input.isActionPressed('Jump')).toBe(true)

    // Release Space, ButtonSouth still pressed
    input.setBindingUp('Keyboard/Space')
    input.update()
    expect(input.isActionPressed('Jump')).toBe(true)

    // Release ButtonSouth
    input.setBindingUp('Gamepad/ButtonSouth')
    input.update()
    expect(input.isActionPressed('Jump')).toBe(false)
    expect(input.isActionJustReleased('Jump')).toBe(true)
  })

  it('TC-F14-05: Querying unregistered action logs warning once and returns false', () => {
    const input = new InputManager()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(input.isActionPressed('NonExistentAction')).toBe(false)
    expect(input.isActionJustPressed('NonExistentAction')).toBe(false)
    expect(input.isActionJustReleased('NonExistentAction')).toBe(false)

    // Only warned once
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not registered'))

    warnSpy.mockRestore()
  })
})
