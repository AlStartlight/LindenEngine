// Renames dist-electron/*.js to *.cjs (package.json is "type": "module").
// Plain Node instead of a shell loop so it also runs under cmd.exe on Windows.
import { readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

const dir = 'dist-electron'
for (const file of readdirSync(dir)) {
  if (file.endsWith('.js')) renameSync(join(dir, file), join(dir, file.replace(/\.js$/, '.cjs')))
}
