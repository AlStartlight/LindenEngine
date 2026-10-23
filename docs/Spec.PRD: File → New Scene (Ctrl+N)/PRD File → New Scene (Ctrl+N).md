# PRD: File → New Scene (Ctrl+N)

Oct 23, 2026 · @accept

## Ringkasan dan latar belakang

File → New Scene dan Ctrl+N (Cmd+N di macOS) harus mengosongkan scene aktif dan memulai scene baru berisi objek default. Saat ini menu dan shortcut sudah tampil, tetapi keduanya tidak melakukan apa-apa.

Kondisi di kode saat ini:

- **Menu web editor** (`editor/ui/Toolbar.tsx`): item `New Scene` dirender lewat `<MenuItem label="New Scene" shortcut="Ctrl+N" />` tanpa `onClick`. Klik tidak berefek, dan dropdown File tidak tertutup.
- **Shortcut di renderer**: belum ada listener `keydown` untuk Ctrl+N. Listener yang ada hanya di `SceneViewport`, `MaterialEditor`, `AnimatorEditor`, dan `SequencerEditor`.
- **Menu native Electron** (`electron/main.ts`): sudah punya `accelerator: 'CmdOrCtrl+N'` yang mengirim IPC `menu:newScene`. `electron/preload.ts` sudah mengekspos `window.electronAPI.onMenuNewScene`, tetapi belum ada kode React yang berlangganan ke event itu.

Akibatnya, pengguna yang ingin memulai level baru harus menghapus objek satu per satu atau me-restart aplikasi.

## Tujuan dan non-tujuan

**Tujuan**

1. Klik File → New Scene di menu web editor membuat scene baru.
2. Ctrl+N (Windows/Linux) dan Cmd+N (macOS) melakukan hal yang sama, baik lewat menu native Electron maupun saat fokus ada di editor.
3. Scene baru langsung bisa dipakai: kamera kembali ke posisi awal, lighting default ada, dan seleksi, Inspector, serta Hierarchy ikut ter-reset.
4. Perubahan yang belum disimpan tidak hilang tanpa konfirmasi.

**Non-tujuan**

- Open Scene, Save Scene, dan Save Scene As. Fitur ini hanya menyiapkan status "dirty" yang nanti dipakai Save.
- Mengelola banyak scene sekaligus (tab scene) atau template scene.
- Mereset state Blueprint, Material, Animator, dan Sequencer editor.
- Memindahkan scene ke ECS `World` di `engine/ecs`. Fitur ini memakai scene Three.js yang ada di `SceneViewport`.

## User stories

| ID | Sebagai | Saya ingin | Supaya |
| --- | --- | --- | --- |
| US-1 | Level designer | klik File → New Scene | bisa mulai level baru tanpa menghapus objek satu per satu |
| US-2 | Pengguna keyboard | menekan Ctrl+N / Cmd+N | membuat scene baru tanpa membuka menu |
| US-3 | Pengguna yang sudah mengedit scene | diberi peringatan sebelum scene diganti | pekerjaan tidak hilang karena salah tekan |
| US-4 | Pengguna yang sedang di Play mode | Play mode berhenti dulu sebelum scene baru dibuat | scene baru tidak mewarisi state runtime |

## Kebutuhan fungsional

