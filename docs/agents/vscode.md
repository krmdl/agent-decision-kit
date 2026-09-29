# Use Agent Decision Kit with VS Code and Copilot Chat

Add `.vscode/mcp.json` at the workspace root:

```json
{
  "servers": {
    "agent-decision-kit": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/agent-decision-kit/dist/cli.js", "mcp"]
    }
  }
}
```

Open the MCP configuration and use its start action, or run **MCP: List Servers** from the Command Palette. In Copilot Chat, use Agent mode and enable Agent Decision Kit in the tools list. Do not turn on unrestricted auto-approval for browser tools.

**Try it:** “Use `browser_inspect` to list the local page actions, then call `browser_action` only for the sample setup completion button. Explain any approval token before confirming.”

VS Code's [MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration) uses a top-level `servers` key in `.vscode/mcp.json` and distinguishes that format from portable `.mcp.json`.
