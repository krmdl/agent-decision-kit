import { describe, expect, it } from "vitest";
import { DecisionRequestSchema } from "../src/core/types.js";
import { extractFromCandidates, pruneContext, pruneContextWithProvider, routeModel, reviewDiff, screenText, verifyCompletion } from "../src/workflows.js";
import type { DecisionProvider, DecisionRequest, DecisionResult } from "../src/core/types.js";

describe("decision request schema", () => {
  it("accepts choice, score, and noul questions in one batch", () => {
    const request = DecisionRequestSchema.parse({
      state: "The relevant files are in src/.",
      questions: {
        file: { type: "choice", instructions: "Pick a file", criteria: { a: "core", b: "browser" } },
        risk: { type: "score", instructions: "Score risk", criteria: ["low", "medium", "high"] },
        safe: { type: "noul", instructions: "Is this safe?" },
      },
    });
    expect(Object.keys(request.questions)).toHaveLength(3);
  });

  it("rejects more than eight questions and choices with fewer than two options", () => {
    const tooMany = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`q${index}`, { type: "noul", instructions: "Check" }]));
    expect(() => DecisionRequestSchema.parse({ state: "x", questions: tooMany })).toThrow();
    expect(() => DecisionRequestSchema.parse({ state: "x", questions: { q: { type: "choice", instructions: "Pick", criteria: { only: "one" } } } })).toThrow();
  });
});

describe("local workflow helpers", () => {
  it("prunes under budget and preserves requested strings verbatim", () => {
    const exact = "ERROR: E_AUTH_REQUIRED at C:\\repo\\src\\client.ts:42";
    const result = pruneContext(`unrelated line\n${exact}\nmore unrelated content\n`, 80, [exact]);
    expect(result.retainedVerbatim).toBe(true);
    expect(result.text).toContain(exact);
    expect(result.outputChars).toBeLessThanOrEqual(80);
  });

  it("preserves a retained string that crosses line boundaries", () => {
    const exact = "ECONNREFUSED 127.0.0.1:5432\n    at connect (src/db.ts:18)";
    const result = pruneContext(`header\n${exact}\nfooter\n`, 120, [exact]);
    expect(result.retainedVerbatim).toBe(true);
    expect(result.text).toContain(exact);
    expect(result.outputChars).toBeLessThanOrEqual(120);
  });

  it("semantically ranks bounded chunks while preserving retained and selected source text exactly", async () => {
    const provider: DecisionProvider = {
      id: "fixture-ranker",
      model: "fixture-choice",
      async decide(request) {
        const [name, question] = Object.entries(request.questions)[0]!;
        if (question.type !== "choice") throw new Error("Expected one bounded choice question");
        const match = Object.entries(question.criteria).find(([, description]) => description.includes("TARGET:"));
        if (!match) throw new Error("Expected the target chunk among the bounded candidates");
        const probabilities = Object.fromEntries(Object.keys(question.criteria).map((label) => [label, label === match[0] ? 0.95 : 0.05 / (Object.keys(question.criteria).length - 1)]));
        return {
          provider: this.id,
          model: this.model,
          latencyMs: 7,
          answers: { [name]: { type: "choice", choice: match[0], probabilities, confidence: 0.95, confidenceSource: "provider-reported", calibration: "uncalibrated-estimate" } },
        };
      },
    };
    const pinned = "PINNED: ERROR at C:\\repo\\src\\db.ts:42\n";
    const target = "TARGET: database connection refused at 127.0.0.1:5432\n";
    const input = `${pinned}NOISE: stale output and unrelated details\n${target}NOISE: async function export return\n`;
    const result = await pruneContextWithProvider(input, pinned.length + target.length, [pinned.trimEnd()], "Which chunk explains the database failure?", provider);

    expect(result.text).toBe(`${pinned}${target}`);
    expect(result.retainedVerbatim).toBe(true);
    expect(result.outputChars).toBeLessThanOrEqual(result.budgetChars);
    expect(result.omittedChunks).toBe(2);
    expect(result.ranking).toMatchObject({ method: "provider-probability-ranking", candidateCount: 3, provider: "fixture-ranker", model: "fixture-choice", latencyMs: 7, calibration: "uncalibrated-estimate" });
  });

  it("fails clearly when a retained string is missing or its source lines do not fit", () => {
    expect(() => pruneContext("only available text\n", 100, ["missing path.ts:42"])).toThrow(/does not occur verbatim/);
    expect(() => pruneContext("prefix RETAINED suffix\n", "RETAINED".length, ["RETAINED"])).toThrow(/exceed the context budget/);
  });

  it("returns transparent model routing and catches a simple risky diff", () => {
    expect(routeModel("fix this typo", { available: ["fast", "reasoning"] }).route).toBe("fast");
    expect(routeModel("review the security architecture", { available: ["fast", "reasoning"] }).route).toBe("reasoning");
    expect(reviewDiff('+const apiKey = "sk-supersecretvalue";').findings.map((item) => item.id)).toContain("secrets");
  });

  it("does not claim completion without overlapping evidence", () => {
    expect(verifyCompletion("The browser action is safe", [{ path: "src/x.ts", excerpt: "export const value = 1" }]).status).toBe("unverified");
  });

  it("distinguishes text overlap from caller-reported test exit status", () => {
    const passed = verifyCompletion("The browser change is implemented and all tests passed", [
      { path: "npm test", kind: "test-result", exitCode: 0, excerpt: "66 tests passed" },
    ]);
    expect(passed).toMatchObject({ status: "text-overlap-only", testClaimStatus: "reported-success" });
    expect(passed.overlappingEvidence[0]).toMatchObject({ path: "npm test", kind: "test-result", exitCode: 0, matchedClaimTerms: expect.arrayContaining(["tests", "passed"]) });
    expect(passed).not.toHaveProperty("verifiedEvidence");

    const missing = verifyCompletion("All browser tests passed", []);
    expect(missing.testClaimStatus).toBe("missing-reported-test-result");

    const failed = verifyCompletion("All browser tests passed", [
      { path: "npm test", kind: "test-result", exitCode: 1, excerpt: "test process exited unsuccessfully" },
    ]);
    expect(failed.testClaimStatus).toBe("reported-failure");
  });
});

