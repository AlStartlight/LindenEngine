import fs from 'node:fs'
import path from 'node:path'
import { SceneSerializer, SerializedEntity } from '../../../engine/scene/serializer'
import { ComponentRegistry } from '../../../engine/ecs/ComponentRegistry'
import { World } from '../../../engine/ecs/World'
import { GameSimulation, FIXED_DT } from '../../../engine/runtime/GameSimulation'
import { Input } from '../../../engine/input/InputActions'
import { normalizeInputActions, normalizeTouchConfig, resolveTouchLayout } from '../../../engine/input/normalizeActions'
import { findLayoutIssues, placeButton, BUTTON_PRESETS } from '../../../engine/input/touchLayoutMath'
import { createRecordingTouchApi } from '../../../engine/input/TouchApi'
import type { TouchButtonDef, TouchConfig } from '../../../engine/input/InputActions'
import { ScriptRuntime, formatScriptError } from '../../../engine/scripting/ScriptRuntime'
import { prepareHeadlessScripts } from '../../play/headlessScripts'
import { formatCompileError } from '../../play/ScriptCompiler'
import { isValidScriptSrc, isValidUiSrc } from '../../../shared/playProtocol'
import { WebBuildRunner } from '../../build/WebBuildRunner'
import { AgentDiffItem } from '../../../shared/agentTypes'
import { ExportPreset } from '../../../shared/types/project'
import { MODEL_TOOLS } from './modelTools'
import { ModelSpecSchema } from '../../../engine/model/ModelSpec'
import { MaterialSpecSchema } from '../../../engine/materials/MaterialSpec'
import { normalizeSceneSettings } from '../../../engine/scene/SceneSettings'
import { parseSceneFile } from '../../../engine/scene/parseSceneFile'

export { setPreviewRenderer } from './modelTools'
export type { PreviewRenderer, PreviewRequest, PreviewResult } from './modelTools'

export interface ToolDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, any>
    required?: string[]
  }
  execute: (
    projectPath: string,
    args: any,
    options?: { onDiff?: (diff: AgentDiffItem) => void }
  ) => Promise<ToolResult>
}

export interface ToolResult {
  success: boolean
  data?: any
  error?: string
  /** Images returned to the agent as MCP image content (linden_render_preview) */
  images?: { mimeType: string; data: string; label?: string }[]
}

function resolveProjectSafePath(projectPath: string, relativePath: string): string {
  const resolvedBase = path.resolve(projectPath)
  const full = path.resolve(projectPath, relativePath)
  if (full !== resolvedBase && !full.startsWith(resolvedBase + path.sep)) {
    throw new Error(`Akses di luar folder proyek ditolak: ${relativePath}`)
  }
  return full
}

const isVec3 = (v: unknown) =>
  (Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))) ||
  (!!v && typeof v === 'object' && ['x', 'y', 'z'].every((k) => Number.isFinite((v as any)[k])))

/**
 * Reject entities the editor could not load faithfully: unknown component types
 * (deserialize would keep them as inert placeholders) or malformed transforms.
 */
export function validateSceneEntities(entities: SerializedEntity[]): string | null {
  const known = new Set(ComponentRegistry.getAll().map((c: any) => c.type))
  for (const ent of entities) {
    if (typeof ent.name !== 'string' || !Array.isArray(ent.components)) {
      return `Entity "${ent.id}" wajib punya "name" (string) dan "components" (array)`
    }
    for (const comp of ent.components) {
      if (!comp || typeof comp.type !== 'string') {
        return `Entity "${ent.name}" punya komponen tanpa "type"`
      }
      if (comp.type !== 'Transform' && !known.has(comp.type)) {
        return `Komponen tidak dikenal "${comp.type}" pada entity "${ent.name}". Komponen tersedia: ${[...known].join(', ')}`
      }
      if (comp.type === 'Script' && !isValidScriptSrc(comp.data?.src)) {
        return `Script.src pada entity "${ent.name}" harus path di dalam scripts/ berakhiran .ts/.js (dapat: ${JSON.stringify(comp.data?.src)})`
      }
      if (comp.type === 'HtmlUI' && !isValidUiSrc(comp.data?.src)) {
        return `HtmlUI.src pada entity "${ent.name}" harus path .html relatif di dalam proyek, mis. ui/hud.html`
      }
      if (comp.type === 'Model') {
        const res = ModelSpecSchema.safeParse({ ...comp.data, src: comp.data?.src || undefined, category: comp.data?.category || undefined, animation: comp.data?.animation || undefined })
        if (!res.success) {
          const i = res.error.issues[0]
          return `Model pada entity "${ent.name}" tidak valid: ${i.path.join('.')} ${i.message}`
        }
      }
      if (comp.type === 'MeshRenderer' && comp.data?.material && Object.keys(comp.data.material).length > 0) {
        const res = MaterialSpecSchema.safeParse(comp.data.material)
        if (!res.success) {
          const i = res.error.issues[0]
          return `MeshRenderer.material pada entity "${ent.name}" tidak valid: ${i.path.join('.')} ${i.message}`
        }
      }
      if (comp.type === 'Transform' && comp.data) {
        for (const key of ['position', 'rotation', 'scale']) {
          if (comp.data[key] !== undefined && !isVec3(comp.data[key])) {
            return `Transform.${key} pada entity "${ent.name}" harus [x, y, z] angka`
          }
        }
      }
    }
  }
  return null
}

const FALL_LIMIT_Y = -50

/**
 * Headless play test: load the scene into a fresh World and run it through the same
 * GameSimulation loop as the web player (fixed 60 Hz physics + scripts), without rendering.
 * With projectPath, scripts in scripts/ are compiled and run; their errors are reported.
 */
