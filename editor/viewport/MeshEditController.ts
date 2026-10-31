import * as THREE from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import type { World } from '../../engine/ecs/World'
import { decodeHalfEdgeMesh, encodeHalfEdgeMesh } from '../../engine/mesh/core/encoding'
import type { GeomResult } from '../../engine/mesh/core/result'
import { MeshEditor } from '../../engine/mesh/modeling/MeshEditor'
import type { TransformSpec } from '../../engine/mesh/modeling/ops'
import { MeshPicker } from '../../engine/mesh/modeling/picking'
import { aliveFaces, allEdges, edgeVertices } from '../../engine/mesh/modeling/topology'
import { triangulatePolygon } from '../../engine/mesh/core/triangulate'
import { EDITABLE_MESH, editableMeshGeometry } from '../../engine/renderer/sceneFactory'
import type { SceneBridge } from '../../engine/scene/SceneBridge'
import type { EditorCommand } from '../commands/CommandStack'
import { setPropertyCommand } from '../commands/entityCommands'
import { useEditorStore, type MeshEditState } from '../store/editorStore'

export type GizmoMode = 'translate' | 'rotate' | 'scale'

export interface MeshEditDeps {
  scene: THREE.Scene
  canvas: HTMLCanvasElement
  /** Element the box-select rectangle is drawn in (the viewport container) */
  overlayRoot: HTMLElement
  getCamera: () => THREE.Camera | null
  transformControls: TransformControls
  orbitControls: OrbitControls
  bridge: SceneBridge
  world: World
  executeCommand: (cmd: EditorCommand) => void
  setGizmoMode: (mode: GizmoMode) => void
  warn: (message: string) => void
}

const SELECTED = new THREE.Color(1, 0.55, 0.1)
const VERTEX = new THREE.Color(0.08, 0.08, 0.1)
const EDGE = new THREE.Color(0.1, 0.1, 0.12)
const CLICK_SLOP_PX = 4

interface Session {
  entityId: string
  editor: MeshEditor
  picker: MeshPicker
  meshObject: THREE.Mesh
  overlay: THREE.Group
  proxy: THREE.Object3D
  savedOffset: { enabled: boolean; factor: number; units: number }
  offChange: () => void
  dragStart: { position: THREE.Vector3; quaternion: THREE.Quaternion } | null
}

/**
 * Mesh Edit Mode in the scene viewport (not React): follows `meshEdit` in the editor store, draws the
 * vertex/edge/face overlay, picks elements with the BVH, drives the transform gizmo through a pivot proxy,
 * handles box select and hotkeys, and commits the result as one undoable EditableMesh.mesh change on exit.
 * Inside Edit Mode, undo/redo walk the mesh history; outside, the edit is a single editor undo step.
 */
export class MeshEditController {
  private session: Session | null = null
  private unsubscribe: () => void
  private offWorld: (() => void)[] = []
  private pointerDown: { x: number; y: number } | null = null
  private boxArmed = false
  private box: { x0: number; y0: number; el: HTMLDivElement } | null = null

  constructor(private readonly deps: MeshEditDeps) {
    this.unsubscribe = useEditorStore.subscribe((state, prev) => {
      if (state.meshEdit?.entityId !== prev.meshEdit?.entityId) this.sync(state.meshEdit)
      else if (state.meshEdit && state.meshEdit.selectMode !== prev.meshEdit?.selectMode) {
        this.session?.editor.selection.setMode(state.meshEdit.selectMode)
        this.refreshOverlay()
      }
    })
    const abortIfGone = (entityId: string) => {
      if (this.session?.entityId === entityId) this.abort()
    }
    this.offWorld.push(
      deps.world.events.on('entityRemoved', (e: { id: string }) => abortIfGone(e.id)),
      deps.world.events.on('componentRemoved', (e: { id: string }, c: { name: string }) => {
        if (c.name === 'EditableMesh') abortIfGone(e.id)
      }),
    )
    deps.transformControls.addEventListener('dragging-changed', this.onDragging)
    deps.transformControls.addEventListener('objectChange', this.onGizmoChange)
    deps.canvas.addEventListener('pointerdown', this.onPointerDown)
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
    this.sync(useEditorStore.getState().meshEdit)
  }

