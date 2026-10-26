import type { InputActionDef, Vector2Composite, AxisComposite, TouchLayout, TouchConfig, TouchButtonDef } from './InputActions'
import { cloneDefaultActions, cloneDefaultTouch } from './defaultInput'

/**
 * Input Actions have existed in three shapes in this repo; everything that loads actions
 * (editor, Play, linden_play, web build, HTML Game bridge, agent tool) goes through here.
 *
 *  1. current: { name, type, bindings: string[], composites?: [...] }
 *  2. legacy runtime: { composite: { up: 'Keyboard/KeyW', ... } } (single key per direction)
 *  3. old agent tool: { name, keys: ['W', 'ArrowUp'] }
 *  4. old agent test: { bindings: [{ device: 'keyboard', path: 'KeyF' }] }
 */

export interface NormalizeResult {
  actions: InputActionDef[]
  warnings: string[]
}

const KEY_ALIASES: Record<string, string> = {
  ' ': 'Space',
  space: 'Space',
  spacebar: 'Space',
  shift: 'ShiftLeft',
  ctrl: 'ControlLeft',
  control: 'ControlLeft',
  alt: 'AltLeft',
  enter: 'Enter',
  return: 'Enter',
  esc: 'Escape',
  escape: 'Escape',
  tab: 'Tab',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
}

const DEVICE_PREFIX: Record<string, string> = {
  keyboard: 'Keyboard',
  key: 'Keyboard',
  mouse: 'Mouse',
  gamepad: 'Gamepad',
  touch: 'Touch',
}

/** 'W' / 'w' / 'KeyW' / 'Keyboard/W' / ' ' -> 'Keyboard/KeyW' (KeyboardEvent.code naming) */
export function normalizeBinding(raw: unknown): string | null {
  if (raw === ' ' || raw === 'Keyboard/ ') return 'Keyboard/Space'
  if (typeof raw !== 'string' || !raw.trim()) return null
  let value = raw.trim()
  let device = 'Keyboard'
  const slash = value.indexOf('/')
  if (slash > 0) {
    const prefix = value.slice(0, slash)
    device = DEVICE_PREFIX[prefix.toLowerCase()] ?? prefix
    value = value.slice(slash + 1)
  }
  if (device !== 'Keyboard') return `${device}/${value}`

  const alias = KEY_ALIASES[value.toLowerCase()]
  if (alias) return `Keyboard/${alias}`
  if (/^[a-z]$/i.test(value)) return `Keyboard/Key${value.toUpperCase()}`
  if (/^[0-9]$/.test(value)) return `Keyboard/Digit${value}`
  return `Keyboard/${value}`
}

function normList(list: unknown, warnings: string[], ctx: string): string[] {
  const arr = Array.isArray(list) ? list : list === undefined ? [] : [list]
  const out: string[] = []
  for (const item of arr) {
    let raw: unknown = item
    if (item && typeof item === 'object') {
      // shape 4: { device, path }
      const o = item as Record<string, unknown>
      raw = o.device ? `${o.device}/${o.path ?? o.code ?? ''}` : (o.path ?? o.code)
    }
    const b = normalizeBinding(raw)
    if (b) {
      if (!out.includes(b)) out.push(b)
    } else {
      warnings.push(`${ctx}: binding tidak dikenali ${JSON.stringify(item)}`)
    }
  }
  return out
}

function normComposite(c: any, type: InputActionDef['type'], warnings: string[], ctx: string): Vector2Composite | AxisComposite | null {
  if (!c || typeof c !== 'object') return null
  if (type === 'axis') {
    const negative = normList(c.negative, warnings, ctx)
    const positive = normList(c.positive, warnings, ctx)
    return negative.length || positive.length ? { negative, positive } : null
  }
  const out: Vector2Composite = {}
  for (const dir of ['up', 'down', 'left', 'right'] as const) {
    const list = normList(c[dir], warnings, ctx)
    if (list.length) out[dir] = list
  }
  return Object.keys(out).length ? out : null
}

