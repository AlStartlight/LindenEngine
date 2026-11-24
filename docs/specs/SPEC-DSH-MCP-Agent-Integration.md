# SPEC: Agent Bridge — DeepSeek Harness & Custom Agents on the Linden MCP

**Status:** Implemented — P0 (bridge/discovery), P1 (MCP v2), P2 (DSH bundle), P3 (editor Agents dialog), P4 (batch play, seeded levels, snapshots, block patch, review gate).
**Version:** 1.0.0
**Date:** 2026-11-24
**Target:** `electron/agent/AgentBridgeService.ts` (new), `electron/agent/LindenMcpServer.ts`, `electron/agent/AgentHost.ts`, `electron/main.ts`, `shared/ipcChannels.ts`, `editor/agent/`, `integrations/dsh/`, `integrations/agents/`
**Related:** [`SPEC-Blender-MCP-Image-To-3D.md`](./SPEC-Blender-MCP-Image-To-3D.md), [`SPEC-Fix-Auto-Approve-OpenCode-Agent.md`](./SPEC-Fix-Auto-Approve-OpenCode-Agent.md), [`SPEC-Agent-Live-Progress-Thinking.md`](./SPEC-Agent-Live-Progress-Thinking.md)
**References:** [lindenengine.com](https://www.lindenengine.com/en), [features](https://www.lindenengine.com/en/features), [architecture](https://www.lindenengine.com/en/architecture)

---

## 1. Executive Summary

Linden Engine already exposes its editing capabilities as an MCP server (`linden`) and connects it to **one** agent runtime: OpenCode. The server is created inside `AgentHost.startServer()`, bound to a random loopback port with a random bearer token, and registered with the OpenCode client only. Every other runtime — DeepSeek Harness, Claude Code, Cursor, a studio's in-house agent — has no supported way in, no discovery, and no least privilege.

This spec turns that private OpenCode detail into a product surface:

1. **Agent Bridge** — a host-level service that owns the `linden` MCP server independently of any agent runtime, publishes a discoverable endpoint manifest, issues per-role tokens, and routes diffs/permissions to the right client and session.
2. **MCP contract v2** — version negotiation, token scopes, per-call client attribution, cancellation, tool-list change notifications, and a stable error taxonomy.
3. **Five domain agents** matching the roster published at `lindenengine.com` — Architect, Programmer, Technical Artist, QA & Physics Tester, Level & Biome Synthesizer — each a least-privilege view over the same tools.
4. **DeepSeek Harness support** — a bundle (`integrations/dsh/`) with five Agent presets plus a stdio bridge, so DSH is a first-class runtime, not a fork of the OpenCode path.
5. **A runtime-neutral contract** — `agents.json` + `agent-bridge.schema.json`, so any custom agent integrates by reading one file, without patching Linden.

The principle: **the engine is the authority, agents are clients.** Tools, validation, path confinement, diffs and permissions stay in `LindenMcpServer` / `LINDEN_TOOLS`; an agent runtime is swappable.

---

## 2. Verified Current State

| # | Fact | Evidence |
|---|---|---|
| 1 | MCP server is Streamable-HTTP, POST-only, JSON responses, loopback, random port | `electron/agent/LindenMcpServer.ts:34-47`, `:62-67` |
| 2 | One random 24-byte bearer token, timing-safe compare, 10 MB body cap | `:24`, `:57`, `:16` |
| 3 | `initialize` echoes the client's `protocolVersion` without validation and advertises `capabilities: { tools: {} }` | `:107-118` |
| 4 | Only `initialize`, `ping`, `tools/list`, `tools/call` exist; no resources, prompts, cancellation or server-initiated notifications | `:102-146` |
| 5 | `tools/list` strips the `linden_` prefix; `tools/call` re-adds it | `:119-131` |
| 6 | 26 tools exist, some feature-gated by `available()` (Blender) | `electron/agent/lindenTools/index.ts:36-47`, `electron/agent/lindenTools/*.ts` |
| 7 | Server is created and started only inside `AgentHost.startServer()`, i.e. only when the OpenCode agent starts | `electron/agent/AgentHost.ts:379-393` |
| 8 | Server is registered with the OpenCode client only, as remote server `linden` | `AgentHost.ts:415-425` |
| 9 | On agent stop the server is closed | `AgentHost.ts:518-519` |
| 10 | Tool-call diffs are attributed to `this.activeSessionId` — a single, OpenCode-owned session | `AgentHost.ts:383-388` |
| 11 | Engine tools write files directly (`scene_apply` rewrites the whole entity list; `script_write` writes whole files) | `lindenTools/index.ts:547-680`, `:709-785` |
| 12 | `linden_play` clamps to 0.1–10 s at 60 Hz per call | `lindenTools/index.ts:264` |
| 13 | Platform uses Electron main + IPC handlers for agent actions | `electron/main.ts:298`, `:1252-1370` |

**Consequences.** A second runtime cannot find the endpoint; sharing one token means no least privilege; two runtimes writing at once have no attribution and no lock; DSH's MCP client can only attach if a human hand-copies URL and token out of a log; and the five-agent story on the website has no per-agent boundary in the product.

---

## 3. Goals / Non-Goals

### Goals
- **G1** Any MCP-capable agent attaches with a file path, not a URL+token paste.
- **G2** Each agent role gets only the tools it needs, enforced server-side by token scope.
- **G3** Concurrent runtimes (OpenCode, DSH, custom) coexist: correct session attribution, scene-level write locks, no silent overwrite.
- **G4** OpenCode keeps working exactly as today (no regression, same tool names).
- **G5** DeepSeek Harness ships five presets that match the published roster and are installable from one bundle.
- **G6** The integration contract is documented and machine-readable for third parties.
- **G7** Honest status: capabilities the website claims but the engine does not implement are listed, not simulated.

### Non-Goals
- Sandboxing agent model providers (that belongs to the agent runtime; see §11).
- Multi-model routing inside Linden.
- Replacing OpenCode as the default in-editor agent.
- Implementing the marketing claims listed in §4 as fake telemetry (see the gap table).
- MCP `prompts` support (DSH does not consume MCP prompts; skills/personas cover the same need).

---

## 4. Website → Engine Capability Map

The public site describes an autonomous multi-agent game engineering platform. A spec that pretends the gap does not exist will produce agents that lie to users. This table is the contract for what the five agents may claim.

| Website claim | Engine reality (verified) | This spec |
|---|---|---|
| Five domain-expert agents in parallel | One tool server, one OpenCode agent, several prompt templates (`electron/agent/prompts/`) | Five scoped roles + DSH presets; concurrency via separate runtimes and locks |
| AST micro-diffs, "no overwrites" | `scene_apply` replaces the entity array; `script_write` replaces whole files; diffs are recorded for review | Write leases + attribution; `linden_script_patch` patches one class/function/method block (block-level, not a full parser) |
| Sub-100 ms hot reload | Editor applies diffs and reloads; agents currently write files the editor watches | Unchanged; agents must report measured latency, not the marketing number |
| 10,000× headless collision trials | `linden_play` runs 0.1–10 s per call | `linden_play_matrix`: up to 20 runs / 60 simulated seconds per call, aggregated verdicts |
| Raft 5/5 quorum | None | `linden_review_gate`: one review record, quorum 1–5, optional hard gate on export; still not Raft |
| Firecracker microVM isolation | Tools run in the Electron main process; Blender script execution is permission-gated | Documented honestly; host OS sandbox is the runtime's job |
| GLSL/SPIR-V shader synthesis | No shader tool exists; materials + VFX + factory models do | Out of scope; artist uses `material_presets`/`factory_write` |
| Procedural WFC level synthesis | No generator tool; primitives + `scene_apply` exist | `linden_level_synthesize`: seeded rooms + corridors, not true WFC |
| Time-travel snapshot rollback | Diffs are stored; no timeline service | File snapshots + restore (`linden_snapshot_*`); not runtime state rollback |
| Godot 4.3 / Unity 6 export | Engine is Three.js/WebGPU + Rapier; `linden_export_web` only | Web export only; no Godot/Unity claims from agents |

**Rule for prompts:** an agent may describe what it verified with a tool call; it must not restate website metrics (determinism score, microVM limits, quorum) as if they were measured in the current project.

---

## 5. Target Architecture

```
┌──────────────────────────── Electron main ────────────────────────────┐
│                                                                      │
│  AgentBridgeService (new, host-level, starts with the app)           │
│   ├─ LindenMcpServer v2   loopback :randomPort /mcp                  │
│   │    ├─ token → { clientId, role, scope }                          │
│   │    ├─ per-request client/session context                         │
│   │    └─ LINDEN_TOOLS (26, unchanged)                              │
│   ├─ EndpointWriter → <project>/.linden/agent-bridge.json  (0600)    │
│   │                   ~/.linden/agent-bridge/last.json                │
│   └─ Diff/permission router → editor UI + AgentHost                 │
│                                                                      │
│  AgentHost (OpenCode)  ── mcp.add("linden", master token) ──► server │
└──────────────────────────────────────────────────────────────────────┘
        ▲                    ▲                          ▲
        │ HTTP + Bearer       │ stdio (bridge)           │ HTTP + Bearer
   OpenCode            DeepSeek Harness            Custom agent
                       integrations/dsh/          integrations/agents/
```

### 5.1 AgentBridgeService

New file `electron/agent/AgentBridgeService.ts`, a singleton beside `AgentHost`.

Responsibilities:
- own exactly one `LindenMcpServer` for the open project;
- issue a master token + one token per role in `integrations/dsh/agents.json` (the engine keeps a compiled-in copy of the role catalog so it works without the repo folder);
- write the manifest atomically (`write tmp → chmod 0600 → rename`), delete it on project close, always update `last.json`;
- expose `getStatus()` for the UI and diagnostics (`clients[]`, `scopes`, `port`, `manifestPath`);
- route `onDiff` / `requestPermission` / `onToolCall` events with `{ clientId, role, sessionId, turnId }`;
- rotate tokens on every start and on explicit `restart()`.

Lifecycle in `electron/main.ts`:
- start on project open (where the window loads a project), not only when the agent panel opens;
- restart on project switch (today `AgentHost` re-registers on project change — the bridge must move the server, not duplicate it);
- stop in `before-quit` alongside `AgentHost.stopServer()`.

`AgentHost` changes:
- delete its own `new LindenMcpServer(...)`; ask `AgentBridgeService` for the URL and master token;
- keep `registerMcp()` semantics (server name `linden`, same headers) so tool names in existing sessions do not change;
- keep `stopServer()` closing only the OpenCode process; the bridge survives.

### 5.2 Endpoint manifest

Written to `<project>/.linden/agent-bridge.json`, schema `integrations/agents/agent-bridge.schema.json`:

```json
{
  "format": "linden-agent-bridge",
  "version": 1,
  "projectPath": "/Users/me/Linden Projects/mars-odyssey",
  "projectName": "Mars Odyssey",
  "endpoint": "http://127.0.0.1:51234/mcp",
  "transport": "streamable-http",
  "protocolVersion": "2025-06-18",
  "server": { "name": "linden", "version": "0.3.0" },
  "issuedAt": "2026-11-24T13:03:00.000Z",
  "expiresAt": null,
  "tokens": {
    "master": "…",
    "linden-game-architect": "…",
    "linden-gameplay-programmer": "…",
    "linden-technical-artist": "…",
    "linden-qa-physics-tester": "…",
    "linden-level-biome-synthesizer": "…"
  },
  "scopes": {
    "linden-qa-physics-tester": ["project_info", "scene_read", "component_list", "play", "render_preview"]
  },
  "limits": { "maxBodyBytes": 10485760, "toolTimeoutMs": 120000, "lockTtlMs": 120000 }
}
```

Rules:
- `127.0.0.1` only; never `0.0.0.0`.
- Never inside the repo tree root: `.linden/` is git-ignored (this change adds it to `.gitignore`).
- On Windows, ACL-restrict the file to the current user; document the fallback (user-profile directory) if that is not possible.
- A stale manifest (process died) is detected by the bridge via connection refused, not by timestamps.

### 5.3 Tokens, roles, scopes

- Token map lives in memory only; the manifest is the only persisted copy.
- `Authorization: Bearer <token>` → lookup with a timing-safe compare over the map (constant set size for a given start).
- 401 for an unknown token. A known token calling outside its scope gets a JSON-RPC error (`-32003`, `LINDEN_E_SCOPE`) with HTTP 200, so MCP clients surface it as a failed tool call instead of a transport failure.
- Scope is a list of bare tool names (`scene_apply`), matching `tools/list`. The engine catalog:

| Role | Tools (bare names) |
|---|---|
| `director` (existing OpenCode session) | all 26 |
| `linden-game-architect` | `project_info`, `scene_read`, `scene_validate`, `scene_apply`, `component_list`, `dimensions`, `play`, `snapshot_create`, `snapshot_list`, `snapshot_restore`, `review_gate` |
| `linden-gameplay-programmer` | `project_info`, `scene_read`, `component_list`, `script_write`, `script_transmute`, `script_patch`, `ui_write`, `web_write`, `input_actions`, `touch_button`, `play`, `export_web`, `snapshot_create`, `snapshot_list`, `snapshot_restore`, `review_gate` |
| `linden-technical-artist` | `project_info`, `scene_read`, `component_list`, `material_presets`, `dimensions`, `model_build`, `model_bake_glb`, `factory_write`, `asset_placeholder`, `asset_import`, `render_preview`, `reference_view`, `blender_status`, `blender_build`, `blender_environment`, `blender_rig_character`, `blender_script` |
| `linden-qa-physics-tester` | `project_info`, `scene_read`, `scene_validate`, `component_list`, `play`, `render_preview`, `play_matrix`, `snapshot_list`, `review_gate` |
| `linden-level-biome-synthesizer` | `project_info`, `scene_read`, `scene_validate`, `scene_apply`, `component_list`, `dimensions`, `material_presets`, `model_build`, `asset_placeholder`, `render_preview`, `play`, `input_actions`, `play_matrix`, `level_synthesize`, `snapshot_create`, `snapshot_list`, `snapshot_restore`, `review_gate` |

Feature-gated tools (Blender) remain listed only when `available()` is true; the scope check runs after availability.

### 5.4 Session and turn attribution

Today every diff is attributed to `AgentHost.activeSessionId`. With multiple runtimes that is wrong. Clients send context per call:

```json
{
  "method": "tools/call",
  "params": {
    "name": "scene_apply",
    "arguments": { "...": "..." },
    "_meta": { "linden": { "sessionId": "dsh-session-42", "turnId": "turn-7", "label": "Linden Game Architect" } }
  }
}
```

The server keeps `requestId → {token, role, sessionId, turnId}` for the duration of the call. `AgentDiffItem` gains `clientId`, `role`, and the metadata; `AgentHost`'s OpenCode path keeps its current inference when `_meta` is absent. The editor attribute diff cards to the originating role, so a human can see which agent touched a scene.

### 5.5 MCP protocol v2

| Area | v1 (today) | v2 |
|---|---|---|
| Version negotiation | echoes any version | supports `2024-11-05`, `2025-03-26`, `2025-06-18`; answers with newest supported, logs a mismatch |
| Capabilities | `tools` only | `tools` (+ `resources` in P3) |
| Auth | one token | token map, scope (`-32003`), 401 for unknown tokens |
| `tools/list` | all available | filtered by token scope; `_meta.linden.role` echo |
| `tools/call` | name + args | name + args + `_meta`, per-request `AbortController`, lock acquisition |
| Cancellation | ignored | `notifications/cancelled` aborts the request; `linden_play` checks the signal every 60 frames |
| List changes | none | `notifications/tools/list_changed` on project switch / Blender detection where a server→client stream exists; otherwise clients reconnect (documented) |
| Transport | POST only, JSON | POST JSON; GET keeps returning 405 (server→client SSE is deferred, so tool-list changes arrive on reconnect) |
| Errors | free text | `{ code, message, details }` in the text block + `isError: true` |
| Limits | 10 MB body | unchanged + `toolTimeoutMs` per call |

**Version compatibility risk:** DSH's MCP client selects the newest revision its SDK supports (2026-07-28 when available) and falls back to legacy revisions. The v2 server must answer with a version it truly implements and the client must recover; P1 includes a matrix test against the installed DSH/OpenCode SDKs, not just curl.

### 5.6 Error taxonomy

| Code | HTTP | Meaning |
|---|---|---|
| `LINDEN_E_AUTH` | 401 | Missing/unknown bearer token |
| `LINDEN_E_SCOPE` | 200, JSON-RPC `-32003` | Token valid, tool outside role scope |
| `LINDEN_E_UNKNOWN_TOOL` | 200 (`isError`) | Tool not registered or `available()` false |
| `LINDEN_E_PROJECT` | 200 (`isError`) | Bad/missing project or scene path |
| `LINDEN_E_LOCKED` | 200, JSON-RPC `-32009` | Scene write lease held by another client, or stale base hash |
| `LINDEN_E_PERMISSION` | 200 (`isError`) | User denied a permission-gated tool |
| `LINDEN_E_CANCELLED` | 200, JSON-RPC `-32800` | Request cancelled through `notifications/cancelled` |
| `LINDEN_E_INTERNAL` | 200 (`isError`) | Unexpected failure; message kept, stack logged only |

---

## 6. Runtime Adapters

| Runtime | Path today | After this spec |
|---|---|---|
| OpenCode | server + token created in `AgentHost` | unchanged; consumes bridge master endpoint |
| DeepSeek Harness | none | `integrations/dsh/` bundle: five presets, stdio bridge, per-role token |
| Any MCP client (Claude Code, Cursor, custom SDK) | manual config, no discovery | read manifest / run bridge with `--print-config` |
| In-process tools (Blender) | direct | unchanged |

The bridge is intentionally thin (transport + discovery + client-side scope mirror). It must not re-implement validation, and it must never be the only line of defence — the server enforces scope too.

---

## 7. Custom Agent Contract

### 7.1 Files a third-party agent needs

| File | Purpose |
|---|---|
| `<project>/.linden/agent-bridge.json` | endpoint, tokens, scopes, bridge command |
| `integrations/agents/agent-bridge.schema.json` | validation for the manifest |
| `integrations/dsh/agents.json` | role catalog: id, tools, handoff expectations |

### 7.2 Minimal custom agent (TypeScript SDK)

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import fs from 'node:fs'

const manifest = JSON.parse(fs.readFileSync(`${process.env.LINDEN_PROJECT}/.linden/agent-bridge.json`, 'utf8'))
const role = 'linden-qa-physics-tester'

const client = new Client({ name: `linden-${role}`, version: '0.1.0' })
await client.connect(new StreamableHTTPClientTransport(new URL(manifest.endpoint), {
  requestInit: { headers: { Authorization: `Bearer ${manifest.tokens[role]}` } },
}))

await client.callTool({
  name: 'play',
  arguments: { scenePath: 'scenes/Main.lscene', durationSeconds: 3 },
  _meta: { linden: { sessionId: 'ci-run-42', label: 'CI QA' } },
})
```

### 7.3 Rules for integrators
1. Read the manifest on start and again after any 401/connection error (tokens rotate).
2. Never write `.lscene`, `project.linden.json` or `scripts/*` yourself — call the tools.
3. Send `_meta.linden.sessionId` so diffs are attributable.
4. Treat `isError: true` as failure; parse the JSON text for `code`.
5. Do not ask users for the token; ask for the project path.

---

## 8. The Five Agents

Shared contract for all five, mirroring the roster at `lindenengine.com/en/features`:

- **Inspect before mutate.** `project_info` → `scene_read` → `component_list`, then act.
- **The engine decides validity.** Only component types and fields returned by the engine; no invented nodes.
- **Evidence or silence.** Every claim is backed by a tool result (play report, render image, diff).
- **Stay in role.** Out-of-scope work is handed off by naming the role and the entity ids.
- **No engine edits.** `engine/`, `editor/`, `electron/` are never written by an agent.

### 8.1 Linden Game Architect — scene graph owner

| | |
|---|---|
| Scope | `project_info`, `scene_read`, `scene_validate`, `scene_apply`, `component_list`, `dimensions`, `play`, `snapshot_*`, `review_gate` |
| Owns | `.lscene` v2 hierarchy, parent-child transforms, component wiring, structural validity |
| Loop | read scene → validate tree (unique ids, parents exist, no cycles) → plan entities → `scene_apply` → `play` 2–5 s → report |
| Definition of done | Entity tree matches the intent; every entity has the components its behaviour needs; play report has no NaN/fallen entity/missing-ground errors; entities it did not author are preserved verbatim |
| Refuses | writing scripts/shaders/assets; inventing component types; replacing a scene without reading it |
| Handoff | "Programmer: attach controller to `Player` (id `player`)"; "Artist: model for `LavaHazardZones`"; "QA: verify 3 s with Move + Jump" |

### 8.2 Linden Gameplay Programmer — type-safe behaviour

| | |
|---|---|
| Scope | `project_info`, `scene_read`, `component_list`, `script_write`, `script_transmute`, `script_patch`, `ui_write`, `web_write`, `input_actions`, `touch_button`, `play`, `export_web`, `snapshot_*`, `review_gate` |
| Owns | TypeScript/GDScript/C#/Rust gameplay, input actions, HTML UI, web export |
| Loop | read scene for real entity ids and public props → write script with `attachTo` → add input actions → `play` with an `inputScript` exercising the verb → fix compile/runtime errors → report |
| Definition of done | Compile clean; script attached; the inputScript reproduces the intended behaviour; no script exceptions; no per-frame allocation added |
| Refuses | editing scene JSON by hand; unattached scripts; `Math.random()` in deterministic gameplay paths; new components |
| Handoff | "QA: inputScript `Move` 0–1 s then `Jump` at 1 s"; "Artist: VFX hook name is `OnDash`" |

### 8.3 Linden Technical Artist — materials, models, asset budget

| | |
|---|---|
| Scope | `project_info`, `scene_read`, `component_list`, `material_presets`, `dimensions`, `model_build`, `model_bake_glb`, `factory_write`, `asset_placeholder`, `asset_import`, `render_preview`, `reference_view`, `blender_*` |
| Owns | PBR materials, procedural/imported geometry, Blender bridge, offscreen render review |
| Loop | inspect → choose material preset or build model → place → `render_preview` (front/side/top/¾) → compare with `reference_view` when supplied → iterate → report budget |
| Definition of done | The rendered images the agent actually inspected support the claim; assets exist under `assets/`/`models/`; triangles/draw-calls/texture sizes reported |
| Refuses | claiming a look without a preview; shader code the engine cannot run; unbounded texture/geometry budgets |
| Handoff | "Architect: entity `Rover` now uses material `steel_brushed`"; "Programmer: `Rover` mesh origin at wheel base" |

### 8.4 Linden QA & Physics Tester — read-only gate

| | |
|---|---|
| Scope | `project_info`, `scene_read`, `scene_validate`, `component_list`, `play`, `render_preview`, `play_matrix`, `snapshot_list`, `review_gate` |
| Owns | verification: clipping, falls, NaN/Infinity, unreachable jumps, jitter, script exceptions |
| Loop | inventory scene → define scenarios (traversal, combat, idle) → `play` per scenario with inputScripts → optionally `render_preview` for visual defects → verdict table |
| Definition of done | Every scenario has method + observed values + PASS/FAIL; failures name the owning agent and the fix they imply; untestable claims are labelled unverified |
| Refuses | writing anything; PASS without observed output; treating a warning as a failure (or the reverse) |
| Handoff | Verdict table to the owning agent; on a regression, the exact scene + duration + inputScript to reproduce |

### 8.5 Linden Level & Biome Synthesizer — prose to playable space

| | |
|---|---|
| Scope | `project_info`, `scene_read`, `scene_validate`, `scene_apply`, `component_list`, `dimensions`, `material_presets`, `model_build`, `asset_placeholder`, `render_preview`, `play`, `input_actions`, `play_matrix`, `level_synthesize`, `snapshot_*`, `review_gate` |
| Owns | layout, traversal path, density, mood (scene settings), spawn points, pacing |
| Loop | pick and state a seed → measure with `dimensions` → build entities → set lighting/fog/sun/postFx → `play` traversal → `render_preview` for mood → tune |
| Definition of done | Seed + rationale recorded; every gap inside character capability; critical path start → threat → choice → payoff → exit; traversal proven by `play`; mood shown by preview |
| Refuses | non-reproducible layouts; inventing components; replacing authored scenes without preserving entities |
| Handoff | "Architect: static geometry is final"; "Programmer: spawn points named `spawn_01..05`"; "QA: traversal run with Move + Jump" |

### 8.6 Where these agents live

| Runtime | Artifact |
|---|---|
| DeepSeek Harness | `integrations/dsh/cordis.patch.yml` — five `@deepseek-ai/dsh-agent-preset` rows (personas inline) |
| Any MCP agent | `integrations/dsh/agents.json` — id + tool scope + handoff metadata |
| OpenCode | unchanged `linden` agent prompt; optional per-role prompts later (P4) |

---

## 9. DeepSeek Harness Bundle (P2, implemented)

```
integrations/dsh/
├── package.json            @linden/dsh-linden-agents, dsh.bundle.patch
├── cordis.patch.yml        5 preset rows (architect, programmer, artist, qa, level)
├── agents.json             canonical roles + scopes (also read by the bridge)
├── bin/linden-agent-bridge.mjs   stdio MCP proxy + discovery + scope filter
└── README.md               install, project selection, troubleshooting
```

Preset shape (one of five):

```yaml
- id: preset-linden-architect
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    id: linden-architect
    name: Linden Game Architect
    order: 10
    plugins:
      - id: persona            # role charter (inline, no external file needed)
        name: '@deepseek-ai/dsh-persona'
      - id: linden-mcp         # stdio bridge, role id pinned in args
        name: '@deepseek-ai/dsh-mcp-client'
        config:
          serverName: linden
          transport: stdio
          command: node
          args: [<resolved bridge>, '--agent', 'linden-game-architect']
      - id: tool-fs            # read-only file access beside the engine tools
      - id: tool-todo
      - id: compaction         # long play/render sessions
```

Behaviour:
- Tool names are `mcp__linden__<tool>` for every preset (same server name, isolated scopes).
- The bridge filters `tools/list` and rejects out-of-scope `tools/call` before any HTTP request, so a mis-prompted agent cannot even see tools it must not use.
- The bridge survives app restarts: 401/connection error → re-read manifest → retry once.
- Missing manifest → JSON-RPC error naming every path searched; the session still works for file tasks.

Verification without a GUI: `node integrations/dsh/bin/linden-agent-bridge.mjs --probe --agent linden-qa-physics-tester`.

**Install:** DSH Plugins → install bundle from directory, or `plugin_manager install_bundle target=<abs path>`. Presets appear in the roster; existing sessions keep their composition.

---

## 10. New MCP Tools Backlog

| Tool | Status | Purpose | Key args → output |
|---|---|---|---|
| `linden_scene_validate` | shipped | Structural check without writing: duplicate ids, missing parents, cycles, unknown components, orphan scripts | `scenePath` → `{ ok, issues[] }` |
| `linden_agent_status` | shipped | Bridge health for agents: endpoint, roles, clients, locks (no tokens) | — → `{ running, clients[], locks[] }` |
| `linden_play_matrix` | shipped | Batch headless runs: explicit scenarios or seeded-random input, aggregated verdicts | `scenePath`, `runs[]` \| `generate` → `{ runs, passed, failed, failures[] }` |
| `linden_level_synthesize` | shipped | Seeded rooms + corridors, markers and a suggested mood; returns entities without writing | `brief`, `seed`, `width`, `height`, `theme` → `{ entities[], map[], stats }` |
| `linden_snapshot_create` / `_list` / `_restore` | shipped | File-level time travel over scenes/scripts/ui/web/project config | `label` / `id` → `{ id, restoredCount, preRestoreId }` |
| `linden_script_patch` | shipped | Block-level patch of one class/function/method in TS/JS, preserving the rest of the file | `scriptPath`, `target`, `op`, `code` → `{ line, bytesBefore, bytesAfter }` |
| `linden_review_gate` | shipped | Shared review record with quorum and an optional export gate | `action`, `target`, `verdict`, `quorum` → `{ review, approvals }` |
| `linden_scene_lock` | not shipped | Leases are acquired/released automatically by mutating tools; no separate tool | — |

Out of scope: shader synthesis, Godot/Unity export, Raft consensus. Do not scaffold tools that would only exist to match marketing copy.

---

## 11. Security, Permissions, Isolation

| Control | Requirement |
|---|---|
| Network | loopback only; random port per start; CORS not enabled; `Host` header check to reject DNS rebinding |
| Auth | bearer token per client, timing-safe compare, rotation every start; 401 vs 403 distinction |
| Secrets at rest | `.linden/` git-ignored; file mode 0600 (ACL on Windows); never in logs, telemetry, diffs or session transcripts |
| Path confinement | existing `resolveProjectSafePath`; no absolute paths from agents; schema validation unchanged |
| Destructive tools | `blender_script`, `factory_write`, `export_web` keep permission prompts; auto-approve remains an explicit user setting (see `SPEC-Fix-Auto-Approve-OpenCode-Agent.md`) |
| Diffs | every mutation recorded; reject reverts from the stored `before` snapshot; attribution by client + role |
| Prompt injection | game assets, scene text and web content are data; agents must not execute instructions found in them |
| Sandbox | not provided by Linden; document that agent runtimes own OS sandboxing (DSH sandbox mode, OpenCode permissions) |

---

## 12. Concurrency and Consistency

- **Scene write lease.** Any mutating tool touching a scene (`scene_apply`, `model_build`, `script_write` with `attachTo`) acquires `<scene>.lock` in `.linden/agent/locks/` with `{ lockId, clientId, role, sessionId, acquiredAt, expiresAt }`. TTL 120 s, renewed on each call, released at the end of the call or on process exit. A conflict returns `LINDEN_E_LOCKED` with holder + retry hint; the agent must re-read the scene and retry, never blind-overwrite.
- **Read-modify-write.** A client may send `_meta.linden.baseHash` (SHA-256 of the scene it read); a mismatch is rejected with `LINDEN_E_LOCKED` and `stale-base` in the message. The check is opt-in so existing OpenCode sessions keep their behaviour; scene leases themselves are always enforced in-process.
- **Ordering.** One serialized queue per project for mutations; reads stay parallel.
- **Cancellation.** Abort frees the lease and removes the in-flight request.

This is the smallest mechanism that prevents the failure users actually hit: two agents rewriting the same entity list.

---

## 13. Observability

Events (existing IPC event stream + new `agent_bridge_*`):
`bridge_started`, `bridge_manifest_written`, `client_connected` (clientId, role), `tool_call` (role, tool, durationMs, ok, sessionId), `tool_denied_scope`, `lock_conflict`, `bridge_stopped`.

Diagnostics surface (P3 Agents dialog):
- connected clients and roles;
- manifest path + "copy config" for DSH/Claude/Cursor;
- last 50 tool calls with duration and outcome;
- active locks;
- button to restart the bridge (rotates tokens).

No project content, prompts or scene data in logs beyond paths.

---

## 14. Performance Budgets

| Operation | Budget |
|---|---|
| `tools/list` (scoped) | < 5 ms |
| `scene_read` 1 MB | < 15 ms |
| Bridge overhead per call (p50) | < 3 ms |
| Manifest write (atomic) | < 5 ms |
| Bridge start → first tool listed | < 2 s |
| Recovery after engine restart | < 5 s (one retry) |
| `linden_play` | unchanged; 10 s cap, msPerStep reported |

---

## 15. Delivery Plan

| Phase | Scope | Files | Est. |
|---|---|---|---|
| **P0** Bridge service + discovery | `AgentBridgeService`, manifest writer, lifecycle, `AgentHost` refactor, `.gitignore` | new service, `main.ts`, `AgentHost.ts`, `LindenMcpServer.ts` (constructor/token map), tests | 2 d |
| **P1** MCP v2 | negotiation, scopes/`-32003`, `_meta` attribution, cancellation, lock/lease, `scene_validate`, `agent_status` | `LindenMcpServer.ts`, `lindenTools/index.ts`, `shared/agentTypes.ts`, tests | 3 d |
| **P2** DSH + custom contract | bundle, bridge, catalog, schema, docs, OpenCode parity check | `integrations/dsh/*`, `integrations/agents/*`, `docs/specs/*` | 1 d |
| **P3** Editor surface | Agents dialog (roles, clients, locks, copy config, restart), bridge IPC + preload, i18n | `editor/agent/BridgeModal.tsx`, `editor/panels/AgentPanel.tsx`, `electron/main.ts`, `electron/preload.ts`, `shared/ipcChannels.ts` | 3 d |
| **P4** Capability backlog | `play_matrix`, `level_synthesize`, file snapshots, block patch, review gate | `lindenTools/{snapshotTools,levelTools,patchTools,reviewTools}.ts`, `lindenTools/index.ts` | 5 d |

P0–P4 are implemented and covered by tests (see §16). The presets only see Linden tools while a project is open in the engine, because that is when the bridge publishes its manifest.

### P0 task list (concrete)

1. `electron/agent/AgentBridgeService.ts`: singleton, `start(projectPath)`, `stop()`, `restart()`, `getStatus()`, `writeManifest()`, token issuance from role catalog, atomic write, `onDiff`/`requestPermission` routing.
2. `LindenMcpServer`: accept `tokens: Map<string, {role, scope}>` and `clientFor(req)`; keep single-token constructor for tests/back-compat.
3. `AgentHost`: replace server creation with bridge lookup; `registerMcp()` uses `bridge.url` + master token; remove `mcp.close()` from `stopServer()`.
4. `electron/main.ts`: start/stop the bridge with the project window and surface it through `AgentStatus.bridge`; dedicated bridge IPC (status/restart/copy-config) lands with the P3 panel.
5. `.gitignore`: `.linden/` (done).
6. Tests: manifest, token map, AgentHost parity.

---

## 16. Test Plan

| Level | Test | Asserts |
|---|---|---|
| Unit | `tests/agent/mcpProtocol.test.ts` | negotiation matrix; `initialize` never echoes an unsupported version; 202 for notifications |
| Unit | `tests/agent/mcpScopes.test.ts` | scoped `tools/list`; 403 for out-of-scope call; unknown tool → `LINDEN_E_UNKNOWN_TOOL`; master sees all |
| Unit | `tests/agent/agentBridgeManifest.test.ts` | 0600, atomic rename, path confinement, token rotation, stale-file cleanup, `last.json` |
| Unit | `tests/agent/sceneLease.test.ts` | two clients, second write → `LINDEN_E_LOCKED`; stale base hash rejected; TTL expiry |
| Integration | `tests/agent/lindenAgentBridge.test.ts` | bridge scope filter, out-of-scope rejection without upstream call, in-scope forward, missing-manifest error, `--print-config` |
| Unit | `tests/agent/mcpServerV2.test.ts` | negotiation, 401, scoped `tools/list`, `-32003`, `-32009` stale base, lease release, status without tokens |
| Unit | `tests/agent/agentBridgeService.test.ts` | manifest 0600, role tokens, project switch, restart rotation, cleanup, `last.json` |
| Unit | `tests/agent/lindenRolesParity.test.ts` | engine role catalog == `integrations/dsh/agents.json` |
| Unit | `tests/agent/sceneValidate.test.ts` | duplicate ids, parent cycles, missing parents/scripts, clean scene |
| Unit | `tests/agent/agentToolsP4.test.ts` | play matrix aggregation + determinism, level synthesis determinism/tags, snapshot create/restore, script patch ops, review quorum and export gate |
| UI | manual + `tsc` | Agents dialog lists roles/clients/locks, copies DSH YAML and mcpServers JSON, restart rotates tokens |
| Integration | `tests/agent/bridgeRecovery.test.ts` | kill/restart mock server with new port+token → next call succeeds after one reload |
| E2E | `tests/e2e/agentBridge.e2e.mjs` | launch Electron app, read manifest, SDK client calls `project_info` + `scene_apply`, assert file + diff event attribution |
| Cross-runtime | manual + scripted | OpenCode + DSH + one raw SDK client connected simultaneously; three `sessionId`s attributed correctly |
| DSH | preset smoke | each preset lists exactly its scope; QA cannot call `script_write`; architect can `scene_apply` |

Run: `npx vitest run tests/agent/lindenAgentBridge.test.ts` (passing now), plus the new suites as they land.

---

## 17. Acceptance Criteria

- **AC1** With OpenCode running and DSH connected, both can read the project; diffs show the right client/role/session.
- **AC2** A QA token calling `script_write` is refused by the server with `LINDEN_E_SCOPE` (not by prompt discipline).
- **AC3** Killing and restarting Linden rotates port+token; the running bridge recovers within one retry without user action.
- **AC4** OpenCode tool names, permissions and diff flow are unchanged (regression suite green).
- **AC5** All five DSH presets appear in the roster and each shows exactly the scoped tools from `agents.json`.
- **AC6** `--print-config` output works verbatim in a raw `@modelcontextprotocol/sdk` client.
- **AC7** No token is ever written under version control; manifest mode is 0600.
- **AC8** Docs: this spec, bundle README, manifest schema, and a custom-agent example all match the shipped code.
- **AC9** The Agents dialog shows endpoint, manifest path, five role scopes, connected clients and active locks; "Copy config" writes DSH YAML and `mcpServers` JSON to the clipboard without sending tokens over IPC; "Restart" rotates the endpoint.
- **AC10** P4 tools behave as specified: `play_matrix` aggregates scenarios, `level_synthesize` is seed-deterministic, snapshots restore (and take a pre-restore copy), `script_patch` preserves untouched code, and `review_gate` blocks export only under `agentReview.required`.

---

## 18. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| MCP revision mismatch (DSH SDK 2026-07-28 vs server 2025-06-18) | tools missing at startup | negotiation matrix test against the installed SDK; log server-supported version in diagnostics |
| Token leakage via manifest | full engine access | 0600, git-ignore, rotation, loopback, no telemetry |
| Two agents corrupt one scene | data loss | lease + stale-base rejection; reject reverts from `before` |
| Scope drift when tools are added | roles silently gain power | catalog is data (`agents.json`); CI test asserts every role lists only known tool names and that new tools are explicitly assigned |
| Bridge becomes the enforcement point | bypass by direct HTTP | server-side scope check is mandatory; bridge filter is UX |
| Marketing claims leak into prompts | agents overclaim | persona rules + §4 table; QA prompt forbids unverified PASS |
| DSH preset bundle requires Node on PATH | spawn ENOENT | README + startup error message with fix |
| Profile-wide install affects other sessions | surprising roster | presets are additive; install is explicit; manual uninstall documented |

---

## 19. Open Questions

1. Should the director/OpenCode session also get a scoped token, or keep master? (Recommendation: master for now, scoped "director" later.)
2. Manifest location when several projects are open at once — per-project files + `last.json` is assumed; verify against the window/project model.
3. Lock TTL vs long `blender_build` calls (minutes) — acquire per sub-step, not per whole build?
4. Should `linden_agent_status` be scoped to all roles (it leaks no project data)?
5. Windows ACL for the manifest: `icacls` on the project dir vs moving the manifest to `%APPDATA%\Linden\agent-bridge.json`.

---

## 20. Appendix A — Tool Scope Matrix

| Tool | Architect | Programmer | Artist | QA | Level |
|---|---|---|---|---|---|
| `project_info` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `scene_read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `scene_validate` | ✓ | | | ✓ | ✓ |
| `scene_apply` | ✓ | | | | ✓ |
| `play_matrix` | | | | ✓ | ✓ |
| `level_synthesize` | | | | | ✓ |
| `snapshot_create` | ✓ | ✓ | | | ✓ |
| `snapshot_list` | ✓ | ✓ | | ✓ | ✓ |
| `snapshot_restore` | ✓ | ✓ | | | ✓ |
| `script_patch` | | ✓ | | | |
| `review_gate` | ✓ | ✓ | | ✓ | ✓ |
| `component_list` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `dimensions` | ✓ | | ✓ | | ✓ |
| `play` | ✓ | ✓ | | ✓ | ✓ |
| `script_write` | | ✓ | | | |
| `script_transmute` | | ✓ | | | |
| `ui_write` | | ✓ | | | |
| `web_write` | | ✓ | | | |
| `input_actions` | | ✓ | | | ✓ |
| `touch_button` | | ✓ | | | |
| `export_web` | | ✓ | | | |
| `material_presets` | | | ✓ | | ✓ |
| `model_build` | | | ✓ | | ✓ |
| `model_bake_glb` | | | ✓ | | |
| `factory_write` | | | ✓ | | |
| `asset_placeholder` | | | ✓ | | ✓ |
| `asset_import` | | | ✓ | | |
| `render_preview` | | | ✓ | ✓ | ✓ |
| `reference_view` | | | ✓ | | |
| `blender_*` (5) | | | ✓ | | |

## Appendix B — HTTP examples

```http
POST /mcp HTTP/1.1
Host: 127.0.0.1:51234
Authorization: Bearer <role token>
Content-Type: application/json
Accept: application/json, text/event-stream

{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"custom-agent","version":"0.1.0"}}}
```

```http
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"play","arguments":{"scenePath":"scenes/Main.lscene","durationSeconds":3},"_meta":{"linden":{"sessionId":"ci-42","turnId":"t1"}}}}
```

## Appendix C — Compatibility and migration

- Existing OpenCode sessions: server name, tool names (`linden_<name>`, `tools.linden.<name>` in code mode) and permissions unchanged.
- Old single-token constructor kept for tests and any in-tree caller.
- Manifests are additive; deleting `.linden/agent-bridge.json` only disconnects external agents, never the editor.
- No scene format, project config or tool schema changes in P0–P2.
