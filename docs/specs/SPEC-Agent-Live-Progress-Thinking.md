# Spec: Proses agent saat generate game dari prompt tidak terlihat (thinking, tool, progres)

Oct 25, 2026 · @accept

## Ringkasan

Saat game dibuat dari prompt, editor tidak memperlihatkan apa yang sedang dikerjakan agent. Tidak ada "thinking" seperti di OpenCode, tidak ada teks yang mengalir, dan langkah tool tidak jelas. Setelah selesai, jejak prosesnya hilang, dan viewport tidak berubah walaupun file scene sudah ditulis.

Penyebabnya ada di tiga lapis:

- `AgentHost` membuang event reasoning OpenCode.
- Panel hanya mendengarkan event saat tab Agent sedang terbuka.
- Store dan panel tidak menyimpan atau menampilkan langkah-langkah yang sudah lewat.

Spec ini membuat proses agent terlihat langsung dan tetap tersimpan, setara dengan tampilan sesi di OpenCode.

## Gejala

1. Buat proyek lewat **New Project from Prompt** (wizard di Project Manager), atau kirim prompt dari panel Agent.
2. Editor terbuka di tab **Inspector**. Tab Agent kosong atau hanya berisi pesan pengguna.
3. Selama 5 detik sampai beberapa menit tidak ada indikator apa pun. Thinking model tidak pernah muncul.
4. Daftar langkah hanya berisi `execute` atau `search`, tanpa isi kode, argumen, atau hasil.
5. Setelah selesai, langkah-langkah hilang. Yang tersisa hanya teks akhir.
6. Viewport masih menampilkan scene awal. Scene hasil agent baru terlihat setelah scene dibuka ulang secara manual.

## Akar masalah

Diverifikasi terhadap kode di `main` + perubahan lokal (25 Okt 2026) dan event nyata dari `opencode serve` v2.0.27:

| # | Masalah | Lokasi | Dampak |
| --- | --- | --- | --- |
| R1 | `handleEvent` tidak menangani `session.reasoning.started/delta/ended`. | `electron/agent/AgentHost.ts:549` | Thinking tidak pernah sampai ke renderer. |
| R2 | Tidak ada event untuk `session.execution.started`, `session.step.started`, atau `session.retry.scheduled`. | `electron/agent/AgentHost.ts:549` | Jeda sebelum token pertama terlihat seperti macet. |
| R3 | Event hanya diterima saat `AgentPanel` ter-mount. Listener dipasang di `init()` yang dipanggil `useEffect` panel. | `editor/agent/agentStore.ts:75`, `editor/panels/AgentPanel.tsx:47` | Wizard mengirim prompt saat editor masih di tab Inspector, jadi semua event awal hilang. |
| R4 | `init()` memasang listener baru setiap kali `projectPath` berubah, tanpa melepas yang lama. | `editor/agent/agentStore.ts:75` | Setelah ganti proyek, langkah dan pesan bisa muncul ganda. |
| R5 | `message_chunk` hanya membawa teks dari satu `assistantMessageID`. Satu prompt menghasilkan beberapa pesan assistant (satu per langkah tool). | `electron/agent/AgentHost.ts:560` | Teks langkah sebelumnya hilang dari layar saat langkah berikutnya mulai. |
| R6 | Saat `message_completed`, langkah dipindah ke `msg.steps`, tapi panel hanya merender `msg.content`. | `editor/agent/agentStore.ts:114`, `editor/panels/AgentPanel.tsx:241` | Proses hilang setelah selesai. |
| R7 | Langkah code-mode bernama `execute`. Nama tool sebenarnya (`linden.scene_apply`) baru diketahui dari `session.tool.progress`, tapi `step_started` sudah terkirim dengan nama lama. Argumen (kode) dan hasil tidak ditampilkan. | `electron/agent/AgentHost.ts`, `editor/panels/AgentPanel.tsx` | Pengguna tidak tahu tool apa yang jalan. |
| R8 | Event dari sesi anak (subagent `general`/`explore`) punya `sessionID` lain dan langsung dibuang. | `electron/agent/AgentHost.ts:552` | Kerja subagent tidak terlihat sama sekali. |
| R9 | `getSessionMessages` hanya mengambil bagian `text`. Bagian `reasoning` dan pemanggilan tool diabaikan. | `electron/agent/AgentHost.ts` (`getSessionMessages`) | Riwayat sesi yang dibuka ulang tidak menampilkan proses. |
| R10 | Tidak ada yang memuat ulang scene di viewport setelah `diff_proposed` dengan `kind: 'scene'`. | tidak ada handler di `editor/` | Hasil agent tidak terlihat di viewport. |
| R11 | Setiap delta mengirim seluruh teks terakumulasi lewat IPC tanpa throttle. | `electron/agent/AgentHost.ts:560` | Pada jawaban panjang, IPC dan render React jadi berat (O(n²)). |

