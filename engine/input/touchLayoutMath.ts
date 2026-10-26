import type { TouchButtonDef, TouchLayout } from './InputActions'

/**
 * Geometry of on-screen touch controls, shared by the player (real placement), the editor
 * preview and the agent tool, so all three agree on where buttons end up.
 * Coordinates are CSS pixels inside the safe-area box, origin top-left.
 */

export const MIN_TOUCH_TARGET = 44
const BASE_SHORT_SIDE = 390

export interface Viewport {
  width: number
  height: number
}

export interface DevicePreset extends Viewport {
  id: string
  label: string
}

export const DEVICE_PRESETS: DevicePreset[] = [
  { id: 'iphone-se', label: 'iPhone SE', width: 375, height: 667 },
  { id: 'iphone-15', label: 'iPhone 15', width: 393, height: 852 },
  { id: 'pixel-8', label: 'Pixel 8', width: 412, height: 915 },
  { id: 'ipad', label: 'iPad', width: 820, height: 1180 },
]

export function landscape(v: Viewport): Viewport {
  return { width: Math.max(v.width, v.height), height: Math.min(v.width, v.height) }
}

/** Scale factor applied to every logical px (button size/offsets, joystick radius) */
export function touchScale(layout: Pick<TouchLayout, 'scale'>, vp: Viewport): number {
  if (typeof layout.scale === 'number') return layout.scale
  if (layout.scale === 'auto' || layout.scale === undefined) {
    return Math.min(1.5, Math.max(0.8, Math.min(vp.width, vp.height) / BASE_SHORT_SIDE))
  }
  return 1
}

export interface ButtonRect {
  /** Visual circle/square */
  x: number
  y: number
  size: number
  /** Touch area (at least MIN_TOUCH_TARGET), centered on the visual */
  hitX: number
  hitY: number
  hitSize: number
}

export function buttonRect(b: TouchButtonDef, vp: Viewport, scale: number): ButtonRect {
  const size = (b.size ?? 56) * scale
  const percent = b.unit === '%'
  const offX = percent ? ((b.x ?? 0) / 100) * vp.width : (b.x ?? 24) * scale
  const offY = percent ? ((b.y ?? 0) / 100) * vp.height : (b.y ?? 24) * scale
  const anchor = b.anchor ?? 'bottom-right'
  let x: number
  if (anchor.endsWith('left')) x = offX
  else if (anchor.endsWith('right')) x = vp.width - offX - size
  else x = vp.width / 2 - size / 2 + offX // center: x shifts right of the middle
  const y = anchor.startsWith('top') ? offY : vp.height - offY - size
  const hitSize = Math.max(size, MIN_TOUCH_TARGET)
  return { x, y, size, hitX: x - (hitSize - size) / 2, hitY: y - (hitSize - size) / 2, hitSize }
}

/** Where a fixed joystick (or a floating one at rest) sits */
export function joystickRestRect(layout: TouchLayout, vp: Viewport, scale: number): { cx: number; cy: number; radius: number } {
  const radius = layout.joystick.radius * scale
  const margin = 40 * scale
  const cx = layout.joystick.side === 'right' ? vp.width - margin - radius : margin + radius
  return { cx, cy: vp.height - margin - radius, radius }
}

export type LayoutIssueKind = 'overlap' | 'offscreen' | 'small' | 'joystick' | 'vector-action'

export interface LayoutIssue {
  kind: LayoutIssueKind
  severity: 'warning' | 'error'
  buttons: string[]
  device?: string
  message: string
}

function overlapArea(a: ButtonRect, b: ButtonRect): number {
  const w = Math.min(a.x + a.size, b.x + b.size) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.size, b.y + b.size) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/**
 * Layout problems on the given devices (both orientations unless the layout pins one):
 * overlapping or off-screen buttons, touch targets under 44 px, buttons covering the joystick,
 * and buttons wired to vector2 actions (a button has no direction).
 */
