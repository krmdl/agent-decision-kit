# Use Agent Decision Kit with Cline

For the Cline CLI, add the server with its MCP wizard. The command below passes the local source checkout's built CLI to Cline:

```sh
cline mcp install agent-decision-kit -- node /absolute/path/to/agent-decision-kit/dist/cli.js mcp
cline mcp
cline config mcp --json
```

The CLI's default settings file is `~/.cline/data/settings/cline_mcp_settings.json`. `CLINE_DATA_DIR` or `CLINE_DIR` can change the data directory, and `CLINE_MCP_SETTINGS_PATH` can override the file path. Prefer the CLI command above so Cline resolves the active location for you.

For the Cline IDE extension, open **MCP Servers → Configure MCP Servers** from the Cline panel and add this entry to the JSON file the editor opens:

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

See Cline's [CLI MCP setup reference](https://github.com/cline/cline/blob/main/apps/cli/README.md#mcp-servers) for the management commands and its [MCP settings path resolver](https://github.com/cline/cline/blob/main/sdk/packages/shared/src/storage/paths.ts#L2797) for the current default and overrides. The IDE's configure action opens the active settings file, avoiding assumptions about extension storage paths.
