# Spec: Kontrol movement karakter (W A S D Q E), analog sentuh untuk mobile, dan input action

Oct 26, 2026 · @accept

## Ringkasan

Game Linden belum punya cara standar untuk menggerakkan karakter. Setiap game harus menulis sendiri script movement, dan input dasarnya pun belum andal:

- Di mobile, tombol sentuh tampil tetapi tidak menggerakkan apa pun.
- Input Actions yang diedit di editor tidak tersimpan ke proyek.
- Tool agent menulis Input Actions dalam format yang tidak dibaca runtime.

Spec ini menambahkan:

1. **Peta input default** yang konsisten untuk keyboard, gamepad, dan sentuh: W A S D (+ panah) untuk bergerak, Q/E untuk berputar (atau turun/naik di mode terbang), serta action Jump, Sprint, Crouch, Interact, Attack.
2. **Kontrol sentuh analog untuk mobile**: joystick virtual dengan nilai analog 0..1 dan tombol action yang dikonfigurasi dari proyek, bukan dari kode.
3. **Komponen `CharacterMovement`**: movement karakter siap pakai yang membaca input action, sehingga game bisa jalan tanpa menulis script movement.
4. Perbaikan alur Input Actions dari editor sampai Play dan build web.

## Gejala

1. Build web dibuka di ponsel. D-pad dan tombol JUMP muncul, tetapi karakter tidak bergerak dan tidak melompat.
2. Di editor, buka **Window → Input Actions**, tambah action `Sprint` (Shift), lalu tutup proyek dan buka lagi. Action `Sprint` hilang.
3. Proyek yang `project.linden.json`-nya punya action custom: saat Play di viewport, action itu tidak dikenali (`[InputManager] Action "Sprint" is not registered`). Di build web action yang sama dikenali.
4. Agent memanggil `linden_input_actions`. File tersimpan, tetapi tidak satu pun action-nya merespons tombol.
5. Tombol panah tidak menggerakkan `Move`. Tidak ada binding Q/E.
6. Setiap game hasil agent menulis ulang script movement (kecepatan, gravitasi, lompat, rotasi), dan hasilnya berbeda-beda serta sering keliru. Contohnya karakter dinamis yang meluncur, atau lompat di udara berkali-kali.
7. Di ponsel tidak bisa berjalan pelan: D-pad hanya memberi nilai 0 atau 1.

## Akar masalah

Diverifikasi terhadap kode di `main` + perubahan lokal (26 Okt 2026):

| # | Masalah | Lokasi | Dampak |
| --- | --- | --- | --- |
| R1 | D-pad sentuh mengirim `KeyboardEvent` dengan `key: 'move_up'/'move_left'/...` dan tombol JUMP dengan `key: 'jump'`. Input membentuk binding `Keyboard/move_up` dan `Keyboard/jump`, yang tidak dipetakan ke action mana pun (default `Move` = `Keyboard/KeyW...`, `Jump` = `Keyboard/Space`). | `player/touchControls.ts:78-131`, `player/player.ts` (`initInputs`) | Kontrol sentuh tidak berfungsi sama sekali (G1). |
| R2 | Tata letak sentuh di-hardcode (D-pad 4 arah + JUMP), tidak mengikuti action proyek, dan tidak punya input analog. `onAxis` dideklarasikan tetapi tidak pernah dipanggil. | `player/touchControls.ts` | Tidak ada joystick dan tidak bisa menambah tombol Sprint/Attack (G7). |
| R3 | `InputActionsWindow` hanya menyimpan ke `projectSettings.inputActions` di memori. IPC `project:saveSettings` ada di main tetapi tidak pernah dipanggil editor. | `editor/windows/InputActionsWindow.tsx:13`, `electron/main.ts:780` | Perubahan Input Actions hilang (G2). |
| R4 | Saat proyek dibuka, `setProject` menggabungkan config ke `projectSettings`, tetapi `config.input.actions` tidak pernah disalin ke `projectSettings.inputActions`. `GameFrame` mengirim `projectSettings.inputActions` (default store) ke game. | `editor/store/editorStore.ts` (`setProject`), `editor/viewport/GameFrame.tsx:66` | Play memakai action default, bukan milik proyek. Play dan build web berbeda (G3). |
| R5 | `linden_input_actions` menerima `{ name, keys, description }` dan menulisnya apa adanya. Runtime (`InputActionDef`) membaca `{ name, type, bindings, composite }`. Test agent memakai bentuk ketiga, `bindings: [{ device, path }]`. | `electron/agent/lindenTools/index.ts:576`, `tests/agent/agentTools.test.ts` | Action dari agent tidak pernah aktif (G4). |
| R6 | `composite` hanya satu set `up/down/left/right` dengan satu tombol per arah. Tidak bisa WASD + panah sekaligus. Alias tombol di-hardcode untuk W/A/S/D saja. | `engine/input/InputActions.ts` (`getVector`, `isBindingActive`) | Panah tidak bekerja (G5). |
| R7 | Tipe `axis` hanya menjumlahkan binding (semua positif). Tidak ada pasangan negatif/positif, padahal Q/E untuk putar kiri/kanan membutuhkannya. | `engine/input/InputActions.ts` (`getAxisRaw`) | Q/E tidak bisa dipetakan sebagai satu sumbu. |
| R8 | Tidak ada komponen movement. `CharacterController` hanya membungkus `moveCharacter(delta)` tanpa gravitasi, lompat, kecepatan, atau orientasi. | `engine/physics/components.ts:135`, `engine/physics/RapierBackend.ts:282` | Setiap game menulis movement sendiri (G6). |
| R9 | Gamepad hanya membaca tombol 0 dan stik kiri. Stik kanan, bumper, dan trigger tidak dipetakan. | `engine/input/InputActions.ts` (`pollGamepads`) | Gamepad tidak bisa berputar, sprint, atau menyerang. |
| R10 | `engine/input/InputMap.ts` (gaya Godot) adalah sistem input kedua yang hanya dipakai test parity, bukan runtime. | `engine/input/InputMap.ts` | Dua sumber kebenaran untuk input. |
| R11 | Kontrol sentuh hanya dipasang jika perangkat mendukung sentuh. Tidak ada cara menguji layout mobile di viewport editor. | `player/touchControls.ts:23` | Layout mobile baru ketahuan rusak setelah dibuka di ponsel. |

