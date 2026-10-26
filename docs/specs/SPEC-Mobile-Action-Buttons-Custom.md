# Spec: Tombol action mobile (hit, run, jump, dll.) yang bisa dikustom developer per proyek

Oct 26, 2026 · @accept

## Ringkasan

Kontrol sentuh mobile sudah ada (joystick analog + tombol JUMP/ATK/RUN/USE/Q/E, lihat `SPEC-Character-Movement-Input-Controls.md`). Developer juga sudah bisa mengubah posisi dan label tombol di tab **Kontrol Sentuh**. Namun kustomisasinya belum bisa diandalkan:

- Tombol baru tidak melakukan apa-apa.
- Mengganti id tombol memutus action-nya tanpa peringatan.
- Ikon terbatas pada 9 karakter teks.
- Ukuran tidak menyesuaikan layar.
- Script tidak bisa menyembunyikan tombol, mengganti label, atau menampilkan cooldown.

Spec ini menjadikan tombol action mobile sepenuhnya bisa dikustom developer per proyek:

1. **Tombol terhubung eksplisit ke action** (`action: "Attack"`), bukan lewat konvensi nama binding.
2. **Tampilan**: ikon bawaan atau gambar dari `assets/`, warna, bentuk, label, dan badge.
3. **Perilaku**: hold, tap, toggle, atau repeat, ditambah cooldown.
4. **Tata letak responsif** untuk ponsel dan tablet, dengan beberapa layout per proyek (mis. jalan kaki vs kendaraan).
5. **API runtime** untuk script: tampilkan/sembunyikan tombol, enable/disable, ganti label/ikon, cooldown, ganti layout.
6. **Editor** dengan pemilih action, pratinjau per perangkat, dan validasi. Agent juga mendapat tool untuk menambah tombol.

## Gejala

1. Developer menambah tombol "DASH" lewat **+ Tombol** di tab Kontrol Sentuh dan memainkannya di ponsel. Tombol muncul, tetapi tidak ada action yang terpicu.
2. Developer mengganti id tombol `Attack` menjadi `Hit` agar sesuai gamenya. Setelah itu tombol tidak lagi menyerang, tanpa pesan apa pun.
3. Tombol dihapus, tetapi binding `Touch/Button/<id>` masih tertinggal di action.
4. Dua tombol diberi id yang sama. Hanya satu yang berubah warna saat ditekan, dan keduanya berbagi status tekan.
5. Developer ingin ikon pedang dari `assets/ui/sword.png`. Yang tersedia hanya `jump`, `attack`, `run`, `use`, `crouch`, `turn-left`, `turn-right`, `up`, `down`.
6. Di tablet 1024×1366 tombol terlihat kecil dan menumpuk di sudut. Di ponsel kecil (320 px) tombol ATK dan USE saling menutupi.
7. Tombol USE seharusnya hanya muncul saat pemain dekat pintu, dan tombol ATK perlu menunjukkan cooldown 1,5 detik. Tidak ada cara melakukannya dari script.
8. Saat pemain naik kendaraan, tombol yang dibutuhkan berbeda (GAS, REM, KELUAR). Satu proyek hanya punya satu layout.
9. "Hit" harus terpicu sekali per ketukan, bukan terus-menerus selama ditahan. Pilihannya hanya "tahan" atau "toggle".

## Akar masalah

Diverifikasi terhadap kode lokal (26 Okt 2026):

