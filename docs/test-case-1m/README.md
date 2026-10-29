# Linden Engine — 680.000 Test Case Unik

680.000 test case yang dibangkitkan dari generator deterministik, dijalankan dengan **Playwright Test** dalam mode headless **tanpa browser**. Tidak ada spec yang memakai fixture `page`/`browser`; UI React dirender di Node dengan `react-dom/server`.

```bash
npm run test:cases:1m                                     # semua kategori (±35 menit), hasil di report/REPORT.md
ONLY=undo bash docs/test-case-1m/tools/run-all.sh          # satu kategori
npx playwright test -c docs/test-case-1m/playwright.config.ts -g "TC-UND-0012345"   # satu test (jalankan tools/generate-parts.mjs dulu)
```

## Keunikan

- Setiap test punya ID `TC-<KATEGORI>-<7 digit>` dan judul yang memuat **input persisnya** (operasi + parameter, atau seed yang membangkitkan input).
- `lib/summary-reporter.ts` mengambil sidik jari SHA-1 dari `kategori | judul tanpa ID` untuk setiap test. `tools/merge-report.mjs` menggabungkan semua batch dan menghitung duplikat secara global. Run dianggap sah hanya jika duplikat = 0.
- Kasus berbasis grid (mis. `node Add(A=3, B=-7)`, `Move (W) by (2, -1, 5)`) unik karena kombinasi parameternya berbeda. Kasus berbasis seed memakai ruang seed terpisah per skenario (`seedOf(space, n)`), sehingga tidak ada dua skenario yang berbagi input.

Kategori Blueprint, Material, Animator dan Sequencer (320.000 case) dihapus bersama fiturnya; lihat `docs/specs/SPEC-Remove-Blueprint-Material-Animator-Sequencer.md`. Nama folder tetap `test-case-1m`.

## Cakupan

| Kategori | ID | Jumlah | Yang diuji |
| --- | --- | --- | --- |
| Scene | `TC-SCN` | 100.000 | Parser `.lscene` (valid + 12 jenis kerusakan), round-trip serializer v2, hierarki & tag di ECS `World` |
| Godot Bridge | `TC-GDT` | 100.000 | Literal Variant, Vector/Color, sanitasi nama node, Euler↔Transform3D, `.tscn` write/parse, groups, export/import world |
| New / Open / Save / Save As | `TC-FIL` | 60.000 | Lewat `editorStore`: reset, save→open, save-as, file rusak, dirty flag |
| Project Settings | `TC-SET` | 60.000 | Tag (tambah/hapus), layer → `LayerMask`, collision matrix simetris |
| Undo / Redo | `TC-UND` | 100.000 | 11 jenis command: undo mengembalikan snapshot scene persis, redo menerapkan ulang; urutan acak |
| GameObject | `TC-GOB` | 60.000 | Create di indeks sibling, Duplicate, Set Tags, active/static |
| Window + Input Actions | `TC-WIN` | 60.000 | Menu Window, perpindahan tab editor, Move/Jump/getAxis/stick |
| Inspector + Move/Rotate/Scale/2D | `TC-TRF` | 100.000 | Edit Transform lewat command + undo/redo, mode 2D, merge drag gizmo |
| Editor UI | `TC-UI` | 40.000 | Console, Toolbar, Project Settings, Input Actions, Inspector, Project panel |
| **Total** | | **680.000** | |

## Struktur

```
gen/            9 generator kategori (sumber kebenaran untuk input dan ekspektasi)
lib/            define.ts (slice → test), util.ts (PRNG), store.ts (reset editorStore), summary-reporter.ts
specs/          200 file part × 5.000 test, dibangkitkan oleh tools/generate-parts.mjs
ui/             entry.ts → ui-bundle.mjs (esbuild), karena Playwright mengubah JSX di file .tsx
tools/          manifest, generate-parts, build-ui, run-all.sh, merge-report
report/         batch-*.json, fingerprints-*.txt, REPORT.md
```

## Batasan

- UI diuji lewat render statis (`react-dom/server`): markup dan teks diperiksa, tetapi klik, drag, dan efek (`useEffect`) tidak dijalankan. Contohnya, Hierarchy terisi lewat `useEffect`, jadi isinya tidak terlihat di render statis. Interaksi nyata butuh suite E2E dengan browser/Electron.
- Tampilan "Both" (Project + Console berdampingan) adalah state lokal `EditorLayout`, tidak diuji terpisah.
- Viewport Three.js (canvas/WebGL) dan physics Rapier tidak dijalankan.
