import { describe, it, expect } from 'vitest'
import { normalizeInputActions, normalizeBinding, withMissingDefaults, normalizeTouchLayout } from '../../engine/input/normalizeActions'

describe('normalizeInputActions', () => {
  it('normalizes key names to KeyboardEvent.code', () => {
    expect(normalizeBinding('W')).toBe('Keyboard/KeyW')
    expect(normalizeBinding('Keyboard/W')).toBe('Keyboard/KeyW')
    expect(normalizeBinding(' ')).toBe('Keyboard/Space')
    expect(normalizeBinding('shift')).toBe('Keyboard/ShiftLeft')
    expect(normalizeBinding('Up')).toBe('Keyboard/ArrowUp')
    expect(normalizeBinding('5')).toBe('Keyboard/Digit5')
    expect(normalizeBinding('gamepad/ButtonSouth')).toBe('Gamepad/ButtonSouth')
    expect(normalizeBinding('Touch/Button/Jump')).toBe('Touch/Button/Jump')
  })

  it('migrates the legacy single composite to composites', () => {
    const { actions } = normalizeInputActions([
      { name: 'Move', type: 'vector2', composite: { up: 'Keyboard/W', down: 'Keyboard/KeyS', left: 'Keyboard/KeyA', right: 'Keyboard/KeyD' }, bindings: ['Gamepad/LeftStick'], deadzone: 0.2 },
    ])
    expect(actions[0]).toEqual({
      name: 'Move',
      type: 'vector2',
      bindings: ['Gamepad/LeftStick'],
      composites: [{ up: ['Keyboard/KeyW'], down: ['Keyboard/KeyS'], left: ['Keyboard/KeyA'], right: ['Keyboard/KeyD'] }],
      deadzone: 0.2,
    })
  })

  it('migrates the old agent shapes ({ name, keys } and { device, path })', () => {
    const { actions, warnings } = normalizeInputActions([
      { name: 'Jump', keys: ['Space', 'W'] },
      { id: 'fire', name: 'Fire', type: 'button', bindings: [{ id: 'b1', device: 'keyboard', path: 'KeyF' }] },
    ])
    expect(actions[0]).toMatchObject({ name: 'Jump', type: 'button', bindings: ['Keyboard/Space', 'Keyboard/KeyW'] })
    expect(actions[1]).toMatchObject({ name: 'Fire', type: 'button', bindings: ['Keyboard/KeyF'] })
    expect(warnings).toEqual([])
  })

  it('reports nameless, duplicate and binding-less actions', () => {
    const { actions, warnings } = normalizeInputActions([{ type: 'button' }, { name: 'A', bindings: ['Space'] }, { name: 'A' }, { name: 'B' }])
    expect(actions.map((a) => a.name)).toEqual(['A', 'B'])
    expect(warnings).toHaveLength(3)
  })

  it('falls back to the default map when actions are missing', () => {
    const names = normalizeInputActions(undefined).actions.map((a) => a.name)
    expect(names).toEqual(['Move', 'Turn', 'Vertical', 'Look', 'Jump', 'Sprint', 'Crouch', 'Interact', 'Attack'])
    expect(withMissingDefaults([{ name: 'Jump', type: 'button', bindings: ['Keyboard/KeyK'] }]).find((a) => a.name === 'Jump')?.bindings).toEqual(['Keyboard/KeyK'])
  })

  it('sanitizes touch layouts', () => {
    const t = normalizeTouchLayout({ enabled: 'always', buttons: [{ id: 'Jump' }, { id: 'bad id<' }, { id: '<>' }], opacity: 5 })
    expect(t.enabled).toBe('always')
    // Invalid characters are stripped; ids with nothing left are dropped
    expect(t.buttons.map((b) => b.id)).toEqual(['Jump', 'badid'])
    expect(t.opacity).toBe(1)
    expect(t.joystick.mode).toBe('floating')
  })
})
