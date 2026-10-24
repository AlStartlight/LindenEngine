# Spec: Bridge Rename, UX Overhaul & Multi-Platform Build

Oct 24, 2026 · @accept

## 1. Ringkasan dan tujuan

Tab "Godot Bridge" diganti nama menjadi **Bridge**, editor mendapat konsep **Project** (File → New Project / Open Project), dan build dipindah ke dialog **Export** ala Godot yang mendukung banyak platform. Usulan target rilis: v0.2.0 (lihat pertanyaan terbuka).

**Tujuan**

1. Semua teks UI "Godot Bridge" menjadi "Bridge"; Godot tetap disebut sebagai salah satu *target* di dalam Bridge, bukan nama fiturnya.
2. Menu File punya **New Project…** dan **Open Project…**, plus **Open Recent** — baik di menu native Electron maupun menu web di `Toolbar.tsx`.
3. Saat aplikasi dibuka tanpa project, tampil **Project Manager** (layar sambutan) seperti Godot, bukan langsung editor kosong.
4. **Project → Export…** membuka dialog preset per platform (Windows, macOS, Linux, Web, Android, iOS) dengan validasi dan log yang jelas.
5. Panel Bridge disusun ulang menjadi langkah-langkah yang jelas: Hubungkan → Sinkronkan → Ekspor.

**Non-tujuan**

- Menulis runtime/player Linden native baru untuk Android/iOS (mobile tetap lewat backend Godot di v0.2).
- Mengganti nama modul internal `engine/godot/*` atau addon `godot-addon/linden_bridge` (lihat bagian 3).
- Asset import pipeline, version control, atau template project online.

## 2. Kondisi saat ini

Editor belum punya konsep project di disk, dan satu-satunya build yang benar-benar jalan adalah ekspor Godot headless dari dalam panel Godot Bridge.

| Area | Lokasi | Kondisi |
| --- | --- | --- |
| Tab "🤖 Godot Bridge" | `editor/EditorLayout.tsx:474` | Tab ke-6 di bar panel tengah, `activeEditorPanel === 'godot'` |
| Judul panel | `editor/panels/GodotPanel.tsx:117` | Header "Godot Bridge" + badge v0.2 |
| Pesan error build | `engine/godot/build/GodotBuildRunner.ts:127` | "…configure the executable path in Godot Bridge settings" |
| Menu File native | `electron/main.ts:71-120` | New/Open/Save Scene, Save As, Build Project (Ctrl+B), Exit |
| Menu File web | `editor/ui/Toolbar.tsx:59-110` | New/Open/Save Scene, Save As, Project Settings |
| Build Project | IPC `build:export` di `electron/main.ts` | Stub: hanya log, mengembalikan `outputPath: ''` |
| Build Godot | IPC `godot:build` | Jalan: `godot --headless --export-release <preset>` |
| Pilihan platform | `GodotPanel.tsx` (select) | Web, Android, iOS, Windows Desktop, macOS, Linux/X11 |
| Project settings | `editor/store/editorStore.ts:12` | Hanya di memori (Zustand); `project.linden.json` di root repo tidak dibaca editor |
| Deteksi Godot | `electron/main.ts` dan `GodotBuildRunner.ts` | Logika yang sama diduplikasi di dua tempat |

Masalah UX yang terlihat:

- Path project Godot dan executable diketik manual sebagai teks, tanpa tombol Browse.
- Status hanya satu baris teks; error build tidak menunjukkan langkah perbaikan.
- Fitur build tersembunyi di dalam tab panel, padahal menu File → Build Project tidak melakukan apa-apa.
- Emoji dipakai sebagai ikon di tab dan tombol, sehingga tampilan berbeda antar OS.

## 3. Rename "Godot Bridge" → "Bridge"

Rename hanya menyentuh teks yang dilihat pengguna dan nama panel di store; kelas dan folder internal Godot tetap, karena memang khusus Godot dan sudah dipakai test.

| Item | Sebelum | Sesudah |
| --- | --- | --- |
| Label tab (`EditorLayout.tsx`) | 🤖 Godot Bridge | Bridge (ikon SVG, bukan emoji) |
| Judul panel (`GodotPanel.tsx`) | Godot Bridge | Bridge, subjudul "Sinkron dan ekspor ke engine lain" |
| Nilai panel (`editorStore.ts`) | `'godot'` | `'bridge'` |
| Komponen | `GodotPanel.tsx` | `BridgePanel.tsx` (file baru; `GodotPanel` jadi bagian "Target: Godot" di dalamnya) |
| Pesan error (`GodotBuildRunner.ts:127`) | …in Godot Bridge settings | …in Bridge → Godot settings |
| Menu Window (baru) | — | Window → Bridge |
| Komentar `CompatReport.ts`, nama describe di `tests/godot/unit.test.ts` | Godot Bridge | Bridge (Godot) |

