/**
 * Rust <-> TypeScript & WebAssembly Bridge for Linden Polyglot Engine.
 * Translates Rust gameplay logic (linden-engine-sdk conventions) to TypeScript,
 * or bridges compiled .wasm modules into Linden IGameScript execution contexts.
 */

export interface RustTranspileResult {
  code: string
  warnings: string[]
  hasUnsupported: boolean
}

export class RustWasmBridge {
  /**
   * Transpiles Rust code with #[linden_script] or standard struct/impl into TypeScript
   */
  static rustToTypeScript(source: string, defaultClassName: string = 'TransmutedRustScript'): RustTranspileResult {
    const lines = source.split(/\r?\n/)
    const outputLines: string[] = []
    const warnings: string[] = []
    let hasUnsupported = false

    let structName = defaultClassName
    const classProps: string[] = []
    const classMethods: string[] = []
    let currentMethodLines: string[] | null = null
    let insideStruct = false

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i]
      const trimmed = rawLine.trim()

      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('use ') || trimmed.startsWith('#![')) {
        continue
      }

      // pub struct VoxelGenerator { ... }
      const structMatch = trimmed.match(/(?:pub\s+)?struct\s+([a-zA-Z0-9_]+)/)
      if (structMatch) {
        structName = structMatch[1]
        insideStruct = true
        continue
      }

      if (insideStruct) {
        if (trimmed === '}' || trimmed.startsWith('}')) {
          insideStruct = false
          continue
        }
        // struct fields: e.g. chunk_size: u32,
        const fieldMatch = trimmed.match(/(?:pub\s+)?([a-zA-Z0-9_]+)\s*:\s*([a-zA-Z0-9_<>]+)/)
        if (fieldMatch) {
          const varName = fieldMatch[1]
          const rType = fieldMatch[2]
          let tsType = 'number'
          let defVal = '0'
          if (rType === 'String' || rType === '&str') {
            tsType = 'string'
            defVal = '""'
          } else if (rType === 'bool') {
            tsType = 'boolean'
            defVal = 'false'
          }
          classProps.push(`  public ${varName}: ${tsType} = ${defVal}`)
        }
        continue
      }

      // impl VoxelGenerator { ... }
      if (trimmed.startsWith('impl ') && trimmed.includes('{')) {
        continue
      }

      // fn init(&mut self, ctx: &mut Context)
      const fnMatch = trimmed.match(/(?:pub\s+)?fn\s+([a-zA-Z0-9_]+)\s*\((.*)\)/)
      if (fnMatch) {
        if (currentMethodLines) {
          classMethods.push(currentMethodLines.join('\n'))
        }
        const fnName = fnMatch[1]
        currentMethodLines = []

        if (fnName === 'init' || fnName === 'new') {
          currentMethodLines.push(`  onInit(context: any): void {`)
        } else if (fnName === 'update') {
          currentMethodLines.push(`  onUpdate(deltaTime: number): void {`)
        } else if (fnName === 'fixed_update' || fnName === 'physics_update') {
          currentMethodLines.push(`  onFixedUpdate(fixedDelta: number): void {`)
        } else if (fnName === 'on_enable') {
          currentMethodLines.push(`  onEnable(): void {`)
        } else if (fnName === 'on_disable') {
          currentMethodLines.push(`  onDisable(): void {`)
        } else if (fnName === 'destroy') {
          currentMethodLines.push(`  onDestroy(): void {`)
        } else {
          currentMethodLines.push(`  ${fnName}(): void {`)
        }
        continue
      }

      if (currentMethodLines) {
        if (trimmed === '}') {
          currentMethodLines.push(`  }`)
          classMethods.push(currentMethodLines.join('\n'))
          currentMethodLines = null
          continue
        }

        let converted = trimmed
        // ctx.log("...") -> console.log("...")
        if (converted.includes('ctx.log(') || converted.includes('println!(')) {
          converted = converted.replace(/(?:ctx\.log|println!)\(/g, 'console.log(')
        }

        // self.field = val -> this.field = val
        if (converted.includes('self.')) {
          converted = converted.replace(/self\./g, 'this.')
        }

        // unsafe blocks
        if (converted.includes('unsafe')) {
          warnings.push(`Unsafe Rust block at line ${i + 1}: ${trimmed}`)
          hasUnsupported = true
        }

        currentMethodLines.push(`    ${converted}`)
      }
    }

    if (currentMethodLines) {
      currentMethodLines.push(`  }`)
      classMethods.push(currentMethodLines.join('\n'))
    }

    outputLines.push(`class Node {
  getNode(name: string): any { return null }
  getComponent(type: string): any { return null }
  emitSignal(name: string, ...args: any[]): void {}
  rotate(...args: any[]): void {}
}`)
    outputLines.push('')
    outputLines.push(`export class ${structName} extends Node {`)
    if (classProps.length > 0) {
      outputLines.push(classProps.join('\n'))
      outputLines.push('')
    }
    if (classMethods.length > 0) {
      outputLines.push(classMethods.join('\n\n'))
      outputLines.push('')
    }
    outputLines.push(`}`)
    outputLines.push(`export default ${structName}`)

    return {
      code: outputLines.join('\n'),
      warnings,
      hasUnsupported,
    }
  }

  /**
   * Generates a TypeScript wrapper for loading and running a compiled .wasm module in Linden ECS.
   */
  static createWasmModuleWrapper(wasmPath: string, className: string = 'WasmGameScript'): string {
    return `// Linden WebAssembly Runtime Module Wrapper
export class ${className} {
  private instance: WebAssembly.Instance | null = null;
  private memory: WebAssembly.Memory | null = null;

  async onInit(context: any): Promise<void> {
    try {
      const response = await fetch('${wasmPath}');
      const buffer = await response.arrayBuffer();
      const imports = {
        env: {
          abort: () => console.error('Wasm script aborted'),
          linden_log: (ptr: number, len: number) => {
            if (!this.memory) return;
            const bytes = new Uint8Array(this.memory.buffer, ptr, len);
            const msg = new TextDecoder().decode(bytes);
            context.log ? context.log(msg) : console.log(msg);
          },
        },
      };
      const result = await WebAssembly.instantiate(buffer, imports);
      this.instance = result.instance;
      this.memory = (result.instance.exports.memory as WebAssembly.Memory) || null;
      if (typeof (this.instance.exports.on_init as any) === 'function') {
        (this.instance.exports.on_init as any)();
      }
    } catch (err) {
      console.error('Failed to instantiate WebAssembly script "${wasmPath}":', err);
    }
  }

  onUpdate(deltaTime: number): void {
    if (this.instance && typeof (this.instance.exports.on_update as any) === 'function') {
      (this.instance.exports.on_update as any)(deltaTime);
    }
  }

  onFixedUpdate(fixedDelta: number): void {
    if (this.instance && typeof (this.instance.exports.on_fixed_update as any) === 'function') {
      (this.instance.exports.on_fixed_update as any)(fixedDelta);
    }
  }

  onDestroy(): void {
    if (this.instance && typeof (this.instance.exports.on_destroy as any) === 'function') {
      (this.instance.exports.on_destroy as any)();
    }
  }
}
export default ${className};
`
  }

  /**
   * Transpiles TypeScript into Rust boilerplate
   */
  static typeScriptToRust(tsSource: string, structName: string = 'TransmutedScript'): string {
    const lines = tsSource.split(/\r?\n/)
    const rsLines: string[] = [
      'use linden_engine::prelude::*;',
      '',
      `#[derive(Default)]`,
      `pub struct ${structName} {`,
      '}',
      '',
      `#[linden_script]`,
      `impl ${structName} {`,
    ]

    for (const rawLine of lines) {
      const trimmed = rawLine.trim()
      if (trimmed.startsWith('onInit(')) {
        rsLines.push('    pub fn init(&mut self, ctx: &mut Context) {\n    }')
      } else if (trimmed.startsWith('onUpdate(')) {
        rsLines.push('    pub fn update(&mut self, ctx: &mut Context, dt: f32) {\n    }')
      } else if (trimmed.startsWith('onFixedUpdate(')) {
        rsLines.push('    pub fn fixed_update(&mut self, ctx: &mut Context, dt: f32) {\n    }')
      }
    }

    rsLines.push('}')
    return rsLines.join('\n')
  }
}
