/**
 * Unity YAML Parser (TC-TR-04, TC-TR-06, TC-TR-08)
 *
 * Parses multi-document Unity YAML files (GameObject, Transform, etc.)
 * with billion-laughs / anchor-bomb security guards.
 */

export interface UnityDocument {
  classId: number
  fileId: string
  tag: string
  content: Record<string, any>
}

export class UnityYamlParserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnityYamlParserError'
  }
}

export class UnityYamlParser {
  private static readonly MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB
  private static readonly MAX_DOCUMENTS = 50000
  private static readonly MAX_ANCHOR_EXPANSIONS = 100

  parse(yamlText: string): UnityDocument[] {
    if (yamlText.length > UnityYamlParser.MAX_FILE_SIZE) {
      throw new UnityYamlParserError('File exceeds maximum allowable size')
    }

    // Check for Unity binary serialization
    if (yamlText.includes('\u0000') || (!yamlText.includes('%TAG !u!') && !yamlText.includes('--- !u!'))) {
      if (!yamlText.trim().startsWith('---')) {
        throw new UnityYamlParserError('ubah Asset Serialization ke Force Text')
      }
    }

    const docs: UnityDocument[] = []
    const docSplits = yamlText.split(/\r?\n--- !u!/)
    let anchorExpansions = 0

    for (let i = 0; i < docSplits.length; i++) {
      if (docs.length >= UnityYamlParser.MAX_DOCUMENTS) {
        throw new UnityYamlParserError('Excessive number of YAML documents (potential DoS)')
      }

      const segment = docSplits[i].trim()
      if (!segment || segment.startsWith('%YAML') || segment.startsWith('%TAG')) {
        continue
      }

      // Format: <classId> &<fileId>\n<key>:\n...
      const firstLineEnd = segment.indexOf('\n')
      const header = firstLineEnd === -1 ? segment : segment.substring(0, firstLineEnd).trim()
      const body = firstLineEnd === -1 ? '' : segment.substring(firstLineEnd + 1)

      const headerMatch = header.match(/^(\d+)\s+&([a-zA-Z0-9_\-]+)/)
      const classId = headerMatch ? parseInt(headerMatch[1], 10) : 0
      const fileId = headerMatch ? headerMatch[2] : `doc_${i}`

      // Check anchor safety
      const anchorCount = (segment.match(/\*[a-zA-Z0-9_]+/g) || []).length
      anchorExpansions += anchorCount
      if (anchorExpansions > UnityYamlParser.MAX_ANCHOR_EXPANSIONS) {
        throw new UnityYamlParserError('Excessive YAML anchor alias expansions detected')
      }

      const parsedContent = this.parseSimpleYamlBody(body)
      docs.push({
        classId,
        fileId,
        tag: `!u!${classId}`,
        content: parsedContent,
      })
    }

    return docs
  }

  private parseSimpleYamlBody(text: string): Record<string, any> {
    const result: Record<string, any> = {}
    const lines = text.split(/\r?\n/)
    let topSection: Record<string, any> | null = null

    for (const line of lines) {
      if (!line.trim() || line.trim().startsWith('#')) continue

      const isIndented = /^\s+/.test(line)
      const trimmed = line.trim()
      const colonIdx = trimmed.indexOf(':')
      if (colonIdx === -1) continue

      const key = trimmed.substring(0, colonIdx).trim()
      const rawVal = trimmed.substring(colonIdx + 1).trim()

      if (!isIndented) {
        // Top level section e.g. "GameObject:" or "Transform:"
        if (rawVal.length === 0) {
          const sectionObj: Record<string, any> = {}
          result[key] = sectionObj
          topSection = sectionObj
        } else {
          result[key] = this.parseScalarOrRef(rawVal)
          topSection = null
        }
      } else {
        // Inside section
        const target = topSection || result
        if (rawVal.length === 0) {
          target[key] = {}
        } else {
          target[key] = this.parseScalarOrRef(rawVal)
        }
      }
    }

    return result
  }

  private parseScalarOrRef(raw: string): any {
    // Check Unity fileID/guid ref: {fileID: 12345, guid: abcdef, type: 3}
    if (raw.startsWith('{') && raw.endsWith('}')) {
      const inner = raw.slice(1, -1).trim()
      const ref: Record<string, any> = {}
      const pairs = inner.split(',')
      for (const p of pairs) {
        const [k, v] = p.split(':').map((s) => s.trim())
        if (k && v !== undefined) {
          ref[k] = isNaN(Number(v)) ? v : Number(v)
        }
      }
      return ref
    }

    if (raw === 'true') return true
    if (raw === 'false') return false
    if (raw === 'null') return null
    if (!isNaN(Number(raw))) return Number(raw)

    return raw.replace(/^["']|["']$/g, '')
  }
}
