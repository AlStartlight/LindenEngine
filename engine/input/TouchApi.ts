/**
 * Script/HTML Game API for on-screen touch buttons (ctx.touch, linden.touch).
 * The browser implementation lives in player/touchApi.ts.
 */

/**
 * What scripts (ctx.touch) and HTML Games (linden.touch) can do with the on-screen buttons.
 * Every call is safe when touch controls aren't shown (desktop): it just does nothing,
 * so game code never has to check the device.
 */
export interface TouchApi {
  /** Touch controls are on screen */
  readonly active: boolean
  /** Name of the active layout ('default' or one of input.touch.layouts) */
  readonly layout: string
  setLayout(name: string): void
  show(id: string): void
  hide(id: string): void
  setEnabled(id: string, enabled: boolean): void
  setLabel(id: string, label: string): void
  /** Built-in icon name or "asset:assets/..." */
  setIcon(id: string, icon: string): void
  /** Small counter on the button (ammo, charges); null removes it */
  setBadge(id: string, text: string | number | null): void
  /** Disable the button for N seconds with a radial sweep */
  setCooldown(id: string, seconds: number): void
  /** Ids of the buttons that trigger an action, e.g. buttonsFor('Interact') */
  buttonsFor(action: string): string[]
  /** Reserved for haptics; no-op for now */
  vibrate(ms: number): void
}

/** Used where no touch layer exists (headless without recording) */
export const NULL_TOUCH: TouchApi = {
  active: false,
  layout: 'default',
  setLayout: () => {},
  show: () => {},
  hide: () => {},
  setEnabled: () => {},
  setLabel: () => {},
  setIcon: () => {},
  setBadge: () => {},
  setCooldown: () => {},
  buttonsFor: () => [],
  vibrate: () => {},
}

/** Headless stand-in for linden_play: records what scripts asked for */
export function createRecordingTouchApi(log: { at: number; call: string }[], now: () => number): TouchApi {
  let layout = 'default'
  const rec = (call: string) => log.push({ at: Math.round(now() * 100) / 100, call })
  return {
    active: false,
    get layout() {
      return layout
    },
    setLayout(name) {
      layout = name
      rec(`setLayout(${name})`)
    },
    show: (id) => rec(`show(${id})`),
    hide: (id) => rec(`hide(${id})`),
    setEnabled: (id, enabled) => rec(`setEnabled(${id}, ${enabled})`),
    setLabel: (id, label) => rec(`setLabel(${id}, ${JSON.stringify(label)})`),
    setIcon: (id, icon) => rec(`setIcon(${id}, ${icon})`),
    setBadge: (id, text) => rec(`setBadge(${id}, ${JSON.stringify(text)})`),
    setCooldown: (id, seconds) => rec(`setCooldown(${id}, ${seconds})`),
    buttonsFor: () => [],
    vibrate: () => {},
  }
}
