import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import type { DecisionProvider } from "../src/core/types.js";

describe("MCP server interoperability", () => {
  it("advertises tools and completes a real MCP tool call", async () => {
    let providerCalls = 0;
    const provider: DecisionProvider = {
      id: "fixture-provider",
      model: "fixture-model",
      async decide(request) {
        providerCalls += 1;
        const answers = Object.fromEntries(Object.entries(request.questions).map(([name, question]) => {
          if (question.type === "choice") {
            const labels = Object.keys(question.criteria);
            const probabilities = Object.fromEntries(labels.map((label, index) => [label, index === 0 ? 0.8 : 0.2 / (labels.length - 1)]));
            return [name, { type: "choice" as const, choice: labels[0]!, probabilities, confidence: 0.8, confidenceSource: "maximum-probability" as const, calibration: "uncalibrated-estimate" as const }];
          }
          if (question.type === "noul") return [name, { type: "noul" as const, noul: 0.7, probabilities: { true: 0.7, false: 0.3 }, confidence: 0.7, confidenceSource: "maximum-probability" as const, calibration: "uncalibrated-estimate" as const }];
          return [name, { type: "score" as const, score: 1, confidenceSource: "unavailable" as const, calibration: "uncalibrated-estimate" as const }];
        }));
        return { provider: this.id, model: this.model, latencyMs: 0, answers };
      },
      async warmup() { return { provider: this.id, model: this.model, latencyMs: 7 }; },
    };
    const server = createServer({ provider });
    const client = new Client({ name: "agent-decision-kit-smoke", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toContain("browser_confirm");
    expect(tools.map((tool) => tool.name)).toContain("browser_select_option");
    expect(tools.map((tool) => tool.name)).toContain("browser_set_range");
    expect(tools.map((tool) => tool.name)).toContain("browser_copy_field");
    expect(tools.map((tool) => tool.name)).toContain("browser_set_checkboxes");
    expect(tools.map((tool) => tool.name)).toContain("browser_drag");
    expect(tools.map((tool) => tool.name)).toContain("context_prune");
    expect(tools.map((tool) => tool.name)).toContain("decide");
    expect(tools.map((tool) => tool.name)).toContain("provider_warmup");
    expect(tools.find((tool) => tool.name === "browser_visual_inspect")?.inputSchema).toHaveProperty("properties.question");
    expect(tools.find((tool) => tool.name === "browser_visual_text")?.inputSchema).toHaveProperty("properties.maxLines");
    expect(tools.find((tool) => tool.name === "browser_visual_action")?.inputSchema).toHaveProperty("properties.text");
    expect(tools.find((tool) => tool.name === "browser_select_option")?.inputSchema).toHaveProperty("properties.optionLabel");
    expect(tools.find((tool) => tool.name === "browser_set_range")?.inputSchema).toHaveProperty("properties.value");
    expect(tools.find((tool) => tool.name === "browser_copy_field")?.inputSchema).toHaveProperty("properties.sourceRef");
    expect(tools.find((tool) => tool.name === "browser_copy_field")?.inputSchema).toHaveProperty("properties.targetRef");
    expect(tools.find((tool) => tool.name === "browser_set_checkboxes")?.inputSchema).toHaveProperty("properties.refs");
    expect(tools.find((tool) => tool.name === "browser_set_checkboxes")?.inputSchema).toHaveProperty("properties.checked");
    expect(tools.find((tool) => tool.name === "browser_drag")?.inputSchema).toHaveProperty("properties.sourceRef");
    expect(tools.find((tool) => tool.name === "browser_drag")?.inputSchema).toHaveProperty("properties.targetRef");
    expect(tools.find((tool) => tool.name === "context_prune")?.inputSchema).toHaveProperty("properties.semantic");
    expect(tools.find((tool) => tool.name === "context_prune")?.inputSchema).toHaveProperty("properties.query");
    const result = await client.callTool({ name: "model_route", arguments: { task: "fix a typo in a label" } });
    const responseText = result.content.find((item) => item.type === "text");
    expect(responseText?.type === "text" ? JSON.parse(responseText.text).complexity : null).toBe("low");
    const warmup = await client.callTool({ name: "provider_warmup", arguments: {} });
    const warmupText = warmup.content.find((item) => item.type === "text");
    expect(warmupText?.type === "text" ? JSON.parse(warmupText.text) : null).toMatchObject({ status: "ready", provider: "fixture-provider", model: "fixture-model", latencyMs: 7 });

    const baseline = await client.callTool({ name: "context_prune", arguments: { text: "keep this line\ndrop that longer line\n", budgetChars: 15 } });
    const baselineText = baseline.content.find((item) => item.type === "text");
    expect(baselineText?.type === "text" ? JSON.parse(baselineText.text) : null).toMatchObject({ retainedVerbatim: true, outputChars: 15 });
    expect(providerCalls).toBe(0, "default context pruning must not call the provider");

    const semantic = await client.callTool({ name: "context_prune", arguments: { text: "Needle: selected for this task.\nOther: unrelated output.\n", budgetChars: 32, semantic: true, query: "Which chunk is selected for this task?" } });
    const semanticText = semantic.content.find((item) => item.type === "text");
    const semanticResult = semanticText?.type === "text" ? JSON.parse(semanticText.text) : null;
    expect(semanticResult).toMatchObject({ text: "Needle: selected for this task.\n", retainedVerbatim: true, ranking: { method: "provider-probability-ranking", provider: "fixture-provider" } });
    expect(providerCalls).toBe(1);

    const missingQuery = await client.callTool({ name: "context_prune", arguments: { text: "sample", semantic: true } });
    const missingQueryText = missingQuery.content.find((item) => item.type === "text");
    expect(missingQueryText?.type === "text" ? JSON.parse(missingQueryText.text).error : null).toMatch(/query is required/u);

    await client.close();
    await server.close();
  });
});
