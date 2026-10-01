import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { DecisionProvider } from "./core/types.js";
import { DecisionRequestSchema, serializeState } from "./core/types.js";

const DEFAULT_IGNORES = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", ".turbo"]);

export async function findRelevantFiles(root: string, query: string, maxFiles = 12) {
  const rootPath = path.resolve(root);
  const terms = query.toLowerCase().match(/[a-z0-9_./-]{2,}/g) ?? [];
  const files: Array<{ path: string; score: number; excerpt: string }> = [];
  let visited = 0;

  async function walk(directory: string): Promise<void> {
    if (visited > 3_000 || files.length >= maxFiles * 5) return;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (visited++ > 3_000 || files.length >= maxFiles * 5) break;
      if (entry.name.startsWith(".") || DEFAULT_IGNORES.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|swift|md|json|ya?ml|toml)$/i.test(entry.name)) {
        const relative = path.relative(rootPath, absolute);
        const filename = entry.name.toLowerCase();
        const score = terms.reduce((sum, term) => sum + (filename.includes(term) ? 3 : 0) + (relative.toLowerCase().includes(term) ? 1 : 0), 0);
        if (score > 0 || files.length < maxFiles) {
          let excerpt = "";
          try { excerpt = (await readFile(absolute, "utf8")).slice(0, 1_200); } catch { /* binary/unreadable */ }
          const contentScore = terms.reduce((sum, term) => sum + (excerpt.toLowerCase().includes(term) ? 1 : 0), 0);
          files.push({ path: relative, score: score + contentScore, excerpt: excerpt.split(/\r?\n/).slice(0, 14).join("\n") });
        }
      }
    }
  }

  await walk(rootPath);
  return { root: rootPath, visitedEntries: Math.min(visited, 3_001), files: files.sort((a, b) => b.score - a.score).slice(0, maxFiles) };
}

type ContextPlan = { chunks: string[]; retained: Set<number>; budgetChars: number };

function prepareContext(input: string, budgetChars: number, retain: string[]): ContextPlan {
  if (!Number.isInteger(budgetChars) || budgetChars < 0) throw new Error("budgetChars must be a non-negative integer");
  const uniqueRetained = [...new Set(retain.filter((item) => item.length > 0))];
  const chunks = input.split(/(?<=\n)/);
  const starts: number[] = [];
  let offset = 0;
  for (const chunk of chunks) {
    starts.push(offset);
    offset += chunk.length;
  }
  const chunkAt = (position: number): number => {
    let low = 0;
    let high = chunks.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const start = starts[middle]!;
      const end = start + chunks[middle]!.length;
      if (position < start) high = middle - 1;
      else if (position >= end) low = middle + 1;
      else return middle;
    }
    return Math.max(0, Math.min(chunks.length - 1, low));
  };
  const kept = new Set<number>();
  let used = 0;
  for (const item of uniqueRetained) {
    const matchStart = input.indexOf(item);
    if (matchStart < 0) throw new Error("A requested retained string does not occur verbatim in the input");
    const firstChunk = chunkAt(matchStart);
    const lastChunk = chunkAt(matchStart + item.length - 1);
    for (let index = firstChunk; index <= lastChunk; index += 1) kept.add(index);
  }
  used = [...kept].reduce((total, index) => total + chunks[index]!.length, 0);
  if (used > budgetChars) throw new Error("The source chunks required to preserve retained text exceed the context budget");
  return { chunks, retained: kept, budgetChars };
}

function contextHeuristicScore(text: string) {
  return (text.match(/\b(?:TODO|FIXME|error|export|function|class|interface|async|await|test|return)\b/gi) ?? []).length;
}

function finalizeContext(plan: ContextPlan, orderedIndices: number[]) {
  const kept = new Set(plan.retained);
  let used = [...kept].reduce((total, index) => total + plan.chunks[index]!.length, 0);
  for (const index of orderedIndices) {
    if (kept.has(index)) continue;
    const text = plan.chunks[index]!;
    if (used + text.length <= plan.budgetChars) { kept.add(index); used += text.length; }
  }
  const output = plan.chunks.map((text, index) => kept.has(index) ? text : "").join("");
  return {
    text: output,
    inputChars: plan.chunks.join("").length,
    outputChars: output.length,
    budgetChars: plan.budgetChars,
    retainedVerbatim: true,
    omittedChunks: plan.chunks.length - kept.size,
  };
}

function heuristicContextOrder(plan: ContextPlan) {
  return plan.chunks.map((text, index) => ({ index, score: contextHeuristicScore(text) }))
    .filter((item) => !plan.retained.has(item.index))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.index);
}

export function pruneContext(input: string, budgetChars = 12_000, retain: string[] = []) {
  const plan = prepareContext(input, budgetChars, retain);
  const result = finalizeContext(plan, heuristicContextOrder(plan));
  const uniqueRetained = [...new Set(retain.filter((item) => item.length > 0))];
  return { ...result, retainedVerbatim: uniqueRetained.every((item) => result.text.includes(item)) };
}

