# Test Cases: Godot Feature Parity dengan UX Unity

23 Okt 2026 · Status: Draft · Dokumen terkait: [PRD.md](./PRD.md) · [SPEC.md](./SPEC.md)

Test case untuk Fase 0–1, ditambah smoke test 2D Fase 2. Tiap kasus menyebut fitur (PRD §4), level, dan prioritas.

**Level**

- **Unit**: fungsi/kelas murni di `engine/`, dijalankan dengan Vitest (perlu ditambahkan sebagai devDependency).
- **Integrasi**: `World` + system + serializer tanpa UI, juga di Vitest (jsdom; Three.js tanpa renderer).
- **E2E**: aplikasi Electron dijalankan dengan Playwright (`_electron.launch`).
- **Manual**: butuh penilaian visual atau perangkat keras (gamepad).

**Prasyarat umum**: project fixture `tests/fixtures/project-basic/` berisi `project.linden.json`, satu scene kosong, dan aset primitif. Setiap test E2E dimulai dari editor yang baru dibuka dengan fixture ini.

---

## F0.1 Scene model berbasis ECS

| ID | Level | Prio | Langkah | Hasil yang diharapkan |
| --- | --- | --- | --- | --- |
| TC-F01-01 | Integrasi | P0 | `world.createEntity('Cube')` lalu `addComponent(id,'MeshRenderer',{primitive:'box'})` | `SceneBridge` membuat tepat 1 `THREE.Mesh` dengan `userData.entityId === id` |
| TC-F01-02 | Integrasi | P0 | `setProperty(id,'Transform','position',[1,2,3])` | `object3D.position` = (1,2,3) pada event berikutnya; tidak ada perubahan lain |
| TC-F01-03 | Integrasi | P0 | `setProperty(id,'Transform','rotation',[0,90,0])` | `object3D.rotation.y ≈ π/2` (toleransi 1e-6) |
| TC-F01-04 | Integrasi | P0 | Buat A > B; `setParent(B, null)` dengan keep world transform | Posisi dunia B tidak berubah; `B.parentId === null`; Hierarchy memindahkan B ke root |
| TC-F01-05 | Integrasi | P0 | `destroyEntity(A)` pada A > B > C | Ketiga entity hilang dari `World`; 3 objek Three.js di-`dispose()`; event `entityRemoved` 3 kali |
| TC-F01-06 | E2E | P0 | Klik Cube di Scene view | Cube terpilih di Hierarchy dan Inspector (sinkron, < 100 ms) |
| TC-F01-07 | E2E | P0 | Klik Cube di Hierarchy | Gizmo muncul di Cube di Scene view |
| TC-F01-08 | Unit | P1 | `setParent(A, C)` saat C adalah cucu A | Ditolak dengan error `PARENT_CYCLE`; World tidak berubah |

## F0.2 Component registry & Inspector

| ID | Level | Prio | Langkah | Hasil yang diharapkan |
| --- | --- | --- | --- | --- |
| TC-F02-01 | Unit | P0 | `ComponentRegistry.search('rigid')` | Hasil pertama `Rigidbody` |
| TC-F02-02 | E2E | P0 | Pilih Cube → `Add Component` → ketik "box col" → Enter | `BoxCollider` muncul di Inspector dengan nilai default dari schema |
| TC-F02-03 | E2E | P0 | `Add Component` → kategori Physics | Daftar sesuai `menuPath` `Physics/*`, urut alfabet |
| TC-F02-04 | E2E | P0 | Tambah `CharacterController` (requires `Capsule…`) | Komponen yang dibutuhkan ikut ditambahkan; satu entri undo |
| TC-F02-05 | E2E | P0 | Tambah `Rigidbody` kedua pada objek yang sama | Ditolak (`disallowMultiple`), pesan di Console |
| TC-F02-06 | E2E | P0 | Drag label "Mass" ke kanan 50 px | Nilai naik bertahap; satu entri undo untuk seluruh drag |
| TC-F02-07 | E2E | P0 | Ketik `-5` di field `mass` (min 0) | Nilai di-clamp jadi 0 |
| TC-F02-08 | E2E | P0 | Pilih 2 objek dengan `mass` 1 dan 2 | Field tampil `—`; ketik 3 → kedua objek bernilai 3; satu entri undo |
| TC-F02-09 | E2E | P1 | Menu `⋮` komponen → Copy Component, pilih objek lain → Paste Component Values | Nilai tersalin; bisa di-undo |
| TC-F02-10 | E2E | P1 | Script dengan `@serialize({min:0,max:20}) speed` | Inspector menampilkan slider 0–20 berlabel "Speed" |
| TC-F02-11 | E2E | P1 | Uncheck checkbox komponen `MeshRenderer` | Mesh tidak dirender; `enabled=false` tersimpan |

