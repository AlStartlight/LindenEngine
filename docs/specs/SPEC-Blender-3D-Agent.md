# SPEC: Opsi "Blender 3D" di panel prompt Linden Agent

Status: **implemented** di `feat/blender-3d-agent` (2026-11-10), M0–M5 selesai. Diverifikasi dengan Blender 5.2.3 (`/Applications/Blender.app`) dan OpenCode 2.1.4. Hasil M0 dan perbedaan dari draft dicatat di bawah.

## M0 answers

| # | Pertanyaan | Jawaban |
|---|---|---|
| 1 | `timeout.execution` MCP dan muat ulang katalog | `mcp.add` (remote) menerima `timeout: {execution}` dan langsung `connected`. `mcp.remove` + `mcp.add` membuat OpenCode memanggil `initialize` + `tools/list` lagi. Setelah status Blender dimatikan, daftar tool Blender tersisa 0 (dicek dengan OpenCode 2.1.4 asli). Nilai default `execution` tidak terdokumentasi di client, jadi Linden menyetel 15 menit secara eksplisit. |
| 2 | Request MCP yang ditahan saat menunggu izin | Belum diuji end-to-end karena butuh model yang benar-benar memanggil tool. Mitigasinya `timeout.execution` 15 menit, ditambah izin otomatis ditolak saat turn berakhir, di-abort, atau server berhenti. |
| 3 | API Blender | `export_scene.gltf(export_format='GLB', export_apply=True, use_selection=True, export_yup=True)`, `--offline-mode`, `-Y`, `--python-exit-code 1` berjalan di Blender 5.2.3. `Material.use_nodes` deprecated sejak 5.0, sehingga hanya di-set di < 5.0. Modifier di-apply lewat `bpy.data.meshes.new_from_object(evaluated)`, tanpa operator, sebelum cutter dihapus. |

## Perbedaan dari draft

- `scale` di spec di-*bake* ke mesh sebelum modifier, sehingga `width` bevel dan `thickness` solidify tetap dalam meter.
- Flatpak dijalankan lewat wrapper `exports/bin/org.blender.Blender`, jadi `prefixArgs` tidak diperlukan.
- Bila `session.prompt` gagal, mode Blender langsung dimatikan lagi.
- `TurnTracker` kini menyembunyikan `<editor-context>`, `<reference-images>` dan `<blender-mode>` di ekor prompt. Ini sekaligus memperbaiki `<reference-images>` yang sebelumnya ikut tampil.
- Batas keras tambahan di runner: 2 juta segitiga. Linden sendiri menolak hasil di atas 300k.

## Tujuan

User mencentang **Blender 3D** di panel prompt agent. Untuk prompt itu agent boleh membuat objek 3D lewat Blender milik user. Blender berjalan sebagai proses terpisah dalam mode background dan mengekspor `.glb`. File itu lalu masuk ke pipeline yang sudah ada: `linden_asset_import`, lalu `linden_model_build {model:{src}}`, lalu `linden_render_preview`.

Kalau checkbox tidak dicentang atau Blender tidak terinstal, perilaku agent dan editor **identik dengan sekarang**.

### Non-goals

- Bundle, link, atau `import bpy` di proses Electron. Begitu juga dependency npm/pip yang terkait Blender.
- Addon user, autoexec, akses jaringan Blender (`--offline-mode`), dan file `.blend` milik user.
- Blender versi < 4.2, Blender dari Microsoft Store, dan Steam.
- Tekstur gambar atau baking di sisi Blender. v1 hanya membuat material PBR polos.
- Animasi atau rig dari Blender.

## Fakta dari kode yang ada

