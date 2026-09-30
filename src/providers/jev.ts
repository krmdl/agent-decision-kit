import type { DecisionProvider, DecisionRequest, DecisionResult, DecisionAnswer } from "../core/types.js";
import { maxProbability } from "../core/types.js";

export interface JevProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

type JevRawAnswer = {
  type?: string;
  choice?: string;
  score?: number;
  noul?: number;
  confidence?: unknown;
  probabilities?: unknown;
};

function jevProbabilities(raw: unknown, expectedKeys: string[], name: string): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Jev returned missing or invalid probabilities for '${name}'`);
  }

  const values = raw as Record<string, unknown>;
  const keys = Object.keys(values);
  if (keys.length !== expectedKeys.length || keys.some((key) => !expectedKeys.includes(key))) {
    throw new Error(`Jev returned incomplete or unexpected probability keys for '${name}'`);
  }

  const probabilities: Record<string, number> = {};
  let total = 0;
  for (const key of expectedKeys) {
    const value = values[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`Jev returned an invalid probability for '${name}.${key}'`);
    }
    probabilities[key] = value;
    total += value;
  }

  // The TypeSafe API describes these values as summing to approximately 1.
  // Allow small serialization/rounding drift, but reject malformed distributions.
  if (total <= 0 || Math.abs(total - 1) > 0.05) {
    throw new Error(`Jev returned probabilities that do not sum approximately to 1 for '${name}'`);
  }
  for (const key of expectedKeys) probabilities[key] = probabilities[key]! / total;
  return probabilities;
}

function confidenceMetadata(raw: unknown, fallback: number | undefined, name: string) {
  if (raw !== undefined && raw !== null) {
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 1) {
      throw new Error(`Jev returned an invalid confidence for '${name}'`);
    }
    return { confidence: raw, confidenceSource: "provider-reported" as const };
  }
  return fallback === undefined
    ? { confidenceSource: "unavailable" as const }
    : { confidence: fallback, confidenceSource: "maximum-probability" as const };
}

function requiredConfidenceMetadata(raw: unknown, name: string) {
  if (raw === undefined || raw === null) throw new Error(`Jev omitted required confidence for '${name}'`);
  return confidenceMetadata(raw, undefined, name);
}

export class JevProvider implements DecisionProvider {
  readonly id = "jev";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: JevProviderOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY ?? process.env.JEV_API_KEY ?? "";
    if (!this.apiKey) throw new Error("Set TYPESAFE_API_KEY to use the optional Jev provider. TypeSafe may charge for API usage.");
    this.baseUrl = (options.baseUrl ?? process.env.TYPESAFE_BASE_URL ?? "https://api.typesafe.ai").replace(/\/+$/, "");
    this.model = options.model ?? process.env.TYPESAFE_MODEL ?? "jev-latest";
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  async decide(request: DecisionRequest): Promise<DecisionResult> {
    const start = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/v1/systemone`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ model: this.model, ...request }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Jev provider returned HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
      }
      const payload = await response.json() as { model?: string; answers?: Record<string, JevRawAnswer> };
      if (!payload.answers) throw new Error("Jev response did not include answers");
      const answers: Record<string, DecisionAnswer> = {};
      for (const [name, question] of Object.entries(request.questions)) {
        const raw = payload.answers[name];
        if (!raw || raw.type !== question.type) throw new Error(`Jev returned a missing or invalid answer for '${name}'`);
        const confidence = (fallback?: number) => confidenceMetadata(raw.confidence, fallback, name);
        if (question.type === "choice") {
          if (!raw.choice || !Object.hasOwn(question.criteria, raw.choice)) throw new Error(`Jev returned an unknown choice for '${name}'`);
          const probabilities = jevProbabilities(raw.probabilities, Object.keys(question.criteria), name);
          const confidenceFields = requiredConfidenceMetadata(raw.confidence, name);
          answers[name] = {
            type: "choice", choice: raw.choice,
            probabilities,
            ...confidenceFields,
            calibration: "provider-calibrated",
          };
        } else if (question.type === "score") {
          if (typeof raw.score !== "number" || !Number.isFinite(raw.score) || raw.score < 0 || raw.score > question.criteria.length - 1) throw new Error(`Jev returned an invalid score for '${name}'`);
          const probabilities = jevProbabilities(raw.probabilities, question.criteria.map((_, index) => String(index)), name);
          const confidenceFields = requiredConfidenceMetadata(raw.confidence, name);
          answers[name] = {
            type: "score", score: raw.score,
            probabilities,
            ...confidenceFields,
            calibration: "provider-calibrated",
          };
        } else {
          if (typeof raw.noul !== "number" || !Number.isFinite(raw.noul) || raw.noul < 0 || raw.noul > 1) throw new Error(`Jev returned an invalid yes/no result for '${name}'`);
          const confidenceFields = confidence(Math.max(raw.noul, 1 - raw.noul));
          answers[name] = {
            type: "noul", noul: raw.noul, probabilities: { true: raw.noul, false: 1 - raw.noul },
            ...confidenceFields, calibration: "provider-calibrated",
          };
        }
      }
      const latencyMs = performance.now() - start;
      for (const answer of Object.values(answers)) answer.latencyMs = latencyMs;
      return { provider: this.id, model: payload.model ?? this.model, latencyMs, answers };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error(`Jev request timed out after ${this.timeoutMs} ms`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
