# Agent setup guides

These guides cover MCP stdio configuration for nine common coding-agent surfaces: Claude Code, Codex CLI, Cursor, Gemini CLI, Windsurf Cascade, VS Code/Copilot Chat, GitHub Copilot CLI, Cline, and OpenCode. CI launches the server through its real stdio transport with the reference MCP SDK. On this Windows machine, Claude Code 2.1.218 connected to a temporary user-scoped server entry; the entry was removed after the handshake check. VS Code 1.135.0 accepted the server definition through `--add-mcp` and wrote it to an isolated profile. Codex CLI 0.154.0 accepted the server through a temporary isolated `CODEX_HOME`, and `codex mcp get` reported it as enabled; the normal Codex configuration was not changed. These checks verify client registration/startup, not an agent model turn. GitHub Copilot Chat is not installed here, so the VS Code result does not verify Copilot tool invocation. Cursor 2.2.20 is installed; its client-side tool invocation has not been tested. Gemini CLI, Windsurf Cascade, GitHub Copilot CLI, Cline, and OpenCode are not installed in this environment.

## Compatibility status

| Client | Server config guide | Current project evidence |
| --- | --- | --- |
| Claude Code | [Guide](claude-code.md) | Claude Code 2.1.218 reported the temporary stdio server `connected`; entry removed after the check; no model-backed turn |
| Codex CLI | [Guide](codex-cli.md) | Codex CLI 0.154.0 reported an isolated temporary entry as `enabled`; SDK stdio subprocess smoke test, no Codex tool-call round trip |
| Cursor | [Guide](cursor.md) | Cursor 2.2.20 installed; client-side tool invocation not tested; config shape checked by `agents:verify` |
| Gemini CLI | [Guide](gemini-cli.md) | `mcpServers` shape checked against Google docs; SDK stdio subprocess smoke test |
| Windsurf Cascade | [Guide](windsurf.md) | JSON shape checked against the legacy Cascade docs; SDK stdio subprocess smoke test |
| VS Code / Copilot Chat | [Guide](vscode.md) | VS Code 1.135.0 `--add-mcp` wrote a valid definition in an isolated profile; Copilot Chat is not installed, so no agent tool call was tested |
| GitHub Copilot CLI | [Guide](copilot-cli.md) | `mcpServers` shape checked against GitHub docs; SDK stdio subprocess smoke test |
| Cline | [Guide](cline.md) | CLI path checked against Cline's source resolver; CLI/IDE management workflow linked to first-party docs; SDK stdio subprocess smoke test |
| OpenCode | [Guide](opencode.md) | Local command array checked against OpenCode docs; SDK stdio subprocess smoke test |

Every guide uses a local source checkout. Build once, then use the absolute path to `dist/cli.js`. The `agent-decision config <name>` output now points to the built entry file in this checkout, instead of an unpublished npm package. `agents:verify` validates all nine CLI aliases, parses each guide's JSON or TOML example, launches the generated command for each alias, and calls `model_route` through MCP stdio. This verifies the configuration shape and server command end to end; it does not emulate each vendor's client parser, UI, or agent-model turn. When an npm package is published, its install command can replace the checkout path.

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
