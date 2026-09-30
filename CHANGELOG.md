# Changelog

## Unreleased

- Resolve role-prefixed labels, ordinal radio/textbox instructions, revealed menu-item targets, and ordered searches through multiple collapsed sections with local browser rules when the target is explicit.
- Keep the synthetic MiniWoB form workflow aligned with explicit radio and textbox ordinals so integration runs exercise the requested sequence and value.
- Expose read-only browser fields in bounded snapshots and open their visible picker with `browser_action`; reject attempts to fill them directly.
- Match an explicit unique submit request locally while preserving the separate sensitive-action approval call.
- Resolve unique exact control labels in simple click/tap/open requests locally, while leaving duplicates ambiguous and consequential actions behind approval.
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

The checked-in decision and MiniWoB records are small, locally run smoke measurements. They do not establish broad task quality, calibration, cross-provider parity, or the latency target. This alpha has not been released to npm or published to GitHub.
