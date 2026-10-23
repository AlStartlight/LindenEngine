# PRD & Test Case — Godot Bridge untuk Linden Engine

Oct 23, 2026 · @accept

## Ringkasan

Linden Engine v0.2 menambahkan **Godot Bridge**: sinkronisasi dua arah antara proyek Linden (ECS, Blueprint, Material, Animator, Sequencer) dan proyek Godot 4.x, sehingga Linden tetap menjadi editor web-first sementara Godot menjadi runtime dan jalur ekspor ke Android, iOS, Web, dan konsol.

**Latar belakang.** Linden Engine (Electron, TypeScript, React, WebGPU/Three.js, MIT) baru v0.1 Alpha. Roadmap-nya masih menunggu import aset, fisika, audio, serialisasi scene, prefab, undo/redo, dan dukungan mobile. Godot (C++, MIT, didukung Godot Foundation) sudah matang di semua area itu dan ekspornya satu klik ke desktop, mobile, Web, dan konsol.

**Konsep sinkronisasi.** Daripada membangun ulang semua fitur runtime, Linden memetakan modelnya ke konsep Godot yang setara:

| Konsep Linden | Padanan Godot |
| --- | --- |
| Entity + Component (ECS) | Node dalam Scene Tree (.tscn) |
| Blueprint (visual scripting) | GDScript hasil transpile (.gd) |
| TypeScript script | GDScript stub + bridge API, atau tetap di runtime Web Linden |
| Material Editor (node graph) | StandardMaterial3D / ShaderMaterial (.tres, .gdshader) |
| Animator (state machine) | AnimationTree + AnimationNodeStateMachine |
| Sequencer (timeline) | AnimationPlayer + Animation tracks |
| Plugin Linden | EditorPlugin / GDExtension di sisi Godot |
| Build Electron/Web | Export preset + export template Godot |

Asumsi dokumen ini: target Godot 4.3 ke atas, format scene teks (.tscn/.tres), dan Godot dijalankan sebagai proses terpisah (editor atau `--headless`), bukan di-embed ke Electron. Lisensi keduanya MIT, jadi tidak ada konflik lisensi.

## Tujuan, non-goal, dan metrik

Keberhasilan diukur dari satu hal: scene yang dibuat di Linden bisa dibuka, dimainkan, dan diekspor di Godot tanpa edit manual, lalu kembali ke Linden tanpa kehilangan data.

**Tujuan**

1. Ekspor proyek Linden menjadi proyek Godot yang valid (project.godot, .tscn, .tres, .gd).
2. Impor proyek Godot (.tscn/.tres) ke Linden dengan hierarki dan komponen terjaga.
3. Live sync dua arah antara editor Linden dan editor Godot yang berjalan bersamaan.
4. Transpile Blueprint ke GDScript yang bisa dibaca dan dijalankan.
5. Build dan ekspor ke Android, iOS, dan Web memakai export template Godot dari dalam Linden.

**Non-goal (v0.2)**

- Meng-embed runtime Godot di dalam jendela Electron.
- Mengonversi TypeScript ke GDScript secara otomatis (hanya stub + bridge).
- Mendukung Godot 3.x atau format biner (.scn/.res).
- Sinkronisasi node 2D (Node2D, Sprite2D); fokus v0.2 adalah 3D.
- C# / .NET di sisi Godot.

**Metrik keberhasilan**

| Metrik | Target |
| --- | --- |
| Round-trip Linden → Godot → Linden tanpa selisih data | 100% untuk komponen yang didukung |
| Proyek hasil ekspor terbuka di Godot tanpa error | 100% pada suite proyek sampel |
| Blueprint ter-transpile yang lolos parser GDScript | ≥ 95% dari node yang didukung |
| Latensi live sync perubahan Transform | ≤ 100 ms (p95, lokal) |
| Waktu ekspor scene 1.000 entity | ≤ 5 detik |
| Waktu dari tombol Build sampai APK/HTML5 jadi | ≤ 2× waktu ekspor Godot langsung |

## Persona dan user stories

Tiga persona menentukan prioritas: desainer non-coder butuh Blueprint yang jalan di Godot, programmer butuh kode GDScript yang rapi, dan tim butuh ekspor mobile.

