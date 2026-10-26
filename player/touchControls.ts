/**
 * On-screen controls for touch devices: an analog joystick (Touch/Joystick), a drag-to-look area
 * (Touch/Look) and action buttons described by project.linden.json input.touch. Each button
 * presses Touch/Button/<id>, which Input routes to the button's `action`.
 *
 * Pointer Events with per-pointer tracking give multi-touch (move + jump + look at once) and also
 * work with a mouse, which is how the editor's Game View lets you test them.
 */
import type { InputManager, TouchLayout, TouchButtonDef, TouchConfig } from '../engine/input/InputActions'
import { resolveTouchLayout, touchLayoutNames } from '../engine/input/normalizeActions'
import { buttonRect, joystickRestRect, touchScale } from '../engine/input/touchLayoutMath'
import { builtinIconSvg } from './touchIcons'

export interface TouchControlsConfig {
  container: HTMLElement
  /** Normalized input.touch (see normalizeTouchConfig) */
  config: TouchConfig
  input: InputManager
  /** Layout to start with (defaults to config.initialLayout) */
  layout?: string
  /** URL for "asset:assets/..." icons, relative to the game root */
  resolveAsset?: (path: string) => string
}

/** Should the controls be shown for this config on this device? */
export function shouldShowTouchControls(layout: Pick<TouchLayout, 'enabled'>): boolean {
  if (layout.enabled === 'always') return true
  if (layout.enabled === 'never') return false
  return typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
}

/** Runtime changes made by scripts; reset when the layout or scene changes */
interface ButtonState {
  visible?: boolean
  enabled?: boolean
  label?: string
  icon?: string
  badge?: string | null
}

interface ButtonView {
  def: TouchButtonDef
  hit: HTMLButtonElement
  face: HTMLDivElement
  iconEl: HTMLSpanElement
  labelEl: HTMLSpanElement
  badgeEl: HTMLSpanElement
  cooldownEl: HTMLDivElement
}

const DEFAULT_COLOR = 'rgba(15,23,42,.45)'
const DEFAULT_PRESSED = 'rgba(59,130,246,.8)'

export class TouchControls {
  private root: HTMLDivElement
  private stage: HTMLDivElement
  private base!: HTMLDivElement
  private knob!: HTMLDivElement
  private layoutName: string
  private layout: TouchLayout
  private views = new Map<string, ButtonView>()
  private state = new Map<string, ButtonState>()
  private cooldownUntil = new Map<string, { start: number; end: number }>()
  private toggled = new Set<string>()
  private repeatTimers = new Map<string, ReturnType<typeof setInterval>>()
  private joystickPointer: number | null = null
  private joystickOrigin = { x: 0, y: 0 }
  private lookPointer: number | null = null
  private lookLast = { x: 0, y: 0 }
  private buttonPointers = new Map<number, string>()
  private cleanup: (() => void)[] = []
  private layoutCleanup: (() => void)[] = []
  private cooldownFrame = 0
  private scale = 1

  constructor(private opts: TouchControlsConfig) {
    this.layoutName = opts.layout ?? opts.config.initialLayout ?? 'default'
    this.layout = resolveTouchLayout(opts.config, this.layoutName)

    this.root = document.createElement('div')
    this.root.id = 'linden-touch-root'
    this.root.style.cssText = `
      position: absolute; inset: 0; z-index: 20; pointer-events: none;
      user-select: none; -webkit-user-select: none; touch-action: none; overflow: hidden;
    `
    // The stage is the safe area; all geometry is computed inside it
    this.stage = document.createElement('div')
    this.root.appendChild(this.stage)
    opts.container.appendChild(this.root)

    this.listen(window, 'pointermove', (e) => this.onPointerMove(e as PointerEvent))
    this.listen(window, 'pointerup', (e) => this.onPointerEnd(e as PointerEvent))
    this.listen(window, 'pointercancel', (e) => this.onPointerEnd(e as PointerEvent))
    this.listen(window, 'blur', () => this.resetAll())
    this.listen(window, 'resize', () => this.positionAll())

    this.applyLayout()
  }

