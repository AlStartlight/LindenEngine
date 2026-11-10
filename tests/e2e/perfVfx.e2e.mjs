// Perf harness (SPEC-Fix-VFX-Kill-Stutter M0/M6): frame times around ctx.vfx.spawn in the real
// editor (Play). Needs the Vite dev server. Usage:
//   node tests/e2e/perfVfx.e2e.mjs '{"renderer":"webgpu","quality":"medium","postFx":true,"preset":"explosion"}'

import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const repo = process.cwd()
const variant = JSON.parse(process.argv[2])
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-perf-'))
const project = path.join(work, 'PerfGame')
const write = (rel, c) => { fs.mkdirSync(path.dirname(path.join(project, rel)), { recursive: true }); fs.writeFileSync(path.join(project, rel), c) }
write('project.linden.json', JSON.stringify({ name: 'PerfGame', version: '0.1.0', renderer: variant.renderer, quality: variant.quality, scenesInBuild: ['scenes/Main.lscene'] }))
write('scripts/Probe.ts', `export default class Probe {
  ctx: any; last = 0; t0 = 0; marks: any[] = []; frames: number[] = []; n = 0; done = false
  onInit(ctx: any) { this.ctx = ctx; this.t0 = performance.now(); ctx.ui.bind('#out', () => this.done ? JSON.stringify(this.result()) : '') }
  onUpdate() {
    const now = performance.now()
    if (this.last) this.frames.push(now - this.last)
    this.last = now
    const t = (now - this.t0) / 1000
    if (t > 3 && this.n < 8 && t > 3 + this.n * 2) {
      const preset = ${JSON.stringify(variant.preset)}
      this.marks.push({ i: this.frames.length, preset })
      this.ctx.vfx.spawn(preset, { x: (this.n % 4) * 2 - 3, y: 1.5, z: 0 })
      this.n++
    }
    if (t > 3 + 8 * 2 + 1) this.done = true
  }
  result() {
    const f = this.frames
    const win = (a: number, b: number) => Math.max(0, ...f.slice(Math.max(0, a), Math.max(0, b)))
    const per = this.marks.map((m: any) => ({ spawn: +win(m.i, m.i + 12).toFixed(1), dispose: +win(m.i + 60, m.i + 110).toFixed(1) }))
    const base = f.slice(Math.min(30, Math.max(0, (this.marks[0]?.i ?? 60) - 10)), this.marks[0]?.i ?? 120)
    const sorted = [...f.slice(this.marks[0]?.i ?? 0)].sort((a, b) => a - b)
    return { baseMax: +Math.max(...base).toFixed(1), baseAvg: +(base.reduce((a, b) => a + b, 0) / base.length).toFixed(1), per, p99: +sorted[Math.floor(sorted.length * 0.99)].toFixed(1), over33: sorted.filter((x) => x > 33).length }
  }
}
`)
write('ui/hud.html', '<div style="position:absolute;top:2px;left:2px;font:10px monospace;color:#fff"><span id="out"></span></div>')
const ents = []
const e = (id, name, comps, parentId = null) => ents.push({ id, name, active: true, static: false, tags: [], layer: 0, parentId, components: [{ type: 'Transform', data: { position: comps.p ?? [0, 0, 0], rotation: comps.r ?? [0, 0, 0], scale: comps.s ?? [1, 1, 1] } }, ...comps.c] })
e('cam', 'Cam', { p: [0, 8, 16], r: [-25, 0, 0], c: [{ type: 'Camera', data: { fov: 60, near: 0.1, far: 500, isActive: true } }] })
e('sun', 'Sun', { r: [-50, 30, 0], c: [{ type: 'Light', data: { lightType: 'directional', intensity: 2, castShadows: true } }] })
e('ground', 'Ground', { p: [0, -0.5, 0], s: [80, 1, 80], c: [{ type: 'MeshRenderer', data: { primitive: 'box', color: '#556655' } }] })
const colors = ['#c0392b', '#2980b9', '#27ae60', '#8e44ad', '#d35400', '#7f8c8d']
for (let i = 0; i < 60; i++) e(`m${i}`, `Mech ${i}`, { p: [(i % 10) * 3 - 14, 1, -Math.floor(i / 10) * 3 - 2], c: [{ type: 'MeshRenderer', data: { primitive: i % 2 ? 'box' : 'cylinder', color: colors[i % 6], metalness: 0.4, roughness: 0.5 } }] })
e('probe', 'Probe', { c: [{ type: 'Script', data: { src: 'scripts/Probe.ts', props: {} } }, { type: 'HtmlUI', data: { src: 'ui/hud.html', mode: 'screen', zIndex: 0, pointerEvents: false, pixelSize: 0.01 } }] })
const settings = variant.postFx ? { postFx: { enabled: true, antialias: 'smaa', ao: true, aoIntensity: 0.6, bloom: true, bloomStrength: 0.4, bloomRadius: 0.4, bloomThreshold: 0.9 } } : { postFx: { enabled: false } }
write('scenes/Main.lscene', JSON.stringify({ format: 'linden-scene', version: 2, name: 'Main', settings, entities: ents }))

const app = await electron.launch({ args: [path.join(repo, 'dist-electron/main.cjs'), `--user-data-dir=${path.join(work, 'userData')}`], cwd: repo })
let page = null
for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? null; if (!page) await new Promise((r) => setTimeout(r, 200)) }
await page.waitForFunction(() => !!window.electronAPI, null, { timeout: 30000 })
await page.evaluate(async () => { const url = performance.getEntriesByType('resource').map((x) => x.name).find((n) => n.includes('/editor/store/editorStore.ts')); window.__store = (await import(url)).useEditorStore })
await page.evaluate((p) => window.electronAPI.addRecentProject({ name: 'PerfGame', path: p, lastOpened: Date.now() }), project)
await page.reload(); await page.waitForFunction(() => !!window.electronAPI); await page.waitForTimeout(1500)
await page.evaluate(async () => { const url = performance.getEntriesByType('resource').map((x) => x.name).find((n) => n.includes('/editor/store/editorStore.ts')); window.__store = (await import(url)).useEditorStore })
await page.getByText('PerfGame', { exact: true }).first().click()
await page.waitForFunction((p) => window.__store.getState().projectPath === p, project, { timeout: 15000 })
await page.waitForTimeout(800)
await page.evaluate(() => window.__store.getState().startPlay())
let out = ''
for (let i = 0; i < 160 && !out; i++) {
  await page.waitForTimeout(250)
  const f = page.frames().find((fr) => fr.url().startsWith('linden-game://'))
  if (f) out = await f.evaluate(() => document.querySelector('#linden-ui-root > div')?.shadowRoot?.querySelector('#out')?.textContent ?? '').catch(() => '')
}
const stats = await page.evaluate(() => document.body.innerText.match(/(WebGPU|WebGL2?)/i)?.[0] ?? '?')
console.log(JSON.stringify({ variant, renderer: stats, result: out ? JSON.parse(out) : null }))
await app.close()
fs.rmSync(work, { recursive: true, force: true })
