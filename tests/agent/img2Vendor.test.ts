// Security regressions for the vendored img2threejs skill (docs/security/img2threejs/FINDINGS_TRIAGE.md)
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'
import { readVendorInfo, skillSourceDir } from '../../electron/agent/img2threejs'
import { resolvePython } from '../../electron/agent/pythonBinary'

const ROOT = path.resolve(__dirname, '..', '..')
const SKILL = skillSourceDir()
const FIXTURES = path.join(__dirname, '..', 'fixtures', 'img2threejs')
const MARK = /^__PWNED\d*__$/

/** Identifiers named __PWNED*__ in code (not in strings or comments), plus parse errors */
function injected(file: string): { lines: number[]; parseErrors: number } {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const lines: number[] = []
  const walk = (n: ts.Node) => {
    if (ts.isIdentifier(n) && MARK.test(n.text)) lines.push(sf.getLineAndCharacterOfPosition(n.getStart()).line + 1)
    ts.forEachChild(n, walk)
  }
  walk(sf)
  return { lines, parseErrors: (sf as any).parseDiagnostics.length }
}

describe('vendored img2threejs: provenance', () => {
  it('records the Linden security patches it was built with', () => {
    const info = readVendorInfo() as any
    expect(info.upstreamTreeSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(info.upstreamTreeSha256).not.toBe(info.treeSha256)
    const files = fs.readdirSync(path.join(ROOT, 'scripts/vendor-patches/img2threejs')).filter((f) => f.endsWith('.patch')).sort()
    expect(info.patches.map((p: any) => path.basename(p.file))).toEqual(files)
    for (const p of info.patches) {
      const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p.file))).digest('hex')
      expect(sha, `${p.file} changed after vendoring; re-run scripts/vendor-img2threejs.mjs`).toBe(p.sha256)
    }
  })

  it('contains no symlinks', () => {
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isSymbolicLink() ? [path.join(d, e.name)] : e.isDirectory() ? walk(path.join(d, e.name)) : []))
    expect(walk(SKILL)).toEqual([])
  })
})

// Spec text is untrusted (the agent writes it from an image). It must never become factory code.
describe('vendored img2threejs: spec text stays data in generated TypeScript', async () => {
  const python = await resolvePython()
  const run = python.bin ? it : it.skip
  let dir: string
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-img2-inject-'))
  })
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  const py = (args: string[], opts: { cwd?: string } = {}) =>
    spawnSync(python.bin!, ['-B', '-E', '-s', ...args], { encoding: 'utf-8', cwd: opts.cwd, env: { PATH: process.env.PATH ?? '', PYTHONUTF8: '1' } })

  run('factory generator: line breaks in targetName stay in the comment (\\n, \\r, U+2028)', () => {
    const spec = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'object-sculpt-spec.json'), 'utf-8'))
    spec.targetName = 'Mug\nglobalThis.__PWNED__ = 1; globalThis.__PWNED2__ = 1;\r//'
    const specFile = path.join(dir, 'spec.json')
    fs.writeFileSync(specFile, JSON.stringify(spec))
    const out = path.join(dir, 'createMugModel.ts')
    const r = py([path.join(SKILL, 'forge/stage3_build/generate_threejs_factory.py'), specFile, '--out', out, '--allow-nonstrict', '--force'])
    expect(r.status, r.stderr.slice(-400)).toBe(0)
    const res = injected(out)
    expect(res.lines).toEqual([])
    expect(res.parseErrors).toBe(0)
    // The value is still there, as data
    expect(fs.readFileSync(out, 'utf-8')).toMatch(/root\.name = "Mug\\nglobalThis\.__PWNED__/)
  })

  run('factory generator: a normal spec still produces the same factory as the test fixture', () => {
    const out = path.join(dir, 'createCeramicMugModel.ts')
    const r = py([path.join(SKILL, 'forge/stage3_build/generate_threejs_factory.py'), path.join(FIXTURES, 'object-sculpt-spec.json'), '--out', out, '--allow-nonstrict', '--force'])
    expect(r.status, r.stderr.slice(-400)).toBe(0)
    expect(fs.readFileSync(out, 'utf-8')).toBe(fs.readFileSync(path.join(FIXTURES, 'createCeramicMugModel.ts'), 'utf-8'))
  })

  run('rig emitter: a bone id containing a template token stays inside its string literal', () => {
    const script = `
import sys
sys.path.insert(0, sys.argv[1])
from stage5_rig.rig_spec import RigSpec, BoneSpec
from stage5_rig import emit_rig
bones = [
    BoneSpec(id="hips", parent=None, joint_pos=(0.0, 0.0, 0.0), component="body", role="skinned", chain="spine"),
    BoneSpec(id="tip__PARENT_JSON__", parent="hips", joint_pos=(0.0, 1.0, 0.0), component="body", role="skinned", chain="spine", tip_pos=(0.0, 2.0, 0.0)),
]
spec = RigSpec(version="1.0", bind_pose="A", forward="+Z", bones=bones)
open(sys.argv[2], "w").write(emit_rig.emit_typescript(spec, {"body": (0.6, 0.6)}, capsule_radius=0.2))
`
    const out = path.join(dir, 'rig.ts')
    const r = py(['-c', script, path.join(SKILL, 'forge'), out])
    expect(r.status, r.stderr.slice(-400)).toBe(0)
    const src = fs.readFileSync(out, 'utf-8')
    expect(src).toMatch(/export const BONE_IDS = \["hips", "tip__PARENT_JSON__"\];/)
    expect(injected(out).parseErrors).toBe(0)
  })
})
