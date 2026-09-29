import type { DecisionProvider, DecisionRequest, DecisionResult, DecisionAnswer } from "../core/types.js";
import { maxProbability, validateProbabilities } from "../core/types.js";

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
  confidence?: number;
  probabilities?: Record<string, number>;
};

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
        if (question.type === "choice") {
          if (!raw.choice || !(raw.choice in question.criteria)) throw new Error(`Jev returned an unknown choice for '${name}'`);
          const probabilities = raw.probabilities
            ? validateProbabilities(Object.fromEntries(Object.keys(question.criteria).map((key) => [key, Number(raw.probabilities?.[key] ?? 0)])))
            : undefined;
          answers[name] = {
            type: "choice", choice: raw.choice,
            ...(probabilities ? { probabilities } : {}),
            ...(typeof raw.confidence === "number" ? { confidence: raw.confidence } : probabilities ? { confidence: maxProbability(probabilities) } : {}),
            calibration: "provider-calibrated",
          };
        } else if (question.type === "score") {
          if (typeof raw.score !== "number" || raw.score < 0 || raw.score > question.criteria.length - 1) throw new Error(`Jev returned an invalid score for '${name}'`);
          const probabilities = raw.probabilities
            ? validateProbabilities(Object.fromEntries(question.criteria.map((_, index) => [String(index), Number(raw.probabilities?.[String(index)] ?? 0)])))
            : undefined;
          answers[name] = {
            type: "score", score: raw.score,
            ...(probabilities ? { probabilities } : {}),
            ...(typeof raw.confidence === "number" ? { confidence: raw.confidence } : probabilities ? { confidence: maxProbability(probabilities) } : {}),
            calibration: "provider-calibrated",
          };
        } else {
          if (typeof raw.noul !== "number" || raw.noul < 0 || raw.noul > 1) throw new Error(`Jev returned an invalid yes/no result for '${name}'`);
          answers[name] = {
            type: "noul", noul: raw.noul, probabilities: { true: raw.noul, false: 1 - raw.noul },
            confidence: Math.max(raw.noul, 1 - raw.noul), calibration: "provider-calibrated",
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
