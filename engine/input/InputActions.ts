import { DEFAULT_INPUT_ACTIONS } from './defaultInput'
import { normalizeInputActions } from './normalizeActions'

/** @deprecated single key per direction; use InputActionDef.composites */
export interface InputActionBindingComposite {
  up?: string
  down?: string
  left?: string
  right?: string
}

export interface Vector2Composite {
  up?: string[]
  down?: string[]
  left?: string[]
  right?: string[]
}

export interface AxisComposite {
  negative?: string[]
  positive?: string[]
}

export interface InputActionDef {
  name: string
  type: 'button' | 'axis' | 'vector2'
  /**
   * Direct bindings: 'Keyboard/Space', 'Mouse/LeftButton', 'Mouse/Delta', 'Gamepad/ButtonSouth',
   * 'Gamepad/LeftStick', 'Gamepad/LeftTrigger', 'Touch/Joystick', 'Touch/Look', 'Touch/Button/Jump'
   */
  bindings?: string[]
  /** vector2: keys per direction; axis: negative/positive keys. Several sets allowed (WASD + arrows) */
  composites?: (Vector2Composite | AxisComposite)[]
  /** @deprecated migrated to composites by normalizeInputActions */
  composite?: InputActionBindingComposite
  deadzone?: number
  /** Multiplier for delta sources (mouse / touch drag) in vector2 actions */
  sensitivity?: number
  /** button: pressed when the strongest source reaches this value (e.g. Sprint from a fully pushed joystick) */
  pressThreshold?: number
}

export type TouchButtonBehavior = 'hold' | 'tap' | 'toggle' | 'repeat'
export type TouchAnchor = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'bottom-center' | 'top-center'

export interface TouchButtonDef {
  /** Unique within a layout: [A-Za-z0-9_-]; the button presses binding Touch/Button/<id> */
  id: string
  /** Input Action this button triggers (the connection lives here, not in the action's bindings) */
  action: string
  /** Axis actions only: direction this button pushes (-1 or +1, default +1) */
  value?: number
  label?: string
  /** Built-in icon name ("jump", "sword"...) or "asset:assets/ui/sword.png" */
  icon?: string
  behavior?: TouchButtonBehavior
  /** Seconds between repeats for behavior 'repeat' */
  repeatInterval?: number
  /** Seconds the button stays disabled after it fires */
  cooldown?: number
  anchor?: TouchAnchor
  x?: number
  y?: number
  /** px = logical pixels scaled with the screen; % = percent of the screen side */
  unit?: 'px' | '%'
  size?: number
  shape?: 'circle' | 'rounded' | 'square'
  color?: string
  pressedColor?: string
  textColor?: string
  opacity?: number
  visible?: boolean
  enabled?: boolean
  /** @deprecated use behavior: 'toggle' */
  toggle?: boolean
}

/** One resolved layout: what the player actually shows */
export interface TouchLayout {
  enabled: 'auto' | 'always' | 'never'
  /** Deadzone comes from the Move action, so it is applied once */
  joystick: { side: 'left' | 'right'; mode: 'floating' | 'fixed'; radius: number }
  look: { enabled: boolean; area: 'right-half'; sensitivity: number }
  buttons: TouchButtonDef[]
  opacity: number
  safeArea: boolean
  orientation?: 'landscape' | 'portrait'
  /** 'auto' = shorter screen side / 390 px clamped to 0.8..1.5; a number = fixed scale */
  scale?: 'auto' | number
}

/** project.linden.json input.touch: the default layout plus named alternatives */
export interface TouchConfig extends TouchLayout {
  /** Override layouts; a layout's buttons replace the default list entirely */
  layouts?: Record<string, Partial<Omit<TouchLayout, 'enabled'>>>
  initialLayout?: string
}

export type InputDevice = 'keyboard' | 'gamepad' | 'touch'

/** Vector sources made of an X and a Y axis value */
const STICK_SOURCES = ['Gamepad/LeftStick', 'Gamepad/RightStick', 'Touch/Joystick']
/** Per-frame deltas (pixels): not clamped, scaled by sensitivity */
const DELTA_SOURCES = ['Mouse/Delta', 'Touch/Look']
/** Pixel delta that equals one unit of stick deflection for Look */
const DELTA_SCALE = 0.02

const GAMEPAD_BUTTONS = [
  'ButtonSouth',
  'ButtonEast',
  'ButtonWest',
  'ButtonNorth',
  'LeftShoulder',
  'RightShoulder',
  'LeftTrigger',
  'RightTrigger',
  'Select',
  'Start',
  'LeftStickPress',
  'RightStickPress',
  'DPadUp',
  'DPadDown',
  'DPadLeft',
  'DPadRight',
]
const GAMEPAD_ANALOG_THRESHOLD = 0.15

