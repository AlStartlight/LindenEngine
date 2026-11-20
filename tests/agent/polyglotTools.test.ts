import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LINDEN_TOOLS } from '../../electron/agent/lindenTools/index'

describe('Agent Tools: Polyglot Script Write & Transmute', () => {
  let projectDir: string

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-agent-polyglot-'))
  })

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true })
  })

  it('writes GDScript, C#, and Rust scripts via linden_script_write', async () => {
    const writeTool = LINDEN_TOOLS.linden_script_write

    // 1. GDScript
    const gdRes = await writeTool.execute(projectDir, {
      scriptPath: 'scripts/Player.gd',
      code: 'extends CharacterBody3D\nfunc _ready():\n\tpass\n',
    })
    expect(gdRes.success).toBe(true)
    expect(fs.existsSync(path.join(projectDir, 'scripts/Player.gd'))).toBe(true)

    // 2. C#
    const csRes = await writeTool.execute(projectDir, {
      scriptPath: 'scripts/Mover.cs',
      code: 'using UnityEngine;\npublic class Mover : MonoBehaviour {}\n',
    })
    expect(csRes.success).toBe(true)
    expect(fs.existsSync(path.join(projectDir, 'scripts/Mover.cs'))).toBe(true)

    // 3. Rust
    const rsRes = await writeTool.execute(projectDir, {
      scriptPath: 'scripts/Generator.rs',
      code: 'pub struct Generator {}\n',
    })
    expect(rsRes.success).toBe(true)
    expect(fs.existsSync(path.join(projectDir, 'scripts/Generator.rs'))).toBe(true)
  })

  it('transmutes GDScript to TypeScript via linden_script_transmute', async () => {
    const writeTool = LINDEN_TOOLS.linden_script_write
    const transmuteTool = LINDEN_TOOLS.linden_script_transmute

    await writeTool.execute(projectDir, {
      scriptPath: 'scripts/Hero.gd',
      code: `extends CharacterBody3D
@export var speed: float = 25.0
func _ready():
\tprint("Hero ready")
`,
    })

    const res = await transmuteTool.execute(projectDir, {
      sourcePath: 'scripts/Hero.gd',
      targetLang: 'typescript',
    })

    expect(res.success).toBe(true)
    const targetPath = path.join(projectDir, 'scripts/Hero.ts')
    expect(fs.existsSync(targetPath)).toBe(true)
    const tsCode = fs.readFileSync(targetPath, 'utf-8')
    expect(tsCode).toContain('export class Hero')
    expect(tsCode).toContain('public speed: number = 25.0')
    expect(tsCode).toContain('onInit(): void')
  })

  it('transmutes C# to GDScript via linden_script_transmute', async () => {
    const writeTool = LINDEN_TOOLS.linden_script_write
    const transmuteTool = LINDEN_TOOLS.linden_script_transmute

    await writeTool.execute(projectDir, {
      scriptPath: 'scripts/Patrol.cs',
      code: `using UnityEngine;
public class Patrol : MonoBehaviour
{
    void Start()
    {
    }
    void Update()
    {
    }
}
`,
    })

    const res = await transmuteTool.execute(projectDir, {
      sourcePath: 'scripts/Patrol.cs',
      targetLang: 'gdscript',
    })

    expect(res.success).toBe(true)
    const targetPath = path.join(projectDir, 'scripts/Patrol.gd')
    expect(fs.existsSync(targetPath)).toBe(true)
    const gdCode = fs.readFileSync(targetPath, 'utf-8')
    expect(gdCode).toContain('func _ready():')
    expect(gdCode).toContain('func _process(delta):')
  })
})
