import { afterEach, describe, expect, it, vi } from "vitest";
import { JevProvider } from "../src/providers/jev.js";
import type { DecisionRequest } from "../src/core/types.js";

afterEach(() => vi.unstubAllGlobals());

describe("optional Jev API adapter", () => {
  it("uses the documented System One request and maps typed probability answers", async () => {
    const fetchMock = vi.fn(async (_input: URL | RequestInfo, _init?: RequestInit) => new Response(JSON.stringify({
      model: "jev-latest",
      answers: {
        tone: { type: "choice", choice: "calm", confidence: 0.91, probabilities: { calm: 0.91, angry: 0.09 } },
        urgency: { type: "score", score: 1.2, confidence: 0.8, legend: { "0": "low", "1": "mid", "2": "high" }, probabilities: { "0": 0.1, "1": 0.5, "2": 0.4 } },
        trueStatement: { type: "noul", noul: 0.96 },
      },
      usage: { input_tokens: 40, output_tokens: 12 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new JevProvider({ apiKey: "fixture-key", baseUrl: "https://api.typesafe.ai", model: "jev-latest" });
    const request: DecisionRequest = {
      state: "A polite message says the issue is urgent.",
      questions: {
        tone: { type: "choice", instructions: "Pick a tone", criteria: { calm: "Polite", angry: "Hostile" } },
        urgency: { type: "score", instructions: "Rate urgency", criteria: ["low", "mid", "high"] },
        trueStatement: { type: "noul", instructions: "Is the message marked urgent?" },
      },
    };
    const result = await provider.decide(request);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.typesafe.ai/v1/systemone");
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(sent).toMatchObject({ model: "jev-latest", state: request.state, questions: request.questions });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: "Bearer fixture-key" });
    expect(result.answers.tone).toMatchObject({ choice: "calm", confidence: 0.91, confidenceSource: "provider-reported", calibration: "provider-calibrated" });
    expect(result.answers.urgency).toMatchObject({ score: 1.2, confidenceSource: "provider-reported", calibration: "provider-calibrated" });
    expect(result.answers.trueStatement).toMatchObject({ noul: 0.96, confidenceSource: "maximum-probability", calibration: "provider-calibrated" });
  });

  it("rejects non-finite and out-of-range Jev estimates", async () => {
    const provider = new JevProvider({ apiKey: "fixture-key" });
    const response = (answer: Record<string, unknown>) => new Response(JSON.stringify({ model: "jev-latest", answers: { result: answer } }), { status: 200 });
    const call = (answer: Record<string, unknown>, question: DecisionRequest["questions"][string]) => {
      vi.stubGlobal("fetch", vi.fn(async () => response(answer)));
      return provider.decide({ state: "fixture", questions: { result: question } });
    };

    await expect(call({ type: "score", score: null }, { type: "score", instructions: "Rate it", criteria: ["low", "high"] }))
      .rejects.toThrow(/invalid score/);
    await expect(call({ type: "noul", noul: 1.1 }, { type: "noul", instructions: "Is it true?" }))
      .rejects.toThrow(/invalid yes\/no/);
    await expect(call({ type: "noul", noul: 0.8, confidence: 1.2 }, { type: "noul", instructions: "Is it true?" }))
      .rejects.toThrow(/invalid confidence/);
  });

  it("rejects incomplete or malformed calibrated distributions", async () => {
    const provider = new JevProvider({ apiKey: "fixture-key" });
    const choice: DecisionRequest["questions"][string] = {
      type: "choice", instructions: "Pick a tone", criteria: { calm: "Polite", angry: "Hostile" },
    };
    const call = (answer: Record<string, unknown>, requestChoice = choice) => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ answers: { result: answer } }), { status: 200 })));
      return provider.decide({ state: "fixture", questions: { result: requestChoice } });
    };

    await expect(call({ type: "choice", choice: "calm", confidence: 0.9, probabilities: { calm: 0.9 } }))
      .rejects.toThrow(/incomplete or unexpected probability keys/);
    await expect(call({ type: "choice", choice: "calm", confidence: 0.9, probabilities: { calm: 0.8, angry: 0.2, other: 0 } }))
      .rejects.toThrow(/incomplete or unexpected probability keys/);
    await expect(call({ type: "choice", choice: "calm", confidence: 0.9, probabilities: { calm: "0.9", angry: 0.1 } }))
      .rejects.toThrow(/invalid probability/);
    await expect(call({ type: "choice", choice: "calm", probabilities: { calm: 0.9, angry: 0.1 } }))
      .rejects.toThrow(/omitted required confidence/);

    const specialKeyChoice: DecisionRequest["questions"][string] = {
      type: "choice", instructions: "Pick a category", criteria: JSON.parse('{"__proto__":"Special","other":"Other"}'),
    };
    const specialKeyAnswer = await call({
      type: "choice", choice: "__proto__", confidence: 0.9,
      probabilities: JSON.parse('{"__proto__":0.9,"other":0.1}'),
    }, specialKeyChoice);
    const specialProbabilities = specialKeyAnswer.answers.result?.type === "choice"
      ? specialKeyAnswer.answers.result.probabilities
      : undefined;
    expect(specialProbabilities && Object.hasOwn(specialProbabilities, "__proto__")).toBe(true);
  });
});
