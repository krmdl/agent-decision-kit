#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, "dist", "cli.js"), "mcp"],
  cwd: root,
});
const client = new Client({ name: "agent-decision-kit-stdio-smoke", version: "0.1.0" });
let discoveredToolCount = 0;

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  discoveredToolCount = tools.length;
  const toolNames = new Set(tools.map(({ name }) => name));
  for (const name of ["decide", "model_route", "browser_launch", "browser_inspect", "browser_action", "browser_drag", "browser_confirm", "browser_set_range", "browser_copy_field", "browser_set_checkboxes"]) {
    assert.ok(toolNames.has(name), `stdio server is missing ${name}`);
  }

  const result = await client.callTool({
    name: "model_route",
    arguments: { task: "fix a typo in a label", available: ["fast", "reasoning"], latencySensitive: true },
  });
  assert.notEqual(result.isError, true, "model_route returned an MCP error");
  const content = result.content.find((item) => item.type === "text");
  assert.ok(content?.type === "text", "model_route returned no text result");
  assert.equal(JSON.parse(content.text).route, "fast");
} finally {
  await client.close();
}

process.stdout.write(`MCP stdio subprocess smoke passed: ${discoveredToolCount} tools discovered and model_route called.\n`);
