#!/usr/bin/env node
import { routeModel } from "../../dist/workflows.js";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));

let event;
try {
  event = JSON.parse(Buffer.concat(chunks).toString("utf8"));
} catch {
  process.exit(0);
}

if (event?.hook_event_name !== "UserPromptSubmit" || typeof event.prompt !== "string" || !event.prompt.trim()) {
  process.exit(0);
}

const prompt = event.prompt.slice(0, 8_000);
const suggestion = routeModel(prompt);
process.stdout.write(`${JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: `Agent Decision Kit suggests the '${suggestion.route}' route for this ${suggestion.complexity}-complexity prompt. ${suggestion.reason} This is a local, unbenchmarked heuristic; it does not dispatch the prompt or change the selected model.`,
  },
})}\n`);
