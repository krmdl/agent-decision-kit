import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

describe("MCP server interoperability", () => {
  it("advertises tools and completes a real MCP tool call", async () => {
    const server = createServer();
    const client = new Client({ name: "agent-decision-kit-smoke", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toContain("browser_confirm");
    expect(tools.map((tool) => tool.name)).toContain("decide");
    expect(tools.find((tool) => tool.name === "browser_visual_inspect")?.inputSchema).toHaveProperty("properties.question");
    const result = await client.callTool({ name: "model_route", arguments: { task: "fix a typo in a label" } });
    const responseText = result.content.find((item) => item.type === "text");
    expect(responseText?.type === "text" ? JSON.parse(responseText.text).complexity : null).toBe("low");

    await client.close();
    await server.close();
  });
});
