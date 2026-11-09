# SPEC: img2threejs reconstruction in Linden Agent (OpenCode)

Status: **implemented** on `feat/img2threejs-agent` (2026-11-07). M0 to M4 are done; the M0 answers and the places where the build differs from the first draft are recorded below. Upstream: `img2threejs/img2threejs` at `0c0c49b` (2026-11-05, skill 2.0.1), vendored in `resources/agent-skills/img2threejs` with two Linden security patches. Security review (2026-11-09): [`docs/security/img2threejs/`](../security/img2threejs/FINDINGS_TRIAGE.md).

> **Update 2026-11-09: img2threejs is OFF by default.** The agent rebuilds objects from reference images with Linden's own tools (prompt section 7: `linden_model_build` parts, hand-written three.js factories via `linden_factory_write`, comparison via `linden_reference_view`). The `linden_img2_*` tools are not registered and the packaged app ships neither the skill nor its prompt (`electron/agent/prompts/img2threejs.md`). `LINDEN_IMG2THREEJS=1` re-enables it in a dev checkout (`electron/agent/features.ts`). Image attachments, Model.factory (sandboxed), GLB bake and the security fixes below stay. Tests: `npm run test:e2e:reference-model`, `npm run test:e2e:packaged-reference-model`; the img2threejs E2E sets the flag.


## Goal

A user gives Linden Agent one reference image ("buat kursi seperti foto ini"). The agent rebuilds the object with the img2threejs pipeline. The result is a normal Linden entity: it shows in the editor, in `linden_render_preview`, in Play and in the web export, and it has a collider.

`linden_model_build` with parts stays for objects described in words. img2threejs adds what that route lacks:

- an image-grounded spec
- a detail inventory
- a strict-quality gate before codegen
- a pass-by-pass render-vs-reference review loop

### Non-goals

- **Plugins:** the domain plugins (`cs2`, `animated-character`, `environment`, `img2glb`) and the `img2` harness. Only the built-in `generic` and `character` profiles are supported.
- **GLB-reference route:** the character route from a GLB (`integrations/glb_character_pipeline`) needs `uv` and is not shipped.
- **Photo-texture projection:** `bake_projected_texture.py` needs a projective `ShaderMaterial`, which `WebGPURenderer` cannot run.
- **Emission targets:** `--target` and `emit_target.py`.
- **Vision adapters:** `run_vision_adapter.py` runs SAM2, MediaPipe and similar models in a separate Python.

## Upstream facts

| Item | Finding |
|---|---|
| Licence | Apache-2.0, with no NOTICE file. Linden ships `LICENSE` with the vendored copy, and `scripts/check-licenses.mjs` checks it. |
| Runtime | Python ≥ 3.10, standard library only. `forge/tests` passes on 3.12. |
| Size | The repo is 7.7 MB; the vendored copy is 3.1 MB (no `forge/tests`, `assets`, `integrations`, `bin`, CI). |
| Agent entry | `SKILL.md` (466 lines) is a router. Each stage names the `grimoire/` or `docs/` file to read. |
| Workflow state | `forge/state.py init`, then `forge/next.py --state .img2threejs/state.json`. Exit code 3 means a hard stop. |
| Factory output | `export function create<Name>Model(options): THREE.Group`. The group carries `userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups }`; characters add `userData.rig`. |
| Factory imports | `three`, plus `three/examples/jsm/*` (EffectComposer, passes, RoomEnvironment, OrbitControls) for its presentation helpers. |
| Materials | `MeshStandard`/`MeshPhysicalMaterial` with `CanvasTexture` maps drawn on `document.createElement('canvas')`. The factory needs a DOM. |
| Roadmap risk | v2.1 moves the `character` domain into `plugin-character`. Stay on 2.0.x until plugins are supported. |

## M0 answers

