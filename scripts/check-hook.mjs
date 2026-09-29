#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hook = path.join(root, "integrations", "claude-code-hooks", "route-prompt-hook.mjs");
const result = spawnSync(process.execPath, [hook], {
  cwd: root,
  input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "Fix this small typo" }),
  encoding: "utf8",
  timeout: 5_000,
});

assert.equal(result.status, 0, result.stderr || "Hook should exit successfully");
const output = JSON.parse(result.stdout);
assert.equal(output.hookSpecificOutput.hookEventName, "UserPromptSubmit");
assert.match(output.hookSpecificOutput.additionalContext, /local-fast/);
assert.match(output.hookSpecificOutput.additionalContext, /does not dispatch/);
process.stdout.write("Claude Code hook smoke check passed.\n");
