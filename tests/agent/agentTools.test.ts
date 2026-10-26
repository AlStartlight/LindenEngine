import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LINDEN_TOOLS } from '../../electron/agent/lindenTools'
import { PROMPT_TEMPLATES } from '../../electron/agent/promptTemplates'
import { GameSpecSchema, AgentDiffItem } from '../../shared/agentTypes'

describe('OpenCode Linden Custom Tools & Prompt Templates (FR-A1..A14)', () => {
  const testProjectDir = path.resolve(process.cwd(), 'tests/fixtures/test-agent-project')

  beforeAll(() => {
    fs.mkdirSync(path.join(testProjectDir, 'scenes'), { recursive: true })
    fs.mkdirSync(path.join(testProjectDir, 'scripts'), { recursive: true })
    fs.mkdirSync(path.join(testProjectDir, 'assets'), { recursive: true })

    fs.writeFileSync(
      path.join(testProjectDir, 'project.linden.json'),
      JSON.stringify(
        {
          name: 'Agent Test Game',
          version: '1.0.0',
          scenesInBuild: ['scenes/Main.lscene'],
          input: {
            actions: [
              {
                id: 'jump',
                name: 'Jump',
                type: 'button',
                bindings: [{ id: 'b1', device: 'keyboard', path: 'Space' }],
              },
            ],
          },
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
              id: 'ent_player',
              name: 'Player',
              components: [
                {
                  type: 'Transform',
                  properties: { position: [0, 1, 0] },
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

  it('linden_project_info returns project structure, scenes, and actions', async () => {
    const res = await LINDEN_TOOLS.linden_project_info.execute(testProjectDir, {})
    expect(res.success).toBe(true)
    expect(res.data?.name).toBe('Agent Test Game')
    expect(res.data?.scenes).toContain('scenes/Main.lscene')
    expect(res.data?.inputActions.length).toBeGreaterThan(0)
  })

  it('linden_scene_read reads structured scene JSON', async () => {
    const res = await LINDEN_TOOLS.linden_scene_read.execute(testProjectDir, {
      scenePath: 'scenes/Main.lscene',
    })
    expect(res.success).toBe(true)
    expect(res.data?.format).toBe('linden-scene')
    expect(res.data?.entities.length).toBe(1)
    expect(res.data?.entities[0].name).toBe('Player')
  })

  it('linden_scene_apply validates entity tree and produces diff', async () => {
    const diffs: AgentDiffItem[] = []
    const res = await LINDEN_TOOLS.linden_scene_apply.execute(
      testProjectDir,
      {
        scenePath: 'scenes/Main.lscene',
        sceneName: 'Main',
        entities: [
          {
            id: 'ent_ground',
            name: 'Ground',
            components: [
              {
                type: 'Transform',
                properties: { position: [0, 0, 0] },
              },
            ],
          },
          {
            id: 'ent_player',
            name: 'Player',
            parentId: 'ent_ground',
            components: [
              {
                type: 'Transform',
                properties: { position: [0, 1, 0] },
              },
            ],
          },
        ],
      },
      { onDiff: (d) => diffs.push(d) }
    )

    expect(res.success).toBe(true)
    expect(res.data?.entityCount).toBe(2)
    expect(diffs.length).toBe(1)
    expect(diffs[0].kind).toBe('scene')
    expect(diffs[0].after).toContain('Ground')
  })

  it('linden_scene_apply rejects invalid parent references', async () => {
    const res = await LINDEN_TOOLS.linden_scene_apply.execute(testProjectDir, {
      scenePath: 'scenes/Main.lscene',
      entities: [
        {
          id: 'ent_child',
          name: 'Child Without Parent',
          parentId: 'non_existent_parent_id',
          components: [],
        },
      ],
    })

    expect(res.success).toBe(false)
    expect(res.error).toContain('non-existent')
  })

  it('linden_component_list returns all registered ECS components and properties', async () => {
    const res = await LINDEN_TOOLS.linden_component_list.execute(testProjectDir, {})
    expect(res.success).toBe(true)
    expect(Array.isArray(res.data)).toBe(true)
    expect(res.data?.some((c: any) => c.type === 'Transform')).toBe(true)
    expect(res.data?.some((c: any) => c.type === 'Camera')).toBe(true)
  })

  it('linden_script_write writes script file and emits diff item', async () => {
    const diffs: AgentDiffItem[] = []
    const sampleScript = `
export class PlayerController {
  speed = 5;
  update(dt: number) {
    // move
  }
}
`
    const res = await LINDEN_TOOLS.linden_script_write.execute(
      testProjectDir,
      {
        scriptPath: 'scripts/PlayerController.ts',
        code: sampleScript,
      },
      { onDiff: (d) => diffs.push(d) }
    )

    expect(res.success).toBe(true)
    expect(fs.existsSync(path.join(testProjectDir, 'scripts/PlayerController.ts'))).toBe(true)
    expect(diffs.length).toBe(1)
    expect(diffs[0].kind).toBe('script')
    expect(diffs[0].after).toContain('PlayerController')
  })

  it('linden_input_actions updates project configuration with new action bindings', async () => {
    const diffs: AgentDiffItem[] = []
    const res = await LINDEN_TOOLS.linden_input_actions.execute(
      testProjectDir,
      {
        actions: [
          {
            id: 'fire',
            name: 'Fire',
            type: 'button',
            bindings: [{ id: 'b_f1', device: 'keyboard', path: 'KeyF' }],
          },
        ],
      },
      { onDiff: (d) => diffs.push(d) }
    )

    expect(res.success).toBe(true)
    const updatedProj = JSON.parse(
      fs.readFileSync(path.join(testProjectDir, 'project.linden.json'), 'utf-8')
    )
    // Old { device, path } bindings are normalized to the runtime shape; merge keeps the other actions
    expect(updatedProj.input.actions.find((a: any) => a.name === 'Fire')).toEqual({ name: 'Fire', type: 'button', bindings: ['Keyboard/KeyF'] })
    expect(updatedProj.input.actions.some((a: any) => a.name === 'Jump')).toBe(true)
    expect(diffs.length).toBe(1)
    expect(diffs[0].kind).toBe('config')
  })

  it('linden_asset_placeholder generates placeholder texture asset', async () => {
    const res = await LINDEN_TOOLS.linden_asset_placeholder.execute(testProjectDir, {
      assetPath: 'assets/player_sprite.png',
      type: 'sprite',
      color: '#38bdf8',
    })

    expect(res.success).toBe(true)
    expect(fs.existsSync(path.join(testProjectDir, 'assets/player_sprite.png'))).toBe(true)
  })

  it('rejects path traversal attempts outside project directory', async () => {
    const res = await LINDEN_TOOLS.linden_script_write.execute(testProjectDir, {
      scriptPath: '../../evil_script.ts',
      code: 'alert("hacked");',
    })

    expect(res.success).toBe(false)
    expect(res.error).toContain('Akses di luar folder proyek ditolak')
  })

  it('validates BUILTIN_PROMPT_TEMPLATES count, genres and prompt fields', () => {
    expect(PROMPT_TEMPLATES.length).toBeGreaterThanOrEqual(10)
    const genres = PROMPT_TEMPLATES.map((t) => t.genre)
    expect(genres).toContain('Platformer')
    expect(genres).toContain('Shooter')
    expect(genres).toContain('Runner')
    expect(genres).toContain('Arcade')

    for (const t of PROMPT_TEMPLATES) {
      expect(t.id).toBeDefined()
      expect(t.title).toBeDefined()
      expect(t.dimension).toMatch(/^(2D|3D)$/)
      expect(t.prompt.length).toBeGreaterThan(20)
    }
  })

  it('validates GameSpec schema using Zod', () => {
    const validGameSpec = {
      title: 'Platformer Adventure',
      genre: 'Platformer',
      description: 'A 2D platformer demo game',
      dimension: '2D' as const,
      camera: {
        position: [0, 2, 10] as [number, number, number],
        target: [0, 0, 0] as [number, number, number],
        fov: 60,
        isOrthographic: false,
      },
      controls: [
        {
          action: 'Jump',
          keys: ['Space'],
          description: 'Jump over obstacles',
        },
      ],
      entities: [
        {
          id: 'player_1',
          name: 'Player',
          primitive: 'box' as const,
          color: '#38bdf8',
          position: [0, 1, 0] as [number, number, number],
          scriptPath: 'scripts/PlayerController.ts',
        },
      ],
      rules: {
        winCondition: 'Collect 5 coins',
        loseCondition: 'Fall into pit or touch hazard',
      },
    }

    const parsed = GameSpecSchema.safeParse(validGameSpec)
    expect(parsed.success).toBe(true)
  })
})

describe('script & UI tools attach to scene entities', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-attach-'))
    fs.mkdirSync(path.join(dir, 'scenes'))
    fs.writeFileSync(
      path.join(dir, 'scenes/Main.lscene'),
      JSON.stringify({ format: 'linden-scene', version: 2, name: 'Main', entities: [{ id: 'p', name: 'Player', parentId: null, components: [{ type: 'Transform', data: {} }] }] })
    )
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('linden_script_write attaches a Script component with props', async () => {
    const diffs: AgentDiffItem[] = []
    const res = await LINDEN_TOOLS.linden_script_write.execute(
      dir,
      { scriptPath: 'scripts/Player.ts', code: 'export default class P {}', attachTo: { scene: 'scenes/Main.lscene', entityId: 'p', props: { speed: 4 } } },
      { onDiff: (d) => diffs.push(d) }
    )
    expect(res.success).toBe(true)
    const scene = JSON.parse(fs.readFileSync(path.join(dir, 'scenes/Main.lscene'), 'utf-8'))
    expect(scene.entities[0].components).toContainEqual({ type: 'Script', data: { src: 'scripts/Player.ts', props: { speed: 4 } } })
    expect(diffs.map((d) => d.kind)).toEqual(['script', 'scene'])
  })

  it('linden_script_write rejects scripts outside scripts/ and unknown entities', async () => {
    const outside = await LINDEN_TOOLS.linden_script_write.execute(dir, { scriptPath: 'src/P.ts', code: '' })
    expect(outside.success).toBe(false)
    const missing = await LINDEN_TOOLS.linden_script_write.execute(dir, {
      scriptPath: 'scripts/P.ts',
      code: '',
      attachTo: { scene: 'scenes/Main.lscene', entityId: 'nope' },
    })
    expect(missing.error).toMatch(/p \(Player\)/)
  })

  it('linden_ui_write writes the fragment, warns about scripts and attaches HtmlUI', async () => {
    const res = await LINDEN_TOOLS.linden_ui_write.execute(dir, {
      uiPath: 'ui/hud.html',
      html: '<div id="coins" onclick="x()">0</div><script>alert(1)</script>',
      attachTo: { scene: 'scenes/Main.lscene', entityId: 'p' },
    })
    expect(res.success).toBe(true)
    expect(res.data.warnings).toHaveLength(2)
    const scene = JSON.parse(fs.readFileSync(path.join(dir, 'scenes/Main.lscene'), 'utf-8'))
    expect(scene.entities[0].components.find((c: any) => c.type === 'HtmlUI').data).toMatchObject({ src: 'ui/hud.html', mode: 'screen' })
  })

  it('linden_web_write only writes inside web/', async () => {
    expect((await LINDEN_TOOLS.linden_web_write.execute(dir, { filePath: 'web/main.js', content: '1' })).success).toBe(true)
    expect((await LINDEN_TOOLS.linden_web_write.execute(dir, { filePath: 'scenes/x.js', content: '1' })).success).toBe(false)
    expect((await LINDEN_TOOLS.linden_web_write.execute(dir, { filePath: 'web/.env', content: '1' })).success).toBe(false)
  })

  it('linden_scene_apply validates Script and HtmlUI paths', async () => {
    const res = await LINDEN_TOOLS.linden_scene_apply.execute(dir, {
      entities: [{ id: 'a', name: 'A', parentId: null, components: [{ type: 'Script', data: { src: '../x.ts' } }] } as any],
    })
    expect(res.error).toMatch(/Script\.src/)
  })
})


describe('linden_play with simulated input', () => {
  it('reports distance and jump height for CharacterMovement characters', async () => {
    const { simulateScene } = await import('../../electron/agent/lindenTools')
    const scene = JSON.stringify({
      format: 'linden-scene',
      version: 2,
      name: 'Move',
      entities: [
        { id: 'g', name: 'Ground', parentId: null, components: [
          { type: 'Transform', data: { position: [0, -0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
          { type: 'BoxCollider', data: { size: { x: 100, y: 1, z: 100 } } },
        ] },
        { id: 'p', name: 'Hero', parentId: null, components: [
          { type: 'Transform', data: { position: [0, 1.05, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
          { type: 'CapsuleCollider', data: { radius: 0.5, height: 2 } },
          { type: 'CharacterController', data: {} },
          { type: 'CharacterMovement', data: { walkSpeed: 4 } },
        ] },
      ],
    })
    const report = await simulateScene(scene, 2, {
      inputScript: [
        { at: 0.3, action: 'Move', value: [0, 1] },
        { at: 1.0, action: 'Jump', press: true },
        { at: 1.05, action: 'Jump', press: false },
        { at: 1.3, action: 'Move', value: [0, 0] },
      ],
    })
    expect(report.errors).toEqual([])
    const hero = report.characters.find((c: any) => c.name === 'Hero')!
    expect(hero.distanceTravelled).toBeGreaterThan(3)
    expect(hero.maxJumpHeight).toBeGreaterThan(1)
    expect(hero.jumps).toBe(1)
    expect(hero.grounded).toBe(true)
  })
})

describe('linden_touch_button', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-touchbtn-'))
    fs.writeFileSync(
      path.join(dir, 'project.linden.json'),
      JSON.stringify({ name: 'T', version: '1', input: { actions: [{ name: 'Dash', type: 'button', bindings: ['Keyboard/KeyG'] }, { name: 'Attack', type: 'button', bindings: ['Mouse/LeftButton'] }] } })
    )
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))
  const read = () => JSON.parse(fs.readFileSync(path.join(dir, 'project.linden.json'), 'utf-8'))

  it('adds one button connected to an action in a free spot, keeping the others', async () => {
    const res = await LINDEN_TOOLS.linden_touch_button.execute(dir, {
      op: 'upsert',
      preset: 'secondary',
      button: { id: 'Dash', action: 'Dash', label: 'DASH', icon: 'dash', behavior: 'tap', cooldown: 1 },
    })
    expect(res.success).toBe(true)
    const touch = read().input.touch
    expect(touch.buttons.length).toBe(7) // 6 defaults + Dash
    expect(touch.buttons.find((b: any) => b.id === 'Dash')).toMatchObject({ action: 'Dash', behavior: 'tap', cooldown: 1 })
    expect(res.data.warnings.filter((w: string) => /bertumpuk|keluar layar/.test(w))).toEqual([])
  })

  it('updates one button, creates layouts, removes buttons, rejects unknown actions', async () => {
    await LINDEN_TOOLS.linden_touch_button.execute(dir, { op: 'upsert', button: { id: 'Attack', label: 'HIT' } })
    expect(read().input.touch.buttons.find((b: any) => b.id === 'Attack')).toMatchObject({ label: 'HIT', action: 'Attack', behavior: 'tap' })

    const veh = await LINDEN_TOOLS.linden_touch_button.execute(dir, { op: 'upsert', layout: 'vehicle', preset: 'primary', button: { id: 'Gas', action: 'Dash', label: 'GAS' } })
    expect(veh.success).toBe(true)
    expect(read().input.touch.layouts.vehicle.buttons.map((b: any) => b.id)).toEqual(['Gas'])

    const rm = await LINDEN_TOOLS.linden_touch_button.execute(dir, { op: 'remove', button: { id: 'Interact' } })
    expect(rm.success).toBe(true)
    expect(read().input.touch.buttons.some((b: any) => b.id === 'Interact')).toBe(false)

    const bad = await LINDEN_TOOLS.linden_touch_button.execute(dir, { op: 'upsert', button: { id: 'Fly', action: 'Fly' } })
    expect(bad.error).toMatch(/Action "Fly" belum ada/)
  })

  it('linden_play records what scripts did with ctx.touch', async () => {
    fs.mkdirSync(path.join(dir, 'scripts'))
    fs.writeFileSync(path.join(dir, 'scripts/Door.ts'), "export default class Door {\n  onInit(ctx: any) { ctx.touch.hide('Interact'); ctx.touch.setBadge('Attack', 3) }\n}\n")
    const scene = JSON.stringify({
      format: 'linden-scene',
      version: 2,
      name: 'S',
      entities: [{ id: 'd', name: 'Door', parentId: null, components: [{ type: 'Transform', data: {} }, { type: 'Script', data: { src: 'scripts/Door.ts' } }] }],
    })
    const { simulateScene } = await import('../../electron/agent/lindenTools')
    const report = await simulateScene(scene, 0.2, { projectPath: dir })
    expect(report.touch.calls.map((c: any) => c.call)).toEqual(['hide(Interact)', 'setBadge(Attack, 3)'])
  })
})
