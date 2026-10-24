/**
 * Window title and scene status formatting helpers.
 */

export function getSceneStatusSuffix(opts: { isDirty: boolean; isSaved: boolean }): string {
  if (opts.isDirty) return ' *'
  if (!opts.isSaved) return ' (unsaved)'
  return ''
}

export function formatWindowTitle(opts: {
  projectName: string | null
  sceneName: string | null
  isDirty: boolean
  isSaved: boolean
}): string {
  if (!opts.projectName) return 'Linden Engine'
  const parts = [opts.projectName]
  if (opts.sceneName) {
    const suffix = getSceneStatusSuffix({ isDirty: opts.isDirty, isSaved: opts.isSaved })
    parts.push(`Scene: ${opts.sceneName}${suffix}`)
  }
  parts.push('Linden Engine')
  return parts.join(' — ')
}

export function getSceneNameFromPath(filePath: string): string {
  if (!filePath) return ''
  const parts = filePath.split(/[/\\]/).filter(Boolean)
  const filename = parts.pop() || filePath
  return filename.replace(/\.lscene$/i, '')
}
