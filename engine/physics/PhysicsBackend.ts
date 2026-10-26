import type { Transform } from '../ecs/Component'
import type { Rigidbody, BaseCollider, RaycastHit } from './components'

export interface PhysicsBackend {
  init(): Promise<void>
  isInitialized(): boolean
  step(deltaTime: number): void
  createBody(entityId: string, rb: Rigidbody, transform: Transform, layer?: number): void
  removeBody(entityId: string): void
  createCollider(entityId: string, collider: BaseCollider, transform: Transform, rb?: Rigidbody, layer?: number): void
  removeCollider(entityId: string): void
  setTranslation(entityId: string, pos: { x: number; y: number; z: number }): void
  getTranslation(entityId: string): { x: number; y: number; z: number } | null
  setRotation(entityId: string, rot: { x: number; y: number; z: number }): void
  getRotation(entityId: string): { x: number; y: number; z: number } | null
  moveCharacter(entityId: string, delta: { x: number; y: number; z: number }): { isGrounded: boolean }
  raycast(
    origin: [number, number, number] | { x: number; y: number; z: number },
    dir: [number, number, number] | { x: number; y: number; z: number },
    maxDist: number,
    layerMask?: number,
    excludeEntityId?: string
  ): RaycastHit | null
  setLayerCollisionMatrix(matrix: boolean[][]): void
  clear(): void
  getBodyCount(): number
}
