/**
 * Material Graph System - Mengelola node graph untuk material
 * 
 * Material Graph adalah container yang mengelola semua node dan koneksi
 * dalam satu material, kemudian bisa mengcompile menjadi shader code.
 */

import { nanoid } from '../utils/index'
import {
  MaterialNode,
  MaterialConnection,
  MaterialOutputNode,
  MaterialDataType,
  NodeCategory,
  // Node imports
  TextureSampleNode,
  ConstantNode,
  Constant2Node,
  Constant3Node,
  Constant4Node,
  ParameterNode,
  TimeNode,
  UVNode,
  VertexColorNode,
  WorldPositionNode,
  NormalNode,
  AddNode,
  SubtractNode,
  MultiplyNode,
  DivideNode,
  PowerNode,
  LerpNode,
  ClampNode,
  SinNode,
  CosNode,
  AbsNode,
  FloorNode,
  FracNode,
  OneMinusNode,
  NormalizeNode,
  DotNode,
  CrossNode,
  ComponentMaskNode,
  AppendNode,
  FresnelNode,
  PannerNode,
  RotatorNode,
} from './MaterialNode'

/**
 * Material Blend Mode
 */
export enum MaterialBlendMode {
  OPAQUE = 'opaque',
  MASKED = 'masked',
  TRANSLUCENT = 'translucent',
  ADDITIVE = 'additive',
}

/**
 * Material Shading Model
 */
export enum MaterialShadingModel {
  LIT = 'lit',
  UNLIT = 'unlit',
  SUBSURFACE = 'subsurface',
  CLEAR_COAT = 'clearcoat',
}

/**
 * Compiled Shader Result
 */
export interface CompiledShader {
  vertexShader: string
  fragmentShader: string
  uniforms: UniformDefinition[]
  success: boolean
  errors: string[]
}

/**
 * Uniform Definition
 */
export interface UniformDefinition {
  name: string
  type: MaterialDataType
  defaultValue: any
}

/**
 * Material Graph - Container untuk node-based material
 */
export class MaterialGraph {
  public id: string
  public name: string
  public nodes: Map<string, MaterialNode> = new Map()
  public connections: MaterialConnection[] = []
  public outputNode: MaterialOutputNode

  // Material Settings
  public blendMode: MaterialBlendMode = MaterialBlendMode.OPAQUE
  public shadingModel: MaterialShadingModel = MaterialShadingModel.LIT
  public twoSided: boolean = false
  public wireframe: boolean = false

  // Editor metadata
  public description: string = ''
  public tags: string[] = []
  public thumbnailPath: string = ''

  constructor(name: string = 'New Material') {
    this.id = nanoid()
    this.name = name

    // Buat output node secara otomatis
    this.outputNode = new MaterialOutputNode()
    this.outputNode.position = { x: 800, y: 300 }
    this.nodes.set(this.outputNode.id, this.outputNode)
  }

  // ==================== NODE MANAGEMENT ====================

  /**
   * Create node berdasarkan tipe
   */
  createNode(nodeType: string): MaterialNode | null {
    const nodeConstructors: Record<string, new () => MaterialNode> = {
      // Input
      'TextureSample': TextureSampleNode,
      'UV': UVNode,
      'VertexColor': VertexColorNode,
      'WorldPosition': WorldPositionNode,
      'Normal': NormalNode,
      'Time': TimeNode,
      
      // Constants
      'Constant': ConstantNode,
      'Constant2': Constant2Node,
      'Constant3': Constant3Node,
      'Constant4': Constant4Node,
      'Parameter': ParameterNode,
      
      // Math
      'Add': AddNode,
      'Subtract': SubtractNode,
      'Multiply': MultiplyNode,
      'Divide': DivideNode,
      'Power': PowerNode,
      'Lerp': LerpNode,
      'Clamp': ClampNode,
      'Sin': SinNode,
      'Cos': CosNode,
      'Abs': AbsNode,
      'Floor': FloorNode,
      'Frac': FracNode,
      'OneMinus': OneMinusNode,
      
      // Vector
      'Normalize': NormalizeNode,
      'Dot': DotNode,
      'Cross': CrossNode,
      'ComponentMask': ComponentMaskNode,
      'Append': AppendNode,
      
      // Utility
      'Fresnel': FresnelNode,
      'Panner': PannerNode,
      'Rotator': RotatorNode,
    }

    const Constructor = nodeConstructors[nodeType]
    if (!Constructor) {
      console.warn(`Unknown node type: ${nodeType}`)
      return null
    }

    const node = new Constructor()
    this.addNode(node)
    return node
  }

