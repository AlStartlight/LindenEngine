/**
 * Material Mapping: Linden PBR Material <-> Godot StandardMaterial3D / ShaderMaterial
 */

import { ColorValue, formatVariant } from '../tscn/Variant'

export interface LindenMaterialData {
  name?: string
  color?: string | ColorValue
  roughness?: number
  metallic?: number
  metalness?: number
  albedoTexture?: string
  normalTexture?: string
  isCustomShader?: boolean
  shaderCode?: string
}

export function parseHexColor(hex: string): ColorValue {
  let cleaned = hex.replace('#', '')
  if (cleaned.length === 3) {
    cleaned = cleaned.split('').map((c) => c + c).join('')
  }
  const num = parseInt(cleaned, 16)
  const r = ((num >> 16) & 255) / 255
  const g = ((num >> 8) & 255) / 255
  const b = (num & 255) / 255
  return { r, g, b, a: 1 }
}

export class MaterialMap {
  /**
   * Convert Linden material properties to Godot StandardMaterial3D sub_resource properties
   */
  static toGodotStandardMaterial(mat: LindenMaterialData): Record<string, any> {
    const props: Record<string, any> = {}

    // Albedo color
    if (mat.color) {
      if (typeof mat.color === 'string') {
        props['albedo_color'] = parseHexColor(mat.color)
      } else {
        props['albedo_color'] = mat.color
      }
    } else {
      props['albedo_color'] = { r: 1, g: 1, b: 1, a: 1 }
    }

    // Metallic
    const metallic = mat.metallic ?? mat.metalness ?? 0
    props['metallic'] = metallic

    // Roughness
    const roughness = mat.roughness ?? 0.5
    props['roughness'] = roughness

    return props
  }

  /**
   * Convert Godot StandardMaterial3D properties to Linden material data
   */
  static fromGodotStandardMaterial(props: Record<string, any>): LindenMaterialData {
    const color = props['albedo_color'] ?? { r: 1, g: 1, b: 1, a: 1 }
    const metallic = props['metallic'] ?? 0
    const roughness = props['roughness'] ?? 0.5

    return {
      color,
      metallic,
      roughness,
    }
  }

  /**
   * Generates .gdshader code from a custom Linden shader graph
   */
  static toGdShader(shaderName: string, uniformDefs: string[] = [], fragmentLogic: string = ''): string {
    return `shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

${uniformDefs.join('\n')}

void fragment() {
    ${fragmentLogic || 'ALBEDO = vec3(1.0);'}
}
`
  }
}