| Area | Temuan | Dampak |
|---|---|---|
| `AgentPanel.tsx` | `includeContext` adalah `useState(true)` yang tidak disimpan. `handleSend` memanggil `sendPrompt(text, context, attachmentPaths)`. | Checkbox baru diletakkan di baris yang sama (div `justify-between`, kiri). |
| `agentStore.sendPrompt` | Mengirim `{sessionId, prompt, mode, context, attachments}` ke `agent:prompt`. Tipe payload `any` di preload dan main. | Tambah tipe `AgentPromptOptions` di `shared/agentTypes.ts`. |
| `AgentHost.submitPrompt` | Menempelkan `<editor-context>` dan `<reference-images>` ke teks prompt, lalu `session.prompt`. | Ini titik sisip paling bersih untuk `<blender-mode>`. |
| `AgentHost.lindenPrompt/ensureInstructions` | System prompt dipasang sekali per sesi lewat `session.instructions.entry.put({key:'linden'})`. | Tidak dipakai untuk Blender karena sifatnya per sesi, bukan per turn. |
| `TurnTracker` | `EDITOR_CONTEXT_RE` hanya menghapus `<editor-context>` di **akhir** teks, jadi `<reference-images>` yang ditempel sesudahnya ikut tampil (bug kecil yang sudah ada). | Regex diganti agar menghapus semua blok injeksi di ekor prompt (`editor-context`, `reference-images`, `blender-mode`). |
| `LINDEN_TOOLS` | Objek konstan saat import, `...(img2threejsEnabled() ? IMG2_TOOLS : {})`. `LindenMcpServer` menampilkan semuanya di `tools/list`. | Deteksi Blender async, jadi gating dipindah ke `tools/list` (lihat Keputusan 3). |
| Tool + izin | `SESSION_PERMISSIONS` meng-allow `linden*` sehingga tool MCP tidak pernah memunculkan PermissionCard. MCP call tidak membawa session id. | `linden_blender_script` butuh alur izin sendiri yang memakai PermissionCard (Keputusan 4). |
| `@opencode/client` | `mcp.add` config remote punya `timeout.execution`. Ada `permission.create` dan `session.instructions.entry.remove`. | Timeout eksekusi MCP harus menutup waktu tunggu izin + 120 dtk Blender. |
| `godotExec.ts` | `bridge-settings.json` di userData (`load/saveBridgeSettings`), `normalizeGodotPath`, `parseGodotVersion`, `validateGodotBinary(runner?)`, `findSystemGodotCandidates`, `resolveGodotExecutable`. | Pola yang ditiru. `saveBridgeSettings` di-merge, jadi key `blenderExecutable` aman. `godotDetect.ts` ternyata deteksi *proyek* Godot, bukan binary. |
| `opencodeBinary.ts` | `loadLoginShellPath`, `mergePath`, `findExecutable`. | Dipakai ulang untuk PATH login shell. |
| `check-licenses.mjs` | Hanya memeriksa closure npm dari `GEOMETRY_ROOTS` dan folder `VENDORED` (yang wajib non-copyleft). | `blender-bridge/` **tidak boleh** masuk `VENDORED`. Ditambah pemeriksaan kecil khusus untuknya (M1). |
| Persistensi renderer | Pola yang ada: `getStorage/setStorage` (localStorage + fallback memori) di `editor/project/projectIO.ts`, dengan key `linden_*`. | Pilihan checkbox disimpan dengan key `linden_agent_blender:<projectPath>`. |
| Packaging | `extraResources` + `resolveAppResource(devRel, packagedRel)`. | `blender-bridge/` ditambahkan ke `extraResources`. |
| Buka panel Bridge | `editorStore.setActiveEditorPanel('bridge')`. | Dipakai untuk link "atur path" di AgentPanel. |
| Mesin ini | `blender` tidak ada di PATH maupun `/Applications`. | Tes e2e akan **skip** di sini. Uji manual butuh Blender terinstal. |

## Keputusan

1. **Isolasi lisensi.** Blender hanya dijalankan lewat `spawn` (tanpa `shell`) dengan argumen array. Komunikasi lewat file JSON dan stdout. Semua Python sisi Blender ada di `blender-bridge/` (`LICENSE` GPL-3.0-or-later + `README.md`). Tidak ada file TS yang meng-import isi folder itu. TS hanya mengetahui path-nya.
2. **Instruksi per turn ditempel ke teks prompt** sebagai blok `<blender-mode>…</blender-mode>` di `submitPrompt`. Alasannya:
   - stateless
   - sudah ada presedennya (`<editor-context>`)
   - tidak ada race put/remove pada instruksi sesi
   - otomatis tidak ada saat flag mati

   Blok ini disembunyikan dari tampilan turn oleh regex TurnTracker yang diperluas.
