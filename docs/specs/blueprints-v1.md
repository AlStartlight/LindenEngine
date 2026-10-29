# SPEC: Blueprints v1 (UE5-style visual logic, agent-editable)

Status: **withdrawn** (2026-10-29), see `SPEC-Remove-Blueprint-Material-Animator-Sequencer.md`. M1 was built on `feat/blueprints-v1` (kept unmerged as an archive); M2–M4 are cancelled.

## Goal

Visual-scripting Blueprints in the spirit of Unreal Engine 5 that:

- run inside `scene` projects next to TypeScript scripts and HTML/CSS UI,
- behave identically in editor Play, headless `linden_play`, and Web export,
- are a stable, text-based contract the OpenCode agent can create, edit, explain and fix.

## Layering

- **TypeScript is the native layer, Blueprints are the logic layer** (UE5's C++ ↔ Blueprint split).
- An entity may carry both a `Script` and a `Blueprint` component.
- TS exposes typed nodes via decorators (`@blueprintCallable`, `@blueprintEvent`, `@blueprintProperty`), extracted at compile time with the TS compiler API into `blueprint-catalog.json` (milestone M4).
- Generic `Emit Event` / `On Event` nodes bridge to the existing script event bus (`ctx.emit` / `ctx.on`).

## Asset format

- Files live at `blueprints/<Name>.lbp.json`, versioned (`"format": "linden.blueprint", "version": 1`) and validated with zod.
- Node IDs are author-chosen stable strings; pins are addressed as `nodeId.pinName` (no random IDs).
- Layout (`x`, `y`, comments) is stored apart from logic so logic diffs stay clean.
- Node kinds come from a **declarative registry**: each type declares its pins, metadata and a codegen function. The old class-per-node implementation in `engine/blueprints/*` is replaced. `BlueprintToGd` is frozen.

## Execution

- Blueprints are **compiled ahead of time to JS** by the same pipeline as TS scripts (scene-mode Play CSP forbids `eval`).
- Every event entry compiles to a **generator function**. Latent nodes (`Delay`, …) `yield`; locals survive the wait.
- A Blueprint scheduler inside `GameSimulation` resumes generators each frame, so Pause / Step / time scale apply.
- Editor Play builds inject `__bp.trace(nodeId)` calls, streamed to the editor as `linden:bpTrace`; Web export strips them.
- A Blueprint that throws is disabled for that entity and reported with its `nodeId` (clickable in Console, readable by the agent).

## Attachment

- Component `Blueprint { src: "blueprints/Player.lbp.json", overrides }`, one per entity.
- Variables flagged *Instance Editable* appear in the Inspector as per-entity overrides.

## v1 scope

Entity Blueprint with Event Graph, Variables and Functions.

Nodes:

- **Event:** BeginPlay, Tick, EndPlay, Input Action (Pressed/Released), Trigger Enter/Exit, Collision Enter/Exit, Custom Event, On Event (bus), UI On Click.
- **Flow:** Branch, Sequence, ForLoop, ForEach, While, Gate, DoOnce, FlipFlop, Delay, Return.
- **Data:** Get/Set Variable, Make/Break Vector3, math (+ − × ÷, Clamp, Lerp, compare, logic), string (Append, Format, ToString), array (Add, Get, Length, Contains).
- **Entity/Physics:** Get/Set Position/Rotation/Scale, Find Entity by Name/Tag, Spawn Prefab, Destroy, Apply Impulse, Set/Get Velocity, Raycast, Add Movement Input, Jump.
- **Input:** Get Axis, Is Action Down.
- **UI** (wraps `ctx.ui`): Set Text, Show/Hide, Bind Value.
- **Other:** Emit Event, Call Function, Print String, Load Scene.
- **Generated:** nodes from TS decorators and component properties.

Variable types: boolean, integer, float, string, vector3, entity reference, and arrays of these.

Deferred to v2: Construction Script, Macros, Level Blueprint, Interfaces, Event Dispatchers, inheritance, Timeline, Map/Set/struct/custom enum, PlaySound (no audio system yet), Blueprints in `html` runtime projects, Blueprint ↔ TS conversion, breakpoints and watches.

## Agent integration

- MCP tools: `blueprint_catalog`, `blueprint_read`, `blueprint_apply` (schema-validated, clear rejection errors), `blueprint_attach`.
- `linden_play` reports per-node Blueprint logs and errors.
- `AGENTS.md` / session instructions are regenerated with the node catalogue.
- The agent may create, modify, explain and fix Blueprints.
- Agent edits to an open Blueprint apply to the editor's in-memory graph as one undo step; otherwise the file is written directly.

## Editor

- Rebuilt on React Flow (`@xyflow/react`) with a UE5-style theme: palette, Variables/Functions panel, save/load, undo, trace highlight, clickable errors.
- Fixes: graph Delete / Ctrl+Z must not leak to the scene; graph state must survive tab switches.

## Milestones (each must pass its tests before the next)

1. **M1 Core:** schema + zod, node registry, compiler to generator JS, scheduler in `GameSimulation`, `Blueprint {src}` component, Play + Web export + hot reload. Unit tests for compiler/runtime, one Play e2e.
2. **M2 Editor:** React Flow editor as above.
3. **M3 Agent:** MCP tools, `linden_play` extension, generated instructions, open-editor sync. Test: agent builds a small game from a prompt through Play.
4. **M4 TS ↔ BP:** decorators, catalogue extraction, typed nodes.