/** Infer action type for shapes that didn't carry one */
function inferType(raw: any): InputActionDef['type'] {
  if (raw.type === 'button' || raw.type === 'axis' || raw.type === 'vector2') return raw.type
  if (raw.composite || raw.composites) return 'vector2'
  return 'button'
}

export function normalizeInputActions(raw: unknown): NormalizeResult {
  const warnings: string[] = []
  if (!Array.isArray(raw)) return { actions: cloneDefaultActions(), warnings: raw === undefined ? [] : ['input.actions bukan array; memakai default'] }

  const actions: InputActionDef[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object' || typeof (item as any).name !== 'string' || !(item as any).name.trim()) {
      warnings.push(`Action tanpa nama dilewati: ${JSON.stringify(item)?.slice(0, 80)}`)
      continue
    }
    const a = item as any
    const name = a.name.trim()
    if (seen.has(name)) {
      warnings.push(`Action "${name}" duplikat; yang pertama dipakai`)
      continue
    }
    seen.add(name)
    const type = inferType(a)
    const ctx = `Action "${name}"`

    const bindings = normList([...(Array.isArray(a.bindings) ? a.bindings : []), ...(Array.isArray(a.keys) ? a.keys : [])], warnings, ctx)
    const composites: (Vector2Composite | AxisComposite)[] = []
    for (const c of [...(Array.isArray(a.composites) ? a.composites : []), ...(a.composite ? [a.composite] : [])]) {
      const n = normComposite(c, type, warnings, ctx)
      if (n) composites.push(n)
    }

    const def: InputActionDef = { name, type, bindings }
    if (composites.length) def.composites = composites
    if (typeof a.deadzone === 'number') def.deadzone = Math.min(Math.max(a.deadzone, 0), 0.95)
    if (typeof a.sensitivity === 'number') def.sensitivity = a.sensitivity
    if (typeof a.pressThreshold === 'number') def.pressThreshold = Math.min(Math.max(a.pressThreshold, 0.05), 1)
    if (!bindings.length && !composites.length) warnings.push(`${ctx} tidak punya binding`)
    actions.push(def)
  }
  return { actions, warnings }
}

/** Add any default action the project doesn't define yet (editor "Tambahkan action default") */
export function withMissingDefaults(actions: InputActionDef[]): InputActionDef[] {
  const names = new Set(actions.map((a) => a.name))
  return [...actions, ...cloneDefaultActions().filter((a) => !names.has(a.name))]
}

const BUILTIN_ICON = /^[a-z][a-z0-9-]{0,31}$/
const ASSET_ICON = /^asset:assets\/(?!.*\.\.)[\w\-./ ]+\.(png|svg|webp)$/i
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+\s*)?\))$/i
const ANCHORS = ['bottom-right', 'bottom-left', 'top-right', 'top-left', 'bottom-center', 'top-center']
const LAYOUT_NAME = /^[A-Za-z0-9_-]{1,32}$/

export interface TouchNormalizeResult {
  config: TouchConfig
  /** Actions with Touch/Button bindings moved onto buttons (only changed when migrating v1) */
  actions: InputActionDef[]
  warnings: string[]
  /** Buttons connected to an action by the v1 -> v2 migration */
  migrated: number
}

const clampNum = (v: unknown, min: number, max: number, fallback?: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, min), max) : fallback

/** Find (and remove) a manual Touch/Button/<id> binding: v1 connected buttons that way */
function takeManualBinding(actions: InputActionDef[], id: string): { action: string; value: number } | null {
  const binding = `Touch/Button/${id}`
  for (const a of actions) {
    if (a.bindings?.includes(binding)) {
      a.bindings = a.bindings.filter((b) => b !== binding)
      return { action: a.name, value: 1 }
    }
    for (const c of (a.composites ?? []) as (AxisComposite & Vector2Composite)[]) {
      for (const key of ['negative', 'positive'] as const) {
        if (c[key]?.includes(binding)) {
          c[key] = c[key]!.filter((b) => b !== binding)
          return { action: a.name, value: key === 'negative' ? -1 : 1 }
        }
      }
    }
  }
  return null
}

