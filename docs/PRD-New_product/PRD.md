# PRD — Linden Engine: OpenCode AI Agent (Prompt-to-Game) & HTML5 Build

| Item | Nilai |
| --- | --- |
| Versi dokumen | 0.1 (draft) |
| Tanggal | 2026-10-25 |
| Target rilis | Linden Engine v0.2.0 |
| Basis kode | `main` @ `723b7e4` (v0.1.3) |
| Status | Draft — menunggu review |

---

## 1. Ringkasan

Linden Engine v0.2 menambahkan dua kemampuan yang saling terkait:

1. **Linden Agent** — panel prompt di editor yang memakai **OpenCode** (versi terbaru, via `opencode serve` + `@opencode-ai/sdk`) sebagai agent AI untuk membuat dan mengubah game dari bahasa natural: scene, entity, komponen, script TypeScript, blueprint, input action, dan aset placeholder.
2. **HTML5 Build nyata** — target ekspor `web` yang menghasilkan game HTML5 yang benar-benar bisa dimainkan (runtime Linden + scene + script + aset), bukan placeholder seperti sekarang.

Gabungan keduanya membentuk alur **Prompt → Game → Preview → Export HTML** dalam satu aplikasi.

## 2. Latar belakang & kondisi saat ini

| Area | Kondisi di v0.1.3 | Lokasi |
| --- | --- | --- |
| Export web | Preset `web` sudah ada di UI (ekstensi `html`, arch `wasm`, opsi `webgpuRequired` + fallback WebGL2), tetapi handler hanya menulis HTML kosong berisi `<div id="game-root">` | `electron/main.ts:156`, `electron/main.ts:900`, `editor/windows/ExportDialog.tsx` |
| Export runner | Readiness check per preset, backend `linden` / `godot` | `editor/export/ExportRunner.ts` |
| Runtime | ECS (`engine/ecs`), renderer WebGPU/Three.js, Babylon, Rapier physics, ScriptSystem, Blueprint, Tween, Input | `engine/*` |
| Format scene | `.lscene` (JSON) dengan schema Zod | `engine/scene/SceneSchema.ts`, `engine/scene/parseSceneFile.ts` |
| Proyek | `project.linden.json` (tags, layers, collision matrix, input actions, export presets) | `shared/types/project.ts` |
| IPC | Daftar kanal tunggal di `shared/ipcChannels.ts`, handler di `electron/main.ts` | — |
| AI | Belum ada integrasi AI/agent apa pun | — |

Masalah utama:

- Pengguna pemula harus memahami ECS, inspector, dan blueprint sebelum bisa membuat game sederhana.
- README mengklaim "Export to HTML5", tetapi hasil ekspor web belum bisa dimainkan.
- Belum ada cara cepat untuk membuat prototipe game dari ide.

## 3. Tujuan, non-tujuan, dan metrik

### 3.1 Tujuan

- G1. Pengguna bisa membuat game 2D/3D sederhana yang bisa dimainkan dari satu prompt, di dalam editor.
- G2. Setiap perubahan oleh agent terlihat (diff), bisa di-undo, dan tervalidasi schema sebelum disimpan.
- G3. Ekspor `web` menghasilkan folder HTML5 statis yang jalan di Chrome, Edge, Firefox, dan Safari terbaru.
- G4. Satu klik "Prompt → Export HTML" menghasilkan build web dari proyek hasil agent.
- G5. Integrasi OpenCode memakai versi terbaru dan provider/model pilihan pengguna (bring-your-own-key).

### 3.2 Non-tujuan (v0.2)

- Generasi aset 3D/tekstur/audio dengan AI (hanya placeholder primitif dan aset bawaan).
- Multiplayer, backend server game, atau hosting build web.
- Ekspor mobile berbasis HTML (PWA/Capacitor) — dicatat untuk fase berikutnya.
- Agent berjalan di cloud milik Linden; agent berjalan lokal di mesin pengguna.

### 3.3 Metrik keberhasilan

