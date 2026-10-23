/**
 * Linden Importer (Linden -> LIF)
 */

import * as fs from 'fs'
import * as path from 'path'
import { LIFProject, LIFScene, LIFNode, EngineId } from '../../core/lif/LIFTypes'
import { PackedScene } from '../../../scene/PackedScene'
import { FidelityReport } from '../../core/FidelityReport'
import { DetectResult } from '../godot/GodotImporter'

export class LindenImporter {
  readonly engine: EngineId = 'linden'

  async detect(dir: string): Promise<DetectResult> {
    const projectJson = path.join(dir, 'linden.project.json')
    const pkgJson = path.join(dir, 'package.json')

    if (fs.existsSync(projectJson)) {
      return { engine: 'linden', version: '0.3.0', supported: true }
    }

    if (fs.existsSync(pkgJson)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf-8'))
        if (pkg.name === 'linden-engine' || pkg.dependencies?.['three']) {
          return { engine: 'linden', version: pkg.version || '0.1.0', supported: true }
        }
      } catch {}
    }

    return { engine: 'linden', version: 'unknown', supported: false, reason: 'linden.project.json not found' }
  }

  async toLIF(dir: string, report?: FidelityReport): Promise<LIFProject> {
    const project: LIFProject = {
      lifVersion: '1.0.0',
      name: path.basename(dir),
      sourceEngine: { engine: 'linden', version: '0.3.0' },
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
        if (ent.name !== 'node_modules' && ent.name !== '.git' && ent.name !== 'dist') {
          this.scanDir(baseDir, fullPath, project, report)
        }
      } else if (ent.isFile()) {
        if (ent.name.endsWith('.lscn')) {
          this.importLscnScene(fullPath, relPath, project, report)
        }
      }
    }
  }

  private importLscnScene(fullPath: string, relPath: string, project: LIFProject, report?: FidelityReport): void {
    try {
      const content = fs.readFileSync(fullPath, 'utf-8')
      const packed = PackedScene.deserialize(content)
      const rootNode = packed.instantiate()

      const lifScene: LIFScene = {
        id: `scene_${path.basename(relPath, '.lscn')}`,
        path: relPath,
        name: path.basename(relPath, '.lscn'),
        root: this.nodeToLifNode(rootNode),
      }

      project.scenes.push(lifScene)
      report?.addItem('resource', relPath, 'full')
    } catch (err: any) {
      report?.addItem('resource', relPath, 'unsupported', err.message)
    }
  }

  private nodeToLifNode(node: any): LIFNode {
    const lifNode: LIFNode = {
      id: node.id || `node_${node.name}`,
      name: node.name,
      type: node.constructor.name,
      children: [],
      components: [],
      groups: node.getGroups ? node.getGroups() : [],
      signals: [],
    }

    if (node.position && typeof node.position.z === 'number') {
      lifNode.transform3D = {
        position: [node.position.x, node.position.y, node.position.z],
        rotation: [0, 0, 0, 1],
        scale: [node.scale?.x ?? 1, node.scale?.y ?? 1, node.scale?.z ?? 1],
      }
    } else if (node.position) {
      lifNode.transform2D = {
        position: [node.position.x, node.position.y],
        rotation: node.rotation ?? 0,
        scale: [node.scale?.x ?? 1, node.scale?.y ?? 1],
      }
    }

    if (typeof node.getChildren === 'function') {
      for (const child of node.getChildren()) {
        lifNode.children.push(this.nodeToLifNode(child))
      }
    }

    return lifNode
  }
}
