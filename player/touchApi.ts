import type { TouchControls } from './touchControls'
import type { TouchApi } from '../engine/input/TouchApi'

export type { TouchApi }

/** A TouchApi over controls that may or may not exist (desktop, controls turned off) */
export function createTouchApi(getControls: () => TouchControls | null, onWarning?: (message: string) => void): TouchApi {
  let desiredLayout = 'default'
  const warned = new Set<string>()
  const warnOnce = (msg: string) => {
    if (warned.has(msg)) return
    warned.add(msg)
    onWarning?.(msg)
  }
  const withButton = (id: string, fn: (c: TouchControls) => boolean) => {
    const c = getControls()
    if (!c) return
    if (!fn(c)) warnOnce(`ctx.touch: tombol "${id}" tidak ada di layout "${c.activeLayout}"`)
  }
  return {
    get active() {
      return !!getControls()
    },
    get layout() {
      return getControls()?.activeLayout ?? desiredLayout
    },
    setLayout(name) {
      desiredLayout = name
      const c = getControls()
      if (c && !c.setLayout(name)) warnOnce(`ctx.touch.setLayout: layout "${name}" tidak ada`)
    },
    show: (id) => withButton(id, (c) => c.patch(id, { visible: true })),
    hide: (id) => withButton(id, (c) => c.patch(id, { visible: false })),
    setEnabled: (id, enabled) => withButton(id, (c) => c.patch(id, { enabled })),
    setLabel: (id, label) => withButton(id, (c) => c.patch(id, { label: String(label) })),
    setIcon: (id, icon) => withButton(id, (c) => c.patch(id, { icon })),
    setBadge: (id, text) => withButton(id, (c) => c.patch(id, { badge: text === null ? null : String(text) })),
    setCooldown: (id, seconds) => withButton(id, (c) => c.setCooldown(id, seconds)),
    buttonsFor: (action) => getControls()?.buttonsFor(action) ?? [],
    vibrate: () => {},
  }
}