export async function pruneContextWithProvider(input: string, budgetChars: number, retain: string[], query: string, provider: DecisionProvider) {
  if (!query.trim()) throw new Error("A non-empty query is required for semantic context pruning");
  const plan = prepareContext(input, budgetChars, retain);
  const heuristicOrder = heuristicContextOrder(plan);
  const baseline = finalizeContext(plan, heuristicOrder);
  if (baseline.omittedChunks === 0) {
    return { ...baseline, ranking: { method: "not-needed", candidateCount: 0, note: "The full context already fits the budget, so the provider was not called." } };
  }

  const queryTerms = [...new Set(query.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}_./-]{2,}/gu) ?? [])];
  const queryOverlap = (text: string) => {
    const lower = text.toLocaleLowerCase("en-US");
    return queryTerms.reduce((score, term) => score + (lower.includes(term) ? 1 : 0), 0);
  };
  const baselinePosition = new Map(heuristicOrder.map((index, position) => [index, position]));
  const candidates = plan.chunks.map((text, index) => ({ index, text, overlap: queryOverlap(text), score: contextHeuristicScore(text) }))
    .filter((item) => !plan.retained.has(item.index) && item.text.trim().length > 0)
    .sort((a, b) => b.overlap - a.overlap || b.score - a.score || (baselinePosition.get(a.index) ?? a.index) - (baselinePosition.get(b.index) ?? b.index))
    .slice(0, 32);
  if (candidates.length < 2) {
    const uniqueRetained = [...new Set(retain.filter((item) => item.length > 0))];
    return {
      ...baseline,
      retainedVerbatim: uniqueRetained.every((item) => baseline.text.includes(item)),
      ranking: { method: "local-heuristic-fallback", candidateCount: candidates.length, note: "At least two non-empty chunks are required for a provider choice; the local heuristic was used." },
    };
  }

  const ranked = await rerankItems(query, candidates.map((item) => item.text.slice(0, 1_200)), provider);
  const selected = ranked.answer?.type === "choice" ? Number(ranked.answer.choice.slice("item_".length)) - 1 : -1;
  const hasProbabilities = ranked.answer?.type === "choice" && ranked.answer.probabilities !== undefined;
  const rankedCandidateIndices = hasProbabilities
    ? ranked.items.map((item) => candidates[item.index]!.index)
    : [...(selected >= 0 && selected < candidates.length ? [candidates[selected]!.index] : []), ...candidates.filter((_item, index) => index !== selected).map((item) => item.index)];
  const semanticOrder = [...rankedCandidateIndices, ...heuristicOrder.filter((index) => !rankedCandidateIndices.includes(index))];
  const result = finalizeContext(plan, semanticOrder);
  const uniqueRetained = [...new Set(retain.filter((item) => item.length > 0))];
  return {
    ...result,
    retainedVerbatim: uniqueRetained.every((item) => result.text.includes(item)),
    ranking: {
      method: hasProbabilities ? "provider-probability-ranking" : "provider-choice-then-local-heuristic",
      candidateCount: candidates.length,
      provider: ranked.provider,
      model: ranked.model,
      latencyMs: ranked.latencyMs,
      confidence: ranked.answer?.confidence,
      confidenceSource: ranked.answer?.confidenceSource,
      calibration: ranked.answer?.calibration,
      note: "Selected source chunks remain verbatim. Ranking estimates can be wrong; review the returned text. Only up to 32 candidate snippets, each capped at 1,200 characters, were sent to the configured provider.",
    },
  };
}

export function routeModel(task: string, options: { available?: string[]; latencySensitive?: boolean } = {}) {
  const available = options.available ?? ["local-fast", "balanced", "reasoning"];
  const words = task.toLowerCase();
  const complexity = /architecture|security|race condition|migration|root cause|refactor|design/.test(words) ? "high"
    : /implement|debug|review|browser|navigate|research/.test(words) ? "medium" : "low";
  const preferred = options.latencySensitive && available.includes("local-fast") ? "local-fast" : complexity === "high" ? "reasoning" : complexity === "medium" ? "balanced" : "local-fast";
  return { route: available.includes(preferred) ? preferred : available[0] ?? "unavailable", complexity, reason: `Heuristic route for ${complexity}-complexity work; override with your agent's own routing policy.` };
}

export function reviewDiff(diff: string) {
  const checks = [
    { id: "secrets", severity: "high", pattern: /(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']{8,}["']/i, message: "Possible hard-coded credential" },
    { id: "destructive-shell", severity: "high", pattern: /(?:rm\s+-rf|Remove-Item\s+.*-Recurse|DROP\s+TABLE|TRUNCATE\s+TABLE)/i, message: "Potentially destructive command or query" },
    { id: "unsafe-html", severity: "medium", pattern: /dangerouslySetInnerHTML|innerHTML\s*=/, message: "Review untrusted HTML handling" },
    { id: "auth-change", severity: "medium", pattern: /(?:authorize|authentication|permission|role|policy)/i, message: "Authorization-related diff deserves review" },
    { id: "dependency-change", severity: "low", pattern: /^\+.*(?:dependencies|version|package\.json)/m, message: "Review dependency and lockfile changes" },
  ];
  return { findings: checks.filter((check) => check.pattern.test(diff)).map(({ id, severity, message }) => ({ id, severity, message })), analyzedChars: diff.length, scope: "heuristic pre-review; not a security audit" };
}

