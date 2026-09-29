# Use Agent Decision Kit with Claude Code

Claude Code can start a local MCP server over stdio. This checkout is not published to npm yet, so point the server at the built JavaScript file.

```sh
claude mcp add --transport stdio agent-decision-kit -- node /absolute/path/to/agent-decision-kit/dist/cli.js mcp
claude mcp list
```

Claude Code writes a user-scoped entry. For a team-shared project configuration, use the `.mcp.json` file and review the server before accepting its project approval prompt:

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

Use a `/`-separated absolute path in JSON on Windows. The CLI's `config claude-code` command prints the current snippet shape.

**Try it:** “Use `browser_launch` with the local demo URL, call `browser_inspect`, then mark the sample setup task complete. Stop and show me any action that needs approval.” Call `/mcp` to review the connection and tool status.

Claude Code's current [MCP guide](https://code.claude.com/docs/en/mcp) documents the `claude mcp add --transport stdio NAME -- COMMAND` form and `.mcp.json` configuration. Project MCP servers may require a workspace trust/approval step.

For an optional local route suggestion on submitted prompts, see the [Claude Code hook integration](../../integrations/claude-code-hooks/README.md). It is disabled by default and never switches the active model.
