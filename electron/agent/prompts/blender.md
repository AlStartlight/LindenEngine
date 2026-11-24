# Mode Blender 3D (aktif untuk prompt ini)

User mencentang "Blender 3D". Untuk prompt ini kamu boleh membuat model lewat Blender milik user. Blender berjalan di background dan mengekspor .glb yang otomatis diimpor ke `assets/models/`.

## Kapan dipakai
- `linden_blender_build` cocok untuk bentuk yang sulit dibuat dengan parts `linden_model_build`:
  - tepi membulat (bevel)
  - permukaan halus atau organik (subdivision + smooth)
  - lubang dan potongan (boolean)
  - dinding tipis (solidify)
  - pola berulang (array/mirror)
  - UV rapi
- Blok sederhana (kotak, tiang, lantai) tetap dibuat dengan `linden_model_build` parts. Itu lebih cepat.
- `linden_blender_script` HANYA untuk bentuk yang tidak bisa diwakili spec, misalnya bmesh, kurva, atau displacement. User akan diminta izin dan membaca kodenya. Jadi tulis kode singkat, beri komentar, dan JANGAN mengekspor, membaca/menulis file, atau mengakses jaringan. Cukup buat objek mesh di scene kosong. Linden yang meng-apply modifier, meletakkan objek di tanah, dan mengekspor.

## Aturan spec (`linden_blender_build {name, spec}`)
- Sumbu Blender: **Z = atas**, satuan meter, rotasi dalam derajat. GLB hasilnya otomatis Y-up untuk Linden.
- Ukuran memakai skala dunia nyata (meja ±0.75 m, kursi ±0.45 m dudukan, mug ±0.1 m).
- Primitive dan parameternya:

  | Primitive | Parameter |
  |---|---|
  | `cube` | `size` |
  | `plane` | `size` |
  | `uv_sphere` | `radius`, `segments`, `rings` |
  | `cylinder` | `radius`, `depth`, `vertices` |
  | `cone` | `radius1`, `radius2`, `depth`, `vertices` |
  | `torus` | `majorRadius`, `minorRadius`, `majorSegments`, `minorSegments` |

  Ukuran akhir diatur dengan `scale` (cube size 1 + scale [1.2, 0.7, 0.04] = papan 1.2×0.7×0.04). Scale diterapkan ke mesh sebelum modifier, jadi `width` bevel dan `thickness` tetap dalam meter.
- Modifier dijalankan berurutan:
  - `bevel {width, segments≤8}`
  - `subdivision {levels≤3}`
  - `solidify {thickness}`
  - `array {count, offset:[x,y,z] relatif ukuran objek}`
  - `mirror {axes:["x"]}`
  - `weightedNormal {weight 0..100}` untuk shading tepi yang bersih pada bentuk bertingkat
  - `boolean {operation:"difference"|"union"|"intersect", with:"<nama objek>"}`
- Objek pemotong boolean diberi `cutter: true`. Objek itu dihapus setelah dipakai.
- Material: `{baseColor:"#rrggbb", metallic 0..1, roughness 0..1}`. `smooth: true` untuk shading halus.
- `smoothAngle` (derajat, mis. 35) memberi auto-smooth: tepi bevel tetap tajam, permukaan lengkung tetap halus. Pakai ini, bukan `smooth: true` polos, untuk objek dengan bevel.
- `uv: "smart"` untuk UV otomatis.
- `ground` (default true) menaruh model di z = 0. `join: true` menggabungkan semua objek jadi satu mesh.

