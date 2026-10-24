/**
 * Godot Variant Types and Serializer / Deserializer
 * Handles Godot 4.x Variant formats for .tscn / .tres files.
 */

export interface Vector2Value {
  x: number
  y: number
}

export interface Vector3Value {
  x: number
  y: number
  z: number
}

export interface Vector4Value {
  x: number
  y: number
  z: number
  w: number
}

export interface ColorValue {
  r: number
  g: number
  b: number
  a: number
}

export interface Transform3DValue {
  // Basis matrix (3x3)
  basis: [
    number, number, number, // xx, xy, xz
    number, number, number, // yx, yy, yz
    number, number, number  // zx, zy, zz
  ]
  // Origin vector
  origin: Vector3Value
}

export class GodotNodePath {
  constructor(public readonly path: string) {}
  toString(): string {
    return `NodePath("${this.path}")`
  }
}

export class GodotExtResource {
  constructor(public readonly id: string) {}
  toString(): string {
    return `ExtResource("${this.id}")`
  }
}

export class GodotSubResource {
  constructor(public readonly id: string) {}
  toString(): string {
    return `SubResource("${this.id}")`
  }
}

/**
 * Clean floating point output for determinism
 */
export function formatFloat(n: number): string {
  if (Object.is(n, -0)) n = 0
  if (Number.isInteger(n)) return n.toString()
  const str = n.toFixed(6)
  // Strip trailing zeros after decimal point
  const trimmed = str.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '')
  return trimmed === '-0' ? '0' : trimmed
}

/**
 * Euler angles in degrees (Linden) to Godot Transform3D
 * Linden: Euler XYZ or YXZ in degrees.
 * Standard Godot 3D rotation order is YXZ.
 */
export function eulerDegreesToTransform3D(
  pos: { x: number; y: number; z: number },
  rotDeg: { x: number; y: number; z: number },
  scale: { x: number; y: number; z: number } = { x: 1, y: 1, z: 1 }
): Transform3DValue {
  const radX = (rotDeg.x * Math.PI) / 180
  const radY = (rotDeg.y * Math.PI) / 180
  const radZ = (rotDeg.z * Math.PI) / 180

  const cx = Math.cos(radX)
  const sx = Math.sin(radX)
  const cy = Math.cos(radY)
  const sy = Math.sin(radY)
  const cz = Math.cos(radZ)
  const sz = Math.sin(radZ)

  // Rotation matrix YXZ: R = Ry * Rx * Rz
  // Ry:
  // [ cy  0  sy ]
  // [  0  1   0 ]
  // [-sy  0  cy ]
  // Rx:
  // [ 1   0   0 ]
  // [ 0  cx -sx ]
  // [ 0  sx  cx ]
  // Rz:
  // [ cz -sz  0 ]
  // [ sz  cz  0 ]
  // [  0   0  1 ]

  const r00 = (cy * cz + sy * sx * sz) * scale.x
  const r01 = (-cy * sz + sy * sx * cz) * scale.y
  const r02 = (sy * cx) * scale.z

  const r10 = (cx * sz) * scale.x
  const r11 = (cx * cz) * scale.y
  const r12 = (-sx) * scale.z

  const r20 = (-sy * cz + cy * sx * sz) * scale.x
  const r21 = (sy * sz + cy * sx * cz) * scale.y
  const r22 = (cy * cx) * scale.z

  return {
    basis: [r00, r01, r02, r10, r11, r12, r20, r21, r22],
    origin: { x: pos.x, y: pos.y, z: pos.z }
  }
}

/**
 * Godot Transform3D to Euler degrees (Linden)
 */
