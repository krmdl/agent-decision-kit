#!/usr/bin/env node
import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { runServer } from "./server.js";
import { createProvider } from "./providers/index.js";
import { DecisionRequestSchema, type DecisionRequest } from "./core/types.js";
import { classifyText, findRelevantFiles, pruneContext, rerankItems, reviewDiff, routeModel, screenText } from "./workflows.js";

const program = new Command();
program.name("agent-decision").description("Local-first MCP tools for structured decisions and browser automation").version("0.1.0-alpha.1");

program.command("mcp").description("Run the MCP server over stdio").action(async () => runServer());
program.command("decide").description("Read one decision request JSON from stdin or a file")
  .option("-f, --file <path>", "JSON file; omit to read stdin")
  .action(async ({ file }: { file?: string }) => {
    const source = file ? await readFile(file, "utf8") : await readStdin();
    const request = DecisionRequestSchema.parse(JSON.parse(source));
    process.stdout.write(`${JSON.stringify(await createProvider().decide(request), null, 2)}\n`);
  });

program.command("classify").description("Classify stdin against caller-provided labels")
  .requiredOption("-l, --labels <csv>", "Two or more comma-separated labels")
  .requiredOption("-i, --instructions <text>", "What the labels mean")
  .action(async ({ labels, instructions }: { labels: string; instructions: string }) => {
    const text = await readStdin();
    const result = await classifyText(text, labels.split(",").map((item) => item.trim()).filter(Boolean), instructions, createProvider());
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });

program.command("screen").description("Run up to eight semantic yes/no screening checks on stdin")
  .requiredOption("-c, --categories <csv>", "Comma-separated screening categories")
  .action(async ({ categories }: { categories: string }) => {
    const result = await screenText(await readStdin(), categories.split(",").map((item) => item.trim()).filter(Boolean), createProvider());
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });

program.command("filter").description("Keep newline-delimited input rows that match a semantic condition")
  .requiredOption("-q, --query <text>", "Condition for retaining a line")
  .option("--invert", "Keep lines that do not match")
  .action(async ({ query, invert }: { query: string; invert?: boolean }) => {
    const lines = (await readStdin()).split(/\r?\n/);
    const provider = createProvider();
    for (let offset = 0; offset < lines.length; offset += 8) {
      const batch = lines.slice(offset, offset + 8);
      const questions: DecisionRequest["questions"] = Object.fromEntries(batch.map((line, index) => [`line_${index}`, { type: "noul" as const, instructions: `Does this line satisfy the filter condition? Condition: ${query}\nLine: ${line}` }]));
      const result = await provider.decide({ state: { query }, questions });
      batch.forEach((line, index) => {
        const answer = result.answers[`line_${index}`];
        const matched = answer?.type === "noul" && answer.noul >= 0.5;
        if (matched !== Boolean(invert) && line.length) process.stdout.write(`${line}\n`);
      });
    }
  });

program.command("rerank").description("Rerank newline-delimited candidate items from stdin")
  .requiredOption("-q, --query <text>", "Relevance query")
  .action(async ({ query }: { query: string }) => {
    const items = (await readStdin()).split(/\r?\n/).filter((line) => line.length > 0);
    process.stdout.write(`${JSON.stringify(await rerankItems(query, items, createProvider()), null, 2)}\n`);
  });

program.command("context-prune").description("Keep a bounded selection of stdin while preserving requested strings verbatim")
  .option("-b, --budget <characters>", "Character budget", "12000")
  .option("-r, --retain <text>", "Exact text that must remain; repeat the option", (value: string, previous: string[]) => [...previous, value], [] as string[])
  .action(async ({ budget, retain }: { budget: string; retain: string[] }) => {
    const result = pruneContext(await readStdin(), Number(budget), retain);
    process.stderr.write(`[context-prune] ${result.inputChars} → ${result.outputChars} chars; ${result.omittedChunks} chunks omitted\n`);
    process.stdout.write(result.text);
  });

program.command("route").description("Suggest a model route without dispatching a provider")
  .argument("[task]", "Task description; stdin is used when omitted")
  .option("-a, --available <csv>", "Available route names")
  .option("--latency-sensitive", "Prefer the fast route when available")
  .action(async (task: string | undefined, { available, latencySensitive }: { available?: string; latencySensitive?: boolean }) => {
    const description = task ?? (await readStdin()).trim();
    const routes = available?.split(",").map((item) => item.trim()).filter(Boolean);
    process.stdout.write(`${JSON.stringify(routeModel(description, { ...(routes ? { available: routes } : {}), ...(latencySensitive ? { latencySensitive: true } : {}) }), null, 2)}\n`);
  });

