# Spec: Toggle UI di viewport, klik sekali lagi untuk menyembunyikan UI dan melihat semua object

Nov 16, 2026 · @accept · branch `feat/ui-overlay-toggle`

## Ringkasan

Tombol **UI** di toolbar viewport menampilkan HTML UI (HUD, menu, panel) di atas scene. Saat statusnya **aktif** (biru), UI bisa menutupi object di scene, terutama UI layar penuh seperti main menu, panel inventori, atau background menu yang tidak transparan. Object hasil generate (dari agent, template, atau script) jadi tidak terlihat.

Perilaku yang diminta:

1. UI **aktif** → klik tombol **UI** → UI **nonaktif**: semua overlay HTML UI disembunyikan, semua object di scene terlihat tanpa tertutup.
2. UI **nonaktif** → klik **UI** lagi → UI aktif kembali di posisi dan state yang sama.

Toggle ini hanya mengubah **tampilan di editor**. Data scene, komponen `HtmlUI`, dan file fragment tidak berubah, dan game hasil export tetap menampilkan UI seperti biasa.

## Kondisi sekarang

### Mode Edit (Play berhenti)

`editor/viewport/SceneViewport.tsx` sudah punya toggle:

```tsx
const [showUiPreview, setShowUiPreview] = useState(true)
...
{playState === 'stopped' && showUiPreview && projectRuntime === 'scene' && <HtmlUiPreview />}
...
<button onClick={() => setShowUiPreview((v) => !v)} title="Tampilkan pratinjau HTML UI">UI</button>
```

`editor/viewport/HtmlUiPreview.tsx` merender setiap `HtmlUI` mode `screen` sebagai iframe sandbox di atas viewport (`z-10`, `pointer-events-none`). Toggle dasarnya sudah jalan, tetapi ada celah:

| # | Celah | Akibat |
|---|---|---|
| C1 | `showUiPreview` disimpan di `useState` lokal | Kembali ke aktif setiap kali `SceneViewport` di-mount ulang (buka project/scene lain, reload editor). User harus mematikannya lagi. |
| C2 | `title` tombol selalu "Tampilkan pratinjau HTML UI" dan tidak ada `aria-pressed` | Tidak jelas apakah klik berikutnya akan menyembunyikan atau menampilkan. |
| C3 | Tidak ada shortcut keyboard | Harus ke toolbar setiap kali ingin mengintip scene di balik UI. |
| C4 | Tidak ada tanda bahwa UI sedang disembunyikan | User bisa lupa UI dimatikan lalu mengira fragment-nya rusak/hilang. |

### Mode Play (Game Frame)

Selama Play, toolbar viewport disembunyikan (`playSession ? 'hidden'`) dan game berjalan di iframe `GameFrame`. UI game dirender oleh `engine/ui/HtmlUiLayer.ts` di dalam iframe:

- `screenRoot` (`#linden-ui-root`, `z-index: 10`) untuk `HtmlUI` mode `screen`;
- `worldRenderer` (CSS3DRenderer, `z-index: 9`) untuk mode `world`.

Toolbar Game Frame (Sentuh, Layout, rasio aspek, Reload, DevTools) **tidak punya** toggle UI. Object yang di-spawn script saat runtime (generate prosedural, spawner, dll.) hanya ada selama Play, sehingga di sinilah paling sering tertutup UI dan tidak bisa dilihat.

## Tujuan

1. **Mode Edit:** tombol **UI** berperilaku sebagai toggle yang jelas: aktif ↔ nonaktif, state bertahan per project.
2. **Mode Play:** tambah tombol **UI** di toolbar Game Frame dengan perilaku yang sama: nonaktif menyembunyikan seluruh UI game (screen **dan** world) tanpa menghentikan atau me-reload game.
3. Saat UI nonaktif, semua object di scene terlihat dan bisa diinteraksikan (klik/select di mode Edit, input game di mode Play).
4. Mengaktifkan kembali UI mengembalikan tampilan persis seperti sebelumnya: teks, nilai binding, elemen yang di-`show`/`hide` script tetap sama karena DOM tidak dihancurkan.

**Non-tujuan**

- Menyembunyikan UI di game hasil export (web/desktop). Toggle ini murni alat debug editor.
- Mengatur visibilitas per fragment/per entity. Bisa dilakukan lewat Inspector (`HtmlUI.enabled`) atau `ctx.ui.hide()`.
- Menyembunyikan kontrol sentuh (joystick/tombol). Sudah ada pengaturan **Sentuh: Off**.

## Solusi

### S1. State toggle disimpan di store (C1)

Pindahkan `showUiPreview` dari `useState` ke `editorStore`:

```ts
uiOverlayVisible: boolean          // default true
setUiOverlayVisible(v: boolean): void
toggleUiOverlay(): void
```

