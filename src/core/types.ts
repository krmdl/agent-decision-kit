import { z } from "zod";

export const MAX_QUESTIONS = 8;
export const MAX_CHOICE_OPTIONS = 255;
export const MAX_SCORE_LEVELS = 10;

export const ChoiceQuestionSchema = z.object({
  type: z.literal("choice"),
  instructions: z.string().min(1),
  criteria: z.record(z.string(), z.string()).refine((items) => Object.keys(items).length >= 2, {
    message: "Choice needs at least two options",
  }).refine((items) => Object.keys(items).length <= MAX_CHOICE_OPTIONS, {
    message: `Choice supports at most ${MAX_CHOICE_OPTIONS} options`,
  }),
});

export const ScoreQuestionSchema = z.object({
  type: z.literal("score"),
  instructions: z.string().min(1),
  criteria: z.array(z.string().min(1)).min(2).max(MAX_SCORE_LEVELS),
});

export const NoulQuestionSchema = z.object({
  type: z.literal("noul"),
  instructions: z.string().min(1),
});

export const DecisionQuestionSchema = z.discriminatedUnion("type", [
  ChoiceQuestionSchema,
  ScoreQuestionSchema,
  NoulQuestionSchema,
]);

export const DecisionRequestSchema = z.object({
  state: z.union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())]),
  questions: z.record(z.string(), DecisionQuestionSchema).refine((items) => Object.keys(items).length >= 1, {
    message: "At least one question is required",
  }).refine((items) => Object.keys(items).length <= MAX_QUESTIONS, {
    message: `At most ${MAX_QUESTIONS} questions can be evaluated per request`,
  }),
});

export type ChoiceQuestion = z.infer<typeof ChoiceQuestionSchema>;
export type ScoreQuestion = z.infer<typeof ScoreQuestionSchema>;
export type NoulQuestion = z.infer<typeof NoulQuestionSchema>;
export type DecisionQuestion = z.infer<typeof DecisionQuestionSchema>;
export type DecisionRequest = z.infer<typeof DecisionRequestSchema>;

export type CalibrationStatus = "provider-calibrated" | "posthoc-calibrated" | "uncalibrated-estimate" | "unavailable";

export interface AnswerMetadata {
  confidence?: number;
  calibration: CalibrationStatus;
  latencyMs?: number;
}

export interface ChoiceAnswer extends AnswerMetadata {
  type: "choice";
  choice: string;
  probabilities?: Record<string, number>;
}

export interface ScoreAnswer extends AnswerMetadata {
  type: "score";
  score: number;
  probabilities?: Record<string, number>;
}

export interface NoulAnswer extends AnswerMetadata {
  type: "noul";
  noul: number;
  probabilities?: { true: number; false: number };
}

export type DecisionAnswer = ChoiceAnswer | ScoreAnswer | NoulAnswer;

export interface DecisionResult {
  provider: string;
  model: string;
  latencyMs: number;
  answers: Record<string, DecisionAnswer>;
}

export interface DecisionProvider {
  readonly id: string;
  readonly model: string;
  decide(request: DecisionRequest): Promise<DecisionResult>;
}

export function serializeState(state: DecisionRequest["state"]): string {
  if (typeof state === "string") return state;
  return JSON.stringify(state);
}

export function validateProbabilities(values: Record<string, number>): Record<string, number> {
  const clean: Record<string, number> = {};
  let total = 0;
  for (const [key, raw] of Object.entries(values)) {
    const value = Number.isFinite(raw) ? Math.max(0, raw) : 0;
    clean[key] = value;
    total += value;
  }
  if (total <= 0) {
    const count = Object.keys(clean).length || 1;
    const uniform = 1 / count;
    for (const key of Object.keys(clean)) clean[key] = uniform;
    return clean;
  }
  for (const key of Object.keys(clean)) clean[key] = clean[key]! / total;
  return clean;
}

export function softmax(scores: number[], temperature = 0.18): number[] {
  if (scores.length === 0) return [];
  const max = Math.max(...scores);
  const scaled = scores.map((score) => Math.exp((score - max) / Math.max(temperature, 0.01)));
  const sum = scaled.reduce((total, value) => total + value, 0);
  return scaled.map((value) => value / sum);
}

export function maxProbability(probabilities: Record<string, number>): number {
  return Math.max(0, ...Object.values(probabilities));
}
