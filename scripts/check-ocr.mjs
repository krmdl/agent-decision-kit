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
  const smallLabelProposal = await browser.visualAction(sampleSmallLabel);
  const smallLabelWasProposed = smallLabelProposal.status === "awaiting-user-approval";
  const smallLabelCancellation = smallLabelWasProposed ? await browser.confirm(smallLabelProposal.approvalToken, false) : undefined;
  if (!optionalSmallLabelFound) assert.ok(smallLabelProposal.sparseTextFallback || smallLabelProposal.proposedAction?.matchSource === "sparse-text-fallback", "a default OCR miss should trigger the sparse-text fallback");
  if (smallLabelCancellation) assert.equal(smallLabelCancellation.status, "cancelled");
  const firstProposal = await browser.visualAction("Save draft");
  assert.equal(firstProposal.status, "awaiting-user-approval", "OCR must propose an exact unique target without clicking");
  const cancelled = await browser.confirm(firstProposal.approvalToken, false);
  assert.equal(cancelled.status, "cancelled", "the user must be able to cancel the visual click");
  const staleProposal = await browser.visualAction("Delete draft");
  assert.equal(staleProposal.status, "awaiting-user-approval", "an exact sensitive-looking visual label must still only propose an action");
  const approvedProposal = await browser.visualAction("Save draft");
  assert.equal(approvedProposal.status, "awaiting-user-approval", "cancelling must leave the unchanged page available for a fresh proposal");
  const approvedAction = await browser.confirm(approvedProposal.approvalToken, true);
  assert.equal(approvedAction.status, "action-executed-after-approval", "the click must execute only after a separate approval call");
  assert.match(approvedAction.effect.title, /Saved locally/u, "the approved coordinate must hit the local fake demo target");
  await assert.rejects(browser.confirm(staleProposal.approvalToken, true), /visual page changed/u, "a page changed after proposal must reject a stale approval");
  const record = {
    benchmark: "visual-only-ocr-smoke",
    task: "read-prominent-canvas-text-and-approve-one-exact-local-click",
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
    sparseTextFallbackSmoke: {
      target: sampleSmallLabel,
      status: smallLabelProposal.status,
      matchSource: smallLabelProposal.proposedAction?.matchSource ?? (smallLabelProposal.sparseTextFallback ? "sparse-text-fallback" : "automatic"),
      latencyMs: smallLabelProposal.proposedAction?.fallbackLatencyMs ?? smallLabelProposal.sparseTextFallback?.latencyMs ?? null,
      proposalCancelled: smallLabelCancellation?.status === "cancelled",
    },
    visualClickSmoke: { proposedWithoutClick: true, cancellationChecked: true, approvedClickReachedLocalCanvasTarget: true, staleScreenshotApprovalRejected: true, click: approvedAction.clickedAtCss },
    lines: result.lines.map(({ text, confidence, box }) => ({ text, confidence, box })),
    runtime: { node: process.version, platform: process.platform, architecture: process.arch, cpuModel: os.cpus()[0]?.model ?? "not reported" },
    timestampUtc: new Date().toISOString(),
    note: "One synthetic canvas screenshot and local click smoke sample, not a quality or speed benchmark. Editable fields are masked. OCR engine scores are not calibrated. The click proposal required an exact unique match and a separate explicit confirmation; the harness checked cancellation and rejection of a stale screenshot. Its demo handler changes only local synthetic canvas pixels and the document title. A miss on small button text can happen; use local visual question answering when OCR is insufficient.",
  };
  const output = path.join(root, "benchmarks", "results", "ocr-smoke.json");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  assert.equal(record.success, true, "OCR did not recognize the prominent sample labels");
  assert.equal(record.visualClickSmoke.approvedClickReachedLocalCanvasTarget, true);
  assert.equal(record.visualClickSmoke.staleScreenshotApprovalRejected, true);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(() => resolve()));
  const tempBase = path.resolve(os.tmpdir());
  const resolvedProfile = path.resolve(profile);
  if (!resolvedProfile.startsWith(tempBase + path.sep)) throw new Error("Refusing cleanup outside the temporary directory");
  await rm(resolvedProfile, { recursive: true, force: true });
}
