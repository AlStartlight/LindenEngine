import { fromLindenMesh, toLindenMesh } from '../core/convert'
import { MAX_SUBDIV_LEVELS, type BooleanOp, type GeometryOps, type SubdivScheme } from '../core/GeometryOps'
import { HalfEdgeMesh } from '../core/HalfEdgeMesh'
import type { LindenMesh } from '../core/LindenMesh'
import { err, ok, type GeomResult } from '../core/result'

/*
 * Non-destructive modifier stack. A stack is evaluated top to bottom on a copy of the source mesh; each
 * step's result is cached under a key made from the previous key and the step's parameters, so changing
 * modifier i re-evaluates only i and the steps after it, and nothing runs when nothing changed.
 */

export type ModifierSpec =
  | { type: 'subdivision'; levels: number; scheme?: SubdivScheme; enabled?: boolean }
  | { type: 'mirror'; axis: 'x' | 'y' | 'z'; merge?: boolean; mergeThreshold?: number; enabled?: boolean }
  /** `operand` names another mesh, resolved by ModifierContext.resolveOperand (an entity id in scenes) */
  | { type: 'boolean'; op: BooleanOp; operand: string; enabled?: boolean }

export interface ModifierContext {
  geometry?: Pick<GeometryOps, 'subdivide' | 'boolean'>
  /** Operand mesh in the modified mesh's local space, with a version string for caching; null when missing */
  resolveOperand?: (operand: string) => { mesh: LindenMesh; version: string } | null
}

/** Validates modifier data coming from scene JSON */
export function parseModifiers(data: unknown): GeomResult<ModifierSpec[]> {
  if (data === undefined || data === null) return ok([])
  if (!Array.isArray(data)) return err('INVALID_MESH', 'modifiers must be an array')
  const out: ModifierSpec[] = []
  for (const [i, m] of data.entries()) {
    const d = m as Record<string, unknown>
    const enabled = d?.enabled === undefined ? undefined : Boolean(d.enabled)
    if (d?.type === 'subdivision') {
      const levels = Number(d.levels)
      if (!Number.isInteger(levels) || levels < 0 || levels > MAX_SUBDIV_LEVELS) return err('INVALID_MESH', `modifier ${i}: levels must be 0..${MAX_SUBDIV_LEVELS}`)
      const scheme = d.scheme === 'loop' ? 'loop' : 'catmull-clark'
      out.push({ type: 'subdivision', levels, scheme, enabled })
    } else if (d?.type === 'mirror') {
      if (d.axis !== 'x' && d.axis !== 'y' && d.axis !== 'z') return err('INVALID_MESH', `modifier ${i}: mirror axis must be x, y or z`)
      const t = d.mergeThreshold === undefined ? 1e-4 : Number(d.mergeThreshold)
      if (!(t >= 0)) return err('INVALID_MESH', `modifier ${i}: mergeThreshold must be >= 0`)
      out.push({ type: 'mirror', axis: d.axis, merge: d.merge === undefined ? true : Boolean(d.merge), mergeThreshold: t, enabled })
    } else if (d?.type === 'boolean') {
      if (d.op !== 'union' && d.op !== 'subtract' && d.op !== 'intersect') return err('INVALID_MESH', `modifier ${i}: boolean op must be union, subtract or intersect`)
      if (typeof d.operand !== 'string' || !d.operand) return err('INVALID_MESH', `modifier ${i}: boolean needs an operand`)
      out.push({ type: 'boolean', op: d.op, operand: d.operand, enabled })
    } else {
      return err('INVALID_MESH', `modifier ${i}: unknown type ${JSON.stringify(d?.type)}`)
    }
  }
  return ok(out)
}

/**
 * Mirror across the plane through the origin perpendicular to `axis`, in local space. With `merge`,
 * vertices within `threshold` of the plane are snapped onto it and shared by both halves.
 */