| Metrik | Target |
| --- | --- |
| Prompt template standar (10 genre) yang menghasilkan game bisa dimainkan tanpa edit manual | ≥ 7 dari 10 |
| Perubahan agent yang lolos validasi schema `.lscene` pada percobaan pertama | ≥ 90% |
| Waktu dari prompt ke preview pertama (game sederhana, model cepat) | ≤ 3 menit |
| Ukuran build web minimal (scene kosong, gzip) | ≤ 3 MB |
| Waktu load build web (scene contoh, broadband) | ≤ 3 detik ke frame pertama |
| Build web lulus smoke test Playwright (Chromium, Firefox, WebKit) | 100% |

## 4. Persona & user stories

**Persona**

- **Pemula / pelajar** — punya ide game, belum paham engine.
- **Indie dev** — ingin prototipe cepat, lalu menyunting manual.
- **Game jam participant** — butuh build HTML untuk diunggah ke itch.io dalam hitungan jam.

**User stories**

| ID | Sebagai | Saya ingin | Agar |
| --- | --- | --- | --- |
| US-1 | Pemula | mengetik "buat platformer 2D dengan koin dan musuh" | mendapat game yang bisa langsung dimainkan |
| US-2 | Indie dev | meminta "tambahkan double jump ke Player" | agent mengubah script/komponen yang ada tanpa merusak scene |
| US-3 | Semua | melihat diff sebelum perubahan diterapkan | saya tetap memegang kendali |
| US-4 | Semua | undo seluruh perubahan satu giliran agent | eksperimen aman |
| US-5 | Semua | memilih provider dan model (Anthropic, OpenAI, lokal, dll.) | memakai akun/biaya sendiri |
| US-6 | Game jam | klik "Export HTML" lalu dapat folder/zip siap upload | bisa dibagikan di itch.io / GitHub Pages |
| US-7 | Indie dev | agent menjalankan preview dan membaca error console | agent bisa memperbaiki bug sendiri |
| US-8 | Semua | melanjutkan sesi agent setelah editor ditutup | konteks percakapan tidak hilang |

## 5. Kebutuhan fungsional — OpenCode sebagai agent

### 5.1 Integrasi runtime OpenCode

- **FR-A1. Deteksi & instalasi.** Editor mendeteksi binary `opencode` di PATH; jika tidak ada, tawarkan instalasi (`npm i -g opencode-ai` atau installer resmi) dan tampilkan versi. Versi minimal dikunci di config (`opencode.minVersion`), dicek via `GET /global/health` (field `version`).
- **FR-A2. Server lokal.** Main process Electron menjalankan OpenCode secara headless memakai `createOpencode()` dari `@opencode-ai/sdk` (setara `opencode serve`):
  - `hostname: 127.0.0.1`, port acak bebas (bukan default 4096, untuk menghindari bentrok).
  - `cwd` = folder proyek Linden yang sedang dibuka.
  - `OPENCODE_SERVER_PASSWORD` acak per sesi editor (HTTP basic auth).
  - `config` inline untuk agent `linden`, model default, dan tool/permission (lihat 5.3).
  - Server dimatikan saat proyek ditutup atau aplikasi keluar.
- **FR-A3. Klien.** Hanya main process yang berbicara ke server OpenCode. Renderer berkomunikasi lewat IPC baru (5.5); kredensial server tidak pernah dikirim ke renderer.
- **FR-A4. Provider & model.** Pengaturan "AI Agent" di Project Settings / Preferences:
  - Daftar provider dan model diambil dari OpenCode (bukan di-hardcode).
  - API key dikelola oleh OpenCode (`opencode auth login`) atau disimpan di keychain OS lewat `safeStorage` Electron; tidak pernah ditulis ke `project.linden.json`.
  - Model default disarankan: model coding terbaru dari provider yang aktif.

### 5.2 Panel Agent di editor