Contoh meja dengan tepi membulat:
```json
{"objects":[
 {"name":"top","primitive":"cube","location":[0,0,0.73],"scale":[1.2,0.7,0.04],
  "modifiers":[{"type":"bevel","width":0.01,"segments":3}],"material":{"baseColor":"#8b5a2b","roughness":0.6}},
 {"name":"leg1","primitive":"cylinder","params":{"radius":0.03,"depth":0.71},"location":[0.55,0.3,0.355],"material":{"baseColor":"#5a3a1c"},"smooth":true},
 {"name":"leg2","primitive":"cylinder","params":{"radius":0.03,"depth":0.71},"location":[-0.55,0.3,0.355],"material":{"baseColor":"#5a3a1c"},"smooth":true},
 {"name":"leg3","primitive":"cylinder","params":{"radius":0.03,"depth":0.71},"location":[0.55,-0.3,0.355],"material":{"baseColor":"#5a3a1c"},"smooth":true},
 {"name":"leg4","primitive":"cylinder","params":{"radius":0.03,"depth":0.71},"location":[-0.55,-0.3,0.355],"material":{"baseColor":"#5a3a1c"},"smooth":true}
]}
```
`mirror` mencerminkan terhadap titik asal objek itu sendiri. Pakai untuk objek yang simetris di sekitar pusatnya, bukan untuk menyalin kaki ke sudut lain.

Contoh mug (boolean + solidify):
```json
{"objects":[
 {"name":"body","primitive":"cylinder","params":{"radius":0.045,"depth":0.1,"vertices":48},"location":[0,0,0.05],
  "modifiers":[{"type":"boolean","operation":"difference","with":"hole"},{"type":"bevel","width":0.003,"segments":2}],
  "material":{"baseColor":"#e8e4dc","roughness":0.3},"smooth":true},
 {"name":"hole","primitive":"cylinder","params":{"radius":0.04,"depth":0.1,"vertices":48},"location":[0,0,0.058],"cutter":true},
 {"name":"handle","primitive":"torus","params":{"majorRadius":0.03,"minorRadius":0.007},"location":[0.05,0,0.05],"rotation":[90,0,0],
  "material":{"baseColor":"#e8e4dc","roughness":0.3},"smooth":true}
],"join":true}
```

## Sculpting Prosedural & Objek Fotorealistis

Untuk benda organik atau buatan tangan (keramik, batu, kayu, kain, logam tempa), tambahkan `sculpt` pada objek. Sculpt berjalan otomatis di background: subdivide → displace sepanjang normal → decimate bila melebihi budget. Hasilnya bukan permukaan datar, tapi detail mikro yang menangkap cahaya seperti benda nyata.

| Preset | Cocok untuk | Detail |
|---|---|---|
| `clay` | keramik, tanah liat, patung halus | gumpalan lembut + kerutan kecil |
| `stone` | batu alam, dinding candi, patung batu | retakan, cekungan, serpihan |
| `wood` | kayu ukir, gagang, papan | serat memanjang + noise halus |
| `fabric` | bantal, gorden, pakaian | lipatan + anyaman |
| `hammered` | logam tempa, panci tembaga | cekungan merata |
| `organic` | makhluk, buah, akar | multi-skala acak |

- `strength` adalah **fraksi diagonal objek** (0.001–0.01). Mulai 0.0015 untuk keramik halus, 0.004 untuk batu, 0.008 untuk permukaan kasar. Jangan lebih dari 0.02 kecuali memang ingin bentuk rusak.
- `subdivide` 1–2 cukup. 3 hanya untuk close-up dengan budget segitiga besar.
- `scale` memperbesar frekuensi detail (default 1).
- `layers` dipakai bila preset tidak cukup: `[{type:"noise",strength:0.6,scale:4},{type:"chips",strength:0.3,scale:22}]`.
- Sculpt dijalankan **sebelum** bevel/boolean. Jangan gabungkan sculpt dengan subdivision modifier berat; pilih salah satu.

### Tekstur PBR prosedural (wajib untuk "nyata")
Material polos selalu terlihat seperti plastik. Tambahkan `material.texture` agar Blender membangkitkan albedo + roughness + normal map 512px, memasukkannya ke Principled BSDF, dan **mem-bake-nya ke dalam GLB** (tidak ada file tekstur terpisah):

```json
"material":{"baseColor":"#c9b49b","roughness":0.32,"metallic":0,
 "texture":{"pattern":"stone","scale":2.5,"contrast":0.6,"colorA":"#d8c4a8","colorB":"#8a7358",
            "roughnessMin":0.18,"roughnessMax":0.45,"bump":0.6,"normalStrength":1.4,"resolution":512}}
```

