import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { loadUiOverlayVisible, saveUiOverlayVisible, uiOverlayKey } from '../../editor/viewport/uiOverlayPreference'
import { useEditorStore } from '../../editor/store/editorStore'
import { parseEditorToGame } from '../../shared/playProtocol'
import { HtmlUiLayer } from '../../engine/ui/HtmlUiLayer'

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    map,
  }
}

describe('UI overlay preference (per project)', () => {
  it('defaults to visible', () => {
    expect(loadUiOverlayVisible('/p/A', memoryStorage())).toBe(true)
    expect(loadUiOverlayVisible(null, memoryStorage())).toBe(true)
    expect(loadUiOverlayVisible('/p/A', null)).toBe(true)
  })

  it('persists per project path', () => {
    const storage = memoryStorage()
    saveUiOverlayVisible('/p/A', false, storage)
    expect(loadUiOverlayVisible('/p/A', storage)).toBe(false)
    expect(loadUiOverlayVisible('/p/B', storage)).toBe(true)
    saveUiOverlayVisible('/p/A', true, storage)
    expect(loadUiOverlayVisible('/p/A', storage)).toBe(true)
  })

  it('falls back to visible when storage throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(() => saveUiOverlayVisible('/p/A', false, broken)).not.toThrow()
    expect(loadUiOverlayVisible('/p/A', broken)).toBe(true)
  })
})

describe('editorStore UI overlay toggle', () => {
  let storage: ReturnType<typeof memoryStorage>
  beforeEach(() => {
    storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
  })
  afterEach(() => {
    useEditorStore.getState().closeProject()
    vi.unstubAllGlobals()
  })

  it('toggles back and forth and saves for the open project', () => {
    useEditorStore.getState().setProject('/p/A')
    expect(useEditorStore.getState().uiOverlayVisible).toBe(true)
    useEditorStore.getState().toggleUiOverlay()
    expect(useEditorStore.getState().uiOverlayVisible).toBe(false)
    expect(storage.map.get(uiOverlayKey('/p/A'))).toBe('false')
    useEditorStore.getState().toggleUiOverlay()
    expect(useEditorStore.getState().uiOverlayVisible).toBe(true)
  })

  it('restores the saved state when a project is reopened, independent per project', () => {
    useEditorStore.getState().setProject('/p/A')
    useEditorStore.getState().setUiOverlayVisible(false)
    useEditorStore.getState().setProject('/p/B')
    expect(useEditorStore.getState().uiOverlayVisible).toBe(true)
    useEditorStore.getState().setProject('/p/A')
    expect(useEditorStore.getState().uiOverlayVisible).toBe(false)
    useEditorStore.getState().closeProject()
    expect(useEditorStore.getState().uiOverlayVisible).toBe(true)
  })
})

describe('linden:uiVisible message', () => {
  it('accepts a boolean', () => {
    expect(parseEditorToGame({ type: 'linden:uiVisible', visible: false })).toEqual({ type: 'linden:uiVisible', visible: false })
    expect(parseEditorToGame({ type: 'linden:uiVisible', visible: true })).toEqual({ type: 'linden:uiVisible', visible: true })
  })

  it('rejects other payloads', () => {
    expect(parseEditorToGame({ type: 'linden:uiVisible' })).toBeNull()
    expect(parseEditorToGame({ type: 'linden:uiVisible', visible: 'false' })).toBeNull()
    expect(parseEditorToGame({ type: 'linden:uiVisible', visible: 0 })).toBeNull()
  })
})

describe('HtmlUiLayer.setVisible', () => {
  function fakeEl() {
    return { id: '', style: {} as Record<string, string>, children: [] as unknown[], appendChild(c: unknown) { this.children.push(c) }, remove() {} }
  }
  function setup() {
    vi.stubGlobal('document', { createElement: () => fakeEl() })
    const container = fakeEl()
    const layer = new HtmlUiLayer({ container: container as any, fetchText: async () => '' })
    const screenRoot = container.children[0] as ReturnType<typeof fakeEl>
    return { layer, screenRoot }
  }
  afterEach(() => vi.unstubAllGlobals())

  it('hides and shows the screen root without removing it', () => {
    const { layer, screenRoot } = setup()
    expect(layer.isVisible).toBe(true)
    layer.setVisible(false)
    expect(screenRoot.style.display).toBe('none')
    expect(layer.isVisible).toBe(false)
    layer.setVisible(true)
    expect(screenRoot.style.display).toBe('')
  })

  it('hides world-space UI too and blurs a focused element', () => {
    const { layer } = setup()
    const worldDom = fakeEl()
    ;(layer as any).worldRenderer = { domElement: worldDom }
    const blur = vi.fn()
    ;(layer as any).entries.set('e1', { entityId: 'e1', src: 'ui/a.html', shadow: { activeElement: { blur } } })
    layer.setVisible(false)
    expect(worldDom.style.display).toBe('none')
    expect(blur).toHaveBeenCalledOnce()
    layer.setVisible(true)
    expect(worldDom.style.display).toBe('')
  })
})
