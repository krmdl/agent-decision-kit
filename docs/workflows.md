# Small decisions inside agent loops

Agent Decision Kit follows one narrow pattern: make the model choose from a bounded set, validate the result, and keep execution in ordinary code. Use a larger model when a task needs open-ended generation or long reasoning.

## Workflow building blocks

| Pattern | Tool or command | Boundaries |
| --- | --- | --- |
| Browser action selection | `browser_inspect`, `browser_decide_and_act`, `browser_action` | Up to 80 visible candidate controls; page data is untrusted; sensitive actions pause for confirmation |
| Browser form entry | `browser_fill` | Only supported visible non-password text fields; values are not echoed and are not submitted |
| Classification | `classify_text` / `agent-decision classify` | Caller supplies the label set; probabilities are uncalibrated unless the provider reports otherwise |
| Semantic screen / guard | `screen_text` / `agent-decision screen` | Up to eight caller-supplied yes/no checks; not moderation or a safety guarantee |
| Reranking | `rerank_items` / `agent-decision rerank` | Chooses among 2–255 supplied items; returned values are ranking estimates |
| Extraction | `extract_candidates` | Selects only among candidate values supplied by the caller; returns no invented free-form field values |
| Context garbage collection | `context_prune` | Exact retained strings stay present; this heuristic selects whole text chunks |
| Semantic repository navigation | `code_navigate` | Skips hidden, dependency and build directories; it is a bounded filename/excerpt search, not a complete index |
| Model routing | `model_route` | Deterministic complexity heuristic; it suggests a route but does not call a model |
| Diff risk prefilter | `diff_risk_review` | Pattern checks locate review candidates; this is not a code audit |
| Completion referee | `completion_verify` | Text-overlap signal only; it cannot prove behavior or that a test ran |

## Preserve context without rewriting it

`context_prune` ranks lines with a small local heuristic and returns the original selected chunks. If you pass `retain`, each retained string must appear exactly in the output or the request fails when it cannot fit in the character budget.

```json
{
  "text": "tool output including a file path and error stack...",
  "budgetChars": 4000,
  "retain": ["src/session.ts:42", "ECONNREFUSED 127.0.0.1:5432"]
}
```

This is a local, transparent baseline. It does not summarize, rewrite, or judge semantic relevance with the default model.

## A bounded browser loop

1. `browser_launch` opens a separate persistent Chromium profile, or `browser_connect` attaches to a selected loopback CDP tab.
2. `browser_inspect` returns the page title, bounded text excerpt, and visible control labels/refs. Form values and browser storage are omitted.
3. Ask `browser_decide_and_act` for one task, or choose a ref explicitly with `browser_action`.
4. Read the short DOM delta. A destructive or externally consequential control returns an approval token instead of clicking.
5. Inspect the proposed action, then call `browser_confirm` separately. Approval is invalidated when the page fingerprint changes.
6. Fill text through `browser_fill`; submitting remains a distinct action.

DOM inspection is the fast path. `browser_visual_inspect` runs a local screenshot caption model for visual-only pages. It downloads model weights on first use, can take much longer, and only describes the page; it does not infer coordinates or automatically click based on the image.

## Compose with a generative model

A coding agent can draft a component plan, then call `decide` to select IDs from a fixed component catalog; ordinary renderer code validates props and creates the UI. This project does not generate HTML or JavaScript from a semantic decision. The example in [`examples/component-router.mjs`](../examples/component-router.mjs) demonstrates the fixed-catalog boundary.
