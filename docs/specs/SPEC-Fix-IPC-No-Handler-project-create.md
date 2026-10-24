# Spec: Fix "No handler registered for 'project:create'" saat New Project

Oct 24, 2026 · @accept

## Ringkasan

Klik **Create** di dialog New Project menampilkan error:

```
Error invoking remote method 'project:create': Error: No handler registered for 'project:create'
```

Kode handler-nya **sudah benar dan sudah ada**. Error muncul karena proses Electron *main* yang sedang berjalan adalah versi lama (sebelum handler `project:*` ditambahkan), sedangkan *preload* dan renderer sudah versi baru. Spec ini memperbaiki alur dev agar main process selalu ikut ter-restart, dan membuat editor menampilkan pesan yang jelas bila versi main dan renderer tidak cocok.

## Gejala

1. Jalankan `npm run electron-dev`.
2. Tambahkan/ubah `ipcMain.handle(...)` di `electron/main.ts` (contoh: handler `project:create`), lalu reload jendela (Cmd+R / F5) atau biarkan Vite melakukan full reload.
3. Buka Project Manager → New Project → isi nama → Create.
4. Muncul error di atas. Open Project, Recent, dan Export menunjukkan error serupa (`project:open`, `project:recent:list`, `export:run`).

## Akar masalah

Bukti dari mesin dev (24 Okt 2026):

| Item | Waktu |
| --- | --- |
| Proses `Electron .` (PID 2445) mulai | 15:44:06 |
| `electron/preload.ts` terakhir diubah | 16:08:14 |
| `electron/main.ts` terakhir diubah (handler `project:*`) | 16:09:26 |
| `dist-electron/main.cjs` & `preload.cjs` dibuild ulang | 16:13:31 |

- `dist-electron/main.cjs` **berisi** `ipcMain.handle('project:create', …)` (`electron/main.ts:507`). Tidak ada exception di top-level sebelum baris itu.
- Main process hanya membaca `main.cjs` **sekali** saat start. Script `electron-dev` menjalankan `build:electron` satu kali lalu `electron .`; tidak ada watch/restart untuk folder `electron/`.
- Preload (`preload.cjs`) dibaca ulang **setiap kali jendela di-load**. Setelah reload, renderer melihat `window.electronAPI.createProject` (preload baru), sehingga guard di `editor/project/projectIO.ts:147` lolos dan `ipcRenderer.invoke('project:create')` dikirim ke main lama yang belum punya handler.

Jadi: preload baru + main lama = channel ada di sisi renderer, tidak ada di sisi main.

## Tujuan

1. Mengubah file di `electron/` saat dev otomatis membuild ulang dan me-restart Electron, sehingga main dan preload selalu satu versi.
2. Bila tetap terjadi mismatch (dev atau build rusak), user melihat pesan yang bisa ditindaklanjuti, bukan error IPC mentah.
3. Mismatch terdeteksi saat editor start, bukan baru saat user klik Create.

**Non-tujuan**

- Mengubah logika `project:create` / `project:open` (sudah benar).
- Mengganti `tsc` dengan bundler lain untuk `electron/`.
- Fallback "web mode" di `createNewProject` (lihat Pertanyaan terbuka).

## Solusi

### 1. Perbaikan langsung (tanpa perubahan kode)

Hentikan `npm run electron-dev` (Ctrl+C) lalu jalankan lagi. Main process baru akan memuat semua handler `project:*`.

### 2. Dev workflow: restart Electron saat `electron/` berubah

Tambahkan devDependency `nodemon` dan ubah script di `package.json`:

```json
"electron:watch": "nodemon --watch electron --watch shared --ext ts --delay 300ms --exec \"npm run build:electron && electron .\"",
"electron-dev": "concurrently -k \"npm run dev\" \"wait-on http://127.0.0.1:5173 && npm run electron:watch\""
```

- `--watch shared` karena tipe IPC bersama ada di `shared/`.
- `build:electron` sudah menjalankan `tsc` + `rename:electron`, jadi output `.cjs` tetap konsisten.
- Perubahan renderer (`editor/`, `src/`) tetap lewat Vite HMR, tidak me-restart Electron.
- `concurrently -k` mematikan semua proses bila salah satu berhenti.

### 3. Satu sumber daftar channel IPC

Buat `shared/ipcChannels.ts`:

```ts
export const IPC_INVOKE_CHANNELS = [
  'app:getVersion', 'app:ipcChannels', 'window:setTitle',
  'project:create', 'project:open', 'project:saveSettings',
  'project:recent:list', 'project:recent:add', 'project:recent:remove', 'project:recent:clear',
  'dialog:showOpenDialog', 'shell:showItemInFolder',
  'export:run', 'godot:detect', 'godot:build',
  // …semua channel ipcMain.handle lainnya
] as const
export type IpcInvokeChannel = (typeof IPC_INVOKE_CHANNELS)[number]
```