## Tujuan

- G1. Di ponsel/tablet, karakter bisa bergerak dengan joystick analog (miring sedikit = jalan pelan) dan melakukan action lewat tombol sentuh, tanpa kode tambahan.
- G2. Keyboard: W A S D dan panah untuk bergerak, Q/E untuk berputar (atau turun/naik di mode terbang), Space lompat, Shift sprint, C crouch, F interact, klik kiri attack. Semua bisa diubah di Input Actions.
- G3. Satu sumber kebenaran: `project.linden.json → input`. Editor, Play di viewport, `linden_play`, dan build web memakai data yang sama.
- G4. Komponen `CharacterMovement` membuat karakter bisa berjalan, berlari, melompat, berputar, dan (opsional) terbang hanya dengan menambahkan komponen, tanpa menulis script.
- G5. Script dan HTML Game bisa membaca input yang sama, termasuk nilai analog dan sumber input terakhir (keyboard/gamepad/sentuh).
- G6. Agent menulis Input Actions dalam format yang benar dan memakai `CharacterMovement` untuk game berkarakter.

## Non-tujuan

- Rebinding tombol oleh pemain di dalam game (menu pengaturan kontrol). Data model sudah mendukungnya; UI-nya di fase berikutnya.
- Kamera orbit/third-person lengkap (collision kamera, zoom). Spec ini hanya mencakup look sederhana (§5.4).
- Input multipemain lokal (beberapa gamepad untuk beberapa karakter).
- Haptic/vibration di mobile.
- Gesture kompleks (pinch, double-tap) selain joystick, tombol, dan area look.

## Desain

### 1. Peta input default

Proyek baru (semua template scene) dan proyek lama tanpa `input.actions` mendapat peta default berikut. Proyek lama yang sudah punya action tetap memakai milik mereka. Action default yang belum ada hanya ditambahkan lewat tombol **Tambahkan action default** di Input Actions, tidak otomatis.

| Action | Tipe | Keyboard / mouse | Gamepad (standar) | Sentuh |
| --- | --- | --- | --- | --- |
| `Move` | vector2 | W A S D, panah | Stik kiri | Joystick kiri (analog) |
| `Turn` | axis | Q (−) / E (+) | Bumper L (−) / R (+) | Tombol ⟲ ⟳ (opsional) |
| `Vertical` | axis | Q (−) / E (+) | Trigger L (−) / R (+) | Tombol ▼ ▲ (mode terbang) |
| `Look` | vector2 | Gerak mouse (saat pointer lock) | Stik kanan | Seret di separuh kanan layar |
| `Jump` | button | Space | A / Cross | Tombol JUMP |
| `Sprint` | button | Shift kiri | Tekan stik kiri (L3) | Joystick didorong penuh (≥ 0.9), atau tombol RUN |
| `Crouch` | button | C, Ctrl kiri | B / Circle | Tombol CROUCH (opsional) |
| `Interact` | button | F | X / Square | Tombol USE |
| `Attack` | button | Klik kiri | Y / Triangle, trigger R | Tombol ATK |

Keputusan untuk Q/E: Q/E dipetakan ke **dua** action, `Turn` dan `Vertical`. Yang dibaca `CharacterMovement` ditentukan propertinya `qeMode` (§4). Default `turn` untuk karakter darat. Mode terbang/berenang memakai `vertical` (Q turun, E naik). Script bebas membaca keduanya.

