import React, { useRef, useEffect, useState, useCallback } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { HierarchyItem } from '../panels/HierarchyPanel'
import { SceneFile } from '../../engine/scene'
import { createWebGLRenderer } from '../../engine/renderer/createRenderer'
import { ScenePipeline } from '../../engine/renderer/sceneFactory'
import { AssetLoader } from '../../engine/assets/AssetLoader'
import { resolveQuality } from '../../engine/scene/SceneSettings'
import { projectAssetUrl } from '../../shared/assetProtocol'
import { useEditorStore } from '../store/editorStore'
import { setPropertyCommand } from '../commands/entityCommands'
import { GameFrame, GameFrameStats } from './GameFrame'
import { HtmlUiPreview } from './HtmlUiPreview'

interface SceneViewportProps {
  onSelectObject?: (object: THREE.Object3D | null) => void
  selectedObjectId?: string | null
  includeSampleObjects?: boolean
  initialScene?: SceneFile
  onTransformObject?: (object: THREE.Object3D) => void
  onSceneModified?: () => void
  onObjectsChange?: (items: HierarchyItem[]) => void
  /** Console sink for game logs/errors while Play runs in the Game Frame */
  onConsoleMessage?: (type: 'info' | 'warn' | 'error', message: string) => void
}

type TransformMode = 'translate' | 'rotate' | 'scale'
type ViewMode = 'perspective' | 'top' | 'front' | 'right'

