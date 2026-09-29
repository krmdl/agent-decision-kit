#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BrowserManager } from "../dist/browser/manager.js";

const root = path.resolve(import.meta.dirname, "..");
const expectedLabels = ["Save draft", "Delete draft"];
const sampleSmallLabel = "Open task";
const html = await readFile(path.join(root, "examples", "visual-only-demo.html"));
const profile = await mkdtemp(path.join(os.tmpdir(), "adk-ocr-smoke-"));
const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
});
const browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });

try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start the local OCR demo server");
  await browser.launch(`http://127.0.0.1:${address.port}/`);
  const result = await browser.visualText();
  const recognizedText = result.lines.map((line) => line.text).join(" ");
  const labelsFound = expectedLabels.filter((label) => recognizedText.toLowerCase().includes(label.toLowerCase()));
  const optionalSmallLabelFound = recognizedText.toLowerCase().includes(sampleSmallLabel.toLowerCase());
  const record = {
    benchmark: "visual-only-ocr-smoke",
    task: "read-prominent-canvas-text",
    success: labelsFound.length === expectedLabels.length,
    engine: result.engine,
    language: result.language,
    screenshotMs: result.screenshotMs,
    initializationMs: result.initializationMs,
    recognitionMs: result.recognitionMs,
    latencyMs: result.screenshotMs + result.latencyMs,
    sampleCount: 1,
    expectedLabels,
    labelsFound,
    optionalSmallLabel: { text: sampleSmallLabel, found: optionalSmallLabelFound },
    lines: result.lines,
    runtime: { node: process.version, platform: process.platform, architecture: process.arch, cpuModel: os.cpus()[0]?.model ?? "not reported" },
    timestampUtc: new Date().toISOString(),
    note: "One synthetic canvas screenshot smoke sample, not a quality or speed benchmark. Editable fields are masked. OCR line confidence is not calibrated. A miss on small button text can happen; use local visual question answering when OCR is insufficient. No page action is performed.",
  };
  const output = path.join(root, "benchmarks", "results", "ocr-smoke.json");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  assert.equal(record.success, true, "OCR did not recognize the prominent sample labels");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(() => resolve()));
  const tempBase = path.resolve(os.tmpdir());
  const resolvedProfile = path.resolve(profile);
  if (!resolvedProfile.startsWith(tempBase + path.sep)) throw new Error("Refusing cleanup outside the temporary directory");
  await rm(resolvedProfile, { recursive: true, force: true });
}
