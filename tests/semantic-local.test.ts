import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPipeline } = vi.hoisted(() => ({ mockPipeline: vi.fn() }));
vi.mock("@huggingface/transformers", () => ({ pipeline: mockPipeline }));

import { SemanticLocalProvider, resetSemanticPipelineForTests } from "../src/providers/semantic-local.js";

const decisionRequest = {
  state: "A small synthetic state.",
  questions: { answer: { type: "choice" as const, instructions: "Choose one", criteria: { first: "First", second: "Second" } } },
};

function mockExtractor(endProfiling = vi.fn()) {
  const extractor = vi.fn(async () => ({ tolist: () => [[1, 0], [1, 0], [0, 1]] }));
  Object.assign(extractor, { model: { sessions: { model: { endProfiling } } } });
  return { extractor, endProfiling };
}

beforeEach(() => {
  resetSemanticPipelineForTests();
  mockPipeline.mockReset();
});

afterEach(() => {
  resetSemanticPipelineForTests();
  vi.unstubAllEnvs();
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

  it("caches one embedding pipeline per model and device", async () => {
    mockPipeline.mockResolvedValue(async (inputs: string[]) => ({ tolist: () => inputs.map(() => [1, 0]) }));
    const request = { state: "Check this", questions: { ok: { type: "noul" as const, instructions: "Is this okay?" } } };

    await new SemanticLocalProvider("model-a", "cpu").decide(request);
    await new SemanticLocalProvider("model-a", "dml").decide(request);
    await new SemanticLocalProvider("model-a", "cpu").decide(request);

    expect(mockPipeline).toHaveBeenCalledTimes(2);
    expect(mockPipeline.mock.calls.map((call) => call[1])).toEqual(["model-a", "model-a"]);
    expect(mockPipeline.mock.calls.map((call) => call[2])).toEqual([
      { dtype: "q8", device: "cpu" },
      { dtype: "q8", device: "dml" },
    ]);
  });

  it("rejects an unknown inference device with the supported choices", () => {
    expect(() => new SemanticLocalProvider("model-a", "tensor-core"))
      .toThrow(/Unsupported AGENT_DECISION_DEVICE .*auto, gpu, cpu, wasm, webgpu, cuda, dml, coreml/);
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

describe("local decision ONNX profiling", () => {
  it("keeps profiling disabled unless an explicit profile prefix is set", async () => {
    const { extractor } = mockExtractor();
    mockPipeline.mockResolvedValue(extractor);
    const provider = new SemanticLocalProvider("fixture-model", "cpu");

    await provider.decide(decisionRequest);
    await provider.endProfiling();

    expect(mockPipeline).toHaveBeenCalledWith("feature-extraction", "fixture-model", { dtype: "q8", device: "cpu" });
  });

  it("captures the configured ONNX Runtime profile and ends every model session", async () => {
    const profilePrefix = "C:/temporary/adk-profile";
    const { extractor, endProfiling } = mockExtractor();
    vi.stubEnv("AGENT_DECISION_ONNX_PROFILE_PREFIX", profilePrefix);
    mockPipeline.mockResolvedValue(extractor);
    const provider = new SemanticLocalProvider("fixture-model", "dml");

    await provider.decide(decisionRequest);
    await provider.endProfiling();

    expect(mockPipeline).toHaveBeenCalledWith("feature-extraction", "fixture-model", {
      dtype: "q8",
      device: "dml",
      session_options: { enableProfiling: true, profileFilePrefix: profilePrefix },
    });
    expect(endProfiling).toHaveBeenCalledOnce();
  });
});
