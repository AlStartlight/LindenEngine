import * as THREE from 'three'

export type RendererPreference = 'webgl' | 'webgpu'
export type RendererBackend = 'webgpu' | 'webgl2'

/** The subset of WebGLRenderer / WebGPURenderer the runtime uses */
export interface GameRenderer {
  domElement: HTMLCanvasElement
  shadowMap: { enabled: boolean; type: THREE.ShadowMapType }
  info: { render: { triangles?: number; calls?: number; drawCalls?: number } }
  setSize(width: number, height: number, updateStyle?: boolean): void
  setPixelRatio(ratio: number): void
  render(scene: THREE.Object3D, camera: THREE.Camera): void
  dispose(): void
}

export interface CreatedRenderer {
  renderer: GameRenderer
  backend: RendererBackend
  /** Why WebGPU was requested but not used */
  fallbackReason?: string
}

/** Settings shared by the editor viewport and the player so edit and play look the same */
export function configureRenderer(renderer: GameRenderer, width: number, height: number): void {
  renderer.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2))
  renderer.setSize(width, height)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
}

export function rendererStats(renderer: GameRenderer): { triangles: number; drawCalls: number } {
  const r = renderer.info.render
  // WebGPURenderer: drawCalls is per frame and calls is cumulative; WebGLRenderer only has per-frame calls
  return { triangles: r.triangles ?? 0, drawCalls: r.drawCalls ?? r.calls ?? 0 }
}

/**
 * Create the game renderer. 'webgpu' uses three's WebGPURenderer, which itself falls back to a
 * WebGL2 backend when navigator.gpu is missing; with requireWebGPU that fallback is an error.
 */
export async function createGameRenderer(
  canvas: HTMLCanvasElement,
  preference: RendererPreference,
  opts: { requireWebGPU?: boolean; width: number; height: number }
): Promise<CreatedRenderer> {
  const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator && !!(navigator as any).gpu

  if (preference === 'webgpu' || opts.requireWebGPU) {
    if (opts.requireWebGPU && !hasWebGPU) {
      throw new Error('WebGPU diperlukan untuk game ini, namun browser Anda belum mendukung WebGPU.')
    }
    try {
      const { WebGPURenderer } = await import('three/webgpu')
      const renderer = new WebGPURenderer({ canvas, antialias: true, powerPreference: 'high-performance' } as any)
      await renderer.init()
      configureRenderer(renderer as unknown as GameRenderer, opts.width, opts.height)
      const isWebGPU = !!(renderer as any).backend?.isWebGPUBackend
      if (opts.requireWebGPU && !isWebGPU) throw new Error('Adapter WebGPU tidak tersedia di perangkat ini.')
      return {
        renderer: renderer as unknown as GameRenderer,
        backend: isWebGPU ? 'webgpu' : 'webgl2',
        fallbackReason: isWebGPU ? undefined : 'navigator.gpu tidak tersedia; WebGPURenderer memakai backend WebGL2',
      }
    } catch (err: any) {
      if (opts.requireWebGPU) throw err
      const created = createWebGLRenderer(canvas, opts.width, opts.height)
      return { ...created, fallbackReason: `WebGPU gagal diinisialisasi (${err?.message ?? err}); memakai WebGL2` }
    }
  }

  return createWebGLRenderer(canvas, opts.width, opts.height)
}

function createWebGLRenderer(canvas: HTMLCanvasElement, width: number, height: number): CreatedRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
  configureRenderer(renderer as unknown as GameRenderer, width, height)
  return { renderer: renderer as unknown as GameRenderer, backend: 'webgl2' }
}
