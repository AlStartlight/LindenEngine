#!/usr/bin/env node
/**
 * LindenEngine Integrated Security Scanner
 *
 * Checks:
 *  1. Non-copyleft license check (checkLicenses)
 *  2. Agent skills security check (check-skills.mjs if skillspector is available)
 *  3. Static code patterns guard:
 *     - nodeIntegration: true
 *     - contextIsolation: false
 *     - shell: true in child_process calls
 *
 * Usage:
 *   node scripts/security-scan.mjs
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkLicenses, GEOMETRY_ROOTS } from './check-licenses.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

console.log('=== LindenEngine Security Vulnerability & Compliance Scan ===\n')

let hasFailure = false

// 1. License Check
console.log('1. Checking dependency licenses for copyleft restrictions...')
try {
  const licenseResult = checkLicenses(GEOMETRY_ROOTS)
  if (licenseResult.violations && licenseResult.violations.length > 0) {
    console.error('❌ License violations found:')
    for (const v of licenseResult.violations) {
      console.error(`   - ${v.name}: ${v.license}`)
    }
    hasFailure = true
  } else {
    console.log('✅ License check passed (no forbidden copyleft packages in critical roots).')
  }
} catch (err) {
  console.error(`❌ Failed to run license check: ${err.message}`)
  hasFailure = true
}

// 2. Static Code Security Checks (SAST - Electron Best Practices)
console.log('\n2. Scanning codebase for insecure Electron patterns...')
const DANGEROUS_PATTERNS = [
  {
    regex: /nodeIntegration\s*:\s*true/g,
    name: 'nodeIntegration enabled',
    severity: 'CRITICAL',
    description: 'nodeIntegration should always be false in renderers.',
  },
  {
    regex: /contextIsolation\s*:\s*false/g,
    name: 'contextIsolation disabled',
    severity: 'CRITICAL',
    description: 'contextIsolation must always be true.',
  },
  {
    regex: /shell\s*:\s*true/g,
    name: 'shell: true in subprocess spawn/exec',
    severity: 'HIGH',
    description: 'Avoid spawning processes with shell: true to prevent command injection.',
  },
]

const SCAN_DIRS = ['electron', 'engine', 'editor', 'shared', 'src']
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs'])

function scanDirectory(dir, issues = []) {
  const fullDir = path.join(ROOT, dir)
  try {
    const entries = readdirSync(fullDir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(fullDir, entry.name)
      const relPath = path.relative(ROOT, fullPath)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'dist' && !entry.name.startsWith('.')) {
          scanDirectory(relPath, issues)
        }
      } else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) {
        const content = readFileSync(fullPath, 'utf8')
        const lines = content.split('\n')
        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
          const line = lines[lineIdx]
          for (const pattern of DANGEROUS_PATTERNS) {
            pattern.regex.lastIndex = 0
            if (pattern.regex.test(line)) {
              issues.push({
                file: relPath,
                line: lineIdx + 1,
                snippet: line.trim(),
                ...pattern,
              })
            }
          }
        }
      }
    }
  } catch (err) {
    // Directory might not exist in some configs
  }
  return issues
}

const staticIssues = []
for (const dir of SCAN_DIRS) {
  scanDirectory(dir, staticIssues)
}

if (staticIssues.length > 0) {
  console.error(`❌ Found ${staticIssues.length} suspicious static code pattern(s):`)
  for (const issue of staticIssues) {
    console.error(`   [${issue.severity}] ${issue.name} in ${issue.file}:${issue.line}`)
    console.error(`     > ${issue.snippet}`)
    console.error(`     Mitigation: ${issue.description}\n`)
  }
  // Mark failure if critical
  if (staticIssues.some((i) => i.severity === 'CRITICAL')) {
    hasFailure = true
  }
} else {
  console.log('✅ Static pattern check passed (no nodeIntegration:true, contextIsolation:false, or shell:true found).')
}

// 3. Agent Skills Check (if SkillSpector is available)
console.log('\n3. Checking agent skill security baseline...')
const skillCheckResult = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-skills.mjs')], {
  encoding: 'utf-8',
})
if (skillCheckResult.status === 2) {
  console.log('ℹ️  SkillSpector is not installed locally. Skipping skillspector check (install to enable in local dev).')
} else if (skillCheckResult.status !== 0) {
  console.error('❌ Skill security check failed:')
  console.error(skillCheckResult.stdout || skillCheckResult.stderr)
  hasFailure = true
} else {
  console.log('✅ Agent skills baseline check passed.')
}

console.log('\n======================================================')
if (hasFailure) {
  console.error('❌ Security check completed with issues that need attention.')
  process.exit(1)
} else {
  console.log('✅ All pre-flight security checks passed successfully!')
  process.exit(0)
}