| Persona | Kebutuhan utama |
| --- | --- |
| Rina, game designer non-coder | Membuat gameplay dengan Blueprint, menguji di Godot, rilis ke Android |
| Bima, programmer indie | Mengedit hasil GDScript di Godot dan melihat perubahan scene kembali di Linden |
| Tim studio kecil (3–5 orang) | Satu repo Git berisi proyek Linden dan Godot yang tetap sinkron |
| Mahasiswa | Belajar konsep engine lewat Linden, lalu pindah ke Godot tanpa mulai dari nol |

**User stories**

1. **US-01** Sebagai desainer, saya ingin klik *Export to Godot* agar scene saya terbuka di Godot dengan objek, kamera, dan lampu yang sama.
2. **US-02** Sebagai desainer, saya ingin Blueprint saya berjalan di Godot tanpa menulis kode.
3. **US-03** Sebagai programmer, saya ingin mengimpor scene .tscn yang sudah ada ke Linden untuk diedit secara visual.
4. **US-04** Sebagai programmer, saya ingin memindahkan objek di Godot dan melihatnya ikut berpindah di viewport Linden secara langsung.
5. **US-05** Sebagai tim, saya ingin konflik edit dari dua editor terdeteksi dan bisa saya pilih mana yang dipakai.
6. **US-06** Sebagai desainer, saya ingin material dari Material Editor tampil mirip di Godot.
7. **US-07** Sebagai animator, saya ingin state machine Animator menjadi AnimationTree di Godot.
8. **US-08** Sebagai tim, saya ingin build APK dan HTML5 langsung dari toolbar Linden.
9. **US-09** Sebagai pengguna, saya ingin laporan jelas tentang fitur yang tidak bisa dikonversi.

## Arsitektur integrasi

Linden tidak pernah memanggil Godot secara langsung: empat komponen di modul `engine/godot/` menangani live sync, file scene, transpile script, dan build.

&#91;embedded content: arsitektur Godot Bridge · 3 lapis, 4 jalur\]

Panah dua arah berarti data mengalir bolak-balik (live sync dan ekspor/impor scene); panah satu arah hanya menghasilkan output untuk Godot. Kunci sinkronisasi antara entity Linden dan node Godot adalah metadata `linden_id`.

## Spesifikasi fungsional

Ada 10 kebutuhan fungsional; P0 wajib untuk rilis v0.2 Beta, P1 boleh menyusul di v0.2.x, P2 untuk v0.3.

| ID | Fitur | Deskripsi | Prioritas | Story |
| --- | --- | --- | --- | --- |
| FR-01 | Scene Exporter | Mengubah World Linden menjadi file .tscn: Entity → Node3D, Component → node anak atau properti sesuai tabel mapping. Menulis project.godot bila belum ada. | P0 | US-01 |
| FR-02 | Scene Importer | Mem-parse .tscn/.tres teks ke World Linden. Node tak dikenal disimpan sebagai `GodotPassthroughComponent` agar tidak hilang saat round-trip. | P0 | US-03 |
| FR-03 | Blueprint Transpiler | BlueprintGraph → GDScript. Event BeginPlay → `_ready()`, Tick → `_process(delta)`, Input → `_input(event)`, Collision → sinyal `body_entered`. | P0 | US-02 |
| FR-04 | Live Sync | Koneksi WebSocket antara Linden (server) dan addon `linden_bridge` di editor Godot (client). Mengirim diff per properti, bukan scene utuh. | P0 | US-04 |
| FR-05 | Conflict Resolver | Tiap properti membawa nomor revisi; perubahan bersamaan pada properti yang sama memunculkan dialog pilih Linden, Godot, atau gabung manual. | P1 | US-05 |
| FR-06 | Material Converter | Node PBR (albedo, metallic, roughness, normal) → StandardMaterial3D. Graph kustom → ShaderMaterial + .gdshader. | P1 | US-06 |
| FR-07 | Animator Converter | State, transisi, parameter, dan kondisi → AnimationTree dengan AnimationNodeStateMachine. Blend tree → AnimationNodeBlendSpace1D/2D. | P1 | US-07 |
| FR-08 | Sequencer Converter | Track Transform/Animation/Audio/Event → track AnimationPlayer (value, animation, audio, method call). | P2 | US-07 |
| FR-09 | Godot Build Runner | Memanggil Godot `--headless --export-release <preset> <path>` dari toolbar, menampilkan log di Console Linden. Deteksi otomatis path Godot dan export template. | P0 | US-08 |
| FR-10 | Compatibility Report | Setiap ekspor/impor menghasilkan laporan: jumlah item terkonversi, dilewati, dan diperingatkan, dengan tautan ke entity terkait. | P0 | US-09 |