**Tetap (tidak diubah):** `engine/godot/GodotBridge.ts`, `GodotBridgeConfig`, `GodotBuildRunner`, IPC `godot:detect` / `godot:build`, addon `godot-addon/linden_bridge`.

**Kompatibilitas:** jika ada state tersimpan dengan `activeEditorPanel: 'godot'`, migrasikan ke `'bridge'` saat load store. Saat ini store tidak dipersist, jadi cukup satu baris pemetaan sebagai pengaman.

Di dalam Bridge, Godot dan Unity tampil sebagai **target**. Panel ini juga menjadi tempat Transmuter (`TransmuterWizard.tsx`), sehingga semua interop engine ada di satu tempat.

## 4. Menu File: New Project dan Open Project

Project = satu folder berisi `project.linden.json`; New Project membuat folder itu, Open Project memuatnya, dan semua path scene/aset relatif terhadap folder tersebut.

**Struktur menu File baru** (native `electron/main.ts` dan web `Toolbar.tsx` harus identik):

| Item | Shortcut (Win/Linux · macOS) | Aksi |
| --- | --- | --- |
| New Project… | Ctrl+Shift+N · Cmd+Shift+N | Dialog New Project |
| Open Project… | Ctrl+Shift+O · Cmd+Shift+O | Pilih folder / `project.linden.json` |
| Open Recent ▸ | — | 10 project terakhir + "Clear Recent" |
| — |  |  |
| New Scene | Ctrl+N · Cmd+N | Tetap (lihat PRD New Scene) |
| Open Scene… | Ctrl+O · Cmd+O | Tetap; dialog default ke folder project |
| Save Scene / Save Scene As… | Ctrl+S / Ctrl+Shift+S | Tetap |
| — |  |  |
| Project Settings… | — | Tetap |
| Export… | Ctrl+Shift+E · Cmd+Shift+E | Dialog Export (bagian 6); menggantikan "Build Project" |
| Close Project | — | Kembali ke Project Manager |
| Exit / Quit | Ctrl+Q · Cmd+Q | Tetap |

**New Project…**

1. Dialog modal berisi: Nama project, Lokasi (field + tombol Browse, default `~/Documents/Linden Projects`), Template (Empty 3D, Empty 2D), Renderer (WebGPU, WebGL fallback).
2. Tombol Create nonaktif sampai nama valid; path akhir ditampilkan langsung di bawah field ("Akan dibuat di: …/MyGame").
3. Error inline: folder sudah ada dan tidak kosong, tidak punya izin tulis, nama mengandung karakter tidak sah.
4. Create menulis `project.linden.json` (skema yang sama dengan file contoh di root repo), folder `scenes/`, `assets/`, dan `scenes/Main.lscene`, lalu membuka project itu.

**Open Project…**

1. Dialog native pilih folder (atau file `project.linden.json`).
2. Validasi: file ada, JSON valid, versi didukung. Gagal → pesan jelas, project aktif tidak berubah.
3. Sukses → muat settings ke `editorStore.projectSettings`, buka scene pertama di `scenesInBuild`, tambahkan ke Recent.

**Perubahan belum disimpan:** New/Open/Close Project memakai dialog konfirmasi yang sama dengan New Scene (`ConfirmDialog.tsx`): Save, Don't Save, Cancel.

**Teknis:** IPC baru `project:create`, `project:open`, `project:recent:list`, `project:recent:clear` di `electron/main.ts`; event menu `menu:newProject`, `menu:openProject`, `menu:closeProject`, `menu:export`; recent disimpan di `userData/recent-projects.json`; judul jendela menjadi `<Nama Project> — Linden Engine`.

## 5. UI/UX yang lebih ramah pengguna

Prinsipnya: pengguna selalu tahu sedang di project apa, langkah berikutnya apa, dan cara memperbaiki error — tanpa mengetik path manual.

**5.1 Project Manager (layar awal)**

