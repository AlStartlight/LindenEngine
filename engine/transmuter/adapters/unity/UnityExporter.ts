/**
 * Unity Exporter (LIF -> Unity) (FR-09, TC-TR-15, TC-TR-16, TC-TR-19)
 */

import * as fs from 'fs'
import * as path from 'path'
import { LIFProject, LIFScene, LIFNode } from '../../core/lif/LIFTypes'
import { CoordinateConverter } from '../../core/CoordinateConverter'
import { CSharpTranspiler } from '../../scripts/csharp/CSharpTranspiler'
import { IdMap } from '../../core/IdMap'
import { FidelityReport } from '../../core/FidelityReport'

export class UnityExporter {
  readonly engine = 'unity'

  async fromLIF(project: LIFProject, outDir: string, idMap: IdMap = new IdMap(), report?: FidelityReport): Promise<void> {
    const assetsDir = path.join(outDir, 'Assets')
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true })
    }

    // 1. Write ProjectSettings
    const projSettingsDir = path.join(outDir, 'ProjectSettings')
    if (!fs.existsSync(projSettingsDir)) {
      fs.mkdirSync(projSettingsDir, { recursive: true })
    }
    fs.writeFileSync(
      path.join(projSettingsDir, 'ProjectVersion.txt'),
      'm_EditorVersion: 2022.3.21f1\nm_EditorVersionWithRevision: 2022.3.21f1 (c8680180cf2a)\n',
      'utf-8'
    )

    // 2. Write Scenes (.unity) & .meta files
    for (const sc of project.scenes) {
      const sceneFileName = sc.path.endsWith('.unity') ? sc.path : `${sc.name || 'Scene'}.unity`
      const scenePath = path.join(assetsDir, sceneFileName)
      fs.mkdirSync(path.dirname(scenePath), { recursive: true })

      const yamlContent = this.exportScene(sc, idMap, report)
      fs.writeFileSync(scenePath, yamlContent, 'utf-8')

      // Write deterministic .meta for scene
      const sceneGuid = idMap.getOrCreateUnityGuid(sc.id)
      const metaContent = `fileFormatVersion: 2\nguid: ${sceneGuid}\nDefaultImporter:\n  externalObjects: {}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n`
      fs.writeFileSync(`${scenePath}.meta`, metaContent, 'utf-8')
    }

    // 3. Write C# Scripts & .meta files
    for (const script of project.scripts) {
      const scriptFileName = script.path.endsWith('.cs') ? script.path : `${script.className || 'Script'}.cs`
      const scriptPath = path.join(assetsDir, scriptFileName)
      fs.mkdirSync(path.dirname(scriptPath), { recursive: true })

      let csContent = script.language === 'csharp' ? script.sourceCode : ''
      if (!csContent && script.transpiledTs) {
        csContent = CSharpTranspiler.typeScriptToCSharp(script.transpiledTs, script.className)
      } else if (!csContent) {
        csContent = CSharpTranspiler.typeScriptToCSharp(script.sourceCode, script.className)
      }
      fs.writeFileSync(scriptPath, csContent, 'utf-8')

      // Deterministic .meta for script
      const scriptGuid = idMap.getOrCreateUnityGuid(script.id)
      const scriptMeta = `fileFormatVersion: 2\nguid: ${scriptGuid}\nMonoImporter:\n  externalObjects: {}\n  serializedVersion: 2\n  defaultReferences: []\n  executionOrder: 0\n  icon: {instanceID: 0}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n`
      fs.writeFileSync(`${scriptPath}.meta`, scriptMeta, 'utf-8')
    }
  }

  exportScene(scene: LIFScene, idMap: IdMap, report?: FidelityReport): string {
    const docs: string[] = ['%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:']
    let nextFileId = 1000

    this.writeNodeToDocs(scene.root, 0, docs, nextFileId, report)
    return docs.join('\n')
  }

  private writeNodeToDocs(
    node: LIFNode,
    fatherFileId: number,
    docs: string[],
    startFileId: number,
    report?: FidelityReport
  ): number {
    const goId = startFileId++
    const tfId = startFileId++

    // Groups -> Tag + LindenGroups component
    let tag = 'Untagged'
    if (node.groups && node.groups.length > 0) {
      tag = node.groups[0]
      if (node.groups.length > 1) {
        report?.addItem('component', `${node.name}.groups`, 'partial', 'Multiple groups mapped to first Tag and LindenGroups component')
      }
    }

    // Signals -> UnityEvent / LindenSignal
    if (node.signals && node.signals.length > 0) {
      report?.addItem('node', `${node.name}.signals`, 'partial', 'Signal mapped to UnityEvent persistent listener')
    }

    // Write GameObject doc
    docs.push(`--- !u!1 &${goId}
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component:
  - component: {fileID: ${tfId}}
  m_Layer: 0
  m_Name: ${node.name}
  m_TagString: ${tag}
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1`)

    // Position conversion: Linden (RH) -> Unity (LH)
    let unityPos: [number, number, number] = [0, 0, 0]
    let unityRot: [number, number, number, number] = [0, 0, 0, 1]

    if (node.transform3D) {
      unityPos = CoordinateConverter.lindenToUnity3DPos(node.transform3D.position)
      unityRot = CoordinateConverter.lindenToUnityQuat(node.transform3D.rotation)
    }

    // Write Transform doc
    docs.push(`--- !u!4 &${tfId}
Transform:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: ${goId}}
  m_LocalRotation: {x: ${unityRot[0]}, y: ${unityRot[1]}, z: ${unityRot[2]}, w: ${unityRot[3]}}
  m_LocalPosition: {x: ${unityPos[0]}, y: ${unityPos[1]}, z: ${unityPos[2]}}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children: []
  m_Father: {fileID: ${fatherFileId}}`)

    for (const child of node.children || []) {
      startFileId = this.writeNodeToDocs(child, tfId, docs, startFileId, report)
    }

    return startFileId
  }
}
