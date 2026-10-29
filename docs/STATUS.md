# Linden Engine: implementation status

Audited 2026-10-29 by reading the code (static audit; packaged-build behaviour not yet verified).

"Working" means the feature takes part in the full game loop: create/open project → edit scene → Play → Web export.

Status key: **WORKING** = wired end to end. **PARTIAL** = wired but incomplete, memory-only or demo data. **STUB** = does nothing, or reports success without doing the work. **BROKEN** = wired but fails at runtime. **DEAD** = code exists but nothing in the UI reaches it.

## Working

- **Project:** New / Open / Open Recent / Close Project, project templates, open-last-project on startup.
- **Scenes:** New / Open / Save / Save As, Import Godot Project.
- **Editing:** keyboard Undo/Redo, Duplicate, Delete.
- **Hierarchy:** select, multi-select, reparent, context menu.
- **Inspector:** property editing, Add / Reset / Remove / Copy / Paste Component.
- **Viewport:** Move/Rotate/Scale gizmo (W/E/R), 2D toggle, HTML UI preview, stats.
- **Play:** Play / Pause / Step, Game Frame, script hot reload.
- **Gameplay:** Rapier 3D physics, TypeScript Script component, Input Actions + touch layouts.
- **Export:** Web export + Run in Browser.
- **Godot / AI:** Godot executable detection, AI Agent panel + Prompt-to-Game.

## Partial

- **Settings persistence:** Project Settings (tags, layers, collision matrix) and export presets are memory-only. `project:saveSettings` is never called, so they are lost on reopen and missing from builds.
- **Web export:** builds from scenes on disk, so unsaved edits are not exported. There is no UI for `scenesInBuild`, and `basePath`, `loadingTitle`, `version` and `packageIdentifier` are unused.
- **Project / Assets panel:** mock data; it does not read the disk.
- **Prefabs:** memory-only; no `.lprefab` file is written.
- **Import .tscn:** parses the file, then discards the result.
- **Native menus:** Edit > Undo/Redo only acts on text fields; Cut/Copy/Paste are text-only.
- **Inspector event listener "+":** uses a hardcoded target.

## Stub (often reporting false success)

- **Exports:**
  - Windows / macOS / Linux export writes a text placeholder.
  - Export Data Only writes nothing.
  - Android/iOS export runs Godot against a non-Godot folder.
- **Godot bridge:**
  - Export to Godot (.tscn) writes nothing but reports success.
  - Live Sync moves no data.
  - The Godot addon never connects.
- **Project Settings:** the Time and Services tabs are static.
- **Inspector:** Prefab "Revert All" does nothing.
- **Toolbar & native menus:**
  - The top toolbar transform buttons have no handlers.
  - Native Help > About has no renderer listener.

## Broken

- **`window.prompt()`:** Electron does not support it, so these actions do nothing: New Tag, New Folder.
- **Transmuter / Unity wizard:** uses Node `fs` in the renderer and has no IPC route. It works only via the CLI and tests.
- **Bottom panel:** cannot be shown again once hidden.
- **Bridge Sync status:** always shows Offline.

## Dead code

- **Engine runtime:** Physics2D, Renderer2D, TileMap, SceneManager / Services, `engine/core/Engine.ts`, InputMap.
- **Editor components:** `editor/viewport/Viewport.tsx`, `AssetBrowser.tsx`, `GodotPanel.tsx`.
- **Not implemented at all:** the Plugin System described in README.

## Removed (2026-10-29)

Blueprint (including Blueprints v1 M1), Material, Animator and Sequencer: editor tabs, menus, engine modules (`engine/blueprints`, `engine/materials`, `engine/animation`, `engine/cinematic`), the `linden_blueprint_apply` agent tool, and the Godot Blueprint/Animator mappings. Gameplay logic is TypeScript only. Old scenes keep `Blueprint` components as inert placeholders. See `docs/specs/SPEC-Remove-Blueprint-Material-Animator-Sequencer.md`.

## Parked follow-ups

1. Never report false success: disable or label unimplemented features.
2. Persist project settings and export presets.
3. Quick fixes batch: in-app prompt dialog, Help > About, toolbar buttons, bottom panel, Inspector event listeners (hardcoded Door/Alarm options; no way to target TS script methods).
4. Disk-backed asset panel and prefabs.
5. Real desktop export.
6. Freeze Godot bridge and Transmuter UI.
7. Honest labels for the "2D" templates.
8. Remove dead code; correct README / FEATURE_SUMMARY / PROJECT_COMPLETION.
