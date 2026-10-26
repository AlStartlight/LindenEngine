import * as THREE from 'three'
import { CSS3DRenderer, CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import type { World } from '../ecs/World'
import type { Entity } from '../ecs/Entity'
import type { HtmlUI } from '../scripting/ScriptComponents'
import type { HtmlUiApi } from '../scripting/ScriptRuntime'
import { sanitizeHtmlFragment } from './sanitizeHtml'
import { isValidUiSrc } from '../../shared/playProtocol'

/** Shared base styles for each fragment's shadow root */
const BASE_CSS = `
:host { all: initial; position: absolute; inset: 0; pointer-events: none; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff; }
:host([data-world]) { position: static; inset: auto; }
.linden-ui-content { position: relative; width: 100%; height: 100%; }
:host([data-world]) .linden-ui-content { width: auto; height: auto; }
[data-interactive], button, input, select, textarea, a { pointer-events: auto; }
[hidden] { display: none !important; }
`

interface UiEntry {
  entityId: string
  src: string
  host: HTMLElement
  shadow: ShadowRoot
  content: HTMLElement
  object?: CSS3DObject
}

interface Binding {
  entityId: string
  selector: string
  getter: () => unknown
  last: string | undefined
}

export interface HtmlUiLayerOptions {
  /** Element positioned over the game canvas; the layer fills it */
  container: HTMLElement
  fetchText: (src: string) => Promise<string>
  onWarning?: (message: string) => void
}

/**
 * Renders HtmlUI components: 'screen' fragments as an overlay on the canvas, 'world'
 * fragments as CSS3D objects that follow their entity. Each fragment lives in its own
 * shadow root so its CSS can't leak into the page (or into the editor preview).
 */
export class HtmlUiLayer {
  private screenRoot: HTMLDivElement
  private worldRenderer: CSS3DRenderer | null = null
  private entries = new Map<string, UiEntry>()
  private bindings: Binding[] = []

  constructor(private options: HtmlUiLayerOptions) {
    this.screenRoot = document.createElement('div')
    this.screenRoot.id = 'linden-ui-root'
    Object.assign(this.screenRoot.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '10', overflow: 'hidden' })
    options.container.appendChild(this.screenRoot)
  }

  get hasEntries(): boolean {
    return this.entries.size > 0
  }

  async loadAll(world: World, getObject3D: (entityId: string) => THREE.Object3D | undefined): Promise<void> {
    for (const entity of world.getEntities()) {
      const comp = entity.getComponent<HtmlUI>('HtmlUI')
      if (!comp || !comp.getEnabled() || !entity.active) continue
      if (!isValidUiSrc(comp.src)) {
        this.options.onWarning?.(`HtmlUI pada "${entity.name}": path tidak valid "${comp.src}"`)
        continue
      }
      let html: string
      try {
        html = await this.options.fetchText(comp.src)
      } catch (err: any) {
        this.options.onWarning?.(`HtmlUI pada "${entity.name}": gagal memuat ${comp.src} (${err?.message ?? err})`)
        continue
      }
      this.mount(entity, comp, html, getObject3D)
    }
  }

  private mount(entity: Entity, comp: HtmlUI, html: string, getObject3D: (id: string) => THREE.Object3D | undefined): void {
    const host = document.createElement('div')
    host.dataset.entityId = entity.id
    const shadow = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = BASE_CSS
    const content = document.createElement('div')
    content.className = 'linden-ui-content'
    const { fragment, report } = sanitizeHtmlFragment(html)
    if (report.removedTags.length || report.removedAttributes.length) {
      this.options.onWarning?.(
        `HtmlUI ${comp.src}: dibuang ${[...report.removedTags.map((t) => `<${t}>`), ...report.removedAttributes].join(', ')} (logika UI harus lewat script ctx.ui)`
      )
    }
    content.appendChild(fragment)
    shadow.append(style, content)
    if (comp.pointerEvents) host.style.pointerEvents = 'auto'

    const entry: UiEntry = { entityId: entity.id, src: comp.src, host, shadow, content }
    if (comp.mode === 'world') {
      host.dataset.world = ''
      const target = getObject3D(entity.id)
      if (!target) {
        this.options.onWarning?.(`HtmlUI world pada "${entity.name}": objek 3D tidak ditemukan`)
        return
      }
      const obj = new CSS3DObject(host)
      obj.scale.setScalar(comp.pixelSize || 0.01)
      target.add(obj)
      entry.object = obj
      this.ensureWorldRenderer()
    } else {
      host.style.zIndex = String(comp.zIndex || 0)
      this.screenRoot.appendChild(host)
    }
    this.entries.set(entity.id, entry)
  }

  /**
   * Hot reload: re-fetch changed fragments and swap their markup inside the same content
   * element, so delegated ctx.ui.on listeners and bindings keep working.
   */
  async reloadFragments(srcs: string[]): Promise<number> {
    const wanted = new Set(srcs.map((s) => s.replace(/\\/g, '/')))
    let count = 0
    for (const entry of this.entries.values()) {
      if (wanted.size > 0 && !wanted.has(entry.src)) continue
      let html: string
      try {
        html = await this.options.fetchText(entry.src)
      } catch (err: any) {
        this.options.onWarning?.(`HtmlUI ${entry.src}: gagal memuat ulang (${err?.message ?? err})`)
        continue
      }
      entry.content.replaceChildren(sanitizeHtmlFragment(html).fragment)
      count++
    }
    // Force bound values to be written into the new elements
    for (const b of this.bindings) b.last = undefined
    return count
  }

  private ensureWorldRenderer(): void {
    if (this.worldRenderer) return
    this.worldRenderer = new CSS3DRenderer()
    Object.assign(this.worldRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '9' })
    this.options.container.appendChild(this.worldRenderer.domElement)
    this.worldRenderer.setSize(this.options.container.clientWidth, this.options.container.clientHeight)
  }

  setSize(width: number, height: number): void {
    this.worldRenderer?.setSize(width, height)
  }

  renderWorld(scene: THREE.Scene, camera: THREE.Camera): void {
    this.worldRenderer?.render(scene, camera)
  }

  /** Elements matching selector, in the entity's own fragment first, then all fragments */
  private queryAll(selector: string, preferEntityId?: string): Element[] {
    const ordered = [...this.entries.values()].sort((a, b) => (a.entityId === preferEntityId ? -1 : b.entityId === preferEntityId ? 1 : 0))
    const out: Element[] = []
    for (const entry of ordered) {
      try {
        out.push(...Array.from(entry.content.querySelectorAll(selector)))
      } catch {
        this.options.onWarning?.(`Selector UI tidak valid: ${selector}`)
        return []
      }
    }
    return out
  }

  apiFor(entity: Entity): HtmlUiApi {
    const id = entity.id
    return {
      root: (entityId?: string) => this.entries.get(entityId ?? id)?.content ?? null,
      query: <T extends Element = Element>(selector: string): T | null => (this.queryAll(selector, id)[0] as T | undefined) ?? null,
      queryAll: <T extends Element = Element>(selector: string) => this.queryAll(selector, id) as T[],
      bind: (selector, getter) => {
        const binding: Binding = { entityId: id, selector, getter, last: undefined }
        this.bindings.push(binding)
        return () => {
          this.bindings = this.bindings.filter((b) => b !== binding)
        }
      },
      on: (selector, event, handler) => {
        // Delegate on every fragment so elements added later still work
        const listener = (e: Event) => {
          for (const node of e.composedPath()) {
            if (node instanceof Element && node.matches(selector)) {
              handler(e)
              return
            }
          }
        }
        const roots = [...this.entries.values()].map((e) => e.content)
        roots.forEach((r) => r.addEventListener(event, listener))
        return () => roots.forEach((r) => r.removeEventListener(event, listener))
      },
      show: (selector) => this.queryAll(selector, id).forEach((el) => (el as HTMLElement).removeAttribute('hidden')),
      hide: (selector) => this.queryAll(selector, id).forEach((el) => (el as HTMLElement).setAttribute('hidden', '')),
    }
  }

  /** Apply bound values; DOM is only touched when a value changes */
  flush(): void {
    for (const b of this.bindings) {
      let text: string
      try {
        const v = b.getter()
        text = v === null || v === undefined ? '' : String(v)
      } catch {
        continue
      }
      if (text === b.last) continue
      b.last = text
      for (const el of this.queryAll(b.selector, b.entityId)) el.textContent = text
    }
  }

  clear(): void {
    for (const entry of this.entries.values()) {
      entry.object?.parent?.remove(entry.object)
      entry.host.remove()
    }
    this.entries.clear()
    this.bindings = []
  }

  dispose(): void {
    this.clear()
    this.screenRoot.remove()
    this.worldRenderer?.domElement.remove()
    this.worldRenderer = null
  }
}