- Tampil saat aplikasi dibuka tanpa project, atau setelah Close Project.
- Kiri: tombol besar New Project dan Open Project. Kanan: daftar Recent (nama, path, waktu terakhir dibuka), bisa dicari, klik dua kali untuk membuka.
- Project di Recent yang foldernya hilang tampil abu-abu dengan aksi "Hapus dari daftar".
- Opsi "Buka project terakhir saat start" (default mati).

**5.2 Panel Bridge**

Panel disusun sebagai tiga kartu bernomor; kartu berikutnya baru aktif setelah kartu sebelumnya siap.

1. **Hubungkan** — pilih target (Godot; Unity via Transmuter). Path project dan executable memakai tombol Browse + Auto-detect. Status: ✓ Ditemukan Godot 4.x di … / ⚠ Tidak ditemukan + tautan "Unduh Godot".
2. **Sinkronkan** — Export .tscn, Import, dan toggle Live Sync dengan indikator port dan jumlah perubahan terakhir.
3. **Ekspor** — tombol "Buka Dialog Export…" (bagian 6), bukan dropdown preset di dalam panel.

Compatibility Report dan Build Output dipindah ke panel bawah (tab "Output" di samping Console), sehingga panel Bridge tidak memanjang.

**5.3 Pola umum**

- Ikon: ganti emoji di tab dan tombol dengan satu set ikon SVG yang konsisten.
- Setiap error menampilkan: apa yang gagal, penyebab yang terdeteksi, dan satu tombol aksi (Browse, Coba lagi, Buka log).
- Toast singkat untuk aksi sukses (Project dibuat, Export selesai + "Tampilkan di Finder/Explorer").
- Status bar bawah: nama project, scene aktif, status sinkron Bridge, status build terakhir.
- Shortcut ditampilkan di menu dan memakai Cmd di macOS, Ctrl di Windows/Linux.
- Semua dialog bisa ditutup dengan Esc dan dikonfirmasi dengan Enter; fokus awal pada field pertama.

## 6. Build dan Export multi-platform (ala Godot)

Export memakai **preset per platform** yang disimpan di project, persis model `export_presets.cfg` di Godot; tiap preset dijalankan oleh salah satu dari dua backend.

**6.1 Backend**

- **Linden native** — build runtime player Linden (Vite bundle) berisi scene di `scenesInBuild`. Untuk Web dihasilkan folder statis; untuk desktop bundle itu dibungkus Electron lewat `electron-builder`.
- **Godot** — project diekspor ke `.tscn` lewat Bridge, lalu `godot --headless --export-release <preset>` (IPC `godot:build` yang sudah ada). Dipakai untuk Android dan iOS, dan opsional untuk platform lain.

&#91;embedded content: alur export · 1 preset, 2 backend\]

ExportRunner adalah komponen baru; backend Godot memakai ulang Bridge dan IPC `godot:build` yang sudah ada.

**6.2 Matriks platform**

| Platform | Backend default | Output | Syarat di mesin build |
| --- | --- | --- | --- |
| Windows (x64, arm64) | Linden native | `.exe` portable / NSIS installer | Build dari macOS/Linux butuh Wine untuk NSIS; zip portable tanpa Wine |
| macOS (Universal) | Linden native | `.app` dalam `.dmg` / `.zip` | Hanya dari macOS; ad-hoc sign (`scripts/adhoc-sign.cjs`) atau Developer ID |
| Linux (x64) | Linden native | AppImage / `.deb` | Semua OS host |
| Web | Linden native | Folder `index.html` + aset (WebGPU, fallback WebGL) | Semua OS host |
| Android | Godot | `.apk` / `.aab` | Godot 4.3+, export templates, Android SDK, keystore |
| iOS | Godot | Project Xcode | macOS + Xcode, Godot export templates |

**6.3 Dialog Export (Project → Export…)**

- Kiri: daftar preset + tombol Add… (pilih platform). Kanan: tab **Options** (nama app, versi, ikon, arsitektur, path output, Debug/Release), **Resources** (scene yang diikutkan, default `scenesInBuild`), **Features** (WebGPU wajib/opsional).
- Setiap preset menampilkan checklist kesiapan: ✓ Godot ditemukan, ✗ Export templates belum terpasang → tombol "Pasang…", ✗ Keystore belum diatur → "Atur…".
- Tombol bawah: **Export Project…** (preset terpilih), **Export All** (semua preset yang valid), **Export PCK/Data only** (hanya bundle scene).
- Progress per tahap (Validasi → Bundle → Package → Sign) dengan log streaming di tab Output; selesai → toast + "Tampilkan di Finder/Explorer".

