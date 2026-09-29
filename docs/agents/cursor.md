# Use Agent Decision Kit with Cursor

Cursor reads local MCP servers from `.cursor/mcp.json` for a project or `~/.cursor/mcp.json` globally. Put the source checkout path in the project file:

```json
{
  "mcpServers": {
    "agent-decision-kit": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/agent-decision-kit/dist/cli.js", "mcp"]
    }
  }
}
```

Restart Cursor or refresh the MCP list. Select the tools needed for the current task in the Agent tools picker. Cursor asks before using MCP tools by default; keep approval prompts enabled for `browser_confirm`.

**Try it:** “Use `browser_inspect` on the local demo. Fill the draft with a short sentence, but do not submit or delete anything.” `browser_fill` reports the character count and does not return the entered text.

See Cursor's [MCP documentation](https://cursor.com/docs/mcp) for project/global paths, `mcpServers` configuration, tool selection, and approval behavior.