## F0.3 Undo/Redo

| ID | Level | Prio | Langkah | Hasil yang diharapkan |
| --- | --- | --- | --- | --- |
| TC-F03-01 | Unit | P0 | `execute(c1)`, `execute(c2)`, `undo()`, `undo()` | `c2.undo` lalu `c1.undo` terpanggil berurutan; `cursor = 0` |
| TC-F03-02 | Unit | P0 | `execute(c1)`, `undo()`, `execute(c3)` | Redo stack kosong; `redo()` tidak berbuat apa-apa |
| TC-F03-03 | Unit | P0 | Dua `SetProperty` dengan `mergeKey` sama berjarak 200 ms | Satu entri history; undo kembali ke nilai sebelum yang pertama |
| TC-F03-04 | Unit | P0 | 201 command dengan `maxDepth=200` | History berisi 200; command tertua dibuang |
| TC-F03-05 | Unit | P0 | `beginGroup('Duplicate')`, 3 command, `endGroup()`, `undo()` | Ketiganya di-undo dalam urutan terbalik sebagai satu langkah |
| TC-F03-06 | E2E | P0 | Untuk **setiap** operasi di SPEC §5.3: lakukan → Ctrl+Z → Ctrl+Y | Setelah Ctrl+Z, `serialize(world)` identik dengan sebelum operasi; setelah Ctrl+Y identik dengan sesudahnya |
| TC-F03-07 | E2E | P0 | Pindahkan objek, Save, Ctrl+Z | Judul jendela kembali ber-`*` (dirty) |
| TC-F03-08 | E2E | P0 | Pindahkan objek, Ctrl+Z | Judul jendela tanpa `*` (kembali ke titik simpan) |
| TC-F03-09 | E2E | P0 | Fokus di field teks Inspector, ketik, Ctrl+Z | Undo teks di dalam field (native), bukan undo scene |
| TC-F03-10 | E2E | P1 | Edit → Undo History, klik entri ke-3 dari atas | Scene melompat ke state itu; entri sesudahnya abu-abu (bisa di-redo) |
| TC-F03-11 | E2E | P0 | Masuk Play mode, pindahkan objek, Ctrl+Z | Tidak ada perubahan scene (undo dimatikan di Play mode) |

## F0.4 Save / Open `.lscene` v2