- **FR-A5.** Panel baru `editor/panels/AgentPanel.tsx` (dock kanan, bisa di-tab dengan Inspector):
  - Input prompt multi-baris + tombol kirim / stop (abort → `POST /session/:id/abort`).
  - Stream respons dan langkah tool secara real-time dari SSE `GET /event` (`client.event.subscribe()`).
  - Daftar sesi (buat, ganti, hapus, fork) memetakan ke `/session` OpenCode.
  - Mode **Plan** (hanya usulan, tanpa tulis) dan **Build** (boleh mengubah proyek).
  - Lampiran konteks: entity terpilih, scene aktif, error console, gambar referensi.
- **FR-A6. Template prompt.** Galeri "Mulai dari prompt": platformer 2D, top-down shooter, endless runner, puzzle match-3, pong, breakout, flappy, racing 3D sederhana, FPS arena kecil, visual novel.
- **FR-A7. Wizard "New Project from Prompt"** di Project Manager: nama proyek + prompt + 2D/3D + model → membuat proyek baru dan menjalankan agent sampai preview siap.

### 5.3 Agent `linden` dan tool khusus

Agent didefinisikan sebagai agent OpenCode bernama `linden` (via `config.agent` inline atau `.opencode/agent/linden.md` di proyek) dengan system prompt yang menjelaskan arsitektur Linden: ECS, format `.lscene`, API `ScriptSystem`, Blueprint, InputActions, dan aturan proyek.

Agent **tidak** menulis file engine secara bebas. Perubahan dilakukan lewat tool khusus Linden (custom tools di `.opencode/tool/` atau MCP server lokal yang dijalankan editor):

| Tool | Fungsi | Validasi |
| --- | --- | --- |
| `linden_project_info` | Baca `project.linden.json`, daftar scene, aset, komponen terdaftar | — |
| `linden_scene_read` | Baca scene sebagai JSON terstruktur | — |
| `linden_scene_apply` | Terapkan patch (tambah/ubah/hapus entity, komponen, hierarki) | Schema Zod `SceneSchema`, ID unik, referensi valid |
| `linden_component_list` | Daftar komponen + properti dari `ComponentRegistry` | — |
| `linden_script_write` | Tulis/ubah script TypeScript di `scripts/` | `tsc --noEmit` terhadap API engine |
| `linden_blueprint_apply` | Buat/ubah graph Blueprint | Validasi node & pin |
| `linden_input_actions` | Tambah/ubah input action | Schema project |
| `linden_asset_placeholder` | Buat primitif/sprite warna/tekstur placeholder | Batas ukuran file |
| `linden_play` | Jalankan preview headless N detik, kembalikan log, error, FPS | Timeout |
| `linden_export_web` | Jalankan build HTML5 (bagian 6) | Readiness check |

- **FR-A8.** Semua tool tulis berjalan lewat `CommandStack` editor sehingga satu giliran agent = satu entri undo grup (`editor/commands/CommandStack.ts`).
- **FR-A9. Permission.** Tool bawaan OpenCode `bash`, `webfetch`, dan `edit` di luar folder proyek default **ask** atau **deny**. Permintaan izin ditampilkan sebagai dialog di editor dan dijawab via API permission OpenCode.
- **FR-A10. Diff & approval.** Mode default "Review": perubahan ditampilkan sebagai diff (scene tree diff + text diff script) dan baru diterapkan setelah pengguna klik Apply. Mode "Auto-apply" opsional.
- **FR-A11. Loop perbaikan.** Setelah `linden_play`, jika ada error runtime, agent boleh mencoba memperbaiki maksimal N kali (default 3) sebelum bertanya ke pengguna.
- **FR-A12. Output terstruktur.** Untuk rencana game, agent memakai structured output (`format: { type: "json_schema" }` di klien `@opencode-ai/sdk/v2`) agar `GameSpec` (genre, scene, entity, kontrol, kondisi menang/kalah) bisa divalidasi sebelum dieksekusi.

### 5.4 Persistensi

- **FR-A13.** ID sesi OpenCode disimpan di `.linden/agent/sessions.json` di proyek (tidak berisi isi percakapan atau key); isi percakapan disimpan oleh OpenCode.
- **FR-A14.** File `AGENTS.md` dibuat otomatis di root proyek baru berisi konvensi proyek untuk agent.

