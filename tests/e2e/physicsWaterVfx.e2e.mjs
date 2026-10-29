// E2E: a lake with a floating crate, a campfire with smoke and a hinged door, run through the real
// Electron app: linden_play (headless physics: buoyancy, joint) and linden_render_preview (water
// shader and particles in the player runtime). PNGs go to LINDEN_E2E_OUT (default: a temp folder).
//   npm run test:e2e:physics-vfx                     (dev build: dist-electron/main.cjs)
//   LINDEN_APP="release/mac-arm64/Linden Engine.app/Contents/MacOS/Linden Engine" npm run test:e2e:physics-vfx
//     (packaged app: guards against main-process imports that only exist in node_modules)
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repo = process.cwd()
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-physics-vfx-e2e-'))
const project = path.join(work, 'Lake')
const outDir = process.env.LINDEN_E2E_OUT ? path.resolve(process.env.LINDEN_E2E_OUT) : path.join(work, 'previews')
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const transform = (position, scale = [1, 1, 1], rotation = [0, 0, 0]) => ({ type: 'Transform', data: { position, rotation, scale } })
const box = (color, size, extra = {}) => ({ type: 'MeshRenderer', data: { primitive: 'box', color, size, roughness: 0.8, ...extra } })
const scene = {
  format: 'linden-scene',
  version: 2,
  name: 'Lake',
  entities: [
    { id: 'sun', name: 'Sun', parentId: null, components: [transform([0, 10, 0], [1, 1, 1], [-50, 30, 0]), { type: 'Light', data: { type: 'directional', intensity: 3, castShadow: true } }] },
    // Lake bed 3 m under the surface, and a shore that rises 0.2 m above it
    { id: 'bed', name: 'LakeBed', parentId: null, components: [transform([0, -3.5, 0]), box('#5b5136', [40, 1, 40]), { type: 'BoxCollider', data: { size: { x: 40, y: 1, z: 40 } } }] },
    { id: 'shore', name: 'Shore', parentId: null, components: [transform([14, -1.4, 0]), box('#6f8a3a', [12, 3.2, 40]), { type: 'BoxCollider', data: { size: { x: 12, y: 3.2, z: 40 } } }] },
    { id: 'lake', name: 'Lake', parentId: null, components: [transform([0, 0, 0]), { type: 'Water', data: { size: { x: 16, y: 40 }, color: '#1e5f74' } }] },
    // 300 kg in 1 m³: floats about 30 % submerged
    { id: 'crate', name: 'Crate', parentId: null, components: [transform([0, 2, 0], [1, 1, 1], [0, 25, 10]), box('#9a6b3c', [1, 1, 1]), { type: 'Rigidbody', data: { mass: 300 } }, { type: 'BoxCollider', data: { size: { x: 1, y: 1, z: 1 } } }] },
    // 4 t: sinks to the bed
    { id: 'rock', name: 'Rock', parentId: null, components: [transform([-3, 2, 2]), box('#777777', [1, 1, 1]), { type: 'Rigidbody', data: { mass: 4000 } }, { type: 'BoxCollider', data: { size: { x: 1, y: 1, z: 1 } } }] },
    { id: 'fire', name: 'Campfire', parentId: null, components: [transform([11, 0.2, -2]), { type: 'ParticleEmitter', data: { preset: 'fire', seed: 1 } }] },
    { id: 'smoke', name: 'Smoke', parentId: 'fire', components: [transform([0, 0.6, 0]), { type: 'ParticleEmitter', data: { preset: 'smoke', seed: 2 } }] },
    // Door hinged at its left edge to the world; a bump makes it swing, the limit stops it
    { id: 'door', name: 'Door', parentId: null, components: [transform([11, 1.2, 3]), box('#5a3b22', [1, 2, 0.08]), { type: 'Rigidbody', data: { mass: 20, useGravity: true } }, { type: 'BoxCollider', data: { size: { x: 1, y: 2, z: 0.08 } } }, { type: 'Joint', data: { type: 'hinge', anchor: { x: -0.5, y: 0, z: 0 }, axis: { x: 0, y: 1, z: 0 }, limits: { enabled: true, min: -80, max: 80 } } }] },
  ],
}

fs.mkdirSync(path.join(project, 'scenes'), { recursive: true })
fs.writeFileSync(path.join(project, 'project.linden.json'), JSON.stringify({ name: 'Lake', quality: 'high', scenesInBuild: ['scenes/Main.lscene'] }))
fs.writeFileSync(path.join(project, 'scenes/Main.lscene'), JSON.stringify(scene, null, 2))

const executablePath = process.env.LINDEN_APP ? path.resolve(process.env.LINDEN_APP) : undefined
const app = await electron.launch({
  ...(executablePath ? { executablePath, args: [`--user-data-dir=${path.join(work, 'userData')}`] } : { args: [path.join(repo, 'dist-electron/main.cjs'), `--user-data-dir=${path.join(work, 'userData')}`] }),
  env: { ...process.env, LINDEN_E2E: '1' },
})
const mainErrors = []
app.process().stderr?.on('data', (d) => {
  const s = String(d)
  if (/Cannot find module|Uncaught|TypeError/.test(s)) mainErrors.push(s.trim())
})
const runTool = (name, args) => app.evaluate(async (_electron, a) => globalThis.__lindenRunTool(a.project, a.name, a.args), { project, name, args })

try {
  for (let i = 0; i < 100 && !(await app.evaluate(() => typeof globalThis.__lindenRunTool === 'function')); i++) await new Promise((r) => setTimeout(r, 100))

  const play = await runTool('linden_play', { durationSeconds: 6 })
  check('linden_play succeeds', play.success, play.error ?? `${play.data?.msPerStep} ms/step`)
  const pos = play.data?.finalPositions ?? {}
  console.log('  final positions:', JSON.stringify(pos))
  check('crate floats at the surface', pos.Crate && pos.Crate[1] > -0.4 && pos.Crate[1] < 0.5, `y = ${pos.Crate?.[1]}`)
  check('rock sinks to the lake bed', pos.Rock && pos.Rock[1] < -2.4, `y = ${pos.Rock?.[1]}`)
  check('hinged door stays on its hinge', pos.Door && Math.abs(pos.Door[1] - 1.2) < 0.1, `y = ${pos.Door?.[1]}`)

  fs.mkdirSync(outDir, { recursive: true })
  const shots = [
    { label: 'scene', args: { views: ['threeQuarter', 'front'], size: 768 } },
    { label: 'campfire', args: { entityId: 'fire', views: ['front'], size: 512 } },
  ]
  for (const shot of shots) {
    const res = await runTool('linden_render_preview', shot.args)
    check(`${shot.label}: render_preview succeeds`, res.success, res.error ?? (res.data?.warnings?.join('; ') || ''))
    if (!res.success) continue
    for (const img of res.images) {
      const buf = Buffer.from(img.data, 'base64')
      const file = path.join(outDir, `${shot.label}-${img.label}.png`)
      fs.writeFileSync(file, buf)
      check(`${shot.label} ${img.label}: has content`, buf.length > 20_000, `${(buf.length / 1024).toFixed(0)} KB → ${file}`)
    }
  }
  check('no module/uncaught errors in the main process', mainErrors.length === 0, mainErrors.join(' | '))
} catch (e) {
  check('e2e run', false, e.message)
} finally {
  await app.close().catch(() => {})
  if (!process.env.LINDEN_E2E_OUT) console.log(`previews: ${outDir}`)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
