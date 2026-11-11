import React, { useEffect, useState } from 'react'
import { useEditorStore } from '../store/editorStore'
import { CURSOR_STYLES, cursorCss, normalizeCursorSettings, type CursorMode, type CursorStyle } from '../../shared/cursorSettings'
import { projectAssetUrl, type AssetEntry } from '../../shared/assetProtocol'

const MODE_LABELS: Record<CursorMode, { label: string; hint: string }> = {
  auto: { label: 'Auto', hint: 'Cursor tampil; klik mengunci cursor hanya kalau ada action yang memakai Mouse/Delta (mouse look).' },
  visible: { label: 'Selalu tampil', hint: 'Cursor tidak pernah dikunci. Untuk point & click, strategi, puzzle, atau game yang banyak UI. Mouse/Delta selalu 0.' },
  hidden: { label: 'Disembunyikan', hint: 'Cursor tidak terlihat di atas game tapi tidak dikunci, misalnya kalau game menggambar cursor sendiri.' },
  locked: { label: 'Dikunci (FPS)', hint: 'Klik pada game mengunci dan menyembunyikan cursor (first person / mouse look). Esc melepasnya.' },
}

const STYLE_LABELS: Record<CursorStyle, string> = {
  default: 'Panah (default)',
  pointer: 'Tangan (pointer)',
  crosshair: 'Crosshair',
  move: 'Move',
  grab: 'Grab',
  grabbing: 'Grabbing',
  text: 'Teks',
  help: 'Help',
  wait: 'Wait',
  'not-allowed': 'Not allowed',
  custom: 'Gambar custom…',
}

const IMAGE_RE = /\.(png|svg|cur|gif|webp)$/i

