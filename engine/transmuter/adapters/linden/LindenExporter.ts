/**
 * Linden Exporter (LIF -> Linden)
 */

import * as fs from 'fs'
import * as path from 'path'
import { LIFProject, LIFScene, LIFNode } from '../../core/lif/LIFTypes'
import { PackedScene } from '../../../scene/PackedScene'
import { Node, Node2D, Node3D } from '../../../scene/Node'

export class LindenExporter {
  readonly engine = 'linden'

  async fromLIF(project: LIFProject, outDir: string): Promise<void> {
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true })
    }

    // 1. Write linden.project.json
    const projConfig = {
      name: project.name || 'LindenProject',
      version: '0.3.0',
      settings: project.settings,
    }
    fs.writeFileSync(path.join(outDir, 'linden.project.json'), JSON.stringify(projConfig, null, 2), 'utf-8')

    // 2. Write Scenes (.lscn)
    for (const sc of project.scenes) {
      const sceneFileName = sc.path.endsWith('.lscn') ? sc.path : `${sc.name || 'Scene'}.lscn`
      const scenePath = path.join(outDir, sceneFileName)
      fs.mkdirSync(path.dirname(scenePath), { recursive: true })

      const rootNode = this.lifNodeToNode(sc.root)
      const packed = new PackedScene()
      packed.pack(rootNode)
      fs.writeFileSync(scenePath, packed.serialize(), 'utf-8')
    }
  }

  private lifNodeToNode(lifNode: LIFNode): Node {
    let node: Node
    if (lifNode.transform2D) {
      const n2d = new Node2D(lifNode.name, lifNode.id)
      n2d.position = { x: lifNode.transform2D.position[0], y: lifNode.transform2D.position[1] }
      n2d.rotation = lifNode.transform2D.rotation
      n2d.scale = { x: lifNode.transform2D.scale[0], y: lifNode.transform2D.scale[1] }
      node = n2d
    } else if (lifNode.transform3D) {
      const n3d = new Node3D(lifNode.name, lifNode.id)
      n3d.position = {
        x: lifNode.transform3D.position[0],
        y: lifNode.transform3D.position[1],
        z: lifNode.transform3D.position[2],
      }
      n3d.scale = {
        x: lifNode.transform3D.scale[0],
        y: lifNode.transform3D.scale[1],
        z: lifNode.transform3D.scale[2],
      }
      node = n3d
    } else {
      node = new Node(lifNode.name, lifNode.id)
    }

    if (lifNode.groups) {
      for (const g of lifNode.groups) {
        node.addToGroup(g)
      }
    }

    for (const child of lifNode.children || []) {
      node.addChild(this.lifNodeToNode(child))
    }

    return node
  }
}
