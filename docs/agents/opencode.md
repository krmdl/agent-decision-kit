# Use Agent Decision Kit with OpenCode

OpenCode has two MCP config layouts. `agent-decision config opencode` prints the v2 layout; OpenCode v1 uses a direct entry under `mcp`. The current `opencode-ai@1.18.34` CLI connected to a temporary server config in both layouts.

OpenCode v2 — `mcp.servers`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "agent-decision-kit": {
        "type": "local",
        "command": ["node", "/absolute/path/to/agent-decision-kit/dist/cli.js", "mcp"]
      }
    }
  }
}
```

OpenCode v1 — server name directly under `mcp`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "agent-decision-kit": {
      "type": "local",
      "command": ["node", "/absolute/path/to/agent-decision-kit/dist/cli.js", "mcp"]
    }
  }
}
```

OpenCode starts local servers automatically. Use `opencode mcp list` to confirm the connection. To keep a server configured but offline, the current v2 docs use `disabled: true`.

**Try it:** “Use `model_route` for ‘review an authentication change’, then run `diff_risk_review` on the patch. Explain that both results are heuristics.”

Read the [v1 MCP guide](https://opencode.ai/docs/mcp-servers/) or [v2 MCP guide](https://opencode.ai/v2/docs/mcp-servers) for the config generation used by your installed version.
