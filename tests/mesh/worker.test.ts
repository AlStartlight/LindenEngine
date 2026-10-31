import { describe, expect, it } from 'vitest'
import { toLindenMesh } from '../../engine/mesh/core/convert'
import { makeCube } from '../../engine/mesh/core/primitives'
import { err, ok } from '../../engine/mesh/core/result'
import { validateTopology } from '../../engine/mesh/core/validate'
import { createGeometryHandler } from '../../engine/mesh/worker/handler'
import type { WorkerBackend } from '../../engine/mesh/worker/protocol'
import { WorkerGeometryOps, type WorkerLike } from '../../engine/mesh/worker/WorkerGeometryOps'

/** In-process worker: messages cross a real structuredClone with transfer, so buffers really detach */
class FakeWorker implements WorkerLike {
  private messageListeners: ((e: { data: unknown }) => void)[] = []
  private errorListeners: ((e: { message?: string }) => void)[] = []
  terminated = false
  received: unknown[] = []

  constructor(private readonly backend?: WorkerBackend, private readonly crashOn?: string) {}

  postMessage(message: unknown, transfer: Transferable[]): void {
    const cloned = structuredClone(message, { transfer })
    this.received.push(cloned)
    const handle = createGeometryHandler(this.backend)
    setTimeout(async () => {
      if (this.crashOn && (cloned as { op: string }).op === this.crashOn) {
        this.errorListeners.forEach((l) => l({ message: 'boom' }))
        return
      }
      const { response, transfer: back } = await handle(cloned)
      const reply = structuredClone(response, { transfer: back })
      this.messageListeners.forEach((l) => l({ data: reply }))
    }, 0)
  }

  addEventListener(type: 'message' | 'error', listener: (e: never) => void): void {
    if (type === 'message') this.messageListeners.push(listener as (e: { data: unknown }) => void)
    else this.errorListeners.push(listener as (e: { message?: string }) => void)
  }

  terminate(): void {
    this.terminated = true
  }
}

describe('geometry worker handler', () => {
  const handle = createGeometryHandler()

  it('answers ping and echo, transferring result buffers', async () => {
    expect((await handle({ id: 1, op: 'ping', args: [] })).response).toEqual({ id: 1, result: ok('pong') })
    const mesh = toLindenMesh(makeCube())
    const { response, transfer } = await handle({ id: 2, op: 'echo', args: [mesh] })
    expect(response.result).toEqual(ok(mesh))
    expect(transfer).toContain(mesh.positions.buffer)
    expect(transfer).toContain(mesh.polygons!.indices.buffer)
  })

  it('geometry ops without a backend answer NOT_IMPLEMENTED', async () => {
    const mesh = toLindenMesh(makeCube())
    const { response } = await handle({ id: 3, op: 'boolean', args: [mesh, mesh, 'union'] })
    expect(response.id).toBe(3)
    expect(response.result.ok).toBe(false)
    if (!response.result.ok) expect(response.result.code).toBe('NOT_IMPLEMENTED')
  })

  it('malformed requests answer WORKER_ERROR instead of throwing', async () => {
    for (const bad of [null, {}, { id: 4, op: 'nope', args: [] }, { id: 5, op: 'ping' }]) {
      const { response } = await handle(bad)
      expect(response.result.ok).toBe(false)
      if (!response.result.ok) expect(response.result.code).toBe('WORKER_ERROR')
    }
  })

  it('exceptions inside a backend become INTERNAL errors', async () => {
    const h = createGeometryHandler({ repair: () => { throw new Error('kaboom') } })
    const mesh = toLindenMesh(makeCube())
    const { response, transfer } = await h({ id: 6, op: 'repair', args: [mesh] })
    expect(response.result).toEqual(err('INTERNAL', 'kaboom'))
    expect(transfer).toEqual([])
  })
})

