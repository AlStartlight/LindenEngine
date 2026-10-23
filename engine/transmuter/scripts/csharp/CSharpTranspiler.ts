/**
 * C# <-> TypeScript Transpiler (FR-07, TC-SC-04..06)
 */

export interface CSharpTranspileResult {
  code: string
  warnings: string[]
  hasUnsupported: boolean
}

export class CSharpTranspiler {
  /**
   * Transpiles Unity C# MonoBehaviour into TypeScript
   */
  static csharpToTypeScript(source: string, defaultClassName: string = 'TransmutedComponent'): CSharpTranspileResult {
    const lines = source.split(/\r?\n/)
    const outputLines: string[] = []
    const warnings: string[] = []
    let hasUnsupported = false

    let className = defaultClassName
    const classProps: string[] = []
    const classMethods: string[] = []
    let currentMethodLines: string[] | null = null

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i]
      const trimmed = rawLine.trim()

      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('using ')) {
        continue
      }

      // public class Player : MonoBehaviour
      const classMatch = trimmed.match(/public\s+class\s+([a-zA-Z0-9_]+)\s*:\s*MonoBehaviour/)
      if (classMatch) {
        className = classMatch[1]
        continue
      }

      // [SerializeField] private float speed = 10f; or public float speed = 5f;
      if (
        trimmed.includes('[SerializeField]') ||
        (/^public\s+(float|int|string|bool)\s+[a-zA-Z0-9_]+/.test(trimmed) && !trimmed.includes('('))
      ) {
        const cleaned = trimmed.replace('[SerializeField]', '').replace(/public|private|protected/, '').trim()
        const [left, rightRaw] = cleaned.split('=').map((s) => s.trim())
        const [cType, vName] = left.split(/\s+/).map((s) => s.trim())
        const varName = vName ? vName.replace(';', '') : ''

        let tsType = 'number'
        if (cType === 'string') tsType = 'string'
        else if (cType === 'bool') tsType = 'boolean'

        let defaultVal = '0'
        if (rightRaw) {
          defaultVal = rightRaw.replace(/f;/g, '').replace(';', '').trim()
        }

        classProps.push(`  public ${varName}: ${tsType} = ${defaultVal}`)
        continue
      }

      // Coroutines: IEnumerator FadeOut()
      if (trimmed.match(/IEnumerator\s+([a-zA-Z0-9_]+)\s*\((.*)\)/)) {
        if (currentMethodLines) {
          classMethods.push(currentMethodLines.join('\n'))
        }
        const m = trimmed.match(/IEnumerator\s+([a-zA-Z0-9_]+)\s*\((.*)\)/)!
        const methodName = m[1]
        currentMethodLines = [`  async ${methodName}(): Promise<void> {`]
        continue
      }

      // void Start() or void Update()
      const methodMatch = trimmed.match(/(?:void|public\s+void|private\s+void)\s+([a-zA-Z0-9_]+)\s*\((.*)\)/)
      if (methodMatch) {
        if (currentMethodLines) {
          classMethods.push(currentMethodLines.join('\n'))
        }
        const mName = methodMatch[1]
        currentMethodLines = []

        if (mName === 'Start') {
          currentMethodLines.push(`  onInit(): void {`)
        } else if (mName === 'Update') {
          currentMethodLines.push(`  onUpdate(deltaTime: number): void {`)
        } else if (mName === 'FixedUpdate') {
          currentMethodLines.push(`  onFixedUpdate(fixedDelta: number): void {`)
        } else {
          currentMethodLines.push(`  ${mName}(): void {`)
        }
        continue
      }

      // Inside method
      if (currentMethodLines) {
        if (trimmed === '}') {
          currentMethodLines.push(`  }`)
          classMethods.push(currentMethodLines.join('\n'))
          currentMethodLines = null
          continue
        }

        // Check for LINQ or complex nested generics: e.g. .Where(x => ...).Select(...)
        if (trimmed.includes('.Where(') || trimmed.includes('.Select(') || trimmed.includes('System.Linq')) {
          hasUnsupported = true
          warnings.push(`Unsupported LINQ construct at line ${i + 1}: ${trimmed}`)
          currentMethodLines.push(`    // TRANSMUTER-TODO: Unsupported LINQ/Generic: ${trimmed}`)
          continue
        }

        // Coroutine yield: yield return new WaitForSeconds(1.0f);
        if (trimmed.includes('yield return new WaitForSeconds')) {
          const matchSec = trimmed.match(/WaitForSeconds\(([^)]+)\)/)
          const sec = matchSec ? matchSec[1].replace('f', '') : '1'
          currentMethodLines.push(`    await new Promise((r) => setTimeout(r, ${sec} * 1000));`)
          continue
        }

        // GetComponent<Rigidbody>() -> this.getComponent('Rigidbody')
        let converted = trimmed
        if (converted.includes('GetComponent<')) {
          converted = converted.replace(/GetComponent<([a-zA-Z0-9_]+)>\(\)/g, "this.getComponent('$1')")
        }

        currentMethodLines.push(`    ${converted}`)
      }
    }

    if (currentMethodLines) {
      currentMethodLines.push(`  }`)
      classMethods.push(currentMethodLines.join('\n'))
    }

    outputLines.push(`import { Node } from '../scene/index'`)
    outputLines.push('')
    outputLines.push(`export class ${className} extends Node {`)
    if (classProps.length > 0) {
      outputLines.push(classProps.join('\n'))
      outputLines.push('')
    }
    if (classMethods.length > 0) {
      outputLines.push(classMethods.join('\n\n'))
    }
    outputLines.push(`}`)

    return {
      code: outputLines.join('\n'),
      warnings,
      hasUnsupported,
    }
  }

  /**
   * Transpiles TypeScript into C# MonoBehaviour
   */
  static typeScriptToCSharp(tsSource: string, className: string = 'TransmutedBehaviour'): string {
    const lines = tsSource.split(/\r?\n/)
    const csLines: string[] = [
      'using UnityEngine;',
      '',
      `public class ${className} : MonoBehaviour`,
      '{',
    ]

    for (const rawLine of lines) {
      const trimmed = rawLine.trim()
      if (trimmed.startsWith('onInit(')) {
        csLines.push('    void Start()\n    {\n    }')
      } else if (trimmed.startsWith('onUpdate(')) {
        csLines.push('    void Update()\n    {\n    }')
      }
    }

    csLines.push('}')
    return csLines.join('\n')
  }
}