| ID | Level | Prio | Langkah | Hasil yang diharapkan |
| --- | --- | --- | --- | --- |
| TC-F04-01 | Integrasi | P0 | Round-trip 50 scene fixture: `deserialize(serialize(world))` | Hasil `serialize` kedua identik byte-per-byte dengan yang pertama |
| TC-F04-02 | Integrasi | P0 | Serialize dua kali tanpa perubahan | Output identik (urutan kunci stabil) |
| TC-F04-03 | Integrasi | P0 | Ubah posisi satu objek, serialize, `diff` dengan versi sebelumnya | Diff hanya menyentuh baris `position` objek itu |
| TC-F04-04 | Integrasi | P0 | Buka file v1 dari spec Open Scene | Termigrasi ke v2; objek, transform, material sama |
| TC-F04-05 | Integrasi | P0 | Scene berisi komponen `script:Unknown` (script sudah dihapus) | Scene tetap terbuka; komponen tampil sebagai "Missing Script" dengan data dipertahankan; save tidak menghapus datanya |
| TC-F04-06 | E2E | P0 | Ctrl+S pada scene baru | Dialog Save As muncul dengan filter `.lscene` |
| TC-F04-07 | E2E | P0 | Ctrl+S pada scene yang sudah punya path | Tersimpan tanpa dialog; `*` hilang dari judul |
| TC-F04-08 | E2E | P0 | Scene dirty → Ctrl+O | Dialog konfirmasi muncul sebelum dialog file (spec Open Scene) |
| TC-F04-09 | E2E | P0 | Scene dirty → tutup jendela | Dialog "Save / Don't Save / Cancel"; Cancel membatalkan penutupan |
| TC-F04-10 | E2E | P1 | Simpan saat disk penuh / folder read-only | Dialog error; file lama tidak rusak (tulis ke `.tmp` lalu rename) |

## F0.5 Play mode

| ID | Level | Prio | Langkah | Hasil yang diharapkan |
| --- | --- | --- | --- | --- |
| TC-F05-01 | E2E | P0 | Ctrl+P | Tombol Play biru, editor ber-tint, `Start()` script terpanggil sekali per komponen |
| TC-F05-02 | E2E | P0 | Play → objek Rigidbody jatuh → Stop | Posisi objek kembali ke nilai sebelum Play; seleksi tetap |
| TC-F05-03 | E2E | P0 | Play → ubah `speed` di Inspector → Stop | Nilai kembali; scene tidak dirty |
| TC-F05-04 | E2E | P0 | Play → Ctrl+Shift+P (Pause) → Ctrl+Alt+P (Step) ×3 | Tepat 3 frame `update` berjalan (diverifikasi lewat counter di script fixture) |
| TC-F05-05 | E2E | P0 | Script melempar exception di `update()` | Error + stack di Console; editor tidak blank; Play tetap berjalan (frame berikutnya mencoba lagi) atau berhenti jika "Error Pause" aktif |
| TC-F05-06 | E2E | P1 | Play → buat objek baru dari script → Stop | Objek tidak ada setelah Stop |

---

## F1.1 Prefab

| ID | Level | Prio | Langkah | Hasil yang diharapkan |
| --- | --- | --- | --- | --- |
| TC-F11-01 | E2E | P0 | Drag "Door" dari Hierarchy ke folder `prefabs/` di Project | File `Door.lprefab` dibuat; "Door" di Hierarchy berubah biru dengan ikon prefab |
| TC-F11-02 | E2E | P0 | Drag `Door.lprefab` ke Scene view 3 kali | 3 instance biru; nama "Door", "Door (1)", "Door (2)"; satu entri undo per drag |
| TC-F11-03 | E2E | P0 | Ubah posisi "Door (1)" | Field position tebal + garis biru; Overrides ▾ menampilkan 1 perubahan |
| TC-F11-04 | E2E | P0 | Buka Prefab Mode, ubah warna material, kembali | Ketiga instance berwarna baru |
| TC-F11-05 | E2E | P0 | Pada TC-F11-03 lalu TC-F11-04 dengan mengubah posisi di prefab | "Door (1)" mempertahankan posisi override-nya; dua instance lain ikut berpindah |
| TC-F11-06 | E2E | P0 | Overrides ▾ → Revert All pada "Door (1)" | Posisi kembali ke nilai prefab; tanda override hilang |
| TC-F11-07 | E2E | P0 | Overrides ▾ → Apply All pada "Door (1)" | `.lprefab` ter-update; instance lain ikut berubah; tanda override hilang |
| TC-F11-08 | E2E | P0 | Tambah komponen `AudioSource` pada instance | Komponen ditandai `+` hijau sebagai added component; Apply menambahkannya ke prefab |
| TC-F11-09 | Integrasi | P0 | Save scene berisi 3 instance, periksa `.lscene` | Tiap instance hanya menyimpan `prefab.asset` + override; isi prefab tidak tersalin |
| TC-F11-10 | Integrasi | P0 | Load scene dua kali | Id entity anak instance sama di kedua load (hash stabil) |
| TC-F11-11 | Integrasi | P0 | Prefab A berisi instance prefab B; buka scene berisi A | Nested prefab terbentuk; ubah B → muncul di dalam A |
| TC-F11-12 | Integrasi | P0 | Prefab A berisi instance A | Ditolak dengan `PREFAB_CYCLE` |
| TC-F11-13 | E2E | P1 | Create → Prefab Variant dari `Door`; ubah warna di variant; ubah ukuran di `Door` | Variant: warna sendiri + ukuran baru dari base |
| TC-F11-14 | E2E | P1 | Klik kanan instance → Prefab → Unpack Completely | Objek jadi GameObject biasa (abu-abu); perubahan prefab tidak lagi memengaruhi; bisa di-undo |
| TC-F11-15 | E2E | P1 | Hapus `Door.lprefab` dari Project saat instance ada di scene | Instance tampil merah "Missing Prefab"; scene tetap bisa dibuka dan disimpan |

