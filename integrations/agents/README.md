# Custom agent integration

This folder holds the runtime-neutral half of the Linden Engine agent contract:

| File | Purpose |
|---|---|
| `agent-bridge.schema.json` | JSON Schema for `<project>/.linden/agent-bridge.json`, the manifest Linden writes on every start |
| `../dsh/agents.json` | The five role definitions (id, tool scope, handoff) — portable to any runtime |

Read the manifest, take the token for your role, connect to `endpoint` over
Streamable HTTP, and call the tools listed in the role's `tools`. Full detail:
[`docs/specs/SPEC-DSH-MCP-Agent-Integration.md`](../../docs/specs/SPEC-DSH-MCP-Agent-Integration.md).

Quick check with the bundled bridge (works for any MCP client):

```bash
node ../dsh/bin/linden-agent-bridge.mjs --print-config --agent linden-qa-physics-tester --project /path/to/game
```

Output includes a ready `mcpServers` JSON block and the same config as DSH YAML.

Rules:

1. Re-read the manifest after any `401` or connection error — the port and tokens
   rotate per engine start.
2. Never write `.lscene`, `project.linden.json` or `scripts/*` directly; use the
   tools so validation, path confinement and diffs still apply.
3. Pass `_meta.linden.sessionId` (and `turnId` when you have one) so the editor
   attributes changes to your agent.
4. `result.isError === true` is a failure; parse the JSON text for `code`.
5. Ask the user for the project path, never for a token.
