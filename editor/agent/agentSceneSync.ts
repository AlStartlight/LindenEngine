const normalize = (p: string) => p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '')

/**
 * Whether a project-relative file the agent wrote is the scene open in the editor.
 * currentScenePath may be absolute or project-relative.
 */
export function isAgentSceneForOpenScene(projectPath: string, file: string, currentScenePath: string | null): boolean {
  if (!currentScenePath) return false
  const rel = normalize(file).replace(/^\.\//, '')
  const open = normalize(currentScenePath)
  return open === `${normalize(projectPath)}/${rel}` || open === rel
}
