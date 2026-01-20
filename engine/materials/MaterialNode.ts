/**
 * Material System - Node-Based Material Editor (UE5 Material Editor + Unity Shader Graph)
 * 
 * Sistem material berbasis node yang memungkinkan artist membuat shader
 * tanpa coding langsung, mirip dengan Material Editor di UE5 atau
 * Shader Graph di Unity.
 */

import { nanoid } from '../utils/index'

// ==================== DATA TYPES ====================

/**
 * Tipe data yang bisa dilewatkan antar node
 */
export enum MaterialDataType {
  FLOAT = 'float',
  FLOAT2 = 'float2',
  FLOAT3 = 'float3',
  FLOAT4 = 'float4',
  TEXTURE2D = 'texture2d',
  TEXTURECUBE = 'texturecube',
  SAMPLER = 'sampler',
  MATRIX3 = 'matrix3',
  MATRIX4 = 'matrix4',
  BOOLEAN = 'boolean',
  INTEGER = 'integer',
}

/**
 * Nilai untuk setiap tipe data
 */
export type MaterialValue = 
  | number 
  | [number, number] 
  | [number, number, number] 
  | [number, number, number, number]
  | Float32Array
  | HTMLImageElement
  | ImageBitmap
  | null

// ==================== PIN SYSTEM ====================

/**
 * Pin Direction - Input atau Output
 */
export enum PinDirection {
  INPUT = 'input',
  OUTPUT = 'output',
}

/**
 * Material Pin - Titik koneksi pada node
 */
export interface MaterialPin {
  id: string
  name: string
  direction: PinDirection
  dataType: MaterialDataType
  defaultValue?: MaterialValue
  connectedTo?: string // ID pin yang terkoneksi
  nodeId: string
}

/**
 * Connection antara dua pin
 */
export interface MaterialConnection {
  id: string
  sourceNodeId: string
  sourcePinId: string
  targetNodeId: string
  targetPinId: string
}

// ==================== NODE SYSTEM ====================

/**
 * Kategori node
 */
export enum NodeCategory {
  INPUT = 'Input',
  OUTPUT = 'Output',
  MATH = 'Math',
  VECTOR = 'Vector',
  TEXTURE = 'Texture',
  UTILITY = 'Utility',
  CONSTANT = 'Constant',
  PARAMETER = 'Parameter',
}

/**
 * Base class untuk semua material node
 */
export abstract class MaterialNode {
  public id: string
  public name: string
  public category: NodeCategory
  public position: { x: number; y: number } = { x: 0, y: 0 }
  public inputPins: MaterialPin[] = []
  public outputPins: MaterialPin[] = []
  public isCollapsed: boolean = false

  constructor(name: string, category: NodeCategory) {
    this.id = nanoid()
    this.name = name
    this.category = category
  }

  /**
   * Tambah input pin
   */
  protected addInputPin(name: string, dataType: MaterialDataType, defaultValue?: MaterialValue): MaterialPin {
    const pin: MaterialPin = {
      id: nanoid(),
      name,
      direction: PinDirection.INPUT,
      dataType,
      defaultValue,
      nodeId: this.id,
    }
    this.inputPins.push(pin)
    return pin
  }

  /**
   * Tambah output pin
   */
  protected addOutputPin(name: string, dataType: MaterialDataType): MaterialPin {
    const pin: MaterialPin = {
      id: nanoid(),
      name,
      direction: PinDirection.OUTPUT,
      dataType,
      nodeId: this.id,
    }
    this.outputPins.push(pin)
    return pin
  }

  /**
   * Get pin by ID
   */
  getPin(pinId: string): MaterialPin | undefined {
    return [...this.inputPins, ...this.outputPins].find(p => p.id === pinId)
  }

  /**
   * Generate shader code untuk node ini
   */
  abstract generateCode(inputs: Map<string, string>): string

