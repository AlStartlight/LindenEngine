# Spec: Fix cursor hilang setelah klik padahal setting "Selalu tampil"

Nov 11, 2026 · @accept · branch `feat/game-cursor-settings`

## Ringkasan

Di Project Settings → **Cursor (Mouse)** mode diset **Selalu tampil**, tetapi saat Play cursor hilang begitu game diklik, dan baru muncul lagi setelah menekan **Esc**. Gejala "hilang setelah klik, kembali dengan Esc" adalah ciri **pointer lock**: game mengunci cursor padahal mode `visible` seharusnya tidak pernah mengunci.

Spec ini menjelaskan akar masalah yang sudah terbukti, perbaikannya, dan pengaman supaya mode `visible`/`hidden` tidak bisa terkunci lagi dari jalur mana pun.

## Gejala

1. Buka project Dizzle (`~/Documents/Linden Projects/Dizzle`). Project ini punya action `Look` yang di-bind ke `Mouse/Delta`.
2. Project Settings → Cursor (Mouse) → Mode: **Selalu tampil**.
3. Play, lalu klik di dalam game.
4. Cursor hilang. Mouse menggerakkan kamera (mouse look). Esc mengembalikan cursor.

## Akar masalah

### A1. Play di editor tidak mengirim setting cursor ke game (terbukti, sudah diperbaiki)

Play di editor menjalankan game di iframe Game Frame. Saat game mengirim `linden:ready`, `editor/viewport/GameFrame.tsx` membalas `linden:init` berisi `projectConfig` yang **disusun manual**: `name`, `collisionMatrix`, `renderer`, `quality`, `input`, `tags`, `layers`. Field `cursor` tidak ikut.

Di game, `player/player.ts` (`initInputs`) membaca `this.projectData?.cursor`, yang nilainya `undefined`. `normalizeCursorSettings(undefined)` mengembalikan mode **`auto`**. Di mode `auto`, `shouldLockPointer` mengunci cursor saat klik bila ada action ber-binding `Mouse/Delta`. Dizzle punya `Look` → `Mouse/Delta`, jadi cursor terkunci.

Web export tidak kena masalah ini karena `electron/build/WebBuildRunner.ts` menyalin seluruh `project.linden.json` (`...projectConfig`) ke `project.json`.

**Status:** sudah diperbaiki di working tree (belum di-commit). `GameFrame.tsx` sekarang mengirim `cursor: normalizeCursorSettings(projectSettings.cursor)`.

### A2. File project Dizzle tersimpan `locked` (terbukti, data)

`Dizzle/project.linden.json` (diubah 15:17:54) berisi:

```json
"cursor": { "mode": "locked", "style": "pointer", "hotspot": [0, 0] }
```

Jadi setelah A1 diperbaiki pun, Dizzle akan tetap mengunci cursor sampai mode di-set ulang ke **Selalu tampil**. Belum diketahui apakah dropdown di UI saat itu menampilkan "Selalu tampil" (UI dan file tidak sinkron) atau memang "Dikunci (FPS)" terpilih. Lihat **Pertanyaan terbuka 1**.

### A3. Setting cursor tidak berlaku untuk sesi Play yang sedang berjalan (desain)

`initInputs()` hanya dipanggil sekali saat game start. Mengubah mode di Project Settings saat Play sedang berjalan tidak berpengaruh sampai Stop → Play. Ini wajar, tetapi dari sisi user terlihat seperti "setting sudah tampil tapi tetap hilang".

### A4. Tidak ada pengaman bila cursor terkunci di mode `visible`/`hidden` (celah)

Saat ini satu-satunya `requestPointerLock` ada di `player/player.ts:371`, dan hanya dipasang bila `shouldLockPointer` true. Tetapi script game punya akses ke `document`/`canvas` dan bisa memanggil `requestPointerLock()` sendiri. Tidak ada yang melepasnya kembali saat mode `visible`/`hidden`.

## Tujuan

1. Mode **Selalu tampil** dan **Disembunyikan**: klik di game **tidak pernah** mengunci cursor, baik di Play editor, Game Frame, maupun web export.
2. Mode **Dikunci (FPS)**: klik mengunci, Esc melepas (perilaku browser), Shift+F1 mengembalikan fokus ke editor (sudah ada di `player/frameChannel.ts`).
3. Mode **Auto**: tetap sama dengan perilaku lama (kunci hanya bila ada `Mouse/Delta`), supaya project lama tidak berubah.
4. Mengubah setting cursor saat Play berjalan langsung berlaku tanpa Stop/Play.
5. Project Settings selalu menampilkan nilai yang benar-benar tersimpan di `project.linden.json`.

