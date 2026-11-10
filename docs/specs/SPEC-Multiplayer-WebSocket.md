# SPEC: Multiplayer online lewat WebSocket

Status: **implemented** di `feat/multiplayer-websocket` (2026-11-10). M1–M6 selesai, kecuali `window.linden.net` untuk proyek HTML Game (opsional, belum dibuat).

Tes:

- `tests/net/*` (server, dua game headless, server export, tool agent)
- `npm run test:e2e:multiplayer`: editor, Play dengan 2 klien
- `npm run test:e2e:multiplayer-web`: hasil web build di dua Chrome melawan `server/linden-server.mjs`

## Perbedaan dari draft (as built)

- **Klien kedua di editor** tidak dibuka di jendela terpisah. Game View menampilkan 1–4 iframe berdampingan (pilihan **Klien: N** di toolbar Game). Semuanya bergabung ke server lokal sesi Play yang sama, jadi lebih mudah diuji dan tidak perlu window manager.
- **Room**: pemain memilih room lewat `?room=`, nama lewat `?name=` di URL halaman game. `ctx.net.join/leave` dari script ditunda.
- **State room**: semua pemain boleh `set` key apa pun (last write wins, sesuai model kepercayaan v1). Opsi `owner` per key ditunda.
- **Pemain keluar**: entity miliknya langsung di-despawn, tanpa grace 10 dtk. Reconnect otomatis (backoff 1–8 dtk, 5 kali) masuk sebagai pemain baru; avatar dibuat ulang di posisi terakhir.
- **Entity scene yang dihapus host** (koin diambil) dicatat server (`removed` di `welcome`), jadi pemain yang bergabung belakangan juga tidak melihatnya.
- **Titik spawn avatar**: pemain pertama di posisi template. Pemain berikutnya disebar melingkar (2 m × √n, golden angle) supaya avatar tidak muncul saling tumpuk; tumpukan seperti itu melontarkan body dinamis.
- **Kamera**: avatar lokal memakai kamera di dalam template (anak entity), bukan kamera scene. Kamera di salinan milik pemain lain dimatikan.
- **Server produksi**: dibangun oleh `scripts/build-server.mjs` (dipanggil `build:electron` dan oleh tes bila belum ada) menjadi satu file ESM 311 KB dengan `ws` + `zod` di dalamnya. Web build menyalinnya ke `server/` beserta `README.md`, `Dockerfile`, dan `package.json`. Server menolak menyajikan isi folder `server/` sendiri dan path traversal.
- **`linden_play {clients}`**: `Input` dan backend `Physics` bersifat global dalam satu proses, jadi input hanya diberikan ke Klien 1 dan backend fisika ditukar per klien setiap frame. Tool juga memperingatkan script pada entity network yang tidak memeriksa `ctx.net.isMine`.
- **Komponen**: `NetworkSync` punya field `template`, `syncTransform`, `rate`, dan `interpolate` (bukan `owner`/`sync[]`). Kepemilikan ditentukan dari asal entity: scene = room, spawn = pemanggil.

## Tujuan

Game Linden (proyek scene) bisa dimainkan beberapa pemain secara online:

- Pemain bergabung ke **room** di sebuah server WebSocket.
- Tiap pemain mendapat avatar.
- Posisi dan rotasi entity yang ditandai network tersinkron ke semua pemain, dengan interpolasi yang halus.
- Script bisa mengirim event game (tembak, ambil item, chat) dan membaca/menulis state room bersama (skor, waktu ronde).

Hasilnya harus bisa:

1. Diuji di editor. Play membuka beberapa klien sekaligus, terhubung ke server lokal yang dijalankan editor.
2. Diekspor. Web build ikut menghasilkan `server/` yang cukup dijalankan dengan `node`.
3. Dibuat dan diverifikasi oleh agent. Ada instruksi prompt, tool setup, dan `linden_play` multi-klien headless.

### Non-goals (v1)

- Simulasi fisika/script **server-authoritative** (server menjalankan scene headless). Desainnya disiapkan agar bisa ditambahkan di v2 (lihat Keputusan 2), tetapi v1 tidak menjalankannya.
- Client-side prediction, rollback, dan lag compensation untuk game kompetitif (FPS).
- Akun, login, persistensi (database), matchmaking berbasis skill, dan lobby browser publik.
- WebRTC/P2P, UDP, dan transport selain WebSocket.
- Ekspor Android/iOS lewat Godot, serta proyek `runtime: "html"`. Untuk keduanya hanya disediakan `window.linden.net` di M6 (opsional).
- Voice chat.