  /**
   * Get output variable name
   */
  getOutputVariableName(pinName: string): string {
    return `${this.name.toLowerCase().replace(/\s/g, '_')}_${this.id.slice(0, 6)}_${pinName.toLowerCase()}`
  }

  /**
   * Serialize node
   */
  serialize(): Record<string, any> {
    return {
      id: this.id,
      type: this.constructor.name,
      name: this.name,
      category: this.category,
      position: this.position,
      inputPins: this.inputPins,
      outputPins: this.outputPins,
    }
  }
}

// ==================== INPUT NODES ====================

/**
 * Texture Sample Node - Sample texture dengan UV
 */
export class TextureSampleNode extends MaterialNode {
  public textureAsset: string = ''

  constructor() {
    super('Texture Sample', NodeCategory.TEXTURE)
    this.addInputPin('UV', MaterialDataType.FLOAT2, [0, 0])
    this.addInputPin('Texture', MaterialDataType.TEXTURE2D)
    this.addOutputPin('RGB', MaterialDataType.FLOAT3)
    this.addOutputPin('R', MaterialDataType.FLOAT)
    this.addOutputPin('G', MaterialDataType.FLOAT)
    this.addOutputPin('B', MaterialDataType.FLOAT)
    this.addOutputPin('A', MaterialDataType.FLOAT)
    this.addOutputPin('RGBA', MaterialDataType.FLOAT4)
  }

  generateCode(inputs: Map<string, string>): string {
    const uv = inputs.get('UV') || 'vUV'
    const textureName = inputs.get('Texture') || 'uTexture'
    const outputVar = this.getOutputVariableName('RGBA')
    return `vec4 ${outputVar} = texture(${textureName}, ${uv});`
  }
}

/**
 * Constant Node - Nilai konstant
 */
export class ConstantNode extends MaterialNode {
  public value: number = 0

  constructor() {
    super('Constant', NodeCategory.CONSTANT)
    this.addOutputPin('Value', MaterialDataType.FLOAT)
  }

  generateCode(_inputs: Map<string, string>): string {
    const outputVar = this.getOutputVariableName('Value')
    return `float ${outputVar} = ${this.value.toFixed(6)};`
  }
}

/**
 * Constant2 Node - Vector2 konstant
 */
export class Constant2Node extends MaterialNode {
  public value: [number, number] = [0, 0]

  constructor() {
    super('Constant2', NodeCategory.CONSTANT)
    this.addOutputPin('Value', MaterialDataType.FLOAT2)
  }

  generateCode(_inputs: Map<string, string>): string {
    const outputVar = this.getOutputVariableName('Value')
    return `vec2 ${outputVar} = vec2(${this.value[0].toFixed(6)}, ${this.value[1].toFixed(6)});`
  }
}

/**
 * Constant3 Node - Vector3 konstant (Color/Direction)
 */
export class Constant3Node extends MaterialNode {
  public value: [number, number, number] = [0, 0, 0]

  constructor() {
    super('Constant3', NodeCategory.CONSTANT)
    this.addOutputPin('Value', MaterialDataType.FLOAT3)
  }

  generateCode(_inputs: Map<string, string>): string {
    const outputVar = this.getOutputVariableName('Value')
    return `vec3 ${outputVar} = vec3(${this.value[0].toFixed(6)}, ${this.value[1].toFixed(6)}, ${this.value[2].toFixed(6)});`
  }
}

/**
 * Constant4 Node - Vector4 konstant
 */
export class Constant4Node extends MaterialNode {
  public value: [number, number, number, number] = [0, 0, 0, 1]

  constructor() {
    super('Constant4', NodeCategory.CONSTANT)
    this.addOutputPin('Value', MaterialDataType.FLOAT4)
  }

  generateCode(_inputs: Map<string, string>): string {
    const outputVar = this.getOutputVariableName('Value')
    return `vec4 ${outputVar} = vec4(${this.value.map(v => v.toFixed(6)).join(', ')});`
  }
}

