/**
 * Godot 4.x Importer (Godot -> LIF)
 */

import * as fs from 'fs'
import * as path from 'path'
import { TscnParser, TscnDocument, TscnNode } from '../../../godot/tscn/TscnParser'
import { LIFProject, LIFScene, LIFNode, EngineId } from '../../core/lif/LIFTypes'
import { GDScriptTranspiler } from '../../scripts/gdscript/GDScriptTranspiler'
import { FidelityReport } from '../../core/FidelityReport'

export interface DetectResult {
  engine: EngineId
  version: string
  supported: boolean
  reason?: string
}

export class GodotImporter {
  readonly engine: EngineId = 'godot'
  private parser = new TscnParser()

  async detect(dir: string): Promise<DetectResult> {
    const projectPath = path.join(dir, 'project.godot')
    if (!fs.existsSync(projectPath)) {
      return { engine: 'godot', version: 'unknown', supported: false, reason: 'project.godot not found' }
    }

    try {
      const content = fs.readFileSync(projectPath, 'utf-8')
      const configVersionMatch = content.match(/config_version\s*=\s*(\d+)/)
      const configVersion = configVersionMatch ? parseInt(configVersionMatch[1], 10) : 5

      if (configVersion <= 4) {
        return {
          engine: 'godot',
          version: '3.x',
          supported: false,
          reason: 'Godot 3.x is not supported. Please upgrade project to Godot 4.',
        }
      }

      return {
        engine: 'godot',
        version: '4.3',
        supported: true,
      }
    } catch (err: any) {
      return { engine: 'godot', version: 'unknown', supported: false, reason: err.message }
    }
  }

  async toLIF(dir: string, report?: FidelityReport): Promise<LIFProject> {
    const project: LIFProject = {
      lifVersion: '1.0.0',
      name: path.basename(dir),
      sourceEngine: { engine: 'godot', version: '4.3' },
      settings: {},
      assets: [],
      resources: [],
      scenes: [],
      scripts: [],
    }

    this.scanDir(dir, dir, project, report)
    return project
  }

