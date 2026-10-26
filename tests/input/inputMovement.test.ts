import { describe, it, expect } from 'vitest'
import { InputManager } from '../../engine/input/InputActions'

describe('Input for character movement', () => {
  it('moves with WASD and with arrows, counting both together once', () => {
    const input = new InputManager()
    input.setBindingDown('Keyboard/ArrowUp')
    input.update()
    expect(input.getVector('Move')).toEqual({ x: 0, y: 1 })
    input.setBindingDown('Keyboard/KeyW')
    input.update()
    expect(input.getVector('Move')).toEqual({ x: 0, y: 1 })
    input.setBindingDown('Keyboard/KeyA')
    input.update()
    const v = input.getVector('Move')
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 5)
  })

  it('keeps analog joystick magnitude (half tilt = half speed) past the deadzone', () => {
    const input = new InputManager()
    input.setVirtualAxis('Touch/Joystick', 0, 0.5)
    input.update()
    const v = input.getVector('Move')
    expect(v.x).toBe(0)
    expect(v.y).toBeCloseTo((0.5 - 0.15) / 0.85, 5)
    expect(input.lastDevice).toBe('touch')
    input.setVirtualAxis('Touch/Joystick', 0.05, 0.05)
    input.update()
    expect(input.getVector('Move')).toEqual({ x: 0, y: 0 })
  })

  it('maps Q/E to Turn and Vertical as -1/+1', () => {
    const input = new InputManager()
    input.setBindingDown('Keyboard/KeyQ')
    input.update()
    expect(input.getAxis('Turn')).toBe(-1)
    expect(input.getAxis('Vertical')).toBe(-1)
    input.setBindingDown('Keyboard/KeyE')
    input.update()
    expect(input.getAxis('Turn')).toBe(0)
    input.setBindingUp('Keyboard/KeyQ')
    input.update()
    expect(input.getAxis('Turn')).toBe(1)
    // Q+E cancel out (axis 0 = released), so releasing Q is a fresh press of Turn
    expect(input.isActionJustPressed('Turn')).toBe(true)
  })

  it('reads analog triggers for Vertical and the legacy two-action getAxis', () => {
    const input = new InputManager()
    input.setAxisValue('Gamepad/RightTrigger', 0.6)
    input.update()
    expect(input.getAxis('Vertical')).toBeCloseTo(0.6, 5)
    expect(input.isActionPressed('Attack')).toBe(true)
    expect(input.getActionStrength('Attack')).toBeCloseTo(0.6, 5)
    input.setBindingDown('Keyboard/Space')
    input.update()
    expect(input.getAxis('Crouch', 'Jump')).toBe(1)
  })

  it('sprints from a fully pushed joystick or the Sprint button', () => {
    const input = new InputManager()
    input.setVirtualAxis('Touch/Joystick', 0, 0.7)
    input.update()
    expect(input.isActionPressed('Sprint')).toBe(false)
    input.setVirtualAxis('Touch/Joystick', 0, 0.95)
    input.update()
    expect(input.isActionPressed('Sprint')).toBe(true)
    input.setVirtualAxis('Touch/Joystick', 0, 0)
    // On-screen buttons reach their action through TouchButtonDef.action
    input.setTouchButtons([{ id: 'Run', action: 'Sprint' }])
    input.setVirtualButton('Touch/Button/Run', true)
    input.update()
    expect(input.isActionPressed('Sprint')).toBe(true)
  })

  it('touch buttons drive their actions; Look deltas last exactly one frame', () => {
    const input = new InputManager()
    input.setTouchButtons([{ id: 'Jump', action: 'Jump' }])
    input.setVirtualButton('Touch/Button/Jump', true)
    input.update()
    expect(input.isActionJustPressed('Jump')).toBe(true)
    input.setVirtualButton('Touch/Button/Jump', false)
    input.update()
    expect(input.isActionJustReleased('Jump')).toBe(true)

    input.addVirtualDelta('Touch/Look', 50, -10)
    input.update()
    const look = input.getVector('Look')
    expect(look.x).toBeCloseTo(1, 5)
    expect(look.y).toBeCloseTo(-0.2, 5)
    input.update()
    expect(input.getVector('Look')).toEqual({ x: 0, y: 0 })
  })

  it('loadActions accepts old agent shapes and reports warnings', () => {
    const input = new InputManager()
    const warnings = input.loadActions([{ name: 'Fire', keys: ['F'] }, { name: 'Broken' }])
    input.setBindingDown('Keyboard/KeyF')
    input.update()
    expect(input.isActionPressed('Fire')).toBe(true)
    expect(warnings).toEqual(['Action "Broken" tidak punya binding'])
  })

  it('counts a tap shorter than one frame as a press for exactly one frame', () => {
    const input = new InputManager()
    input.setBindingDown('Keyboard/Space')
    input.setBindingUp('Keyboard/Space')
    input.update()
    expect(input.isActionJustPressed('Jump')).toBe(true)
    input.update()
    expect(input.isActionPressed('Jump')).toBe(false)
    expect(input.isActionJustReleased('Jump')).toBe(true)
  })
})
