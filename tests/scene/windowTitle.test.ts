import { describe, it, expect } from 'vitest'
import {
  formatWindowTitle,
  getSceneStatusSuffix,
  getSceneNameFromPath,
} from '../../editor/ui/windowTitle'
import { validateSceneName } from '../../editor/windows/NewSceneDialog'

describe('Window Title & Scene Name Helpers', () => {
  describe('formatWindowTitle', () => {
    it('returns "Linden Engine" when no project is open (Project Manager)', () => {
      const title = formatWindowTitle({
        projectName: null,
        sceneName: null,
        isDirty: false,
        isSaved: false,
      })
      expect(title).toBe('Linden Engine')
    })

    it('formats title for saved scene in open project', () => {
      const title = formatWindowTitle({
        projectName: 'MyGame',
        sceneName: 'Isac',
        isDirty: false,
        isSaved: true,
      })
      expect(title).toBe('MyGame — Scene: Isac — Linden Engine')
    })

    it('formats title for scene with unsaved changes (* dirty indicator)', () => {
      const title = formatWindowTitle({
        projectName: 'MyGame',
        sceneName: 'Isac',
        isDirty: true,
        isSaved: true,
      })
      expect(title).toBe('MyGame — Scene: Isac * — Linden Engine')
    })

    it('formats title for new scene that has never been saved ((unsaved) indicator)', () => {
      const title = formatWindowTitle({
        projectName: 'MyGame',
        sceneName: 'Isac',
        isDirty: false,
        isSaved: false,
      })
      expect(title).toBe('MyGame — Scene: Isac (unsaved) — Linden Engine')
    })

    it('formats title for new unsaved scene that also has dirty edits (* takes precedence)', () => {
      const title = formatWindowTitle({
        projectName: 'MyGame',
        sceneName: 'Isac',
        isDirty: true,
        isSaved: false,
      })
      expect(title).toBe('MyGame — Scene: Isac * — Linden Engine')
    })

    it('handles project with no scene name', () => {
      const title = formatWindowTitle({
        projectName: 'MyGame',
        sceneName: null,
        isDirty: false,
        isSaved: false,
      })
      expect(title).toBe('MyGame — Linden Engine')
    })
  })

  describe('getSceneStatusSuffix', () => {
    it('returns empty string when saved and clean', () => {
      expect(getSceneStatusSuffix({ isDirty: false, isSaved: true })).toBe('')
    })

    it('returns " *" when dirty regardless of saved state', () => {
      expect(getSceneStatusSuffix({ isDirty: true, isSaved: true })).toBe(' *')
      expect(getSceneStatusSuffix({ isDirty: true, isSaved: false })).toBe(' *')
    })

    it('returns " (unsaved)" when not saved and not dirty', () => {
      expect(getSceneStatusSuffix({ isDirty: false, isSaved: false })).toBe(' (unsaved)')
    })
  })

  describe('getSceneNameFromPath', () => {
    it('extracts name from standard POSIX file path', () => {
      expect(getSceneNameFromPath('/Users/asep/Documents/MyGame/scenes/Isac.lscene')).toBe('Isac')
    })

    it('extracts name from Windows file path with backslashes', () => {
      expect(getSceneNameFromPath('C:\\Users\\asep\\Documents\\MyGame\\scenes\\Isac.lscene')).toBe('Isac')
    })

    it('extracts name from bare filename', () => {
      expect(getSceneNameFromPath('Isac.lscene')).toBe('Isac')
    })

    it('is case-insensitive to .lscene extension', () => {
      expect(getSceneNameFromPath('/scenes/Level1.LSCENE')).toBe('Level1')
    })

    it('preserves dots inside the scene name', () => {
      expect(getSceneNameFromPath('/scenes/Level.01.final.lscene')).toBe('Level.01.final')
    })

    it('returns bare name if no extension is present', () => {
      expect(getSceneNameFromPath('Isac')).toBe('Isac')
    })

    it('handles empty path', () => {
      expect(getSceneNameFromPath('')).toBe('')
    })
  })

  describe('validateSceneName', () => {
    it('accepts valid alphanumeric scene names', () => {
      expect(validateSceneName('Isac').valid).toBe(true)
      expect(validateSceneName('NewScene').valid).toBe(true)
      expect(validateSceneName('Level_01-Forest').valid).toBe(true)
    })

    it('rejects empty or whitespace-only names', () => {
      expect(validateSceneName('').valid).toBe(false)
      expect(validateSceneName('   ').valid).toBe(false)
    })

    it('rejects names longer than 64 characters', () => {
      const longName = 'A'.repeat(65)
      const res = validateSceneName(longName)
      expect(res.valid).toBe(false)
      expect(res.error).toContain('64 karakter')
    })

    it('rejects invalid file path characters / \\ : * ? " < > |', () => {
      const forbidden = ['/', '\\', ':', '*', '?', '"', '<', '>', '|']
      for (const char of forbidden) {
        const res = validateSceneName(`Scene${char}Name`)
        expect(res.valid).toBe(false)
      }
    })

    it('rejects existing scene names with "Nama sudah dipakai"', () => {
      const existing = ['scenes/Main.lscene', 'scenes/Level1.lscene', 'Isac']
      const res = validateSceneName('Main', existing)
      expect(res.valid).toBe(false)
      expect(res.error).toBe('Nama sudah dipakai')

      const resCase = validateSceneName('main', existing)
      expect(resCase.valid).toBe(false)
      expect(resCase.error).toBe('Nama sudah dipakai')

      const resIsac = validateSceneName('isac', existing)
      expect(resIsac.valid).toBe(false)
      expect(resIsac.error).toBe('Nama sudah dipakai')
    })

    it('allows a name that does not collide with existing scenes', () => {
      const existing = ['scenes/Main.lscene', 'scenes/Level1.lscene']
      const res = validateSceneName('Level2', existing)
      expect(res.valid).toBe(true)
    })
  })
})