function normalizeButtons(
  raw: unknown,
  actions: InputActionDef[] | undefined,
  warnings: string[],
  where: string,
  counter: { migrated: number }
): TouchButtonDef[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: TouchButtonDef[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const b = item as Record<string, any>
    let id = typeof b.id === 'string' ? b.id.replace(/[^A-Za-z0-9_-]/g, '') : ''
    if (!id) {
      warnings.push(`${where}: tombol tanpa id dilewati`)
      continue
    }
    if (seen.has(id)) {
      let n = 2
      while (seen.has(`${id}_${n}`)) n++
      warnings.push(`${where}: id tombol "${id}" ganda; yang kedua diganti "${id}_${n}"`)
      id = `${id}_${n}`
    }
    seen.add(id)

    let action = typeof b.action === 'string' ? b.action.trim() : ''
    let value = typeof b.value === 'number' && b.value < 0 ? -1 : 1
    if (!action && actions) {
      const manual = takeManualBinding(actions, id)
      if (manual) {
        action = manual.action
        value = manual.value
        counter.migrated++
      } else if (actions.some((a) => a.name === id)) {
        action = id
        counter.migrated++
      }
    }
    if (!action) warnings.push(`${where}: tombol "${id}" belum terhubung ke action`)
    else if (actions && !actions.some((a) => a.name === action)) warnings.push(`${where}: tombol "${id}" memakai action "${action}" yang tidak ada`)

    const def: TouchButtonDef = { id, action }
    if (value === -1) def.value = -1
    if (typeof b.label === 'string') def.label = b.label.slice(0, 16)
    if (typeof b.icon === 'string' && b.icon) {
      if (BUILTIN_ICON.test(b.icon) || ASSET_ICON.test(b.icon)) def.icon = b.icon
      else warnings.push(`${where}: ikon tombol "${id}" tidak valid (${b.icon}); pakai nama bawaan atau asset:assets/...png|svg|webp`)
    }
    const behavior = b.behavior ?? (b.toggle ? 'toggle' : undefined)
    if (behavior) def.behavior = ['hold', 'tap', 'toggle', 'repeat'].includes(behavior) ? behavior : 'hold'
    const repeat = clampNum(b.repeatInterval, 0.05, 2)
    if (repeat !== undefined) def.repeatInterval = repeat
    const cooldown = clampNum(b.cooldown, 0, 60)
    if (cooldown) def.cooldown = cooldown
    def.anchor = ANCHORS.includes(b.anchor) ? b.anchor : 'bottom-right'
    def.unit = b.unit === '%' ? '%' : 'px'
    def.x = clampNum(b.x, 0, def.unit === '%' ? 100 : 4000, 24)
    def.y = clampNum(b.y, 0, def.unit === '%' ? 100 : 4000, 24)
    def.size = clampNum(b.size, 24, 240, 56)
    if (['circle', 'rounded', 'square'].includes(b.shape)) def.shape = b.shape
    for (const key of ['color', 'pressedColor', 'textColor'] as const) {
      if (typeof b[key] === 'string' && b[key]) {
        if (COLOR.test(b[key].trim())) def[key] = b[key].trim()
        else warnings.push(`${where}: warna ${key} tombol "${id}" tidak valid (${b[key]})`)
      }
    }
    const opacity = clampNum(b.opacity, 0.1, 1)
    if (opacity !== undefined) def.opacity = opacity
    if (b.visible === false) def.visible = false
    if (b.enabled === false) def.enabled = false
    out.push(def)
  }
  return out
}

