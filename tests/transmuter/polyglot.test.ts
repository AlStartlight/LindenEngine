import { describe, it, expect } from 'vitest'
import { GDScriptTranspiler } from '../../engine/transmuter/scripts/gdscript/GDScriptTranspiler'
import { CSharpTranspiler } from '../../engine/transmuter/scripts/csharp/CSharpTranspiler'
import { RustWasmBridge } from '../../engine/transmuter/scripts/rust/RustWasmBridge'
import { TransmuterCore } from '../../engine/transmuter/core/TransmuterCore'

describe('Polyglot Multi-Language Support (GDScript, C#, Rust, TypeScript)', () => {
  describe('GDScript 4 Parity', () => {
    it('transpiles GDScript class with export default and Godot node access shorthand ($)', () => {
      const gdCode = `extends CharacterBody3D

@export var jump_speed: float = 12.0
@onready var mesh = $MeshInstance3D

func _ready():
\tprint("Player ready")

func _process(delta):
\tposition.y += jump_speed * delta
`
      const res = GDScriptTranspiler.gdscriptToTypeScript(gdCode, 'Player')
      expect(res.code).toContain('export class Player extends CharacterBody3D')
      expect(res.code).toContain('export default Player')
      expect(res.code).toContain('public jump_speed: number = 12.0')
      expect(res.code).toContain("this.getNode('MeshInstance3D')")
      expect(res.code).toContain('console.log("Player ready")')
    })

    it('transpiles lifecycle hooks _enter_tree and _exit_tree to onEnable and onDisable', () => {
      const gdCode = `extends Node
func _enter_tree():
\tpass
func _exit_tree():
\tpass
`
      const res = GDScriptTranspiler.gdscriptToTypeScript(gdCode, 'LifeCycleTest')
      expect(res.code).toContain('onEnable(): void')
      expect(res.code).toContain('onDisable(): void')
    })
  })

  describe('C# Unity Parity', () => {
    it('transpiles C# class with export default, LindenBehaviour, and transform rotation', () => {
      const csCode = `using UnityEngine;

public class Turret : LindenBehaviour
{
    [SerializeField] private float turnSpeed = 45f;

    public override void Start()
    {
        Debug.Log("Turret initialized");
    }

    public override void Update(float deltaTime)
    {
        transform.Rotate(0, turnSpeed * deltaTime, 0);
    }
}
`
      const res = CSharpTranspiler.csharpToTypeScript(csCode, 'Turret')
      expect(res.code).toContain('export class Turret extends Node')
      expect(res.code).toContain('export default Turret')
      expect(res.code).toContain('public turnSpeed: number = 45')
      expect(res.code).toContain('onInit(): void')
      expect(res.code).toContain('onUpdate(deltaTime: number): void')
      expect(res.code).toContain('this.rotate(0, turnSpeed * deltaTime, 0)')
    })
  })

  describe('Rust & WebAssembly Bridge', () => {
    it('transpiles Rust struct with #[linden_script] to TypeScript class', () => {
      const rsCode = `use linden_engine::prelude::*;

pub struct VoxelGenerator {
    pub chunk_size: u32,
    pub is_active: bool,
}

#[linden_script]
impl VoxelGenerator {
    pub fn init(&mut self, ctx: &mut Context) {
        self.chunk_size = 16;
        ctx.log("Voxel generator initialized");
    }

    pub fn update(&mut self, ctx: &mut Context, dt: f32) {
    }
}
`
      const res = RustWasmBridge.rustToTypeScript(rsCode, 'VoxelGenerator')
      expect(res.code).toContain('export class VoxelGenerator extends Node')
      expect(res.code).toContain('export default VoxelGenerator')
      expect(res.code).toContain('public chunk_size: number = 0')
      expect(res.code).toContain('public is_active: boolean = false')
      expect(res.code).toContain('onInit(context: any): void')
      expect(res.code).toContain('this.chunk_size = 16')
      expect(res.code).toContain('console.log("Voxel generator initialized")')
    })

    it('generates WebAssembly runtime wrapper for precompiled .wasm module', () => {
      const wrapper = RustWasmBridge.createWasmModuleWrapper('assets/scripts/physics_opt.wasm', 'PhysicsOpt')
      expect(wrapper).toContain('export class PhysicsOpt')
      expect(wrapper).toContain('fetch(\'assets/scripts/physics_opt.wasm\')')
      expect(wrapper).toContain('WebAssembly.instantiate')
      expect(wrapper).toContain('onUpdate(deltaTime: number): void')
      expect(wrapper).toContain('export default PhysicsOpt;')
    })
  })

  describe('TransmuterCore Cross-Language Router', () => {
    it('auto-detects language from file extension and content', () => {
      expect(TransmuterCore.detectLanguage('scripts/player.gd')).toBe('gdscript')
      expect(TransmuterCore.detectLanguage('scripts/Enemy.cs')).toBe('csharp')
      expect(TransmuterCore.detectLanguage('scripts/generator.rs')).toBe('rust')
      expect(TransmuterCore.detectLanguage('scripts/ui.ts')).toBe('typescript')

      expect(TransmuterCore.detectLanguage('func _ready():\n  pass')).toBe('gdscript')
      expect(TransmuterCore.detectLanguage('using UnityEngine;\npublic class X : MonoBehaviour {}')).toBe('csharp')
    })

    it('transmutes C# directly to GDScript via intermediate AST', () => {
      const csCode = `using UnityEngine;
public class Mover : MonoBehaviour
{
    void Start()
    {
    }
    void Update()
    {
    }
}
`
      const result = TransmuterCore.transmute({
        sourceLang: 'csharp',
        targetLang: 'gdscript',
        code: csCode,
        className: 'Mover',
      })

      expect(result.targetLang).toBe('gdscript')
      expect(result.code).toContain('func _ready():')
      expect(result.code).toContain('func _process(delta):')
    })

    it('transmutes GDScript to C# via intermediate AST', () => {
      const gdCode = `extends Node
func _ready():
\tpass
func _process(delta):
\tpass
`
      const result = TransmuterCore.transmute({
        sourceLang: 'gdscript',
        targetLang: 'csharp',
        code: gdCode,
        className: 'Controller',
      })

      expect(result.targetLang).toBe('csharp')
      expect(result.code).toContain('public class Controller : MonoBehaviour')
      expect(result.code).toContain('void Start()')
      expect(result.code).toContain('void Update()')
    })
  })
})