  get active(): boolean {
    return this.session !== null
  }

  get editor(): MeshEditor | null {
    return this.session?.editor ?? null
  }

  dispose(): void {
    this.end(false)
    this.unsubscribe()
    for (const off of this.offWorld) off()
    this.deps.transformControls.removeEventListener('dragging-changed', this.onDragging)
    this.deps.transformControls.removeEventListener('objectChange', this.onGizmoChange)
    this.deps.canvas.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
  }

  // ---------------------------------------------------------------- session lifecycle

  private sync(state: MeshEditState | null): void {
    if (this.session && this.session.entityId !== state?.entityId) this.end(true)
    if (state && !this.session) this.start(state)
  }

  private start(state: MeshEditState): void {
    const { bridge, world, scene } = this.deps
    const comp = world.getEntity(state.entityId)?.getComponent('EditableMesh') as unknown as { mesh: unknown } | undefined
    const meshObject = bridge.getObject(state.entityId)?.getObjectByName(EDITABLE_MESH) as THREE.Mesh | undefined
    const decoded = comp ? decodeHalfEdgeMesh(comp.mesh) : null
    if (!comp || !meshObject || !decoded?.ok) {
      this.deps.warn(`Edit Mode: ${decoded && !decoded.ok ? decoded.message : 'entity has no editable mesh'}`)
      useEditorStore.getState().exitMeshEdit()
      return
    }
    const editor = new MeshEditor(decoded.value)
    editor.selection.setMode(state.selectMode)
    const overlay = new THREE.Group()
    overlay.name = '__mesh_edit_overlay__'
    overlay.userData.editorHelper = true
    meshObject.add(overlay)
    const material = meshObject.material as THREE.Material
    const savedOffset = { enabled: material.polygonOffset, factor: material.polygonOffsetFactor, units: material.polygonOffsetUnits }
    // Push the surface back a little so edges and points drawn on it win the depth test
    material.polygonOffset = true
    material.polygonOffsetFactor = 1
    material.polygonOffsetUnits = 1
    const proxy = new THREE.Object3D()
    proxy.name = '__mesh_edit_pivot__'
    proxy.userData.editorHelper = true
    scene.add(proxy)
    this.session = {
      entityId: state.entityId, editor, picker: new MeshPicker(editor.mesh), meshObject, overlay, proxy, savedOffset,
      offChange: editor.onChange(() => this.onMeshChanged()), dragStart: null,
    }
    // Edit the cage: the object may be showing its modifier result, which the overlay would not match
    this.replaceGeometry(meshObject, editor.mesh)
    this.refreshOverlay()
  }

  /** Leaves Edit Mode; with `commit`, an edited mesh is written back as one editor command */
  private end(commit: boolean): void {
    const s = this.session
    if (!s) return
    this.session = null
    s.offChange()
    this.deps.transformControls.detach()
    s.proxy.removeFromParent()
    s.overlay.removeFromParent()
    disposeGroup(s.overlay)
    const material = s.meshObject.material as THREE.Material
    material.polygonOffset = s.savedOffset.enabled
    material.polygonOffsetFactor = s.savedOffset.factor
    material.polygonOffsetUnits = s.savedOffset.units
    s.picker.dispose()
    this.cancelBox()
    if (commit && s.editor.history.canUndo && this.deps.world.getEntity(s.entityId)) {
      // The property change makes the bridge rebuild it (modifiers and shading included)
      this.deps.executeCommand(setPropertyCommand(s.entityId, 'EditableMesh', 'mesh', encodeHalfEdgeMesh(s.editor.mesh)))
    } else if (this.deps.world.getEntity(s.entityId)) {
      // Nothing to write: still show the stored mesh again (with its modifier result) instead of the cage
      this.deps.bridge.rebuildEditableMesh(s.entityId)
    }
  }

  /** The entity or its EditableMesh disappeared (scene loaded, deleted): drop the session without writing */
  private abort(): void {
    const s = this.session
    if (!s) return
    s.editor.history.clear()
    this.end(false)
    useEditorStore.getState().exitMeshEdit()
  }