| # | Question | Answer |
|---|---|---|
| 1 | End to end outside Linden | The scaffold chain works: state, next, probe, assessment, spec, strict gate (fails closed on a scaffold), generator. A full reconstruction needs the agent's image analysis, so it is not something a test can run unattended. |
| 2 | Scripts with cwd = job folder | They work, given absolute script paths and project-relative arguments resolved by Linden. `run_gates.py` and `emit_target.py` read the cwd for the plugin registry; Linden points `IMG2_HOME` at an empty, Linden-owned folder. |
| 3 | Read-only skill folder | **It does not work.** `new_pre_spec_assessment.py` writes a BM25 cache to `<skill>/.cache/spec-search/`, and `-E` disables `PYTHONDONTWRITEBYTECODE`. Linden therefore copies the skill once per version to `userData/agent-skills/img2threejs-<treeSha>/` and runs Python with `-B -E -s`. Not `-I`: that drops the script folder from `sys.path` and breaks the `_shared` imports. |
| 4 | Factory bundling | Addons are bundled for real (see M2), not stubbed. The fixture factory compiles, runs in Node with a stubbed canvas, and renders in Electron. |
| 5 | Units and origin | The units are **relative** (`dimensions.units: "relative"`) and the origin is the object's centre, not the ground. Linden normalises every factory with `fit`. |
| 6 | Image parts in `@opencode/client` | Supported: `session.prompt({ sessionID, text, files: [{ uri, name }] })`. `ModelInfo.capabilities.input` says whether a model takes images. |
| 7 | Windows | The forge scripts are stdlib Python with no POSIX-only calls on the paths Linden runs. The resolver knows the `py -3` launcher, python.org folders and WindowsApps. Not run on a Windows machine yet. |

## Decision (as built)

1. **A pinned, trimmed copy is vendored**, not installed with `npx img2threejs install`.
   - `scripts/vendor-img2threejs.mjs --ref <tag|commit>` (or `--from <checkout>`) downloads the source, trims it, and writes `VENDOR.json` (commit, skill version, tree hash, licence). With `--test` it runs upstream `forge/tests` first.
   - A global install would be unpinned, would change the user's other OpenCode sessions, and would live outside the project. Linden sessions deny `external_directory`.
2. **Python runs through Linden MCP tools**, not the agent's shell.
   - `linden*` tools need no permission prompt, stay inside the project, and are path-checked, time-limited and output-capped.
3. **The generated factory runs as a `Model` source** (`Model.factory`). This keeps the `CanvasTexture` materials, sockets, pivots and the idle `tick`. A GLB bake is available on request (`linden_model_bake_glb`).

## Architecture

```
attach (panel) ─► references/<slug>.png ─► prompt text + file part (vision models)
                                             │
OpenCode agent ─(MCP)─► linden_img2_status / _read / _write / _run
                         └─ python -B -E -s <userData>/agent-skills/img2threejs-<sha>/forge/<script>
                            cwd = .linden/img2threejs/<job>/, IMG2_HOME = <userData>/agent-skills/img2-home
                            generate_threejs_factory.py ─► models/<job>/create<Name>Model.ts
               ─► linden_model_build {model:{factory}} ─► hidden window probe (player/factoryProbe.ts)
                                                          ─► Model {factory, fit, bounds, bake}
               ─► linden_render_preview ─► .linden/previews/<entity>-<view>.png
               ─► linden_img2_run make_comparison_sheet.py ─► sheet image returned to the agent
               ─► linden_img2_run append_review.py ─► next pass or hard stop

game-models/<x>.js ◄─ compiled on demand from models/<x>.ts
  editor:  never imported; factory:preview runs it in the sandboxed probe window → GLB (security/img2threejs L-3)
  Play / preview: linden-game://play/<session>/game-models/...
  web export: <build>/game-models/... (compileFactories)
```

## M1: Vendored skill, Python resolver, tools

| Piece | File |
|---|---|
| Vendored copy, `VENDOR.json` | `resources/agent-skills/img2threejs/` |
| Vendoring script | `scripts/vendor-img2threejs.mjs` |
| Python ≥ 3.10 resolver | `electron/agent/pythonBinary.ts` |
| Runtime copy, script allowlist, argument mapping, runner | `electron/agent/img2threejs.ts` |
| Tools | `electron/agent/lindenTools/img2Tools.ts` |
| Script labels (panel and turn phase) | `shared/img2Labels.ts` |