**Aturan bisnis penting**

- Rotasi Linden disimpan dalam derajat; Godot memakai radian di Transform3D. Konversi wajib di FR-01 dan FR-02.
- Kedua engine memakai sumbu Y ke atas dan sistem tangan kanan, jadi posisi tidak perlu di-flip.
- Nama Entity yang tidak valid sebagai nama Node Godot (mengandung `.` `:` `@` `/` `"` `%`) disanitasi, nama asli disimpan di metadata `linden_name`.
- Setiap node Godot hasil ekspor membawa metadata `linden_id` (UUID entity) sebagai kunci sinkronisasi.
- Script TypeScript tidak dikonversi; ekspor membuat stub .gd dengan komentar TODO dan masuk ke Compatibility Report.

## Kebutuhan non-fungsional

Yang paling kritis adalah integritas data: bridge tidak boleh menghapus atau merusak isi proyek Godot milik pengguna.

| ID | Kategori | Kebutuhan |
| --- | --- | --- |
| NFR-01 | Integritas data | Ekspor tidak pernah menimpa file .tscn yang diubah manual tanpa konfirmasi; backup otomatis ke `.linden/backup/` sebelum menulis. |
| NFR-02 | Determinisme | Ekspor scene yang sama dua kali menghasilkan file byte-identik (urutan node dan properti stabil), agar diff Git bersih. |
| NFR-03 | Performa | Ekspor 1.000 entity ≤ 5 detik; impor ≤ 5 detik; live sync ≤ 100 ms p95 di localhost. |
| NFR-04 | Kompatibilitas | Godot 4.3 ke atas; Windows 10+, macOS 12+, Ubuntu 22.04+. Versi Godot dicek saat handshake. |
| NFR-05 | Keamanan | WebSocket hanya bind ke 127.0.0.1, memakai token sesi acak per peluncuran; pesan divalidasi skema sebelum diterapkan. |
| NFR-06 | Ketahanan | Koneksi live sync putus → reconnect otomatis dengan backoff, lalu resync berbasis revisi tanpa kehilangan perubahan. |
| NFR-07 | Observabilitas | Semua operasi bridge tercatat di Console Linden dengan level info/warn/error dan ID korelasi. |
| NFR-08 | Kualitas kode | TypeScript strict, cakupan unit test modul `engine/godot/` ≥ 80%, lolos ESLint dan Prettier. |
| NFR-09 | Keterbacaan output | GDScript hasil transpile memakai typed GDScript, indentasi tab, dan komentar asal node Blueprint. |

## Spesifikasi teknis

Bridge ditambahkan sebagai modul baru `engine/godot/` plus addon GDScript `linden_bridge` yang disalin ke folder `addons/` proyek Godot.

**Struktur folder baru**

```
LindenEngine/
├── engine/godot/
│   ├── GodotBridge.ts          # entry point, lifecycle, konfigurasi
│   ├── tscn/
│   │   ├── TscnParser.ts       # .tscn/.tres → AST
│   │   ├── TscnWriter.ts       # AST → teks deterministik
│   │   └── Variant.ts          # Vector3, Transform3D, Color, NodePath, dll.
│   ├── mapping/
│   │   ├── ComponentMap.ts     # Component Linden ↔ Node/properti Godot
│   │   ├── MaterialMap.ts
│   │   └── AnimatorMap.ts
│   ├── transpiler/
│   │   ├── BlueprintToGd.ts
│   │   └── nodes/              # satu emitter per tipe node Blueprint
│   ├── sync/
│   │   ├── SyncServer.ts       # WebSocket 127.0.0.1
│   │   ├── DiffEngine.ts
│   │   └── ConflictResolver.ts
│   ├── build/GodotBuildRunner.ts
│   └── report/CompatReport.ts
├── editor/panels/GodotPanel.tsx  # status koneksi, tombol Export/Import/Build
└── godot-addon/linden_bridge/
    ├── plugin.cfg
    ├── plugin.gd               # EditorPlugin
    └── sync_client.gd          # WebSocketPeer
```

**API publik**

