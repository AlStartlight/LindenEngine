import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { TscnParser, tscnDocumentToSceneIR } from '../../engine/godot/tscn/TscnParser'
import { normalizeGodotPath, validateGodotBinary } from '../../electron/bridge/godotExec'
import { detectGodotProject } from '../../electron/bridge/godotDetect'
import { mapGodotSceneIR } from '../../electron/bridge/godotMapper'
import { writeLindenProject } from '../../electron/bridge/projectWriter'
import * as childProcess from 'node:child_process'

describe('Godot Bridge Import Project (SPEC-Bridge-Import-Godot-Project)', () => {
  const fixtureDir = path.join(process.cwd(), 'fixtures/godot/mini-3d')

  // 1. Parser tests
  describe('TscnParser multi-line string handling', () => {
    it('parses multi-line strings with brackets without breaking into section headers', () => {
      const hudTscnPath = path.join(fixtureDir, 'ui/hud.tscn')
      const content = fs.readFileSync(hudTscnPath, 'utf-8')
      const parser = new TscnParser()
      const doc = parser.parse(content)

      expect(doc.nodes.length).toBe(2)
      const labelNode = doc.nodes.find((n) => n.name === 'CreditsLabel')
      expect(labelNode).toBeDefined()
      expect(labelNode?.properties['text']).toContain('[font_size=20]')
      expect(labelNode?.properties['text']).toContain('[font_size=16]')
    })

    it('resolves ext_resource for instance node', () => {
      const mainTscnPath = path.join(fixtureDir, 'main.tscn')
      const content = fs.readFileSync(mainTscnPath, 'utf-8')
      const parser = new TscnParser()
      const doc = parser.parse(content)

      const player1 = doc.nodes.find((n) => n.name === 'Player1')
      expect(player1).toBeDefined()
      expect(player1?.instancePath).toBe('res://player.tscn')

      const sceneIR = tscnDocumentToSceneIR(doc, 'res://main.tscn')
      const player1IR = sceneIR.nodes.find((n) => n.name === 'Player1')
      expect(player1IR?.instance).toBe('res://player.tscn')
    })
  })

  // 2. Executable resolution and validation
  describe('resolveGodotExecutable & validateGodotBinary', () => {
    it('normalizes macOS .app bundle to Contents/MacOS/Godot if present', () => {
      const fakeApp = '/Fake/Applications/Godot.app'
      const norm = normalizeGodotPath(fakeApp)
      // Since it doesn't physically exist, normalizeGodotPath returns clean path
      expect(norm).toBe('/Fake/Applications/Godot.app')
    })

    it('validates binary output and rejects version < 4.3', () => {
      const runner = () => ({
        status: 0,
        stdout: '3.5.1.stable.official\n',
        stderr: '',
      })

      const res = validateGodotBinary(process.execPath, runner)
      expect(res.ok).toBe(false)
      expect(res.reason).toContain('Versi Godot minimal 4.3 diperlukan')
    })

    it('accepts Godot version >= 4.3 (e.g. 4.7.2)', () => {
      const runner = () => ({
        status: 0,
        stdout: '4.7.2.stable.official.972322\n',
        stderr: '',
      })

      const res = validateGodotBinary(process.execPath, runner)
      expect(res.ok).toBe(true)
      expect(res.version).toBe('4.7.2')
    })
  })

  // 3. Project Detect
  describe('detectGodotProject', () => {
    it('detects Godot project info from project.godot', () => {
      const info = detectGodotProject(fixtureDir)
      expect(info.name).toBe('Mini 3D Test')
      expect(info.godotVersion).toBe('4.3')
      expect(info.configVersion).toBe(5)
      expect(info.mainScene).toBe('res://main.tscn')
      expect(info.viewport.width).toBe(1280)
      expect(info.viewport.height).toBe(720)
      expect(info.autoloads.length).toBe(1)
      expect(info.autoloads[0].name).toBe('Global')
      expect(info.inputActions).toContain('jump')
      expect(info.inputActions).toContain('move_left')
      expect(info.counts.scenes).toBeGreaterThanOrEqual(4)
      expect(info.counts.scripts).toBeGreaterThanOrEqual(1)
      expect(info.counts.assets).toBeGreaterThanOrEqual(1)
    })
  })

  // 4. Mapper IR -> Linden Scene
  describe('mapGodotSceneIR', () => {
    it('maps native CSGBox3D, Camera3D, DirectionalLight3D, RigidBody3D and Passthrough', () => {
      const mainTscnPath = path.join(fixtureDir, 'main.tscn')
      const content = fs.readFileSync(mainTscnPath, 'utf-8')
      const parser = new TscnParser()
      const doc = parser.parse(content)
      const sceneIR = tscnDocumentToSceneIR(doc, 'res://main.tscn')

      const mapped = mapGodotSceneIR(sceneIR)
      expect(mapped.sceneData.format).toBe('linden-scene')
      expect(mapped.sceneData.version).toBe(2)

      const cameraEntity = mapped.sceneData.entities.find((e) => e.name === 'Camera3D')
      expect(cameraEntity).toBeDefined()
      expect(cameraEntity.components.some((c: any) => c.type === 'Camera')).toBe(true)

      const csgEntity = mapped.sceneData.entities.find((e) => e.name === 'CSGBox3D')
      expect(csgEntity).toBeDefined()
      expect(csgEntity.components.some((c: any) => c.type === 'MeshRenderer')).toBe(true)

      const player1Entity = mapped.sceneData.entities.find((e) => e.name === 'Player1')
      expect(player1Entity).toBeDefined()
      expect(player1Entity.prefab?.source).toBe('scenes/player.lscene')
    })
  })

  // 5. Project Writer (End-to-End without Godot binary)
  describe('writeLindenProject', () => {
    let tmpDest: string

    beforeEach(() => {
      tmpDest = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-import-test-'))
    })

    afterEach(() => {
      try {
        fs.rmSync(tmpDest, { recursive: true, force: true })
      } catch {}
    })

    it('writes project structure, preserves same-named files in different subdirectories, and creates reports', async () => {
      const info = detectGodotProject(fixtureDir)
      const parser = new TscnParser()

      const sceneFiles = [
        'main.tscn',
        'player.tscn',
        'ui/hud.tscn',
        'a/level.tscn',
        'b/level.tscn',
      ]

      const scenes = sceneFiles.map((f) => {
        const full = path.join(fixtureDir, f)
        const content = fs.readFileSync(full, 'utf-8')
        const doc = parser.parse(content)
        return tscnDocumentToSceneIR(doc, `res://${f}`)
      })

      const result = await writeLindenProject(
        info,
        scenes,
        {
          jobId: 'test-job',
          dir: fixtureDir,
          dest: tmpDest,
          name: 'MiniGame',
          transpileScripts: true,
          copyAddons: true,
        }
      )

      expect(fs.existsSync(result.projectPath)).toBe(true)
      expect(fs.existsSync(result.reportPath)).toBe(true)

      // Verify no collision between a/level.lscene and b/level.lscene
      expect(fs.existsSync(path.join(result.projectPath, 'scenes/a/level.lscene'))).toBe(true)
      expect(fs.existsSync(path.join(result.projectPath, 'scenes/b/level.lscene'))).toBe(true)

      // Verify project.linden.json
      const manifestPath = path.join(result.projectPath, 'project.linden.json')
      expect(fs.existsSync(manifestPath)).toBe(true)
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
      expect(manifest.name).toBe('MiniGame')
      expect(manifest.scenesInBuild[0]).toBe('scenes/main.lscene')
      expect(manifest.display.width).toBe(1280)
      expect(manifest.display.height).toBe(720)

      // Verify assets and scripts copied
      expect(fs.existsSync(path.join(result.projectPath, 'assets/assets/icon.png'))).toBe(true)
      expect(fs.existsSync(path.join(result.projectPath, 'scripts/scripts/player.gd'))).toBe(true)

      // Verify summary report
      expect(result.summary.totalScenes).toBe(5)
      expect(result.summary.assetsCopied).toBeGreaterThanOrEqual(1)
      expect(result.summary.scriptsCopied).toBeGreaterThanOrEqual(1)
    })
  })
})
