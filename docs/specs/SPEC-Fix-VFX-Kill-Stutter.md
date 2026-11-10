# SPEC: FPS turun di bawah 60 / patah-patah saat proyektil menghancurkan AI lawan

Status: **draft v2, menunggu persetujuan** (2026-11-11). Revisi setelah owner menyatakan bahwa **ledakan tanpa lampu pun tetap lag**, dan bahwa gejalanya muncul di **PIJAMA** dan **Moon Wars** (bukan EVEX). Owner minta perbaikan di **engine**, karena game-nya bermacam-macam.

## Gejala

Saat peluru/rudal mengenai dan menghancurkan musuh, frame macet dan FPS turun di bawah 60.

| Game | Setelan | Yang terjadi saat kill |
|---|---|---|
| PIJAMA | WebGPU, kualitas default (medium), postFx (SMAA + AO + bloom), 31 Model + 32 MeshRenderer, 5 lampu, 8 emitter | `vfx.spawn('sparks')` per hit, `vfx.spawn('explosion')` saat rudal/mech meledak (sering beberapa sekaligus karena area damage), musuh dipindah ke y=−50, proyektil pool diparkir di y=−60 |
| Moon Wars | WebGPU, postFx yang sama, 22 Model, 9 lampu, 13 emitter (`fire`/`smoke`/`magic`) | `vfx.spawn('magic')` + `world.destroyEntity` |

### Non-goals

- Mengubah script game. Perbaikan harus berlaku untuk game apa pun tanpa edit script.
- Optimasi umum renderer (LOD, culling, instancing model).

## Pengukuran (M0 awal, 2026-11-11)

Harness: `tests/e2e/perfVfx.e2e.mjs`.

- Editor asli, Play, 60 mesh berlampu, matahari dengan bayangan.
- Script memanggil `ctx.vfx.spawn(preset)` 8× (setiap 2 dtk).
- Yang dicatat: frame terlama dalam 12 frame setelah spawn, dan dalam frame 60–110 setelah spawn (saat efek dihapus).
- Mesin dev macOS, baseline 16,7 ms/frame.

| Varian | Spawn **pertama** | Spawn ke-2…8 | Hapus efek pertama | p99 |
|---|---|---|---|---|
| WebGPU + postFx, `explosion` (berlampu) | **805,8 ms** | 19,8–25,0 ms | 22,8 ms | 21,9 |
| WebGPU + postFx, `sparks` (**tanpa lampu**) | **608,0 ms** | 17,1–19,4 ms | 18,2 ms | 18,2 |
| WebGPU, quality `low` (postFx mati, lampu partikel mati) | 56,0 ms | 17,5–18,9 ms | 17,9 ms | 18,4 |
| WebGPU tanpa postFx, `explosion` (berlampu) | 261,5 ms | 17,0–18,0 ms | **206,5 ms** | 18,3 |
| WebGL + postFx, `explosion` | 295,6 ms | 16,8–17,6 ms | 18,1 ms | 17,7 |

### Kesimpulan

1. **Penyebab utama: kompilasi saat pertama dipakai (first-use).**
   - Material partikel dibuat baru setiap `vfx.spawn`. Kombinasi pertama (backend × postFx × blending × tekstur × jumlah lampu) membuat node material dan pipeline/program shader baru secara sinkron di frame itu.
   - Dengan postFx aktif biayanya 0,6–0,8 dtk, karena post pipeline (MRT untuk AO/bloom) menambah varian. **Ini terjadi tanpa lampu**, sesuai temuan owner.
   - Setiap preset berbeda (`sparks`, `explosion`, `magic`, `fire`, `smoke`) adalah first-use tersendiri, sehingga di game sungguhan hitch muncul berkali-kali pada kill-kill awal.
2. **Penyebab kedua: jumlah lampu berubah.**
   - Lampu ledakan yang ditambah lalu dihapus membuat semua render object yang terkena cahaya dibangun ulang (206,5 ms saat dihapus, tanpa postFx). Mekanismenya terkonfirmasi di three r186: `RenderObject.getDynamicCacheKey()` → `LightsNode.getHash()`.
   - Setiap **jumlah lampu bersamaan** yang baru adalah varian baru: 1 ledakan, 2 ledakan sekaligus (rudal area), dan seterusnya. Akibatnya hitch muncul lagi saat kill beruntun.
3. Setelah varian terkompilasi, spawn dan hapus berikutnya hanya ~17–25 ms. Biaya alokasi per efek (geometri, `InstancedMesh`, buffer) kecil tetapi menambah jitter (19,8–25 ms pada varian berlampu).
4. **Belum diukur, dicek di M0 lanjutan pada scene PIJAMA/Moon Wars:**
   - `fitShadows()` tiap 30 frame, dengan alokasi `Box3`/`Sphere` per mesh dan caster yang diparkir di y=−50/−60 ikut melebarkan frustum bayangan
   - dampak banyak emitter berlampu permanen (Moon Wars: 13 emitter)

## Keputusan

Urutan sesuai dampak yang terukur.

### F1. Prewarm semua varian partikel saat loading