- `electron/preload.ts` hanya memanggil `ipcRenderer.invoke` dengan channel bertipe `IpcInvokeChannel`.
- `electron/main.ts` menambah handler `app:ipcChannels` yang mengembalikan daftar channel yang **benar-benar terdaftar** (dikumpulkan lewat wrapper `handle(channel, fn)` yang memanggil `ipcMain.handle` dan mencatat channel ke `Set`).
- Test unit memastikan setiap channel di `IPC_INVOKE_CHANNELS` didaftarkan di `main.ts` (parse source atau import dengan `ipcMain` di-mock).

### 4. Cek kecocokan saat startup

Di renderer (mis. `editor/EditorLayout.tsx` atau `ProjectManagerWindow.tsx`, sekali saat mount):

1. Panggil `electronAPI.getIpcChannels()` → `app:ipcChannels`.
2. Bandingkan dengan `IPC_INVOKE_CHANNELS`.
3. Jika ada yang hilang, atau `app:ipcChannels` sendiri tidak terdaftar: tampilkan banner kuning di atas Project Manager:
   > Editor diperbarui tetapi proses aplikasi masih versi lama. **Restart Linden Engine** untuk melanjutkan.
   dengan tombol **Restart** (`app.relaunch(); app.exit(0)` lewat channel `app:relaunch`, didaftarkan paling awal di `main.ts`) dan log daftar channel yang hilang ke Console panel.

### 5. Pesan error yang ramah di pemanggil IPC

Tambahkan helper di `editor/project/ipc.ts`:

```ts
export async function invokeIpc<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (err: any) {
    const msg = String(err?.message ?? err)
    if (msg.includes('No handler registered for')) {
      throw new Error('Fitur ini belum tersedia di proses aplikasi yang sedang berjalan. Restart Linden Engine lalu coba lagi.')
    }
    throw err
  }
}
```

Pakai di `createNewProject`, `openExistingProject`, fungsi recent, dan export runner. Pesan tampil di field error dialog New Project (`ProjectManagerWindow.tsx:146`) seperti error lain.

## File yang diubah

| File | Perubahan |
| --- | --- |
| `package.json` | Script `electron:watch`, `electron-dev`; devDependency `nodemon` |
| `shared/ipcChannels.ts` | Baru: daftar channel invoke |
| `electron/main.ts` | Wrapper `handle()`, handler `app:ipcChannels` dan `app:relaunch` |
| `electron/preload.ts` | `getIpcChannels`, `relaunchApp`; channel bertipe `IpcInvokeChannel` |
| `editor/project/ipc.ts` | Baru: `invokeIpc` |
| `editor/project/projectIO.ts` | Bungkus semua `electronAPI.*` dengan `invokeIpc` |
| `editor/windows/ProjectManagerWindow.tsx` | Banner mismatch + tombol Restart |
| `tests/project/ipc.test.ts` | Baru: test mapping error dan kelengkapan channel |

## Acceptance criteria

- [ ] Setelah restart `npm run electron-dev`, New Project → Create membuat folder berisi `project.linden.json`, `scenes/Main.lscene`, `assets/` tanpa error.
- [ ] Mengedit `electron/main.ts` saat dev otomatis me-restart Electron dalam < 5 detik; handler baru langsung bisa dipanggil.
- [ ] Mengedit file di `editor/` tidak me-restart Electron (tetap HMR).
- [ ] Bila main lama dan preload baru (simulasi: hapus satu `handle` lalu build ulang tanpa restart), Project Manager menampilkan banner mismatch dan tombol Restart berfungsi.
- [ ] Error "No handler registered" tidak pernah tampil mentah ke user; yang tampil adalah pesan restart.
- [ ] Test unit memastikan setiap channel di `IPC_INVOKE_CHANNELS` punya `ipcMain.handle` di `main.ts`.
- [ ] Build packaged (`npm run dist:mac`) New Project tetap berjalan.

## Test plan

1. **Unit** (`vitest`): `invokeIpc` memetakan error "No handler registered" ke pesan restart dan meneruskan error lain apa adanya.
2. **Unit**: kelengkapan channel `shared/ipcChannels.ts` vs `electron/main.ts`.
3. **Manual dev**: jalankan `electron-dev`, ubah komentar di `main.ts`, pastikan Electron restart; lalu New Project berhasil.
4. **Manual mismatch**: jalankan Electron, tambah channel baru di `IPC_INVOKE_CHANNELS` + preload tanpa restart main, reload jendela → banner muncul.
5. **Packaged**: `npm run dist:mac`, buka app, New Project dan Open Project berhasil.

## Pertanyaan terbuka

- [ ] Fallback web mode di `createNewProject` (`projectIO.ts:176`) mengembalikan `status: 'ok'` dengan path palsu saat editor dibuka di browser biasa (bukan Electron). Apakah lebih baik menampilkan "New Project hanya tersedia di aplikasi desktop"?
- [ ] Pakai `nodemon` atau `electronmon`? `nodemon` dipilih karena sudah umum dan tidak perlu konfigurasi khusus Electron.
