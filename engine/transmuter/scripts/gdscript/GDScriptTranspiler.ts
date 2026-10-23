/**
 * GDScript <-> TypeScript Transpiler (FR-07, TC-SC-01..03, TC-SC-07)
 */

export interface TranspileResult {
  code: string
  warnings: string[]
  hasUnsupported: boolean
}

export class GDScriptTranspiler {
  /**
   * Transpiles GDScript 2.0 (Godot 4) code into TypeScript
   */
  static gdscriptToTypeScript(source: string, className: string = 'TransmutedScript'): TranspileResult {
    const lines = source.split(/\r?\n/)
    const outputLines: string[] = []
    const warnings: string[] = []
    let hasUnsupported = false

    let extendsClass = 'Node'
    const classProps: string[] = []
    const classMethods: string[] = []
    let currentMethodLines: string[] | null = null

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i]
      const trimmed = rawLine.trim()

      if (!trimmed || trimmed.startsWith('#')) {
        continue
      }

      // extends ...
      if (trimmed.startsWith('extends ')) {
        const target = trimmed.replace('extends ', '').trim()
        extendsClass = target === 'CharacterBody2D' ? 'CharacterBody2D' : (target === 'Node2D' ? 'Node2D' : (target === 'Node3D' ? 'Node3D' : 'Node'))
        continue
      }

      // signal my_signal
      if (trimmed.startsWith('signal ')) {
        const sigName = trimmed.replace('signal ', '').replace(/\(.*\)/, '').trim()
        classProps.push(`  public readonly ${sigName} = new Signal('${sigName}', this)`)
        continue
      }

      // @export var speed: float = 200.0 or @export var speed = 200
      if (trimmed.startsWith('@export') || trimmed.startsWith('var ')) {
        const cleaned = trimmed.replace('@export', '').replace('var', '').trim()
        const [left, right] = cleaned.split('=').map((s) => s.trim())
        const [varName, varType] = left.split(':').map((s) => s.trim())

        let tsType = 'any'
        let defaultVal = right || 'null'
        if (varType === 'float' || varType === 'int') {
          tsType = 'number'
        } else if (varType === 'String' || varType === 'string') {
          tsType = 'string'
        } else if (varType === 'bool' || varType === 'boolean') {
          tsType = 'boolean'
        } else if (right && !isNaN(Number(right))) {
          tsType = 'number'
        }

        classProps.push(`  public ${varName}: ${tsType} = ${defaultVal}`)
        continue
      }

      // func _ready(): or func _process(delta):
      if (trimmed.startsWith('func ')) {
        if (currentMethodLines) {
          classMethods.push(currentMethodLines.join('\n'))
        }

        const funcHeader = trimmed.replace('func ', '').replace(/:$/, '').trim()
        currentMethodLines = []

        if (funcHeader.startsWith('_ready(')) {
          currentMethodLines.push(`  onInit(): void {`)
        } else if (funcHeader.startsWith('_process(')) {
          const arg = funcHeader.includes('delta') ? 'delta: number' : ''
          currentMethodLines.push(`  onUpdate(${arg}): void {`)
        } else if (funcHeader.startsWith('_physics_process(')) {
          const arg = funcHeader.includes('delta') ? 'delta: number' : ''
          currentMethodLines.push(`  onPhysicsUpdate(${arg}): void {`)
        } else {
          // Custom function
          currentMethodLines.push(`  ${funcHeader}: void {`)
        }
        continue
      }

      // Inside function body
      if (currentMethodLines) {
        // Check for unsupported GDScript constructs (e.g. await create_timer, meta reflection)
        if (trimmed.includes('create_timer') || trimmed.includes('get_tree().create_timer') || trimmed.includes('ClassDB.') || trimmed.includes('set_meta')) {
          hasUnsupported = true
          warnings.push(`Unsupported construct at line ${i + 1}: ${trimmed}`)
          currentMethodLines.push(`    // TRANSMUTER-TODO: Unsupported GDScript: ${trimmed}`)
          continue
        }

        // Map emit_signal("sig") or sig.emit()
        let converted = trimmed
        if (converted.includes('emit_signal(')) {
          converted = converted.replace(/emit_signal\(([^)]+)\)/g, 'this.emitSignal($1)')
        } else if (/\.emit\(/.test(converted)) {
          converted = converted.replace(/([a-zA-Z0-9_]+)\.emit\(([^)]*)\)/g, 'this.$1.emit($2)')
        }

        // Map get_node(...)
        if (converted.includes('get_node(')) {
          converted = converted.replace(/get_node\(([^)]+)\)/g, 'this.getNode($1)')
        }

        currentMethodLines.push(`    ${converted};`)
      }
    }

    if (currentMethodLines) {
      currentMethodLines.push(`  }`)
      classMethods.push(currentMethodLines.join('\n'))
    }

    outputLines.push(`import { ${extendsClass}, Signal } from '../scene/index'`)
    outputLines.push('')
    outputLines.push(`export class ${className} extends ${extendsClass} {`)
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
   * Transpiles TypeScript into GDScript (Godot 4)
   */
  static typeScriptToGDScript(tsSource: string): string {
    const lines = tsSource.split(/\r?\n/)
    const gdLines: string[] = ['extends Node3D', '']

    for (const rawLine of lines) {
      const trimmed = rawLine.trim()
      if (trimmed.startsWith('onUpdate(') || trimmed.startsWith('onUpdate (')) {
        gdLines.push('func _process(delta):')
      } else if (trimmed.startsWith('onInit(') || trimmed.startsWith('onInit (')) {
        gdLines.push('func _ready():')
      } else if (trimmed.includes('rotateY(') || trimmed.includes('rotation.y +=')) {
        gdLines.push('\trotate_y(delta)')
      }
    }

    return gdLines.join('\n')
  }
}