export class InputManager {
  private actions: Map<string, InputActionDef> = new Map()
  private rawActiveBindings: Set<string> = new Set() // e.g. "Keyboard/Space", "Touch/Button/Jump"
  private rawActiveAxes: Map<string, number> = new Map() // e.g. "Gamepad/LeftStickX" -> 0.4
  // Bindings pressed since the last update(): a tap shorter than a frame still counts for one frame
  private tapAccum: Set<string> = new Set()
  private tapFrame: Set<string> = new Set()

  // Deltas accumulate between frames and are frozen per frame by update()
  private deltaAccum: Map<string, number> = new Map()
  private deltaFrame: Map<string, number> = new Map()

  // Per-action state
  private pressedActions: Set<string> = new Set()
  private prevPressedActions: Set<string> = new Set()
  private justPressedActions: Set<string> = new Set()
  private justReleasedActions: Set<string> = new Set()
  private warnedActions: Set<string> = new Set()

  private listeningCallback: ((binding: string) => void) | null = null
  /** Touch buttons connected to actions (TouchButtonDef.action): action -> [{ binding, value }] */
  private touchBindings: Map<string, { binding: string; value: number }[]> = new Map()
  /** Scripted values per action (linden_play inputScript, tests); win over real devices */
  private overrides: Map<string, number | { x: number; y: number }> = new Map()

  /** Device the player used last; lets UI show matching button prompts */
  lastDevice: InputDevice = 'keyboard'

  constructor() {
    this.registerDefaultActions()
    this.setupWindowListeners()
  }

  registerDefaultActions(): void {
    for (const a of JSON.parse(JSON.stringify(DEFAULT_INPUT_ACTIONS)) as InputActionDef[]) {
      this.registerAction(a)
    }
  }

  registerAction(action: InputActionDef): void {
    this.actions.set(action.name, action)
  }

  getActions(): InputActionDef[] {
    return Array.from(this.actions.values())
  }

  /** Replace all actions; any of the historical shapes is accepted (see normalizeActions.ts) */
  loadActions(actions: unknown[]): string[] {
    const { actions: normalized, warnings } = normalizeInputActions(actions)
    this.actions.clear()
    this.warnedActions.clear()
    for (const a of normalized) {
      this.registerAction(a)
    }
    return warnings
  }

  /**
   * Called once per frame update to compute "just pressed" and "just released" states
   */
  update(): void {
    this.justPressedActions.clear()
    this.justReleasedActions.clear()

    this.deltaFrame = this.deltaAccum
    this.deltaAccum = new Map()
    this.tapFrame = this.tapAccum
    this.tapAccum = new Set()

    // Query Gamepad API if available
    this.pollGamepads()

    for (const [name, action] of this.actions.entries()) {
      let isPressed = false

      if (action.type === 'button') {
        isPressed = this.buttonStrength(action) >= (action.pressThreshold ?? 0.5)
      } else if (action.type === 'vector2') {
        const v = this.computeVector(action)
        isPressed = Math.hypot(v.x, v.y) > 0.001
      } else if (action.type === 'axis') {
        isPressed = Math.abs(this.computeAxis(action)) > 0.001
      }

      const wasPressed = this.prevPressedActions.has(name)
      if (isPressed && !wasPressed) {
        this.justPressedActions.add(name)
      } else if (!isPressed && wasPressed) {
        this.justReleasedActions.add(name)
      }

      if (isPressed) {
        this.pressedActions.add(name)
      } else {
        this.pressedActions.delete(name)
      }
    }

    this.prevPressedActions = new Set(this.pressedActions)
  }

  /** Raw key state by KeyboardEvent.code or .key, e.g. 'KeyW', 'ArrowLeft', ' ' */
  isKeyDown(key: string): boolean {
    return this.rawActiveBindings.has(`Keyboard/${key}`)
  }

  isMouseDown(button: number = 0): boolean {
    const name = button === 0 ? 'LeftButton' : button === 2 ? 'RightButton' : 'MiddleButton'
    return this.rawActiveBindings.has(`Mouse/${name}`)
  }

  /** Release every held binding, e.g. when the game loses focus so keys don't stick */
  releaseAll(): void {
    this.rawActiveBindings.clear()
    this.tapAccum.clear()
    this.rawActiveAxes.clear()
    this.deltaAccum.clear()
  }

