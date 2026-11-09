# img2threejs in Linden — findings and remediation

Companion to [`SECURITY_AUDIT_BASELINE.md`](SECURITY_AUDIT_BASELINE.md) (state before remediation).

> **2026-11-09:** after this review the owner chose to turn img2threejs off (no third-party skill code in the product). It is not registered
> and not packaged; reference images are rebuilt with Linden's own tools. The fixes below remain for the opt-in mode (`LINDEN_IMG2THREEJS=1`);
> L-3 (factory code never runs in the editor renderer) also protects the new hand-written factories. Every one of the
71 SkillSpector findings was checked by hand. The scanner found **no** real vulnerability; the manual review found
**five** — two in the upstream code generators, three in Linden's own integration — and all five are fixed with
regression tests.

| | Before | After |
|---|---|---|
| SkillSpector (static) | 100/100 CRITICAL, 71 findings, DO_NOT_INSTALL | 0/100, 0 new findings, 72 reviewed in the baseline; CAUTION only because coverage stays 96.8% (partial) |
| Factory code in the editor renderer | runs, next to `electronAPI` | never runs there; built in a sandboxed window, delivered as GLB |
| Spec text → generated TypeScript | could become code | stays a comment / string literal |
| Upstream test suite (1416 tests) | OK | OK (64 skipped both times) |

## Real vulnerabilities (fixed)

### L-1 Code injection through factory comments — upstream, HIGH
`generate_threejs_factory.py` wrote spec text verbatim into `//` comments: `targetName`, the build-pass id, repetition
system id/mode/level, standProud notes. A line break (`\n`, `\r`, `U+2028`, `U+2029`) ends a JS comment, so the rest of
the value became top-level code that runs when the factory module is imported. The spec is written by the agent from
a reference image, and an image can carry instructions (prompt injection). Combined with L-3 this ran in the editor
with `electronAPI`.

- Proof: `targetName = "Mug\nglobalThis.__PWNED__ = 1; …"` → lines 570–571 of the upstream output are code (TypeScript AST).
- Fix: `ts_comment()` keeps such text on one line (`scripts/vendor-patches/img2threejs/0001-factory-comments-stay-comments.patch`).
  The pass id turned out to be validated against a fixed list; it is sanitized anyway.
- Unchanged: output for normal specs is byte-identical (fixture comparison); all other spec values were already
  emitted through `json.dumps`, numeric coercion or identifier sanitizers (audited line by line).
- Test: `tests/agent/img2Vendor.test.ts` (fails on the upstream generator, passes on the patched one).

### L-2 Template re-substitution in the rig emitters — upstream, MEDIUM
`emit_rig.py` and `emit_animation_runtime.py` filled templates with sequential `str.replace`, so a value inserted for one
token was searched again for the next. A bone id containing a later token (`"tip__PARENT_JSON__"`) received raw JSON
inside its string literal and broke out of it (`["hips", "tip{"hips": null, …}"]`, 6 parse errors).

- Fix: one regex pass (`0002-rig-templates-single-pass.patch`). Test: `tests/agent/img2Vendor.test.ts`.

### L-3 Project code ran in the privileged editor renderer — Linden integration, HIGH
Before Model.factory the editor never executed project code: games run in the sandboxed `linden-game://` iframe. The
factory integration imported compiled `models/*.ts` straight into the editor renderer (which has the full `electronAPI`
preload) and widened the CSP `script-src` with `linden-asset:`. Opening a project with a malicious factory, or a factory
generated from a poisoned spec, gave that code editor privileges.

- Fix: the editor viewport sets `AssetLoader.isolatedFactory`; `SceneBridge` asks the host for the factory's output and
  gets a GLB built in the hidden probe window (`sandbox: true`, no preload, navigation and popups denied) via the new IPC
  `factory:preview` (`electron/agent/factoryPreview.ts`: request validation, project must be the open one, cache by
  `factoryHash` in `userData/factory-previews`). `linden-asset://` no longer serves `game-models/`, and `script-src` is
  back to its original value.