- Saat scene dimuat, di balik layar loading, engine merender **satu frame warm-up melalui pipeline yang sama** (postFx/MRT bila aktif) dengan satu `ParticleSystem` dummy per varian:
  - semua preset bawaan (`fire`, `smoke`, `sparks`, `explosion`, `magic`, `rain`, `splash`)
  - semua emitter di scene, termasuk tekstur aset custom
- Dummy memakai 1 instance dengan alpha 0 di depan kamera, sehingga tidak terlihat. Setelah frame warm-up, dummy dilepas, tetapi material bersama (F2) tetap disimpan.
- Alasan memakai warm-up render dan bukan `renderer.compileAsync`: post pipeline merender scene ke render target MRT miliknya. Kompilasi di luar pipeline itu bisa menghasilkan pipeline key berbeda dan tetap meninggalkan hitch. Warm-up render dijamin memakai key yang sama.
- Bila WebGPU `compileAsync` terbukti memakai key yang sama (dicek di M1), keduanya dipakai: `compileAsync` dulu (tidak memblokir), lalu warm-up render untuk sisanya.
- Target: spawn pertama ≤ 25 ms di semua varian pada tabel pengukuran.
- Tambahan waktu loading diukur. Perkiraan < 1 dtk dengan postFx WebGPU, dan sebagian besar memang biaya yang sekarang dibayar di tengah permainan.

### F2. Material partikel dipakai bersama

- Alpha per instance dibaca lewat nama atribut geometri (`attribute('instanceAlpha')` di TSL; atribut yang sama di WebGL), bukan buffer milik satu emitter. Satu material bisa dipakai semua `InstancedMesh` dengan key yang sama.
- **Cache material** per renderer dengan key `backend | blending | tekstur`. Material tidak di-dispose saat efek selesai; semuanya di-dispose saat bridge dilepas.
- Dengan begitu varian yang sudah di-warm-up (F1) tetap terpakai untuk semua `vfx.spawn` berikutnya: tidak ada node build, dan render object hanya dibuat untuk mesh baru.

### F3. Pool lampu VFX dengan jumlah tetap

- Saat scene mulai, `SceneBridge` membuat **N `PointLight` permanen** (intensitas 0, selalu `visible`), dengan N mengikuti kualitas:
  - `low`: 0
  - `medium`: 2
  - `high`: 4
- `ParticleSystem` meminjam lampu dari pool (posisi, warna, intensitas, flicker) dan mengembalikannya saat selesai.
- Jumlah lampu scene **tidak pernah berubah** selama main, jadi tidak ada build ulang saat ledakan muncul atau hilang, dan tidak ada varian baru saat beberapa ledakan terjadi bersamaan.
- Pool habis: efek terbaru mengambil lampu dari efek tertua yang sedang memudar.
- Lampu pool ikut di-warm-up di F1, sehingga varian "dengan N lampu pool" sudah terkompilasi sejak loading.
- Emitter permanen di scene (obor Moon Wars) tetap memakai lampu sendiri seperti sekarang, karena jumlahnya konstan.

### F4. Pool objek partikel one-shot

`vfx.spawn` untuk preset non-loop memakai ulang `ParticleSystem` (geometri, `InstancedMesh`, buffer alpha/warna) per (preset, kapasitas), alih-alih membuat dan membuang setiap kali. Tujuannya menghilangkan jitter 19–25 ms yang tersisa di tabel. Entity efek tetap dibuat dan dihapus seperti sekarang (API dan perilaku `ctx.vfx.spawn` tidak berubah).

### F5. Instrumentasi performa

`?perf=1` di URL game, atau toggle **Perf** di toolbar Game View, menyalakan perekam yang mencatat:

- frame time per frame
- daftar **frame > 20 ms** beserta kejadian di frame itu: `vfx:spawn(preset)`, `vfx:dispose`, `lights:changed`, `material:new`, `pipeline:compile` / `program:new`, `entity:add/remove`, `fitShadows ms`, `script ms`, `physics ms`, `render ms`

Hasilnya tersedia di `window.__lindenPerf` dan ringkasan dikirim ke Console editor tiap 5 dtk. Saat mati, biayanya nol. Ini dipakai untuk M0 di PIJAMA dan Moon Wars, dan untuk mencegah regresi.

### F6. Bayangan dan entity yang disembunyikan (hanya bila M0 membuktikan berdampak)

- **`fitShadows`**:
  - tanpa alokasi per panggilan
  - fit ulang hanya bila daftar atau posisi caster berubah
  - caster di luar `settings.shadows.distance` dari kamera tidak ikut (field baru, default 200 m, 0 = perilaku lama), sehingga objek yang diparkir di y=−50/−60 tidak melebarkan frustum
- **`entity.active` berlaku saat runtime**:
  - objek disembunyikan dan body Rapier di-disable (bukan dihapus)
  - script entity nonaktif tetap jalan, supaya timer respawn tetap bekerja
  - ini memberi game cara resmi menggantikan trik "parkir jauh"

Tanpa bukti dari M0, F6 dicatat sebagai pekerjaan terpisah.

## Pengukuran sesudah (kriteria lulus)

