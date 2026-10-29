import fs from 'node:fs'
import path from 'node:path'
import { mimeTypeFor } from '../../shared/mime'
import { ASSET_HOST, ASSET_SCHEME, AssetEntry, assetKind } from '../../shared/assetProtocol'
import { safeJoin } from '../play/GameProtocol'

/**
 * Routing for linden-asset://project/<path>: files under the open project's assets/ folder only.
 * Electron-free so the path guards are unit-testable.
 */

let assetRoot: string | null = null

export function setAssetRoot(projectPath: string | null): void {
  assetRoot = projectPath ? path.resolve(projectPath) : null
}

export function getAssetRoot(): string | null {
  return assetRoot
}

export function resolveAssetRequest(url: string, root = assetRoot): { status: number; filePath?: string; headers: Record<string, string> } {
  const headers: Record<string, string> = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { status: 400, headers }
  }
  if (parsed.protocol !== `${ASSET_SCHEME}:` || parsed.host !== ASSET_HOST || !root) return { status: 404, headers }
  const rel = decodeURIComponent(parsed.pathname).replace(/^\/+/, '')
  if (!rel.startsWith('assets/')) return { status: 403, headers }
  const file = safeJoin(root, rel)
  if (!file) return { status: 403, headers }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return { status: 404, headers }
  return { status: 200, filePath: file, headers: { ...headers, 'Content-Type': mimeTypeFor(file) } }
}

/** Every file under assets/ (project-relative, forward slashes) */
export function listProjectAssets(root = assetRoot, limit = 5000): AssetEntry[] {
  if (!root) return []
  const out: AssetEntry[] = []
  const base = path.join(root, 'assets')
  const walk = (dir: string) => {
    if (out.length >= limit || !fs.existsSync(dir)) return
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.')) continue
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(full)
      else if (ent.isFile()) {
        const rel = path.relative(root, full).split(path.sep).join('/')
        out.push({ path: rel, kind: assetKind(rel), size: fs.statSync(full).size })
      }
    }
  }
  walk(base)
  return out.sort((a, b) => a.path.localeCompare(b.path))
}
