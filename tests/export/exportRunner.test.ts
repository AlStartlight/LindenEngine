import { describe, it, expect } from 'vitest'
import { ExportRunner } from '../../editor/export/ExportRunner'
import { ExportPreset } from '../../shared/types/project'
import { useEditorStore } from '../../editor/store/editorStore'

describe('Multi-Platform Export Runner & Presets (Spec §6)', () => {
  const samplePresets: ExportPreset[] = [
    {
      id: 'p-web',
      name: 'Web HTML5',
      platform: 'web',
      backend: 'linden',
      arch: ['wasm'],
      output: 'build/web/index.html',
      mode: 'release',
    },
    {
      id: 'p-android',
      name: 'Android APK',
      platform: 'android',
      backend: 'godot',
      arch: ['arm64'],
      output: 'build/android/game.apk',
      mode: 'debug',
    },
    {
      id: 'p-win',
      name: 'Windows Desktop',
      platform: 'windows',
      backend: 'linden',
      arch: ['x64'],
      output: 'build/win/game.exe',
      mode: 'release',
    },
  ]

  it('checks preset readiness and flags missing Godot binary for Godot backend', () => {
    // When Godot binary is not detected
    const checks = ExportRunner.checkPresetReadiness(samplePresets[1], '/tmp/proj', null)
    expect(checks.length).toBeGreaterThan(0)

    const godotCheck = checks.find((c) => c.id === 'godot-binary')
    expect(godotCheck).toBeDefined()
    expect(godotCheck?.passed).toBe(false)
    expect(godotCheck?.fixLabel).toBe('Unduh Godot')

    const androidCheck = checks.find((c) => c.id === 'android-templates')
    expect(androidCheck).toBeDefined()
  })

  it('checks readiness for Linden native presets', () => {
    const checks = ExportRunner.checkPresetReadiness(samplePresets[0], '/tmp/proj')
    const runtimeCheck = checks.find((c) => c.id === 'linden-runtime')
    expect(runtimeCheck).toBeDefined()
    expect(runtimeCheck?.passed).toBe(true)
  })

  it('executes Linden native export with progress stages', async () => {
    const stages: string[] = []
    const logs: string[] = []

    const res = await ExportRunner.runExport(
      samplePresets[0],
      '/tmp/test-project',
      (prog) => stages.push(prog.stage),
      (log) => logs.push(log)
    )

    expect(res.success).toBe(true)
    expect(stages).toContain('validation')
    expect(stages).toContain('bundle')
    expect(stages).toContain('package')
    expect(stages).toContain('complete')
    expect(logs.some((l) => l.includes('Memulai export'))).toBe(true)
  })

  it('executes Data-only export bundle', async () => {
    const logs: string[] = []
    const res = await ExportRunner.exportDataOnly(
      '/tmp/test-project',
      ['scenes/Main.lscene', 'scenes/Level2.lscene'],
      'build/data/game.lpkg',
      (l) => logs.push(l)
    )

    expect(res.success).toBe(true)
    expect(logs.some((l) => l.includes('Membundel 2 scene'))).toBe(true)
  })

  it('manages export presets in editor store', () => {
    const store = useEditorStore.getState()
    const initialCount = store.exportPresets.length

    const customPreset: ExportPreset = {
      id: 'custom-preset-1',
      name: 'Custom Linux',
      platform: 'linux',
      backend: 'linden',
      arch: ['x64'],
      output: 'build/linux/game.AppImage',
      mode: 'release',
    }

    store.addExportPreset(customPreset)
    expect(useEditorStore.getState().exportPresets.length).toBe(initialCount + 1)

    // Update
    store.updateExportPreset({ ...customPreset, mode: 'debug' })
    const updated = useEditorStore.getState().exportPresets.find((p) => p.id === 'custom-preset-1')
    expect(updated?.mode).toBe('debug')

    // Remove
    store.removeExportPreset('custom-preset-1')
    expect(useEditorStore.getState().exportPresets.length).toBe(initialCount)
  })
})