  isActionPressed(name: string): boolean {
    if (!this.actions.has(name)) {
      this.warnUnregistered(name)
      return false
    }
    return this.pressedActions.has(name)
  }

  isActionJustPressed(name: string): boolean {
    if (!this.actions.has(name)) {
      this.warnUnregistered(name)
      return false
    }
    return this.justPressedActions.has(name)
  }

  isActionJustReleased(name: string): boolean {
    if (!this.actions.has(name)) {
      this.warnUnregistered(name)
      return false
    }
    return this.justReleasedActions.has(name)
  }

  /** 0..1: analog strength of a button (trigger, joystick) or magnitude of an axis/vector action */
  getActionStrength(name: string): number {
    const action = this.actions.get(name)
    if (!action) {
      this.warnUnregistered(name)
      return 0
    }
    if (action.type === 'button') return Math.min(1, this.buttonStrength(action))
    if (action.type === 'axis') return Math.min(1, Math.abs(this.computeAxis(action)))
    const v = this.computeVector(action)
    return Math.min(1, Math.hypot(v.x, v.y))
  }

  getVector(name: string): { x: number; y: number } {
    const action = this.actions.get(name)
    if (!action) {
      this.warnUnregistered(name)
      return { x: 0, y: 0 }
    }
    return this.computeVector(action)
  }

  /**
   * getAxis('Turn') reads an axis action (-1..1).
   * getAxis('Left', 'Right') keeps the old two-button form.
   */
  getAxis(nameOrNegative: string, positiveAction?: string): number {
    if (positiveAction !== undefined) {
      const neg = this.isActionPressed(nameOrNegative) ? 1 : 0
      const pos = this.isActionPressed(positiveAction) ? 1 : 0
      return pos - neg
    }
    const action = this.actions.get(nameOrNegative)
    if (!action) {
      this.warnUnregistered(nameOrNegative)
      return 0
    }
    if (action.type === 'vector2') return this.computeVector(action).x
    if (action.type === 'button') return Math.min(1, this.buttonStrength(action))
    return this.computeAxis(action)
  }

  private computeVector(action: InputActionDef): { x: number; y: number } {
    const o = this.overrides.get(action.name)
    if (o !== undefined) return typeof o === 'number' ? { x: o, y: 0 } : { x: o.x, y: o.y }
    let x = 0
    let y = 0

    // Keyboard / button composites (several sets, several keys per direction)
    for (const c of (action.composites ?? []) as Vector2Composite[]) {
      x += this.maxValue(c.right) - this.maxValue(c.left)
      y += this.maxValue(c.up) - this.maxValue(c.down)
    }
    // Legacy single composite (actions registered without normalizing)
    if (action.composite) {
      const c = action.composite
      x += (c.right ? this.bindingValue(c.right) : 0) - (c.left ? this.bindingValue(c.left) : 0)
      y += (c.up ? this.bindingValue(c.up) : 0) - (c.down ? this.bindingValue(c.down) : 0)
    }
    // WASD + arrows held together count once
    x = Math.max(-1, Math.min(1, x))
    y = Math.max(-1, Math.min(1, y))
    const digital = x !== 0 || y !== 0

    // Sticks and the touch joystick (analog)
    let ax = 0
    let ay = 0
    for (const b of action.bindings ?? []) {
      if (STICK_SOURCES.includes(b)) {
        ax += this.rawActiveAxes.get(`${b}X`) ?? 0
        ay += this.rawActiveAxes.get(`${b}Y`) ?? 0
      }
    }

    // Radial deadzone on the analog part, remapped so motion starts at 0 just past it
    const deadzone = action.deadzone ?? 0
    const amag = Math.hypot(ax, ay)
    if (amag <= deadzone) {
      ax = 0
      ay = 0
    } else if (deadzone > 0) {
      const scaled = Math.min(1, (amag - deadzone) / (1 - deadzone))
      ax = (ax / amag) * scaled
      ay = (ay / amag) * scaled
    }

    x += ax
    y += ay
    // Keys-only input is a unit direction (diagonals too); analog keeps its 0..1 length
    const mag = Math.hypot(x, y)
    const keysOnly = digital && ax === 0 && ay === 0
    if (mag > 1 || (keysOnly && mag > 0)) {
      x /= mag
      y /= mag
    }

    // Deltas (mouse look, touch drag) are added after clamping: they are speeds, not positions
    const sensitivity = action.sensitivity ?? 1
    for (const b of action.bindings ?? []) {
      if (DELTA_SOURCES.includes(b)) {
        x += (this.deltaFrame.get(`${b}X`) ?? 0) * DELTA_SCALE * sensitivity
        y += (this.deltaFrame.get(`${b}Y`) ?? 0) * DELTA_SCALE * sensitivity
      }
    }

    return { x, y }
  }

