#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { env as transformersEnv } from "@huggingface/transformers";
import { BrowserManager } from "../dist/browser/manager.js";

const root = path.resolve(import.meta.dirname, "..");
const model = process.env.AGENT_DECISION_VISION_MODEL ?? "HuggingFaceTB/SmolVLM2-500M-Video-Instruct";
const expectedLabel = "Open task";
const modelCachePath = transformersEnv.cacheDir ? path.join(transformersEnv.cacheDir, model) : undefined;
const modelFilesPresentBeforeRun = modelCachePath
  ? await stat(modelCachePath).then((entry) => entry.isDirectory()).catch(() => false)
  : false;
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
  const record = {
    benchmark: "visual-only-smoke",
    task: "read-canvas-button-label",
    success: result.description.toLowerCase().includes(expectedLabel.toLowerCase()),
    expectedLabel,
    description: result.description,
    model: result.model,
    provider: result.provider,
    confidence: result.confidence,
    calibration: "unavailable",
    latencyMs: result.latencyMs,
    sampleCount: 1,
    runtime: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      osVersion: os.release(),
      cpuModel: os.cpus()[0]?.model ?? "not reported",
      accelerator: "CPU",
      modelFilesPresentBeforeRun,
    },
    timestampUtc: new Date().toISOString(),
    note: "One integration smoke sample on a synthetic canvas page. It checks visible text recognition only; it is not a quality, calibration, or speed benchmark. Latency includes model initialization and generation.",
  };
  const output = path.join(root, "benchmarks", "results", "vision-smoke.json");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  if (!record.success) process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(() => resolve()));
  await rm(profile, { recursive: true, force: true });
}
