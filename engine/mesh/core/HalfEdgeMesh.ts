import { err, ok, type GeomResult } from './result'

/**
 * Half-edge mesh for topology editing. Supports n-gons; boundaries are encoded as `twin = -1`
 * (no explicit boundary half-edges). Storage is struct-of-arrays in typed arrays with free slots:
 * removed elements stay in place until `compact()` (so indices held by selections stay valid).
 *
 * - vertex v is alive when `vertexAlive[v] === 1`; `vertexHalfEdge[v]` is an outgoing half-edge or -1 (isolated)
 * - half-edge h is alive when `heFace[h] >= 0`; `heVertex[h]` is its origin
 * - face f is alive when `faceHalfEdge[f] >= 0`
 * - corner attributes (uv, normal) are stored per half-edge: the value of the origin vertex inside that face
 */

/** Directed-edge keys pack two vertex indices into one safe integer, which limits vertex slots to 2^21 */
export const MAX_VERTEX_SLOTS = 1 << 21
const KEY_SHIFT = 4294967296 // 2^32

function edgeKey(a: number, b: number): number {
  return a * KEY_SHIFT + b
}

type TypedArray = Int32Array | Float32Array | Uint8Array

function grow<T extends TypedArray>(arr: T, size: number, fill = 0): T {
  if (arr.length >= size) return arr
  let cap = Math.max(16, arr.length)
  while (cap < size) cap *= 2
  const next = new (arr.constructor as new (n: number) => T)(cap)
  next.set(arr)
  if (fill !== 0) next.fill(fill, arr.length)
  return next
}

/** Plain, transferable snapshot of a HalfEdgeMesh (arrays are tightly sized to the slot counts) */
export interface HalfEdgeMeshData {
  positions: Float32Array
  vertexAlive: Uint8Array
  vertexHalfEdge: Int32Array
  heNext: Int32Array
  hePrev: Int32Array
  heTwin: Int32Array
  heVertex: Int32Array
  heFace: Int32Array
  faceHalfEdge: Int32Array
  cornerUvs?: Float32Array
  cornerNormals?: Float32Array
}

export class HalfEdgeMesh {
  vertexSlots = 0
  halfEdgeSlots = 0
  faceSlots = 0

  positions: Float32Array = new Float32Array(0)
  vertexAlive: Uint8Array = new Uint8Array(0)
  vertexHalfEdge: Int32Array = new Int32Array(0)

  heNext: Int32Array = new Int32Array(0)
  hePrev: Int32Array = new Int32Array(0)
  heTwin: Int32Array = new Int32Array(0)
  heVertex: Int32Array = new Int32Array(0)
  heFace: Int32Array = new Int32Array(0)

  faceHalfEdge: Int32Array = new Int32Array(0)

  cornerUvs: Float32Array | null = null
  cornerNormals: Float32Array | null = null

  private edges = new Map<number, number>()
  private aliveVertices = 0
  private aliveFaces = 0

  get vertexCount(): number {
    return this.aliveVertices
  }

  get faceCount(): number {
    return this.aliveFaces
  }

  get halfEdgeCount(): number {
    return this.edges.size
  }

  /** Number of undirected edges (boundary edges count once) */
  get edgeCount(): number {
    let n = 0
    for (let h = 0; h < this.halfEdgeSlots; h++) {
      if (this.heFace[h] < 0) continue
      const t = this.heTwin[h]
      if (t < 0 || h < t) n++
    }
    return n
  }

  isVertexAlive(v: number): boolean {
    return v >= 0 && v < this.vertexSlots && this.vertexAlive[v] === 1
  }

  isHalfEdgeAlive(h: number): boolean {
    return h >= 0 && h < this.halfEdgeSlots && this.heFace[h] >= 0
  }

  isFaceAlive(f: number): boolean {
    return f >= 0 && f < this.faceSlots && this.faceHalfEdge[f] >= 0
  }

  /** Half-edge from a to b, or -1 */
  findHalfEdge(a: number, b: number): number {
    return this.edges.get(edgeKey(a, b)) ?? -1
  }

  /** Destination vertex of a half-edge */
  heTarget(h: number): number {
    return this.heVertex[this.heNext[h]]
  }

  enableCornerUvs(): void {
    if (!this.cornerUvs) this.cornerUvs = new Float32Array(this.heNext.length * 2)
  }

  enableCornerNormals(): void {
    if (!this.cornerNormals) this.cornerNormals = new Float32Array(this.heNext.length * 3)
  }

