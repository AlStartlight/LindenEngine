# SPEC: Cosmic Rift world + Playwright verification

Status: **implemented** (2026-11-25). Verified against the real Electron app (WebGL2, 60 fps).

## Tujuan

Membuktikan bahwa "dunia" yang dibuat benar-benar hidup di Linden Engine, bukan hanya file scene:

1. **Lingkungan** dimuat: IBL HDR, langit berbintang, kabut, color grading, planet bercincin,
   gerbang batu hasil sculpt Blender, portal, kristal, batu mengambang, rune circle, dan cahaya.
2. **Karakter** benar-benar beranimasi: 9 clip locomotion, state machine idle/walk/run/jump/land,
   tulang skeleton bergerak antar-frame, dan karakter berpindah posisi saat input ditekan.

Pengujian memakai Playwright langsung terhadap Electron. Di sesi DSH ini tidak ada server
`Playwright MCP` yang ter-mount, jadi API Playwright dipakai langsung — driver yang sama, tetapi
bisa membaca World/SceneBridge, yang tidak bisa dilakukan tool browser-only MCP.

## Dunia yang dikirim

| File | Isi |
|---|---|
| `scenes/CosmicRift.lscene` | 18 entity: sky dome/background, ground, gate, portal, planet, rocks, crystals, lights, camera, warden |
| `assets/models/astral_warden.glb` | 22 bones, 9 clip: Idle, Walk, Run, Jump_Start, Fall, Land, Crouch_Idle, Crouch_Walk, Attack |
| `assets/models/ruin_gate.glb` | gerbang batu sculpt + tekstur PBR 256px tertanam |
| `assets/hdri/cosmic_rift.hdr` | environment nebula 2048×1024 untuk IBL |
| `assets/sky/cosmic_sky.png` | tekstur langit 4096×2048 untuk background |
| `assets/sky/portal_swirl.png` | tekstur pusaran portal |

Latar belakang memakai PNG (bukan HDR langsung) karena jalur background equirect engine
mengecilkan tekstur ke PMREM sehingga bintang tampak seperti blob. `ScenePipeline` sekarang
memaksa `minFilter = LinearFilter`, `generateMipmaps = false` untuk tekstur langit agar bintang tetap
tajam; HDR tetap dipakai untuk IBL.

## Hook pengujian

`player/main.ts` mengekspos player hanya bila `window.__LINDEN_DEBUG__` sudah diset sebelum frame
mulai. Playwright memakai `app.context().addInitScript()` untuk menyetel flag itu. Hook memberi
akses ke `world`, `bridge`, `scene`, animation player, dan bone transforms tanpa mengubah scene.

## Assertion (`tests/e2e/cosmicRift.e2e.mjs`)

- 18 entity dunia dimuat, termasuk `Astral Warden`, `Rift Gate`, `Ringed Planet`.
- `environment = assets/hdri/cosmic_rift.hdr`, `skybox = assets/sky/cosmic_sky.png`.
- fog aktif, `colorGrade` aktif, tone mapping `agx`.
- 11 model, 1 particle emitter, 4 lights.
- 9 clip karakter tersedia; state awal `idle`, clip `Idle`, grounded.
- Waktu animasi berjalan (clip loop) dan 22 bone berubah antar-frame.
- W men-trigger `walk` + clip `Walk`, posisi Z berubah > 1.5 m.
- Lepas tombol kembali `idle`; Shift+W menjadi `run` + clip `Run` dengan speed 7 vs 4.
- Space: karakter di udara lalu land dan grounded.
- Screenshot idle dan walk berbeda, > 20 KB.
- Tidak ada error asset/load di console.

## Hasil

```
15/15 passed
WebGL2 60 FPS ~5 ms
```

Screenshot: `docs/media/cosmic-rift-idle.png`, `docs/media/cosmic-rift-walk.png`.

## Menjalankan

```bash
npm run dev
npm run test:e2e:cosmic
```

## Batasan

- Karakter memakai rig humanoid biped dari `blender-bridge/rigging`; belum ada rig burung/phoenix.
- Gerbang dan planet adalah prop statis; hanya karakter yang beranimasi skeletal.
- Test berjalan di WebGL2; jalur WebGPU belum diuji.