  // ---------------- public API (wrapped by TouchApi) ----------------

  get activeLayout(): string {
    return this.layoutName
  }

  get layoutNames(): string[] {
    return touchLayoutNames(this.opts.config)
  }

  setLayout(name: string): boolean {
    if (!this.layoutNames.includes(name)) return false
    this.layoutName = name
    this.layout = resolveTouchLayout(this.opts.config, name)
    this.state.clear()
    this.applyLayout()
    return true
  }

  buttonsFor(action: string): string[] {
    return this.layout.buttons.filter((b) => b.action === action).map((b) => b.id)
  }

  hasButton(id: string): boolean {
    return this.views.has(id)
  }

  patch(id: string, change: ButtonState): boolean {
    const view = this.views.get(id)
    if (!view) return false
    this.state.set(id, { ...this.state.get(id), ...change })
    if (change.visible === false || change.enabled === false) this.release(id)
    this.renderButton(view)
    return true
  }

  setCooldown(id: string, seconds: number): boolean {
    const view = this.views.get(id)
    if (!view) return false
    if (seconds <= 0) this.cooldownUntil.delete(id)
    else {
      const now = performance.now()
      this.cooldownUntil.set(id, { start: now, end: now + seconds * 1000 })
      this.release(id)
      this.tickCooldowns()
    }
    this.renderButton(view)
    return true
  }

  /** Release everything (focus loss, scene switch) so nothing stays pressed */
  resetAll(): void {
    this.joystickPointer = null
    this.lookPointer = null
    this.buttonPointers.clear()
    this.opts.input.setVirtualAxis('Touch/Joystick', 0, 0)
    for (const id of this.views.keys()) this.release(id)
    this.toggled.clear()
    this.views.forEach((v) => this.renderButton(v))
    if (this.base) this.placeBaseAtRest()
  }

  /** Back to the layout's initial button states (called on scene change) */
  resetState(): void {
    this.state.clear()
    this.cooldownUntil.clear()
    this.resetAll()
  }

  destroy(): void {
    this.resetAll()
    cancelAnimationFrame(this.cooldownFrame)
    this.layoutCleanup.forEach((fn) => fn())
    this.cleanup.forEach((fn) => fn())
    this.cleanup = []
    this.opts.input.setTouchButtons([])
    this.root.remove()
  }

  // ---------------- layout ----------------

  private listen(target: EventTarget, type: string, fn: (e: Event) => void, bucket = this.cleanup): void {
    target.addEventListener(type, fn, { passive: false })
    bucket.push(() => target.removeEventListener(type, fn))
  }

  private applyLayout(): void {
    this.resetAll()
    this.layoutCleanup.forEach((fn) => fn())
    this.layoutCleanup = []
    this.views.clear()
    this.stage.replaceChildren()
    const layout = this.layout
    this.opts.input.setTouchButtons(layout.buttons)

    const inset = (side: string) => (layout.safeArea ? `env(safe-area-inset-${side}, 0px)` : '0px')
    this.stage.style.cssText = `position:absolute; top:${inset('top')}; right:${inset('right')}; bottom:${inset('bottom')}; left:${inset('left')}; pointer-events:none;`

    // Joystick zone: the left (or right) half; floating sticks appear where the thumb lands
    const side = layout.joystick.side === 'right' ? 'right' : 'left'
    const zone = document.createElement('div')
    zone.dataset.lindenTouch = 'joystick-zone'
    zone.style.cssText = `position:absolute; top:0; bottom:0; ${side}:0; width:50%; pointer-events:auto; touch-action:none;`
    this.stage.appendChild(zone)
    this.listen(zone, 'pointerdown', (e) => this.onJoystickDown(e as PointerEvent), this.layoutCleanup)

    if (layout.look.enabled) {
      const look = document.createElement('div')
      look.dataset.lindenTouch = 'look-zone'
      look.style.cssText = `position:absolute; top:0; bottom:0; ${side === 'left' ? 'right' : 'left'}:0; width:50%; pointer-events:auto; touch-action:none;`
      this.stage.appendChild(look)
      this.listen(look, 'pointerdown', (e) => this.onLookDown(e as PointerEvent), this.layoutCleanup)
    }

    this.base = document.createElement('div')
    this.knob = document.createElement('div')
    this.base.appendChild(this.knob)
    this.stage.appendChild(this.base)

    for (const def of layout.buttons) this.createButton(def)
    if (layout.orientation) this.mountOrientationHint(layout.orientation)
    this.positionAll()
    // Sizes are known only after layout; place again on the next frame
    requestAnimationFrame(() => this.positionAll())
  }

