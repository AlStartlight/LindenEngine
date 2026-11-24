// E2E: the Cosmic Rift demo world in the real Electron app, driven with Playwright.
// Proves the environment is loaded (HDR sky, lights, portal, planet, particles) and that the
// rigged character really animates and moves in the running game (not just a static GLB).
//
// Needs the Vite dev server (`npm run dev`) and a built main process (`npm run build:electron`):
//   npm run test:e2e:cosmic
// Screenshots land in docs/media/.
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repo = process.cwd()
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-cosmic-e2e-'))
const project = path.join(work, 'CosmicRift')
const outDir = path.join(repo, 'docs/media')
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// Fixture: copy the shipped world and its assets into an isolated project
for (const dir of ['scenes', 'assets/models', 'assets/hdri', 'assets/sky']) fs.mkdirSync(path.join(project, dir), { recursive: true })
fs.writeFileSync(
  path.join(project, 'project.linden.json'),
  JSON.stringify({ name: 'CosmicRift', version: '0.1.0', quality: 'high', scenesInBuild: ['scenes/Main.lscene'] }, null, 2)
)
fs.copyFileSync(path.join(repo, 'scenes/CosmicRift.lscene'), path.join(project, 'scenes/Main.lscene'))
fs.copyFileSync(path.join(repo, 'assets/models/astral_warden.glb'), path.join(project, 'assets/models/astral_warden.glb'))
fs.copyFileSync(path.join(repo, 'assets/models/ruin_gate.glb'), path.join(project, 'assets/models/ruin_gate.glb'))
fs.copyFileSync(path.join(repo, 'assets/hdri/cosmic_rift.hdr'), path.join(project, 'assets/hdri/cosmic_rift.hdr'))
fs.copyFileSync(path.join(repo, 'assets/sky/cosmic_sky.png'), path.join(project, 'assets/sky/cosmic_sky.png'))
fs.copyFileSync(path.join(repo, 'assets/sky/portal_swirl.png'), path.join(project, 'assets/sky/portal_swirl.png'))
fs.mkdirSync(outDir, { recursive: true })

const env = { ...process.env, LINDEN_E2E: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({
  args: [path.join(repo, 'dist-electron/main.cjs'), `--user-data-dir=${path.join(work, 'userData')}`],
  cwd: repo,
  env,
})
// The game frame gets the debug flag before its scripts run
await app.context().addInitScript(() => {
  window.__LINDEN_DEBUG__ = true
})

let page = null
for (let i = 0; i < 120 && !page; i++) {
  page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? null
  if (!page) await new Promise((r) => setTimeout(r, 200))
}
if (!page) throw new Error('Editor window not found (start `npm run dev`)')
const rendererErrors = []
page.on('console', (m) => {
  if (m.type() === 'error' && !/Autofill/.test(m.text())) rendererErrors.push(m.text())
})

await page.waitForFunction(() => !!window.electronAPI, null, { timeout: 30000 })
await page.evaluate((p) => window.electronAPI.addRecentProject({ name: 'CosmicRift', path: p, lastOpened: Date.now() }), project)
await page.reload()
await page.waitForFunction(() => !!window.electronAPI)
await page.waitForTimeout(1500)

const bindStore = () =>
  page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/editor/store/editorStore.ts'))
    window.__store = (await import(url)).useEditorStore
  })
await bindStore()
await page.getByText('CosmicRift', { exact: true }).first().click()
await page.waitForFunction((p) => window.__store.getState().projectPath === p, project, { timeout: 20000 })
await page.waitForTimeout(1000)

const startPlay = () => page.evaluate(() => window.__store.getState().startPlay())
const gameFrame = async () => {
  for (let i = 0; i < 150; i++) {
    const f = page.frames().find((fr) => fr.url().startsWith('linden-game://'))
    if (f) {
      try {
        await f.waitForFunction(() => !!document.querySelector('#game-canvas'), null, { timeout: 5000 })
        const ready = await f.evaluate(() => !!window.__lindenPlayer)
        if (ready) return f
      } catch {
        /* frame was replaced while the runtime booted */
      }
    }
    await page.waitForTimeout(200)
  }
  throw new Error('Game Frame / __lindenPlayer not ready')
}