## F1.2 Events (signals)

| ID | Level | Prio | Langkah | Hasil yang diharapkan |
| --- | --- | --- | --- | --- |
| TC-F12-01 | Unit | P0 | `field.on(fn)`; `emit(1)` | `fn` terpanggil sekali dengan `1` |
| TC-F12-02 | Unit | P0 | `const off = field.on(fn); off(); emit()` | `fn` tidak terpanggil |
| TC-F12-03 | Unit | P0 | 3 listener, listener ke-2 melempar exception | Listener 1 dan 3 tetap terpanggil; error dicatat |
| TC-F12-04 | Integrasi | P0 | Listener serialisasi ke entity yang sudah dihapus; `emit()` | Dilewati + warning di Console; tidak crash |
| TC-F12-05 | E2E | P0 | Inspector Collider pintu → On Trigger Enter → `+` → drag "Door" → pilih `Door.open` → Play → gerakkan Player masuk trigger | `open()` terpanggil sekali saat masuk |
| TC-F12-06 | E2E | P0 | Event dengan argumen statis `"Level2"` ke `SceneLoader.load(string)` | Method menerima `"Level2"` |
| TC-F12-07 | E2E | P0 | Save → Open scene dari TC-F12-05 | Listener tetap ada dan berfungsi |
| TC-F12-08 | E2E | P1 | Duplicate (Ctrl+D) objek yang listener-nya menunjuk ke anaknya sendiri | Listener salinan menunjuk ke anak salinan (remap id), bukan ke anak asli |
| TC-F12-09 | Integrasi | P0 | Blueprint pintu berisi `Custom Event "OpenDoor"` → `Print String "opened"`; listener `{component:'Blueprint', method:'OpenDoor'}`; `emit()` | Console berisi "opened" tepat 1× |
| TC-F12-10 | E2E | P0 | Inspector event → target "Door" (punya komponen Blueprint) → buka dropdown fungsi | Ada kelompok **Blueprint** berisi `OpenDoor`; pilih, Play, picu trigger → pintu terbuka |
| TC-F12-11 | E2E | P0 | Ganti nama Custom Event `OpenDoor` → `Open` di Blueprint Editor, lalu Ctrl+Z | Listener ikut berganti ke `Open`; setelah Ctrl+Z keduanya kembali ke `OpenDoor` |
| TC-F12-12 | Integrasi | P0 | Listener menunjuk Custom Event yang node-nya sudah dihapus; `emit()` | Warning di Console; listener tampil merah "Missing Blueprint Event"; tidak crash |
| TC-F12-13 | Integrasi | P1 | `Custom Event "Damage"` dengan parameter `number`; listener dengan argumen statis `25` | Pin parameter bernilai 25 |
| TC-F12-14 | Integrasi | P1 | Blueprint memanggil `Invoke Event` → `onDied` di entity sendiri; ada listener script pada `onDied` | Method script terpanggil 1× |

