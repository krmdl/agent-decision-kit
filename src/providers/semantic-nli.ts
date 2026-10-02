import { pipeline, type DeviceType } from "@huggingface/transformers";
import type { DecisionAnswer, DecisionProvider, DecisionQuestion, DecisionRequest, DecisionResult } from "../core/types.js";
import { maxProbability, serializeState, validateProbabilities } from "../core/types.js";
import { resolveDevice, SemanticLocalProvider } from "./semantic-local.js";

interface ZeroShotResult {
  labels: string[];
  scores: number[];
}

type ZeroShotPipeline = (
  sequence: string,
  candidateLabels: string[],
  options: { hypothesis_template: string },
) => Promise<ZeroShotResult>;

const sharedPipelines = new Map<string, Promise<ZeroShotPipeline>>();
const MAX_NLI_HYPOTHESES_PER_REQUEST = 24;

interface QuestionPlan {
  name: string;
  question: DecisionQuestion;
  keys: string[];
  labels: string[];
  hypothesisTemplate: string;
}

async function getPipeline(model: string, device: DeviceType): Promise<ZeroShotPipeline> {
  const key = `${model}\u0000${device}`;
  const existing = sharedPipelines.get(key);
  if (existing) return existing;

  const pending = pipeline("zero-shot-classification", model, { dtype: "q8", device })
    .then((value) => value as unknown as ZeroShotPipeline);
  sharedPipelines.set(key, pending);
  void pending.catch(() => {
    if (sharedPipelines.get(key) === pending) sharedPipelines.delete(key);
  });
  return pending;
}

function planQuestion(name: string, question: DecisionQuestion): QuestionPlan {
  if (question.type === "choice") {
    const entries = Object.entries(question.criteria);
    return {
      name,
      question,
      keys: entries.map(([key]) => key),
      labels: entries.map(([key, description]) => `${key}: ${description}`),
      hypothesisTemplate: "The best option is {}.",
    };
  }
  if (question.type === "score") {
    const riskQuestion = /\brisk\b/i.test(question.instructions);
    return {
      name,
      question,
      keys: question.criteria.map((_criterion, index) => String(index)),
      labels: question.criteria.map((criterion, index) => `${index}: ${criterion}`),
      hypothesisTemplate: riskQuestion ? "The risk level is {}." : "The score is {}.",
    };
  }
  return {
    name,
    question,
    keys: ["true", "false"],
    labels: ["yes", "no"],
    hypothesisTemplate: "The correct answer is {}.",
  };
}

function answerFor(plan: QuestionPlan, result: ZeroShotResult): DecisionAnswer {
  if (!Array.isArray(result.labels) || !Array.isArray(result.scores) || result.labels.length !== plan.labels.length || result.scores.length !== plan.labels.length) {
    throw new Error(`The local NLI model returned an incomplete label distribution for '${plan.name}'`);
  }
  const returnedScores = new Map<string, number>();
  for (let index = 0; index < result.labels.length; index += 1) {
    const label = result.labels[index]!;
    const score = result.scores[index]!;
    if (!plan.labels.includes(label) || returnedScores.has(label) || !Number.isFinite(score) || score < 0 || score > 1) {
      throw new Error(`The local NLI model returned an invalid label distribution for '${plan.name}'`);
    }
    returnedScores.set(label, score);
  }
  if (plan.labels.some((label) => !returnedScores.has(label))) {
    throw new Error(`The local NLI model omitted an answer label for '${plan.name}'`);
  }

  const probabilities = validateProbabilities(Object.fromEntries(
    plan.keys.map((key, index) => [key, returnedScores.get(plan.labels[index]!)!]),
  ));
  const confidence = maxProbability(probabilities);
  const metadata = {
    confidence,
    confidenceSource: "maximum-probability" as const,
    calibration: "uncalibrated-estimate" as const,
  };

  if (plan.question.type === "choice") {
    const choice = Object.entries(probabilities).sort((left, right) => right[1] - left[1])[0]?.[0] ?? plan.keys[0]!;
    return { type: "choice", choice, probabilities, ...metadata };
  }
  if (plan.question.type === "score") {
    const score = plan.keys.reduce((total, key) => total + Number(key) * (probabilities[key] ?? 0), 0);
    return { type: "score", score, probabilities, ...metadata };
  }
  const noul = probabilities.true ?? 0.5;
  return { type: "noul", noul, probabilities: { true: noul, false: 1 - noul }, ...metadata };
}

export class SemanticNliProvider implements DecisionProvider {
  readonly id = "semantic-nli";
  readonly model: string;
  readonly device: DeviceType;
  private readonly fastModel: SemanticLocalProvider;

  constructor(
    model = process.env.AGENT_DECISION_NLI_MODEL ?? "Xenova/nli-deberta-v3-small",
    device = process.env.AGENT_DECISION_DEVICE ?? "cpu",
    fastModel = process.env.AGENT_DECISION_FAST_MODEL ?? process.env.AGENT_DECISION_MODEL ?? "Xenova/all-MiniLM-L6-v2",
  ) {
    this.model = model;
    this.device = resolveDevice(device);
    this.fastModel = new SemanticLocalProvider(fastModel, this.device);
  }

  async warmup() {
    const start = performance.now();
    const classifier = await getPipeline(this.model, this.device);
    await classifier("Question: Is local inference enabled? Context: This warm-up uses synthetic text.", ["yes", "no"], {
      hypothesis_template: "The correct answer is {}.",
    });
    return { provider: this.id, model: this.model, latencyMs: Math.round(performance.now() - start) };
  }

  async decide(request: DecisionRequest): Promise<DecisionResult> {
    const plans = Object.entries(request.questions).map(([name, question]) => planQuestion(name, question));
    const hypothesisCount = plans.reduce((total, plan) => total + plan.labels.length, 0);
    if (hypothesisCount > MAX_NLI_HYPOTHESES_PER_REQUEST) {
      return this.fastModel.decide(request);
    }

    const start = performance.now();
    const classifier = await getPipeline(this.model, this.device);
    const state = serializeState(request.state).slice(0, 8_000);
    const answers = Object.create(null) as Record<string, DecisionAnswer>;
    for (const plan of plans) {
      const result = await classifier(`Context: ${state}\nQuestion: ${plan.question.instructions}`, plan.labels, {
        hypothesis_template: plan.hypothesisTemplate,
      });
      answers[plan.name] = answerFor(plan, result);
    }

    const latencyMs = performance.now() - start;
    for (const answer of Object.values(answers)) answer.latencyMs = latencyMs;
    return { provider: this.id, model: this.model, latencyMs, answers };
  }
}

export function resetSemanticNliPipelineForTests(): void {
  sharedPipelines.clear();
}