- Behaviour change: the editor shows a static copy (no idle animation, no `ctx.model` runtime); the viewport's **Anim**
  toggle is removed. Play, `linden_render_preview`, GLB bake and web export are unchanged (all already sandboxed).
- CSP `connect-src` gains `blob:` so GLTFLoader can read textures embedded in a GLB (also fixes embedded-texture GLB
  imports in the editor). Blob URLs can only be created by the page itself.
- Tests: `tests/agent/factoryPreview.test.ts`, `tests/model/factoryModel.test.ts` (isolated path),
  `tests/e2e/img2threejsFactory.e2e.mjs` step 7 (module import is blocked, `__LINDEN_THREE__` never set in the editor,
  GLB came from the probe, model visible).

### L-4 Vendor script followed symlinks — Linden tooling, MEDIUM
`scripts/vendor-img2threejs.mjs` copied with `statSync`, which follows symlinks: a symlink in the upstream tarball
pointing at, say, `~/.ssh/id_rsa` would have copied that file from the maintainer's machine into the repository.
- Fix: `lstatSync`; a symlink stops vendoring. Test: no symlinks in the vendored tree (`img2Vendor.test.ts`).

### L-5 The runtime copy was trusted without a check — Linden integration, LOW
The skill runs from a writable copy in `userData/agent-skills/` (needed because spec-search writes a cache). A modified
copy was reused as long as `.linden-ready` existed, and older copies stayed around.
- Fix: `ensureSkillRuntime` re-hashes the copy (`skillTreeHash`, same algorithm as `VENDOR.json treeSha256`, ignoring
  `.cache`/`__pycache__`) once per session and replaces it on mismatch; copies of other versions are deleted.
  `setImg2RuntimeRoot` now also resets the per-process memo. Test: `img2Tools.test.ts` (tamper → restored).

### Hardening for agent-facing install instructions (RP1/AS1/PE3)
`SKILL.md` and `docs/INSTALL.md` tell an agent to run `npx --yes img2threejs@latest install` (unpinned package, edits
`~/.claude/settings.json`); the showcase prompts use `.env` configs and `npx tsc/vite`. None of that ships with Linden,
and Linden's prompt already says "never install anything", shell commands need approval and `external_directory` is
denied. In addition, `linden_img2_read` now puts a `[Linden]` note above these files (do not run npx/npm/pip/uv/img2,
do not edit `~/.claude`, `~/.hermes`, `~/.codex`, `~/.img2` or `.env`). The upstream text itself is left intact.

## SkillSpector findings (all 71 verified as false positives)

