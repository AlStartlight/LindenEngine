import { SourceMapLookup, findScriptFrame, normalizeMappedSource, RawSourceMap } from '../shared/sourceMap'
import { COMPILED_SCRIPTS_DIR } from '../shared/playProtocol'

const lookups = new Map<string, Promise<SourceMapLookup | null>>()

function loadLookup(scriptUrl: string): Promise<SourceMapLookup | null> {
  let p = lookups.get(scriptUrl)
  if (!p) {
    p = fetch(`${scriptUrl}.map`)
      .then((res) => (res.ok ? (res.json() as Promise<RawSourceMap>) : null))
      .then((map) => (map ? new SourceMapLookup(map) : null))
      .catch(() => null)
    lookups.set(scriptUrl, p)
  }
  return p
}

/** Recompiled scripts come with new maps */
export function resetSourceMapCache(): void {
  lookups.clear()
}

/**
 * Map an error thrown by a compiled game script back to the original scripts/*.ts location,
 * using the .map file the Play session serves next to the script.
 */
export async function mapScriptErrorLocation(error: unknown): Promise<{ file: string; line: number; col: number } | null> {
  const stack = (error as any)?.stack
  if (typeof stack !== 'string') return null
  const frame = findScriptFrame(stack, `/${COMPILED_SCRIPTS_DIR}/`)
  if (!frame) return null
  const lookup = await loadLookup(frame.url)
  const pos = lookup?.originalPositionFor(frame.line, frame.col)
  if (!pos) {
    const rel = frame.url.slice(frame.url.indexOf(`/${COMPILED_SCRIPTS_DIR}/`) + 1)
    return { file: rel, line: frame.line, col: frame.col }
  }
  return { file: normalizeMappedSource(pos.source), line: pos.line, col: pos.col }
}
