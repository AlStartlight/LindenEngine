/**
 * Godot .tscn and .tres Parser
 * Parses text-based scene and resource files into an AST.
 */

import { parseVariant } from './Variant'

export interface TscnDescriptor {
  type: 'gd_scene' | 'gd_resource'
  attributes: Record<string, any>
}

export interface TscnExtResource {
  type: string
  path: string
  id: string
  uid?: string
}

export interface TscnSubResource {
  type: string
  id: string
  properties: Record<string, any>
}

export interface TscnNode {
  name: string
  type?: string
  parent?: string
  instance?: any
  groups?: string[]
  properties: Record<string, any>
}

export interface TscnConnection {
  signal: string
  from: string
  to: string
  method: string
  flags?: number
}

export interface TscnDocument {
  descriptor: TscnDescriptor
  extResources: TscnExtResource[]
  subResources: TscnSubResource[]
  nodes: TscnNode[]
  connections: TscnConnection[]
}

export class TscnParserError extends Error {
  constructor(message: string, public readonly line: number) {
    super(`Line ${line}: ${message}`)
    this.name = 'TscnParserError'
  }
}

export class TscnParser {
  parse(source: string): TscnDocument {
    const lines = source.split(/\r?\n/)
    const doc: TscnDocument = {
      descriptor: { type: 'gd_scene', attributes: {} },
      extResources: [],
      subResources: [],
      nodes: [],
      connections: [],
    }

    let currentSection:
      | { type: 'descriptor' }
      | { type: 'ext_resource'; res: TscnExtResource }
      | { type: 'sub_resource'; res: TscnSubResource }
      | { type: 'node'; node: TscnNode }
      | { type: 'connection' }
      | null = null

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1
      const line = lines[i].trim()

      if (!line || line.startsWith(';')) {
        continue
      }

      // Section header: [tag attr="val" ...]
      if (line.startsWith('[')) {
        if (!line.endsWith(']')) {
          throw new TscnParserError(`Malformed section header: missing closing bracket`, lineNum)
        }

        const inner = line.slice(1, -1).trim()
        const spaceIdx = inner.indexOf(' ')
        const tag = spaceIdx === -1 ? inner : inner.slice(0, spaceIdx)
        const attrStr = spaceIdx === -1 ? '' : inner.slice(spaceIdx + 1)
        const attrs = this.parseAttributes(attrStr, lineNum)

        if (tag === 'gd_scene' || tag === 'gd_resource') {
          doc.descriptor = {
            type: tag,
            attributes: attrs,
          }
          currentSection = { type: 'descriptor' }
        } else if (tag === 'ext_resource') {
          if (!attrs.id) {
            throw new TscnParserError(`ext_resource missing id attribute`, lineNum)
          }
          const extRes: TscnExtResource = {
            type: attrs.type || '',
            path: attrs.path || '',
            id: String(attrs.id),
            uid: attrs.uid,
          }
          doc.extResources.push(extRes)
          currentSection = { type: 'ext_resource', res: extRes }
        } else if (tag === 'sub_resource') {
          if (!attrs.id) {
            throw new TscnParserError(`sub_resource missing id attribute`, lineNum)
          }
          const subRes: TscnSubResource = {
            type: attrs.type || '',
            id: String(attrs.id),
            properties: {},
          }
          doc.subResources.push(subRes)
          currentSection = { type: 'sub_resource', res: subRes }
        } else if (tag === 'node') {
          if (!attrs.name) {
            throw new TscnParserError(`node missing name attribute`, lineNum)
          }
          let groups: string[] | undefined = undefined
          if (attrs.groups) {
            try {
              const parsed = parseVariant(attrs.groups)
              if (Array.isArray(parsed)) {
                groups = parsed.map(String)
              }
            } catch {}
          }
          const node: TscnNode = {
            name: attrs.name,
            type: attrs.type,
            parent: attrs.parent,
            instance: attrs.instance ? parseVariant(attrs.instance) : undefined,
            groups,
            properties: {},
          }
          doc.nodes.push(node)
          currentSection = { type: 'node', node }
        } else if (tag === 'connection') {
          if (!attrs.signal || !attrs.from || !attrs.to || !attrs.method) {
            throw new TscnParserError(`connection missing required attributes (signal, from, to, method)`, lineNum)
          }
          doc.connections.push({
            signal: attrs.signal,
            from: attrs.from,
            to: attrs.to,
            method: attrs.method,
            flags: attrs.flags ? parseInt(attrs.flags, 10) : undefined,
          })
          currentSection = { type: 'connection' }
        } else {
          // Unknown or custom section
          currentSection = null
        }
        continue
      }

      // Property line: key = value
      const eqIdx = line.indexOf('=')
      if (eqIdx !== -1 && currentSection) {
        const key = line.slice(0, eqIdx).trim()
        const rawVal = line.slice(eqIdx + 1).trim()
        const parsedVal = parseVariant(rawVal)

        if (currentSection.type === 'node') {
          currentSection.node.properties[key] = parsedVal
        } else if (currentSection.type === 'sub_resource') {
          currentSection.res.properties[key] = parsedVal
        }
      }
    }

    if (!doc.descriptor || !doc.descriptor.type) {
      throw new TscnParserError(`Missing [gd_scene] or [gd_resource] header`, 1)
    }

    return doc
  }

  private parseAttributes(str: string, lineNum: number): Record<string, string> {
    const attrs: Record<string, string> = {}
    if (!str.trim()) return attrs

    // Regex match key=value where value is "...", '...', [...], or identifier
    const regex = /([a-zA-Z0-9_]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\[[^\]]*\])|([^\s]+))/g
    let match: RegExpExecArray | null
    let matchedAny = false

    while ((match = regex.exec(str)) !== null) {
      matchedAny = true
      const key = match[1]
      const val = match[2] ?? match[3] ?? match[4] ?? match[5]
      attrs[key] = val
    }

    if (!matchedAny && str.trim().length > 0) {
      throw new TscnParserError(`Malformed attributes in section: "${str}"`, lineNum)
    }

    return attrs
  }
}
