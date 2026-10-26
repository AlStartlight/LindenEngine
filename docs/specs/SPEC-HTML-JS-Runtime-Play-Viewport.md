# Spec: Render HTML & JavaScript saat Play di viewport dan di build web (termasuk game 3D HTML)

Oct 26, 2026 · @accept

## Ringkasan

Linden menjanjikan alur **Prompt → Game → Preview → Export HTML** (lihat `docs/PRD-New_product/PRD.md`). Saat ini yang benar-benar jalan hanyalah scene `.lscene` berisi primitive + fisika. Kode JavaScript/TypeScript game tidak pernah dieksekusi, HTML tidak bisa ditampilkan di viewport, dan Play di editor tetap dirender dari kamera editor, bukan kamera game.

Spec ini menambahkan tiga kemampuan yang memakai satu runtime yang sama di editor dan di build web:

1. **Script JS/TS** di `scripts/` dijalankan saat Play di viewport dan di build web.
2. **HTML UI overlay** (HUD, menu, skor) yang dirender di atas canvas 3D, baik di viewport saat Play maupun di build web.
3. **HTML Game**: proyek yang berisi `index.html` + JS sendiri (misalnya game three.js/WebGL/WebGPU buatan tangan atau buatan agent) bisa dijalankan dan ditampilkan di viewport saat Play, lalu diekspor apa adanya.

## Gejala

1. Agent menulis `scripts/PlayerController.ts` lewat `linden_script_write`. Tekan **Play** di editor: fisika jalan, tetapi Player tidak bisa digerakkan. Tidak ada error di Console.
2. Build web (`linden_export_web`) berhasil, tetapi game di browser juga tidak merespons input. Folder `scripts/` tidak ada di output.
3. Saat Play, viewport tetap memakai kamera orbit editor (10, 10, 10). Komponen `Camera` di scene diabaikan, jadi yang terlihat berbeda dengan hasil build web.
4. Tidak ada cara menampilkan skor, nyawa, atau menu "Game Over" di atas viewport.
5. Pengguna yang punya game 3D HTML (`index.html` + `main.js` dengan three.js) tidak bisa membukanya di Linden. Viewport hanya bisa merender scene `.lscene`.

## Akar masalah

Diverifikasi terhadap `main` + perubahan lokal (26 Okt 2026):

| # | Masalah | Lokasi | Dampak |
| --- | --- | --- | --- |
| R1 | `ScriptComponent` memakai `import(this.scriptPath)` dengan path proyek mentah. Vite/Electron tidak bisa meng-import file `.ts` dari luar root app, dan TS tidak di-transpile. | `engine/scripting/ScriptSystem.ts:94`, `:131` | Script tidak pernah termuat. |
| R2 | `ScriptComponent` tidak terdaftar di `ComponentRegistry` dan tidak punya bentuk di skema `.lscene`. | `engine/ecs/ComponentRegistry.ts`, `engine/scene/SceneSchema.ts` | Scene tidak bisa menautkan script ke entity. Agent menulis script yang tidak dipakai siapa pun. |
| R3 | `startPlay`/`stepPlay` hanya menjalankan fisika, `Input`, `Tween`, dan `world.update`. Tidak ada tahap muat/eksekusi script. | `editor/store/editorStore.ts:250`, `:312` | Play di editor tidak menjalankan logika game. |
| R4 | `stepPlay` memakai `dt = 1/50` tetap, dipanggil sekali per `requestAnimationFrame`. | `editor/store/editorStore.ts:314` | Kecepatan game bergantung FPS monitor (60 Hz vs 120 Hz berbeda 2×). |
| R5 | Render loop viewport selalu memakai `cameraRef` (kamera editor), juga saat Play. | `editor/viewport/SceneViewport.tsx:347` | Hasil Play tidak sama dengan build web. |
| R6 | `WebBuildRunner` hanya menyalin `scenes/` dan `assets/`. `LindenPlayer` tidak punya tahap muat script. | `electron/build/WebBuildRunner.ts:217`, `player/player.ts` | Build web tanpa logika game. |
| R7 | Tidak ada komponen atau layer DOM untuk UI HTML. `SceneViewport` hanya punya overlay tint & stats. | `editor/viewport/SceneViewport.tsx` | Tidak ada HUD. |
| R8 | CSP editor (`index.html`) dan `BrowserWindow` tidak menyediakan tempat aman untuk menjalankan HTML/JS milik proyek. Menjalankannya langsung di renderer editor berarti kode game bisa memanggil `window.electron` (preload). | `index.html:6`, `electron/main.ts:211` | HTML Game tidak bisa ditampilkan tanpa membuka celah keamanan. |
| R9 | `rolldown` hanya ada di `devDependencies`. | `package.json` | Transpile TS script di app terpaket tidak tersedia. |

## Tujuan