/**
 * Parameter Node - Exposed parameter yang bisa diubah dari luar
 */
export class ParameterNode extends MaterialNode {
  public parameterName: string = 'MyParameter'
  public parameterType: MaterialDataType = MaterialDataType.FLOAT
  public defaultValue: MaterialValue = 0

  constructor() {
    super('Parameter', NodeCategory.PARAMETER)
    this.addOutputPin('Value', MaterialDataType.FLOAT)
  }

  setParameterType(type: MaterialDataType): void {
    this.parameterType = type
    // Update output pin type
    if (this.outputPins.length > 0) {
      this.outputPins[0].dataType = type
    }
  }

  generateCode(_inputs: Map<string, string>): string {
    // Parameters are declared as uniforms
    return `// Parameter: ${this.parameterName} (uniform)`
  }

  getUniformDeclaration(): string {
    const glslType = this.getGLSLType(this.parameterType)
    return `uniform ${glslType} u_${this.parameterName};`
  }

  private getGLSLType(type: MaterialDataType): string {
    switch (type) {
      case MaterialDataType.FLOAT: return 'float'
      case MaterialDataType.FLOAT2: return 'vec2'
      case MaterialDataType.FLOAT3: return 'vec3'
      case MaterialDataType.FLOAT4: return 'vec4'
      case MaterialDataType.TEXTURE2D: return 'sampler2D'
      case MaterialDataType.BOOLEAN: return 'bool'
      case MaterialDataType.INTEGER: return 'int'
      default: return 'float'
    }
  }
}

/**
 * Time Node - Waktu game untuk animasi
 */
export class TimeNode extends MaterialNode {
  constructor() {
    super('Time', NodeCategory.INPUT)
    this.addOutputPin('Time', MaterialDataType.FLOAT)
    this.addOutputPin('SinTime', MaterialDataType.FLOAT)
    this.addOutputPin('CosTime', MaterialDataType.FLOAT)
    this.addOutputPin('DeltaTime', MaterialDataType.FLOAT)
  }

  generateCode(_inputs: Map<string, string>): string {
    return `// Time values from uniform uTime`
  }
}

/**
 * UV Node - Texture coordinates
 */
export class UVNode extends MaterialNode {
  public uvChannel: number = 0

  constructor() {
    super('UV', NodeCategory.INPUT)
    this.addOutputPin('UV', MaterialDataType.FLOAT2)
  }

  generateCode(_inputs: Map<string, string>): string {
    const outputVar = this.getOutputVariableName('UV')
    return `vec2 ${outputVar} = vUV${this.uvChannel > 0 ? this.uvChannel : ''};`
  }
}

/**
 * Vertex Color Node
 */
export class VertexColorNode extends MaterialNode {
  constructor() {
    super('Vertex Color', NodeCategory.INPUT)
    this.addOutputPin('Color', MaterialDataType.FLOAT4)
    this.addOutputPin('RGB', MaterialDataType.FLOAT3)
    this.addOutputPin('R', MaterialDataType.FLOAT)
    this.addOutputPin('G', MaterialDataType.FLOAT)
    this.addOutputPin('B', MaterialDataType.FLOAT)
    this.addOutputPin('A', MaterialDataType.FLOAT)
  }

  generateCode(_inputs: Map<string, string>): string {
    const outputVar = this.getOutputVariableName('Color')
    return `vec4 ${outputVar} = vColor;`
  }
}

/**
 * World Position Node
 */
export class WorldPositionNode extends MaterialNode {
  constructor() {
    super('World Position', NodeCategory.INPUT)
    this.addOutputPin('Position', MaterialDataType.FLOAT3)
  }

  generateCode(_inputs: Map<string, string>): string {
    const outputVar = this.getOutputVariableName('Position')
    return `vec3 ${outputVar} = vWorldPosition;`
  }
}

/**
 * Normal Node
 */