3. **Gating tool dinamis.** `BLENDER_TOOLS` selalu ada di `LINDEN_TOOLS`, tetapi `ToolDefinition` mendapat field opsional `available?: () => boolean`.
   - `LindenMcpServer` menyaring `tools/list` dan menolak `tools/call` untuk tool yang tidak available.
   - Deteksi Blender dimulai saat app ready. `AgentHost.startServer` menunggu hasilnya (maks 5 dtk) sebelum `mcp.add`.
   - Kalau status Blender berubah (path diatur atau dideteksi ulang) saat agent berjalan, AgentHost mendaftarkan ulang server MCP `linden` (`mcp.remove` + `mcp.add`) agar katalog tool diperbarui.
4. **Izin `linden_blender_script` lewat antrean izin Linden sendiri**, bukan OpenCode.
   - `ToolDefinition.execute` menerima `options.requestPermission(req) => Promise<boolean>`, disediakan AgentHost lewat `LindenMcpServer`.
   - AgentHost membuat `AgentPermissionRequest` dengan id `linden-blender-<uuid>`, `action: 'blender_script'`, dan field baru `code`. Request itu dikirim lewat event `permission_requested` yang sudah ada.
   - `replyPermission` mengecek map lokal dulu sebelum meneruskan ke OpenCode.
   - PermissionCard menampilkan kode **lengkap** (mono, bisa di-scroll, tanpa collapse 3 baris).
   - Izin yang masih menunggu otomatis ditolak saat turn berakhir, di-abort, atau server berhenti.
   - Alasan tidak memakai `permission.create` OpenCode: semantik balasannya (blocking atau tidak, dan event apa) belum terverifikasi, sedangkan alur lokal sepenuhnya di bawah kontrol kita. Ini dicek ulang di M0. Kalau `permission.create` ternyata bersih, boleh dipakai.
5. **Flag per turn** disimpan di modul `electron/agent/blenderMode.ts`, dengan pola seperti `setPreviewRenderer`:
   - `beginBlenderTurn(sessionId)`, `endBlenderTurn(sessionId?)`, `blenderTurnActive(): boolean`
   - di-set di `submitPrompt` saat `useBlender`, dan di-clear di `submitPrompt` saat tidak
   - di-reset pada `turn_ended` sesi itu, `abortPrompt`, dan `stopServer`
6. **Folder kerja di dalam proyek**: `.linden/agent/blender/<jobId>/`. Ini konsisten dengan kebijakan "temp file ke proyek, bukan /tmp" di `spawnServer`.
   - Isinya: `spec.json`, `script.py`, `out.glb`, `log.txt`.
   - Job yang sukses dihapus setelah import. Job yang gagal disimpan, maksimal 5 terakhir, untuk debugging.
7. **Sumbu di spec memakai Blender-native (Z ke atas, meter, derajat).** Exporter glTF (`export_yup=True`, default) mengubahnya ke Y-up Linden. Alasannya: mirror/array/boolean dan bounds tetap natural, tanpa konversi Euler yang rawan salah. `blender.md` menyatakannya dengan jelas: "di spec Z = atas; hasil .glb otomatis Y-up".
8. **Penyimpanan checkbox** memakai `getStorage/setStorage` yang di-export dari `projectIO.ts`, dengan key per proyek. Tidak ada mekanisme baru.

## Arsitektur

```
AgentPanel ☑ Blender 3D ──sendPrompt(…, {useBlender})──► agent:prompt
                                                          │
AgentHost.submitPrompt: text += <blender-mode>blender.md</blender-mode>; beginBlenderTurn(sid)
                                                          │
OpenCode ──MCP──► LindenMcpServer ──► linden_blender_build / _script / _status
                                         │  cek blenderTurnActive() + blenderStatus()
                                         │  (_script: requestPermission → PermissionCard)
                                         ▼
                 spawn(blender, [-b, --factory-startup, -Y, --offline-mode,
                        --python-exit-code, 1, -P, runner.py, --, --spec|--script, --out])
                                         │  cwd=.linden/agent/blender/<job>, timeout 120 dtk
                                         ▼
                 stdout "LINDEN_RESULT:{…}" → importAssetFile() (dipakai juga oleh linden_asset_import)
                                         ▼
                 assets/models/<name>.glb + info inspeksi → agent: model_build → render_preview
turn_ended ──► endBlenderTurn + tolak izin Blender yang masih menunggu
```

## Komponen

### 1. Deteksi: `electron/bridge/blenderExec.ts` + `blenderDetect.ts`