## F1.3 Physics 3D

| ID | Level | Prio | Langkah | Hasil yang diharapkan |
| --- | --- | --- | --- | --- |
| TC-F13-01 | Integrasi | P0 | Sphere `Rigidbody` dinamis di y=10 di atas `BoxCollider` lantai, simulasi 3 s | Sphere diam di atas lantai (y ≈ radius ± 0.01) |
| TC-F13-02 | Integrasi | P0 | Seperti TC-F13-01, jatuh bebas 1 s tanpa lantai | y ≈ 10 − ½·9.81·1² = 5.095 (toleransi 0.05) |
| TC-F13-03 | Integrasi | P0 | `useGravity=false` | Posisi tidak berubah |
| TC-F13-04 | Integrasi | P0 | `freezeRotation=[true,true,true]`, kubus jatuh miring | Rotasi tetap |
| TC-F13-05 | Integrasi | P0 | Kubus `isTrigger` dilewati sphere dinamis | `onTriggerEnter` 1×, `onTriggerExit` 1×; sphere tidak terpantul |
| TC-F13-06 | Integrasi | P0 | Dua kubus dinamis bertabrakan | `onCollisionEnter` di keduanya dengan `other` saling menunjuk |
| TC-F13-07 | Integrasi | P0 | Layer "Player" & "Enemy" tidak dicentang di matrix | Keduanya saling tembus; tidak ada event collision |
| TC-F13-08 | Integrasi | P0 | `Physics.raycast([0,5,0],[0,-1,0],10)` ke lantai di y=0 | Hit dengan `point.y ≈ 0`, `distance ≈ 5`, `entity` = lantai |
| TC-F13-09 | Integrasi | P0 | Raycast dengan layerMask yang mengecualikan lantai | `null` |
| TC-F13-10 | Integrasi | P0 | `CharacterController.move([0,0,1])` ke dinding | Berhenti di dinding; `isGrounded` true saat di lantai |
| TC-F13-11 | Integrasi | P1 | `CharacterController` menaiki anak tangga 0.25 dengan `stepOffset=0.3` | Naik; dengan `stepOffset=0.2` tertahan |
| TC-F13-12 | Integrasi | P1 | Kinematic body digerakkan lewat Transform | Mendorong body dinamis; dirinya tidak terdorong |
| TC-F13-13 | Integrasi | P1 | Simulasi yang sama dijalankan dua kali | Posisi akhir identik (determinisme) |
| TC-F13-14 | Manual | P0 | Scene 500 rigidbody kubus jatuh ke lantai | ≥ 60 FPS simulasi di MacBook Air M1; tidak ada yang tembus lantai |
| TC-F13-15 | E2E | P1 | Gizmo collider | Wireframe hijau sesuai ukuran collider saat objek dipilih |

## F1.4 Input Actions

| ID | Level | Prio | Langkah | Hasil yang diharapkan |
| --- | --- | --- | --- | --- |
| TC-F14-01 | Unit | P0 | Simulasikan keydown Space pada frame N, keyup pada N+3 | `isActionJustPressed('Jump')` true hanya di N; `isActionPressed` true di N..N+2; `JustReleased` true di N+3 |
| TC-F14-02 | Unit | P0 | Tahan W dan D | `getVector('Move')` ≈ (0.707, 0.707) (dinormalisasi) |
| TC-F14-03 | Unit | P0 | Stick kiri (0.1, 0) dengan deadzone 0.2 | `getVector` = (0,0) |
| TC-F14-04 | Unit | P0 | Dua binding (Space & ButtonSouth) ditekan bersamaan lalu satu dilepas | Action tetap pressed sampai keduanya lepas |
| TC-F14-05 | Unit | P0 | Action yang tidak terdaftar | Warning sekali di Console; mengembalikan `false` |
| TC-F14-06 | E2E | P0 | Window → Input Actions → `+` → "Fire" → Listen → klik kiri mouse | Binding `Mouse/LeftButton` tersimpan di `project.linden.json` |
| TC-F14-07 | E2E | P0 | Fokus di field teks editor saat Play | Ketikan tidak memicu action game |
| TC-F14-08 | Manual | P1 | Gamepad Xbox & PlayStation | Tombol bawah (A / ✕) memicu `Jump` di keduanya |

