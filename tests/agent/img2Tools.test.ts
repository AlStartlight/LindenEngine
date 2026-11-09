import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  BLOCKED_SCRIPTS,
  ensureSkillRuntime,
  skillTreeHash,
  isValidJobName,
  listAllowedScripts,
  normalizeScript,
  readSkillFile,
  resolveScriptArgs,
  setImg2RuntimeRoot,
  skillSourceDir,
  readVendorInfo,
} from '../../electron/agent/img2threejs'
import { isSupportedPython, parsePythonVersion, pythonDirs, pythonMissingMessage, resolvePython } from '../../electron/agent/pythonBinary'
import { IMG2_TOOLS, img2ScriptLabel, mergePatch } from '../../electron/agent/lindenTools/img2Tools'
import { LINDEN_TOOLS } from '../../electron/agent/lindenTools'

const SKILL = skillSourceDir()
const FIXTURES = path.join(__dirname, '..', 'fixtures', 'img2threejs')

describe('img2threejs vendored skill', () => {
  it('ships a pinned copy with its licence and no tests', () => {
    const info = readVendorInfo()
    expect(info?.skillVersion).toMatch(/^2\.0\./)
    expect(info?.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(fs.existsSync(path.join(SKILL, 'LICENSE'))).toBe(true)
    expect(fs.existsSync(path.join(SKILL, 'SKILL.md'))).toBe(true)
    expect(fs.existsSync(path.join(SKILL, 'forge', 'tests'))).toBe(false)
  })

  it('allows the pipeline scripts and blocks plugin/projection/vision ones', () => {
    const allowed = listAllowedScripts(SKILL)
    for (const s of ['next.py', 'state.py', 'stage1_intake/probe_image.py', 'stage2_spec/validate_sculpt_spec.py', 'stage3_build/generate_threejs_factory.py', 'stage4_review/make_comparison_sheet.py', 'stage4_review/append_review.py']) {
      expect(allowed).toContain(s)
    }
    for (const s of BLOCKED_SCRIPTS) expect(allowed).not.toContain(s)
    expect(allowed.some((s) => s.startsWith('_shared/') || s.startsWith('tests/'))).toBe(false)
  })

  it('reads SKILL.md and grimoire files only', () => {
    const skill = readSkillFile(SKILL, 'SKILL.md')
    expect(skill.text.slice(skill.notice!.length + 2)).toMatch(/^---\nname: img2threejs/)
    expect(readSkillFile(SKILL, 'grimoire/').text).toMatch(/intake\//)
    const head = readSkillFile(SKILL, 'SKILL.md', 1, 3)
    expect(head.text.slice(head.notice!.length + 2).split('\n')).toHaveLength(3)
    expect(() => readSkillFile(SKILL, '../package.json')).toThrow()
    expect(() => readSkillFile(SKILL, 'bin/img2threejs.mjs')).toThrow()
  })

  it('puts a Linden note above upstream install/plugin/showcase instructions', () => {
    // SKILL.md and docs/INSTALL.md tell the agent to run `npx --yes img2threejs@latest install`
    // (unpinned, edits ~/.claude/settings.json); the showcase prompts use .env files and npx tsc/vite
    for (const f of ['SKILL.md', 'docs/INSTALL.md', 'docs/PLUGINS.md', 'docs/GLB_CHARACTER_PROMPT.md', 'docs/GLB_CHARACTER_POLISH_PROMPT.md']) {
      const r = readSkillFile(SKILL, f)
      expect(r.notice, f).toMatch(/already installed in Linden/)
      expect(r.text.startsWith('[Linden]'), f).toBe(true)
      expect(r.notice).toMatch(/do not run npx/)
    }
    expect(readSkillFile(SKILL, 'docs/GLB_CHARACTER_PROMPT.md').notice).toMatch(/build-character\.sh/)
    expect(readSkillFile(SKILL, 'grimoire/intake/local_spec_search.md').notice).toBeUndefined()
  })
})

describe('img2threejs runtime copy integrity', () => {
  let root: string
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-img2-integrity-'))
  })
  afterAll(() => {
    setImg2RuntimeRoot(null)
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('hashes the tree like the vendor script, ignoring runtime-only files', () => {
    expect(skillTreeHash(SKILL)).toBe(readVendorInfo()!.treeSha256)
  })

  it('replaces a tampered copy and removes copies of other versions', async () => {
    setImg2RuntimeRoot(root)
    fs.mkdirSync(path.join(root, 'img2threejs-31d35868426f'), { recursive: true }) // an older, unpatched copy
    const dest = await ensureSkillRuntime()
    expect(path.basename(dest)).toBe(`img2threejs-${readVendorInfo()!.treeSha256!.slice(0, 12)}`)
    expect(fs.existsSync(path.join(root, 'img2threejs-31d35868426f'))).toBe(false)
    // spec-search writes its cache inside the copy: that is not tampering
    fs.mkdirSync(path.join(dest, '.cache'), { recursive: true })
    fs.writeFileSync(path.join(dest, '.cache', 'index.json'), '{}')
    expect(skillTreeHash(dest)).toBe(readVendorInfo()!.treeSha256)

    const gen = path.join(dest, 'forge', 'stage3_build', 'generate_threejs_factory.py')
    fs.appendFileSync(gen, '\nimport os  # tampered\n')
    setImg2RuntimeRoot(root) // forget the per-process memo, like a new app session
    const again = await ensureSkillRuntime()
    expect(again).toBe(dest)
    expect(fs.readFileSync(gen, 'utf-8')).not.toMatch(/tampered/)
  })
})

describe('linden_img2_run argument handling', () => {
  const project = path.resolve('/projects/game')
  const job = path.join(project, '.linden', 'img2threejs', 'mug')

  it('normalises script names and job slugs', () => {
    expect(normalizeScript('python3 forge/stage2_spec/new_sculpt_spec.py')).toBe('stage2_spec/new_sculpt_spec.py')
    expect(normalizeScript('./forge/next.py')).toBe('next.py')
    expect(isValidJobName('kursi-jati')).toBe(true)
    expect(isValidJobName('../x')).toBe(false)
    expect(isValidJobName('Kursi')).toBe(false)
    expect(img2ScriptLabel('forge/stage2_spec/validate_sculpt_spec.py')).toBe('Validasi spec')
  })

  it('maps relative paths to the job folder and named roots to the project or skill', () => {
    const r = resolveScriptArgs(project, 'mug', SKILL, [
      'Ceramic Mug',
      '--image',
      'references/mug.png',
      '--assessment',
      'assessment.json',
      '--out=object-sculpt-spec.json',
      '--layer-scores-json',
      '{"form":0.8}',
      '--complexity',
      'simple',
      '--capture',
      '90=right.png',
      'docs/materials/material-reference.json',
    ])
    expect(r.error).toBeUndefined()
    expect(r.args).toEqual([
      'Ceramic Mug',
      '--image',
      path.join(project, 'references', 'mug.png'),
      '--assessment',
      path.join(job, 'assessment.json'),
      `--out=${path.join(job, 'object-sculpt-spec.json')}`,
      '--layer-scores-json',
      '{"form":0.8}',
      '--complexity',
      'simple',
      '--capture',
      `90=${path.join(job, 'right.png')}`,
      path.join(path.resolve(SKILL), 'docs', 'materials', 'material-reference.json'),
    ])
    expect(r.out).toBe('.linden/img2threejs/mug/object-sculpt-spec.json')
  })

  it('refuses escapes, --target and skill files outside the reference folders', () => {
    expect(resolveScriptArgs(project, 'mug', SKILL, ['--out', '../../../../etc/x.json']).error).toMatch(/luar proyek/)
    expect(resolveScriptArgs(project, 'mug', SKILL, ['/etc/passwd']).error).toMatch(/luar proyek/)
    expect(resolveScriptArgs(project, 'mug', SKILL, ['--target', 'glb']).error).toMatch(/--target/)
    expect(resolveScriptArgs(project, 'mug', SKILL, ['--target=glb']).error).toMatch(/--target/)
    expect(resolveScriptArgs(project, 'mug', SKILL, [path.join(SKILL, 'VENDOR.json')]).error).toMatch(/grimoire/)
  })
})

describe('Python resolver', () => {
  it('parses and gates versions', () => {
    expect(parsePythonVersion('3.12.4\n')).toBe('3.12.4')
    expect(isSupportedPython('3.9.6')).toBe(false)
    expect(isSupportedPython('3.10.0')).toBe(true)
    expect(isSupportedPython('4.0.0')).toBe(true)
    expect(isSupportedPython(null)).toBe(false)
  })

  it('searches pyenv, uv and python.org folders', () => {
    const dirs = pythonDirs('/home/u', 'linux', {}, (d) => (d.endsWith(path.join('uv', 'python')) ? ['cpython-3.12.4-linux-x86_64-gnu', 'cpython-3.11.9-linux'] : []))
    expect(dirs).toContain(path.join('/home/u', '.pyenv', 'shims'))
    const uv = path.join('/home/u', '.local', 'share', 'uv', 'python')
    expect(dirs.indexOf(path.join(uv, 'cpython-3.12.4-linux-x86_64-gnu', 'bin'))).toBeLessThan(dirs.indexOf(path.join(uv, 'cpython-3.11.9-linux', 'bin')))
    const win = pythonDirs('C:\\Users\\u', 'win32', { LOCALAPPDATA: 'C:\\L' }, (d) => (d.endsWith('Python') ? ['Python39', 'Python312'] : []))
    expect(win.some((d) => d.endsWith('Python312'))).toBe(true)
  })

  it('explains what to install', () => {
    expect(pythonMissingMessage([{ bin: '/usr/bin/python3', version: '3.9.6' }])).toMatch(/3\.9\.6.*LINDEN_PYTHON/s)
  })
})

describe('img2 tools (optional skill, off by default)', () => {
  it('are not given to the agent unless LINDEN_IMG2THREEJS=1', () => {
    expect(process.env.LINDEN_IMG2THREEJS).toBeUndefined()
    expect(Object.keys(LINDEN_TOOLS).filter((n) => n.startsWith('linden_img2_'))).toEqual([])
    expect(LINDEN_TOOLS.linden_model_bake_glb).toBeDefined()
  })

  it('still exist as a module for the opt-in mode', () => {
    for (const name of ['linden_img2_run', 'linden_img2_read', 'linden_img2_write', 'linden_img2_status']) expect(IMG2_TOOLS[name]).toBeDefined()
  })

  it('the shipped prompt describes the native workflow and never the img2 tools', () => {
    const prompt = fs.readFileSync(path.join(__dirname, '..', '..', 'electron/agent/prompts/linden.md'), 'utf-8')
    expect(prompt).toMatch(/## 7\. Rebuilding an object from a reference image\n/)
    expect(prompt).toMatch(/linden_reference_view/)
    expect(prompt).toMatch(/linden_factory_write/)
    expect(prompt).not.toMatch(/linden_img2_|img2threejs/)
    const optional = fs.readFileSync(path.join(__dirname, '..', '..', 'electron/agent/prompts/img2threejs.md'), 'utf-8')
    expect(optional).toMatch(/LINDEN_IMG2THREEJS=1/)
  })
})

describe('linden_img2_write', () => {
  let project: string
  beforeAll(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-img2-write-'))
  })
  afterAll(() => fs.rmSync(project, { recursive: true, force: true }))
  const write = (args: any, onDiff?: (d: any) => void) => IMG2_TOOLS.linden_img2_write.execute(project, args, { onDiff })

  it('writes and merge-patches job files, with a diff', async () => {
    const diffs: any[] = []
    const a = await write({ job: 'mug', path: 'object-sculpt-spec.json', content: JSON.stringify({ targetName: 'Mug', materials: [{ id: 'a' }], scores: { x: 1, y: 2 } }) }, (d) => diffs.push(d))
    expect(a.success).toBe(true)
    const b = await write({ job: 'mug', path: 'object-sculpt-spec.json', patch: { materials: [{ id: 'b' }], scores: { y: null, z: 3 } } }, (d) => diffs.push(d))
    expect(b.success).toBe(true)
    const spec = JSON.parse(fs.readFileSync(path.join(project, '.linden/img2threejs/mug/object-sculpt-spec.json'), 'utf-8'))
    expect(spec).toEqual({ targetName: 'Mug', materials: [{ id: 'b' }], scores: { x: 1, z: 3 } })
    expect(diffs.map((d) => d.action)).toEqual(['create', 'modify'])
    expect(mergePatch({ a: [1] }, { a: [2] })).toEqual({ a: [2] })
  })

  it('refuses other files, escapes and bad JSON', async () => {
    expect((await write({ job: 'mug', path: '../../x.json', content: '{}' })).error).toMatch(/folder job/)
    expect((await write({ job: 'mug', path: 'x.py', content: '' })).error).toMatch(/json/)
    expect((await write({ job: 'mug', path: 'x.json', content: '{' })).error).toMatch(/JSON tidak valid/)
    expect((await write({ job: 'mug', path: 'new.json', patch: {} })).error).toMatch(/belum ada/)
  })
})

// Real runs of the vendored forge scripts; needs Python >= 3.10 (skipped otherwise)
describe('linden_img2_run with Python', async () => {
  const python = await resolvePython()
  const run = python.bin ? it : it.skip
  let project: string
  let runtime: string

  beforeAll(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-img2-'))
    runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-img2-runtime-'))
    setImg2RuntimeRoot(runtime)
    fs.mkdirSync(path.join(project, 'references'), { recursive: true })
    fs.copyFileSync(path.join(FIXTURES, 'mug.png'), path.join(project, 'references', 'mug.png'))
    fs.writeFileSync(path.join(project, 'project.linden.json'), '{"name":"t"}')
  })
  afterAll(() => {
    setImg2RuntimeRoot(null)
    fs.rmSync(project, { recursive: true, force: true })
    fs.rmSync(runtime, { recursive: true, force: true })
  })

  const tool = (args: any, onDiff?: (d: any) => void) => IMG2_TOOLS.linden_img2_run.execute(project, args, { onDiff })

  run(
    'runs the intake, spec and gate steps in the job folder without touching the vendored copy',
    async () => {
      const sourceBefore = fs.readdirSync(SKILL).sort()

      const status = await IMG2_TOOLS.linden_img2_status.execute(project, {})
      expect(status.data.ready).toBe(true)

      const init = await tool({ job: 'mug', script: 'state.py', args: ['init', '--state', '.img2threejs/state.json', '--reference', 'references/mug.png', '--profile', 'generic', '--spec', 'object-sculpt-spec.json'] })
      expect(init.success).toBe(true)
      expect(init.data.exitCode).toBe(0)
      expect(fs.existsSync(path.join(project, '.linden/img2threejs/mug/.img2threejs/state.json'))).toBe(true)

      const next = await tool({ job: 'mug', script: 'forge/next.py', args: ['--state', '.img2threejs/state.json'] })
      expect(next.data.hardStop).toBe(false)
      expect(next.data.stdout).toMatch(/image-analysis/)

      const probe = await tool({ job: 'mug', script: 'stage1_intake/probe_image.py', args: ['references/mug.png'] })
      expect(JSON.parse(probe.data.stdout).width).toBe(256)

      const assess = await tool({ job: 'mug', script: 'stage2_spec/new_pre_spec_assessment.py', args: ['Ceramic Mug', '--image', 'references/mug.png', '--complexity', 'simple', '--out', 'assessment.json'] })
      expect(assess.data.exitCode).toBe(0)
      const spec = await tool({ job: 'mug', script: 'stage2_spec/new_sculpt_spec.py', args: ['Ceramic Mug', '--image', 'references/mug.png', '--assessment', 'assessment.json', '--out', 'object-sculpt-spec.json'] })
      expect(spec.data.exitCode).toBe(0)
      expect(spec.data.files).toContain('.linden/img2threejs/mug/object-sculpt-spec.json')

      // A scaffold spec is shallow: the strict gate and the fail-closed generator block it
      const strict = await tool({ job: 'mug', script: 'stage2_spec/validate_sculpt_spec.py', args: ['object-sculpt-spec.json', '--strict-quality'] })
      expect(strict.data.exitCode).not.toBe(0)
      expect(strict.data.stdout + strict.data.stderr).toMatch(/strict quality failure/)
      const diffs: any[] = []
      const gen = await tool({ job: 'mug', script: 'stage3_build/generate_threejs_factory.py', args: ['object-sculpt-spec.json', '--out', 'models/mug/createCeramicMugModel.ts'] }, (d) => diffs.push(d))
      expect(gen.data.exitCode).not.toBe(0)
      expect(fs.existsSync(path.join(project, 'models/mug/createCeramicMugModel.ts'))).toBe(false)
      expect(diffs).toHaveLength(0)

      // Comparison sheet comes back as an image for the agent to judge
      const sheet = await tool({ job: 'mug', script: 'stage4_review/make_comparison_sheet.py', args: ['--reference', 'references/mug.png', '--render', 'references/mug.png', '--out', 'cmp.png', '--json'] })
      expect(sheet.data.exitCode).toBe(0)
      expect(sheet.images?.[0]?.mimeType).toBe('image/png')

      expect(fs.readdirSync(SKILL).sort()).toEqual(sourceBefore)
      expect(fs.existsSync(path.join(SKILL, '.cache'))).toBe(false)
    },
    120_000
  )

  run('refuses unsafe runs', async () => {
    expect((await tool({ job: 'mug', script: 'stage3_build/emit_target.py', args: [] })).error).toMatch(/tidak didukung/)
    expect((await tool({ job: 'mug', script: 'stage3_build/generate_threejs_factory.py', args: ['s.json', '--out', 'src/x.ts'] })).error).toMatch(/models\//)
    expect((await tool({ job: 'mug', script: 'stage3_build/generate_threejs_factory.py', args: ['s.json', '--out', 'models/x.ts', '--allow-nonstrict'] })).error).toMatch(/fixture/)
    expect((await tool({ job: 'mug', script: 'stage1_intake/probe_image.py', args: ['../../../../outside.png'] })).error).toMatch(/luar proyek/)
    expect((await tool({ job: '../evil', script: 'next.py' })).error).toMatch(/slug/)
    const read = await IMG2_TOOLS.linden_img2_read.execute(project, { path: 'grimoire/scripts.md', maxLines: 5 })
    expect(read.success).toBe(true)
  })
})
