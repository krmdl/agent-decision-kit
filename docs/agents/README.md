# Agent setup guides

These guides cover MCP stdio configuration for nine common coding-agent surfaces: Claude Code, Codex CLI, Cursor, Gemini CLI, Windsurf Cascade, VS Code/Copilot Chat, GitHub Copilot CLI, Cline, and OpenCode. CI launches the server through its real stdio transport with the reference MCP SDK. On this Windows machine, Claude Code 2.1.218 connected to a temporary user-scoped server entry; the entry was removed after the handshake check. VS Code 1.135.0 accepted the server definition through `--add-mcp` and wrote it to an isolated profile. These checks verify client registration/startup, not an agent model turn. GitHub Copilot Chat is not installed here, so the VS Code result does not verify Copilot tool invocation. Codex CLI 0.154.0 previously loaded an isolated entry as enabled, but no Codex tool round trip was run. Cursor 2.2.20 is installed; its client-side tool invocation has not been tested. Gemini CLI, Windsurf Cascade, GitHub Copilot CLI, Cline, and OpenCode are not installed in this environment.

## Compatibility status

| Client | Server config guide | Current project evidence |
| --- | --- | --- |
| Claude Code | [Guide](claude-code.md) | Claude Code 2.1.218 reported the temporary stdio server `connected`; entry removed after the check; no model-backed turn |
| Codex CLI | [Guide](codex-cli.md) | Isolated CLI config listed as `enabled`; SDK stdio subprocess smoke test, no Codex tool-call round trip |
| Cursor | [Guide](cursor.md) | Cursor 2.2.20 installed; client-side tool invocation not tested; config shape checked by `agents:verify` |
| Gemini CLI | [Guide](gemini-cli.md) | `mcpServers` shape checked against Google docs; SDK stdio subprocess smoke test |
| Windsurf Cascade | [Guide](windsurf.md) | JSON shape checked against the legacy Cascade docs; SDK stdio subprocess smoke test |
| VS Code / Copilot Chat | [Guide](vscode.md) | VS Code 1.135.0 `--add-mcp` wrote a valid definition in an isolated profile; Copilot Chat is not installed, so no agent tool call was tested |
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

After adding the config, use the client’s MCP list/status command and ask it to call `model_route` on a simple prompt. For a latency-sensitive session, call `provider_warmup` once before ambiguous semantic decisions; its first call may download model weights and its timing is not a performance guarantee. For browser actions, start with `examples/browser-demo.html` on localhost. Agent-specific commands and prompts are described in each guide.

To attach to a tab in a separate Chrome profile, see the [local Chrome tab connection guide](../browser-chrome.md). It covers the loopback-only CDP endpoint and the required list-then-select calls.