  /**
   * Add existing node ke graph
   */
  addNode(node: MaterialNode): void {
    this.nodes.set(node.id, node)
  }

  /**
   * Remove node dari graph
   */
  removeNode(nodeId: string): boolean {
    // Tidak bisa hapus output node
    if (nodeId === this.outputNode.id) {
      console.warn('Cannot remove output node')
      return false
    }

    // Hapus semua koneksi yang terhubung ke node ini
    this.connections = this.connections.filter(
      conn => conn.sourceNodeId !== nodeId && conn.targetNodeId !== nodeId
    )

    return this.nodes.delete(nodeId)
  }

  /**
   * Get node by ID
   */
  getNode(nodeId: string): MaterialNode | undefined {
    return this.nodes.get(nodeId)
  }

  /**
   * Get semua nodes
   */
  getAllNodes(): MaterialNode[] {
    return Array.from(this.nodes.values())
  }

  /**
   * Get nodes by category
   */
  getNodesByCategory(category: NodeCategory): MaterialNode[] {
    return this.getAllNodes().filter(node => node.category === category)
  }

  // ==================== CONNECTION MANAGEMENT ====================

  /**
   * Connect dua pin
   */
  connect(
    sourceNodeId: string,
    sourcePinId: string,
    targetNodeId: string,
    targetPinId: string
  ): MaterialConnection | null {
    const sourceNode = this.nodes.get(sourceNodeId)
    const targetNode = this.nodes.get(targetNodeId)

    if (!sourceNode || !targetNode) {
      console.warn('Source or target node not found')
      return null
    }

    const sourcePin = sourceNode.outputPins.find(p => p.id === sourcePinId)
    const targetPin = targetNode.inputPins.find(p => p.id === targetPinId)

    if (!sourcePin || !targetPin) {
      console.warn('Source or target pin not found')
      return null
    }

    // Check type compatibility
    if (!this.areTypesCompatible(sourcePin.dataType, targetPin.dataType)) {
      console.warn(`Incompatible types: ${sourcePin.dataType} -> ${targetPin.dataType}`)
      return null
    }

    // Check for cycles
    if (this.wouldCreateCycle(sourceNodeId, targetNodeId)) {
      console.warn('Connection would create a cycle')
      return null
    }

    // Hapus koneksi existing di target pin
    this.disconnectPin(targetNodeId, targetPinId)

    // Buat koneksi baru
    const connection: MaterialConnection = {
      id: nanoid(),
      sourceNodeId,
      sourcePinId,
      targetNodeId,
      targetPinId,
    }

    this.connections.push(connection)
    targetPin.connectedTo = sourcePinId

    return connection
  }

  /**
   * Disconnect pin
   */
  disconnectPin(nodeId: string, pinId: string): boolean {
    const index = this.connections.findIndex(
      conn => (conn.targetNodeId === nodeId && conn.targetPinId === pinId) ||
              (conn.sourceNodeId === nodeId && conn.sourcePinId === pinId)
    )

    if (index !== -1) {
      const conn = this.connections[index]
      const targetNode = this.nodes.get(conn.targetNodeId)
      if (targetNode) {
        const targetPin = targetNode.inputPins.find(p => p.id === conn.targetPinId)
        if (targetPin) {
          targetPin.connectedTo = undefined
        }
      }
      this.connections.splice(index, 1)
      return true
    }

    return false
  }

  /**
   * Remove connection by ID
   */
  removeConnection(connectionId: string): boolean {
    const index = this.connections.findIndex(c => c.id === connectionId)
    if (index !== -1) {
      const conn = this.connections[index]
      const targetNode = this.nodes.get(conn.targetNodeId)
      if (targetNode) {
        const targetPin = targetNode.inputPins.find(p => p.id === conn.targetPinId)
        if (targetPin) {
          targetPin.connectedTo = undefined
        }
      }
      this.connections.splice(index, 1)
      return true
    }
    return false
  }