## F1.5 Tags & Layers

| ID | Level | Prio | Langkah | Hasil yang diharapkan |
| --- | --- | --- | --- | --- |
| TC-F15-01 | Integrasi | P0 | 3 entity ber-tag "Enemy"; `findByTag('Enemy')` | 3 hasil, urutan Hierarchy |
| TC-F15-02 | E2E | P0 | Header Inspector → Tag ▾ → "Add Tag…" → "Coin" | Tag tersedia di dropdown semua objek; tersimpan di project settings |
| TC-F15-03 | E2E | P0 | Hapus tag "Enemy" yang dipakai 3 objek | Peringatan "Dipakai 3 objek"; jika lanjut, tag dilepas dari ketiganya; bisa di-undo |
| TC-F15-04 | E2E | P0 | Ganti layer objek berisi anak | Dialog "Ubah juga layer anak?" (Yes, change children / No, this object only) |
| TC-F15-05 | Unit | P0 | `LayerMask.getMask('Default','Water')` | `(1<<0) \| (1<<4)` |
| TC-F15-06 | Integrasi | P0 | Entity A tag `[Enemy, Flying]`, B `[Enemy]`, C `[Flying]` | `findByTag('Enemy')` = A,B; `findByAllTags(['Enemy','Flying'])` = A; `findByAnyTag(['Enemy','Flying'])` = A,B,C |
| TC-F15-07 | Integrasi | P0 | `addTag('Enemy')` dua kali pada entity yang sama | `tags` tetap berisi satu `Enemy`; tidak ada event ganda |
| TC-F15-08 | Integrasi | P0 | Hapus entity ber-tag lalu `findByTag` | Entity tidak muncul (indeks ikut diperbarui) |
| TC-F15-09 | E2E | P0 | Pilih objek → `Tags +` → pilih "Enemy" lalu "Flying" | Dua chip tampil; tersimpan di `.lscene` sebagai `"tags": ["Enemy","Flying"]`; tiap penambahan satu entri undo |
| TC-F15-10 | E2E | P0 | Multi-select A `[Enemy]` dan B `[]` | Chip `Enemy` tampil pudar; `+` → "Flying" menambahkan Flying ke keduanya dalam satu undo |
| TC-F15-11 | E2E | P1 | Ketik `t:Enemy` di pencarian Hierarchy | Hanya objek ber-tag Enemy (beserta parent-nya, abu-abu) yang tampil |
| TC-F15-12 | Integrasi | P1 | `world.callTag('Enemy','takeDamage',10)` pada 3 Enemy | `takeDamage(10)` terpanggil pada ketiganya; entity tanpa method itu dilewati tanpa error |
| TC-F15-13 | Manual | P1 | Scene 10.000 entity, 100 ber-tag Enemy; `findByTag` 1.000× | < 5 ms total (indeks, bukan scan) |

## F1.6–F1.9

