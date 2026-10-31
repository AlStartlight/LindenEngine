import { MAX_SUBDIV_LEVELS, type SubdivScheme } from '../core/GeometryOps'
import { HalfEdgeMesh } from '../core/HalfEdgeMesh'
import { err, fromException, ok, type GeomResult } from '../core/result'
import type { MainModule } from './wasm/opensubdiv'

export { MAX_SUBDIV_LEVELS }

let loading: Promise<MainModule> | null = null

/** Loads the OpenSubdiv WASM module (native/build.sh) on first use */
export async function loadOpenSubdiv(): Promise<GeomResult<MainModule>> {
  try {
    loading ??= import('./wasm/opensubdiv.js').then((m) => m.default())
    return ok(await loading)
  } catch (e) {
    loading = null
    return err('WASM_LOAD_FAILED', `could not load OpenSubdiv: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Uniform subdivision with OpenSubdiv Far. Catmull-Clark accepts any n-gons and returns quads; Loop needs
 * triangles and returns triangles. Corner uvs are carried as a face-varying channel (seams stay sharp).
 */
export async function subdivideMesh(mesh: HalfEdgeMesh, levels: number, scheme: SubdivScheme): Promise<GeomResult<HalfEdgeMesh>> {
  if (!Number.isInteger(levels) || levels < 0 || levels > MAX_SUBDIV_LEVELS) {
    return err('INVALID_MESH', `levels must be an integer from 0 to ${MAX_SUBDIV_LEVELS}, got ${levels}`)
  }
  if (mesh.faceCount === 0) return err('EMPTY_MESH', 'cannot subdivide an empty mesh')
  const { mesh: m } = mesh.compact()
  const sizes = new Uint32Array(m.faceSlots)
  const verts: number[] = []
  const uvs: number[] = []
  for (let f = 0; f < m.faceSlots; f++) {
    const hs = m.faceHalfEdges(f)
    sizes[f] = hs.length
    if (scheme === 'loop' && hs.length !== 3) {
      return err('INVALID_TOPOLOGY', `Loop subdivision needs triangles; face ${f} has ${hs.length} sides`)
    }
    for (const h of hs) {
      verts.push(m.heVertex[h])
      if (m.cornerUvs) uvs.push(m.cornerUvs[h * 2], m.cornerUvs[h * 2 + 1])
    }
  }
  if (levels === 0) return ok(m)

  const loaded = await loadOpenSubdiv()
  if (!loaded.ok) return loaded
  try {
    const r = loaded.value.subdivide(
      m.positions.slice(0, m.vertexSlots * 3), sizes, Uint32Array.from(verts), new Float32Array(uvs), levels, scheme === 'loop' ? 1 : 0,
    )
    if (!r.ok) return err('INVALID_TOPOLOGY', `OpenSubdiv: ${r.error}`)
    return buildHalfEdge(r.positions, r.faceSizes, r.faceVertices, r.cornerUvs)
  } catch (e) {
    return fromException(e)
  }
}

function buildHalfEdge(positions: Float32Array, sizes: Uint32Array, verts: Uint32Array, uvs?: Float32Array): GeomResult<HalfEdgeMesh> {
  const out = new HalfEdgeMesh()
  for (let i = 0; i < positions.length; i += 3) out.addVertex(positions[i], positions[i + 1], positions[i + 2])
  if (uvs) out.enableCornerUvs()
  let offset = 0
  for (let f = 0; f < sizes.length; f++) {
    const loop = verts.subarray(offset, offset + sizes[f])
    const added = out.addFace(loop)
    if (!added.ok) return err('INTERNAL', `subdivided face ${f} is invalid: ${added.message}`)
    if (uvs && out.cornerUvs) {
      out.faceHalfEdges(added.value).forEach((h, k) => {
        out.cornerUvs![h * 2] = uvs[(offset + k) * 2]
        out.cornerUvs![h * 2 + 1] = uvs[(offset + k) * 2 + 1]
      })
    }
    offset += sizes[f]
  }
  return ok(out)
}