## Fakta dari kode yang ada

| Area | Temuan | Dampak |
|---|---|---|
| Dependency | `ws@^8.22` (MIT) dan `@types/ws` sudah ada. Dipakai `electron/bridge/syncServer.ts` (sync Godot). | Server memakai `ws`, tanpa dependency baru. Klien browser memakai `WebSocket` bawaan. |
| Runtime game | `GameSimulation` dipakai bersama oleh player (browser, Game View editor) dan `linden_play` (headless Node). Fixed step 1/60 s. | Satu modul `NetSystem` di `engine/` jalan di browser dan headless. Server-authoritative v2 bisa memakai `GameSimulation` yang sama. |
| API script | `GameScriptContext` (`ctx.input/physics/vfx/scene/emit/on/...`). Modul virtual `linden` mengekspor `Input`, `Physics`, `Tween`, `Easing` (`ScriptCompiler.ts`). | Ditambahkan `ctx.net` dan hook `onNetJoin/onNetLeave/onNetEvent`. |
| Spawn runtime | Belum ada instansiasi prefab saat runtime (`prefab.ts` hanya tipe + editor). `ctx.vfx.spawn` khusus efek. Editor punya `duplicateEntityCommand`. | Perlu helper runtime untuk clone subtree entity (via `SceneSerializer`) untuk avatar dan objek network. |
| Play di editor | Game berjalan di origin `linden-game://` dengan CSP ketat. `connect-src` hanya `'self'` + `project.play.allowNetwork` (difilter `SAFE_ORIGIN`, sudah menerima `ws(s)://`). | Server dev lokal (`ws://127.0.0.1:<port>`) ditambahkan otomatis ke CSP sesi Play. `multiplayer.serverUrl` juga masuk ke CSP. |
| Web build | `WebBuildRunner` menghasilkan situs statis tanpa CSP. `serveLocal()` menyajikan build di 127.0.0.1. | Build menambahkan `server/linden-server.mjs` (bundle esbuild + `ws`). Server itu bisa sekaligus menyajikan file statis game. |
| Konfigurasi proyek | `LindenProjectConfig` sudah punya `play.allowNetwork`, `services`, dan `exportPresets`. | Ditambah blok `multiplayer` di `project.linden.json`. |
| Proyek nyata | "EVEX SPACE ONLINE" (kapal kinematic + `EveController.ts`) adalah kasus uji alami. | Dipakai sebagai uji manual M5. |

## Keputusan (rekomendasi)

1. **Topologi client–server lewat room server WebSocket**, bukan P2P.
   - Satu proses Node, banyak room, maksimal N pemain per room (default 16).
   - Server mengelola room, ID pemain, kepemilikan entity, state room, dan snapshot untuk pemain yang bergabung belakangan.
2. **Otoritas v1: owner-authoritative dengan validasi server.**
   - Setiap entity network punya **owner**: seorang pemain, atau `room` (dikendalikan oleh **host**, yaitu pemain paling awal di room; berpindah otomatis kalau host keluar).
   - Owner mensimulasikan entity itu secara lokal (fisika/script seperti sekarang) dan mengirim snapshot transform.
   - Server hanya meneruskan update dari owner yang sah, membatasi ukuran dan laju, lalu menyimpan snapshot terakhir.
   - Alasannya: script Linden berjalan di klien. Model ini bekerja untuk semua game yang ada tanpa menulis ulang, latensi pemain sendiri nol, dan servernya ringan.
   - Kekurangannya: klien yang curang bisa memalsukan posisi miliknya sendiri. Ini dicatat sebagai risiko. v2: mode `authority: "server"` menjalankan `GameSimulation` headless di server (modul yang sama).
3. **Penanda network lewat komponen, bukan kode.**
   - `NetworkSync` pada entity berisi:
     - `owner`: `"spawner"` | `"room"`
     - `sync`: `["transform"]` + daftar field script opsional
     - `rate`: Hz, default 15
     - `interpolate`: default true
   - Entity scene dengan `NetworkSync` dimiliki `room` (pintu, musuh, item).
   - Avatar memakai **template**: entity scene dengan `NetworkSync.template = "player"` disembunyikan saat Play. Setiap pemain yang bergabung mendapat clone dengan id deterministik `net:<playerId>:<templateId>`.
