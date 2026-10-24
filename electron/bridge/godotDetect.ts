import fs from 'node:fs'
import path from 'node:path'
import type { GodotProjectInfo } from '../../shared/godotBridgeTypes'

const ASSET_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.svg', '.webp',
  '.wav', '.ogg', '.mp3',
  '.ttf', '.otf',
  '.glb', '.gltf', '.obj'
])

export function detectGodotProject(dir: string): GodotProjectInfo {
  const projectGodotPath = path.join(dir, 'project.godot')
  if (!fs.existsSync(projectGodotPath)) {
    throw new Error(`File project.godot tidak ditemukan di direktori: ${dir}`)
  }

  const content = fs.readFileSync(projectGodotPath, 'utf-8')
  const lines = content.split(/\r?\n/)

  let currentSection = ''
  let configVersion = 5
  let name = path.basename(dir)
  let godotVersion = '4.3'
  let mainScene: string | null = null
  const autoloads: { name: string; path: string }[] = []
  let viewportWidth = 1152
  let viewportHeight = 648
  const inputActions: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim()
    if (!rawLine || rawLine.startsWith(';')) continue

    if (rawLine.startsWith('[') && rawLine.endsWith(']')) {
      currentSection = rawLine.slice(1, -1).trim()
      continue
    }

    const eqIdx = rawLine.indexOf('=')
    if (eqIdx === -1) continue

    const key = rawLine.slice(0, eqIdx).trim()
    const val = rawLine.slice(eqIdx + 1).trim()

    if (key === 'config_version') {
      configVersion = parseInt(val, 10)
      if (configVersion <= 4) {
        throw new Error(
          'Project Godot 3.x belum didukung. Buka di Godot 4 lalu simpan ulang.'
        )
      }
    } else if (currentSection === 'application') {
      if (key === 'config/name') {
        name = val.replace(/^["']|["']$/g, '')
      } else if (key === 'run/main_scene') {
        mainScene = val.replace(/^["']|["']$/g, '')
      } else if (key === 'config/features') {
        const match = val.match(/"(\d+\.\d+)"/)
        if (match) {
          godotVersion = match[1]
        }
      }
    } else if (currentSection === 'autoload') {
      autoloads.push({
        name: key,
        path: val.replace(/^["'*]|["']$/g, ''),
      })
    } else if (currentSection === 'display') {
      if (key === 'window/size/viewport_width') {
        viewportWidth = parseInt(val, 10) || viewportWidth
      } else if (key === 'window/size/viewport_height') {
        viewportHeight = parseInt(val, 10) || viewportHeight
      }
    } else if (currentSection === 'input') {
      inputActions.push(key)
    }
  }

  // Scan file counts
  let scenesCount = 0
  let scriptsCount = 0
  let resourcesCount = 0
  let assetsCount = 0

  function scanFolder(folder: string) {
    if (!fs.existsSync(folder)) return
    const entries = fs.readdirSync(folder, { withFileTypes: true })
    for (const ent of entries) {
      if (ent.name === '.git' || ent.name === '.godot' || ent.name === '.linden') continue
      const full = path.join(folder, ent.name)
      if (ent.isDirectory()) {
        scanFolder(full)
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase()
        if (ext === '.tscn') scenesCount++
        else if (ext === '.gd') scriptsCount++
        else if (ext === '.tres') resourcesCount++
        else if (ASSET_EXTENSIONS.has(ext)) assetsCount++
      }
    }
  }

  scanFolder(dir)

  // Scan addons
  const addons: string[] = []
  const addonsDir = path.join(dir, 'addons')
  if (fs.existsSync(addonsDir)) {
    try {
      const items = fs.readdirSync(addonsDir, { withFileTypes: true })
      for (const item of items) {
        if (item.isDirectory() && !item.name.startsWith('.')) {
          addons.push(item.name)
        }
      }
    } catch {}
  }

  return {
    dir,
    name,
    godotVersion,
    configVersion,
    mainScene,
    autoloads,
    viewport: { width: viewportWidth, height: viewportHeight },
    inputActions,
    counts: {
      scenes: scenesCount,
      scripts: scriptsCount,
      resources: resourcesCount,
      assets: assetsCount,
    },
    addons,
  }
}