export function verifyCompletion(claim: string, evidence: Array<{ path: string; excerpt: string }>) {
  const verified = evidence.filter((item) => item.excerpt.trim().length > 0 && claim.toLowerCase().split(/\W+/).some((word) => word.length > 3 && item.excerpt.toLowerCase().includes(word)));
  const unsupported = evidence.filter((item) => !verified.includes(item));
  return { verifiedEvidence: verified.map(({ path: file, excerpt }) => ({ path: file, excerpt: excerpt.slice(0, 600) })), unsupportedEvidencePaths: unsupported.map((item) => item.path), status: verified.length ? "partial-evidence" : "unverified", note: "Text overlap is a weak evidence check. It does not establish correctness or prove that tests passed." };
}

export async function decide(request: unknown, provider: DecisionProvider) {
  const parsed = DecisionRequestSchema.parse(request);
  return provider.decide(parsed);
}

export async function classifyText(text: string, labels: string[], instructions: string, provider: DecisionProvider) {
  if (labels.length < 2 || labels.length > 255) throw new Error("Classification requires 2 to 255 labels.");
  const criteria = Object.fromEntries(labels.map((label, index) => [`label_${index + 1}`, label]));
  const result = await provider.decide({ state: text, questions: { classification: { type: "choice", instructions, criteria } } });
  const answer = result.answers.classification;
  return { label: answer?.type === "choice" ? labels[Number(answer.choice.slice(6)) - 1] ?? answer.choice : null, answer, provider: result.provider, model: result.model, latencyMs: result.latencyMs };
}

export async function screenText(text: string, categories: string[], provider: DecisionProvider) {
  if (categories.length < 1 || categories.length > 8) throw new Error("Screening supports 1 to 8 checks in one batch.");
  const questions = Object.fromEntries(categories.map((category, index) => [`screen_${index + 1}`, { type: "noul" as const, instructions: `Does this text match the following screening category: ${category}? Answer based only on the supplied text.` }]));
  const result = await provider.decide({ state: text, questions });
  return { matches: categories.map((category, index) => ({ category, answer: result.answers[`screen_${index + 1}`] })), provider: result.provider, model: result.model, latencyMs: result.latencyMs, note: "Semantic screening estimates only. Not a moderation, legal, or safety guarantee." };
}

export async function rerankItems(query: string, items: string[], provider: DecisionProvider) {
  if (items.length < 2 || items.length > 255) throw new Error("Reranking supports 2 to 255 items.");
  const labels = items.map((_, index) => `item_${index + 1}`);
  const criteria = Object.fromEntries(items.map((item, index) => [labels[index]!, item.slice(0, 2_000)]));
  const result = await provider.decide({ state: { query }, questions: { relevance: { type: "choice", instructions: query, criteria } } });
  const answer = result.answers.relevance;
  const probabilities = answer?.type === "choice" ? answer.probabilities ?? {} : {};
  return { items: items.map((item, index) => ({ item, index, score: probabilities[labels[index]!] ?? 0 })).sort((a, b) => b.score - a.score), answer, provider: result.provider, model: result.model, latencyMs: result.latencyMs };
}

export async function extractFromCandidates(text: string, fields: Array<{ name: string; instructions: string; candidates: string[] }>, provider: DecisionProvider) {
  if (fields.length < 1 || fields.length > 8) throw new Error("Extraction supports 1 to 8 fields in one batch.");
  const normalized = fields.map((field) => [...new Set(field.candidates.filter((item) => item.length > 0))].slice(0, 254));
  const questions = Object.fromEntries(fields.map((field, index) => {
    const options = normalized[index]!;
    if (!options.length) throw new Error(`Field '${field.name}' must include at least one candidate value.`);
    const none = `__none_${index + 1}__`;
    return [`field_${index + 1}`, { type: "choice" as const, instructions: field.instructions, criteria: { ...Object.fromEntries(options.map((option, optionIndex) => [`value_${optionIndex + 1}`, option])), [none]: "No supplied candidate is supported by the text" } }];
  }));
  const result = await provider.decide({ state: text, questions });
  return { fields: fields.map((field, index) => {
    const answer = result.answers[`field_${index + 1}`];
    const selected = answer?.type === "choice" ? answer.choice : "";
    if (selected.startsWith("value_")) return { name: field.name, value: normalized[index]?.[Number(selected.slice(6)) - 1] ?? null, answer };
    return { name: field.name, value: null, answer };
  }), provider: result.provider, model: result.model, latencyMs: result.latencyMs, note: "Extraction selects only among caller-supplied candidates; it does not invent values." };
}

export function compactState(state: unknown, maxChars = 8_000) {
  return serializeState(typeof state === "string" ? state : state as Parameters<typeof serializeState>[0]).slice(0, maxChars);
}