Catatan: E sering dipakai sebagai "interact" di game PC. Karena permintaan ini memakai E untuk movement, `Interact` dipindah ke F. Proyek bisa mengubahnya di Input Actions.

### 2. Model data Input Actions

Perluas `InputActionDef` di `engine/input/InputActions.ts` dengan bentuk yang tetap kompatibel ke belakang:

```ts
export interface Vector2Composite { up?: string[]; down?: string[]; left?: string[]; right?: string[] }
export interface AxisComposite { negative?: string[]; positive?: string[] }

export interface InputActionDef {
  name: string
  type: 'button' | 'axis' | 'vector2'
  /** Binding langsung: 'Keyboard/Space', 'Mouse/LeftButton', 'Gamepad/ButtonSouth', 'Gamepad/LeftStick', 'Touch/Joystick', 'Touch/Button/Jump' */
  bindings?: string[]
  /** vector2: tombol per arah; axis: pasangan negatif/positif. Beberapa set boleh (WASD + panah) */
  composites?: (Vector2Composite | AxisComposite)[]
  /** @deprecated satu set up/down/left/right bertipe string; dimigrasi ke composites saat load */
  composite?: { up?: string; down?: string; left?: string; right?: string }
  deadzone?: number        // default 0.15 untuk stik/joystick
  sensitivity?: number     // pengali untuk Look (mouse/drag), default 1
  /** button: dianggap ditekan jika nilai analog sumbernya ≥ threshold (mis. Sprint dari joystick penuh) */
  pressThreshold?: number
}
```

Contoh di `project.linden.json`:

```json
{
  "input": {
    "actions": [
      {
        "name": "Move",
        "type": "vector2",
        "composites": [
          { "up": ["Keyboard/KeyW"], "down": ["Keyboard/KeyS"], "left": ["Keyboard/KeyA"], "right": ["Keyboard/KeyD"] },
          { "up": ["Keyboard/ArrowUp"], "down": ["Keyboard/ArrowDown"], "left": ["Keyboard/ArrowLeft"], "right": ["Keyboard/ArrowRight"] }
        ],
        "bindings": ["Gamepad/LeftStick", "Touch/Joystick"],
        "deadzone": 0.15
      },
      {
        "name": "Turn",
        "type": "axis",
        "composites": [{ "negative": ["Keyboard/KeyQ", "Gamepad/LeftShoulder", "Touch/Button/TurnLeft"], "positive": ["Keyboard/KeyE", "Gamepad/RightShoulder", "Touch/Button/TurnRight"] }]
      },
      { "name": "Jump", "type": "button", "bindings": ["Keyboard/Space", "Gamepad/ButtonSouth", "Touch/Button/Jump"] },
      { "name": "Sprint", "type": "button", "bindings": ["Keyboard/ShiftLeft", "Gamepad/LeftStickPress", "Touch/Button/Sprint", "Touch/Joystick"], "pressThreshold": 0.9 }
    ],
    "touch": { "...": "lihat §3" }
  }
}
```

Aturan:

- **Nama binding** memakai `KeyboardEvent.code` (`Keyboard/KeyW`, `Keyboard/ArrowLeft`, `Keyboard/ShiftLeft`). `Keyboard/W` lama dinormalisasi ke `Keyboard/KeyW` saat load, menggantikan alias hardcode (R6).
- **Gamepad** memakai nama standar W3C: `ButtonSouth/East/West/North`, `LeftShoulder`, `RightShoulder`, `LeftTrigger`, `RightTrigger` (analog), `LeftStickPress`, `RightStickPress`, `Start`, `Select`, `DPadUp/Down/Left/Right`, `LeftStick`, `RightStick` (R9).
- **Sentuh**: `Touch/Joystick` (vector2 analog dari joystick kiri), `Touch/Look` (delta seret di area look), dan `Touch/Button/<Id>` (tombol yang didefinisikan di `input.touch.buttons`).
- **Nilai vector2** adalah jumlah semua sumber, lalu diberi deadzone, lalu panjangnya dibatasi ≤ 1. Nilai analog dipertahankan, sehingga joystick setengah = 0.5 (G1, gejala 7). Diagonal keyboard dinormalisasi ke panjang 1.
- **Nilai axis** = Σ positive − Σ negative, dibatasi ke −1..1. Trigger memberi nilai analog.
- Fungsi migrasi `normalizeInputActions(raw)` di `engine/input/normalizeActions.ts` membaca tiga bentuk lama yang ada di repo, lalu mengembalikan bentuk baru plus daftar peringatan. Ketiga bentuk itu:
  - `composite` string tunggal;
  - `{ name, keys }` dari tool agent lama;
  - `bindings: [{ device, path }]` dari test agent.

  Fungsi ini dipakai saat proyek dibuka, oleh `Input.loadActions`, oleh tool agent, dan oleh web build. Ini menutup R5.

