# SPEC: NixieFX particle VFX for Linden games

Status: the package is installed and verified (2026-11-01). The integration below is not implemented yet.

## Decision

Linden adds **NixieFX** (`nixie-fx`) as a second particle system, for effects made in a dedicated VFX tool. The built-in `ParticleEmitter` stays.

| | `ParticleEmitter` (built in, `SPEC-Physics-Water-VFX`) | `NixieEffect` (this spec) |
|---|---|---|
| Authoring | Inspector fields and presets, the agent's `linden_scene_apply` | NixieFX editor or the `nixie-fx` CLI, exported as a bundle |
| Good for | quick fire, smoke, sparks; procedural tweaks from scripts | designed effects: sub-emitters, trails, texture sheets, shader graphs, lit particles |
| Data | component fields | `assets/vfx/manifest.json` + effect JSON, referenced by id |
| Runtime cost | always in the player | ~205 KB minified / 61 KB gzip, loaded only by scenes that use it |

### Why the earlier objection no longer applies

`SPEC-Physics-Water-VFX` rejected three.quarks and three-nebula for two reasons. NixieFX answers both.

1. **WebGPU.** Those libraries build GLSL `ShaderMaterial`s that `WebGPURenderer` cannot run. NixieFX ships a separate node/TSL adapter (`nixie-fx/three-webgpu`: `createThreeNodeAdapter`, passed as `renderAdapter`). WebGL uses the stock path.
2. **Serialization.** Those libraries keep effects in their own JSON. NixieFX effects stay in their exported bundle, an engine-neutral JSON asset. The component stores only the bundle path and the effect id, so scenes, the Inspector and the agent see two plain fields.

## Verified facts (2026-11-01)

| Item | Finding |
|---|---|
| Package | `nixie-fx@0.1.24`, MIT, by Avetis Zakharyan (Rockbite Games); repo `azakhary/nixie-fx` |
| Activity | first release 2026-08-15; 25 versions; about 3.4k downloads/month |
| Dependencies | none at runtime |
| Install hooks | no install scripts |
| Peer dependencies | optional `three` (`>=0.184 <0.186`) and `pixi.js` |
| Installed as | exact pin `"nixie-fx": "0.1.24"` |
| Licence check | `scripts/check-licenses.mjs` now includes `nixie-fx` in its roots; it passes |

**Peer range.** Linden uses three **0.186.1**, which is outside the declared range. The conflict is resolved with a targeted override in `package.json`, `"overrides": { "nixie-fx": { "three": "$three" } }`. There is one `three` in the tree (deduped); `--legacy-peer-deps` was not used.

The override was checked on r186 at two levels:

- **Node smoke test.** The fixture bundle loads with `loadVfxExportBundle`. `getSupport` reports `three3d: supported` with no warnings or blockers. Over 2 s, 25 particles were active, drawn in 1 instanced draw call.
- **Real WebGL in Electron** (`tests/e2e/nixieFx.e2e.mjs`). Shaders compile with no errors and 1816 effect pixels reach the framebuffer. That test guards the override, so run it on every `nixie-fx` or `three` upgrade.

**Authoring flow.**

- The CLI works offline: `effect create --profile three-world-3d`, `validate` and `export`.
- A project needs `vfx-editor.prj`. The editor normally writes it; `normalizeEditorProjectFile` from `nixie-fx/project` can produce one, with defaults `effectDataPath: "."`, `outputPath: "out/vfx"`, `assetRootPath: "."`.
- Fixture: `tests/fixtures/nixie-fx/fire-burst/` (exported bundle) and `fire-burst.source.json` (authored source).

## Constraints from the current code

- **Visual only.** NixieFX runs in `SceneBridge` and `engine/renderer`, like `ParticleEmitter`. Nothing about it affects gameplay.
  - Headless `linden_play` (Electron main) skips it.
  - Never import `nixie-fx` from anything `electron/` imports. `scripts/build-electron.mjs` inlines `three`, and the main process must stay light.
- **Lazy loading.** `SceneBridge` loads `nixie-fx/three` with `import()` when it first sees a `NixieEffect`. Scenes without one pay nothing.
  - The player bundle is built with rolldown (`scripts/build-player.mjs`), which code-splits dynamic imports of npm packages with no extra configuration.
