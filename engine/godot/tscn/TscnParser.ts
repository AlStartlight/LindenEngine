/**
 * Godot .tscn and .tres Parser
 * Parses text-based scene and resource files into an AST.
 */

import { parseVariant, GodotExtResource, GodotSubResource } from './Variant'
import type { GodotSceneIR, GodotNodeIR, GodotValue } from '../../../shared/godotBridgeTypes'

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
  instancePath?: string
  scriptPath?: string
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

/**
 * True when a property value has no open string literal and balanced brackets,
 * i.e. the value does not continue on the next line.
 */
export function isValueComplete(value: string): boolean {
  let inString = false
  let depth = 0
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (inString) {
      if (ch === '\\') {
        i++
      } else if (ch === '"') {
        inString = false
      }
    } else if (ch === '"') {
      inString = true
    } else if (ch === '(' || ch === '[' || ch === '{') {
      depth++
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--
    }
  }
  return !inString && depth <= 0
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
      if (eqIdx !== -1) {
        const key = line.slice(0, eqIdx).trim()
        let rawVal = line.slice(eqIdx + 1).trim()

        // Values may span several lines (multi-line strings, arrays, dictionaries).
        // Continuation lines are raw value text, never section headers, even when they start with "[".
        while (!isValueComplete(rawVal) && i + 1 < lines.length) {
          i++
          rawVal += '\n' + lines[i]
        }

        if (!currentSection) continue
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

    // Resolve ext_resources for instance and script
    const extMap = new Map<string, string>()
    for (const r of doc.extResources) {
      extMap.set(r.id, r.path)
    }

    for (const node of doc.nodes) {
      if (node.instance && node.instance instanceof GodotExtResource) {
        node.instancePath = extMap.get(node.instance.id)
      }
      if (node.properties['script'] && node.properties['script'] instanceof GodotExtResource) {
        node.scriptPath = extMap.get(node.properties['script'].id)
      }
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

function variantToGodotValue(val: any, extMap: Map<string, string>): GodotValue {
  if (val === null || val === undefined) return null
  if (typeof val === 'boolean' || typeof val === 'number' || typeof val === 'string') return val

  if (val instanceof GodotExtResource) {
    return {
      $t: 'Resource',
      type: 'Resource',
      path: extMap.get(val.id) || val.id,
    }
  }

  if (val instanceof GodotSubResource) {
    return {
      $t: 'Resource',
      type: 'SubResource',
      path: val.id,
    }
  }

  if (val.basis && val.origin) {
    return {
      $t: 'Transform3D',
      basis: val.basis,
      origin: [val.origin.x ?? 0, val.origin.y ?? 0, val.origin.z ?? 0],
    }
  }

  if (typeof val.x === 'number' && typeof val.y === 'number' && typeof val.z === 'number') {
    return { $t: 'Vector3', v: [val.x, val.y, val.z] }
  }

  if (typeof val.x === 'number' && typeof val.y === 'number') {
    return { $t: 'Vector2', v: [val.x, val.y] }
  }

  if (typeof val.r === 'number' && typeof val.g === 'number' && typeof val.b === 'number') {
    return { $t: 'Color', v: [val.r, val.g, val.b, val.a ?? 1] }
  }

  if (Array.isArray(val)) {
    return val.map((item) => variantToGodotValue(item, extMap))
  }

  if (typeof val === 'object') {
    const res: Record<string, GodotValue> = {}
    for (const [k, v] of Object.entries(val)) {
      res[k] = variantToGodotValue(v, extMap)
    }
    return res
  }

  return String(val)
}

export function tscnDocumentToSceneIR(doc: TscnDocument, scenePath: string): GodotSceneIR {
  const extMap = new Map<string, string>()
  for (const r of doc.extResources) {
    extMap.set(r.id, r.path)
  }

  const nodes: GodotNodeIR[] = []
  for (let idx = 0; idx < doc.nodes.length; idx++) {
    const n = doc.nodes[idx]
    let nodePath = '.'
    if (idx > 0) {
      if (!n.parent || n.parent === '.') {
        nodePath = n.name
      } else {
        nodePath = `${n.parent}/${n.name}`
      }
    }

    let instancePath = n.instancePath
    if (!instancePath && n.instance) {
      if (typeof n.instance === 'string') {
        instancePath = n.instance
      } else if (n.instance instanceof GodotExtResource && extMap.has(n.instance.id)) {
        instancePath = extMap.get(n.instance.id)
      }
    }

    let scriptPath = n.scriptPath
    if (!scriptPath && n.properties['script']) {
      const s = n.properties['script']
      if (typeof s === 'string') {
        scriptPath = s
      } else if (s instanceof GodotExtResource && extMap.has(s.id)) {
        scriptPath = extMap.get(s.id)
      }
    }

    const props: Record<string, GodotValue> = {}
    for (const [k, v] of Object.entries(n.properties)) {
      props[k] = variantToGodotValue(v, extMap)
    }

    nodes.push({
      path: nodePath,
      name: n.name,
      type: n.type || 'Node',
      instance: instancePath,
      script: scriptPath,
      groups: n.groups || [],
      props,
    })
  }

  return {
    path: scenePath,
    inheritsFrom: null,
    nodes,
    connections: doc.connections.map((c) => ({
      from: c.from,
      signal: c.signal,
      to: c.to,
      method: c.method,
      flags: c.flags || 0,
    })),
    source: 'ts-parser',
  }
}

