import { afterEach, describe, expect, it, vi } from "vitest";

const { mockPipeline } = vi.hoisted(() => ({ mockPipeline: vi.fn() }));
vi.mock("@huggingface/transformers", () => ({ pipeline: mockPipeline }));

import { SemanticLocalProvider, resetSemanticPipelineForTests } from "../src/providers/semantic-local.js";

afterEach(() => {
  resetSemanticPipelineForTests();
  mockPipeline.mockReset();
});

describe("SemanticLocalProvider score answers", () => {
  it("returns a finite expected ordinal score with positional probabilities", async () => {
    mockPipeline.mockResolvedValue(async (inputs: string[]) => ({
      tolist: () => inputs.map((_input, index) => {
        if (index === 1) return [0, 1, 0];
        if (index === 2) return [0, 0, 1];
        return [1, 0, 0];
      }),
    }));

    const provider = new SemanticLocalProvider();
    const result = await provider.decide({
      state: "Review the result",
      questions: {
        quality: {
          type: "score",
          criteria: ["poor", "average", "excellent"],
          instructions: "How good is this result?",
        },
      },
    });

    const answer = result.answers.quality;
    expect(answer?.type).toBe("score");
    if (answer?.type !== "score") throw new Error("Expected score answer");
    expect(Number.isFinite(answer.score)).toBe(true);
    expect(answer.score).toBeGreaterThanOrEqual(0);
    expect(answer.score).toBeLessThanOrEqual(2);
    expect(answer.score).toBeGreaterThan(1.5);
    expect(Object.keys(answer.probabilities)).toEqual(["0", "1", "2"]);
    expect(Object.values(answer.probabilities).every(Number.isFinite)).toBe(true);
    expect(Object.values(answer.probabilities).reduce((sum, probability) => sum + probability, 0)).toBeCloseTo(1);
  });

  it("keeps ordinal probabilities distinct when score labels repeat", async () => {
    mockPipeline.mockResolvedValue(async (inputs: string[]) => ({
      tolist: () => inputs.map((_input, index) => index === 2 ? [0, 1, 0] : [1, 0, 0]),
    }));

    const provider = new SemanticLocalProvider();
    const result = await provider.decide({
      state: "Review the result",
      questions: {
        quality: {
          type: "score",
          criteria: ["same", "same", "high"],
          instructions: "How good is this result?",
        },
      },
    });

    const answer = result.answers.quality;
    expect(answer?.type).toBe("score");
    if (answer?.type !== "score") throw new Error("Expected score answer");
    expect(Object.keys(answer.probabilities)).toEqual(["0", "1", "2"]);
    expect(Number.isFinite(answer.score)).toBe(true);
    expect(answer.score).toBeGreaterThanOrEqual(0);
    expect(answer.score).toBeLessThanOrEqual(2);
  });
});