  addVertex(x: number, y: number, z: number): number {
    const v = this.vertexSlots
    if (v >= MAX_VERTEX_SLOTS) throw new RangeError(`HalfEdgeMesh supports at most ${MAX_VERTEX_SLOTS} vertex slots`)
    this.vertexSlots++
    this.positions = grow(this.positions, this.vertexSlots * 3)
    this.vertexAlive = grow(this.vertexAlive, this.vertexSlots)
    this.vertexHalfEdge = grow(this.vertexHalfEdge, this.vertexSlots, -1)
    this.positions[v * 3] = x
    this.positions[v * 3 + 1] = y
    this.positions[v * 3 + 2] = z
    this.vertexAlive[v] = 1
    this.vertexHalfEdge[v] = -1
    this.aliveVertices++
    return v
  }

  setPosition(v: number, x: number, y: number, z: number): void {
    this.positions[v * 3] = x
    this.positions[v * 3 + 1] = y
    this.positions[v * 3 + 2] = z
  }

  /**
   * Adds a face from a vertex loop (counter-clockwise seen from the front).
   * Fails without modifying the mesh when the loop repeats a vertex or reuses a directed edge
   * (which would make an edge non-manifold or flip orientation against a neighbour).
   */
  addFace(loop: ArrayLike<number>): GeomResult<number> {
    const n = loop.length
    if (n < 3) return err('INVALID_TOPOLOGY', `face needs at least 3 vertices, got ${n}`)
    for (let i = 0; i < n; i++) {
      const a = loop[i]
      if (!this.isVertexAlive(a)) return err('INVALID_TOPOLOGY', `vertex ${a} does not exist`)
      for (let j = i + 1; j < n; j++) {
        if (loop[j] === a) return err('INVALID_TOPOLOGY', `face repeats vertex ${a}`)
      }
    }
    for (let i = 0; i < n; i++) {
      const a = loop[i]
      const b = loop[(i + 1) % n]
      if (this.edges.has(edgeKey(a, b))) {
        return err('NON_MANIFOLD_INPUT', `directed edge ${a}->${b} is already used by another face`)
      }
    }

    const f = this.faceSlots++
    this.faceHalfEdge = grow(this.faceHalfEdge, this.faceSlots, -1)
    const h0 = this.halfEdgeSlots
    this.halfEdgeSlots += n
    this.growHalfEdges(this.halfEdgeSlots)

    for (let i = 0; i < n; i++) {
      const h = h0 + i
      const a = loop[i]
      const b = loop[(i + 1) % n]
      this.heVertex[h] = a
      this.heFace[h] = f
      this.heNext[h] = h0 + ((i + 1) % n)
      this.hePrev[h] = h0 + ((i + n - 1) % n)
      const t = this.edges.get(edgeKey(b, a))
      if (t !== undefined) {
        this.heTwin[h] = t
        this.heTwin[t] = h
      } else {
        this.heTwin[h] = -1
      }
      this.edges.set(edgeKey(a, b), h)
      if (this.vertexHalfEdge[a] < 0) this.vertexHalfEdge[a] = h
    }
    this.faceHalfEdge[f] = h0
    this.aliveFaces++
    return ok(f)
  }

  /** Removes a face; its vertices stay (possibly isolated) */
  removeFace(f: number): void {
    if (!this.isFaceAlive(f)) return
    const hs = this.faceHalfEdges(f)
    for (const h of hs) {
      const v = this.heVertex[h]
      this.edges.delete(edgeKey(v, this.heTarget(h)))
      const t = this.heTwin[h]
      if (t >= 0) this.heTwin[t] = -1
    }
    for (const h of hs) {
      const v = this.heVertex[h]
      if (this.vertexHalfEdge[v] === h) {
        // Another outgoing half-edge of v in a neighbouring face, else v becomes isolated
        const p = this.heTwin[this.hePrev[h]]
        const t = this.heTwin[h]
        const q = t >= 0 ? this.heNext[t] : -1
        this.vertexHalfEdge[v] = p >= 0 && this.heFace[p] !== f ? p : q >= 0 && this.heFace[q] !== f ? q : -1
      }
    }
    for (const h of hs) {
      this.heFace[h] = -1
      this.heTwin[h] = -1
    }
    this.faceHalfEdge[f] = -1
    this.aliveFaces--
  }

  /** Removes an isolated vertex; returns false if faces still use it */
  removeVertex(v: number): boolean {
    if (!this.isVertexAlive(v) || this.vertexHalfEdge[v] >= 0) return false
    this.vertexAlive[v] = 0
    this.aliveVertices--
    return true
  }

  faceHalfEdges(f: number): number[] {
    const out: number[] = []
    const start = this.faceHalfEdge[f]
    if (start < 0) return out
    let h = start
    do {
      out.push(h)
      h = this.heNext[h]
    } while (h !== start && out.length <= this.halfEdgeSlots)
    return out
  }

  faceVertices(f: number): number[] {
    return this.faceHalfEdges(f).map((h) => this.heVertex[h])
  }

