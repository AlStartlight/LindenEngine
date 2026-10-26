/**
 * Minimal source map v3 reader: enough to map a compiled script stack frame
 * (game-scripts/Player.js:12:5) back to scripts/Player.ts. No dependencies so it
 * runs in the browser player and in the main process.
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_INDEX: Record<string, number> = {}
for (let i = 0; i < B64.length; i++) B64_INDEX[B64[i]] = i

export interface RawSourceMap {
  version: number
  sources: string[]
  mappings: string
  sourceRoot?: string
}

/** [generatedCol, sourceIndex, sourceLine, sourceCol] per segment, zero-based */
type Segment = [number, number, number, number]

function decodeVlq(str: string, pos: { i: number }): number {
  let result = 0
  let shift = 0
  for (;;) {
    const digit = B64_INDEX[str[pos.i++]]
    if (digit === undefined) throw new Error('Invalid VLQ')
    result += (digit & 31) << shift
    if (!(digit & 32)) break
    shift += 5
  }
  return result & 1 ? -(result >>> 1) : result >>> 1
}

export function decodeMappings(mappings: string): Segment[][] {
  const lines: Segment[][] = []
  let srcIdx = 0
  let srcLine = 0
  let srcCol = 0
  for (const lineStr of mappings.split(';')) {
    const line: Segment[] = []
    let genCol = 0
    if (lineStr) {
      for (const segStr of lineStr.split(',')) {
        if (!segStr) continue
        const pos = { i: 0 }
        genCol += decodeVlq(segStr, pos)
        if (pos.i < segStr.length) {
          srcIdx += decodeVlq(segStr, pos)
          srcLine += decodeVlq(segStr, pos)
          srcCol += decodeVlq(segStr, pos)
          line.push([genCol, srcIdx, srcLine, srcCol])
        }
      }
    }
    lines.push(line)
  }
  return lines
}

export class SourceMapLookup {
  private lines: Segment[][]
  private sources: string[]

  constructor(map: RawSourceMap) {
    this.lines = decodeMappings(map.mappings)
    this.sources = map.sources.map((s) => (map.sourceRoot ? `${map.sourceRoot}${s}` : s))
  }

  /** line/col are 1-based (stack trace convention); returns 1-based too */
  originalPositionFor(line: number, col: number): { source: string; line: number; col: number } | null {
    const segs = this.lines[line - 1]
    if (!segs || segs.length === 0) return null
    let best: Segment | null = null
    for (const seg of segs) {
      if (seg[0] <= col - 1) best = seg
      else break
    }
    best = best ?? segs[0]
    return { source: this.sources[best[1]], line: best[2] + 1, col: best[3] + 1 }
  }
}

/** Find the first stack frame that points into a compiled game script */
export function findScriptFrame(stack: string, marker = '/game-scripts/'): { url: string; line: number; col: number } | null {
  const re = /((?:[a-z-]+:\/\/|\/)[^\s()]*?\.js)(?:\?[^\s():]*)?:(\d+):(\d+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stack))) {
    if (m[1].includes(marker)) return { url: m[1], line: Number(m[2]), col: Number(m[3]) }
  }
  return null
}

/** Normalize a source path from a map ('../../scripts/Player.ts') to 'scripts/Player.ts' */
export function normalizeMappedSource(source: string): string {
  const norm = source.replace(/\\/g, '/')
  const idx = norm.lastIndexOf('scripts/')
  return idx >= 0 ? norm.slice(idx) : norm.replace(/^(\.\.\/)+/, '')
}
