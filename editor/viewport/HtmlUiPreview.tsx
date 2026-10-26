import React, { useEffect, useState } from 'react'
import { useEditorStore } from '../store/editorStore'
import { sanitizeHtmlFragment } from '../../engine/ui/sanitizeHtml'

interface PreviewItem {
  entityId: string
  src: string
  zIndex: number
  html: string
}

/**
 * Wraps a fragment for an inert preview. The sandbox (no allow-scripts) already stops scripts;
 * sanitizing too keeps the preview identical to what the game renders.
 */
function previewDocument(html: string): string {
  const holder = document.createElement('div')
  holder.appendChild(sanitizeHtmlFragment(html).fragment)
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:transparent;color:#fff;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden}</style></head><body>${holder.innerHTML}</body></html>`
}

/**
 * Edit-mode preview of HtmlUI 'screen' fragments over the viewport, so HUD layout can be
 * checked without pressing Play. Scripts don't run here; bound values show their markup default.
 */
export const HtmlUiPreview: React.FC = () => {
  const world = useEditorStore((s) => s.world)
  const projectPath = useEditorStore((s) => s.projectPath)
  const [revision, setRevision] = useState(0)
  const [items, setItems] = useState<PreviewItem[]>([])

  useEffect(() => {
    const bump = () => setRevision((r) => r + 1)
    const offs = ['entityAdded', 'entityRemoved', 'componentAdded', 'componentRemoved'].map((ev) => world.events.on(ev, bump))
    offs.push(
      world.events.on('propertyChanged', (_entity: unknown, type: string) => {
        if (type === 'HtmlUI') bump()
      })
    )
    return () => offs.forEach((off) => off())
  }, [world])

  useEffect(() => {
    const read = window.electronAPI?.playReadUiFragment
    if (!projectPath || !read) {
      setItems([])
      return
    }
    let cancelled = false
    const targets = world
      .getEntities()
      .map((e) => ({ entity: e, ui: e.getComponent('HtmlUI') as any }))
      .filter(({ entity, ui }) => entity.active && ui && ui.getEnabled() && ui.mode !== 'world' && ui.src)

    Promise.all(
      targets.map(async ({ entity, ui }) => {
        const res = await read({ projectPath, src: ui.src })
        return res.status === 'ok' && res.html !== undefined
          ? { entityId: entity.id, src: ui.src, zIndex: Number(ui.zIndex) || 0, html: res.html }
          : null
      })
    ).then((loaded) => {
      if (!cancelled) setItems(loaded.filter((x): x is PreviewItem => x !== null).sort((a, b) => a.zIndex - b.zIndex))
    })
    return () => {
      cancelled = true
    }
  }, [world, projectPath, revision])

  if (items.length === 0) return null
  return (
    <div className="absolute inset-0 pointer-events-none z-10">
      {items.map((item) => (
        <iframe
          key={`${item.entityId}:${item.src}`}
          title={`UI preview ${item.src}`}
          sandbox=""
          srcDoc={previewDocument(item.html)}
          className="absolute inset-0 w-full h-full border-0 bg-transparent"
          style={{ colorScheme: 'normal' }}
          tabIndex={-1}
        />
      ))}
    </div>
  )
}

export default HtmlUiPreview