  faceSize(f: number): number {
    return this.faceHalfEdges(f).length
  }

  /**
   * Outgoing half-edges of v in fan order. On a boundary the fan is walked both ways from vertexHalfEdge.
   * A non-manifold vertex (several fans) only reports the fan containing vertexHalfEdge.
   */
  vertexOutgoing(v: number): number[] {
    const start = this.vertexHalfEdge[v]
    if (start < 0) return []
    const out: number[] = [start]
    const limit = this.halfEdgeSlots
    // Forward: twin(prev(h)) is the next outgoing edge around v
    let h = this.heTwin[this.hePrev[start]]
    while (h >= 0 && h !== start && out.length <= limit) {
      out.push(h)
      h = this.heTwin[this.hePrev[h]]
    }
    if (h === start) return out
    // Open fan: walk the other way with next(twin(h))
    const back: number[] = []
    let t = this.heTwin[start]
    while (t >= 0 && back.length <= limit) {
      const n = this.heNext[t]
      back.push(n)
      t = this.heTwin[n]
    }
    return back.reverse().concat(out)
  }

  /** Unnormalized face normal (Newell's method); its length is twice the polygon area */
  faceNormal(f: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
    let nx = 0
    let ny = 0
    let nz = 0
    const vs = this.faceVertices(f)
    const p = this.positions
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i] * 3
      const b = vs[(i + 1) % vs.length] * 3
      nx += (p[a + 1] - p[b + 1]) * (p[a + 2] + p[b + 2])
      ny += (p[a + 2] - p[b + 2]) * (p[a] + p[b])
      nz += (p[a] - p[b]) * (p[a + 1] + p[b + 1])
    }
    out[0] = nx
    out[1] = ny
    out[2] = nz
    return out
  }

  /** Directed edge -> half-edge map, exposed read-only for validation */
  edgeEntries(): IterableIterator<[number, number]> {
    return this.edges.entries()
  }

  static decodeEdgeKey(key: number): [number, number] {
    const a = Math.floor(key / KEY_SHIFT)
    return [a, key - a * KEY_SHIFT]
  }

  /** Copy with dead slots removed; returns the new mesh and old->new index maps (-1 for removed) */
  compact(): { mesh: HalfEdgeMesh; vertexMap: Int32Array; faceMap: Int32Array; halfEdgeMap: Int32Array } {
    const vertexMap = new Int32Array(this.vertexSlots).fill(-1)
    const faceMap = new Int32Array(this.faceSlots).fill(-1)
    const halfEdgeMap = new Int32Array(this.halfEdgeSlots).fill(-1)
    let nv = 0
    for (let v = 0; v < this.vertexSlots; v++) if (this.vertexAlive[v]) vertexMap[v] = nv++
    let nf = 0
    let nh = 0
    // Half-edges are renumbered face by face, starting from each face's first half-edge
    for (let f = 0; f < this.faceSlots; f++) {
      if (this.faceHalfEdge[f] < 0) continue
      faceMap[f] = nf++
      for (const h of this.faceHalfEdges(f)) halfEdgeMap[h] = nh++
    }

    const m = new HalfEdgeMesh()
    m.vertexSlots = nv
    m.faceSlots = nf
    m.halfEdgeSlots = nh
    m.aliveVertices = nv
    m.aliveFaces = nf
    m.positions = new Float32Array(nv * 3)
    m.vertexAlive = new Uint8Array(nv).fill(1)
    m.vertexHalfEdge = new Int32Array(nv)
    m.heNext = new Int32Array(nh)
    m.hePrev = new Int32Array(nh)
    m.heTwin = new Int32Array(nh)
    m.heVertex = new Int32Array(nh)
    m.heFace = new Int32Array(nh)
    m.faceHalfEdge = new Int32Array(nf)
    if (this.cornerUvs) m.cornerUvs = new Float32Array(nh * 2)
    if (this.cornerNormals) m.cornerNormals = new Float32Array(nh * 3)

    for (let v = 0; v < this.vertexSlots; v++) {
      const nvx = vertexMap[v]
      if (nvx < 0) continue
      m.positions[nvx * 3] = this.positions[v * 3]
      m.positions[nvx * 3 + 1] = this.positions[v * 3 + 1]
      m.positions[nvx * 3 + 2] = this.positions[v * 3 + 2]
      const h = this.vertexHalfEdge[v]
      m.vertexHalfEdge[nvx] = h >= 0 ? halfEdgeMap[h] : -1
    }
    for (let f = 0; f < this.faceSlots; f++) {
      if (faceMap[f] >= 0) m.faceHalfEdge[faceMap[f]] = halfEdgeMap[this.faceHalfEdge[f]]
    }
    for (let h = 0; h < this.halfEdgeSlots; h++) {
      const nhx = halfEdgeMap[h]
      if (nhx < 0) continue
      m.heNext[nhx] = halfEdgeMap[this.heNext[h]]
      m.hePrev[nhx] = halfEdgeMap[this.hePrev[h]]
      const t = this.heTwin[h]
      m.heTwin[nhx] = t >= 0 ? halfEdgeMap[t] : -1
      m.heVertex[nhx] = vertexMap[this.heVertex[h]]
      m.heFace[nhx] = faceMap[this.heFace[h]]
      if (this.cornerUvs && m.cornerUvs) {
        m.cornerUvs[nhx * 2] = this.cornerUvs[h * 2]
        m.cornerUvs[nhx * 2 + 1] = this.cornerUvs[h * 2 + 1]
      }
      if (this.cornerNormals && m.cornerNormals) {
        for (let k = 0; k < 3; k++) m.cornerNormals[nhx * 3 + k] = this.cornerNormals[h * 3 + k]
      }
    }
    for (let h = 0; h < nh; h++) m.edges.set(edgeKey(m.heVertex[h], m.heVertex[m.heNext[h]]), h)
    return { mesh: m, vertexMap, faceMap, halfEdgeMap }
  }

  clone(): HalfEdgeMesh {
    return HalfEdgeMesh.fromData(this.toData())
  }

  /** Snapshot with tightly sized copies of every array (dead slots included) */
  toData(): HalfEdgeMeshData {
    const data: HalfEdgeMeshData = {
      positions: this.positions.slice(0, this.vertexSlots * 3),
      vertexAlive: this.vertexAlive.slice(0, this.vertexSlots),
      vertexHalfEdge: this.vertexHalfEdge.slice(0, this.vertexSlots),
      heNext: this.heNext.slice(0, this.halfEdgeSlots),
      hePrev: this.hePrev.slice(0, this.halfEdgeSlots),
      heTwin: this.heTwin.slice(0, this.halfEdgeSlots),
      heVertex: this.heVertex.slice(0, this.halfEdgeSlots),
      heFace: this.heFace.slice(0, this.halfEdgeSlots),
      faceHalfEdge: this.faceHalfEdge.slice(0, this.faceSlots),
    }
    if (this.cornerUvs) data.cornerUvs = this.cornerUvs.slice(0, this.halfEdgeSlots * 2)
    if (this.cornerNormals) data.cornerNormals = this.cornerNormals.slice(0, this.halfEdgeSlots * 3)
    return data
  }

  /** Adopts the arrays of a snapshot (no copy) and rebuilds the edge map */
  static fromData(data: HalfEdgeMeshData): HalfEdgeMesh {
    const m = new HalfEdgeMesh()
    m.vertexSlots = data.vertexAlive.length
    m.halfEdgeSlots = data.heNext.length
    m.faceSlots = data.faceHalfEdge.length
    m.positions = data.positions
    m.vertexAlive = data.vertexAlive
    m.vertexHalfEdge = data.vertexHalfEdge
    m.heNext = data.heNext
    m.hePrev = data.hePrev
    m.heTwin = data.heTwin
    m.heVertex = data.heVertex
    m.heFace = data.heFace
    m.faceHalfEdge = data.faceHalfEdge
    m.cornerUvs = data.cornerUvs ?? null
    m.cornerNormals = data.cornerNormals ?? null
    for (let v = 0; v < m.vertexSlots; v++) if (m.vertexAlive[v]) m.aliveVertices++
    for (let f = 0; f < m.faceSlots; f++) if (m.faceHalfEdge[f] >= 0) m.aliveFaces++
    for (let h = 0; h < m.halfEdgeSlots; h++) {
      if (m.heFace[h] >= 0) m.edges.set(edgeKey(m.heVertex[h], m.heVertex[m.heNext[h]]), h)
    }
    return m
  }

  private growHalfEdges(size: number): void {
    this.heNext = grow(this.heNext, size)
    this.hePrev = grow(this.hePrev, size)
    this.heTwin = grow(this.heTwin, size)
    this.heVertex = grow(this.heVertex, size)
    this.heFace = grow(this.heFace, size, -1)
    if (this.cornerUvs) this.cornerUvs = grow(this.cornerUvs, this.heNext.length * 2)
    if (this.cornerNormals) this.cornerNormals = grow(this.cornerNormals, this.heNext.length * 3)
  }
}

/** Every ArrayBuffer of a HalfEdgeMeshData snapshot, for postMessage transfer lists */
export function halfEdgeDataBuffers(data: HalfEdgeMeshData): ArrayBuffer[] {
  const set = new Set<ArrayBuffer>()
  for (const a of Object.values(data) as (ArrayBufferView | undefined)[]) {
    if (a && a.buffer instanceof ArrayBuffer) set.add(a.buffer)
  }
  return [...set]
}