### 5.5 IPC baru

Ditambahkan ke `shared/ipcChannels.ts`:

```
agent:status          agent:start           agent:stop
agent:providers       agent:setModel
agent:session:list    agent:session:create  agent:session:delete
agent:prompt          agent:abort           agent:permission:reply
agent:diff:apply      agent:diff:reject
```

Event stream dari main ke renderer: `agent:event` (diteruskan dari SSE OpenCode, sudah difilter per sesi).

## 6. Kebutuhan fungsional — HTML5 build

### 6.1 Runtime web (Linden Player)

- **FR-W1.** Paket baru `player/` (atau `engine/player/`): entry point browser yang memuat `project.json` + scene `.lscene` + script terkompilasi, lalu menjalankan `Engine` tanpa editor/Electron.
- **FR-W2.** Tidak ada dependensi Node/Electron di bundle player (lint rule + test import graph).
- **FR-W3. Renderer.** WebGPU jika tersedia; fallback WebGL2 bila `webgpuRequired = false` (opsi sudah ada di preset). Jika `true` dan tidak didukung, tampilkan layar pesan yang jelas.
- **FR-W4. Physics.** Rapier (`@dimforge/rapier3d-compat`) dimuat sebagai WASM yang dibundel lokal.
- **FR-W5. Input.** Keyboard, mouse, gamepad, dan touch (kontrol virtual opsional untuk mobile browser).
- **FR-W6. Audio.** Web Audio, dengan "click to start" untuk mematuhi autoplay policy.

### 6.2 Pipeline build

Mengganti stub di `electron/main.ts:156` dan `electron/main.ts:900`:

1. Validasi proyek (schema scene, script `tsc`, aset hilang) — memakai `ExportRunner.checkPresetReadiness`.
2. Kompilasi script & blueprint proyek → modul ES (rolldown/Vite yang sudah ada di devDependencies).
3. Bundle player + game → `index.html`, `game.[hash].js`, `assets/`, `rapier.wasm`, `project.json`.
4. Optimasi: tree-shaking renderer yang tidak dipakai (Babylon vs Three), minify, kompresi gzip/brotli opsional.
5. Output folder `build/web/<Proyek>/` + opsi `.zip` (siap itch.io).
6. Laporan build: ukuran per file, waktu, peringatan.

- **FR-W7. Opsi preset web:** judul, ukuran kanvas (fixed / responsive / fullscreen), warna & logo loading screen, `webgpuRequired`, base path (untuk GitHub Pages), kompresi, include source map.
- **FR-W8. Preview lokal.** Tombol "Run in Browser" menjalankan server statis lokal dan membuka browser default (`shell:openExternal`).
- **FR-W9. Tanpa server.** Build harus jalan dari hosting statis apa pun. Pembukaan via `file://` didukung bila memungkinkan; jika WASM/fetch terhalang, tampilkan petunjuk.
- **FR-W10. Progress.** Memakai `ExportProgressEvent` yang sudah ada (`validation → bundle → package → complete`).

### 6.3 Alur Prompt → Game → HTML

```
Prompt pengguna
  → agent "linden" menyusun GameSpec (structured output)
  → pengguna menyetujui rencana (opsional)
  → tool linden_* membuat scene, script, input, aset placeholder
  → linden_play: preview + baca error → perbaiki (≤ 3 kali)
  → pengguna review diff → Apply
  → linden_export_web / tombol Export HTML
  → folder build/web + zip + "Run in Browser"
```

## 7. Arsitektur teknis

```
┌──────────────────────── Electron Renderer (React) ────────────────────────┐
│ AgentPanel · DiffView · PermissionDialog · ExportDialog (web)             │
└───────────────────────────────▲───────────────────────────────────────────┘
                                │ IPC agent:* / export:run
┌───────────────────────────────┴──── Electron Main ────────────────────────┐
│ AgentHost (electron/agent/)          WebBuildRunner (electron/build/web)  │
│  - createOpencode() / lifecycle       - compile scripts (rolldown)        │
│  - SSE → agent:event                  - bundle player + assets            │
│  - permission relay                   - zip, report                       │
│ LindenToolServer (custom tools / MCP) ── memanggil scene/project IO ──────│
└───────────────▲───────────────────────────────────────────────────────────┘
                │ HTTP + SSE (127.0.0.1, basic auth)
┌───────────────┴──────────────┐        ┌────────────────────────────────┐
│ OpenCode server (opencode)   │ ─────▶ │ Provider LLM pilihan pengguna  │
│ agent "linden" + tools       │        └────────────────────────────────┘
└──────────────────────────────┘
```