program.command("navigate").description("Rank relevant source paths in a repository")
  .requiredOption("-q, --query <text>", "Task description")
  .option("-r, --root <path>", "Repository root", ".")
  .option("-n, --max-files <count>", "Maximum results", "12")
  .action(async ({ query, root, maxFiles }: { query: string; root: string; maxFiles: string }) => {
    process.stdout.write(`${JSON.stringify(await findRelevantFiles(root, query, Number(maxFiles)), null, 2)}\n`);
  });

program.command("review-diff").description("Run heuristic risk patterns against a diff")
  .option("-f, --file <path>", "Read a diff from a file; otherwise read stdin")
  .action(async ({ file }: { file?: string }) => {
    const diff = file ? await readFile(file, "utf8") : await readStdin();
    process.stdout.write(`${JSON.stringify(reviewDiff(diff), null, 2)}\n`);
  });

program.command("config <agent>").description("Print MCP setup guidance for a supported coding agent")
  .action((agent: string) => { process.stdout.write(`${JSON.stringify(agentConfig(agent), null, 2)}\n`); });

program.command("browser-install").description("Install Playwright Chromium")
  .action(async () => {
    const command = process.platform === "win32" ? "npx.cmd" : "npx";
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, ["playwright", "install", "chromium"], { stdio: "inherit", shell: process.platform === "win32" });
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Playwright browser installation exited with code ${code}`)));
    });
    process.stdout.write("Chromium installed.\n");
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function agentConfig(agent: string) {
  const command = "npx";
  const args = ["-y", "agent-decision-kit", "mcp"];
  const entry = { command, args };
  const normalized = agent.toLowerCase().replace(/[^a-z]/g, "");
  const configurations: Record<string, { file: string; snippet: unknown; note?: string }> = {
    claude: { file: "~/.claude.json or project .mcp.json", snippet: { mcpServers: { "agent-decision-kit": entry } } },
    claudecode: { file: "~/.claude.json or project .mcp.json", snippet: { mcpServers: { "agent-decision-kit": entry } } },
    codex: { file: "~/.codex/config.toml", snippet: '[mcp_servers.agent-decision-kit]\ncommand = "npx"\nargs = ["-y", "agent-decision-kit", "mcp"]' },
    codexcli: { file: "~/.codex/config.toml", snippet: '[mcp_servers.agent-decision-kit]\ncommand = "npx"\nargs = ["-y", "agent-decision-kit", "mcp"]' },
    cursor: { file: ".cursor/mcp.json", snippet: { mcpServers: { "agent-decision-kit": entry } } },
    gemini: { file: "~/.gemini/settings.json", snippet: { mcpServers: { "agent-decision-kit": entry } } },
    geminicli: { file: "~/.gemini/settings.json", snippet: { mcpServers: { "agent-decision-kit": entry } } },
    windsurf: { file: "~/.codeium/windsurf/mcp_config.json", snippet: { mcpServers: { "agent-decision-kit": entry } } },
    windsurfcascade: { file: "~/.codeium/windsurf/mcp_config.json", snippet: { mcpServers: { "agent-decision-kit": entry } } },
    vscode: { file: ".vscode/mcp.json", snippet: { servers: { "agent-decision-kit": { type: "stdio", ...entry } } } },
    copilot: { file: "~/.copilot/mcp-config.json", snippet: { mcpServers: { "agent-decision-kit": { type: "local", ...entry, env: {}, tools: ["*"] } } } },
    copilotcli: { file: "~/.copilot/mcp-config.json", snippet: { mcpServers: { "agent-decision-kit": { type: "local", ...entry, env: {}, tools: ["*"] } } } },
    githubcopilotcli: { file: "~/.copilot/mcp-config.json", snippet: { mcpServers: { "agent-decision-kit": { type: "local", ...entry, env: {}, tools: ["*"] } } } },
    vscodecopilotchat: { file: ".vscode/mcp.json", snippet: { servers: { "agent-decision-kit": { type: "stdio", ...entry } } } },
    cline: { file: "~/.cline/mcp.json (CLI), or Cline MCP Servers → Configure in the IDE", snippet: { mcpServers: { "agent-decision-kit": { ...entry, disabled: false, autoApprove: [] } } } },
    opencode: { file: "opencode.json", snippet: { "$schema": "https://opencode.ai/config.json", mcp: { servers: { "agent-decision-kit": { type: "local", command: [command, ...args] } } } } },
  };
  const found = configurations[normalized];
  if (!found) throw new Error(`Unknown agent '${agent}'. Supported: Claude Code, Codex CLI, Cursor, Gemini CLI, Windsurf Cascade, VS Code/Copilot Chat, GitHub Copilot CLI, Cline, OpenCode.`);
  return { agent, ...found, note: "The published npm command becomes usable after a release. For source checkout, replace npx/args with node and the absolute path to dist/cli.js. Verify the generated config against your installed agent version." };
}