class FakeProvider implements DecisionProvider {
  readonly id = "fake-test";
  readonly model = "fixture";
  async decide(request: DecisionRequest): Promise<DecisionResult> {
    const answers: DecisionResult["answers"] = {};
    for (const [key, question] of Object.entries(request.questions)) {
      if (question.type === "choice") {
        const labels = Object.keys(question.criteria);
        const probabilities = Object.fromEntries(labels.map((label) => [label, label === "value_1" ? 0.8 : 0.2 / (labels.length - 1)]));
        answers[key] = { type: "choice", choice: labels[0]!, probabilities, confidence: 0.8, confidenceSource: "maximum-probability", calibration: "uncalibrated-estimate" };
      } else if (question.type === "noul") answers[key] = { type: "noul", noul: 0.7, probabilities: { true: 0.7, false: 0.3 }, confidence: 0.7, confidenceSource: "maximum-probability", calibration: "uncalibrated-estimate" };
      else answers[key] = { type: "score", score: 1, confidenceSource: "unavailable", calibration: "uncalibrated-estimate" };
    }
    return { provider: this.id, model: this.model, latencyMs: 1, answers };
  }
}

describe("batched semantic workflows", () => {
  it("extracts only a caller-provided candidate and screens in one provider call", async () => {
    const provider = new FakeProvider();
    const extracted = await extractFromCandidates("Kerem owns the repo", [{ name: "owner", instructions: "Select the owner", candidates: ["Kerem", "Ada"] }], provider);
    expect(extracted.fields[0]?.value).toBe("Kerem");
    const screened = await screenText("sample", ["contains a link", "contains a key"], provider);
    expect(screened.matches).toHaveLength(2);
    expect(screened.note.toLowerCase()).toContain("not a moderation");
  });
});
