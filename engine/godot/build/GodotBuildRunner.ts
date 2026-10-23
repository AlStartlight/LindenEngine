/**
 * Godot Build Runner
 * Invokes Godot CLI in headless mode to build export presets (Android, iOS, Web, Desktop).
 */

type ChildProcess = any
type SpawnOptions = any

function getNodeModule<T = any>(moduleName: string): T | null {
  if (typeof window !== 'undefined') {
    return null
  }
  try {
    if (typeof process !== 'undefined' && typeof (process as any)?.getBuiltinModule === 'function') {
      return (process as any).getBuiltinModule(moduleName)
    }
  } catch {
    // Ignore error
  }
  try {
    const req = (globalThis as any).require || (typeof module !== 'undefined' ? (module as any).require : undefined)
    if (typeof req === 'function') {
      return req(moduleName)
    }
  } catch {
    // Ignore error
  }
  return null
}

const nodeChildProcess = getNodeModule<any>('node:child_process')
const nodeFs = getNodeModule<any>('node:fs')
const nodePath = getNodeModule<any>('node:path')

export interface BuildResult {
  success: boolean
  outputPath: string
  logs: string[]
  durationMs: number
  exitCode: number
  error?: string
}

export class GodotBuildRunner {
  /**
   * Find Godot executable on the current system
   */
  static findGodotExecutable(customPath?: string): string | null {
    if (customPath && (!nodeFs || nodeFs.existsSync(customPath))) {
      return customPath
    }

    if (!nodeFs || typeof process === 'undefined') {
      return customPath || null
    }

    const platform = process.platform || ''
    const candidatePaths: string[] = []

    if (platform === 'darwin') {
      candidatePaths.push(
        '/Applications/Godot.app/Contents/MacOS/Godot',
        '/Applications/Godot 4.app/Contents/MacOS/Godot',
        '/Applications/Godot_mono.app/Contents/MacOS/Godot',
        `${process.env?.HOME || ''}/Applications/Godot.app/Contents/MacOS/Godot`
      )
    } else if (platform === 'win32') {
      const progFiles = process.env?.['ProgramFiles'] || 'C:\\Program Files'
      candidatePaths.push(
        `${progFiles}\\Godot\\Godot.exe`,
        `${progFiles}\\Godot 4\\Godot.exe`
      )
    } else {
      // Linux / Unix
      candidatePaths.push(
        '/usr/bin/godot',
        '/usr/local/bin/godot',
        '/usr/bin/godot4',
        '/usr/local/bin/godot4',
        '/snap/bin/godot'
      )
    }

    for (const p of candidatePaths) {
      if (nodeFs.existsSync(p)) {
        return p
      }
    }

    // Check system PATH
    const envPath = process.env?.PATH || ''
    const delimiter = nodePath?.delimiter || (platform === 'win32' ? ';' : ':')
    const pathDirs = envPath.split(delimiter)
    const binNames = platform === 'win32' ? ['godot.exe', 'godot4.exe'] : ['godot', 'godot4']

    for (const dir of pathDirs) {
      for (const bin of binNames) {
        const full = nodePath ? nodePath.join(dir, bin) : `${dir}/${bin}`
        if (nodeFs.existsSync(full)) {
          return full
        }
      }
    }

    return null
  }

  constructor(
    private godotProjectPath: string,
    private customExecutable?: string
  ) {}

  /**
   * Run build export for given preset
   */
  async build(
    preset: string,
    outputPath: string,
    onLog?: (line: string) => void
  ): Promise<BuildResult> {
    const startTime = Date.now()
    const logs: string[] = []

    const execPath = GodotBuildRunner.findGodotExecutable(this.customExecutable)
    if (!execPath) {
      const err =
        'Godot executable not found. Please install Godot 4.3+ or configure the executable path in Godot Bridge settings.'
      return {
        success: false,
        outputPath,
        logs: [err],
        durationMs: 0,
        exitCode: -1,
        error: err,
      }
    }

    // Ensure output directory exists
    if (nodePath && nodeFs) {
      const outDir = nodePath.dirname(outputPath)
      if (!nodeFs.existsSync(outDir)) {
        nodeFs.mkdirSync(outDir, { recursive: true })
      }
    }

    if (!nodeChildProcess?.spawn) {
      const err = 'Process execution (child_process.spawn) is not supported in this environment.'
      return {
        success: false,
        outputPath,
        logs: [err],
        durationMs: 0,
        exitCode: -1,
        error: err,
      }
    }

    const args = [
      '--headless',
      '--path',
      this.godotProjectPath,
      '--export-release',
      preset,
      outputPath,
    ]

    return new Promise((resolve) => {
      const child = nodeChildProcess.spawn(execPath, args)

      child.stdout.on('data', (chunk: any) => {
        const lines = chunk.toString().split('\n')
        for (const line of lines) {
          if (line.trim()) {
            logs.push(line)
            onLog?.(line)
          }
        }
      })

      child.stderr.on('data', (chunk: any) => {
        const lines = chunk.toString().split('\n')
        for (const line of lines) {
          if (line.trim()) {
            logs.push(`[stderr] ${line}`)
            onLog?.(`[stderr] ${line}`)
          }
        }
      })

      child.on('close', (code: any) => {
        const durationMs = Date.now() - startTime
        resolve({
          success: code === 0,
          outputPath,
          logs,
          durationMs,
          exitCode: code ?? -1,
          error: code === 0 ? undefined : `Build failed with exit code ${code}`,
        })
      })

      child.on('error', (err: any) => {
        const durationMs = Date.now() - startTime
        resolve({
          success: false,
          outputPath,
          logs: [...logs, err.message],
          durationMs,
          exitCode: -1,
          error: err.message,
        })
      })
    })
  }
}
