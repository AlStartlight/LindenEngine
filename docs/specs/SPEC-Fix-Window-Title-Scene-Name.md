# Spec: Judul jendela tidak menampilkan nama scene setelah New Scene + Save

Oct 24, 2026 · @accept

## Ringkasan

Setelah membuka project, membuat scene baru, memberinya nama **Isac**, lalu menyimpannya, judul jendela tetap:

```
MyGame — Untitled — Linden Engine
```

Seharusnya:

```
MyGame — Scene: Isac — Linden Engine
```

Ada dua penyebab. Pertama, nama scene di store tidak pernah diperbarui saat scene diberi nama atau disimpan. Kedua, format judul belum memuat label `Scene:`.

## Langkah reproduksi

1. Jalankan `npm run electron-dev`.
2. File → Open Project… → pilih project **MyGame**.
3. File → New Scene (Ctrl/Cmd+N).
4. File → Save Scene (Ctrl/Cmd+S), beri nama file **Isac** di dialog simpan, klik Save.
5. **Hasil:** judul `MyGame — Untitled — Linden Engine`. Label scene di Toolbar dan status bar juga `Untitled`.
6. **Harapan:** judul `MyGame — Scene: Isac — Linden Engine`, Toolbar dan status bar `Isac`.

## Akar masalah

| # | Lokasi | Masalah |
| --- | --- | --- |
| 1 | `editor/store/editorStore.ts` `newScene()` | Selalu menyetel `sceneName: 'Untitled'`. New Scene tidak meminta nama. |
| 2 | `editor/store/editorStore.ts` `saveScene(path)` | Hanya memperbarui `isDirty` dan `currentScenePath`; `sceneName` tidak diturunkan dari nama file yang dipilih user. |
| 3 | `editor/EditorLayout.tsx` `handleSaveScene` | Scene diserialisasi **sebelum** dialog simpan dibuka (`SceneSerializer.serialize(world, sceneName)`), jadi isi file `Isac.lscene` tetap berisi `"name": "Untitled"`. Membuka file itu lagi akan menampilkan `Untitled`. |
| 4 | `editor/EditorLayout.tsx:166-167` | Format judul `${projectName} — ${sceneName}${dirty} — Linden Engine` tidak punya label `Scene:`. |
| 5 | `editor/EditorLayout.tsx:203` | Default path dialog simpan adalah `Untitled.lscene` relatif, bukan folder `scenes/` di project, sehingga dialog terbuka di folder Documents. |

## Keputusan desain

- **Sumber nama scene = nama file** (tanpa `.lscene`), sama seperti Godot. Field `name` di dalam file disinkronkan ke nama file setiap kali disimpan.
- Scene baru yang belum pernah disimpan memakai nama yang diketik user di dialog New Scene. Nama ini menjadi nama file default saat Save pertama.
- Format judul:

  | Kondisi | Judul |
  | --- | --- |
  | Project terbuka, scene tersimpan | `MyGame — Scene: Isac — Linden Engine` |
  | Ada perubahan belum disimpan | `MyGame — Scene: Isac * — Linden Engine` |
  | Scene baru belum pernah disimpan | `MyGame — Scene: Isac (unsaved) — Linden Engine` |
  | Tanpa project (Project Manager) | `Linden Engine` |

## Solusi

### 1. Fungsi format judul yang bisa dites

File baru `editor/ui/windowTitle.ts`:

```ts
export function formatWindowTitle(opts: {
  projectName: string | null
  sceneName: string | null
  isDirty: boolean
  isSaved: boolean
}): string {
  if (!opts.projectName) return 'Linden Engine'
  const parts = [opts.projectName]
  if (opts.sceneName) {
    const suffix = opts.isDirty ? ' *' : !opts.isSaved ? ' (unsaved)' : ''
    parts.push(`Scene: ${opts.sceneName}${suffix}`)
  }
  parts.push('Linden Engine')
  return parts.join(' — ')
}
```

`EditorLayout.tsx` memanggil fungsi ini di efek judul, dengan `isSaved = currentScenePath !== null`. Dependensi efek ditambah `currentScenePath` dan `isProjectOpen`.

### 2. New Scene meminta nama

- `handleNewScene` (setelah konfirmasi perubahan belum disimpan) membuka dialog **New Scene** dengan field Nama (default `NewScene`, fokus otomatis, Enter = Create, Esc = Cancel).
- Validasi: tidak kosong, maksimal 64 karakter, tanpa `/ \ : * ? " < > |`. Jika `scenes/<nama>.lscene` sudah ada di project, tampilkan peringatan "Nama sudah dipakai" dan nonaktifkan Create.
- Store: `newScene(name: string)` menyetel `sceneName: name`, `currentScenePath: null`, `isDirty: false`.

### 3. Save Scene menyinkronkan nama