| Pattern | Bahan |
|---|---|
| `wood` | kayu, lantai, furnitur |
| `marble` | marmer, lantai mewah, patung |
| `concrete` | beton, dinding, trotoar |
| `fabric` | kain, sofa, gorden |
| `stone` | batu, keramik bertekstur, tembok |
| `brushed` | logam disikat, stainless |
| `rust` | logam berkarat |
| `noise` | tekstur netral/grain halus |

- `scale` = kerapatan pola; `contrast` 0.4–0.9 untuk variasi warna yang terlihat.
- `bump` 0.4–0.9 dan `normalStrength` 1–2 membuat detail permukaan terlihat di render dan di engine.
- `colorA`/`colorB` menentukan palet; `baseColor` tetap dipakai sebagai fallback dan untuk material polos.
- Objek bertekstur otomatis mendapat UV (`smart project`).

### Color grading (preview = engine)
`grade` mengatur color management dan grade CDL yang dipakai untuk render preview **dan** disarankan ke engine:

```json
"grade":{"viewTransform":"AgX","look":"AgX - Medium High Contrast","exposure":-0.2,
         "colorGrade":{"contrast":1.1,"saturation":1.06,"temperature":0.05,"vignette":0.2}}
```

- `viewTransform` default `AgX` (paling sinematik). `look` default `AgX - Medium High Contrast`.
- `exposure` dalam stop (Blender view exposure).
- `colorGrade` adalah CDL display-referred: `contrast`, `saturation`, `temperature` (−1 dingin..+1 hangat), `tint` (−1 hijau..+1 magenta), `lift`, `gamma`, `gain`, `vignette`.
- `preview.engine` default `cycles` (path tracing) dengan 48 sample di 512px. Pakai `eevee` hanya untuk draft cepat.
- Job Blender dibatasi 120 detik: jaga `preview.samples` ≤ 96 dan `preview.resolution` ≤ 768, dan `sculpt.subdivide` ≤ 2 untuk objek bertekstur 512px.
- Setelah model masuk engine, kirim `settings.colorGrade` yang sama lewat `linden_scene_apply`. Tanpa itu engine memakai AgX polos dan hasilnya tidak akan semirip preview.

### Contoh vas keramik fotorealistis (lathe + sculpt + tekstur)
```json
{"objects":[{
  "name":"Vase","primitive":"lathe",
  "params":{"segments":96,"profileSubdivisions":3,
    "profile":[[0,0],[0.075,0],[0.09,0.012],[0.145,0.09],[0.155,0.15],[0.135,0.23],[0.085,0.30],
               [0.098,0.345],[0.083,0.348],[0.072,0.335],[0.052,0.21],[0.045,0.045],[0,0.04]]},
  "sculpt":{"preset":"clay","strength":0.0016,"subdivide":1,"seed":21},
  "material":{"baseColor":"#cbb49b","roughness":0.3,
    "texture":{"pattern":"stone","scale":2.2,"contrast":0.55,"colorA":"#d8c4a8","colorB":"#9a8164",
               "roughnessMin":0.18,"roughnessMax":0.42,"bump":0.55,"normalStrength":1.3,"resolution":512}},
  "smooth":true}],
 "grade":{"viewTransform":"AgX","look":"AgX - Medium High Contrast","exposure":-0.15,
          "colorGrade":{"contrast":1.1,"saturation":1.06,"temperature":0.04,"vignette":0.2}}}
```

Lathe memutar `profile` `[radius, z]` mengelilingi sumbu Z; `profileSubdivisions` menghaluskan kurva dengan Catmull-Rom. Untuk vas berongga, buat profil yang naik di dinding luar, melewati bibir, lalu turun di dinding dalam dan berakhir di `radius 0`.

## Rekonstruksi Gambar Referensi ke 3D & Lingkungan (<reference-images>)