- G1. Script `scripts/*.ts` dan `scripts/*.js` yang ditautkan ke entity berjalan saat Play di viewport, dengan hasil yang sama di build web.
- G2. Saat Play, viewport merender dari komponen `Camera` aktif di scene (Game View). Kamera editor kembali saat Stop.
- G3. Komponen `HtmlUI` merender HTML/CSS di atas canvas, bisa membaca dan mengubah state game dari script, di viewport dan di build web.
- G4. Proyek bertipe **HTML Game** (`index.html` + JS) bisa di-Play di viewport, termasuk game 3D (WebGL2/WebGPU), dan diekspor ke web tanpa diubah.
- G5. Kode game, baik script maupun HTML Game, tidak bisa mengakses API Electron/Node, filesystem, atau IPC editor.
- G6. Error JS game tampil di panel Console editor dengan file dan baris aslinya (source map), dan tidak membuat editor crash.

## Non-tujuan

- Debugger breakpoint di dalam editor (cukup tombol "Open DevTools" untuk frame game).
- Mengedit HTML Game secara visual (hierarchy/inspector) — HTML Game diperlakukan sebagai kotak hitam.
- Paket npm pihak ketiga di script (selain `three`, yang disediakan runtime). Import bare specifier lain ditolak dengan pesan jelas.
- Hot reload state-preserving penuh. Cukup: script berubah saat Play → restart Play otomatis (opsional, lihat §8).
- Ekspor HTML Game ke desktop/mobile.

## Desain

### 1. Gambaran arsitektur

```
                 ┌───────────────────────── Editor renderer (React) ─────────────────────────┐
                 │  SceneViewport                                                           │
 Stop (edit) ──► │   ├─ <canvas> three.js + kamera editor + gizmo                            │
                 │   └─ (tidak ada kode game)                                               │
                 │                                                                          │
 Play ─────────► │   └─ <iframe sandbox src="linden-game://play/<sessionId>/index.html">     │
                 │        (Game Frame — origin terpisah, tanpa preload)                     │
                 └───────────────▲──────────────────────────────────────────┬──────────────┘
                                 │ postMessage (play/pause/stop/log/stats)  │
                                 │                                          ▼
                 ┌──────────────── Game Frame = LindenPlayer yang sama dengan build web ─────┐
                 │  mode 'scene' : World + SceneBridge + Rapier + ScriptRuntime + HtmlUI     │
                 │  mode 'html'  : index.html proyek apa adanya + shim `linden` (opsional)   │
                 └──────────────────────────────────────────────────────────────────────────┘
```

Prinsip utama: **Play di editor menjalankan `LindenPlayer` yang sama dengan build web, di dalam iframe ber-sandbox.** Jadi apa yang dilihat di viewport = apa yang dilihat pemain, dan kode game tidak pernah berjalan di konteks renderer editor yang punya akses `window.electron`.

Konsekuensi untuk kode yang ada:

- `startPlay`/`stepPlay`/`stopPlay` di `editorStore` tidak lagi menyimulasikan `world` milik editor. Saat Play, editor mengirim snapshot scene ke Game Frame. Saat Stop, frame dihancurkan. Snapshot/restore (`playSnapshot`) tidak diperlukan lagi karena world editor tidak pernah disentuh, tapi tetap dipertahankan satu rilis sebagai fallback (flag `legacyInEditorPlay`).
- `linden_play` (headless, dipakai agent) ikut memakai `ScriptRuntime` yang sama (§3) supaya error script terlapor ke agent.

### 2. Protokol `linden-game://` (main process)

Daftarkan skema privileged di `electron/main.ts` sebelum `app.ready`:

```ts
protocol.registerSchemesAsPrivileged([{
  scheme: 'linden-game',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, stream: true },
}])
```

Handler (`electron/play/GameProtocol.ts`, baru) memetakan URL ke file:

| URL | Sumber |
| --- | --- |
| `linden-game://play/<sessionId>/index.html` | template `player/index.html` (mode `scene`) atau `index.html` proyek (mode `html`) |
| `linden-game://play/<sessionId>/game.js` | runtime player prebuilt (`dist-player/`) |
| `linden-game://play/<sessionId>/scripts/<name>.js` | hasil transpile `scripts/<name>.ts` dari cache sesi (§3.3) |
| `linden-game://play/<sessionId>/scenes/…`, `assets/…`, file lain | file proyek, read-only |

Aturan:

- `sessionId` acak per Play, hanya berlaku sampai Stop. Request ke sesi yang tidak aktif → 404.
- Path dinormalisasi lalu dicek `startsWith(projectRoot)`. `..`, symlink keluar proyek, dan absolute path ditolak (403).
- Setiap response membawa header CSP game:

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:;
frame-ancestors 'self' <origin editor>
```

  `connect-src` bisa diperluas per proyek lewat `project.linden.json → play.allowNetwork: string[]` (default kosong).
- MIME dari ekstensi (`.js`/`.mjs` → `text/javascript`, `.wasm` → `application/wasm`, `.glb`, `.ktx2`, `.hdr`, dsb.). Ini juga yang dipakai `WebBuildRunner` (sudah ada map MIME di `electron/build/WebBuildRunner.ts:304`, pindahkan ke `shared/mime.ts`).

CSP editor (`index.html:6`) ditambah `frame-src linden-game:`.

### 3. Script JS/TS (mode `scene`)

#### 3.1 Komponen `Script`

Daftarkan di `ComponentRegistry` (menggantikan `ScriptComponent` lama yang tidak terdaftar):

```ts
ComponentRegistry.register({
  type: 'Script',
  menuPath: 'Scripting/Script',
  icon: 'Code',
  allowMultiple: true,
  properties: [
    { name: 'src', label: 'Script', kind: 'asset', assetKind: 'script', default: '' }, // 'scripts/PlayerController.ts'
    { name: 'props', label: 'Properties', kind: 'json', default: {} },                // nilai field publik
    { name: 'enabled', label: 'Enabled', kind: 'boolean', default: true },
  ],
})
```

Bentuk di `.lscene`:

```json
{ "type": "Script", "data": { "src": "scripts/PlayerController.ts", "props": { "speed": 6 } } }
```

Tambahkan validasi skema di `engine/scene/SceneSchema.ts` (path wajib relatif, di bawah `scripts/`, berakhiran `.ts`/`.js`/`.mjs`).

#### 3.2 Kontrak script

Kontrak `IGameScript` di `engine/scripting/ScriptSystem.ts` dipertahankan supaya script hasil agent yang sudah ada tetap jalan, dengan konteks yang dilengkapi:

```ts
export interface ScriptContext {
  entity: Entity
  world: World
  input: InputManager      // dari engine/input/InputActions (action map project)
  time: TimeManager
  physics: PhysicsApi      // raycast, applyImpulse, setLinearVelocity
  ui: HtmlUiApi            // §4
  three: typeof import('three')   // akses objek render tingkat rendah
  object3D: THREE.Object3D | null // dari SceneBridge.getObject(entity.id)
  scene: { load(path: string): Promise<void>; find(name: string): Entity | null }
  log: (...args: unknown[]) => void
}
```

Urutan siklus hidup per frame (game loop di `LindenPlayer.gameLoop`):

```
Input.update()
accumulator += min(frameDt, 0.25)
while (accumulator >= FIXED_DT /* 1/60 */) {
  scripts.onFixedUpdate(FIXED_DT); physics.step(FIXED_DT); syncTransforms(); accumulator -= FIXED_DT
}
scripts.onUpdate(frameDt * timeScale); Tween.update(...); world.update(...)
scripts.onLateUpdate?(...)
htmlUi.flush()
renderer.render(scene, activeCamera)
```

Ini menggantikan `dt = 1/50` tetap (R4).

Field publik dengan nilai awal primitif (`number`, `string`, `boolean`, `[x,y,z]`) diekspos ke Inspector. Nilainya diambil dari `props` saat instansiasi (`Object.assign(instance, props)` sebelum `onInit`).

#### 3.3 Kompilasi script

Modul baru `electron/play/ScriptCompiler.ts`, dipakai oleh Play, `linden_play`, dan `WebBuildRunner`:

- Input: semua file di `scripts/` (bukan hanya yang ditautkan, supaya import antar-script bisa jalan).
- Bundle per entry dengan `rolldown` (`platform: 'browser'`, `format: 'esm'`, `sourcemap: 'inline'` di Play, `external` dari opsi build di web). `three` dan `linden` di-resolve ke global runtime (`external: ['three', 'linden']` + import map di `index.html`). Bare import lain → error kompilasi: `Paket "x" tidak didukung di script (scripts/A.ts:3)`.
- Cache di memori per sesi Play, dikunci `mtime + size`. Kompilasi ulang hanya file yang berubah.
- Error kompilasi dikirim ke Console editor (dengan file:baris) dan Play dibatalkan dengan status jelas, bukan layar hitam.
- **Pindahkan `rolldown` dari `devDependencies` ke `dependencies`** dan pastikan binary native-nya ikut dikemas (`asarUnpack` untuk `@rolldown/binding-*`). Tambahkan test di `tests/export` bahwa `ScriptCompiler` bisa di-load dari path resource terpaket (R9).

#### 3.4 Pemuatan di player

`player/player.ts` mendapat tahap baru antara langkah 7 dan 9:

```ts
// 8b. Load & instantiate scripts
this.updateLoadingStatus('Memuat script game...', 85)
await this.scriptRuntime.loadAll(this.world, { baseUrl: this.config.basePath ?? './' })
```

`ScriptRuntime` (`engine/scripting/ScriptRuntime.ts`, baru, tanpa dependensi Node):

- Untuk setiap entity dengan `Script`, `import(new URL(src.replace(/\.ts$/, '.js'), baseUrl))`, instansiasi `default`, set `props`, panggil `onInit(ctx)`.
- Setiap callback dibungkus try/catch. Exception pertama dari satu script → script itu di-disable, error dilaporkan (`console.error` + `postMessage({type:'log'})` ke editor), game tetap jalan. Ini sesuai perilaku Unity/Godot dan memudahkan loop perbaikan agent.
- `onDestroy` dipanggil saat entity dihapus atau Stop.

`ScriptComponent`/`ScriptManager` lama ditandai `@deprecated` dan dihapus setelah satu rilis.

### 4. HTML UI overlay

#### 4.1 Komponen `HtmlUI`

```ts
ComponentRegistry.register({
  type: 'HtmlUI',
  menuPath: 'UI/HTML UI',
  icon: 'Layout',
  properties: [
    { name: 'src', label: 'HTML File', kind: 'asset', assetKind: 'html', default: '' }, // 'ui/hud.html'
    { name: 'mode', label: 'Mode', kind: 'enum', default: 'screen', options: ['screen', 'world'] },
    { name: 'zIndex', label: 'Z Index', kind: 'number', default: 0 },
    { name: 'pointerEvents', label: 'Capture Input', kind: 'boolean', default: false },
    { name: 'pixelSize', label: 'World Pixel Size', kind: 'number', default: 0.01 },  // mode 'world'
  ],
})
```

- **`screen`**: fragmen HTML disisipkan ke `<div id="linden-ui-root">` yang menumpuk di atas `#game-canvas` (`position:absolute; inset:0`). Default `pointer-events:none`, kecuali elemen dengan atribut `data-interactive` atau komponen dengan `pointerEvents: true`.
- **`world`**: memakai `CSS3DRenderer` dari `three/examples/jsm/renderers/CSS3DRenderer.js`, objek `CSS3DObject` mengikuti transform entity. Dipakai untuk label nama, health bar di atas musuh, papan info di dunia 3D. Dirender setelah `WebGLRenderer` dengan kamera yang sama.

