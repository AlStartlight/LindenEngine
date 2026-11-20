import { Component } from '../ecs/Component'

export type ScriptLanguage = 'auto' | 'typescript' | 'gdscript' | 'csharp' | 'rust'

/**
 * Links an entity to a gameplay script in scripts/ (TS, GDScript, C#, or Rust).
 * The script runs in Play (viewport Game Frame), linden_play and the web build via ScriptRuntime.
 */
export class Script extends Component {
  public src: string = ''
  public language: ScriptLanguage = 'auto'
  /** Initial values for the script's public fields, applied before onInit */
  public props: Record<string, unknown> = {}

  constructor() {
    super('Script')
  }

  detectLanguage(): 'typescript' | 'gdscript' | 'csharp' | 'rust' {
    if (this.language && this.language !== 'auto') return this.language
    if (this.src.endsWith('.gd')) return 'gdscript'
    if (this.src.endsWith('.cs')) return 'csharp'
    if (this.src.endsWith('.rs') || this.src.endsWith('.wasm')) return 'rust'
    return 'typescript'
  }

  clone(): Script {
    const c = new Script()
    c.src = this.src
    c.language = this.language
    c.props = JSON.parse(JSON.stringify(this.props ?? {}))
    c.isEnabled = this.isEnabled
    return c
  }
}

/**
 * HTML/CSS overlay rendered on top of the game canvas ('screen') or attached to the entity in 3D ('world').
 * The fragment must not contain <script>; logic lives in scripts via ctx.ui.
 */
export class HtmlUI extends Component {
  public src: string = ''
  public mode: 'screen' | 'world' = 'screen'
  public zIndex: number = 0
  public pointerEvents: boolean = false
  public pixelSize: number = 0.01

  constructor() {
    super('HtmlUI')
  }

  clone(): HtmlUI {
    const c = new HtmlUI()
    c.src = this.src
    c.mode = this.mode
    c.zIndex = this.zIndex
    c.pointerEvents = this.pointerEvents
    c.pixelSize = this.pixelSize
    c.isEnabled = this.isEnabled
    return c
  }
}