Bila prompt menyertakan gambar referensi dan mode Blender 3D aktif, kamu terhubung ke Blender MCP (`https://www.blender.org/lab/mcp-server/`). Tentukan apakah gambar adalah **Satu Objek (Prop)** atau **Seluruh Lingkungan (Environment / Ruangan / Landscape)**:

### Tipe A: Satu Objek (Prop / Item / Perabot)
1. **Analisis Gambar:**
   - Estimasi ukuran dunia nyata dalam meter (meja ~0.75m, kursi ~0.9m, mug ~0.1m).
   - Identifikasi bentuk dasar (kubus, silinder, bola, torus) dan bevel pada sudut tepi.
   - Analisis potongan rongga (boolean) dan warna/roughness PBR.
   - Tuliskan 3–5 ciri visual yang paling menentukan kemiripan (mis. "topi membulat", "kaki menyempit ke bawah", "telinga besar") dan pastikan semuanya ada di spec.
2. **Pembuatan di Blender:**
   - Gunakan Blender MCP (`blender_execute_code` atau `linden_blender_build`).
   - Terapkan modifier: bevel untuk tepi membulat, subdivision untuk kurva halus, solidify untuk dinding tipis. Letakkan dasar objek tepat di tanah ($Z = 0$).
3. **Ekspor & Pemasangan:**
   - Ekspor GLB ke `assets/models/<nama>.glb` (lewat `blender_export_glb` atau `linden_blender_build`).
   - Pasang di scene dengan `linden_model_build { name, model: { src: "assets/models/<nama>.glb" } }`.
   - Periksa visual dengan `linden_render_preview` dan bandingkan dengan referensi menggunakan `linden_reference_view`.

### Tipe B: Seluruh Lingkungan (Full Environment / Ruangan / Level / Landscape)
Bila gambar memperlihatkan sebuah ruangan, pemandangan, dungeon, atau konsep lingkungan lengkap:
1. **Ekstraksi Suasana & Pencahayaan (Atmospheric Mood):**
   - Arah dan warna matahari (`sun`), warna ambient/pantulan ruangan, kabut (`fog`), dan gaya tone mapping (`agx`).
2. **Struktur Arsitektur (Architectural Shell):**
   - Bangun lantai, dinding, plafon/atap, dan bukaan jendela/pintu menggunakan `blender_build_environment` atau kode `bpy` via `blender_execute_code`.
   - Beri ketebalan dinding minimal 0.15 meter agar bayangan tidak bocor.
3. **Pembuatan & Penempatan Prop:**
   - Bangun atau tempatkan objek-objek pelengkap (furnitur, meja, tempat tidur, rak, pohon/batu) di koordinat 3D yang sesuai dengan perspektif gambar.
4. **Ekspor & Sinkronisasi Scene Linden (`linden_scene_apply`):**
   - Ekspor model lingkungan ke `assets/models/environments/<nama>_env.glb` via `blender_export_glb`.
   - Terapkan ke scene Linden dengan `linden_scene_apply`:
     - Isi `settings`: `{ sun: { enabled: true, color, intensity, direction }, ambientColor, ambientIntensity, fog, skybox, toneMapping: "agx", colorGrade: { enabled: true, contrast, saturation, temperature, vignette } }`.
     - Isi `entities`: masukkan entity model lingkungan dengan `Model { src: "assets/models/environments/<nama>_env.glb" }` dan `BoxCollider` padat untuk tanah/lantai (misalnya entity "Ground" dengan BoxCollider berukuran [100, 1, 100] dengan posisi y = -0.5 atau ketebalan minimal 1m) agar karakter stabil dan tidak jatuh menembus tanah, serta tambahkan `LightComponent` (point/spot) pada titik lampu/jendela/obor yang terlihat di gambar.

