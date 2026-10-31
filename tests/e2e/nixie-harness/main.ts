// Renders the fixture NixieFX effect with Linden's three version (r186) through a real WebGL context.
// Built and driven by tests/e2e/nixieFx.e2e.mjs.
import * as THREE from 'three'
import { loadVfxExportBundle } from 'nixie-fx/export'
import { ThreeVfxRenderer } from 'nixie-fx/three'
import manifest from '../../fixtures/nixie-fx/fire-burst/manifest.json'
import fireBurst from '../../fixtures/nixie-fx/fire-burst/effects/fire-burst.json'

async function run() {
  const shaderErrors: string[] = []
  const origError = console.error
  console.error = (...args: unknown[]) => {
    shaderErrors.push(args.map(String).join(' '))
    origError(...args)
  }
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true })
  renderer.setSize(256, 256)
  document.body.appendChild(renderer.domElement)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.set(0, 1.5, 5)
  camera.lookAt(0, 1, 0)
  const bundle = loadVfxExportBundle({ manifest, effectsByPath: { 'effects/fire-burst.json': fireBurst } }, { requiredBackend: 'three3d' })
  const effect = bundle.effectsById.get('fire-burst')
  if (!effect) throw new Error('fire-burst missing from bundle')
  const vfx = new ThreeVfxRenderer({ scene, camera })
  const support = vfx.getSupport(effect)
  vfx.createEffect(effect, { position: [0, 0.5, 0], seed: 42 })
  for (let i = 0; i < 60; i++) {
    vfx.update(1 / 60)
    renderer.render(scene, camera)
  }
  const gl = renderer.getContext()
  const px = new Uint8Array(256 * 256 * 4)
  gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, px)
  let lit = 0
  for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 30) lit++
  console.error = origError
  return {
    three: THREE.REVISION, support: support.status, particles: vfx.stats.activeParticles, drawCalls: renderer.info.render.calls,
    programs: renderer.info.programs?.length ?? 0, litPixels: lit, errors: shaderErrors,
  }
}

;(window as unknown as { nixieSmoke: typeof run }).nixieSmoke = run