Harness `tests/e2e/perfVfx.e2e.mjs` diperluas dengan:

- urutan campuran preset (`sparks` → `explosion` → `magic` → `fire` → `smoke`)
- 3 ledakan bersamaan
- jumlah mesh sama dengan PIJAMA (60+ mesh, 5 lampu, postFx)

Semua varian backend × postFx × kualitas harus memenuhi:

| Metrik | Target |
|---|---|
| Frame > 33 ms setelah loading selesai | **0** |
| Spawn pertama tiap preset | ≤ 25 ms |
| 3 ledakan bersamaan | ≤ 25 ms |
| Hapus efek | ≤ 25 ms |
| p99 frame time | ≤ 20 ms |
| `lights:changed` selama main | 0 |
| `material:new` / `pipeline:compile` selama main (setelah warm-up) | 0 untuk preset bawaan |
| Waktu loading tambahan | dicatat; ≤ 1 dtk (WebGPU + postFx) |
| Visual | ledakan tetap punya kilatan cahaya di medium/high; tidak ada kedipan objek dummy saat loading |

Uji manual dengan `?perf=1` di PIJAMA (tembak musuh, rudal area) dan Moon Wars (`magic` + destroy), sebelum dan sesudah. Ringkasan perf dicatat di spec.

## Rencana implementasi

Setiap milestone ditutup dengan `npm run type-check`, `npm test`, dan harness perf (angka dicatat di spec).

**M0 — Instrumentasi + ukur game sungguhan**

1. Perekam perf (`engine/renderer/perfRecorder.ts`), opsi `?perf=1`, toggle di Game View, ringkasan ke Console.
2. Jalankan PIJAMA dan Moon Wars dengan `?perf=1`: catat frame > 20 ms dan penyebabnya, termasuk `fitShadows` (untuk memutuskan F6).
3. Perluas harness (preset campuran, ledakan bersamaan, scene setara PIJAMA).

**M1 — Material bersama + warm-up (F2 + F1)**

- `particleMaterialCache.ts`, `attribute('instanceAlpha')` di WebGPU dan WebGL, warm-up render di player (loading) dan di bridge editor.
- Cek apakah `compileAsync` memakai key yang sama.
- Tes unit:
  - dua emitter dengan key sama memakai satu material
  - dispose emitter tidak men-dispose material bersama
  - dispose bridge membersihkan semuanya
  - tekstur aset punya key sendiri
- Harness: spawn pertama ≤ 25 ms.

**M2 — Pool lampu (F3)**

- `engine/vfx/lightPool.ts`, pool dibuat sesuai `QualityCaps`, `ParticleSystem` meminjam, lampu pool ikut di-warm-up.
- Tes unit:
  - jumlah lampu scene konstan selama 50 spawn/dispose dan 3 ledakan bersamaan
  - pool habis → ambil yang tertua
  - `low` → 0
- Harness: `lights:changed` = 0, hapus efek ≤ 25 ms tanpa postFx.

**M3 — Pool objek one-shot (F4)**

Reuse `ParticleSystem` per preset. Tes: 100 spawn tidak menambah jumlah geometri/buffer setelah pemanasan (`renderer.info.memory`).

**M4 — F6 (bila M0 membuktikan berdampak)**

Masing-masing dengan tesnya sendiri (lihat F6).

**M5 — Verifikasi**

- Tabel sesudah di spec, untuk semua varian.
- PIJAMA dan Moon Wars `?perf=1` sebelum/sesudah.
- Screenshot ledakan (kilatan cahaya tetap ada).
- Regresi: `npm run test:e2e:physics-vfx` dan `test:e2e:touch` tetap lolos.

## Risiko & keterbatasan

- **Loading lebih lama.** Waktu kompilasi pindah dari tengah permainan ke loading. Untuk WebGPU + postFx perkiraannya < 1 dtk. Bila terlalu lama, warm-up dibatasi pada preset yang benar-benar dipakai: emitter scene ditambah nama preset yang muncul di `ctx.vfx.spawn('…')` dalam script hasil kompilasi, dideteksi statis.
- **Pool lampu** menambah biaya fragment kecil yang konstan (N point light ber-intensitas 0) di medium/high. Bila p99 scene tanpa partikel memburuk di M5, pool dibuat hanya untuk scene yang memakai partikel berlampu. Lebih dari N ledakan berlampu bersamaan hanya menerangi N yang terbaru.
- **`attribute('instanceAlpha')`** harus diverifikasi di WebGPU r186. Fallback: material per emitter tetapi di-pool dan tidak di-dispose (tetap tanpa build ulang setelah warm-up).
- **Material dan efek baru di luar preset bawaan** (misalnya tekstur dari script yang tidak terdeteksi) masih bisa first-use sekali. Kejadian ini terlihat di `?perf=1` sebagai `material:new`.
- **Material lain yang baru muncul saat main**, misalnya script yang membuat `new THREE.MeshBasicMaterial` untuk beam/tracer, juga first-use. Ini di luar partikel; perekam perf menandainya, dan agent diberi panduan untuk membuatnya di `onInit`.