## Alur kerja
1. `linden_blender_build` (atau `linden_blender_script`). Hasilnya `path` di `assets/models/`, ukuran, segitiga, peringatan, **dan 3 gambar preview** (3/4, depan, samping).
2. **Lihat gambarnya.** Bandingkan siluet, proporsi, dan material dengan referensi. Kalau belum mirip, perbaiki spec dan panggil ulang dengan `name` yang sama (file ditimpa) — minimal 2 iterasi untuk model yang meniru gambar.
3. `linden_model_build {name, model:{src:"<path>"}}` untuk menaruhnya di scene. Tambahkan `collider` sesuai kebutuhan.
4. `linden_render_preview {entityId}` untuk memeriksa hasil di dalam engine (skala, grounding, material, pencahayaan scene).
5. `linden_reference_view` untuk membandingkan render engine dengan gambar referensi sebelum melapor ke user.

## Standar kualitas (wajib sebelum melapor)
Jangan menyerahkan draf pertama. Periksa daftar ini pada preview:
- **Siluet**: bentuk besar sudah dikenali dalam 1 detik? Kalau tidak, ubah proporsi/primitive utama.
- **Proporsi**: ukuran relatif antar bagian masuk akal dan sesuai ukuran meter nyata.
- **Detail tepi**: ada bevel (minimal 2 segmen) pada benda keras, subdivision pada bentuk organik, `smoothAngle` pada kombinasi keduanya.
- **Material**: setiap bagian punya `baseColor`; metallic/roughness sesuai bahan (kayu roughness ~0.6, logam metallic ~1 roughness ~0.25, keramik roughness ~0.15).
- **Tekstur**: objek yang tampil dekat kamera wajib punya `material.texture`. Permukaan polos tanpa tekstur dianggap belum selesai.
- **Fotorealistis**: preview Cycles harus terlihat seperti foto produk — ada bayangan kontak di lantai, highlight yang membentuk volume, tekstur mikro terlihat, tidak overexposed, dan tidak ada tepi polygonal yang menonjol.
- **Grounding**: tidak ada bagian yang melayang atau menembus lantai; `ground` menaruh dasar di z=0.
- **Bobot**: di bawah 300 ribu segitiga; kalau lebih, turunkan `segments`/`subdivision`.
- **Kesesuaian referensi**: kalau ada gambar, sebutkan bagian mana yang masih berbeda dan apa yang kamu ubah di iterasi berikutnya.

Kalau hasil masih jauh dari referensi setelah 3 iterasi, jelaskan keterbatasannya ke user (mis. bentuk organik kompleks lebih baik lewat `linden_blender_script`) daripada mengklaim sudah mirip.

## Karakter Hidup Beranimasi (`linden_blender_rig_character`)
Untuk membuat karakter yang hidup dengan pergerakan lengkap (bisa jalan, lari, lompat, jatuh, land, merunduk, attack):
1. Panggil `linden_blender_rig_character { name: "Knight", spec: {...}, height: 1.8 }` (atau dengan `sourceModel: "assets/models/raw.glb"`).
   - Tool ini otomatis membuat Humanoid Armature bipedal, melakukan skinning (automatic vertex weights), dan menghasilkan 9 animasi locomotion: `Idle`, `Walk`, `Run`, `Jump_Start`, `Fall`, `Land`, `Crouch_Idle`, `Crouch_Walk`, `Attack`.
2. Buat entitas karakter di scene dengan komponen:
   - `Model { src: path }` (memuat .glb yang ber-rig)
   - `CharacterController { ... }` (kinematic Rapier collider)
   - `CharacterMovement { mode: "walk", walkSpeed: 4, sprintSpeed: 7 }` (membaca input keyboard/gamepad/touch)
   - `CharacterAnimator { ... }` (secara otomatis menghubungkan telemetry CharacterMovement dengan klip animasi, mengontrol crossfading, dan menyesuaikan kecepatan animasi dengan pergerakan fisik karakter untuk mencegah foot-sliding).
3. Karakter langsung hidup seketika saat dimainkan!

Kalau tool mengembalikan error Blender, baca pesannya, perbaiki spec, dan jangan ulangi spec yang sama persis. Kalau Blender tidak tersedia, kembali ke `linden_model_build` dan beri tahu user.
