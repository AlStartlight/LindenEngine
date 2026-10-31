// Fails when any package in the dependency closure of the given roots is GPL/LGPL/AGPL licensed.
// Reads package-lock.json (lockfileVersion 3), so it checks exactly what npm installs.
//   node scripts/check-licenses.mjs                 -> checks the geometry stack roots below
//   node scripts/check-licenses.mjs pkg-a pkg-b     -> checks those roots
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Packages added for the modeling subsystem; all of them and their transitive deps must stay non-copyleft */
export const GEOMETRY_ROOTS = ['manifold-3d', 'meshoptimizer', 'draco3d', 'three-mesh-bvh']

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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const roots = process.argv.length > 2 ? process.argv.slice(2) : GEOMETRY_ROOTS
  const { checked, violations, excepted, unknown, missingRoots } = checkLicenses(roots)
  console.log(`checked ${checked} packages from: ${roots.join(', ')}`)
  if (missingRoots.length) console.log(`not installed (skipped): ${missingRoots.join(', ')}`)
  if (excepted.length) console.log(`approved exceptions (${excepted.length}): ${excepted.join(', ')}`)
  if (unknown.length) console.log(`no license field: ${unknown.join(', ')}`)
  if (violations.length) {
    console.error(`copyleft licenses found:\n  ${violations.join('\n  ')}`)
    process.exit(1)
  }
  console.log(excepted.length ? 'ok: no GPL/LGPL/AGPL packages outside the approved exceptions' : 'ok: no GPL/LGPL/AGPL packages')
}