### 7.1 Modul baru / perubahan

| Path | Jenis | Isi |
| --- | --- | --- |
| `electron/agent/AgentHost.ts` | baru | Start/stop OpenCode, klien SDK, relay event & permission |
| `electron/agent/lindenTools/*` | baru | Implementasi tool `linden_*` (custom tool OpenCode atau MCP stdio) |
| `electron/agent/prompts/linden.md` | baru | System prompt agent + ringkasan API engine |
| `electron/build/WebBuildRunner.ts` | baru | Pipeline HTML5 (bagian 6.2) |
| `player/` | baru | Entry runtime browser + loading screen |
| `editor/panels/AgentPanel.tsx`, `editor/agent/*` | baru | UI agent, store Zustand, diff view |
| `shared/agentTypes.ts` | baru | Tipe `GameSpec`, event, permission |
| `shared/ipcChannels.ts` | ubah | Kanal `agent:*` |
| `electron/main.ts` | ubah | Ganti stub web export, daftarkan handler agent |
| `electron/preload.ts` | ubah | Expose API agent ke renderer |
| `shared/types/project.ts` | ubah | Field preset web baru (`canvasMode`, `basePath`, `compress`, …), blok `agent` (model default, mode approve) |
| `editor/windows/ExportDialog.tsx` | ubah | Opsi web baru + "Run in Browser" |
| `package.json` | ubah | Tambah `@opencode-ai/sdk` |

### 7.2 Keputusan teknis

- **SDK, bukan spawn CLI mentah** — `@opencode-ai/sdk` memberi tipe dari OpenAPI (`/doc`) dan event SSE yang stabil.
- **Tool khusus, bukan edit file bebas** — menjaga validitas `.lscene` dan undo; edit file bebas hanya untuk `scripts/` dan tetap lewat diff.
- **Upgrade Electron** — Electron 27 sudah EOL; ikuti `docs/specs/SPEC-Upgrade-Electron-27-to-45.md` sebelum/bersamaan dengan fitur ini (Node lebih baru untuk SDK & build).

## 8. Kebutuhan non-fungsional

| Kategori | Kebutuhan |
| --- | --- |
| Keamanan | Server OpenCode hanya bind `127.0.0.1`, password acak per sesi, CORS tertutup. Tool tulis dibatasi ke folder proyek (cek path traversal). `bash` default ask. |
| Privasi | Tidak ada telemetri prompt ke Linden. Pengguna diberi tahu bahwa isi proyek dikirim ke provider LLM pilihannya. Opsi provider lokal (mis. Ollama) didukung lewat OpenCode. |
| Kredensial | API key via OpenCode auth atau `safeStorage`; tidak pernah di repo, log, atau build web. |
| Keandalan | Crash/timeout OpenCode tidak menjatuhkan editor; auto-restart 1 kali, lalu tampilkan error. |
| Performa | Panel agent tidak memblok render viewport (stream di-throttle). Build web scene contoh ≤ 30 detik di laptop M1. |
| Kompatibilitas | macOS, Windows, Linux (sama dengan editor). Browser: 2 versi terakhir Chrome, Edge, Firefox, Safari. |
| Lisensi | OpenCode MIT; pastikan lisensi dependensi player kompatibel untuk didistribusikan dalam build web. |
| Aksesibilitas | Panel agent bisa dioperasikan keyboard; status stream diumumkan ke screen reader. |

## 9. Rencana rilis