4. **Remote = puppet.**
   - Di klien yang bukan owner, entity network dibuat kinematic dan `CharacterMovement` dinonaktifkan.
   - Transform diisi interpolasi buffer 100 ms; `ctx.input` tidak dipakai.
   - Script tetap jalan, tetapi bisa memeriksa `ctx.net.isMine`. Script yang menggerakkan entity wajib memeriksanya; agent diajari ini, dan `linden_play` memperingatkan bila script remote menulis transform.
5. **Protokol JSON v1** dengan field `v: 1`, divalidasi zod di server dan klien (`shared/net/protocol.ts`).
   - Pesan dari klien ke server:
     - `hello`, `join{room, name}`
     - `spawn`, `despawn`
     - `state` (batch transform)
     - `event{name, data, to}`
     - `roomState{key, value}`
     - `ping`
   - Pesan dari server ke klien:
     - `welcome{playerId, room, host, players, entities, roomState, serverTime}`
     - `joined`, `left`, `hostChanged`
     - `spawned`, `despawned`
     - `state`, `event`, `roomState`
     - `pong`, `error{code, message}`
   - Transform dikuantisasi (posisi 1 mm, rotasi quaternion 4 desimal) dan dikirim hanya bila berubah. Format biner (msgpack) bisa menyusul di v2 tanpa mengubah API script.
6. **Satu implementasi server untuk tiga tempat:** `server/net/RoomServer.ts` (Node, `ws`) dipakai oleh:
   - (a) proses main editor saat Play
   - (b) `linden_play` headless multi-klien
   - (c) `server/linden-server.mjs` hasil export
7. **Konfigurasi** `project.linden.json`:

   ```jsonc
   "multiplayer": {
     "enabled": true,
     "serverUrl": "wss://game.example.com/net",   // produksi; kosong = server yang sama dengan halaman game
     "maxPlayers": 16,
     "tickRate": 15,
     "room": "auto"                                 // "auto" = room "default" | "code" = pemain memasukkan kode room
   }
   ```

8. **Keamanan server** (default aktif):
   - pesan maksimal 16 KB
   - maksimal 60 pesan/detik per klien (token bucket)
   - maksimal 256 entity per pemain
   - nama dibersihkan (≤ 24 karakter)
   - `allowedOrigins` opsional
   - ID dibuat server, tidak pernah dari klien
   - update dari bukan owner diabaikan dan dicatat
   - tidak ada `eval` atau pemuatan kode dari klien
   - koneksi idle 30 detik diputus

   Untuk TLS (`wss://`), server dipasang di belakang reverse proxy (Caddy/nginx), dengan contoh di README server.

## API script

```ts
export default class Ship {
  private ctx: any
  onInit(ctx) { this.ctx = ctx }

  onUpdate(dt) {
    if (!this.ctx.net.isMine) return                // avatar pemain lain: hanya puppet
    // ... kontrol seperti biasa; transform otomatis terkirim karena NetworkSync
    if (this.ctx.input.isActionJustPressed('Attack')) {
      this.ctx.net.send('fire', { from: this.ctx.entity.id }, { to: 'all' })
    }
  }

  onNetEvent(name, data, from) {                    // event dari pemain lain (dan dari diri sendiri bila to:'all')
    if (name === 'fire') this.ctx.vfx.spawn('muzzle', /* ... */)
  }
  onNetJoin(player) { this.ctx.log(`${player.name} bergabung`) }
  onNetLeave(player) {}
}
```

`ctx.net`:

| Member | Keterangan |
|---|---|
| `connected`, `playerId`, `room`, `isHost`, `players` | `players` berisi `{id, name, isHost}[]` |
| `isMine` | Entity script ini dimiliki klien ini (selalu true di single-player) |
| `owner(entity?)` | `playerId` pemilik, atau `'room'` |
| `send(name, data, {to?})` | `to`: `'all'` \| `'others'` \| `'host'` \| playerId. Data JSON ≤ 8 KB |
| `spawn(templateName, {position, rotation, data})` | Clone entity template bertanda `NetworkSync.template` di semua klien, dimiliki pemanggil. Mengembalikan Entity lokal |
| `destroy(entity)` | Hanya owner atau host |
| `state.get(key)`, `state.set(key, value)`, `state.on(key, cb)` | State room bersama (last-write-wins di server; hanya host atau pemilik key bila `state.set(key, v, {owner: true})`) |
| `join(room?)`, `leave()` | Untuk `room: "code"`. Pada mode `auto`, join terjadi otomatis saat scene mulai |

