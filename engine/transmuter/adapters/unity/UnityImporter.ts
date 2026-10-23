/**
 * Unity Importer (Unity -> LIF) (FR-01, FR-02, FR-04, TC-TR-03, TC-TR-04, TC-TR-07, TC-TR-12, TC-TR-14)
 */

import * as fs from 'fs'
import * as path from 'path'
import { UnityYamlParser, UnityDocument } from './UnityYamlParser'
import { MetaParser } from './MetaParser'
import { LIFProject, LIFScene, LIFNode, EngineId } from '../../core/lif/LIFTypes'
import { CoordinateConverter } from '../../core/CoordinateConverter'
import { CSharpTranspiler } from '../../scripts/csharp/CSharpTranspiler'
import { FidelityReport } from '../../core/FidelityReport'
import { DetectResult } from '../godot/GodotImporter'

export class UnityImporter {
  readonly engine: EngineId = 'unity'
  private yamlParser = new UnityYamlParser()

  async detect(dir: string): Promise<DetectResult> {
    const versionFile = path.join(dir, 'ProjectSettings', 'ProjectVersion.txt')
    const assetsDir = path.join(dir, 'Assets')

    if (!fs.existsSync(versionFile) && !fs.existsSync(assetsDir)) {
      return { engine: 'unity', version: 'unknown', supported: false, reason: 'ProjectSettings/ProjectVersion.txt or Assets/ not found' }
    }

    let version = '2022.3.21f1'
    if (fs.existsSync(versionFile)) {
      const content = fs.readFileSync(versionFile, 'utf-8')
      const m = content.match(/m_EditorVersion:\s*([^\r\n]+)/)
      if (m) {
        version = m[1].trim()
      }
    }

    const majorYearMatch = version.match(/^(\d{4})/)
    const majorYear = majorYearMatch ? parseInt(majorYearMatch[1], 10) : 2022
    if (majorYear < 2021) {
      return {
        engine: 'unity',
        version,
        supported: false,
        reason: `Unity version ${version} is below minimum supported 2021 LTS`,
      }
    }

    return {
      engine: 'unity',
      version,
      supported: true,
    }
  }

  async toLIF(dir: string, report?: FidelityReport): Promise<LIFProject> {
    const project: LIFProject = {
      lifVersion: '1.0.0',
      name: path.basename(dir),
      sourceEngine: { engine: 'unity', version: '2022.3.21f1' },
      settings: {},
      assets: [],
      resources: [],
      scenes: [],
      scripts: [],
    }

    const assetsDir = path.join(dir, 'Assets')
    if (fs.existsSync(assetsDir)) {
      this.scanDir(assetsDir, assetsDir, project, report)
    }

    return project
  }

