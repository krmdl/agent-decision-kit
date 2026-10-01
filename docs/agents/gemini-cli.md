# Use Agent Decision Kit with Gemini CLI

Gemini CLI supports stdio MCP servers through its `mcpServers` configuration. The `gemini mcp add` command writes the entry for you:

```sh
gemini mcp add --scope user agent-decision-kit node /absolute/path/to/agent-decision-kit/dist/cli.js mcp
gemini mcp list
```

Or add the following under `mcpServers` in `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "agent-decision-kit": {
      "command": "node",
      "args": ["/absolute/path/to/agent-decision-kit/dist/cli.js", "mcp"],
      "trust": false
    }
  }
}
```

Leave `trust` false so the client does not suppress its normal tool confirmations. Restart Gemini CLI or use its `/mcp` command to inspect available tools.

Gemini CLI does not connect MCP servers while the current workspace is untrusted. Trust a checkout you control through Gemini CLI's normal workspace trust flow; the smoke test used a temporary `GEMINI_CLI_HOME` and enabled workspace trust only for that process, without changing personal settings.

**Try it:** “Classify these two sample task lines with `classify_text`, show the calibration label, and do not treat the scores as calibrated.”

Google's [Gemini CLI MCP guide](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md) documents the `mcpServers` settings and `gemini mcp add` workflow.
