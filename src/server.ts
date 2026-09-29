import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DecisionRequestSchema } from "./core/types.js";
import { createProvider } from "./providers/index.js";
import { BrowserManager } from "./browser/manager.js";
import { classifyText, extractFromCandidates, findRelevantFiles, pruneContext, rerankItems, reviewDiff, routeModel, screenText, verifyCompletion } from "./workflows.js";

function asToolResult(value: unknown) {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : { result: value };
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: data };
}

export function createServer() {
  const server = new McpServer({ name: "agent-decision-kit", version: "0.1.0-alpha.1" });
  const browser = new BrowserManager();
  const provider = createProvider();

  server.registerTool("decide", {
    title: "Structured decision",
    description: "Answer up to eight typed choice, score, or yes/no questions in one batch. Confidence calibration status is explicit.",
    inputSchema: { request: z.unknown() },
  }, async ({ request }) => {
    try { return asToolResult(await provider.decide(DecisionRequestSchema.parse(request))); }
    catch (error) { return asToolResult({ error: error instanceof Error ? error.message : String(error) }); }
  });

  server.registerTool("code_navigate", {
    title: "Find relevant code",
    description: "Rank a bounded set of source files by filename and excerpt relevance. Skips common dependency/build directories and hidden directories.",
    inputSchema: { root: z.string().default("."), query: z.string().min(1), maxFiles: z.number().int().min(1).max(40).default(12) },
  }, async ({ root, query, maxFiles }) => asToolResult(await findRelevantFiles(root, query, maxFiles)));

  server.registerTool("context_prune", {
    title: "Prune context",
    description: "Reduce text to a character budget while preserving requested retained strings verbatim. This is a simple local heuristic.",
    inputSchema: { text: z.string(), budgetChars: z.number().int().min(0).max(1_000_000).default(12_000), retain: z.array(z.string()).default([]) },
  }, async ({ text, budgetChars, retain }) => asToolResult(pruneContext(text, budgetChars, retain)));

  server.registerTool("model_route", {
    title: "Suggest a model route",
    description: "Return a transparent complexity heuristic; it does not query or select any provider automatically.",
    inputSchema: { task: z.string().min(1), available: z.array(z.string()).optional(), latencySensitive: z.boolean().optional() },
  }, async ({ task, available, latencySensitive }) => asToolResult(routeModel(task, { ...(available ? { available } : {}), ...(latencySensitive !== undefined ? { latencySensitive } : {}) })));

  server.registerTool("diff_risk_review", {
    title: "Diff risk pre-review",
    description: "Run fast pattern checks on a diff. This is a heuristic pre-review, not a security audit.",
    inputSchema: { diff: z.string().max(1_000_000) },
  }, async ({ diff }) => asToolResult(reviewDiff(diff)));

  server.registerTool("completion_verify", {
    title: "Check completion evidence",
    description: "Check whether supplied evidence text overlaps a completion claim. Does not run tests or prove correctness.",
    inputSchema: { claim: z.string().min(1), evidence: z.array(z.object({ path: z.string(), excerpt: z.string() })).max(100) },
  }, async ({ claim, evidence }) => asToolResult(verifyCompletion(claim, evidence)));

  server.registerTool("classify_text", {
    title: "Classify text",
    description: "Choose among caller-provided labels and return uncalibrated probability estimates when available.",
    inputSchema: { text: z.string().max(20_000), labels: z.array(z.string().min(1)).min(2).max(255), instructions: z.string().min(1).max(2_000) },
  }, async ({ text, labels, instructions }) => asToolResult(await classifyText(text, labels, instructions, provider)));

  server.registerTool("screen_text", {
    title: "Screen text against categories",
    description: "Batch up to eight semantic yes/no checks. Results are estimates and must not be treated as moderation or a safety guarantee.",
    inputSchema: { text: z.string().max(20_000), categories: z.array(z.string().min(1)).min(1).max(8) },
  }, async ({ text, categories }) => asToolResult(await screenText(text, categories, provider)));

  server.registerTool("rerank_items", {
    title: "Rerank items",
    description: "Rank 2 to 255 caller-supplied strings for a query using one bounded choice call. Returns scores with calibration metadata.",
    inputSchema: { query: z.string().min(1).max(2_000), items: z.array(z.string().min(1)).min(2).max(255) },
  }, async ({ query, items }) => asToolResult(await rerankItems(query, items, provider)));

  server.registerTool("extract_candidates", {
    title: "Extract from supplied candidates",
    description: "For up to eight fields, select only among candidate values supplied by the caller or return none. It does not generate unsupported values.",
    inputSchema: { text: z.string().max(20_000), fields: z.array(z.object({ name: z.string().min(1), instructions: z.string().min(1), candidates: z.array(z.string().min(1)).min(1).max(254) })).min(1).max(8) },
  }, async ({ text, fields }) => asToolResult(await extractFromCandidates(text, fields, provider)));

  server.registerTool("browser_launch", {
    title: "Launch isolated browser",
    description: "Launch Playwright Chromium with a separate persistent profile. Pages stay local; start with a public, non-sensitive demo site.",
    inputSchema: { url: z.string().url().optional() },
  }, async ({ url }) => asToolResult(await browser.launch(url)));

  server.registerTool("browser_connect", {
    title: "Connect to selected Chrome tab",
    description: "Attach to a user-selected local Chrome tab through its loopback CDP WebSocket endpoint.",
    inputSchema: { endpoint: z.string().url(), pageIndex: z.number().int().min(0).default(0) },
  }, async ({ endpoint, pageIndex }) => asToolResult(await browser.connect(endpoint, pageIndex)));

  server.registerTool("browser_navigate", {
    title: "Navigate browser",
    description: "Navigate the active tab to an explicit http(s) URL.",
    inputSchema: { url: z.string().url() },
  }, async ({ url }) => asToolResult(await browser.navigate(url)));

  server.registerTool("browser_inspect", {
    title: "Inspect browser page",
    description: "Return a bounded visible DOM/accessible-action snapshot. Does not include form values, passwords, cookies, or storage.",
    inputSchema: {},
  }, async () => asToolResult(await browser.inspect()));

  server.registerTool("browser_decide_and_act", {
    title: "Choose one browser action",
    description: "Ask the configured decision provider to select one of at most 80 visible actions. Sensitive actions require a separate approval tool call. Page content is untrusted input.",
    inputSchema: { task: z.string().min(1).max(1_000), },
  }, async ({ task }) => asToolResult(await browser.decideAndAct(task, provider)));

  server.registerTool("browser_action", {
    title: "Run selected browser action",
    description: "Click a ref returned by browser_inspect. Sensitive actions return an approval token and do not run until browser_confirm is called.",
    inputSchema: { ref: z.string().regex(/^r\d+$/) },
  }, async ({ ref }) => asToolResult(await browser.act(ref)));

  server.registerTool("browser_fill", {
    title: "Fill a visible browser field",
    description: "Fill a visible non-password text field selected by a fresh browser_inspect ref. The value is never returned or submitted; it remains in the page until a separate action is taken.",
    inputSchema: { ref: z.string().regex(/^r\d+$/), text: z.string().max(20_000) },
  }, async ({ ref, text }) => asToolResult(await browser.fill(ref, text)));

  server.registerTool("browser_confirm", {
    title: "Approve or cancel sensitive action",
    description: "Explicit user approval gate for a proposed payment, sending, publishing, deletion, or similarly sensitive action. Tokens expire after five minutes.",
    inputSchema: { approvalToken: z.string().uuid(), approve: z.boolean() },
    annotations: { destructiveHint: true, openWorldHint: true },
  }, async ({ approvalToken, approve }) => asToolResult(await browser.confirm(approvalToken, approve)));

  server.registerTool("browser_visual_inspect", {
    title: "Inspect visual-only page locally",
    description: "Capture a screenshot and caption it with a local vision model. First use may download model files and take substantially longer than DOM inspection.",
    inputSchema: {},
  }, async () => asToolResult(await browser.visualInspect()));

  server.registerTool("browser_close", {
    title: "Close browser session",
    description: "Close the current Playwright/CDP browser connection and clear pending approvals.",
    inputSchema: {},
  }, async () => asToolResult(await browser.close()));

  return server;
}

export async function runServer() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
