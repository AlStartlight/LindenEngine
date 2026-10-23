/**
 * Godot 4.x Exporter (LIF -> Godot)
 */

import * as fs from 'fs'
import * as path from 'path'
import { LIFProject, LIFScene, LIFNode } from '../../core/lif/LIFTypes'
import { GDScriptTranspiler } from '../../scripts/gdscript/GDScriptTranspiler'
import { IdMap } from '../../core/IdMap'
import { formatVariant } from '../../../godot/tscn/Variant'

export class GodotExporter {
  readonly engine = 'godot'

  async fromLIF(project: LIFProject, outDir: string, idMap: IdMap = new IdMap()): Promise<void> {
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true })
    }

    // 1. Write project.godot
    this.writeProjectGodot(project, outDir)

    // 2. Write scenes (.tscn)
    for (const sc of project.scenes) {
      const scenePath = path.join(outDir, sc.path.endsWith('.tscn') ? sc.path : `${sc.path}.tscn`)
      fs.mkdirSync(path.dirname(scenePath), { recursive: true })
      const tscnContent = this.exportScene(sc, idMap)
      fs.writeFileSync(scenePath, tscnContent, 'utf-8')
    }

    // 3. Write scripts (.gd)
    for (const script of project.scripts) {
      const scriptPath = path.join(outDir, script.path.endsWith('.gd') ? script.path : `${script.path}.gd`)
      fs.mkdirSync(path.dirname(scriptPath), { recursive: true })
      let gdContent = script.language === 'gdscript' ? script.sourceCode : ''
      if (!gdContent && script.transpiledTs) {
        gdContent = GDScriptTranspiler.typeScriptToGDScript(script.transpiledTs)
      } else if (!gdContent) {
        gdContent = GDScriptTranspiler.typeScriptToGDScript(script.sourceCode)
      }
      fs.writeFileSync(scriptPath, gdContent, 'utf-8')
    }
  }

  private writeProjectGodot(project: LIFProject, outDir: string): void {
    const lines = [
      '; Engine configuration file.',
      '; It\'s best edited using the editor UI and not directly,',
      '; since the parameters that go here are not all obvious.',
      '',
      'config_version=5',
      '',
      '[application]',
      `config/name="${project.name || 'LindenProject'}"`,
    ]

    if (project.settings.mainScene) {
      lines.push(`run/main_scene="res://${project.settings.mainScene.replace(/^\/+/, '')}"`)
    }

    lines.push('')
    fs.writeFileSync(path.join(outDir, 'project.godot'), lines.join('\n'), 'utf-8')
  }

  exportScene(scene: LIFScene, idMap: IdMap): string {
    const lines: string[] = ['[gd_scene format=3]', '']
    const connections: string[] = []

    this.writeNode(scene.root, undefined, lines, connections, idMap)

    lines.push('')
    lines.push(...connections)
    return lines.join('\n')
  }

  private writeNode(
    node: LIFNode,
    parentPath: string | undefined,
    lines: string[],
    connections: string[],
    idMap: IdMap
  ): void {
    let header = `[node name="${node.name}" type="${node.type}"`
    if (parentPath !== undefined) {
      header += ` parent="${parentPath}"`
    }
    if (node.groups && node.groups.length > 0) {
      header += ` groups=[${node.groups.map((g) => `"${g}"`).join(', ')}]`
    }
    header += ']'
    lines.push(header)

    // UID metadata
    const godotUid = idMap.getOrCreateGodotUid(node.id)
    lines.push(`metadata/linden_uid = "${godotUid}"`)

    if (node.transform2D) {
      lines.push(`position = Vector2(${node.transform2D.position[0]}, ${node.transform2D.position[1]})`)
      if (node.transform2D.rotation !== 0) {
        lines.push(`rotation = ${node.transform2D.rotation}`)
      }
      if (node.transform2D.scale[0] !== 1 || node.transform2D.scale[1] !== 1) {
        lines.push(`scale = Vector2(${node.transform2D.scale[0]}, ${node.transform2D.scale[1]})`)
      }
    } else if (node.transform3D) {
      lines.push(`position = Vector3(${node.transform3D.position[0]}, ${node.transform3D.position[1]}, ${node.transform3D.position[2]})`)
      if (node.transform3D.scale[0] !== 1 || node.transform3D.scale[1] !== 1 || node.transform3D.scale[2] !== 1) {
        lines.push(`scale = Vector3(${node.transform3D.scale[0]}, ${node.transform3D.scale[1]}, ${node.transform3D.scale[2]})`)
      }
    }

    if (node.extras) {
      for (const [k, v] of Object.entries(node.extras)) {
        lines.push(`${k} = ${formatVariant(v)}`)
      }
    }
    lines.push('')

    // Connections
    for (const sig of node.signals || []) {
      connections.push(
        `[connection signal="${sig.name}" from="${node.name}" to="${sig.targetNodeId}" method="${sig.method}"]`
      )
    }

    const myPath = parentPath === undefined ? '.' : (parentPath === '.' ? node.name : `${parentPath}/${node.name}`)
    for (const child of node.children || []) {
      this.writeNode(child, myPath, lines, connections, idMap)
    }
  }
}