API baru di `InputManager` (dipakai script lewat `ctx.input`):

```ts
getVector(name): { x: number; y: number }      // analog, sudah deadzone
getAxis(name): number                           // overload baru: satu action bertipe axis
getAxis(negativeAction, positiveAction): number // bentuk lama tetap ada
isActionPressed / isActionJustPressed / isActionJustReleased(name)
getActionStrength(name): number                 // 0..1 (analog untuk button dari trigger/joystick)
lastDevice: 'keyboard' | 'gamepad' | 'touch'    // untuk menampilkan ikon tombol yang sesuai
setVirtualAxis(binding, x, y) / setVirtualButton(binding, down)  // dipakai TouchControls, bukan KeyboardEvent palsu
```

`TouchControls` tidak lagi memalsukan `KeyboardEvent`. Ia menulis langsung ke `InputManager` lewat `setVirtualAxis` / `setVirtualButton`, sehingga nama binding sentuh tidak bisa bentrok dengan keyboard (R1).

`InputMap.ts` ditandai `@deprecated`. Fungsi gaya Godot (`is_action_pressed`, dst.) dijadikan pembungkus tipis di atas `Input` supaya test parity tetap lulus (R10).

### 3. Kontrol sentuh mobile

#### 3.1 Konfigurasi

```json
"touch": {
  "enabled": "auto",
  "joystick": { "side": "left", "mode": "floating", "radius": 64, "deadzone": 0.12 },
  "look": { "enabled": true, "area": "right-half", "sensitivity": 1.0 },
  "buttons": [
    { "id": "Jump", "label": "JUMP", "icon": "jump", "anchor": "bottom-right", "x": 24, "y": 32, "size": 72 },
    { "id": "Attack", "label": "ATK", "anchor": "bottom-right", "x": 112, "y": 48, "size": 60 },
    { "id": "Sprint", "label": "RUN", "anchor": "bottom-right", "x": 40, "y": 120, "size": 52, "toggle": false },
    { "id": "Interact", "label": "USE", "anchor": "bottom-right", "x": 120, "y": 128, "size": 52 }
  ],
  "opacity": 0.6,
  "safeArea": true
}
```

- `enabled`: `"auto"` (tampil di perangkat sentuh), `"always"`, atau `"never"`.
- `joystick.mode`:
  - `floating` (default): joystick muncul di titik sentuh pertama pada separuh kiri layar.
  - `fixed`: posisi tetap di sudut kiri bawah.
- Tiap tombol menghasilkan binding `Touch/Button/<id>`. Action dihubungkan lewat binding tersebut di Input Actions. Tombol baru di template default sudah terhubung ke action yang namanya sama.
- `toggle: true` membuat tombol berperilaku tahan/lepas otomatis (mis. Crouch).
- `safeArea` menghormati `env(safe-area-inset-*)` untuk notch/home indicator.

#### 3.2 Implementasi (`player/touchControls.ts`, ditulis ulang)

- Memakai **Pointer Events** dengan pelacakan `pointerId`, jadi multi-touch bisa: joystick + JUMP + look bersamaan. `touch-action: none` di area kontrol.
- **Joystick**: base + knob dalam satu SVG/DOM ringan. Nilai = offset / radius dibatasi panjang 1, sumbu Y dibalik (atas = +1). Deadzone radial dengan remap halus `(m − dz) / (1 − dz)`. Nilai ditulis tiap `pointermove`. Saat `pointerup`/`pointercancel`/`blur`, nilai kembali ke 0.
- **Look**: delta seret di area kanan yang tidak menyentuh tombol, dikalikan `sensitivity`. Ditulis sebagai `Touch/Look` dan di-reset ke 0 tiap frame setelah dibaca, seperti delta mouse.
- **Tombol**: `setVirtualButton('Touch/Button/<id>', down)`. Ada umpan balik visual saat ditekan. Label dari `label`, ikon opsional dari set bawaan (jump, attack, run, use, crouch, turn-left, turn-right, up, down).
- Kontrol dipasang di layer `#linden-touch-root` di atas canvas dan di bawah HTML UI (z-index 20). `pointer-events` hanya aktif pada elemen kontrol, sehingga HUD `HtmlUI` tetap bisa diklik.
- Jika `orientation` portrait dan game meminta landscape (`touch.orientation: "landscape"`), tampil petunjuk "Putar perangkat".
- Bentuk dan nilai ditampilkan dengan aturan yang sama di Play editor dan build web, karena keduanya memakai `LindenPlayer`.

#### 3.3 Uji di editor

- Toolbar Game View (`editor/viewport/GameFrame.tsx`) mendapat toggle **Kontrol Sentuh** (`auto`/`on`/`off`). Saat `on`, game di-init dengan `touch.enabled: "always"`, dan joystick/tombol bisa dimainkan dengan mouse (Pointer Events sudah menangani mouse). Ini menutup R11.
- Rasio `9:16 Mobile` yang sudah ada otomatis menyalakan toggle ini (bisa dimatikan).
- Panel **Input Actions** mendapat tab **Sentuh** untuk mengatur posisi tombol dengan drag di pratinjau 9:16/16:9. Hasilnya disimpan ke `input.touch.buttons`.

