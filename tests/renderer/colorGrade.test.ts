import { describe, it, expect } from 'vitest'
import { DEFAULT_SCENE_SETTINGS, SceneSettingsSchema, normalizeSceneSettings } from '../../engine/scene/SceneSettings'

/**
 * Color grading is a display-referred CDL pass after tone mapping. Blender previews apply the same
 * math (blender-bridge/runner.py `_grade_rgb`), so the schema defaults and fallbacks must stay
 * neutral for old scenes.
 */
describe('scene color grading', () => {
  it('is disabled and neutral by default', () => {
    const s = SceneSettingsSchema.parse({})
    expect(s.colorGrade).toEqual({
      enabled: false,
      contrast: 1,
      saturation: 1,
      temperature: 0,
      tint: 0,
      lift: 0,
      gamma: 1,
      gain: 1,
      vignette: 0,
    })
    expect(DEFAULT_SCENE_SETTINGS.colorGrade.enabled).toBe(false)
  })

  it('keeps an old scene working and adds the neutral grade', () => {
    const { settings, warnings } = normalizeSceneSettings({ toneMapping: 'aces', exposure: 1.2 })
    expect(warnings).toEqual([])
    expect(settings.toneMapping).toBe('aces')
    expect(settings.exposure).toBe(1.2)
    expect(settings.colorGrade.enabled).toBe(false)
  })

  it('accepts a valid grade and drops an invalid one with a warning', () => {
    const ok = normalizeSceneSettings({
      colorGrade: { enabled: true, contrast: 1.15, saturation: 1.08, temperature: -0.2, tint: 0.1, vignette: 0.3 },
    })
    expect(ok.warnings).toEqual([])
    expect(ok.settings.colorGrade).toMatchObject({ enabled: true, contrast: 1.15, saturation: 1.08, temperature: -0.2, vignette: 0.3 })

    // An out-of-range field invalidates the whole colorGrade block; the scene still loads
    const bad = normalizeSceneSettings({ colorGrade: { enabled: true, contrast: 99 } })
    expect(bad.warnings[0]).toMatch(/colorGrade/)
    expect(bad.settings.colorGrade).toEqual(DEFAULT_SCENE_SETTINGS.colorGrade)
  })
})
