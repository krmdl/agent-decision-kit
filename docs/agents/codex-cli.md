# Use Agent Decision Kit with Codex CLI

Codex CLI reads MCP configuration from `~/.codex/config.toml`. Add the source checkout as a stdio server:

```sh
codex mcp add agent-decision-kit -- node /absolute/path/to/agent-decision-kit/dist/cli.js mcp
codex mcp list
```

Equivalent TOML:

```toml
[mcp_servers.agent-decision-kit]
command = "node"
args = ["/absolute/path/to/agent-decision-kit/dist/cli.js", "mcp"]
```

The server supports typed decisions, browser inspection and approval, local context pruning, and code-review prechecks. A Codex project can scope MCP settings in `.codex/config.toml` when that project is trusted.

**Try it:** “Use `code_navigate` to find the browser action manager, then use `diff_risk_review` on the current staged diff. Tell me that this is a pre-review, not a security audit.”

OpenAI's [Codex MCP docs](https://developers.openai.com/codex/mcp) list `codex mcp add NAME -- COMMAND` and the `[mcp_servers.NAME]` table.
