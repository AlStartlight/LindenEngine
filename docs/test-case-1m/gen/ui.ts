import { expect } from '@playwright/test'
import type { Case } from '../lib/define'
import { mulberry32, pick, randInt, seedOf } from '../lib/util'
// The UI is pre-bundled with esbuild (tools/build-ui.mjs) because Playwright rewrites JSX in .tsx files
// @ts-ignore - generated ES module
import * as ui from '../ui/ui-bundle.mjs'

// Editor UI rendered without a browser (react-dom/server) — 40.000 cases
//   20.000 Console: every message is shown with its type colour (one seed each)
//    5.000 Toolbar: scene name and dirty marker in the title (one seed each)
//    5.000 Project Settings window lists the project's tags (one seed each)
//    5.000 Input Actions window lists the project's actions (one seed each)
//    4.999 Inspector shows the selected GameObject and its components (one seed each)
//        1 Project panel renders
export const COUNT = 40_000

const h = ui.createElement
const render = (el: unknown): string => ui.renderToStaticMarkup(el)
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ')
const COLOR: Record<string, string> = { error: 'text-red-400', warn: 'text-yellow-400', success: 'text-green-400' }
const noop = () => {}

const store = ui.useEditorStore
const DEFAULT_SETTINGS = JSON.parse(JSON.stringify(store.getState().projectSettings))

/**
 * zustand 4.5 renders the *initial* state on the server (getServerSnapshot), so for
 * react-dom/server the state has to be written to both the live and the initial snapshot.
 */
function setUiState(partial: Record<string, unknown>) {
  store.setState(partial)
  Object.assign(store.getInitialState(), partial)
}

function freshUiStore() {
  store.getState().newScene()
  setUiState({ selectedEntityIds: [], activeWindow: null, activeEditorPanel: 'viewport', projectSettings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) })
  return store
}

export function* cases(): Generator<Case> {
  for (let s = 0; s < 20_000; s++) {
    const seed = seedOf(1201, s)
    yield { title: `Console shows every message with its type colour seed=${s}`, run: () => {
      const rng = mulberry32(seed)
      const messages = Array.from({ length: randInt(rng, 1, 12) }, (_, i) => ({ type: pick(rng, ['info', 'warn', 'error', 'success']), message: `msg_${s}_${i}_${randInt(rng, 0, 1e6)}`, time: new Date(randInt(rng, 0, 2e12)) }))
      const html = render(h(ui.ConsolePanel, { messages }))
      for (const m of messages) {
        expect(html).toContain(m.message)
        if (COLOR[m.type]) {
          const row = html.slice(0, html.indexOf(m.message))
          expect(row.lastIndexOf(COLOR[m.type])).toBeGreaterThan(row.lastIndexOf('<div class="flex items-start'))
        }
      }
    } }
  }

  for (let s = 0; s < 5_000; s++) {
    const seed = seedOf(1202, s)
    yield { title: `Toolbar shows the scene name and dirty marker seed=${s}`, run: () => {
      const rng = mulberry32(seed)
      const sceneName = `Level_${s}_${randInt(rng, 0, 9999)}`
      const isDirty = rng() < 0.5
      const t = text(render(h(ui.Toolbar, { isPlaying: false, onPlay: noop, onStop: noop, onPause: noop, sceneName, isDirty })))
      expect(t).toContain(sceneName)
      for (const menu of ['File', 'Edit', 'GameObject', 'Window']) expect(t).toContain(menu)
      expect(t.includes(`${sceneName}*`) || t.includes(`${sceneName} *`) || t.includes(`* ${sceneName}`) || t.includes(`*${sceneName}`)).toBe(isDirty)
    } }
  }

  for (let s = 0; s < 5_000; s++) {
    const seed = seedOf(1203, s)
    yield { title: `Project Settings window lists the project's tags seed=${s}`, run: () => {
      const rng = mulberry32(seed)
      freshUiStore()
      const tags = Array.from({ length: randInt(rng, 1, 10) }, (_, i) => `Tag_${s}_${i}`)
      setUiState({ projectSettings: { ...store.getState().projectSettings, tags } })
      const t = text(render(h(ui.ProjectSettingsWindow, { onClose: noop })))
      expect(t).toContain('Project Settings')
      for (const tag of tags) expect(t).toContain(tag)
    } }
  }

  for (let s = 0; s < 5_000; s++) {
    const seed = seedOf(1204, s)
    yield { title: `Input Actions window lists the project's actions seed=${s}`, run: () => {
      const rng = mulberry32(seed)
      freshUiStore()
      const actions = Array.from({ length: randInt(rng, 1, 8) }, (_, i) => ({ name: `Action_${s}_${i}`, type: pick(rng, ['button', 'axis', 'vector2']), bindings: [`Keyboard/Key${String.fromCharCode(65 + i)}`] }))
      setUiState({ projectSettings: { ...store.getState().projectSettings, inputActions: actions } })
      const t = text(render(h(ui.InputActionsWindow, { onClose: noop })))
      expect(t).toContain('Input Actions')
      for (const a of actions) expect(t).toContain(a.name)
    } }
  }

  for (let s = 0; s < 4_999; s++) {
    const seed = seedOf(1205, s)
    yield { title: `Inspector shows the selected GameObject and its components seed=${s}`, run: () => {
      const rng = mulberry32(seed)
      freshUiStore()
      const w = store.getState().world
      const e = w.createEntity(`Selected_${s}_${randInt(rng, 0, 999)}`)
      const comps = ['MeshRenderer', 'Camera', 'Light', 'Rigidbody'].filter(() => rng() < 0.5)
      for (const c of comps) w.addComponent(e.id, c)
      setUiState({ selectedEntityIds: [e.id] })
      const html = render(h(ui.InspectorPanel, {}))
      expect(html).toContain(e.name)
      const t = text(html).replace(/\s/g, '')
      for (const c of ['Transform', ...comps]) expect(t).toContain(c)
    } }
  }

  const PANELS: Array<[string, string[]]> = [
    ['ProjectPanel', ['assets', 'prefabs', 'scenes', 'materials', 'scripts']],
  ]
  for (const [panel, labels] of PANELS) {
    yield { title: `${panel} renders its default content`, run: () => {
      freshUiStore()
      const t = text(render(h(ui[panel], {})))
      for (const l of labels) expect(t).toContain(l)
    } }
  }
}