export interface InputScriptStep {
  /** Seconds from the start */
  at: number
  action: string
  /** vector2: [x, y]; axis: -1..1 */
  value?: [number, number] | number
  /** button: true = press, false = release */
  press?: boolean
}

export async function simulateScene(
  sceneJson: string,
  durationSeconds: number,
  opts: { projectPath?: string; inputScript?: InputScriptStep[] } = {}
) {
  const errors: string[] = []
  const warnings: string[] = []
  const world = new World()
  world.initialize()
  SceneSerializer.deserialize(sceneJson, world)

  // Same Input Actions as the game (project.linden.json), so scripts and CharacterMovement see real names
  Input.releaseAll()
  Input.clearActionOverrides()
  let projectInput: unknown
  if (opts.projectPath) {
    try {
      projectInput = JSON.parse(fs.readFileSync(path.join(opts.projectPath, 'project.linden.json'), 'utf-8')).input?.actions
    } catch {
      projectInput = undefined
    }
  }
  for (const w of Input.loadActions(projectInput as unknown[])) warnings.push(`Input: ${w}`)
  let projectTouch: unknown
  if (opts.projectPath) {
    try {
      projectTouch = JSON.parse(fs.readFileSync(path.join(opts.projectPath, 'project.linden.json'), 'utf-8')).input?.touch
    } catch {
      projectTouch = undefined
    }
  }
  const touchCheck = normalizeTouchConfig(projectTouch, Input.getActions())
  const actionTypes = Object.fromEntries(Input.getActions().map((a) => [a.name, a.type]))
  const touchIssues = [
    ...touchCheck.warnings,
    ...['default', ...Object.keys(touchCheck.config.layouts ?? {})].flatMap((name) =>
      findLayoutIssues(resolveTouchLayout(touchCheck.config, name), undefined, actionTypes)
        .filter((i) => i.kind !== 'small')
        .map((i) => `[${name}] ${i.message}`)
    ),
  ]
  const touchCalls: { at: number; call: string }[] = []
  let simTime = 0
  const steps = [...(opts.inputScript ?? [])].sort((a, b) => a.at - b.at)
  for (const step of steps) {
    if (!Input.getActions().some((a) => a.name === step.action)) {
      warnings.push(`inputScript memakai action "${step.action}" yang tidak ada di Input Actions`)
    }
  }

  const sim = new GameSimulation(world)
  await sim.initPhysics()
  const dynamicIds = [...sim.dynamicBodyIds]

  const scriptEntities = world.getEntities().filter((e) => e.hasComponent('Script'))
  const scriptReport = { compiled: [] as string[], attached: scriptEntities.length, running: 0, errors: [] as string[] }
  if (scriptEntities.length > 0) {
    if (!opts.projectPath) {
      warnings.push('Scene punya komponen Script tetapi proyek tidak diketahui; script tidak dijalankan')
    } else {
      const { compile, loadModule } = await prepareHeadlessScripts(opts.projectPath)
      scriptReport.compiled = compile.sources
      for (const e of compile.errors) {
        const msg = `Kompilasi gagal: ${formatCompileError(e)}`
        scriptReport.errors.push(msg)
        errors.push(msg)
      }
      if (compile.ok) {
        const runtime = new ScriptRuntime({
          world,
          loadModule,
          three: (globalThis as any).__LINDEN_THREE__,
          touch: createRecordingTouchApi(touchCalls, () => simTime),
          log: () => {},
          onError: (info) => {
            const msg = formatScriptError(info)
            scriptReport.errors.push(msg)
            errors.push(`Script error: ${msg}`)
          },
        })
        await runtime.loadAll()
        sim.scripts = runtime
      }
    }
  }
  sim.startComponents()

  const frames = Math.round(Math.min(Math.max(durationSeconds, 0.1), 10) * 60)
  const started = Date.now()

  // Track characters driven by CharacterMovement so the agent can verify controls
  const movers = world.getEntities().filter((e) => e.hasComponent('CharacterMovement'))
  const track = new Map(
    movers.map((e) => {
      const p = e.getTransform().position
      return [e.id, { start: { ...p }, last: { ...p }, path: 0, maxRise: 0, jumps: 0, wasRising: false }]
    })
  )

  let framesRun = 0
  let nextStep = 0
  for (; framesRun < frames; framesRun++) {
    const now = framesRun / 60
    simTime = now
    while (nextStep < steps.length && steps[nextStep].at <= now) {
      const st = steps[nextStep++]
      if (Array.isArray(st.value)) Input.setActionOverride(st.action, { x: st.value[0], y: st.value[1] })
      else if (typeof st.value === 'number') Input.setActionOverride(st.action, st.value)
      else Input.setActionOverride(st.action, st.press === false ? null : 1)
    }
    try {
      sim.frame(FIXED_DT)
      for (const e of movers) {
        const tr = track.get(e.id)!
        const p = e.getTransform().position
        const cm = e.getComponent('CharacterMovement') as any
        tr.path += Math.hypot(p.x - tr.last.x, p.z - tr.last.z)
        tr.maxRise = Math.max(tr.maxRise, p.y - tr.start.y)
        const rising = (cm?.velocity?.y ?? 0) > 1
        if (rising && !tr.wasRising) tr.jumps++
        tr.wasRising = rising
        tr.last = { ...p }
      }
    } catch (e: any) {
      errors.push(`Error runtime pada langkah ${framesRun}: ${e.message}`)
      break
    }
  }
  const elapsedMs = Date.now() - started
  scriptReport.running = sim.scripts?.activeCount ?? 0
  Input.clearActionOverrides()
  const round = (n: number) => Math.round(n * 100) / 100
  const characters = movers.map((e) => {
    const tr = track.get(e.id)!
    const p = e.getTransform().position
    const cm = e.getComponent('CharacterMovement') as any
    return {
      name: e.name,
      start: [tr.start.x, tr.start.y, tr.start.z].map(round),
      end: [p.x, p.y, p.z].map(round),
      distanceTravelled: round(tr.path),
      maxJumpHeight: round(tr.maxRise),
      jumps: tr.jumps,
      grounded: !!cm?.isGrounded,
      facingDeg: round(e.getTransform().rotation.y),
    }
  })
  sim.dispose()

  const finalPositions: Record<string, number[]> = {}
  for (const id of dynamicIds) {
    const ent = world.getEntity(id)!
    const p = ent.getTransform().position
    finalPositions[ent.name] = [p.x, p.y, p.z].map((n) => Math.round(n * 100) / 100)
    if (![p.x, p.y, p.z].every(Number.isFinite)) {
      errors.push(`Posisi "${ent.name}" menjadi NaN/Infinity`)
    } else if (p.y < FALL_LIMIT_Y) {
      errors.push(`"${ent.name}" jatuh ke bawah dunia (y=${p.y.toFixed(1)}); kemungkinan tidak ada collider di bawahnya`)
    }
  }
  if (world.getEntities().length === 0) errors.push('Scene kosong: tidak ada entity')
  if (dynamicIds.length === 0) warnings.push('Tidak ada Rigidbody dinamis; fisika tidak diuji')

  return {
    simulatedSeconds: framesRun / 60,
    entityCount: world.getEntities().length,
    dynamicBodies: dynamicIds.length,
    msPerStep: framesRun > 0 ? Math.round((elapsedMs / framesRun) * 100) / 100 : null,
    finalPositions,
    characters,
    touch: { calls: touchCalls.slice(0, 100), layoutIssues: touchIssues.slice(0, 30) },
    scripts: scriptReport,
    errors,
    warnings,
  }
}

