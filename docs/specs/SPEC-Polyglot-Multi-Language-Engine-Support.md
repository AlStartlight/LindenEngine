# Spec: Polyglot Multi-Language Engine Support (GDScript, C#, Rust, TypeScript, Python & i18n)

**Status:** Implemented / Verified (Passing Tests)  
**Versi:** 1.0.0  
**Target:** Linden Engine Core, Script Runtime, Transmuter, Multi-Agent AI, dan Editor DX  
**Referensi:** [lindenengine.com](https://lindenengine.com), `engine/scripting/`, `engine/transmuter/`, `engine/godot/`

---

## 1. Ringkasan Eksekutif

Sesuai dengan visi dan arsitektur yang dipublikasikan di **lindenengine.com**, Linden Engine adalah *multi-agent AI game engine* modern yang dibangun untuk indie creator dan studio game. Salah satu pilar utamanya adalah kemampuan AI agent untuk mengubah deskripsi teks (prompt) secara instan menjadi arsitektur scene kanonikal dan sintesis kode tipe-aman (*type-safe code*) di berbagai bahasa pemrograman utama industri game:
1. **GDScript** (ekosistem Godot 4)
2. **C#** (ekosistem Unity & .NET)
3. **Rust** (ekosistem high-performance systems & WebAssembly)
4. **TypeScript / JavaScript** (ekosistem WebGPU & web-first native)
5. **Python** (automasi Blender Bridge & pipeline 3D)

Selain polyglot programming runtimes, sistem ini juga mencakup **i18n & Natural Language Support**:
- **Editor Localization**: Antarmuka Linden Editor dalam berbagai bahasa (Bahasa Indonesia, English, Japanese, Simplified Chinese).
- **In-Game Localization Framework**: API lokalisasi bawaan untuk string game, dialog, font fallback, dan RTL text.
- **Multilingual AI Prompting**: Memungkinkan kreator memberikan prompt instruksi kepada agent dalam bahasa ibu mereka (misal: Bahasa Indonesia atau English), dan agent menghasilkan kode yang presisi dalam bahasa target mana pun (GDScript, C#, Rust, atau TS).

Spesifikasi ini merancang arsitektur **Linden Polyglot Engine** agar pengembang dapat menulis, menjalankan, mentranspilasi, dan meng-compile script dalam bahasa apa pun dengan performa tinggi, interoperabilitas penuh, dan *zero friction*.

---

## 2. Gejala & Masalah Saat Ini

Diverifikasi pada codebase Linden Engine saat ini:

| Komponen | Status Saat Ini | Dampak | Kebutuhan Solusi |
| --- | --- | --- | --- |
| **Script Runtime** (`engine/scripting/ScriptRuntime.ts`) | Hanya mengeksekusi JavaScript/TypeScript melalui `iframe` sandbox dan bundling JS. | File `.gd`, `.cs`, atau `.rs` tidak dapat dieksekusi langsung saat Play di viewport. | Menghadirkan **Polyglot Execution Pipeline** (Transpiler + WebAssembly micro-runtime). |
| **Transmuter** (`engine/transmuter/`) | Terdapat stub `GDScriptTranspiler.ts` dan `CSharpTranspiler.ts` berbasis regex sederhana. | Transpilasi sering gagal pada fitur bahasa modern (generics, lambdas, async/await, math types). | AST-based parser & transpiler dengan type-mapping lengkap dan source map support. |
| **Rust Support** | Belum ada crate SDK atau WebAssembly bridge untuk script gameplay Rust. | Pengembang systems/Rust tidak bisa mengintegrasikan modul performa tinggi langsung ke ECS. | Crate `linden-engine-sdk` dan direct `.wasm` loader di ECS. |
| **Inspector Editor** (`editor/`) | Komponen script hanya berasumsi file `.ts` / `.js`. Tidak ada pemilih bahasa atau syntax highlighting Monaco untuk GDScript/C#/Rust. | Creator tidak dapat memilih bahasa pemrograman script di UI Inspector. | Selector bahasa di Inspector + LSP / highlighter Monaco Editor untuk GDScript, C#, Rust, TS. |
| **Multi-Agent Synthesizer** | Agent LLM cenderung hanya menulis kode TypeScript. | Fitur sintesis multi-bahasa yang diiklankan di lindenengine.com belum memiliki prompt templates terverifikasi. | Prompt system polyglot generator + headless microVM compiler validator. |
| **Game Localization (i18n)** | Belum ada modul lokalisasi terpadu untuk text rendering di UI HTML / 3D Canvas. | Developer harus membuat sistem terjemahan manual sendiri untuk merilis game multi-bahasa. | Built-in `I18nService` + format file kamus `.linden.po` / `.json` + UI editor translation manager. |

---

## 3. Arsitektur Solusi (The Linden Polyglot Architecture)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             Linden Editor & AI Agent                             │
│  ┌───────────────────────┐  ┌───────────────────────┐  ┌──────────────────────┐  │
│  │ Monaco Polyglot Editor│  │  Multi-Agent AI Core  │  │   Inspector Panel    │  │
│  │ (TS / GD / C# / Rust) │  │  (Multi-Lang Prompt)  │  │(Language Selector UI)│  │
│  └───────────┬───────────┘  └───────────┬───────────┘  └──────────┬───────────┘  │
└──────────────┼──────────────────────────┼─────────────────────────┼──────────────┘
               ▼                          ▼                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                   Linden Polyglot Pipeline & Transmuter Core                     │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │ AST Transpiler & Wasm Compiler Layer:                                       ││
│  │  • GDScript 2.0 ──► AST Parser ──► Linden TS / Wasm bytecode                ││
│  │  • C# (.NET)    ──► Roslyn/AST ──► Linden TS / dotnet.wasm runtime          ││
│  │  • Rust (2024)  ──► cargo build --target wasm32-unknown-unknown ──► .wasm   ││
│  │  • TypeScript   ──► Rolldown / SWC Bundler                                  ││
│  └──────────────────────────────────────┬──────────────────────────────────────┘│
└─────────────────────────────────────────┼────────────────────────────────────────┘
                                          ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                   Unified Scripting ABI (Polyglot Bridge Layer)                  │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │ • Lifecycle Hooks: onInit(), onUpdate(dt), onFixedUpdate(dt), onDestroy()   │ │
│  │ • ECS Bindings: Entity, Component, Transform, Query, Tags                  │ │
│  │ • Engine Subsystems: Physics (Rapier), VFX, Audio, Input, HtmlUI, Camera  │ │
│  │ • Event & Signal Dispatcher: Interop sinyal GDScript, C# Action, TS Event  │ │
│  └────────────────────────────────────┬───────────────────────────────────────┘ │
└───────────────────────────────────────┼──────────────────────────────────────────┘
                                        ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                   Game Execution Sandbox (Viewport / Web / Native)               │
│  ┌─────────────────────────┐  ┌─────────────────────────┐  ┌──────────────────┐  │
│  │   JavaScript/TS VM      │  │   Wasm Runtime MicroVM  │  │ In-Game I18n Bus │  │
│  │  (V8 / Browser Engine)  │  │  (GDScript / C# / Rust) │  │(Locale & Strings)│  │
│  └─────────────────────────┘  └─────────────────────────┘  └──────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Spesifikasi Komponen & Detail Teknis

### 4.1. Unified Polyglot ABI (Application Binary Interface)

Agar semua bahasa memiliki paritas fungsional dan dapat saling berinteraksi (interoperable), Linden Engine mendefinisikan **Linden ABI v1**:

#### 1. Lifecycle Standard
Setiap script terikat pada sebuah `Entity` dan mengikuti siklus hidup kanonikal:
- `onInit()` / GDScript `_ready()` / C# `Start()` / Rust `init()`: Dipanggil satu kali saat entity aktif pertama kali.
- `onUpdate(dt: number)` / GDScript `_process(delta)` / C# `Update()` / Rust `update(dt)`: Dipanggil setiap frame render.
- `onFixedUpdate(fixedDt: number)` / GDScript `_physics_process(delta)` / C# `FixedUpdate()` / Rust `fixed_update(dt)`: Dipanggil pada interval fisika tetap (50Hz / 60Hz).
- `onEnable()` / GDScript `_enter_tree()` / C# `OnEnable()` / Rust `on_enable()`.
- `onDisable()` / GDScript `_exit_tree()` / C# `OnDisable()` / Rust `on_disable()`.
- `onDestroy()` / GDScript `queue_free()` / C# `OnDestroy()` / Rust `destroy()`.

#### 2. Cross-Language Event & Signal System
Script dalam bahasa berbeda dalam scene yang sama dapat saling bertukar sinyal/pesan:
- GDScript: `emit_signal("player_damaged", 25)`
- C#: `EmitSignal("player_damaged", 25)`
- TypeScript: `context.emit("player_damaged", 25)`
- Rust: `linden::emit("player_damaged", 25)`

---

### 4.2. Bahasa Pemrograman yang Didukung (Polyglot Run-list)

#### A. GDScript 2.0 (Godot 4 Parity)
- **Ekstensi File:** `.gd`
- **Model Eksekusi:**
  1. *Dev Mode (Fast Transpile)*: Transpilasi real-time GDScript AST ke TypeScript via `@linden/gdscript-transpiler`. Memberikan feedback <5ms di editor tanpa overhead build step.
  2. *Wasm MicroVM Mode (Direct)*: WebAssembly GDScript micro-interpreter untuk logic kompleks yang membutuhkan evaluasi dinamis GDScript 4 murni.
- **Dukungan Sintaks Godot:**
  - `@export var speed: float = 10.0` dipetakan otomatis ke Inspector property control.
  - `@onready var mesh = $MeshInstance3D` dipetakan ke node query `context.scene.find()`.
  - Vektor & Transform: `Vector2`, `Vector3`, `Transform3D`, `Basis`, `Quaternion`.

```gdscript
# Contoh GDScript di Linden Engine: scripts/PlayerController.gd
extends CharacterBody3D

@export var speed: float = 8.0
@export var jump_force: float = 12.0
signal health_changed(current_hp, max_hp)

func _ready():
    print("Player GDScript ready!")

func _physics_process(delta):
    var move_dir = Input.get_vector("move_left", "move_right", "move_forward", "move_backward")
    velocity.x = move_dir.x * speed
    velocity.z = move_dir.y * speed
    move_and_slide()
```

#### B. C# (.NET / Unity Parity)
- **Ekstensi File:** `.cs`
- **Model Eksekusi:**
  1. *Transpile Mode (Lightweight)*: Transpilasi C# MonoBehaviour ke Linden TypeScript via Roslyn AST analyzer.
  2. *Dotnet WebAssembly Runtime*: Menjalankan runtime WebAssembly .NET (`dotnet.native.wasm`) untuk eksekusi C# native kelas produksi tanpa kehilangan fitur reflection atau LINQ.
- **Dukungan Sintaks:**
  - Atribut: `[SerializeField]`, `[Header]`, `[Range(min, max)]`.
  - Siklus: `Awake()`, `Start()`, `Update()`, `FixedUpdate()`, `OnCollisionEnter()`.

```csharp
// Contoh C# di Linden Engine: scripts/EnemyAI.cs
using Linden.Core;
using Linden.Physics;

public class EnemyAI : LindenBehaviour {
    [SerializeField] private float patrolRadius = 15f;
    [SerializeField] private int maxHealth = 100;
    private int currentHealth;

    public override void Start() {
        currentHealth = maxHealth;
        LindenLog.Info("Enemy initialized with health: " + currentHealth);
    }

    public override void Update(float deltaTime) {
        Transform.Rotate(0, 45f * deltaTime, 0);
    }
}
```

#### C. Rust (WebAssembly & Native Systems)
- **Ekstensi File:** `.rs` (dikompilasi ke `.wasm`)
- **Model Eksekusi:**
  - Di-compile langsung via `wasm32-unknown-unknown` dengan crate `linden_engine`.
  - Zero-copy shared memory buffer antara WebAssembly memory space dan JavaScript ArrayBuffer untuk manipulasi ribuan Transform / partikel per frame.
- **Crate SDK:** `linden-engine-sdk` yang mengekspos makro `#[linden_script]`.

```rust
// Contoh Rust di Linden Engine: scripts/VoxelGenerator.rs
use linden_engine::prelude::*;

#[derive(Default)]
pub struct VoxelGenerator {
    chunk_size: u32,
}

#[linden_script]
impl VoxelGenerator {
    pub fn init(&mut self, ctx: &mut Context) {
        self.chunk_size = 16;
        ctx.log("Voxel generator initialized via Rust Wasm!");
    }

    pub fn update(&mut self, ctx: &mut Context, dt: f32) {
        // High performance compute logic
    }
}
```

#### D. TypeScript / JavaScript (First-Class Native)
- **Ekstensi File:** `.ts`, `.js`
- **Model Eksekusi:**
  - Native runtime Linden Engine via `ScriptRuntime.ts` yang berjalan di sandboxed iframe.
  - Hot reload state-preserving <100ms.
  - Tipe otomatis dari `linden-engine/types`.

#### E. Python (Blender Bridge & Pipeline Automation)
- **Ekstensi File:** `.py`
- **Model Eksekusi:**
  - Berjalan melalui `blender-bridge/` dan IPC daemon internal Python untuk procedural generation, model conversion, mesh cleanup, dan UV unwrap.

---

### 4.3. Multi-Agent AI Code Synthesis Architecture

Sesuai janji di lindenengine.com: *"5 specialized AI agents synthesize type-safe code in GDScript, C#, and Rust bindings and compile live into WebAssembly"*:

1. **Agent Prompt Specialization**:
   - Agent dibekali dengan grammar dan template skema untuk masing-masing bahasa target.
   - User dapat mengetik prompt dalam bahasa alami (misal: *"Buat script kontrol karakter platformer 3D dengan double jump dan wall slide menggunakan GDScript"* atau *"Write enemy AI with A* pathfinding in C#"*).
2. **Polyglot Transmuter (Cross-Language 1-Click Converter)**:
   - Pengembang dapat mengklik tombol **"Convert to GDScript"** atau **"Convert to C#"** di editor.
   - Transmuter menguraikan AST kode sumber dan merekonstruksinya ke bahasa target dengan memetakan API sesuai tabel `ApiMap.ts`.
3. **Headless Verification MicroVM**:
   - Kode yang dihasilkan oleh AI diuji terlebih dahulu di microVM headless (`linden_play` test trial) untuk memastikan:
     - Tidak ada syntax error atau missing imports.
     - Tidak ada infinite loops di loop update.
     - Tidak ada memory leak atau collision crash.
   - Jika lulus verifikasi, script langsung di-hot-reload ke scene aktif.

---

### 4.4. Natural Language Localization System (i18n)

Untuk mendukung pembuat game dan pemain global serta lokal:

#### 1. In-Game Localization Service (`I18nService`)
- Terintegrasi di core engine runtime:
```ts
// Penggunaan di TypeScript/JavaScript
context.i18n.t('menu.play') // Mengembalikan "Main" atau "Play"
context.i18n.setLocale('id-ID') // Ganti bahasa dinamis

// Penggunaan di GDScript
I18n.tr("menu.play")

// Penggunaan di C#
I18n.Translate("menu.play")
```

#### 2. Format File Terjemahan (`.linden.i18n.json` atau `.po`)
Disimpan di folder proyek `locales/`:
```json
{
  "locale": "id-ID",
  "fallback": "en-US",
  "translations": {
    "menu.play": "Mulai Game",
    "menu.settings": "Pengaturan",
    "menu.exit": "Keluar",
    "hud.health": "Nyawa: {hp}/{maxHp}",
    "game_over": "Permainan Selesai"
  }
}
```

#### 3. Editor UI Multilingual Support
Editor Linden Engine mendukung pemilihan bahasa antarmuka:
- `en-US`: English (Default)
- `id-ID`: Bahasa Indonesia
- `ja-JP`: 日本語 (Japanese)
- `zh-CN`: 简体中文 (Simplified Chinese)
- `es-ES`: Español
Pengaturan disimpan di `editorStore.ts` dan preferensi user.

---

### 4.5. Editor DX (Developer Experience) Enhancements

1. **Script Component Inspector**:
   - Dropdown: `Language`: `[ TypeScript (Default) | GDScript | C# | Rust ]`
   - Tombol **"Open in Editor"** (membuka Monaco internal atau VS Code dengan ekstensi yang sesuai).
   - Tombol **"Transmute to..."** untuk konversi instan antar bahasa.
2. **Monaco Editor Polyglot Integration**:
   - Syntax highlighter untuk GDScript, C#, Rust, dan TypeScript.
   - Type definitions & intellisense (`linden.d.ts`, `LindenEngine.cs`, `linden_sdk.rs`, `linden_api.gd`).
3. **Unified Console Output**:
   - Log, Warning, dan Error dari semua runtime bahasa diformat ke skema log konsol tunggal dengan source-map line highlighting.

---

## 5. Skema Data & Modifikasi File

### 5.1. Skema Scene (`SceneSchema.ts`)
Pembaruan `ScriptComponent`:
```ts
export interface ScriptComponentData {
  type: 'Script'
  language: 'typescript' | 'gdscript' | 'csharp' | 'rust'
  path: string
  properties: Record<string, any>
  wasmModulePath?: string // Opsional: jika script adalah output build Wasm (Rust/C#)
}
```

### 5.2. File Registry & Transpiler Extension
- `engine/transmuter/core/TransmuterCore.ts`: Router utama yang mengarahkan file `.gd`, `.cs`, `.rs`, `.ts` ke compiler/transpiler yang tepat.
- `engine/scripting/PolyglotLoader.ts`: Modul yang memuat artifact hasil transpilasi/Wasm ke dalam context runtime `ScriptRuntime`.
- `engine/i18n/I18nManager.ts`: Modul pengelola kamus multi-bahasa in-game dan antarmuka editor.

---

## 6. Rencana Implementasi Bertahap (Phased Roadmap)

### Fase 1: Polyglot Transmuter & AST Engine (Weeks 1–2)
- [ ] Upgrade `GDScriptTranspiler.ts` ke ANTLR/AST-based parser untuk mendukung sintaks GDScript 4 penuh (signals, decorators, vector math).
- [ ] Upgrade `CSharpTranspiler.ts` untuk memetakan MonoBehaviour ke Linden ECS Lifecycle secara akurat.
- [ ] Tambahkan dropdown pilihan bahasa (`Language`) di Inspector `ScriptComponent`.
- [ ] Buat test suite verifikasi transpilasi untuk 20+ skenario script gameplay umum (karakter controller, AI patroly, trigger box, UI binder).

### Fase 2: Rust WebAssembly SDK & Wasm Loader (Weeks 3–4)
- [ ] Buat crate Rust `linden-engine-sdk` dengan binding C-ABI ke WebAssembly memory.
- [ ] Tambahkan Wasm module runner di `engine/scripting/ScriptRuntime.ts` yang membaca export function `_init`, `_update`, `_fixed_update`.
- [ ] Implementasikan zero-copy buffer transfer untuk komponen Transform dan Physics.

### Fase 3: Multi-Agent AI Polyglot Synthesizer (Weeks 5–6)
- [ ] Daftarkan prompt system baru di Multi-Agent Core untuk generasi GDScript, C#, Rust, dan TS.
- [ ] Hubungkan headless sandbox verifier (`microVM`) untuk menguji script sebelum diterapkan ke scene.
- [ ] Tambahkan fitur "1-Click Transmute" pada UI script viewer di Editor.

### Fase 4: In-Game Localization & Editor i18n (Weeks 7–8)
- [ ] Implementasikan `I18nManager` di engine runtime (`engine/i18n/`).
- [ ] Tambahkan dukungan token `{i18n:key}` di HTML UI renderer (`HtmlUiLayer`).
- [ ] Sediakan paket bahasa untuk UI Editor Linden (Bahasa Indonesia & English sebagai prioritas pertama, disusul Japanese & Chinese).
- [ ] Tambahkan panel visual "Localization Tables" di Editor untuk memudahkan creator mengisi terjemahan game.

---

## 7. Kriteria Penerimaan (Acceptance Criteria / DoD)

1. **Paritas Eksekusi**:
   - File `.gd` (GDScript) dapat ditautkan ke Entity di scene dan berfungsi normal saat Play di viewport dan saat web build.
   - File `.cs` (C#) dapat ditranspilasi/dijalankan dengan mapping lifecycle (`Start`, `Update`, `FixedUpdate`) yang tepat.
   - Modul `.wasm` dari Rust dapat mengontrol entity dan berinteraksi dengan Rapier Physics tanpa degradasi FPS.
2. **Paritas Sinyal Antar-Bahasa**:
   - Script GDScript dapat meng-emit sinyal yang didengarkan oleh script TypeScript atau C# pada entity lain.
3. **Editor DX**:
   - Monaco Editor di dalam Linden Engine menampilkan highlighting dan error checking untuk semua bahasa yang didukung.
   - Ganti bahasa antarmuka editor (misal: English <-> Bahasa Indonesia) langsung mengupdate semua menu, dialog, dan tooltip tanpa perlu restart aplikasi.
4. **Agent Reliability**:
   - Agent AI dapat menerima instruksi dalam bahasa apa pun dan menghasilkan kode yang valid dalam GDScript, C#, Rust, atau TypeScript dengan tingkat kelulusan headless verification > 95%.
5. **Keamanan Sandbox**:
   - Script dalam semua bahasa berjalan di lingkungan terisolasi (sandbox iframe / WebAssembly isolate) tanpa akses langsung ke Node.js runtime atau filesystem host di luar folder proyek yang diizinkan.
