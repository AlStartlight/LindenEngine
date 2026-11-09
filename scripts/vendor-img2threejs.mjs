#!/usr/bin/env node
/**
 * Vendor a pinned, trimmed copy of img2threejs (https://github.com/img2threejs/img2threejs) into
 * resources/agent-skills/img2threejs. Linden Agent runs its forge scripts through linden_img2_run.
 *
 *   node scripts/vendor-img2threejs.mjs --ref <tag|branch|commit>   download from GitHub
 *   node scripts/vendor-img2threejs.mjs --from <checkout>           copy a local checkout (offline)
 *   add --test to run upstream forge/tests on the new copy before it replaces the old one
 *
 * Upgrades are deliberate: the script prints the SKILL.md diff so the change can be reviewed.
 * Linden security patches in scripts/vendor-patches/img2threejs/ are applied after trimming; an
 * upgrade where one no longer applies fails. After an upgrade, run `npm run check:skills`.
 * See docs/specs/SPEC-Img2ThreeJS-Agent.md.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = 'img2threejs/img2threejs'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEST = path.join(ROOT, 'resources', 'agent-skills', 'img2threejs')
const PATCH_DIR = path.join(ROOT, 'scripts', 'vendor-patches', 'img2threejs')

/** What Linden ships: the router, the scripts (no tests) and the docs SKILL.md points at */
const KEEP = ['SKILL.md', 'LICENSE', 'CHANGELOG.md', 'forge', 'grimoire', 'docs']
const DROP = [/(^|\/)__pycache__(\/|$)/, /^forge\/tests(\/|$)/, /\.pyc$/, /(^|\/)\.DS_Store$/]

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function copyTree(src, dst, rel = '') {
  // lstat: a symlink in the upstream tree must not pull a file from this machine into the repo
  const st = fs.lstatSync(src)
  if (DROP.some((re) => re.test(rel))) return
  if (st.isSymbolicLink()) throw new Error(`Upstream contains a symlink (${rel}); refusing to vendor it`)
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true })
    for (const name of fs.readdirSync(src)) copyTree(path.join(src, name), path.join(dst, name), rel ? `${rel}/${name}` : name)
  } else if (st.isFile()) {
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(src, dst)
  }
}

function hashTree(dir) {
  const h = crypto.createHash('sha256')
  const walk = (d, rel) => {
    for (const name of fs.readdirSync(d).sort()) {
      const full = path.join(d, name)
      const r = rel ? `${rel}/${name}` : name
      if (r === 'VENDOR.json') continue
      if (fs.statSync(full).isDirectory()) walk(full, r)
      else h.update(r).update('\0').update(fs.readFileSync(full))
    }
  }
  walk(dir, '')
  return h.digest('hex')
}

function findPython() {
  const names = process.env.LINDEN_PYTHON ? [process.env.LINDEN_PYTHON] : ['python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3', 'python']
  for (const n of names) {
    const r = spawnSync(n, ['-c', 'import sys;print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf-8' })
    if (r.status !== 0) continue
    const [maj, min] = r.stdout.trim().split('.').map(Number)
    if (maj > 3 || (maj === 3 && min >= 10)) return n
  }
  return null
}

function skillVersion(dir) {
  const m = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf-8').match(/^version:\s*(\S+)/m)
  return m ? m[1] : null
}

