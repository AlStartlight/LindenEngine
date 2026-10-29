import * as THREE from 'three'
import { World } from '../engine/ecs/World'
import { SceneBridge } from '../engine/scene/SceneBridge'
import { SceneSerializer } from '../engine/scene/serializer'
import { createWebGLRenderer } from '../engine/renderer/createRenderer'
import { ScenePipeline } from '../engine/renderer/sceneFactory'
import { AssetLoader } from '../engine/assets/AssetLoader'
import { resolveQuality } from '../engine/scene/SceneSettings'
import '../engine/ecs/ComponentRegistry'

/**
 * Offscreen render preview for linden_render_preview: loads a scene through the same World +
 * SceneBridge + ScenePipeline as the player, frames the scene or one entity, and renders it from
 * front, side, top and 3/4. Electron reads the result from window.__lindenPreview.
 * Served at linden-game://play/<session>/__linden/runtime/preview.html?scene=...&entity=...
 */

type View = 'front' | 'side' | 'top' | 'threeQuarter'

const DIRECTIONS: Record<View, THREE.Vector3> = {
  front: new THREE.Vector3(0, 0.08, 1),
  side: new THREE.Vector3(1, 0.08, 0),
  top: new THREE.Vector3(0, 1, 0.0001),
  threeQuarter: new THREE.Vector3(1, 0.65, 1),
}

const nextFrame = () => new Promise<void>((r) => setTimeout(r, 0))

async function run() {
  const q = new URLSearchParams(location.search)
  const scenePath = q.get('scene') || 'scenes/Main.lscene'
  const entityId = q.get('entity') || ''
  const size = Math.min(1024, Math.max(128, Number(q.get('size')) || 512))
  const views = (q.get('views') || 'front,side,top,threeQuarter').split(',').filter((v): v is View => v in DIRECTIONS)
  const isolate = q.get('isolate') === '1'
  const warnings: string[] = []
  const warn = (m: string) => warnings.push(m)

  // Project root of the session: .../<session>/__linden/runtime/preview.html → .../<session>/
  const root = new URL('../../', location.href)
  const resolveUrl = (rel: string) => new URL(rel.replace(/^\/+/, ''), root).href

  const project = await fetch(resolveUrl('project.linden.json'))
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}))
  const sceneRes = await fetch(resolveUrl(scenePath))
  if (!sceneRes.ok) throw new Error(`Scene ${scenePath} tidak ditemukan (HTTP ${sceneRes.status})`)

  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  const renderer = createWebGLRenderer(canvas, size, size, { preserveDrawingBuffer: true }).renderer as unknown as THREE.WebGLRenderer
  const world = new World()
  SceneSerializer.deserialize(await sceneRes.text(), world)
  const scene = new THREE.Scene()
  const assets = new AssetLoader({ resolveUrl, decoderPath: new URL('decoders/', import.meta.url).href, renderer, warn })
  const pipeline = new ScenePipeline(renderer as any, scene, { backend: 'webgl2', quality: resolveQuality((project as any).quality), assets, warn })
  renderer.setPixelRatio(1)
  pipeline.setSize(size, size)
  pipeline.applySettings(world.getSceneSettings())
  const bridge = new SceneBridge(world)
  bridge.attach(scene, { assets, allowTransmission: pipeline.caps.transmission, warn })
  await assets.whenIdle()
  await pipeline.whenReady()

  let target: THREE.Object3D = scene
  if (entityId) {
    const obj = bridge.getObject(entityId)
    if (!obj) throw new Error(`Entity "${entityId}" tidak ada di ${scenePath}`)
    target = obj
  }
  scene.updateMatrixWorld(true)
  const meshBounds = (root: THREE.Object3D) => {
    const b = new THREE.Box3()
    root.traverseVisible((o) => {
      if ((o as THREE.Mesh).isMesh) b.union(new THREE.Box3().setFromObject(o))
    })
    return b
  }
  const isFloorLike = (b: THREE.Box3) => {
    const s = b.getSize(new THREE.Vector3())
    return !b.isEmpty() && s.y < Math.max(s.x, s.z) * 0.2
  }
  let bounds = new THREE.Box3()
  if (entityId) bounds = meshBounds(target)
  else {
    // Whole scene: frame the objects, not the floor/terrain they stand on
    for (const ent of world.getEntities()) {
      const obj = bridge.getObject(ent.id)
      if (!obj || ent.parentId) continue
      const b = meshBounds(obj)
      if (!isFloorLike(b)) bounds.union(b)
    }
    if (bounds.isEmpty()) bounds = meshBounds(scene)
  }
  if (bounds.isEmpty()) throw new Error('Tidak ada mesh untuk dirender')

  // Triangles drawn (post-processing passes reset renderer.info, so count the scene)
  let triangles = 0
  scene.traverseVisible((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const g = mesh.geometry
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3
    triangles += tris * ((mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1)
  })

  if (isolate && entityId) {
    // Keep only the target and flat floor-like entities right under it
    for (const ent of world.getEntities()) {
      const obj = bridge.getObject(ent.id)
      if (!obj || obj === target || ent.parentId) continue
      let isAncestor = false
      target.traverseAncestors((a) => (isAncestor ||= a === obj))
      if (isAncestor) continue
      const b = meshBounds(obj)
      obj.visible = isFloorLike(b) && b.max.y <= bounds.min.y + 0.05
    }
  }

  const sphere = bounds.getBoundingSphere(new THREE.Sphere())
  const fov = 30
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.01, 1000)
  const distance = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(fov / 2))) * 1.08
  camera.near = Math.max(0.005, distance / 200)
  camera.far = distance * 4 + sphere.radius * 4

  const images: { view: View; dataUrl: string }[] = []
  for (const view of views) {
    const dir = DIRECTIONS[view].clone().normalize()
    camera.position.copy(sphere.center).addScaledVector(dir, distance)
    camera.up.set(0, 1, 0)
    if (view === 'top') camera.up.set(0, 0, -1)
    camera.lookAt(sphere.center)
    camera.updateProjectionMatrix()
    // The first render compiles shaders and starts post-processing; wait for it, then render the shot
    pipeline.render(camera)
    await pipeline.whenReady()
    await nextFrame()
    pipeline.render(camera)
    images.push({ view, dataUrl: canvas.toDataURL('image/png') })
  }

  const s = bounds.getSize(new THREE.Vector3())
  bridge.dispose()
  pipeline.dispose()
  assets.dispose()
  renderer.dispose()
  return { images, size: [s.x, s.y, s.z].map((n) => Math.round(n * 1000) / 1000), triangles: Math.round(triangles), warnings }
}

;(window as any).__lindenPreview = run().catch((err) => ({ error: String(err?.message ?? err) }))
