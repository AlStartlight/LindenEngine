import fs from 'node:fs'
import path from 'node:path'
import WebSocket from 'ws'
import type { ToolDefinition, InputScriptStep } from './index'
import { attachComponentToScene } from './index'
import { World } from '../../../engine/ecs/World'
import { SceneSerializer } from '../../../engine/scene/serializer'
import { GameSimulation } from '../../../engine/runtime/GameSimulation'
import { ScriptRuntime, formatScriptError } from '../../../engine/scripting/ScriptRuntime'
import { Input } from '../../../engine/input/InputActions'
import { Physics } from '../../../engine/physics/components'
import { NetSystem } from '../../../engine/net/NetSystem'
import { RoomServer } from '../../../server/net/RoomServer'
import { normalizeMultiplayer, type MultiplayerConfig } from '../../../shared/net/config'
import { prepareHeadlessScripts } from '../../play/headlessScripts'
import { formatCompileError } from '../../play/ScriptCompiler'

/**
 * Agent tools for multiplayer (docs/specs/SPEC-Multiplayer-WebSocket.md): turn it on, mark the
 * player template, and play a scene with several headless clients on an in-process room server.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function readProjectConfig(projectPath: string): any {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectPath, 'project.linden.json'), 'utf-8'))
  } catch {
    return {}
  }
}

/** Scripts attached to networked entities that never check ctx.net.isMine move every copy */
function isMineWarnings(sceneJson: string, projectPath: string): string[] {
  let scene: any
  try {
    scene = JSON.parse(sceneJson)
  } catch {
    return []
  }
  const out = new Set<string>()
  const byId = new Map<string, any>((scene.entities ?? []).map((e: any) => [e.id, e]))
  const networked = (e: any): boolean => {
    for (let cur = e; cur; cur = cur.parentId ? byId.get(cur.parentId) : null) {
      if (cur.components?.some((c: any) => c.type === 'NetworkSync')) return true
    }
    return false
  }
  for (const e of scene.entities ?? []) {
    const src = e.components?.find((c: any) => c.type === 'Script')?.data?.src
    if (!src || !networked(e)) continue
    try {
      const code = fs.readFileSync(path.join(projectPath, src), 'utf-8')
      if (!/\bisMine\b/.test(code)) out.add(`${src} ada di entity network "${e.name}" tetapi tidak memeriksa ctx.net.isMine; script itu ikut menggerakkan salinan milik pemain lain`)
    } catch {
      /* missing file is reported by the compile step */
    }
  }
  return [...out]
}

