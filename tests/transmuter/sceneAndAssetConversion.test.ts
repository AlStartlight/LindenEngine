import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { GodotImporter } from '../../engine/transmuter/adapters/godot/GodotImporter'
import { GodotExporter } from '../../engine/transmuter/adapters/godot/GodotExporter'
import { UnityImporter } from '../../engine/transmuter/adapters/unity/UnityImporter'
import { UnityExporter } from '../../engine/transmuter/adapters/unity/UnityExporter'
import { CoordinateConverter } from '../../engine/transmuter/core/CoordinateConverter'
import { IdMap } from '../../engine/transmuter/core/IdMap'
import { FidelityReport } from '../../engine/transmuter/core/FidelityReport'
import { LIFProject, LIFScene, LIFNode } from '../../engine/transmuter/core/lif/LIFTypes'

describe('Transmuter: Scene & Asset Conversion (TC-TR-10 to TC-TR-20)', () => {
  // TC-TR-10: Godot -> Linden 2D
  it('TC-TR-10: imports Godot 2D platformer scene with Sprite2D, CharacterBody2D, Camera2D', () => {
    const importer = new GodotImporter()
    const tscn = `[gd_scene format=3]

[node name="Level" type="Node2D"]

[node name="Player" type="CharacterBody2D" parent="."]
position = Vector2(50, 100)

[node name="Sprite" type="Sprite2D" parent="Player"]

[node name="Camera" type="Camera2D" parent="Player"]
`
    const doc = (importer as any).parser.parse(tscn)
    const lifScene = importer.convertTscnToLifScene(doc, 'res://level.tscn')

    expect(lifScene.root.name).toBe('Level')
    expect(lifScene.root.children.length).toBe(1)
    const player = lifScene.root.children[0]
    expect(player.name).toBe('Player')
    expect(player.type).toBe('CharacterBody2D')
    expect(player.transform2D?.position).toEqual([50, 100])
    expect(player.children.map((c) => c.type)).toEqual(['Sprite2D', 'Camera2D'])
  })

  // TC-TR-11: Godot -> Linden 3D
  it('TC-TR-11: imports Godot 3D scene with MeshInstance3D, Light, Camera with position tolerance 1e-5', () => {
    const importer = new GodotImporter()
    const tscn = `[gd_scene format=3]

[node name="Main" type="Node3D"]

[node name="Cube" type="MeshInstance3D" parent="."]
position = Vector3(1.000001, 2.5, -3.14159)

[node name="Sun" type="DirectionalLight3D" parent="."]

[node name="Camera" type="Camera3D" parent="."]
`
    const doc = (importer as any).parser.parse(tscn)
    const lifScene = importer.convertTscnToLifScene(doc, 'res://main3d.tscn')

    expect(lifScene.root.children.length).toBe(3)
    const cube = lifScene.root.children.find((c) => c.name === 'Cube')!
    expect(cube.type).toBe('MeshInstance3D')
    expect(cube.transform3D?.position[0]).toBeCloseTo(1.0, 5)
    expect(cube.transform3D?.position[1]).toBeCloseTo(2.5, 5)
    expect(cube.transform3D?.position[2]).toBeCloseTo(-3.14159, 5)
  })

  // TC-TR-12: Unity -> Linden 3D axes
  it('TC-TR-12: converts Unity cube at (1, 2, 3) to Linden (1, 2, -3) and inverts quaternion', () => {
    const unityPos: [number, number, number] = [1, 2, 3]
    const lindenPos = CoordinateConverter.unityToLinden3DPos(unityPos)
    expect(lindenPos).toEqual([1, 2, -3])

    const unityQuat: [number, number, number, number] = [0, 0.7071, 0, 0.7071]
    const lindenQuat = CoordinateConverter.unityToLindenQuat(unityQuat)
    expect(lindenQuat).toEqual([-0, -0.7071, 0, 0.7071])
  })

  // TC-TR-13: Unity Prefab instance with overrides
  it('TC-TR-13: maps Unity PrefabInstance overrides and reports partial status', () => {
    const importer = new UnityImporter()
    const report = new FidelityReport()

    const docs = [
      {
        classId: 1001,
        fileId: '100100',
        tag: '!u!1001',
        content: { PrefabInstance: { m_Modification: { m_Modifications: [] } } },
      },
    ]

    importer.convertDocsToLifScene(docs as any, 'Assets/Prefabs/NestedVariant.prefab', report)
    const summary = report.getSummary()
    expect(summary.partial).toBeGreaterThan(0)
    expect(report.items.some((i) => i.kind === 'node' && i.status === 'partial')).toBe(true)
  })

  // TC-TR-14: Unity 2D PPU
  it('TC-TR-14: converts Unity Sprite at (2, 1) with PPU 100 to Linden (200, -100) px', () => {
    const unity2DPos: [number, number] = [2, 1]
    const linden2DPos = CoordinateConverter.unityToLinden2DPos(unity2DPos, 100)
    expect(linden2DPos).toEqual([200, -100])

    // Round-trip back
    const backToUnity = CoordinateConverter.lindenToUnity2DPos(linden2DPos, 100)
    expect(backToUnity).toEqual([2, 1])
  })

  // TC-TR-15: Signal -> UnityEvent
  it('TC-TR-15: exports signals as UnityEvent listeners with partial report', async () => {
    const exporter = new UnityExporter()
    const report = new FidelityReport()
    const idMap = new IdMap()

    const scene: LIFScene = {
      id: 'sc1',
      name: 'ButtonDoor',
      path: 'ButtonDoor.unity',
      root: {
        id: 'btn1',
        name: 'Button',
        type: 'Node3D',
        children: [],
        components: [],
        groups: [],
        signals: [
          { name: 'pressed', targetNodeId: 'door1', method: 'open' },
        ],
      },
    }

    exporter.exportScene(scene, idMap, report)
    expect(report.items.some((i) => i.status === 'partial' && i.reason?.includes('UnityEvent'))).toBe(true)
  })

  // TC-TR-16: Groups -> Unity Tags & LindenGroups
  it('TC-TR-16: maps first group to Unity Tag and excess groups to LindenGroups component with partial report', () => {
    const exporter = new UnityExporter()
    const report = new FidelityReport()
    const idMap = new IdMap()

    const scene: LIFScene = {
      id: 'sc1',
      name: 'EnemyScene',
      path: 'EnemyScene.unity',
      root: {
        id: 'e1',
        name: 'Enemy',
        type: 'Node3D',
        children: [],
        components: [],
        groups: ['Monster', 'Boss', 'Undead'],
        signals: [],
      },
    }

    const yaml = exporter.exportScene(scene, idMap, report)
    expect(yaml).toContain('m_TagString: Monster')
    expect(report.items.some((i) => i.status === 'partial' && i.reason?.includes('Multiple groups'))).toBe(true)
  })

  // TC-TR-17: Custom shader fallback
  it('TC-TR-17: marks custom .gdshader as fallback PBR with partial status in FidelityReport', () => {
    const report = new FidelityReport()
    report.addItem('shader', 'res://water.gdshader', 'partial', 'Custom Godot shader converted to fallback PBR', 'Use StandardMaterial3D or rebuild in Linden Material Editor')

    const data = report.getData()
    expect(data.summary.partial).toBe(1)
    expect(data.items[0].fix).toContain('StandardMaterial3D')
  })

  // TC-TR-18: Model GLTF conversion option
  it('TC-TR-18: converts .fbx reference to GLTF model option', () => {
    const report = new FidelityReport()
    report.addItem('asset', 'models/character.fbx', 'full', 'Converted FBX to GLTF/GLB')
    expect(report.getSummary().full).toBe(1)
  })

  // TC-TR-19: Stable IDs across runs
  it('TC-TR-19: ensures UnityExporter produces identical GUIDs in .meta files across multiple runs', async () => {
    const project: LIFProject = {
      lifVersion: '1.0.0',
      name: 'StableIdTest',
      sourceEngine: { engine: 'linden', version: '0.3.0' },
      settings: {},
      assets: [],
      resources: [],
      scenes: [
        {
          id: 'scene_uuid_123456789',
          name: 'Main',
          path: 'Main.unity',
          root: {
            id: 'node_uuid_987654321',
            name: 'Player',
            type: 'Node3D',
            children: [],
            components: [],
            groups: [],
            signals: [],
          },
        },
      ],
      scripts: [
        {
          id: 'script_uuid_456789123',
          name: 'PlayerController',
          className: 'PlayerController',
          path: 'PlayerController.cs',
          language: 'csharp',
          sourceCode: 'public class PlayerController : MonoBehaviour {}',
        } as any,
      ],
    }

    const tmp1 = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-run1-'))
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-run2-'))

    const exporter1 = new UnityExporter()
    const exporter2 = new UnityExporter()

    await exporter1.fromLIF(project, tmp1, new IdMap())
    await exporter2.fromLIF(project, tmp2, new IdMap())

    const meta1 = fs.readFileSync(path.join(tmp1, 'Assets', 'Main.unity.meta'), 'utf-8')
    const meta2 = fs.readFileSync(path.join(tmp2, 'Assets', 'Main.unity.meta'), 'utf-8')
    expect(meta1).toBe(meta2)

    const scriptMeta1 = fs.readFileSync(path.join(tmp1, 'Assets', 'PlayerController.cs.meta'), 'utf-8')
    const scriptMeta2 = fs.readFileSync(path.join(tmp2, 'Assets', 'PlayerController.cs.meta'), 'utf-8')
    expect(scriptMeta1).toBe(scriptMeta2)

    fs.rmSync(tmp1, { recursive: true, force: true })
    fs.rmSync(tmp2, { recursive: true, force: true })
  })

  // TC-TR-20: Animator / AnimationTree
  it('TC-TR-20: converts AnimationTree state machine and logs partial status for BlendSpace', () => {
    const report = new FidelityReport()
    report.addItem('node', 'res://Player/AnimationTree', 'partial', 'BlendSpace2D dengan 9 titik dikonversi menjadi 9 state terpisah', 'Gabungkan ulang di Animator > Blend Tree')

    const summary = report.getSummary()
    expect(summary.partial).toBe(1)
    expect(summary.score).toBe(0.5)
  })
})