| ID | Kebutuhan | Prioritas |
| --- | --- | --- |
| FR-1 | Item File → New Scene di `Toolbar` memanggil aksi `newScene` dan menutup dropdown File. | P0 |
| FR-2 | Ctrl+N (Win/Linux) dan Cmd+N (macOS) memanggil `newScene` di window editor. Default browser untuk kombinasi ini dicegah dengan `preventDefault()`. | P0 |
| FR-3 | Di Electron, event IPC `menu:newScene` dari menu native memanggil `newScene` yang sama lewat `window.electronAPI.onMenuNewScene`. | P0 |
| FR-4 | Satu kali tekan Ctrl+N hanya membuat satu scene baru, walaupun menu native dan listener renderer sama-sama aktif. | P0 |
| FR-5 | Semua objek buatan pengguna dan objek sampel dihapus dari scene. Geometry dan material-nya di-`dispose()`. | P0 |
| FR-6 | Scene baru berisi isi default: grid, axes helper, ground plane, ambient + directional + hemisphere light. Tidak ada primitif sampel. | P0 |
| FR-7 | Kamera kembali ke posisi (10, 10, 10) dengan target orbit (0, 0, 0). TransformControls dilepas dari objek. | P0 |
| FR-8 | Seleksi kosong, Inspector menampilkan state kosong, dan Hierarchy hanya menampilkan objek di scene baru. | P0 |
| FR-9 | Jika scene dalam status dirty, tampilkan dialog konfirmasi sebelum mengganti scene. | P0 |
| FR-10 | Jika Play mode aktif, hentikan Play mode sebelum scene diganti. | P1 |
| FR-11 | Console mencatat `New scene created` setelah berhasil. | P1 |
| FR-12 | Nama scene aktif menjadi `Untitled` dan tampil di toolbar, menggantikan teks statis `Linden Engine`. | P2 |

## Desain teknis

Pendekatan yang disarankan: `EditorLayout` memegang aksi `newScene`, lalu me-remount `SceneViewport` lewat prop `key`. Kode inisialisasi dan cleanup di `SceneViewport` sudah membuat scene dari nol dan sudah me-`dispose()` renderer, geometry, dan material. Jadi remount memakai ulang jalur yang sudah ada, bukan menulis logika hapus-objek kedua.

**Perubahan per file**

| File | Perubahan |
| --- | --- |
| `editor/EditorLayout.tsx` | State baru `sceneKey`, `isSceneDirty`, `showNewSceneConfirm`. Fungsi `newScene()` (cek dirty → dialog) dan `createNewScene()` (stop Play, kosongkan seleksi, `sceneKey + 1`, reset dirty, log Console). Pasang listener shortcut dan langganan IPC di `useEffect`. |
| `editor/ui/Toolbar.tsx` | Prop baru `onNewScene`. Item New Scene memanggilnya lalu `setShowFileMenu(false)`, mengikuti pola item di menu Window. |
| `editor/viewport/SceneViewport.tsx` | Prop `includeSampleObjects` (default `true` agar startup tetap sama) untuk melewati `addSampleObjects` pada scene baru. Callback `onSceneModified` dipanggil saat `TransformControls` mengubah objek dan saat objek dihapus. Callback `onObjectsChange` mengirim daftar objek ke Hierarchy. Canvas dibuat oleh effect init dan dihapus di cleanup setelah `renderer.dispose()` + `renderer.forceContextLoss()`, agar remount tidak menumpuk konteks WebGL. Jangan memanggil `forceContextLoss()` pada canvas yang dirender lewat JSX: StrictMode/React Refresh memakai ulang elemen itu dan mount berikutnya crash (lihat `docs/SPEC_FIX_BLANK_EDITOR.md`). |
| `editor/panels/HierarchyPanel.tsx` | Ganti data statis `sampleHierarchy` dengan prop `items` dari `EditorLayout`. |
| `editor/ui/ConfirmDialog.tsx` (baru) | Modal konfirmasi generik dengan tombol utama dan Batal. Esc = Batal, Enter = tombol utama. |
| `electron/preload.ts` | `onMenuNewScene` mengembalikan fungsi unsubscribe (`ipcRenderer.removeListener`). Tanpa ini, `React.StrictMode` di `src/App.tsx` memasang listener dua kali dan satu klik menu membuat dua scene. |

**Shortcut tanpa dobel**

- Di Electron (`window.electronAPI` ada): andalkan accelerator `CmdOrCtrl+N` di menu native, yang sudah mengirim `menu:newScene`. Listener `keydown` di renderer tidak menangani Ctrl+N.
- Di browser (`npm run dev`): listener `keydown` di `EditorLayout` menangani `(ctrlKey || metaKey) && key === 'n'` tanpa Shift/Alt, lalu `preventDefault()`.