File HTML UI adalah **fragmen** (tanpa `<html>`), boleh berisi `<style>` (di-scope otomatis dengan `@scope (#ui-<entityId>)`), dan **tidak boleh** berisi `<script>`. Logika UI ditulis di script entity lewat `ctx.ui`. Ini membuat satu jalur eksekusi kode saja (ScriptRuntime) dan mencegah HTML injeksi menjalankan kode.

Fragmen di-sanitasi saat dimuat (buang `<script>`, atribut `on*`, `javascript:` URL). Tambahkan sanitizer kecil di `engine/ui/sanitizeHtml.ts` dengan test.

#### 4.2 API `ctx.ui`

```ts
interface HtmlUiApi {
  root(entityId?: string): HTMLElement                        // root fragmen milik entity
  query<T extends Element>(selector: string): T | null
  bind(selector: string, getter: () => string | number): void // di-update tiap frame di htmlUi.flush(), hanya jika nilai berubah
  on(selector: string, event: string, handler: (e: Event) => void): () => void
  show(selector: string): void
  hide(selector: string): void
}
```

Contoh:

```ts
export default class Hud {
  coins = 0
  onInit(ctx) {
    ctx.ui.bind('#coins', () => this.coins)
    ctx.ui.on('#restart', 'click', () => ctx.scene.load('scenes/Main.lscene'))
  }
}
```

#### 4.3 Di editor (mode Stop)

Saat tidak Play, `SceneViewport` menampilkan pratinjau statis fragmen `screen` di overlay (tanpa script, sanitized, `pointer-events:none`) supaya layout HUD bisa dicek. Toggle "Show UI" di toolbar viewport. Mode `world` tidak dipratinjau di edit mode pada fase ini.

### 5. HTML Game (mode `html`)

Untuk game yang ditulis langsung sebagai halaman web (three.js, Babylon, PlayCanvas, WebGPU murni, canvas 2D).

#### 5.1 Deteksi dan konfigurasi

`project.linden.json`:

```json
{
  "runtime": "html",
  "html": {
    "entry": "web/index.html",
    "resolution": { "mode": "responsive" },
    "allowNetwork": []
  }
}
```

Tambahkan ke `LindenProjectConfig` di `shared/types/project.ts`:

```ts
runtime?: 'scene' | 'html'   // default 'scene'
html?: { entry: string; resolution?: { mode: 'responsive' | 'fixed'; width?: number; height?: number }; allowNetwork?: string[] }
play?: { allowNetwork?: string[] }
```

Wizard "New Project" mendapat template **HTML Game (three.js)** berisi `web/index.html`, `web/main.js`, dan import map ke `three` lokal (`web/vendor/three.module.js` disalin dari `node_modules/three/build`) supaya tidak bergantung CDN.

#### 5.2 Play di viewport

- Tombol Play membuka Game Frame dengan `src = linden-game://play/<sessionId>/<html.entry>`.
- Tidak ada hierarchy/inspector/gizmo. Panel Hierarchy menampilkan placeholder "HTML Game — scene dikelola oleh kode". Viewport saat Stop menampilkan kartu "Tekan Play untuk menjalankan web/index.html" + thumbnail frame terakhir.
- Pause: editor mengirim `postMessage({type:'linden:pause'})`. Shim `linden` (§5.3) menahan `requestAnimationFrame` dan menghentikan `AudioContext`. Tanpa shim, Pause dinonaktifkan dengan tooltip.
- Stop: iframe dihapus, sesi protokol dibatalkan.
- Reload saat file di `web/` berubah selama Play (watcher di main, debounce 300 ms) → iframe di-reload. Ini setara live-server.

#### 5.3 Shim `linden` (opsional untuk HTML Game)

Bridge kecil (`player/htmlBridge.ts`, ~2 KB) yang otomatis disuntikkan ke `<head>` entry HTML oleh protokol (dan oleh build web):