function normalizeLayoutFields(r: Record<string, any>, base: TouchLayout): Omit<TouchLayout, 'buttons'> {
  return {
    enabled: r.enabled === 'always' || r.enabled === 'never' ? r.enabled : r.enabled === 'auto' ? 'auto' : base.enabled,
    joystick: {
      side: r.joystick?.side === 'right' ? 'right' : r.joystick?.side === 'left' ? 'left' : base.joystick.side,
      mode: r.joystick?.mode === 'fixed' ? 'fixed' : r.joystick?.mode === 'floating' ? 'floating' : base.joystick.mode,
      radius: clampNum(r.joystick?.radius, 24, 200, base.joystick.radius)!,
    },
    look: {
      enabled: typeof r.look?.enabled === 'boolean' ? r.look.enabled : base.look.enabled,
      area: 'right-half',
      sensitivity: clampNum(r.look?.sensitivity, 0, 10, base.look.sensitivity)!,
    },
    opacity: clampNum(r.opacity, 0.1, 1, base.opacity)!,
    safeArea: typeof r.safeArea === 'boolean' ? r.safeArea : base.safeArea,
    orientation: r.orientation === 'landscape' || r.orientation === 'portrait' ? r.orientation : base.orientation,
    scale: r.scale === 'auto' ? 'auto' : typeof r.scale === 'number' ? clampNum(r.scale, 0.5, 3, 1) : base.scale,
  }
}

/**
 * Normalize project input.touch (v1 or v2). With `actions`, v1 buttons are connected to the
 * action that listed their Touch/Button/<id> binding, and that binding is removed from the action.
 */
export function normalizeTouchConfig(raw: unknown, actions?: InputActionDef[]): TouchNormalizeResult {
  const warnings: string[] = []
  const counter = { migrated: 0 }
  const workActions = actions ? (JSON.parse(JSON.stringify(actions)) as InputActionDef[]) : undefined
  const base = cloneDefaultTouch()
  if (!raw || typeof raw !== 'object') {
    return { config: base, actions: workActions ?? [], warnings, migrated: 0 }
  }
  const r = raw as Record<string, any>
  const config: TouchConfig = {
    ...normalizeLayoutFields(r, base),
    buttons: Array.isArray(r.buttons) ? normalizeButtons(r.buttons, workActions, warnings, 'Layout default', counter) : base.buttons,
  }
  if (r.layouts && typeof r.layouts === 'object') {
    const layouts: NonNullable<TouchConfig['layouts']> = {}
    for (const [name, value] of Object.entries(r.layouts as Record<string, any>)) {
      if (!LAYOUT_NAME.test(name) || name === 'default' || !value || typeof value !== 'object') {
        warnings.push(`Layout "${name}" dilewati (nama tidak valid)`)
        continue
      }
      const l: Record<string, any> = {}
      for (const key of ['joystick', 'look', 'opacity', 'safeArea', 'orientation', 'scale'] as const) {
        if (value[key] !== undefined) l[key] = value[key]
      }
      if (Array.isArray(value.buttons)) l.buttons = normalizeButtons(value.buttons, workActions, warnings, `Layout ${name}`, counter)
      layouts[name] = l
    }
    if (Object.keys(layouts).length) config.layouts = layouts
  }
  if (typeof r.initialLayout === 'string' && (r.initialLayout === 'default' || config.layouts?.[r.initialLayout])) {
    config.initialLayout = r.initialLayout
  }
  return { config, actions: workActions ?? [], warnings, migrated: counter.migrated }
}

/** The layout to show: named layout fields over the default ones; its buttons replace the default list */
export function resolveTouchLayout(config: TouchConfig, name?: string): TouchLayout {
  const layoutName = name ?? config.initialLayout ?? 'default'
  const { layouts: _layouts, initialLayout: _initial, ...base } = config
  const over = layoutName !== 'default' ? config.layouts?.[layoutName] : undefined
  if (!over) return { ...base, buttons: base.buttons.map((b) => ({ ...b })) }
  const fields = normalizeLayoutFields(over as Record<string, any>, base)
  return { ...fields, enabled: base.enabled, buttons: (over.buttons ?? base.buttons).map((b) => ({ ...b })) }
}

export function touchLayoutNames(config: TouchConfig): string[] {
  return ['default', ...Object.keys(config.layouts ?? {})]
}

/** @deprecated use normalizeTouchConfig + resolveTouchLayout */
export function normalizeTouchLayout(raw: unknown): TouchLayout {
  return resolveTouchLayout(normalizeTouchConfig(raw).config)
}
