# Use Agent Decision Kit with Cline

For Cline CLI, edit `~/.cline/mcp.json`; for the VS Code extension, open **MCP Servers → Configure MCP Servers** from the Cline panel. Add:

```json
{
  "mcpServers": {
    "agent-decision-kit": {
      "command": "node",
      "args": ["/absolute/path/to/agent-decision-kit/dist/cli.js", "mcp"],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

Keep `autoApprove` empty. Cline should ask before a tool call; inspect the arguments for `browser_confirm` before approving a sensitive browser action.

**Try it:** “Use `context_prune` on the sample error log and preserve the exact file path and error text. Show me the retained text unchanged.”

The [Cline MCP guide](https://docs.cline.bot/mcp/mcp-overview) documents the CLI path, extension settings editor, and local stdio `command`/`args` format.
