# PRD & Test Case — Linden Engine: Fitur ala Godot + Transmuter Godot/Unity

Oct 23, 2026 · @accept

## 1. Ringkasan & latar belakang

Linden Engine v0.2–v0.4 akan mengadopsi fitur inti Godot Engine (scene tree berbasis node, signals, 2D lengkap, TileMap, AnimationPlayer, export template) dan menambahkan **Transmuter**: modul konversi proyek dua arah antara Linden ↔ Godot dan Linden ↔ Unity.

**Kondisi saat ini.** [Linden Engine](https://github.com/AlStartlight/LindenEngine) adalah engine desktop berbasis Electron, TypeScript, React, dan WebGPU (fallback Three.js), berstatus v0.1 Alpha. Arsitekturnya ECS (Entity–Component–System) dengan Blueprint visual scripting, Material Editor, Animator, Sequencer, dan scripting TypeScript dengan hot-reload. Fokus saat ini 3D; dukungan 2D, prefab, serialisasi scene, dan undo/redo belum ada.

**Mengapa Godot.** [Godot Engine](https://github.com/godotengine/godot) adalah engine 2D/3D open source berlisensi MIT. Model scene-sebagai-node, sistem signal, dan format teks `.tscn`/`.tres` terbukti nyaman dipakai dan mudah di-diff di Git. Lisensi MIT memungkinkan konsep dan bagian kode diadopsi dengan atribusi.

**Mengapa Transmuter.** Hambatan terbesar engine baru adalah biaya pindah. Jika pengguna bisa membuka proyek Godot atau Unity di Linden, dan mengembalikannya bila perlu, risiko mencoba Linden turun drastis. Transmuter juga menjadikan Linden jembatan antar-engine, nilai jual yang tidak dimiliki Godot maupun Unity.

**Istilah.**

| Istilah | Arti |
| --- | --- |
| Transmuter | Modul konversi proyek dua arah antar engine |
| LIF | Linden Interchange Format, representasi perantara (IR) netral engine |
| Importer | Adapter sumber → LIF (mis. Godot → LIF) |
| Exporter | Adapter LIF → target (mis. LIF → Unity) |
| Round-trip | Konversi A → B → A yang hasilnya setara dengan aslinya |
| Fidelity report | Laporan per elemen: terkonversi penuh, sebagian, atau tidak didukung |

## 2. Tujuan, non-tujuan & metrik

Keberhasilan diukur dari seberapa banyak proyek nyata Godot dan Unity bisa dibuka dan dijalankan di Linden tanpa perbaikan manual.

**Tujuan**

1. Linden mendukung game 2D dan 3D dengan model scene tree + node yang setara dengan Godot, tanpa membuang ECS yang sudah ada.
2. Pengguna dapat mengimpor proyek Godot 4.x dan Unity (2021 LTS ke atas) ke Linden lewat satu wizard.
3. Pengguna dapat mengekspor proyek Linden ke format proyek Godot 4.x dan Unity yang bisa dibuka di editor masing-masing.
4. Setiap konversi menghasilkan fidelity report yang jujur: apa yang berhasil, sebagian, dan gagal.

**Non-tujuan (fase ini)**

- Konversi otomatis 100% kode GDScript/C# yang kompleks; target-nya transpilasi terbantu + stub yang ditandai.
- Kompatibilitas biner dengan plugin native Godot (GDExtension) atau paket Unity berbayar.
- Konversi Godot 3.x dan Unity di bawah 2021 LTS.
- Shader HDRP/URP kustom atau Visual Shader Godot yang kompleks; dikonversi ke material PBR standar + peringatan.
- Membaca file Unity berformat biner (Force Binary serialization); pengguna diminta mengubah ke Force Text.

**Metrik keberhasilan (target v0.4)**

| Metrik | Target |
| --- | --- |
| Proyek demo resmi Godot 2D yang bisa dijalankan setelah impor | ≥ 80% dari set uji |
| Proyek sampel Unity 2D/3D sederhana yang bisa dijalankan setelah impor | ≥ 70% dari set uji |
| Kesetaraan round-trip scene (Linden → Godot → Linden) | ≥ 99% properti transform, hierarki, dan referensi aset identik |
| Akurasi transpilasi skrip (fungsi lolos uji tanpa edit manual) | ≥ 60% GDScript, ≥ 50% C# |
| Waktu impor proyek 500 aset | ≤ 60 detik di mesin referensi |
| Elemen tak didukung yang tidak tercatat di fidelity report | 0 |

## 3. Persona & user stories

Tiga persona utama: developer Godot yang ingin mencoba Linden, developer Unity yang ingin keluar dari ekosistem Unity, dan tim campuran yang perlu bertukar aset antar engine.

| Persona | Kebutuhan utama | Rasa sakit saat ini |
| --- | --- | --- |
| Rina, indie dev Godot 2D | Membawa game platformer-nya ke Linden untuk mencoba Blueprint & Sequencer | Takut kehilangan scene, tilemap, dan animasi |
| Dimas, dev Unity 3D | Migrasi proyek kecil ke engine open source berbasis web | Kode C# dan prefab tidak bisa dibawa |
| Studio campuran (artist di Unity, programmer di Godot) | Bertukar level dan aset tanpa rakit ulang | Ekspor/impor manual lewat FBX/GLTF memakan waktu |
| Mahasiswa game dev | Belajar konsep yang sama di tiga engine | Tidak ada perbandingan langsung |

**User stories**

| ID | Sebagai | Saya ingin | Agar |
| --- | --- | --- | --- |
| US-01 | dev Godot | membuka folder berisi `project.godot` di Linden | proyek saya langsung bisa dijalankan |
| US-02 | dev Godot | node, signal, dan TileMap saya tetap berfungsi | saya tidak menyusun ulang level |
| US-03 | dev Godot | GDScript saya diterjemahkan ke TypeScript dengan bagian yang gagal ditandai | saya tahu persis yang harus diperbaiki |
| US-04 | dev Unity | mengimpor folder `Assets/` + `ProjectSettings/` | scene dan prefab saya muncul di Hierarchy |
| US-05 | dev Unity | MonoBehaviour C# saya dipetakan ke skrip TypeScript Linden | logika gameplay terbawa |
| US-06 | pengguna Linden | mengekspor proyek ke Godot 4 | saya bisa memakai export template Godot untuk konsol |
| US-07 | pengguna Linden | mengekspor proyek ke Unity | tim artist bisa lanjut bekerja di Unity |
| US-08 | semua | melihat fidelity report sebelum dan sesudah konversi | saya bisa memutuskan apakah layak dilanjutkan |
| US-09 | semua | konversi tidak pernah mengubah proyek sumber | proyek asli saya aman |
| US-10 | pengguna CLI/CI | menjalankan Transmuter tanpa editor | konversi bisa diotomatisasi |

## 4. Lingkup fitur ala Godot

Fitur Godot diadopsi sebagai lapisan di atas ECS Linden, bukan pengganti: setiap Node adalah Entity dengan komponen `NodeInfo` (nama, parent, urutan anak, grup), sehingga sistem ECS tetap berjalan cepat dan Transmuter punya model yang bisa dipetakan ke Godot maupun Unity.

| ID | Fitur | Padanan Godot | Deskripsi di Linden | Prioritas | Rilis |
| --- | --- | --- | --- | --- | --- |
| GF-01 | Scene tree & tipe Node | Node, Node2D, Node3D | Hierarki bertipe di atas ECS; tipe node = entity + set komponen bawaan | P0 | v0.2 |
| GF-02 | Scene instancing | PackedScene, `.tscn` | Format teks `.lscn` yang bisa di-diff; scene bisa di-instance di scene lain (sekaligus jadi sistem Prefab di roadmap) | P0 | v0.2 |
| GF-03 | Resource | Resource, `.tres` | Aset data bersama (`.lres`): material, tileset, kurva, animasi; dimuat lewat path `res://` | P0 | v0.2 |
| GF-04 | Signals | `signal`, `connect()` | Event bertipe antar node; koneksi tersimpan di scene; node Blueprint "On Signal" dan "Emit Signal" | P0 | v0.2 |
| GF-05 | Groups | `add_to_group()` | Tag node untuk query dan panggilan massal | P1 | v0.2 |
| GF-06 | Autoload | Autoload/singleton | Skrip/scene global yang dimuat sebelum scene utama | P1 | v0.2 |
| GF-07 | Renderer 2D | CanvasItem, Sprite2D, Camera2D, CanvasLayer | Pipeline 2D WebGPU: sprite, z-index, layer, kamera 2D, batching | P0 | v0.2 |
| GF-08 | AnimatedSprite & AnimationPlayer | AnimatedSprite2D, AnimationPlayer | Animasi properti apa pun via track; terintegrasi dengan Sequencer yang ada | P0 | v0.3 |
| GF-09 | AnimationTree | AnimationTree, StateMachine, BlendSpace | Disatukan dengan Animator state machine Linden | P1 | v0.3 |
| GF-10 | TileMap & TileSet | TileMapLayer, TileSet | Editor tile dengan atlas, autotile/terrain, collision & navigation per tile | P0 | v0.3 |
| GF-11 | Fisika 2D & 3D | PhysicsBody2D/3D, Area | Rapier 2D/3D: StaticBody, RigidBody, CharacterBody, Area, collision layer/mask | P0 | v0.2 |
| GF-12 | Input Map | InputMap actions | Aksi bernama yang dipetakan ke keyboard, mouse, gamepad | P0 | v0.2 |
| GF-13 | UI (Control) | Control, Container, Theme | Node UI dengan anchor, container (HBox, VBox, Grid, Margin), dan tema | P1 | v0.3 |
| GF-14 | Navigasi | NavigationRegion, NavigationAgent | Navmesh 2D/3D + pathfinding agen | P2 | v0.4 |
| GF-15 | Partikel | GPUParticles2D/3D | Sistem partikel GPU (mengisi item roadmap Particle system) | P1 | v0.3 |
| GF-16 | Audio bus | AudioServer, AudioStreamPlayer | Bus mixer dengan efek; pemutar 2D/3D | P1 | v0.3 |
| GF-17 | Export presets | Export templates | Preset ekspor per platform (Web, Windows, macOS, Linux) dengan opsi tersimpan | P0 | v0.3 |
| GF-18 | Undo/Redo | UndoRedo | Semua aksi editor bisa di-undo, termasuk hasil Transmuter | P0 | v0.2 |
| GF-19 | Remote debugger | Remote scene tree | Inspeksi scene tree saat game berjalan, breakpoint skrip | P2 | v0.4 |
| GF-20 | Dock Node/Signal | Node dock | Panel untuk melihat dan menghubungkan signal serta mengatur grup | P1 | v0.2 |

Scripting tetap TypeScript. Linden tidak membuat bahasa mirip GDScript; GDScript masuk lewat transpiler Transmuter (bagian 5).

## 5. Spesifikasi Transmuter

Transmuter mengonversi lewat satu representasi perantara, LIF, sehingga cukup ada satu importer dan satu exporter per engine; konversi Godot ↔ Unity langsung pun melewati LIF.

&#91;embedded content: arsitektur Transmuter · 3 importer, LIF, 3 exporter\]

Setiap importer hanya tahu cara membaca engine-nya ke LIF, dan setiap exporter hanya tahu cara menulis LIF ke engine-nya. Menambah engine keempat cukup satu adapter baru.

**Tahapan pipeline**

1. **Detect**: kenali engine dan versi dari penanda folder.
2. **Parse**: baca file sumber ke AST khusus engine; belum ada interpretasi.
3. **Resolve**: selesaikan semua referensi (ExtResource/SubResource Godot, `fileID`/`guid` Unity) dan bangun IdMap.
4. **Normalize**: petakan ke LIF; konversi sumbu, satuan, dan PPU; transpilasi skrip; properti tak terpetakan masuk `extras`.
5. **Validate**: validasi LIF dengan JSON Schema; catat setiap kehilangan ke fidelity report.
6. **Emit**: tulis proyek target ke folder temp, lalu rename atomik ke folder output.
7. **Report**: tulis `transmuter-report.json` dan `.html`.

**Adapter Godot 4**

- Membaca `project.godot` (format INI, `config_version=5`), `.tscn` dan `.tres` (format teks `format=3` dengan blok `[gd_scene]`, `[ext_resource]`, `[sub_resource]`, `[node]`, `[connection]`), serta file `.uid` untuk skrip.
- Cache `.godot/imported/` diabaikan; aset asli disalin dan diimpor ulang oleh Linden. Opsi impor dari file `.import` (filter tekstur, kompresi) dipetakan bila ada padanannya.
- Ekspor menulis `.tscn`/`.tres` format 3 dengan `uid://` yang stabil (diturunkan dari UUID Linden), sehingga diff Git tetap bersih.

**Adapter Unity (2021 LTS ke atas)**

- Mensyaratkan Asset Serialization = Force Text. Membaca YAML Unity (`%TAG !u! tag:unity3d.com,2011:`) per dokumen `--- !u!<classID> &<fileID>`: GameObject (1), Transform (4), MonoBehaviour (114), PrefabInstance (1001), dan komponen umum lainnya.
- Membaca file `.meta` untuk GUID dan import settings. Referensi skrip `m_Script: {fileID: 11500000, guid: …}` dipetakan ke file C# yang lalu ditranspilasi.
- Ekspor menulis `.meta` dengan GUID deterministik (hash UUID Linden), scene/prefab YAML, dan skrip C# turunan `MonoBehaviour`. Paket kecil `com.linden.runtime` ikut disertakan untuk komponen tanpa padanan (mis. `LindenGroups`, `LindenSignal`).

**Adapter Linden** membaca dan menulis `.lscn`/`.lres` sendiri; ia juga menjadi acuan uji round-trip.

## 6. Pemetaan konsep antar engine

Sebagian besar konsep punya padanan langsung; perbedaan terbesar ada di model hierarki (Godot: node bertipe, Unity: GameObject + komponen) dan di skrip, sehingga LIF menyimpan keduanya: node bertipe dengan daftar komponen.

| Konsep LIF | Linden | Godot 4 | Unity | Fidelity |
| --- | --- | --- | --- | --- |
| Proyek | `linden.project.json` | `project.godot` | `ProjectSettings/*.asset` | Penuh |
| Scene | `.lscn` | `.tscn` | `.unity` (YAML) | Penuh |
| Scene yang di-instance | Scene instance | PackedScene instance | Prefab / Prefab Variant | Penuh; override prefab bersarang = sebagian |
| Objek | Entity + `NodeInfo` | Node | GameObject | Penuh |
| Transform 3D | Transform | Node3D (transform) | Transform | Penuh (konversi sumbu, lihat catatan) |
| Transform 2D | Transform2D | Node2D | Transform (z diabaikan) / RectTransform untuk UI | Penuh |
| Mesh | MeshRenderer | MeshInstance3D | MeshFilter + MeshRenderer | Penuh |
| Sprite 2D | SpriteRenderer | Sprite2D | SpriteRenderer | Penuh |
| Kamera | Camera | Camera2D / Camera3D | Camera | Penuh |
| Cahaya | Light | DirectionalLight3D, OmniLight3D, SpotLight3D | Light (Directional/Point/Spot) | Penuh; nilai intensitas dikalibrasi |
| Benda fisika | RigidBody / StaticBody / CharacterBody | RigidBody, StaticBody, CharacterBody | Rigidbody (+ isKinematic), CharacterController | Sebagian (parameter solver berbeda) |
| Collider | Collider | CollisionShape + Shape resource | BoxCollider, SphereCollider, dll | Penuh untuk bentuk primitif |
| Area/trigger | Area | Area2D / Area3D | Collider dengan `isTrigger` | Penuh |
| Event | Signal | Signal | UnityEvent / C# event | Sebagian (UnityEvent penuh, C# event via skrip) |
| Tag/grup | Group | Group | Tag (satu per objek) + Layer | Sebagian (Unity hanya 1 tag) |
| Tilemap | TileMap + TileSet | TileMapLayer + TileSet | Tilemap + Tile/RuleTile | Sebagian (aturan autotile berbeda) |
| Animasi properti | AnimationPlayer | AnimationPlayer | AnimationClip + Animator | Penuh untuk transform; kurva kustom sebagian |
| State machine animasi | Animator | AnimationTree | Animator Controller | Sebagian |
| Material | PBR Material (`.lres`) | StandardMaterial3D | Material (Standard/URP Lit) | Sebagian; shader kustom jadi PBR + peringatan |
| UI | Control nodes | Control, Container | uGUI (Canvas, RectTransform) | Sebagian; UI Toolkit tidak didukung |
| Input | Input Map | InputMap | Input Manager / Input System actions | Penuh untuk Input System; Input Manager lama sebagian |
| Skrip | TypeScript | GDScript (C# Godot = sebagian) | C# MonoBehaviour | Terbantu (transpilasi + stub) |
| Logika visual | Blueprint | — (VisualScript dihapus di Godot 4) | Visual Scripting (Bolt) | Linden → lain: diekspor sebagai skrip hasil generate |
| Global/singleton | Autoload | Autoload | ScriptableObject / static class | Sebagian |
| ID aset | UUID di `.lmeta` | `uid://` + path `res://` | GUID di `.meta` | Penuh (tabel pemetaan ID) |

**Catatan sistem koordinat.** Godot dan Linden (Three.js) memakai koordinat tangan kanan, Y ke atas. Unity memakai tangan kiri, Y ke atas. Konversi Unity ↔ LIF membalik sumbu Z untuk posisi, dan mengonversi rotasi quaternion (x, y, z, w) → (−x, −y, z, w); urutan winding mesh juga dibalik. Satuan dianggap 1 unit = 1 meter di ketiga engine.

**Catatan 2D.** Godot 2D memakai Y ke bawah dalam piksel; Unity 2D memakai Y ke atas dalam unit dengan Pixels Per Unit per sprite. LIF menyimpan 2D dalam piksel Y-ke-bawah, dan exporter Unity membagi dengan PPU serta membalik Y.

## 7. Kebutuhan fungsional, non-fungsional & UX

Transmuter wajib non-destruktif, deterministik, dan transparan: proyek sumber tidak pernah diubah, input yang sama selalu menghasilkan output yang sama, dan setiap kehilangan data tercatat.

**Kebutuhan fungsional**

| ID | Kebutuhan | Prioritas |
| --- | --- | --- |
| FR-01 | Mendeteksi tipe proyek otomatis dari folder (`project.godot` → Godot; `Assets/` + `ProjectSettings/ProjectVersion.txt` → Unity; `linden.project.json` → Linden) | P0 |
| FR-02 | Mendeteksi versi engine dan menolak versi tak didukung dengan pesan jelas | P0 |
| FR-03 | Parse `.tscn`, `.tres`, `project.godot`, dan `.import` Godot 4 | P0 |
| FR-04 | Parse YAML Unity (`.unity`, `.prefab`, `.asset`, `.mat`, `.anim`, `.controller`) dengan dukungan tag `!u!` dan referensi `fileID`/`guid` | P0 |
| FR-05 | Membangun tabel ID: `uid://` Godot dan GUID `.meta` Unity ↔ UUID Linden, disimpan di `transmuter/idmap.json` | P0 |
| FR-06 | Menyalin dan mengonversi aset: tekstur (PNG/JPG/WebP apa adanya), model (FBX/OBJ → GLTF), audio (WAV/OGG/MP3) | P0 |
| FR-07 | Transpilasi GDScript → TypeScript dan C# → TypeScript; fungsi yang gagal diganti stub `// TRANSMUTER-TODO` yang menyimpan kode asli sebagai komentar | P0 |
| FR-08 | Ekspor Linden → Godot: menulis `project.godot`, `.tscn`, `.tres`, dan skrip GDScript hasil generate dari TypeScript/Blueprint | P0 |
| FR-09 | Ekspor Linden → Unity: menulis struktur `Assets/`, file `.meta` dengan GUID stabil, scene/prefab YAML, dan skrip C# hasil generate | P0 |
| FR-10 | Fidelity report (HTML + JSON) per elemen: Penuh / Sebagian / Tidak didukung, dengan lokasi file sumber dan saran perbaikan | P0 |
| FR-11 | Mode pratinjau (dry run): analisis + report tanpa menulis output | P0 |
| FR-12 | Konversi inkremental: hanya file yang berubah sejak konversi terakhir (berdasarkan hash) | P1 |
| FR-13 | Konversi langsung Godot ↔ Unity lewat LIF tanpa membuka di Linden | P1 |
| FR-14 | Plugin adapter pihak ketiga (engine lain, mis. Defold, Cocos) lewat sistem plugin Linden | P2 |
| FR-15 | Hasil impor bisa di-undo sebagai satu aksi di editor | P1 |

**Kebutuhan non-fungsional**

| ID | Kebutuhan |
| --- | --- |
| NFR-01 | Non-destruktif: Transmuter hanya membaca folder sumber; output selalu ke folder baru |
| NFR-02 | Deterministik: input sama → output byte-identik (urutan stabil, tanpa timestamp di konten) |
| NFR-03 | Performa: proyek 500 aset ≤ 60 detik; scene 10.000 node ≤ 5 detik parse |
| NFR-04 | Memori: ≤ 2 GB untuk proyek 2 GB aset (streaming, bukan muat semua) |
| NFR-05 | Keamanan: parser tidak mengeksekusi kode dari proyek sumber; batas ukuran file dan kedalaman YAML untuk mencegah serangan billion-laughs |
| NFR-06 | Lintas platform: berjalan di Windows, macOS, Linux (Electron) dan di CLI Node.js 18+ |
| NFR-07 | Dapat dibatalkan: proses panjang bisa di-cancel tanpa meninggalkan output setengah jadi (tulis ke folder temp lalu rename) |
| NFR-08 | Aksesibilitas: wizard dapat dioperasikan penuh dengan keyboard, kontras WCAG AA |

**UX editor: Transmuter Wizard** (menu *File → Transmuter…*)

1. **Pilih arah**: Impor ke Linden, Ekspor dari Linden, atau Konversi langsung.
2. **Pilih sumber & target**: folder sumber (terdeteksi otomatis, badge engine + versi) dan folder output kosong.
3. **Analisis**: dry run menampilkan ringkasan (jumlah scene, aset, skrip) dan skor fidelity per kategori sebelum ada file ditulis.
4. **Opsi**: transpilasi skrip (ya/tidak/stub saja), konversi model ke GLTF, perlakuan shader kustom, konversi sumbu.
5. **Jalankan**: progress bar per tahap, log langsung, tombol Batal.
6. **Hasil**: fidelity report interaktif; klik item membuka file sumber atau node hasil di Hierarchy; tombol "Buka proyek".

Di Asset Browser, file `.tscn`, `.unity`, dan `.prefab` yang di-drag masuk memicu impor satu scene lewat pipeline yang sama.

## 8. Spesifikasi teknis

Transmuter adalah paket `engine/transmuter/` yang bisa dipakai dari editor, CLI, dan plugin; setiap engine diwakili satu adapter yang mengimplementasikan `Importer` dan/atau `Exporter` terhadap LIF.

**Struktur modul (tambahan pada repo)**

```
engine/
├── scene/                 # GF-01..06: Node, SceneTree, PackedScene, Signal, Group, Autoload
├── renderer2d/            # GF-07: pipeline 2D WebGPU
├── tilemap/               # GF-10
├── animation/             # GF-08..09: AnimationPlayer, AnimationTree
└── transmuter/
    ├── core/
    │   ├── lif/           # skema LIF + validator (JSON Schema)
    │   ├── Pipeline.ts    # detect → parse → normalize → emit → report
    │   ├── IdMap.ts
    │   ├── CoordinateConverter.ts
    │   └── FidelityReport.ts
    ├── adapters/
    │   ├── linden/        # LindenImporter, LindenExporter
    │   ├── godot/         # TscnParser, TresParser, GodotImporter, GodotExporter
    │   └── unity/         # UnityYamlParser, MetaParser, UnityImporter, UnityExporter
    ├── scripts/
    │   ├── gdscript/      # lexer, parser, GDScript AST → TS, TS → GDScript
    │   ├── csharp/        # parser (tree-sitter-c-sharp), C# → TS, TS → C#
    │   └── apimap/        # tabel API: Godot/Unity API ↔ Linden API
    └── cli/
        └── transmuter.ts
editor/panels/TransmuterWizard.tsx
editor/panels/FidelityReportView.tsx
```

**API inti**

```typescript
export type EngineId = 'linden' | 'godot' | 'unity'

export interface DetectResult {
  engine: EngineId
  version: string          // mis. '4.3' atau '2022.3.21f1'
  supported: boolean
  reason?: string
}

export interface Importer {
  readonly engine: EngineId
  detect(dir: string): Promise<DetectResult>
  toLIF(dir: string, opts: TransmuteOptions, ctx: TransmuteContext): Promise<LIFProject>
}

export interface Exporter {
  readonly engine: EngineId
  fromLIF(project: LIFProject, outDir: string, opts: TransmuteOptions, ctx: TransmuteContext): Promise<void>
}

export interface TransmuteOptions {
  dryRun?: boolean
  scripts?: 'transpile' | 'stub' | 'skip'
  convertModelsToGltf?: boolean
  customShaders?: 'fallback-pbr' | 'skip'
  incremental?: boolean
  signal?: AbortSignal
}

export async function transmute(
  src: string, from: EngineId, to: EngineId, outDir: string, opts?: TransmuteOptions
): Promise<FidelityReport>
```

**Skema LIF (ringkas).** Satu `LIFProject` berisi `settings`, `assets[]` (id, path, tipe, hash), `resources[]`, `scenes[]`, dan `scripts[]`. Setiap `LIFNode` punya `id`, `name`, `type` (mis. `Sprite2D`), `parent`, `children[]` terurut, `components[]` dengan properti bertipe, `groups[]`, `signals[]` (sumber, nama, target, metode), dan `extras` untuk properti engine asal yang tidak dipetakan (disimpan agar round-trip tetap utuh). Versi skema ditulis di `lifVersion` dan divalidasi dengan JSON Schema.

**CLI**

```
npx linden-transmuter detect <folder>
npx linden-transmuter analyze <folder> --to godot|unity|linden [--json]
npx linden-transmuter convert <folder> --to godot|unity|linden --out <folder>
    [--scripts transpile|stub|skip] [--incremental] [--report report.html]
```

Kode keluar: `0` sukses penuh, `1` gagal, `2` sukses dengan elemen Sebagian/Tidak didukung (agar CI bisa memutuskan).

**Format fidelity report (JSON)**

```json
{
  "source": { "engine": "godot", "version": "4.3" },
  "target": { "engine": "linden", "version": "0.3.0" },
  "summary": { "full": 1820, "partial": 64, "unsupported": 7, "score": 0.96 },
  "items": [
    {
      "kind": "node",
      "source": "res://levels/level1.tscn#Player/AnimationTree",
      "status": "partial",
      "reason": "BlendSpace2D dengan 9 titik dikonversi menjadi 9 state terpisah",
      "fix": "Gabungkan ulang di Animator > Blend Tree"
    }
  ]
}
```

**Transpilasi skrip.** GDScript dan C# di-parse ke AST, lalu diturunkan ke TypeScript lewat tabel `apimap` (mis. `get_node("Player")` / `GetComponent<T>()` → `this.node.get('Player')` / `this.entity.getComponent(T)`; `_process(delta)` / `Update()` → `onUpdate(deltaTime)`; `_ready()` / `Start()` → `onInit()`; `emit_signal` → `this.emit`). Arah sebaliknya memakai tabel yang sama. Blueprint diekspor dengan mengompilasi graph ke TypeScript dulu, lalu ke GDScript atau C#. Kode hasil generate tidak pernah dieksekusi selama konversi.

## 9. Test case

Uji dijalankan di Vitest (unit & integrasi), Playwright (UI editor), dan job CI terpisah untuk korpus proyek nyata; rilis diblokir bila ada test P0 gagal.

**Korpus uji.** (a) Fixture minimal buatan tim per fitur; (b) proyek dari [godot-demo-projects](https://github.com/godotengine/godot-demo-projects) yang berlisensi MIT; (c) proyek sampel Unity yang dibuat sendiri tim (bukan aset Unity Asset Store, demi lisensi); (d) proyek Linden contoh dari README (Rotating Cube, Player Movement).

### 9.1 Fitur ala Godot (unit & integrasi)

| ID | Skenario | Langkah | Hasil yang diharapkan | Prioritas |
| --- | --- | --- | --- | --- |
| TC-GF-01 | Hierarki node | Buat Node2D dengan 3 anak, pindahkan anak ke-3 ke indeks 0 | Urutan anak berubah; transform global anak dihitung ulang | P0 |
| TC-GF-02 | Simpan & muat scene | Simpan scene berisi 50 node ke `.lscn`, muat ulang | Hierarki, properti, dan grup identik; file teks stabil (diff kosong saat disimpan ulang) | P0 |
| TC-GF-03 | Scene instancing | Instance `Enemy.lscn` 3x, ubah properti di file sumber | Ketiga instance ikut berubah kecuali properti yang di-override | P0 |
| TC-GF-04 | Signal | Hubungkan `Button.pressed` ke `Door.open()`, klik tombol saat Play | `open()` terpanggil tepat 1x; koneksi tersimpan di `.lscn` | P0 |
| TC-GF-05 | Signal di Blueprint | Node "On Signal: body\_entered" di Blueprint Area | Event terpicu saat RigidBody masuk Area | P0 |
| TC-GF-06 | Group | Tambah 10 node ke grup `enemies`, panggil `callGroup('enemies','stun')` | Ke-10 node menerima panggilan | P1 |
| TC-GF-07 | Autoload | Daftarkan `GameState` sebagai autoload, ganti scene | Instance `GameState` sama sebelum & sesudah ganti scene | P1 |
| TC-GF-08 | Render 2D z-index | 3 sprite bertumpuk dengan z-index 0, 5, −1 | Urutan gambar: −1, 0, 5 | P0 |
| TC-GF-09 | TileMap | Lukis 100 tile dengan terrain autotile | Tile tepi memilih varian benar; collision per tile aktif | P0 |
| TC-GF-10 | AnimationPlayer | Animasikan `position` dan `modulate` 2 detik, Play | Nilai di t=1 detik sesuai interpolasi (toleransi 1e-4) | P0 |
| TC-GF-11 | Fisika 2D | CharacterBody2D jatuh ke StaticBody2D | Berhenti di permukaan, `isOnFloor()` = true | P0 |
| TC-GF-12 | Input Map | Petakan aksi `jump` ke Space dan tombol A gamepad | Keduanya memicu `isActionPressed('jump')` | P0 |
| TC-GF-13 | Undo/Redo | Tambah node, ubah transform, hapus node, Undo 3x | Scene kembali ke keadaan awal persis | P0 |
| TC-GF-14 | Export preset | Ekspor preset Web | Folder `dist/` berisi build yang jalan di Chrome & Firefox | P0 |

### 9.2 Transmuter: deteksi & parsing

| ID | Skenario | Langkah | Hasil yang diharapkan | Prioritas |
| --- | --- | --- | --- | --- |
| TC-TR-01 | Deteksi Godot | `detect` pada folder berisi `project.godot` (config\_version=5) | `engine=godot`, `version=4.x`, `supported=true` | P0 |
| TC-TR-02 | Tolak Godot 3 | `detect` pada proyek `config_version=4` | `supported=false`, pesan menyebut Godot 3 belum didukung | P0 |
| TC-TR-03 | Deteksi Unity | Folder dengan `ProjectSettings/ProjectVersion.txt` 2022.3 | `engine=unity`, `version=2022.3.x` | P0 |
| TC-TR-04 | Unity mode biner | Scene Unity berserialisasi biner | Gagal dengan pesan "ubah Asset Serialization ke Force Text" | P0 |
| TC-TR-05 | Parse `.tscn` | File dengan `ext_resource`, `sub_resource`, node bersarang, `connection` | AST memuat semua bagian; referensi `ExtResource("1_abc")` terselesaikan | P0 |
| TC-TR-06 | Parse YAML Unity | `.unity` dengan banyak dokumen `--- !u!1 &123` | Semua GameObject + komponen terhubung lewat `fileID` | P0 |
| TC-TR-07 | Referensi rusak | `.prefab` merujuk GUID yang tidak ada | Konversi lanjut; item `unsupported` dengan path & GUID di report | P0 |
| TC-TR-08 | File berbahaya | YAML dengan anchor bersarang eksponensial (billion laughs) | Parser berhenti di batas, error jelas, memori < 200 MB | P0 |
| TC-TR-09 | Folder sumber read-only | Jalankan konversi pada folder read-only | Sukses; tidak ada upaya tulis ke sumber | P0 |

### 9.3 Transmuter: konversi scene & aset

| ID | Skenario | Langkah | Hasil yang diharapkan | Prioritas |
| --- | --- | --- | --- | --- |
| TC-TR-10 | Godot → Linden 2D | Impor demo platformer 2D Godot | Scene terbuka; sprite, TileMap, CharacterBody2D, kamera ada; game bisa di-Play | P0 |
| TC-TR-11 | Godot → Linden 3D | Impor scene 3D dengan MeshInstance3D, lampu, kamera | Posisi/rotasi sama (toleransi 1e-5); mesh & material tampil | P0 |
| TC-TR-12 | Unity → Linden sumbu | Kubus Unity di (1, 2, 3) rotasi Y 90° | Di Linden posisi (1, 2, −3), orientasi visual identik | P0 |
| TC-TR-13 | Unity prefab bersarang | Prefab A berisi Prefab B dengan override warna | Instance scene di Linden; override tercatat; status `partial` jika variant bertingkat > 2 | P0 |
| TC-TR-14 | Unity 2D PPU | Sprite PPU 100 di (2, 1) | Di Linden posisi (200, −100) px | P0 |
| TC-TR-15 | Signal → UnityEvent | Ekspor Linden dengan signal Button→Door ke Unity | `Button.onClick` berisi persistent call ke `Door.Open` | P1 |
| TC-TR-16 | Grup → tag Unity | Node dengan 2 grup diekspor ke Unity | Grup pertama jadi Tag, sisanya ke komponen `LindenGroups`; status `partial` | P1 |
| TC-TR-17 | Material kustom | Shader Godot `.gdshader` kustom | Diganti PBR dengan albedo/tekstur yang terbaca; item `partial` + saran | P0 |
| TC-TR-18 | Model FBX | Impor `.fbx` dengan opsi GLTF aktif | File `.glb` dibuat; jumlah vertex & material sama | P1 |
| TC-TR-19 | ID stabil | Ekspor Linden → Unity 2x | GUID di semua `.meta` identik antar run | P0 |
| TC-TR-20 | Animator | AnimationTree Godot dengan state machine 4 state | Animator Linden dengan 4 state & transisi; BlendSpace = `partial` | P1 |

### 9.4 Transmuter: skrip

| ID | Skenario | Langkah | Hasil yang diharapkan | Prioritas |
| --- | --- | --- | --- | --- |
| TC-SC-01 | GDScript dasar | `_ready`, `_process(delta)`, `@export var speed = 200` | Kelas TS dengan `onInit`, `onUpdate`, properti `speed` di Inspector | P0 |
| TC-SC-02 | GDScript signal | `signal died` + `emit_signal("died")` / `died.emit()` | Signal terdeklarasi dan dipancarkan di TS | P0 |
| TC-SC-03 | GDScript tak didukung | `await get_tree().create_timer(1).timeout` + kode meta | Bagian yang tak bisa diterjemahkan jadi stub `TRANSMUTER-TODO` berisi kode asli; file tetap terkompilasi | P0 |
| TC-SC-04 | C# MonoBehaviour | `Start`, `Update`, `[SerializeField] float speed`, `GetComponent<Rigidbody>()` | TS ekuivalen; field tampil di Inspector | P0 |
| TC-SC-05 | C# coroutine | `IEnumerator` + `yield return new WaitForSeconds(1)` | Diterjemahkan ke `async` + `await wait(1)` | P1 |
| TC-SC-06 | C# LINQ/generic kompleks | Kueri LINQ bersarang | Stub + report `partial`; tidak crash | P0 |
| TC-SC-07 | Blueprint → GDScript | Ekspor blueprint "Rotating Cube" ke Godot | GDScript `_process` merotasi node; berjalan di Godot 4 | P0 |
| TC-SC-08 | Tanpa eksekusi | Skrip sumber berisi kode yang menulis file saat dimuat | Tidak ada efek samping selama konversi (diverifikasi sandbox fs) | P0 |

### 9.5 Round-trip & regresi

| ID | Skenario | Langkah | Hasil yang diharapkan | Prioritas |
| --- | --- | --- | --- | --- |
| TC-RT-01 | Linden → Godot → Linden | Konversi 20 scene fixture bolak-balik | ≥ 99% properti transform, hierarki, referensi aset identik | P0 |
| TC-RT-02 | Linden → Unity → Linden | Sama, lewat Unity | ≥ 99% identik; perbedaan hanya di item `partial` yang tercatat | P0 |
| TC-RT-03 | Godot → Linden → Godot | Buka hasil di Godot 4 editor headless (`godot --headless --import`) | Tidak ada error impor; `extras` mengembalikan properti asli | P0 |
| TC-RT-04 | Unity → Linden → Unity | Buka hasil di Unity batchmode | Tidak ada error kompilasi atau referensi hilang | P1 |
| TC-RT-05 | Godot ↔ Unity langsung | Konversi Godot → Unity lewat CLI | Proyek Unity terbuka; report merangkum kehilangan | P1 |
| TC-RT-06 | Determinisme | Konversi proyek sama 3x | Hash folder output identik | P0 |
| TC-RT-07 | Snapshot regresi | CI membandingkan output korpus dengan snapshot | Perubahan output wajib disetujui eksplisit | P0 |

### 9.6 Performa, CLI & UI

| ID | Skenario | Langkah | Hasil yang diharapkan | Prioritas |
| --- | --- | --- | --- | --- |
| TC-PF-01 | Proyek besar | Impor proyek 500 aset di mesin referensi | ≤ 60 detik; memori puncak ≤ 2 GB | P0 |
| TC-PF-02 | Scene besar | Parse `.tscn` 10.000 node | ≤ 5 detik | P1 |
| TC-PF-03 | Inkremental | Ubah 1 scene, konversi ulang `--incremental` | Hanya 1 scene diproses; waktu < 10% konversi penuh | P1 |
| TC-CL-01 | Kode keluar CLI | Konversi proyek dengan 1 item `partial` | Exit code 2; report ditulis | P0 |
| TC-CL-02 | Batal | Kirim SIGINT di tengah konversi | Folder output tidak ada/kosong; folder temp dibersihkan | P0 |
| TC-UI-01 | Wizard alur penuh | Jalankan 6 langkah wizard dengan proyek Godot | Proyek hasil terbuka di editor; report tampil | P0 |
| TC-UI-02 | Dry run | Pilih Analisis saja | Ringkasan & skor tampil; folder output tetap kosong | P0 |
| TC-UI-03 | Navigasi report | Klik item `partial` di report | Node terkait terseleksi di Hierarchy | P1 |
| TC-UI-04 | Undo impor | Impor satu `.tscn` via drag-drop, lalu Ctrl+Z | Semua node hasil impor hilang dalam satu langkah | P1 |
| TC-UI-05 | Keyboard & kontras | Operasikan wizard hanya dengan keyboard; cek kontras | Semua langkah bisa diselesaikan; kontras ≥ 4.5:1 | P1 |

## 10. Roadmap, risiko & pertanyaan terbuka

Godot didahulukan karena formatnya teks terbuka dan berlisensi MIT; Unity dikerjakan setelah LIF dan jalur round-trip terbukti stabil.

&#91;embedded content: roadmap v0.2–v0.4 · fitur engine, Transmuter, dan gate per rilis\]

Tiap rilis hanya dinyatakan selesai jika gate-nya lulus di CI. Tanggal target belum ditentukan dan perlu disepakati tim.

**Risiko**

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| Transpilasi skrip jauh di bawah target akurasi | Pengguna harus menulis ulang banyak kode | Stub yang jelas + kode asli di komentar; prioritaskan pola API paling umum dari korpus |
| Format Godot/Unity berubah antar versi | Parser rusak di versi baru | Adapter per versi mayor; uji korpus per versi di CI |
| Perbedaan fisika antar engine | Gameplay terasa beda setelah konversi | Catat parameter fisika sebagai `partial`; dokumentasikan perbedaan solver |
| Skala proyek (ribuan aset) | Lambat atau kehabisan memori | Streaming parse, konversi inkremental, worker thread |
| Lingkup terlalu besar untuk tim kecil | Rilis molor | Gate per rilis; fitur P2 boleh digeser ke v1.0 |

**Lisensi & legal**

- Godot berlisensi MIT: kode yang diadopsi wajib menyertakan notice MIT Godot di `THIRD_PARTY_NOTICES`.
- Unity bukan open source: Transmuter hanya membaca dan menulis format file proyek milik pengguna, tidak menyalin kode atau biner Unity. Format YAML Unity didokumentasikan publik oleh Unity.
- Korpus uji Unity dibuat sendiri oleh tim; aset Asset Store tidak dimasukkan ke repo.
- Merek "Godot" dan "Unity" hanya dipakai secara deskriptif ("impor dari Godot"), bukan sebagai bagian nama produk. Sebaiknya dikonfirmasi dengan penasihat hukum sebelum rilis publik.

**Pertanyaan terbuka**

- [x] Apakah Node menjadi model utama editor, atau tetap opsional di samping ECS murni? ya node menjadi model utama ecs jadi optional
- [x] Format `.lscn` mengikuti sintaks mirip `.tscn` (INI) atau JSON/YAML? ya
- [x] Dukungan Godot C# (.NET) masuk v0.3 atau ditunda? masuk ke v0.3
- [x] Unity Input Manager lama: dikonversi penuh atau hanya Input System baru? ya input system baru
- [x] Siapa pemilik korpus uji dan siapa yang menyetujui perubahan snapshot? esteben vanhold
- [x] Target tanggal untuk v0.2, v0.3, dan v0.4. di jadwalkan melalu pR  v0.2 25 oktober 2026 ,v0.3 1 vovember 2026  v0.4 10 november 2026
