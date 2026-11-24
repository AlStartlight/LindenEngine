# SPEC: Pipeline Blender Fotorealistis (sculpt + PBR bake + color grading)

Status: **implemented** (2026-11-24). Diverifikasi dengan Blender 5.2.3 (`/Applications/Blender.app`), Cycles CPU,
dan suite Vitest (935 tes + e2e Blender nyata).

## Tujuan

Agen "Blender 3D" sebelumnya hanya bisa membuat bentuk dari primitive + modifier dengan material polos. Spec ini
menambahkan tiga kemampuan yang membuat objek hasil Blender terlihat seperti benda nyata dan tampil sama di Linden
Engine:

1. **Sculpting prosedural** (`object.sculpt`) — subdivide, displace sepanjang normal dengan preset/layer, lalu
   decimate otomatis bila melewati budget.
2. **Tekstur PBR prosedural yang di-bake ke GLB** (`material.texture`) — albedo, roughness/metallic (ORM), dan
   tangent normal map dibangkitkan dengan numpy di dalam Blender, dipasang ke Principled BSDF, dan diekspor
   tertanam di `.glb` (tanpa file tekstur terpisah).
3. **Color grading dua sisi** (`spec.grade` + `settings.colorGrade`) — Blender memakai AgX + look + white balance
   untuk render preview, lalu grade CDL display-referred yang **sama persis** diterapkan engine sebagai pass
   post-processing. Preview Blender dan tampilan engine memakai matematika yang identik.

Tambahan pendukung: primitive `lathe` (profil `[radius, z]` di-revolve, dihaluskan Catmull-Rom), UV silindris
bebas jahitan untuk benda putar, dan `clearcoat` untuk glasir keramik.

## Perubahan spec (`shared/blenderSpec.ts` + validasi kembar di `runner.py`)

### Primitive `lathe`

```json
{"primitive":"lathe","params":{"profile":[[0,0],[0.09,0.012],[0.145,0.09],[0,0.04]],"segments":96,"profileSubdivisions":3}}
```

- `profile`: 2–128 titik `[radius, z]` (meter). Profil tertutup (mulai dan berakhir di radius 0) menghasilkan
  benda padat/berongga yang kedap.
- `profileSubdivisions`: 1–8, resampling Catmull-Rom supaya profil kasar tetap melengkung mulus.
- `uv: "cylindrical"` (default untuk lathe bertekstur) memetakan sudut → U dan tinggi → V tanpa jahitan di depan.

### `sculpt`

```json
{"preset":"clay","strength":0.0015,"scale":1,"seed":21,"subdivide":1,"decimate":0.6}
```

| Field | Arti |
|---|---|
| `preset` | `clay`, `stone`, `wood`, `fabric`, `hammered`, `organic`, `custom` |
| `strength` | fraksi diagonal bounding box (0–0.2). 0.0015 keramik halus, 0.004 batu, 0.008 kasar |
| `scale` | pengali frekuensi detail |
| `seed` | seed deterministik |
| `subdivide` | level simple-subdivision sebelum displacement (0–3, biaya 4^level) |
| `decimate` | rasio collapse 0–1 setelah sculpt; default otomatis bila > 280k segitiga |
| `layers` | layer manual: `noise`, `ridged`, `dents`, `wrinkles`, `grain`, `chips` |

Sculpt dijalankan **sebelum** modifier lain, sehingga bevel/boolean bekerja pada permukaan yang sudah berdetail.
`strength` dasar dikalikan bobot layer; layer manual menimpa preset.

### `material.texture`

```json
{"pattern":"stone","scale":2.6,"contrast":0.62,"colorA":"#ddcab0","colorB":"#92795c",
 "roughnessMin":0.2,"roughnessMax":0.44,"bump":0.55,"normalStrength":1.35,"resolution":512,"seed":17}
```

- Pola: `noise`, `wood`, `marble`, `concrete`, `fabric`, `stone`, `brushed`, `rust`.
- Semua peta dibangkitkan sebagai PNG 8-bit di folder job, dimuat, di-`pack()`, lalu diekspor sebagai
  `baseColorTexture`, `metallicRoughnessTexture`, dan `normalTexture` di dalam GLB yang sama.
- AO dipanggang ke albedo (tidak menambah tekstur keempat) supaya biaya GPU rendah.
- `material.clearcoat` / `clearcoatRoughness` → `KHR_materials_clearcoat` (glasir keramik, pernis kayu).

### `grade` dan `preview`

```json
{"grade":{"viewTransform":"AgX","look":"AgX - Medium High Contrast","exposure":-0.1,
          "whiteBalance":{"temperature":6600,"tint":2},
          "colorGrade":{"contrast":1.12,"saturation":1.08,"temperature":0.05,"vignette":0.2}},
 "preview":{"engine":"cycles","samples":64,"resolution":768,"backdrop":true}}
```

- Blender: `scene.view_settings` (AgX/Filmic/Standard/Neutral, look, exposure stop, white balance).
- `colorGrade` diterapkan ke PNG preview setelah render (numpy, display-referred sRGB).
- `preview.engine` default `cycles`; `samples` default 48; `resolution` default 512; `backdrop` menambah lantai
  studio untuk bayangan kontak.
