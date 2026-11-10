import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  blenderCandidates,
  blenderSpawnEnv,
  normalizeBlenderPath,
  parseBlenderVersion,
  sortWindowsBlenderDirs,
  validateBlenderBinary,
} from '../../electron/bridge/blenderExec'
import { detectBlender, getBlenderStatus, setBlenderPath, setBlenderStatusForTest, setBlenderVersionRunner } from '../../electron/bridge/blenderDetect'
import { loadBridgeSettings, setBridgeSettingsDir } from '../../electron/bridge/godotExec'

describe('parseBlenderVersion', () => {
  it('reads the first "Blender x.y.z" line, also after warnings', () => {
    expect(parseBlenderVersion('Blender 4.2.3 LTS\n\tbuild date: 2024-10-21\n')).toEqual({ ok: true, version: '4.2.3' })
    expect(parseBlenderVersion('Color management: warning\nBlender 4.5.0\n')).toEqual({ ok: true, version: '4.5.0' })
    expect(parseBlenderVersion('Blender 5.0')).toEqual({ ok: true, version: '5.0.0' })
  })

  it('rejects versions below 4.2, empty and unknown output with Indonesian reasons', () => {
    const old = parseBlenderVersion('Blender 4.1.1\n')
    expect(old.ok).toBe(false)
    expect(old.version).toBe('4.1.1')
    expect(old.reason).toMatch(/minimal 4\.2/)
    expect(parseBlenderVersion('Blender 3.6.5 LTS').ok).toBe(false)
    expect(parseBlenderVersion('').reason).toMatch(/tidak memberikan output/)
    expect(parseBlenderVersion('Godot 4.3.stable').reason).toMatch(/tidak dikenali/)
  })
})

describe('normalizeBlenderPath', () => {
  it('turns a macOS .app bundle into its binary and trims slashes and quotes', () => {
    expect(normalizeBlenderPath('/Applications/Blender.app/', 'darwin')).toBe('/Applications/Blender.app/Contents/MacOS/Blender')
    expect(normalizeBlenderPath(' "/Applications/Blender 4.2.app" ', 'darwin')).toBe('/Applications/Blender 4.2.app/Contents/MacOS/Blender')
    expect(normalizeBlenderPath('/Applications/Blender.app/Contents/MacOS/Blender', 'darwin')).toBe('/Applications/Blender.app/Contents/MacOS/Blender')
  })

  it('turns a Windows install folder into blender.exe', () => {
    const dir = 'C:\\Program Files\\Blender Foundation\\Blender 4.2'
    expect(normalizeBlenderPath(`${dir}\\`, 'win32', (p) => p === dir)).toBe(`${dir}\\blender.exe`)
    expect(normalizeBlenderPath(`${dir}\\blender.exe`, 'win32', () => false)).toBe(`${dir}\\blender.exe`)
  })

  it('leaves Linux paths alone', () => {
    expect(normalizeBlenderPath('/usr/bin/blender', 'linux')).toBe('/usr/bin/blender')
  })
})

describe('blenderCandidates', () => {
  it('sorts Windows install folders by version, newest first', () => {
    expect(sortWindowsBlenderDirs(['Blender 4.2', 'Blender 4.10', 'Blender 3.6', 'Other', 'Blender 4.4'])).toEqual([
      'Blender 4.10',
      'Blender 4.4',
      'Blender 4.2',
      'Blender 3.6',
    ])
  })

  it('looks at LINDEN_BLENDER, the saved path, PATH, then the usual places (macOS)', () => {
    const c = blenderCandidates({
      platform: 'darwin',
      env: { LINDEN_BLENDER: '/opt/Blender.app' },
      home: '/Users/u',
      saved: '/saved/Blender',
      pathDirs: ['/usr/local/bin'],
      findOnPath: (name, dirs) => (name === 'blender' && dirs.includes('/usr/local/bin') ? '/usr/local/bin/blender' : null),
      readDir: (dir) => (dir === '/Applications' ? ['Blender 4.2.app', 'Blender.app', 'Safari.app'] : []),
    })
    expect(c).toEqual([
      { bin: '/opt/Blender.app/Contents/MacOS/Blender', source: 'env' },
      { bin: '/saved/Blender', source: 'settings' },
      { bin: '/usr/local/bin/blender', source: 'path' },
      { bin: '/Applications/Blender.app/Contents/MacOS/Blender', source: 'common' },
      { bin: '/Applications/Blender 4.2.app/Contents/MacOS/Blender', source: 'common' },
    ])
  })

  it('picks the newest Blender Foundation folder on Windows', () => {
    const c = blenderCandidates({
      platform: 'win32',
      env: { ProgramFiles: 'C:\\Program Files' },
      home: 'C:\\Users\\u',
      findOnPath: () => null,
      readDir: (dir) => (dir === 'C:\\Program Files\\Blender Foundation' ? ['Blender 4.2', 'Blender 4.4'] : []),
    })
    expect(c[0]).toEqual({ bin: 'C:\\Program Files\\Blender Foundation\\Blender 4.4\\blender.exe', source: 'common' })
  })

  it('includes snap and flatpak exports on Linux', () => {
    const bins = blenderCandidates({ platform: 'linux', env: {}, home: '/home/u', findOnPath: () => null }).map((c) => c.bin)
    expect(bins).toContain('/snap/bin/blender')
    expect(bins).toContain('/var/lib/flatpak/exports/bin/org.blender.Blender')
    expect(bins).toContain('/home/u/.local/share/flatpak/exports/bin/org.blender.Blender')
  })
})