```ts
interface GodotBridgeConfig {
  godotProjectPath: string
  godotExecutable?: string      // auto-detect bila kosong
  syncPort?: number             // default 6007
  onConflict?: 'ask' | 'linden-wins' | 'godot-wins'
}

class GodotBridge {
  constructor(engine: LindenEngine, config: GodotBridgeConfig)
  exportScene(world: World, outPath: string): Promise<CompatReport>
  importScene(tscnPath: string): Promise<{ world: World; report: CompatReport }>
  transpileBlueprint(graph: BlueprintGraph): { code: string; report: CompatReport }
  startLiveSync(): Promise<void>
  stopLiveSync(): void
  build(preset: string, outPath: string): Promise<BuildResult>
}
```

**Protokol live sync (JSON lewat WebSocket)**

```json
{
  "v": 1,
  "type": "property_changed",
  "token": "<token sesi>",
  "linden_id": "5f1c…",
  "path": "transform.position",
  "value": { "x": 1, "y": 0, "z": -2 },
  "rev": 42,
  "origin": "godot"
}
```

Tipe pesan: `hello` (versi + token), `snapshot`, `node_added`, `node_removed`, `node_reparented`, `property_changed`, `ack`, `conflict`, `error`.

**Tabel mapping komponen**

| Komponen Linden | Node/properti Godot | Catatan |
| --- | --- | --- |
| Entity | Node3D | metadata `linden_id`, `linden_name` |
| Transform | `Node3D.transform` (Transform3D) | rotasi derajat ↔ radian, skala langsung |
| MeshRenderer (primitif) | MeshInstance3D + BoxMesh/SphereMesh/CylinderMesh/PlaneMesh |  |
| MeshRenderer (.gltf) | instance scene .glb/.gltf hasil import Godot | path aset di-remap ke `res://` |
| Camera | Camera3D | fov, near, far |
| Light (directional/point/spot) | DirectionalLight3D / OmniLight3D / SpotLight3D | intensitas → `light_energy` |
| RigidBody | RigidBody3D | mass, gravity\_scale, linear/angular damp |
| Collider | CollisionShape3D + Shape3D | anak dari body |
| AudioSource | AudioStreamPlayer3D | volume dB, autoplay |
| BlueprintComponent | script .gd pada node | hasil FR-03 |
| ScriptComponent (TS) | stub .gd | masuk laporan sebagai peringatan |

**Mapping node Blueprint → GDScript (contoh)**

| Node Blueprint | GDScript |
| --- | --- |
| Event BeginPlay | `func _ready() -> void:` |
| Event Tick | `func _process(delta: float) -> void:` |
| Input | `func _input(event: InputEvent) -> void:` |
| Collision | `body_entered.connect(_on_body_entered)` |
| Branch | `if cond:` / `else:` |
| Sequence | pernyataan berurutan |
| Loop | `for i in range(n):` |
| Delay | `await get_tree().create_timer(t).timeout` |
| Print | `print(value)` |
| Rotate | `rotate_y(deg_to_rad(v) * delta)` |
| Spawn | `add_child(scene.instantiate())` |
| Destroy | `queue_free()` |
| Get/Set Variable | `var` bertipe di level kelas |

## Test case

Ada 37 test case dalam lima kelompok; semua kasus P0 wajib lulus sebelum rilis v0.2 Beta. Unit test memakai Vitest, uji sisi Godot memakai GUT (Godot Unit Test) atau `godot --headless --script`, E2E memakai Playwright untuk Electron.

**Lingkungan uji:** Node.js 18+, Godot 4.3 dan versi stabil terbaru 4.x, export template terpasang, proyek sampel `fixtures/` (scene kosong, rotating cube, 1.000 entity, karakter beranimasi, proyek Godot demo resmi).

### Unit test (UT)