export class NormalNode extends MaterialNode {
  constructor() {
    super('Normal', NodeCategory.INPUT)
    this.addOutputPin('WorldNormal', MaterialDataType.FLOAT3)
    this.addOutputPin('LocalNormal', MaterialDataType.FLOAT3)
  }

  generateCode(_inputs: Map<string, string>): string {
    return `// Normal from vNormal`
  }
}

// ==================== MATH NODES ====================

/**
 * Add Node - Penjumlahan
 */
export class AddNode extends MaterialNode {
  constructor() {
    super('Add', NodeCategory.MATH)
    this.addInputPin('A', MaterialDataType.FLOAT, 0)
    this.addInputPin('B', MaterialDataType.FLOAT, 0)
    this.addOutputPin('Result', MaterialDataType.FLOAT)
  }

  generateCode(inputs: Map<string, string>): string {
    const a = inputs.get('A') || '0.0'
    const b = inputs.get('B') || '0.0'
    const outputVar = this.getOutputVariableName('Result')
    return `float ${outputVar} = ${a} + ${b};`
  }
}

/**
 * Subtract Node - Pengurangan
 */
export class SubtractNode extends MaterialNode {
  constructor() {
    super('Subtract', NodeCategory.MATH)
    this.addInputPin('A', MaterialDataType.FLOAT, 0)
    this.addInputPin('B', MaterialDataType.FLOAT, 0)
    this.addOutputPin('Result', MaterialDataType.FLOAT)
  }

  generateCode(inputs: Map<string, string>): string {
    const a = inputs.get('A') || '0.0'
    const b = inputs.get('B') || '0.0'
    const outputVar = this.getOutputVariableName('Result')
    return `float ${outputVar} = ${a} - ${b};`
  }
}

/**
 * Multiply Node - Perkalian
 */
export class MultiplyNode extends MaterialNode {
  constructor() {
    super('Multiply', NodeCategory.MATH)
    this.addInputPin('A', MaterialDataType.FLOAT, 1)
    this.addInputPin('B', MaterialDataType.FLOAT, 1)
    this.addOutputPin('Result', MaterialDataType.FLOAT)
  }

  generateCode(inputs: Map<string, string>): string {
    const a = inputs.get('A') || '1.0'
    const b = inputs.get('B') || '1.0'
    const outputVar = this.getOutputVariableName('Result')
    return `float ${outputVar} = ${a} * ${b};`
  }
}

/**
 * Divide Node - Pembagian
 */
export class DivideNode extends MaterialNode {
  constructor() {
    super('Divide', NodeCategory.MATH)
    this.addInputPin('A', MaterialDataType.FLOAT, 1)
    this.addInputPin('B', MaterialDataType.FLOAT, 1)
    this.addOutputPin('Result', MaterialDataType.FLOAT)
  }

  generateCode(inputs: Map<string, string>): string {
    const a = inputs.get('A') || '1.0'
    const b = inputs.get('B') || '1.0'
    const outputVar = this.getOutputVariableName('Result')
    return `float ${outputVar} = ${a} / max(${b}, 0.0001);`
  }
}

/**
 * Power Node - Pangkat
 */
export class PowerNode extends MaterialNode {
  constructor() {
    super('Power', NodeCategory.MATH)
    this.addInputPin('Base', MaterialDataType.FLOAT, 2)
    this.addInputPin('Exponent', MaterialDataType.FLOAT, 2)
    this.addOutputPin('Result', MaterialDataType.FLOAT)
  }

  generateCode(inputs: Map<string, string>): string {
    const base = inputs.get('Base') || '2.0'
    const exp = inputs.get('Exponent') || '2.0'
    const outputVar = this.getOutputVariableName('Result')
    return `float ${outputVar} = pow(${base}, ${exp});`
  }
}

/**
 * Lerp Node - Linear interpolation
 */
