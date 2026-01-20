import React, { useRef, useEffect, useState, useCallback } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'

interface SceneViewportProps {
  onSelectObject?: (object: THREE.Object3D | null) => void
  selectedObjectId?: string | null
}

type TransformMode = 'translate' | 'rotate' | 'scale'
type ViewMode = 'perspective' | 'top' | 'front' | 'right'

export const SceneViewport: React.FC<SceneViewportProps> = ({ 
  onSelectObject,
  selectedObjectId 
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const orbitControlsRef = useRef<OrbitControls | null>(null)
  const transformControlsRef = useRef<TransformControls | null>(null)
  const gridRef = useRef<THREE.GridHelper | null>(null)
  const animationFrameRef = useRef<number>(0)
  const objectsRef = useRef<Map<string, THREE.Object3D>>(new Map())

  const [transformMode, setTransformMode] = useState<TransformMode>('translate')
  const [viewMode, setViewMode] = useState<ViewMode>('perspective')
  const [showGrid, setShowGrid] = useState(true)
  const [showWireframe, setShowWireframe] = useState(false)
  const [stats, setStats] = useState({ fps: 0, triangles: 0, drawCalls: 0 })
  const [isInitialized, setIsInitialized] = useState(false)

  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return

    const container = containerRef.current
    const canvas = canvasRef.current

    // Scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1a1a2e)
    sceneRef.current = scene

    // Camera
    const camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      10000
    )
    camera.position.set(10, 10, 10)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    })
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1
    rendererRef.current = renderer

    // Orbit Controls - enables 360 degree rotation
    const orbitControls = new OrbitControls(camera, canvas)
    orbitControls.enableDamping = true
    orbitControls.dampingFactor = 0.05
    orbitControls.screenSpacePanning = true
    orbitControls.minDistance = 1
    orbitControls.maxDistance = 500
    orbitControls.maxPolarAngle = Math.PI
    orbitControlsRef.current = orbitControls

    // Transform Controls
    const transformControls = new TransformControls(camera, canvas)
    transformControls.setMode('translate')
    transformControls.addEventListener('dragging-changed', (event) => {
      orbitControls.enabled = !event.value
    })
    scene.add(transformControls)
    transformControlsRef.current = transformControls

    // Grid
    const grid = new THREE.GridHelper(100, 100, 0x444444, 0x333333)
    scene.add(grid)
    gridRef.current = grid

    // Axes helper
    const axesHelper = new THREE.AxesHelper(5)
    scene.add(axesHelper)

    // Ambient Light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4)
    scene.add(ambientLight)

    // Directional Light (main light)
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1)
    directionalLight.position.set(50, 50, 50)
    directionalLight.castShadow = true
    directionalLight.shadow.mapSize.width = 2048
    directionalLight.shadow.mapSize.height = 2048
    directionalLight.shadow.camera.near = 0.5
    directionalLight.shadow.camera.far = 500
    directionalLight.shadow.camera.left = -50
    directionalLight.shadow.camera.right = 50
    directionalLight.shadow.camera.top = 50
    directionalLight.shadow.camera.bottom = -50
    scene.add(directionalLight)

    // Hemisphere light for better ambient
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.3)
    hemiLight.position.set(0, 100, 0)
    scene.add(hemiLight)

    // Add sample objects
    addSampleObjects(scene)

    setIsInitialized(true)

    // Animation loop
    let lastTime = performance.now()
    let frameCount = 0
    let fpsTime = 0

    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate)

      const currentTime = performance.now()
      frameCount++

      if (currentTime - fpsTime >= 1000) {
        setStats({
          fps: Math.round(frameCount * 1000 / (currentTime - fpsTime)),
          triangles: renderer.info.render.triangles,
          drawCalls: renderer.info.render.calls,
        })
        frameCount = 0
        fpsTime = currentTime
      }

      lastTime = currentTime

      orbitControls.update()
      renderer.render(scene, camera)
    }

    animate()

    // Handle resize
    const handleResize = () => {
      if (!container) return
      const width = container.clientWidth
      const height = container.clientHeight

      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }

    window.addEventListener('resize', handleResize)
    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(container)

    // Handle object selection via raycasting
    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2()

    const handleClick = (event: MouseEvent) => {
      if (!container || !camera || !scene) return
      
      const rect = container.getBoundingClientRect()
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      raycaster.setFromCamera(mouse, camera)
      
      const selectableObjects = scene.children.filter(
        obj => obj.userData.selectable && obj.visible
      )
      
      const intersects = raycaster.intersectObjects(selectableObjects, true)

      if (intersects.length > 0) {
        let selectedObject = intersects[0].object
        // Get top-level parent if nested
        while (selectedObject.parent && selectedObject.parent !== scene) {
          if (selectedObject.parent.userData.selectable) {
            selectedObject = selectedObject.parent
          } else {
            break
          }
        }
        
        transformControls.attach(selectedObject)
        onSelectObject?.(selectedObject)
      } else {
        transformControls.detach()
        onSelectObject?.(null)
      }
    }

    canvas.addEventListener('click', handleClick)

    // Cleanup
    return () => {
      cancelAnimationFrame(animationFrameRef.current)
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
      canvas.removeEventListener('click', handleClick)
      
      orbitControls.dispose()
      transformControls.dispose()
      renderer.dispose()
      
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose()
          if (Array.isArray(object.material)) {
            object.material.forEach(m => m.dispose())
          } else {
            object.material.dispose()
          }
        }
      })
    }
  }, [onSelectObject])

  // Add sample objects to demonstrate 3D editing
  const addSampleObjects = (scene: THREE.Scene) => {
    // Ground plane
    const groundGeo = new THREE.PlaneGeometry(100, 100)
    const groundMat = new THREE.MeshStandardMaterial({ 
      color: 0x333333,
      roughness: 0.8,
      metalness: 0.2,
    })
    const ground = new THREE.Mesh(groundGeo, groundMat)
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.01
    ground.receiveShadow = true
    ground.userData = { name: 'Ground', selectable: false }
    scene.add(ground)

    // Sample Cube
    const cubeGeo = new THREE.BoxGeometry(2, 2, 2)
    const cubeMat = new THREE.MeshStandardMaterial({ 
      color: 0x00aaff,
      roughness: 0.5,
      metalness: 0.5,
    })
    const cube = new THREE.Mesh(cubeGeo, cubeMat)
    cube.position.set(0, 1, 0)
    cube.castShadow = true
    cube.receiveShadow = true
    cube.userData = { id: 'cube-1', name: 'Cube', selectable: true, type: 'primitive' }
    scene.add(cube)
    objectsRef.current.set('cube-1', cube)

    // Sample Sphere
    const sphereGeo = new THREE.SphereGeometry(1, 32, 32)
    const sphereMat = new THREE.MeshStandardMaterial({ 
      color: 0xff6600,
      roughness: 0.3,
      metalness: 0.7,
    })
    const sphere = new THREE.Mesh(sphereGeo, sphereMat)
    sphere.position.set(5, 1, 0)
    sphere.castShadow = true
    sphere.receiveShadow = true
    sphere.userData = { id: 'sphere-1', name: 'Sphere', selectable: true, type: 'primitive' }
    scene.add(sphere)
    objectsRef.current.set('sphere-1', sphere)

    // Sample Cylinder
    const cylinderGeo = new THREE.CylinderGeometry(0.5, 0.5, 3, 32)
    const cylinderMat = new THREE.MeshStandardMaterial({ 
      color: 0x00ff88,
      roughness: 0.4,
      metalness: 0.6,
    })
    const cylinder = new THREE.Mesh(cylinderGeo, cylinderMat)
    cylinder.position.set(-5, 1.5, 0)
    cylinder.castShadow = true
    cylinder.receiveShadow = true
    cylinder.userData = { id: 'cylinder-1', name: 'Cylinder', selectable: true, type: 'primitive' }
    scene.add(cylinder)
    objectsRef.current.set('cylinder-1', cylinder)

    // Sample Torus
    const torusGeo = new THREE.TorusGeometry(1, 0.4, 16, 100)
    const torusMat = new THREE.MeshStandardMaterial({ 
      color: 0xff00ff,
      roughness: 0.2,
      metalness: 0.8,
    })
    const torus = new THREE.Mesh(torusGeo, torusMat)
    torus.position.set(0, 1, 5)
    torus.castShadow = true
    torus.receiveShadow = true
    torus.userData = { id: 'torus-1', name: 'Torus', selectable: true, type: 'primitive' }
    scene.add(torus)
    objectsRef.current.set('torus-1', torus)

    // Sample Cone
    const coneGeo = new THREE.ConeGeometry(1, 2, 32)
    const coneMat = new THREE.MeshStandardMaterial({ 
      color: 0xffff00,
      roughness: 0.5,
      metalness: 0.5,
    })
    const cone = new THREE.Mesh(coneGeo, coneMat)
    cone.position.set(0, 1, -5)
    cone.castShadow = true
    cone.receiveShadow = true
    cone.userData = { id: 'cone-1', name: 'Cone', selectable: true, type: 'primitive' }
    scene.add(cone)
    objectsRef.current.set('cone-1', cone)
  }

  // Update transform mode
  useEffect(() => {
    if (transformControlsRef.current) {
      transformControlsRef.current.setMode(transformMode)
    }
  }, [transformMode])

  // Update grid visibility
  useEffect(() => {
    if (gridRef.current) {
      gridRef.current.visible = showGrid
    }
  }, [showGrid])

  // Handle view mode changes
  useEffect(() => {
    if (!cameraRef.current || !orbitControlsRef.current) return

    const camera = cameraRef.current
    const controls = orbitControlsRef.current

    switch (viewMode) {
      case 'top':
        camera.position.set(0, 50, 0.001)
        controls.target.set(0, 0, 0)
        break
      case 'front':
        camera.position.set(0, 5, 50)
        controls.target.set(0, 5, 0)
        break
      case 'right':
        camera.position.set(50, 5, 0)
        controls.target.set(0, 5, 0)
        break
      case 'perspective':
      default:
        camera.position.set(10, 10, 10)
        controls.target.set(0, 0, 0)
        break
    }

    camera.updateProjectionMatrix()
    controls.update()
  }, [viewMode])

  // Focus on selected object
  const focusOnSelected = useCallback(() => {
    if (!transformControlsRef.current?.object || !cameraRef.current || !orbitControlsRef.current) return

    const object = transformControlsRef.current.object
    const box = new THREE.Box3().setFromObject(object)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    const fov = cameraRef.current.fov * (Math.PI / 180)
    const distance = maxDim / (2 * Math.tan(fov / 2)) * 2

    cameraRef.current.position.copy(center).add(new THREE.Vector3(distance, distance, distance))
    orbitControlsRef.current.target.copy(center)
    orbitControlsRef.current.update()
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return

      switch (event.key.toLowerCase()) {
        case 'w':
          setTransformMode('translate')
          break
        case 'e':
          setTransformMode('rotate')
          break
        case 'r':
          setTransformMode('scale')
          break
        case 'f':
          focusOnSelected()
          break
        case 'g':
          setShowGrid(prev => !prev)
          break
        case 'delete':
        case 'backspace':
          if (transformControlsRef.current?.object) {
            const obj = transformControlsRef.current.object
            transformControlsRef.current.detach()
            obj.parent?.remove(obj)
            onSelectObject?.(null)
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [focusOnSelected, onSelectObject])

  return (
    <div ref={containerRef} className="w-full h-full relative bg-[#1a1a2e]">
      <canvas ref={canvasRef} className="w-full h-full" />

      {/* Toolbar */}
      <div className="absolute top-2 left-2 flex gap-1 bg-black/60 rounded-lg p-1">
        <button
          onClick={() => setTransformMode('translate')}
          className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            transformMode === 'translate' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
          title="Move (W)"
        >
          Move
        </button>
        <button
          onClick={() => setTransformMode('rotate')}
          className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            transformMode === 'rotate' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
          title="Rotate (E)"
        >
          Rotate
        </button>
        <button
          onClick={() => setTransformMode('scale')}
          className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            transformMode === 'scale' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
          title="Scale (R)"
        >
          Scale
        </button>
        <div className="w-px bg-gray-600 mx-1" />
        <button
          onClick={() => setShowGrid(prev => !prev)}
          className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            showGrid ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
          title="Toggle Grid (G)"
        >
          Grid
        </button>
        <button
          onClick={focusOnSelected}
          className="px-3 py-1.5 rounded text-xs font-medium bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
          title="Focus Selected (F)"
        >
          Focus
        </button>
      </div>

      {/* View Mode Selector */}
      <div className="absolute top-2 right-2 flex gap-1 bg-black/60 rounded-lg p-1">
        {(['perspective', 'top', 'front', 'right'] as ViewMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={`px-2 py-1 rounded text-xs font-medium capitalize transition-colors ${
              viewMode === mode ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {mode}
          </button>
        ))}
      </div>

      {/* Stats */}
      <div className="absolute bottom-2 left-2 bg-black/70 rounded-lg px-3 py-2 text-xs font-mono">
        <div className="text-green-400">FPS: {stats.fps}</div>
        <div className="text-blue-400">Triangles: {stats.triangles.toLocaleString()}</div>
        <div className="text-yellow-400">Draw Calls: {stats.drawCalls}</div>
      </div>

      {/* Viewport Gizmo */}
      <ViewportGizmo camera={cameraRef.current} controls={orbitControlsRef.current} />

      {/* Keyboard Shortcuts Help */}
      <div className="absolute bottom-2 right-2 bg-black/60 rounded-lg px-3 py-2 text-xs text-gray-400">
        <div><span className="text-gray-300">W</span> Move</div>
        <div><span className="text-gray-300">E</span> Rotate</div>
        <div><span className="text-gray-300">R</span> Scale</div>
        <div><span className="text-gray-300">F</span> Focus</div>
        <div><span className="text-gray-300">G</span> Grid</div>
        <div><span className="text-gray-300">Del</span> Delete</div>
      </div>
    </div>
  )
}

// Viewport Gizmo Component (like Unity's scene view orientation gizmo)
interface ViewportGizmoProps {
  camera: THREE.PerspectiveCamera | null
  controls: OrbitControls | null
}

const ViewportGizmo: React.FC<ViewportGizmoProps> = ({ camera, controls }) => {
  const gizmoRef = useRef<HTMLCanvasElement>(null)
  const [hovered, setHovered] = useState<string | null>(null)

  useEffect(() => {
    if (!gizmoRef.current || !camera) return

    const canvas = gizmoRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const size = 100
    canvas.width = size
    canvas.height = size

    const animate = () => {
      requestAnimationFrame(animate)

      ctx.clearRect(0, 0, size, size)

      // Get camera direction
      const dir = new THREE.Vector3()
      camera.getWorldDirection(dir)

      // Get camera up
      const up = camera.up.clone()

      // Calculate right vector
      const right = new THREE.Vector3().crossVectors(dir, up).normalize()

      // Recalculate up to ensure orthogonality
      const realUp = new THREE.Vector3().crossVectors(right, dir).normalize()

      const center = size / 2
      const axisLength = 35

      // Project axes
      const axes = [
        { color: '#ff4444', label: 'X', dir: new THREE.Vector3(1, 0, 0) },
        { color: '#44ff44', label: 'Y', dir: new THREE.Vector3(0, 1, 0) },
        { color: '#4444ff', label: 'Z', dir: new THREE.Vector3(0, 0, 1) },
      ]

      // Sort by depth for proper drawing order
      const sortedAxes = axes.map(axis => {
        const projected = axis.dir.clone()
        const x = -projected.dot(right)
        const y = projected.dot(realUp)
        const z = -projected.dot(dir)
        return { ...axis, x, y, z }
      }).sort((a, b) => a.z - b.z)

      // Draw negative axes first (behind)
      sortedAxes.forEach(axis => {
        if (axis.z < 0) {
          ctx.beginPath()
          ctx.moveTo(center, center)
          ctx.lineTo(center - axis.x * axisLength * 0.5, center - axis.y * axisLength * 0.5)
          ctx.strokeStyle = axis.color + '40'
          ctx.lineWidth = 2
          ctx.stroke()
        }
      })

      // Draw positive axes
      sortedAxes.forEach(axis => {
        const endX = center + axis.x * axisLength
        const endY = center - axis.y * axisLength

        ctx.beginPath()
        ctx.moveTo(center, center)
        ctx.lineTo(endX, endY)
        ctx.strokeStyle = axis.color
        ctx.lineWidth = 2
        ctx.stroke()

        // Draw axis label
        ctx.fillStyle = axis.color
        ctx.font = 'bold 12px Arial'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(axis.label, endX + axis.x * 8, endY - axis.y * 8)
      })

      // Draw center sphere
      ctx.beginPath()
      ctx.arc(center, center, 4, 0, Math.PI * 2)
      ctx.fillStyle = '#888'
      ctx.fill()
    }

    animate()
  }, [camera])

  return (
    <div className="absolute bottom-20 left-2">
      <canvas
        ref={gizmoRef}
        className="rounded-lg bg-black/50 cursor-pointer"
        style={{ width: 80, height: 80 }}
      />
    </div>
  )
}

export default SceneViewport
