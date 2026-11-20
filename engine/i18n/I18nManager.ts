/**
 * Linden Engine In-Game & Editor Localization (i18n) Manager.
 * Provides unified multi-language text lookup, parameter interpolation,
 * and locale switching across TypeScript, GDScript, C#, and Rust runtimes.
 */

export interface LocaleDictionary {
  locale: string
  fallback?: string
  translations: Record<string, string>
}

export class I18nManager {
  private currentLocale: string = 'en-US'
  private fallbackLocale: string = 'en-US'
  private dictionaries: Map<string, Record<string, string>> = new Map()
  private listeners: Set<(newLocale: string) => void> = new Set()

  constructor(defaultLocale: string = 'en-US', fallback: string = 'en-US') {
    this.currentLocale = defaultLocale
    this.fallbackLocale = fallback
  }

  get locale(): string {
    return this.currentLocale
  }

  get fallback(): string {
    return this.fallbackLocale
  }

  setLocale(locale: string): void {
    if (this.currentLocale === locale) return
    this.currentLocale = locale
    for (const listener of this.listeners) {
      listener(locale)
    }
  }

  setFallback(locale: string): void {
    this.fallbackLocale = locale
  }

  onLocaleChange(listener: (newLocale: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Load a translation dictionary for a given locale
   */
  loadTranslations(locale: string, translations: Record<string, string>): void {
    const existing = this.dictionaries.get(locale) || {}
    this.dictionaries.set(locale, { ...existing, ...translations })
  }

  /**
   * Load from a structured LocaleDictionary object or JSON
   */
  loadDictionary(dict: LocaleDictionary): void {
    if (dict.fallback) {
      this.fallbackLocale = dict.fallback
    }
    this.loadTranslations(dict.locale, dict.translations)
  }

  /**
   * List all registered locale codes
   */
  getAvailableLocales(): string[] {
    return Array.from(this.dictionaries.keys())
  }

  /**
   * Translate a key with optional variable interpolation: e.g. "Nyawa: {hp}/{maxHp}"
   */
  t(key: string, params?: Record<string, unknown>): string {
    const dict = this.dictionaries.get(this.currentLocale)
    let template = dict?.[key]

    // Fallback if not found in current locale
    if (template === undefined && this.fallbackLocale !== this.currentLocale) {
      const fallbackDict = this.dictionaries.get(this.fallbackLocale)
      template = fallbackDict?.[key]
    }

    if (template === undefined) {
      return key
    }

    if (!params) {
      return template
    }

    return this.interpolate(template, params)
  }

  /**
   * GDScript alias for Godot translation parity: I18n.tr("key")
   */
  tr(key: string, params?: Record<string, unknown>): string {
    return this.t(key, params)
  }

  /**
   * C# Unity alias: I18n.Translate("key")
   */
  Translate(key: string, params?: Record<string, unknown>): string {
    return this.t(key, params)
  }

  private interpolate(template: string, params: Record<string, unknown>): string {
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, paramName) => {
      const val = params[paramName]
      return val !== undefined && val !== null ? String(val) : match
    })
  }

  clear(): void {
    this.dictionaries.clear()
    this.listeners.clear()
  }
}

/** Global default in-game i18n instance */
export const globalI18n = new I18nManager('en-US', 'en-US')