Pisahkan dialog dan penulisan file agar konten diserialisasi **setelah** nama final diketahui:

| IPC baru | Input | Output |
| --- | --- | --- |
| `scene:pickSavePath` | `{ defaultPath }` | `{ status: 'ok', path } \| { status: 'canceled' }` |
| `scene:write` | `{ path, content }` | `{ status: 'ok' } \| { status: 'error', message }` |

Alur `handleSaveScene(isSaveAs)`:

1. Jika ada `currentScenePath` dan bukan Save As → `path = currentScenePath`.
2. Jika tidak → `pickSavePath({ defaultPath: <projectPath>/scenes/<sceneName>.lscene })`. Batal → selesai tanpa perubahan.
3. `finalName = basename(path, '.lscene')`.
4. `content = SceneSerializer.serialize(world, finalName)`.
5. `scene:write({ path, content })`.
6. Store: `saveScene(path, finalName)` menyetel `sceneName: finalName`, `currentScenePath: path`, `isDirty: false`, dan `commandStack.markSaved()`.

`scene:save` lama dipertahankan sementara untuk kompatibilitas, ditandai deprecated. Kedua channel baru ditambahkan ke `shared/ipcChannels.ts` dan `electron/preload.ts`.

### 4. Open Scene

`openScene(json, path)` menyetel `sceneName` dari nama file (`basename(path, '.lscene')`). Field `name` di dalam file hanya dipakai jika path tidak ada (mode browser).

### 5. Konsistensi label

Toolbar (`editor/ui/Toolbar.tsx:383`) dan status bar (`EditorLayout.tsx:851`) memakai `sceneName` yang sama, dengan penanda `*` atau `(unsaved)` yang sama seperti judul.

## File yang diubah

| File | Perubahan |
| --- | --- |
| `editor/ui/windowTitle.ts` | Baru: `formatWindowTitle` |
| `editor/EditorLayout.tsx` | Efek judul memakai `formatWindowTitle`; `handleNewScene` membuka dialog nama; `handleSaveScene` memakai alur baru |
| `editor/windows/NewSceneDialog.tsx` | Baru: dialog nama scene |
| `editor/store/editorStore.ts` | `newScene(name)`, `saveScene(path, name)`, `openScene` menurunkan nama dari path |
| `editor/io/sceneIO.ts` | `pickSceneSavePath`, `writeSceneFile` |
| `electron/main.ts`, `electron/preload.ts`, `shared/ipcChannels.ts` | IPC `scene:pickSavePath`, `scene:write` |
| `tests/scene/windowTitle.test.ts`, `tests/scene/saveSceneName.test.ts` | Baru |

## Acceptance criteria

- [ ] Skenario reproduksi (Open Project MyGame → New Scene "Isac" → Save) menghasilkan judul `MyGame — Scene: Isac — Linden Engine`.
- [ ] Sebelum disimpan, judul `MyGame — Scene: Isac (unsaved) — Linden Engine`.
- [ ] Setelah menambah objek, judul `MyGame — Scene: Isac * — Linden Engine`; setelah Save, `*` hilang.
- [ ] File `scenes/Isac.lscene` berisi `"name": "Isac"`.
- [ ] Save As dengan nama `Level2` mengubah judul ke `Scene: Level2` dan menulis `"name": "Level2"`.
- [ ] Open Scene `Isac.lscene` menampilkan `Scene: Isac` walau field `name` di file berbeda.
- [ ] Dialog simpan pertama kali terbuka di `<project>/scenes/` dengan nama `<sceneName>.lscene`.
- [ ] Batal di dialog simpan tidak mengubah judul, nama, atau status dirty.
- [ ] Toolbar, status bar, dan judul jendela selalu menampilkan nama yang sama.
- [ ] Judul native Electron (`mainWindow.setTitle`) dan `document.title` sama.

## Test plan

1. **Unit `formatWindowTitle`:** semua baris tabel keputusan desain, termasuk tanpa project.
2. **Unit store:** `newScene('Isac')` → `sceneName === 'Isac'`; `saveScene('/p/scenes/Level2.lscene', 'Level2')` → `sceneName === 'Level2'`, `isDirty === false`.
3. **Unit save flow:** dengan `electronAPI` di-mock, `handleSaveScene` memserialisasi dengan nama dari path yang dipilih (bukan nama lama).
4. **Manual Electron:** jalankan langkah reproduksi dan semua acceptance criteria di macOS dan Windows.

## Pertanyaan terbuka

- [ ] Pemisah judul: pakai ` — ` (em dash, seperti sekarang) atau `--` persis seperti di laporan bug? Spec ini memakai em dash.
- [ ] Apakah rename scene juga perlu tersedia dari Hierarchy atau panel Project (klik kanan → Rename), yang sekaligus mengganti nama file?
