#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BrowserManager } from "../dist/browser/manager.js";

const root = path.resolve(import.meta.dirname, "..");
const demo = await readFile(path.join(root, "examples", "visual-only-demo.html"));
const profile = await mkdtemp(path.join(os.tmpdir(), "adk-vision-smoke-"));
const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(demo);
});
const browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });

try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start visual demo server");
  await browser.launch(`http://127.0.0.1:${address.port}/`);
  const snapshot = await browser.inspect();
  if (snapshot.candidates.length !== 0) throw new Error(`Visual-only demo exposed ${snapshot.candidates.length} DOM actions`);

  const result = await browser.visualInspect("What is the label of the main green button? Answer only with the visible text.");
  if (result.provider !== "local-vision" || !result.description) throw new Error("Local vision inference returned no description");
  process.stdout.write(`${JSON.stringify({ model: result.model, description: result.description, latencyMs: result.latencyMs, confidence: result.confidence, note: result.note }, null, 2)}\n`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(() => resolve()));
  await rm(profile, { recursive: true, force: true });
}
