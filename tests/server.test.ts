import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import type { DecisionProvider } from "../src/core/types.js";

describe("MCP server interoperability", () => {
  it("advertises tools and completes a real MCP tool call", async () => {
    const provider: DecisionProvider = {
      id: "fixture-provider",
      model: "fixture-model",
      async decide() { return { provider: this.id, model: this.model, latencyMs: 0, answers: {} }; },
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
    expect(tools.map((tool) => tool.name)).toContain("decide");
    expect(tools.map((tool) => tool.name)).toContain("provider_warmup");
    expect(tools.find((tool) => tool.name === "browser_visual_inspect")?.inputSchema).toHaveProperty("properties.question");
    expect(tools.find((tool) => tool.name === "browser_visual_text")?.inputSchema).toHaveProperty("properties.maxLines");
    expect(tools.find((tool) => tool.name === "browser_visual_action")?.inputSchema).toHaveProperty("properties.text");
    expect(tools.find((tool) => tool.name === "browser_select_option")?.inputSchema).toHaveProperty("properties.optionLabel");
    expect(tools.find((tool) => tool.name === "browser_set_range")?.inputSchema).toHaveProperty("properties.value");
    expect(tools.find((tool) => tool.name === "browser_copy_field")?.inputSchema).toHaveProperty("properties.sourceRef");
    expect(tools.find((tool) => tool.name === "browser_copy_field")?.inputSchema).toHaveProperty("properties.targetRef");
    const result = await client.callTool({ name: "model_route", arguments: { task: "fix a typo in a label" } });
    const responseText = result.content.find((item) => item.type === "text");
    expect(responseText?.type === "text" ? JSON.parse(responseText.text).complexity : null).toBe("low");
    const warmup = await client.callTool({ name: "provider_warmup", arguments: {} });
    const warmupText = warmup.content.find((item) => item.type === "text");
    expect(warmupText?.type === "text" ? JSON.parse(warmupText.text) : null).toMatchObject({ status: "ready", provider: "fixture-provider", model: "fixture-model", latencyMs: 7 });

    await client.close();
    await server.close();
  });
});
