import fs from 'node:fs'
import path from 'node:path'
import type { ToolDefinition } from './index'
import { isValidScriptSrc } from '../../../shared/playProtocol'

/**
 * Block-level script patching (SPEC-DSH-MCP-Agent-Integration P4, "AST micro-diff").
 *
 * Instead of rewriting a whole script, replace/delete/insert one class, function or
 * method block, found by name with brace matching that skips strings and comments.
 * TypeScript/JavaScript only; GDScript/C#/Rust keep using linden_script_write.
 */

interface Block {
  kind: 'class' | 'function' | 'method'
  name: string
  className?: string
  start: number
  end: number
  bodyStart: number
  bodyEnd: number
  indent: string
}

const RESERVED = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'function',
  'return',
  'super',
  'await',
  'typeof',
  'do',
  'else',
  'try',
  'finally',
  'with',
  'new',
])

function safeJoin(projectPath: string, rel: string): string {
  const base = path.resolve(projectPath)
  const full = path.resolve(projectPath, rel)
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error(`Path di luar proyek: ${rel}`)
  return full
}

function skipString(src: string, i: number): number {
  const quote = src[i]
  let j = i + 1
  while (j < src.length) {
    if (src[j] === '\\') {
      j += 2
      continue
    }
    if (src[j] === quote) return j + 1
    j++
  }
  return j
}

function matchPair(src: string, open: number): number {
  const openChar = src[open]
  const closeChar = openChar === '{' ? '}' : ')'
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i)
      i = nl === -1 ? src.length : nl
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2)
      i = close === -1 ? src.length : close + 1
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(src, i) - 1
      continue
    }
    if (c === openChar) depth++
    else if (c === closeChar) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function balanced(src: string): boolean {
  let balance = 0
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i)
      i = nl === -1 ? src.length : nl
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2)
      i = close === -1 ? src.length : close + 1
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(src, i) - 1
      continue
    }
    if (c === '{') balance++
    else if (c === '}') {
      balance--
      if (balance < 0) return false
    }
  }
  return balance === 0
}

function lineStart(src: string, index: number): number {
  const nl = src.lastIndexOf('\n', index)
  return nl === -1 ? 0 : nl + 1
}

function indentOf(src: string, start: number): string {
  const line = src.slice(start, src.indexOf('\n', start) === -1 ? src.length : src.indexOf('\n', start))
  return (line.match(/^[ \t]*/) ?? [''])[0]
}

function findClasses(src: string): Block[] {
  const blocks: Block[] = []
  const re = /^[ \t]*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const open = src.indexOf('{', m.index + m[0].length)
    if (open === -1) continue
    const bodyEnd = matchPair(src, open)
    if (bodyEnd === -1) continue
    const start = lineStart(src, m.index + (m[0].length - m[0].trimStart().length))
    blocks.push({ kind: 'class', name: m[1], start, end: bodyEnd + 1, bodyStart: open, bodyEnd, indent: indentOf(src, start) })
    re.lastIndex = bodyEnd + 1
  }
  return blocks
}

function findFunctions(src: string): Block[] {
  const blocks: Block[] = []
  const re = /^[ \t]*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const parenOpen = src.indexOf('(', m.index + m[0].length - 1)
    const parenClose = matchPair(src, parenOpen)
    if (parenClose === -1) continue
    const open = src.indexOf('{', parenClose)
    if (open === -1) continue
    if (src.slice(parenClose + 1, open).includes(';')) continue
    const bodyEnd = matchPair(src, open)
    if (bodyEnd === -1) continue
    const start = lineStart(src, m.index)
    blocks.push({ kind: 'function', name: m[1], start, end: bodyEnd + 1, bodyStart: open, bodyEnd, indent: indentOf(src, start) })
    re.lastIndex = bodyEnd + 1
  }
  return blocks
}