export const SceneViewport: React.FC<SceneViewportProps> = ({
  onSelectObject,
  selectedObjectId,
  initialScene,
  onTransformObject,
  onSceneModified,
  onConsoleMessage,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | THREE.OrthographicCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const pipelineRef = useRef<ScenePipeline | null>(null)
  const consoleRef = useRef(onConsoleMessage)
  consoleRef.current = onConsoleMessage
  const orbitControlsRef = useRef<OrbitControls | null>(null)
  const transformControlsRef = useRef<TransformControls | null>(null)
  const gridRef = useRef<THREE.GridHelper | null>(null)
  const animationFrameRef = useRef<number>(0)

  const {
    world,
    bridge,
    selectedEntityIds,
    selectEntity,
    executeCommand,
    playState,
    stepPlay,
    playSession,
    projectRuntime,
  } = useEditorStore()

  const [transformMode, setTransformMode] = useState<TransformMode>('translate')
  const [is2DMode, setIs2DMode] = useState(false)
  const [stats, setStats] = useState({ fps: 0, triangles: 0, drawCalls: 0 })
  const [gameStats, setGameStats] = useState<GameFrameStats | null>(null)
  const [showUiPreview, setShowUiPreview] = useState(true)

  useEffect(() => {
    if (!playSession) setGameStats(null)
  }, [playSession])

  // Transform controls attaching to selected entity
  const primarySelectedId = selectedEntityIds[0] || selectedObjectId || null

  useEffect(() => {
    const transformControls = transformControlsRef.current
    if (!transformControls) return

    if (primarySelectedId) {
      const obj = bridge.getObject(primarySelectedId)
      if (obj) {
        transformControls.attach(obj)
      } else {
        transformControls.detach()
      }
    } else {
      transformControls.detach()
    }
  }, [primarySelectedId, bridge])

  // Set transform mode
  useEffect(() => {
    const transformControls = transformControlsRef.current
    if (transformControls) {
      transformControls.setMode(transformMode)
    }
  }, [transformMode])

  // Switch 2D / 3D Mode
  const toggle2DMode = useCallback(() => {
    const container = containerRef.current
    const scene = sceneRef.current
    if (!container || !scene) return

    const nextMode = !is2DMode
    setIs2DMode(nextMode)

    const aspect = container.clientWidth / container.clientHeight
    const orbit = orbitControlsRef.current

    if (nextMode) {
      // 2D Orthographic mode
      const frustumSize = 10
      const orthoCamera = new THREE.OrthographicCamera(
        (frustumSize * aspect) / -2,
        (frustumSize * aspect) / 2,
        frustumSize / 2,
        frustumSize / -2,
        0.1,
        1000
      )
      orthoCamera.position.set(0, 0, 20)
      orthoCamera.lookAt(0, 0, 0)
      cameraRef.current = orthoCamera

      if (orbit) {
        orbit.object = orthoCamera
        orbit.enableRotate = false // Disable rotation in 2D
        orbit.target.set(0, 0, 0)
        orbit.update()
      }

      if (transformControlsRef.current) {
        transformControlsRef.current.camera = orthoCamera
        transformControlsRef.current.showZ = false // 2D only X and Y
      }
    } else {
      // 3D Perspective mode
      const persCamera = new THREE.PerspectiveCamera(60, aspect, 0.1, 10000)
      persCamera.position.set(10, 10, 10)
      persCamera.lookAt(0, 0, 0)
      cameraRef.current = persCamera

      if (orbit) {
        orbit.object = persCamera
        orbit.enableRotate = true
        orbit.target.set(0, 0, 0)
        orbit.update()
      }

      if (transformControlsRef.current) {
        transformControlsRef.current.camera = persCamera
        transformControlsRef.current.showZ = true
      }
    }
  }, [is2DMode])

  // Initialize Three.js Scene and SceneBridge
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const canvas = document.createElement('canvas')
    canvas.className = 'block w-full h-full'
    container.prepend(canvas)
    canvasRef.current = canvas

    const scene = new THREE.Scene()
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      10000
    )
    camera.position.set(10, 10, 10)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera

    // Same renderer setup, scene settings pipeline and asset loading as the player (sceneFactory.ts)
    const renderer = createWebGLRenderer(canvas, container.clientWidth, container.clientHeight).renderer as unknown as THREE.WebGLRenderer
    rendererRef.current = renderer
    const warn = (msg: string) => consoleRef.current?.('warn', msg)
    const assets = new AssetLoader({
      resolveUrl: projectAssetUrl,
      decoderPath: new URL('decoders/', document.baseURI).href,
      renderer,
      warn,
    })
    const pipeline = new ScenePipeline(renderer as any, scene, {
      backend: 'webgl2',
      quality: resolveQuality(useEditorStore.getState().projectSettings.quality),
      assets,
      warn,
    })
    pipeline.setSize(container.clientWidth, container.clientHeight)
    pipeline.applySettings(world.getSceneSettings())
    pipelineRef.current = pipeline
    const offSettings = world.events.on('sceneSettingsChanged', (s: any) => pipeline.applySettings(s))

    const orbitControls = new OrbitControls(camera, canvas)
    orbitControls.enableDamping = true
    orbitControls.dampingFactor = 0.05
    orbitControls.screenSpacePanning = true
    orbitControlsRef.current = orbitControls

    const transformControls = new TransformControls(camera, canvas)
    transformControls.setMode(transformMode)
    transformControls.addEventListener('dragging-changed', (event) => {
      orbitControls.enabled = !event.value
    })

    // On dragging transform controls, dispatch SetPropertyCommand
    transformControls.addEventListener('objectChange', () => {
      onSceneModified?.()
      const targetObj = transformControls.object
      if (!targetObj) return

      const entityId = bridge.getEntityId(targetObj)
      if (!entityId) return

      const euler = new THREE.Euler().setFromQuaternion(targetObj.quaternion)

      executeCommand(
        setPropertyCommand(
          entityId,
          'Transform',
          'position',
          [targetObj.position.x, targetObj.position.y, targetObj.position.z],
          undefined,
          `gizmo:pos:${entityId}`
        )
      )
      executeCommand(
        setPropertyCommand(
          entityId,
          'Transform',
          'rotation',
          [
            THREE.MathUtils.radToDeg(euler.x),
            THREE.MathUtils.radToDeg(euler.y),
            THREE.MathUtils.radToDeg(euler.z),
          ],
          undefined,
          `gizmo:rot:${entityId}`
        )
      )
      executeCommand(
        setPropertyCommand(
          entityId,
          'Transform',
          'scale',
          [targetObj.scale.x, targetObj.scale.y, targetObj.scale.z],
          undefined,
          `gizmo:scale:${entityId}`
        )
      )

      onTransformObject?.(targetObj)
    })

    // three r169+: TransformControls is not an Object3D; its gizmo lives in getHelper()
    const transformGizmo = transformControls.getHelper()
    transformGizmo.userData.editorHelper = true
    scene.add(transformGizmo)
    transformControlsRef.current = transformControls

    // Grid
    const grid = new THREE.GridHelper(100, 100, 0x444444, 0x333333)
    grid.userData.editorHelper = true
    scene.add(grid)
    gridRef.current = grid

    // Lights, environment and shadows come from the scene settings (ScenePipeline)
    bridge.attach(scene, { assets, allowTransmission: pipeline.caps.transmission, warn })

    // Raycast on click to select entity
    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2()

    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1

      if (!cameraRef.current) return
      raycaster.setFromCamera(mouse, cameraRef.current)

      // Only intersect meshes attached to entities
      const objectsToTest: THREE.Object3D[] = []
      scene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh && child !== gridRef.current) {
          objectsToTest.push(child)
        }
      })

      const intersects = raycaster.intersectObjects(objectsToTest, true)
      if (intersects.length > 0) {
        const hit = intersects[0].object
        const entId = bridge.getEntityId(hit)
        if (entId) {
          selectEntity(entId, e.ctrlKey || e.metaKey || e.shiftKey)
          onSelectObject?.(hit)
        } else {
          selectEntity(null)
          onSelectObject?.(null)
        }
      } else {
        selectEntity(null)
        onSelectObject?.(null)
      }
    }

    canvas.addEventListener('click', handleClick)

    // Resize handler
    const handleResize = () => {
      if (!container || !rendererRef.current || !cameraRef.current) return
      const w = container.clientWidth
      const h = container.clientHeight
      pipeline.setSize(w, h)
      if (cameraRef.current instanceof THREE.PerspectiveCamera) {
        cameraRef.current.aspect = w / h
        cameraRef.current.updateProjectionMatrix()
      } else if (cameraRef.current instanceof THREE.OrthographicCamera) {
        const frustumSize = 10
        const aspect = w / h
        cameraRef.current.left = (frustumSize * aspect) / -2
        cameraRef.current.right = (frustumSize * aspect) / 2
        cameraRef.current.top = frustumSize / 2
        cameraRef.current.bottom = frustumSize / -2
        cameraRef.current.updateProjectionMatrix()
      }
    }

    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(container)

    // Keyboard Shortcuts: Q/W/E/R
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || '').toLowerCase()
      if (activeTag === 'input' || activeTag === 'textarea') return

      if (e.key.toLowerCase() === 'w') setTransformMode('translate')
      else if (e.key.toLowerCase() === 'e') setTransformMode('rotate')
      else if (e.key.toLowerCase() === 'r') setTransformMode('scale')
    }
    window.addEventListener('keydown', handleKeyDown)

    // Render loop
    let lastTime = performance.now()
    let frameCount = 0
    let lastFpsUpdate = performance.now()

    const animate = (time: number) => {
      animationFrameRef.current = requestAnimationFrame(animate)

      const dt = Math.min((time - lastTime) / 1000, 0.1)
      lastTime = time

      const editorState = useEditorStore.getState()
      // The Game Frame renders the game itself; don't spend GPU on the hidden editor scene
      if (editorState.playSession) return

      // Legacy in-editor play: step the simulation here
      if (editorState.playState === 'playing') {
        stepPlay()
      }

      orbitControls.update()
      bridge.update(dt)
      if (cameraRef.current) {
        pipeline.render(cameraRef.current)
      }

      frameCount++
      if (time - lastFpsUpdate >= 500) {
        setStats({
          fps: Math.round((frameCount * 1000) / (time - lastFpsUpdate)),
          triangles: renderer.info.render.triangles,
          drawCalls: renderer.info.render.calls,
        })
        frameCount = 0
        lastFpsUpdate = time
      }
    }

    animationFrameRef.current = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(animationFrameRef.current)
      resizeObserver.disconnect()
      window.removeEventListener('keydown', handleKeyDown)
      canvas.removeEventListener('click', handleClick)
      orbitControls.dispose()
      transformControls.dispose()
      bridge.detach()
      offSettings()
      pipeline.dispose()
      pipelineRef.current = null
      assets.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
      canvasRef.current = null
    }
  }, [bridge, world])

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden select-none bg-[#1a1a2e]">
      {/* Game Frame: Play runs the real player (or HTML Game) in a sandboxed iframe */}
      {playSession && (
        <GameFrame key={playSession.id} session={playSession} onConsole={onConsoleMessage} onStats={setGameStats} />
      )}

      {/* Play Mode Overlay (SPEC §5, §7): border only over the Game Frame so game colors stay true */}
      {playState !== 'stopped' && (
        <div
          className="absolute inset-0 pointer-events-none z-40 transition-opacity"
          style={{
            backgroundColor: playSession ? 'transparent' : 'rgba(58, 58, 90, 0.2)',
            border: `2px solid ${playState === 'paused' ? 'rgba(234, 179, 8, 0.7)' : 'rgba(59, 130, 246, 0.5)'}`,
          }}
        />
      )}

      {/* HTML UI preview in edit mode */}
      {playState === 'stopped' && showUiPreview && projectRuntime === 'scene' && <HtmlUiPreview />}

      {/* HTML Game projects have no editable scene: the game is the project's own page */}
      {playState === 'stopped' && projectRuntime === 'html' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#11111d]">
          <div className="max-w-sm text-center text-sm text-gray-300 px-6">
            <div className="text-base font-semibold text-white mb-2">HTML Game</div>
            <p className="text-gray-400 mb-1">Scene dikelola oleh kode game di folder web proyek.</p>
            <p className="text-gray-400">Tekan <span className="text-white font-medium">Play</span> untuk menjalankan game di viewport.</p>
          </div>
        </div>
      )}

      {/* Top Viewport Controls (edit tools; hidden while the Game Frame owns the viewport) */}
      <div
        className={`absolute top-2 left-2 z-30 flex items-center gap-1.5 bg-black/60 backdrop-blur-xs rounded-lg p-1 border border-gray-700/60 text-xs ${
          playSession || projectRuntime === 'html' ? 'hidden' : ''
        }`}
      >
        {/* 2D / 3D Toggle (TC-F27-01) */}
        <button
          className={`px-2 py-1 rounded font-bold transition-colors ${
            is2DMode ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-white/10'
          }`}
          onClick={toggle2DMode}
        >
          2D
        </button>

        <div className="w-px h-4 bg-gray-700/60" />

        <button
          className={`px-2 py-1 rounded text-xs transition-colors ${
            transformMode === 'translate' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-white/10'
          }`}
          onClick={() => setTransformMode('translate')}
          title="Move (W)"
        >
          Move (W)
        </button>
        <button
          className={`px-2 py-1 rounded text-xs transition-colors ${
            transformMode === 'rotate' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-white/10'
          }`}
          onClick={() => setTransformMode('rotate')}
          title="Rotate (E)"
        >
          Rotate (E)
        </button>
        <button
          className={`px-2 py-1 rounded text-xs transition-colors ${
            transformMode === 'scale' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-white/10'
          }`}
          onClick={() => setTransformMode('scale')}
          title="Scale (R)"
        >
          Scale (R)
        </button>

        <div className="w-px h-4 bg-gray-700/60" />

        <button
          className={`px-2 py-1 rounded text-xs transition-colors ${
            showUiPreview ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-white/10'
          }`}
          onClick={() => setShowUiPreview((v) => !v)}
          title="Tampilkan pratinjau HTML UI"
        >
          UI
        </button>
      </div>

      {/* Stats Overlay */}
      <div className="absolute bottom-2 left-2 z-50 bg-black/60 backdrop-blur-xs px-2.5 py-1 rounded border border-gray-700/50 text-[10px] text-gray-400 font-mono flex items-center gap-3">
        {playSession ? (
          <>
            <span className="text-blue-300">Game</span>
            {gameStats?.renderer && <span className="text-emerald-300">{gameStats.renderer === 'webgpu' ? 'WebGPU' : 'WebGL2'}</span>}
            <span>{gameStats?.fps ?? 0} FPS</span>
            <span>{gameStats?.frameMs ?? 0} ms</span>
            {gameStats?.triangles !== undefined && <span>{gameStats.triangles} Tris</span>}
            {gameStats?.drawCalls !== undefined && <span>{gameStats.drawCalls} Batches</span>}
          </>
        ) : (
          <>
            <span>{stats.fps} FPS</span>
            <span>{stats.triangles} Tris</span>
            <span>{stats.drawCalls} Batches</span>
          </>
        )}
      </div>
    </div>
  )
}

export default SceneViewport
