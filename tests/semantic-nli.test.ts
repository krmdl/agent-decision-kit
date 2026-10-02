import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPipeline } = vi.hoisted(() => ({ mockPipeline: vi.fn() }));
vi.mock("@huggingface/transformers", () => ({ pipeline: mockPipeline }));

import { SemanticNliProvider, resetSemanticNliPipelineForTests } from "../src/providers/semantic-nli.js";
import { resetSemanticPipelineForTests } from "../src/providers/semantic-local.js";
import { createProvider } from "../src/providers/index.js";

beforeEach(() => {
  resetSemanticNliPipelineForTests();
  resetSemanticPipelineForTests();
  mockPipeline.mockReset();
});

afterEach(() => {
  resetSemanticNliPipelineForTests();
  resetSemanticPipelineForTests();
  vi.unstubAllEnvs();
});

describe("SemanticNliProvider", () => {
  it("is available through the public provider selector", () => {
    expect(createProvider("semantic-nli")).toBeInstanceOf(SemanticNliProvider);
    expect(createProvider("local-nli")).toBeInstanceOf(SemanticNliProvider);
    expect(() => createProvider("unknown-provider")).toThrow(/semantic-nli/);
  });

  it("maps zero-shot labels to typed Choice, Score, and yes/no answers", async () => {
    const classifier = vi.fn()
      .mockResolvedValueOnce({
        labels: ["second: Second", "first: First"],
        scores: [0.8, 0.2],
      })
      .mockResolvedValueOnce({
        labels: ["2: excellent", "1: average", "0: poor"],
        scores: [0.6, 0.3, 0.1],
      })
      .mockResolvedValueOnce({ labels: ["no", "yes"], scores: [0.75, 0.25] });
    mockPipeline.mockResolvedValue(classifier);
    const provider = new SemanticNliProvider("nli-fixture");

    const result = await provider.decide({
      state: "An explicitly synthetic review state.",
      questions: {
        choice: { type: "choice", instructions: "Choose one", criteria: { first: "First", second: "Second" } },
        score: { type: "score", instructions: "Rate quality", criteria: ["poor", "average", "excellent"] },
        approval: { type: "noul", instructions: "Should the action proceed?" },
      },
    });

    expect(mockPipeline).toHaveBeenCalledWith("zero-shot-classification", "nli-fixture", { dtype: "q8", device: "cpu" });
    expect(result.provider).toBe("semantic-nli");
    expect(result.model).toBe("nli-fixture");
    expect(result.answers.choice).toMatchObject({
      type: "choice",
      choice: "second",
      probabilities: { first: 0.2, second: 0.8 },
      confidence: 0.8,
      confidenceSource: "maximum-probability",
      calibration: "uncalibrated-estimate",
    });
    expect(result.answers.score).toMatchObject({
      type: "score",
      score: 1.5,
      probabilities: { "0": 0.1, "1": 0.3, "2": 0.6 },
    });
    expect(result.answers.approval).toMatchObject({
      type: "noul",
      noul: 0.25,
      probabilities: { true: 0.25, false: 0.75 },
    });
    expect(classifier).toHaveBeenCalledTimes(3);
  });

  it("preserves special question and option keys without prototype collisions", async () => {
    mockPipeline.mockResolvedValue(async (_sequence: string, labels: string[]) => ({
      labels: [...labels].reverse(),
      scores: [0.1, 0.9],
    }));
    const provider = new SemanticNliProvider("nli-special-key-fixture");
    const questions = JSON.parse('{"__proto__":{"type":"choice","instructions":"Choose safely","criteria":{"__proto__":"Special option","other":"Other option"}}}');

    const result = await provider.decide({ state: "synthetic", questions });
    const answer = result.answers["__proto__"];

    expect(answer).toMatchObject({ type: "choice", choice: "__proto__" });
    expect(answer?.type === "choice" && Object.hasOwn(answer.probabilities ?? {}, "__proto__")).toBe(true);
    expect(answer?.type === "choice" && answer.probabilities?.["__proto__"]).toBe(0.9);
  });

  it("falls back to the fast local provider for wide choice requests without loading NLI", async () => {
    mockPipeline.mockResolvedValue(async (inputs: string[]) => ({
      tolist: () => inputs.map(() => [1, 0]),
    }));
    const criteria = Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`option-${index}`, `Option ${index}`]));
    const provider = new SemanticNliProvider("nli-fixture", "cpu", "fast-fixture");

    const result = await provider.decide({
      state: "A large synthetic choice set.",
      questions: { choice: { type: "choice", instructions: "Choose one", criteria } },
    });

    expect(mockPipeline).toHaveBeenCalledOnce();
    expect(mockPipeline).toHaveBeenCalledWith("feature-extraction", "fast-fixture", { dtype: "q8", device: "cpu" });
    expect(result.provider).toBe("semantic-local");
    expect(result.model).toBe("fast-fixture");
    expect(result.answers.choice).toMatchObject({ type: "choice", choice: "option-0" });
  });

  it("caches the zero-shot pipeline per model and device", async () => {
    mockPipeline.mockResolvedValue(async (_sequence: string, labels: string[]) => ({ labels, scores: [0.6, 0.4] }));
    const request = { state: "synthetic", questions: { answer: { type: "noul" as const, instructions: "Is this safe?" } } };

    await new SemanticNliProvider("nli-a", "cpu").decide(request);
    await new SemanticNliProvider("nli-a", "dml").decide(request);
    await new SemanticNliProvider("nli-a", "cpu").decide(request);

    expect(mockPipeline).toHaveBeenCalledTimes(2);
    expect(mockPipeline.mock.calls.map((call) => call[0])).toEqual(["zero-shot-classification", "zero-shot-classification"]);
    expect(mockPipeline.mock.calls.map((call) => call[2])).toEqual([
      { dtype: "q8", device: "cpu" },
      { dtype: "q8", device: "dml" },
    ]);
  });

  it("enables ONNX Runtime profiling and ends every NLI session when requested", async () => {
    vi.stubEnv("AGENT_DECISION_ONNX_PROFILE_PREFIX", "C:/tmp/nli-profile");
    const endProfiling = vi.fn();
    const classifier = Object.assign(
      vi.fn(async (_sequence: string, labels: string[]) => ({ labels, scores: [0.7, 0.3] })),
      { model: { sessions: { classifier: { endProfiling } } } },
    );
    mockPipeline.mockResolvedValue(classifier);
    const provider = new SemanticNliProvider("nli-profile-fixture");

    await provider.decide({
      state: "synthetic profile request",
      questions: { answer: { type: "noul", instructions: "Is the local provider enabled?" } },
    });
    await provider.endProfiling();

    expect(mockPipeline).toHaveBeenCalledWith("zero-shot-classification", "nli-profile-fixture", {
      dtype: "q8",
      device: "cpu",
      session_options: { enableProfiling: true, profileFilePrefix: "C:/tmp/nli-profile" },
    });
    expect(endProfiling).toHaveBeenCalledOnce();
  });

  it("retries model initialization after a transient failure", async () => {
    mockPipeline
      .mockRejectedValueOnce(new Error("temporary model download failure"))
      .mockResolvedValueOnce(async (_sequence: string, labels: string[]) => ({ labels, scores: [0.8, 0.2] }));
    const provider = new SemanticNliProvider("retry-model");
    const request = { state: "synthetic", questions: { answer: { type: "noul" as const, instructions: "Is this safe?" } } };

    await expect(provider.decide(request)).rejects.toThrow("temporary model download failure");
    await expect(provider.decide(request)).resolves.toMatchObject({ provider: "semantic-nli", model: "retry-model" });
    expect(mockPipeline).toHaveBeenCalledTimes(2);
  });

  it("rejects incomplete or malformed candidate distributions", async () => {
    mockPipeline.mockResolvedValue(async (_sequence: string, labels: string[]) => ({ labels: [labels[0]!], scores: [1] }));
    const provider = new SemanticNliProvider("malformed-model");

    await expect(provider.decide({
      state: "synthetic",
      questions: { answer: { type: "noul", instructions: "Is this safe?" } },
    })).rejects.toThrow(/incomplete label distribution/);
  });
});