/**
 * Add or replace one component on an entity of a saved scene (used to attach scripts and UI
 * right after writing them, so the agent can't leave a script that nothing runs).
 */
function attachComponentToScene(
  projectPath: string,
  sceneRel: string,
  entityId: string,
  component: { type: string; data: Record<string, unknown> },
  onDiff?: (diff: AgentDiffItem) => void
): { error?: string; entityName?: string } {
  const fullPath = resolveProjectSafePath(projectPath, sceneRel)
  if (!fs.existsSync(fullPath)) return { error: `Scene ${sceneRel} tidak ditemukan` }
  const before = fs.readFileSync(fullPath, 'utf-8')
  let scene: any
  try {
    scene = JSON.parse(before)
  } catch (e: any) {
    return { error: `Scene ${sceneRel} bukan JSON valid: ${e.message}` }
  }
  const entity = (scene.entities ?? []).find((e: any) => e.id === entityId)
  if (!entity) {
    const ids = (scene.entities ?? []).map((e: any) => `${e.id} (${e.name})`).join(', ')
    return { error: `Entity "${entityId}" tidak ada di ${sceneRel}. Entity tersedia: ${ids}` }
  }
  entity.components = (entity.components ?? []).filter((c: any) => c.type !== component.type)
  entity.components.push(component)
  const after = JSON.stringify(scene, null, 2)
  fs.writeFileSync(fullPath, after, 'utf-8')
  onDiff?.({
    id: `diff_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    file: sceneRel,
    kind: 'scene',
    action: 'modify',
    description: `Pasang ${component.type} pada entity ${entity.name}`,
    before,
    after,
    status: 'applied',
  })
  return { entityName: entity.name }
}

const attachToSchema = {
  type: 'object',
  description: 'Tautkan langsung ke entity di scene (disarankan)',
  properties: {
    scene: { type: 'string', description: 'Path scene, mis. scenes/Main.lscene' },
    entityId: { type: 'string', description: 'ID entity tujuan' },
    props: { type: 'object', description: 'Nilai awal field publik script (khusus script)' },
  },
  required: ['scene', 'entityId'],
}

export const LINDEN_TOOLS: Record<string, ToolDefinition> = {
  linden_project_info: {
    name: 'linden_project_info',
    description: 'Membaca konfigurasi project.linden.json, daftar scene, aset, dan script proyek.',
    parameters: {
      type: 'object',
      properties: {},
    },
    async execute(projectPath: string) {
      try {
        const projFile = path.join(projectPath, 'project.linden.json')
        let config: any = {}
        if (fs.existsSync(projFile)) {
          config = JSON.parse(fs.readFileSync(projFile, 'utf-8'))
        }

        const scenes: string[] = []
        const scenesDir = path.join(projectPath, 'scenes')
        if (fs.existsSync(scenesDir)) {
          for (const f of fs.readdirSync(scenesDir)) {
            if (f.endsWith('.lscene')) scenes.push(`scenes/${f}`)
          }
        }

        const scripts: string[] = []
        const scriptsDir = path.join(projectPath, 'scripts')
        if (fs.existsSync(scriptsDir)) {
          for (const f of fs.readdirSync(scriptsDir)) {
            if (f.endsWith('.ts') || f.endsWith('.js')) scripts.push(`scripts/${f}`)
          }
        }

        const assets: string[] = []
        const assetsDir = path.join(projectPath, 'assets')
        if (fs.existsSync(assetsDir)) {
          for (const f of fs.readdirSync(assetsDir)) {
            assets.push(`assets/${f}`)
          }
        }

        return {
          success: true,
          data: {
            name: config.name || path.basename(projectPath),
            version: config.version || '1.0.0',
            scenes,
            scripts,
            assets,
            inputActions: config.input?.actions || [],
            exportPresets: config.exportPresets || [],
          },
        }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },

  linden_scene_read: {
    name: 'linden_scene_read',
    description: 'Membaca scene Linden (.lscene) sebagai JSON terstruktur berisi daftar entity dan komponen.',
    parameters: {
      type: 'object',
      properties: {
        scenePath: {
          type: 'string',
          description: 'Path relatif scene, misalnya scenes/Main.lscene. Jika kosong membaca scene utama.',
        },
      },
    },
    async execute(projectPath: string, args: { scenePath?: string }) {
      try {
        let rel = args.scenePath || 'scenes/Main.lscene'
        const fullPath = resolveProjectSafePath(projectPath, rel)
        if (!fs.existsSync(fullPath)) {
          return { success: false, error: `File scene tidak ditemukan: ${rel}` }
        }

        const content = fs.readFileSync(fullPath, 'utf-8')
        const json = JSON.parse(content)
        return { success: true, data: json }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },

  linden_scene_apply: {
    name: 'linden_scene_apply',
    description: 'Menerapkan pembuatan atau perubahan scene: menambahkan entity, komponen, mengubah transform, atau mengganti seluruh scene.',
    parameters: {
      type: 'object',
      properties: {
        scenePath: {
          type: 'string',
          description: 'Path scene, contoh scenes/Main.lscene',
        },
        sceneName: {
          type: 'string',
          description: 'Nama scene, contoh Main',
        },
        settings: {
          type: 'object',
          description:
            'Setting render scene (digabung dengan yang ada): environment ("room", "none", atau assets/hdri/x.hdr), environmentIntensity, ' +
            'skybox (null, "#rrggbb", "environment"), toneMapping (agx|aces|neutral|...), exposure, ambientColor, ambientIntensity, ' +
            'fog {enabled,type,color,near,far,density}, shadowQuality (off|low|medium|high), sun {enabled,color,intensity,direction}, ' +
            'postFx {enabled, ao, bloom, antialias: smaa|fxaa|none}',
        },
        entities: {
          type: 'array',
          description:
            'Seluruh entity scene (menggantikan isi scene; kosongkan untuk hanya mengubah settings). Tipe komponen dan propertinya lihat linden_component_list. ' +
            'Contoh: {"id":"player","name":"Player","parentId":null,"components":[{"type":"Transform","data":{"position":[0,1,0],"rotation":[0,0,0],"scale":[1,1,1]}},{"type":"MeshRenderer","data":{"primitive":"sphere","color":"#38bdf8"}}]}',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              parentId: { type: ['string', 'null'] },
              active: { type: 'boolean' },
              tags: { type: 'array', items: { type: 'string' } },
              components: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    type: { type: 'string', description: 'Nama komponen, mis. Transform, MeshRenderer, Rigidbody' },
                    data: { type: 'object' },
                  },
                  required: ['type'],
                },
              },
            },
            required: ['name', 'components'],
          },
        },
      },
    },
    async execute(projectPath: string, args: { scenePath?: string; sceneName?: string; settings?: Record<string, unknown>; entities?: SerializedEntity[] }, options) {
      try {
        const rel = args.scenePath || 'scenes/Main.lscene'
        const fullPath = resolveProjectSafePath(projectPath, rel)

        // Without entities only the settings change: keep the scene's current entities
        if (!args.entities) {
          if (!args.settings) return { success: false, error: 'Isi "entities" dan/atau "settings"' }
          const existing = fs.existsSync(fullPath) ? parseSceneFile(fs.readFileSync(fullPath, 'utf-8')) : null
          if (existing && 'message' in existing) return { success: false, error: `Scene ${rel} tidak bisa dibaca: ${existing.message}` }
          args = { ...args, entities: (existing && 'scene' in existing ? existing.scene.entities : []) as SerializedEntity[] }
        }
        const entities = args.entities!

        // Validation: Unique IDs & Valid parent references
        const seenIds = new Set<string>()
        for (const ent of entities) {
          if (!ent.id) {
            ent.id = `ent_${Math.random().toString(36).substring(2, 9)}`
          }
          if (seenIds.has(ent.id)) {
            return { success: false, error: `Duplikat ID entity: ${ent.id}` }
          }
          seenIds.add(ent.id)
        }

        for (const ent of entities) {
          if (ent.parentId && !seenIds.has(ent.parentId)) {
            return { success: false, error: `Entity "${ent.name}" merujuk parent non-existent: ${ent.parentId}` }
          }
        }

        const schemaError = validateSceneEntities(entities)
        if (schemaError) {
          return { success: false, error: schemaError }
        }

        let beforeContent = ''
        let previousSettings: Record<string, unknown> = {}
        if (fs.existsSync(fullPath)) {
          beforeContent = fs.readFileSync(fullPath, 'utf-8')
          try {
            previousSettings = JSON.parse(beforeContent).settings ?? {}
          } catch {
            // A corrupt scene is replaced as a whole
          }
        }
        // Settings merge with the scene's current ones; invalid fields are reported, not silently dropped
        const merged = { ...previousSettings, ...(args.settings ?? {}) }
        const { settings, warnings: settingsWarnings } = normalizeSceneSettings(merged)
        if (args.settings && settingsWarnings.length > 0) {
          return { success: false, error: settingsWarnings.join('; ') }
        }

        const sceneData = {
          format: 'linden-scene',
          version: 2,
          name: args.sceneName || path.basename(rel, '.lscene'),
          settings,
          entities: entities,
        }

        const newContent = JSON.stringify(sceneData, null, 2)

        const diff: AgentDiffItem = {
          id: `diff_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          file: rel,
          kind: 'scene',
          action: beforeContent ? 'modify' : 'create',
          description: `Perbarui scene ${rel} dengan ${entities.length} entity`,
          before: beforeContent,
          after: newContent,
          status: 'applied',
        }

        fs.mkdirSync(path.dirname(fullPath), { recursive: true })
        fs.writeFileSync(fullPath, newContent, 'utf-8')
        options?.onDiff?.(diff)

        return { success: true, data: { scenePath: rel, entityCount: entities.length } }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },

  linden_component_list: {
    name: 'linden_component_list',
    description: 'Mendapatkan daftar seluruh komponen bawaan Linden Engine beserta propertinya.',
    parameters: {
      type: 'object',
      properties: {},
    },
    async execute() {
      try {
        const comps = ComponentRegistry.getAll().map((c: any) => ({
          type: c.type,
          menuPath: c.menuPath,
          properties: c.properties.map((p: any) => ({
            name: p.name,
            kind: p.kind,
            default: p.default,
          })),
        }))
        return { success: true, data: comps }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },

  linden_script_write: {
    name: 'linden_script_write',
    description:
      'Menulis atau memperbarui script TypeScript logika game di folder scripts/ (export default class). ' +
      'Isi attachTo agar script langsung terpasang (komponen Script) pada entity; script yang tidak terpasang tidak pernah dijalankan. ' +
      'Import yang boleh hanya "three" dan "linden", serta file lain di scripts/.',
    parameters: {
      type: 'object',
      properties: {
        scriptPath: {
          type: 'string',
          description: 'Path relatif file script, misalnya scripts/PlayerController.ts',
        },
        code: {
          type: 'string',
          description: 'Kode sumber TypeScript untuk script game',
        },
        attachTo: attachToSchema,
      },
      required: ['scriptPath', 'code'],
    },
    async execute(
      projectPath: string,
      args: { scriptPath: string; code: string; attachTo?: { scene: string; entityId: string; props?: Record<string, unknown> } },
      options
    ) {
      try {
        const fullPath = resolveProjectSafePath(projectPath, args.scriptPath)
        const scriptPath = args.scriptPath.replace(/\\/g, '/').replace(/^\.\//, '')
        if (!isValidScriptSrc(scriptPath)) {
          return { success: false, error: `scriptPath harus di dalam scripts/ dan berakhiran .ts/.js (dapat: ${args.scriptPath})` }
        }
        let before = ''
        if (fs.existsSync(fullPath)) {
          before = fs.readFileSync(fullPath, 'utf-8')
        }

        const diff: AgentDiffItem = {
          id: `diff_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          file: args.scriptPath,
          kind: 'script',
          action: before ? 'modify' : 'create',
          description: `${before ? 'Ubah' : 'Buat'} script ${args.scriptPath}`,
          before,
          after: args.code,
          status: 'applied',
        }

        fs.mkdirSync(path.dirname(fullPath), { recursive: true })
        fs.writeFileSync(fullPath, args.code, 'utf-8')
        options?.onDiff?.(diff)

        if (args.attachTo) {
          const attached = attachComponentToScene(
            projectPath,
            args.attachTo.scene,
            args.attachTo.entityId,
            { type: 'Script', data: { src: scriptPath, props: args.attachTo.props ?? {} } },
            options?.onDiff
          )
          if (attached.error) return { success: false, error: `Script ditulis, tetapi gagal dipasang: ${attached.error}` }
          return { success: true, data: { scriptPath, size: args.code.length, attachedTo: attached.entityName } }
        }

        return {
          success: true,
          data: {
            scriptPath,
            size: args.code.length,
            warning: 'Script belum ditautkan ke entity mana pun; isi attachTo atau tambahkan komponen Script lewat linden_scene_apply.',
          },
        }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },

  linden_input_actions: {
    name: 'linden_input_actions',
    description:
      'Menulis Input Actions (dan opsional layout kontrol sentuh) ke project.linden.json. Action default sudah ada: ' +
      'Move (vector2: WASD/panah/stik kiri/joystick sentuh), Turn & Vertical (axis: Q/E), Look, Jump, Sprint, Crouch, Interact (F), Attack. ' +
      'Kirim hanya action tambahan atau yang diubah; mode "merge" (default) mempertahankan action lain. ' +
      'Binding memakai KeyboardEvent.code: "Keyboard/KeyW", "Keyboard/Space", "Keyboard/ShiftLeft", "Mouse/LeftButton", ' +
      '"Gamepad/ButtonSouth", "Gamepad/LeftStick", "Touch/Joystick", "Touch/Button/<Id>".',
    parameters: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          description: 'Daftar action',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              type: { type: 'string', enum: ['button', 'axis', 'vector2'] },
              bindings: { type: 'array', items: { type: 'string' } },
              composites: {
                type: 'array',
                description: 'vector2: [{up:[..],down:[..],left:[..],right:[..]}]; axis: [{negative:[..],positive:[..]}]',
                items: { type: 'object' },
              },
              deadzone: { type: 'number' },
              pressThreshold: { type: 'number' },
            },
            required: ['name'],
          },
        },
        mode: { type: 'string', enum: ['merge', 'replace'], description: 'merge (default) atau ganti semua' },
        touch: {
          type: 'object',
          description:
            'Seluruh konfigurasi kontrol sentuh (menimpa yang ada). Untuk menambah/mengubah satu tombol pakai linden_touch_button.',
        },
      },
      required: ['actions'],
    },
    async execute(projectPath: string, args: { actions: unknown[]; mode?: 'merge' | 'replace'; touch?: unknown }, options) {
      try {
        const projFile = path.join(projectPath, 'project.linden.json')
        let config: any = { name: 'Linden Game', version: '1.0.0' }
        let before = ''
        if (fs.existsSync(projFile)) {
          before = fs.readFileSync(projFile, 'utf-8')
          config = JSON.parse(before)
        }

        const incoming = normalizeInputActions(args.actions)
        const existing = normalizeInputActions(config.input?.actions).actions
        const actions =
          args.mode === 'replace'
            ? incoming.actions
            : [...existing.filter((a) => !incoming.actions.some((n) => n.name === a.name)), ...incoming.actions]

        config.input = { ...(config.input ?? {}), actions }
        if (args.touch !== undefined) {
          const t = normalizeTouchConfig(args.touch, actions)
          config.input.touch = t.config
          config.input.actions = t.actions
          incoming.warnings.push(...t.warnings)
        }

        const after = JSON.stringify(config, null, 2)
        const diff: AgentDiffItem = {
          id: `diff_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          file: 'project.linden.json',
          kind: 'config',
          action: 'modify',
          description: `Perbarui ${incoming.actions.length} input actions`,
          before,
          after,
          status: 'applied',
        }

        fs.writeFileSync(projFile, after, 'utf-8')
        options?.onDiff?.(diff)

        return {
          success: true,
          data: { actionCount: actions.length, actions: actions.map((a) => a.name), warnings: incoming.warnings },
        }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },

  linden_touch_button: {
    name: 'linden_touch_button',
    description:
      'Menambah/mengubah (op "upsert") atau menghapus (op "remove") SATU tombol kontrol sentuh mobile tanpa mengubah tombol lain. ' +
      'Tombol terhubung ke Input Action lewat "action" (mis. Attack, Jump, Sprint, Interact, atau action custom seperti Dash). ' +
      'behavior: "hold" (default), "tap" (sekali per ketukan, cocok untuk HIT/serang), "toggle", "repeat". cooldown dalam detik. ' +
      'icon: nama bawaan (jump, attack, sword, shoot, run, use, crouch, dash, shield, reload, turn-left, turn-right, up, down, pause, menu) ' +
      'atau "asset:assets/ui/x.png". Tanpa posisi, "preset" (primary, secondary, tertiary, top-right, top-left) memilih tempat kosong. ' +
      'layout: "default" atau nama layout lain (mis. "vehicle"); layout baru dibuat otomatis.',
    parameters: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['upsert', 'remove'] },
        layout: { type: 'string', description: 'Default "default"' },
        preset: { type: 'string', enum: Object.keys(BUTTON_PRESETS) },
        button: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            action: { type: 'string' },
            value: { type: 'number', description: 'Untuk action axis: -1 atau 1' },
            label: { type: 'string' },
            icon: { type: 'string' },
            behavior: { type: 'string', enum: ['hold', 'tap', 'toggle', 'repeat'] },
            repeatInterval: { type: 'number' },
            cooldown: { type: 'number' },
            anchor: { type: 'string' },
            x: { type: 'number' },
            y: { type: 'number' },
            unit: { type: 'string', enum: ['px', '%'] },
            size: { type: 'number' },
            shape: { type: 'string', enum: ['circle', 'rounded', 'square'] },
            color: { type: 'string' },
            pressedColor: { type: 'string' },
            textColor: { type: 'string' },
            visible: { type: 'boolean' },
            enabled: { type: 'boolean' },
          },
          required: ['id'],
        },
      },
      required: ['op', 'button'],
    },
    async execute(
      projectPath: string,
      args: { op: 'upsert' | 'remove'; layout?: string; preset?: string; button: Partial<TouchButtonDef> & { id: string } },
      options
    ) {
      try {
        const projFile = path.join(projectPath, 'project.linden.json')
        const before = fs.existsSync(projFile) ? fs.readFileSync(projFile, 'utf-8') : ''
        const config: any = before ? JSON.parse(before) : { name: 'Linden Game', version: '1.0.0' }
        const actions = normalizeInputActions(config.input?.actions).actions
        const current = normalizeTouchConfig(config.input?.touch, actions)
        const touch: TouchConfig = current.config
        const layoutName = args.layout && args.layout !== 'default' ? args.layout.replace(/[^A-Za-z0-9_-]/g, '') : 'default'

        // The button list being edited (a named layout gets its own copy of the default buttons)
        let list: TouchButtonDef[]
        if (layoutName === 'default') list = touch.buttons
        else {
          touch.layouts = touch.layouts ?? {}
          const l = (touch.layouts[layoutName] = touch.layouts[layoutName] ?? {})
          l.buttons = l.buttons ?? []
          list = l.buttons
        }

        const index = list.findIndex((b) => b.id === args.button.id)
        if (args.op === 'remove') {
          if (index < 0) return { success: false, error: `Tombol "${args.button.id}" tidak ada di layout ${layoutName}` }
          list.splice(index, 1)
        } else {
          const existing = index >= 0 ? list[index] : undefined
          const action = args.button.action ?? existing?.action
          if (!action) return { success: false, error: 'Tombol baru wajib punya "action"' }
          if (!actions.some((a) => a.name === action)) {
            return { success: false, error: `Action "${action}" belum ada. Tambahkan dulu lewat linden_input_actions. Action tersedia: ${actions.map((a) => a.name).join(', ')}` }
          }
          let next: TouchButtonDef = { ...(existing ?? { anchor: 'bottom-right', size: 56 }), ...args.button, action } as TouchButtonDef
          const positioned = args.button.x !== undefined || args.button.y !== undefined || (existing && !args.preset)
          if (!positioned) next = placeButton(resolveTouchLayout(touch, layoutName), next, args.preset ?? 'secondary')
          if (index >= 0) list[index] = next
          else list.push(next)
        }

        const normalized = normalizeTouchConfig(touch, actions)
        config.input = { ...(config.input ?? {}), actions: normalized.actions, touch: normalized.config }
        const issues = findLayoutIssues(
          resolveTouchLayout(normalized.config, layoutName),
          undefined,
          Object.fromEntries(actions.map((a) => [a.name, a.type]))
        ).filter((i) => i.kind !== 'small')
        const after = JSON.stringify(config, null, 2)
        fs.writeFileSync(projFile, after, 'utf-8')
        options?.onDiff?.({
          id: `diff_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          file: 'project.linden.json',
          kind: 'config',
          action: 'modify',
          description: `${args.op === 'remove' ? 'Hapus' : 'Atur'} tombol sentuh ${args.button.id} (${layoutName})`,
          before,
          after,
          status: 'applied',
        })
        const saved = resolveTouchLayout(normalized.config, layoutName).buttons
        return {
          success: true,
          data: {
            layout: layoutName,
            buttons: saved.map((b) => `${b.id}→${b.action}`),
            button: saved.find((b) => b.id === args.button.id),
            warnings: [...normalized.warnings, ...issues.map((i) => i.message)],
          },
        }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },

  linden_asset_placeholder: {
    name: 'linden_asset_placeholder',
    description: 'Membuat aset placeholder (sprite / tekstur warna SVG/PNG) di folder assets/.',
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Nama file aset, misalnya assets/player.svg' },
        width: { type: 'number', description: 'Lebar gambar' },
        height: { type: 'number', description: 'Tinggi gambar' },
        color: { type: 'string', description: 'Warna heksadesimal, misal #38bdf8' },
        label: { type: 'string', description: 'Teks label di tengah aset' },
      },
      required: ['filename'],
    },
    async execute(projectPath: string, args: { filename?: string; assetPath?: string; width?: number; height?: number; color?: string; label?: string }) {
      try {
        const targetFilename = args.filename || args.assetPath
        if (!targetFilename) {
          return { success: false, error: 'Nama file aset wajib ditentukan' }
        }
        const fullPath = resolveProjectSafePath(projectPath, targetFilename)
        const w = args.width || 64
        const h = args.height || 64
        const c = args.color || '#3b82f6'
        const label = args.label || ''

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${c}" rx="8" />
  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="${Math.max(10, Math.floor(w / 6))}">${label}</text>
</svg>`

        fs.mkdirSync(path.dirname(fullPath), { recursive: true })
        fs.writeFileSync(fullPath, svg, 'utf-8')
        return { success: true, data: { filename: targetFilename, size: svg.length } }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },

  linden_play: {
    name: 'linden_play',
    description:
      'Menjalankan scene secara headless (ECS + fisika Rapier + script, 60 langkah/detik) selama N detik. ' +
      'Melaporkan error runtime/script, entity yang jatuh ke bawah dunia, posisi akhir entity dinamis, dan untuk entity ' +
      'ber-CharacterMovement: jarak tempuh, tinggi lompat, jumlah lompat, status grounded. Pakai inputScript untuk ' +
      'mensimulasikan pemain, mis. [{"at":0,"action":"Move","value":[0,1]},{"at":0.5,"action":"Jump","press":true},{"at":0.6,"action":"Jump","press":false}].',
    parameters: {
      type: 'object',
      properties: {
        scenePath: { type: 'string', description: 'Path scene yang akan diuji' },
        durationSeconds: { type: 'number', description: 'Durasi simulasi dalam detik game (default 2, maks 10)' },
        inputScript: {
          type: 'array',
          description: 'Urutan input tersimulasi berdasarkan nama action',
          items: {
            type: 'object',
            properties: {
              at: { type: 'number', description: 'Detik sejak mulai' },
              action: { type: 'string' },
              value: { description: 'vector2: [x, y] (y=1 maju); axis: -1..1' },
              press: { type: 'boolean', description: 'button: true tekan, false lepas' },
            },
            required: ['at', 'action'],
          },
        },
      },
    },
    async execute(projectPath: string, args: { scenePath?: string; durationSeconds?: number; inputScript?: InputScriptStep[] }) {
      try {
        const rel = args.scenePath || 'scenes/Main.lscene'
        const fullPath = resolveProjectSafePath(projectPath, rel)
        if (!fs.existsSync(fullPath)) {
          return { success: false, error: `Scene ${rel} tidak ditemukan untuk play test` }
        }

        const raw = fs.readFileSync(fullPath, 'utf-8')
        const report = await simulateScene(raw, args.durationSeconds ?? 2, { projectPath, inputScript: args.inputScript })
        return {
          success: report.errors.length === 0,
          data: { testedScene: rel, ...report },
          error: report.errors.length > 0 ? report.errors.join('; ') : undefined,
        }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },

  linden_ui_write: {
    name: 'linden_ui_write',
    description:
      'Menulis fragmen HTML UI (HUD, menu, skor) di ui/*.html dan memasangnya sebagai komponen HtmlUI. ' +
      'Fragmen berisi HTML + <style> saja, tanpa <script> atau atribut on*; logika UI ditulis di script lewat ctx.ui ' +
      '(ctx.ui.bind("#coins", () => this.coins), ctx.ui.on("#restart", "click", ...)). ' +
      'mode "screen" = overlay di atas layar, "world" = menempel di entity 3D. Elemen yang bisa diklik beri atribut data-interactive.',
    parameters: {
      type: 'object',
      properties: {
        uiPath: { type: 'string', description: 'Path relatif, mis. ui/hud.html' },
        html: { type: 'string', description: 'Fragmen HTML (boleh berisi <style>)' },
        mode: { type: 'string', enum: ['screen', 'world'] },
        attachTo: attachToSchema,
      },
      required: ['uiPath', 'html'],
    },
    async execute(
      projectPath: string,
      args: { uiPath: string; html: string; mode?: 'screen' | 'world'; attachTo?: { scene: string; entityId: string } },
      options
    ) {
      try {
        const fullPath = resolveProjectSafePath(projectPath, args.uiPath)
        const uiPath = args.uiPath.replace(/\\/g, '/').replace(/^\.\//, '')
        if (!isValidUiSrc(uiPath)) {
          return { success: false, error: `uiPath harus file .html relatif di dalam proyek (dapat: ${args.uiPath})` }
        }
        const warnings: string[] = []
        if (/<script\b/i.test(args.html)) warnings.push('<script> akan dibuang saat runtime; pindahkan logika ke script (ctx.ui)')
        if (/\son[a-z]+\s*=/i.test(args.html)) warnings.push('Atribut on* (onclick, ...) akan dibuang; pakai ctx.ui.on di script')

        const before = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf-8') : ''
        fs.mkdirSync(path.dirname(fullPath), { recursive: true })
        fs.writeFileSync(fullPath, args.html, 'utf-8')
        options?.onDiff?.({
          id: `diff_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          file: uiPath,
          kind: 'asset',
          action: before ? 'modify' : 'create',
          description: `${before ? 'Ubah' : 'Buat'} UI ${uiPath}`,
          before,
          after: args.html,
          status: 'applied',
        })

        if (args.attachTo) {
          const attached = attachComponentToScene(
            projectPath,
            args.attachTo.scene,
            args.attachTo.entityId,
            { type: 'HtmlUI', data: { src: uiPath, mode: args.mode ?? 'screen', zIndex: 0, pointerEvents: false, pixelSize: 0.01 } },
            options?.onDiff
          )
          if (attached.error) return { success: false, error: `UI ditulis, tetapi gagal dipasang: ${attached.error}` }
          return { success: true, data: { uiPath, attachedTo: attached.entityName, warnings } }
        }
        return { success: true, data: { uiPath, warnings } }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },

  linden_web_write: {
    name: 'linden_web_write',
    description:
      'Khusus proyek HTML Game (project.linden.json "runtime": "html"): menulis file halaman game (HTML/JS/CSS) di folder web/. ' +
      'Gunakan three.js lokal lewat import map ke "./vendor/three.module.js" (sudah ada di template), bukan CDN. ' +
      'window.linden.input berisi Input Actions proyek; panggil linden.registerRenderer(renderer) agar statistik tampil di editor.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path relatif di dalam web/, mis. web/main.js' },
        content: { type: 'string' },
      },
      required: ['filePath', 'content'],
    },
    async execute(projectPath: string, args: { filePath: string; content: string }, options) {
      try {
        const fullPath = resolveProjectSafePath(projectPath, args.filePath)
        const rel = args.filePath.replace(/\\/g, '/').replace(/^\.\//, '')
        if (!rel.startsWith('web/') || rel.split('/').some((seg) => seg.startsWith('.'))) {
          return { success: false, error: 'linden_web_write hanya boleh menulis di dalam folder web/' }
        }
        if (!/\.(html?|js|mjs|css|json|svg|txt)$/i.test(rel)) {
          return { success: false, error: 'Tipe file tidak didukung (html, js, mjs, css, json, svg, txt)' }
        }
        const before = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf-8') : ''
        fs.mkdirSync(path.dirname(fullPath), { recursive: true })
        fs.writeFileSync(fullPath, args.content, 'utf-8')
        options?.onDiff?.({
          id: `diff_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          file: rel,
          kind: 'asset',
          action: before ? 'modify' : 'create',
          description: `${before ? 'Ubah' : 'Buat'} ${rel}`,
          before,
          after: args.content,
          status: 'applied',
        })
        return { success: true, data: { filePath: rel, size: args.content.length } }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },

  linden_export_web: {
    name: 'linden_export_web',
    description: 'Mengekspor game ke build HTML5 yang dapat langsung dimainkan di browser atau diunggah ke itch.io.',
    parameters: {
      type: 'object',
      properties: {
        presetName: { type: 'string', description: 'Nama preset export web (opsional)' },
        canvasMode: { type: 'string', enum: ['fixed', 'responsive', 'fullscreen'] },
      },
    },
    async execute(projectPath: string, args: { presetName?: string; canvasMode?: 'fixed' | 'responsive' | 'fullscreen' }) {
      try {
        const preset: ExportPreset = {
          id: 'web-auto-export',
          name: args.presetName || 'HTML5 Web',
          platform: 'web',
          backend: 'linden',
          arch: ['wasm'],
          output: 'build/web',
          mode: 'release',
          canvasMode: args.canvasMode || 'responsive',
          zipOutput: true,
        }

        const result = await WebBuildRunner.runBuild({
          projectPath,
          preset,
        })

        return {
          success: result.success,
          data: {
            outputPath: result.outputPath,
            zipPath: result.zipPath,
            durationMs: result.durationMs,
            totalSize: result.report?.totalSizeFormatted,
          },
          error: result.error,
        }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },

  ...MODEL_TOOLS,
}