const probe = (frame) =>
  frame.evaluate(() => {
    const p = window.__lindenPlayer
    if (!p) return { ready: false }
    const world = p.world
    const bridge = p.bridge
    const ents = world.getEntities()
    const warden = ents.find((e) => e.name === 'Astral Warden')
    if (!warden) return { ready: false, count: ents.length }
    const anim = bridge.getAnimationPlayer(warden.id)
    const animator = warden.getComponent('CharacterAnimator')
    const mov = warden.getComponent('CharacterMovement')
    const tr = warden.getTransform()
    const s = world.getSceneSettings()
    const obj = bridge.getObject(warden.id)
    const bones = []
    if (obj) obj.traverse((o) => { if (o.isBone) bones.push([o.name, ...o.quaternion.toArray().map((v) => Math.round(v * 1000) / 1000)]) })
    return {
      ready: true,
      names: ents.map((e) => e.name),
      lights: ents.filter((e) => e.hasComponent('Light')).length,
      models: ents.filter((e) => e.hasComponent('Model')).length,
      particles: ents.filter((e) => e.hasComponent('ParticleEmitter')).length,
      clips: anim ? anim.getClipNames() : [],
      clip: anim ? anim.currentAnimation : null,
      time: anim ? anim.currentTime : 0,
      playing: anim ? anim.isPlaying : false,
      state: animator ? animator.currentState : null,
      speed: mov ? mov.speed : -1,
      grounded: mov ? mov.isGrounded : false,
      pos: { x: tr.position.x, y: tr.position.y, z: tr.position.z },
      env: s.environment,
      sky: s.skybox,
      fog: s.fog.enabled,
      grade: s.colorGrade.enabled,
      tone: s.toneMapping,
      bones,
      bg: (() => {
        const t = p.scene && p.scene.background
        if (!t) return null
        if (!t.isTexture) return { kind: t.type }
        return { w: t.image && t.image.width, h: t.image && t.image.height, mapping: t.mapping, minFilter: t.minFilter, blur: p.scene.backgroundBlurriness }
      })(),
    }
  })

const settle = async (frame, ms = 700) => {
  await page.waitForTimeout(ms)
  return probe(frame)
}

