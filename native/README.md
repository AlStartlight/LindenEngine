# native/: OpenSubdiv and Geogram for WebAssembly

```sh
npm run build:native        # everything (first run downloads ~600 MB of toolchain)
native/build.sh <stage>     # toolchain | sources | opensubdiv | geogram | bindings | all
```

The outputs are committed, so building the app never needs Emscripten:

| Output | Built from | Used by |
|---|---|---|
| `engine/mesh/subdiv/wasm/opensubdiv.{js,wasm,d.ts}` | `opensubdiv/binding.cpp` + OpenSubdiv Far/Osd CPU | `engine/mesh/subdiv/opensubdivAdapter.ts` |
| `engine/mesh/uv/wasm/geogram.{js,wasm,d.ts}` | `geogram/binding.cpp` + Geogram (lib only) | `engine/mesh/uv/geogramAdapter.ts` |

Both run only inside the geometry worker and are loaded on first use.

## Reproducibility

- Every version is pinned in `versions.env`: emsdk, CMake, Ninja, uv, Python, and the source archives with their SHA-256.
- Everything is installed under `native/` (`.emsdk`, `.venv`, `.python`, `.cache`, `build`; all gitignored). Nothing is installed system-wide.
  - emsdk needs Python ≥ 3.10, so `uv` fetches a standalone CPython into `.python`.
- `SOURCE_DATE_EPOCH` is pinned, so two clean builds produce byte-identical `.wasm`, `.js` and `.d.ts`. Without it, Geogram embeds its configure time.

## Licences

- **OpenSubdiv** is Apache 2.0, modified (`LICENSES/opensubdiv-NOTICE.txt` ships with it).
- **Geogram** is BSD-3.
- The third-party code compiled into Geogram is xatlas, amgcl, libMeshb and rply (MIT), PoissonRecon (BSD) and zlib.
- The build copies these licence texts to `wasm/LICENSES/`.

The build turns off the parts of Geogram that may not ship:

| Library | Licence | Setting |
|---|---|---|
| TetGen | AGPL | `GEOGRAM_WITH_TETGEN=OFF` |
| Triangle | redistribution only without compensation | `GEOGRAM_WITH_TRIANGLE=OFF` |
| HLBFGS | non-commercial only | `GEOGRAM_WITH_HLBFGS=OFF` |

The build fails if `compile_commands.json` still lists any of their sources.

Because HLBFGS is off, CVT remeshing runs Lloyd iterations only; Newton's optimizer depends on HLBFGS.

## Runtime notes

- Both modules are built with `-fwasm-exceptions`. C++ errors and Geogram assertions (`sys:assert=throw`) therefore come back as typed errors; they do not abort the module.
- `geogram/pre.js` stops Geogram's `initialize()` from mounting the host filesystem (NODEFS) under Node.
- OpenNL's console output is silenced. It reports optional solver plug-ins it cannot `dlopen` in WASM, and real errors come back through return values anyway.
- `wasm-ld` warns about `gzseek`/`gztell` signature mismatches in Geogram's file I/O (`geofile.cpp`). The bindings never call that code.