Tanpa `multiplayer.enabled`, `ctx.net` adalah stub offline: `connected=false`, `isMine=true`, `send` hanya memanggil `onNetEvent` lokal bila `to: 'all'`. Script multiplayer tetap jalan single-player.

## Arsitektur

```
           Game klien A (player)                       Game klien B
 ┌─────────────────────────────────┐          ┌───────────────────────┐
 │ GameSimulation                  │          │ GameSimulation        │
 │  ScriptRuntime ── ctx.net ──┐   │          │  ...                  │
 │  NetSystem (fixed step):    │   │          │  NetSystem            │
 │   - kirim snapshot milikku  ▼   │          │   - interpolasi remote│
 │   - terapkan snapshot remote    │          │                       │
 │  NetClient (WebSocket) ─────────┼── ws ──┐ │  NetClient ───────────┼── ws ─┐
 └─────────────────────────────────┘        ▼ └───────────────────────┘       ▼
                                   ┌───────────────────────────────────────────────┐
                                   │ RoomServer (Node, ws): rooms, players, owner,  │
                                   │ snapshot terakhir, roomState, rate limit       │
                                   │ editor main (Play) | linden_play | node server │
                                   └───────────────────────────────────────────────┘
```

### File baru

| File | Isi |
|---|---|
| `shared/net/protocol.ts` | Tipe + skema zod pesan, `PROTOCOL_VERSION`, kuantisasi transform |
| `shared/net/config.ts` | Normalisasi `multiplayer` di project config + default |
| `engine/net/NetClient.ts` | Koneksi WebSocket (transport di-inject: `WebSocket` browser / `ws` Node), reconnect dengan backoff, ping/RTT, offset jam server |
| `engine/net/NetSystem.ts` | Dipasang di `GameSimulation`: ownership, kirim snapshot per `rate`, buffer interpolasi, puppet mode, spawn/despawn template |
| `engine/net/NetworkSync.ts` | Komponen (registry + schema) |
| `engine/net/instantiate.ts` | Clone subtree entity runtime via `SceneSerializer` dengan id baru deterministik |
| `engine/net/netApi.ts` | `ctx.net` + stub offline |
| `server/net/RoomServer.ts` | Server room (Node, `ws`), bisa dites tanpa Electron |
| `server/linden-server.ts` | Entry CLI untuk export: `--port`, `--static <dir>`, `--max-players`, `--origins` |
| `electron/net/devServer.ts` | Menyalakan/mematikan RoomServer lokal per sesi Play, port acak di 127.0.0.1 |
| `editor/panels/MultiplayerSection.tsx` | Pengaturan Multiplayer (Project Settings): enable, serverUrl, maxPlayers, tickRate, room mode |

### File yang diubah (utama)

- `engine/scripting/ScriptRuntime.ts`: `ctx.net`, dispatch `onNetJoin/onNetLeave/onNetEvent`.
- `engine/runtime/GameSimulation.ts`: memasang `NetSystem` bila multiplayer aktif.
- `player/player.ts`: membaca config, mengatur URL server dengan urutan berikut:
  1. query `?net=`
  2. `multiplayer.serverUrl`
  3. host halaman yang sama
- `electron/play/PlaySession.ts` + `GameProtocol.ts`: dev server per sesi dan CSP `connect-src`. Toolbar Play mendapat pilihan **"Play: 2 klien"** (klien ke-2 di jendela terpisah).
- `electron/build/WebBuildRunner.ts`: bundle `server/linden-server.mjs` + `server/README.md` (+ `Dockerfile` contoh), lalu `serveLocal` menjalankan RoomServer juga.
- `electron/play/ScriptCompiler.ts`: tidak perlu diubah (API lewat `ctx`).
- `electron/agent/prompts/linden.md`: bagian baru "4c. Multiplayer".
- `electron/agent/lindenTools/*`:
  - `linden_multiplayer_setup` (aktifkan + buat template avatar dari entity pemain yang ada)
  - `linden_play` dengan `clients: 2..4` (headless, RoomServer in-process), yang melaporkan join/spawn, jarak sinkron (error posisi remote vs owner), event terkirim, dan peringatan script puppet yang menulis transform

