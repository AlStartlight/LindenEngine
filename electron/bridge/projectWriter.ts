import fs from 'node:fs'
import path from 'node:path'
import { GDScriptTranspiler } from '../../engine/transmuter/scripts/gdscript/GDScriptTranspiler'
import type {
  GodotProjectInfo,
  GodotSceneIR,
  ImportProjectOptions,
  ImportProgressEvent,
  ImportSummary,
} from '../../shared/godotBridgeTypes'
import { mapGodotSceneIR, MappedSceneResult } from './godotMapper'

const ASSET_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.svg', '.webp',
  '.wav', '.ogg', '.mp3',
  '.ttf', '.otf',
  '.glb', '.gltf', '.obj'
])

export async function writeLindenProject(
  projectInfo: GodotProjectInfo,
  scenes: GodotSceneIR[],
  options: ImportProjectOptions,
  onProgress?: (event: ImportProgressEvent) => void,
  onLog?: (line: string) => void
): Promise<{ summary: ImportSummary; projectPath: string; reportPath: string }> {
  const destDir = options.dest
  const projectName = options.name || projectInfo.name
  const finalProjectPath = path.join(destDir, projectName)
  const tempProjectPath = path.join(destDir, `${projectName}.importing`)

  // Clean existing temp folder if present
  if (fs.existsSync(tempProjectPath)) {
    fs.rmSync(tempProjectPath, { recursive: true, force: true })
  }
  fs.mkdirSync(tempProjectPath, { recursive: true })

  try {
    // 1. Map and write scenes
    onProgress?.({
      jobId: options.jobId,
      stage: 'mapping',
      done: 4,
      total: 5,
      message: `Memetakan dan menulis ${scenes.length} scene...`,
    })

    const scenesInBuild: string[] = []
    let totalNodes = 0
    let nativeNodes = 0
    let passthroughNodes = 0
    let skippedNodes = 0
    let errorNodes = 0
    const nodeTypeCounts: Record<string, { total: number; native: number; passthrough: number }> = {}

    const scenesBaseDir = path.join(tempProjectPath, 'scenes')
    fs.mkdirSync(scenesBaseDir, { recursive: true })

    // Find main scene relative path
    let mainSceneRel: string | null = null
    if (projectInfo.mainScene) {
      mainSceneRel = projectInfo.mainScene.replace(/^res:\/\//, '').replace(/\.tscn$/, '.lscene')
    }

    for (const sceneIR of scenes) {
      const relPath = sceneIR.path.replace(/^res:\/\//, '')
      const relLScene = relPath.replace(/\.tscn$/, '.lscene')
      const targetFilePath = path.join(scenesBaseDir, relLScene)
      const targetDir = path.dirname(targetFilePath)

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true })
      }

      const mapped: MappedSceneResult = mapGodotSceneIR(sceneIR)

      totalNodes += mapped.sceneData.entities.length
      nativeNodes += mapped.stats.native
      passthroughNodes += mapped.stats.passthrough
      skippedNodes += mapped.stats.skipped
      errorNodes += mapped.stats.error

      for (const [t, cnt] of Object.entries(mapped.stats.typeCounts)) {
        if (!nodeTypeCounts[t]) {
          nodeTypeCounts[t] = { total: 0, native: 0, passthrough: 0 }
        }
        nodeTypeCounts[t].total += cnt.total
        nodeTypeCounts[t].native += cnt.native
        nodeTypeCounts[t].passthrough += cnt.passthrough
      }

      fs.writeFileSync(targetFilePath, JSON.stringify(mapped.sceneData, null, 2), 'utf-8')

      const sceneRelFromRoot = path.join('scenes', relLScene).replace(/\\/g, '/')
      if (mainSceneRel && relLScene === mainSceneRel) {
        scenesInBuild.unshift(sceneRelFromRoot)
      } else {
        scenesInBuild.push(sceneRelFromRoot)
      }
    }

    // 2. Copy Assets, Scripts, and Godot files
    onProgress?.({
      jobId: options.jobId,
      stage: 'write',
      done: 5,
      total: 5,
      message: 'Menyalin aset, script, dan metadata project...',
    })

    const assetsBaseDir = path.join(tempProjectPath, 'assets')
    const scriptsBaseDir = path.join(tempProjectPath, 'scripts')
    const godotBaseDir = path.join(tempProjectPath, 'godot')

    fs.mkdirSync(assetsBaseDir, { recursive: true })
    fs.mkdirSync(scriptsBaseDir, { recursive: true })
    fs.mkdirSync(godotBaseDir, { recursive: true })

    let assetsCopied = 0
    let scriptsCopied = 0

    function copyRecursive(srcFolder: string, relFolder: string = '') {
      const entries = fs.readdirSync(srcFolder, { withFileTypes: true })
      for (const ent of entries) {
        if (ent.name === '.git' || ent.name === '.godot' || ent.name === '.linden') continue
        const fullSrc = path.join(srcFolder, ent.name)
        const currentRel = relFolder ? path.join(relFolder, ent.name) : ent.name

        if (ent.isDirectory()) {
          copyRecursive(fullSrc, currentRel)
        } else if (ent.isFile()) {
          const ext = path.extname(ent.name).toLowerCase()
          if (ASSET_EXTENSIONS.has(ext)) {
            const dest = path.join(assetsBaseDir, currentRel)
            fs.mkdirSync(path.dirname(dest), { recursive: true })
            fs.copyFileSync(fullSrc, dest)
            assetsCopied++
          } else if (ext === '.gd') {
            const destGd = path.join(scriptsBaseDir, currentRel)
            fs.mkdirSync(path.dirname(destGd), { recursive: true })
            fs.copyFileSync(fullSrc, destGd)
            scriptsCopied++

            if (options.transpileScripts) {
              try {
                const gdCode = fs.readFileSync(fullSrc, 'utf-8')
                const res = GDScriptTranspiler.gdscriptToTypeScript(gdCode, path.basename(ent.name, '.gd'))
                const destTs = destGd.replace(/\.gd$/, '.ts')
                fs.writeFileSync(destTs, res.code, 'utf-8')
              } catch {
                const destTs = destGd.replace(/\.gd$/, '.ts')
                fs.writeFileSync(
                  destTs,
                  `// TRANSMUTER-TODO: Gagal transpile otomatis dari ${ent.name}\nexport class ${path.basename(
                    ent.name,
                    '.gd'
                  )} {}\n`,
                  'utf-8'
                )
              }
            }
          } else if (ext === '.tres' || ext === '.import' || ent.name === 'project.godot') {
            const destGodot = path.join(godotBaseDir, currentRel)
            fs.mkdirSync(path.dirname(destGodot), { recursive: true })
            fs.copyFileSync(fullSrc, destGodot)
          }
        }
      }
    }

    copyRecursive(options.dir)

    // 3. Write project.linden.json
    const projectManifest = {
      name: projectName,
      version: '1.0.0',
      scenesInBuild,
      input: {
        actions: projectInfo.inputActions || [],
      },
      display: {
        width: projectInfo.viewport.width || 1280,
        height: projectInfo.viewport.height || 720,
      },
      bridge: {
        source: {
          engine: 'godot',
          version: projectInfo.godotVersion,
          path: options.dir,
        },
      },
    }

    fs.writeFileSync(
      path.join(tempProjectPath, 'project.linden.json'),
      JSON.stringify(projectManifest, null, 2),
      'utf-8'
    )

    // 4. Calculate summary & write reports
    const nativeScore = totalNodes > 0 ? Math.round((nativeNodes / totalNodes) * 100) : 100
    const preservedScore =
      totalNodes > 0 ? Math.round(((nativeNodes + passthroughNodes) / totalNodes) * 100) : 100

    const summary: ImportSummary = {
      projectName,
      godotVersion: projectInfo.godotVersion,
      sourcePath: options.dir,
      destPath: finalProjectPath,
      totalScenes: scenes.length,
      okScenes: scenes.length,
      failedScenes: [],
      totalNodes,
      nativeNodes,
      passthroughNodes,
      skippedNodes,
      errorNodes,
      nativeScore,
      preservedScore,
      nodeTypeCounts,
      assetsCopied,
      scriptsCopied,
    }

    fs.writeFileSync(
      path.join(tempProjectPath, 'import-report.json'),
      JSON.stringify(summary, null, 2),
      'utf-8'
    )

    const reportHtml = generateHtmlReport(summary)
    fs.writeFileSync(path.join(tempProjectPath, 'import-report.html'), reportHtml, 'utf-8')

    // 5. Atomic Rename
    if (fs.existsSync(finalProjectPath)) {
      fs.rmSync(finalProjectPath, { recursive: true, force: true })
    }
    fs.renameSync(tempProjectPath, finalProjectPath)

    onProgress?.({
      jobId: options.jobId,
      stage: 'done',
      done: 5,
      total: 5,
      message: `Import selesai! ${scenes.length} scene berhasil diimpor.`,
    })

    return {
      summary,
      projectPath: finalProjectPath,
      reportPath: path.join(finalProjectPath, 'import-report.html'),
    }
  } catch (err: any) {
    if (fs.existsSync(tempProjectPath)) {
      try {
        fs.rmSync(tempProjectPath, { recursive: true, force: true })
      } catch {}
    }
    throw err
  }
}

