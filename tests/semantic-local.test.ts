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
    expect(answer.confidenceSource).toBe("maximum-probability");
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

  it("caches one embedding pipeline per configured model", async () => {
    mockPipeline.mockResolvedValue(async (inputs: string[]) => ({ tolist: () => inputs.map(() => [1, 0]) }));
    const request = { state: "Check this", questions: { ok: { type: "noul" as const, instructions: "Is this okay?" } } };

    await new SemanticLocalProvider("model-a").decide(request);
    await new SemanticLocalProvider("model-b").decide(request);

    expect(mockPipeline).toHaveBeenCalledTimes(2);
    expect(mockPipeline.mock.calls.map((call) => call[1])).toEqual(["model-a", "model-b"]);
  });

  it("retries pipeline initialization after a transient failure", async () => {
    mockPipeline
      .mockRejectedValueOnce(new Error("temporary model download failure"))
      .mockResolvedValueOnce(async (inputs: string[]) => ({ tolist: () => inputs.map(() => [1, 0]) }));
    const provider = new SemanticLocalProvider("retry-model");
    const request = { state: "Check this", questions: { ok: { type: "noul" as const, instructions: "Is this okay?" } } };

    await expect(provider.decide(request)).rejects.toThrow("temporary model download failure");
    await expect(provider.decide(request)).resolves.toMatchObject({ provider: "semantic-local", model: "retry-model" });
    expect(mockPipeline).toHaveBeenCalledTimes(2);
  });

  it("warms the local model in the current provider instance for a later decision", async () => {
    const extractor = vi.fn(async (inputs: string[]) => ({ tolist: () => inputs.map(() => [1, 0]) }));
    mockPipeline.mockResolvedValue(extractor);
    const provider = new SemanticLocalProvider("warm-model");

    await expect(provider.warmup()).resolves.toMatchObject({ provider: "semantic-local", model: "warm-model" });
    await provider.decide({ state: "Check this", questions: { ok: { type: "noul", instructions: "Is this okay?" } } });

    expect(mockPipeline).toHaveBeenCalledTimes(1);
    expect(extractor).toHaveBeenNthCalledWith(1, ["Agent Decision Kit local decision warm-up."], { pooling: "mean", normalize: true });
  });
});