/** Project Settings → Cursor: shown/hidden/locked over the game and its shape (project.linden.json "cursor") */
export const CursorSettingsSection: React.FC = () => {
  const { projectSettings, projectPath, saveCursorSettings, setProjectSettings } = useEditorStore()
  const cursor = normalizeCursorSettings(projectSettings.cursor)
  const usesMouseLook = projectSettings.inputActions.some((a) => a.bindings?.includes('Mouse/Delta'))
  const [images, setImages] = useState<string[]>([])
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    window.electronAPI?.listAssets?.().then(
      (list: AssetEntry[]) => setImages(list.filter((a) => IMAGE_RE.test(a.path)).map((a) => a.path)),
      () => {}
    )
  }, [])

  // Show what is on disk (edited outside the editor, by the agent, or a failed save), not a stale store copy
  useEffect(() => {
    const read = window.electronAPI?.readProjectCursor
    if (!projectPath || !read) return
    let alive = true
    const refresh = () =>
      read(projectPath).then(
        (onDisk) => {
          if (!alive) return
          const inStore = normalizeCursorSettings(useEditorStore.getState().projectSettings.cursor)
          if (JSON.stringify(onDisk) !== JSON.stringify(inStore)) setProjectSettings({ cursor: onDisk })
        },
        () => {}
      )
    refresh()
    window.addEventListener('focus', refresh)
    return () => {
      alive = false
      window.removeEventListener('focus', refresh)
    }
  }, [projectPath, setProjectSettings])

  const save = async (patch: Parameters<typeof saveCursorSettings>[0]) => {
    const res = await saveCursorSettings(patch)
    setStatus(
      res === 'error'
        ? 'Gagal menyimpan ke project.linden.json'
        : res === 'memory-only'
          ? 'Belum tersimpan ke file: tidak ada project yang terbuka'
          : null
    )
  }

  const shapeDisabled = cursor.mode === 'hidden'
  // Editor preview loads the custom image through linden-asset:// (the game resolves it next to project.linden.json)
  const previewCss = cursorCss(cursor, projectAssetUrl)

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-gray-300 text-sm">Mouse Cursor</h3>
      <div className="bg-[#121b33] border border-gray-700/50 rounded-lg p-3 space-y-3 max-w-md">
        <div className="flex items-center justify-between gap-3">
          <span className="text-gray-300">Mode</span>
          <select
            aria-label="Cursor mode"
            value={cursor.mode}
            onChange={(e) => save({ mode: e.target.value as CursorMode })}
            className="bg-black/40 border border-gray-700 rounded px-2 py-1 text-white"
          >
            {(Object.keys(MODE_LABELS) as CursorMode[]).map((m) => (
              <option key={m} value={m}>
                {MODE_LABELS[m].label}
              </option>
            ))}
          </select>
        </div>
        <p className="text-gray-500 leading-relaxed">{MODE_LABELS[cursor.mode].hint}</p>
        {usesMouseLook && (cursor.mode === 'visible' || cursor.mode === 'hidden') && (
          <p className="text-amber-400 leading-relaxed">
            Project ini punya action dengan binding Mouse/Delta (mouse look). Di mode ini cursor tidak dikunci, jadi
            Mouse/Delta selalu 0 dan kamera tidak berputar mengikuti mouse.
          </p>
        )}

        <div className="flex items-center justify-between gap-3">
          <span className={shapeDisabled ? 'text-gray-600' : 'text-gray-300'}>Bentuk</span>
          <select
            aria-label="Cursor shape"
            value={cursor.style}
            disabled={shapeDisabled}
            onChange={(e) => {
              const style = e.target.value as CursorStyle
              // 'custom' needs an image; pick the first one so the choice sticks
              if (style === 'custom' && !cursor.image) {
                if (images[0]) save({ style, image: images[0] })
                else setStatus('Belum ada gambar (PNG/SVG/CUR) di folder assets/')
                return
              }
              save({ style })
            }}
            className="bg-black/40 border border-gray-700 rounded px-2 py-1 text-white disabled:opacity-50"
          >
            {CURSOR_STYLES.map((s) => (
              <option key={s} value={s}>
                {STYLE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        {cursor.style === 'custom' && !shapeDisabled && (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="text-gray-300">Gambar</span>
              <select
                aria-label="Cursor image"
                value={cursor.image ?? ''}
                onChange={(e) => save({ image: e.target.value })}
                className="max-w-[220px] bg-black/40 border border-gray-700 rounded px-2 py-1 text-white"
              >
                {cursor.image && !images.includes(cursor.image) && <option value={cursor.image}>{cursor.image}</option>}
                {images.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-gray-300">Hotspot (x, y px)</span>
              <div className="flex gap-2">
                {[0, 1].map((i) => (
                  <input
                    key={i}
                    aria-label={i === 0 ? 'Hotspot X' : 'Hotspot Y'}
                    type="number"
                    min={0}
                    max={127}
                    value={cursor.hotspot[i]}
                    onChange={(e) => {
                      const hotspot: [number, number] = [...cursor.hotspot]
                      hotspot[i] = Number(e.target.value)
                      save({ hotspot })
                    }}
                    className="w-16 bg-black/40 border border-gray-700 rounded px-2 py-1 text-white"
                  />
                ))}
              </div>
            </div>
            <p className="text-gray-500 leading-relaxed">
              Hotspot = titik klik di dalam gambar, dihitung dari kiri atas. Browser membatasi gambar cursor maksimal 128×128 px
              (disarankan 32×32).
            </p>
          </>
        )}

        <div
          className="h-16 rounded border border-dashed border-gray-600 flex items-center justify-center text-gray-500"
          style={{ cursor: previewCss }}
        >
          Arahkan mouse ke sini untuk preview
        </div>
        {status && <p className="text-amber-400">{status}</p>}
        <p className="text-gray-500 leading-relaxed">Berlaku di Play (langsung, tanpa Stop/Play), Game Frame, dan web export. Tidak berpengaruh di perangkat sentuh.</p>
      </div>
    </div>
  )
}