  /**
   * Get connections untuk node
   */
  getNodeConnections(nodeId: string): MaterialConnection[] {
    return this.connections.filter(
      conn => conn.sourceNodeId === nodeId || conn.targetNodeId === nodeId
    )
  }

  /**
   * Check apakah dua tipe compatible
   */
  private areTypesCompatible(source: MaterialDataType, target: MaterialDataType): boolean {
    // Same type always compatible
    if (source === target) return true

    // Float can connect to any float vector
    if (source === MaterialDataType.FLOAT) {
      return [
        MaterialDataType.FLOAT2,
        MaterialDataType.FLOAT3,
        MaterialDataType.FLOAT4,
      ].includes(target)
    }

    // Vector can connect to smaller vector
    const sizes: Record<MaterialDataType, number> = {
      [MaterialDataType.FLOAT]: 1,
      [MaterialDataType.FLOAT2]: 2,
      [MaterialDataType.FLOAT3]: 3,
      [MaterialDataType.FLOAT4]: 4,
      [MaterialDataType.TEXTURE2D]: 0,
      [MaterialDataType.TEXTURECUBE]: 0,
      [MaterialDataType.SAMPLER]: 0,
      [MaterialDataType.MATRIX3]: 9,
      [MaterialDataType.MATRIX4]: 16,
      [MaterialDataType.BOOLEAN]: 1,
      [MaterialDataType.INTEGER]: 1,
    }

    const sourceSize = sizes[source] || 0
    const targetSize = sizes[target] || 0

    return sourceSize >= targetSize && targetSize > 0
  }

  /**
   * Check apakah koneksi akan membuat cycle
   */
  private wouldCreateCycle(sourceNodeId: string, targetNodeId: string): boolean {
    // BFS untuk check reachability dari target ke source
    const visited = new Set<string>()
    const queue = [targetNodeId]

    while (queue.length > 0) {
      const current = queue.shift()!
      if (current === sourceNodeId) return true
      if (visited.has(current)) continue
      visited.add(current)

      // Find all nodes that this node connects to (as source)
      const outgoingConnections = this.connections.filter(c => c.sourceNodeId === current)
      for (const conn of outgoingConnections) {
        queue.push(conn.targetNodeId)
      }
    }

    return false
  }

  // ==================== COMPILATION ====================

  /**
   * Compile graph menjadi shader code
   */
  compile(): CompiledShader {
    const errors: string[] = []
    const uniforms: UniformDefinition[] = []

    try {
      // Topological sort untuk execution order
      const sortedNodes = this.topologicalSort()
      if (sortedNodes.length === 0 && this.nodes.size > 1) {
        errors.push('Cycle detected in material graph')
        return { vertexShader: '', fragmentShader: '', uniforms, success: false, errors }
      }

      // Collect uniforms dari parameter nodes
      for (const node of sortedNodes) {
        if (node instanceof ParameterNode) {
          uniforms.push({
            name: node.parameterName,
            type: node.parameterType,
            defaultValue: node.defaultValue,
          })
        }
      }

      // Generate code
      const generatedCode = this.generateShaderCode(sortedNodes)

      // Buat vertex shader
      const vertexShader = this.generateVertexShader()

      // Buat fragment shader
      const fragmentShader = this.generateFragmentShader(generatedCode, uniforms)

      return {
        vertexShader,
        fragmentShader,
        uniforms,
        success: true,
        errors: [],
      }
    } catch (err) {
      errors.push(`Compilation error: ${err}`)
      return {
        vertexShader: '',
        fragmentShader: '',
        uniforms,
        success: false,
        errors,
      }
    }
  }

  /**
   * Topological sort untuk node execution order
   */
  private topologicalSort(): MaterialNode[] {
    const visited = new Set<string>()
    const result: MaterialNode[] = []

    const visit = (nodeId: string) => {
      if (visited.has(nodeId)) return
      visited.add(nodeId)

      // Visit all nodes that this node depends on
      const incomingConnections = this.connections.filter(c => c.targetNodeId === nodeId)
      for (const conn of incomingConnections) {
        visit(conn.sourceNodeId)
      }

      const node = this.nodes.get(nodeId)
      if (node) {
        result.push(node)
      }
    }

    // Start dari output node
    visit(this.outputNode.id)

    return result
  }

