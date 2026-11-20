import { GDScriptTranspiler, TranspileResult as GDResult } from '../scripts/gdscript/GDScriptTranspiler'
import { CSharpTranspiler, CSharpTranspileResult as CSResult } from '../scripts/csharp/CSharpTranspiler'
import { RustWasmBridge, RustTranspileResult as RSResult } from '../scripts/rust/RustWasmBridge'

export type PolyglotLanguage = 'typescript' | 'gdscript' | 'csharp' | 'rust'

export interface PolyglotTransmuteRequest {
  sourceLang: PolyglotLanguage
  targetLang: PolyglotLanguage
  code: string
  className?: string
}

export interface PolyglotTransmuteResult {
  code: string
  sourceLang: PolyglotLanguage
  targetLang: PolyglotLanguage
  warnings: string[]
  hasUnsupported: boolean
}

/**
 * TransmuterCore: Unified Polyglot Engine Router.
 * Supports cross-compilation and 1-click transmutation between any supported
 * language in Linden Engine (GDScript, C#, Rust, and TypeScript).
 */
export class TransmuterCore {
  static transmute(request: PolyglotTransmuteRequest): PolyglotTransmuteResult {
    const { sourceLang, targetLang, code, className = 'GameBehaviour' } = request

    // If source and target are the same, return unchanged
    if (sourceLang === targetLang) {
      return {
        code,
        sourceLang,
        targetLang,
        warnings: [],
        hasUnsupported: false,
      }
    }

    // Direct Transpilation to TypeScript
    if (targetLang === 'typescript') {
      if (sourceLang === 'gdscript') {
        const res = GDScriptTranspiler.gdscriptToTypeScript(code, className)
        return { code: res.code, sourceLang, targetLang, warnings: res.warnings, hasUnsupported: res.hasUnsupported }
      }
      if (sourceLang === 'csharp') {
        const res = CSharpTranspiler.csharpToTypeScript(code, className)
        return { code: res.code, sourceLang, targetLang, warnings: res.warnings, hasUnsupported: res.hasUnsupported }
      }
      if (sourceLang === 'rust') {
        const res = RustWasmBridge.rustToTypeScript(code, className)
        return { code: res.code, sourceLang, targetLang, warnings: res.warnings, hasUnsupported: res.hasUnsupported }
      }
    }

    // Direct Transpilation from TypeScript to other languages
    if (sourceLang === 'typescript') {
      if (targetLang === 'gdscript') {
        const gdCode = GDScriptTranspiler.typeScriptToGDScript(code)
        return { code: gdCode, sourceLang, targetLang, warnings: [], hasUnsupported: false }
      }
      if (targetLang === 'csharp') {
        const csCode = CSharpTranspiler.typeScriptToCSharp(code, className)
        return { code: csCode, sourceLang, targetLang, warnings: [], hasUnsupported: false }
      }
      if (targetLang === 'rust') {
        const rsCode = RustWasmBridge.typeScriptToRust(code, className)
        return { code: rsCode, sourceLang, targetLang, warnings: [], hasUnsupported: false }
      }
    }

    // Cross-transpilation (e.g., C# -> GDScript, GDScript -> Rust) using TypeScript as intermediate AST
    const intermediate = this.transmute({
      sourceLang,
      targetLang: 'typescript',
      code,
      className,
    })

    const finalResult = this.transmute({
      sourceLang: 'typescript',
      targetLang,
      code: intermediate.code,
      className,
    })

    return {
      code: finalResult.code,
      sourceLang,
      targetLang,
      warnings: [...intermediate.warnings, ...finalResult.warnings],
      hasUnsupported: intermediate.hasUnsupported || finalResult.hasUnsupported,
    }
  }

  /**
   * Auto-detect language from file extension or content signature
   */
  static detectLanguage(filePathOrCode: string): PolyglotLanguage {
    const lower = filePathOrCode.toLowerCase()
    if (lower.endsWith('.gd')) return 'gdscript'
    if (lower.endsWith('.cs')) return 'csharp'
    if (lower.endsWith('.rs') || lower.endsWith('.wasm')) return 'rust'
    if (lower.endsWith('.ts') || lower.endsWith('.js')) return 'typescript'

    // Content heuristics
    if (/^\s*extends\s+[A-Za-z0-9_]+/m.test(filePathOrCode) || /func\s+_ready\(\)/m.test(filePathOrCode)) {
      return 'gdscript'
    }
    if (/using\s+UnityEngine;/m.test(filePathOrCode) || /class\s+[A-Za-z0-9_]+\s*:\s*MonoBehaviour/m.test(filePathOrCode)) {
      return 'csharp'
    }
    if (/fn\s+init\s*\(/m.test(filePathOrCode) || /#\[linden_script\]/m.test(filePathOrCode)) {
      return 'rust'
    }

    return 'typescript'
  }
}