**`blenderExec.ts`** (fungsi murni dan sinkron, bisa dites):

- `parseBlenderVersion(output)` mencari baris `^Blender (\d+)\.(\d+)(?:\.(\d+))?` di **baris mana pun**, karena macOS kadang mencetak warning lebih dulu. Hasilnya `{ok, version?, reason?}`, minimal 4.2. Pesan error:
  - `Blender --version tidak memberikan output`
  - `Format versi Blender tidak dikenali: "…"`
  - `Versi Blender minimal 4.2 diperlukan (terdeteksi: …)`
- `normalizeBlenderPath(input, platform, exists)`:
  - trim, buang slash di akhir
  - macOS: `….app` → `….app/Contents/MacOS/Blender`
  - Windows: kalau input berupa folder `Blender Foundation\Blender X.Y`, tambahkan `blender.exe`

  `platform` dan `exists` di-inject supaya tes lintas OS jalan di CI mana pun.
- `pickHighestWindowsBlender(dirNames)` mengurutkan `Blender 4.2`, `Blender 4.10`, dst. secara numerik.
- `blenderCandidates({platform, env, home, loginPath, readDir})` mengembalikan daftar `{bin, prefixArgs?}` dengan urutan:
  1. `LINDEN_BLENDER`
  2. `bridge-settings.json` `blenderExecutable`
  3. `blender` di PATH login shell (`loadLoginShellPath` + `findExecutable`)
  4. lokasi umum:
     - macOS: `/Applications/Blender.app/...`, `~/Applications/Blender.app/...`
     - Windows: `%ProgramFiles%\Blender Foundation\Blender */blender.exe`, versi tertinggi
     - Linux: `/snap/bin/blender`, `/usr/bin/blender`, `/var/lib/flatpak/exports/bin/org.blender.Blender`, `~/.local/share/flatpak/exports/bin/org.blender.Blender`
- `validateBlenderBinary(cand, runner?)` menjalankan `--version` (async spawn, timeout 15 dtk karena peluncuran pertama di macOS bisa lambat, tanpa shell).
- `blenderSpawnEnv()` memakai env proses tanpa `PYTHONPATH`, `PYTHONHOME`, `PYTHONSTARTUP`, dan `BLENDER_USER_*`. `BLENDER_USER_SCRIPTS` dan `BLENDER_USER_CONFIG` diarahkan ke folder job yang kosong. Ini mencegah addon dan skrip startup user, sebagai lapisan tambahan di atas `--factory-startup`.

**`blenderDetect.ts`** (cache + API untuk IPC):

- `detectBlender({refresh?})` mengembalikan `Promise<BlenderStatus>`. Kandidat pertama yang valid dipakai, lalu `saveBridgeSettings({blenderExecutable, blenderVersion})`.
- `setBlenderPath(input)` melakukan normalize → validate → simpan. Kalau gagal, cache tidak berubah dan alasannya dikembalikan.
- `getBlenderStatus()` mengembalikan nilai cache (sinkron). `onBlenderStatusChange(cb)` dipakai AgentHost untuk registrasi ulang MCP.
- Tipe di `shared/blenderTypes.ts`:

  ```ts
  { found: boolean; path?: string; version?: string;
    source?: 'env'|'settings'|'path'|'common'|'manual'; reason?: string }
  ```

IPC baru (`shared/ipcChannels.ts`, `preload.ts`, `main.ts`):

| Channel | Fungsi |
|---|---|
| `blender:status` | Ambil status dari cache |
| `blender:detect` | Deteksi ulang (refresh) |
| `blender:setPath` | Set path manual |

Untuk "Pilih file…" dipakai `dialog:showOpenDialog` yang sudah ada.

### 2. Runner: `blender-bridge/runner.py` (GPL-3.0-or-later)

Perintah:

```
blender -b --factory-startup -Y --offline-mode --python-exit-code 1 -P runner.py -- --spec spec.json --out out.glb
blender … -P runner.py -- --script script.py --out out.glb
```

Urutan kerja:

