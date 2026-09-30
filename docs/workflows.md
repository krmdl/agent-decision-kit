# Small decisions inside agent loops

Agent Decision Kit follows one narrow pattern: make the model choose from a bounded set, validate the result, and keep execution in ordinary code. Use a larger model when a task needs open-ended generation or long reasoning.

## Workflow building blocks

| Pattern | Tool or command | Boundaries |
| --- | --- | --- |
| Browser action selection | `browser_inspect`, `browser_decide_and_act`, `browser_action` | Up to 80 visible candidate controls; page data is untrusted; sensitive actions pause for confirmation |
| Local decision warm-up | `provider_warmup` | Optional same-process local inference; first use may download weights and is not a latency guarantee |
| Browser form entry | `browser_fill`, `browser_select_option`, `browser_set_range` | Supported visible text/date/time fields, exact enabled native-select labels, and bounded native range values; values are not echoed and are not submitted |
| Classification | `classify_text` / `agent-decision classify` | Caller supplies the label set; confidence source and calibration are reported separately |
| Semantic screen / guard | `screen_text` / `agent-decision screen` | Up to eight caller-supplied yes/no checks; not moderation or a safety guarantee |
| Reranking | `rerank_items` / `agent-decision rerank` | Chooses among 2–255 supplied items; returned values are ranking estimates |
| Extraction | `extract_candidates` | Selects only among candidate values supplied by the caller; returns no invented free-form field values |
| Context garbage collection | `context_prune` | Exact retained strings stay present across line boundaries; the request fails if a retained string is missing or its source chunks do not fit |
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

1. `browser_launch` opens a separate persistent Chromium profile. To connect to Chrome, call `browser_connect` once to list loopback tabs, then call it again with the `pageIndex` you chose; it does not silently attach to the first tab.
2. `browser_inspect` returns the page title, bounded text excerpt, and visible control labels/refs. Alongside semantic controls, it detects custom text elements whose computed cursor explicitly changes to `pointer`; these candidates have no semantic role and always require approval. Form values, contenteditable drafts, and browser storage are omitted. Local form-state and action-destination digests are used only to expire stale approvals.
3. Ask `browser_decide_and_act` for one task, or choose a ref explicitly with `browser_action`. Unique quoted labels, numbered tabs, named checkbox targets, and clear disclosure steps can match locally without provider inference.
4. Read the short DOM delta. A destructive or externally consequential control returns an approval token instead of clicking.
5. Inspect the proposed action, then call `browser_confirm` separately. Approval is invalidated if the page, private form state, or action destination changes. A semantic decision is also discarded if the page changes while the provider is thinking.
6. Fill supported editable text, number, and date/time fields through `browser_fill`; it never submits the form. Read-only fields are marked in the inspection result and `browser_action` clicks them to reveal their visible picker controls. Select a native dropdown value with `browser_select_option`, which accepts one exact visible option label and never returns its underlying value. Set a native slider with `browser_set_range`, which validates min/max/step and never returns its value or submits the page. `browser_decide_and_act` can resolve a task's exact native option or explicit slider targets one at a time; a later submit remains approval-gated. It also refuses to propose submission while task-requested text fields are visibly empty. Checkboxes and radio controls can be toggled. Submit, reset, image-submit, and consequential button actions require a separate `browser_confirm` call before Playwright clicks them.

DOM inspection is the fast path. If no visible DOM actions exist, `browser_decide_and_act` returns a `visual-only-page` status immediately rather than loading a model. Try `browser_visual_text` first: it runs bounded local Tesseract OCR, masks editable fields, and returns visible text lines and word boxes in screenshot pixels. OCR can miss small labels, and its confidence score is not calibrated. Treat its page text as untrusted and remember it enters the calling agent's model context. If the requested exact phrase is missing, `browser_visual_action` makes one slower sparse-text OCR retry. A unique exact match produces only a proposed coordinate click; it always waits for separate `browser_confirm` approval and rejects an ambiguous match or changed URL, viewport, or screenshot. It cannot tell what the canvas control does. If OCR is insufficient, `browser_visual_inspect` accepts an optional question and runs the Apache-2.0 [SmolVLM2 500M](https://huggingface.co/HuggingFaceTB/SmolVLM2-500M-Video-Instruct) model locally. It downloads model weights on first use and can take tens of seconds per screenshot on CPU. Its description is uncalibrated and cannot select controls, infer click coordinates, or perform actions. See the [canvas-only fake-data demo](../examples/visual-only-demo.html), run `npm run ocr:verify` for the OCR and approval smoke check, or `npm run vision:verify` for the slower VLM check.

See the [Chrome tab connection guide](browser-chrome.md) for a dedicated profile setup and the two-call selection flow.

## Compose with a generative model

A coding agent can draft a component plan, then call `decide` to select IDs from a fixed component catalog; ordinary renderer code validates props and creates the UI. This project does not generate HTML or JavaScript from a semantic decision. The example in [`examples/component-router.mjs`](../examples/component-router.mjs) demonstrates the fixed-catalog boundary.