| ID | Rule (count) | Where | Verdict |
|---|---|---|---|
| T-01 | RP1 MCP Rug Pull (31) | `SKILL.md:29`, `CHANGELOG.md`, `docs/INSTALL.md`, `docs/PLUGINS.md`, `docs/GLB_*CHARACTER_PROMPT.md` | Documentation of the upstream npm installer and showcase toolchain; nothing in Linden runs npx. Mitigated further by the `[Linden]` read note. |
| T-02 | AS1 Agent Snooping (3) | `docs/INSTALL.md:86,243`, `docs/PLUGINS.md:89` | Text describing what the upstream installer does to `~/.claude/settings.json`; installer not shipped. |
| T-03 | PE3 Credential Access (3) | `docs/GLB_CHARACTER_POLISH_PROMPT.md:41,146`, `docs/GLB_CHARACTER_PROMPT.md:226` | `<subject-id>.env` is a build-config placeholder for the (unshipped) showcase script, not a secret. |
| T-04 | AE4 Unicode (12) | 12 docs/forge files | Greek Δ and Σ as math symbols (ΔE, sums). Verified: no bidi, zero-width or tag characters anywhere in the skill. |
| T-05 | AR2 Anti-Refusal (1) | `forge/stage2_spec/new_sculpt_spec.py:1374` | "do not judge a front reference against a random render angle" — a review-pairing rule. |
| T-06 | P9 Prompt Injection (1) | `forge/stage2_spec/new_sculpt_spec.py:1170` | Newline count in ordinary source. |
| T-07 | EA4 Excessive Agency (1) | `forge/stage3_build/uv_unwrap.py:221` | Comment "would loop forever" next to the guard that prevents it; loop bounded by `max_charts`. |
| T-08 | EA2 Excessive Agency (1) | `grimoire/intake/local_spec_search.md:7` | "automatically run" the **local, offline** spec search. |
| T-09 | E3 Data Exfiltration (1) | `docs/PLUGINS.md:183` | `ls -l ~/…` troubleshooting step in docs. |
| T-10 | LP3 Least Privilege (1) | `SKILL.md:1` | No `allowed-tools` frontmatter; in Linden the scope is enforced in code (5 `linden_img2_*` tools, script allowlist, `BLOCKED_SCRIPTS`, path confinement). |
| T-11 | AE1 Analysis Evasion (3) | `SKILL.md:219,279,331` | Scanner could not fully parse the referenced `generate_threejs_factory.py`, `probe_glb.py` (binary `struct` format strings) and `render_capture.md`. Each was reviewed by hand (L-1 came from that review). |
| T-12 | AST4 subprocess (5) | `build_detail_inventory.py`, `extract_landmarks.py`, `delight_albedo.py`, `extract_pbr_evidence.py`, `make_comparison_sheet.py` | `sips` (macOS image converter) with list argv, no shell, confined input path. |
| T-13 | AST4 + TT2 (4) | `run_vision_adapter.py:40`, `emit_target.py:164` | Arbitrary-command runners by design; **blocked** in Linden (`BLOCKED_SCRIPTS`, `--target` refused, vision python env never passed). |
| T-14 | AST3 `__import__` (3) | `probe_glb.py`, `compare_region_passes.py`, `validate_render_profile.py` | `__import__("sys")` with a constant name in the `__main__` guard. |
| T-15 | AST7 getattr (1) | `forge/stage5_rig/action_design.py:188` | `getattr` over a fixed alias list on a dataclass. |

Coverage notes (not findings): 20 `SKILL.md` references point at files created at run time or not shipped
(`.img2threejs/state.json`, `runtime/scripts/…`, `forge/tests/…`), and 6 files were only partially parsed — the
three from T-11 plus `docs/GLB_ANIMATED_CHARACTER_PROMPT.md`, `docs/standard-prompts/glb-force-measured.md` and
`docs/raw/img2threejs-skill-dataset.json`. These keep the report at "partial" coverage; they were read by hand.

Checked by hand beyond the scanner: no network code in `forge/` (no urllib/requests/socket/http), no
`eval`/`exec`/`pickle`/`marshal`/`os.system`/`shell=True`, no reads of `~/.ssh`, `~/.aws`, keychains or tokens, standard
library only, only `IMG2_HOME` and `IMG2THREEJS_VISION_PYTHON` read from the environment (both controlled by Linden).

## Keeping it fixed

- Upstream copy + patches: `scripts/vendor-img2threejs.mjs` applies `scripts/vendor-patches/img2threejs/*.patch` after
  trimming and records `upstreamTreeSha256`, each patch's sha256 and the final `treeSha256` in `VENDOR.json`. An upgrade
  where a patch no longer applies fails; check whether upstream fixed it, then update or drop the patch.
- `tests/agent/img2Vendor.test.ts` and `img2Tools.test.ts`: tree hash = `VENDOR.json`, patch hashes, no symlinks,
  injection regressions.
- `npm run check:skills`: SkillSpector against `skillspector-baseline.yaml`; fails on any finding not reviewed here.
  Verified: appending a prompt-injection + `curl | sh` line to a grimoire file gives 3 new HIGH findings.
- Upstream report: L-1 and L-2 should go to img2threejs upstream; the patches are ready to send.

## Residual risk

- The model still reads untrusted images; prompt injection can steer what it writes into specs or scripts. Linden
  limits what follows from that (tool allowlist, path confinement, shell approval, factory code only in sandboxes), but
  it cannot make the model's judgement trustworthy.
- Play and web builds run factory code by design, inside the same sandbox as game scripts.
- The runtime copy is verified once per session, not before every script run.
- Windows has not been run.
