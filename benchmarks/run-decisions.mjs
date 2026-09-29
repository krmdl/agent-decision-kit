#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createProvider } from "../dist/providers/index.js";

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
process.stdout.write(`${JSON.stringify({
  provider: provider.id,
  model: provider.model,
  sampleCount: records.length,
  runtime: { node: process.version, platform: process.platform, architecture: process.arch },
  accuracy: records.filter((item) => item.correct).length / records.length,
  meanBrierScore: brierRecords.length ? brierRecords.reduce((sum, item) => sum + item.brierScore, 0) / brierRecords.length : null,
  latencyMs: {
    firstCallIncludingInitialization: firstCallMs,
    withinProcessSteadyState: { sampleCount: warmRecords.length, p50: percentile(0.5), p95: percentile(0.95) },
  },
  records,
  note: "The first call includes pipeline initialization and may include model download. warmWithinProcess only means later calls in this process. This small starter set is not a general quality, calibration, or performance claim; report hardware, accelerator, model-cache state, provider setup, and held-out data.",
}, null, 2)}\n`);
