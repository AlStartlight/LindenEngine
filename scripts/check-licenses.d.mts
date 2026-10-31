export const GEOMETRY_ROOTS: string[]
export const APPROVED_EXCEPTIONS: Record<string, string>
export function checkLicenses(
  roots?: string[],
  lockPath?: string,
): { checked: number; violations: string[]; excepted: string[]; unknown: string[]; missingRoots: string[] }