async function main() {
  const ref = arg('--ref')
  const from = arg('--from')
  if (!ref && !from) {
    console.error('Usage: node scripts/vendor-img2threejs.mjs (--ref <tag|commit> | --from <checkout>) [--test]')
    process.exit(2)
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'img2threejs-vendor-'))
  let source = from ? path.resolve(from) : null
  let commit = null
  let tarballSha256 = null
  try {
    if (!source) {
      const api = await fetch(`https://api.github.com/repos/${REPO}/commits/${encodeURIComponent(ref)}`, { headers: { Accept: 'application/vnd.github+json' } })
      if (!api.ok) throw new Error(`Cannot resolve ref ${ref}: HTTP ${api.status}`)
      commit = (await api.json()).sha
      const res = await fetch(`https://codeload.github.com/${REPO}/tar.gz/${commit}`)
      if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      tarballSha256 = crypto.createHash('sha256').update(buf).digest('hex')
      const tgz = path.join(work, 'src.tar.gz')
      fs.writeFileSync(tgz, buf)
      const out = path.join(work, 'src')
      fs.mkdirSync(out)
      execFileSync('tar', ['-xzf', tgz, '-C', out, '--strip-components=1'])
      source = out
    } else {
      try {
        commit = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim()
      } catch {
        commit = null
      }
    }

    for (const k of ['SKILL.md', 'forge', 'grimoire']) {
      if (!fs.existsSync(path.join(source, k))) throw new Error(`${source} does not look like img2threejs (missing ${k})`)
    }

    if (process.argv.includes('--test')) {
      const py = findPython()
      if (!py) throw new Error('--test needs Python >= 3.10 (set LINDEN_PYTHON)')
      console.log(`Running upstream forge/tests with ${py} ...`)
      const r = spawnSync(py, ['-m', 'unittest', 'discover', '-s', 'forge/tests'], { cwd: source, stdio: 'inherit', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
      if (r.status !== 0) throw new Error('Upstream tests failed; the vendored copy was not replaced')
    }

    const staged = path.join(work, 'staged')
    for (const k of KEEP) {
      const s = path.join(source, k)
      if (fs.existsSync(s)) copyTree(s, path.join(staged, k), k)
    }

    // Linden security patches (scripts/vendor-patches/img2threejs/*.patch), applied in order on the
    // trimmed upstream tree. A patch that no longer applies stops the upgrade: re-check whether
    // upstream fixed the issue, then update or drop the patch (docs/security/img2threejs/).
    const upstreamTreeSha256 = hashTree(staged)
    const patches = []
    const patchFiles = fs.existsSync(PATCH_DIR) ? fs.readdirSync(PATCH_DIR).filter((f) => f.endsWith('.patch')).sort() : []
    for (const f of patchFiles) {
      const full = path.join(PATCH_DIR, f)
      const r = spawnSync('git', ['apply', '--whitespace=nowarn', full], { cwd: staged, encoding: 'utf-8' })
      if (r.status !== 0) throw new Error(`Patch ${f} does not apply to this upstream version:\n${r.stderr}`)
      patches.push({ file: path.relative(ROOT, full), sha256: crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex') })
      console.log(`Applied ${f}`)
    }

    const oldSkill = fs.existsSync(path.join(DEST, 'SKILL.md')) ? fs.readFileSync(path.join(DEST, 'SKILL.md'), 'utf-8') : null
    const vendor = {
      repo: `https://github.com/${REPO}`,
      ref: ref ?? null,
      commit,
      skillVersion: skillVersion(staged),
      fetchedAt: new Date().toISOString(),
      tarballSha256,
      upstreamTreeSha256,
      patches,
      treeSha256: hashTree(staged),
      license: 'Apache-2.0',
      kept: KEEP,
      note: 'Trimmed copy with Linden security patches; forge/tests, assets, integrations, bin and CI files are not shipped. Regenerate with scripts/vendor-img2threejs.mjs; do not edit files here by hand (tests/agent/img2Vendor.test.ts checks treeSha256).',
    }
    fs.writeFileSync(path.join(staged, 'VENDOR.json'), JSON.stringify(vendor, null, 2) + '\n')

    fs.rmSync(DEST, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(DEST), { recursive: true })
    fs.cpSync(staged, DEST, { recursive: true })

    if (oldSkill !== null) {
      const tmpOld = path.join(work, 'SKILL.old.md')
      fs.writeFileSync(tmpOld, oldSkill)
      const d = spawnSync('git', ['diff', '--no-index', '--stat', '--', tmpOld, path.join(DEST, 'SKILL.md')], { encoding: 'utf-8' })
      console.log(d.stdout || 'SKILL.md unchanged')
    }
    console.log(`Vendored img2threejs ${vendor.skillVersion} (${commit ?? 'local'}) into ${path.relative(ROOT, DEST)}`)
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