| Fase | Lingkup | Kriteria keluar |
| --- | --- | --- |
| M0 — Fondasi (1–2 minggu) | Upgrade Electron, `player/` minimal (render scene `.lscene` di browser) | `valid-basic.lscene` tampil di Chrome & Firefox |
| M1 — HTML5 Build (2–3 minggu) | `WebBuildRunner`, script compile, Rapier WASM, opsi preset, Run in Browser, zip | Demo platformer manual bisa dimainkan dari build web; smoke test Playwright 3 browser lulus |
| M2 — Agent dasar (2–3 minggu) | `AgentHost`, panel, sesi, provider/model, permission, tool read + `scene_apply` + `script_write`, diff & undo | US-2, US-3, US-4, US-5 lulus |
| M3 — Prompt-to-Game (2 minggu) | `GameSpec` structured output, `linden_play` + loop perbaikan, template prompt, wizard New Project from Prompt | ≥ 7/10 template menghasilkan game bisa dimainkan |
| M4 — Prompt → HTML (1 minggu) | `linden_export_web`, tombol satu klik, dokumentasi | US-1 + US-6 end-to-end < 5 menit |
| Beta v0.2.0 | Hardening, docs, contoh | Semua kriteria penerimaan di bawah |

### 9.1 Kriteria penerimaan (ringkas)

- [ ] OpenCode terdeteksi, versi ditampilkan, server start/stop bersama proyek.
- [ ] Prompt di panel menghasilkan stream respons dan bisa dihentikan.
- [ ] Setiap perubahan agent lolos validasi schema dan tampil sebagai diff.
- [ ] Satu giliran agent bisa di-undo dengan satu Ctrl+Z.
- [ ] Permission `bash`/edit di luar proyek muncul sebagai dialog.
- [ ] API key tidak muncul di `project.linden.json`, log, atau output build.
- [ ] Export preset `web` menghasilkan `index.html` + aset yang bisa dimainkan.
- [ ] Fallback WebGL2 berjalan saat WebGPU tidak tersedia dan `webgpuRequired = false`.
- [ ] Zip build bisa diunggah dan dimainkan di itch.io (uji manual).
- [ ] Alur "New Project from Prompt → Export HTML" selesai tanpa edit manual untuk template platformer.

### 9.2 Pengujian

- Unit (Vitest): `AgentHost` dengan server OpenCode tiruan, setiap tool `linden_*`, `WebBuildRunner`.
- Integrasi: OpenCode nyata dengan model murah/lokal di CI opsional (job manual, butuh secret).
- E2E (Playwright): build web contoh di Chromium, Firefox, WebKit — cek frame pertama, input, tanpa error console.
- Evaluasi prompt: suite 10 template genre, dijalankan per rilis, hasil dicatat (playable / error / butuh edit).

## 10. Risiko, dependensi, dan pertanyaan terbuka

### 10.1 Risiko

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| API OpenCode berubah cepat (rilis sering) | Integrasi rusak saat update | Kunci versi min/max teruji, adapter tipis di `AgentHost`, test kontrak terhadap `/doc` |
| Model menghasilkan scene/script tidak valid | Game rusak | Tool tervalidasi, loop perbaikan, diff + undo |
| Biaya token tinggi untuk pengguna | Pengguna kecewa | Tampilkan pemakaian token/biaya per sesi, rekomendasi model hemat |
| Ukuran bundle web besar (Babylon + Three + Rapier) | Load lambat | Pilih satu renderer per build, code splitting, lazy load physics |
| Agent menjalankan perintah berbahaya | Keamanan | Permission ask/deny, sandbox path, tanpa `bash` default |
| WebGPU belum merata di browser | Game tidak jalan | Fallback WebGL2 sebagai default untuk preset web |

### 10.2 Dependensi

- OpenCode CLI (`opencode-ai`) dan `@opencode-ai/sdk` versi terbaru.
- Akun/API key provider LLM milik pengguna, atau model lokal.
- Upgrade Electron (`docs/specs/SPEC-Upgrade-Electron-27-to-45.md`).

### 10.3 Pertanyaan terbuka

