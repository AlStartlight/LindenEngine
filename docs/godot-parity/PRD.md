# PRD: Godot Feature Parity dengan UX Unity

23 Okt 2026 · Status: Draft · Dokumen terkait: [SPEC.md](./SPEC.md) · [TEST_CASES.md](./TEST_CASES.md)

Linden Engine mengadopsi **fitur** dari [Godot Engine](https://github.com/godotengine/godot) (MIT), tetapi menyajikannya dengan **UI/UX Unity**. Dari Godot kita ambil model scene yang bisa di-instance, signals, undo/redo, input map, physics body, autoload, resource kustom, dan pipeline export. Dari Unity kita ambil cara pengguna berinteraksi: GameObject + Component, Inspector bergaya Unity, Prefab, Add Component, Tags & Layers, Project window, dan shortcut Unity.

Rilis dibagi tiga fase. **Fase 0–1 (v0.2–v0.3)** adalah komitmen PRD ini. Fase 2–3 dicatat sebagai arah dan akan diperinci di PRD lanjutan.

---

## 1. Latar belakang

### 1.1 Kondisi Linden saat ini (diverifikasi dari kode, 23 Okt 2026)

| Area | Kondisi |
| --- | --- |
| Model scene editor | Viewport memakai objek Three.js langsung (`editor/viewport/SceneViewport.tsx`). ECS `World` di `engine/ecs` **tidak dipakai** oleh editor. |
| Hierarchy / Inspector | Hierarchy kini berbasis daftar objek viewport; Inspector hanya transform. Belum ada komponen yang bisa ditambah/dihapus. |
| Physics | `PhysicsSystem.updateEntity()` dan `checkCollisions()` masih kosong (placeholder). Komponen `RigidBody` dan `Collider` hanya data. |
| Undo/Redo | Hook `editor/hooks/useHistory.ts` ada, tetapi belum dipakai untuk operasi scene. |
| Save/Open | Spec Open Scene + format `.lscene` v1 ada (`docs/specs/PRD-Open-Scene-Ctrl-O.md`); Save belum ada. |
| Visual scripting, Material graph, Animator, Sequencer | Ada sebagai editor terpisah (`engine/blueprints`, `engine/materials`, `engine/animation`, `engine/cinematic`). |
| Input | `InputManager` hanya interface di `engine/scripting/ScriptSystem.ts`. |

### 1.2 Kenapa Godot sebagai sumber fitur

- Arsitektur Godot terdokumentasi dan bersumber terbuka (MIT), jadi desainnya bisa dipelajari langsung dan bagian kecil boleh diporting dengan menyertakan notice lisensi.
- Model **scene = prefab** di Godot (`scene/resources/packed_scene.h`) memberi satu konsep untuk level dan objek yang bisa dipakai ulang. Ini lebih sederhana daripada Scene + Prefab terpisah.
- Fitur seperti signals (`core/object/object.h`), input map (`core/input/input_map.h`), dan undo/redo (`core/object/undo_redo.h`) kecil, terisolasi, dan sangat berpengaruh pada produktivitas.

### 1.3 Kenapa UX Unity

- Pengguna sasaran (indie dan pelajar) paling banyak berasal dari Unity. Menu `GameObject`, `Component`, panel Hierarchy/Inspector, dan shortcut W/E/R di Linden sudah meniru Unity.
- Model ECS Linden (Entity + Component) sudah setara dengan GameObject + Component Unity. Pohon Node Godot dipetakan ke Hierarchy Unity, bukan sebaliknya.

## 2. Tujuan dan non-tujuan

**Tujuan (Fase 0–1)**

1. Editor bekerja di atas satu model data: ECS `World` sebagai sumber kebenaran; Three.js hanya tampilan.
2. Pengguna bisa membuat level dari GameObject + Component, menyimpannya, membukanya lagi, dan meng-undo setiap perubahan.
3. Objek bisa dijadikan **Prefab** yang di-instance di banyak scene, dengan override per-instance (perilaku `PackedScene` Godot, tampilan Prefab Unity).
4. Gameplay dasar berjalan di Play mode: physics body, collider, trigger, raycast, input action, dan event antar-komponen.
5. Setiap fitur punya padanan Unity yang langsung dikenali: nama menu, letak panel, shortcut, dan istilah.

**Non-tujuan**

- GDScript dan C#. Bahasa scripting tetap **TypeScript**; konsep Godot diekspresikan sebagai API TypeScript.
- Meniru UI Godot (dock FileSystem, tab 2D/3D/Script di atas, Node dock). UI selalu mengikuti Unity.
- Kompatibilitas file `.tscn`/`.tres` Godot atau `.unity`/`.prefab` Unity. Importer bisa dibahas terpisah.
- Multiplayer (`scene/main/multiplayer_api`), XR (`modules/openxr`), dan renderer 2D penuh di Fase 0–1.
- Menyamai seluruh fitur Godot. Daftar fitur di §4 adalah subset yang dipilih.

## 3. Persona dan user stories

| Persona | Kebutuhan utama |
| --- | --- |
| **Rina — indie dev, mantan pengguna Unity** | Bisa langsung produktif tanpa belajar ulang shortcut dan letak panel. |
| **Dimas — pelajar** | Membuat game sederhana (platformer 3D) dari nol: physics, input, scene berpindah. |
| **Tim kecil (2–4 orang)** | Prefab yang dipakai ulang lintas level dan file scene yang bisa di-diff di Git. |

| ID | Sebagai | Saya ingin | Supaya |
| --- | --- | --- | --- |
| US-01 | Rina | klik `Add Component` di Inspector dan mencari "Rigidbody" | objek jatuh karena gravitasi saat Play |
| US-02 | Rina | Ctrl+Z / Ctrl+Y untuk setiap perubahan (pindah objek, ubah nilai Inspector, hapus, reparent) | berani bereksperimen |
| US-03 | Tim | drag GameObject dari Hierarchy ke Project window untuk membuat Prefab | objek yang sama dipakai di banyak level |
| US-04 | Tim | mengubah Prefab dan melihat semua instance ikut berubah, kecuali nilai yang saya override | konsistensi tanpa kehilangan variasi |
| US-05 | Dimas | menghubungkan event `OnTriggerEnter` sebuah pintu ke fungsi `open()` lewat Inspector | logika sederhana tanpa menulis kode wiring |
| US-06 | Dimas | mendefinisikan action "Jump" = Space / tombol A gamepad di satu tempat | script cukup membaca `Input.isActionPressed('Jump')` |
| US-07 | Rina | memberi beberapa tag sekaligus ("Enemy", "Flying") dan layer "Characters" ke objek | script dan raycast bisa memfilter objek |
| US-11 | Dimas | memilih Custom Event "OpenDoor" di Blueprint pintu sebagai target event trigger | logika pintu dibuat tanpa menulis TypeScript |
| US-08 | Dimas | membuat skor yang tetap ada saat pindah scene | state global tanpa singleton manual |
| US-09 | Tim | membuat aset data (mis. `WeaponData`) dari menu `Create` di Project window | desainer mengubah angka tanpa menyentuh kode |
| US-10 | Rina | melihat Play mode dengan editor ber-tint dan perubahan dikembalikan saat Stop | tidak kehilangan setup scene karena eksperimen di Play mode |

## 4. Katalog fitur

Prioritas: **P0** = wajib untuk fase itu, **P1** = sebaiknya, **P2** = jika sempat.

### 4.1 Fase 0 — Fondasi (v0.2)

| ID | Fitur | Sumber Godot | Wujud UX Unity | Prioritas |
| --- | --- | --- | --- | --- |
| F0.1 | Scene model berbasis ECS | `scene/main/node.h`, `scene/main/scene_tree.h` | Hierarchy berisi GameObject; Inspector menampilkan komponen | P0 |
| F0.2 | Component registry + reflection properti | `core/object/class_db.h`, `core/object/property_info.h` | Inspector otomatis per komponen; `Add Component` dengan pencarian | P0 |
| F0.3 | Undo/Redo | `core/object/undo_redo.h`, `editor/editor_undo_redo_manager.h` | Edit → Undo/Redo, Ctrl+Z / Ctrl+Y, Edit → Undo History | P0 |
| F0.4 | Save / Open scene `.lscene` v2 | `scene/resources/packed_scene.h` (format teks `.tscn`) | File → Save Scene (Ctrl+S), Save As, Open (Ctrl+O), tanda `*` di judul | P0 |
| F0.5 | Play mode dengan snapshot & restore | `editor/run`, `scene_tree` change scene | Tombol Play/Pause/Step di tengah toolbar; tint Play mode; scene dikembalikan saat Stop | P0 |

### 4.2 Fase 1 — Gameplay inti (v0.3)

| ID | Fitur | Sumber Godot | Wujud UX Unity | Prioritas |
| --- | --- | --- | --- | --- |
| F1.1 | Prefab (instanced scene) + override + nested prefab | `packed_scene.h`, `instance_placeholder.h`, scene inheritance | Prefab biru di Hierarchy; Overrides dropdown (Apply/Revert); Prefab Mode; Prefab Variant | P0 |
| F1.2 | Signals → Events | `Object::connect`, `emit_signal` di `core/object/object.h` | Field `UnityEvent`-style di Inspector (`+` / `−`, pilih target & fungsi); target bisa method script **atau Custom Event di Blueprint** | P0 |
| F1.3 | Physics 3D | `scene/3d/physics/*` (`rigid_body_3d`, `static_body_3d`, `character_body_3d`, `area_3d`, `ray_cast_3d`, `collision_shape_3d`), `modules/jolt_physics` | Komponen `Rigidbody`, `Box/Sphere/Capsule/Mesh Collider`, `Is Trigger`, `Character Controller`; `Physics.raycast()`; Project Settings → Physics (Layer Collision Matrix) | P0 |
| F1.4 | Input Map | `core/input/input_map.h`, `input_event.h` | Window → Input Actions (daftar action + binding, tombol "Listen") | P0 |
| F1.5 | Groups → Tags & Layers | `Node::add_to_group`, `SceneTree::get_nodes_in_group` | Field Tags (multi-pilih) & dropdown Layer di header Inspector; Project Settings → Tags and Layers | P0 |
| F1.6 | Autoload → Persistent Services | Project Settings → Autoload | Project Settings → Services: daftar script/prefab yang hidup lintas scene | P1 |
| F1.7 | Custom Resource → Data Asset | `core/io/resource.h`, `.tres` | Project window → Create → (tipe data asset); Inspector untuk aset | P1 |
| F1.8 | Timer & Tween | `scene/main/timer.h`, `scene/animation/tween.h` | Komponen `Timer` dengan event `OnTimeout`; API `Tween.to(...)` | P1 |
| F1.9 | Scene switching | `SceneTree::change_scene_to_file` | `SceneManager.load('Level2')`; Build Settings → Scenes In Build | P1 |

### 4.3 Fase 2 — Produksi (v0.4, ringkasan)

| ID | Fitur | Sumber Godot | Wujud UX Unity |
| --- | --- | --- | --- |
| F2.1 | AnimationPlayer (track properti apa pun) | `scene/animation/animation_player.h`, `scene/resources/animation.h` | Window → Animation: dopesheet, curves, tombol Record |
| F2.2 | AnimationTree blend space | `animation_blend_space_1d/2d.h`, `animation_node_state_machine.h` | Blend Tree di Animator Editor yang sudah ada |
| F2.3 | Navigation | `modules/navigation_3d`, `servers/navigation_3d` | Komponen `NavMesh Surface` (tombol Bake), `NavMesh Agent` |
| F2.4 | Audio bus | `servers/audio`, `editor/audio` | Window → Audio Mixer (group, effect, snapshot) |
| F2.5 | Export preset | `editor/export` | File → Build Profiles (Windows/macOS/Linux/Web) |
| F2.6 | Debugger & profiler | `editor/debugger`, `servers/debugger` | Window → Profiler; Hierarchy live saat Play |
| F2.7 | 2D dasar: sprite, kamera 2D, sorting | `scene/2d/sprite_2d.h`, `animated_sprite_2d.h`, `camera_2d.h`, `parallax_2d.h` | Mode 2D di Scene view (tombol "2D"), komponen `Sprite Renderer` (Sorting Layer, Order in Layer), `Camera` ortografik |
| F2.8 | Physics 2D | `scene/2d/physics`, `modules/godot_physics_2d` | `Rigidbody 2D`, `Box/Circle/Capsule/Polygon Collider 2D`, `Physics2D.raycast()` (Rapier 2D) |
| F2.9 | Tilemap 2D | `modules/tilemap` | Window → Tile Palette (brush, eraser, fill), komponen `Tilemap` + `Tilemap Collider 2D` |

### 4.4 Fase 3 — Ekosistem (ringkasan)

GridMap 3D (`modules/gridmap`) → brush 3D di Tile Palette. UI Control + Theme (`scene/gui`) → Canvas/RectTransform + Theme asset. Particles → Particle System modular. Editor plugin (`editor/plugins`) → Package Manager. CSG (`modules/csg`) → ProBuilder-like shapes.

## 5. Prinsip UX Unity yang wajib diikuti

| Area | Aturan |
| --- | --- |
| Layout default | Hierarchy kiri, Scene/Game view tengah, Inspector kanan, Project + Console bawah. Tab bisa di-dock ulang (Fase 2). |
| Istilah | GameObject, Component, Prefab, Inspector, Hierarchy, Project, Scene, Play mode. **Tidak** memakai Node, Dock, FileSystem, Autoload, Group. |
| Shortcut | Q Hand, W Move, E Rotate, R Scale, T Rect, F Frame Selected, Ctrl+D Duplicate, Del Delete, Ctrl+Z/Ctrl+Y, Ctrl+S, Ctrl+N, Ctrl+O, Ctrl+P Play, Ctrl+Shift+P Pause, Ctrl+Alt+P Step. Cmd di macOS. |
| Inspector | Header GameObject: checkbox active, nama, dropdown Tag & Layer, Static. Tiap komponen: foldout, checkbox enabled, ikon, menu `⋮` (Reset, Remove Component, Copy/Paste Values, Move Up/Down). Tombol `Add Component` lebar penuh di bawah. |
| Prefab | Ikon & teks biru di Hierarchy; nilai yang di-override **tebal** dengan garis biru di kiri; panah `>` untuk masuk Prefab Mode. |
| Play mode | Seluruh editor diberi tint (default `#3a3a5a` 20%); perubahan di Play mode hilang saat Stop, kecuali komponen di-"Copy Component" lalu "Paste Values". |
| Konflik shortcut saat ini | Ctrl+B dipakai Build and Run **dan** Blueprint Editor; Ctrl+Shift+S dipakai Save As **dan** Sequencer. Window shortcut dipindah ke Ctrl+1…Ctrl+9 (seperti Unity). |

## 6. Metrik keberhasilan

| Metrik | Target Fase 1 | Cara ukur |
| --- | --- | --- |
| Tugas "platformer mini" (lihat TEST_CASES §E2E-01) oleh pengguna Unity baru | ≤ 20 menit tanpa membaca dokumentasi | Uji pengguna, 5 orang |
| Operasi editor yang bisa di-undo | 100% dari daftar di SPEC §5.3 | Test otomatis |
| Round-trip save → open | 0 perbedaan pada 50 scene fixture | Test otomatis |
| FPS editor dengan 1.000 GameObject primitif | ≥ 50 FPS di MacBook Air M1 | Benchmark |
| Physics: 500 rigidbody berjatuhan | ≥ 60 FPS simulasi, tanpa objek tembus lantai | Benchmark |

## 7. Rilis dan ketergantungan

| Fase | Isi | Prasyarat |
| --- | --- | --- |
| v0.2 (Fase 0) | F0.1–F0.5 | Fix blank editor (`docs/SPEC_FIX_BLANK_EDITOR.md`), New Scene, Open Scene |
| v0.3 (Fase 1) | F1.1–F1.9 | Fase 0 selesai; Rapier 3D terpasang |
| v0.4 (Fase 2) | F2.1–F2.9 | Asset pipeline glTF dan import tekstur/sprite (ROADMAP Phase 2) |

## 8. Risiko

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| Migrasi editor ke ECS mematahkan fitur yang sudah ada (Blueprint, Animator, dll.) | Tinggi | Bridge bertahap (SPEC §4); editor graph tetap independen; test regresi |
| Physics WASM menambah ukuran bundle | Sedang | Lazy-load modul physics saat scene pertama kali memakai Rigidbody |
| Override prefab rumit (nested, variant) | Tinggi | Fase 1 hanya 1 level variant; nested prefab tanpa variant-of-variant |
| Pengguna Godot bingung dengan istilah Unity | Rendah | Halaman docs "Dari Godot ke Linden" berisi tabel padanan istilah |
| Lisensi | Rendah | Godot MIT: kode yang diporting menyertakan copyright notice di `THIRD_PARTY_NOTICES.md` |

## 9. Keputusan

Diputuskan 23 Okt 2026.

| Topik | Keputusan | Dampak |
| --- | --- | --- |
| Library physics | **Rapier** (`@dimforge/rapier3d-compat`; `@dimforge/rapier2d-compat` untuk 2D di Fase 2) | SPEC §10.1 |
| Tag | **Banyak tag per objek**, seperti group Godot. UI tetap di header Inspector ala Unity, berupa field multi-pilih | SPEC §11.2, TC-F15-06..08 |
| Target event | **Graph Blueprint boleh jadi target event**, lewat node baru *Custom Event* | SPEC §8.3, TC-F12-09..11 |
| 2D | **Masuk Fase 2** (F2.7–F2.9), bukan Fase 3 | §4.3, SPEC §12 |
