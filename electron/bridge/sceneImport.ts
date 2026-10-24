import fs from 'node:fs'
import { dialog } from 'electron'
import { TscnParser, tscnDocumentToSceneIR } from '../../engine/godot/tscn/TscnParser'
import { mapGodotSceneIR } from './godotMapper'

export async function importSingleGodotScene(opts?: { tscnPath?: string }) {
  let chosenPath = opts?.tscnPath

  if (!chosenPath) {
    const res = await dialog.showOpenDialog({
      title: 'Pilih File Scene Godot (.tscn)',
      filters: [{ name: 'Godot Scene', extensions: ['tscn'] }],
      properties: ['openFile'],
    })

    if (res.canceled || !res.filePaths[0]) {
      return { canceled: true }
    }
    chosenPath = res.filePaths[0]
  }

  if (!fs.existsSync(chosenPath)) {
    throw new Error(`File scene tidak ditemukan: ${chosenPath}`)
  }

  const content = fs.readFileSync(chosenPath, 'utf-8')
  const parser = new TscnParser()
  const doc = parser.parse(content)
  const sceneIR = tscnDocumentToSceneIR(doc, chosenPath)
  const mapped = mapGodotSceneIR(sceneIR)

  return {
    canceled: false,
    path: chosenPath,
    sceneData: mapped.sceneData,
    stats: mapped.stats,
    report: {
      convertedCount: mapped.stats.native + mapped.stats.passthrough,
      skippedCount: mapped.stats.skipped,
      warnings: [],
      errors: [],
      issues: [],
    },
  }
}