1. Bundel binary OpenCode di installer Linden, atau minta pengguna menginstal sendiri?
2. Tool Linden diekspos sebagai custom tool OpenCode (`.opencode/tool/`) atau MCP server lokal? MCP lebih portabel ke agent lain; custom tool lebih sederhana.
3. Renderer default build web: Three.js (lebih kecil) atau Babylon?
4. Apakah blueprint ikut dibuat agent di v0.2, atau script TypeScript saja dulu?
5. Perlu mode "web editor" (editor berjalan di browser + `opencode web`) di masa depan?

## 11. Catatan implementasi (2026-10-25)

Keputusan yang diambil saat eksekusi PRD, menggantikan asumsi di bagian 5 dan 7 yang ditulis untuk OpenCode v1:

| Topik | Asumsi awal | Implementasi |
| --- | --- | --- |
| Versi OpenCode | `opencode-ai` + `@opencode-ai/sdk` (v1, API `/session`, `/event`) | CLI `@opencode/cli` ≥ 2.0 (terbaru 2.1.4) dengan API v2 `/api/*`; klien `@opencode/client` 2.1.4 (fetch, ringan). `@opencode/sdk` v2 tidak dipakai karena menjalankan OpenCode in-process dengan dependensi native yang berat. |
| Start server | `createOpencode()` | `opencode serve --hostname=127.0.0.1 --port=<acak>` dengan `OPENCODE_SERVER_PASSWORD` acak, auth Basic `opencode:<password>` (`electron/agent/AgentHost.ts`). |
| Tool Linden | custom tool atau MCP | MCP server remote di main process (`electron/agent/LindenMcpServer.ts`, 127.0.0.1 + bearer token), didaftarkan via `mcp.add` sebagai `linden`. OpenCode memanggilnya sebagai `tools.linden.*`. |
| Instruksi agent | agent `linden` di config | Agent bawaan `build`/`plan` + entri instruksi sesi `linden` (isi `electron/agent/prompts/linden.md`). |
| Permission | `bash`/`edit` ask | Aturan sesi: default `ask`; `read`/`glob`/`grep`/`list`/tool Linden `allow`. Permintaan datang lewat event `permission.asked`, dijawab `permission.reply`. |
| Diff & undo | approve sebelum tulis | Tool Linden menulis langsung dan mengirim diff; "Tolak" mengembalikan isi sebelumnya (atau menghapus file baru). Grup undo `CommandStack` belum diimplementasikan. |
| `linden_play` | preview headless | Simulasi nyata: scene dimuat ke `World`, body Rapier dibuat, 60 langkah/detik, melaporkan error runtime, NaN, dan body yang jatuh. |
| Build web di app terpaket | — | Runtime player dibangun saat `npm run build` ke `dist-player/` dan dikirim sebagai `extraResources` (`player-runtime`); export hanya menyalin runtime, tanpa rolldown saat runtime. |

Belum dikerjakan: structured output `GameSpec` (FR-A12), grup undo satu giliran agent (FR-A8), kompilasi `scripts/*.ts` proyek ke dalam build web, dan test kontrak otomatis terhadap `/openapi.json`.

## 12. Referensi

- OpenCode Server: https://opencode.ai/docs/server/ (`opencode serve`, endpoint `/session`, `/session/:id/message`, `/session/:id/prompt_async`, SSE `/event`, OpenAPI `/doc`, `OPENCODE_SERVER_PASSWORD`)
- OpenCode SDK: https://opencode.ai/docs/sdk/ (`@opencode-ai/sdk`, `createOpencode`, `createOpencodeClient`, `client.session.prompt`, `client.event.subscribe`, structured output di `/v2`)
- OpenCode Agents: https://opencode.ai/docs/agents/
- OpenCode Custom Tools: https://opencode.ai/docs/custom-tools/
- Kode terkait: `editor/export/ExportRunner.ts`, `editor/windows/ExportDialog.tsx`, `electron/main.ts`, `shared/ipcChannels.ts`, `shared/types/project.ts`, `engine/scene/SceneSchema.ts`, `engine/scripting/ScriptSystem.ts`
