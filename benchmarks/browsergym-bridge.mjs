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
        result = { node: process.version, playwright: playwrightPackage.version };
        break;
      case "connect":
        result = await browser.connect(request.endpoint, request.pageIndex ?? 0);
        break;
      case "inspect":
        result = await browser.inspect();
        break;
      case "fill":
        result = await browser.fill(request.ref, request.text);
        break;
      case "copy-field":
        result = await browser.copyField(request.sourceRef, request.targetRef);
        break;
      case "set-checkboxes":
        result = await browser.setCheckboxes(request.refs, request.checked);
        break;
      case "select-option":
        result = await browser.selectOption(request.ref, request.optionLabel);
        break;
      case "set-range":
        result = await browser.setRange(request.ref, request.value);
        break;
      case "act":
        result = await browser.act(request.ref);
        break;
      case "visual-inspect":
        result = await browser.visualInspect(request.question);
        break;
      case "visual-text":
        result = await browser.visualText(request.maxLines ?? 40);
        break;
      case "visual-action":
        result = await browser.visualAction(request.text);
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