- Membungkus `requestAnimationFrame` agar Pause/Step bisa bekerja.
- Meneruskan `console.*`, `window.onerror`, dan `unhandledrejection` ke editor.
- Mengirim stats per 500 ms: FPS, dan jika ada `WebGLRenderer` three.js yang didaftarkan lewat `linden.registerRenderer(renderer)`, juga `renderer.info.render.triangles/calls`. Ini ditampilkan di overlay stats viewport yang sudah ada.
- Ekspos `window.linden.input` dengan action map project, sehingga HTML Game bisa memakai binding yang sama dengan editor dan touch controls (`player/touchControls.ts`).

Penyuntikan bisa dimatikan dengan `html.injectBridge: false`.

#### 5.4 Ekspor web

`WebBuildRunner` bercabang pada `runtime`:

- `scene`: seperti sekarang + salin hasil `ScriptCompiler` ke `scripts/` + `ui/` (fragmen HTML) + import map `three`.
- `html`: salin folder induk `html.entry` apa adanya, suntikkan shim (jika aktif), tulis `index.html` di root output yang redirect/iframe ke entry jika entry tidak di root. Readiness check: entry ada, semua `src`/`href` relatif di HTML entry ada di disk (warning, bukan error).

### 6. Viewport saat Play (berlaku untuk kedua mode)

Perubahan di `editor/viewport/SceneViewport.tsx` dan komponen baru `editor/viewport/GameFrame.tsx`:

- Saat `playState !== 'stopped'`, render `<GameFrame>` menumpuk penuh di atas canvas editor, dan **hentikan render loop editor** (`cancelAnimationFrame`) supaya GPU tidak merender dua scene. Lanjutkan saat Stop.
- `GameFrame` membuat `<iframe>` dengan:

```html
<iframe
  sandbox="allow-scripts allow-same-origin allow-pointer-lock"
  allow="gamepad; fullscreen; autoplay; xr-spatial-tracking; cross-origin-isolated"
  src="linden-game://play/<sessionId>/index.html">
```

  `allow-same-origin` diperlukan supaya modul ES, `fetch` aset, dan IndexedDB bekerja. Ini aman karena origin `linden-game://play` berbeda dari origin editor, dan iframe tidak memuat preload Electron. `allow-top-navigation`, `allow-popups`, dan `allow-forms` sengaja **tidak** diberikan.
- Main process: pada `web-contents-created` / `will-frame-navigate`, tolak navigasi frame game ke luar `linden-game://play/<sessionId>/`. `setWindowOpenHandler` → `deny`.
- Fokus & input: klik pertama di frame memindahkan fokus keyboard ke game. `Esc` (atau `Shift+F1`, seperti Unity) melepas fokus dan pointer lock kembali ke editor. Shortcut editor (W/E/R, Ctrl+S, Ctrl+Z) tidak aktif saat fokus di game, dan memang sudah diblok saat Play untuk undo/redo (`editorStore.ts` `undo`/`redo`).
- Resolusi: dropdown di toolbar viewport — `Free Aspect`, `16:9`, `9:16 (mobile)`, `1920×1080`, `1280×720`. Frame di-letterbox di dalam viewport. Nilai default dari export preset `canvasMode`.
- Game View vs Scene View (mode `scene`): kamera game dipilih dari entity dengan `Camera.isActive = true` (pertama yang ditemukan). Jika tidak ada, player membuat kamera default dan Console menampilkan warning `Tidak ada Camera aktif di scene; memakai kamera default` (R5).
- Overlay tint biru (`SceneViewport.tsx`, "Play Mode Tint Overlay") tetap ada sebagai border, bukan tint di atas game, supaya warna game tidak berubah.
- Tombol "Open Game DevTools" di menu viewport → `webContents.openDevTools()` khusus frame game (`webFrameMain` dari `frameTreeNodeId`).

#### 6.1 Protokol pesan editor ↔ Game Frame

Ditambahkan di `shared/playProtocol.ts`:

```ts
type EditorToGame =
  | { type: 'linden:init'; scene?: SceneFile; projectConfig: LindenProjectConfig; mode: 'scene' | 'html' }
  | { type: 'linden:pause' } | { type: 'linden:resume' } | { type: 'linden:step' }
  | { type: 'linden:setTimeScale'; value: number }

type GameToEditor =
  | { type: 'linden:ready' }
  | { type: 'linden:log'; level: 'log' | 'info' | 'warn' | 'error'; args: string[]; source?: { file: string; line: number; col: number } }
  | { type: 'linden:stats'; fps: number; triangles?: number; drawCalls?: number; frameMs: number }
  | { type: 'linden:fatal'; message: string; stack?: string }
```

- Pesan divalidasi dengan `zod` (sudah ada di dependencies) di kedua sisi, dan `event.source === iframe.contentWindow` dicek di editor.
- Scene dikirim lewat `linden:init` dari state editor (bukan dibaca ulang dari disk), sehingga perubahan yang belum disimpan tetap ikut di-Play, sama seperti perilaku sekarang.
- Stack trace dipetakan ke file `.ts` asli memakai inline source map dari `ScriptCompiler`, lalu ditampilkan di Console dengan link yang membuka file di editor kode.

### 7. Render 3D di Game Frame

