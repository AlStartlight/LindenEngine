/**
 * WebGPU Renderer - Main rendering engine
 * Fallback ke Three.js jika WebGPU tidak tersedia
 */
export interface RendererConfig {
  canvas: HTMLCanvasElement
  width: number
  height: number
  pixelRatio: number
  useWebGPU: boolean
}

export class WebGPURenderer {
  private canvas: HTMLCanvasElement
  private width: number
  private height: number
  private pixelRatio: number

  // WebGPU variables
  private device: GPUDevice | null = null
  private context: GPUCanvasContext | null = null
  private format: GPUTextureFormat = 'bgra8unorm'
  private commandEncoder: GPUCommandEncoder | null = null

  // Shader programs
  private renderPipeline: GPURenderPipeline | null = null

  // Buffers
  private vertexBuffer: GPUBuffer | null = null
  private indexBuffer: GPUBuffer | null = null

  constructor(config: RendererConfig) {
    this.canvas = config.canvas
    this.width = config.width
    this.height = config.height
    this.pixelRatio = config.pixelRatio

    this.canvas.width = this.width * this.pixelRatio
    this.canvas.height = this.height * this.pixelRatio
    this.canvas.style.width = `${this.width}px`
    this.canvas.style.height = `${this.height}px`
  }

  /**
   * Initialize WebGPU
   */
  async initialize(): Promise<boolean> {
    try {
      const adapter = await navigator.gpu?.requestAdapter()
      if (!adapter) {
        console.warn('WebGPU tidak tersedia, fallback ke Three.js')
        return false
      }

      this.device = await adapter.requestDevice()
      if (!this.device) {
        console.warn('Gagal mendapatkan GPU device')
        return false
      }

      const ctx = this.canvas.getContext('webgpu') as GPUCanvasContext
      if (!ctx) {
        console.warn('WebGPU context tidak tersedia')
        return false
      }

      this.context = ctx
      this.format = navigator.gpu?.getPreferredCanvasFormat?.() || 'bgra8unorm'

      this.context.configure({
        device: this.device,
        format: this.format,
        alphaMode: 'opaque',
      })

      await this.setupShaders()
      await this.setupBuffers()

      console.log('[WebGPURenderer] Initialized successfully')
      return true
    } catch (error) {
      console.error('[WebGPURenderer] Initialization failed:', error)
      return false
    }
  }

  /**
   * Setup shaders
   */
  private async setupShaders(): Promise<void> {
    if (!this.device) return

    const shaderCode = this.getShaderCode()

    const shaderModule = this.device.createShaderModule({
      code: shaderCode,
    })

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [],
    })

    this.renderPipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vertex_main',
        buffers: [
          {
            arrayStride: 24, // 3 floats * 4 bytes untuk position
            attributes: [
              {
                shaderLocation: 0,
                offset: 0,
                format: 'float32x3',
              },
            ],
          },
        ],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'back',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragment_main',
        targets: [
          {
            format: this.format,
          },
        ],
      },
    })
  }

  /**
   * Setup vertex dan index buffers
   */
  private async setupBuffers(): Promise<void> {
    if (!this.device) return

    // Simple triangle
    const vertices = new Float32Array([
      0.0, 0.5, 0.0, 1.0, 0.0, 0.0, -0.5, -0.5, 0.0, 0.0, 1.0, 0.0, 0.5, -0.5, 0.0, 0.0, 0.0, 1.0,
    ])

    this.vertexBuffer = this.device.createBuffer({
      label: 'GPUBuffer',
      size: vertices.byteLength,
      mappedAtCreation: true,
      usage: GPUBufferUsage.VERTEX,
    })

    new Float32Array(this.vertexBuffer.getMappedRange()).set(vertices)
    this.vertexBuffer.unmap()
  }

  /**
   * Get shader code dalam WGSL format
   */
  private getShaderCode(): string {
    return `
      @vertex
      fn vertex_main(@location(0) position: vec3f) -> @builtin(position) vec4f {
        return vec4f(position, 1.0);
      }

      @fragment
      fn fragment_main() -> @location(0) vec4f {
        return vec4f(0.0, 1.0, 0.5, 1.0);
      }
    `
  }

  /**
   * Begin frame render
   */
  beginFrame(): void {
    if (!this.context || !this.device) return

    this.commandEncoder = this.device.createCommandEncoder()
  }

  /**
   * Render scene
   */
  render(): void {
    if (!this.context || !this.device || !this.commandEncoder || !this.renderPipeline) return

    const textureView = this.context.getCurrentTexture().createView()

    const renderPass = this.commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })

    renderPass.setPipeline(this.renderPipeline)
    if (this.vertexBuffer) {
      renderPass.setVertexBuffer(0, this.vertexBuffer)
      renderPass.draw(3)
    }
    renderPass.end()

    const commandBuffer = this.commandEncoder.finish()
    this.device.queue.submit([commandBuffer])
  }

  /**
   * End frame render
   */
  endFrame(): void {
    this.commandEncoder = null
  }

  /**
   * Resize renderer
   */
  resize(width: number, height: number): void {
    this.width = width
    this.height = height

    this.canvas.width = width * this.pixelRatio
    this.canvas.height = height * this.pixelRatio
    this.canvas.style.width = `${width}px`
    this.canvas.style.height = `${height}px`

    if (this.context && this.device) {
      this.context.configure({
        device: this.device,
        format: this.format,
      })
    }
  }

  /**
   * Cleanup
   */
  dispose(): void {
    this.vertexBuffer?.destroy()
    this.indexBuffer?.destroy()
    this.device = null
    this.context = null
  }

  /**
   * Get device
   */
  getDevice(): GPUDevice | null {
    return this.device
  }

  /**
   * Get format
   */
  getFormat(): GPUTextureFormat {
    return this.format
  }

  /**
   * Check apakah WebGPU supported
   */
  static isSupported(): boolean {
    return 'gpu' in navigator
  }
}

