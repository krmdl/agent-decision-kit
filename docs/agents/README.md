# Agent setup guides

These guides cover MCP stdio configuration for nine common coding-agent surfaces: Claude Code, Codex CLI, Cursor, Gemini CLI, Windsurf Cascade, VS Code/Copilot Chat, GitHub Copilot CLI, Cline, and OpenCode. CI launches the server through its real stdio transport with the reference MCP SDK. In a local Windows check, Claude Code 2.1.218 reported a connected isolated server; Codex CLI 0.154.0 loaded an isolated config entry as enabled, without an agent-turn/tool-call test. The other vendor executables have not been runtime-tested in this environment.

## Compatibility status

| Client | Server config guide | Current project evidence |
| --- | --- | --- |
| Claude Code | [Guide](claude-code.md) | Isolated CLI health check reported `Connected`; SDK stdio subprocess smoke test |
| Codex CLI | [Guide](codex-cli.md) | Isolated CLI config listed as `enabled`; SDK stdio subprocess smoke test, no Codex tool-call round trip |
| Cursor | [Guide](cursor.md) | Required `type: "stdio"` field and JSON shape checked against Cursor docs; SDK stdio subprocess smoke test |
| Gemini CLI | [Guide](gemini-cli.md) | `mcpServers` shape checked against Google docs; SDK stdio subprocess smoke test |
| Windsurf Cascade | [Guide](windsurf.md) | JSON shape checked against the legacy Cascade docs; SDK stdio subprocess smoke test |
| VS Code / Copilot Chat | [Guide](vscode.md) | `servers` shape checked against VS Code docs; SDK stdio subprocess smoke test |
| GitHub Copilot CLI | [Guide](copilot-cli.md) | `mcpServers` shape checked against GitHub docs; SDK stdio subprocess smoke test |
| Cline | [Guide](cline.md) | CLI path checked against Cline's source resolver; CLI/IDE management workflow linked to first-party docs; SDK stdio subprocess smoke test |
| OpenCode | [Guide](opencode.md) | Local command array checked against OpenCode docs; SDK stdio subprocess smoke test |

Every guide uses a local source checkout because the npm package has not been published. Build once, then use the absolute path to `dist/cli.js`. The `agents:verify` check validates the CLI's nine config aliases and parses each guide's JSON or TOML example. This checks the examples' syntax and command shape; it does not test vendor-specific settings or install the agents. If the project later publishes a package, the equivalent command is `npx -y agent-decision-kit mcp`.

## Common source setup

```sh
git clone https://github.com/krmdl/agent-decision-kit.git
cd agent-decision-kit
npm install
npm run build
npm run browser:install
```

Replace `/absolute/path/to/agent-decision-kit` in the examples below with the checkout's actual absolute path. On Windows use an escaped absolute path such as `C:\\Users\\you\\src\\agent-decision-kit\\dist\\cli.js`.

## Smoke test

After adding the config, use the client’s MCP list/status command and ask it to call `model_route` on a simple prompt. For browser actions, start with `examples/browser-demo.html` on localhost. Agent-specific commands and prompts are described in each guide.

To attach to a tab in a separate Chrome profile, see the [local Chrome tab connection guide](../browser-chrome.md). It covers the loopback-only CDP endpoint and the required list-then-select calls.
