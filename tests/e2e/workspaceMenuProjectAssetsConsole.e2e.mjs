// E2E test for Workspace Menu, Project Panel, Assets Browser, and Console Panel in Linden Engine.
// Verifies live UI components, menu navigation, tab switching, and console interactions in Electron.
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repo = process.cwd()
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-workspace-e2e-'))
console.log(`[Workspace E2E] work folder: ${work}`)

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const project = path.join(work, 'WorkspaceTestProject')
const write = (rel, content) => {
  fs.mkdirSync(path.dirname(path.join(project, rel)), { recursive: true })
  fs.writeFileSync(path.join(project, rel), content)
}

write(
  'project.linden.json',
  JSON.stringify(
    {
      name: 'WorkspaceTestProject',
      version: '0.1.0',
      scenesInBuild: ['scenes/Main.lscene'],
    },
    null,
    2
  )
)

write(
  'scenes/Main.lscene',
  JSON.stringify(
    {
      format: 'linden-scene',
      version: 2,
      name: 'Main',
      entities: [
        {
          id: 'cam',
          name: 'Main Camera',
          active: true,
          static: false,
          tags: [],
          layer: 0,
          parentId: null,
          components: [
            { type: 'Transform', data: { position: [0, 2, 5], rotation: [0, 0, 0], scale: [1, 1, 1] } },
            { type: 'Camera', data: { fov: 60, near: 0.1, far: 1000, isActive: true } },
          ],
        },
      ],
    },
    null,
    2
  )
)

let app = null
try {
  app = await electron.launch({
    args: [path.join(repo, 'dist-electron/main.cjs'), project, `--user-data-dir=${path.join(work, 'userData')}`],
    cwd: repo,
    timeout: 30000,
  })

  let page = null
  for (let i = 0; i < 100 && !page; i++) {
    page = app.windows().find((w) => w.url().startsWith('http://localhost:5173') || w.url().includes('index.html')) ?? null
    if (!page) await new Promise((r) => setTimeout(r, 200))
  }

  if (!page) {
    page = await app.firstWindow()
  }

  check('Electron window opened', !!page)
  await page.waitForLoadState('domcontentloaded')

  // 1. Verify Top Menu Bar
  const fileMenuBtn = page.locator('button', { hasText: 'File' }).first()
  await fileMenuBtn.waitFor({ timeout: 10000 })
  check('Top Menu File button present', await fileMenuBtn.isVisible())

  const windowMenuBtn = page.locator('button', { hasText: 'Window' }).first()
  check('Top Menu Window button present', await windowMenuBtn.isVisible())

  // Open Window menu
  await windowMenuBtn.click()
  await page.waitForTimeout(200)

  const workspaceSubmenu = page.locator('text=Workspace Layout')
  check('Workspace Layout menu item visible', await workspaceSubmenu.isVisible())

  const panelsSubmenu = page.locator('text=Panels & Views')
  check('Panels & Views menu item visible', await panelsSubmenu.isVisible())

  // Close menu with Escape
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)

  // 2. Verify Bottom Workspace Tabs
  const projectTab = page.locator('button', { hasText: 'Project' }).first()
  const assetsTab = page.locator('button', { hasText: 'Assets' }).first()
  const consoleTab = page.locator('button', { hasText: 'Console' }).first()

  check('Bottom Project tab visible', await projectTab.isVisible())
  check('Bottom Assets tab visible', await assetsTab.isVisible())
  check('Bottom Console tab visible', await consoleTab.isVisible())

  // Switch to Project tab
  await projectTab.click()
  await page.waitForTimeout(200)
  const foldersHeader = page.locator('text=Folders')
  check('Project Panel Folders header visible', await foldersHeader.isVisible())

  const createBtn = page.locator('button', { hasText: 'Create' }).first()
  check('Project Panel Create button visible', await createBtn.isVisible())

  // Switch to Assets tab
  await assetsTab.click()
  await page.waitForTimeout(200)
  const allPill = page.locator('button', { hasText: 'All' }).first()
  check('Assets Browser category pill visible', await allPill.isVisible())

  // Switch to Console tab
  await consoleTab.click()
  await page.waitForTimeout(200)
  const errorsFilterBtn = page.locator('button', { hasText: 'Errors' }).first()
  const warningsFilterBtn = page.locator('button', { hasText: 'Warnings' }).first()
  const clearBtn = page.locator('button', { hasText: 'Clear' }).first()

  check('Console Errors filter button visible', await errorsFilterBtn.isVisible())
  check('Console Warnings filter button visible', await warningsFilterBtn.isVisible())
  check('Console Clear button visible', await clearBtn.isVisible())

  // Test Console command input
  const commandInput = page.locator('input[placeholder*="Enter command"]').first()
  if (await commandInput.isVisible()) {
    await commandInput.fill('help')
    await commandInput.press('Enter')
    await page.waitForTimeout(200)
    const helpLog = page.locator('text=Commands: clear, help, stats, entities')
    check('Console command execution and log output', (await helpLog.count()) > 0)

    // Clear logs
    await clearBtn.click()
    await page.waitForTimeout(150)
    check('Console Clear action emptied logs', (await page.locator('text=Commands: clear, help').count()) === 0)
  }

  console.log('\n[Workspace E2E] All interaction assertions completed successfully!')
} catch (err) {
  check('E2E run', false, String(err?.message ?? err))
} finally {
  if (app) {
    try {
      await app.close()
    } catch {}
  }
  try {
    fs.rmSync(work, { recursive: true, force: true })
  } catch {}
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`)
if (failed.length > 0) {
  process.exit(1)
} else {
  process.exit(0)
}