  private viewport(): { width: number; height: number } {
    const width = this.stage.clientWidth || this.opts.container.clientWidth || window.innerWidth
    const height = this.stage.clientHeight || this.opts.container.clientHeight || window.innerHeight
    return { width, height }
  }

  private positionAll(): void {
    const vp = this.viewport()
    this.scale = touchScale(this.layout, vp)
    const r = this.layout.joystick.radius * this.scale
    this.base.style.cssText = `
      position:absolute; width:${r * 2}px; height:${r * 2}px; margin:${-r}px 0 0 ${-r}px; border-radius:50%;
      background: rgba(255,255,255,0.12); border: 2px solid rgba(255,255,255,0.35);
      pointer-events:none; transition: opacity .15s;
    `
    const k = Math.round(r * 0.9)
    this.knob.style.cssText = `
      position:absolute; left:50%; top:50%; width:${k}px; height:${k}px; margin:${-k / 2}px 0 0 ${-k / 2}px;
      border-radius:50%; background: rgba(255,255,255,0.55); box-shadow: 0 2px 8px rgba(0,0,0,.35);
    `
    if (this.joystickPointer === null) this.placeBaseAtRest()
    for (const view of this.views.values()) {
      const rect = buttonRect(view.def, vp, this.scale)
      Object.assign(view.hit.style, { left: `${rect.hitX}px`, top: `${rect.hitY}px`, width: `${rect.hitSize}px`, height: `${rect.hitSize}px` })
      Object.assign(view.face.style, { width: `${rect.size}px`, height: `${rect.size}px` })
      view.iconEl.style.fontSize = `${Math.round(rect.size * 0.38)}px`
      view.labelEl.style.fontSize = `${Math.max(9, Math.round(rect.size * 0.17))}px`
      this.renderButton(view)
    }
  }

  private placeBaseAtRest(): void {
    const vp = this.viewport()
    const rest = joystickRestRect(this.layout, vp, this.scale)
    this.base.style.left = `${rest.cx}px`
    this.base.style.top = `${rest.cy}px`
    this.base.style.opacity = String(this.layout.joystick.mode === 'fixed' ? this.layout.opacity : this.layout.opacity * 0.5)
    this.knob.style.transform = 'translate(0px, 0px)'
  }

  // ---------------- joystick & look ----------------

  private onJoystickDown(e: PointerEvent): void {
    if (this.joystickPointer !== null) return
    e.preventDefault()
    this.joystickPointer = e.pointerId
    const stageRect = this.stage.getBoundingClientRect()
    if (this.layout.joystick.mode === 'floating') {
      this.joystickOrigin = { x: e.clientX, y: e.clientY }
      this.base.style.left = `${e.clientX - stageRect.left}px`
      this.base.style.top = `${e.clientY - stageRect.top}px`
    } else {
      const b = this.base.getBoundingClientRect()
      this.joystickOrigin = { x: b.left + b.width / 2, y: b.top + b.height / 2 }
    }
    this.base.style.opacity = '1'
    this.updateJoystick(e.clientX, e.clientY)
  }