- Mode `scene`: `LindenPlayer` memakai `WebGLRenderer` (WebGL2) seperti sekarang. Jika `webgpuRequired` atau `project.renderer: 'webgpu'`, pakai `WebGPURenderer` dari `three/webgpu` dengan fallback otomatis ke WebGL2 + warning. Catatan: `three@0.158` belum punya `three/webgpu` yang stabil. Upgrade `three` (≥ r171) adalah prasyarat terpisah untuk jalur WebGPU dan tidak memblok fase 1.
- Shadow, tone mapping, dan pixel ratio (`min(devicePixelRatio, 2)`) disamakan antara player dan viewport editor. Pindahkan konfigurasi renderer ke `engine/renderer/createRenderer.ts` yang dipakai keduanya, supaya tampilan edit vs play tidak berbeda.
- Mode `html`: game memilih renderernya sendiri. Electron 45 (Chromium 14x) mendukung WebGL2 dan WebGPU di macOS/Windows. Di Linux WebGPU butuh flag, jadi template default memakai WebGL2.
- Context loss: frame game dan canvas editor adalah dua context WebGL terpisah. Karena render loop editor dihentikan saat Play (§6), tidak ada kompetisi GPU. Saat Stop, canvas editor tidak perlu dibuat ulang.
- Aset 3D (`.glb/.gltf`, `.ktx2`, `.hdr`, `.basis`) disajikan oleh protokol dengan MIME yang benar. Dekoder Draco/KTX2 dikirim bersama runtime di `dist-player/decoders/`.

### 8. Hot reload (fase 2)

- Saat Play, `scripts/*` berubah → `ScriptCompiler` kompilasi ulang → editor mengirim `linden:reloadScripts` → `ScriptRuntime` memanggil `onDestroy`, re-import modul baru (`?v=<hash>`), menyalin field publik lama ke instance baru, lalu `onReload ?? onInit`. Kontrak `onReload` di `IGameScript` sudah ada.
- `ui/*.html` berubah → fragmen diganti di tempat.
- `web/*` (mode html) → reload iframe penuh (§5.2).

### 9. Agent

- `linden_script_write`: tambah parameter `attachTo?: { scene: string; entityId: string; props?: Record<string, unknown> }` yang sekaligus menambahkan komponen `Script` ke entity. Jika tidak diisi, tool mengembalikan peringatan "Script belum ditautkan ke entity mana pun".
- `linden_ui_write` (baru): tulis `ui/*.html` + pasang `HtmlUI`. Validasi sanitizer dijalankan dan hasilnya dilaporkan.
- `linden_play`: jalankan `ScriptCompiler` + `ScriptRuntime` di headless (Node + `happy-dom` atau `jsdom` untuk `ctx.ui`, tanpa render). Laporkan error kompilasi, exception per script (file:baris), dan script yang di-disable. Ini menutup loop perbaikan agent (PRD FR-A11).
- `electron/agent/prompts/linden.md` §4: perbarui kontrak script, contoh `ctx.ui`, dan aturan "selalu tautkan script ke entity".
- Prompt "buat game HTML three.js" → agent boleh membuat proyek `runtime: 'html'` dari template §5.1 dan memakai tool `linden_file_write` khusus folder `web/` (path dibatasi).

## Rencana file

| File | Status | Isi |
| --- | --- | --- |
| `electron/play/GameProtocol.ts` | baru | Skema `linden-game://`, sesi, path guard, CSP, MIME |
| `electron/play/ScriptCompiler.ts` | baru | Bundle `scripts/` via rolldown, cache, source map |
| `electron/play/PlaySession.ts` | baru | Lifecycle sesi Play, watcher file, IPC `play:start/stop` |
| `electron/main.ts` | ubah | Register skema, guard navigasi frame, IPC baru |
| `shared/ipcChannels.ts` | ubah | `play:start`, `play:stop`, `play:compileError`, `play:fileChanged` |
| `shared/playProtocol.ts` | baru | Tipe + skema zod pesan editor ↔ game |
| `shared/mime.ts` | baru | Map MIME bersama (protokol + web build) |
| `shared/types/project.ts` | ubah | `runtime`, `html`, `play` |
| `engine/scripting/ScriptRuntime.ts` | baru | Load, instansiasi, siklus hidup, isolasi error |
| `engine/scripting/ScriptSystem.ts` | ubah | Perluas `ScriptContext`, deprecate `ScriptComponent` |
| `engine/ui/HtmlUiLayer.ts` | baru | Layer `screen` + `world` (CSS3DRenderer), `ctx.ui` |
| `engine/ui/sanitizeHtml.ts` | baru | Sanitizer fragmen |
| `engine/renderer/createRenderer.ts` | baru | Konfigurasi renderer bersama editor/player |
| `engine/ecs/ComponentRegistry.ts` | ubah | Komponen `Script`, `HtmlUI` |
| `engine/scene/SceneSchema.ts` | ubah | Validasi `Script`, `HtmlUI` |
| `player/player.ts` | ubah | Fixed timestep, ScriptRuntime, HtmlUI, kamera aktif, mode embedded (postMessage) |
| `player/htmlBridge.ts` | baru | Shim `linden` untuk HTML Game |
| `player/index.html` | ubah | `#linden-ui-root`, import map `three` |
| `editor/viewport/GameFrame.tsx` | baru | iframe, letterbox, fokus, pesan |
| `editor/viewport/SceneViewport.tsx` | ubah | Mount GameFrame, hentikan loop saat Play, pratinjau UI |
| `editor/store/editorStore.ts` | ubah | `startPlay/stopPlay` via PlaySession, `legacyInEditorPlay` |
| `electron/build/WebBuildRunner.ts` | ubah | Salin script terkompilasi + `ui/`, cabang `runtime: 'html'` |
| `electron/agent/lindenTools/index.ts` | ubah | `attachTo`, `linden_ui_write`, `linden_play` + script |
| `electron/agent/prompts/linden.md` | ubah | Kontrak script & UI |
| `package.json` | ubah | `rolldown` → dependencies, `asarUnpack` binding |
| `index.html` | ubah | CSP `frame-src linden-game:` |