Bentuk event yang relevan (dari `@opencode/client` 2.1.4, `dist/promise/generated/types.d.ts`):

```ts
session.reasoning.delta  { sessionID, assistantMessageID, ordinal, delta }
session.text.delta       { sessionID, assistantMessageID, ordinal, delta }
session.tool.input.delta { sessionID, assistantMessageID, id, delta }
session.tool.progress    { sessionID, assistantMessageID, id, metadata: { toolCalls?: [{ tool, status, input }] } }
```

## Tujuan

- G1. Thinking model tampil langsung saat streaming, bisa dilipat seperti di OpenCode, dan menampilkan durasinya.
- G2. Selalu ada indikator status (`Menunggu model…`, `Berpikir…`, `Menjalankan linden.scene_apply…`, `Mencoba ulang (2/3)…`) dari saat prompt dikirim sampai selesai.
- G3. Proses satu giliran (thinking → teks → tool → hasil) tampil berurutan sebagai timeline dan tetap ada setelah selesai maupun setelah sesi dibuka ulang.
- G4. Tidak ada event yang hilang, walaupun tab Agent belum dibuka atau prompt dikirim dari wizard.
- G5. Perubahan scene oleh agent langsung terlihat di viewport.

## Non-tujuan

- Mengubah alur permission atau isi tool Linden.
- Menampilkan isi `shell` secara streaming (cukup output akhir).
- Menyunting atau mengulang (fork) langkah dari timeline.

## Desain

### 1. Model data: timeline per giliran

Ganti `activeSteps` + `streamingText` dengan satu timeline per giliran (`AgentTurn`). Tambahkan di `shared/agentTypes.ts`:

```ts
export type AgentPart =
  | { kind: 'reasoning'; id: string; text: string; startedAt: number; endedAt?: number }
  | { kind: 'text'; id: string; text: string }
  | {
      kind: 'tool'
      id: string            // tool call id dari OpenCode
      tool: string          // nama asli, mis. 'linden.scene_apply' atau 'shell'
      input?: unknown       // argumen / kode code-mode
      status: 'running' | 'completed' | 'failed'
      output?: string       // dipotong 4000 karakter
      error?: string
      childSessionId?: string
    }

export type AgentTurnPhase = 'queued' | 'waiting_model' | 'thinking' | 'writing' | 'tool' | 'retrying' | 'done' | 'failed' | 'interrupted'

export interface AgentTurn {
  id: string                // id pesan user dari session.prompt
  sessionId: string
  prompt: string
  phase: AgentTurnPhase
  phaseDetail?: string      // mis. nama tool, "percobaan 2/3"
  parts: AgentPart[]        // urut sesuai kejadian
  startedAt: number
  endedAt?: number
  tokens?: { input: number; output: number; reasoning: number }
}
```

Event baru dari main ke renderer (menggantikan `message_chunk` / `step_*` / `message_completed`; tipe lama dihapus):

```ts
type AgentEvent =
  | { type: 'turn_started'; sessionId; data: { turnId; prompt } }
  | { type: 'turn_phase'; sessionId; data: { phase: AgentTurnPhase; detail?: string } }
  | { type: 'part_upsert'; sessionId; data: AgentPart }   // id sama = ganti
  | { type: 'part_append'; sessionId; data: { id: string; kind: 'reasoning' | 'text'; delta: string } }
  | { type: 'turn_usage'; sessionId; data: { input; output; reasoning } }
  | { type: 'turn_ended'; sessionId; data: { phase: 'done' | 'failed' | 'interrupted'; error?: string } }
  | { type: 'diff_proposed' | 'permission_requested' | 'status_changed' | 'error'; ... }  // tetap
```

