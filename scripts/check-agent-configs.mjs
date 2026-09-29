#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clients = [
  ["claude-code", "claude-code", "json"],
  ["codex-cli", "codex-cli", "toml"],
  ["cursor", "cursor", "json"],
  ["gemini-cli", "gemini-cli", "json"],
  ["windsurf-cascade", "windsurf", "json"],
  ["vscode-copilot-chat", "vscode", "json"],
  ["github-copilot-cli", "copilot-cli", "json"],
  ["cline", "cline", "json"],
  ["opencode", "opencode", "json"],
];
for (const [client, guide, format] of clients) {
  const result = spawnSync(process.execPath, [path.join(root, "dist", "cli.js"), "config", client], {
    cwd: root,
    encoding: "utf8",
    timeout: 5_000,
  });
  assert.equal(result.status, 0, `${client}: ${result.stderr || result.stdout}`);
  const config = JSON.parse(result.stdout);
  assert.ok(config.file, `${client}: missing config path`);
  assert.ok(config.snippet, `${client}: missing config snippet`);
  const markdown = await readFile(path.join(root, "docs", "agents", `${guide}.md`), "utf8");
  const block = [...markdown.matchAll(/```(json|toml)\s*([\s\S]*?)```/gi)]
    .find((match) => match[1].toLowerCase() === format);
  assert.ok(block, `${client}: missing ${format.toUpperCase()} config example`);

  if (format === "json") {
    const example = JSON.parse(block[2].trim());
    const server = client === "vscode-copilot-chat"
      ? example.servers?.["agent-decision-kit"]
      : client === "opencode"
        ? example.mcp?.servers?.["agent-decision-kit"]
        : example.mcpServers?.["agent-decision-kit"];
    assert.ok(server, `${client}: config does not define agent-decision-kit`);
    const command = Array.isArray(server.command) ? server.command : [server.command, ...(server.args ?? [])];
    assert.equal(command[0], "node", `${client}: server command must launch Node.js`);
    assert.ok(command[1]?.endsWith("/dist/cli.js"), `${client}: command must target the built CLI`);
    assert.equal(command.at(-1), "mcp", `${client}: command must select MCP stdio mode`);
  } else {
    const example = block[2];
    assert.match(example, /^\[mcp_servers\.agent-decision-kit\]\s*$/m, `${client}: missing MCP server table`);
    assert.match(example, /^command\s*=\s*"node"\s*$/m, `${client}: server command must launch Node.js`);
    const args = example.match(/^args\s*=\s*(\[[^\r\n]*\])\s*$/m)?.[1];
    assert.ok(args, `${client}: missing command arguments`);
    const values = JSON.parse(args);
    assert.ok(values[0]?.endsWith("/dist/cli.js"), `${client}: command must target the built CLI`);
    assert.equal(values.at(-1), "mcp", `${client}: command must select MCP stdio mode`);
  }
}
process.stdout.write(`Agent configuration smoke check passed for ${clients.length} aliases and validated their JSON/TOML guide examples.\n`);