## Fase

| Fase | Isi | Kriteria selesai |
| --- | --- | --- |
| F1 — Script jalan | §3 (komponen `Script`, ScriptCompiler, ScriptRuntime, fixed timestep) + build web + `linden_play` | Demo platformer dengan `PlayerController.ts` bisa digerakkan di build web dan headless `linden_play` melaporkan error script |
| F2 — Play di Game Frame | §2, §6, §7 (WebGL2) | Play di viewport memakai iframe + kamera game. Tampilan sama dengan build web (screenshot diff ≤ 1%) |
| F3 — HTML UI | §4 | HUD koin + tombol restart bekerja di viewport dan build web |
| F4 — HTML Game | §5 + template three.js | Template HTML Game 3D jalan di viewport dan build web, error tampil di Console |
| F5 — Hot reload & WebGPU | §8, `three` upgrade + `WebGPURenderer` | Edit script saat Play tanpa Stop. Scene jalan dengan WebGPU dan fallback WebGL2 |

## Keamanan

- Kode game hanya berjalan di origin `linden-game://play`, tanpa preload, tanpa `nodeIntegration`, dan tidak bisa menjangkau `window.parent.electron` (beda origin → `SecurityError`).
- Protokol hanya melayani file di dalam root proyek yang sedang terbuka, read-only, dan hanya selama sesi Play aktif.
- Jaringan diblok secara default (`connect-src 'self'`). Proyek harus opt-in eksplisit per domain.
- HTML UI tidak bisa mengeksekusi kode (sanitizer + CSP tanpa `unsafe-inline` untuk script).
- Navigasi frame, popup, dan `window.open` ditolak di main process.
- Tambahkan test Playwright: dari dalam game, `window.parent.electron` → throw. `fetch('linden-game://play/<id>/../../etc/passwd')` → 403. `fetch('https://example.com')` → diblok CSP.

## Rencana tes

Unit (`vitest`):

- `tests/play/gameProtocol.test.ts`: path traversal, symlink keluar, sesi kedaluwarsa, MIME, header CSP.
- `tests/play/scriptCompiler.test.ts`: TS → JS, import antar-script, bare import ditolak dengan pesan file:baris, cache berdasarkan mtime, source map valid.
- `tests/scripting/scriptRuntime.test.ts`: urutan `onInit → onFixedUpdate → onUpdate → onLateUpdate`, `props` diterapkan sebelum `onInit`, exception men-disable satu script saja, `onDestroy` saat stop.
- `tests/scripting/fixedTimestep.test.ts`: posisi setelah 1 detik sama pada simulasi 30/60/144 FPS (toleransi 1e-3).
- `tests/ui/sanitizeHtml.test.ts`: `<script>`, `onerror=`, `javascript:` dibuang. Markup normal utuh.
- `tests/export/webBuildRunner.test.ts`: tambah kasus `scripts/` terkompilasi + `ui/` tersalin. Mode `html` menyalin entry + menyuntikkan shim.
- `tests/scene`: validasi skema `Script`/`HtmlUI`.

E2E (Playwright, `docs/test-case`):

- TC-HTML-01: Proyek scene + `PlayerController.ts` → Play → tekan `→` → posisi Player bertambah. Stop → posisi kembali ke nilai edit.
- TC-HTML-02: Play memakai kamera game (`Camera.isActive`). Screenshot viewport ≈ screenshot build web di resolusi sama.
- TC-HTML-03: HUD `HtmlUI` menampilkan jumlah koin dan bertambah saat koin diambil. Tombol Restart bisa diklik.
- TC-HTML-04: Template HTML Game three.js → Play → canvas 3D merender (piksel tengah ≠ warna clear). FPS muncul di overlay stats.
- TC-HTML-05: `throw new Error('boom')` di `onUpdate` → Console editor menampilkan `boom` dengan `scripts/X.ts:<baris>`. Editor tetap responsif, game tetap jalan.
- TC-HTML-06: Keamanan (lihat bagian Keamanan).
- TC-HTML-07: Build web scene + script + UI lulus smoke test di Chromium, Firefox, WebKit (perluas test PRD).

## Acceptance criteria

