import * as THREE from 'three'
import type { RendererBackend } from './createRenderer'
import type { ColorGrade } from '../scene/SceneSettings'

/**
 * Optional per-scene post-processing: ambient occlusion (GTAO), bloom, color grading and
 * anti-aliasing (SMAA/FXAA). WebGLRenderer uses EffectComposer passes; WebGPURenderer uses a TSL
 * RenderPipeline. An effect that cannot be created on a backend is skipped with a warning instead
 * of failing the frame.
 */

export interface PostFxOptions {
  ao: boolean
  aoIntensity: number
  bloom: boolean
  bloomStrength: number
  bloomThreshold: number
  bloomRadius: number
  antialias: 'none' | 'fxaa' | 'smaa'
  /** Display-referred grade applied after tone mapping (see sceneFactory.applySettings) */
  grade: ColorGrade
}

function gradeShader(): { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string } {
  return {
    uniforms: {
      tDiffuse: { value: null },
      uContrast: { value: 1 },
      uSaturation: { value: 1 },
      uTemperature: { value: 0 },
      uTint: { value: 0 },
      uLift: { value: 0 },
      uGamma: { value: 1 },
      uGain: { value: 1 },
      uVignette: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float uContrast;
      uniform float uSaturation;
      uniform float uTemperature;
      uniform float uTint;
      uniform float uLift;
      uniform float uGamma;
      uniform float uGain;
      uniform float uVignette;
      varying vec2 vUv;

      void main() {
        vec4 tex = texture2D(tDiffuse, vUv);
        vec3 c = tex.rgb;
        c.r *= 1.0 + 0.12 * uTemperature;
        c.b *= 1.0 - 0.12 * uTemperature;
        c.g *= 1.0 - 0.08 * uTint;
        c.r *= 1.0 + 0.04 * uTint;
        c.b *= 1.0 + 0.04 * uTint;
        c += uLift;
        c *= uGain;
        c = pow(max(c, vec3(0.0)), vec3(1.0 / max(uGamma, 0.05)));
        float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(luma), c, uSaturation);
        c = (c - 0.5) * uContrast + 0.5;
        float d = length((vUv - 0.5) * 2.0) / 1.41421356;
        float t = clamp((1.0 - d) / 0.55, 0.0, 1.0);
        float mask = t * t * (3.0 - 2.0 * t);
        c *= 1.0 + (mask - 1.0) * uVignette;
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), tex.a);
      }
    `,
  }
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
  const [{ EffectComposer }, { RenderPass }, { OutputPass }, { ShaderPass }] = await Promise.all([
    import('three/examples/jsm/postprocessing/EffectComposer.js'),
    import('three/examples/jsm/postprocessing/RenderPass.js'),
    import('three/examples/jsm/postprocessing/OutputPass.js'),
    import('three/examples/jsm/postprocessing/ShaderPass.js'),
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
  // Tone mapping + sRGB, then color grade and AA on display-referred color
  composer.addPass(new OutputPass())
  if (fx.grade.enabled) {
    const gradePass = new ShaderPass(gradeShader())
    const u = gradePass.material.uniforms
    u.uContrast.value = fx.grade.contrast
    u.uSaturation.value = fx.grade.saturation
    u.uTemperature.value = fx.grade.temperature
    u.uTint.value = fx.grade.tint
    u.uLift.value = fx.grade.lift
    u.uGamma.value = fx.grade.gamma
    u.uGain.value = fx.grade.gain
    u.uVignette.value = fx.grade.vignette
    composer.addPass(gradePass)
    active.push('grade')
  }
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
  // Grading and AA both need display-referred color: tone map + sRGB first
  let display: any = null
  if (fx.antialias !== 'none' || fx.grade.enabled) {
    try {
      pipeline.outputColorTransform = false
      display = tsl.renderOutput(color)
      if (fx.grade.enabled) {
        try {
          const g = fx.grade
          let c = display.rgb
          c = tsl.mul(c, tsl.vec3(1.0 + 0.12 * g.temperature, 1.0 - 0.08 * g.tint, 1.0 - 0.12 * g.temperature))
          c = tsl.mul(c, tsl.vec3(1.0 + 0.04 * g.tint, 1.0, 1.0 + 0.04 * g.tint))
          c = tsl.add(c, tsl.vec3(g.lift))
          c = tsl.mul(c, tsl.vec3(g.gain))
          c = tsl.pow(tsl.max(c, tsl.vec3(0.0)), tsl.vec3(1.0 / Math.max(0.05, g.gamma)))
          const luma = tsl.dot(c, tsl.vec3(0.2126, 0.7152, 0.0722))
          c = tsl.mix(tsl.vec3(luma), c, tsl.float(g.saturation))
          c = tsl.add(tsl.mul(tsl.sub(c, tsl.vec3(0.5)), tsl.vec3(g.contrast)), tsl.vec3(0.5))
          if (g.vignette > 0) {
            const d = tsl.div(tsl.length(tsl.mul(tsl.sub(tsl.screenUV, tsl.vec2(0.5)), tsl.vec2(2.0))), tsl.float(1.41421356))
            const t = tsl.clamp(tsl.div(tsl.sub(tsl.float(1.0), d), tsl.float(0.55)), 0.0, 1.0)
            const mask = tsl.smoothstep(tsl.float(0.0), tsl.float(1.0), t)
            c = tsl.mul(c, tsl.add(tsl.float(1.0), tsl.mul(tsl.sub(mask, tsl.float(1.0)), tsl.float(g.vignette))))
          }
          display = tsl.vec4(tsl.clamp(c, 0.0, 1.0), display.a)
          active.push('grade')
        } catch (err: any) {
          warn(`Color grading tidak tersedia di WebGPU: ${err?.message ?? err}`)
        }
      }
    } catch (err: any) {
      display = null
      pipeline.outputColorTransform = true
      warn(`Post-processing display pass gagal di WebGPU: ${err?.message ?? err}`)
    }
  }
  if (display) {
    color = display
    if (fx.antialias === 'smaa') {
      try {
        const { smaa } = await import('three/examples/jsm/tsl/display/SMAANode.js')
        color = smaa(display)
        active.push('smaa')
      } catch (err: any) {
        warn(`SMAA tidak tersedia di WebGPU: ${err?.message ?? err}`)
      }
    } else if (fx.antialias === 'fxaa') {
      try {
        const { fxaa } = await import('three/examples/jsm/tsl/display/FXAANode.js')
        color = fxaa(display)
        active.push('fxaa')
      } catch (err: any) {
        warn(`FXAA tidak tersedia di WebGPU: ${err?.message ?? err}`)
      }
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