  /**
   * Generate shader code dari sorted nodes
   */
  private generateShaderCode(sortedNodes: MaterialNode[]): string {
    const codeLines: string[] = []
    const nodeOutputs = new Map<string, Map<string, string>>()

    for (const node of sortedNodes) {
      // Collect inputs untuk node ini
      const inputs = new Map<string, string>()

      for (const inputPin of node.inputPins) {
        // Cari koneksi ke pin ini
        const conn = this.connections.find(
          c => c.targetNodeId === node.id && c.targetPinId === inputPin.id
        )

        if (conn) {
          // Ada koneksi, gunakan output dari source node
          const sourceOutputs = nodeOutputs.get(conn.sourceNodeId)
          const sourceNode = this.nodes.get(conn.sourceNodeId)
          if (sourceOutputs && sourceNode) {
            const sourcePin = sourceNode.outputPins.find(p => p.id === conn.sourcePinId)
            if (sourcePin) {
              const varName = sourceOutputs.get(sourcePin.name)
              if (varName) {
                inputs.set(inputPin.name, varName)
              }
            }
          }
        }
        // Jika tidak ada koneksi, node akan menggunakan default value
      }

      // Generate code untuk node
      const code = node.generateCode(inputs)
      if (code.trim()) {
        codeLines.push(`  // ${node.name}`)
        codeLines.push(`  ${code.trim().replace(/\n/g, '\n  ')}`)
        codeLines.push('')
      }

      // Store output variable names
      const outputs = new Map<string, string>()
      for (const outputPin of node.outputPins) {
        outputs.set(outputPin.name, node.getOutputVariableName(outputPin.name))
      }
      nodeOutputs.set(node.id, outputs)
    }

    return codeLines.join('\n')
  }

  /**
   * Generate vertex shader
   */
  private generateVertexShader(): string {
    return `#version 300 es
precision highp float;

// Attributes
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUV;
layout(location = 3) in vec4 aColor;
layout(location = 4) in vec4 aTangent;

// Uniforms
uniform mat4 uModelMatrix;
uniform mat4 uViewMatrix;
uniform mat4 uProjectionMatrix;
uniform mat4 uNormalMatrix;
uniform float uTime;

// Varyings
out vec3 vWorldPosition;
out vec3 vNormal;
out vec2 vUV;
out vec4 vColor;
out vec3 vTangent;
out vec3 vBitangent;

void main() {
  vec4 worldPosition = uModelMatrix * vec4(aPosition, 1.0);
  vWorldPosition = worldPosition.xyz;
  
  vNormal = normalize(mat3(uNormalMatrix) * aNormal);
  vTangent = normalize(mat3(uNormalMatrix) * aTangent.xyz);
  vBitangent = cross(vNormal, vTangent) * aTangent.w;
  
  vUV = aUV;
  vColor = aColor;
  
  gl_Position = uProjectionMatrix * uViewMatrix * worldPosition;
}
`
  }

  /**
   * Generate fragment shader
   */
  private generateFragmentShader(nodeCode: string, uniforms: UniformDefinition[]): string {
    // Generate uniform declarations
    const uniformDecls = uniforms.map(u => {
      const glslType = this.getGLSLType(u.type)
      return `uniform ${glslType} u_${u.name};`
    }).join('\n')

    return `#version 300 es
precision highp float;

// Material Output Structure
struct MaterialOutput {
  vec3 baseColor;
  float metallic;
  float roughness;
  vec3 normal;
  vec3 emissive;
  float ao;
  float opacity;
};

// Varyings
in vec3 vWorldPosition;
in vec3 vNormal;
in vec2 vUV;
in vec4 vColor;
in vec3 vTangent;
in vec3 vBitangent;

// Built-in Uniforms
uniform float uTime;
uniform vec3 uCameraPosition;
uniform sampler2D uTexture;

// Material Parameters
${uniformDecls}

// Output
out vec4 fragColor;

void main() {
${nodeCode}

  // Final lighting calculation (simplified PBR)
  vec3 N = normalize(output.normal);
  vec3 V = normalize(uCameraPosition - vWorldPosition);
  
  // Simple ambient + diffuse
  float ambient = 0.1;
  float diffuse = max(dot(N, vec3(0.0, 1.0, 0.0)), 0.0);
  
  vec3 finalColor = output.baseColor * (ambient + diffuse * (1.0 - output.metallic));
  finalColor += output.emissive;
  finalColor *= output.ao;
  
  fragColor = vec4(finalColor, output.opacity);
}
`
  }