export class LerpNode extends MaterialNode {
  constructor() {
    super('Lerp', NodeCategory.MATH)
    this.addInputPin('A', MaterialDataType.FLOAT, 0)
    this.addInputPin('B', MaterialDataType.FLOAT, 1)
    this.addInputPin('Alpha', MaterialDataType.FLOAT, 0.5)
    this.addOutputPin('Result', MaterialDataType.FLOAT)
  }

  generateCode(inputs: Map<string, string>): string {
    const a = inputs.get('A') || '0.0'
    const b = inputs.get('B') || '1.0'
    const alpha = inputs.get('Alpha') || '0.5'
    const outputVar = this.getOutputVariableName('Result')
    return `float ${outputVar} = mix(${a}, ${b}, ${alpha});`
  }
}

/**
 * Clamp Node - Clamp nilai
 */
export class ClampNode extends MaterialNode {
  constructor() {
    super('Clamp', NodeCategory.MATH)
    this.addInputPin('Value', MaterialDataType.FLOAT, 0)
    this.addInputPin('Min', MaterialDataType.FLOAT, 0)
    this.addInputPin('Max', MaterialDataType.FLOAT, 1)
    this.addOutputPin('Result', MaterialDataType.FLOAT)
  }

  generateCode(inputs: Map<string, string>): string {
    const value = inputs.get('Value') || '0.0'
    const min = inputs.get('Min') || '0.0'
    const max = inputs.get('Max') || '1.0'
    const outputVar = this.getOutputVariableName('Result')
    return `float ${outputVar} = clamp(${value}, ${min}, ${max});`
  }
}

/**
 * Sin Node
 */
export class SinNode extends MaterialNode {
  constructor() {
    super('Sin', NodeCategory.MATH)
    this.addInputPin('Value', MaterialDataType.FLOAT, 0)
    this.addOutputPin('Result', MaterialDataType.FLOAT)
  }

  generateCode(inputs: Map<string, string>): string {
    const value = inputs.get('Value') || '0.0'
    const outputVar = this.getOutputVariableName('Result')
    return `float ${outputVar} = sin(${value});`
  }
}

/**
 * Cos Node
 */
export class CosNode extends MaterialNode {
  constructor() {
    super('Cos', NodeCategory.MATH)
    this.addInputPin('Value', MaterialDataType.FLOAT, 0)
    this.addOutputPin('Result', MaterialDataType.FLOAT)
  }

  generateCode(inputs: Map<string, string>): string {
    const value = inputs.get('Value') || '0.0'
    const outputVar = this.getOutputVariableName('Result')
    return `float ${outputVar} = cos(${value});`
  }
}

/**
 * Abs Node
 */
export class AbsNode extends MaterialNode {
  constructor() {
    super('Abs', NodeCategory.MATH)
    this.addInputPin('Value', MaterialDataType.FLOAT, 0)
    this.addOutputPin('Result', MaterialDataType.FLOAT)
  }

  generateCode(inputs: Map<string, string>): string {
    const value = inputs.get('Value') || '0.0'
    const outputVar = this.getOutputVariableName('Result')
    return `float ${outputVar} = abs(${value});`
  }
}

/**
 * Floor Node
 */
export class FloorNode extends MaterialNode {
  constructor() {
    super('Floor', NodeCategory.MATH)
    this.addInputPin('Value', MaterialDataType.FLOAT, 0)
    this.addOutputPin('Result', MaterialDataType.FLOAT)
  }

  generateCode(inputs: Map<string, string>): string {
    const value = inputs.get('Value') || '0.0'
    const outputVar = this.getOutputVariableName('Result')
    return `float ${outputVar} = floor(${value});`
  }
}

/**
 * Frac Node - Fractional part
 */
export class FracNode extends MaterialNode {
  constructor() {
    super('Frac', NodeCategory.MATH)
    this.addInputPin('Value', MaterialDataType.FLOAT, 0)
    this.addOutputPin('Result', MaterialDataType.FLOAT)
  }