**6.4 Penyimpanan preset**

Preset ditambahkan ke `project.linden.json` di kunci baru `exportPresets`:

```json
"exportPresets": [
  { "name": "Windows Desktop", "platform": "windows", "backend": "linden", "arch": ["x64"], "output": "build/windows/MyGame.exe", "mode": "release" },
  { "name": "Android", "platform": "android", "backend": "godot", "output": "build/android/MyGame.apk", "mode": "debug" }
]
```

**6.5 Teknis**

- Ganti stub `build:export` di `electron/main.ts` dengan `ExportRunner` yang memilih backend per preset dan men-stream log lewat event `export:log` / `export:progress`.
- Satukan deteksi Godot: `electron/main.ts` memanggil `GodotBuildRunner.findGodotExecutable` alih-alih menyalin logikanya.
- Mode headless CLI untuk CI: `linden --export "<preset>" <project-dir>` (setara `godot --export-release`).

## 7. Rencana implementasi, acceptance criteria, risiko

Dikerjakan dalam empat PR berurutan agar tiap PR bisa direview dan dirilis sendiri.

1. **PR 1 — Rename Bridge** (kecil): label, store `'bridge'`, `BridgePanel.tsx`, pesan error, test describe.
2. **PR 2 — Project system**: IPC `project:*`, New/Open/Close Project, Open Recent, Project Manager, judul jendela, load/save `project.linden.json`.
3. **PR 3 — Export dialog + backend Godot**: preset di `project.linden.json`, dialog Export, `ExportRunner` memakai `godot:build`, tab Output, hapus dropdown build di panel.
4. **PR 4 — Backend Linden native**: entry runtime player, bundle Web, paket desktop via `electron-builder`, CLI `--export`.

**Acceptance criteria**

- [ ] Tidak ada teks "Godot Bridge" yang terlihat di UI; `grep -rn "Godot Bridge" editor electron` kosong.
- [ ] Tab dan menu Window menampilkan "Bridge"; fitur Export/Import/Live Sync Godot tetap jalan (`tests/godot/unit.test.ts` hijau).
- [ ] File → New Project… membuat folder dengan `project.linden.json`, `scenes/Main.lscene`, `assets/`, lalu membukanya.
- [ ] File → Open Project… memuat settings dan scene pertama; JSON rusak menampilkan error dan tidak mengubah project aktif.
- [ ] Open Recent menyimpan maksimal 10 entri dan bertahan setelah aplikasi ditutup.
- [ ] Menu native dan menu web punya item dan shortcut yang sama, Cmd di macOS.
- [ ] Perubahan belum disimpan memicu dialog Save / Don't Save / Cancel sebelum ganti project.
- [ ] Dialog Export bisa menambah preset untuk 6 platform dan menyimpannya ke `project.linden.json`.
- [ ] Export Web dan desktop host (mis. macOS di Mac) menghasilkan build yang bisa dijalankan.
- [ ] Export Android tanpa Godot/templates menampilkan checklist yang menyebut apa yang kurang dan tombol perbaikan.

**Risiko**

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| Belum ada runtime player Linden terpisah dari editor | PR 4 paling besar dan bisa molor | Rilis PR 1–3 dulu; desktop/web sementara bisa lewat backend Godot |
| Cross-compile Windows/macOS terbatas oleh OS host | Export Windows dari Mac butuh Wine; macOS hanya dari Mac | Checklist kesiapan menjelaskan; CI matrix di `.github/workflows/build-electron.yml` |
| Shortcut baru bentrok dengan shortcut viewport | Aksi ganda | Audit shortcut di `EditorLayout.tsx` sebelum PR 2 |
| Path absolut lama di settings | Project tidak portabel | Simpan semua path relatif ke folder project |

**Pertanyaan terbuka**

- [ ] Target rilis: v0.2.0 atau dipecah per PR (0.1.3, 0.1.4, …)? ya
- [ ] Apakah Unity ikut tampil sebagai target di Bridge sekarang, atau Godot saja dulu? ya
- [ ] Format desktop default: installer (NSIS/DMG) atau portable zip? ya semua seperti yang telah ada
- [ ] Perlu template project tambahan (2D platformer, 3D FPS) di New Project? ya