export function findLayoutIssues(
  layout: TouchLayout,
  devices: DevicePreset[] = DEVICE_PRESETS,
  actionTypes: Record<string, string> = {}
): LayoutIssue[] {
  const issues: LayoutIssue[] = []
  const seen = new Set<string>()
  const add = (issue: LayoutIssue) => {
    const key = `${issue.kind}:${issue.buttons.join(',')}`
    if (seen.has(key)) return
    seen.add(key)
    issues.push(issue)
  }

  for (const b of layout.buttons) {
    if (actionTypes[b.action] === 'vector2') {
      add({ kind: 'vector-action', severity: 'error', buttons: [b.id], message: `Tombol "${b.id}" memakai action vector2 "${b.action}"; tombol tidak punya arah` })
    }
  }

  const visible = layout.buttons.filter((b) => b.visible !== false)
  for (const device of devices) {
    const orientations = layout.orientation === 'portrait' ? [{ width: Math.min(device.width, device.height), height: Math.max(device.width, device.height) }] : layout.orientation === 'landscape' ? [landscape(device)] : [device, landscape(device)]
    for (const vp of orientations) {
      const scale = touchScale(layout, vp)
      const rects = visible.map((b) => ({ b, r: buttonRect(b, vp, scale) }))
      const where = `${device.label} ${vp.width > vp.height ? 'landscape' : 'portrait'}`
      for (const { b, r } of rects) {
        if (r.x < 0 || r.y < 0 || r.x + r.size > vp.width || r.y + r.size > vp.height) {
          add({ kind: 'offscreen', severity: 'warning', buttons: [b.id], device: where, message: `Tombol "${b.id}" keluar layar di ${where}` })
        }
        if (r.size < MIN_TOUCH_TARGET) {
          add({ kind: 'small', severity: 'warning', buttons: [b.id], device: where, message: `Tombol "${b.id}" lebih kecil dari ${MIN_TOUCH_TARGET} px di ${where} (area sentuh tetap diperbesar)` })
        }
      }
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const area = overlapArea(rects[i].r, rects[j].r)
          const smaller = Math.min(rects[i].r.size, rects[j].r.size) ** 2
          if (area > smaller * 0.1) {
            add({ kind: 'overlap', severity: 'warning', buttons: [rects[i].b.id, rects[j].b.id], device: where, message: `Tombol "${rects[i].b.id}" dan "${rects[j].b.id}" bertumpuk di ${where}` })
          }
        }
      }
      const joy = joystickRestRect(layout, vp, scale)
      const joyRect: ButtonRect = { x: joy.cx - joy.radius, y: joy.cy - joy.radius, size: joy.radius * 2, hitX: 0, hitY: 0, hitSize: 0 }
      for (const { b, r } of rects) {
        // More than 30% of the joystick's circle covered by the button's box
        if (overlapArea(r, joyRect) > 0.3 * Math.PI * joy.radius ** 2) {
          add({ kind: 'joystick', severity: 'warning', buttons: [b.id], device: where, message: `Tombol "${b.id}" menutupi area joystick di ${where}` })
        }
      }
    }
  }
  return issues
}

/** Placement presets for the agent tool: free spots around the bottom-right thumb area */
export const BUTTON_PRESETS: Record<string, Pick<TouchButtonDef, 'anchor' | 'x' | 'y' | 'size'>[]> = {
  primary: [{ anchor: 'bottom-right', x: 24, y: 32, size: 72 }],
  secondary: [
    { anchor: 'bottom-right', x: 112, y: 48, size: 60 },
    { anchor: 'bottom-right', x: 40, y: 120, size: 52 },
    { anchor: 'bottom-right', x: 120, y: 128, size: 52 },
    { anchor: 'bottom-right', x: 190, y: 40, size: 52 },
    { anchor: 'bottom-right', x: 196, y: 112, size: 52 },
  ],
  'top-right': [
    { anchor: 'top-right', x: 16, y: 16, size: 48 },
    { anchor: 'top-right', x: 72, y: 16, size: 48 },
  ],
  'top-left': [
    { anchor: 'top-left', x: 16, y: 16, size: 48 },
    { anchor: 'top-left', x: 72, y: 16, size: 48 },
  ],
}
BUTTON_PRESETS.tertiary = BUTTON_PRESETS.secondary.slice(2)

/** First preset slot that doesn't overlap existing visible buttons on any device */
export function placeButton(layout: TouchLayout, button: TouchButtonDef, preset: string): TouchButtonDef {
  const slots = BUTTON_PRESETS[preset] ?? BUTTON_PRESETS.secondary
  for (const slot of slots) {
    const candidate = { ...button, ...slot, unit: 'px' as const }
    const trial: TouchLayout = { ...layout, buttons: [...layout.buttons.filter((b) => b.id !== button.id), candidate] }
    const clash = findLayoutIssues(trial).some((i) => (i.kind === 'overlap' || i.kind === 'offscreen') && i.buttons.includes(button.id))
    if (!clash) return candidate
  }
  return { ...button, ...slots[slots.length - 1], unit: 'px' }
}