  /** Connect the active layout's buttons to their actions (replaces the previous set) */
  setTouchButtons(buttons: { id: string; action: string; value?: number }[]): void {
    this.touchBindings.clear()
    for (const b of buttons) {
      if (!b.action) continue
      const list = this.touchBindings.get(b.action) ?? []
      list.push({ binding: `Touch/Button/${b.id}`, value: typeof b.value === 'number' && b.value < 0 ? -1 : 1 })
      this.touchBindings.set(b.action, list)
    }
  }

  private computeAxis(action: InputActionDef): number {
    const o = this.overrides.get(action.name)
    if (o !== undefined) return typeof o === 'number' ? Math.max(-1, Math.min(1, o)) : o.x
    let v = 0
    for (const c of (action.composites ?? []) as AxisComposite[]) {
      v += this.maxValue(c.positive) - this.maxValue(c.negative)
    }
    // Direct bindings: analog axes add their value, buttons add 1
    for (const b of action.bindings ?? []) v += this.bindingValue(b)
    for (const t of this.touchBindings.get(action.name) ?? []) {
      if (!action.bindings?.includes(t.binding)) v += t.value * this.bindingValue(t.binding)
    }
    const clamped = Math.max(-1, Math.min(1, v))
    return Math.abs(clamped) <= (action.deadzone ?? 0) ? 0 : clamped
  }

  private buttonStrength(action: InputActionDef): number {
    const o = this.overrides.get(action.name)
    if (o !== undefined) return typeof o === 'number' ? Math.abs(o) : Math.hypot(o.x, o.y)
    let best = this.maxValue(action.bindings)
    for (const c of (action.composites ?? []) as AxisComposite[]) {
      best = Math.max(best, this.maxValue(c.positive), this.maxValue(c.negative))
    }
    for (const t of this.touchBindings.get(action.name) ?? []) best = Math.max(best, this.bindingValue(t.binding))
    return best
  }

  private maxValue(bindings: string[] | undefined): number {
    let best = 0
    for (const b of bindings ?? []) best = Math.max(best, Math.abs(this.bindingValue(b)))
    return best
  }

  /** Current value of one binding: 1/0 for buttons, analog for triggers, magnitude for sticks */
  private bindingValue(binding: string): number {
    if (this.rawActiveBindings.has(binding) || this.tapFrame.has(binding)) return 1
    if (STICK_SOURCES.includes(binding)) {
      return Math.hypot(this.rawActiveAxes.get(`${binding}X`) ?? 0, this.rawActiveAxes.get(`${binding}Y`) ?? 0)
    }
    return this.rawActiveAxes.get(binding) ?? 0
  }

  // ---------- Sources used by touch controls, tests and the gamepad poller ----------

  /** Analog 2D source, e.g. setVirtualAxis('Touch/Joystick', 0.3, 0.8) */
  setVirtualAxis(binding: string, x: number, y: number): void {
    this.rawActiveAxes.set(`${binding}X`, x)
    this.rawActiveAxes.set(`${binding}Y`, y)
    if (binding.startsWith('Touch/') && (x !== 0 || y !== 0)) this.lastDevice = 'touch'
  }

  /** Add a per-frame delta, e.g. addVirtualDelta('Touch/Look', dx, dy) */
  addVirtualDelta(binding: string, dx: number, dy: number): void {
    this.deltaAccum.set(`${binding}X`, (this.deltaAccum.get(`${binding}X`) ?? 0) + dx)
    this.deltaAccum.set(`${binding}Y`, (this.deltaAccum.get(`${binding}Y`) ?? 0) + dy)
    if (binding.startsWith('Touch/')) this.lastDevice = 'touch'
  }

  setVirtualButton(binding: string, down: boolean): void {
    if (down) this.press(binding)
    else this.rawActiveBindings.delete(binding)
    if (down && binding.startsWith('Touch/')) this.lastDevice = 'touch'
  }

  /** Force an action's value (null clears): number for button/axis, {x, y} for vector2 */
  setActionOverride(name: string, value: number | { x: number; y: number } | null): void {
    if (value === null) this.overrides.delete(name)
    else this.overrides.set(name, value)
  }

  clearActionOverrides(): void {
    this.overrides.clear()
  }