export async function simulateMultiplayer(
  sceneJson: string,
  durationSeconds: number,
  opts: { projectPath: string; clients: number; inputScript?: InputScriptStep[] }
) {
  const errors: string[] = []
  const warnings: string[] = []
  const project = readProjectConfig(opts.projectPath)
  const cfg: MultiplayerConfig = { ...normalizeMultiplayer(project.multiplayer), enabled: true }
  if (!normalizeMultiplayer(project.multiplayer).enabled) warnings.push('multiplayer.enabled belum true di project.linden.json; jalankan linden_multiplayer_setup')
  warnings.push(...isMineWarnings(sceneJson, opts.projectPath))

  Input.releaseAll()
  Input.clearActionOverrides()
  for (const w of Input.loadActions(project.input?.actions)) warnings.push(`Input: ${w}`)

  const server = new RoomServer({ log: () => {} })
  await server.start()
  const hasScripts = /"type"\s*:\s*"Script"/.test(sceneJson)
  const headless = hasScripts ? await prepareHeadlessScripts(opts.projectPath) : null
  if (headless) for (const e of headless.compile.errors) errors.push(`Kompilasi gagal: ${formatCompileError(e)}`)

  const clients: { name: string; world: World; sim: GameSimulation; net: NetSystem }[] = []
  const events: { client: string; name: string; from: string }[] = []
  try {
    for (let i = 0; i < opts.clients; i++) {
      const name = `Klien ${i + 1}`
      const world = new World()
      world.initialize()
      SceneSerializer.deserialize(sceneJson, world)
      const sim = new GameSimulation(world)
      const net = new NetSystem({
        world,
        sim,
        config: cfg,
        url: server.url,
        name,
        socket: (u) => new WebSocket(u) as any,
        warn: (m) => warnings.push(`${name}: ${m}`),
      })
      net.prepare()
      if (!(await net.connect())) errors.push(`${name} gagal terhubung ke server lokal`)
      sim.net = net
      await sim.initPhysics(project.collisionMatrix)
      if (headless?.compile.ok) {
        const runtime = new ScriptRuntime({
          world,
          loadModule: headless.loadModule,
          three: (globalThis as any).__LINDEN_THREE__,
          createNet: (e) => net.api(e),
          log: () => {},
          onError: (info) => errors.push(`${name}: Script error: ${formatScriptError(info)}`),
        })
        sim.scripts = runtime
        await runtime.loadAll()
        // Record network events every client receives
        const origNotify = runtime.notifyAll.bind(runtime)
        runtime.notifyAll = (hook: string, ...args: unknown[]) => {
          if (hook === 'onNetEvent' && events.length < 200) events.push({ client: name, name: String(args[0]), from: String(args[2]) })
          origNotify(hook, ...args)
        }
      }
      sim.startComponents()
      await net.start()
      clients.push({ name, world, sim, net })
    }

    // Input drives client 1 only (Input is global in one process, so it is set per client frame)
    const steps = [...(opts.inputScript ?? [])].sort((a, b) => a.at - b.at)
    const active = new Map<string, number | { x: number; y: number }>()
    const frames = Math.round(Math.min(Math.max(durationSeconds, 0.5), 10) * 60)
    // Then 0.4 s without input so remote copies catch up before positions are compared
    const settle = 24
    let nextStep = 0
    for (let f = 0; f < frames + settle; f++) {
      const now = f / 60
      while (f < frames && nextStep < steps.length && steps[nextStep].at <= now) {
        const st = steps[nextStep++]
        if (Array.isArray(st.value)) active.set(st.action, { x: st.value[0], y: st.value[1] })
        else if (typeof st.value === 'number') active.set(st.action, st.value)
        else if (st.press === false) active.delete(st.action)
        else active.set(st.action, 1)
      }
      if (f === frames) active.clear()
      clients.forEach((c, i) => {
        if (c.sim.physics) Physics.setBackend(c.sim.physics)
        Input.clearActionOverrides()
        if (i === 0) for (const [k, v] of active) Input.setActionOverride(k, v)
        try {
          c.sim.frame(1 / 60)
        } catch (e: any) {
          errors.push(`${c.name}: ${e.message}`)
        }
      })
      Input.clearActionOverrides()
      // Real time passes so snapshots travel and interpolation (server clock) moves on
      await sleep(16)
    }

    // Where each owner's entities are vs. where the other clients show them
    let maxError = 0
    const worst: { entity: string; owner: string; seenBy: string; error: number }[] = []
    for (const owner of clients) {
      for (const ent of owner.world.getRootEntities()) {
        if (!owner.net.owner(ent) || !owner.net.isMine(ent)) continue
        const p = ent.getTransform().position
        for (const other of clients) {
          if (other === owner) continue
          const copy = other.world.getEntity(ent.id)
          if (!copy) {
            errors.push(`${other.name} tidak punya salinan "${ent.name}" (${ent.id}) milik ${owner.name}`)
            continue
          }
          const q = copy.getTransform().position
          const err = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)
          maxError = Math.max(maxError, err)
          if (err > 0.1) worst.push({ entity: ent.name, owner: owner.name, seenBy: other.name, error: Math.round(err * 1000) / 1000 })
        }
      }
    }
    if (worst.length) errors.push(`Posisi tidak sinkron (> 10 cm) untuk ${worst.length} salinan, mis. "${worst[0].entity}" milik ${worst[0].owner} di ${worst[0].seenBy}: ${worst[0].error} m`)

    return {
      clients: clients.map((c) => ({
        name: c.name,
        playerId: c.net.localPlayerId,
        connected: c.net.connected,
        host: c.net.isHost,
        players: c.net.playerList().length,
        avatars: c.world.getEntities().filter((e) => /:player$/.test(e.id)).map((e) => e.name),
        networkedEntities: c.world.getRootEntities().filter((e) => c.net.owner(e)).length,
      })),
      sync: { maxPositionError: Math.round(maxError * 1000) / 1000, outOfSync: worst.slice(0, 10) },
      events: events.slice(0, 50),
      errors,
      warnings: [...new Set(warnings)].slice(0, 40),
    }
  } finally {
    for (const c of clients) c.sim.dispose()
    await server.close()
    Input.clearActionOverrides()
  }
}