  generateCode(inputs: Map<string, string>): string {
    const value = inputs.get('Value') || '0.0'
    const outputVar = this.getOutputVariableName('Result')
    return `float ${outputVar} = fract(${value});`
  }
}

/**
 * One Minus Node - 1 - Value
 */
export class OneMinusNode extends MaterialNode {
  constructor() {
    super('One Minus', NodeCategory.MATH)
    this.addInputPin('Value', MaterialDataType.FLOAT, 0)
    this.addOutputPin('Result', MaterialDataType.FLOAT)
  }

  generateCode(inputs: Map<string, string>): string {
    const value = inputs.get('Value') || '0.0'
    const outputVar = this.getOutputVariableName('Result')
    return `float ${outputVar} = 1.0 - ${value};`
  }
}

// ==================== VECTOR NODES ====================

/**
 * Normalize Node
 */
export class NormalizeNode extends MaterialNode {
  constructor() {
    super('Normalize', NodeCategory.VECTOR)
    this.addInputPin('Vector', MaterialDataType.FLOAT3, [0, 1, 0])
    this.addOutputPin('Result', MaterialDataType.FLOAT3)
  }

  generateCode(inputs: Map<string, string>): string {
    const vector = inputs.get('Vector') || 'vec3(0.0, 1.0, 0.0)'
    const outputVar = this.getOutputVariableName('Result')
    return `vec3 ${outputVar} = normalize(${vector});`
  }
}

/**
 * Dot Product Node
 */
export class DotNode extends MaterialNode {
  constructor() {
    super('Dot', NodeCategory.VECTOR)
    this.addInputPin('A', MaterialDataType.FLOAT3, [0, 0, 0])
    this.addInputPin('B', MaterialDataType.FLOAT3, [0, 0, 0])
    this.addOutputPin('Result', MaterialDataType.FLOAT)
  }

  generateCode(inputs: Map<string, string>): string {
    const a = inputs.get('A') || 'vec3(0.0)'
    const b = inputs.get('B') || 'vec3(0.0)'
    const outputVar = this.getOutputVariableName('Result')
    return `float ${outputVar} = dot(${a}, ${b});`
  }
}

/**
 * Cross Product Node
 */
export class CrossNode extends MaterialNode {
  constructor() {
    super('Cross', NodeCategory.VECTOR)
    this.addInputPin('A', MaterialDataType.FLOAT3, [0, 0, 0])
    this.addInputPin('B', MaterialDataType.FLOAT3, [0, 0, 0])
    this.addOutputPin('Result', MaterialDataType.FLOAT3)
  }

  generateCode(inputs: Map<string, string>): string {
    const a = inputs.get('A') || 'vec3(0.0)'
    const b = inputs.get('B') || 'vec3(0.0)'
    const outputVar = this.getOutputVariableName('Result')
    return `vec3 ${outputVar} = cross(${a}, ${b});`
  }
}

/**
 * Component Mask Node - Extract components from vector
 */
export class ComponentMaskNode extends MaterialNode {
  public mask: { r: boolean; g: boolean; b: boolean; a: boolean } = {
    r: true,
    g: true,
    b: false,
    a: false,
  }

  constructor() {
    super('Component Mask', NodeCategory.VECTOR)
    this.addInputPin('Input', MaterialDataType.FLOAT4, [0, 0, 0, 0])
    this.addOutputPin('Output', MaterialDataType.FLOAT2)
  }

  generateCode(inputs: Map<string, string>): string {
    const input = inputs.get('Input') || 'vec4(0.0)'
    const components = []
    if (this.mask.r) components.push('r')
    if (this.mask.g) components.push('g')
    if (this.mask.b) components.push('b')
    if (this.mask.a) components.push('a')
    
    const swizzle = components.join('')
    const outputVar = this.getOutputVariableName('Output')
    
    if (components.length === 1) {
      return `float ${outputVar} = ${input}.${swizzle};`
    } else if (components.length === 2) {
      return `vec2 ${outputVar} = ${input}.${swizzle};`
    } else if (components.length === 3) {
      return `vec3 ${outputVar} = ${input}.${swizzle};`
    } else {
      return `vec4 ${outputVar} = ${input}.${swizzle};`
    }
  }
}