### 4. Komponen `CharacterMovement`

Komponen baru di `engine/movement/CharacterMovement.ts`, didaftarkan di `ComponentRegistry` (`Gameplay/Character Movement`). Ia membutuhkan `CharacterController`, atau `Rigidbody` dinamis sebagai alternatif (`requires` otomatis menambahkan `CharacterController` + `CapsuleCollider` + `Rigidbody` kinematic jika belum ada).

| Properti | Default | Keterangan |
| --- | --- | --- |
| `moveAction` | `"Move"` | Action vector2 untuk arah gerak |
| `turnAction` / `verticalAction` | `"Turn"` / `"Vertical"` | Action axis untuk Q/E |
| `jumpAction` / `sprintAction` / `crouchAction` | `"Jump"` / `"Sprint"` / `"Crouch"` | Action button |
| `mode` | `"walk"` | `walk` (gravitasi), `fly` (tanpa gravitasi, Q/E naik turun), `topdown` (tanpa lompat, XZ saja) |
| `qeMode` | `"turn"` | `turn`: Q/E memutar karakter; `vertical`: Q/E turun/naik; `strafe`: Q/E geser kiri/kanan |
| `walkSpeed` / `sprintSpeed` / `crouchSpeed` | 4 / 7 / 2 m/s | Kecepatan maksimum |
| `acceleration` / `deceleration` | 30 / 40 m/s² | Respons input (karakter tidak langsung berhenti total) |
| `airControl` | 0.4 | Porsi kontrol saat di udara |
| `jumpHeight` | 1.2 m | Kecepatan awal dihitung `sqrt(2·g·h)` |
| `gravity` | 20 m/s² | Gravitasi karakter (lebih "game-like" dari 9.81) |
| `coyoteTime` / `jumpBuffer` | 0.1 / 0.1 s | Lompat tetap bisa sesaat setelah jatuh dari tepi / sesaat sebelum mendarat |
| `maxJumps` | 1 | 2 = double jump |
| `turnSpeed` | 180 °/s | Kecepatan putar Q/E dan stik/joystick saat `turn` |
| `orientToMovement` | `true` | Karakter menghadap arah gerak (dihaluskan `rotationSmoothing`) |
| `cameraRelative` | `true` | W = maju relatif arah kamera aktif. Jika `false`, relatif dunia (W = −Z) |
| `analogWalk` | `true` | Kecepatan sebanding besar vektor input (joystick setengah = setengah kecepatan) |

Perilaku per fixed step (dijalankan sistem `CharacterMovementSystem` di `GameSimulation.fixedStep`, sebelum `physics.step`):

1. Baca `Move` → vektor 2D. Jika `cameraRelative`, putar dengan yaw kamera aktif. `LindenPlayer` mengisi `GameSimulation.viewYaw` dari entity Camera aktif tiap frame. Headless memakai 0.
2. Hitung kecepatan target dari mode (walk/sprint/crouch) × `|input|` (jika `analogWalk`). Arah horizontal mendekati target dengan `acceleration`/`deceleration`, dan dikalikan `airControl` di udara.
3. Q/E sesuai `qeMode`:
   - `turn`: yaw += axis × `turnSpeed` × dt. `orientToMovement` dimatikan sementara selama ada input putar.
   - `vertical`: kecepatan Y = axis × `walkSpeed` (mode `fly`).
   - `strafe`: ditambahkan ke sumbu X lokal.
4. Gravitasi dan lompat:
   - `vy −= gravity·dt`.
   - Jika `Jump` baru ditekan (atau tersimpan di `jumpBuffer`), dan karakter grounded atau masih dalam `coyoteTime`, atau `jumps < maxJumps`, maka `vy = sqrt(2·g·jumpHeight)`.
5. Gerakkan:
   - Dengan `CharacterController`: `controller.move(v·dt)` → Rapier KCC (autostep, snap to ground, slope dari `slopeLimit`). `isGrounded` diambil dari hasilnya. Saat grounded, `vy` di-reset ke nilai kecil negatif.
   - Dengan `Rigidbody` dinamis: `setLinearVelocity({ x, y: vy, z })`. Rotasi dikunci X/Z. Grounded dari raycast pendek ke bawah.
6. Orientasi: jika `orientToMovement` dan |v_horizontal| > 0.1, yaw berinterpolasi ke `atan2(vx, vz)`.

Bersamaan dengan ini, `RapierBackend.moveCharacter` memakai `slopeLimit`/`stepOffset` dari komponen alih-alih konstanta 0.3/0.5, dan membuat body kinematic-position untuk karakter.