### Python resolver

The resolver tries these in order:

1. `LINDEN_PYTHON`
2. `python3.14` … `python3.10`, `python3`, `python` on a merged PATH: current PATH, login shell, pyenv shims, `~/.local/bin`, Homebrew, uv-managed `cpython-*`, `/Library/Frameworks/Python.framework`
3. Windows: python.org folders, then `py -3`

It accepts only 3.10 or newer. macOS `/usr/bin/python3` (3.9) is reported as too old and not used. When nothing is found, the error lists the interpreters it rejected and how to install a newer one. The packaged app, launched with Finder's PATH, finds `/opt/homebrew/bin/python3.14`.

### Tools

- **`linden_img2_status`:** reports Python, the skill version, the supported profiles, and the jobs in the project.
- **`linden_img2_read {path, startLine?, maxLines?}`:** reads `SKILL.md`, `grimoire/**`, `docs/**` or `forge/**`. A directory path lists its entries.
- **`linden_img2_write {job, path, content | patch}`:** writes `.json`, `.md` or `.txt` files in the job folder. JSON is validated first, and `patch` is an RFC 7386 merge patch.
  - Added during the build: the agent fills the spec many times, and the generic edit tool asks for permission on every edit.
- **`linden_img2_run {job, script, args, timeoutSec?}`:** runs one forge script.
  - **Allowed scripts:** every `forge/stage*/` script plus `state.py`, `next.py` and `report.py`. Blocked: `emit_target.py`, `bake_projected_texture.py`, `run_vision_adapter.py`.
  - **Path arguments:** relative paths mean the job folder. `references/`, `models/`, `assets/`, `scenes/` and `.linden/` mean the project root. `grimoire/`, `docs/` and `forge/` mean the skill. `--capture 90=x.png` pairs are mapped too. Anything outside the project or skill is refused, and so is `--target`.
  - **Factory generation:** `generate_threejs_factory.py` must write `--out models/**.ts`, and `--allow-nonstrict` is refused. A successful run sends a diff to the panel.
  - **Hard stop:** exit code 3 or `status=stopped` sets `hardStop`.
  - **Comparison sheets:** `make_comparison_sheet.py` returns the sheet as an MCP image.
  - **Limits:** 120 s timeout by default (600 s at most) and 64 KB of output per stream. The result lists the files the run changed.

### Agent prompt

`electron/agent/prompts/linden.md`, section 7, tells the agent:

- when to use img2threejs and when to use parts
- the tool mapping for `python3 forge/...`
- the job folder layout
- the render step: `linden_model_build {factory}` + `linden_render_preview`
- how to pass previews to `make_comparison_sheet.py` and `turntable_gate.py`
- `meshesOut` for `self_intersection.py`
- the Linden limits
- the honesty rules

The prompt reaches existing projects through `syncProjectAgentsMd`.

## M2: `Model.factory` runtime

### Data

`engine/model/ModelSpec.ts` and `ModelComponent.ts` gain these fields:

- `factory`: the source file under `models/`
- `factoryExport`: the export to call
- `factoryOptions`: `textureSize`, `textureAnisotropy` and `qualityPriority`
- `fit { scale, offset }`
- `bounds`: the existing field, filled in for factories too
- `bake { hash, triangles, hull, boxes, exports, sockets }`

`factory` cannot be combined with `parts` or `src`. The registry lists `factory` in the Inspector, and the collider enum now includes `compound`.

### Compile and serve

- `electron/play/ScriptCompiler.ts`: `compileFactory()` builds one self-contained ESM module per factory with rolldown (`codeSplitting: false`), cached by the fingerprint of `models/`. `compileFactories()` compiles all of them for the web export.
- **Real addons, not stubs.** `three/examples/jsm/*` and `three/addons/*` are bundled from three's sources, and their own `three` imports resolve to the shared global. Gameplay scripts get the same addon support.
  - In a packaged app, electron-builder strips `node_modules/**/examples` from the asar. The supported addon folders ship as `extraResources` → `three-addons`: environments, postprocessing, shaders, controls, geometries, utils, math, curves, modifiers, objects.
