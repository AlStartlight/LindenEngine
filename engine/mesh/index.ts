export * from './core/result'
export * from './core/LindenMesh'
export * from './core/HalfEdgeMesh'
export * from './core/convert'
export * from './core/validate'
export * from './core/triangulate'
export * from './core/primitives'
export type { GeometryOps, BooleanOp, SubdivScheme, UvMethod } from './core/GeometryOps'
export { WorkerGeometryOps, type WorkerLike, type WorkerGeometryOpsOptions } from './worker/WorkerGeometryOps'
export { createGeometryOps } from './worker/createGeometryOps'
export { MeshEditor, type MeshEditorOptions } from './modeling/MeshEditor'
export { MeshCommandStack, type MeshCommand } from './modeling/MeshCommandStack'
export { MeshSelection, edgeLoop, edgeRing, type SelectMode, type SelectionData, type ScreenRect, type ProjectFn } from './modeling/selection'
export { MeshPicker, type PickHit } from './modeling/picking'
export type { Pivot, TransformSpec, DeleteMode, OpResult } from './modeling/ops'
export { edgeId, edgeVertices } from './modeling/topology'
export type { GlbExportOptions, GltfImportReport } from './io/gltf'
export { bevel, type BevelOptions } from './modeling/bevel'
export {
  dissolveFaces, dissolveEdges, dissolveVertices, flipNormals, recalculateNormals, loopCut, splitEdge,
  connectVertices, knifeCut, fillOrBridge, type KnifePoint,
} from './modeling/advancedOps'
export {
  ModifierStack, parseModifiers, mirrorMesh, modifierCacheKey, canonicalJson, hashKey, type ModifierSpec, type ModifierContext,
} from './modeling/modifiers'
export { encodeHalfEdgeMesh, decodeHalfEdgeMesh, type EncodedMesh } from './core/encoding'
export { MAX_SUBDIV_LEVELS } from './core/GeometryOps'