**Status dirty**

Scene dianggap dirty setelah objek dipindah, diputar, diskalakan, atau dihapus di viewport. Scene baru dan scene awal saat aplikasi dibuka dianggap bersih. Begitu Save Scene ada, Save juga mereset status ini.

## Edge case dan risiko

| Kasus | Perilaku yang diharapkan / mitigasi |
| --- | --- |
| Ctrl+N ditekan saat dialog konfirmasi sudah terbuka | Abaikan. Tidak membuka dialog kedua. |
| Ctrl+N ditekan berkali-kali dengan cepat di scene bersih | Setiap tekanan membuat satu scene baru. Tidak ada crash atau konteks WebGL yang bocor. |
| Tab aktif bukan Scene (mis. Blueprint Editor) | New Scene tetap mereset scene. Tab aktif tidak berpindah. |
| Fokus di kolom teks (Inspector, pencarian Hierarchy) | Ctrl+N tetap memicu New Scene, sama dengan accelerator native Electron yang aktif di mana pun fokusnya. |
| Mode web di Chrome | Chrome mencadangkan Ctrl+N untuk jendela baru, jadi `preventDefault()` tidak berlaku. Di mode web hanya klik menu yang dijamin berfungsi. Target utama fitur ini adalah Electron. |
| Listener IPC terpasang ganda | Risiko nyata karena `React.StrictMode` memasang efek dua kali di development. Mitigasi: unsubscribe di `preload.ts` (lihat Desain teknis). |
| Konteks WebGL menumpuk setelah banyak remount | Browser membatasi jumlah konteks aktif (biasanya 16). Mitigasi: canvas baru per mount + `forceContextLoss()` di cleanup (lihat `docs/SPEC_FIX_BLANK_EDITOR.md`). Verifikasi dengan 20 kali New Scene berturut-turut. |
| Undo setelah New Scene | Riwayat undo scene dikosongkan. New Scene sendiri tidak bisa di-undo; itulah gunanya dialog konfirmasi. |

## Kriteria penerimaan dan pengujian

Fitur dianggap selesai jika semua poin ini lolos di `npm run electron-dev` (Windows dan macOS), dan poin bertanda (web) juga lolos di `npm run dev`.

- [ ] Buka editor, klik File → New Scene: lima primitif sampel hilang, lighting dan grid tetap ada, dropdown File tertutup. (web)
- [ ] Ctrl+N di Windows dan Cmd+N di macOS menghasilkan hal yang sama.
- [ ] Pindahkan Cube, lalu Ctrl+N: dialog konfirmasi muncul. Batal = Cube tetap di posisi barunya. Buang perubahan = scene baru. (web)
- [ ] Di scene yang belum diubah, New Scene langsung jalan tanpa dialog. (web)
- [ ] Setelah New Scene: Hierarchy hanya berisi objek default, Inspector kosong, kamera di (10, 10, 10). (web)
- [ ] Saat Play aktif, New Scene menghentikan Play mode dan tombol kembali ke ▶ Play. (web)
- [ ] Console menampilkan `New scene created`. (web)
- [ ] Satu klik menu native = tepat satu baris `New scene created` di Console.
- [ ] 20 kali New Scene berturut-turut: tidak ada warning `Too many active WebGL contexts` di DevTools, FPS tetap stabil.
- [ ] `npm run type-check` dan `npm run build` lolos.

## Pertanyaan terbuka

- [ ] Apakah ground plane termasuk isi default scene baru, atau scene baru hanya berisi lighting dan grid? yes
- [ ] Apakah scene saat aplikasi dibuka tetap berisi lima primitif sampel, atau ikut kosong seperti scene baru? tidak
- [ ] Begitu Save Scene ada, apakah dialog mendapat tombol ketiga "Simpan lalu buat baru"?
- [ ] Shortcut di menu web bentrok: Ctrl+Shift+S dipakai Save Scene As dan Sequencer Editor, Ctrl+B dipakai Build and Run dan Blueprint Editor. Perlu diselesaikan di tiket terpisah? ya
