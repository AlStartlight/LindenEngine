import { describe, it, expect } from 'vitest'
import { normalizeTouchConfig, resolveTouchLayout, touchLayoutNames } from '../../engine/input/normalizeActions'
import { InputManager } from '../../engine/input/InputActions'
import { cloneDefaultActions } from '../../engine/input/defaultInput'

const v1Actions = () => {
  const actions = cloneDefaultActions()
  actions.find((a) => a.name === 'Jump')!.bindings!.push('Touch/Button/Jump')
  ;(actions.find((a) => a.name === 'Turn')!.composites![0] as any).negative.push('Touch/Button/TurnLeft')
  actions.push({ name: 'Dash', type: 'button', bindings: ['Keyboard/KeyG'] })
  return actions
}

describe('touch config v2', () => {
  it('migrates v1 buttons: manual bindings move onto the button, action names match ids', () => {
    const res = normalizeTouchConfig(
      { buttons: [{ id: 'Jump', label: 'JUMP' }, { id: 'TurnLeft', toggle: true }, { id: 'Dash' }, { id: 'Mystery' }] },
      v1Actions()
    )
    const byId = Object.fromEntries(res.config.buttons.map((b) => [b.id, b]))
    expect(byId.Jump).toMatchObject({ action: 'Jump' })
    expect(byId.TurnLeft).toMatchObject({ action: 'Turn', value: -1, behavior: 'toggle' })
    expect(byId.Dash).toMatchObject({ action: 'Dash' })
    expect(byId.Mystery.action).toBe('')
    expect(res.migrated).toBe(3)
    expect(res.warnings.join(' ')).toMatch(/Mystery.*belum terhubung/)
    // the manual binding was moved off the action
    expect(res.actions.find((a) => a.name === 'Jump')!.bindings).not.toContain('Touch/Button/Jump')
  })

  it('renames duplicate ids, rejects bad icons/colors, warns on unknown actions', () => {
    const res = normalizeTouchConfig(
      {
        buttons: [
          { id: 'Hit', action: 'Attack', icon: 'asset:assets/ui/sword.png', color: '#dc2626' },
          { id: 'Hit', action: 'Attack', icon: 'asset:../secret.png', color: 'red;background:url(x)' },
          { id: 'Fly', action: 'Fly' },
        ],
      },
      cloneDefaultActions()
    )
    expect(res.config.buttons.map((b) => b.id)).toEqual(['Hit', 'Hit_2', 'Fly'])
    expect(res.config.buttons[0]).toMatchObject({ icon: 'asset:assets/ui/sword.png', color: '#dc2626' })
    expect(res.config.buttons[1].icon).toBeUndefined()
    expect(res.config.buttons[1].color).toBeUndefined()
    expect(res.warnings.join('\n')).toMatch(/ganda/)
    expect(res.warnings.join('\n')).toMatch(/"Fly" yang tidak ada/)
  })

  it('resolves named layouts over the default and keeps the initial layout', () => {
    const res = normalizeTouchConfig(
      {
        buttons: [{ id: 'Jump', action: 'Jump' }],
        look: { enabled: true },
        layouts: { vehicle: { look: { enabled: false }, buttons: [{ id: 'Gas', action: 'Jump', shape: 'rounded' }] }, 'bad name!': {} },
        initialLayout: 'vehicle',
      },
      cloneDefaultActions()
    )
    expect(touchLayoutNames(res.config)).toEqual(['default', 'vehicle'])
    const vehicle = resolveTouchLayout(res.config)
    expect(vehicle.buttons.map((b) => b.id)).toEqual(['Gas'])
    expect(vehicle.look.enabled).toBe(false)
    expect(vehicle.joystick.radius).toBe(64)
    expect(resolveTouchLayout(res.config, 'default').buttons.map((b) => b.id)).toEqual(['Jump'])
    expect(res.warnings.join(' ')).toMatch(/bad name!/)
  })

  it('routes button presses to actions, with direction for axis actions', () => {
    const input = new InputManager()
    input.setTouchButtons([
      { id: 'Hit', action: 'Attack' },
      { id: 'L', action: 'Turn', value: -1 },
      { id: 'R', action: 'Turn', value: 1 },
    ])
    input.setVirtualButton('Touch/Button/Hit', true)
    input.setVirtualButton('Touch/Button/L', true)
    input.update()
    expect(input.isActionPressed('Attack')).toBe(true)
    expect(input.getAxis('Turn')).toBe(-1)
    input.setVirtualButton('Touch/Button/L', false)
    input.setVirtualButton('Touch/Button/R', true)
    input.update()
    expect(input.getAxis('Turn')).toBe(1)
    // switching layouts disconnects the old buttons
    input.setTouchButtons([])
    input.update()
    expect(input.isActionPressed('Attack')).toBe(false)
  })
})
