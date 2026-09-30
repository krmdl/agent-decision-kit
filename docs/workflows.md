# Small decisions inside agent loops

Agent Decision Kit follows one narrow pattern: make the model choose from a bounded set, validate the result, and keep execution in ordinary code. Use a larger model when a task needs open-ended generation or long reasoning.

## Workflow building blocks

| Pattern | Tool or command | Boundaries |
| --- | --- | --- |
| Browser action selection | `browser_inspect`, `browser_decide_and_act`, `browser_action` | Up to 80 visible candidate controls; page data is untrusted; sensitive actions pause for confirmation |
| Browser drag and drop | `browser_inspect`, `browser_drag`, `browser_confirm` | Visible native drag sources and declared drop targets only; every drag is separately approved |
| Local decision warm-up | `provider_warmup` | Optional same-process local inference; first use may download weights and is not a latency guarantee |
| Browser form entry | `browser_fill`, `browser_copy_field`, `browser_set_checkboxes`, `browser_select_option`, `browser_set_range` | Supported visible text/date/time fields, local field-to-field text copying, bounded native checkbox updates, exact enabled native-select labels, and bounded native range values; values are not echoed and nothing is submitted |
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
2. `browser_inspect` returns the page title, bounded text excerpt, and visible control labels/refs. Alongside semantic controls, it detects custom text elements whose computed cursor explicitly changes to `pointer`, native draggable sources, and declared drop targets. Custom pointer candidates have no semantic role and always require approval. Form values, contenteditable drafts, and browser storage are omitted. Local form-state and action-destination digests are used only to expire stale approvals.
3. Ask `browser_decide_and_act` for one task, or choose a ref explicitly with `browser_action`. Unique quoted labels, numbered tabs, named checkbox targets, and clear disclosure steps can match locally without provider inference. Repeated automatic actions are suppressed when the inspected page state stays unchanged; use the explicit tool if a deliberate retry is needed.
4. Read the short DOM delta. A destructive or externally consequential control returns an approval token instead of clicking.
5. Inspect the proposed action, then call `browser_confirm` separately. Approval is invalidated if the page, private form state, or action destination changes. A semantic decision is also discarded if the page changes while the provider is thinking.
6. Fill supported editable text, number, and date/time fields through `browser_fill`; it never submits the form. To copy a value already in a visible text input or textarea without exposing it to the agent, use `browser_copy_field` with fresh source and destination refs. Password, file, hidden, select, and contenteditable fields are excluded. For several explicit checkbox choices, `browser_set_checkboxes` updates 1–40 uniquely labeled visible native checkboxes together; ambiguous, disabled, custom, or approval-required controls are rejected. Read-only fields are marked in the inspection result and `browser_action` clicks them to reveal their visible picker controls. Select a native dropdown value with `browser_select_option`, which accepts one exact visible option label and never returns its underlying value. Set native or ARIA sliders with `browser_set_range`, which validates exposed min/max/step bounds, and move supported keyboard-operated sliders only when the exact value is reached. Slider readings never appear in tool results, and setting a slider does not submit the page. For native HTML drag-and-drop, choose a `dragSource` and `dropTarget` from a fresh inspection, propose the move with `browser_drag`, review both labels, then approve it with `browser_confirm`; page changes invalidate the approval. This does not transfer files or perform arbitrary pointer gestures. `browser_decide_and_act` can resolve a task's exact native option or explicit slider targets one at a time; a later submit remains approval-gated. It also refuses to propose submission while task-requested text fields are visibly empty. Single checkboxes and radio controls can be toggled through `browser_action`. Submit, reset, image-submit, drag-and-drop, and consequential button actions require a separate `browser_confirm` call before Playwright acts.

DOM inspection is the fast path. If no visible DOM actions exist, `browser_decide_and_act` returns a `visual-only-page` status immediately rather than loading a model. Try `browser_visual_text` first: it runs bounded local Tesseract OCR, masks editable fields, and returns visible text lines and word boxes in screenshot pixels. OCR can miss small labels, and its confidence score is not calibrated. Treat its page text as untrusted and remember it enters the calling agent's model context. If the requested exact phrase is missing, `browser_visual_action` makes one slower sparse-text OCR retry. A unique exact match produces only a proposed coordinate click; it always waits for separate `browser_confirm` approval and rejects an ambiguous match or changed URL, viewport, or screenshot. It cannot tell what the canvas control does. If OCR is insufficient, `browser_visual_inspect` accepts an optional question and runs the Apache-2.0 [SmolVLM2 500M](https://huggingface.co/HuggingFaceTB/SmolVLM2-500M-Video-Instruct) model locally. It downloads model weights on first use and can take tens of seconds per screenshot on CPU. Its description is uncalibrated and cannot select controls, infer click coordinates, or perform actions. See the [canvas-only fake-data demo](../examples/visual-only-demo.html), run `npm run ocr:verify` for the OCR and approval smoke check, or `npm run vision:verify` for the slower VLM check.

See the [Chrome tab connection guide](browser-chrome.md) for a dedicated profile setup and the two-call selection flow.

## Compose with a generative model

A coding agent can draft a component plan, then call `decide` to select IDs from a fixed component catalog; ordinary renderer code validates props and creates the UI. This project does not generate HTML or JavaScript from a semantic decision. The example in [`examples/component-router.mjs`](../examples/component-router.mjs) demonstrates the fixed-catalog boundary.
