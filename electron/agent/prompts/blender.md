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
  - `boolean {operation:"difference"|"union"|"intersect", with:"<nama objek>"}`
- Objek pemotong boolean diberi `cutter: true`. Objek itu dihapus setelah dipakai.
- Material: `{baseColor:"#rrggbb", metallic 0..1, roughness 0..1}`. `smooth: true` untuk shading halus. `uv: "smart"` untuk UV otomatis.
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

## Alur kerja
1. `linden_blender_build` (atau `linden_blender_script`). Hasilnya `path` di `assets/models/`, ukuran, segitiga, dan peringatan.
2. `linden_model_build {name, model:{src:"<path>"}}` untuk menaruhnya di scene. Tambahkan `collider` sesuai kebutuhan.
3. `linden_render_preview {entityId}`. Periksa proporsi, skala, material, dan apakah model melayang.
4. Kalau belum pas, perbaiki spec lalu ulangi langkah 1–3 (maksimal 3 iterasi). Panggil ulang dengan `name` yang sama: file GLB akan ditimpa dan entity diperbarui.

Kalau tool mengembalikan error Blender, baca pesannya, perbaiki spec, dan jangan ulangi spec yang sama persis. Kalau Blender tidak tersedia, kembali ke `linden_model_build` dan beri tahu user.
