# img2threejs in Linden — security audit baseline

State **before** remediation (branch `feat/img2threejs-agent`, 2026-11-09). Findings and fixes are in
[`FINDINGS_TRIAGE.md`](FINDINGS_TRIAGE.md).

- Skill: img2threejs 2.0.1, upstream commit `0c0c49bc168e648dbaf9c8c080474de0b3a941b6`, Apache-2.0
- Vendored at `resources/agent-skills/img2threejs/` by `scripts/vendor-img2threejs.mjs` (trimmed copy, `VENDOR.json`)
- Scanner: SkillSpector v2.12.0, static (`--no-llm`): score 100/100, CRITICAL, 71 findings
  (10 HIGH, 60 MEDIUM, 1 LOW), coverage 96.8% (179 of 185 components fully inspected, 6 partially, 0 uninspected),
  recommendation DO_NOT_INSTALL

## 1. Architecture

```
Agent panel (editor renderer)                       Electron main                         Sandboxed renderers
───────────────────────────────                     ─────────────────────────────         ──────────────────────
user attaches image ──agent:attachImage──▶ references/<slug>.png (≤20 MB, sniffed)
prompt ──agent:prompt──▶ AgentHost ──▶ opencode serve (child) ──MCP──▶ LINDEN_TOOLS
                                         linden_img2_status / _read / _write / _run
                                         └─ runForgeScript: python -B -E -s forge/<script>
                                            cwd = <project>/.linden/img2threejs/<job>/
                                            env = minimal (PATH, HOME, TMP, IMG2_HOME=isolated)
                                         linden_model_build (factory)  ──▶ hidden probe window (sandbox:true, no preload)
                                         linden_render_preview         ──▶ hidden preview window (sandbox:true, no preload)
                                         linden_model_bake_glb         ──▶ probe window → models/*.glb
Editor viewport ── import(linden-asset://project/game-models/x.js) ◀── ScriptCompiler (rolldown) ◀── models/x.ts   ⚠ see §4
Play (iframe, linden-game://, sandboxed)  ── import(game-models/x.js)
Web export ── game-models/*.js in the build
```

### Execution flow of one reconstruction

1. `linden_img2_status`: Python ≥ 3.10 found (`electron/agent/pythonBinary.ts`); the skill is copied once per version to
   `userData/agent-skills/img2threejs-<sha12>/` (`ensureSkillRuntime`), because `spec-search` writes a cache inside the skill.
2. `linden_img2_read SKILL.md` and the `grimoire/`/`docs/` page each stage names (read-only; only `SKILL.md`, `CHANGELOG.md`,
   `LICENSE`, `VENDOR.json`, `grimoire/`, `docs/`, `forge/` are readable).
3. `linden_img2_run`: `state.py init` → `next.py` → stage 1 intake (probe image, landmarks, PBR evidence) → stage 2 spec
   (`new_pre_spec_assessment.py`, `new_sculpt_spec.py`, `validate_sculpt_spec.py`) → stage 3
   `generate_threejs_factory.py --out models/<job>/create<Name>Model.ts` → stage 4 review (comparison sheet,
   `append_review.py`, gates) → stage 5 rig (characters).
4. The agent writes the spec itself (`linden_img2_write`, JSON merge patch) from what it sees in the reference image.
5. `linden_model_build` measures the factory in the probe window and stores `fit`/`bounds`/`bake` in the scene.

## 2. File dependency graph (vendored skill)

| Area | Content | Count |
|---|---|---|
| `SKILL.md` | Router: order of operations, hard rules, links to `grimoire/` and `docs/` | 1 |
| `forge/` | Python 3.10+ scripts, **standard library only** (`forge/requirements.txt`), 77 entry points | 112 `.py` |
| `forge/_shared/` | Shared helpers (spec search, color metrics, subdivision, workflow state, artifact cache) | |
| `forge/stage3_build/generate_threejs_factory.py` | Spec JSON → TypeScript factory (**code generator**) | |
| `forge/stage5_rig/emit_rig.py`, `emit_animation_runtime.py` | Rig/animation JSON → TypeScript (**code generators**) | |
| `grimoire/` | Stage contracts for the agent | 31 `.md` |
| `docs/` | Install, plugins, character prompts, schemas, research notes | 33 files |

Not shipped: upstream `bin/`, `integrations/`, `runtime/`, `assets/`, `forge/tests/`, npm installer, CI.

## 3. Security boundaries and existing controls

