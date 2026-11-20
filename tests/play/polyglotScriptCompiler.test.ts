import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { compileScripts, listScriptSources } from '../../electron/play/ScriptCompiler'
import { isValidScriptSrc, compiledScriptPath } from '../../shared/playProtocol'

describe('Polyglot ScriptCompiler (GDScript, C#, Rust)', () => {
  let project: string
  let out: string

  const write = (rel: string, code: string) => {
    const full = path.join(project, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, code)
  }

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'linden-polyglot-compile-'))
    out = path.join(project, '.out', 'game-scripts')
  })
  afterEach(() => fs.rmSync(project, { recursive: true, force: true }))

  it('validates script sources and compiles paths for all supported languages', () => {
    expect(isValidScriptSrc('scripts/Player.gd')).toBe(true)
    expect(isValidScriptSrc('scripts/Enemy.cs')).toBe(true)
    expect(isValidScriptSrc('scripts/Voxel.rs')).toBe(true)
    expect(isValidScriptSrc('scripts/Main.ts')).toBe(true)
    expect(isValidScriptSrc('scripts/hack.py')).toBe(false)
    expect(isValidScriptSrc('../outside.gd')).toBe(false)

    expect(compiledScriptPath('scripts/Player.gd')).toBe('game-scripts/Player.js')
    expect(compiledScriptPath('scripts/ai/Enemy.cs')).toBe('game-scripts/ai/Enemy.js')
    expect(compiledScriptPath('scripts/physics/Voxel.rs')).toBe('game-scripts/physics/Voxel.js')
  })

  it('lists polyglot script sources in scripts/', () => {
    write('scripts/Player.gd', 'extends Node\nfunc _ready():\n\tpass\n')
    write('scripts/Enemy.cs', 'using UnityEngine;\npublic class Enemy : MonoBehaviour {}\n')
    write('scripts/Compute.rs', 'pub struct Compute {}\n')
    write('scripts/Native.ts', 'export default class Native {}\n')

    const sources = listScriptSources(project)
    expect(sources).toContain('scripts/Player.gd')
    expect(sources).toContain('scripts/Enemy.cs')
    expect(sources).toContain('scripts/Compute.rs')
    expect(sources).toContain('scripts/Native.ts')
  })

  it('automatically transpiles and compiles GDScript into browser ESM during build', async () => {
    const gdCode = `extends Node

@export var speed: float = 15.0

func _ready():
\tprint("Godot script compiled")

func _process(delta):
\tpass
`
    write('scripts/GodotPlayer.gd', gdCode)

    const res = await compileScripts(project, out)
    expect(res.ok).toBe(true)
    expect(res.errors).toEqual([])

    const compiledJsPath = path.join(out, 'GodotPlayer.js')
    expect(fs.existsSync(compiledJsPath)).toBe(true)

    const content = fs.readFileSync(compiledJsPath, 'utf-8')
    expect(content).toContain('GodotPlayer')
    expect(content).toContain('speed')
    expect(content).toContain('onInit')
    expect(content).toContain('onUpdate')
  })

  it('automatically transpiles and compiles C# MonoBehaviour into browser ESM during build', async () => {
    const csCode = `using UnityEngine;

public class TurretAI : MonoBehaviour
{
    [SerializeField] private float fireRate = 2.0f;

    void Start()
    {
        Debug.Log("Turret ready");
    }

    void Update()
    {
    }
}
`
    write('scripts/TurretAI.cs', csCode)

    const res = await compileScripts(project, out)
    expect(res.ok).toBe(true)
    expect(res.errors).toEqual([])

    const compiledJsPath = path.join(out, 'TurretAI.js')
    expect(fs.existsSync(compiledJsPath)).toBe(true)

    const content = fs.readFileSync(compiledJsPath, 'utf-8')
    expect(content).toContain('TurretAI')
    expect(content).toContain('fireRate')
    expect(content).toContain('onInit')
    expect(content).toContain('onUpdate')
  })

  it('automatically compiles Rust gameplay script into browser ESM during build', async () => {
    const rsCode = `pub struct Generator {
    pub count: u32,
}

impl Generator {
    pub fn init(&mut self, ctx: &mut Context) {
        self.count = 42;
    }
}
`
    write('scripts/Generator.rs', rsCode)

    const res = await compileScripts(project, out)
    expect(res.ok).toBe(true)
    expect(res.errors).toEqual([])

    const compiledJsPath = path.join(out, 'Generator.js')
    expect(fs.existsSync(compiledJsPath)).toBe(true)

    const content = fs.readFileSync(compiledJsPath, 'utf-8')
    expect(content).toContain('Generator')
    expect(content).toContain('onInit')
  })
})
