#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { summarizeConfidenceReliability } from "./decision-metrics.mjs";

const QUESTION_TYPES = ["choice", "noul", "score"];

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (!["--baseline", "--candidate", "--output"].includes(argument)) {
      throw new Error(`Unknown argument '${argument}'. Use --help for usage.`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a file path`);
    options[argument.slice(2)] = value;
    index += 1;
  }
  if (!options.baseline || !options.candidate) throw new Error("Both --baseline and --candidate are required");
  return options;
}

function validateReport(report, label) {
  if (!report || typeof report !== "object" || Array.isArray(report)) throw new Error(`${label} is not a JSON report object`);
  if (typeof report.provider !== "string" || typeof report.model !== "string") throw new Error(`${label} is missing provider or model metadata`);
  if (!Array.isArray(report.records) || report.records.length === 0) throw new Error(`${label} has no case records`);
  const records = new Map();
  for (const record of report.records) {
    if (!record || typeof record.id !== "string" || !record.id) throw new Error(`${label} contains a case without an id`);
    if (records.has(record.id)) throw new Error(`${label} contains duplicate case ids`);
    if (!QUESTION_TYPES.includes(record.questionType)) throw new Error(`${label} contains an unsupported question type`);
    if (!Object.hasOwn(record, "expected") || !Object.hasOwn(record, "prediction")) throw new Error(`${label} has an incomplete case record`);
    if (typeof record.latencyMs !== "number" || !Number.isFinite(record.latencyMs) || record.latencyMs < 0) {
      throw new Error(`${label} contains an invalid case latency`);
    }
    records.set(record.id, record);
  }
  return records;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalJson(item)]));
  }
  return value;
}

function normalizedAnswer(value, questionType) {
  if (questionType === "noul") return String(value).trim().toLowerCase();
  return String(value).trim().toLowerCase();
}

function isCorrect(record) {
  return normalizedAnswer(record.prediction, record.questionType) === normalizedAnswer(record.expected, record.questionType);
}

function scoreError(record) {
  if (typeof record.prediction !== "number" || !Number.isFinite(record.prediction)) return null;
  const expected = Number(record.expected);
  return Number.isFinite(expected) ? Math.abs(record.prediction - expected) : null;
}

function brierScore(record) {
  const probabilities = record.probabilities;
  if (!probabilities || typeof probabilities !== "object" || Array.isArray(probabilities)) return null;
  const keys = Object.keys(probabilities);
  if (keys.length === 0 || keys.some((key) => typeof probabilities[key] !== "number" || !Number.isFinite(probabilities[key]))) return null;
  const expected = String(record.expected).toLowerCase();
  return keys.reduce((total, key) => {
    const probability = probabilities[key];
    const target = key.toLowerCase() === expected ? 1 : 0;
    return total + (probability - target) ** 2;
  }, 0);
}

function mean(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function summarizeType(records, type) {
  const selected = records.filter((record) => record.questionType === type);
  const brierValues = selected.map(brierScore).filter((value) => value !== null);
  if (type === "score") {
    const errors = selected.map(scoreError).filter((value) => value !== null);
    const validPredictions = selected.filter((record) => scoreError(record) !== null);
    return {
      sampleCount: selected.length,
      answeredCount: errors.length,
      meanAbsoluteError: mean(errors),
      withinHalfPointRate: errors.length ? errors.filter((value) => value <= 0.5).length / errors.length : null,
      exactMatchRate: validPredictions.length
        ? validPredictions.filter((record) => Math.round(record.prediction) === Number(record.expected)).length / validPredictions.length
        : null,
      meanBrierScore: mean(brierValues),
      brierSampleCount: brierValues.length,
    };
  }
  return {
    sampleCount: selected.length,
    answeredCount: selected.filter((record) => record.prediction !== null && record.prediction !== undefined).length,
    accuracy: selected.length ? selected.filter(isCorrect).length / selected.length : null,
    meanBrierScore: mean(brierValues),
    brierSampleCount: brierValues.length,
  };
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function summarizeLatency(report) {
  const records = report.records;
  const firstRecord = records.find((record) => record.warmWithinProcess === false);
  const warmRecords = records.filter((record) => record.warmWithinProcess === true);
  const firstCallMs = firstRecord?.latencyMs ?? report.latencyMs?.firstCallIncludingInitialization ?? null;
  const warmValues = warmRecords.map((record) => record.latencyMs);
  return {
    firstCallIncludingInitializationMs: typeof firstCallMs === "number" && Number.isFinite(firstCallMs) ? firstCallMs : null,
    warmCallCount: warmValues.length,
    warmP50Ms: percentile(warmValues, 0.5),
    warmP95Ms: percentile(warmValues, 0.95),
  };
}

function reliability(records) {
  const eligible = records
    .filter((record) => record.questionType !== "score")
    .map((record) => ({
      correct: isCorrect(record),
      confidence: record.confidence,
      confidenceSource: record.confidenceSource ?? "unavailable",
      calibration: record.calibration ?? "unavailable",
    }));
  const groups = summarizeConfidenceReliability(eligible);
  const sampleCount = groups.reduce((total, group) => total + group.sampleCount, 0);
  const ece = sampleCount
    ? groups.reduce((total, group) => total + group.expectedCalibrationError * group.sampleCount, 0) / sampleCount
    : null;
  return { sampleCount, expectedCalibrationError: ece, groups };
}

function runtimeSummary(report) {
  const runtime = report.runtime ?? {};
  return {
    node: runtime.node ?? null,
    platform: runtime.platform ?? null,
    architecture: runtime.architecture ?? null,
    osVersion: runtime.osVersion ?? null,
    cpuModel: typeof runtime.cpuModel === "string" ? runtime.cpuModel.trim() : null,
    requestedDevice: runtime.requestedDevice ?? null,
    modelCacheState: runtime.modelCacheState ?? null,
  };
}

function finiteDelta(candidate, baseline) {
  return typeof candidate === "number" && Number.isFinite(candidate)
    && typeof baseline === "number" && Number.isFinite(baseline)
    ? candidate - baseline
    : null;
}

export function compareDecisionRuns(baseline, candidate) {
  const baselineRecords = validateReport(baseline, "Baseline");
  const candidateRecords = validateReport(candidate, "Candidate");
  if (JSON.stringify(canonicalJson(baseline.sourceDataset ?? null)) !== JSON.stringify(canonicalJson(candidate.sourceDataset ?? null))) {
    throw new Error("Reports use different source dataset metadata");
  }
  if (baselineRecords.size !== candidateRecords.size) throw new Error("Reports use different case counts");
  for (const [id, baselineRecord] of baselineRecords) {
    const candidateRecord = candidateRecords.get(id);
    if (!candidateRecord) throw new Error("Reports use different case ids");
    if (baselineRecord.questionType !== candidateRecord.questionType || JSON.stringify(baselineRecord.expected) !== JSON.stringify(candidateRecord.expected)) {
      throw new Error("Reports disagree on question type or expected label for a shared case");
    }
  }

  const alignedIds = [...baselineRecords.keys()];
  const baselineCases = alignedIds.map((id) => baselineRecords.get(id));
  const candidateCases = alignedIds.map((id) => candidateRecords.get(id));
  const pairedOutcomes = Object.fromEntries(QUESTION_TYPES.map((type) => {
    const pairs = alignedIds
      .map((id, index) => [baselineRecords.get(id), candidateRecords.get(id)])
      .filter(([baselineRecord]) => baselineRecord.questionType === type);
    return [type, {
      sampleCount: pairs.length,
      predictionAgreementCount: pairs.filter(([baselineRecord, candidateRecord]) =>
        normalizedAnswer(baselineRecord.prediction, type) === normalizedAnswer(candidateRecord.prediction, type)).length,
      predictionDisagreementCount: pairs.filter(([baselineRecord, candidateRecord]) =>
        normalizedAnswer(baselineRecord.prediction, type) !== normalizedAnswer(candidateRecord.prediction, type)).length,
      bothCorrectCount: pairs.filter(([baselineRecord, candidateRecord]) => isCorrect(baselineRecord) && isCorrect(candidateRecord)).length,
      baselineOnlyCorrectCount: pairs.filter(([baselineRecord, candidateRecord]) => isCorrect(baselineRecord) && !isCorrect(candidateRecord)).length,
      candidateOnlyCorrectCount: pairs.filter(([baselineRecord, candidateRecord]) => !isCorrect(baselineRecord) && isCorrect(candidateRecord)).length,
      bothIncorrectCount: pairs.filter(([baselineRecord, candidateRecord]) => !isCorrect(baselineRecord) && !isCorrect(candidateRecord)).length,
    }];
  }));
  const baselineMetrics = Object.fromEntries(QUESTION_TYPES.map((type) => [type, summarizeType(baselineCases, type)]));
  const candidateMetrics = Object.fromEntries(QUESTION_TYPES.map((type) => [type, summarizeType(candidateCases, type)]));
  const baselineReliability = reliability(baselineCases);
  const candidateReliability = reliability(candidateCases);
  const baselineLatency = summarizeLatency(baseline);
  const candidateLatency = summarizeLatency(candidate);
  const baselineRuntime = runtimeSummary(baseline);
  const candidateRuntime = runtimeSummary(candidate);
  const hostFields = ["node", "platform", "architecture", "osVersion", "cpuModel"];
  const sameHost = hostFields.every((field) => baselineRuntime[field] !== null && baselineRuntime[field] === candidateRuntime[field]);

  return {
    schemaVersion: 1,
    comparedCaseCount: alignedIds.length,
    questionTypeCounts: Object.fromEntries(QUESTION_TYPES.map((type) => [type, baselineCases.filter((record) => record.questionType === type).length])),
    sourceDataset: baseline.sourceDataset ?? null,
    pairedOutcomes,
    baseline: {
      provider: baseline.provider,
      model: baseline.model,
      runtime: baselineRuntime,
      byQuestionType: baselineMetrics,
      confidenceReliability: baselineReliability,
      latency: baselineLatency,
    },
    candidate: {
      provider: candidate.provider,
      model: candidate.model,
      runtime: candidateRuntime,
      byQuestionType: candidateMetrics,
      confidenceReliability: candidateReliability,
      latency: candidateLatency,
    },
    deltas: {
      accuracyPercentagePoints: {
        choice: finiteDelta(candidateMetrics.choice.accuracy, baselineMetrics.choice.accuracy) === null ? null : finiteDelta(candidateMetrics.choice.accuracy, baselineMetrics.choice.accuracy) * 100,
        yesNo: finiteDelta(candidateMetrics.noul.accuracy, baselineMetrics.noul.accuracy) === null ? null : finiteDelta(candidateMetrics.noul.accuracy, baselineMetrics.noul.accuracy) * 100,
      },
      scoreMeanAbsoluteError: finiteDelta(candidateMetrics.score.meanAbsoluteError, baselineMetrics.score.meanAbsoluteError),
      meanBrierScore: Object.fromEntries(QUESTION_TYPES.map((type) => [type, finiteDelta(candidateMetrics[type].meanBrierScore, baselineMetrics[type].meanBrierScore)])),
      expectedCalibrationError: finiteDelta(candidateReliability.expectedCalibrationError, baselineReliability.expectedCalibrationError),
      latencyMs: {
        firstCallIncludingInitialization: finiteDelta(candidateLatency.firstCallIncludingInitializationMs, baselineLatency.firstCallIncludingInitializationMs),
        warmP50: finiteDelta(candidateLatency.warmP50Ms, baselineLatency.warmP50Ms),
        warmP95: finiteDelta(candidateLatency.warmP95Ms, baselineLatency.warmP95Ms),
      },
    },
    comparability: {
      sameLabeledCases: true,
      sourceDatasetMetadataMatches: true,
      sameHost,
      fieldsComparedForHost: hostFields,
      providerCostsIncluded: false,
      note: "This summarizes two completed runs; it does not call either provider. Paired outcomes count prediction agreement and which device-only answers are correct, but do not estimate statistical significance. Positive accuracy deltas favor the candidate; lower score error, Brier, ECE, and latency values favor the candidate. A paired result on one fixture is not a parity or general performance claim.",
    },
  };
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write("Usage: node benchmarks/compare-decision-runs.mjs --baseline <report.json> --candidate <report.json> [--output <comparison.json>]\n\nCompares two completed run-decisions reports with identical labeled cases. This command never invokes a provider.\n");
    return;
  }
  const baseline = JSON.parse(await readFile(path.resolve(options.baseline), "utf8"));
  const candidate = JSON.parse(await readFile(path.resolve(options.candidate), "utf8"));
  const comparison = compareDecisionRuns(baseline, candidate);
  const output = `${JSON.stringify(comparison, null, 2)}\n`;
  if (options.output) {
    const outputPath = path.resolve(options.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output, "utf8");
  }
  process.stdout.write(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`Decision run comparison failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