| # | Masalah | Lokasi | Dampak |
| --- | --- | --- | --- |
| R1 | Tombol dan action hanya terhubung lewat konvensi nama: tombol menekan binding `Touch/Button/<id>`, dan action harus mencantumkan binding itu secara manual. **+ Tombol** membuat `Button<n>` tanpa menambahkan binding ke action mana pun. | `editor/windows/InputActionsWindow.tsx:518`, `player/touchControls.ts:231` | Tombol baru mati (gejala 1). |
| R2 | Mengedit id tombol hanya mengubah `buttons[i].id`. Binding di action tetap menunjuk id lama. | `editor/windows/InputActionsWindow.tsx:535` | Tombol berhenti bekerja setelah rename (gejala 2). |
| R3 | Menghapus tombol tidak membersihkan binding `Touch/Button/<id>` di action. | `editor/windows/InputActionsWindow.tsx` (tombol ✕ di daftar) | Binding yatim (gejala 3). |
| R4 | `normalizeTouchLayout` hanya memvalidasi format id, tidak memeriksa duplikat. `setButton` memakai `querySelector`, sehingga hanya elemen pertama yang diperbarui. | `engine/input/normalizeActions.ts:166`, `player/touchControls.ts:235` | Status dan tampilan tombol kacau (gejala 4). |
| R5 | Ikon berupa peta tetap 9 karakter Unicode. Tidak ada dukungan gambar, warna, atau bentuk. | `player/touchControls.ts:16`, `TouchButtonDef` di `engine/input/InputActions.ts:43` | Tombol tidak bisa mengikuti gaya visual game (gejala 5). |
| R6 | Posisi dan ukuran dalam piksel absolut dari sudut, tanpa skala menurut ukuran layar, tanpa satuan persen, dan tanpa deteksi tumpang-tindih. | `player/touchControls.ts` (`createButton`) | Layout rusak di tablet dan ponsel kecil (gejala 6). |
| R7 | Tidak ada API runtime untuk tombol. `TouchControls` hanya diakses `LindenPlayer`. `ctx` script tidak punya `touch`. | `player/player.ts` (`initInputs`), `engine/scripting/ScriptRuntime.ts` | Tombol tidak bisa kontekstual (gejala 7). |
| R8 | `TouchLayout` hanya satu per proyek. | `engine/input/InputActions.ts` (`TouchLayout`) | Tidak bisa beda layout per mode permainan (gejala 8). |
| R9 | Perilaku tombol hanya `hold` (default) atau `toggle: true`. | `TouchButtonDef.toggle`, `player/touchControls.ts:224` | Tidak ada tap sekali, repeat, atau cooldown (gejala 9). |
| R10 | Editor tidak memvalidasi layout (id ganda, tombol tanpa action, tumpang-tindih, tombol < 44 px, keluar layar, menutupi zona joystick). Pratinjau hanya 16:9/9:16 generik. | `editor/windows/InputActionsWindow.tsx` (`TouchLayoutEditor`) | Masalah baru ketahuan di perangkat. |
| R11 | Tool agent hanya bisa menimpa seluruh `input.touch` lewat `linden_input_actions`. | `electron/agent/lindenTools/index.ts:686` | Agent cenderung menghapus tombol bawaan saat menambah satu tombol. |

## Tujuan

- G1. Setiap tombol punya `action` eksplisit. Menambah, mengganti nama, atau menghapus tombol tidak pernah memutus action atau meninggalkan binding yatim.
- G2. Developer bisa mengatur label, ikon (bawaan atau gambar `assets/`), warna, bentuk, ukuran, dan posisi tiap tombol.
- G3. Perilaku per tombol: `hold`, `tap`, `toggle`, `repeat`, plus `cooldown` dengan indikator visual.
- G4. Layout tetap rapi dari ponsel 320 px sampai tablet 1366 px, dengan skala otomatis dan safe area. Editor memperingatkan tumpang-tindih dan target sentuh terlalu kecil.
- G5. Satu proyek bisa punya beberapa layout. Script bisa berganti layout dan mengubah tombol saat game berjalan.
- G6. Semua kustomisasi tersimpan di `project.linden.json` dan berlaku sama di Play viewport, build web, dan HTML Game (`linden.touch`).
- G7. Agent bisa menambah/mengubah satu tombol untuk satu action tanpa menyentuh tombol lain.

## Non-tujuan

- Haptic/vibration (dicatat untuk fase berikutnya; API disiapkan sebagai no-op).
- Gesture (swipe, pinch, double-tap) sebagai pemicu action.
- Editor layout visual di dalam Game View saat Play (pengaturan tetap lewat tab Kontrol Sentuh). Pemain mengatur ulang tombol di dalam game masuk fase opsional T5.
- Lokalisasi otomatis label (label tetap teks bebas dari developer).

## Desain

### 1. Model data tombol (v2)