1. Parse argumen setelah `--`.
2. Hapus semua objek, mesh, material, dan koleksi bawaan. Set unit ke metrik dengan `scale_length=1`.
3. **Mode spec:**
   - Validasi ulang secara defensif dengan Python murni, tanpa `eval`/`exec`.
   - Buat primitif (`bpy.ops.mesh.primitive_*_add`).
   - Set transform (rotasi derajat → radian).
   - Pasang modifier sesuai urutan.
   - Buat material Principled BSDF (`baseColor`, `metallic`, `roughness`).
   - Shade smooth bila diminta.
   - Jalankan `smart_project` bila `uv: 'smart'`.
   - Apply semua modifier dengan urutan stack. Boolean memakai objek lain yang ditandai `cutter: true`, dan cutter dihapus setelah semua boolean di-apply.
4. **Mode script:** `exec(compile(open(script).read(), script, 'exec'), {'__name__': '__main__'})`, lalu apply modifier seperti mode spec.
5. Jika `ground` (default true), geser semua objek ekspor agar `min z` dunia sama dengan 0.
6. Ekspor:

   ```python
   bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, use_selection=False)
   ```

   Hanya objek mesh yang terlihat yang diekspor.
7. Cetak satu baris `LINDEN_RESULT:{"objects":n,"triangles":n,"bounds":{"min":[…],"max":[…]},"materials":[…],"warnings":[…]}`. Bounds dalam koordinat Blender.
8. Kalau ada error, cetak `LINDEN_ERROR:<pesan>` ke stderr lalu `sys.exit(1)`. `--python-exit-code 1` menangkap exception yang lolos.

`blender-bridge/README.md` menjelaskan lisensi, cara Linden memanggilnya, dan bahwa folder ini tidak pernah di-import oleh kode MIT.

### 3. Tools: `electron/agent/lindenTools/blenderTools.ts`

Skema zod `BlenderSpecSchema` diletakkan di `shared/blenderSpec.ts` agar bisa dites dan dipakai bersama:

```ts
{
  objects: Array<{                       // 1..64
    name: string                         // unik, [A-Za-z0-9_-]{1,48}
    primitive: 'cube'|'uv_sphere'|'cylinder'|'cone'|'torus'|'plane'
    params?: { size?, radius?, radius1?, radius2?, depth?, segments?, rings?,
               vertices?, majorRadius?, minorRadius? }   // angka positif berbatas
    location?: [x,y,z]; rotation?: [x,y,z] /*derajat*/; scale?: [x,y,z]
    modifiers?: Array<
      | { type:'bevel', width, segments?≤8, limit?:'angle'|'none' }
      | { type:'subdivision', levels≤3 }
      | { type:'solidify', thickness }
      | { type:'array', count 2..64, offset:[x,y,z] /*relatif*/ }
      | { type:'mirror', axes:('x'|'y'|'z')[] }
      | { type:'boolean', operation:'difference'|'union'|'intersect', with:<name objek lain> }>
    material?: { baseColor: '#rrggbb' | [r,g,b] /*0..1*/, metallic?:0..1, roughness?:0..1 }
    smooth?: boolean; uv?: 'smart'|'none'; cutter?: boolean
  }>
  ground?: boolean   // default true
  join?: boolean     // gabung semua objek non-cutter jadi satu mesh, default false
}
```

Validasi tambahan (`superRefine`):

- nama unik
- `boolean.with` harus menunjuk objek yang ada dan bukan dirinya sendiri
- minimal satu objek non-cutter
- estimasi beban: subdivision dikali array dibatasi, jadi tidak bisa membuat jutaan poligon

Setelah build, ada batas keras 300k segitiga (dari `LINDEN_RESULT`). Di atas batas itu tool menolak dan GLB tidak diimpor.

Tool:

| Tool | Input | Alur |
|---|---|---|
| `linden_blender_status` | – | `{found, version, path, active: blenderTurnActive()}`. Tidak diblokir flag karena berguna untuk diagnosis. |
| `linden_blender_build` | `{name, spec, target?}` | Cek flag → zod → buat job dir → tulis `spec.json` → `runBlender()` → parse `LINDEN_RESULT` → `importAssetFile(projectPath, out.glb, target ?? assets/models/<slug(name)>.glb)` → `{path, blender: result, ...inspeksi, next: 'linden_model_build {model:{src: path}} lalu linden_render_preview'}`. |
| `linden_blender_script` | `{name, code, target?}` | Cek flag → batasi `code` (≤ 64 KB) → `requestPermission({action:'blender_script', message:'Agent ingin menjalankan Python di Blender', code})` → kalau ditolak: `{success:false, error:'Script Blender ditolak user.'}` → kalau diizinkan: tulis `script.py` → `runBlender()` → import seperti di atas. |

