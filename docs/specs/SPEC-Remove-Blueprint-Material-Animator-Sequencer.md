# SPEC: Remove Blueprint, Material, Animator and Sequencer

Status: implemented on `chore/remove-graph-editors` (2026-10-29). Supersedes `docs/specs/blueprints-v1.md`.

## Decision

Remove all four node/timeline features completely: the editor tabs, menus, engine modules, agent tool, Godot mappings, tests and docs. Gameplay logic is written in TypeScript scripts only; UI stays HTML/CSS (HtmlUI) and HTML Game projects stay as they are.

This includes **Blueprints v1 milestone M1** (commit `5ac44bd` on `feat/blueprints-v1`). Milestones M2–M4 are cancelled.

## Why

- The audit (`docs/STATUS.md`) found the Material, Animator and Sequencer editors to be sandboxes:
  - they load hardcoded demo data;
  - they have no save/load and no runtime effect;
  - they rely on `window.prompt()`, which does not work in Electron;
  - their Delete and Ctrl+Z also act on the scene.
- The legacy Blueprint editor has the same problems. M1 added a working runtime, but no editor UI.
- The working loop (project → scene → TS scripts → Play → Web export) and the AI agent do not depend on any of these features.
- Removing them cuts about 10k lines and every place where the UI promises features that don't exist.

## Branching

- Start a new branch `chore/remove-graph-editors` from `feat/html-js-runtime-movement-touch` (`2969a25`), the commit **before** M1. M1 then never lands and does not need to be reverted file by file.
- Keep `feat/blueprints-v1` unmerged as an archive. Do not delete it.
- Carry over from M1 only `docs/STATUS.md` (updated, see Docs below). The M1 additions `CharacterMovement.addMovementInput()` / `jump()` are **not** carried over; re-add them with their own tests if scripts need them.
- Local `main` is behind the feature branch (it is v0.1.3). Target the PR at whichever branch is current upstream.

## Scope

Paths are relative to the repo root. "Delete" means removing the file. "Edit" means removing only the parts named.

### Editor UI

| Path | Action |
|---|---|
| `editor/panels/BlueprintEditor.tsx` | Delete |
| `editor/panels/MaterialEditor.tsx` | Delete |
| `editor/panels/AnimatorEditor.tsx` | Delete |
| `editor/panels/SequencerEditor.tsx` | Delete |
| `editor/hooks/useHistory.ts` | Delete (only these four editors use it) |
| `editor/panels/index.ts` | Edit: drop the four exports and their entries in the panel catalogue |
| `editor/EditorLayout.tsx` | Edit: drop the four imports, the four tab buttons, the conditional mounts, and the `onOpen*Editor` props passed to Toolbar |
| `editor/ui/Toolbar.tsx` | Edit: drop the `onOpenBlueprintEditor` / `onOpenMaterialEditor` / `onOpenAnimatorEditor` / `onOpenSequencerEditor` props and their Window-menu items |
| `editor/ui/Icons.tsx` | Edit: drop `Blueprint`, `Material`, `Animator`, `Sequencer` icons once nothing references them |
| `editor/store/editorStore.ts` | Edit: `activeEditorPanel` becomes `'viewport' \| 'bridge' \| 'godot'` (type, `setActiveEditorPanel` signature, implementation) |
| `editor/panels/InspectorPanel.tsx` | Edit: drop the `BlueprintComponent` import, the "Blueprint" optgroup and the `bpEvents` lookup. The "+" listener button must no longer default to `component: 'Blueprint', method: 'OpenDoor'`; it adds a listener with an empty component and method |

### Electron

| Path | Action |
|---|---|
| `electron/main.ts` | Edit: drop the Window-menu items Blueprint / Material / Animator / Sequencer Editor (they send `menu:openBlueprint`, `menu:openMaterial`, `menu:openAnimator`, `menu:openSequencer`, which no renderer listener handles) |
| `electron/agent/lindenTools/index.ts` | Edit: drop the `linden_blueprint_apply` tool |
| `electron/agent/prompts/linden.md` | Edit: drop the `linden_blueprint_apply` line and renumber the tool list |
| `shared/mime.ts` | Edit: drop `.lbp` |

`AGENTS.md` is written into projects only when missing (`AgentHost`), so existing projects keep the old tool line. This is harmless: calling the tool returns "unknown tool". No migration is needed.

### Engine

| Path | Action |
|---|---|
| `engine/blueprints/` (whole folder) | Delete |
| `engine/materials/` (whole folder) | Delete (only `MaterialEditor` imports it) |
| `engine/animation/` (whole folder) | Delete (only `AnimatorEditor` and one parity test import it) |
| `engine/cinematic/` (whole folder) | Delete (only `SequencerEditor` imports it) |
| `engine/ecs/ComponentRegistry.ts` | Edit: drop the `'Blueprint'` component registration and its import |
| `engine/events/EventField.ts` | Edit: drop the `listener.component === 'Blueprint'` branch and the import. Listeners always call `component[method]` |
| `engine/godot/GodotBridge.ts` | Edit: drop `transpileBlueprint` and the `BlueprintGraph` / `BlueprintToGd` imports |
| `engine/godot/transpiler/BlueprintToGd.ts` | Delete. If `engine/godot/transpiler/` is then empty, delete the folder too |
| `engine/godot/mapping/AnimatorMap.ts` | Delete (only tests use it) |
| `engine/godot/mapping/ComponentMap.ts` | Edit: drop the `Blueprint` lookup and its "Blueprint attached" report line |