  /**
   * Get GLSL type string
   */
  private getGLSLType(type: MaterialDataType): string {
    switch (type) {
      case MaterialDataType.FLOAT: return 'float'
      case MaterialDataType.FLOAT2: return 'vec2'
      case MaterialDataType.FLOAT3: return 'vec3'
      case MaterialDataType.FLOAT4: return 'vec4'
      case MaterialDataType.TEXTURE2D: return 'sampler2D'
      case MaterialDataType.TEXTURECUBE: return 'samplerCube'
      case MaterialDataType.MATRIX3: return 'mat3'
      case MaterialDataType.MATRIX4: return 'mat4'
      case MaterialDataType.BOOLEAN: return 'bool'
      case MaterialDataType.INTEGER: return 'int'
      default: return 'float'
    }
  }

  // ==================== SERIALIZATION ====================

  /**
   * Serialize material graph untuk save
   */
  serialize(): Record<string, any> {
    return {
      id: this.id,
      name: this.name,
      blendMode: this.blendMode,
      shadingModel: this.shadingModel,
      twoSided: this.twoSided,
      wireframe: this.wireframe,
      description: this.description,
      tags: this.tags,
      nodes: Array.from(this.nodes.values()).map(n => n.serialize()),
      connections: this.connections,
    }
  }

  /**
   * Deserialize dari saved data
   */
  static deserialize(data: Record<string, any>): MaterialGraph {
    const graph = new MaterialGraph(data.name)
    graph.id = data.id
    graph.blendMode = data.blendMode
    graph.shadingModel = data.shadingModel
    graph.twoSided = data.twoSided
    graph.wireframe = data.wireframe
    graph.description = data.description || ''
    graph.tags = data.tags || []

    // Clear default nodes
    graph.nodes.clear()

    // Map class names to node type names
    const classNameToType: Record<string, string> = {
      // Output
      'MaterialOutputNode': 'MaterialOutput',
      
      // Input nodes
      'TextureSampleNode': 'TextureSample',
      'UVNode': 'UV',
      'VertexColorNode': 'VertexColor',
      'WorldPositionNode': 'WorldPosition',
      'NormalNode': 'Normal',
      'TimeNode': 'Time',
      
      // Constant nodes
      'ConstantNode': 'Constant',
      'Constant2Node': 'Constant2',
      'Constant3Node': 'Constant3',
      'Constant4Node': 'Constant4',
      'ParameterNode': 'Parameter',
      
      // Math nodes
      'AddNode': 'Add',
      'SubtractNode': 'Subtract',
      'MultiplyNode': 'Multiply',
      'DivideNode': 'Divide',
      'PowerNode': 'Power',
      'LerpNode': 'Lerp',
      'ClampNode': 'Clamp',
      'SinNode': 'Sin',
      'CosNode': 'Cos',
      'AbsNode': 'Abs',
      'FloorNode': 'Floor',
      'FracNode': 'Frac',
      'OneMinusNode': 'OneMinus',
      
      // Vector nodes
      'NormalizeNode': 'Normalize',
      'DotNode': 'Dot',
      'CrossNode': 'Cross',
      'ComponentMaskNode': 'ComponentMask',
      'AppendNode': 'Append',
      
      // Utility nodes
      'FresnelNode': 'Fresnel',
      'PannerNode': 'Panner',
      'RotatorNode': 'Rotator',
    }

    // Recreate nodes
    for (const nodeData of data.nodes) {
      // Convert class name to node type if needed
      const nodeType = classNameToType[nodeData.type] || nodeData.type
      
      // Special handling for MaterialOutput
      if (nodeType === 'MaterialOutput') {
        // Create a MaterialOutputNode directly since it's not in createNode
        const outputNode = new MaterialOutputNode()
        outputNode.id = nodeData.id
        outputNode.position = nodeData.position
        graph.nodes.set(outputNode.id, outputNode)
        graph.outputNode = outputNode
      } else {
        const node = graph.createNode(nodeType)
        if (node) {
          node.id = nodeData.id
          node.position = nodeData.position
        }
      }
    }

    // Recreate connections
    graph.connections = data.connections

    return graph
  }
}

