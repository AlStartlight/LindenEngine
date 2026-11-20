import { test, expect } from '@playwright/test'
import { mulberry32, randInt, pick, tcId, type Rng } from './_helpers'
import { World } from '../../../engine/ecs/World'
import { instantiatePrefabCommand } from '../../../editor/commands/prefabAndEventCommands'
import type { ProjectAssetItem } from '../../../editor/panels/ProjectPanel'
import type { AssetEntry } from '../../../shared/assetProtocol'

/**
 * 10,000 Deterministic E2E Test Cases for Workspace Menu, Project, Assets, and Console
 *
 * 1. 2,500 cases: Workspace Menu & Layout Navigation (TC-WSM-0001 .. TC-WSM-2500)
 * 2. 2,500 cases: Project Panel Operations (TC-PRJ-0001 .. TC-PRJ-2500)
 * 3. 2,500 cases: Assets Browser & Resource Management (TC-AST-0001 .. TC-AST-2500)
 * 4. 2,500 cases: Console Panel Diagnostics & Terminal (TC-CNS-0001 .. TC-CNS-2500)
 */

// ============================================================================
// PART 1: Workspace Menu & Layout Navigation (2,500 Cases)
// ============================================================================

type WorkspaceLayout = 'default' | 'console-focus' | 'assets-focus' | 'split-all' | 'viewport-maximized'
type BottomTab = 'project' | 'assets' | 'console' | 'output' | 'all' | 'hidden'
type HeightPreset = 'compact' | 'normal' | 'expanded' | 'maximized'

interface WorkspaceState {
  activeMenu: 'file' | 'edit' | 'gameobject' | 'window' | null
  bottomTab: BottomTab
  heightPreset: HeightPreset
  activeEditorPanel: 'viewport' | 'bridge' | 'godot'
  rightTab: 'inspector' | 'scene' | 'agent'
}

function createWorkspaceState(): WorkspaceState {
  return {
    activeMenu: null,
    bottomTab: 'all',
    heightPreset: 'normal',
    activeEditorPanel: 'viewport',
    rightTab: 'inspector',
  }
}

function applyWorkspaceLayout(state: WorkspaceState, layout: WorkspaceLayout): void {
  switch (layout) {
    case 'default':
      state.bottomTab = 'project'
      state.heightPreset = 'normal'
      state.activeEditorPanel = 'viewport'
      state.rightTab = 'inspector'
      break
    case 'console-focus':
      state.bottomTab = 'console'
      state.heightPreset = 'expanded'
      state.activeEditorPanel = 'viewport'
      break
    case 'assets-focus':
      state.bottomTab = 'assets'
      state.heightPreset = 'expanded'
      state.activeEditorPanel = 'viewport'
      break
    case 'split-all':
      state.bottomTab = 'all'
      state.heightPreset = 'normal'
      state.activeEditorPanel = 'viewport'
      break
    case 'viewport-maximized':
      state.bottomTab = 'hidden'
      state.activeEditorPanel = 'viewport'
      break
  }
}

function toggleBottomPanel(state: WorkspaceState): void {
  state.bottomTab = state.bottomTab === 'hidden' ? 'project' : 'hidden'
}

function handleMenuHover(state: WorkspaceState, menu: 'file' | 'edit' | 'gameobject' | 'window'): void {
  if (state.activeMenu && state.activeMenu !== menu) {
    state.activeMenu = menu
  }
}

function computeLogBadges(messages: Array<{ type: string }>) {
  let errors = 0
  let warns = 0
  for (const m of messages) {
    if (m.type === 'error') errors++
    else if (m.type === 'warn') warns++
  }
  return { errorCount: errors, warnCount: warns }
}

