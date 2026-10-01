#!/usr/bin/env node
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
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
  const generatedCommand = readCliConfigCommand(client, config.snippet);
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
    if (client === "cursor") assert.equal(server.type, "stdio", "cursor: stdio server type must be explicit");
    const command = Array.isArray(server.command) ? server.command : [server.command, ...(server.args ?? [])];
    assert.equal(command[0], "node", `${client}: server command must launch Node.js`);
    assert.ok(command[1]?.endsWith("/dist/cli.js"), `${client}: command must target the built CLI`);
    assert.equal(command.at(-1), "mcp", `${client}: command must select MCP stdio mode`);
    const normalizedGuideCommand = normalizeCommand(command.map((argument) => argument.replace("/absolute/path/to/agent-decision-kit", root.replaceAll("\\", "/"))));
    assert.deepEqual(normalizeCommand(generatedCommand), normalizedGuideCommand, `${client}: CLI-generated command differs from its guide example`);
  } else {
    const example = block[2];
    assert.match(example, /^\[mcp_servers\.agent-decision-kit\]\s*$/m, `${client}: missing MCP server table`);
    assert.match(example, /^command\s*=\s*"node"\s*$/m, `${client}: server command must launch Node.js`);
    const args = example.match(/^args\s*=\s*(\[[^\r\n]*\])\s*$/m)?.[1];
    assert.ok(args, `${client}: missing command arguments`);
    const values = JSON.parse(args);
    assert.ok(values[0]?.endsWith("/dist/cli.js"), `${client}: command must target the built CLI`);
    assert.equal(values.at(-1), "mcp", `${client}: command must select MCP stdio mode`);
    const normalizedGuideArgs = values.map((argument) => argument.replace("/absolute/path/to/agent-decision-kit", root.replaceAll("\\", "/")));
    const normalizedGuideCommand = normalizeCommand(["node", ...normalizedGuideArgs]);
    assert.deepEqual(normalizeCommand(generatedCommand), normalizedGuideCommand, `${client}: CLI-generated command differs from its guide example`);
  }

  if (client === "opencode") verifyOpenCodeV1Example(markdown, generatedCommand, root);
  await verifyMcpCommand(client, generatedCommand[0], generatedCommand.slice(1));
}
process.stdout.write(`Agent configuration smoke check passed for ${clients.length} aliases: guide examples validated, generated server commands launched, and model_route called for each. This does not emulate vendor-specific clients.\n`);

function readCliConfigCommand(client, snippet) {
  let entry;
  if (typeof snippet === "string") {
    const command = snippet.match(/^command\s*=\s*"([^"]+)"\s*$/m)?.[1];
    const args = snippet.match(/^args\s*=\s*(\[[^\r\n]*\])\s*$/m)?.[1];
    assert.ok(command && args, `${client}: generated TOML snippet has no command/args`);
    entry = { command, args: JSON.parse(args) };
  } else {
    const servers = client === "opencode"
      ? snippet.mcp?.servers
      : client === "vscode-copilot-chat"
        ? snippet.servers
        : snippet.mcpServers;
    entry = servers?.["agent-decision-kit"];
    assert.ok(entry, `${client}: generated JSON snippet has no agent-decision-kit entry`);
  }

  const command = Array.isArray(entry.command) ? entry.command : [entry.command, ...(entry.args ?? [])];
  assert.equal(command[0], "node", `${client}: generated config must launch Node.js`);
  assert.ok(normalizeArgument(command[1] ?? "").endsWith("/dist/cli.js"), `${client}: generated config must target the built CLI`);
  assert.equal(command.at(-1), "mcp", `${client}: generated config must select MCP stdio mode`);
  return command;
}

function normalizeArgument(value) {
  return value.replaceAll("\\", "/");
}

function normalizeCommand(command) {
  return command.map((argument) => typeof argument === "string" ? normalizeArgument(argument) : argument);
}

function verifyOpenCodeV1Example(markdown, generatedCommand, root) {
  const configs = [...markdown.matchAll(/```json\s*([\s\S]*?)```/gi)]
    .map((match) => JSON.parse(match[1].trim()));
  const server = configs.find((config) => config.mcp?.["agent-decision-kit"] && !config.mcp.servers)?.mcp?.["agent-decision-kit"];
  assert.ok(server, "opencode: missing v1 config with a direct server entry under mcp");
  assert.equal(server.type, "local", "opencode v1: server type must be local");
  assert.ok(Array.isArray(server.command), "opencode v1: command must be an array");
  const normalized = server.command.map((argument) => argument.replace("/absolute/path/to/agent-decision-kit", root.replaceAll("\\", "/")));
  assert.deepEqual(normalizeCommand(normalized), normalizeCommand(generatedCommand), "opencode v1: command must match the generated MCP command");
}

async function verifyMcpCommand(clientName, command, args) {
  const transport = new StdioClientTransport({ command, args, cwd: root });
  const client = new Client({ name: `agent-config-smoke-${clientName}`, version: "0.1.0" });
  let timeout;
  try {
    await Promise.race([
      client.connect(transport),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${clientName}: MCP subprocess did not initialize within 15 seconds`)), 15_000);
      }),
    ]);
    const { tools } = await client.listTools();
    const names = new Set(tools.map(({ name }) => name));
    assert.ok(names.has("model_route"), `${clientName}: MCP subprocess does not expose model_route`);
    const result = await client.callTool({
      name: "model_route",
      arguments: { task: "fix a typo in a label", available: ["fast", "reasoning"], latencySensitive: true },
    });
    assert.notEqual(result.isError, true, `${clientName}: model_route returned an MCP error`);
    const content = result.content.find((item) => item.type === "text");
    assert.ok(content?.type === "text", `${clientName}: model_route returned no text result`);
    assert.equal(JSON.parse(content.text).route, "fast", `${clientName}: unexpected model_route result`);
  } finally {
    if (timeout) clearTimeout(timeout);
    await client.close().catch(() => undefined);
  }
}