- [ ] Script `.ts`/`.js` yang ditautkan lewat komponen `Script` berjalan saat Play di viewport, di `linden_play`, dan di build web dengan perilaku yang sama.
- [ ] Simulasi tidak bergantung refresh rate (fixed timestep 1/60).
- [ ] Saat Play, viewport merender dari kamera game di dalam iframe ber-sandbox. Kamera editor kembali utuh saat Stop.
- [ ] `HtmlUI` mode `screen` dan `world` tampil di viewport saat Play dan di build web, dan bisa dikendalikan dari script lewat `ctx.ui`.
- [ ] Proyek `runtime: 'html'` (template three.js 3D) bisa di-Play di viewport dan diekspor ke web.
- [ ] Error kompilasi dan runtime tampil di Console editor dengan lokasi file `.ts` asli.
- [ ] Kode game tidak bisa mengakses `window.electron`, IPC, filesystem di luar proyek, atau jaringan tanpa izin.
- [ ] Agent dapat menulis script + UI yang langsung tertaut, dan `linden_play` melaporkan error script ke agent.
- [ ] App terpaket (macOS/Windows/Linux) bisa mengompilasi script tanpa `node_modules` dev.

## Pertanyaan terbuka

1. Apakah Play perlu tetap mendukung inspeksi live (pilih entity di Hierarchy saat Play dan lihat transform berubah)? Dengan iframe, ini butuh kanal `linden:inspect` tambahan. Usulan: fase 2, read-only.
2. `three` di-upgrade sekarang (≥ r171, untuk WebGPU) atau setelah F4? Upgrade menyentuh `SceneViewport`, `SceneBridge`, dan TransformControls.
3. Untuk HTML Game, apakah pengguna boleh memakai CDN (unpkg/jsdelivr) lewat `allowNetwork`, atau template selalu memaksa vendor lokal supaya build offline?

## Status implementasi (26 Okt 2026)

F1–F5 selesai.

Keputusan atas pertanyaan terbuka:

1. Inspeksi live saat Play belum ada. Hierarchy/Inspector menampilkan world editor yang tidak berubah selama Play.
2. `three` di-upgrade ke 0.186.1. `TransformControls` sekarang dipasang lewat `getHelper()`. `WebGPURenderer` dimuat dinamis dari `three/webgpu` sebagai chunk terpisah (~590 KB) hanya jika `project.linden.json` berisi `"renderer": "webgpu"`. Jika WebGPU tidak tersedia, renderer otomatis memakai WebGL2 dan mengirim peringatan. Overlay viewport menampilkan backend yang aktif. Viewport editor tetap memakai WebGL.
3. Template HTML Game memakai three.js lokal (`web/vendor/three.module.js` + `three.core.js`). CDN hanya bisa dipakai lewat opt-in `html.allowNetwork`.

Perbedaan dari desain:

- Komponen `Script` hanya satu per entity (`disallowMultiple`), karena `Entity` menyimpan komponen per nama. Untuk beberapa perilaku, script bisa saling import modul di `scripts/`.
- Mode `html` mengizinkan inline script (`'unsafe-inline'`) karena seluruh halaman memang kode proyek. Isolasi tetap dijamin oleh origin `linden-game://` yang terpisah. Origin di `allowNetwork` juga boleh memuat script/aset. Mode `scene` tetap tanpa inline script.
- Pratinjau HtmlUI di mode edit memakai iframe `srcdoc` ber-sandbox (tanpa `allow-scripts`) dan fragmen yang sudah disanitasi, bukan shadow DOM di dokumen editor.
- Bridge HTML Game di build web ada di `linden-runtime/` (bukan `__linden/`), karena GitHub Pages menyembunyikan folder berawalan `_`.
- `linden_play` headless tidak memakai happy-dom. `ctx.ui` di sana berupa stub tanpa efek.
- Play lama di dalam editor tetap dipakai otomatis jika tidak ada folder proyek atau `electronAPI` (pengganti flag `legacyInEditorPlay`).
- Chromium mencatat pelanggaran CSP "inline event handler" saat `DOMParser` mem-parse fragmen UI yang berisi `on*`. Atribut itu diblokir lalu dibuang sebelum masuk DOM. Log ini hanya muncul di DevTools frame game.

Hot reload (F5):

- Saat Play, perubahan di `scripts/` dikompilasi ulang (debounce 250 ms, satu kompilasi sekaligus). Script diimpor ulang dengan `?v=<versi>`, field instance lama disalin ke instance baru, lalu `onReload(ctx)` dipanggil, atau `onInit(ctx)` jika `onReload` tidak ada. Binding `ctx.ui` dan `ctx.on` milik instance lama dilepas.
- Jika kompilasi gagal saat Play, error tampil di Console dan game tetap memakai versi lama.
- Perubahan di `ui/*.html` mengganti markup di elemen yang sama, sehingga listener dan binding tetap jalan.
- HTML Game tetap memuat ulang seluruh halaman.

Pengujian:

- Unit: `tests/play/*`, `tests/scripting/*`, `tests/export/webBuildRuntimes.test.ts`, dan tambahan di `tests/agent/agentTools.test.ts`.
- E2E Electron: `npm run test:e2e:play` (butuh `npm run dev`), mencakup 27 skenario TC-HTML-01..07 + hot reload + WebGPU. Sanitizer belum punya unit test karena belum ada DOM di vitest; perilakunya diuji di E2E.