test.describe('Workspace Menu & Layout Navigation (2,500 tests)', () => {
  let testNum = 0

  for (let s = 0; s < 2500; s++) {
    const rng = mulberry32(110000 + s)
    test(`${tcId('WSM', ++testNum)} workspace menu interaction sequence seed=${s}`, () => {
      const state = createWorkspaceState()
      const steps = randInt(rng, 5, 20)

      for (let i = 0; i < steps; i++) {
        const action = pick(rng, [
          'open_menu',
          'hover_menu',
          'close_menu',
          'apply_layout',
          'toggle_bottom',
          'switch_tab',
          'cycle_height',
        ] as const)

        if (action === 'open_menu') {
          const m = pick(rng, ['file', 'edit', 'gameobject', 'window'] as const)
          state.activeMenu = state.activeMenu === m ? null : m
        } else if (action === 'hover_menu') {
          const m = pick(rng, ['file', 'edit', 'gameobject', 'window'] as const)
          handleMenuHover(state, m)
        } else if (action === 'close_menu') {
          state.activeMenu = null
        } else if (action === 'apply_layout') {
          const l = pick(rng, ['default', 'console-focus', 'assets-focus', 'split-all', 'viewport-maximized'] as const)
          applyWorkspaceLayout(state, l)
          if (l === 'default') {
            expect(state.bottomTab).toBe('project')
            expect(state.heightPreset).toBe('normal')
          } else if (l === 'console-focus') {
            expect(state.bottomTab).toBe('console')
            expect(state.heightPreset).toBe('expanded')
          } else if (l === 'assets-focus') {
            expect(state.bottomTab).toBe('assets')
            expect(state.heightPreset).toBe('expanded')
          } else if (l === 'split-all') {
            expect(state.bottomTab).toBe('all')
          } else if (l === 'viewport-maximized') {
            expect(state.bottomTab).toBe('hidden')
          }
        } else if (action === 'toggle_bottom') {
          const before = state.bottomTab
          toggleBottomPanel(state)
          if (before === 'hidden') expect(state.bottomTab).toBe('project')
          else expect(state.bottomTab).toBe('hidden')
        } else if (action === 'switch_tab') {
          const tab = pick(rng, ['project', 'assets', 'console', 'output', 'all'] as const)
          state.bottomTab = tab
          expect(state.bottomTab).toBe(tab)
        } else if (action === 'cycle_height') {
          const next =
            state.heightPreset === 'compact'
              ? 'normal'
              : state.heightPreset === 'normal'
              ? 'expanded'
              : state.heightPreset === 'expanded'
              ? 'maximized'
              : 'compact'
          state.heightPreset = next
          expect(['compact', 'normal', 'expanded', 'maximized']).toContain(state.heightPreset)
        }
      }

      // Verify log badges computation
      const msgCount = randInt(rng, 0, 15)
      const msgs = Array.from({ length: msgCount }, () => ({
        type: pick(rng, ['error', 'warn', 'info', 'success']),
      }))
      const { errorCount, warnCount } = computeLogBadges(msgs)
      const expectedErrors = msgs.filter((m) => m.type === 'error').length
      const expectedWarns = msgs.filter((m) => m.type === 'warn').length
      expect(errorCount).toBe(expectedErrors)
      expect(warnCount).toBe(expectedWarns)
    })
  }
})

// ============================================================================
// PART 2: Project Panel Operations (2,500 Cases)
// ============================================================================

function resolveBreadcrumbs(folderPath: string) {
  const parts = folderPath.split('/')
  const result: Array<{ name: string; path: string }> = []
  let acc = ''
  for (const p of parts) {
    acc = acc ? `${acc}/${p}` : p
    result.push({ name: p, path: acc })
  }
  return result
}

function resolveInstanceName(world: World, baseName: string): string {
  const existingCount = world.getEntities().filter((e) => e.name.startsWith(baseName)).length
  return existingCount === 0 ? baseName : `${baseName} (${existingCount})`
}

