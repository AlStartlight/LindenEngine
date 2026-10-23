import { MAX_SCENE_BYTES, SceneLoadErrorCode } from '../../engine/scene'

export type PickResult =
  | { status: 'canceled' }
  | { status: 'ok'; fileName: string; path: string | null; content: string }
  | { status: 'error'; code: SceneLoadErrorCode; fileName?: string; message: string }

export async function pickAndReadScene(defaultDir?: string): Promise<PickResult> {
  // 1. Electron environment
  if (typeof window !== 'undefined' && window.electronAPI?.openSceneDialog) {
    try {
      const res = await window.electronAPI.openSceneDialog(defaultDir ? { defaultDir } : undefined)
      if (res.status === 'canceled') {
        return { status: 'canceled' }
      }
      if (res.status === 'error') {
        return {
          status: 'error',
          code: (res.code as SceneLoadErrorCode) || 'READ_FAILED',
          fileName: res.fileName,
          message: res.message || 'File tidak bisa dibaca.',
        }
      }
      return {
        status: 'ok',
        fileName: res.fileName ?? 'scene.lscene',
        path: res.path ?? null,
        content: res.content ?? '',
      }
    } catch (err: any) {
      return {
        status: 'error',
        code: 'READ_FAILED',
        message: `File tidak bisa dibaca: ${err?.message || String(err)}`,
      }
    }
  }

  // 2. Web browser environment
  return new Promise<PickResult>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.lscene'
    input.style.display = 'none'
    document.body.appendChild(input)

    let settled = false

    const cleanup = () => {
      settled = true
      window.removeEventListener('focus', onFocus)
      input.remove()
    }

    input.onchange = async () => {
      if (settled) return
      const file = input.files?.[0]
      cleanup()

      if (!file) {
        resolve({ status: 'canceled' })
        return
      }

      if (file.size > MAX_SCENE_BYTES) {
        resolve({
          status: 'error',
          code: 'FILE_TOO_LARGE',
          fileName: file.name,
          message: 'File lebih dari 50 MB.',
        })
        return
      }

      try {
        const content = await file.text()
        resolve({
          status: 'ok',
          fileName: file.name,
          path: null,
          content,
        })
      } catch (err: any) {
        resolve({
          status: 'error',
          code: 'READ_FAILED',
          fileName: file.name,
          message: `File tidak bisa dibaca: ${err?.message || String(err)}`,
        })
      }
    }

    input.oncancel = () => {
      if (settled) return
      cleanup()
      resolve({ status: 'canceled' })
    }

    const onFocus = () => {
      setTimeout(() => {
        if (!settled && (!input.files || input.files.length === 0)) {
          cleanup()
          resolve({ status: 'canceled' })
        }
      }, 500)
    }

    window.addEventListener('focus', onFocus, { once: true })

    input.click()
  })
}

export async function saveSceneFile(
  content: string,
  defaultName: string = 'Scene.lscene',
  existingPath?: string | null
): Promise<{ status: 'ok'; path: string | null } | { status: 'canceled' } | { status: 'error'; message: string }> {
  if (typeof window !== 'undefined' && window.electronAPI?.saveSceneDialog) {
    try {
      const res = await window.electronAPI.saveSceneDialog({
        defaultPath: existingPath || defaultName,
        content,
      })
      if (res.status === 'canceled') return { status: 'canceled' }
      return { status: 'ok', path: res.path ?? null }
    } catch (err: any) {
      return { status: 'error', message: err.message || String(err) }
    }
  }

  // Browser download fallback
  try {
    const blob = new Blob([content], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = defaultName.endsWith('.lscene') ? defaultName : `${defaultName}.lscene`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    return { status: 'ok', path: existingPath || defaultName }
  } catch (err: any) {
    return { status: 'error', message: err.message || String(err) }
  }
}
