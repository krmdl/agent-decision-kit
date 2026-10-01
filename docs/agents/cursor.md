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

Restart Cursor or refresh the MCP list. Select the tools needed for the current task in the Agent tools picker. Review the MCP approval mode in Cursor settings. Cursor 3.6 and later defaults to Auto-review, which can run allowlisted tools immediately and sends other calls through its safety classifier; older versions ask before MCP tool calls. Keep any allowlist narrow. Sensitive browser actions still require this server's separate `browser_confirm` approval.

If you also use Cursor CLI, it reads the same MCP configuration as the editor. Run `agent mcp list-tools agent-decision-kit` to check that the configured server exposes its tools. On first use, the CLI may say the server has not been approved; after checking its command and arguments, run `agent mcp enable agent-decision-kit`, then list the tools again. `agent mcp list` opens an interactive server list. These commands check configuration and connectivity, not a model-backed tool call.

**Try it:** “Use `browser_inspect` on the local demo. Fill the draft with a short sentence, but do not submit or delete anything.” `browser_fill` reports the character count and does not return the entered text.

See Cursor's [MCP documentation](https://cursor.com/docs/mcp) for project/global paths, `mcpServers` configuration, tool selection, and approval behavior, and the [Cursor CLI MCP guide](https://cursor.com/docs/cli/mcp) for CLI commands.