`TouchButtonDef` di `engine/input/InputActions.ts` diperluas. Field lama tetap dibaca:

```ts
export type TouchButtonBehavior = 'hold' | 'tap' | 'toggle' | 'repeat'

export interface TouchButtonDef {
  id: string                       // unik dalam satu layout: [A-Za-z0-9_-]
  action: string                   // nama Input Action yang dipicu, mis. "Attack"
  label?: string                   // teks di tombol, mis. "HIT"
  icon?: string                    // ikon bawaan ("jump", "attack", "sword", ...) atau "asset:assets/ui/sword.png"
  behavior?: TouchButtonBehavior   // default 'hold'
  repeatInterval?: number          // detik, untuk 'repeat' (default 0.15)
  cooldown?: number                // detik; tombol nonaktif + sapuan radial setelah dipicu
  anchor?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'bottom-center' | 'top-center'
  x?: number                       // jarak dari jangkar; satuan sesuai `unit`
  y?: number
  unit?: 'px' | '%'                // px = piksel logis yang ikut diskalakan; % = persen sisi layar
  size?: number                    // diameter/sisi dalam px logis (diskalakan)
  shape?: 'circle' | 'rounded' | 'square'
  color?: string                   // #rrggbb atau rgba(); warna dasar
  pressedColor?: string
  textColor?: string
  opacity?: number                 // menimpa opacity layout
  visible?: boolean                // default true; bisa diubah script
  enabled?: boolean                // default true; bisa diubah script
  /** @deprecated diganti behavior: 'toggle' */
  toggle?: boolean
}

export interface TouchLayout {
  enabled: 'auto' | 'always' | 'never'
  joystick: { side: 'left' | 'right'; mode: 'floating' | 'fixed'; radius: number }
  look: { enabled: boolean; area: 'right-half'; sensitivity: number }
  buttons: TouchButtonDef[]
  opacity: number
  safeArea: boolean
  orientation?: 'landscape' | 'portrait'
  /** 'auto' = skala sisi pendek layar / 390 px, dibatasi 0.8..1.5; angka = skala tetap */
  scale?: 'auto' | number
}

/** Beberapa layout per proyek; "default" wajib ada */
export interface TouchConfig extends TouchLayout {
  layouts?: Record<string, Partial<TouchLayout>>  // mis. { vehicle: { buttons: [...], look: { enabled: false } } }
  initialLayout?: string                          // default "default"
}
```

Aturan koneksi tombol ↔ action (menutup R1–R3):

- Runtime membuat binding virtual `Touch/Button/<id>` dan **menambahkannya ke action `button.action` saat load** (di memori, tidak ditulis ke file). Developer tidak perlu lagi mencantumkannya di tab Actions.
- Binding `Touch/Button/<id>` yang ditulis manual di action tetap berfungsi (kompatibel ke belakang). Jika tombol sekaligus punya `action`, binding tidak digandakan.
- Karena koneksi ada di tombol, mengganti `id` atau menghapus tombol tidak lagi memengaruhi action.
- Migrasi v1 → v2 (`normalizeTouchLayout`), untuk tombol tanpa `action`:
  1. Jika ada action yang bindings-nya memuat `Touch/Button/<id>`, `action` diisi nama action tersebut dan binding manual itu dihapus dari action (dipindah ke tombol).
  2. Jika tidak, dan ada action yang namanya sama dengan `id`, `action = id`.
  3. Jika tidak keduanya, tombol tetap ada tetapi masuk daftar peringatan "tidak terhubung ke action".
- `toggle: true` dimigrasi ke `behavior: 'toggle'`.
- Validasi saat load:
  - id duplikat dalam satu layout: yang kedua diberi akhiran `_2` + peringatan;
  - `action` yang tidak ada di Input Actions: peringatan, tombol tetap tampil dalam keadaan nonaktif;
  - `icon` `asset:` di luar `assets/` atau bukan png/svg/webp: diabaikan + peringatan.

Contoh `project.linden.json`:

```json
"touch": {
  "enabled": "auto",
  "scale": "auto",
  "joystick": { "side": "left", "mode": "floating", "radius": 64 },
  "look": { "enabled": true, "area": "right-half", "sensitivity": 1 },
  "buttons": [
    { "id": "Hit", "action": "Attack", "label": "HIT", "icon": "asset:assets/ui/sword.png", "behavior": "tap", "cooldown": 0.6,
      "anchor": "bottom-right", "x": 110, "y": 40, "size": 72, "color": "#dc2626" },
    { "id": "Jump", "action": "Jump", "label": "JUMP", "icon": "jump", "anchor": "bottom-right", "x": 24, "y": 24, "size": 84 },
    { "id": "Run", "action": "Sprint", "label": "RUN", "icon": "run", "behavior": "toggle", "anchor": "bottom-right", "x": 30, "y": 130, "size": 56 },
    { "id": "Use", "action": "Interact", "label": "USE", "icon": "use", "visible": false, "anchor": "bottom-right", "x": 120, "y": 140, "size": 56 }
  ],
  "layouts": {
    "vehicle": {
      "look": { "enabled": false },
      "buttons": [
        { "id": "Gas", "action": "Accelerate", "label": "GAS", "anchor": "bottom-right", "x": 24, "y": 24, "size": 90, "shape": "rounded" },
        { "id": "Brake", "action": "Brake", "label": "REM", "anchor": "bottom-right", "x": 130, "y": 24, "size": 72, "shape": "rounded" },
        { "id": "Exit", "action": "Interact", "label": "KELUAR", "anchor": "top-right", "x": 16, "y": 16, "size": 52 }
      ]
    }
  }
}
```

### 2. Perilaku tombol (R9)

Implementasi di `player/touchControls.ts`, di atas binding virtual `Touch/Button/<id>`:

| `behavior` | Saat ditekan | Saat dilepas | Catatan |
| --- | --- | --- | --- |
| `hold` (default) | binding aktif | binding nonaktif | Untuk Sprint (tahan), Move-up/down, gas |
| `tap` | binding aktif **satu frame** (memakai tap latch `InputManager`) | — | Untuk Hit/Attack/Jump sekali per ketukan. Menahan tidak memicu ulang |
| `toggle` | aktif ↔ nonaktif bergantian | — | Untuk Run/Crouch toggle. Status terlihat (warna `pressedColor` menetap) |
| `repeat` | aktif satu frame, lalu satu frame tiap `repeatInterval` selama ditahan | berhenti | Untuk tembakan beruntun |

`cooldown` (detik): setelah dipicu, tombol mengabaikan sentuhan dan menampilkan sapuan radial (conic-gradient) serta sisa waktu sampai selesai. Cooldown bisa juga dipicu dari script (`ctx.touch.setCooldown`), misalnya agar cooldown sama untuk keyboard dan sentuh.

### 3. Tampilan dan tata letak responsif (R5, R6)

- **Ikon bawaan** diperluas dan dibuat sebagai SVG inline (bukan karakter teks) supaya konsisten di semua perangkat: `jump`, `attack`, `sword`, `shoot`, `run`, `use`, `crouch`, `dash`, `shield`, `reload`, `turn-left`, `turn-right`, `up`, `down`, `pause`, `menu`. Daftarnya di `player/touchIcons.ts`.
- **Ikon gambar**: `"asset:assets/ui/sword.png"` dimuat relatif terhadap root game (Play: protokol `linden-game://` sesi aktif; build web: folder `assets/` yang sudah disalin). Format yang diizinkan: png, svg, webp.
- **Gaya**: `shape` (lingkaran / kotak sudut membulat / kotak), `color`, `pressedColor`, `textColor`, `opacity`. Nilai warna divalidasi regex (hex/rgb[a]) sebelum masuk CSS.
- **Badge** (dari script, mis. sisa peluru "12") tampil di sudut kanan atas tombol.
- **Skala**:
  - `scale: 'auto'` menghitung `clamp(0.8, min(vw, vh) / 390, 1.5)`, lalu semua `px` logis (`x`, `y`, `size`, `joystick.radius`) dikalikan skala ini.
  - `unit: '%'` memakai persen lebar (untuk `x`) / tinggi (untuk `y`) layar.
  - Jangkar `bottom-center` / `top-center` untuk tombol di tengah (mis. PAUSE).
