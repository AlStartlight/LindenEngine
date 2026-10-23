/**
 * Godot-like InputMap system (GF-12)
 * Maps named actions to keyboard keys, mouse buttons, and gamepad buttons.
 */

export interface InputBinding {
  type: 'key' | 'mouse' | 'gamepad'
  code: string | number
  strength?: number
}

export class InputMap {
  private static actions: Map<string, InputBinding[]> = new Map()
  private static pressedStates: Map<string, boolean> = new Map()
  private static justPressedStates: Map<string, boolean> = new Map()

  static addAction(action: string): void {
    if (!this.actions.has(action)) {
      this.actions.set(action, [])
    }
  }

  static actionAddEvent(action: string, binding: InputBinding): void {
    this.addAction(action)
    this.actions.get(action)!.push(binding)
  }

  static isActionPressed(action: string): boolean {
    const bindings = this.actions.get(action)
    if (!bindings) return false
    for (const b of bindings) {
      if (this.pressedStates.get(`${b.type}:${b.code}`)) {
        return true
      }
    }
    return false
  }

  static is_action_pressed(action: string): boolean {
    return this.isActionPressed(action)
  }

  static isActionJustPressed(action: string): boolean {
    const bindings = this.actions.get(action)
    if (!bindings) return false
    for (const b of bindings) {
      if (this.justPressedStates.get(`${b.type}:${b.code}`)) {
        return true
      }
    }
    return false
  }

  static is_action_just_pressed(action: string): boolean {
    return this.isActionJustPressed(action)
  }

  static getActionStrength(action: string): number {
    return this.isActionPressed(action) ? 1.0 : 0.0
  }

  // Internal test / driver hooks
  static setPressed(type: 'key' | 'mouse' | 'gamepad', code: string | number, pressed: boolean): void {
    const key = `${type}:${code}`
    const wasPressed = this.pressedStates.get(key) || false
    this.pressedStates.set(key, pressed)
    if (pressed && !wasPressed) {
      this.justPressedStates.set(key, true)
    } else {
      this.justPressedStates.set(key, false)
    }
  }

  static clear(): void {
    this.actions.clear()
    this.pressedStates.clear()
    this.justPressedStates.clear()
  }
}