- `electron/play/factoryModules.ts`: `game-models/<x>.js` is compiled on demand and served by `linden-game://` (Play and preview) only. A factory that fails to compile is served as a module that throws the compile error.
- The editor never imports factory code (it holds `electronAPI`): `AssetLoader.isolatedFactory` → IPC `factory:preview` → `electron/agent/factoryPreview.ts` runs the factory in the sandboxed probe window and returns GLB, cached by `factoryHash` in `userData/factory-previews`. `index.html` keeps its original `script-src`; `connect-src` gains `blob:` for GLB-embedded textures.

### Run

- `AssetLoader.loadFactory(src, version)` imports `game-models/<x>.js?v=<bake.hash>` and sets the three global first.
- `SceneBridge.buildFactoryModel` calls the factory with `factoryOptions` and the shadow flags, applies `fit`, and draws one copy per instance.
  - Instance copies are cloned without `userData`: `Object3D.clone` serialises `userData` with JSON and throws on `sculptRuntime`.
  - A failing factory becomes an entity warning plus a red wireframe box built from `bounds`.
- **Idle animation:** `root.userData.tick(dt, elapsed)` runs in the player (`setAnimateFactories(true)`). The editor shows the static GLB copy (no tick, no `ctx.model` runtime); the earlier **Anim** toggle was removed with the isolation fix.
- **Headless physics:** `modelCollider.ts` builds the collider from the bake. `box` uses `bounds`, `convexHull` uses `bake.hull`, and `compound` uses `bake.boxes`, one per `sculptRuntime` collider.
  - `linden_play` warns when a factory is missing or was never measured, or when `bake.hash` no longer matches the sources in `models/`.

### `linden_model_build` with `factory`

1. The tool compiles the factory and reports compile errors.
2. It measures the factory in a hidden window: `previewWindow.createFactoryProbe` opens `preview.html?probe=...`, which runs `player/factoryProbe.ts`. The probe returns:
   - bounds and triangles
   - a 160-direction support-point hull
   - one box per collider
   - the sockets, nodes, materials and `ShaderMaterial` count
   - optionally, the meshes
3. It computes `fit` from `fitScale`, then `fitHeight`, then the category's real-world height. Placement decides where the model rests:
   - floor: the lowest point at y 0, centred in x/z
   - ceiling: the highest point at y 0
   - wall: the back at z 0
   - free: centred on the origin
4. It reports any of these: `NOT_SCALED`, `SCALE_MISMATCH` (outside 0.6–1.6× of the table), `TRIANGLE_BUDGET` (above 150k), `SHADER_MATERIAL`, `NO_COLLIDER`, and factory warnings.
5. It writes `factory`, `fit`, `bounds` and `bake`. With `meshesOut`, it also writes the meshes in the `self_intersection.py` format.

### Export

- **Web export:** compiles `models/` into `game-models/` and does not ship `models/` or `references/`.
- **Godot:** correction to the draft: Linden has no Linden-to-Godot exporter. The bridge only imports from Godot. `linden_model_bake_glb` covers portability.

## M3: Image input and the review loop

- **Attaching images (`editor/panels/AgentPanel.tsx`):** "+ Gambar" button, drag and drop, and paste, with thumbnails.
  - `agent:attachImage` → `electron/agent/referenceImages.ts` copies the image to `references/<slug>[-n].<ext>`.
  - The format comes from the bytes (png, jpg or webp), the limit is 20 MB, and images above 2048 px are downscaled with `nativeImage`.
  - The panel attaches only to the project that is open.
- **Sending (`AgentHost.submitPrompt({ attachments })`):** the paths are validated again. The prompt gets a `<reference-images>` note, and models that take images also get `files: [{ uri: file://..., name }]`.
- **Vision check:** when OpenCode says the selected model has no image input, the panel blocks sending and says why. When the metadata says nothing, it sends.
- **Progress:** a `linden_img2_run` call sets the turn phase to "<step> · <job>", for example "Validasi spec · kursi-jati". Tool rows show the same summary, and factory builds show the factory path.
- **Review sheets:** comparison sheets come back to the agent inline.