Keadaan yang bisa dibaca script (`ctx.entity.getComponent('CharacterMovement')` atau `ctx.movement`):

```ts
isGrounded: boolean; velocity: Vec3; speed: number; isSprinting: boolean; isCrouching: boolean; jumpsUsed: number
enabled: boolean                    // script bisa mematikan movement (cutscene, mati)
addImpulse(v: Vec3): void           // knockback, jump pad
teleport(pos: Vec3): void
```

Event untuk script: `onJump`, `onLand(fallSpeed)`, `onStartSprint`, `onStopSprint`, dikirim ke script di entity yang sama (pola sama dengan `onTriggerEnter`), dan juga sebagai `ctx.emit('movement:jump', { entityId })`.

Komponen ini juga dijalankan oleh `linden_play` headless (lewat `GameSimulation`). Agent bisa menguji movement dengan input tersimulasi (§6).

### 5. Integrasi

#### 5.1 Satu sumber kebenaran untuk Input Actions (R3, R4)

- `setProject` mengisi `projectSettings.inputActions = normalizeInputActions(config.input?.actions ?? defaults)` dan `projectSettings.touch = config.input?.touch ?? defaultTouch`.
- `InputActionsWindow` menyimpan ke disk lewat `window.electronAPI.saveProjectSettings` (debounce 500 ms). Config ditulis ulang dengan `input: { actions, touch }` dan field lain dipertahankan (baca → merge → tulis). Status "Tersimpan" tampil di header jendela.
- `GameFrame` mengirim `input: { actions: projectSettings.inputActions, touch: projectSettings.touch }`.
- Web build tetap membaca `project.linden.json`, kini lewat `normalizeInputActions`.
- HTML Game bridge (`player/htmlBridge.ts`) memakai `normalizeInputActions` yang sama. Bridge juga mendapat `linden.touch.mount(options?)` supaya HTML Game bisa memakai joystick dan tombol Linden (opsional, tidak otomatis).

#### 5.2 Script

`ctx.input` sudah menunjuk ke `Input`, jadi API baru (§2) langsung tersedia. Contoh movement manual yang tidak memakai `CharacterMovement`:

```ts
onUpdate(dt) {
  const move = this.ctx.input.getVector('Move')   // analog: keyboard 0/1, joystick 0..1
  const turn = this.ctx.input.getAxis('Turn')     // Q = -1, E = +1
  if (this.ctx.input.isActionJustPressed('Attack')) this.attack()
}
```

#### 5.3 Pointer lock dan mouse look

- Klik di canvas game meminta `requestPointerLock()` jika ada action yang memakai `Mouse/Delta` (default: `Look`). Esc melepasnya (perilaku browser). Shift+F1 di Game View tetap mengembalikan fokus ke editor (sudah ada).
- Delta mouse diakumulasi per frame ke binding `Mouse/Delta` dan di-reset setelah `Input.update()`.

#### 5.4 Look sederhana

Jika `Look` dipakai dan entity kamera aktif adalah child dari karakter, `CharacterMovement` dengan `qeMode: 'turn'` juga menambahkan `Look.x` ke yaw dan `Look.y` ke pitch kamera (dibatasi ±80°). Kamera orbit/third-person penuh adalah non-tujuan.

### 6. Agent

- `linden_input_actions` diganti skemanya ke bentuk §2 (`type`, `bindings`, `composites`) dan memanggil `normalizeInputActions` sebelum menulis. Input bentuk lama `{ name, keys }` diterima dan dikonversi, dengan peringatan di hasil tool. Parameter opsional `touch` ikut ditulis.
- Prompt agent (`electron/agent/prompts/linden.md`):
  - Untuk game berkarakter, pakai `CharacterMovement` (+ `CharacterController`), bukan script movement.
  - Script hanya untuk aturan game (skor, musuh, interaksi).
  - Pakai nama action default (§1).
- `linden_play` mendapat parameter `inputScript`, berupa urutan input tersimulasi:

  ```json
  [{ "at": 0, "action": "Move", "value": [0, 1] }, { "at": 0.5, "action": "Jump", "press": true }, { "at": 0.6, "action": "Jump", "press": false }]
  ```

  Laporan menyertakan jarak tempuh, tinggi lompat maksimum, dan status grounded akhir untuk entity ber-`CharacterMovement`. Dengan ini agent bisa memverifikasi "karakter bisa jalan dan melompat" secara headless.

## Rencana file

