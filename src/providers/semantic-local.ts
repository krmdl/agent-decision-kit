import { pipeline, type DeviceType } from "@huggingface/transformers";
import type { DecisionProvider, DecisionRequest, DecisionResult, DecisionAnswer } from "../core/types.js";
import { maxProbability, serializeState, softmax, validateProbabilities } from "../core/types.js";

type EmbeddingPipeline = (
  input: string | string[],
  options: { pooling: "mean"; normalize: true },
) => Promise<{ tolist: () => number[][] }>;

const sharedPipelines = new Map<string, Promise<EmbeddingPipeline>>();
const supportedDevices = ["auto", "gpu", "cpu", "wasm", "webgpu", "cuda", "dml", "coreml"] as const satisfies readonly DeviceType[];

function resolveDevice(device: string): DeviceType {
  const normalized = device.trim().toLowerCase();
  if (!supportedDevices.includes(normalized as (typeof supportedDevices)[number])) {
    throw new Error(`Unsupported AGENT_DECISION_DEVICE '${device}'. Choose one of: ${supportedDevices.join(", ")}`);
  }
  return normalized as DeviceType;
}

async function getPipeline(model: string, device: DeviceType): Promise<EmbeddingPipeline> {
  const cacheKey = `${model}\u0000${device}`;
  const existing = sharedPipelines.get(cacheKey);
  if (existing) return existing;
  const pending = pipeline("feature-extraction", model, { dtype: "q8", device }).then((value) => value as unknown as EmbeddingPipeline);
  sharedPipelines.set(cacheKey, pending);
  void pending.catch(() => {
    if (sharedPipelines.get(cacheKey) === pending) sharedPipelines.delete(cacheKey);
  });
  return pending;
}

function vectorize(output: { tolist: () => number[][] }): number[][] {
  const listed = output.tolist();
  if (!Array.isArray(listed[0])) return [listed as unknown as number[]];
  return listed;
}

function cosine(left: number[], right: number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    dot += left[index]! * right[index]!;
    leftNorm += left[index]! ** 2;
    rightNorm += right[index]! ** 2;
  }
  const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  return denominator === 0 ? 0 : dot / denominator;
}

export class SemanticLocalProvider implements DecisionProvider {
  readonly id = "semantic-local";
  readonly model: string;
  readonly device: DeviceType;

  constructor(model = process.env.AGENT_DECISION_MODEL ?? "Xenova/all-MiniLM-L6-v2", device = process.env.AGENT_DECISION_DEVICE ?? "cpu") {
    this.model = model;
    this.device = resolveDevice(device);
  }

  async warmup() {
    const start = performance.now();
    const extractor = await getPipeline(this.model, this.device);
    await extractor(["Agent Decision Kit local decision warm-up."], { pooling: "mean", normalize: true });
    return { provider: this.id, model: this.model, device: this.device, latencyMs: Math.round(performance.now() - start) };
  }

  async decide(request: DecisionRequest): Promise<DecisionResult> {
    const start = performance.now();
    const extractor = await getPipeline(this.model, this.device);
    const state = serializeState(request.state).slice(0, 8_000);
    const questions = Object.entries(request.questions);
    const inputs: string[] = [];
    const plan: Array<{ name: string; type: DecisionAnswer["type"]; options: string[]; original: string[] }> = [];

    for (const [name, question] of questions) {
      if (question.type === "choice") {
        const options = Object.entries(question.criteria).map(([key, description]) => `${key}: ${description}`);
        plan.push({ name, type: "choice", options, original: Object.keys(question.criteria) });
        inputs.push(`${question.instructions}\nContext: ${state}`, ...options);
      } else if (question.type === "score") {
        const options = question.criteria.map((description, index) => `${index}: ${description}`);
        plan.push({ name, type: "score", options, original: question.criteria });
        inputs.push(`${question.instructions}\nContext: ${state}`, ...options);
      } else {
        const options = [`true: Yes. ${question.instructions}`, `false: No. ${question.instructions}`];
        plan.push({ name, type: "noul", options, original: ["true", "false"] });
        inputs.push(`${question.instructions}\nContext: ${state}`, ...options);
      }
    }

    const embedded = vectorize(await extractor(inputs, { pooling: "mean", normalize: true }));
    let cursor = 0;
    const answers: Record<string, DecisionAnswer> = {};
    for (const item of plan) {
      const query = embedded[cursor++] ?? [];
      const optionVectors = item.options.map(() => embedded[cursor++] ?? []);
      const probabilities = validateProbabilities(Object.fromEntries(
        item.original.map((label, index) => [item.type === "score" ? String(index) : label, softmax(optionVectors.map((vector) => cosine(query, vector)))[index] ?? 0]),
      ));
      const confidence = maxProbability(probabilities);

      if (item.type === "choice") {
        const choice = Object.entries(probabilities).sort((left, right) => right[1] - left[1])[0]?.[0] ?? item.original[0]!;
        answers[item.name] = { type: "choice", choice, probabilities, confidence, confidenceSource: "maximum-probability", calibration: "uncalibrated-estimate" };
      } else if (item.type === "score") {
        const score = item.original.reduce((total, _criterion, index) => total + index * (probabilities[String(index)] ?? 0), 0);
        answers[item.name] = { type: "score", score, probabilities, confidence, confidenceSource: "maximum-probability", calibration: "uncalibrated-estimate" };
      } else {
        const noul = probabilities.true ?? 0.5;
        answers[item.name] = { type: "noul", noul, probabilities: { true: noul, false: 1 - noul }, confidence, confidenceSource: "maximum-probability", calibration: "uncalibrated-estimate" };
      }
    }

    const latencyMs = performance.now() - start;
    for (const answer of Object.values(answers)) answer.latencyMs = latencyMs;
    return { provider: this.id, model: this.model, latencyMs, answers };
  }
}

export function resetSemanticPipelineForTests(): void {
  sharedPipelines.clear();
}