describe('WorkerGeometryOps', () => {
  it('starts the worker lazily, on the first call', async () => {
    let created = 0
    const ops = new WorkerGeometryOps(() => {
      created++
      return new FakeWorker()
    })
    expect(ops.started).toBe(false)
    expect(created).toBe(0)
    expect(await ops.call('ping')).toEqual(ok('pong'))
    await ops.call('ping')
    expect(created).toBe(1)
  })

  it("'copy' ownership leaves the caller's arrays intact", async () => {
    const ops = new WorkerGeometryOps(() => new FakeWorker())
    const mesh = toLindenMesh(makeCube())
    const before = Array.from(mesh.positions)
    const r = await ops.call('echo', mesh)
    expect(mesh.positions.byteLength).toBeGreaterThan(0)
    expect(Array.from(mesh.positions)).toEqual(before)
    expect(r).toEqual(ok(mesh))
  })

  it("'transfer' ownership moves the caller's buffers (zero copy)", async () => {
    const ops = new WorkerGeometryOps(() => new FakeWorker(), { inputOwnership: 'transfer' })
    const mesh = toLindenMesh(makeCube())
    const expected = toLindenMesh(makeCube())
    const r = await ops.call('echo', mesh)
    expect(mesh.positions.byteLength).toBe(0)
    expect(r).toEqual(ok(expected))
  })

  it('half-edge meshes are sent as snapshots and the source mesh stays usable', async () => {
    const worker = new FakeWorker({ subdivide: (data) => ok(data) })
    const ops = new WorkerGeometryOps(() => worker)
    const cube = makeCube()
    const r = await ops.subdivide(cube, 1, 'catmull-clark')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.toData()).toEqual(cube.toData())
    expect(validateTopology(r.value)).toEqual([])
    expect(cube.positions.byteLength).toBeGreaterThan(0)
  })

  it('unimplemented ops resolve with NOT_IMPLEMENTED (never reject)', async () => {
    const ops = new WorkerGeometryOps(() => new FakeWorker())
    const mesh = toLindenMesh(makeCube())
    const results = await Promise.all([
      ops.boolean(mesh, mesh, 'subtract'),
      ops.subdivide(makeCube(), 2, 'catmull-clark'),
      ops.unwrapUV(mesh, 'lscm'),
      ops.remesh(mesh, 100),
      ops.smooth(mesh, 3),
      ops.repair(mesh),
      ops.simplify(mesh, 0.5, 0.01),
      ops.generateLODs(mesh, [0.5, 0.25]),
    ])
    for (const r of results) {
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.code).toBe('NOT_IMPLEMENTED')
    }
  })

  it('concurrent requests resolve to their own responses', async () => {
    const ops = new WorkerGeometryOps(() => new FakeWorker())
    const a = toLindenMesh(makeCube(1))
    const b = toLindenMesh(makeCube(2))
    const [ra, rb] = await Promise.all([ops.call('echo', a), ops.call('echo', b)])
    expect(ra).toEqual(ok(a))
    expect(rb).toEqual(ok(b))
  })

  it('a worker crash fails pending calls with WORKER_ERROR and the next call starts a new worker', async () => {
    const workers: FakeWorker[] = []
    const ops = new WorkerGeometryOps(() => {
      const w = new FakeWorker(undefined, workers.length === 0 ? 'ping' : undefined)
      workers.push(w)
      return w
    })
    const r = await ops.call('ping')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('WORKER_ERROR')
    expect(workers[0].terminated).toBe(true)
    expect(await ops.call('ping')).toEqual(ok('pong'))
    expect(workers).toHaveLength(2)
  })

  it('a worker that cannot be created yields WORKER_ERROR', async () => {
    const ops = new WorkerGeometryOps(() => { throw new Error('no workers here') })
    const r = await ops.call('ping')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('WORKER_ERROR')
  })

  it('dispose fails pending calls and terminates the worker', async () => {
    const worker = new FakeWorker()
    const ops = new WorkerGeometryOps(() => worker)
    const pending = ops.call('ping')
    ops.dispose()
    const r = await pending
    expect(r.ok).toBe(false)
    expect(worker.terminated).toBe(true)
    expect(ops.started).toBe(false)
  })
})