export function transform3DToEulerDegrees(transform: Transform3DValue): {
  position: Vector3Value
  rotation: Vector3Value
  scale: Vector3Value
} {
  const [b00, b01, b02, b10, b11, b12, b20, b21, b22] = transform.basis

  // Extract scale from column norms
  const sx = Math.hypot(b00, b10, b20)
  const sy = Math.hypot(b01, b11, b21)
  const sz = Math.hypot(b02, b12, b22)

  // Normalize basis for rotation
  const invSx = sx !== 0 ? 1 / sx : 1
  const invSy = sy !== 0 ? 1 / sy : 1
  const invSz = sz !== 0 ? 1 / sz : 1

  const r00 = b00 * invSx
  const r01 = b01 * invSy
  const r02 = b02 * invSz

  const r10 = b10 * invSx
  const r11 = b11 * invSy
  const r12 = b12 * invSz

  const r20 = b20 * invSx
  const r21 = b21 * invSy
  const r22 = b22 * invSz

  // Decompose YXZ:
  // r12 = -sin(x)
  let rotX = 0
  let rotY = 0
  let rotZ = 0

  if (Math.abs(r12) < 0.999999) {
    rotX = Math.asin(-Math.max(-1, Math.min(1, r12)))
    rotY = Math.atan2(r02, r22)
    rotZ = Math.atan2(r10, r11)
  } else {
    // Gimbal lock
    rotX = r12 < 0 ? Math.PI / 2 : -Math.PI / 2
    rotY = Math.atan2(-r20, r00)
    rotZ = 0
  }

  return {
    position: {
      x: transform.origin.x,
      y: transform.origin.y,
      z: transform.origin.z
    },
    rotation: {
      x: (rotX * 180) / Math.PI,
      y: (rotY * 180) / Math.PI,
      z: (rotZ * 180) / Math.PI
    },
    scale: { x: sx, y: sy, z: sz }
  }
}

/**
 * Format any value into Godot .tscn variant string
 */
export function formatVariant(val: any): string {
  if (val === null || val === undefined) return 'null'
  if (typeof val === 'boolean') return val ? 'true' : 'false'
  if (typeof val === 'number') return formatFloat(val)
  if (typeof val === 'string') return JSON.stringify(val)

  if (val instanceof GodotNodePath || val instanceof GodotExtResource || val instanceof GodotSubResource) {
    return val.toString()
  }

  // Vector2
  if (typeof val.x === 'number' && typeof val.y === 'number' && val.z === undefined) {
    return `Vector2(${formatFloat(val.x)}, ${formatFloat(val.y)})`
  }

  // Vector3
  if (typeof val.x === 'number' && typeof val.y === 'number' && typeof val.z === 'number' && val.w === undefined) {
    return `Vector3(${formatFloat(val.x)}, ${formatFloat(val.y)}, ${formatFloat(val.z)})`
  }

  // Vector4
  if (typeof val.x === 'number' && typeof val.y === 'number' && typeof val.z === 'number' && typeof val.w === 'number') {
    return `Vector4(${formatFloat(val.x)}, ${formatFloat(val.y)}, ${formatFloat(val.z)}, ${formatFloat(val.w)})`
  }

  // Color
  if (typeof val.r === 'number' && typeof val.g === 'number' && typeof val.b === 'number') {
    const a = typeof val.a === 'number' ? val.a : 1
    return `Color(${formatFloat(val.r)}, ${formatFloat(val.g)}, ${formatFloat(val.b)}, ${formatFloat(a)})`
  }

  // Transform3D
  if (val.basis && Array.isArray(val.basis) && val.origin) {
    const b = val.basis.map(formatFloat)
    const o = [val.origin.x, val.origin.y, val.origin.z].map(formatFloat)
    return `Transform3D(${b.join(', ')}, ${o.join(', ')})`
  }

  // Array
  if (Array.isArray(val)) {
    return `[${val.map(formatVariant).join(', ')}]`
  }

  // Dictionary
  if (typeof val === 'object') {
    // Sort keys for determinism
    const keys = Object.keys(val).sort()
    const entries = keys.map((k) => `"${k}": ${formatVariant(val[k])}`)
    return `{${entries.join(', ')}}`
  }

  return String(val)
}

/**
 * Tokenizer / Parser for Godot Variant literals in .tscn files
 */
