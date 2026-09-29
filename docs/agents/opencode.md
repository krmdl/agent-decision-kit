# Use Agent Decision Kit with OpenCode

OpenCode v2 configures stdio servers under `mcp.servers`. Add a local server to `opencode.json`:

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

OpenCode starts local servers automatically. Use `opencode mcp list` to confirm the connection. To keep a server configured but offline, the current v2 docs use `disabled: true`.

**Try it:** “Use `model_route` for ‘review an authentication change’, then run `diff_risk_review` on the patch. Explain that both results are heuristics.”

Read OpenCode's [MCP server guide](https://opencode.ai/v2/docs/mcp-servers) if your installed version uses a different config generation; v1 examples used a different layout.
