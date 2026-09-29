# Use Agent Decision Kit with Windsurf Cascade

For the legacy Cascade agent, add this stdio server to Windsurf's `mcp_config.json` (open Cascade’s MCP settings from the panel menu):

```json
{
  "mcpServers": {
    "agent-decision-kit": {
      "command": "node",
      "args": ["/absolute/path/to/agent-decision-kit/dist/cli.js", "mcp"]
    }
  }
}
```

The commonly documented user config path is `~/.codeium/windsurf/mcp_config.json`; use the app's MCP settings action to locate the active file for your installation. Refresh the MCP list after editing.

**Try it:** “Use `code_navigate` to find the local demo and inspect its accessible controls. Only click a low-risk action and report the page delta.”

Windsurf's Cascade page currently redirects to [Devin's legacy Cascade MCP guide](https://docs.devin.ai/desktop/cascade/mcp), which describes this config file. Devin's newer default agent is a different client; re-check its MCP setup if you use that agent instead.