  private warnUnregistered(name: string): void {
    if (!this.warnedActions.has(name)) {
      this.warnedActions.add(name)
      console.warn(`[InputManager] Action "${name}" is not registered in Input Actions`)
    }
  }

  private press(binding: string): void {
    this.rawActiveBindings.add(binding)
    this.tapAccum.add(binding)
  }

  // Simulation helpers for tests
  setBindingDown(binding: string): void {
    this.press(binding)
  }

  setBindingUp(binding: string): void {
    this.rawActiveBindings.delete(binding)
  }

  setAxisValue(axis: string, value: number): void {
    this.rawActiveAxes.set(axis, value)
  }

  listenNextInput(callback: (binding: string) => void): void {
    this.listeningCallback = callback
  }

  cancelListen(): void {
    this.listeningCallback = null
  }

  private setupWindowListeners(): void {
    if (typeof window === 'undefined') return

    window.addEventListener('keydown', (e) => {
      // If focused in input/textarea, ignore
      const activeTag = (document.activeElement?.tagName || '').toLowerCase()
      if (activeTag === 'input' || activeTag === 'textarea') return

      const binding = `Keyboard/${e.code || e.key}`
      if (this.listeningCallback) {
        this.listeningCallback(binding)
        this.listeningCallback = null
        e.preventDefault()
        return
      }

      this.lastDevice = 'keyboard'
      if (e.repeat) return
      this.press(binding)
      this.press(`Keyboard/${e.key}`)
    })

    window.addEventListener('keyup', (e) => {
      const binding = `Keyboard/${e.code || e.key}`
      this.rawActiveBindings.delete(binding)
      this.rawActiveBindings.delete(`Keyboard/${e.key}`)
    })

    window.addEventListener('blur', () => this.releaseAll())

    window.addEventListener('mousedown', (e) => {
      const buttonName = e.button === 0 ? 'LeftButton' : e.button === 2 ? 'RightButton' : 'MiddleButton'
      const binding = `Mouse/${buttonName}`
      if (this.listeningCallback) {
        this.listeningCallback(binding)
        this.listeningCallback = null
        return
      }
      // Taps on touch controls must not also count as an Attack click
      if ((e.target as Element | null)?.closest?.('#linden-touch-root')) return
      this.lastDevice = 'keyboard'
      this.press(binding)
    })

    window.addEventListener('mouseup', (e) => {
      const buttonName = e.button === 0 ? 'LeftButton' : e.button === 2 ? 'RightButton' : 'MiddleButton'
      this.rawActiveBindings.delete(`Mouse/${buttonName}`)
    })

    // Mouse look only while the pointer is locked to the game
    window.addEventListener('mousemove', (e) => {
      if (typeof document !== 'undefined' && document.pointerLockElement) {
        this.addVirtualDelta('Mouse/Delta', e.movementX, -e.movementY)
      }
    })
  }

  private pollGamepads(): void {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return
    const gamepads = navigator.getGamepads()
    if (!gamepads) return

    for (const gp of gamepads) {
      if (!gp) continue
      let active = false

      // Standard mapping: https://w3c.github.io/gamepad/#remapping
      GAMEPAD_BUTTONS.forEach((name, i) => {
        const btn = gp.buttons[i]
        const value = btn ? (typeof btn.value === 'number' ? btn.value : btn.pressed ? 1 : 0) : 0
        const key = `Gamepad/${name}`
        if (name === 'LeftTrigger' || name === 'RightTrigger') {
          this.rawActiveAxes.set(key, value >= GAMEPAD_ANALOG_THRESHOLD ? value : 0)
        } else if (btn?.pressed) {
          if (!this.rawActiveBindings.has(key)) this.press(key)
        } else {
          this.rawActiveBindings.delete(key)
        }
        if (value >= 0.5) active = true
      })

      // Sticks (Y up = +1)
      if (gp.axes.length >= 2) {
        this.rawActiveAxes.set('Gamepad/LeftStickX', gp.axes[0])
        this.rawActiveAxes.set('Gamepad/LeftStickY', -gp.axes[1])
        if (Math.hypot(gp.axes[0], gp.axes[1]) > 0.3) active = true
      }
      if (gp.axes.length >= 4) {
        this.rawActiveAxes.set('Gamepad/RightStickX', gp.axes[2])
        this.rawActiveAxes.set('Gamepad/RightStickY', -gp.axes[3])
        if (Math.hypot(gp.axes[2], gp.axes[3]) > 0.3) active = true
      }
      if (active) this.lastDevice = 'gamepad'
    }
  }
}

export const Input = new InputManager()