- Satu state dipakai bersama mode Edit dan mode Play, sehingga mematikan UI di Edit juga berlaku saat Play dimulai, dan sebaliknya.
- Simpan per project di `localStorage` dengan key `linden:uiOverlayVisible:<projectPath>` (preferensi editor, bukan data project; **tidak** ditulis ke `project.linden.json`). Bungkus baca/tulis dengan `try/catch`; bila gagal, pakai default `true`.

### S2. Tombol yang jelas (C2, C4)

Di `SceneViewport.tsx` dan `GameFrame.tsx`:

```tsx
<button
  aria-pressed={uiOverlayVisible}
  onClick={toggleUiOverlay}
  title={uiOverlayVisible ? 'Sembunyikan HTML UI (U)' : 'Tampilkan HTML UI (U)'}
>
  UI
</button>
```

- Aktif: `bg-blue-600 text-white` (sama dengan sekarang).
- Nonaktif: gaya tombol biasa, ditambah label kecil **"UI disembunyikan"** (pointer-events none) supaya user tahu UI sedang dimatikan, bukan rusak. Mode Edit: pojok kanan bawah viewport. Game Frame: pojok kanan atas, karena kanan bawah dipakai overlay statistik game.

### S3. Shortcut keyboard (C3)

Tombol **U** saat viewport fokus dan tidak sedang mengetik di input/textarea:

- Mode Edit: ditangani di handler keyboard viewport yang sudah ada. Pastikan tidak bentrok dengan shortcut Mesh Edit (E, I, X, M, P, Tab).
- Mode Play: keyboard dimiliki game, jadi **U tidak dipakai** di dalam iframe (game bisa memakai U). Di Play, toggle hanya lewat tombol toolbar Game Frame.

### S4. Toggle UI di Game Frame (mode Play)

**Protokol** (`shared/playProtocol.ts`): tambah pesan editor → game

```ts
{ type: 'linden:uiVisible', visible: boolean }
```

divalidasi di `parseEditorToGame` (`visible` harus boolean).

**Editor** (`editor/viewport/GameFrame.tsx`):

- Tombol **UI** di toolbar, di sebelah kiri pemisah sebelum **Reload**.
- Kirim `linden:uiVisible` setiap kali `uiOverlayVisible` berubah selama sesi aktif.
- Kirim juga sekali setelah `linden:init` (atau sertakan `uiVisible` di payload `linden:init`) supaya state awal ikut terbawa saat Play dimulai atau setelah **Reload**.

**Player** (`player/player.ts` → `engine/ui/HtmlUiLayer.ts`): tambah method

```ts
setVisible(visible: boolean): void {
  this.screenRoot.style.display = visible ? '' : 'none'
  if (this.worldRenderer) this.worldRenderer.domElement.style.display = visible ? '' : 'none'
}
```

- Sembunyikan **root** dengan `display: none`, bukan unmount per fragment: DOM, binding, dan state `show`/`hide` dari script tetap utuh, dan elemen yang tersembunyi tidak menerima klik sehingga klik jatuh ke canvas game.
- Jangan pakai `visibility: hidden`: setiap host fragment memakai `:host { all: initial }`, yang mengembalikan `visibility` ke `visible`, sehingga UI tetap tampil.
- `worldRenderer` dibuat lazily (`ensureWorldRenderer`); bila dibuat saat UI nonaktif, langsung ikut tersembunyi.
- `linden:uiVisible` bisa tiba sebelum `HtmlUiLayer` dibuat. `LindenPlayer` menyimpan nilainya dan menerapkannya begitu layer dibuat.
- Fragment baru yang di-mount atau di-hot-reload (`reloadFragments`) saat UI nonaktif ikut tersembunyi karena berada di dalam root yang sama.
- `ctx.ui` di script tetap berjalan normal (set teks, show/hide, event). Hanya tampilannya yang disembunyikan.
- Bila ada elemen UI yang sedang fokus saat disembunyikan, panggil `blur()` supaya Space/Enter kembali ke game.

### S5. Mode Edit tetap unmount

Di mode Edit, `HtmlUiPreview` boleh tetap di-unmount saat nonaktif (perilaku sekarang). Pratinjau tidak punya state script, dan unmount membuang iframe yang tidak terpakai.

## Kriteria lulus