`part_append` hanya membawa delta (bukan seluruh teks), sehingga R11 selesai tanpa pengiriman ulang.

### 2. Pemetaan event OpenCode → Linden (`AgentHost.handleEvent`)

| Event OpenCode | Event Linden |
| --- | --- |
| `session.inbox.enqueued` (item user) | `turn_started` + `turn_phase: queued` |
| `session.execution.started` | `turn_phase: waiting_model` |
| `session.reasoning.started` | `part_upsert` reasoning (`id = <assistantMessageID>:r<ordinal>`, `startedAt`) + `turn_phase: thinking` |
| `session.reasoning.delta` | `part_append` reasoning |
| `session.reasoning.ended` | `part_upsert` reasoning dengan `endedAt` |
| `session.text.started` | `part_upsert` text (`id = <assistantMessageID>:t<ordinal>`) + `turn_phase: writing` |
| `session.text.delta` | `part_append` text |
| `session.tool.input.started` | `part_upsert` tool `running` (nama sementara) + `turn_phase: tool` |
| `session.tool.called` | `part_upsert` tool dengan `input` |
| `session.tool.progress` | `part_upsert` tool dengan `tool` diganti nama dari `metadata.toolCalls[].tool` (code-mode) + `turn_phase: tool, detail` |
| `session.tool.success` / `session.tool.failed` | `part_upsert` tool `completed` / `failed` + `output` / `error` |
| `session.retry.scheduled` | `turn_phase: retrying, detail` |
| `session.usage.updated` | `turn_usage` |
| `session.execution.succeeded` / `failed` / `interrupted` | `turn_ended` |
| `session.step.failed` | `error` (tetap) |

Id part yang deterministik membuat `part_upsert` idempoten, sehingga event yang datang ganda tidak menduplikasi baris.

**Sesi anak (R8):** simpan `Set<string>` sesi yang dipantau. Isinya sesi aktif ditambah sesi anak yang tercatat dari `session.created` dengan `parentID` di set tersebut. Event sesi anak dipetakan ke part `tool` milik pemanggilnya (`childSessionId`). Teksnya muncul sebagai sub-timeline yang bisa dilipat.

**Throttle (R11):** gabungkan `part_append` per part dan kirim paling sering setiap 50 ms. Saat `turn_ended`, buffer dikirim seketika.

### 3. Buffer di main supaya tidak ada event hilang (R3)

- `AgentHost` menyimpan timeline giliran yang sedang berjalan (dan 1 giliran terakhir) per sesi di memori. Isinya dibangun dari event yang sama dengan yang dikirim ke renderer.
- IPC baru `agent:turn:snapshot` (`sessionId`) → `AgentTurn | null`.
- Saat store berlangganan, ia memanggil snapshot dulu, baru menerapkan event berikutnya. Event yang `turnId`-nya lebih lama dari snapshot diabaikan.

### 4. Langganan event di level aplikasi (R3, R4)

- Pindahkan `api.onAgentEvent(...)` dari `init()` ke modul `editor/agent/agentEvents.ts`. Modul ini dipanggil sekali dari `EditorLayout` saat proyek terbuka, menyimpan fungsi unsubscribe, dan melepasnya saat proyek berganti.
- `AgentPanel` hanya membaca store, tanpa memasang listener sendiri.
- Saat wizard mengirim prompt, `EditorLayout` otomatis beralih ke tab **Agent** (`setRightTab('agent')`), dan sesi wizard menjadi `currentSessionId`.
- Toolbar menampilkan indikator kecil "Agent bekerja…" (titik berdenyut + fase) selama ada giliran berjalan, juga saat tab Inspector yang aktif. Klik indikator membuka tab Agent.

### 5. Tampilan panel (G1–G3)

Setiap giliran dirender sebagai kartu dengan urutan `parts`:

```
┌ Kamu ─────────────────────────────────────────────┐
│ buat platformer 2D dengan koin dan musuh           │
└────────────────────────────────────────────────────┘
▾ Berpikir · 6,2 dtk                       (dilipat saat selesai)
   Pengguna minta platformer 2D. Perlu ground, player…
● linden.component_list                       selesai ▸
● linden.scene_apply  scenes/Main.lscene · 7 entity    selesai ▸
   └ diff: scenes/Main.lscene  [Lihat] [Tolak]
◌ linden.play                                 berjalan…
Scene sudah dibuat. Player bisa bergerak dengan…  ▌
──────────────────────────────────────────────────
Berpikir… · 00:18 · 12,4k token masuk / 640 keluar   [Stop]
```

- **Reasoning:** teks abu-abu miring dan bisa dilipat. Terbuka saat streaming, otomatis terlipat saat `endedAt` terisi. Judulnya "Berpikir · X dtk". Jika model tidak mengirim reasoning, bagian ini tidak ditampilkan.
- **Tool:** satu baris berisi ikon status (berjalan / selesai / gagal), nama asli tool, dan ringkasan argumen. Ringkasannya `scenePath`, `command` untuk shell, atau baris pertama kode code-mode. Klik baris membuka argumen lengkap dan output (monospace, maksimal 4000 karakter).
- **Diff:** ditampilkan di bawah tool yang menghasilkannya, dicocokkan lewat `source.id` dan `tool call id` bila tersedia. Jika tidak cocok, tampil di akhir giliran.
- **Teks:** markdown dengan kursor berkedip selama streaming.
- **Footer status:** fase saat ini, waktu berjalan, dan token. Tombol Stop memanggil `agent:abort`.
- Auto-scroll hanya jika pengguna sedang berada di bawah. Jika pengguna menggulir ke atas, tampilkan tombol "↓ Terbaru".

### 6. Riwayat sesi (R9)

`getSessionMessages` dirombak menjadi `getSessionTurns(sessionId): AgentTurn[]`. Setiap pesan `user` membuka giliran baru. Pesan `assistant` setelahnya dipetakan bagian per bagian:

| `content[].type` | Part |
| --- | --- |
| `reasoning` | `reasoning` (`startedAt`/`endedAt` dari `time`) |
| `text` | `text` |
| `tool` (pemanggilan + hasil) | `tool` |

Bentuk persis bagian tool di `message.list` perlu dicek dengan satu sesi nyata sebelum implementasi. Ini dicatat di pertanyaan terbuka.

### 7. Viewport ikut berubah (R10)

Pada `diff_proposed` dengan `kind: 'scene'` dan `file` sama dengan scene yang sedang terbuka:

- Jika scene tidak punya perubahan yang belum disimpan, muat ulang dari disk (`SceneSerializer.deserialize` lewat jalur yang sama dengan Open Scene). Tampilkan toast "Scene diperbarui oleh Agent".
- Jika ada perubahan yang belum disimpan, jangan menimpa. Tampilkan banner "Agent mengubah scene ini · [Muat ulang] [Abaikan]".
- Pemuatan ulang masuk ke `CommandStack` sebagai satu entri ("Perubahan Agent"), sehingga Ctrl+Z mengembalikan scene sebelumnya.

Scene yang ditulis agent tetapi tidak sedang terbuka cukup diberi tanda di Asset Browser (titik "baru/diubah").

## File yang diubah

| File | Perubahan |
| --- | --- |
| `shared/agentTypes.ts` | Tipe `AgentPart`, `AgentTurn`, `AgentTurnPhase`, union `AgentEvent` baru |
| `electron/agent/AgentHost.ts` | Pemetaan event baru, set sesi yang dipantau, buffer giliran + throttle, `getSessionTurns`, snapshot |
| `shared/ipcChannels.ts`, `electron/main.ts`, `electron/preload.ts`, `src/vite-env.d.ts` | `agent:turn:snapshot`, `agent:session:turns` (mengganti `agent:session:messages`) |
| `editor/agent/agentEvents.ts` (baru) | Langganan tunggal, unsubscribe saat ganti proyek, sinkron snapshot |
| `editor/agent/agentStore.ts` | State `turns: AgentTurn[]`, reducer `part_upsert`/`part_append`/`turn_*`, hapus listener dari `init()` |
| `editor/panels/AgentPanel.tsx` + `editor/agent/TurnView.tsx` (baru) | Render timeline, reasoning yang bisa dilipat, baris tool, footer status |
| `editor/EditorLayout.tsx`, `editor/ui/Toolbar.tsx` | Pasang langganan, pindah ke tab Agent saat prompt wizard, indikator "Agent bekerja…", reload scene |
| `editor/windows/ProjectManagerWindow.tsx` | Jadikan sesi wizard aktif di store, jangan tutup tanpa memberi tahu `EditorLayout` |