| ID | Modul | Skenario | Langkah | Hasil yang diharapkan | Prio |
| --- | --- | --- | --- | --- | --- |
| UT-01 | TscnWriter | Entity tunggal dengan Transform | Ekspor entity posisi (1,2,3), rotasi Y 90° | Satu `[node]` Node3D; Transform3D berisi rotasi π/2 rad; metadata `linden_id` ada | P0 |
| UT-02 | TscnWriter | Determinisme | Ekspor scene sama dua kali | Kedua file byte-identik | P0 |
| UT-03 | TscnWriter | Sanitasi nama | Entity bernama `Player.1/Main` | Nama node valid tanpa karakter terlarang; `linden_name` menyimpan nama asli | P0 |
| UT-04 | TscnParser | Parse .tscn standar | Parse scene buatan Godot berisi Node3D, MeshInstance3D, Camera3D | AST benar; jumlah node dan hierarki sama | P0 |
| UT-05 | TscnParser | ext\_resource dan sub\_resource | Scene dengan material sub\_resource dan mesh ext\_resource | Referensi ter-resolve; tidak ada ID yatim | P0 |
| UT-06 | TscnParser | File rusak | Parse .tscn dengan header terpotong | Error terkontrol dengan nomor baris; tidak crash | P0 |
| UT-07 | Variant | Konversi tipe | Round-trip Vector3, Color, Transform3D, NodePath, Array, Dictionary | Nilai sama dalam toleransi 1e-6 | P0 |
| UT-08 | ComponentMap | Light | Konversi point light intensitas 2 | OmniLight3D dengan `light_energy = 2` | P1 |
| UT-09 | ComponentMap | Komponen tak dikenal | Impor node `GPUParticles3D` | Disimpan sebagai `GodotPassthroughComponent`; muncul di laporan | P0 |
| UT-10 | BlueprintToGd | Event Tick + Rotate | Transpile graph rotating cube | Kode berisi `_process(delta: float)` dan `rotate_y`; lolos parser GDScript | P0 |
| UT-11 | BlueprintToGd | Branch + Loop | Graph dengan Branch bersarang dan For Loop | Indentasi tab benar; struktur if/for sesuai graph | P0 |
| UT-12 | BlueprintToGd | Delay | Graph BeginPlay → Delay 2 s → Print | `_ready()` memakai `await get_tree().create_timer(2.0).timeout` | P1 |
| UT-13 | BlueprintToGd | Node tidak didukung | Graph berisi node kustom plugin | Komentar `# UNSUPPORTED` di kode; peringatan di laporan; sisa graph tetap dihasilkan | P0 |
| UT-14 | BlueprintToGd | Siklus eksekusi | Graph dengan loop exec tanpa kondisi keluar | Transpile ditolak dengan pesan jelas | P1 |
| UT-15 | DiffEngine | Diff properti | Ubah satu posisi pada scene 100 entity | Hanya satu pesan `property_changed` | P0 |
| UT-16 | ConflictResolver | Edit bersamaan | Rev lokal 41 dan remote 41 mengubah path sama | Status `conflict`; tidak ada data yang ditimpa diam-diam | P1 |

### Integration test (IT)

| ID | Skenario | Langkah | Hasil yang diharapkan | Prio |
| --- | --- | --- | --- | --- |
| IT-01 | Ekspor terbuka di Godot | Ekspor rotating cube, jalankan `godot --headless --path <proyek> --quit` | Exit code 0, tanpa error di log | P0 |
| IT-02 | Round-trip Linden → Godot → Linden | Ekspor fixture lalu impor kembali | World identik (entity, hierarki, komponen, nilai) | P0 |
| IT-03 | Round-trip Godot → Linden → Godot | Impor scene demo Godot, ekspor ulang | Node passthrough utuh; diff hanya pada metadata Linden | P0 |
| IT-04 | Blueprint berjalan di Godot | Ekspor rotating cube, jalankan 60 frame headless | Rotasi Y bertambah sesuai delta; tidak ada error runtime | P0 |
| IT-05 | Material PBR | Ekspor material albedo merah, metallic 1, roughness 0.2 | StandardMaterial3D dengan nilai sama | P1 |
| IT-06 | Animator | Ekspor state machine Idle/Running/Jumping | AnimationTree dengan 3 state dan transisi berkondisi `Speed` | P1 |
| IT-07 | Sequencer | Ekspor cutscene 4 track | AnimationPlayer dengan track value, animation, audio, method | P2 |
| IT-08 | Handshake addon | Jalankan Linden dan Godot dengan addon aktif | `hello` sukses; versi Godot tercatat; token cocok | P0 |
| IT-09 | Token salah | Kirim pesan dengan token acak | Koneksi ditolak; error tercatat; tidak ada perubahan scene | P0 |

### End-to-end test (E2E)