  // ---------------------------------------------------------------- drawing

  private replaceGeometry(meshObject: THREE.Mesh, mesh: MeshEditor['mesh']): void {
    const old = meshObject.geometry
    meshObject.geometry = editableMeshGeometry(mesh)
    old.dispose()
  }

  private onMeshChanged(): void {
    const s = this.session
    if (!s) return
    this.replaceGeometry(s.meshObject, s.editor.mesh)
    if (s.dragStart) s.picker.refit()
    else s.picker.rebuild()
    s.editor.selection.prune()
    this.refreshOverlay()
  }

  /** Rebuilds points / edges / selected-face fill and re-places the gizmo pivot */
  refreshOverlay(): void {
    const s = this.session
    if (!s) return
    const { editor, overlay } = s
    const mesh = editor.mesh
    const sel = editor.selection
    for (const child of [...overlay.children]) {
      overlay.remove(child)
      disposeGroup(child)
    }
    const p = mesh.positions

    // Edges
    const edges = allEdges(mesh)
    const ePos = new Float32Array(edges.length * 6)
    const eCol = new Float32Array(edges.length * 6)
    edges.forEach((e, i) => {
      const [a, b] = edgeVertices(mesh, e)
      ePos.set(p.subarray(a * 3, a * 3 + 3), i * 6)
      ePos.set(p.subarray(b * 3, b * 3 + 3), i * 6 + 3)
      const c = sel.edges.has(e) ? SELECTED : EDGE
      for (const o of [0, 3]) c.toArray(eCol, i * 6 + o)
    })
    const eGeo = new THREE.BufferGeometry()
    eGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3))
    eGeo.setAttribute('color', new THREE.BufferAttribute(eCol, 3))
    const lines = new THREE.LineSegments(eGeo, new THREE.LineBasicMaterial({ vertexColors: true }))
    lines.renderOrder = 10
    overlay.add(lines)

    // Vertices (vertex mode only, as in Blender)
    if (sel.mode === 'vertex') {
      const verts: number[] = []
      for (let v = 0; v < mesh.vertexSlots; v++) if (mesh.vertexAlive[v]) verts.push(v)
      const vPos = new Float32Array(verts.length * 3)
      const vCol = new Float32Array(verts.length * 3)
      verts.forEach((v, i) => {
        vPos.set(p.subarray(v * 3, v * 3 + 3), i * 3)
        ;(sel.vertices.has(v) ? SELECTED : VERTEX).toArray(vCol, i * 3)
      })
      const vGeo = new THREE.BufferGeometry()
      vGeo.setAttribute('position', new THREE.BufferAttribute(vPos, 3))
      vGeo.setAttribute('color', new THREE.BufferAttribute(vCol, 3))
      const points = new THREE.Points(vGeo, new THREE.PointsMaterial({ size: 6, sizeAttenuation: false, vertexColors: true }))
      points.renderOrder = 11
      overlay.add(points)
    }

    // Selected faces: translucent fill
    if (sel.faces.size) {
      const tris: number[] = []
      const scratch: number[] = []
      for (const f of sel.faces) {
        if (!mesh.isFaceAlive(f)) continue
        const vs = mesh.faceVertices(f)
        const pts = vs.flatMap((v) => [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]])
        scratch.length = 0
        triangulatePolygon(pts, scratch)
        for (const k of scratch) tris.push(pts[k * 3], pts[k * 3 + 1], pts[k * 3 + 2])
      }
      const fGeo = new THREE.BufferGeometry()
      fGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris), 3))
      const fill = new THREE.Mesh(fGeo, new THREE.MeshBasicMaterial({
        color: SELECTED, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      }))
      fill.renderOrder = 9
      overlay.add(fill)
    }
    if (!s.dragStart) this.placePivot()
  }

  /** Gizmo pivot at the selection median, oriented like the mesh (so scale works along local axes) */
  private placePivot(): void {
    const s = this.session
    if (!s) return
    const verts = [...s.editor.selection.vertices]
    if (verts.length === 0) {
      this.deps.transformControls.detach()
      return
    }
    const c = new THREE.Vector3()
    for (const v of verts) c.add(new THREE.Vector3().fromArray(s.editor.mesh.positions, v * 3))
    c.divideScalar(verts.length)
    s.meshObject.updateWorldMatrix(true, false)
    s.proxy.position.copy(c.applyMatrix4(s.meshObject.matrixWorld))
    s.meshObject.getWorldQuaternion(s.proxy.quaternion)
    s.proxy.scale.set(1, 1, 1)
    s.proxy.updateMatrixWorld()
    if (this.deps.transformControls.object !== s.proxy) this.deps.transformControls.attach(s.proxy)
  }

  // ---------------------------------------------------------------- gizmo

  private onDragging = (event: { value: unknown }): void => {
    const s = this.session
    if (!s || this.deps.transformControls.object !== s.proxy) return
    if (event.value) {
      s.dragStart = { position: s.proxy.position.clone(), quaternion: s.proxy.quaternion.clone() }
      s.editor.beginTransform(useEditorStore.getState().meshEdit?.pivot ?? 'median')
    } else if (s.dragStart) {
      s.dragStart = null
      void s.editor.commitTransform().then(() => {
        s.picker.rebuild()
        this.refreshOverlay()
      })
    }
  }

  /** Converts the proxy's world-space change since drag start into a mesh-local TransformSpec */
  private onGizmoChange = (): void => {
    const s = this.session
    if (!s?.dragStart || this.deps.transformControls.object !== s.proxy) return
    const inv = s.meshObject.matrixWorld.clone().invert()
    const spec: TransformSpec = {}
    const mode = this.deps.transformControls.mode
    if (mode === 'translate') {
      const a = s.dragStart.position.clone().applyMatrix4(inv)
      const b = s.proxy.position.clone().applyMatrix4(inv)
      spec.translate = [b.x - a.x, b.y - a.y, b.z - a.z]
    } else if (mode === 'rotate') {
      const delta = s.proxy.quaternion.clone().multiply(s.dragStart.quaternion.clone().invert())
      const angle = 2 * Math.acos(Math.min(1, Math.abs(delta.w)))
      if (angle > 1e-6) {
        const axis = new THREE.Vector3(delta.x, delta.y, delta.z).normalize().multiplyScalar(Math.sign(delta.w) || 1)
        const worldQ = new THREE.Quaternion()
        s.meshObject.getWorldQuaternion(worldQ)
        axis.applyQuaternion(worldQ.invert())
        spec.rotate = { axis: [axis.x, axis.y, axis.z], angle }
      }
    } else {
      spec.scale = [s.proxy.scale.x, s.proxy.scale.y, s.proxy.scale.z]
    }
    s.editor.updateTransform(spec)
  }

  // ---------------------------------------------------------------- pointer

  private ndc(e: { clientX: number; clientY: number }): THREE.Vector2 {
    const r = this.deps.canvas.getBoundingClientRect()
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.pointerDown = { x: e.clientX, y: e.clientY }
    if (!this.session || !this.boxArmed || e.button !== 0) return
    this.boxArmed = false
    const el = document.createElement('div')
    el.style.cssText = 'position:absolute;border:1px dashed #fb923c;background:rgba(251,146,60,0.08);pointer-events:none;z-index:45'
    this.deps.overlayRoot.appendChild(el)
    const r = this.deps.overlayRoot.getBoundingClientRect()
    this.box = { x0: e.clientX - r.left, y0: e.clientY - r.top, el }
    this.updateBox(e)
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (this.box) this.updateBox(e)
  }

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.box || !this.session) return
    const r = this.deps.overlayRoot.getBoundingClientRect()
    const x1 = e.clientX - r.left
    const y1 = e.clientY - r.top
    const rect = { minX: Math.min(this.box.x0, x1), maxX: Math.max(this.box.x0, x1), minY: Math.min(this.box.y0, y1), maxY: Math.max(this.box.y0, y1) }
    this.cancelBox()
    const s = this.session
    const camera = this.deps.getCamera()
    if (!camera) return
    s.meshObject.updateWorldMatrix(true, false)
    const canvasRect = this.deps.canvas.getBoundingClientRect()
    const ox = canvasRect.left - r.left
    const oy = canvasRect.top - r.top
    const v = new THREE.Vector3()
    s.editor.selection.box((x, y, z) => {
      v.set(x, y, z).applyMatrix4(s.meshObject.matrixWorld).project(camera)
      if (v.z < -1 || v.z > 1) return null
      return [ox + ((v.x + 1) / 2) * canvasRect.width, oy + ((1 - v.y) / 2) * canvasRect.height]
    }, rect, { extend: e.shiftKey, subtract: e.ctrlKey || e.metaKey })
    // pointerDown keeps the drag start: the click that follows this release is then ignored as a drag
    this.refreshOverlay()
  }

  private updateBox(e: PointerEvent): void {
    if (!this.box) return
    const r = this.deps.overlayRoot.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    Object.assign(this.box.el.style, {
      left: `${Math.min(x, this.box.x0)}px`, top: `${Math.min(y, this.box.y0)}px`,
      width: `${Math.abs(x - this.box.x0)}px`, height: `${Math.abs(y - this.box.y0)}px`,
    })
  }

  private cancelBox(): void {
    this.box?.el.remove()
    this.box = null
    this.boxArmed = false
    this.deps.orbitControls.enabled = true
  }

  /** Click in Edit Mode: pick an element (shift = toggle, alt = edge loop). Returns true when handled. */
  handleClick(e: MouseEvent): boolean {
    const s = this.session
    if (!s) return false
    const down = this.pointerDown
    // An orbit drag or a gizmo interaction is not a click
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP_PX) return true
    if (this.deps.transformControls.axis !== null) return true
    const camera = this.deps.getCamera()
    if (!camera) return true
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(this.ndc(e), camera)
    s.meshObject.updateWorldMatrix(true, false)
    const ray = raycaster.ray.clone().applyMatrix4(s.meshObject.matrixWorld.clone().invert())
    const hit = s.picker.raycast(ray)
    const sel = s.editor.selection
    if (!hit) {
      if (!e.shiftKey) sel.selectNone()
    } else if (e.altKey) {
      sel.selectEdgeLoop(hit.edge, e.shiftKey)
    } else {
      sel.click(sel.mode === 'vertex' ? hit.vertex : sel.mode === 'edge' ? hit.edge : hit.face, e.shiftKey)
    }
    this.refreshOverlay()
    return true
  }

  // ---------------------------------------------------------------- keys and operations

  private report(label: string, r: GeomResult<void>): void {
    const status = r.ok ? null : `${label}: ${r.message}`
    useEditorStore.getState().setMeshEdit({ status })
    if (status) this.deps.warn(status)
  }

  run(label: string, op: (editor: MeshEditor) => Promise<GeomResult<void>>): void {
    const s = this.session
    if (!s) return
    void op(s.editor).then((r) => this.report(label, r))
  }

  /** Inset thickness: 15% of the average edge length of the selected faces */
  private insetThickness(editor: MeshEditor): number {
    let total = 0
    let n = 0
    for (const f of editor.selection.faces) {
      const vs = editor.mesh.faceVertices(f)
      vs.forEach((v, i) => {
        const w = vs[(i + 1) % vs.length]
        total += new THREE.Vector3().fromArray(editor.mesh.positions, v * 3).distanceTo(new THREE.Vector3().fromArray(editor.mesh.positions, w * 3))
        n++
      })
    }
    return n ? (total / n) * 0.15 : 0.1
  }

  inset(): void {
    this.run('Inset', (ed) => ed.inset(this.insetThickness(ed)))
  }

  /** Bevel with 2 segments, 10% of the average length of the selected edges (or of the edges at selected vertices) */
  bevel(): void {
    this.run('Bevel', (ed) => {
      const m = ed.mesh
      const lengths: number[] = []
      const edgeLen = (h: number) => new THREE.Vector3().fromArray(m.positions, m.heVertex[h] * 3)
        .distanceTo(new THREE.Vector3().fromArray(m.positions, m.heTarget(h) * 3))
      if (ed.selection.mode === 'vertex') {
        for (const v of ed.selection.vertices) for (const h of m.vertexOutgoing(v)) lengths.push(edgeLen(h))
      } else {
        for (const e of ed.selection.edges) lengths.push(edgeLen(e))
      }
      const avg = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0.1
      return ed.bevel(avg * 0.1, 2)
    })
  }

  /** Viewport keydown; returns true when Edit Mode consumed the key */
  handleKeyDown(e: KeyboardEvent): boolean {
    const store = useEditorStore.getState()
    const key = e.key.toLowerCase()
    const mod = e.ctrlKey || e.metaKey
    if (!this.session) {
      if (key === 'tab' && !mod && store.playState === 'stopped') {
        const id = store.selectedEntityIds[0]
        if (id && store.enterMeshEdit(id)) {
          e.preventDefault()
          return true
        }
      }
      return false
    }
    const s = this.session
    const sel = s.editor.selection
    const handled = (): true => {
      e.preventDefault()
      e.stopPropagation()
      return true
    }
    if (key === 'tab') {
      store.exitMeshEdit()
      return handled()
    }
    if (mod && key === 'z') {
      void (e.shiftKey ? s.editor.redo() : s.editor.undo()).then(() => this.refreshOverlay())
      return handled()
    }
    if (mod && key === 'y') {
      void s.editor.redo().then(() => this.refreshOverlay())
      return handled()
    }
    if (mod && key === 'l') {
      sel.selectLinked()
      this.refreshOverlay()
      return handled()
    }
    if (mod && key === 'b') {
      this.bevel()
      return handled()
    }
    if (mod && key === 'r') {
      this.run('Loop Cut', (ed) => ed.loopCut(undefined, 1))
      return handled()
    }

    if (mod) return false
    switch (key) {
      case '1':
      case '2':
      case '3':
        store.setMeshEdit({ selectMode: key === '1' ? 'vertex' : key === '2' ? 'edge' : 'face' })
        return handled()
      case 'a':
        if (e.altKey) sel.selectNone()
        else sel.selectAll()
        this.refreshOverlay()
        return handled()
      case 'b':
        this.boxArmed = true
        this.deps.orbitControls.enabled = false
        return handled()
      case 'escape':
        this.cancelBox()
        return handled()
      case 'g':
        this.deps.setGizmoMode('translate')
        return handled()
      case 'r':
        this.deps.setGizmoMode('rotate')
        return handled()
      case 's':
        this.deps.setGizmoMode('scale')
        return handled()
      case 'p':
        store.setMeshEdit({ pivot: store.meshEdit?.pivot === 'individual' ? 'median' : 'individual' })
        return handled()
      case 'e':
        this.run('Extrude', (ed) => ed.extrude(0))
        this.deps.setGizmoMode('translate')
        return handled()
      case 'i':
        this.inset()
        return handled()
      case 'x':
        // Shift+X dissolves (Blender uses Ctrl+X, which is the Edit > Cut menu accelerator here)
        if (e.shiftKey) this.run('Dissolve', (ed) => ed.dissolve())
        else this.run('Delete', (ed) => ed.delete())
        return handled()
      case 'delete':
      case 'backspace':
        this.run('Delete', (ed) => ed.delete())
        return handled()
      case 'm':
        this.run('Merge', (ed) => (e.altKey ? ed.mergeByDistance(1e-4) : ed.mergeAtCenter()))
        return handled()
      case 'j':
        this.run('Connect', (ed) => ed.connect())
        return handled()
      case 'f':
        this.run('Fill / Bridge', (ed) => ed.fillOrBridge())
        return handled()
      case 'n':
        if (e.altKey) this.run('Flip Normals', (ed) => ed.flipNormals())
        else if (e.shiftKey) this.run('Recalculate Normals', (ed) => ed.recalculateNormals())
        else return false
        return handled()
      default:
        return false
    }
  }
}

function disposeGroup(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh
    m.geometry?.dispose()
    const mat = m.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
    else mat?.dispose()
  })
}