- **Safe area** tetap memakai `env(safe-area-inset-*)`.
- **Target sentuh minimum** 44 px setelah skala. Tombol yang lebih kecil diperbesar area sentuhnya (hit area), tanpa mengubah ukuran gambarnya.
- **Aksesibilitas**: `aria-label` = label, atau nama action jika label kosong.

### 4. Beberapa layout dan API runtime (R7, R8)

`layouts` menimpa field `default` per kunci. Untuk `buttons`, daftar layout menggantikan daftar default seluruhnya. Layout aktif awal = `initialLayout`. Scene bisa menetapkan `settings.touchLayout` yang dipakai saat scene dimuat.

API untuk script (`ctx.touch`) dan HTML Game (`linden.touch`). Semua fungsi aman dipanggil walaupun kontrol sentuh tidak tampil (no-op), sehingga logika game tidak perlu memeriksa perangkat:

```ts
interface TouchApi {
  readonly active: boolean                // kontrol sentuh sedang tampil
  readonly layout: string                 // nama layout aktif
  setLayout(name: string): void           // 'default' | nama di layouts
  show(id: string): void
  hide(id: string): void
  setEnabled(id: string, enabled: boolean): void
  setLabel(id: string, label: string): void
  setIcon(id: string, icon: string): void // ikon bawaan atau "asset:..."
  setBadge(id: string, text: string | number | null): void
  setCooldown(id: string, seconds: number): void
  /** Tombol untuk action tertentu, mis. sembunyikan semua tombol Interact */
  buttonsFor(action: string): string[]
  vibrate(ms: number): void               // no-op di fase ini
}
```

Contoh:

```ts
export default class Door {
  onTriggerEnter(other) { if (other.hasTag('Player')) this.ctx.touch.show('Use') }
  onTriggerExit(other)  { if (other.hasTag('Player')) this.ctx.touch.hide('Use') }
}
export default class Weapon {
  onUpdate() {
    if (this.ctx.input.isActionJustPressed('Attack') && this.ready) {
      this.swing()
      this.ctx.touch.setCooldown('Hit', 0.6)
      this.ctx.touch.setBadge('Hit', this.ammo)
    }
  }
}
```

Implementasi:

- `TouchControls` mendapat metode publik yang dibungkus `TouchApi` (`player/touchApi.ts`).
- `LindenPlayer` meneruskannya ke `ScriptRuntime` lewat opsi `createTouch`, mirip `createUi`.
- Headless (`linden_play`) memakai stub yang mencatat panggilan, supaya agent bisa melihat "tombol Use ditampilkan pada 2,3 s".
- Status tombol (visible/enabled/label/badge) direset saat scene berganti.

### 5. Editor: tab Kontrol Sentuh v2 (R1–R4, R10)

Perubahan di `editor/windows/InputActionsWindow.tsx` (`TouchLayoutEditor`):

- **Daftar tombol** dengan kolom **Action** (dropdown dari Input Actions proyek, ditambah opsi "+ Action baru…") di posisi pertama. **+ Tombol** meminta memilih action dulu, lalu mengisi id, label, dan ikon otomatis dari action (mis. Attack → id `Attack`, label `ATK`, ikon `attack`).
- Kolom id bisa diubah bebas tanpa memutus apa pun, karena koneksi ada di `action`.
- **Panel properti tombol** terpilih: label, ikon (galeri ikon bawaan + pemilih gambar dari `assets/`), behavior, repeat interval, cooldown, bentuk, warna/pressed/teks, opacity, ukuran, jangkar + x/y + satuan, visible/enabled awal.
- **Pratinjau perangkat**: preset iPhone SE (375×667), iPhone 15 (393×852), Pixel 8 (412×915), iPad (820×1180), masing-masing portrait/landscape. Tersedia overlay safe area dan zona joystick/look. Skala `auto` diterapkan persis seperti runtime, karena memakai fungsi tata letak yang sama (`computeTouchLayout()` di `engine/input/touchLayoutMath.ts`, dipakai editor dan player).
- **Validasi** (daftar di bawah pratinjau; klik untuk memilih tombolnya):
  - error: id ganda, action tidak ada, ikon asset tidak ditemukan;
  - peringatan: tombol saling tumpang-tindih atau keluar layar di salah satu preset, target sentuh < 44 px, tombol menutupi > 30% zona joystick, action Move/Look tidak bisa dipakai di tombol (tipe vector2).