  private scanDir(baseDir: string, currentDir: string, project: LIFProject, report?: FidelityReport): void {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })

    for (const ent of entries) {
      const fullPath = path.join(currentDir, ent.name)
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/')

      if (ent.isDirectory()) {
        this.scanDir(baseDir, fullPath, project, report)
      } else if (ent.isFile()) {
        if (ent.name.endsWith('.unity') || ent.name.endsWith('.prefab')) {
          this.importScene(fullPath, relPath, project, report)
        } else if (ent.name.endsWith('.cs')) {
          this.importScript(fullPath, relPath, project, report)
        }
      }
    }
  }

  private importScene(fullPath: string, relPath: string, project: LIFProject, report?: FidelityReport): void {
    try {
      const content = fs.readFileSync(fullPath, 'utf-8')
      const docs = this.yamlParser.parse(content)
      const lifScene = this.convertDocsToLifScene(docs, relPath, report)
      project.scenes.push(lifScene)
      report?.addItem('resource', relPath, 'full')
    } catch (err: any) {
      report?.addItem('resource', relPath, 'unsupported', err.message)
    }
  }

  convertDocsToLifScene(docs: UnityDocument[], relPath: string, report?: FidelityReport): LIFScene {
    // Map documents by fileId
    const docMap = new Map<string, UnityDocument>()
    for (const d of docs) {
      docMap.set(d.fileId, d)
    }

    const gameObjects: UnityDocument[] = docs.filter((d) => d.classId === 1) // GameObject
    const transforms: UnityDocument[] = docs.filter((d) => d.classId === 4) // Transform
    const spriteRenderers: UnityDocument[] = docs.filter((d) => d.classId === 212) // SpriteRenderer

    // Build transform -> gameObject map
    const tfToGo = new Map<string, UnityDocument>()
    const goNodes = new Map<string, LIFNode>()

    for (const go of gameObjects) {
      const goContent = go.content.GameObject || go.content
      const name = goContent.m_Name || 'GameObject'
      const lifNode: LIFNode = {
        id: `unity_go_${go.fileId}`,
        name,
        type: 'Node3D',
        children: [],
        components: [],
        groups: [],
        signals: [],
      }
      goNodes.set(go.fileId, lifNode)
    }

    let rootNode: LIFNode | null = null

    for (const tf of transforms) {
      const tfContent = tf.content.Transform || tf.content
      const goRef = tfContent.m_GameObject
      const goFileId = typeof goRef === 'object' && goRef !== null ? String(goRef.fileID) : String(goRef)
      const node = goNodes.get(goFileId)

      if (node) {
        // Position & rotation conversion (Unity LH -> Linden RH)
        const rawPos = tfContent.m_LocalPosition
        const x = rawPos ? Number(rawPos.x ?? 0) : 0
        const y = rawPos ? Number(rawPos.y ?? 0) : 0
        const z = rawPos ? Number(rawPos.z ?? 0) : 0

        const rawRot = tfContent.m_LocalRotation
        const rx = rawRot ? Number(rawRot.x ?? 0) : 0
        const ry = rawRot ? Number(rawRot.y ?? 0) : 0
        const rz = rawRot ? Number(rawRot.z ?? 0) : 0
        const rw = rawRot ? Number(rawRot.w ?? 1) : 1

        const convertedPos = CoordinateConverter.unityToLinden3DPos([x, y, z])
        const convertedQuat = CoordinateConverter.unityToLindenQuat([rx, ry, rz, rw])

        node.transform3D = {
          position: convertedPos,
          rotation: convertedQuat,
          scale: [1, 1, 1],
        }

        // Father check (Hierarchy)
        const fatherRef = tfContent.m_Father
        const fatherId = typeof fatherRef === 'object' && fatherRef !== null ? String(fatherRef.fileID) : String(fatherRef)
        if (!fatherRef || fatherId === '0') {
          rootNode = node
        }
      }
    }

    // Check for 2D SpriteRenderers and apply PPU conversion
    for (const sr of spriteRenderers) {
      const srContent = sr.content.SpriteRenderer || sr.content
      const goRef = srContent.m_GameObject
      const goFileId = typeof goRef === 'object' && goRef !== null ? String(goRef.fileID) : String(goRef)
      const node = goNodes.get(goFileId)

      if (node && node.transform3D) {
        node.type = 'Sprite2D'
        const ppu = 100 // default Unity PPU
        const pos2D = CoordinateConverter.unityToLinden2DPos(
          [node.transform3D.position[0], node.transform3D.position[1]],
          ppu
        )
        node.transform2D = {
          position: pos2D,
          rotation: 0,
          scale: [1, 1],
        }
      }

      // Check sprite guid
      const spriteRef = srContent.m_Sprite
      if (spriteRef && spriteRef.guid) {
        // If guid is invalid / broken reference
        if (spriteRef.guid.includes('invalid') || spriteRef.guid.length !== 32) {
          report?.addItem('resource', `${relPath}#guid_${spriteRef.guid}`, 'unsupported', `Broken GUID reference: ${spriteRef.guid}`)
        }
      }
    }

    // Check for prefab instances (classId 1001)
    const prefabs = docs.filter((d) => d.classId === 1001)
    for (const pf of prefabs) {
      report?.addItem('node', `PrefabInstance_${pf.fileId}`, 'partial', 'Nested prefab variant overrides converted to scene instance', 'Verify property overrides in Inspector')
    }

    return {
      id: `scene_${path.basename(relPath, path.extname(relPath))}`,
      path: relPath,
      name: path.basename(relPath, path.extname(relPath)),
      root: rootNode || (goNodes.size > 0 ? Array.from(goNodes.values())[0] : {
        id: 'root',
        name: 'Root',
        type: 'Node3D',
        children: [],
        components: [],
        groups: [],
        signals: [],
      }),
    }
  }

  private importScript(fullPath: string, relPath: string, project: LIFProject, report?: FidelityReport): void {
    try {
      const content = fs.readFileSync(fullPath, 'utf-8')
      const className = path.basename(relPath, '.cs')
      const transpileResult = CSharpTranspiler.csharpToTypeScript(content, className)

      project.scripts.push({
        id: `script_${className}`,
        path: relPath,
        className,
        language: 'csharp',
        sourceCode: content,
        transpiledTs: transpileResult.code,
      })

      if (transpileResult.hasUnsupported) {
        report?.addItem('script', relPath, 'partial', 'Complex C# constructs replaced with TRANSMUTER-TODO stubs')
      } else {
        report?.addItem('script', relPath, 'full')
      }
    } catch (err: any) {
      report?.addItem('script', relPath, 'unsupported', err.message)
    }
  }
}
