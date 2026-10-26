import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseShellPath, mergePath, candidateDirs, findExecutable, needsShell, loadLoginShellPath, resolveOpencode } from '../../electron/agent/opencodeBinary'

describe('opencode CLI lookup for packaged apps', () => {
  const tmp: string[] = []
  const mk = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-oc-'))
    tmp.push(d)
    return d
  }
  afterEach(() => {
    while (tmp.length) fs.rmSync(tmp.pop()!, { recursive: true, force: true })
    delete process.env.OPENCODE_BIN
  })

  it('reads PATH between markers despite shell banners', () => {
    expect(parseShellPath('Welcome to oh-my-zsh\n__LINDEN_PATH__/a:/b__LINDEN_PATH__\n')).toBe('/a:/b')
    expect(parseShellPath('no markers')).toBeNull()
  })

  it('merges PATH parts without duplicates, keeping order', () => {
    expect(mergePath(['/usr/bin:/bin', null, '/opt/homebrew/bin:/usr/bin', ''], ':')).toBe('/usr/bin:/bin:/opt/homebrew/bin')
  })

  it('lists nvm node versions newest first plus Homebrew and npm folders', () => {
    const home = '/Users/me'
    const dirs = candidateDirs(home, 'darwin', {}, (dir) =>
      dir === path.join(home, '.nvm', 'versions', 'node') ? ['v18.20.0', 'v24.22.1', 'v20.11.1'] : []
    )
    const nvm = dirs.filter((d) => d.includes('.nvm'))
    expect(nvm).toEqual([
      path.join(home, '.nvm/versions/node/v24.22.1/bin'),
      path.join(home, '.nvm/versions/node/v20.11.1/bin'),
      path.join(home, '.nvm/versions/node/v18.20.0/bin'),
    ])
    expect(dirs).toContain('/opt/homebrew/bin')
    expect(dirs).toContain(path.join(home, '.opencode', 'bin'))
    expect(dirs).toContain(path.join(home, '.npm-global', 'bin'))
  })

  it('finds an executable and skips non-executable files', () => {
    const a = mk()
    const b = mk()
    fs.writeFileSync(path.join(a, 'opencode'), '#!/bin/sh\n')
    fs.chmodSync(path.join(a, 'opencode'), 0o644)
    fs.writeFileSync(path.join(b, 'opencode'), '#!/bin/sh\necho 2.1.4\n')
    fs.chmodSync(path.join(b, 'opencode'), 0o755)
    expect(findExecutable('opencode', [a, b], 'darwin')).toBe(path.join(b, 'opencode'))
    expect(findExecutable('opencode', [a], 'darwin')).toBeNull()
  })

  it('accepts Windows npm shims and starts them through the shell', () => {
    const d = mk()
    fs.writeFileSync(path.join(d, 'opencode.cmd'), '@echo off\n')
    expect(findExecutable('opencode', [d], 'win32')).toBe(path.join(d, 'opencode.cmd'))
    expect(needsShell('C:\\npm\\opencode.cmd')).toBe(true)
    expect(needsShell('/usr/local/bin/opencode')).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('reads the login shell PATH', async () => {
    const p = await loadLoginShellPath('/bin/sh')
    expect(p).toMatch(/\/bin/)
  })

  it('honours OPENCODE_BIN', async () => {
    const d = mk()
    const bin = path.join(d, 'my-opencode')
    fs.writeFileSync(bin, '#!/bin/sh\n')
    fs.chmodSync(bin, 0o755)
    process.env.OPENCODE_BIN = bin
    expect(await resolveOpencode({ refresh: true })).toMatchObject({ bin, source: 'OPENCODE_BIN' })
    process.env.OPENCODE_BIN = path.join(d, 'missing')
    expect(await resolveOpencode({ refresh: true })).toMatchObject({ bin: null, source: 'not-found' })
  })
})
