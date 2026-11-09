import { BrowserWindow } from 'electron'
import { startPreviewSession, stopPlaySession } from '../play/PlaySession'
import type { PreviewRequest, PreviewResult } from './lindenTools'
import type { FactoryProbe, FactoryProbeRequest } from './lindenTools/factoryTools'

const PREVIEW_TIMEOUT_MS = 90_000

/**
 * linden_render_preview: renders a scene in a hidden window with the player runtime's preview page
 * (same World + SceneBridge + ScenePipeline as the player) and returns the PNGs.
 */
export function createPreviewRenderer(opts: { cacheRoot: string; preferSourceRuntime: boolean }) {
  return async (req: PreviewRequest): Promise<PreviewResult> => {
    const session = await startPreviewSession({ projectPath: req.projectPath, ...opts })
    const win = new BrowserWindow({
      show: false,
      width: req.size,
      height: req.size,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    })
    // The preview page runs project assets only; it never navigates or opens windows
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    try {
      const params = new URLSearchParams({
        scene: req.scenePath,
        size: String(req.size),
        views: req.views.join(','),
        isolate: req.isolate ? '1' : '0',
        ...(req.entityId ? { entity: req.entityId } : {}),
      })
      await win.loadURL(`${session.url}?${params}`)
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Render preview melebihi batas waktu')), PREVIEW_TIMEOUT_MS)
      })
      const result: any = await Promise.race([win.webContents.executeJavaScript('window.__lindenPreview', true), timeout]).finally(() => clearTimeout(timer))
      if (!result || result.error) throw new Error(result?.error ?? 'Render preview gagal')
      return {
        images: result.images.map((img: { view: PreviewRequest['views'][number]; dataUrl: string }) => ({
          view: img.view,
          png: Buffer.from(img.dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'),
        })),
        size: result.size,
        triangles: result.triangles,
        warnings: result.warnings ?? [],
      }
    } finally {
      win.destroy()
      stopPlaySession(session.id)
    }
  }
}


/**
 * linden_model_build {model:{factory}} and linden_model_bake_glb: runs a model factory once in a
 * hidden window (it needs a DOM canvas) and returns what player/factoryProbe.ts measured.
 */
export function createFactoryProbe(opts: { cacheRoot: string; preferSourceRuntime: boolean }) {
  return async (req: FactoryProbeRequest): Promise<FactoryProbe> => {
    const session = await startPreviewSession({ projectPath: req.projectPath, ...opts })
    const win = new BrowserWindow({
      show: false,
      width: 256,
      height: 256,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    try {
      const params = new URLSearchParams({
        probe: req.factory,
        ...(req.exportName ? { export: req.exportName } : {}),
        options: JSON.stringify(req.options ?? {}),
        meshes: req.meshes ? '1' : '0',
        glb: req.glb ? '1' : '0',
      })
      await win.loadURL(`${session.url}?${params}`)
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Probe factory melebihi batas waktu')), PREVIEW_TIMEOUT_MS)
      })
      const result: any = await Promise.race([win.webContents.executeJavaScript('window.__lindenPreview', true), timeout]).finally(() => clearTimeout(timer))
      if (!result || result.error) throw new Error(result?.error ?? 'Probe factory gagal')
      return result
    } finally {
      win.destroy()
      stopPlaySession(session.id)
    }
  }
}