- **One renderer per scene.** Use one `ThreeVfxRenderer` per `SceneBridge`, not one per entity. Shared draw state is what lets `ThreeVfxBatcher` merge emitters later.
- **Camera.** NixieFX needs the camera for billboards and sorting, and `SceneBridge` does not know it today. Add `bridge.setCamera(camera)`, called by `SceneViewport` (including when 2D/3D swaps the camera), `LindenPlayer` and `player/preview.ts`.
- **Time.** `bridge.update(dt)` already runs once per frame in the editor and the player. Call `vfx.update(dt)` exactly once from there.
- **Quality profiles.** `QUALITY_CAPS` gains `nixieMaxParticles` (low 2 000, medium 8 000, high 20 000), applied through the renderer's budget API (`setBudget`).
- **Assets.** Textures, meshes and material graphs referenced by a bundle resolve relative to the bundle folder through `AssetLoader` (`projectAssetUrl` in the editor, relative URLs in the player and web export).

## Project layout

```
<project>/
  vfx/                      authoring project (opened in the NixieFX editor or used with the CLI)
    vfx-editor.prj          settings.outputPath = "../assets/vfx"  (allowExternalOutput: true)
    fire-burst.json         authored effects
  assets/vfx/               exported bundle (what the game loads)
    manifest.json
    effects/*.json
    <textures, meshes, .material graphs>
```

`File > New Project` templates create `vfx/vfx-editor.prj` with that output path. Web export already copies `assets/`, so the bundle ships with the game.

## M1: `NixieEffect` component and WebGL runtime

### Component (`engine/vfx/nixie/NixieEffectComponent.ts`)

The component must not import three or nixie-fx, because the registry is loaded in Electron main.

| Property | Kind | Default | Notes |
|---|---|---|---|
| `bundle` | assetRef (`vfx-bundle`) | `assets/vfx/manifest.json` | exported manifest |
| `effectId` | string (enum in the Inspector, read from the manifest) | `''` | id in `manifest.effects` |
| `playOnStart` | boolean | `true` | |
| `seed` | int | `0` | 0 = derived from the entity id (deterministic per entity) |
| `timeScale` | number | `1` | |
| `runtimeParameters` | json | `{}` | NixieFX runtime parameter patch, for colour and multipliers |
| `onFinished` | event | | fired when a non-looping effect has played out |

`menuPath: 'Effects/NixieFX Effect'`. Register it in `ComponentRegistry`; `linden_component_list` then picks it up for the agent automatically.

### Runtime (`engine/vfx/nixie/nixieRuntime.ts`, used by `SceneBridge`)

- **Bundles.** `loadBundle(path)` is cached per path. It fetches the manifest and its effect JSON through `AssetLoader` and calls `loadVfxExportBundle(..., { requiredBackend: 'three3d' })`. A failure warns once per bundle and shows nothing.
- **Instances.** Each `NixieEffect` gets `renderer.createEffect(effect, { seed, autoStart: playOnStart })`. The instance root is reparented under the entity's `Object3D`, so the effect follows the entity transform; NixieFX's `local`/`world` simulation space stays as authored. Removing the component or the entity calls `removeEffect(instance, true)`.
- **Support report.** `getSupport(effect)`: `blocked` shows nothing and warns; `partial` warns with the report's warnings, once per effect. Unsupported features must never pass silently.
- **Lifecycle.**
  - `bridge.update(dt)` calls `vfx.update(dt * timeScale)`.
  - `bridge.detach()` destroys the renderer and bundle cache.
  - The editor pauses effects that are not selected unless VFX preview is on, reusing `setParticlePreview`.
- **Property changes.** Changing `bundle`, `effectId` or `seed` rebuilds the instance. Changing `runtimeParameters` applies the patch live.

### Tests

- **Unit (Node, like `tests/vfx/particles.test.ts`):** component defaults and serialization round trip. The bridge builds an instance from the fixture bundle and reparents it under the entity. Errors warn: unknown effect id, missing bundle, blocked effect. Destroy and detach release everything. Determinism: the same seed gives the same particle positions after N updates.
- **E2E:** extend `tests/e2e/nixieFx.e2e.mjs` to render a Linden scene with a `NixieEffect` through `linden_render_preview` (player runtime) and check that effect pixels appear.