## M4

- **Scripts:** `ctx.model` gives scripts `socket(id)`, `node(id)`, `mesh(id)`, `sockets`, `runtime` and `rig` for factory models, through `SceneBridge.getModelRuntime`.
- **Characters:** `root.userData.rig` (SkinnedMesh + Skeleton) renders as built and is exposed through `ctx.model.rig`. Clip playback for rigs without glTF clips is still the factory's own `tick`.
- **`linden_model_bake_glb {entityId, target?, switch?}`:** GLTFExporter in the probe window, with `CanvasTexture` maps exported as PNG.
  - The fit goes into a `LindenFit` root node, so the GLB is in meters and rests like the Model did.
  - With `switch`, the entity's Model moves to `src`.
  - `ShaderMaterial`, `tick` and scripted sockets do not survive the bake.

## Testing

| Suite | What it covers |
|---|---|
| `tests/play/factoryCompiler.test.ts` | Path mapping, export picking, compiling the fixture with real addons and running it in Node, errors (bare import, missing addon, escape), web export, addons in scripts |
| `tests/agent/img2Tools.test.ts` | Vendored copy, allowlist, `readSkillFile`, argument mapping and refusals, Python resolver, `linden_img2_write`, and **real Python runs** (state, next, probe, assessment, spec, strict gate, fail-closed generator, comparison sheet, vendored copy untouched) |
| `tests/agent/factoryTools.test.ts` | Spec refinement, fit for every placement, fitted bake, `linden_model_build` with a probe stub, colliders from the bake, stale-bake warning in `linden_play`, GLB fit wrapping |
| `tests/agent/referenceImages.test.ts` | Sniffing, saving and resizing images, attachment validation, file parts only for vision models |
| `tests/model/factoryModel.test.ts` | SceneBridge: fit, shadows, runtime and `ctx.model`, tick gating, placeholder, instances, rebuild on change, headless |
| `tests/agent/turnTracker.test.ts` | img2 step labels |
| `tests/e2e/img2threejsFactory.e2e.mjs` (`npm run test:e2e:img2threejs`) | In Electron: build+measure, render preview, physics drop onto the floor, comparison sheet, GLB bake, web export. With `npm run dev`, also the editor viewport: model visible from the sandboxed GLB, module import blocked, no factory code run in the editor. 23/23 |
| `tests/e2e/packagedImg2threejs.e2e.mjs` (`npm run test:e2e:packaged-img2threejs`) | The packaged macOS app with Finder's PATH: shipped resources, Python found, skill copied to userData, forge runs, cache outside Resources, factory compiled with packaged addons, preview. 11/11 |

Fixtures in `tests/fixtures/img2threejs/`:

- `mug.png`
- `assessment.json`
- `object-sculpt-spec.json`: a two-component scaffold
- `createCeramicMugModel.ts`: generated by upstream with `--allow-nonstrict`, as a test fixture only

## Risks

| Risk | Mitigation |
|---|---|
| No Python ≥ 3.10 | A clear error with install hints. `linden_model_build` with parts keeps working. |
| Token cost | The upstream correction caps hold (3 per pass, 6 total). The comparison is one sheet image per pass. |
| Upstream churn | A pinned copy, reviewed upgrades (`vendor-img2threejs.mjs` prints the `SKILL.md` diff), upstream tests with `--test`, Linden security patches re-applied (`scripts/vendor-patches/img2threejs/`), and `npm run check:skills` against the reviewed SkillSpector baseline. |
| Generated/project code with editor privileges | Factory code runs only in sandboxes (probe/preview windows, the Play iframe, web builds); the editor gets GLB. Spec text cannot become code (patches L-1/L-2). See `docs/security/img2threejs/`. |
| Fidelity expectations | The prompt makes the agent report inferred regions and per-region confidence. |
| Windows | The resolver handles it, but no Windows run has been done yet. |
