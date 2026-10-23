import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { GodotImporter } from '../../engine/transmuter/adapters/godot/GodotImporter'
import { UnityImporter } from '../../engine/transmuter/adapters/unity/UnityImporter'
import { UnityYamlParser, UnityYamlParserError } from '../../engine/transmuter/adapters/unity/UnityYamlParser'
import { TscnParser } from '../../engine/godot/tscn/TscnParser'
import { Pipeline } from '../../engine/transmuter/core/Pipeline'

describe('Transmuter: Detection & Parsing (TC-TR-01 to TC-TR-09)', () => {
  // TC-TR-01: Detect Godot 4
  it('TC-TR-01: detects Godot 4 project with config_version=5 as supported', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'godot4-test-'))
    fs.writeFileSync(path.join(tmp, 'project.godot'), 'config_version=5\n[application]\nconfig/name="TestGodot4"', 'utf-8')

    const importer = new GodotImporter()
    const res = await importer.detect(tmp)

    expect(res.engine).toBe('godot')
    expect(res.supported).toBe(true)
    expect(res.version).toContain('4')
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  // TC-TR-02: Reject Godot 3
  it('TC-TR-02: detects Godot 3 project with config_version=4 and rejects as unsupported', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'godot3-test-'))
    fs.writeFileSync(path.join(tmp, 'project.godot'), 'config_version=4\n[application]\nconfig/name="OldGodot3"', 'utf-8')

    const importer = new GodotImporter()
    const res = await importer.detect(tmp)

    expect(res.engine).toBe('godot')
    expect(res.supported).toBe(false)
    expect(res.reason).toContain('Godot 3.x is not supported')
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  // TC-TR-03: Detect Unity
  it('TC-TR-03: detects Unity project with ProjectSettings/ProjectVersion.txt 2022.3', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-test-'))
    const ps = path.join(tmp, 'ProjectSettings')
    fs.mkdirSync(ps, { recursive: true })
    fs.writeFileSync(path.join(ps, 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.21f1\n', 'utf-8')

    const importer = new UnityImporter()
    const res = await importer.detect(tmp)

    expect(res.engine).toBe('unity')
    expect(res.supported).toBe(true)
    expect(res.version).toContain('2022.3')
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  // TC-TR-04: Reject Unity Binary Serialization
  it('TC-TR-04: rejects binary serialized Unity scene with message to switch to Force Text', () => {
    const binaryContent = 'UnityFS\u0000\u0000\u0001\u0000\u0000\u0000'
    const parser = new UnityYamlParser()

    expect(() => parser.parse(binaryContent)).toThrow('ubah Asset Serialization ke Force Text')
  })

  // TC-TR-05: Parse .tscn with ext_resource, sub_resource, nested nodes, connections
  it('TC-TR-05: parses .tscn with ext_resource, sub_resource, nested nodes, and connections', () => {
    const tscn = `[gd_scene format=3]

[ext_resource type="Texture2D" path="res://icon.png" id="1_abc"]

[sub_resource type="BoxShape3D" id="BoxShape3D_1"]
size = Vector3(1, 1, 1)

[node name="Level" type="Node3D"]

[node name="Player" type="Node3D" parent="."]

[node name="Trigger" type="Area3D" parent="Player"]

[connection signal="body_entered" from="Trigger" to="Player" method="_on_body_entered"]
`
    const parser = new TscnParser()
    const doc = parser.parse(tscn)

    expect(doc.extResources.length).toBe(1)
    expect(doc.extResources[0].id).toBe('1_abc')
    expect(doc.subResources.length).toBe(1)
    expect(doc.nodes.length).toBe(3)
    expect(doc.connections.length).toBe(1)
    expect(doc.connections[0].signal).toBe('body_entered')
  })

  // TC-TR-06: Parse Unity YAML documents connected via fileID
  it('TC-TR-06: parses Unity YAML with GameObject and Transform connected via fileID', () => {
    const yaml = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &1001
GameObject:
  m_Name: MainCamera
--- !u!4 &1002
Transform:
  m_GameObject: {fileID: 1001}
  m_LocalPosition: {x: 0, y: 1, z: -10}
`
    const parser = new UnityYamlParser()
    const docs = parser.parse(yaml)

    expect(docs.length).toBe(2)
    expect(docs[0].classId).toBe(1)
    expect(docs[0].fileId).toBe('1001')
    expect(docs[1].classId).toBe(4)
    expect(docs[1].content.Transform.m_GameObject.fileID).toBe(1001)
  })

  // TC-TR-07: Broken reference in prefab
  it('TC-TR-07: handles broken reference gracefully and logs unsupported item in report', () => {
    const importer = new UnityImporter()
    const docs = [
      {
        classId: 1,
        fileId: '1',
        tag: '!u!1',
        content: { GameObject: { m_Name: 'SpriteObj' } },
      },
      {
        classId: 4,
        fileId: '2',
        tag: '!u!4',
        content: { Transform: { m_GameObject: { fileID: 1 }, m_LocalPosition: { x: 0, y: 0, z: 0 } } },
      },
      {
        classId: 212,
        fileId: '3',
        tag: '!u!212',
        content: { SpriteRenderer: { m_GameObject: { fileID: 1 }, m_Sprite: { fileID: 21300000, guid: 'invalid_guid_9999' } } },
      },
    ]

    const report = {
      addItem: (kind: string, source: string, status: string, reason?: string) => {
        expect(status).toBe('unsupported')
        expect(reason).toContain('Broken GUID reference')
      },
    } as any

    const scene = importer.convertDocsToLifScene(docs, 'Assets/Broken.prefab', report)
    expect(scene.root.name).toBe('SpriteObj')
  })

  // TC-TR-08: Billion laughs / YAML anchor safety
  it('TC-TR-08: halts on excessive YAML anchor expansions preventing billion-laughs attack', () => {
    // Generate anchor nesting
    let malicious = `%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n`
    for (let i = 0; i < 200; i++) {
      malicious += `--- !u!1 &${i}\nGameObject:\n  ref: *anchor_${i}\n`
    }

    const parser = new UnityYamlParser()
    expect(() => parser.parse(malicious)).toThrow('Excessive YAML anchor alias expansions detected')
  })

  // TC-TR-09: Read-only source directory
  it('TC-TR-09: converts from read-only directory without modifying source files', async () => {
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'src-readonly-'))
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-target-'))

    fs.writeFileSync(path.join(srcDir, 'project.godot'), 'config_version=5\n[application]\nconfig/name="ReadOnlyGodot"', 'utf-8')
    fs.writeFileSync(path.join(srcDir, 'main.tscn'), '[gd_scene format=3]\n[node name="Root" type="Node3D"]\n', 'utf-8')

    // Make directory read-only
    try {
      fs.chmodSync(srcDir, 0o555)
    } catch {}

    const pipeline = new Pipeline()
    const report = await pipeline.run(srcDir, 'godot', 'linden', outDir)

    expect(report.source.engine).toBe('godot')
    expect(fs.existsSync(path.join(outDir, 'linden.project.json'))).toBe(true)

    // Restore write permissions to clean up
    try {
      fs.chmodSync(srcDir, 0o777)
    } catch {}
    fs.rmSync(srcDir, { recursive: true, force: true })
    fs.rmSync(outDir, { recursive: true, force: true })
  })
})
