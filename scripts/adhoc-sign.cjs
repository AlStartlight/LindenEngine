// electron-builder afterSign hook: ad-hoc signs the macOS app when no Developer ID
// certificate signed it. Runs before the .dmg/.zip are created, so both ship the signed app.
// Ad-hoc signing avoids the "app is damaged" error on Apple Silicon; users still see the
// "unidentified developer" prompt (right-click > Open) until the app is notarized.
const { execFileSync, spawnSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return

  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)

  // A real certificate already signed the app: keep that signature (codesign -d prints to stderr)
  const info = spawnSync('codesign', ['-dvv', app], { encoding: 'utf8' })
  if (/Authority=/.test(`${info.stdout}${info.stderr}`)) return

  console.log(`  • ad-hoc signing  app=${app}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
}