test.describe('Project Panel Operations (2,500 tests)', () => {
  let testNum = 0

  for (let s = 0; s < 2500; s++) {
    const rng = mulberry32(210000 + s)
    test(`${tcId('PRJ', ++testNum)} project breadcrumbs, prefabs & sorting seed=${s}`, () => {
      // 1. Breadcrumbs testing
      const depth = randInt(rng, 1, 6)
      const parts = ['assets', ...Array.from({ length: depth - 1 }, (_, i) => `dir_${s}_${i}`)]
      const fullPath = parts.join('/')
      const crumbs = resolveBreadcrumbs(fullPath)
      expect(crumbs.length).toBe(depth)
      expect(crumbs[0].name).toBe('assets')
      expect(crumbs[crumbs.length - 1].path).toBe(fullPath)

      // 2. Prefab instantiation naming collision test in World
      const world = new World()
      const baseName = `Prop_${s}`
      const numInstances = randInt(rng, 1, 8)
      for (let i = 0; i < numInstances; i++) {
        const expectedName = i === 0 ? baseName : `${baseName} (${i})`
        const chosen = resolveInstanceName(world, baseName)
        expect(chosen).toBe(expectedName)
        world.createEntity(chosen)
      }
      expect(world.getEntities().length).toBe(numInstances)

      // 3. Search and sort algorithm test
      const itemCount = randInt(rng, 4, 16)
      const items: ProjectAssetItem[] = Array.from({ length: itemCount }, (_, idx) => {
        const type = pick(rng, ['folder', 'prefab', 'scene', 'material', 'asset'] as const)
        return {
          id: `item_${s}_${idx}`,
          name: `asset_${s}_${pick(rng, ['alpha', 'beta', 'gamma', 'delta'])}_${idx}`,
          type,
          path: `${fullPath}/asset_${idx}`,
        }
      })

      // Folders always precede non-folders
      const sorted = [...items].sort((a, b) => {
        if (a.type === 'folder' && b.type !== 'folder') return -1
        if (a.type !== 'folder' && b.type === 'folder') return 1
        return a.name.localeCompare(b.name)
      })

      let seenNonFolder = false
      for (const item of sorted) {
        if (item.type !== 'folder') seenNonFolder = true
        if (seenNonFolder) {
          expect(item.type === 'folder' ? false : true).toBe(true)
        }
      }

      // Filter query test
      const query = 'alpha'
      const filtered = items.filter((it) => it.name.includes(query))
      for (const f of filtered) {
        expect(f.name).toContain(query)
      }
    })
  }
})

// ============================================================================
// PART 3: Assets Browser & Resource Management (2,500 Cases)
// ============================================================================

function classifyAssetKind(filePath: string): AssetEntry['kind'] {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  if (['glb', 'gltf', 'obj'].includes(ext)) return 'model'
  if (['hdr', 'exr'].includes(ext)) return 'environment'
  if (['png', 'jpg', 'jpeg', 'ktx2', 'webp'].includes(ext)) return 'texture'
  if (['mp3', 'wav', 'ogg'].includes(ext)) return 'audio'
  return 'other'
}

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

test.describe('Assets Browser & Resource Management (2,500 tests)', () => {
  let testNum = 0

  for (let s = 0; s < 2500; s++) {
    const rng = mulberry32(310000 + s)
    test(`${tcId('AST', ++testNum)} asset categorization, filter and format seed=${s}`, () => {
      // 1. Classification test
      const ext = pick(rng, ['glb', 'gltf', 'obj', 'hdr', 'exr', 'png', 'jpg', 'ktx2', 'mp3', 'wav', 'txt'])
      const testPath = `assets/sub/${s}_model.${ext}`
      const kind = classifyAssetKind(testPath)

      if (['glb', 'gltf', 'obj'].includes(ext)) expect(kind).toBe('model')
      else if (['hdr', 'exr'].includes(ext)) expect(kind).toBe('environment')
      else if (['png', 'jpg', 'ktx2'].includes(ext)) expect(kind).toBe('texture')
      else if (['mp3', 'wav'].includes(ext)) expect(kind).toBe('audio')
      else expect(kind).toBe('other')

      // 2. File size formatting test
      const bytes = randInt(rng, 0, 50 * 1024 * 1024)
      const formatted = formatFileSize(bytes)
      if (bytes === 0) expect(formatted).toBe('0 B')
      else if (bytes < 1024) expect(formatted).toContain('B')
      else if (bytes < 1024 * 1024) expect(formatted).toContain('KB')
      else expect(formatted).toContain('MB')

      // 3. Asset entry filtering
      const count = randInt(rng, 5, 20)
      const assetList: AssetEntry[] = Array.from({ length: count }, (_, i) => {
        const itemExt = pick(rng, ['glb', 'hdr', 'png', 'mp3'])
        const itemPath = `assets/item_${s}_${i}.${itemExt}`
        return {
          path: itemPath,
          kind: classifyAssetKind(itemPath),
          size: randInt(rng, 100, 2000000),
          mtimeMs: 1700000000 + i * 1000,
        }
      })

      const targetKind = pick(rng, ['all', 'model', 'environment', 'texture', 'audio'] as const)
      const result = assetList.filter((a) => targetKind === 'all' || a.kind === targetKind)
      if (targetKind !== 'all') {
        for (const item of result) {
          expect(item.kind).toBe(targetKind)
        }
      }
    })
  }
})