export const NET_TOOLS: Record<string, ToolDefinition> = {
  linden_multiplayer_setup: {
    name: 'linden_multiplayer_setup',
    description:
      'Mengaktifkan multiplayer online (WebSocket) di project.linden.json dan, bila playerEntityId diisi, menjadikan entity itu template avatar: ' +
      'ia diberi NetworkSync {template:"player"}, disembunyikan saat Play, dan tiap pemain mendapat salinannya. Entity lain yang perlu sinkron ' +
      '(pintu, musuh, item) cukup diberi NetworkSync tanpa template lewat linden_scene_apply. Uji dengan linden_play {clients: 2}.',
    parameters: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', description: 'Default true; false mematikan multiplayer' },
        playerEntityId: { type: 'string', description: 'Entity pemain (beserta anaknya, mis. kamera) yang menjadi avatar tiap pemain' },
        scenePath: { type: 'string', description: 'Default scenes/Main.lscene' },
        tickRate: { type: 'number', description: 'Snapshot per detik (1-60, default 15)' },
        maxPlayers: { type: 'number', description: 'Pemain per room (2-64, default 16)' },
        serverUrl: { type: 'string', description: 'wss://... server produksi; kosong = server yang sama dengan halaman game' },
      },
    },
    async execute(projectPath: string, args: { enabled?: boolean; playerEntityId?: string; scenePath?: string; tickRate?: number; maxPlayers?: number; serverUrl?: string }, options) {
      try {
        const configPath = path.join(projectPath, 'project.linden.json')
        const config = readProjectConfig(projectPath)
        const patch: Record<string, unknown> = { enabled: args.enabled !== false }
        if (args.tickRate !== undefined) patch.tickRate = args.tickRate
        if (args.maxPlayers !== undefined) patch.maxPlayers = args.maxPlayers
        if (args.serverUrl !== undefined) patch.serverUrl = args.serverUrl
        const before = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : ''
        config.multiplayer = normalizeMultiplayer({ ...(config.multiplayer ?? {}), ...patch })
        const after = JSON.stringify(config, null, 2)
        fs.writeFileSync(configPath, after, 'utf-8')
        options?.onDiff?.({
          id: `diff_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          file: 'project.linden.json',
          kind: 'config',
          action: 'modify',
          description: `Multiplayer ${config.multiplayer.enabled ? 'aktif' : 'mati'}`,
          before,
          after,
          status: 'applied',
        })
        let template: string | undefined
        if (args.playerEntityId) {
          const res = attachComponentToScene(
            projectPath,
            args.scenePath || 'scenes/Main.lscene',
            args.playerEntityId,
            { type: 'NetworkSync', data: { template: 'player', syncTransform: true, rate: 0, interpolate: true } },
            options?.onDiff
          )
          if (res.error) return { success: false, error: res.error }
          template = res.entityName
        }
        return {
          success: true,
          data: {
            multiplayer: config.multiplayer,
            ...(template ? { playerTemplate: template } : {}),
            next: 'Script yang menggerakkan entity network wajib memeriksa ctx.net.isMine. Uji dengan linden_play {clients: 2, inputScript}.',
          },
        }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },
}