## M2: WebGPU

- When the project renderer is WebGPU (`createGameRenderer`), pass `renderAdapter: createThreeNodeAdapter(...)`, imported lazily from `nixie-fx/three-webgpu`.
- **To verify first:** that the adapter works with Linden's own `WebGPURenderer` (from `createRenderer`), not only with `createThreeWebGpuRenderer`. If it does not, the `NixieEffect` is skipped with a warning on WebGPU projects, and WebGL keeps working.
- **Test:** the same fixture rendered with `backend: 'webgpu'` in Electron.

## M3: Editor experience

- **Inspector.**
  - `effectId` is a dropdown filled from the selected manifest.
  - A "Play / Restart" button.
  - The support status (supported / partial / blocked, with warnings).
- **Assets panel.**
  - A `vfx-bundle` asset type for `manifest.json`.
  - A stale-export badge from `compareVfxExportToSources` (browser-safe), comparing `vfx/*.json` with the bundle.
  - "Export VFX" runs `nixie-fx export vfx` through the existing build runner.
- **Authoring.**
  - "Open in NixieFX editor" opens <https://nixiefx.com/editor/> in the system browser.
  - **To check:** whether the editor can open the local `vfx/` folder (File System Access API) or needs a manual import.
- **Viewport.** Effects play when selected, or always when the VFX toggle is on, the same rule as `ParticleEmitter`.

## M4: Script API and agent

Extend `ctx.vfx` (`engine/scripting/ScriptRuntime.ts`). The existing `play`/`stop` also accept an entity with a `NixieEffect`:

```ts
ctx.vfx.play(entity?)                      // NixieEffect: restart from time 0
ctx.vfx.stop(entity?, { clear?: boolean })  // stop emitting; clear removes live particles
ctx.vfx.spawnNixie(effectId, position, { bundle?, parent?, seed?, autoDestroy? = true }): Entity
ctx.vfx.setParameters(entity, patch)       // runtimeParameters, live
```

- `spawnNixie` mirrors `spawn`. It creates a temporary entity, which is destroyed after `onFinished` unless `autoDestroy` is false.
- In headless `linden_play` there is no renderer, so `onFinished` fires after the effect's authored duration, read from the effect JSON, and scripts behave the same.
- **Agent.**
  - `electron/agent/prompts/linden.md` gets a short section: when to use `NixieEffect` or `ParticleEmitter`, and the CLI flow. That file is currently being edited in another session, so coordinate before changing it.
  - Optionally install NixieFX's own agent skills (`npx skills add https://github.com/azakhary/nixie-fx`), which cover authoring and export.

## M5: Web export and docs

- `WebBuildRunner` already copies `assets/`. Add a check that warns when `assets/vfx` is stale (same comparison as M3) before building.
- Add a docs page: install, authoring, export, the component, the script API and the quality caps.

## Risks and policy

| Risk | Mitigation |
|---|---|
| The `three` peer range excludes r186, so the override is outside upstream's tested range | Exact pin; `nixieFx.e2e.mjs` must pass on every `three` or `nixie-fx` change; ask upstream to widen the range |
| A 0.1.x API can change between minors | Exact pin; only `engine/vfx/nixie/` imports `nixie-fx`, so an upgrade touches one folder |
| The editor is a hosted web app | Effects are plain JSON and the CLI works offline; the export format is the contract, not the editor |
| Bundle size | Dynamic import: scenes without `NixieEffect` load nothing |
| Overdraw from many transparent emitters | Quality caps; `ThreeVfxBatcher` later (it needs host transparent-sort hooks) |

## Out of scope (later)

- PixiJS (`nixie-fx/pixi`) for 2D/UI scenes. Linden's 2D renderer is separate; this can follow if needed.
- `ThreeVfxBatcher` / `ThreeSurfaceBatcher`. They need `ScenePipeline` to expose its final transparent order.
- Converting `ParticleEmitter` presets to NixieFX effects, or the reverse.
