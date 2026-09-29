#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clients = ["claude-code", "codex-cli", "cursor", "gemini-cli", "windsurf-cascade", "vscode-copilot-chat", "github-copilot-cli", "cline", "opencode"];
for (const client of clients) {
  const result = spawnSync(process.execPath, [path.join(root, "dist", "cli.js"), "config", client], {
    cwd: root,
    encoding: "utf8",
    timeout: 5_000,
  });
  assert.equal(result.status, 0, `${client}: ${result.stderr || result.stdout}`);
  const config = JSON.parse(result.stdout);
  assert.ok(config.file, `${client}: missing config path`);
  assert.ok(config.snippet, `${client}: missing config snippet`);
}
process.stdout.write(`Agent configuration smoke check passed for ${clients.length} aliases.\n`);
