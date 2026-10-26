import * as THREE from 'three'
import { World } from '../engine/ecs/World'
import { SceneBridge } from '../engine/scene/SceneBridge'
import { SceneSerializer } from '../engine/scene/serializer'
import { Input } from '../engine/input/InputActions'
import { GameSimulation } from '../engine/runtime/GameSimulation'
import { ScriptRuntime, ScriptErrorInfo } from '../engine/scripting/ScriptRuntime'
import { HtmlUiLayer } from '../engine/ui/HtmlUiLayer'
import { compiledScriptPath } from '../shared/playProtocol'
import { createGameRenderer, GameRenderer, RendererBackend, RendererPreference, rendererStats } from '../engine/renderer/createRenderer'
import { TouchControls, shouldShowTouchControls } from './touchControls'
import { createTouchApi, TouchApi } from './touchApi'
import { normalizeTouchConfig } from '../engine/input/normalizeActions'
import { DEFAULT_SCENE } from './defaultScene'
import '../engine/ecs/ComponentRegistry'

export interface PlayerStats {
  fps: number
  frameMs: number
  triangles: number
  drawCalls: number
  renderer: RendererBackend
}

export interface PlayerConfig {
  canvas: HTMLCanvasElement
  container?: HTMLElement
  projectDataUrl?: string
  sceneDataUrl?: string
  webgpuRequired?: boolean
  canvasMode?: 'fixed' | 'responsive' | 'fullscreen'
  basePath?: string
  embeddedData?: {
    project?: any
    scene?: any
    scripts?: Record<string, any>
  }
  /** Called for script failures (load, init, update...) after the script is disabled */
  onScriptError?: (info: ScriptErrorInfo) => void
  onWarning?: (message: string) => void
  onInfo?: (message: string) => void
  onStats?: (stats: PlayerStats) => void
  /** Fired once the first frame has rendered */
  onStarted?: () => void
}

export class LindenPlayer {
  private canvas: HTMLCanvasElement
  private container: HTMLElement
  private config: PlayerConfig
  private world: World
  private bridge: SceneBridge
  private scene: THREE.Scene
  private defaultCamera: THREE.PerspectiveCamera
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera
  private cameraEntityId: string | null = null
  private renderer: GameRenderer | null = null
  private backend: RendererBackend = 'webgl2'
  private sim: GameSimulation
  private ui: HtmlUiLayer | null = null
  private touchControls: TouchControls | null = null
  /** ctx.touch for scripts; works (as no-op) without on-screen controls */
  readonly touch: TouchApi
  private projectData: any = null

  private isRunning: boolean = false
  private isPaused: boolean = false
  private pendingSteps: number = 0
  private lastTime: number = 0
  private animFrameId: number = 0
  private audioContext: AudioContext | null = null
  private statsFrames = 0
  private statsSince = 0
  private statsFrameMs = 0
  private startedNotified = false
  private scriptVersion = ''

  constructor(config: PlayerConfig) {
    this.config = config
    this.canvas = config.canvas
    this.container = config.container || (config.canvas.parentElement as HTMLElement) || document.body
    this.world = new World()
    this.world.initialize()
    this.bridge = new SceneBridge(this.world)
    this.sim = new GameSimulation(this.world)
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x1a1a2e)