  private scanDir(baseDir: string, currentDir: string, project: LIFProject, report?: FidelityReport): void {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })

    for (const ent of entries) {
      const fullPath = path.join(currentDir, ent.name)
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/')

      if (ent.isDirectory()) {
        if (ent.name !== '.godot' && ent.name !== '.git') {
          this.scanDir(baseDir, fullPath, project, report)
        }
      } else if (ent.isFile()) {
        if (ent.name.endsWith('.tscn')) {
          this.importScene(fullPath, relPath, project, report)
        } else if (ent.name.endsWith('.gd')) {
          this.importScript(fullPath, relPath, project, report)
        } else if (ent.name.endsWith('.gdshader')) {
          report?.addItem('shader', `res://${relPath}`, 'partial', 'Custom Godot shader converted to fallback PBR', 'Use StandardMaterial3D or rebuild in Linden Material Editor')
        }
      }
    }
  }

  private importScene(fullPath: string, relPath: string, project: LIFProject, report?: FidelityReport): void {
    try {
      const content = fs.readFileSync(fullPath, 'utf-8')
      const doc = this.parser.parse(content)
      const lifScene = this.convertTscnToLifScene(doc, relPath, report)
      project.scenes.push(lifScene)
      report?.addItem('resource', `res://${relPath}`, 'full')
    } catch (err: any) {
      report?.addItem('resource', `res://${relPath}`, 'unsupported', err.message)
    }
  }

  convertTscnToLifScene(doc: TscnDocument, relPath: string, report?: FidelityReport): LIFScene {
    const nodeMap = new Map<string, LIFNode>()
    let rootNode: LIFNode | null = null

    for (let i = 0; i < doc.nodes.length; i++) {
      const tNode = doc.nodes[i]
      const lifNode = this.convertNode(tNode, report)

      if (i === 0 || !tNode.parent) {
        rootNode = lifNode
        nodeMap.set('.', lifNode)
        nodeMap.set(lifNode.name, lifNode)
      } else {
        const parentPath = tNode.parent
        const parent = nodeMap.get(parentPath) || rootNode
        if (parent) {
          parent.children.push(lifNode)
          lifNode.parent = parent.id
        }
        const fullKey = parentPath === '.' ? lifNode.name : `${parentPath}/${lifNode.name}`
        nodeMap.set(fullKey, lifNode)
        nodeMap.set(lifNode.name, lifNode)
      }
    }

    // Attach connections
    for (const conn of doc.connections) {
      const fromNode = nodeMap.get(conn.from)
      const toNode = nodeMap.get(conn.to)
      if (fromNode) {
        fromNode.signals.push({
          name: conn.signal,
          targetNodeId: toNode ? toNode.id : conn.to,
          method: conn.method,
          flags: conn.flags,
        })
      }
    }

    return {
      id: `scene_${path.basename(relPath, '.tscn')}`,
      path: relPath,
      name: path.basename(relPath, '.tscn'),
      root: rootNode || {
        id: 'root',
        name: 'Root',
        type: 'Node',
        children: [],
        components: [],
        groups: [],
        signals: [],
      },
    }
  }

  private convertNode(tNode: TscnNode, report?: FidelityReport): LIFNode {
    const type = tNode.type || 'Node'
    const id = `node_${tNode.name}_${Math.random().toString(36).substring(2, 7)}`

    const lifNode: LIFNode = {
      id,
      name: tNode.name,
      type,
      children: [],
      components: [],
      groups: tNode.groups || [],
      signals: [],
      extras: {},
    }

    // 2D transforms
    if (type.includes('2D') || type === 'Sprite2D' || type === 'Camera2D' || type === 'CharacterBody2D') {
      const pos = tNode.properties['position']
      const rot = tNode.properties['rotation'] || 0
      const scl = tNode.properties['scale']
      lifNode.transform2D = {
        position: pos ? [pos.x ?? 0, pos.y ?? 0] : [0, 0],
        rotation: typeof rot === 'number' ? rot : 0,
        scale: scl ? [scl.x ?? 1, scl.y ?? 1] : [1, 1],
      }
    }

    // 3D transforms
    if (type.includes('3D') || type === 'MeshInstance3D' || type === 'DirectionalLight3D' || type === 'Camera3D') {
      const pos = tNode.properties['position']
      const rot = tNode.properties['rotation']
      const scl = tNode.properties['scale']
      lifNode.transform3D = {
        position: pos ? [pos.x ?? 0, pos.y ?? 0, pos.z ?? 0] : [0, 0, 0],
        rotation: [0, 0, 0, 1], // identity quaternion fallback
        scale: scl ? [scl.x ?? 1, scl.y ?? 1, scl.z ?? 1] : [1, 1, 1],
      }
    }

    // Record properties to extras or components
    for (const [k, v] of Object.entries(tNode.properties)) {
      if (k !== 'position' && k !== 'rotation' && k !== 'scale') {
        lifNode.extras![k] = v
      }
    }

    report?.addItem('node', tNode.name, 'full')
    return lifNode
  }

  private importScript(fullPath: string, relPath: string, project: LIFProject, report?: FidelityReport): void {
    try {
      const content = fs.readFileSync(fullPath, 'utf-8')
      const className = path.basename(relPath, '.gd')
      const transpileResult = GDScriptTranspiler.gdscriptToTypeScript(content, className)

      project.scripts.push({
        id: `script_${className}`,
        path: relPath,
        className,
        language: 'gdscript',
        sourceCode: content,
        transpiledTs: transpileResult.code,
      })

      if (transpileResult.hasUnsupported) {
        report?.addItem('script', `res://${relPath}`, 'partial', 'Some GDScript features replaced with TRANSMUTER-TODO stubs', 'Review stubs in generated TypeScript')
      } else {
        report?.addItem('script', `res://${relPath}`, 'full')
      }
    } catch (err: any) {
      report?.addItem('script', `res://${relPath}`, 'unsupported', err.message)
    }
  }
}