describe('blenderSpawnEnv', () => {
  it('drops inherited Python/Blender variables and isolates the user folders', () => {
    const env = blenderSpawnEnv('/job/user', { PATH: '/bin', PYTHONPATH: '/evil', PYTHONHOME: '/x', BLENDER_USER_SCRIPTS: '/addons', HOME: '/h' })
    expect(env.PATH).toBe('/bin')
    expect(env.HOME).toBe('/h')
    expect(env.PYTHONPATH).toBeUndefined()
    expect(env.PYTHONHOME).toBeUndefined()
    expect(env.BLENDER_USER_SCRIPTS).toBe(path.join('/job/user', 'scripts'))
    expect(env.BLENDER_USER_CONFIG).toBe(path.join('/job/user', 'config'))
  })
})

describe('validateBlenderBinary and detection cache', () => {
  let dir: string
  let fakeBin: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-blender-detect-'))
    fakeBin = path.join(dir, 'blender')
    fs.writeFileSync(fakeBin, '')
    setBridgeSettingsDir(dir)
  })
  afterEach(() => {
    setBlenderVersionRunner(null)
    setBlenderStatusForTest(null)
    delete process.env.LINDEN_BLENDER
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('accepts Blender 4.2+ and reports why others fail', async () => {
    const ok = await validateBlenderBinary(fakeBin, 'manual', async () => ({ code: 0, stdout: 'Blender 4.2.3 LTS\n', stderr: '' }))
    expect(ok).toEqual({ found: true, path: fakeBin, version: '4.2.3', source: 'manual' })
    const old = await validateBlenderBinary(fakeBin, 'manual', async () => ({ code: 0, stdout: 'Blender 3.6.0\n', stderr: '' }))
    expect(old.found).toBe(false)
    expect(old.reason).toMatch(/minimal 4\.2/)
    expect((await validateBlenderBinary(path.join(dir, 'nope'), 'manual')).reason).toMatch(/tidak ditemukan/)
    expect((await validateBlenderBinary(dir, 'manual')).reason).toMatch(/folder/)
    const crash = await validateBlenderBinary(fakeBin, 'manual', async () => ({ code: 1, stdout: '', stderr: 'boom' }))
    expect(crash.reason).toMatch(/kode 1: boom/)
  })

  it('detects from LINDEN_BLENDER, saves the path and caches the status', async () => {
    process.env.LINDEN_BLENDER = fakeBin
    setBlenderVersionRunner(async (bin) => ({ code: 0, stdout: bin === fakeBin ? 'Blender 4.4.1\n' : '', stderr: '' }))
    const s = await detectBlender({ refresh: true })
    expect(s).toMatchObject({ found: true, path: fakeBin, version: '4.4.1', source: 'env' })
    expect(getBlenderStatus()).toEqual(s)
    expect(loadBridgeSettings()).toMatchObject({ blenderExecutable: fakeBin, blenderVersion: '4.4.1' })
  })

  it('keeps the working Blender when a manual path is invalid', async () => {
    setBlenderStatusForTest({ found: true, path: '/good/blender', version: '4.2.0', source: 'path' })
    setBlenderVersionRunner(async () => ({ code: 0, stdout: 'Blender 4.0.0\n', stderr: '' }))
    const res = await setBlenderPath(fakeBin)
    expect(res.found).toBe(false)
    expect(getBlenderStatus().path).toBe('/good/blender')
    setBlenderVersionRunner(async () => ({ code: 0, stdout: 'Blender 4.2.1\n', stderr: '' }))
    expect(await setBlenderPath(fakeBin)).toMatchObject({ found: true, source: 'manual', version: '4.2.1' })
    expect(getBlenderStatus().path).toBe(fakeBin)
  })
})