- Hasil `LINDEN_RESULT` menyertakan `textures[]` dan `grade{}` supaya agen bisa meneruskan grade ke
  `linden_scene_apply`.

## Preview fotorealistis (`runner.py`)

- Engine default **Cycles CPU**, denoise OIDN, max 6 bounces.
- Lighting studio 4 area light (key/fill/rim/top) yang skalanya mengikuti diagonal objek; world gradient gelap.
- Lantai studio besar (bayangan kontak), kamera 70 mm, framing otomatis, tiga sudut (3/4, depan, samping).
- Color management diterapkan sebelum render; grade CDL setelah render.
- Waktu terukur: vas 50k segitiga + 512px tekstur + 3×768px/64 sample ≈ 40 detik di Apple Silicon. Default
  (512px/48 sample) ≈ 10 detik. Batas job Blender tetap 120 detik.

## Color grading engine (`engine/scene/SceneSettings.ts`, `engine/renderer/postProcessing.ts`)

`settings.colorGrade`:

| Field | Rentang | Netral |
|---|---|---|
| `enabled` | bool | false |
| `contrast` | 0–4 | 1 |
| `saturation` | 0–4 | 1 |
| `temperature` | −1..1 (dingin..hangat) | 0 |
| `tint` | −1..1 (hijau..magenta) | 0 |
| `lift` | −0.5..0.5 | 0 |
| `gamma` | 0.1–4 | 1 |
| `gain` | 0–4 | 1 |
| `vignette` | 0–1 | 0 |

- **WebGL2**: `ShaderPass` setelah `OutputPass`, sebelum SMAA/FXAA.
- **WebGPU**: node TSL setelah `renderOutput`, sebelum AA; bila node gagal dibuat, frame tetap jalan tanpa grade
  (warning, bukan crash).
- Grade mengaktifkan pipeline post-processing walau `postFx.enabled` false. Pada profil kualitas `low`
  post-processing tetap dimatikan sesuai `QualityCaps`.
- Scene lama tetap valid: `normalizeSceneSettings` memberi default netral, dan blok `colorGrade` yang tidak valid
  dibuang dengan warning tanpa menolak scene.
- Nilai grade juga bisa diatur di panel **Scene Settings → Color Grading**.

## Alur agen

1. `linden_blender_build` dengan `sculpt`, `material.texture`, `grade`, `preview`.
2. Agen melihat 3 preview. Iterasi sampai siluet, proporsi, tekstur, dan pencahayaan masuk akal.
3. `linden_model_build {model:{src:"assets/models/<nama>.glb"}}`.
4. `linden_scene_apply {settings:{colorGrade: <blender.grade.colorGrade>}}` agar engine sama dengan preview.
5. `linden_render_preview` / `linden_reference_view` untuk verifikasi akhir.

`electron/agent/prompts/blender.md` memuat aturan lengkap, tabel preset/pola, contoh vas, dan standar kualitas
(tekstur wajib untuk objek dekat kamera, bayangan kontak, tidak overexposed).

## Demo yang dikirim

- `assets/models/photoreal_vase.glb` — vas keramik 50.304 segitiga, 3 peta PBR tertanam, glasir clearcoat.
- `scenes/PhotorealStudio.lscene` — scene studio dengan grade yang sama, lantai beton, camera, rim/fill light.
- `samples/photoreal-vase/spec.json` + `README.md` — spec yang bisa dijalankan ulang.
- `docs/media/photoreal-vase-*.png` — preview Blender 3/4, depan, samping.
- `docs/media/engine-photoreal-*.png` — render scene yang sama di runtime player Electron (GLB + `colorGrade`),
  dihasilkan oleh `npm run test:e2e:photoreal`.

## Non-goals / batasan

- Tidak melakukan baking dari material node arbitrer (hanya pola prosedural yang dikenal).
- Tidak memakai sculpt brush interaktif; sculpt sepenuhnya prosedural dan deterministik.
- Tidak mengekspor .blend atau tekstur eksternal; GLB self-contained.
- LUT `.cube` belum didukung; grade memakai CDL.
- Preview adalah best-effort: bila render gagal, GLB tetap diekspor dan warning dilaporkan.

## Uji

- `tests/agent/blenderTools.test.ts` — schema lathe/sculpt/texture/grade/preview, penolakan kombinasi tidak valid.
- `tests/agent/blenderBuild.e2e.test.ts` — Blender nyata: vas lathe + sculpt + 3 peta PBR tertanam + 3 preview.
- `tests/renderer/colorGrade.test.ts` — default netral, scene lama, fallback nilai tidak valid.
- `tests/scene/photorealStudioScene.test.ts` — demo `.lscene` valid, GLB ada, round-trip serializer.
- `tests/e2e/photorealPreview.e2e.mjs` (`npm run test:e2e:photoreal`) — Electron nyata merender scene demo lewat
  player runtime; memverifikasi GLB bertekstur + pass `colorGrade` dan menyimpan PNG ke `docs/media/`.
- Suite penuh: 938 tes lulus.