| Boundary | Control (file) |
|---|---|
| Which scripts run | Allowlist of `forge/{state,next,report}.py` and `stage1..5/*.py`. `emit_target.py`, `bake_projected_texture.py` and `run_vision_adapter.py` are blocked (`BLOCKED_SCRIPTS`, `electron/agent/img2threejs.ts`) |
| Interpreter | `python -B -E -s`: no bytecode writes, ignores `PYTHON*` env, no user site-packages |
| Environment | Minimal env; `IMG2_HOME` is a Linden-owned empty folder, so user-installed img2 plugins never load; `IMG2THREEJS_VISION_PYTHON` is not passed |
| Paths | Every path flag is resolved to the project, the job folder or the skill (read-only data); absolute paths, `..`, `--target` and paths outside are refused (`resolveScriptArgs`) |
| Factory output | `--out` must be `models/**.ts`; `--allow-nonstrict` is refused |
| Resources | 120 s default / 600 s max timeout, 64 KB stdout/stderr caps, process killed on timeout |
| Agent permissions | `linden*` tools allowed; shell commands **ask**; `external_directory` **deny** (`SESSION_PERMISSIONS`) |
| Agent instructions | Linden prompt §7: never run forge scripts through the shell, never install anything, never bypass a gate |
| Reference images | Type sniffed (PNG/JPEG/WebP/GIF), ≤ 20 MB, only for the open project; sent only to vision-capable models |
| Factory code at runtime | Probe/preview windows: `sandbox: true`, no preload, navigation and popups denied. Play: sandboxed cross-origin iframe. **Editor viewport: imports the factory into the privileged editor renderer (see §4)** |

## 4. Trust model notes found while mapping

- **Editor renderer runs project code.** Before Model.factory, the editor never executed project code: game scripts run only in
  the sandboxed `linden-game://` iframe (`editor/viewport/GameFrame.tsx`). The factory integration imports
  `models/*.ts` (compiled) into the editor renderer, which has the full `electronAPI` preload. A malicious `models/*.ts`
  in an opened project, or a factory generated from a poisoned spec, would run with editor privileges. CSP `script-src`
  was widened with `linden-asset:` for this.
- **Spec → code generators.** The spec is written by the agent from an image; an image can carry text (prompt injection).
  Whatever the generators copy from the spec into TypeScript must stay data.

## 5. Network, subprocess, filesystem, environment

| Kind | Where | Notes |
|---|---|---|
| Network | none in `forge/` | No urllib/requests/socket/http; no downloads at runtime |
| Subprocess | `sips` (macOS image conversion) in 5 intake/review scripts | List argv, no shell, input path already confined |
| Subprocess | `emit_target.py` (target toolchains), `run_vision_adapter.py` (vision venv) | Arbitrary commands by design; **blocked in Linden** |
| Dynamic code | none | No `eval`/`exec`/`pickle`/`marshal`/`os.system`/`shell=True`; `__import__("sys")` only in `__main__` guards |
| Filesystem writes | 49 scripts write outputs | Into the job folder / `models/` via confined flags; `artifact_cache.py` writes `.cache/` inside the skill copy in userData |
| Environment | `IMG2_HOME`, `IMG2THREEJS_VISION_PYTHON` | Both controlled by Linden (see §3) |
| MCP | the skill ships no MCP server | Linden exposes the skill through its own `linden` MCP tools only |

## 6. External dependencies

- Python ≥ 3.10 from the user's machine (not bundled); standard library only.
- three r186 addons from `node_modules/three/examples/jsm` (shipped as `three-addons`) for compiled factories.
- rolldown (factory compiler), already a Linden dependency.

## 7. Critical pipeline components (must keep working)

`generate_threejs_factory.py` (factory output), `validate_sculpt_spec.py` (strict gate), `next.py`/`state.py` (workflow
authority), `make_comparison_sheet.py` (review), `probe_glb.py` (GLB import), stage 5 rig/animation emitters, PBR evidence
(`extract_pbr_evidence.py`, `delight_albedo.py`), Linden's factory compiler, probe, `linden_model_bake_glb`, Play and web export.

## 8. Tests and validation commands

| Command | Covers |
|---|---|
| `npx vitest run` | All unit tests; img2-specific: `tests/agent/img2Tools.test.ts`, `factoryTools.test.ts`, `referenceImages.test.ts`, `tests/play/factoryCompiler.test.ts`, `tests/model/factoryModel.test.ts` |
| `npm run test:e2e:img2threejs` | Real Electron app: build, preview, physics, comparison sheet, GLB bake, web export, editor viewport (with `npm run dev`) |
| `npm run test:e2e:packaged-img2threejs` | Packaged app launched with a Finder PATH |
| `npm run check:licenses` | Vendored license |
| `skillspector scan resources/agent-skills/img2threejs --no-llm` | Static skill scan |