Not touched:

- `engine/godot/mapping/MaterialMap.ts`. It maps MeshRenderer materials for Godot import and has nothing to do with the Material editor.
- `engine/time/Tween.ts`, whose comment mentions Godot's animation folder.

### Tests

| Path | Action |
|---|---|
| `tests/events/eventField.test.ts` | Edit: drop TC-F12-09, -12, -13 and -14 (Blueprint listeners) and the blueprint imports |
| `tests/godot/unit.test.ts` | Edit: drop the BlueprintToGd tests (the `describe` block using `BlueprintGraph`) |
| `tests/godot/integration.test.ts` | Edit: drop IT-04 (Blueprint → GDScript), IT-06 (Animator → AnimationTree) and IT-07 (Sequencer → AnimationPlayer) and their imports |
| `tests/godot-parity/godotParity.test.ts` | Edit: drop TC-GF-10 (AnimationPlayer) and its import |
| `docs/test-case-1m/gen/blueprint.ts`, `animator.ts`, `sequencer.ts` | Delete. Remove their entries from `docs/test-case-1m/tools/manifest.mjs`, `docs/test-case-1m/ui/entry.ts`, and any cases in `gen/ui.ts` / `gen/window-input.ts` that open these tabs or menus |

The Transmuter tests that only contain the words "Animator" / "AnimationTree" inside report strings (`tests/transmuter/*`) stay. They test report formatting, not these features.

### Docs

| Path | Action |
|---|---|
| `docs/BLUEPRINT_GUIDE.md` | Delete |
| `README.md` | Edit: drop the "Blueprint visual scripting", "Material Editor", "Animator", "Sequencer" claims, table-of-contents entries, tutorial steps and file-tree lines. Describe logic as TypeScript scripts + HtmlUI |
| `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `CONTRIBUTING.md` | Edit: drop mentions of the four features |
| `docs/ARCHITECTURE copy.md` | Delete (stale duplicate) |
| `docs/specs/blueprints-v1.md` | Keep, add `Status: withdrawn (see SPEC-Remove-Blueprint-Material-Animator-Sequencer.md)` at the top |
| `docs/STATUS.md` | Edit: move the four features out of Partial / Broken into a "Removed" section, and drop the related Broken lines (prompt-based actions in Animator/Sequencer, graph Delete/Ctrl+Z leak, tab-switch data loss) |

Historical PRDs under `docs/godot-parity/`, `docs/PRD-New_product/` and `docs/specs/PRD-*` are records and stay unchanged.

## Compatibility

- **Scenes containing a `Blueprint` component.**
  - The serializer already keeps unregistered component types as a generic placeholder (`engine/scene/serializer.ts`, "Missing script or unknown component").
  - Such scenes must open, Play and save again without losing that component's data.
  - The component does nothing at runtime.
- **`.lbp` / `.lbp.json` files in projects** are left on disk untouched. Nothing reads them.
- **EventField listeners with `component: 'Blueprint'`** in saved scenes:
  - They now take the generic path.
  - With no `Blueprint` component present, this produces the existing warning ("has no component …").
  - It never throws.

## Out of scope

- Fixing the Inspector event-listener UI. Its hardcoded "Door.open / Alarm.ring" options and the missing way to target TS script methods are a follow-up item in `docs/STATUS.md`.
- Any of the other parked audit follow-ups.

## Acceptance criteria

1. **No leftover references.** `grep -rniE "blueprint|MaterialEditor|engine/materials|Animator|AnimationPlayer|AnimationTree|Sequencer|VirtualCamera|\.lbp" editor engine electron player shared src tests` returns nothing. The only exceptions are the Transmuter report strings listed above and the compatibility tests that load leftover `Blueprint` data (`tests/scene/removedComponents.test.ts`, TC-F12-12 in `tests/events/eventField.test.ts`).
2. **Type-checks pass:** `npm run type-check` and `tsc -p tsconfig.electron.json --noEmit`.
3. **Unit tests pass:** `npm test`.
4. **E2E tests pass:** `npm run test:e2e:play`, `npm run test:e2e:move`, `npm run test:e2e:touch`, and `npm run test:e2e:packaged-agent` (when a packaged build is available).
5. **Editor UI is clean.**
   - The editor's centre tab bar shows only Viewport and Bridge (plus Godot if it is still mounted).
   - Neither the native nor the React Window menu lists any of the four editors.
   - No console errors at startup.
6. **Old scenes survive.** A scene containing `{ "type": "Blueprint", "data": { "blueprintName": "X" } }` on an entity:
   - opens without error;
   - runs Play with its scripts unaffected;
   - after Save, still contains that component with the same data.

   Add this as a unit test in `tests/scene/`.
7. **Agent tool is gone.** The agent's tool list (`LINDEN_TOOLS`) no longer contains `linden_blueprint_apply`, and `tests/agent` still passes.
8. **Builds work:** `npm run build` and `npm run build:player` succeed.

## Order of work

1. Create the branch, then remove the editor UI, store, menus and icons. Run type-check.
2. Remove the engine modules, the registry entry, EventField, and the Godot mappings with their tests. Run type-check and unit tests.
3. Remove the agent tool, prompt line and mime entry. Run the agent tests.
4. Add the scene-compatibility test (criterion 6).
5. Update docs and run the acceptance criteria.
6. Commit as one `refactor!:` commit that lists the removed features in the body.