    this.defaultCamera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000)
    this.defaultCamera.position.set(0, 5, 10)
    this.defaultCamera.lookAt(0, 0, 0)
    this.camera = this.defaultCamera
    this.touch = createTouchApi(() => this.touchControls, (msg) => this.warn(msg))
  }

  async start(): Promise<void> {
    try {
      this.updateLoadingStatus('Memuat data proyek...', 10)
      this.projectData = await this.loadProjectData()

      // 1-2. Renderer: WebGPU when the project asks for it (falls back to WebGL2), else WebGL2
      this.updateLoadingStatus('Memeriksa kapabilitas grafis...', 20)
      await this.initRenderer()

      // 3. Setup Default Lighting
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
      this.scene.add(ambientLight)

      const dirLight = new THREE.DirectionalLight(0xffffff, 0.8)
      dirLight.position.set(10, 20, 15)
      dirLight.castShadow = true
      dirLight.shadow.mapSize.width = 2048
      dirLight.shadow.mapSize.height = 2048
      this.scene.add(dirLight)

      // 4. Attach bridge to sync ECS world to Three.js scene
      this.bridge.attach(this.scene)
      this.ui = new HtmlUiLayer({
        container: this.container,
        fetchText: (src) => this.fetchText(src),
        onWarning: (msg) => this.warn(msg),
      })

      // 5. Load Project & Scene Data
      this.updateLoadingStatus('Memuat scene...', 40)
      const actions = this.projectData?.input?.actions ?? this.projectData?.inputActions
      if (Array.isArray(actions) && actions.length > 0) Input.loadActions(actions)
      const sceneData = await this.loadSceneData(this.projectData)
      // Touch controls exist before scripts run, so onInit can already show/hide buttons
      this.initInputs()

      // 6-9. Build world, physics, scripts, UI
      await this.loadWorld(sceneData)

      // 10. Hide Loading Screen
      this.updateLoadingStatus('Selesai!', 100)
      this.hideLoadingScreen()

      // 11. Start Loop
      this.isRunning = true
      this.lastTime = performance.now()
      this.statsSince = this.lastTime
      this.animFrameId = requestAnimationFrame((t) => this.gameLoop(t))

      window.addEventListener('resize', () => this.handleResize())
      this.handleResize()
    } catch (err: any) {
      this.showFatalError(err.message || 'Terjadi kesalahan saat memuat game.')
      throw err
    }
  }

  private async loadWorld(sceneData: any): Promise<void> {
    this.updateLoadingStatus('Membangun dunia game...', 60)
    // Each scene starts from the layout's own button states, optionally in its own layout
    this.touchControls?.resetState()
    const scene = typeof sceneData === 'string' ? JSON.parse(sceneData) : sceneData
    const sceneLayout = scene?.settings?.touchLayout
    if (typeof sceneLayout === 'string' && sceneLayout) this.touch.setLayout(sceneLayout)
    SceneSerializer.deserialize(typeof sceneData === 'string' ? sceneData : JSON.stringify(sceneData), this.world)
    this.resolveActiveCamera()

    this.updateLoadingStatus('Menginisialisasi simulasi fisika...', 75)
    await this.sim.initPhysics(this.projectData?.collisionMatrix)

    this.updateLoadingStatus('Memuat script game...', 85)
    const scripts = new ScriptRuntime({
      world: this.world,
      loadModule: (src) => {
        const url = this.resolveUrl(compiledScriptPath(src))
        // A new query string is a new module record, so hot reload gets the recompiled code
        return import(/* @vite-ignore */ this.scriptVersion ? `${url}?v=${this.scriptVersion}` : url)
      },
      onError: (info) => {
        if (this.config.onScriptError) this.config.onScriptError(info)
        else console.error(`[Linden] Script ${info.src} (${info.phase}) dinonaktifkan:`, info.error)
      },
      createUi: (entity) => this.ui!.apiFor(entity),
      getObject3D: (id) => this.bridge.getObject(id),
      three: THREE,
      loadScene: (path) => this.switchScene(path),
      touch: this.touch,
    })
    this.sim.scripts = scripts

    this.updateLoadingStatus('Memuat UI...', 90)
    // UI before scripts so onInit can bind to elements
    await this.ui!.loadAll(this.world, (id) => this.bridge.getObject(id))
    await scripts.loadAll()
    this.sim.startComponents()
  }

  /** Hot reload after the editor recompiled scripts/ */
  async reloadScripts(version: string): Promise<{ reloaded: number; failed: number }> {
    this.scriptVersion = version
    const res = (await this.sim.scripts?.reload()) ?? { reloaded: 0, failed: 0 }
    const msg = `Script dimuat ulang: ${res.reloaded}${res.failed ? `, gagal ${res.failed} (versi lama tetap jalan)` : ''}`
    if (this.config.onInfo) this.config.onInfo(msg)
    else console.info(`[Linden] ${msg}`)
    return res
  }

  /** Hot reload of HtmlUI fragments; empty list reloads all */
  async reloadUi(files: string[]): Promise<void> {
    const count = (await this.ui?.reloadFragments(files)) ?? 0
    if (count > 0) {
      const msg = `UI dimuat ulang: ${files.join(', ') || 'semua'}`
      if (this.config.onInfo) this.config.onInfo(msg)
      else console.info(`[Linden] ${msg}`)
    }
  }

  /** ctx.scene.load: replace the running scene with another .lscene from the project */
  async switchScene(path: string): Promise<void> {
    const wasPaused = this.isPaused
    this.isPaused = true
    this.sim.dispose()
    this.ui?.clear()
    this.world.clear()
    this.sim = new GameSimulation(this.world)
    const res = await fetch(this.resolveUrl(path))
    if (!res.ok) throw new Error(`Scene ${path} tidak ditemukan (HTTP ${res.status})`)
    await this.loadWorld(await res.text())
    this.handleResize()
    this.isPaused = wasPaused
  }

  /** First entity with an active Camera drives the view; otherwise a default camera is used */
  private resolveActiveCamera(): void {
    const camEntity = this.world.getEntities().find((e) => {
      const cam = e.getComponent('Camera') as any
      return e.active && cam && cam.isActive !== false
    })
    if (!camEntity) {
      this.cameraEntityId = null
      this.camera = this.defaultCamera
      this.warn('Tidak ada Camera aktif di scene; memakai kamera default')
      return
    }
    const cam = camEntity.getComponent('Camera') as any
    const aspect = (this.canvas.clientWidth || 16) / (this.canvas.clientHeight || 9)
    if (cam.isOrthographic) {
      const size = cam.orthoSize ?? 5
      this.camera = new THREE.OrthographicCamera(-size * aspect, size * aspect, size, -size, cam.near ?? 0.1, cam.far ?? 1000)
    } else {
      this.camera = new THREE.PerspectiveCamera(cam.fov ?? 60, aspect, cam.near ?? 0.1, cam.far ?? 1000)
    }
    this.cameraEntityId = camEntity.id
  }

  private syncCameraToEntity(): void {
    if (!this.cameraEntityId) return
    const obj = this.bridge.getObject(this.cameraEntityId)
    if (!obj) return
    obj.updateWorldMatrix(true, false)
    obj.matrixWorld.decompose(this.camera.position, this.camera.quaternion, new THREE.Vector3())
  }

  /** Horizontal facing of the game camera (radians, 0 = looking down -Z) */
  private cameraYaw(): number {
    const dir = this.camera.getWorldDirection(new THREE.Vector3())
    return Math.atan2(-dir.x, -dir.z)
  }

  private resolveUrl(rel: string): string {
    const base = this.config.basePath ? new URL(this.config.basePath, document.baseURI).href : document.baseURI
    return new URL(rel.replace(/^\/+/, ''), base).href
  }

  private async fetchText(rel: string): Promise<string> {
    const res = await fetch(this.resolveUrl(rel))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.text()
  }

  private warn(message: string): void {
    if (this.config.onWarning) this.config.onWarning(message)
    else console.warn(`[Linden] ${message}`)
  }

  private async initRenderer(): Promise<void> {
    const preference: RendererPreference = this.projectData?.renderer === 'webgpu' ? 'webgpu' : 'webgl'
    const created = await createGameRenderer(this.canvas, preference, {
      requireWebGPU: this.config.webgpuRequired,
      width: this.canvas.clientWidth || 800,
      height: this.canvas.clientHeight || 450,
    })
    this.renderer = created.renderer
    this.backend = created.backend
    if (created.fallbackReason) this.warn(created.fallbackReason)
    const label = created.backend === 'webgpu' ? 'WebGPU' : 'WebGL2'
    if (this.config.onInfo) this.config.onInfo(`Renderer: ${label}`)
    else console.info(`[Linden] Renderer: ${label}`)
  }

  private async loadProjectData(): Promise<any> {
    if (this.config.embeddedData?.project) {
      return this.config.embeddedData.project
    }
    const url = this.config.projectDataUrl || 'project.json'
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (e: any) {
      console.warn('Gagal memuat project.json via fetch, menggunakan konfigurasi default:', e.message)
      return {
        name: 'Linden Game',
        scenesInBuild: ['scenes/Main.lscene'],
      }
    }
  }

  private async loadSceneData(projectData: any): Promise<any> {
    if (this.config.embeddedData?.scene) {
      return this.config.embeddedData.scene
    }
    const sceneFile =
      this.config.sceneDataUrl ||
      projectData?.scenesInBuild?.[0] ||
      'scenes/Main.lscene'
    try {
      const res = await fetch(sceneFile)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (e: any) {
      console.warn('Gagal fetch file scene, membuat scene dasar:', e.message)
      return DEFAULT_SCENE
    }
  }

  private initInputs(): void {
    // On-screen joystick + buttons write straight into Input (Touch/Joystick, Touch/Button/<id> -> action)
    const { config, warnings } = normalizeTouchConfig(this.projectData?.input?.touch, Input.getActions())
    warnings.forEach((w) => this.warn(`Kontrol sentuh: ${w}`))
    if (shouldShowTouchControls(config)) {
      this.touchControls = new TouchControls({
        container: this.container,
        config,
        input: Input,
        resolveAsset: (path) => this.resolveUrl(path),
      })
      return
    }
    // Desktop: mouse look needs pointer lock; a click on the game grabs it (Esc releases)
    const usesMouseLook = Input.getActions().some((a) => a.bindings?.includes('Mouse/Delta'))
    if (usesMouseLook) {
      this.canvas.addEventListener('click', () => {
        if (document.pointerLockElement !== this.canvas) this.canvas.requestPointerLock?.()
      })
    }
  }

  pause(): void {
    this.isPaused = true
  }

  resume(): void {
    this.isPaused = false
    this.lastTime = performance.now()
  }

  /** Advance exactly one fixed step while paused */
  step(): void {
    this.pendingSteps++
  }

  setTimeScale(value: number): void {
    this.sim.timeScale = value
  }

  private gameLoop(time: number): void {
    if (!this.isRunning) return

    const frameDt = (time - this.lastTime) / 1000
    this.lastTime = time

    if (!this.isPaused) {
      this.sim.frame(frameDt)
    } else if (this.pendingSteps > 0) {
      this.pendingSteps--
      this.sim.frame(1 / 60)
    }

    // Scripts mutate transforms directly; push them to the scene graph before rendering
    this.bridge.syncTransforms()
    this.syncCameraToEntity()
    this.sim.viewYaw = this.cameraYaw()
    this.ui?.flush()

    if (this.renderer) {
      this.renderer.render(this.scene, this.camera)
      this.ui?.renderWorld(this.scene, this.camera)
    }

    this.reportStats(time, performance.now() - time)
    this.animFrameId = requestAnimationFrame((t) => this.gameLoop(t))
  }

  private reportStats(now: number, frameMs: number): void {
    this.statsFrames++
    this.statsFrameMs = Math.max(this.statsFrameMs, frameMs)
    if (now - this.statsSince < 500) return
    if (!this.startedNotified) {
      this.startedNotified = true
      this.config.onStarted?.()
    }
    const counts = this.renderer ? rendererStats(this.renderer) : { triangles: 0, drawCalls: 0 }
    this.config.onStats?.({
      fps: Math.round((this.statsFrames * 1000) / (now - this.statsSince)),
      frameMs: Math.round(this.statsFrameMs * 10) / 10,
      ...counts,
      renderer: this.backend,
    })
    this.statsFrames = 0
    this.statsFrameMs = 0
    this.statsSince = now
  }

  private handleResize(): void {
    if (!this.renderer) return
    const mode = this.config.canvasMode || 'responsive'

    let width = this.container.clientWidth
    let height = this.container.clientHeight

    if (mode === 'fixed') {
      width = 800
      height = 450
    } else if (mode === 'fullscreen') {
      width = window.innerWidth
      height = window.innerHeight
    }

    const aspect = width / Math.max(height, 1)
    if (this.camera instanceof THREE.PerspectiveCamera) {
      this.camera.aspect = aspect
      this.camera.updateProjectionMatrix()
    } else {
      const size = (this.camera.top - this.camera.bottom) / 2
      this.camera.left = -size * aspect
      this.camera.right = size * aspect
      this.camera.updateProjectionMatrix()
    }

    this.renderer.setSize(width, height)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.ui?.setSize(width, height)
  }

  private updateLoadingStatus(msg: string, percent: number): void {
    const bar = document.getElementById('loading-bar-fill')
    const text = document.getElementById('loading-text')
    if (bar) bar.style.width = `${percent}%`
    if (text) text.textContent = msg
  }

  private hideLoadingScreen(): void {
    const loading = document.getElementById('loading-screen')
    if (loading) {
      loading.style.opacity = '0'
      loading.style.pointerEvents = 'none'
      setTimeout(() => {
        if (loading.parentNode) loading.parentNode.removeChild(loading)
      }, 500)
    }
  }

  private showFatalError(errorMsg: string): void {
    const loading = document.getElementById('loading-screen')
    if (!loading) return
    // Built with DOM APIs: the editor's Game Frame CSP forbids inline handlers
    const box = document.createElement('div')
    box.style.cssText =
      'background: rgba(220, 38, 38, 0.2); border: 1px solid #ef4444; border-radius: 12px; padding: 24px; max-width: 480px; text-align: center; color: white; font-family: sans-serif;'
    const title = document.createElement('h2')
    title.style.cssText = 'margin: 0 0 12px; color: #f87171; font-size: 18px;'
    title.textContent = 'Gagal Memulai Game'
    const msg = document.createElement('p')
    msg.style.cssText = 'margin: 0 0 16px; font-size: 13px; line-height: 1.5; color: #fca5a5;'
    msg.textContent = errorMsg
    const retry = document.createElement('button')
    retry.style.cssText = 'background: #ef4444; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-size: 13px; cursor: pointer;'
    retry.textContent = 'Coba Lagi'
    retry.addEventListener('click', () => location.reload())
    box.append(title, msg, retry)
    loading.replaceChildren(box)
  }

  initAudio(): void {
    if (!this.audioContext && typeof AudioContext !== 'undefined') {
      this.audioContext = new AudioContext()
    }
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume()
    }
  }

  dispose(): void {
    this.isRunning = false
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId)
    }
    this.touchControls?.destroy()
    this.sim.dispose()
    this.ui?.dispose()
    this.bridge.detach()
    this.renderer?.dispose()
  }
}