- **Tab layout**: `default` + layout tambahan (tambah, ganti nama, duplikat, hapus). Field yang tidak diubah mewarisi `default`.
- **Migrasi**: saat proyek lama dibuka, editor menjalankan migrasi v1 → v2 (§1) dan menampilkan ringkasan sekali ("3 tombol dihubungkan ke action berdasarkan binding lama, 1 tombol belum terhubung").
- Semua perubahan tetap tersimpan otomatis lewat `project:saveInput`.
- Game View: toggle **Sentuh: On** juga menerima layout aktif dari dropdown kecil (uji layout `vehicle` tanpa mengubah kode).

### 6. Agent (R11)

- Tool baru `linden_touch_button`:
  ```json
  { "op": "upsert" | "remove", "layout": "default", "button": { "id": "Hit", "action": "Attack", "label": "HIT", "icon": "attack", "behavior": "tap", "cooldown": 0.6, "preset": "primary" } }
  ```
  `preset` (`primary`, `secondary`, `tertiary`, `top-right`, `top-left`) memilih posisi kosong yang tidak tumpang-tindih di semua preset perangkat. Tool menjalankan validasi §5 dan mengembalikan peringatan.
- `linden_input_actions` tetap menerima `touch` utuh, tetapi deskripsinya menyarankan `linden_touch_button` untuk perubahan per tombol.
- Prompt agent:
  - Setiap action yang dibutuhkan pemain mobile harus punya tombol.
  - Pakai `behavior: 'tap'` untuk serangan sekali pukul.
  - Pakai `ctx.touch.show/hide` untuk tombol kontekstual (Interact).
- `linden_play` melaporkan panggilan `ctx.touch` dan validasi layout.

### 7. Opsional (T5): kustomisasi oleh pemain

`touch.allowPlayerCustomize: true` menampilkan ikon ⚙ kecil di layar. Pemain bisa menggeser dan mengubah ukuran tombol, serta mengatur opacity. Hasilnya disimpan di `localStorage` per game (kunci `linden-touch:<nama game>`), dan ada tombol "Reset ke default". Layout developer tetap menjadi dasar.

## Rencana file

| File | Status | Isi |
| --- | --- | --- |
| `engine/input/InputActions.ts` | ubah | Tipe `TouchButtonDef` v2, `TouchConfig`. Binding virtual tombol → action saat `loadActions`/`setTouchConfig` |
| `engine/input/normalizeActions.ts` | ubah | Migrasi v1 → v2, validasi, `resolveLayout(config, name)` |
| `engine/input/touchLayoutMath.ts` | baru | Skala auto, satuan px/%, jangkar, deteksi tumpang-tindih (dipakai editor + player + agent) |
| `engine/input/defaultInput.ts` | ubah | Tombol default memakai `action` dan `behavior` |
| `player/touchControls.ts` | ubah | Perilaku tap/repeat/toggle, cooldown, badge, gaya, ikon gambar, skala, layout aktif |
| `player/touchIcons.ts` | baru | Ikon SVG bawaan |
| `player/touchApi.ts` | baru | `TouchApi` di atas `TouchControls`, plus stub untuk headless |
| `player/player.ts` | ubah | `createTouch` ke ScriptRuntime, `settings.touchLayout` per scene |
| `player/htmlBridge.ts` | ubah | `linden.touch` = `TouchApi` |
| `engine/scripting/ScriptRuntime.ts` | ubah | `ctx.touch` |
| `editor/windows/InputActionsWindow.tsx` | ubah | Tab Kontrol Sentuh v2 (§5) |
| `editor/viewport/GameFrame.tsx` | ubah | Pilihan layout saat Sentuh: On |
| `electron/agent/lindenTools/index.ts` | ubah | `linden_touch_button`, laporan `touch` di `linden_play` |
| `electron/agent/prompts/linden.md` | ubah | Aturan tombol mobile |

## Fase

