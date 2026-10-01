# Changelog

## Unreleased

- Add opt-in ONNX Runtime per-node provider profiling to decision benchmarks, with provider counts in the JSON report and compressed trace output kept beside it.
- Classify browser value-entry controls using their accessible labels, so sensitive words in a select option do not block safe filtering while action controls remain approval-gated.
- Recheck up to eight repeated digit glyphs with local single-character OCR and record the five-seed visual-only MiniWoB retry run.
- Stop after a visible page heading exactly matches a requested all/every collection; return the matched destination and avoid reopening its navigation menu.
- Add opt-in provider ranking to `context_prune` and `context-prune`; keep the local heuristic as the default and return selected source chunks verbatim.
- Report completion-claim token overlap without calling it verified evidence, and distinguish caller-reported test-result exit codes from independently verified test runs.
- Add `browser_drag` for visible native draggable sources and declared drop targets; every move needs a separate approval and is cancelled when the page changes.
- Resolve role-prefixed labels, ordinal radio/textbox instructions, and revealed menu-item targets locally; track visited disclosures so multi-section searches do not toggle tabs back and forth.
- Select exact requested options in native lists before proposing submission, set explicit native slider values without returning them, and block submit proposals while task-requested text fields remain empty.
- Stop repeated automatic approval loops when a confirmed pointer-only click leaves the visible page unchanged.
- Stop repeated automatic browser actions when the inspected page state did not change; explicit `browser_action` calls remain available.
- Return range-slider bounds and step without exposing its current form value; add an explicit `browser_set_range` MCP tool.
- Include accessible ARIA sliders and keyboard-operated jQuery UI slider handles with a linked visible readout; verify explicit values without returning them.
- Include bounded CSS `cursor: pointer` targets alongside semantic browser controls; custom targets remain subject to the sensitive-action approval gate.
- Click an explicitly requested textarea widget instead of only focusing it, and keep the synthetic MiniWoB form workflow aligned with explicit ordinals and its local submit approval gate.
- Expose read-only browser fields in bounded snapshots and open their visible picker with `browser_action`; reject attempts to fill them directly.
- Match an explicit unique submit request locally while preserving the separate sensitive-action approval call.
- Resolve unique exact control labels in simple click/tap/open requests locally, while leaving duplicates ambiguous and consequential actions behind approval.
- Resolve a unique visible destination label named in a navigation request locally; keep duplicate destinations ambiguous.
- Detect and stop automatic browser actions when the same task cycles back to an earlier inspected page state.
- Add a curated multi-tool BrowserGym smoke harness for explicit fake task values, native selects, read-only date pickers, paginated search, and local visual descriptions.
- Record whether the local model cache directory existed before decision measurements and add one Linux Docker result; older MiniWoB cache-state claims were corrected.
- Re-run the eight-task MiniWoB integration suite in Linux Docker and preserve summary and per-task records with environment versions.
- Add a real CLI-over-MCP-stdio subprocess smoke check to local development and the cross-platform CI matrix.
- Verify Claude Code's MCP health check and Codex CLI config loading on installed Windows clients using isolated temporary config directories; no vendor-model turns or paid inference were used.
- Add a local, bounded OCR fast path for visual-only pages; mask editable fields and keep the slower local vision-language question tool available for OCR misses.
- Add exact-phrase OCR click proposals for visual-only pages; every coordinate click requires a separate approval and a pixel-identical current screenshot.
- Retry an exact visual-click target once with local sparse-text OCR when the default OCR pass misses it; verify the same URL, viewport, and screenshot before proposing a click.
- Extend the curated MiniWoB harness to exercise OCR-grounded visual clicks under an exact local-file approval guard.
- Include the optional Claude Code hook in the npm package and verify required release files in CI.
- Mask contenteditable draft text, detect private form and action-target changes when validating approvals, and discard semantic decisions if the page changes during inference.
- Preserve context-retention strings across line boundaries, reject missing retained text, and report confidence sources separately from calibration status.
- Retry local embedding-pipeline initialization after a transient failure and cache pipelines by model ID.
- Add an optional same-process MCP warm-up for the local decision model.
- Record confidence source in decision benchmark cases and report ten-bin Choice/yes-no reliability with expected calibration error; preserve Windows and Linux CPU repeats for the independent 30-case fixture.
- Add unit coverage for confidence reliability grouping, bin boundaries, unsupported confidence values, and ECE calculation.
- Preserve child-runner exit codes and bounded sanitized stderr diagnostics in BrowserGym episode records.
- Repeat the full focused MiniWoB task set after a non-reproducible 61.8-second failure; retain the failed run, isolated retry, and latest 8/8 result separately.

## 0.1.0-alpha.1 — 2026-09-29

- Initial experimental MCP server and CLI source.
- Local semantic decision baseline, optional OpenAI-compatible and Jev adapters.
- Bounded Playwright browser snapshots, local vision captioning, explicit confirmation gate, and an isolated browser profile.
- Coding workflows for navigation, exact-retaining context pruning, model routing, diff triage, completion evidence, classification, screening, reranking, and candidate extraction.
- English Astro site scaffold, agent setup guides, demo page, benchmark protocol, and cross-platform CI workflow.

The checked-in decision and MiniWoB records are small, locally run smoke measurements. They do not establish broad task quality, calibration, cross-provider parity, or the latency target. This alpha has not been released to npm or as a tagged GitHub Release.