/**
 * Fallback Three.js Renderer
 */
export class ThreeJSRenderer {
  private canvas: HTMLCanvasElement
  private scene: any
  private camera: any
  private renderer: any

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
  }

  async initialize(): Promise<boolean> {
    try {
      // Dynamic import Three.js
      const THREE = await import('three')

      this.scene = new THREE.Scene()
      this.scene.background = new THREE.Color(0x111111)

      this.camera = new THREE.PerspectiveCamera(75, this.canvas.clientWidth / this.canvas.clientHeight, 0.1, 1000)
      this.camera.position.z = 5

      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true })
      this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight)
      this.renderer.setPixelRatio(window.devicePixelRatio)

      // Add simple cube
      const geometry = new THREE.BoxGeometry()
      const material = new THREE.MeshPhongMaterial({ color: 0x00ff88 })
      const cube = new THREE.Mesh(geometry, material)
      this.scene.add(cube)

      // Add light
      const light = new THREE.DirectionalLight(0xffffff, 1)
      light.position.set(5, 5, 5)
      this.scene.add(light)

      console.log('[ThreeJSRenderer] Initialized successfully')
      return true
    } catch (error) {
      console.error('[ThreeJSRenderer] Initialization failed:', error)
      return false
    }
  }

  render(): void {
    if (this.renderer) {
      this.renderer.render(this.scene, this.camera)
    }
  }

  resize(width: number, height: number): void {
    if (this.camera) {
      this.camera.aspect = width / height
      this.camera.updateProjectionMatrix()
    }
    if (this.renderer) {
      this.renderer.setSize(width, height)
    }
  }

  dispose(): void {
    if (this.renderer) {
      this.renderer.dispose()
    }
  }
}

/**
 * Renderer abstraction - gunakan WebGPU atau Three.js
 */
export class Renderer {
  private webgpuRenderer: WebGPURenderer | null = null
  private threejsRenderer: ThreeJSRenderer | null = null
  private useWebGPU: boolean = false
  private canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement, config: Partial<RendererConfig> = {}) {
    this.canvas = canvas
    const defaultConfig: RendererConfig = {
      canvas,
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      pixelRatio: window.devicePixelRatio,
      useWebGPU: config.useWebGPU ?? WebGPURenderer.isSupported(),
    }

    if (defaultConfig.useWebGPU) {
      this.webgpuRenderer = new WebGPURenderer(defaultConfig)
      this.useWebGPU = true
    } else {
      this.threejsRenderer = new ThreeJSRenderer(canvas)
    }
  }

  async initialize(): Promise<boolean> {
    if (this.useWebGPU && this.webgpuRenderer) {
      const success = await this.webgpuRenderer.initialize()
      if (!success) {
        // Fallback ke Three.js
        this.webgpuRenderer = null
        this.useWebGPU = false
        this.threejsRenderer = new ThreeJSRenderer(this.canvas)
        return await this.threejsRenderer?.initialize() || false
      }
      return true
    } else if (this.threejsRenderer) {
      return await this.threejsRenderer.initialize()
    }
    return false
  }

  render(): void {
    if (this.useWebGPU && this.webgpuRenderer) {
      this.webgpuRenderer.beginFrame()
      this.webgpuRenderer.render()
      this.webgpuRenderer.endFrame()
    } else if (this.threejsRenderer) {
      this.threejsRenderer.render()
    }
  }

  resize(width: number, height: number): void {
    if (this.webgpuRenderer) {
      this.webgpuRenderer.resize(width, height)
    }
    if (this.threejsRenderer) {
      this.threejsRenderer.resize(width, height)
    }
  }

  dispose(): void {
    this.webgpuRenderer?.dispose()
    this.threejsRenderer?.dispose()
  }
}