export function mirrorMesh(src: HalfEdgeMesh, axis: 'x' | 'y' | 'z', merge = true, threshold = 1e-4): GeomResult<HalfEdgeMesh> {
  const { mesh: m } = src.compact()
  const k = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
  const out = new HalfEdgeMesh()
  const n = m.vertexSlots
  const onPlane = new Uint8Array(n)
  for (let v = 0; v < n; v++) {
    const p = [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]]
    if (merge && Math.abs(p[k]) <= threshold) {
      onPlane[v] = 1
      p[k] = 0
    }
    out.addVertex(p[0], p[1], p[2])
  }
  const mirror = new Int32Array(n)
  for (let v = 0; v < n; v++) {
    if (onPlane[v]) {
      mirror[v] = v
      continue
    }
    const p = [out.positions[v * 3], out.positions[v * 3 + 1], out.positions[v * 3 + 2]]
    p[k] = -p[k]
    mirror[v] = out.addVertex(p[0], p[1], p[2])
  }
  if (m.cornerUvs) out.enableCornerUvs()
  const addFace = (verts: number[], hs: number[]): GeomResult<void> => {
    const r = out.addFace(verts)
    if (!r.ok) return err('INVALID_TOPOLOGY', `mirror: ${r.message} (does the mesh cross the mirror plane?)`)
    if (m.cornerUvs && out.cornerUvs) {
      out.faceHalfEdges(r.value).forEach((h, i) => {
        out.cornerUvs![h * 2] = m.cornerUvs![hs[i] * 2]
        out.cornerUvs![h * 2 + 1] = m.cornerUvs![hs[i] * 2 + 1]
      })
    }
    return ok(undefined)
  }
  for (let f = 0; f < m.faceSlots; f++) {
    const hs = m.faceHalfEdges(f)
    const vs = hs.map((h) => m.heVertex[h])
    const r1 = addFace(vs, hs)
    if (!r1.ok) return r1
    if (vs.every((v) => onPlane[v])) continue // a face lying in the plane is not doubled
    // Mirroring flips orientation, so the copy is wound the other way
    const rv = [...vs].reverse().map((v) => mirror[v])
    const r2 = addFace(rv, [...hs].reverse())
    if (!r2.ok) return r2
  }
  return ok(out)
}

/** JSON with object keys sorted at every level, so equal data always gives the same string (scene files sort keys) */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
    }
    return v
  })
}

/** FNV-1a over strings: a cheap cache key, not a cryptographic hash */
export function hashKey(...parts: string[]): string {
  let h = 0x811c9dc5
  for (const s of parts) {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    h ^= 0xff
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

/**
 * Cache key of an EditableMesh's modifier result: the base mesh data, the modifier parameters and the
 * versions of any boolean operands. The editor stores the evaluated mesh under this key; the player only
 * renders a cache whose key still matches (it never runs WASM itself).
 */
export function modifierCacheKey(mesh: unknown, modifiers: ModifierSpec[], operandVersions: string[] = []): string {
  return hashKey('linden-modifiers-v1', canonicalJson(mesh ?? null), canonicalJson(modifiers), ...operandVersions)
}

export class ModifierStack {
  private cache: { key: string; mesh: HalfEdgeMesh }[] = []
  /** How many modifier steps were actually computed (cache misses), for tests and diagnostics */
  evaluations = 0

  /**
   * Evaluates `specs` on `source`. `sourceVersion` must change whenever the source mesh changes.
   * Returns the final mesh (the source itself when the stack is empty or fully disabled).
   */
  async evaluate(source: HalfEdgeMesh, sourceVersion: string, specs: ModifierSpec[], ctx: ModifierContext = {}): Promise<GeomResult<HalfEdgeMesh>> {
    let key = hashKey('source', sourceVersion)
    let current = source
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i]
      const operand = spec.type === 'boolean' && spec.enabled !== false ? ctx.resolveOperand?.(spec.operand) ?? null : null
      key = hashKey(key, canonicalJson(spec), operand?.version ?? '')
      const cached = this.cache[i]
      if (cached && cached.key === key) {
        current = cached.mesh
        continue
      }
      this.cache.length = i // everything after a miss is stale
      const r = await this.apply(current, spec, ctx, operand)
      if (!r.ok) return err(r.code, `modifier ${i + 1} (${spec.type}): ${r.message}`)
      this.evaluations++
      this.cache[i] = { key, mesh: r.value }
      current = r.value
    }
    this.cache.length = specs.length
    return ok(current)
  }

  clear(): void {
    this.cache = []
  }

  private async apply(
    mesh: HalfEdgeMesh, spec: ModifierSpec, ctx: ModifierContext, operand: { mesh: LindenMesh } | null,
  ): Promise<GeomResult<HalfEdgeMesh>> {
    if (spec.enabled === false) return ok(mesh)
    if (spec.type === 'mirror') return mirrorMesh(mesh, spec.axis, spec.merge ?? true, spec.mergeThreshold ?? 1e-4)
    if (spec.type === 'subdivision') {
      if (spec.levels === 0) return ok(mesh)
      if (!ctx.geometry) return err('NOT_IMPLEMENTED', 'no GeometryOps available for subdivision')
      return ctx.geometry.subdivide(mesh, spec.levels, spec.scheme ?? 'catmull-clark')
    }
    if (!ctx.geometry) return err('NOT_IMPLEMENTED', 'no GeometryOps available for boolean')
    if (!operand) return err('INVALID_MESH', `boolean operand '${spec.operand}' was not found`)
    const r = await ctx.geometry.boolean(toLindenMesh(mesh, { polygons: false }), operand.mesh, spec.op)
    if (!r.ok) return r
    const he = fromLindenMesh(r.value, { weld: true })
    return he.ok ? ok(he.value.mesh) : he
  }
}