**Non-tujuan**

- Mouse look tanpa pointer lock (mis. drag dengan klik kanan) di mode `visible`. Di mode ini `Mouse/Delta` selalu 0; kamera Dizzle yang memakai `Look` tidak akan berputar dengan mouse. Itu fitur terpisah (lihat **Lanjutan**).
- API script untuk mengubah cursor saat runtime (`ctx.cursor`). Dicatat sebagai lanjutan.

## Solusi

### S1. Kirim `cursor` lewat `linden:init` (A1), sudah dikerjakan

`editor/viewport/GameFrame.tsx`:

```ts
projectConfig: {
  ...
  quality: projectSettings.quality ?? 'medium',
  cursor: normalizeCursorSettings(projectSettings.cursor),
  input: { ... },
}
```

Supaya field baru tidak tertinggal lagi, tambahkan test yang memastikan setiap field yang dibaca player dari `projectData` (`quality`, `renderer`, `input`, `cursor`) ada di payload `linden:init`. Caranya: ekstrak penyusun payload ke fungsi murni `buildPlayProjectConfig(state, touchOverrides)` di `editor/viewport/playProjectConfig.ts`, lalu uji fungsinya.

### S2. Terapkan ulang cursor saat setting berubah selama Play (A3)

- Tambah pesan editor → game `linden:cursor` di `shared/playProtocol.ts` dengan payload `CursorSettings` (divalidasi dengan `normalizeCursorSettings` di `parseEditorToGame`).
- `GameFrame.tsx` berlangganan `projectSettings.cursor` di store; bila berubah dan sesi Play aktif, kirim `linden:cursor`.
- `LindenPlayer` memindahkan logika cursor ke method `applyCursor(settings)`:
  - set `canvas.style.cursor = cursorCss(...)`;
  - simpan settings di field `this.cursor`; listener klik yang dipasang **sekali** memanggil `requestPointerLock` hanya bila `shouldLockPointer(this.cursor, usesMouseLook)`;
  - bila mode baru tidak boleh mengunci dan `document.pointerLockElement === canvas`, panggil `document.exitPointerLock()`.

### S3. Pengaman: lepas lock yang tidak diizinkan (A4)

Di `LindenPlayer`, dengarkan `pointerlockchange`. Bila cursor terkunci padahal `shouldLockPointer(this.cursor, …)` false (mode `visible`/`hidden`, atau `auto` tanpa mouse look), langsung `document.exitPointerLock()` dan kirim satu peringatan ke Console editor:

> `Cursor diset "Selalu tampil" di Project Settings, pointer lock dari script dilepas.`

Peringatan dikirim sekali per sesi supaya Console tidak banjir.

### S4. UI menampilkan nilai tersimpan (A2, tujuan 5)

- Setelah `saveCursorSettings` sukses, store sudah memegang nilai yang dinormalisasi. Tambahkan pembacaan ulang `project.linden.json` saat jendela Project Settings dibuka (atau saat `window` focus), sehingga perubahan dari luar editor (agent, edit manual) ikut tampil.
- Bila `saveCursorSettings` mengembalikan `error` atau `memory-only`, tampilkan statusnya di bawah dropdown (sudah ada untuk `error`; tambahkan untuk `memory-only`: "Belum tersimpan, project belum dibuka").

### S5. Langkah user untuk Dizzle (tanpa perubahan kode)

Project Settings → Cursor (Mouse) → **Selalu tampil** → Stop → Play.

## Kriteria lulus

| # | Skenario | Hasil yang diharapkan |
|---|---|---|
| K1 | Dizzle, mode Selalu tampil, Play, klik game | Cursor tetap terlihat; `document.pointerLockElement` null |
| K2 | Sama dengan K1, tetapi script memanggil `canvas.requestPointerLock()` | Lock langsung dilepas, cursor terlihat, 1 peringatan di Console |
| K3 | Mode Dikunci (FPS), klik | Cursor terkunci; Esc melepas; Shift+F1 mengembalikan fokus ke editor |
| K4 | Mode Auto, project dengan `Mouse/Delta` | Klik mengunci (perilaku lama) |
| K5 | Mode Auto, project tanpa `Mouse/Delta` | Klik tidak mengunci |
| K6 | Play berjalan di mode Dikunci, cursor terkunci, ubah ke Selalu tampil di Project Settings | Lock dilepas tanpa Stop/Play; klik berikutnya tidak mengunci |
| K7 | Web export dengan mode Selalu tampil | Sama dengan K1 |
| K8 | Mode Disembunyikan | Cursor tidak terlihat di atas canvas, tidak terkunci, terlihat lagi di luar canvas |