| Fase | Isi | Kriteria selesai |
| --- | --- | --- |
| T1 — Koneksi eksplisit | `action` di tombol, binding virtual, migrasi v1, validasi id/action | Tombol baru langsung memicu action-nya. Rename/hapus tidak memutus action. Proyek lama tetap bekerja |
| T2 — Perilaku & tampilan | tap/toggle/repeat/cooldown, ikon SVG + gambar asset, gaya, skala auto, satuan % | HIT dengan `tap` + cooldown 0,6 s bekerja. Layout rapi di 320 px dan 1366 px |
| T3 — Editor | Tab Kontrol Sentuh v2, pratinjau perangkat, validasi, tab layout | Developer bisa membuat layout lengkap tanpa menyentuh JSON |
| T4 — Runtime API & layout ganda | `ctx.touch` / `linden.touch`, `layouts`, `settings.touchLayout` | USE muncul hanya dekat pintu. Ganti ke layout `vehicle` dari script |
| T5 — Agent & opsional pemain | `linden_touch_button`, prompt, kustomisasi pemain | Agent menambah tombol DASH tanpa menghapus tombol lain |

## Rencana tes

Unit (`vitest`):

- `tests/input/touchConfig.test.ts`:
  - migrasi v1 (binding manual → `action`, `id` = nama action, tombol yatim → peringatan);
  - id ganda → `_2`;
  - action tidak ada → peringatan;
  - `resolveLayout` mewarisi default;
  - binding virtual tidak menggandakan binding manual.
- `tests/input/touchLayoutMath.test.ts`:
  - skala auto (320 → 0.82, 390 → 1, 1366 → 1.5);
  - satuan %;
  - jangkar tengah;
  - deteksi tumpang-tindih;
  - target < 44 px.
- `tests/input/touchControls.test.ts` (DOM sintetis):
  - `tap` aktif tepat satu frame walau ditahan;
  - `repeat` memicu tiap interval;
  - `toggle` bertahan;
  - cooldown memblokir sentuhan dan selesai tepat waktu;
  - `hide` melepas tombol yang sedang ditekan;
  - ikon `asset:` membentuk URL di bawah `assets/`.
- `tests/scripting/scriptRuntime.test.ts`: `ctx.touch` no-op tanpa kontrol sentuh, dan stub headless mencatat panggilan.
- `tests/agent/agentTools.test.ts`: `linden_touch_button` upsert/remove menjaga tombol lain, `preset` tidak tumpang-tindih.

E2E (`tests/e2e/movement.e2e.mjs` diperluas, atau `tests/e2e/touchButtons.e2e.mjs`):

- TC-TOUCH-01: Tambah tombol "DASH" → action `Dash` di editor → Play dengan Sentuh: On → tap DASH → script membaca `Dash` aktif.
- TC-TOUCH-02: Ganti id `Attack` → `Hit` → tombol tetap memicu `Attack`.
- TC-TOUCH-03: HIT `tap` + cooldown 0,6 s: ditahan 1 detik = 1 kali `Attack`, dan tap kedua sebelum 0,6 s diabaikan.
- TC-TOUCH-04: Script `ctx.touch.show('Use')` saat masuk trigger pintu → tombol muncul. Keluar trigger → hilang.
- TC-TOUCH-05: Script `ctx.touch.setLayout('vehicle')` → tombol GAS/REM/KELUAR tampil, joystick tetap, look nonaktif.
- TC-TOUCH-06: Build web pada emulasi iPhone SE dan iPad → tidak ada tumpang-tindih (cek bounding box), ikon `asset:` termuat.

## Acceptance criteria