/**
 * Append Node - Combine scalars/vectors
 */
export class AppendNode extends MaterialNode {
  constructor() {
    super('Append', NodeCategory.VECTOR)
    this.addInputPin('A', MaterialDataType.FLOAT, 0)
    this.addInputPin('B', MaterialDataType.FLOAT, 0)
    this.addOutputPin('Result', MaterialDataType.FLOAT2)
  }

  generateCode(inputs: Map<string, string>): string {
    const a = inputs.get('A') || '0.0'
    const b = inputs.get('B') || '0.0'
    const outputVar = this.getOutputVariableName('Result')
    return `vec2 ${outputVar} = vec2(${a}, ${b});`
  }
}

// ==================== UTILITY NODES ====================

/**
 * Fresnel Node - Rim lighting effect
 */
export class FresnelNode extends MaterialNode {
  constructor() {
    super('Fresnel', NodeCategory.UTILITY)
    this.addInputPin('Exponent', MaterialDataType.FLOAT, 5)
    this.addInputPin('BaseReflectivity', MaterialDataType.FLOAT, 0.04)
    this.addOutputPin('Result', MaterialDataType.FLOAT)
  }

  generateCode(inputs: Map<string, string>): string {
    const exp = inputs.get('Exponent') || '5.0'
    const baseReflect = inputs.get('BaseReflectivity') || '0.04'
    const outputVar = this.getOutputVariableName('Result')
    return `
    float ${outputVar};
    {
      vec3 viewDir = normalize(uCameraPosition - vWorldPosition);
      float NdotV = max(dot(vNormal, viewDir), 0.0);
      ${outputVar} = ${baseReflect} + (1.0 - ${baseReflect}) * pow(1.0 - NdotV, ${exp});
    }`
  }
}

/**
 * Panner Node - UV animation
 */
export class PannerNode extends MaterialNode {
  constructor() {
    super('Panner', NodeCategory.UTILITY)
    this.addInputPin('UV', MaterialDataType.FLOAT2, [0, 0])
    this.addInputPin('Time', MaterialDataType.FLOAT, 0)
    this.addInputPin('SpeedX', MaterialDataType.FLOAT, 1)
    this.addInputPin('SpeedY', MaterialDataType.FLOAT, 1)
    this.addOutputPin('Result', MaterialDataType.FLOAT2)
  }

  generateCode(inputs: Map<string, string>): string {
    const uv = inputs.get('UV') || 'vUV'
    const time = inputs.get('Time') || 'uTime'
    const speedX = inputs.get('SpeedX') || '1.0'
    const speedY = inputs.get('SpeedY') || '1.0'
    const outputVar = this.getOutputVariableName('Result')
    return `vec2 ${outputVar} = ${uv} + vec2(${speedX}, ${speedY}) * ${time};`
  }
}

/**
 * Rotator Node - UV rotation
 */
export class RotatorNode extends MaterialNode {
  constructor() {
    super('Rotator', NodeCategory.UTILITY)
    this.addInputPin('UV', MaterialDataType.FLOAT2, [0, 0])
    this.addInputPin('Time', MaterialDataType.FLOAT, 0)
    this.addInputPin('Speed', MaterialDataType.FLOAT, 1)
    this.addInputPin('Center', MaterialDataType.FLOAT2, [0.5, 0.5])
    this.addOutputPin('Result', MaterialDataType.FLOAT2)
  }