| File | Status | Isi |
| --- | --- | --- |
| `engine/input/InputActions.ts` | ubah | `composites`, axis negatif/positif, binding gamepad lengkap, `getAxis(name)`, `getActionStrength`, `lastDevice`, `setVirtualAxis/Button`, `Mouse/Delta`, normalisasi `KeyboardEvent.code` |
| `engine/input/normalizeActions.ts` | baru | Migrasi 3 bentuk lama + default actions/touch |
| `engine/input/defaultInput.ts` | baru | Peta default §1 dan layout sentuh default §3.1 |
| `engine/input/InputMap.ts` | ubah | `@deprecated`, delegasi ke `Input` |
| `engine/movement/CharacterMovement.ts` | baru | Komponen + `CharacterMovementSystem` |
| `engine/ecs/ComponentRegistry.ts` | ubah | Registrasi `CharacterMovement` |
| `engine/runtime/GameSimulation.ts` | ubah | Jalankan sistem movement di fixed step, `viewYaw` |
| `engine/physics/RapierBackend.ts` | ubah | `moveCharacter` memakai `slopeLimit`/`stepOffset` komponen |
| `player/touchControls.ts` | tulis ulang | Joystick analog, look, tombol dari config, Pointer Events multi-touch |
| `player/player.ts` | ubah | Pasang TouchControls dari `input.touch`, isi `viewYaw`, pointer lock |
| `player/htmlBridge.ts` | ubah | `normalizeInputActions`, `linden.touch.mount()` |
| `editor/store/editorStore.ts` | ubah | `setProject` memuat `input.actions`/`touch`; `saveInputSettings()` |
| `editor/windows/InputActionsWindow.tsx` | ubah | Multi-composite, axis, binding gamepad/sentuh, tab Sentuh, simpan ke disk |
| `editor/viewport/GameFrame.tsx` | ubah | Kirim `touch`, toggle Kontrol Sentuh |
| `editor/project/projectTemplates.ts` | ubah | Template memakai peta default; template 3D/FPS/Platformer memakai `CharacterMovement` untuk Player |
| `electron/agent/lindenTools/index.ts` | ubah | Skema `linden_input_actions`, `inputScript` di `linden_play` |
| `electron/agent/prompts/linden.md` | ubah | Aturan movement + nama action default |
| `shared/types/project.ts` | ubah | Tipe `input.actions` dan `input.touch` |

## Fase

| Fase | Isi | Kriteria selesai |
| --- | --- | --- |
| M1 — Fondasi input | §2 (model, normalisasi, gamepad, `setVirtual*`), §5.1 (simpan/muat, Play = build web), perbaikan `linden_input_actions` | Action dari editor tersimpan dan dipakai identik di Play dan build web. Panah dan Q/E bekerja. Action dari agent aktif |
| M2 — Sentuh analog | §3 lengkap + toggle di Game View | Di ponsel (dan simulasi di editor), joystick menggerakkan karakter dengan nilai analog. Tombol JUMP/ATK/RUN/USE memicu action |
| M3 — CharacterMovement | §4 + integrasi template + `linden_play inputScript` | Template 3D: Player berjalan, berlari, melompat, berputar Q/E tanpa script. Mode `fly` naik/turun dengan Q/E |
| M4 — Look & agent | §5.3, §5.4, prompt agent | Mouse/stik kanan/drag kanan memutar pandangan. Game hasil prompt memakai `CharacterMovement` |

## Rencana tes

Unit (`vitest`):

- `tests/input/normalizeActions.test.ts`: tiga bentuk lama → bentuk baru. `Keyboard/W` → `Keyboard/KeyW`. Peringatan untuk binding tak dikenal.
- `tests/input/inputActions.test.ts`:
  - WASD dan panah sama-sama menggerakkan `Move`.
  - Diagonal dinormalisasi ke panjang 1.
  - Joystick 0.5 → panjang 0.5 setelah deadzone.
  - `Turn` Q=−1, E=+1, Q+E=0.
  - `Sprint` aktif dari joystick ≥ 0.9 (`pressThreshold`).
  - `lastDevice` berubah sesuai sumber.
  - `releaseAll` saat blur.
- `tests/input/touchControls.test.ts` (DOM sintetis via Pointer Events): dua pointer bersamaan (joystick + Jump), `pointercancel` me-reset nilai, tombol dari config membentuk `Touch/Button/<id>`.
- `tests/movement/characterMovement.test.ts` (headless `GameSimulation` + Rapier):
  - Maju 1 detik dengan `Move=(0,1)` → jarak ≈ `walkSpeed` (± akselerasi).
  - Sprint lebih jauh.
  - Joystick 0.5 → setengah kecepatan.
  - Lompat mencapai `jumpHeight` ± 5%, dan tidak bisa lompat lagi di udara saat `maxJumps=1`.
  - `coyoteTime` bekerja.
  - Q/E memutar yaw `turnSpeed` °/s.
  - `fly` + E menaikkan Y.
  - `cameraRelative` dengan yaw kamera 90° mengubah arah W.
- `tests/agent/agentTools.test.ts`: `linden_input_actions` menulis bentuk §2. `linden_play` dengan `inputScript` melaporkan jarak tempuh > 0 dan tinggi lompat.

E2E (`tests/e2e/playViewport.e2e.mjs`, diperluas):

