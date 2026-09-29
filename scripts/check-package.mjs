#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this check through `npm run package:verify` so npm's pack command can be located.");

const packed = spawnSync(process.execPath, [npmCli, "pack", "--dry-run", "--json"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
});
if (packed.error) throw packed.error;
if (packed.status !== 0) throw new Error(packed.stderr || `npm pack exited with status ${packed.status}`);

let manifest;
try {
  manifest = JSON.parse(packed.stdout)[0];
} catch {
  throw new Error(`Could not parse npm pack's JSON output: ${packed.stdout.slice(0, 500)}`);
}

const included = new Set((manifest?.files ?? []).map((file) => file.path));
const required = [
  "LICENSE",
  "README.md",
  "package.json",
  "dist/cli.js",
  "dist/server.js",
  "docs/agents/README.md",
  "integrations/claude-code-hooks/README.md",
  "integrations/claude-code-hooks/route-prompt-hook.mjs",
];
const missing = required.filter((file) => !included.has(file));
if (missing.length) throw new Error(`The npm package is missing required files: ${missing.join(", ")}`);

process.stdout.write(`Package dry-run passed: ${manifest.entryCount} files; CLI, MCP server, agent guides, and optional hook are included.\n`);