  generateCode(inputs: Map<string, string>): string {
    const uv = inputs.get('UV') || 'vUV'
    const time = inputs.get('Time') || 'uTime'
    const speed = inputs.get('Speed') || '1.0'
    const center = inputs.get('Center') || 'vec2(0.5, 0.5)'
    const outputVar = this.getOutputVariableName('Result')
    return `
    vec2 ${outputVar};
    {
      float angle = ${time} * ${speed};
      vec2 centered = ${uv} - ${center};
      float c = cos(angle);
      float s = sin(angle);
      ${outputVar} = vec2(centered.x * c - centered.y * s, centered.x * s + centered.y * c) + ${center};
    }`
  }
}

// ==================== OUTPUT NODES ====================

/**
 * Material Output Node - Final material output
 * Ini adalah node output utama seperti di UE5 Material Editor
 */
export class MaterialOutputNode extends MaterialNode {
  constructor() {
    super('Material Output', NodeCategory.OUTPUT)
    // PBR Inputs
    this.addInputPin('BaseColor', MaterialDataType.FLOAT3, [0.8, 0.8, 0.8])
    this.addInputPin('Metallic', MaterialDataType.FLOAT, 0)
    this.addInputPin('Roughness', MaterialDataType.FLOAT, 0.5)
    this.addInputPin('Specular', MaterialDataType.FLOAT, 0.5)
    this.addInputPin('Normal', MaterialDataType.FLOAT3, [0, 0, 1])
    this.addInputPin('Emissive', MaterialDataType.FLOAT3, [0, 0, 0])
    this.addInputPin('AmbientOcclusion', MaterialDataType.FLOAT, 1)
    this.addInputPin('Opacity', MaterialDataType.FLOAT, 1)
    this.addInputPin('OpacityMask', MaterialDataType.FLOAT, 1)
    this.addInputPin('WorldPositionOffset', MaterialDataType.FLOAT3, [0, 0, 0])
  }

  generateCode(inputs: Map<string, string>): string {
    const baseColor = inputs.get('BaseColor') || 'vec3(0.8)'
    const metallic = inputs.get('Metallic') || '0.0'
    const roughness = inputs.get('Roughness') || '0.5'
    const normal = inputs.get('Normal') || 'vNormal'
    const emissive = inputs.get('Emissive') || 'vec3(0.0)'
    const ao = inputs.get('AmbientOcclusion') || '1.0'
    const opacity = inputs.get('Opacity') || '1.0'

    return `
    // Material Output
    MaterialOutput output;
    output.baseColor = ${baseColor};
    output.metallic = ${metallic};
    output.roughness = ${roughness};
    output.normal = ${normal};
    output.emissive = ${emissive};
    output.ao = ${ao};
    output.opacity = ${opacity};
    `
  }
}

// ==================== NODE FACTORY ====================

/**
 * Node type registry for factory pattern
 */
export const MaterialNodeTypes = {
  TextureSample: TextureSampleNode,
  Constant: ConstantNode,
  Constant2: Constant2Node,
  Constant3: Constant3Node,
  Constant4: Constant4Node,
  Parameter: ParameterNode,
  Time: TimeNode,
  UV: UVNode,
  VertexColor: VertexColorNode,
  WorldPosition: WorldPositionNode,
  Normal: NormalNode,
  Add: AddNode,
  Subtract: SubtractNode,
  Multiply: MultiplyNode,
  Divide: DivideNode,
  Power: PowerNode,
  Lerp: LerpNode,
  Clamp: ClampNode,
  Sin: SinNode,
  Cos: CosNode,
  Abs: AbsNode,
  Floor: FloorNode,
  Frac: FracNode,
  OneMinus: OneMinusNode,
  Normalize: NormalizeNode,
  Dot: DotNode,
  Cross: CrossNode,
  ComponentMask: ComponentMaskNode,
  Append: AppendNode,
  Fresnel: FresnelNode,
  Panner: PannerNode,
  Rotator: RotatorNode,
  MaterialOutput: MaterialOutputNode,
} as const

export type MaterialNodeTypeName = keyof typeof MaterialNodeTypes
