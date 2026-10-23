export interface InputActionBindingComposite {
  up?: string
  down?: string
  left?: string
  right?: string
}

export interface InputActionDef {
  name: string
  type: 'button' | 'axis' | 'vector2'
  bindings?: string[]
  composite?: InputActionBindingComposite
  deadzone?: number
}

export class InputManager {
  private actions: Map<string, InputActionDef> = new Map()
  private rawActiveBindings: Set<string> = new Set() // Set of currently active binding strings e.g. "Keyboard/Space"
  private rawActiveAxes: Map<string, number> = new Map() // Binding -> raw value

  // Per-action state
  private pressedActions: Set<string> = new Set()
  private prevPressedActions: Set<string> = new Set()
  private justPressedActions: Set<string> = new Set()
  private justReleasedActions: Set<string> = new Set()
  private warnedActions: Set<string> = new Set()

  private listeningCallback: ((binding: string) => void) | null = null

  constructor() {
    this.registerDefaultActions()
    this.setupWindowListeners()
  }

  registerDefaultActions(): void {
    this.registerAction({
      name: 'Jump',
      type: 'button',
      bindings: ['Keyboard/Space', 'Gamepad/ButtonSouth'],
    })

    this.registerAction({
      name: 'Move',
      type: 'vector2',
      composite: {
        up: 'Keyboard/KeyW',
        down: 'Keyboard/KeyS',
        left: 'Keyboard/KeyA',
        right: 'Keyboard/KeyD',
      },
      bindings: ['Gamepad/LeftStick'],
      deadzone: 0.2,
    })
  }

  registerAction(action: InputActionDef): void {
    this.actions.set(action.name, action)
  }

  getActions(): InputActionDef[] {
    return Array.from(this.actions.values())
  }

  loadActions(actions: InputActionDef[]): void {
    this.actions.clear()
    for (const a of actions) {
      this.registerAction(a)
    }
  }

