# Use Agent Decision Kit with GitHub Copilot CLI

GitHub Copilot CLI has a separate MCP format from `.vscode/mcp.json`. Add a local server to `~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "agent-decision-kit": {
      "type": "local",
      "command": "node",
      "args": ["/absolute/path/to/agent-decision-kit/dist/cli.js", "mcp"],
      "env": {},
      "tools": ["*"]
    }
  }
}
```

Or add it from the terminal:

```sh
copilot mcp add agent-decision-kit -- node /absolute/path/to/agent-decision-kit/dist/cli.js mcp
copilot mcp list
```

`copilot mcp list` shows saved server definitions; it does not confirm a server handshake. In the isolated CLI check for this repository, `COPILOT_HOME` pointed to a temporary directory, and the normal Copilot profile was not changed. The repository's `agents:verify` command separately starts the MCP process and calls `model_route` over stdio.

**Try it:** “Use `screen_text` to check the sample text against two labels. Show the probability and calibration source.”

GitHub's [Copilot CLI MCP guide](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers) documents the user config path and `copilot mcp add` command. The Copilot CLI does not read `.vscode/mcp.json`; use its own format above.
