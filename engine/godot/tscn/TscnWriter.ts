/**
 * Godot .tscn and .tres Writer
 * Deterministic serializer generating byte-stable text output.
 */

import { formatVariant } from './Variant'
import { TscnDocument, TscnNode, TscnSubResource, TscnExtResource } from './TscnParser'

const INVALID_NODE_CHARS = /[.:@/"%]/g

export function sanitizeNodeName(name: string): { sanitized: string; original: string; changed: boolean } {
  const sanitized = name.replace(INVALID_NODE_CHARS, '_')
  return {
    sanitized: sanitized || 'Node3D',
    original: name,
    changed: sanitized !== name,
  }
}

export class TscnWriter {
  write(doc: TscnDocument): string {
    const lines: string[] = []

    // 1. Descriptor header
    const descAttrs: string[] = []
    // Deterministic attribute order: load_steps, format, uid, then alphabetically
    const attrKeys = Object.keys(doc.descriptor.attributes).sort((a, b) => {
      const order = ['load_steps', 'format', 'uid']
      const idxA = order.indexOf(a)
      const idxB = order.indexOf(b)
      if (idxA !== -1 && idxB !== -1) return idxA - idxB
      if (idxA !== -1) return -1
      if (idxB !== -1) return 1
      return a.localeCompare(b)
    })

    for (const k of attrKeys) {
      const val = doc.descriptor.attributes[k]
      if (typeof val === 'number') {
        descAttrs.push(`${k}=${val}`)
      } else {
        descAttrs.push(`${k}="${val}"`)
      }
    }

    lines.push(`[${doc.descriptor.type}${descAttrs.length ? ' ' + descAttrs.join(' ') : ''}]`)
    lines.push('')

    // 2. ExtResources (sorted by id)
    const sortedExt = [...doc.extResources].sort((a, b) => a.id.localeCompare(b.id))
    for (const ext of sortedExt) {
      const attrs = [`type="${ext.type}"`]
      if (ext.uid) attrs.push(`uid="${ext.uid}"`)
      attrs.push(`path="${ext.path}"`)
      attrs.push(`id="${ext.id}"`)
      lines.push(`[ext_resource ${attrs.join(' ')}]`)
      lines.push('')
    }

    // 3. SubResources (sorted by id)
    const sortedSub = [...doc.subResources].sort((a, b) => a.id.localeCompare(b.id))
    for (const sub of sortedSub) {
      lines.push(`[sub_resource type="${sub.type}" id="${sub.id}"]`)
      const propKeys = Object.keys(sub.properties).sort()
      for (const k of propKeys) {
        lines.push(`${k} = ${formatVariant(sub.properties[k])}`)
      }
      lines.push('')
    }

    // 4. Nodes (in document order)
    for (const node of doc.nodes) {
      const attrs: string[] = [`name="${node.name}"`]
      if (node.type) attrs.push(`type="${node.type}"`)
      if (node.parent) attrs.push(`parent="${node.parent}"`)
      if (node.instance) attrs.push(`instance=${formatVariant(node.instance)}`)

      lines.push(`[node ${attrs.join(' ')}]`)
      const propKeys = Object.keys(node.properties).sort()
      for (const k of propKeys) {
        lines.push(`${k} = ${formatVariant(node.properties[k])}`)
      }
      lines.push('')
    }

    // 5. Connections (sorted by from, signal, to, method)
    const sortedConn = [...doc.connections].sort((a, b) => {
      const ka = `${a.from}:${a.signal}:${a.to}:${a.method}`
      const kb = `${b.from}:${b.signal}:${b.to}:${b.method}`
      return ka.localeCompare(kb)
    })
    for (const conn of sortedConn) {
      const attrs = [
        `signal="${conn.signal}"`,
        `from="${conn.from}"`,
        `to="${conn.to}"`,
        `method="${conn.method}"`,
      ]
      if (conn.flags !== undefined) {
        attrs.push(`flags=${conn.flags}`)
      }
      lines.push(`[connection ${attrs.join(' ')}]`)
      lines.push('')
    }

    // Ensure trailing newline
    return lines.join('\n').trimEnd() + '\n'
  }
}
