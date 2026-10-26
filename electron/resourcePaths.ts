import fs from 'node:fs'
import path from 'node:path'

/**
 * Resolve a file shipped with the editor. In dev it lives under the repo (devRel);
 * in a packaged app electron-builder copies it to resources/<packagedRel> (extraResources).
 */
export function resolveAppResource(devRel: string, packagedRel: string): string {
  const devPath = path.join(process.cwd(), devRel)
  if (fs.existsSync(devPath)) return devPath

  const appPath = path.join(__dirname, '..', devRel)
  if (fs.existsSync(appPath)) return appPath

  const resourcesPath = (process as any).resourcesPath
  if (resourcesPath) {
    const packagedPath = path.join(resourcesPath, packagedRel)
    if (fs.existsSync(packagedPath)) return packagedPath
  }

  return devPath
}
