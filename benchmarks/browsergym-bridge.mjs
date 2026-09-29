#!/usr/bin/env node
import readline from "node:readline";
import { readFile } from "node:fs/promises";
import { BrowserManager } from "../dist/browser/manager.js";
import { createProvider } from "../dist/providers/index.js";

const playwrightPackage = JSON.parse(
  await readFile(new URL("../node_modules/playwright/package.json", import.meta.url), "utf8"),
);

const marker = "@@ADK_BROWSERGYM@@";
const browser = new BrowserManager({ headless: true, includeCandidateSnapshot: true });
const provider = createProvider("semantic-local");
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function respond(id, result, error) {
  process.stdout.write(`${marker}${JSON.stringify({ id, result, error })}\n`);
}

for await (const line of input) {
  if (!line.trim()) continue;
  let request;
  try {
    request = JSON.parse(line);
    let result;
    switch (request.op) {
      case "versions":
        result = { playwright: playwrightPackage.version };
        break;
      case "connect":
        result = await browser.connect(request.endpoint, request.pageIndex ?? 0);
        break;
      case "inspect":
        result = await browser.inspect();
        break;
      case "decide-and-act":
        result = await browser.decideAndAct(request.task, provider);
        break;
      case "confirm":
        result = await browser.confirm(request.approvalToken, request.approve);
        break;
      case "close":
        result = await browser.close();
        respond(request.id, result);
        input.close();
        break;
      default:
        throw new Error(`Unknown operation '${request.op}'`);
    }
    respond(request.id, result);
  } catch (error) {
    respond(request?.id, undefined, error instanceof Error ? error.message : String(error));
  }
}

await browser.close();
