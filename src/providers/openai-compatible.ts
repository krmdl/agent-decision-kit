import type { DecisionProvider, DecisionRequest, DecisionResult, DecisionAnswer } from "../core/types.js";
import { maxProbability, serializeState, validateProbabilities } from "../core/types.js";

type RawAnswer = {
  type?: string;
  choice?: unknown;
  score?: unknown;
  noul?: unknown;
  confidence?: unknown;
  probabilities?: unknown;
};

function providerConfidence(raw: unknown, name: string): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 1) {
    throw new Error(`Provider returned an invalid confidence for '${name}'`);
  }
  return raw;
}

export interface OpenAICompatibleOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

export class OpenAICompatibleProvider implements DecisionProvider {
  readonly id = "openai-compatible";
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;

  constructor(options: OpenAICompatibleOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.AGENT_DECISION_BASE_URL ?? "http://127.0.0.1:11434/v1").replace(/\/+$/, "");
    this.apiKey = options.apiKey ?? process.env.AGENT_DECISION_API_KEY;
    this.model = options.model ?? process.env.AGENT_DECISION_CHAT_MODEL ?? "qwen2.5:3b";
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async decide(request: DecisionRequest): Promise<DecisionResult> {
    const start = performance.now();
    const expected = Object.create(null) as Record<string, string>;
    for (const [name, question] of Object.entries(request.questions)) {
      expected[name] = question.type;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: "You are a typed decision function. Return only a JSON object with an `answers` object. For each requested question return its exact type, the selected choice or numeric score or noul probability, probabilities when possible, and a confidence estimate in [0,1]. Never invent option labels. Do not execute tools or generate prose.",
            },
            {
              role: "user",
              content: JSON.stringify({ state: request.state, questions: request.questions, expectedTypes: expected }),
            },
          ],
        }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Provider returned HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
      }
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new Error("Provider returned an empty decision response");
      const parsed = JSON.parse(content) as { answers?: Record<string, RawAnswer> };
      if (!parsed.answers || typeof parsed.answers !== "object") throw new Error("Response must include an answers object");

      const answers = Object.create(null) as Record<string, DecisionAnswer>;
      for (const [name, question] of Object.entries(request.questions)) {
        const raw = parsed.answers[name];
        if (!raw || raw.type !== question.type) throw new Error(`Missing or invalid answer for question '${name}'`);
        const sourceProbabilities = raw.probabilities && typeof raw.probabilities === "object"
          ? raw.probabilities as Record<string, number>
          : undefined;
        const confidence = providerConfidence(raw.confidence, name);
        if (question.type === "choice") {
          const choice = String(raw.choice ?? "");
          if (!Object.hasOwn(question.criteria, choice)) throw new Error(`Provider chose unknown option '${choice}' for '${name}'`);
          const probabilities = sourceProbabilities
            ? validateProbabilities(Object.fromEntries(Object.keys(question.criteria).map((key) => [key, Number(sourceProbabilities[key] ?? 0)])))
            : undefined;
          answers[name] = {
            type: "choice", choice,
            ...(probabilities ? { probabilities, confidence: confidence ?? maxProbability(probabilities) } : confidence === undefined ? {} : { confidence }),
            confidenceSource: confidence !== undefined ? "provider-reported" : probabilities ? "maximum-probability" : "unavailable",
            calibration: "uncalibrated-estimate",
          };
        } else if (question.type === "score") {
          const score = Number(raw.score);
          if (!Number.isFinite(score) || score < 0 || score > question.criteria.length - 1) throw new Error(`Provider returned an out-of-range score for '${name}'`);
          const probabilities = sourceProbabilities
            ? validateProbabilities(Object.fromEntries(question.criteria.map((_, index) => [String(index), Number(sourceProbabilities[String(index)] ?? 0)])))
            : undefined;
          answers[name] = {
            type: "score", score,
            ...(probabilities ? { probabilities, confidence: confidence ?? maxProbability(probabilities) } : confidence === undefined ? {} : { confidence }),
            confidenceSource: confidence !== undefined ? "provider-reported" : probabilities ? "maximum-probability" : "unavailable",
            calibration: "uncalibrated-estimate",
          };
        } else {
          const noul = Number(raw.noul);
          if (!Number.isFinite(noul) || noul < 0 || noul > 1) throw new Error(`Provider returned an invalid yes/no probability for '${name}'`);
          answers[name] = {
            type: "noul", noul, probabilities: { true: noul, false: 1 - noul },
            ...(confidence === undefined ? { confidence: Math.max(noul, 1 - noul) } : { confidence }),
            confidenceSource: confidence !== undefined ? "provider-reported" : "maximum-probability",
            calibration: "uncalibrated-estimate",
          };
        }
      }
      const latencyMs = performance.now() - start;
      for (const answer of Object.values(answers)) answer.latencyMs = latencyMs;
      return { provider: this.id, model: this.model, latencyMs, answers };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error(`Provider timed out after ${this.timeoutMs} ms`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