| ID | Level | Prio | Fitur | Langkah | Hasil yang diharapkan |
| --- | --- | --- | --- | --- | --- |
| TC-F16-01 | Integrasi | P1 | Services | Daftarkan `ScoreService`; Play; `SceneManager.load('Level2')` | Instance service sama (`===`) sebelum dan sesudah pindah scene; nilai skor tetap |
| TC-F16-02 | Integrasi | P1 | Services | Service A dan B, urutan A lalu B | `awake()` A terpanggil sebelum B |
| TC-F17-01 | E2E | P1 | Data Asset | Project → Create → Game → Weapon Data | File `.lasset` dibuat; Inspector menampilkan `damage = 10` |
| TC-F17-02 | Integrasi | P1 | Data Asset | Dua komponen mereferensikan aset sama; satu mengubah `damage` saat runtime | Yang lain melihat nilai yang sama (shared); `duplicate()` menghasilkan salinan independen |
| TC-F18-01 | Integrasi | P1 | Timer | `waitTime=1`, `oneShot=true`, simulasi 3 s | `onTimeout` tepat 1× pada t ≈ 1.0 s (± 1 frame) |
| TC-F18-02 | Integrasi | P1 | Timer | `oneShot=false` 3.5 s | `onTimeout` 3× |
| TC-F18-03 | Integrasi | P1 | Tween | `Tween.to(e,'Transform.position',[0,5,0],1,{ease:'linear'})`, cek di t=0.5 | y ≈ 2.5 |
| TC-F18-04 | Integrasi | P1 | Tween | Hapus entity di tengah tween | Tween berhenti tanpa error; `then()` tidak terpanggil |
| TC-F19-01 | E2E | P1 | Scene switching | Build Settings berisi Level1 (index 0), Level2; Play dari Level1; script memanggil `load('Level2')` | Level2 tampil; objek Level1 hilang; Services tetap |
| TC-F19-02 | E2E | P1 | Scene switching | `load('NotInBuild')` | Error jelas di Console; scene aktif tetap |

## Rapier (keputusan library physics)

| ID | Level | Prio | Langkah | Hasil yang diharapkan |
| --- | --- | --- | --- | --- |
| TC-RAP-01 | E2E | P0 | Buka editor dengan scene tanpa Rigidbody/Collider; cek Network/Sources DevTools | Modul `@dimforge/rapier3d-compat` **belum** dimuat |
| TC-RAP-02 | E2E | P0 | Tambah `Rigidbody` lalu Play | Rapier dimuat satu kali; simulasi berjalan; tidak ada error WASM di Console |
| TC-RAP-03 | E2E | P0 | `npm run build:all`, jalankan aplikasi hasil build, Play scene berisi Rigidbody | Physics berjalan di build production (WASM ter-bundle) |
| TC-RAP-04 | Integrasi | P0 | Play → Stop 20× berturut | Tidak ada kebocoran: jumlah body di `RAPIER.World` = 0 setelah tiap Stop; heap stabil |

## Fase 2 — 2D (smoke, diperinci di PRD Fase 2)

| ID | Level | Prio | Langkah | Hasil yang diharapkan |
| --- | --- | --- | --- | --- |
| TC-F27-01 | E2E | P0 | Klik tombol "2D" di Scene view | Kamera editor ortografik menghadap sumbu XY; rotasi orbit dimatikan; gizmo hanya X/Y |
| TC-F27-02 | Integrasi | P0 | Dua sprite di posisi sama: A `orderInLayer=1`, B `0` | A tergambar di atas B, apa pun nilai z-nya |
| TC-F28-01 | Integrasi | P0 | `Rigidbody 2D` + `Circle Collider 2D` jatuh ke `Box Collider 2D` | Berhenti di atas lantai; z tetap |
| TC-F28-02 | Integrasi | P0 | Tambah `Rigidbody` (3D) ke entity yang sudah punya `Rigidbody 2D` | Ditolak dengan pesan konflik |
| TC-F29-01 | E2E | P1 | Tile Palette → brush, cat 10 tile, Ctrl+Z | Satu goresan = satu entri undo; tile hilang semua |
| TC-F29-02 | Integrasi | P1 | Tilemap 100×100 tile solid + `Tilemap Collider 2D` | Collider digabung (jumlah shape ≪ 10.000); bola tidak tersangkut di sambungan tile |

---

## E2E skenario lintas fitur

### E2E-01 — Platformer mini (dipakai juga untuk uji pengguna di PRD §6)