- TC-MOVE-01: Tekan W 1 detik di Game View → Player maju. Tekan E → yaw berubah. Space → Player naik lalu turun ke tanah.
- TC-MOVE-02: Toggle Kontrol Sentuh → drag joystick setengah radius dengan mouse → kecepatan ≈ setengah. Tap JUMP → lompat.
- TC-MOVE-03: Tambah action `Dash` (Shift+Space) di Input Actions → tutup/buka proyek → action tetap ada dan bekerja di Play dan build web.
- TC-MOVE-04: Build web dibuka dengan emulasi sentuh (viewport 390×844, `hasTouch`) → kontrol sentuh tampil otomatis dan berfungsi.

## Acceptance criteria

- [ ] W A S D dan panah menggerakkan karakter. Q/E memutar karakter (atau turun/naik di mode `fly`). Space/Shift/C/F/klik kiri memicu Jump/Sprint/Crouch/Interact/Attack.
- [ ] Di perangkat sentuh, joystick analog dan tombol action tampil otomatis, mendukung multi-touch, dan karakter merespons dengan kecepatan sebanding kemiringan joystick.
- [ ] Gamepad standar bisa bergerak, memutar, melompat, sprint, dan menyerang.
- [ ] Input Actions yang diubah di editor tersimpan ke `project.linden.json` dan dipakai sama persis di Play, `linden_play`, dan build web.
- [ ] Menambahkan komponen `CharacterMovement` ke entity cukup untuk karakter yang bisa berjalan, berlari, melompat (dengan coyote time dan jump buffer), dan berputar, tanpa script.
- [ ] Kontrol sentuh bisa diuji dari viewport editor dengan mouse.
- [ ] Agent menulis Input Actions dalam format yang benar dan bisa memverifikasi movement lewat `linden_play` dengan input tersimulasi.

## Pertanyaan terbuka

1. **Interact di F atau E?** Spec ini memakai E untuk Turn/Vertical sesuai permintaan, sehingga Interact pindah ke F. Jika ingin E = Interact (konvensi PC), Turn bisa dipindah ke Q/E hanya saat `qeMode` aktif dan Interact ke E saat tidak.
2. **Mode joystick default: `floating` atau `fixed`?** `floating` lebih nyaman di layar besar. `fixed` lebih mudah dipahami pemain baru.
3. **Template 2D platformer: `CharacterMovement` mode `walk` dengan sumbu Z dikunci, atau komponen `CharacterMovement2D` terpisah?** Usulan: properti `lockAxis: 'z'` pada komponen yang sama.

## Status implementasi (26 Okt 2026)

M1–M4 selesai. Pertanyaan terbuka dijawab dengan default spec:

- Interact = F.
- Joystick `floating`.
- Platformer 2D memakai `CharacterMovement` dengan `lockAxis: 'z'`.

Perbedaan dari desain:

- `joystick.deadzone` dihapus. Deadzone hanya diterapkan sekali, lewat action `Move`.
- Ketukan yang lebih singkat dari satu frame tetap terhitung sebagai satu frame tekan ("tap latch" di `InputManager`). Sebelumnya, tekan-lepas Space di antara dua frame hilang.
- `InputMap.ts` hanya ditandai `@deprecated` (dipakai test parity Godot), belum didelegasikan ke `Input`.
- Kamera yang menempel langsung di entity karakter juga diperlakukan sebagai first-person. Arah gerak mengikuti hadap karakter dan putar otomatis dimatikan, supaya karakter tidak berputar terus.
- Template FPS memakai kapsul + child "Head Camera". Template 2D platformer memakai `CharacterMovement` (lockAxis z, double jump).
- Mode `walk` dengan Rigidbody dinamis memakai gravitasi dunia (9.81), bukan `gravity` komponen.
- `linden_play` mendukung `inputScript` lewat `Input.setActionOverride`, dan melaporkan `characters[]`.
- Perbaikan terkait yang ditemukan saat pengujian:
  - Runtime Play di mode dev dibangun ulang otomatis jika `player/`, `engine/`, atau `shared/` berubah.
  - Ekspor web tidak lagi memakai `dist-player/` yang lebih tua dari sumbernya.
  - Respons error `linden-game://` tampil sebagai halaman gelap dengan pesan, bukan halaman putih.
  - Game View menampilkan overlay "Game tidak merespons" jika game diam selama 10 detik.

Pengujian:

- Unit: `tests/input/*` (normalisasi, WASD/panah, analog, Q/E, trigger, sprint dari joystick, sentuh, delta look, tap latch), `tests/movement/characterMovement.test.ts` (11 skenario dengan Rapier), dan `tests/agent/agentTools.test.ts` (format baru `linden_input_actions`, `inputScript`).
- E2E Electron `npm run test:e2e:move`: 17 skenario TC-MOVE-01..04, termasuk build web dengan emulasi sentuh.
