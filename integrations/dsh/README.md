# Linden Engine agents for DeepSeek Harness

A DeepSeek Harness bundle that adds the five Linden Engine specialist agents as
Agent presets, wired to the engine through the `linden` MCP server — the same
server OpenCode uses, reached through a stdio bridge instead of a per-app config.

| Preset (roster) | Agent id (`agents.json`) | Engine tools in scope | Writes |
| --- | --- | --- | --- |
| Linden Game Architect | `linden-game-architect` | 11 | scenes, snapshots |
| Linden Gameplay Programmer | `linden-gameplay-programmer` | 16 | scripts, UI, input, snapshots |
| Linden Technical Artist | `linden-technical-artist` | 17 | assets, models |
| Linden QA & Physics Tester | `linden-qa-physics-tester` | 9 | nothing (read-only) |
| Linden Level & Biome Synthesizer | `linden-level-biome-synthesizer` | 18 | scenes, snapshots |

Each preset mounts its own `@deepseek-ai/dsh-mcp-client` row that spawns
`bin/linden-agent-bridge.mjs` with `--agent <id>`. The bridge:

1. finds the live endpoint in `<project>/.linden/agent-bridge.json`
   (fallback: `$LINDEN_MCP_ENDPOINT`, the current directory, `~/.linden/agent-bridge/last.json`);
2. forwards MCP JSON-RPC to the loopback Streamable-HTTP server with the role token;
3. re-reads the manifest and retries once when the app restarted and rotated the
   port/token;
4. hides every tool outside the role's scope in `tools/list` and refuses
   `tools/call` for them — least privilege that survives the engine exposing more
   tools later.

Roles now include the P4 capabilities: `play_matrix` (QA, Level), `level_synthesize`
(Level), `snapshot_create/list/restore` (Architect, Programmer, Level — QA lists
only), `script_patch` (Programmer) and `review_gate` (Architect, Programmer, QA,
Level). The editor's agent panel has an **Agents** button with the same roles,
connected clients, active scene locks and a "copy MCP config" action.

## Prerequisites

- **A Linden Engine build with the Agent Bridge** (`electron/agent/AgentBridgeService.ts`,
  P0 of [`docs/specs/SPEC-DSH-MCP-Agent-Integration.md`](../../docs/specs/SPEC-DSH-MCP-Agent-Integration.md)).
  The engine publishes `<project>/.linden/agent-bridge.json` (endpoint, per-role
  tokens, scopes) whenever a project is open. Without an open project there is no
  manifest: the bridge fails with an actionable message and the presets list no
  Linden tools (the session still works for file work).
- **Node.js ≥ 20 on `PATH`** — the bridge is spawned with `command: node`.
- **DeepSeek Harness** with the bundle installed (below).

## Install

From the DeepSeek Harness Web **Plugins** page, install a bundle from a local
directory and pick this folder, or from a session with Full access:

```
plugin_manager action=install_bundle target=/absolute/path/to/LindenEngine/integrations/dsh
```

Then start a new session and pick one of the five presets in the agent roster.
Existing sessions keep the preset composition they started with.

Manual smoke test without the GUI:

```bash
node integrations/dsh/bin/linden-agent-bridge.mjs --probe --agent linden-game-architect
node integrations/dsh/bin/linden-agent-bridge.mjs --print-config --agent linden-technical-artist
```

`--probe` prints the endpoint, protocol version, server info and the filtered tool
list. `--print-config` prints HTTP, stdio, DSH YAML and `mcpServers` JSON configs —
the last two are directly usable by a custom agent.

## Choosing the project

The bridge reads `.linden/agent-bridge.json` from, in order:

1. `--project <dir>` (set in a preset only if you edit it);
2. `$LINDEN_PROJECT`;
3. the process working directory (normally the DSH workspace = the game project);
4. `$PWD` again, then `~/.linden/agent-bridge/last.json`.

Run DeepSeek Harness with the game project as the workspace, or export
`LINDEN_PROJECT=/path/to/game` before starting it.

## Custom agents

Any MCP-capable runtime can use the same contract without this bundle:

```json
{
  "mcpServers": {
    "linden-qa": {
      "command": "node",
      "args": [
        "/path/to/LindenEngine/integrations/dsh/bin/linden-agent-bridge.mjs",
        "--agent", "linden-qa-physics-tester",
        "--project", "/path/to/game"
      ]
    }
  }
}
```

Or connect to the HTTP endpoint directly and send
`Authorization: Bearer <token>` from the manifest (no scope filtering then — the
token's own scope applies). The role catalogue in `agents.json` is the portable
part: copy `id` + `tools` into your own agent runtime when you do not want the
bridge.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Session lists no `mcp__linden__*` tools | Engine bridge not running or manifest not written. Run `--probe` and read stderr; the message lists every path searched. |
| `Linden Engine MCP endpoint tidak ditemukan` | Same as above; or the workspace is not the game project — set `LINDEN_PROJECT`. |
| `401` after restarting the engine | The bridge reloads and retries once; if it persists, the engine rewrote the manifest with a new token and the old file is stale — restart the DSH session so the endpoint reloads. |
| Tool call refused with `tidak ada dalam scope` | Correct behaviour: that role must ask the owning agent (or the human) to do it. |
| `spawn node ENOENT` | Node.js is not on `PATH` for the DSH host process. |
| Preset activation: cannot resolve `@linden/dsh-linden-agents/bridge` | The bundle was symlinked instead of installed, or the profile module tree is stale. Reinstall from the directory; or edit the preset's `args` to the absolute path of `bin/linden-agent-bridge.mjs`. |

## Security

- The manifest contains bearer tokens: keep `.linden/` out of version control
  (the engine repo adds it to `.gitignore` in P0) and never paste it into a prompt.
- Endpoint is loopback-only, one random port per app start, token rotated on every
  start.
- The bridge is a scope filter, not a sandbox. The engine remains the authority:
  it validates scene entities, confines paths to the project, gates Blender script
  execution behind a permission prompt, and records every write as a diff.

## Files

```
integrations/dsh/
├── package.json           # DSH bundle manifest (dsh.bundle.patch)
├── cordis.patch.yml       # five @deepseek-ai/dsh-agent-preset declarations
├── agents.json            # canonical roles + tool scopes (shared contract)
├── bin/linden-agent-bridge.mjs
└── README.md
```