1. File → New Scene.
2. GameObject → 3D Object → Plane, beri nama "Ground", scale (10,1,10).
3. GameObject → 3D Object → Capsule, nama "Player", position (0,2,0), tag "Player".
4. Add Component → Character Controller; Add Component → script `PlayerController` (fixture: membaca action `Move` dan `Jump`).
5. Window → Input Actions: pastikan `Move` (WASD) dan `Jump` (Space) ada.
6. Buat Cube "Coin", tag `[Coin, Pickup]`, Box Collider `isTrigger`, komponen Blueprint berisi Custom Event `Collect` (memanggil `Score.add(1)` lalu destroy diri). Hubungkan `On Trigger Enter` ke `Blueprint ▸ Collect` lewat Inspector.
7. Jadikan Coin prefab, buat 5 instance.
8. Ctrl+S → simpan `Level1.lscene`.
9. Ctrl+P, gerakkan Player menyentuh 5 Coin.

**Hasil**: Player tidak tembus lantai, bisa lompat, skor di Console = 5, kelima Coin hilang. Setelah Stop, kelima Coin muncul lagi dan scene tidak dirty. Close + buka ulang `Level1.lscene`: semua objek, komponen, prefab link, dan binding input tetap.

### E2E-02 — Ketahanan undo

Lakukan 50 operasi acak dari SPEC §5.3 (seed tetap), lalu 50× Ctrl+Z. `serialize(world)` harus identik dengan scene awal. Lalu 50× Ctrl+Y: identik dengan state akhir.

### E2E-03 — Regresi editor lama

Buka tab Blueprint, Material, Animator, Sequencer setelah migrasi ECS. Tiap editor terbuka tanpa error di Console. Kembali ke tab Scene: viewport tampil dan seleksi dipertahankan (regresi `docs/SPEC_FIX_BLANK_EDITOR.md`).

## Non-fungsional

| ID | Kategori | Langkah | Target |
| --- | --- | --- | --- |
| TC-NF-01 | Performa | Scene 1.000 primitif, orbit kamera 10 s | ≥ 50 FPS editor (M1) |
| TC-NF-02 | Performa | Inspector: pilih objek dengan 10 komponen | Render panel < 50 ms |
| TC-NF-03 | Performa | Save scene 1.000 entity | < 500 ms; file < 2 MB |
| TC-NF-04 | Memori | New Scene 20× berturut | Heap kembali ke ±10% baseline; tidak ada warning WebGL context |
| TC-NF-05 | Bundle | `vite build` dengan physics | Modul Rapier dimuat lazy; bundle awal bertambah < 100 KB |
| TC-NF-06 | Aksesibilitas | Navigasi Hierarchy & Inspector dengan keyboard saja (↑↓ ←→ Enter F2 Del) | Semua aksi utama bisa dilakukan |

## Ringkasan cakupan

| Fitur | Unit | Integrasi | E2E | Manual | Total |
| --- | --- | --- | --- | --- | --- |
| F0.1 | 1 | 5 | 2 | 0 | 8 |
| F0.2 | 1 | 0 | 10 | 0 | 11 |
| F0.3 | 5 | 0 | 6 | 0 | 11 |
| F0.4 | 0 | 5 | 5 | 0 | 10 |
| F0.5 | 0 | 0 | 6 | 0 | 6 |
| F1.1 | 0 | 4 | 11 | 0 | 15 |
| F1.2 | 3 | 5 | 6 | 0 | 14 |
| F1.3 | 0 | 13 | 1 | 1 | 15 |
| F1.4 | 5 | 0 | 2 | 1 | 8 |
| F1.5 | 1 | 5 | 6 | 1 | 13 |
| F1.6–F1.9 | 0 | 7 | 3 | 0 | 10 |
| Rapier | 0 | 1 | 3 | 0 | 4 |
| 2D (Fase 2) | 0 | 4 | 2 | 0 | 6 |
| Lintas fitur + NF | — | — | 3 | 6 | 9 |
| **Total** | **16** | **49** | **66** | **9** | **140** |