function generateHtmlReport(s: ImportSummary): string {
  const rows = Object.entries(s.nodeTypeCounts)
    .sort((a, b) => b[1].total - a[1].total)
    .map(
      ([type, cnt]) => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #334155; font-family: monospace;">${type}</td>
        <td style="padding: 8px; border-bottom: 1px solid #334155; text-align: right;">${cnt.total}</td>
        <td style="padding: 8px; border-bottom: 1px solid #334155; text-align: right; color: #34d399;">${cnt.native}</td>
        <td style="padding: 8px; border-bottom: 1px solid #334155; text-align: right; color: #94a3b8;">${cnt.passthrough}</td>
      </tr>`
    )
    .join('')

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Laporan Import Godot — ${s.projectName}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 32px; }
    .container { max-width: 900px; margin: 0 auto; background: #1e293b; border-radius: 12px; padding: 32px; border: 1px solid #334155; }
    h1 { margin-top: 0; color: #ffffff; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 6px; font-weight: bold; font-size: 13px; margin-right: 8px; }
    .badge-native { background: #065f46; color: #6ee7b7; border: 1px solid #047857; }
    .badge-preserved { background: #1e3a8a; color: #93c5fd; border: 1px solid #1d4ed8; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 24px 0; }
    .stat-card { background: #0f172a; padding: 16px; border-radius: 8px; border: 1px solid #334155; }
    .stat-val { font-size: 24px; font-weight: bold; color: #f8fafc; }
    .stat-lbl { font-size: 12px; color: #94a3b8; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
    th { text-align: left; padding: 8px; border-bottom: 2px solid #475569; color: #cbd5e1; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Laporan Import Godot: ${s.projectName}</h1>
    <p style="color: #94a3b8; font-size: 13px;">Sumber: <code>${s.sourcePath}</code> (Godot ${s.godotVersion})</p>

    <div style="margin: 16px 0;">
      <span class="badge badge-native">Native Score: ${s.nativeScore}%</span>
      <span class="badge badge-preserved">Data Preserved: ${s.preservedScore}%</span>
    </div>

    <div class="grid">
      <div class="stat-card"><div class="stat-val">${s.totalScenes}</div><div class="stat-lbl">Scene Terkonversi</div></div>
      <div class="stat-card"><div class="stat-val">${s.totalNodes}</div><div class="stat-lbl">Total Node</div></div>
      <div class="stat-card"><div class="stat-val">${s.assetsCopied}</div><div class="stat-lbl">Aset Tersalin</div></div>
      <div class="stat-card"><div class="stat-val">${s.scriptsCopied}</div><div class="stat-lbl">Script Tersalin</div></div>
    </div>

    <h2 style="font-size: 16px; margin-top: 32px; border-bottom: 1px solid #334155; padding-bottom: 8px;">Distribusi Tipe Node</h2>
    <table>
      <thead>
        <tr>
          <th>Tipe Godot</th>
          <th style="text-align: right;">Jumlah</th>
          <th style="text-align: right;">Native</th>
          <th style="text-align: right;">Passthrough</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>
</body>
</html>`
}