- Saat flag mati, ketiga tool build/script mengembalikan:

  ```ts
  { success: false, error: 'Mode Blender 3D tidak aktif untuk prompt ini. Gunakan linden_model_build.' }
  ```

- **`runBlender(job, args)`** (bisa di-mock lewat `setBlenderSpawn(fn)`):
  - `spawn(bin, [...prefixArgs, ...args], {cwd: jobDir, env: blenderSpawnEnv(), shell: false, windowsHide: true})`
  - timeout 120 dtk lalu `SIGKILL` dengan error `Blender melewati batas waktu 120 detik`
  - stdout dan stderr disimpan di ring buffer, stderr dipotong ke **4 KB terakhir**
  - error yang dikembalikan menyertakan `LINDEN_ERROR` bila ada, exit code, dan ekor stderr
- **Refactor kecil `modelTools.ts`:** isi `execute` milik `linden_asset_import` dipindah ke `export function importAssetFile(projectPath, source, target?)`. Tool lama memanggil fungsi itu, sehingga perilakunya tidak berubah.
- `available: () => getBlenderStatus().found`. `linden_blender_status` juga ikut tersembunyi kalau Blender tidak ada, sesuai brief.
- Timeout eksekusi MCP: `mcp.add` diberi `timeout: { execution: 15 * 60_000 }`, cukup untuk tunggu izin + 120 dtk Blender. Nilai default OpenCode diverifikasi di M0, dan tool lain tidak boleh jadi lebih pendek timeout-nya.

### 4. Panel prompt: `AgentPanel.tsx`

- Checkbox **Blender 3D** di sebelah "Konteks Scene" (`gap-3`), dengan class yang sama. Tombol Template tetap di kanan.
- Saat mount, panggil `blenderStatus()` via IPC. Panggil ulang ketika panel kembali fokus (`window focus`) agar perubahan di pengaturan Bridge terbaca.
- Kalau tidak terdeteksi: `disabled`, `title="Blender tidak ditemukan — atur path di pengaturan Bridge"`, dan link kecil "Atur" yang memanggil `setActiveEditorPanel('bridge')`.
- Kalau terdeteksi: `title="Blender 4.2.3 — agent boleh membuat model lewat Blender untuk prompt ini"`.
- State `useBlender` dibaca/ditulis lewat `getStorage/setStorage('linden_agent_blender:' + projectPath)` dan di-reset saat proyek berganti. Default `false`.
- `handleSend` memanggil `sendPrompt(text, context, paths, { useBlender: useBlender && blender.found })`.
- `agentStore.sendPrompt(prompt, context?, attachments?, options?: { useBlender?: boolean })` mengirim `useBlender` di level atas payload, **bukan** di dalam `context`, karena `context` di-dump ke prompt sebagai JSON.
- Tipe `AgentPromptOptions` di `shared/agentTypes.ts` dipakai di preload (`agentSubmitPrompt`), `main.ts` (`agent:prompt`), dan `AgentHost.submitPrompt`.

### 5. Instruksi per turn: `electron/agent/prompts/blender.md`

Isinya maksimal sekitar 70 baris, karena ikut terkirim di setiap turn Blender:

- kapan memakai `linden_blender_build`: bentuk organik/halus, bevel, boolean kompleks, array/mirror, UV
- kapan tetap memakai `linden_model_build` parts: blok sederhana
- sumbu: Z = atas di spec, meter, rotasi derajat, objek otomatis menapak tanah
- format spec dengan 2 contoh: meja ber-bevel; mug dengan boolean + solidify
- `linden_blender_script` hanya untuk yang tidak bisa diwakili spec, karena user akan diminta izin dan melihat kodenya. Kontraknya: buat objek mesh di scene, jangan ekspor sendiri, jangan akses file atau jaringan.
- alur: build → (import otomatis) → `linden_model_build {model:{src}}` → `linden_render_preview` → perbaiki spec → maksimal 3 iterasi

Di `submitPrompt`:

```ts
if (options.useBlender && getBlenderStatus().found) {
  text += `\n\n<blender-mode>\n${blenderPrompt()}\n</blender-mode>`
  beginBlenderTurn(sessionId)
} else endBlenderTurn()
```