| # | Skenario | Hasil yang diharapkan |
|---|---|---|
| U1 | Mode Edit, scene dengan `HtmlUI` layar penuh (background tidak transparan), UI aktif | UI terlihat, object di belakangnya tertutup |
| U2 | U1, klik **UI** | Semua overlay hilang; semua object di scene terlihat dan bisa diklik/select; tombol tidak biru; label "UI disembunyikan" muncul |
| U3 | U2, klik **UI** lagi | UI tampil kembali seperti U1; label hilang |
| U4 | U2, tekan **U** di viewport | Sama dengan U3 (toggle bolak-balik) |
| U5 | U2, buka scene lain lalu kembali, atau restart editor | UI tetap nonaktif untuk project ini; project lain tidak terpengaruh |
| U6 | Play, game punya main menu layar penuh, klik **UI** di toolbar Game Frame | Menu hilang, object yang di-spawn script terlihat; game tetap berjalan (tidak reload, skor/timer lanjut) |
| U7 | U6, klik canvas | Klik diterima game, bukan tombol menu yang tersembunyi |
| U8 | U6, script mengubah teks HUD lalu UI diaktifkan lagi | HUD menampilkan nilai terbaru |
| U9 | U6, `HtmlUI` mode `world` (label di atas object) | Ikut tersembunyi saat UI nonaktif dan tampil kembali saat aktif |
| U10 | UI dimatikan di mode Edit, lalu Play | Game mulai dengan UI tersembunyi; tombol UI di Game Frame berstatus nonaktif |
| U11 | U6, tekan **Reload** di Game Frame | Setelah reload UI tetap tersembunyi |
| U12 | Web export | UI tampil normal, tidak terpengaruh toggle editor |
| U13 | Mengetik di input fragment UI saat Play, tekan **U** | Huruf "u" masuk ke input; UI tidak tersembunyi |

## Test

- **Unit** (`tests/player/uiOverlayToggle.test.ts`): `toggleUiOverlay` membalik state; persist dan restore per `projectPath`; `localStorage` yang melempar error → default `true`.
- **Unit protokol** (file yang sama): `parseEditorToGame` menerima `linden:uiVisible` dengan boolean dan menolak payload lain.
- **Unit player** (DOM tiruan, file yang sama): `HtmlUiLayer.setVisible(false)` men-set `visibility: hidden` pada `screenRoot` dan `worldRenderer`; fragment yang di-mount setelahnya ikut tersembunyi; `setVisible(true)` mengembalikan; DOM dan binding tidak dihapus.
- **E2E** (`tests/e2e/uiOverlayToggle.e2e.mjs`, `npm run test:e2e:ui-toggle`): U1–U5 di mode Edit (hitung iframe `UI preview`), U6, U8–U11 di Play (baca `getComputedStyle(#linden-ui-root).display` di iframe game).
- **Manual:** U1–U13 di satu project dengan main menu layar penuh dan satu project dengan spawner runtime (lihat `~/Documents/Linden Projects`).

## Rencana implementasi

1. S1 + S2: pindah state ke store, persist per project, tombol dengan `aria-pressed`, title dinamis, label "UI disembunyikan". Menutup U1–U3, U5.
2. S3: shortcut **U** di mode Edit. Menutup U4.
3. S4: `linden:uiVisible`, tombol di Game Frame, `HtmlUiLayer.setVisible`. Menutup U6–U11, U13.
4. Test unit + e2e, verifikasi manual U1–U13.

## Pertanyaan terbuka

1. **State bersama Edit dan Play** (S1): apakah mematikan UI di mode Edit memang harus ikut berlaku saat Play? Alternatifnya, Play selalu mulai dengan UI aktif supaya game diuji seperti aslinya. Spec ini memilih state bersama karena tujuannya melihat object, bukan menguji UI.
2. **Shortcut U**: per 16 Nov 2026 belum ada shortcut `U`/`KeyU` di `editor/`. Bila nanti bentrok, alternatifnya `Shift+U`.

## Status implementasi (16 Nov 2026)

Semua solusi S1–S5 sudah dikerjakan di branch `feat/ui-overlay-toggle`. Pertanyaan terbuka dijawab dengan pilihan default spec: state dibagi antara Edit dan Play, shortcut `U`.

| Bagian | File |
|---|---|
| Preferensi per project (localStorage) | `editor/viewport/uiOverlayPreference.ts` |
| State `uiOverlayVisible`, `setUiOverlayVisible`, `toggleUiOverlay`; dimuat di `setProject`, di-reset di `closeProject` | `editor/store/editorStore.ts` |
| Tombol UI (`aria-pressed`, title dinamis), label, shortcut `U` | `editor/viewport/SceneViewport.tsx` |
| Tombol UI di Game Frame, kirim `linden:uiVisible` saat berubah dan setelah `linden:init` | `editor/viewport/GameFrame.tsx` |
| Pesan `linden:uiVisible` | `shared/playProtocol.ts`, `player/main.ts` |
| `LindenPlayer.setUiVisible`, `HtmlUiLayer.setVisible` | `player/player.ts`, `engine/ui/HtmlUiLayer.ts` |

Hasil test:

- Unit `tests/player/uiOverlayToggle.test.ts`: 11 test lulus. Seluruh suite: 89 file, 824 test lulus.
- E2E `npm run test:e2e:ui-toggle` di Electron: 14/14 lulus (U1–U6, U8–U11). Screenshot memastikan box di belakang menu layar penuh terlihat saat UI nonaktif, di mode Edit maupun Play.
- Belum diuji otomatis: U7 (klik jatuh ke canvas), U12 (web export), U13 (mengetik "u" di input UI saat Play). U12 dan U13 aman secara desain: web export tidak menerima pesan editor, dan shortcut `U` hanya dipasang di window editor, bukan di iframe game.

