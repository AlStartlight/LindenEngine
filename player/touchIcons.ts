/**
 * Built-in touch button icons: 24x24 SVG paths drawn with currentColor, so they look the
 * same on every device (unlike emoji/Unicode glyphs) and follow the button's textColor.
 */
const PATHS: Record<string, string> = {
  jump: 'M12 4l-6 6h4v6h4v-6h4zM5 20h14',
  attack: 'M12 2l2.4 7.2H22l-6 4.4 2.3 7.4L12 16.6 5.7 21l2.3-7.4-6-4.4h7.6z',
  sword: 'M14.5 3H21v6.5L10 20.5l-2-2L19 7.5V5h-2.5L5.5 16l-2-2zM6 15l3 3-2.5 2.5-3-3z',
  shoot: 'M3 12h10M13 8l4 4-4 4M19 6v12',
  run: 'M5 6l7 6-7 6M12 6l7 6-7 6',
  use: 'M8 12V6a1.5 1.5 0 013 0v5V4.5a1.5 1.5 0 013 0V11V6a1.5 1.5 0 013 0v8a6 6 0 01-6 6h-1a6 6 0 01-5-2.7L3.5 13a1.5 1.5 0 012.4-1.8z',
  crouch: 'M12 20l-6-6h4V8h4v6h4zM5 4h14',
  dash: 'M3 8h7M2 12h9M3 16h7M13 6l8 6-8 6z',
  shield: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z',
  reload: 'M20 12a8 8 0 11-2.3-5.7M20 4v5h-5',
  'turn-left': 'M9 4L4 9l5 5M4 9h9a6 6 0 016 6v5',
  'turn-right': 'M15 4l5 5-5 5M20 9h-9a6 6 0 00-6 6v5',
  up: 'M12 5l7 9H5z',
  down: 'M12 19l-7-9h14z',
  pause: 'M8 5v14M16 5v14',
  menu: 'M4 7h16M4 12h16M4 17h16',
}

export const BUILTIN_ICONS = Object.keys(PATHS)

/** Inline SVG markup for a built-in icon, or null if the name is unknown */
export function builtinIconSvg(name: string, size: number): string | null {
  const d = PATHS[name]
  if (!d) return null
  const filled = name === 'attack' || name === 'up' || name === 'down' || name === 'dash'
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`
}