## Test

- **Unit** (`tests/player/cursorSettings.test.ts`, sudah ada 10 test): tambah kasus `buildPlayProjectConfig` menyertakan `cursor` (S1) dan `parseEditorToGame` untuk `linden:cursor` (S2).
- **Unit player:** uji `applyCursor` dan handler `pointerlockchange` dengan DOM tiruan (jsdom/happy-dom): `exitPointerLock` dipanggil di mode `visible`, tidak dipanggil di `locked`.
- **E2E** (`tests/e2e/playViewport.e2e.mjs`): jalankan Play di Electron, klik canvas, baca `document.pointerLockElement` di iframe untuk K1, K3 dan K6. Catatan: Chrome yang dikendalikan Playwright di luar Electron menolak pointer lock di semua mode (terlihat saat uji 11 Nov), jadi K1/K3/K6 harus diuji di Electron atau manual.
- **Manual:** K1–K8 di Dizzle dan satu project FPS (`SmallFPSArena`).

## Rencana implementasi

1. Commit S1 (sudah ada di working tree) bersama fitur Cursor settings.
2. S3 (pengaman `pointerlockchange`). Perubahan kecil dan menutup K2.
3. S2 (`linden:cursor` + `applyCursor`). Menutup K6.
4. S4 (sinkron UI dengan file).
5. Test unit + e2e, lalu verifikasi manual K1–K8.

## Status implementasi (11 Nov 2026)

S1–S4 dikerjakan, belum di-commit:

- S1: `editor/viewport/playProjectConfig.ts` (`buildPlayProjectConfig`), dipakai `GameFrame.tsx`.
- S2: pesan `linden:cursor` di `shared/playProtocol.ts`; `GameFrame.tsx` mengirimnya saat `projectSettings.cursor` berubah; `player/main.ts` → `LindenPlayer.setCursor`.
- S2/S3: logika cursor dipindah ke `player/cursorController.ts` (`CursorController`: bentuk, kunci saat klik, pengaman `pointerlockchange` dengan satu peringatan per sesi).
- S4: IPC `project:readCursor`; tab Cursor membaca ulang file saat dibuka dan saat window focus, menampilkan status `memory-only`, dan memperingatkan bila mode `visible`/`hidden` dipakai di project yang punya `Mouse/Delta`.

Hasil test:

- Unit: `tests/player/cursorController.test.ts` (11) + `tests/player/cursorSettings.test.ts` (10); seluruh suite 815/815.
- E2E Electron: `npm run test:e2e:cursor` (`tests/e2e/gameCursor.e2e.mjs`), 8/8 lulus: K1, K2, K3 (klik mengunci), K6, penyimpanan ke file. K4/K5/K8 tercakup unit test; K7 (web export) dan Esc/Shift+F1 belum diuji otomatis.

Catatan: action bawaan project baru (`engine/input/defaultInput.ts`) sudah berisi `Look` → `Mouse/Delta`, jadi mode **Auto** mengunci cursor di hampir semua project.

## Risiko & keterbatasan

- **Mouse look mati di mode `visible`.** Game seperti Dizzle yang memakai `Look` → `Mouse/Delta` tidak bisa memutar kamera dengan mouse. Editor sebaiknya menampilkan peringatan di tab Cursor bila mode `visible`/`hidden` dipilih dan project punya action ber-binding `Mouse/Delta`.
- **S3 bisa mematahkan script yang sengaja mengunci cursor** (mis. hanya saat aiming). Untuk kasus itu user harus memakai mode Auto/Dikunci, atau menunggu API `ctx.cursor` (lanjutan).
- Browser membatasi `requestPointerLock` ke gesture user dan bisa menolak lock ulang dalam ±1 detik setelah Esc; perilaku ini di luar kendali engine.

## Pertanyaan terbuka

1. Saat bug terjadi, apakah dropdown Mode menampilkan "Selalu tampil" sementara file berisi `locked`? Bila ya, ada bug sinkronisasi UI ↔ file yang belum ditemukan dan perlu direproduksi sebelum S4.
2. Apakah mode `visible` perlu fallback mouse look (drag klik kanan menghasilkan `Mouse/Delta`)? Bila ya, buat spec terpisah.

## Lanjutan

- `ctx.cursor.set({ mode, style })` di scripting API untuk game yang berganti mode (menu → gameplay).
- Fallback mouse look tanpa pointer lock untuk mode `visible`.