## Rencana implementasi

Setiap milestone ditutup dengan `npm run type-check` + `npm test` hijau.

**M1 — Protokol + RoomServer (tanpa engine)**

- `shared/net/protocol.ts`, `server/net/RoomServer.ts`.
- Tes vitest dengan klien `ws` sungguhan di port acak:
  - join/leave dan pergantian host
  - spawn/despawn dan ownership (update dari bukan owner ditolak)
  - snapshot untuk pemain yang bergabung belakangan
  - roomState
  - rate limit, ukuran pesan, dan idle timeout
  - room penuh
  - versi protokol berbeda menghasilkan `error`

**M2 — Klien + NetSystem headless**

- `NetClient` (transport di-inject), `NetSystem`, `NetworkSync`, `instantiate`.
- Tes: dua `GameSimulation` headless + RoomServer in-process.
  - Avatar A bergerak, lalu posisi di B mengikuti dalam ≤ 150 ms (error < 5 cm setelah interpolasi).
  - Entity `room` hanya bisa digerakkan host.
  - Saat host keluar, host berpindah.
  - Saat reconnect, entity milik pemain lama di-despawn setelah 10 dtk grace.

**M3 — `ctx.net` + hook script**

- API di atas, stub offline, dan dispatch hook.
- Tes:
  - `send` ke `all`, `others`, `host`, dan `id`
  - `state.set/on`
  - `spawn` template
  - single-player tetap identik bila multiplayer tidak aktif (snapshot hasil `linden_play` sebelum = sesudah)

**M4 — Editor: Play multi-klien + pengaturan**

- Dev server per sesi Play, CSP otomatis, tombol "Play: 2 klien", `MultiplayerSection`, dan indikator koneksi di Game View (`● 2 pemain · 38 ms`).
- Uji Playwright (pola `tests/e2e/*.e2e.mjs`): Play 2 klien, gerakkan avatar klien 1, lalu periksa posisi di klien 2.

**M5 — Export + server produksi**

- Web build menghasilkan `server/linden-server.mjs` (bundle esbuild, Node ≥ 18), `server/README.md` (jalankan, reverse proxy TLS, env), dan `Dockerfile`.
- `serveLocal` + RoomServer untuk preview.
- Tes:
  - jalankan `node server/linden-server.mjs --static .. --port 0`
  - buka dua halaman Playwright dari build, lalu periksa sinkronisasi
- Uji manual pada "EVEX SPACE ONLINE": dua kapal terlihat satu sama lain.

**M6 — Agent (+ opsional HTML Game)**

- `linden.md` bagian 4c, `linden_multiplayer_setup`, dan `linden_play {clients}`.
- Tes tool dengan RoomServer in-process.
- Opsional: `window.linden.net` untuk `runtime: "html"`.

## Risiko & keterbatasan

- **Kecurangan.** Pada v1 owner-authoritative, klien bisa memalsukan state miliknya. Untuk game kompetitif perlu mode server-authoritative (v2).
- **Fisika antar-pemain.** Tabrakan dua body dinamis milik pemain berbeda tidak dideterministikkan; masing-masing owner menang di sisinya. Benda yang perlu didorong bersama sebaiknya dimiliki `room` (host).
- **Host migration.** Saat host keluar, entity `room` diambil alih host baru dari snapshot terakhir. Simulasi lokal host lama yang belum terkirim (< 1 tick) hilang.
- **Bandwidth.** JSON 15 Hz × 16 pemain × ~10 entity masih wajar (~50–100 KB/s per klien). Untuk skala lebih besar perlu biner + area-of-interest (v2).
- **Hosting.** Server produksi harus dijalankan user sendiri (VPS/Docker). Linden tidak menyediakan hosting.
- **Browser.** `ws://` dari halaman `https://` diblokir (mixed content), jadi produksi wajib `wss://`. README server menjelaskannya.

## Pertanyaan terbuka untuk owner

1. Setuju owner-authoritative untuk v1, dengan server-authoritative ditunda ke v2?
2. Kode server produksi: cukup di-generate dari web build (`server/`), atau juga dijadikan paket npm terpisah (`@linden/server`)? Rekomendasi: cukup di-generate, tanpa paket baru.
3. Batas default: 16 pemain/room, tickRate 15 Hz. Perlu diubah untuk EVEX?