  private updateJoystick(clientX: number, clientY: number): void {
    const r = this.layout.joystick.radius * this.scale
    let dx = clientX - this.joystickOrigin.x
    let dy = clientY - this.joystickOrigin.y
    const len = Math.hypot(dx, dy)
    if (len > r) {
      dx = (dx / len) * r
      dy = (dy / len) * r
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`
    // Screen Y grows downwards; Move.y is +1 for "forward/up"
    this.opts.input.setVirtualAxis('Touch/Joystick', dx / r, -dy / r)
  }

  private onLookDown(e: PointerEvent): void {
    if (this.lookPointer !== null) return
    e.preventDefault()
    this.lookPointer = e.pointerId
    this.lookLast = { x: e.clientX, y: e.clientY }
  }

  private onPointerMove(e: PointerEvent): void {
    if (e.pointerId === this.joystickPointer) {
      e.preventDefault()
      this.updateJoystick(e.clientX, e.clientY)
    } else if (e.pointerId === this.lookPointer) {
      e.preventDefault()
      const s = this.layout.look.sensitivity ?? 1
      this.opts.input.addVirtualDelta('Touch/Look', (e.clientX - this.lookLast.x) * s, -(e.clientY - this.lookLast.y) * s)
      this.lookLast = { x: e.clientX, y: e.clientY }
    }
  }

  private onPointerEnd(e: PointerEvent): void {
    if (e.pointerId === this.joystickPointer) {
      this.joystickPointer = null
      this.opts.input.setVirtualAxis('Touch/Joystick', 0, 0)
      this.placeBaseAtRest()
    }
    if (e.pointerId === this.lookPointer) this.lookPointer = null
    const id = this.buttonPointers.get(e.pointerId)
    if (id) {
      this.buttonPointers.delete(e.pointerId)
      // Another finger may still hold the same button
      if (![...this.buttonPointers.values()].includes(id)) this.onButtonUp(id)
    }
  }

  // ---------------- buttons ----------------

  private createButton(def: TouchButtonDef): void {
    const hit = document.createElement('button')
    hit.type = 'button'
    hit.dataset.lindenTouch = `button:${def.id}`
    hit.setAttribute('aria-label', def.label || def.action || def.id)
    hit.style.cssText = `
      position:absolute; padding:0; margin:0; border:0; background:transparent; pointer-events:auto; touch-action:none;
      display:flex; align-items:center; justify-content:center; -webkit-tap-highlight-color: transparent;
    `
    const face = document.createElement('div')
    const radius = def.shape === 'square' ? '8%' : def.shape === 'rounded' ? '28%' : '50%'
    face.style.cssText = `
      position:relative; box-sizing:border-box; border-radius:${radius}; border:2px solid rgba(255,255,255,.4);
      display:flex; flex-direction:column; align-items:center; justify-content:center; overflow:hidden;
      font-weight:700; font-family: system-ui, sans-serif; backdrop-filter: blur(4px);
      transition: transform .06s, background-color .08s, opacity .15s;
    `
    const iconEl = document.createElement('span')
    iconEl.style.cssText = 'display:flex; line-height:1; pointer-events:none;'
    const labelEl = document.createElement('span')
    labelEl.style.cssText = 'display:block; letter-spacing:.04em; pointer-events:none; white-space:nowrap;'
    const cooldownEl = document.createElement('div')
    cooldownEl.style.cssText = 'position:absolute; inset:0; display:none; align-items:center; justify-content:center; color:#fff; font-size:12px; pointer-events:none;'
    const badgeEl = document.createElement('span')
    badgeEl.style.cssText = `
      position:absolute; top:-4px; right:-4px; min-width:18px; height:18px; padding:0 4px; border-radius:9px;
      background:#f59e0b; color:#111827; font:700 11px/18px system-ui, sans-serif; text-align:center; display:none; pointer-events:none;
    `
    face.append(iconEl, labelEl, cooldownEl)
    hit.append(face, badgeEl)

    const view: ButtonView = { def, hit, face, iconEl, labelEl, badgeEl, cooldownEl }
    this.views.set(def.id, view)
    this.stage.appendChild(hit)

    this.listen(
      hit,
      'pointerdown',
      (e) => {
        const pe = e as PointerEvent
        pe.preventDefault()
        pe.stopPropagation()
        this.buttonPointers.set(pe.pointerId, def.id)
        this.onButtonDown(def.id)
      },
      this.layoutCleanup
    )
    this.listen(hit, 'contextmenu', (e) => e.preventDefault(), this.layoutCleanup)
    this.renderButton(view)
  }

  private binding(id: string): string {
    return `Touch/Button/${id}`
  }

  private isUsable(id: string): boolean {
    const view = this.views.get(id)
    if (!view) return false
    const st = this.state.get(id) ?? {}
    const visible = st.visible ?? view.def.visible !== false
    const enabled = st.enabled ?? view.def.enabled !== false
    return visible && enabled && !this.isCooling(id)
  }

  private isCooling(id: string): boolean {
    const cd = this.cooldownUntil.get(id)
    return !!cd && performance.now() < cd.end
  }

  /** One-frame press: Input's tap latch keeps it for exactly one update() */
  private pulse(id: string): void {
    this.opts.input.setVirtualButton(this.binding(id), true)
    this.opts.input.setVirtualButton(this.binding(id), false)
  }

  private fired(id: string): void {
    const view = this.views.get(id)
    if (view?.def.cooldown) this.setCooldown(id, view.def.cooldown)
  }

  private onButtonDown(id: string): void {
    const view = this.views.get(id)
    if (!view || !this.isUsable(id)) return
    const behavior = view.def.behavior ?? 'hold'
    if (behavior === 'tap') {
      this.pulse(id)
      this.flash(view)
      this.fired(id)
    } else if (behavior === 'toggle') {
      const on = !this.toggled.has(id)
      if (on) this.toggled.add(id)
      else this.toggled.delete(id)
      this.opts.input.setVirtualButton(this.binding(id), on)
      if (on) this.fired(id)
    } else if (behavior === 'repeat') {
      this.pulse(id)
      this.fired(id)
      const every = (view.def.repeatInterval ?? 0.15) * 1000
      this.repeatTimers.set(
        id,
        setInterval(() => {
          if (this.isUsable(id)) {
            this.pulse(id)
            this.fired(id)
          }
        }, every)
      )
    } else {
      this.opts.input.setVirtualButton(this.binding(id), true)
      this.fired(id)
    }
    this.renderButton(view, true)
  }

  private onButtonUp(id: string): void {
    const view = this.views.get(id)
    if (!view) return
    const behavior = view.def.behavior ?? 'hold'
    if (behavior === 'hold') this.opts.input.setVirtualButton(this.binding(id), false)
    if (behavior === 'repeat') this.clearRepeat(id)
    this.renderButton(view)
  }

  private clearRepeat(id: string): void {
    const t = this.repeatTimers.get(id)
    if (t) clearInterval(t)
    this.repeatTimers.delete(id)
  }

  /** Stop any ongoing press of a button (hidden, disabled, cooling down, layout change) */
  private release(id: string): void {
    this.clearRepeat(id)
    this.toggled.delete(id)
    this.opts.input.setVirtualButton(this.binding(id), false)
    for (const [pointer, bid] of this.buttonPointers) if (bid === id) this.buttonPointers.delete(pointer)
  }

  private flash(view: ButtonView): void {
    view.face.style.transform = 'scale(0.92)'
    view.face.style.backgroundColor = view.def.pressedColor ?? DEFAULT_PRESSED
    setTimeout(() => this.renderButton(view), 120)
  }

  private renderButton(view: ButtonView, pressed?: boolean): void {
    const { def } = view
    const st = this.state.get(def.id) ?? {}
    const visible = st.visible ?? def.visible !== false
    const enabled = st.enabled ?? def.enabled !== false
    const behavior = def.behavior ?? 'hold'
    const held =
      pressed ?? ((behavior === 'toggle' && this.toggled.has(def.id)) || [...this.buttonPointers.values()].includes(def.id))
    view.hit.style.display = visible ? 'flex' : 'none'
    view.face.style.opacity = String((def.opacity ?? this.layout.opacity) * (enabled ? 1 : 0.4))
    view.face.style.color = def.textColor ?? '#fff'
    view.face.style.backgroundColor = held && behavior !== 'tap' ? def.pressedColor ?? DEFAULT_PRESSED : def.color ?? DEFAULT_COLOR
    view.face.style.transform = held && behavior !== 'tap' ? 'scale(0.94)' : ''

    const icon = st.icon ?? def.icon
    const faceSize = parseFloat(view.face.style.width) || (def.size ?? 56)
    if (icon?.startsWith('asset:')) {
      const url = this.opts.resolveAsset?.(icon.slice('asset:'.length)) ?? icon.slice('asset:'.length)
      if (view.iconEl.dataset.src !== url) {
        const img = document.createElement('img')
        img.src = url
        img.alt = ''
        img.draggable = false
        img.style.cssText = `width:${Math.round(faceSize * 0.5)}px; height:${Math.round(faceSize * 0.5)}px; object-fit:contain; pointer-events:none;`
        view.iconEl.replaceChildren(img)
        view.iconEl.dataset.src = url
      }
    } else {
      const svg = icon ? builtinIconSvg(icon, Math.round(faceSize * 0.38)) : null
      const key = `${icon}:${Math.round(faceSize)}`
      if (view.iconEl.dataset.src !== key) {
        view.iconEl.innerHTML = svg ?? ''
        view.iconEl.dataset.src = key
      }
    }
    view.labelEl.textContent = st.label ?? def.label ?? ''
    view.labelEl.style.display = view.labelEl.textContent ? 'block' : 'none'

    const badge = st.badge
    view.badgeEl.style.display = badge === undefined || badge === null || badge === '' ? 'none' : 'block'
    view.badgeEl.textContent = badge === undefined || badge === null ? '' : String(badge)
    this.renderCooldown(view)
  }

  private renderCooldown(view: ButtonView): void {
    const cd = this.cooldownUntil.get(view.def.id)
    const now = performance.now()
    if (!cd || now >= cd.end) {
      view.cooldownEl.style.display = 'none'
      return
    }
    const done = (now - cd.start) / (cd.end - cd.start)
    view.cooldownEl.style.display = 'flex'
    view.cooldownEl.style.background = `conic-gradient(transparent ${done * 360}deg, rgba(2,6,23,.6) 0deg)`
    view.cooldownEl.textContent = ((cd.end - now) / 1000).toFixed(1)
  }

  private tickCooldowns = (): void => {
    cancelAnimationFrame(this.cooldownFrame)
    let active = false
    for (const [id, cd] of this.cooldownUntil) {
      const view = this.views.get(id)
      if (view) this.renderCooldown(view)
      if (performance.now() < cd.end) active = true
      else this.cooldownUntil.delete(id)
    }
    if (active) this.cooldownFrame = requestAnimationFrame(this.tickCooldowns)
  }

  private mountOrientationHint(orientation: 'landscape' | 'portrait'): void {
    const hint = document.createElement('div')
    hint.textContent = orientation === 'landscape' ? 'Putar perangkat ke mode landscape' : 'Putar perangkat ke mode portrait'
    hint.style.cssText =
      'position:absolute; inset:0; display:none; align-items:center; justify-content:center; background:rgba(2,6,23,.85); color:#fff; font:600 16px system-ui; pointer-events:auto; z-index:5;'
    this.stage.appendChild(hint)
    const check = () => {
      const isLandscape = window.innerWidth >= window.innerHeight
      hint.style.display = (orientation === 'landscape') !== isLandscape ? 'flex' : 'none'
    }
    check()
    this.listen(window, 'resize', check, this.layoutCleanup)
  }
}
