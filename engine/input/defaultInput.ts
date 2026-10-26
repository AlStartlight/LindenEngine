import type { InputActionDef, TouchConfig } from './InputActions'

/**
 * Default control map for Linden games (spec: SPEC-Character-Movement-Input-Controls §1).
 * Q/E drive both Turn and Vertical; CharacterMovement.qeMode decides which one it reads.
 */
export const DEFAULT_INPUT_ACTIONS: InputActionDef[] = [
  {
    name: 'Move',
    type: 'vector2',
    composites: [
      { up: ['Keyboard/KeyW'], down: ['Keyboard/KeyS'], left: ['Keyboard/KeyA'], right: ['Keyboard/KeyD'] },
      { up: ['Keyboard/ArrowUp'], down: ['Keyboard/ArrowDown'], left: ['Keyboard/ArrowLeft'], right: ['Keyboard/ArrowRight'] },
    ],
    bindings: ['Gamepad/LeftStick', 'Touch/Joystick'],
    deadzone: 0.15,
  },
  {
    name: 'Turn',
    type: 'axis',
    composites: [
      {
        negative: ['Keyboard/KeyQ', 'Gamepad/LeftShoulder'],
        positive: ['Keyboard/KeyE', 'Gamepad/RightShoulder'],
      },
    ],
  },
  {
    name: 'Vertical',
    type: 'axis',
    composites: [
      {
        negative: ['Keyboard/KeyQ', 'Gamepad/LeftTrigger'],
        positive: ['Keyboard/KeyE', 'Gamepad/RightTrigger'],
      },
    ],
  },
  {
    name: 'Look',
    type: 'vector2',
    bindings: ['Mouse/Delta', 'Gamepad/RightStick', 'Touch/Look'],
    deadzone: 0.15,
    sensitivity: 1,
  },
  { name: 'Jump', type: 'button', bindings: ['Keyboard/Space', 'Gamepad/ButtonSouth'] },
  {
    name: 'Sprint',
    type: 'button',
    bindings: ['Keyboard/ShiftLeft', 'Gamepad/LeftStickPress', 'Touch/Joystick'],
    pressThreshold: 0.9,
  },
  { name: 'Crouch', type: 'button', bindings: ['Keyboard/KeyC', 'Keyboard/ControlLeft', 'Gamepad/ButtonEast'] },
  { name: 'Interact', type: 'button', bindings: ['Keyboard/KeyF', 'Gamepad/ButtonWest'] },
  {
    name: 'Attack',
    type: 'button',
    bindings: ['Mouse/LeftButton', 'Gamepad/ButtonNorth', 'Gamepad/RightTrigger'],
  },
]

/** Touch buttons connect to actions through `action` (spec SPEC-Mobile-Action-Buttons-Custom) */
export const DEFAULT_TOUCH_LAYOUT: TouchConfig = {
  enabled: 'auto',
  scale: 'auto',
  joystick: { side: 'left', mode: 'floating', radius: 64 },
  look: { enabled: true, area: 'right-half', sensitivity: 1 },
  buttons: [
    { id: 'Jump', action: 'Jump', label: 'JUMP', icon: 'jump', behavior: 'hold', anchor: 'bottom-right', x: 24, y: 32, size: 72 },
    { id: 'Attack', action: 'Attack', label: 'ATK', icon: 'attack', behavior: 'tap', anchor: 'bottom-right', x: 112, y: 48, size: 60 },
    { id: 'Sprint', action: 'Sprint', label: 'RUN', icon: 'run', behavior: 'hold', anchor: 'bottom-right', x: 40, y: 120, size: 52 },
    { id: 'Interact', action: 'Interact', label: 'USE', icon: 'use', behavior: 'tap', anchor: 'bottom-right', x: 120, y: 128, size: 52 },
    { id: 'TurnLeft', action: 'Turn', value: -1, label: 'Q', icon: 'turn-left', anchor: 'bottom-left', x: 24, y: 190, size: 44 },
    { id: 'TurnRight', action: 'Turn', value: 1, label: 'E', icon: 'turn-right', anchor: 'bottom-left', x: 80, y: 190, size: 44 },
  ],
  opacity: 0.6,
  safeArea: true,
}

export function cloneDefaultActions(): InputActionDef[] {
  return JSON.parse(JSON.stringify(DEFAULT_INPUT_ACTIONS))
}

export function cloneDefaultTouch(): TouchConfig {
  return JSON.parse(JSON.stringify(DEFAULT_TOUCH_LAYOUT))
}