// ==================== PRESET MATERIALS ====================

/**
 * Create preset material: Basic Lit
 */
export function createBasicLitMaterial(): MaterialGraph {
  const graph = new MaterialGraph('Basic Lit')
  
  // Create color parameter
  const colorNode = graph.createNode('Constant3') as Constant3Node
  colorNode.value = [0.8, 0.2, 0.2]
  colorNode.position = { x: 200, y: 200 }
  
  // Create roughness parameter
  const roughnessNode = graph.createNode('Constant') as ConstantNode
  roughnessNode.value = 0.5
  roughnessNode.position = { x: 200, y: 400 }
  
  // Connect to output
  const colorPin = colorNode.outputPins[0]
  const roughnessPin = roughnessNode.outputPins[0]
  const baseColorInput = graph.outputNode.inputPins.find(p => p.name === 'BaseColor')
  const roughnessInput = graph.outputNode.inputPins.find(p => p.name === 'Roughness')
  
  if (colorPin && baseColorInput) {
    graph.connect(colorNode.id, colorPin.id, graph.outputNode.id, baseColorInput.id)
  }
  if (roughnessPin && roughnessInput) {
    graph.connect(roughnessNode.id, roughnessPin.id, graph.outputNode.id, roughnessInput.id)
  }
  
  return graph
}

/**
 * Create preset material: Textured PBR
 */
export function createTexturedPBRMaterial(): MaterialGraph {
  const graph = new MaterialGraph('Textured PBR')
  
  // UV Node
  const uvNode = graph.createNode('UV') as UVNode
  uvNode.position = { x: 0, y: 300 }
  
  // Albedo Texture
  const albedoNode = graph.createNode('TextureSample') as TextureSampleNode
  albedoNode.position = { x: 200, y: 200 }
  
  // Normal Map
  const normalNode = graph.createNode('TextureSample') as TextureSampleNode
  normalNode.position = { x: 200, y: 400 }
  
  // Roughness/Metallic
  const roughnessNode = graph.createNode('TextureSample') as TextureSampleNode
  roughnessNode.position = { x: 200, y: 600 }
  
  // Connect UV to textures
  const uvPin = uvNode.outputPins[0]
  for (const texNode of [albedoNode, normalNode, roughnessNode]) {
    const uvInput = texNode.inputPins.find(p => p.name === 'UV')
    if (uvInput) {
      graph.connect(uvNode.id, uvPin.id, texNode.id, uvInput.id)
    }
  }
  
  return graph
}

/**
 * Create preset material: Emissive
 */
export function createEmissiveMaterial(): MaterialGraph {
  const graph = new MaterialGraph('Emissive')
  
  // Base color
  const colorNode = graph.createNode('Constant3') as Constant3Node
  colorNode.value = [0, 1, 1]
  colorNode.position = { x: 200, y: 200 }
  
  // Emissive strength
  const strengthNode = graph.createNode('Constant') as ConstantNode
  strengthNode.value = 5.0
  strengthNode.position = { x: 200, y: 400 }
  
  // Multiply for emission
  const multiplyNode = graph.createNode('Multiply') as MultiplyNode
  multiplyNode.position = { x: 400, y: 300 }
  
  // Connect
  const colorPin = colorNode.outputPins[0]
  const strengthPin = strengthNode.outputPins[0]
  const multiplyA = multiplyNode.inputPins[0]
  const multiplyB = multiplyNode.inputPins[1]
  
  // Note: This is simplified - in real implementation we'd need vector multiply
  
  return graph
}