try {
  await startPlay()
  let frame = await gameFrame()
  // Character clips load asynchronously with the GLB
  await frame.waitForFunction(
    () => {
      const p = window.__lindenPlayer
      if (!p) return false
      const w = p.world.getEntities().find((e) => e.name === 'Astral Warden')
      if (!w) return false
      const a = p.bridge.getAnimationPlayer(w.id)
      return !!a && a.getClipNames().length >= 9
    },
    null,
    { timeout: 30000 }
  )
  const idle0 = await settle(frame, 1200)
  const idle1 = await settle(frame, 700)

  check('world entities loaded', idle0.ready && idle0.names.includes('Astral Warden') && idle0.names.includes('Rift Ground'), idle0.names.join(', '))
  check('HDR environment + textured sky dome loaded', idle0.env === 'assets/hdri/cosmic_rift.hdr' && idle0.sky === 'assets/sky/cosmic_sky.png', `${idle0.env} | skybox=${idle0.sky}`)
  check('environment lighting, fog and color grade active', idle0.fog && idle0.grade && idle0.tone === 'agx', `fog=${idle0.fog} grade=${idle0.grade} tone=${idle0.tone}`)
  check('environment props: portal, planet, rocks and particles', idle0.models >= 7 && idle0.particles >= 1 && idle0.lights >= 3, `models=${idle0.models} particles=${idle0.particles} lights=${idle0.lights}`)
  check('character has all 9 locomotion clips', ['Idle', 'Walk', 'Run', 'Jump_Start', 'Fall', 'Land', 'Crouch_Idle', 'Crouch_Walk', 'Attack'].every((c) => idle0.clips.includes(c)), idle0.clips.join(', '))
  check('character starts idle and grounded', idle0.state === 'idle' && idle0.clip === 'Idle' && idle0.grounded, `state=${idle0.state} clip=${idle0.clip} grounded=${idle0.grounded}`)
  check('idle animation is playing (clip loops)', idle1.playing && idle1.time !== idle0.time, `t ${idle0.time.toFixed(2)} -> ${idle1.time.toFixed(2)}`)
  check('skeleton bones actually move over time', JSON.stringify(idle0.bones) !== JSON.stringify(idle1.bones), `${idle0.bones.length} bones sampled`)

  const canvas = frame.locator('#game-canvas')
  await canvas.screenshot({ path: path.join(outDir, 'cosmic-rift-idle.png') })
  const idleShot = fs.statSync(path.join(outDir, 'cosmic-rift-idle.png')).size

  // Focus the game and walk forward (W = -Z, toward the gate)
  const iframe = page.locator('iframe[title="Game"]')
  await iframe.click({ position: { x: 200, y: 200 } })
  await iframe.focus()
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(900)
  const walking = await probe(frame)
  await canvas.screenshot({ path: path.join(outDir, 'cosmic-rift-walk.png') })
  await page.keyboard.up('KeyW')
  await page.waitForTimeout(500)
  const stopped = await probe(frame)
  const walked = idle1.pos.z - walking.pos.z

  check('W triggers walk animation + state', (walking.state === 'walk' || walking.state === 'run') && walking.clip === 'Walk', `state=${walking.state} clip=${walking.clip} speed=${walking.speed.toFixed(2)}`)
  check('character really moves in the world', walked > 1.5 && Math.abs(walking.pos.x - idle1.pos.x) < 1.5, `dz=${walked.toFixed(2)}`)
  check('character returns to idle after release', stopped.state === 'idle' && stopped.clip === 'Idle', `state=${stopped.state} clip=${stopped.clip}`)

  // Sprint
  await page.keyboard.down('ShiftLeft')
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(800)
  const running = await probe(frame)
  await page.keyboard.up('KeyW')
  await page.keyboard.up('ShiftLeft')
  await page.waitForTimeout(400)
  check('Shift+W switches to Run', running.state === 'run' && running.clip === 'Run' && running.speed > walking.speed, `state=${running.state} clip=${running.clip} speed=${running.speed.toFixed(2)} vs ${walking.speed.toFixed(2)}`)

  // Jump
  const beforeJump = await probe(frame)
  await page.keyboard.press('Space')
  let maxY = beforeJump.pos.y
  let sawAir = false
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(60)
    const p = await probe(frame)
    maxY = Math.max(maxY, p.pos.y)
    if (!p.grounded) sawAir = true
  }
  await page.waitForTimeout(700)
  const landed = await probe(frame)
  check('Space jumps and lands', sawAir && maxY - beforeJump.pos.y > 0.4 && landed.grounded, `rise=${(maxY - beforeJump.pos.y).toFixed(2)} grounded=${landed.grounded}`)

  const walkShot = fs.statSync(path.join(outDir, 'cosmic-rift-walk.png')).size
  check('rendered frames have content and differ', idleShot > 20000 && walkShot > 20000 && idleShot !== walkShot, `idle=${(idleShot / 1024).toFixed(0)}KB walk=${(walkShot / 1024).toFixed(0)}KB`)

  const consoleText = await page.evaluate(() => document.body.innerText)
  const loadErrors = [...rendererErrors, ...consoleText.split('\n')].filter((t) => /gagal dimuat|tidak valid|404 \(Not Found\)|Failed to fetch|has been removed/i.test(t))
  check('no asset/load errors in the console', loadErrors.length === 0, loadErrors.slice(0, 3).join(' | '))

  await page.evaluate(() => window.__store.getState().stopPlay())
} finally {
  await app.close()
  fs.rmSync(work, { recursive: true, force: true })
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed; screenshots in ${path.relative(repo, outDir)}`)
process.exit(failed.length ? 1 : 0)
