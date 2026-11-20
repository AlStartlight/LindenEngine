import { describe, it, expect } from 'vitest'
import { I18nManager } from '../../engine/i18n/I18nManager'
import { World } from '../../engine/ecs/World'
import { Entity } from '../../engine/ecs/Entity'
import { Script } from '../../engine/scripting/ScriptComponents'
import { ScriptRuntime } from '../../engine/scripting/ScriptRuntime'
import { tEditor, setEditorLocale, getEditorLocale, LOCALE_STORAGE_KEY, EDITOR_TRANSLATIONS, EDITOR_LANGUAGES } from '../../editor/i18n/translations'

describe('In-Game & Editor Localization (i18n)', () => {
  it('translates strings with fallback and variable interpolation', () => {
    const i18n = new I18nManager('id-ID', 'en-US')

    i18n.loadTranslations('en-US', {
      'game.title': 'Linden Adventure',
      'hud.health': 'Health: {hp}/{maxHp}',
      'menu.quit': 'Quit Game',
    })

    i18n.loadTranslations('id-ID', {
      'game.title': 'Petualangan Linden',
      'hud.health': 'Nyawa: {hp}/{maxHp}',
    })

    // id-ID direct translation
    expect(i18n.t('game.title')).toBe('Petualangan Linden')
    expect(i18n.t('hud.health', { hp: 75, maxHp: 100 })).toBe('Nyawa: 75/100')

    // Missing in id-ID -> fallback to en-US
    expect(i18n.t('menu.quit')).toBe('Quit Game')

    // Non-existent key returns key itself
    expect(i18n.t('unknown.key')).toBe('unknown.key')
  })

  it('supports Godot tr() and Unity Translate() aliases', () => {
    const i18n = new I18nManager('id-ID')
    i18n.loadTranslations('id-ID', {
      'start_game': 'Mulai Permainan',
    })

    expect(i18n.tr('start_game')).toBe('Mulai Permainan')
    expect(i18n.Translate('start_game')).toBe('Mulai Permainan')
  })

  it('notifies listeners on locale change', () => {
    const i18n = new I18nManager('en-US')
    let notified = ''
    const unsubscribe = i18n.onLocaleChange((locale) => {
      notified = locale
    })

    i18n.setLocale('ja-JP')
    expect(notified).toBe('ja-JP')
    expect(i18n.locale).toBe('ja-JP')

    unsubscribe()
    i18n.setLocale('es-ES')
    expect(notified).toBe('ja-JP') // no further notification after unsub
  })

  it('exposes i18n on GameScriptContext inside ScriptRuntime', async () => {
    const world = new World()
    const entity = world.createEntity('Player')
    const scriptComp = new Script()
    scriptComp.src = 'scripts/Player.ts'
    entity.addComponent(scriptComp)

    const i18n = new I18nManager('id-ID')
    i18n.loadTranslations('id-ID', { 'welcome': 'Selamat datang di Linden' })

    let translatedInScript = ''

    class TestPlayerScript {
      onInit(ctx: any) {
        translatedInScript = ctx.i18n.t('welcome')
      }
    }

    const runtime = new ScriptRuntime({
      world,
      i18n,
      loadModule: async () => ({ default: TestPlayerScript }),
    })

    await runtime.loadAll()
    expect(translatedInScript).toBe('Selamat datang di Linden')
  })

  it('translates Editor UI across en-US, id-ID, ja-JP, and zh-CN', () => {
    setEditorLocale('en-US')
    expect(getEditorLocale()).toBe('en-US')
    expect(tEditor('toolbar.play')).toBe('Play')
    expect(tEditor('panel.inspector')).toBe('Inspector')

    setEditorLocale('id-ID')
    expect(tEditor('toolbar.play')).toBe('Mainkan')
    expect(tEditor('panel.inspector')).toBe('Inspektur')

    setEditorLocale('ja-JP')
    expect(tEditor('toolbar.play')).toBe('プレイ')

    setEditorLocale('zh-CN')
    expect(tEditor('toolbar.play')).toBe('运行')

    setEditorLocale('es-ES')
    expect(tEditor('toolbar.play')).toBe('Reproducir')
    expect(tEditor('console.errors')).toBe('Errores')
    expect(tEditor('assets.search_placeholder')).toBe('Buscar archivos...')
    expect(tEditor('agent.send')).toBe('Generar')
  })

  it('persists editor locale preference in localStorage', () => {
    setEditorLocale('ja-JP')
    if (typeof localStorage !== 'undefined') {
      expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ja-JP')
    }

    setEditorLocale('id-ID')
    if (typeof localStorage !== 'undefined') {
      expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('id-ID')
    }
  })

  it('guarantees essential editor translation keys across all 5 languages', () => {
    const requiredKeys = [
      'toolbar.play',
      'toolbar.move_tool',
      'panel.hierarchy',
      'panel.inspector',
      'panel.console',
      'panel.assets',
      'panel.agent',
      'console.filter_all',
      'console.errors',
      'console.warnings',
      'console.logs',
      'console.clear',
      'assets.search_placeholder',
      'assets.no_assets',
      'agent.prompt_placeholder',
      'agent.send',
      'agent.stop',
    ]

    for (const lang of EDITOR_LANGUAGES) {
      const dict = EDITOR_TRANSLATIONS[lang.code]
      expect(dict).toBeDefined()
      for (const key of requiredKeys) {
        expect(dict[key], `Missing translation key "${key}" for locale "${lang.code}"`).toBeDefined()
        expect(dict[key].length).toBeGreaterThan(0)
      }
    }
  })
})