function findMethods(src: string, parent: Block): Block[] {
  const methods: Block[] = []
  let cursor = parent.bodyStart + 1
  while (cursor < parent.bodyEnd) {
    const nl = src.indexOf('\n', cursor)
    const lineEnd = nl === -1 ? src.length : nl
    const line = src.slice(cursor, lineEnd)
    const m = line.match(/^([ \t]*)((?:(?:public|private|protected|static|async|readonly|override|abstract|declare|get|set)\s+)*)([A-Za-z_$][\w$]*)\s*\(/)
    if (m) {
      const name = m[3]
      if (!RESERVED.has(name) && !name.startsWith('#')) {
        const nameOffset = cursor + m[1].length + m[2].length
        const parenOpen = src.indexOf('(', nameOffset)
        const parenClose = parenOpen === -1 ? -1 : matchPair(src, parenOpen)
        if (parenClose !== -1) {
          const open = src.indexOf('{', parenClose)
          if (open !== -1) {
            const between = src.slice(parenClose + 1, open)
            if (!between.includes(';') && !between.includes('=>') && open - parenClose < 400) {
              const bodyEnd = matchPair(src, open)
              if (bodyEnd !== -1) {
                methods.push({
                  kind: 'method',
                  name,
                  className: parent.name,
                  start: cursor,
                  end: bodyEnd + 1,
                  bodyStart: open,
                  bodyEnd,
                  indent: indentOf(src, cursor),
                })
                cursor = bodyEnd + 1
                continue
              }
            }
          }
        }
      }
    }
    cursor = lineEnd + 1
  }
  return methods
}

function resolveTarget(src: string, target: { kind: string; name: string; className?: string }): Block {
  const classes = findClasses(src)
  const functions = findFunctions(src)
  const methods = classes.flatMap((c) => findMethods(src, c))

  if (target.kind === 'class') {
    const block = classes.find((b) => b.name === target.name)
    if (!block) throw new Error(`Class "${target.name}" tidak ditemukan. Tersedia: ${classes.map((c) => c.name).join(', ') || '(tidak ada)'}`)
    return block
  }
  if (target.kind === 'function') {
    const block = functions.find((b) => b.name === target.name)
    if (!block) throw new Error(`Function "${target.name}" tidak ditemukan. Tersedia: ${functions.map((c) => c.name).join(', ') || '(tidak ada)'}`)
    return block
  }
  const candidates = methods.filter((b) => b.name === target.name && (!target.className || b.className === target.className))
  if (candidates.length === 1) return candidates[0]
  if (candidates.length > 1) {
    throw new Error(
      `Method "${target.name}" ada di beberapa class (${candidates.map((c) => c.className).join(', ')}); sertakan target.className`
    )
  }
  const known = methods.map((m) => `${m.className}.${m.name}`)
  throw new Error(`Method "${target.name}" tidak ditemukan. Tersedia: ${known.join(', ') || '(tidak ada)'}`)
}

function applyBlock(src: string, block: Block, op: string, code: string): string {
  const indent = block.indent
  switch (op) {
    case 'replace':
      return `${src.slice(0, block.start)}${indent}${code.trimEnd()}${src.slice(block.end)}`
    case 'delete': {
      let end = block.end
      if (src[end] === '\n') end++
      return `${src.slice(0, block.start)}${src.slice(end)}`
    }
    case 'insert-before':
      return `${src.slice(0, block.start)}${indent}${code.trimEnd()}\n${src.slice(block.start)}`
    case 'insert-after':
      return `${src.slice(0, block.end)}${code.trimEnd() ? `\n${indent}${code.trimEnd()}` : ''}${src.slice(block.end)}`
    default:
      throw new Error(`op "${op}" tidak dikenal (replace, delete, insert-before, insert-after)`)
  }
}

export const PATCH_TOOLS: Record<string, ToolDefinition> = {
  linden_script_patch: {
    name: 'linden_script_patch',
    description:
      'Patch satu blok script TypeScript/JavaScript (class, function, atau method) tanpa menulis ulang seluruh file: ' +
      'op replace/delete/insert-before/insert-after. Blok dicari dengan brace matching yang melewati string dan komentar, ' +
      'dan hasil patch divalidasi kurung kurawalnya sebelum ditulis. Untuk GDScript/C#/Rust pakai linden_script_write.',
    parameters: {
      type: 'object',
      properties: {
        scriptPath: { type: 'string', description: 'Path script di scripts/, mis. scripts/PlayerController.ts' },
        target: {
          type: 'object',
          description: 'Blok yang dipatch',
          properties: {
            kind: { type: 'string', enum: ['class', 'function', 'method'] },
            name: { type: 'string' },
            className: { type: 'string', description: 'Wajib bila nama method sama di beberapa class' },
          },
          required: ['kind', 'name'],
        },
        op: { type: 'string', enum: ['replace', 'delete', 'insert-before', 'insert-after'] },
        code: { type: 'string', description: 'Kode blok baru (untuk replace/insert; kosong untuk delete)' },
      },
      required: ['scriptPath', 'target', 'op'],
    },
    async execute(
      projectPath: string,
      args: { scriptPath: string; target: { kind: string; name: string; className?: string }; op: string; code?: string },
      options
    ) {
      try {
        const rel = String(args.scriptPath || '').replace(/\\/g, '/').replace(/^\.\//, '')
        if (!isValidScriptSrc(rel)) {
          return { success: false, error: `scriptPath harus di dalam scripts/ dan berakhiran .ts/.js (dapat: ${args.scriptPath})` }
        }
        if (!/\.(ts|tsx|js|jsx|mjs)$/i.test(rel)) {
          return { success: false, error: 'linden_script_patch hanya untuk TypeScript/JavaScript; pakai linden_script_write untuk bahasa lain' }
        }
        const full = safeJoin(projectPath, rel)
        if (!fs.existsSync(full)) return { success: false, error: `Script ${rel} tidak ditemukan` }

        const before = fs.readFileSync(full, 'utf-8')
        const block = resolveTarget(before, args.target)
        const code = args.code ?? ''
        if ((args.op === 'replace' || args.op.startsWith('insert')) && !code.trim()) {
          return { success: false, error: `op ${args.op} membutuhkan "code"` }
        }
        const after = applyBlock(before, block, args.op, code)
        if (!balanced(after)) {
          return { success: false, error: 'Patch dibatalkan: hasilnya tidak seimbang kurung kurawalnya (cek kode yang dimasukkan)' }
        }
        if (after === before) return { success: false, error: 'Tidak ada perubahan yang dihasilkan patch' }

        fs.writeFileSync(full, after, 'utf-8')
        options?.onDiff?.({
          id: `diff_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          file: rel,
          kind: 'script',
          action: 'modify',
          description: `${args.op} ${args.target.kind} ${args.target.className ? `${args.target.className}.` : ''}${args.target.name} di ${rel}`,
          before,
          after,
          status: 'applied',
        })
        return {
          success: true,
          data: {
            scriptPath: rel,
            target: { ...args.target, className: block.className },
            op: args.op,
            bytesBefore: before.length,
            bytesAfter: after.length,
            line: before.slice(0, block.start).split('\n').length,
          },
        }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  },
}
