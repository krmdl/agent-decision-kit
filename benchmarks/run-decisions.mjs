#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { env } from "@huggingface/transformers";
import { createProvider } from "../dist/providers/index.js";

async function modelCacheDirectoryExists(modelId) {
  if (typeof modelId !== "string" || !env.cacheDir || !/^[\w.-]+(?:\/[\w.-]+)+$/.test(modelId)) return null;
  const cacheRoot = path.resolve(env.cacheDir);
  const modelCachePath = path.resolve(cacheRoot, ...modelId.split("/"));
  const relativePath = path.relative(cacheRoot, modelCachePath);
  if (!relativePath || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) return null;
  try {
    return (await stat(modelCachePath)).isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    return null;
  }
}

const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
if (outputIndex >= 0 && (!outputPath || outputPath.startsWith("--"))) {
  throw new Error("--output requires a file path");
}
const fixturesIndex = process.argv.indexOf("--fixtures");
const fixturesPath = fixturesIndex >= 0 ? process.argv[fixturesIndex + 1] : "./fixtures/decision-cases.jsonl";
if (fixturesIndex >= 0 && (!fixturesPath || fixturesPath.startsWith("--"))) {
  throw new Error("--fixtures requires a JSONL file path");
}
const fixtureSource = fixturesIndex >= 0 ? path.resolve(fixturesPath) : new URL("./fixtures/decision-cases.jsonl", import.meta.url);
const cases = (await readFile(fixtureSource, "utf8"))
  .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
if (cases.length === 0) throw new Error("The decision fixture file must contain at least one JSONL record");
const provider = createProvider();
const modelCacheDirectoryPresentBeforeRun = provider.id === "semantic-local"
  ? await modelCacheDirectoryExists(provider.model)
  : null;
const records = [];
for (const item of cases) {
  const start = performance.now();
  const result = await provider.decide({ state: item.state, questions: { answer: item.question } });
  const answer = result.answers.answer;
  const prediction = answer?.type === "choice" ? answer.choice : answer?.type === "noul" ? answer.noul >= 0.5 : answer?.type === "score" ? answer.score : null;
  const probabilities = answer?.type === "choice" || answer?.type === "score" ? answer.probabilities : answer?.type === "noul" ? { true: answer.noul, false: 1 - answer.noul } : undefined;
  const actual = item.expected === true ? "true" : item.expected === false ? "false" : item.expected;
  let brier = null;
  if (probabilities) {
    const keys = Object.keys(probabilities);
    brier = keys.reduce((sum, key) => sum + (probabilities[key] - (key === actual || (key.toLowerCase() === String(actual).toLowerCase()) ? 1 : 0)) ** 2, 0);
  }
  const scoreAbsoluteError = answer?.type === "score" ? Math.abs(answer.score - Number(item.expected)) : null;
  const correct = answer?.type === "choice" || answer?.type === "noul"
    ? String(prediction).toLowerCase() === String(item.expected).toLowerCase()
    : undefined;
  records.push({
    id: item.id,
    questionType: item.question.type,
    expected: item.expected,
    prediction,
    ...(answer?.type === "score" ? { scoreAbsoluteError, scoreWithinHalfPoint: scoreAbsoluteError <= 0.5, scoreExactMatch: Math.round(answer.score) === Number(item.expected) } : {}),
    ...(correct === undefined ? {} : { correct }),
    probabilities,
    calibration: answer?.calibration ?? "unavailable",
    warmWithinProcess: records.length > 0,
    latencyMs: Math.round(performance.now() - start),
    brierScore: brier,
  });
}
const firstCallMs = records[0]?.latencyMs ?? 0;
const warmRecords = records.filter((item) => item.warmWithinProcess);
const warmOrdered = warmRecords.map((item) => item.latencyMs).sort((a, b) => a - b);
const percentile = (fraction) => warmOrdered[Math.max(0, Math.ceil(warmOrdered.length * fraction) - 1)] ?? 0;
const brierRecords = records.filter((item) => item.brierScore !== null);
const classificationRecords = records.filter((item) => item.questionType === "choice" || item.questionType === "noul");
const scoreRecords = records.filter((item) => item.questionType === "score");
const mean = (items, field) => items.length ? items.reduce((sum, item) => sum + item[field], 0) / items.length : null;
const byQuestionType = Object.fromEntries(["choice", "noul", "score"].map((type) => {
  const selected = records.filter((item) => item.questionType === type);
  return [type, {
    sampleCount: selected.length,
    ...(type === "score" ? {
      meanAbsoluteError: mean(selected, "scoreAbsoluteError"),
      withinHalfPointRate: selected.length ? selected.filter((item) => item.scoreWithinHalfPoint).length / selected.length : null,
      exactMatchRate: selected.length ? selected.filter((item) => item.scoreExactMatch).length / selected.length : null,
    } : {
      accuracy: selected.length ? selected.filter((item) => item.correct).length / selected.length : null,
    }),
    meanBrierScore: mean(selected.filter((item) => item.brierScore !== null), "brierScore"),
  }];
}));
const report = `${JSON.stringify({
  provider: provider.id,
  model: provider.model,
  sampleCount: records.length,
  byQuestionType,
  runtime: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    osVersion: os.release(),
    cpuModel: os.cpus()[0]?.model ?? "not reported",
    accelerator: provider.id === "semantic-local" ? "CPU (Transformers.js default backend)" : "provider-specific; not inspected",
    modelCacheDirectoryPresentBeforeRun,
    modelCacheState: provider.id !== "semantic-local"
      ? "not applicable; provider does not use the Transformers.js model cache"
      : modelCacheDirectoryPresentBeforeRun === true
        ? "model cache directory existed before this process; required files were not individually verified"
        : modelCacheDirectoryPresentBeforeRun === false
          ? "model cache directory was absent before this process; first call may include model retrieval"
          : "model cache directory was not safely inspected; cache state is unknown",
  },
  classificationAccuracy: classificationRecords.length ? classificationRecords.filter((item) => item.correct).length / classificationRecords.length : null,
  scoreMeanAbsoluteError: mean(scoreRecords, "scoreAbsoluteError"),
  scoreWithinHalfPointRate: scoreRecords.length ? scoreRecords.filter((item) => item.scoreWithinHalfPoint).length / scoreRecords.length : null,
  meanBrierScore: brierRecords.length ? brierRecords.reduce((sum, item) => sum + item.brierScore, 0) / brierRecords.length : null,
  latencyMs: {
    firstCallIncludingInitialization: firstCallMs,
    withinProcessSteadyState: { sampleCount: warmRecords.length, p50: percentile(0.5), p95: percentile(0.95) },
  },
  records,
  note: "The first call includes provider initialization and may include model retrieval if files were missing. For the Transformers.js local provider, cache inspection only checks whether the model cache directory existed before the process; it does not verify every required file. warmWithinProcess only means later calls in this process. Choice/yes-no accuracy and score error are reported separately. This small human-labeled fixture is not a general quality, calibration, or performance claim; all probabilities remain uncalibrated.",
}, null, 2)}\n`;
if (outputPath) {
  const resolvedOutput = path.resolve(outputPath);
  await mkdir(path.dirname(resolvedOutput), { recursive: true });
  await writeFile(resolvedOutput, report, "utf8");
}
process.stdout.write(report);
