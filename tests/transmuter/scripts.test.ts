import { describe, it, expect } from 'vitest'
import { GDScriptTranspiler } from '../../engine/transmuter/scripts/gdscript/GDScriptTranspiler'
import { CSharpTranspiler } from '../../engine/transmuter/scripts/csharp/CSharpTranspiler'

describe('Transmuter: Script Transpilation (TC-SC-01 to TC-SC-08)', () => {
  // TC-SC-01: GDScript basic
  it('TC-SC-01: transpiles _ready, _process(delta), and @export var speed = 200 to TypeScript', () => {
    const gdCode = `extends CharacterBody2D

@export var speed: float = 200.0

func _ready():
\tprint("Player ready")

func _process(delta):
\tposition.x += speed * delta
`
    const res = GDScriptTranspiler.gdscriptToTypeScript(gdCode, 'Player')

    expect(res.code).toContain('export class Player extends CharacterBody2D')
    expect(res.code).toContain('public speed: number = 200.0')
    expect(res.code).toContain('onInit(): void')
    expect(res.code).toContain('onUpdate(delta: number): void')
    expect(res.hasUnsupported).toBe(false)
  })

  // TC-SC-02: GDScript signal
  it('TC-SC-02: transpiles signal died and died.emit() / emit_signal("died")', () => {
    const gdCode = `extends Node

signal died(score)

func take_damage():
\tdied.emit(100)
\temit_signal("died", 50)
`
    const res = GDScriptTranspiler.gdscriptToTypeScript(gdCode, 'Health')

    expect(res.code).toContain("public readonly died = new Signal('died', this)")
    expect(res.code).toContain('this.died.emit(100)')
    expect(res.code).toContain('this.emitSignal("died", 50)')
  })

  // TC-SC-03: GDScript unsupported construct stub
  it('TC-SC-03: handles unsupported await get_tree().create_timer with TRANSMUTER-TODO stub', () => {
    const gdCode = `extends Node

func wait_something():
\tawait get_tree().create_timer(1).timeout
`
    const res = GDScriptTranspiler.gdscriptToTypeScript(gdCode, 'TimerTest')

    expect(res.hasUnsupported).toBe(true)
    expect(res.code).toContain('// TRANSMUTER-TODO: Unsupported GDScript: await get_tree().create_timer(1).timeout')
  })

  // TC-SC-04: C# MonoBehaviour
  it('TC-SC-04: transpiles Start, Update, [SerializeField] float speed, GetComponent<Rigidbody>() to TypeScript', () => {
    const csCode = `using UnityEngine;

public class Mover : MonoBehaviour
{
    [SerializeField] private float speed = 10f;

    void Start()
    {
        var rb = GetComponent<Rigidbody>();
    }

    void Update()
    {
    }
}
`
    const res = CSharpTranspiler.csharpToTypeScript(csCode, 'Mover')

    expect(res.code).toContain('export class Mover extends Node')
    expect(res.code).toContain('public speed: number = 10')
    expect(res.code).toContain('onInit(): void')
    expect(res.code).toContain('onUpdate(deltaTime: number): void')
    expect(res.code).toContain("this.getComponent('Rigidbody')")
  })

  // TC-SC-05: C# coroutine to async/await
  it('TC-SC-05: transpiles IEnumerator coroutine with WaitForSeconds to async/await', () => {
    const csCode = `using System.Collections;
using UnityEngine;

public class DelayAction : MonoBehaviour
{
    IEnumerator FadeOut()
    {
        yield return new WaitForSeconds(2.5f);
    }
}
`
    const res = CSharpTranspiler.csharpToTypeScript(csCode, 'DelayAction')

    expect(res.code).toContain('async FadeOut(): Promise<void>')
    expect(res.code).toContain('await new Promise((r) => setTimeout(r, 2.5 * 1000));')
  })

  // TC-SC-06: C# LINQ / complex generic stub
  it('TC-SC-06: replaces complex LINQ with TRANSMUTER-TODO stub without crashing', () => {
    const csCode = `using System.Linq;
using UnityEngine;

public class LinqQuery : MonoBehaviour
{
    void Start()
    {
        var activeEnemies = enemies.Where(x => x.hp > 0).Select(x => x.name);
    }
}
`
    const res = CSharpTranspiler.csharpToTypeScript(csCode, 'LinqQuery')

    expect(res.hasUnsupported).toBe(true)
    expect(res.code).toContain('// TRANSMUTER-TODO: Unsupported LINQ/Generic')
  })

  // TC-SC-07: TypeScript to GDScript export
  it('TC-SC-07: exports TypeScript rotating cube logic to GDScript _process', () => {
    const tsCode = `export class RotatingCube {
  onUpdate(delta: number) {
    this.rotateY(delta);
  }
}`
    const gdCode = GDScriptTranspiler.typeScriptToGDScript(tsCode)

    expect(gdCode).toContain('func _process(delta):')
    expect(gdCode).toContain('rotate_y(delta)')
  })

  // TC-SC-08: Sandbox / No script execution
  it('TC-SC-08: safely parses scripts without executing harmful payload instructions', () => {
    const maliciousScript = `extends Node
func _ready():
\tOS.execute("rm", ["-rf", "/"])
`
    // Pure lexical parse without eval/exec
    const res = GDScriptTranspiler.gdscriptToTypeScript(maliciousScript, 'SafeCheck')
    expect(res.code).toContain('export class SafeCheck')
  })
})