| ID | Skenario | Langkah | Hasil yang diharapkan | Prio |
| --- | --- | --- | --- | --- |
| E2E-01 | Alur desainer | Buat cube + Blueprint di Linden → Export to Godot → buka di editor Godot → Play | Cube berputar seperti di Linden | P0 |
| E2E-02 | Live sync Linden → Godot | Geser entity di viewport Linden | Node bergerak di Godot ≤ 100 ms | P0 |
| E2E-03 | Live sync Godot → Linden | Ubah nama dan posisi node di Godot | Hierarchy dan viewport Linden ter-update | P0 |
| E2E-04 | Putus sambung | Tutup Godot saat sync aktif, edit di Linden, buka lagi | Reconnect otomatis; perubahan offline tersinkron | P1 |
| E2E-05 | Konflik | Ubah properti sama di kedua editor dalam 1 detik | Dialog konflik muncul; pilihan pengguna diterapkan di keduanya | P1 |
| E2E-06 | Build Web | Klik Build → preset Web | Folder HTML5 jadi; log tampil di Console; game jalan di browser | P0 |
| E2E-07 | Build Android | Klik Build → preset Android (SDK terpasang) | File .apk jadi; terpasang dan jalan di emulator | P0 |
| E2E-08 | Godot tidak ditemukan | Hapus path Godot, klik Export/Build | Pesan jelas + tombol pilih executable; tidak crash | P0 |

### Performa dan kompatibilitas (PC)

| ID | Skenario | Hasil yang diharapkan | Prio |
| --- | --- | --- | --- |
| PC-01 | Ekspor 1.000 entity | ≤ 5 detik | P0 |
| PC-02 | Impor 1.000 node | ≤ 5 detik | P0 |
| PC-03 | 500 perubahan Transform per detik lewat live sync | p95 ≤ 100 ms; memori stabil 10 menit | P1 |
| PC-04 | Matriks OS (Windows, macOS, Linux) × Godot (4.3, 4.x terbaru) | IT-01, IT-02, E2E-01 lulus di semua kombinasi | P0 |

## Roadmap, risiko, dan pertanyaan terbuka

Pengerjaan dibagi empat fase berurutan; fase berikutnya baru dimulai setelah test gate fase sebelumnya lulus. Sequencer Converter (FR-08, P2) menyusul di v0.3.

&#91;embedded content: roadmap Godot Bridge · 4 fase, gate per fase\]

Gate Fase 2 juga mencakup E2E-01, E2E-06, E2E-07, dan E2E-08; gate Fase 3 mencakup E2E-02 sampai E2E-05.

**Risiko**

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| Format .tscn berubah antar versi minor Godot 4.x | Ekspor/impor gagal | Uji matriks versi (PC-04); deteksi `format=` di header; parser toleran properti tak dikenal |
| Semantik Blueprint tidak 1:1 dengan GDScript (mis. Delay, Gate) | Perilaku game berbeda | Emitter per node dengan uji perilaku headless (IT-04); laporan peringatan untuk node berisiko |
| Material kustom tampil berbeda (WebGPU vs renderer Forward+ Godot) | Visual tidak konsisten | Batasi v0.2 ke PBR standar; graph kustom diberi label eksperimental |
| Loop sinkronisasi (perubahan memantul antar editor) | CPU tinggi, data rusak | Field `origin` + `rev`; abaikan echo dari sumber sendiri (UT-15) |
| Pengguna belum memasang Godot atau export template | Build gagal | Deteksi otomatis, panduan instalasi di GodotPanel (E2E-08) |
| Script TypeScript tidak ikut terkonversi | Gameplay hilang di Godot | Stub .gd + laporan jelas; dorong logika baru ke Blueprint |

**Pertanyaan terbuka**

- [ ] Apakah runtime Web Linden tetap dipertahankan, atau Godot Web export menjadi satu-satunya jalur Web? godot webs export 
- [ ] Apakah addon `linden_bridge` dirilis di Godot Asset Library atau hanya dibundel di repo Linden? ya dua duanya
- [ ] Perlukah dukungan Node2D masuk v0.3, mengingat Linden saat ini fokus 3D? ya
- [ ] Apakah transpile TypeScript → GDScript layak dijajaki, atau cukup GDExtension yang menjalankan JS? ya semua
- [ ] Versi minimum Godot: tetap 4.3, atau naik ke versi stabil terbaru saat implementasi dimulai? support naik ke versi stabil terbaru minimal godot 4.3
