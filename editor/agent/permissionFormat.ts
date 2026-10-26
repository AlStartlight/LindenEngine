import { AgentPermissionRequest } from '../../shared/agentTypes'

const ACTION_TITLES: Record<string, string> = {
  shell: 'Menjalankan perintah shell',
  edit: 'Mengubah file',
  write: 'Menulis file',
  read: 'Membaca file',
  glob: 'Mencari file',
  grep: 'Mencari isi file',
  list: 'Melihat isi folder',
  webfetch: 'Mengakses web',
  websearch: 'Mencari di web',
  browser: 'Membuka browser',
  external_directory: 'Mengakses folder di luar proyek',
}

export function permissionTitle(action: string): string {
  return ACTION_TITLES[action] ?? `Izin "${action}"`
}

const normalize = (p: string) => p.replace(/\\/g, '/')

/** Show paths inside the project relative to it; anything else is returned unchanged */
export function toProjectRelative(projectPath: string | null | undefined, resource: string): string {
  if (!projectPath) return resource
  const root = normalize(projectPath).replace(/\/+$/, '')
  const value = normalize(resource)
  if (value === root) return '.'
  return value.startsWith(`${root}/`) ? value.slice(root.length + 1) : resource
}

export interface PermissionLine {
  /** Text shown in the card */
  text: string
  /** Full original value, for the tooltip */
  full: string
  /** "+3 −1" style change summary for edits */
  change?: string
}

/** One line per command or path: never join resources into one long string */
export function permissionLines(req: AgentPermissionRequest, projectPath?: string | null): PermissionLine[] {
  if (req.files && req.files.length > 0) {
    return req.files.map((f) => ({
      text: toProjectRelative(projectPath, f.file),
      full: f.file,
      change:
        f.additions !== undefined || f.deletions !== undefined ? `+${f.additions ?? 0} −${f.deletions ?? 0}` : undefined,
    }))
  }
  return req.resources.map((r) => ({
    text: req.action === 'shell' ? r : toProjectRelative(projectPath, r),
    full: r,
  }))
}