- `blenderPrompt()` dibaca lewat `resolveAppResource` seperti `linden.md`.
- `endBlenderTurn` dipanggil dari callback TurnTracker (`turn_ended`), `abortPrompt`, dan `stopServer`. Ketiganya juga menolak izin Blender yang masih menunggu.
- Regex di TurnTracker diganti menjadi:

  ```ts
  /(\n*<(editor-context|reference-images|blender-mode)>[\s\S]*?<\/\2>)+\s*$/
  ```

- `linden.md` **tidak diubah**, sehingga saat flag mati prompt identik byte-per-byte.

### 6. Pengaturan Bridge

- Komponen baru `editor/panels/BlenderSettingsSection.tsx`, dirender di dalam `BridgePanel` sebagai bagian baru "Blender".
- Isinya: input path, tombol **Deteksi otomatis** (`blender:detect`), **Pilih file…** (`showOpenDialog` → `blender:setPath`), dan status (`Blender 4.2.3 ✓ (sumber: PATH)` / alasan gagal).

### 7. Lisensi & packaging

- `blender-bridge/LICENSE` berisi teks lengkap GPL-3.0. `blender-bridge/README.md`.
- `package.json` `extraResources` mendapat `{from: 'blender-bridge', to: 'blender-bridge'}`. Path di runtime: `resolveAppResource('blender-bridge/runner.py', 'blender-bridge/runner.py')`.
- `check-licenses.mjs` mendapat pemeriksaan `checkSeparateProcess()`:
  - `blender-bridge/LICENSE` ada dan GPL
  - tidak ada file `.ts`/`.tsx`/`.js` di `electron`, `editor`, `engine`, atau `shared` yang meng-`import`/`require` dari `blender-bridge`

  Pemeriksaan ini mencetak `separate-process GPL: blender-bridge (spawn only)`. Dependency npm tidak bertambah.

## Rencana implementasi

Setiap milestone ditutup dengan `npm run type-check` dan `npm test` yang hijau.

**M0 — Spike (≤ ½ hari, tanpa kode produk)**

1. Cek default `timeout.execution` MCP di OpenCode dan apakah `mcp.remove` + `mcp.add` memuat ulang katalog tool.
2. Pastikan request MCP yang ditahan beberapa menit (menunggu izin) tidak diputus OpenCode.
3. Pastikan nama parameter `export_scene.gltf` dan `--offline-mode` di Blender 4.2 LTS (butuh Blender terinstal; kalau tidak ada, gunakan dokumentasi API 4.2).

Hasilnya dicatat di bagian "M0 answers" pada spec ini.

**M1 — Deteksi + runner + lisensi**

1. `shared/blenderTypes.ts`, `electron/bridge/blenderExec.ts`, `blenderDetect.ts`. Perluas tipe `load/saveBridgeSettings`.
2. IPC `blender:status|detect|setPath` di `ipcChannels.ts`, `preload.ts`, `main.ts`. Deteksi dimulai saat app ready.
3. `blender-bridge/{runner.py,LICENSE,README.md}`, `extraResources`, `check-licenses.mjs`.
4. Tes `tests/bridge/blenderExec.test.ts`: `parseBlenderVersion` (4.2.3 LTS, 4.1 ditolak, 5.0, ada warning di depan, kosong), normalisasi `.app`/Windows/slash, versi Windows tertinggi, urutan kandidat dengan env dan settings.

**M2 — Tools**

1. `shared/blenderSpec.ts` (zod), `electron/agent/blenderMode.ts`, refactor `importAssetFile` di `modelTools.ts`.
2. `blenderTools.ts` + `runBlender` (spawn bisa di-mock), lalu daftarkan di `LINDEN_TOOLS`. `ToolDefinition.available` dan `options.requestPermission`. Filter di `LindenMcpServer`.
3. Tes `tests/agent/blenderTools.test.ts` dengan spawn di-mock:
   - spec valid/invalid
   - penolakan saat flag mati (ketiga tool)
   - parse `LINDEN_RESULT` (ada, hilang, JSON rusak)
   - stderr dipotong 4 KB
   - timeout → kill
   - exit ≠ 0
   - batas segitiga
   - izin ditolak → spawn tidak dipanggil
   - import memanggil `importAssetFile` (file masuk `assets/models/`)
   - `tools/list` menyembunyikan tool Blender saat tidak terdeteksi
   - `linden_asset_import` lama tetap lolos `modelTools.test.ts`

