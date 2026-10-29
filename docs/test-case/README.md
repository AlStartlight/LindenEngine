# Linden Engine — 10.000 Test Cases

10.000 test case untuk modul inti Linden Engine. Dijalankan dengan **Playwright Test** dalam mode headless **tanpa browser**: tidak ada spec yang memakai fixture `page`/`browser`, jadi Playwright tidak meluncurkan Chromium dan semua test berjalan di Node.

```bash
npm run test:cases                                   # semua 10.000 test
npm run test:cases -- specs/06-world.spec.ts         # satu file
npm run test:cases -- -g "TC-SCN-0612"               # satu test berdasarkan ID
npx playwright show-report docs/test-case/report/html
```

Setiap test punya ID unik `TC-<MODUL>-<nomor>`. Input dibangkitkan dari PRNG ber-seed (`mulberry32` di `specs/_helpers.ts`), sehingga ID yang sama selalu menghasilkan input yang sama dan kegagalan bisa direproduksi.

## Cakupan

| File | ID | Modul yang diuji | Jumlah | Yang diperiksa |
| --- | --- | --- | --- | --- |
| `01-vector3.spec.ts` | `TC-VEC` | `engine/utils` `Vector3Utils` | 1.200 | Komutatif, invers, normalisasi, ortogonalitas cross, simetri jarak, skala |
| `02-easing.spec.ts` | `TC-EAS` | `engine/time/Tween` `Easing` (22 fungsi) | 1.100 | Titik ujung, rentang [0,1], dualitas In/Out, simetri InOut |
| `03-layermask.spec.ts` | `TC-LYR` | `engine/scene/LayerMask` | 1.024 | `hasLayer` untuk semua pasangan 32×32 layer |
| `04-signal.spec.ts` | `TC-SIG` | `engine/scene/Signal` | 600 | Jumlah panggilan, disconnect, urutan, isolasi exception, target/method |
| `05-scene-parse.spec.ts` | `TC-SCN` | `engine/scene/parseSceneFile` | 1.800 | 600 scene valid + 12 jenis kerusakan × 100 (kode error yang tepat) |
| `06-world.spec.ts` | `TC-WLD` | `engine/ecs/World` | 1.800 | Urutan hierarki, destroy subtree, deteksi `PARENT_CYCLE`, reparent, indeks tag |
| `07-command-stack.spec.ts` | `TC-CMD` | `editor/commands/CommandStack` | 1.000 | 700 urutan undo/redo acak vs model referensi, group, dirty flag |
| `08-serializer.spec.ts` | `TC-SER` | `engine/scene/serializer` | 800 | Round-trip `.lscene` v2 byte-identik, `stableStringify` stabil |
| `09-input.spec.ts` | `TC-INP` | `engine/input/InputActions` | 400 | Kombinasi WASD × deadzone, stick analog, just pressed/released |
| `10-tween.spec.ts` | `TC-TWN` | `engine/time/Tween` | 276 | Interpolasi 22 easing, kill, delay, loops, `then`, `bindWorld` |
| **Total** | | | **10.000** | |

## Hasil terakhir

23 Okt 2026, macOS, Node 24.21, Playwright 1.56.1: **10.000 lulus, 0 gagal, 0 skip, 0 flaky** dalam ±17 detik (paralel).

Laporan: `report/results.json` (mesin) dan `report/html/` (browsable).

## Belum dicakup

UI editor (React), viewport Three.js, Rapier physics, dan Electron IPC. Bagian itu butuh browser atau Electron (`page` / `_electron`) dan sebaiknya menjadi suite E2E terpisah.