- [ ] Setiap tombol sentuh terhubung ke Input Action lewat field `action`. Menambah, mengganti id, dan menghapus tombol tidak pernah memutus action atau meninggalkan binding yatim.
- [ ] Developer bisa mengatur label, ikon bawaan/gambar asset, bentuk, warna, ukuran, posisi (px/%), perilaku (hold/tap/toggle/repeat), dan cooldown per tombol dari editor, tanpa menulis JSON.
- [ ] Layout diskalakan otomatis dan tetap bebas tumpang-tindih di ponsel kecil sampai tablet. Editor memperingatkan masalah layout sebelum game dimainkan.
- [ ] Script dan HTML Game bisa menampilkan/menyembunyikan, enable/disable, mengganti label/ikon/badge, memberi cooldown, dan mengganti layout saat game berjalan.
- [ ] Proyek bisa punya beberapa layout. Scene bisa menentukan layout awalnya.
- [ ] Proyek yang dibuat dengan format v1 tetap bekerja setelah migrasi otomatis.
- [ ] Agent bisa menambah atau menghapus satu tombol untuk satu action tanpa mengubah tombol lain.

## Pertanyaan terbuka

1. **`tap` untuk Jump default?** Jump saat ini `hold` (berguna untuk lompat variabel). Usulan: default Jump tetap `hold`, Attack menjadi `tap`.
2. **Kustomisasi oleh pemain (T5) masuk rilis ini atau ditunda?**
3. **Ikon gambar: perlu dukungan sprite sheet (satu gambar berisi beberapa ikon)?** Usulan: belum. Satu file per ikon cukup untuk fase ini.

## Status implementasi (26 Okt 2026)

T1–T4 selesai. Dari T5, tool agent `linden_touch_button` dan aturan prompt sudah dikerjakan. **Kustomisasi oleh pemain (§7) ditunda.**

Keputusan atas pertanyaan terbuka:

1. Jump tetap `hold`, Attack/HIT `tap`, Interact/USE `tap`.
2. Kustomisasi oleh pemain ditunda.
3. Sprite sheet tidak didukung; satu file per ikon.

Perbedaan dari desain:

- `TouchButtonDef.value` (−1/+1) ditambahkan untuk tombol yang memicu action **axis**, mis. Q/E → `Turn`. Tanpa field ini arahnya tidak diketahui.
- Peta default tidak lagi mencantumkan `Touch/Button/*` di bindings action. Semua tombol default memakai `action`.
- Id tidak valid disanitasi (karakter ilegal dibuang), bukan dibuang seluruhnya. Tombol yang id-nya kosong setelah sanitasi baru dilewati.
- Mengganti nama action di tab Actions ikut memperbarui `action` di semua tombol (semua layout).
- Validasi di editor menampilkan: id ganda, action tidak ada, ikon tidak valid, tumpang-tindih/keluar layar, tombol < 44 px, tombol menutupi joystick, dan tombol yang memakai action vector2.
- Properti tombol di editor tampil satu kolom, supaya tetap terbaca di jendela kecil.

Bug yang ditemukan dan diperbaiki saat pengujian:

- **`World.addComponent` menimpa `EventField`** (`onTriggerEnter`, `onCollisionEnter`, dst.) dengan array `listeners` hasil serialize. Akibatnya event trigger/collision tidak pernah sampai ke script di scene yang dimuat dari `.lscene` atau dikirim editor saat Play. Sekarang field tetap berupa `EventField` dan hanya listener-nya yang dipulihkan.
- **Character controller Rapier memperlakukan collider trigger sebagai dinding.** Pintu, koin, dan checkpoint menghalangi pemain. Sekarang sensor dikecualikan (`QueryFilterFlags.EXCLUDE_SENSORS`), dan event enter/exit tetap terkirim.

Pengujian:

- Unit: `tests/input/touchConfig.test.ts` (migrasi v1, id ganda, ikon/warna tidak valid, layout bernama, routing tombol → action termasuk axis) dan `tests/input/touchLayoutMath.test.ts` (skala, px/%, jangkar tengah, 44 px, tumpang-tindih/joystick/vector2, `placeButton`).
- Tambahan unit: `tests/agent/agentTools.test.ts` (`linden_touch_button`, `ctx.touch` di `linden_play`) dan `tests/movement/characterMovement.test.ts` (melewati trigger, round trip `EventField`).
- E2E Electron `npm run test:e2e:touch`: 13 skenario TC-TOUCH-01..06, termasuk build web di iPhone SE dan iPad.
- Unit test perilaku tombol di DOM belum ada, karena vitest belum punya DOM. Perilaku tap, cooldown, tampil/sembunyi, dan ganti layout diuji di E2E.