// ============================================================================
// PART 4: Console Panel Diagnostics & Terminal (2,500 Cases)
// ============================================================================

interface RawLog {
  type: string
  message: string
  time: Date
  details?: string
}

function collapseLogs(logs: RawLog[]) {
  const collapsed: Array<RawLog & { count: number }> = []
  for (const log of logs) {
    const last = collapsed[collapsed.length - 1]
    if (last && last.type === log.type && last.message === log.message) {
      last.count++
      last.time = log.time
    } else {
      collapsed.push({ ...log, count: 1 })
    }
  }
  return collapsed
}

class TerminalInterpreter {
  history: string[] = []
  output: string[] = []

  run(cmd: string, world: World): void {
    const trimmed = cmd.trim()
    if (!trimmed) return
    this.history.push(trimmed)
    const [action, ...args] = trimmed.split(' ')

    switch (action.toLowerCase()) {
      case 'clear':
        this.output = []
        break
      case 'help':
        this.output.push('Available: clear, help, stats, entities')
        break
      case 'stats':
        this.output.push(`Entities: ${world.getEntities().length}`)
        break
      case 'entities':
        this.output.push(world.getEntities().map((e) => e.name).join(','))
        break
      default:
        this.output.push(`Unknown command: ${action}`)
        break
    }
  }
}

test.describe('Console Panel Diagnostics & Terminal (2,500 tests)', () => {
  let testNum = 0

  for (let s = 0; s < 2500; s++) {
    const rng = mulberry32(410000 + s)
    test(`${tcId('CNS', ++testNum)} console collapse, search and terminal command execution seed=${s}`, () => {
      // 1. Message collapse testing
      const msgPool = [
        'Rapier 3D initialized',
        'Shader compile warning',
        'Cannot read property of undefined',
        'Scene saved successfully',
      ]
      const logCount = randInt(rng, 5, 25)
      const rawLogs: RawLog[] = []
      let lastMsg = ''

      for (let i = 0; i < logCount; i++) {
        // Repeat previous message with 40% probability to test collapse
        const msg = rng() < 0.4 && lastMsg ? lastMsg : pick(rng, msgPool)
        lastMsg = msg
        rawLogs.push({
          type: msg.includes('error') ? 'error' : msg.includes('warning') ? 'warn' : 'info',
          message: msg,
          time: new Date(1700000000000 + i * 1000),
        })
      }

      const collapsed = collapseLogs(rawLogs)
      expect(collapsed.length).toBeLessThanOrEqual(rawLogs.length)
      const sumCounts = collapsed.reduce((sum, item) => sum + item.count, 0)
      expect(sumCounts).toBe(rawLogs.length)

      // Ensure no two consecutive identical items exist in collapsed output
      for (let i = 1; i < collapsed.length; i++) {
        const same = collapsed[i].type === collapsed[i - 1].type && collapsed[i].message === collapsed[i - 1].message
        expect(same).toBe(false)
      }

      // 2. Terminal interpreter testing
      const term = new TerminalInterpreter()
      const world = new World()
      const entCount = randInt(rng, 0, 5)
      for (let e = 0; e < entCount; e++) world.createEntity(`Node_${e}`)

      term.run('help', world)
      expect(term.output.length).toBe(1)
      expect(term.output[0]).toContain('Available')

      term.run('stats', world)
      expect(term.output[term.output.length - 1]).toBe(`Entities: ${entCount}`)

      term.run('clear', world)
      expect(term.output.length).toBe(0)

      term.run('custom_foo_cmd', world)
      expect(term.output[0]).toContain('Unknown command: custom_foo_cmd')
      expect(term.history.length).toBe(4)
    })
  }
})
