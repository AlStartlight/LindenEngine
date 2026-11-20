import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 1. Patch minimatch dist/commonjs/index.js if needed
const minimatchCjs = path.resolve(__dirname, '../node_modules/minimatch/dist/commonjs/index.js')
if (fs.existsSync(minimatchCjs)) {
  const content = fs.readFileSync(minimatchCjs, 'utf-8')
  if (!content.includes('module.exports = Object.assign(minimatch, exports)')) {
    const target = 'exports.minimatch.unescape = unescape_js_1.unescape;'
    if (content.includes(target)) {
      const patched = content.replace(target, `${target}\nmodule.exports = Object.assign(minimatch, exports);`)
      fs.writeFileSync(minimatchCjs, patched, 'utf-8')
    }
  }
}

// 2. Defensively patch nodemon match.js if present
const nodemonMatch = path.resolve(__dirname, '../node_modules/nodemon/lib/monitor/match.js')
if (fs.existsSync(nodemonMatch)) {
  const content = fs.readFileSync(nodemonMatch, 'utf-8')
  if (!content.includes('typeof _minimatch')) {
    const target = "const minimatch = require('minimatch');"
    const replacement = "const _minimatch = require('minimatch');\nconst minimatch = typeof _minimatch === 'function' ? _minimatch : (_minimatch.minimatch || _minimatch.default);"
    if (content.includes(target)) {
      fs.writeFileSync(nodemonMatch, content.replace(target, replacement), 'utf-8')
    }
  }
}
