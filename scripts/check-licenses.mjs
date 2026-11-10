// Fails when any package in the dependency closure of the given roots is GPL/LGPL/AGPL licensed.
// Reads package-lock.json (lockfileVersion 3), so it checks exactly what npm installs.
//   node scripts/check-licenses.mjs                 -> checks the geometry stack roots below
//   node scripts/check-licenses.mjs pkg-a pkg-b     -> checks those roots
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Packages added for the modeling subsystem and NixieFX VFX; they and their transitive deps must stay non-copyleft */
export const GEOMETRY_ROOTS = ['manifold-3d', 'meshoptimizer', 'draco3d', 'three-mesh-bvh', 'nixie-fx']

/**
 * Approved exceptions (name prefix -> reason). Keep this list short and explicit.
 * manifold-3d >= 3.3.0 pulls sharp/libvips (LGPL-3.0) via @gltf-transform/functions -> ndarray-pixels,
 * only for its CAD/glTF tooling; the owner chose to stay on 3.5.4 (2026-10-31). Our code never imports it.
 */
export const APPROVED_EXCEPTIONS = {
  '@img/sharp-': 'transitive via manifold-3d -> @gltf-transform/functions -> ndarray-pixels -> sharp (approved 2026-10-31)',
}

const COPYLEFT = /\b(A|L)?GPL\b|GNU (Affero |Lesser )?General Public/i

/** npm's node_modules resolution over lockfile paths: nearest node_modules/<name> walking up */
function resolve(packages, fromPath, name) {
  let dir = fromPath
  for (;;) {
    const candidate = dir ? `${dir}/node_modules/${name}` : `node_modules/${name}`
    if (packages[candidate]) return candidate
    if (!dir) return null
    const idx = dir.lastIndexOf('/node_modules/')
    dir = idx >= 0 ? dir.slice(0, idx) : ''
  }
}

export function checkLicenses(roots = GEOMETRY_ROOTS, lockPath = path.join(root, 'package-lock.json')) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
  const packages = lock.packages ?? {}
  const seen = new Map()
  const missingRoots = []
  const stack = []
  for (const name of roots) {
    const p = resolve(packages, '', name)
    if (p) stack.push(p)
    else missingRoots.push(name)
  }
  while (stack.length) {
    const p = stack.pop()
    if (seen.has(p)) continue
    const entry = packages[p]
    seen.set(p, entry)
    const deps = { ...entry.dependencies, ...entry.optionalDependencies, ...entry.peerDependencies }
    for (const dep of Object.keys(deps)) {
      const r = resolve(packages, p, dep)
      if (r && !seen.has(r)) stack.push(r)
    }
  }
  const violations = []
  const excepted = []
  const unknown = []
  for (const [p, entry] of seen) {
    const name = p.slice(p.lastIndexOf('node_modules/') + 'node_modules/'.length)
    const license = typeof entry.license === 'string' ? entry.license : JSON.stringify(entry.license ?? null)
    if (!entry.license) unknown.push(`${name}@${entry.version}`)
    else if (COPYLEFT.test(license)) {
      const exception = Object.keys(APPROVED_EXCEPTIONS).find((prefix) => name.startsWith(prefix))
      if (exception) excepted.push(`${name}@${entry.version}`)
      else violations.push(`${name}@${entry.version} (${license})`)
    }
  }
  return { checked: seen.size, violations, excepted, unknown, missingRoots }
}

/** Non-npm code shipped with Linden (vendored copies), checked by their VENDOR.json + LICENSE */
export const VENDORED = ['resources/agent-skills/img2threejs']

export function checkVendored(dirs = VENDORED, base = root) {
  const violations = []
  const checked = []
  for (const rel of dirs) {
    const dir = path.join(base, rel)
    let license = null
    try {
      license = JSON.parse(readFileSync(path.join(dir, 'VENDOR.json'), 'utf8')).license ?? null
    } catch {
      violations.push(`${rel}: VENDOR.json tidak ada`)
      continue
    }
    let text = ''
    try {
      text = readFileSync(path.join(dir, 'LICENSE'), 'utf8')
    } catch {
      violations.push(`${rel}: LICENSE tidak ada`)
      continue
    }
    if (!license || COPYLEFT.test(license) || COPYLEFT.test(text.slice(0, 400))) violations.push(`${rel} (${license ?? 'unknown'})`)
    else checked.push(`${rel} (${license})`)
  }
  return { checked, violations }
}

/**
 * GPL code Linden ships but only runs in a separate program (never bundled, linked or imported):
 * blender-bridge/ runs inside the user's own Blender, started with spawn. Each folder must carry a
 * GPL LICENSE, and no source in the MIT code may import from it.
 */
export const SEPARATE_PROCESS_GPL = ['blender-bridge']
const SOURCE_DIRS = ['electron', 'editor', 'engine', 'shared', 'src', 'player']
const SOURCE_EXT = /\.(ts|tsx|js|mjs|cjs|jsx)$/

function listSources(dir) {
  let out = []
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out = out.concat(listSources(full))
    else if (SOURCE_EXT.test(name)) out.push(full)
  }
  return out
}

export function checkSeparateProcess(dirs = SEPARATE_PROCESS_GPL, base = root, sourceDirs = SOURCE_DIRS) {
  const violations = []
  const checked = []
  for (const rel of dirs) {
    let text = ''
    try {
      text = readFileSync(path.join(base, rel, 'LICENSE'), 'utf8')
    } catch {
      violations.push(`${rel}: LICENSE tidak ada`)
      continue
    }
    if (!/GNU GENERAL PUBLIC LICENSE/.test(text.slice(0, 400))) violations.push(`${rel}: LICENSE bukan GPL`)
    const importRe = new RegExp(`(?:from\\s*|import\\s*\\(\\s*|require\\s*\\(\\s*|import\\s+)['"][^'"]*\\b${rel}\\/`)
    for (const dir of sourceDirs) {
      for (const file of listSources(path.join(base, dir))) {
        if (importRe.test(readFileSync(file, 'utf8'))) violations.push(`${path.relative(base, file)} meng-import ${rel}/ (hanya boleh dijalankan sebagai proses terpisah)`)
      }
    }
    checked.push(`${rel} (GPL, spawn only)`)
  }
  return { checked, violations }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const roots = process.argv.length > 2 ? process.argv.slice(2) : GEOMETRY_ROOTS
  const { checked, violations, excepted, unknown, missingRoots } = checkLicenses(roots)
  console.log(`checked ${checked} packages from: ${roots.join(', ')}`)
  if (missingRoots.length) console.log(`not installed (skipped): ${missingRoots.join(', ')}`)
  if (excepted.length) console.log(`approved exceptions (${excepted.length}): ${excepted.join(', ')}`)
  if (unknown.length) console.log(`no license field: ${unknown.join(', ')}`)
  const vendored = checkVendored()
  if (vendored.checked.length) console.log(`vendored: ${vendored.checked.join(', ')}`)
  violations.push(...vendored.violations)
  const separate = checkSeparateProcess()
  if (separate.checked.length) console.log(`separate-process GPL: ${separate.checked.join(', ')}`)
  violations.push(...separate.violations)
  if (violations.length) {
    console.error(`copyleft licenses found:\n  ${violations.join('\n  ')}`)
    process.exit(1)
  }
  console.log(excepted.length ? 'ok: no GPL/LGPL/AGPL packages outside the approved exceptions' : 'ok: no GPL/LGPL/AGPL packages')
}