  /**
   * Called once per frame update to compute "just pressed" and "just released" states
   */
  update(): void {
    this.justPressedActions.clear()
    this.justReleasedActions.clear()

    // Query Gamepad API if available
    this.pollGamepads()

    for (const [name, action] of this.actions.entries()) {
      let isPressed = false

      if (action.type === 'button') {
        if (action.bindings) {
          for (const b of action.bindings) {
            if (this.rawActiveBindings.has(b)) {
              isPressed = true
              break
            }
          }
        }
      } else if (action.type === 'vector2') {
        const v = this.getVector(name)
        if (Math.hypot(v.x, v.y) > 0.001) {
          isPressed = true
        }
      } else if (action.type === 'axis') {
        const a = this.getAxisRaw(action)
        if (Math.abs(a) > 0.001) {
          isPressed = true
        }
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

  getVector(name: string): { x: number; y: number } {
    const action = this.actions.get(name)
    if (!action) {
      this.warnUnregistered(name)
      return { x: 0, y: 0 }
    }

    let x = 0
    let y = 0

    // Keyboard composite
    if (action.composite) {
      const up = action.composite.up ? this.isBindingActive(action.composite.up) : false
      const down = action.composite.down ? this.isBindingActive(action.composite.down) : false
      const left = action.composite.left ? this.isBindingActive(action.composite.left) : false
      const right = action.composite.right ? this.isBindingActive(action.composite.right) : false

      if (right) x += 1
      if (left) x -= 1
      if (up) y += 1
      if (down) y -= 1
    }

    // Gamepad left stick binding
    if (action.bindings?.includes('Gamepad/LeftStick')) {
      const stickX = this.rawActiveAxes.get('Gamepad/LeftStickX') ?? 0
      const stickY = this.rawActiveAxes.get('Gamepad/LeftStickY') ?? 0
      x += stickX
      y += stickY
    }

    // Apply deadzone
    const deadzone = action.deadzone ?? 0
    const mag = Math.hypot(x, y)
    if (mag <= deadzone) {
      return { x: 0, y: 0 }
    }

    // Normalize if length > 1
    if (mag > 1) {
      return { x: x / mag, y: y / mag }
    }

    return { x, y }
  }

  getAxis(negativeAction: string, positiveAction: string): number {
    const neg = this.isActionPressed(negativeAction) ? 1 : 0
    const pos = this.isActionPressed(positiveAction) ? 1 : 0
    return pos - neg
  }

  private getAxisRaw(action: InputActionDef): number {
    let val = 0
    if (action.bindings) {
      for (const b of action.bindings) {
        if (this.rawActiveAxes.has(b)) {
          val += this.rawActiveAxes.get(b)!
        } else if (this.rawActiveBindings.has(b)) {
          val += 1
        }
      }
    }
    return val
  }

  private isBindingActive(binding: string): boolean {
    if (this.rawActiveBindings.has(binding)) return true

    // Check alias e.g. "Keyboard/W" vs "Keyboard/KeyW"
    if (binding === 'Keyboard/W' && this.rawActiveBindings.has('Keyboard/KeyW')) return true
    if (binding === 'Keyboard/KeyW' && this.rawActiveBindings.has('Keyboard/W')) return true
    if (binding === 'Keyboard/S' && this.rawActiveBindings.has('Keyboard/KeyS')) return true
    if (binding === 'Keyboard/KeyS' && this.rawActiveBindings.has('Keyboard/S')) return true
    if (binding === 'Keyboard/A' && this.rawActiveBindings.has('Keyboard/KeyA')) return true
    if (binding === 'Keyboard/KeyA' && this.rawActiveBindings.has('Keyboard/A')) return true
    if (binding === 'Keyboard/D' && this.rawActiveBindings.has('Keyboard/KeyD')) return true
    if (binding === 'Keyboard/KeyD' && this.rawActiveBindings.has('Keyboard/D')) return true

    return false
  }

  private warnUnregistered(name: string): void {
    if (!this.warnedActions.has(name)) {
      this.warnedActions.add(name)
      console.warn(`[InputManager] Action "${name}" is not registered in Input Actions`)
    }
  }

  // Simulation helpers for tests
  setBindingDown(binding: string): void {
    this.rawActiveBindings.add(binding)
    // Alias check
    if (binding === 'Keyboard/Space') {
      this.rawActiveBindings.add('Space')
    }
  }

  setBindingUp(binding: string): void {
    this.rawActiveBindings.delete(binding)
    if (binding === 'Keyboard/Space') {
      this.rawActiveBindings.delete('Space')
    }
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

      this.rawActiveBindings.add(binding)
      this.rawActiveBindings.add(`Keyboard/${e.key}`)
    })

    window.addEventListener('keyup', (e) => {
      const binding = `Keyboard/${e.code || e.key}`
      this.rawActiveBindings.delete(binding)
      this.rawActiveBindings.delete(`Keyboard/${e.key}`)
    })

    window.addEventListener('mousedown', (e) => {
      const buttonName = e.button === 0 ? 'LeftButton' : e.button === 2 ? 'RightButton' : 'MiddleButton'
      const binding = `Mouse/${buttonName}`
      if (this.listeningCallback) {
        this.listeningCallback(binding)
        this.listeningCallback = null
        return
      }
      this.rawActiveBindings.add(binding)
    })

    window.addEventListener('mouseup', (e) => {
      const buttonName = e.button === 0 ? 'LeftButton' : e.button === 2 ? 'RightButton' : 'MiddleButton'
      this.rawActiveBindings.delete(`Mouse/${buttonName}`)
    })
  }

  private pollGamepads(): void {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return
    const gamepads = navigator.getGamepads()
    if (!gamepads) return

    for (const gp of gamepads) {
      if (!gp) continue

      // Standard buttons mapping: 0=A/South, 1=B/East, 2=X/West, 3=Y/North
      if (gp.buttons[0]?.pressed) {
        this.rawActiveBindings.add('Gamepad/ButtonSouth')
      } else {
        this.rawActiveBindings.delete('Gamepad/ButtonSouth')
      }

      // Left stick
      if (gp.axes.length >= 2) {
        this.rawActiveAxes.set('Gamepad/LeftStickX', gp.axes[0])
        this.rawActiveAxes.set('Gamepad/LeftStickY', -gp.axes[1])
      }
    }
  }
}

export const Input = new InputManager()
