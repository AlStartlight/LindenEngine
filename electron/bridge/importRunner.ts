import type { BrowserWindow } from 'electron'
import { detectGodotProject } from './godotDetect'
import { extractGodotProject } from './godotExtract'
import { writeLindenProject } from './projectWriter'
import type { ImportProjectOptions, ImportProgressEvent } from '../../shared/godotBridgeTypes'

const activeJobs = new Set<string>()

export function cancelImportJob(jobId: string) {
  activeJobs.delete(jobId)
}

export function isJobActive(jobId: string): boolean {
  return activeJobs.has(jobId)
}

export async function runGodotImportJob(
  options: ImportProjectOptions,
  userDataDir: string,
  mainWindow: BrowserWindow | null
) {
  const { jobId } = options
  activeJobs.add(jobId)

  const onLog = (line: string) => {
    if (!activeJobs.has(jobId)) return
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('bridge:import:log', { jobId, line })
    }
  }

  const onProgress = (event: ImportProgressEvent) => {
    if (!activeJobs.has(jobId)) return
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('bridge:import:progress', event)
    }
  }

  try {
    onLog(`[Import] Memulai import project Godot dari: ${options.dir}`)

    // 1. Detect
    const projectInfo = detectGodotProject(options.dir)
    onLog(`[Import] Terdeteksi project: "${projectInfo.name}", Godot ${projectInfo.godotVersion}`)

    if (!activeJobs.has(jobId)) {
      throw new Error('Import dibatalkan oleh user')
    }

    // 2. Extract
    const extraction = await extractGodotProject(
      options.dir,
      userDataDir,
      jobId,
      onProgress,
      onLog
    )

    if (!activeJobs.has(jobId)) {
      throw new Error('Import dibatalkan oleh user')
    }

    // 3. Map & Write
    const result = await writeLindenProject(
      projectInfo,
      extraction.scenes,
      options,
      onProgress,
      onLog
    )

    onLog(`[Import] Selesai! Project ditulis ke: ${result.projectPath}`)
    return {
      status: 'success',
      projectPath: result.projectPath,
      reportPath: result.reportPath,
      summary: result.summary,
    }
  } catch (err: any) {
    onLog(`[Import Error] ${err.message}`)
    onProgress({
      jobId,
      stage: 'error',
      done: 0,
      total: 5,
      message: err.message,
    })
    throw err
  } finally {
    activeJobs.delete(jobId)
  }
}