**M3 — AgentHost + izin + prompt**

1. `AgentPromptOptions`. `submitPrompt` menyisipkan `<blender-mode>`, `begin/endBlenderTurn`, dan reset di `turn_ended`/abort/stop.
2. Antrean izin lokal (`requestPermission`, `replyPermission` mengecek map lokal dulu). `AgentPermissionRequest.code?`. PermissionCard menampilkan kode lengkap. `permissionTitle('blender_script')` = "Jalankan script Blender".
3. `mcp.add` dengan `timeout.execution`. Registrasi ulang MCP saat status Blender berubah.
4. `prompts/blender.md`. Regex TurnTracker.
5. Tes di `agentHost.test.ts`/`turnTracker.test.ts`:
   - flag mati → teks prompt identik dengan sebelumnya (snapshot)
   - flag hidup → blok ada dan flag aktif, lalu reset setelah `turn_ended`
   - blok disembunyikan dari tampilan prompt
   - izin lokal: allow, reject, dan auto-reject saat turn selesai

**M4 — UI**

1. Export `getStorage/setStorage` dari `projectIO.ts`. Checkbox + tooltip + link di `AgentPanel.tsx`. `agentStore.sendPrompt(…, options)`.
2. `BlenderSettingsSection.tsx` di `BridgePanel`.
3. Tes: `agentStore` meneruskan `useBlender` di level atas payload. Tes UI ringan bila pola tes komponen sudah ada.

**M5 — E2E opsional + verifikasi**

1. `tests/e2e/blender.e2e.test.ts` (vitest, `describe.skipIf(!blenderFound)`): proyek fixture sementara → `linden_blender_build` kubus bevel → cek `assets/models/<name>.glb` ada, magic `glTF`, dan triangles > 12.
2. `npm run type-check`, `npm test`, `npm run check:licenses`. Uji manual (di bawah). Update bagian Status di spec ini.

## Uji manual

1. Instal Blender ≥ 4.2. Buka Bridge → Blender → **Deteksi otomatis**, lalu pastikan versinya tampil.
2. Panel agent: checkbox Blender 3D aktif, tooltip menampilkan versi. Tutup lalu buka lagi proyek, dan pastikan pilihan tetap tersimpan.
3. Centang, lalu kirim "buat meja kayu dengan tepi membulat". Agent harus memanggil `linden_blender_build` → `linden_model_build` → `linden_render_preview`, dan file muncul di `assets/models/`.
4. Minta "buat vas dengan pola spiral pakai script". PermissionCard harus menampilkan kode lengkap. Tolak → agent menerima error. Izinkan → GLB masuk.
5. Hapus centang, lalu kirim prompt yang sama. Tidak ada tool Blender yang dipakai, dan isi prompt tidak memuat `<blender-mode>`.
6. Ganti path ke file yang bukan Blender. Status harus menampilkan alasan berbahasa Indonesia, dan checkbox menjadi disabled.

## Risiko & keterbatasan

- **`linden_blender_script` tetap menjalankan Python arbitrer dengan hak user.** Izin hanya mitigasi, bukan sandbox. `--factory-startup`, `-Y`, `--offline-mode`, env bersih, cwd job, dan timeout membatasi efek samping yang tidak disengaja, tetapi bukan serangan yang disengaja. Ini harus ditulis jelas di PermissionCard.
- Flatpak/snap mungkin tidak bisa menulis ke folder proyek di luar `$HOME` (sandbox). Error-nya diteruskan apa adanya.
- Peluncuran pertama Blender di macOS (Gatekeeper) bisa lebih lama dari timeout `--version`. User cukup klik Deteksi ulang.
- Flag per turn bersifat global per host. Panel sudah memblokir prompt kedua selama turn berjalan, tetapi prompt dari `ProjectManagerWindow` (tanpa flag) otomatis mematikannya. Ini sesuai harapan.
- Blok `<blender-mode>` menambah sekitar 1–2 ribu token per turn Blender.
- Blender tidak tersedia di mesin dev ini, jadi e2e dan M0 butir 3 perlu mesin yang punya Blender.