export function parseVariant(input: string): any {
  const trimmed = input.trim()

  if (trimmed === 'null') return null
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false

  // Number
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)) {
    return parseFloat(trimmed)
  }

  // String
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try {
      // Godot writes multi-line strings with raw newlines, which JSON does not allow
      return JSON.parse(trimmed.replace(/\r?\n/g, '\\n').replace(/\t/g, '\\t'))
    } catch {
      return trimmed.slice(1, -1)
    }
  }

  // ExtResource("id")
  const extMatch = trimmed.match(/^ExtResource\(\s*["']?([^"')]+)["']?\s*\)$/)
  if (extMatch) return new GodotExtResource(extMatch[1])

  // SubResource("id")
  const subMatch = trimmed.match(/^SubResource\(\s*["']?([^"')]+)["']?\s*\)$/)
  if (subMatch) return new GodotSubResource(subMatch[1])

  // NodePath("path")
  const npMatch = trimmed.match(/^NodePath\(\s*["']([^"']*)["']\s*\)$/)
  if (npMatch) return new GodotNodePath(npMatch[1])

  // Vector2(x, y)
  const v2Match = trimmed.match(/^Vector2\(([^)]+)\)$/)
  if (v2Match) {
    const parts = splitArgs(v2Match[1]).map(Number)
    return { x: parts[0], y: parts[1] }
  }

  // Vector3(x, y, z)
  const v3Match = trimmed.match(/^Vector3\(([^)]+)\)$/)
  if (v3Match) {
    const parts = splitArgs(v3Match[1]).map(Number)
    return { x: parts[0], y: parts[1], z: parts[2] }
  }

  // Vector4(x, y, z, w)
  const v4Match = trimmed.match(/^Vector4\(([^)]+)\)$/)
  if (v4Match) {
    const parts = splitArgs(v4Match[1]).map(Number)
    return { x: parts[0], y: parts[1], z: parts[2], w: parts[3] }
  }

  // Color(r, g, b, a)
  const colMatch = trimmed.match(/^Color\(([^)]+)\)$/)
  if (colMatch) {
    const parts = splitArgs(colMatch[1]).map(Number)
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 }
  }

  // Transform3D(b0, b1, ... b8, ox, oy, oz)
  const t3Match = trimmed.match(/^Transform3D\(([^)]+)\)$/)
  if (t3Match) {
    const parts = splitArgs(t3Match[1]).map(Number)
    if (parts.length === 12) {
      return {
        basis: parts.slice(0, 9) as [number, number, number, number, number, number, number, number, number],
        origin: { x: parts[9], y: parts[10], z: parts[11] }
      }
    }
  }

  // Array [...]
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim()
    if (!inner) return []
    const items = splitArgs(inner)
    return items.map(parseVariant)
  }

  // Dictionary {...}
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const inner = trimmed.slice(1, -1).trim()
    if (!inner) return {}
    const entries = splitArgs(inner)
    const dict: Record<string, any> = {}
    for (const entry of entries) {
      const colonIdx = entry.indexOf(':')
      if (colonIdx !== -1) {
        const k = parseVariant(entry.slice(0, colonIdx).trim())
        const v = parseVariant(entry.slice(colonIdx + 1).trim())
        dict[String(k)] = v
      }
    }
    return dict
  }

  return trimmed
}

/**
 * Split arguments respecting parentheses, brackets, and quotes
 */
function splitArgs(str: string): string[] {
  const result: string[] = []
  let depth = 0
  let inQuote = false
  let quoteChar = ''
  let current = ''

  for (let i = 0; i < str.length; i++) {
    const char = str[i]
    if (inQuote) {
      current += char
      if (char === quoteChar && str[i - 1] !== '\\') {
        inQuote = false
      }
    } else if (char === '"' || char === "'") {
      inQuote = true
      quoteChar = char
      current += char
    } else if (char === '(' || char === '[' || char === '{') {
      depth++
      current += char
    } else if (char === ')' || char === ']' || char === '}') {
      depth--
      current += char
    } else if (char === ',' && depth === 0) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim().length > 0) {
    result.push(current.trim())
  }
  return result
}
