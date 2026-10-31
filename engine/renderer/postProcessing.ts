import * as THREE from 'three'
import type { RendererBackend } from './createRenderer'

/**
 * Optional per-scene post-processing: ambient occlusion (GTAO), bloom and anti-aliasing (SMAA/FXAA).
 * WebGLRenderer uses EffectComposer passes; WebGPURenderer uses a TSL RenderPipeline. An effect that
 * cannot be created on a backend is skipped with a warning instead of failing the frame.
 */

export interface PostFxOptions {
  ao: boolean
  aoIntensity: number
  bloom: boolean
  bloomStrength: number
  bloomThreshold: number
  bloomRadius: number
  antialias: 'none' | 'fxaa' | 'smaa'
}

export interface PostPipeline {
  render(): void
  setSize(width: number, height: number): void
  dispose(): void
  /** Effects actually active (after fallbacks) */
  readonly active: string[]
}

export async function createPostPipeline(
  renderer: unknown,
  backend: RendererBackend,
  isWebGPURenderer: boolean,
  scene: THREE.Scene,
  camera: THREE.Camera,
  fx: PostFxOptions,
  size: { width: number; height: number },
  warn: (message: string) => void
): Promise<PostPipeline | null> {
  try {
    return isWebGPURenderer
      ? await createTslPipeline(renderer, scene, camera, fx, warn)
      : await createComposerPipeline(renderer as THREE.WebGLRenderer, scene, camera, fx, size, warn)
  } catch (err: any) {
    warn(`Post-processing dimatikan (${backend}): ${err?.message ?? err}`)
    return null
  }
}

async function createComposerPipeline(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  fx: PostFxOptions,
  size: { width: number; height: number },
  warn: (message: string) => void
): Promise<PostPipeline> {
  const [{ EffectComposer }, { RenderPass }, { OutputPass }] = await Promise.all([
    import('three/examples/jsm/postprocessing/EffectComposer.js'),
    import('three/examples/jsm/postprocessing/RenderPass.js'),
    import('three/examples/jsm/postprocessing/OutputPass.js'),
  ])
  const composer = new EffectComposer(renderer)
  composer.setPixelRatio(renderer.getPixelRatio())
  composer.setSize(size.width, size.height)
  composer.addPass(new RenderPass(scene, camera))
  const active: string[] = []

  if (fx.ao) {
    try {
      const { GTAOPass } = await import('three/examples/jsm/postprocessing/GTAOPass.js')
      const gtao = new GTAOPass(scene, camera, size.width, size.height)
      gtao.blendIntensity = fx.aoIntensity
      composer.addPass(gtao)
      active.push('gtao')
    } catch (err: any) {
      warn(`GTAO tidak tersedia di WebGL: ${err?.message ?? err}`)
    }
  }
  if (fx.bloom) {
    try {
      const { UnrealBloomPass } = await import('three/examples/jsm/postprocessing/UnrealBloomPass.js')
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.width, size.height), fx.bloomStrength, fx.bloomRadius, fx.bloomThreshold))
      active.push('bloom')
    } catch (err: any) {
      warn(`Bloom tidak tersedia di WebGL: ${err?.message ?? err}`)
    }
  }
  // Tone mapping + sRGB, then AA on display-referred color
  composer.addPass(new OutputPass())
  if (fx.antialias === 'smaa') {
    try {
      const { SMAAPass } = await import('three/examples/jsm/postprocessing/SMAAPass.js')
      composer.addPass(new SMAAPass())
      active.push('smaa')
    } catch (err: any) {
      warn(`SMAA tidak tersedia di WebGL: ${err?.message ?? err}`)
    }
  } else if (fx.antialias === 'fxaa') {
    try {
      const { FXAAPass } = await import('three/examples/jsm/postprocessing/FXAAPass.js')
      composer.addPass(new FXAAPass())
      active.push('fxaa')
    } catch (err: any) {
      warn(`FXAA tidak tersedia di WebGL: ${err?.message ?? err}`)
    }
  }

  return {
    active,
    render: () => composer.render(),
    setSize: (w, h) => {
      composer.setPixelRatio(renderer.getPixelRatio())
      composer.setSize(w, h)
    },
    dispose: () => {
      for (const pass of composer.passes) (pass as any).dispose?.()
      composer.dispose()
    },
  }
}

async function createTslPipeline(
  renderer: unknown,
  scene: THREE.Scene,
  camera: THREE.Camera,
  fx: PostFxOptions,
  warn: (message: string) => void
): Promise<PostPipeline> {
  const webgpu = await import('three/webgpu')
  const tsl: any = await import('three/tsl')
  const pipeline = new webgpu.RenderPipeline(renderer as any)
  const active: string[] = []

  const scenePass = tsl.pass(scene, camera)
  let color: any = scenePass

  if (fx.ao) {
    try {
      const { ao } = await import('three/examples/jsm/tsl/display/GTAONode.js')
      // Single-sampled: GTAO samples depth with textureGather, which WGSL has no multisampled overload
      // for, so an MSAA prepass (the renderer's default with antialias on) breaks the whole frame
      const prePass = tsl.pass(scene, camera, { samples: 0 })
      prePass.setMRT(tsl.mrt({ output: tsl.normalView }))
      const aoPass: any = ao(prePass.getTextureNode('depth'), prePass.getTextureNode(), camera)
      const aoValue = aoPass.getTextureNode().sample(tsl.screenUV).r
      // Blend toward no occlusion for intensities below 1
      scenePass.contextNode = tsl.builtinAOContext(tsl.mix(tsl.float(1), aoValue, Math.min(1, fx.aoIntensity)))
      active.push('gtao')
    } catch (err: any) {
      warn(`GTAO tidak tersedia di WebGPU: ${err?.message ?? err}`)
    }
  }
  if (fx.bloom) {
    try {
      const { bloom } = await import('three/examples/jsm/tsl/display/BloomNode.js')
      color = color.add(bloom(scenePass, fx.bloomStrength, fx.bloomRadius, fx.bloomThreshold))
      active.push('bloom')
    } catch (err: any) {
      warn(`Bloom tidak tersedia di WebGPU: ${err?.message ?? err}`)
    }
  }
  if (fx.antialias !== 'none') {
    try {
      // AA works on display-referred color: tone map + sRGB first, then AA
      pipeline.outputColorTransform = false
      const display = tsl.renderOutput(color)
      if (fx.antialias === 'smaa') {
        const { smaa } = await import('three/examples/jsm/tsl/display/SMAANode.js')
        color = smaa(display)
      } else {
        const { fxaa } = await import('three/examples/jsm/tsl/display/FXAANode.js')
        color = fxaa(display)
      }
      active.push(fx.antialias)
    } catch (err: any) {
      pipeline.outputColorTransform = true
      warn(`${fx.antialias.toUpperCase()} tidak tersedia di WebGPU: ${err?.message ?? err}`)
    }
  }
  pipeline.outputNode = color

  return {
    active,
    render: () => pipeline.render(),
    // RenderPipeline follows the renderer's size
    setSize: () => {},
    dispose: () => pipeline.dispose(),
  }
}