## Kriteria penerimaan

- [ ] Prompt dengan model yang mengirim reasoning (mis. `opencode/flint-40b-free`): blok "Berpikir" muncul ≤ 1 detik setelah `session.reasoning.started` dan teksnya bertambah selama streaming.
- [ ] Antara klik Kirim dan token pertama, footer selalu menampilkan fase (`Menunggu model…`). Tidak pernah ada layar diam tanpa indikator.
- [ ] Tool code-mode tampil dengan nama asli (`linden.scene_apply`), bukan `execute`, beserta ringkasan argumen. Klik membuka input dan output lengkap.
- [ ] Setelah giliran selesai, reasoning (terlipat), tool, diff, dan teks tetap terlihat dalam urutan yang sama.
- [ ] Buat proyek via wizard: editor otomatis membuka tab Agent dan menampilkan giliran dari awal (`queued`). Tidak ada part yang hilang dibanding `message.list` OpenCode.
- [ ] Buka tab Agent di tengah giliran yang sedang berjalan: timeline langsung lengkap dari snapshot, lalu lanjut streaming.
- [ ] Ganti proyek dua kali lalu kirim prompt: setiap part muncul tepat sekali.
- [ ] Tutup dan buka editor, pilih sesi lama: reasoning, tool, dan teks tampil sama seperti saat live.
- [ ] Agent menulis scene yang sedang terbuka (tanpa perubahan lokal): viewport menampilkan entity baru ≤ 1 detik setelah diff. Ctrl+Z mengembalikan scene sebelumnya.
- [ ] Jawaban 20.000 karakter: jumlah pesan IPC `agent:event` ≤ 25/detik dan UI tetap responsif (scroll lancar).

## Pengujian

**Unit (Vitest)**
- `tests/agent/agentHost.test.ts`: urutan event OpenCode rekaman (reasoning → text → tool code-mode → success → execution.succeeded) menghasilkan urutan `turn_*`/`part_*` yang benar. Nama tool berganti dari `execute` ke `linden.scene_apply`. Event ganda tidak menduplikasi part. Event sesi anak masuk ke tool induk. Event dari sesi lain diabaikan.
- Throttle: 1.000 `session.text.delta` dalam 100 ms menghasilkan ≤ 3 `part_append` dengan teks gabungan yang identik.
- `getSessionTurns`: fixture `message.list` (reasoning + text + tool) dipetakan ke `AgentTurn`.
- Reducer store: `part_upsert`/`part_append`/`turn_ended` dan snapshot + event lanjutan.

**Integrasi manual**
- Jalankan `opencode serve` lokal dengan model gratis, buat proyek dari wizard, lalu bandingkan timeline panel dengan tampilan sesi yang sama di `opencode` TUI/web.

**Fixture event**
- Rekam satu giliran nyata dari `/api/event` ke `tests/fixtures/agent/turn-codemode.jsonl` sebagai sumber test, supaya perubahan format event OpenCode terdeteksi saat SDK di-upgrade.

## Pertanyaan terbuka

1. Bentuk bagian `tool` di `message.list` (untuk riwayat) belum diverifikasi. Cek dengan satu sesi yang memanggil tool sebelum menulis `getSessionTurns`.
2. Apakah reasoning juga perlu disimpan di `.linden/agent/`, atau cukup dari OpenCode? Usulan: cukup dari OpenCode, karena sudah persisten di database OpenCode.
3. Model yang tidak mengekspos reasoning (sebagian provider OpenAI-compatible): cukup tanpa blok Berpikir, atau tampilkan "Model tidak mengirim proses berpikir"? Usulan: tanpa blok, karena fase `Menunggu model…`/`Menulis…` sudah memberi umpan balik.
