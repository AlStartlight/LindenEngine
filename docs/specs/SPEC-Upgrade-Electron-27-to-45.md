# Spec: Upgrade Electron 27 → 45 dan electron-builder 24 → 26

Oct 24, 2026 · @accept

## Ringkasan

Linden Engine berjalan di **Electron 27.3.11**, yang membawa **Node 18.17.1** dan Chromium 118. Electron 27 terakhir dirilis 16 Apr 2024 dan sudah lama di luar dukungan. Node 18 sendiri EOL sejak 30 Apr 2025. Artinya semua user aplikasi desktop menjalankan runtime yang tidak lagi menerima patch keamanan, terlepas dari versi Node di mesin developer.

Spec ini meng-upgrade ke **Electron 45** (Node 24.22.0, Chromium 156) dan **electron-builder 26**, sehingga runtime aplikasi sama dengan Node dev (`.nvmrc` = 24.22.1) dan sisa temuan `npm audit` untuk `electron` / `electron-builder` hilang.

## Kondisi saat ini

| Item | Nilai |
| --- | --- |
| `electron` | 27.3.11 (devDependency `^27.0.0`) |
| Node di dalam Electron | 18.17.1 (dicek dengan `ELECTRON_RUN_AS_NODE=1 electron -e "process.versions"`) |
| `electron-builder` | 24.13.3 (`^24.6.4`) |
| Node dev / CI | 24.22.1 via `.nvmrc` |
| `npm audit` | 13 temuan; `electron` (high) dan `electron-builder` (high, termasuk `tar` critical) butuh upgrade major |

## Pilihan versi

Electron mendukung tiga major stabil terakhir. Per 24 Okt 2026:

| Electron | Rilis terbaru | Node | Chromium | Status |
| --- | --- | --- | --- | --- |
| 45 | 45.0.0 (21 Okt 2026) | 24.22.0 | 156 | Didukung, paling baru |
| 44 | 44.9.3 (21 Okt 2026) | 24.22.0 | 152 | Didukung |
| 43 | 43.8.3 (21 Okt 2026) | 24.22.0 | 150 | Didukung, keluar paling dulu |
| 27 | 27.3.11 (16 Apr 2024) | 18.17.1 | 118 | Tidak didukung |

**Keputusan:** target `electron@^45`, karena didukung paling lama. Jika ada blocker di 45.0.x (baru 3 hari), pakai `electron@^44.9.3` sementara dan naik ke 45 setelah 45.1.

## Lingkup perubahan

### 1. Dependency

```json
"electron": "^45.0.0",
"electron-builder": "^26.18.0"
```

Lalu `npm install`, commit `package-lock.json`.

### 2. Kode Electron yang perlu dicek

Hasil audit kode saat ini (`electron/main.ts`, `electron/preload.ts`):

| Area | Kondisi | Tindakan |
| --- | --- | --- |
| `webPreferences` | `contextIsolation: true`, `nodeIntegration: false`, `sandbox` tidak diset (default `true`) | Tetap. Tambahkan `sandbox: true` eksplisit agar jelas |
| Preload | Hanya `require('electron')`; `contextBridge` + `ipcRenderer.invoke/on` | Kompatibel dengan preload tersandbox. Jangan import `shared/` di preload saat runtime (hanya tipe) |
| `File.path` di renderer | Tidak dipakai | Tidak ada. Jika nanti butuh drag file dari OS, pakai `webUtils.getPathForFile` |
| `require('os')` dan `child_process` di main | Dipakai di handler `system:getInfo` dan export Godot | Tetap jalan di main process |
| `dialog`, `Menu`, `shell` | API standar | Uji manual (bagian Test plan) |
| ESM | Main dan preload dikompilasi ke CommonJS `.cjs` | Tetap CJS. Migrasi ESM di luar lingkup |

Sebelum merge, baca [Electron Breaking Changes](https://www.electronjs.org/docs/latest/breaking-changes) untuk 28 sampai 45 dan centang setiap item yang menyentuh API di tabel atas.

### 3. electron-builder 26

- Cek konfigurasi `build` di `package.json` (target `nsis`/`msi`, `dmg`/`zip`, `AppImage`/`deb`) tetap valid.
- Hook `afterSign: scripts/adhoc-sign.cjs` harus tetap dipanggil dan menandatangani `.app` (cek output `codesign -dv`).
- Pastikan field `files` masih menyertakan `dist-electron/**/*`, termasuk `dist-electron/shared/`.

### 4. Minimum OS

Chromium 156 menaikkan versi OS minimum dibanding Chromium 118. Catat minimum macOS, Windows, dan Linux untuk Electron 45 dari release notes resmi, dan tulis di `README.md` bagian instalasi.

### 5. CI

`.github/workflows/build-electron.yml` sudah memakai `node-version-file: .nvmrc`. Pastikan matrix macOS, Windows, Linux menghasilkan artefak dengan Electron 45.

## Acceptance criteria

- [ ] `ELECTRON_RUN_AS_NODE=1 npx electron -e "console.log(process.versions.electron, process.versions.node)"` mencetak `45.x` dan `24.x`.
- [ ] `npm audit` tidak lagi melaporkan `electron`, `electron-builder`, `tar`, `app-builder-lib`, atau `extract-zip`.
- [ ] `npm run type-check`, `npx vitest run`, `npm run build`, `npm run build:electron` lulus.
- [ ] `npm run electron-dev` membuka editor; New Project, Open Project, Open Recent, Save Scene, dan Export (Godot) berjalan.
- [ ] Menu native (File, Edit, View, Help) dan semua shortcut berfungsi di macOS dan Windows.
- [ ] `npm run dist:mac` menghasilkan `.dmg` yang bisa dibuka, editor tampil (tidak blank, lihat `docs/SPEC_FIX_BLANK_EDITOR.md`), dan `.app` ter-sign ad-hoc.
- [ ] CI hijau di ketiga OS.

## Test plan

1. **Otomatis:** type-check, vitest, build web, build electron.
2. **Dev manual:** `npm run electron-dev`, lalu jalankan skenario acceptance untuk project, scene, Bridge, dan Export.
3. **Packaged manual:** `npm run dist:mac` (dan Windows/Linux lewat CI), install, buka, ulangi skenario.
4. **Keamanan:** di DevTools renderer, pastikan `typeof require === 'undefined'` dan `process` tidak tersedia (sandbox aktif).

## Risiko

| Risiko | Mitigasi |
| --- | --- |
| Breaking change di API yang tidak tercakup test | Checklist breaking changes 28–45 + uji manual menu dan dialog |
| electron-builder 26 mengubah output atau signing | Bandingkan artefak 0.1.2 vs baru; cek `codesign -dv` |
| Electron 45.0.0 masih baru | Fallback ke `^44.9.3` |
| Minimum OS naik, sebagian user lama tidak bisa install | Catat di README dan release notes |

## Pertanyaan terbuka

- [ ] Rilis sebagai 0.2.0 karena minimum OS berubah?
- [ ] Aktifkan auto-update (`electron-updater`) sekalian, agar patch Electron berikutnya sampai ke user tanpa install manual?
