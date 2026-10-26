import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { WebBuildRunner } from '../../electron/build/WebBuildRunner'
import { ExportPreset } from '../../shared/types/project'

describe('HTML5 Web Build Pipeline & Local Server (FR-W1..W10)', () => {
  const testProjectDir = path.resolve(process.cwd(), 'tests/fixtures/test-web-project')

  beforeAll(() => {
    // Set up test project with scenes and config
    fs.mkdirSync(path.join(testProjectDir, 'scenes'), { recursive: true })
    fs.mkdirSync(path.join(testProjectDir, 'scripts'), { recursive: true })
    fs.mkdirSync(path.join(testProjectDir, 'assets'), { recursive: true })

    fs.writeFileSync(
      path.join(testProjectDir, 'project.linden.json'),
      JSON.stringify(
        {
          name: 'Test Web Game',
          version: '1.2.3',
          scenesInBuild: ['scenes/Main.lscene'],
        },
        null,
        2
      )
    )

    fs.writeFileSync(
      path.join(testProjectDir, 'scenes/Main.lscene'),
      JSON.stringify(
        {
          format: 'linden-scene',
          version: 2,
          name: 'Main',
          entities: [
            {
              id: 'camera_1',
              name: 'Main Camera',
              components: [
                {
                  type: 'Camera',
                  properties: { isOrthographic: false, fov: 60 },
                },
              ],
            },
          ],
        },
        null,
        2
      )
    )
  })

  afterAll(() => {
    if (fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true })
    }
  })

  it('runs full HTML5 build pipeline producing index.html, game.js, project.json and zip bundle', async () => {
    const preset: ExportPreset = {
      id: 'web-preset-test',
      name: 'HTML5 Web',
      platform: 'web',
      backend: 'linden',
      arch: ['wasm'],
      output: 'build/web',
      mode: 'release',
      appName: 'Super Web Game',
      canvasMode: 'fullscreen',
      loadingColor: '#1e293b',
      loadingTitle: 'Loading Super Web Game...',
      webgpuRequired: false,
      zipOutput: true,
      includeSourceMap: false,
    }

    const stages: string[] = []
    const logs: string[] = []

    const result = await WebBuildRunner.runBuild({
      projectPath: testProjectDir,
      preset,
      onProgress: (p) => stages.push(p.stage),
      onLog: (l) => logs.push(l),
    })

    expect(result.success).toBe(true)
    expect(result.outputPath).toContain('index.html')
    expect(stages).toContain('validation')
    expect(stages).toContain('bundle')
    expect(stages).toContain('package')
    expect(stages).toContain('complete')

    // Verify files created on disk
    const outDir = path.resolve(testProjectDir, 'build/web')
    expect(fs.existsSync(path.join(outDir, 'index.html'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'game.js'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'project.json'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'scenes/Main.lscene'))).toBe(true)

    // Verify template variables replaced in index.html
    const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf-8')
    expect(html).toContain('Super Web Game')
    expect(html).toContain('#1e293b')
    expect(html).toContain('fullscreen')

    // Verify ZIP archive created
    expect(result.zipPath).toBeDefined()
    if (result.zipPath) {
      expect(fs.existsSync(result.zipPath)).toBe(true)
      const zipStat = fs.statSync(result.zipPath)
      expect(zipStat.size).toBeGreaterThan(100)
    }

    // Verify Build Report
    expect(result.report).toBeDefined()
    if (result.report) {
      expect(result.report.files.length).toBeGreaterThan(0)
      expect(result.report.totalSizeBytes).toBeGreaterThan(0)
      expect(result.report.durationMs).toBeGreaterThan(0)
    }
  }, 30000)

  it('starts and closes local static web server with COOP/COEP headers', async () => {
    const buildDir = path.resolve(testProjectDir, 'build/web')
    const server = await WebBuildRunner.serveLocal(buildDir, 0)

    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(server.port).toBeGreaterThan(0)

    // Request index.html from local server
    const response = await new Promise<{ statusCode: number; headers: any; body: string }>((resolve, reject) => {
      http.get(`${server.url}/index.html`, (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body,
          })
        })
        res.on('error', reject)
      })
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.headers['cross-origin-opener-policy']).toBe('same-origin')
    expect(response.headers['cross-origin-embedder-policy']).toBe('require-corp')
    expect(response.body).toContain('Super Web Game')

    // Close server
    server.close()
  })

  it('returns 404 for non-existent files on the local static server', async () => {
    const buildDir = path.resolve(testProjectDir, 'build/web')
    const server = await WebBuildRunner.serveLocal(buildDir, 0)

    const statusCode = await new Promise<number>((resolve, reject) => {
      http.get(`${server.url}/non_existent_file.xyz`, (res) => {
        resolve(res.statusCode || 0)
      }).on('error', reject)
    })

    expect(statusCode).toBe(404)
    server.close()
  })
})
