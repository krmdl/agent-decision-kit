#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createProvider } from "../dist/providers/index.js";

const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
if (outputIndex >= 0 && (!outputPath || outputPath.startsWith("--"))) {
  throw new Error("--output requires a file path");
}
const cases = (await readFile(new URL("./fixtures/decision-cases.jsonl", import.meta.url), "utf8"))
  .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const provider = createProvider();
const records = [];
for (const item of cases) {
  const start = performance.now();
  const result = await provider.decide({ state: item.state, questions: { answer: item.question } });
  const answer = result.answers.answer;
  const prediction = answer?.type === "choice" ? answer.choice : answer?.type === "noul" ? answer.noul >= 0.5 : null;
  const probabilities = answer?.type === "choice" ? answer.probabilities : answer?.type === "noul" ? { true: answer.noul, false: 1 - answer.noul } : undefined;
  const actual = item.expected === true ? "true" : item.expected === false ? "false" : item.expected;
  let brier = null;
  if (probabilities) {
    const keys = Object.keys(probabilities);
    brier = keys.reduce((sum, key) => sum + (probabilities[key] - (key === actual || (key.toLowerCase() === String(actual).toLowerCase()) ? 1 : 0)) ** 2, 0);
  }
  records.push({ id: item.id, expected: item.expected, prediction, correct: String(prediction).toLowerCase() === String(item.expected).toLowerCase(), probabilities, calibration: answer?.calibration ?? "unavailable", warmWithinProcess: records.length > 0, latencyMs: Math.round(performance.now() - start), brierScore: brier });
}
const firstCallMs = records[0]?.latencyMs ?? 0;
const warmRecords = records.filter((item) => item.warmWithinProcess);
const warmOrdered = warmRecords.map((item) => item.latencyMs).sort((a, b) => a - b);
const percentile = (fraction) => warmOrdered[Math.max(0, Math.ceil(warmOrdered.length * fraction) - 1)] ?? 0;
const brierRecords = records.filter((item) => item.brierScore !== null);
const report = `${JSON.stringify({
  provider: provider.id,
  model: provider.model,
  sampleCount: records.length,
  runtime: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    osVersion: os.release(),
    cpuModel: os.cpus()[0]?.model ?? "not reported",
    accelerator: "CPU (Transformers.js default backend)",
    modelCacheState: "model artifacts were already cached before this process; first measured call includes pipeline initialization",
  },
  accuracy: records.filter((item) => item.correct).length / records.length,
  meanBrierScore: brierRecords.length ? brierRecords.reduce((sum, item) => sum + item.brierScore, 0) / brierRecords.length : null,
  latencyMs: {
    firstCallIncludingInitialization: firstCallMs,
    withinProcessSteadyState: { sampleCount: warmRecords.length, p50: percentile(0.5), p95: percentile(0.95) },
  },
  records,
  note: "The first call includes pipeline initialization. warmWithinProcess only means later calls in this process. This small starter set is not a general quality, calibration, or performance claim; all probabilities remain uncalibrated.",
}, null, 2)}\n`;
if (outputPath) {
  const resolvedOutput = path.resolve(outputPath);
  await mkdir(path.dirname(resolvedOutput), { recursive: true });
  await writeFile(resolvedOutput, report, "utf8");
}
process.stdout.write(report);
