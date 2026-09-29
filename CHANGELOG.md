# Changelog

## Unreleased

- Expose read-only browser fields in bounded snapshots and open their visible picker with `browser_action`; reject attempts to fill them directly.
- Match an explicit unique submit request locally while preserving the separate sensitive-action approval call.
- Add a curated multi-tool BrowserGym smoke harness for explicit fake task values, native selects, read-only date pickers, paginated search, and local visual descriptions.

## 0.1.0-alpha.1 — 2026-09-29

- Initial experimental MCP server and CLI source.
- Local semantic decision baseline, optional OpenAI-compatible and Jev adapters.
- Bounded Playwright browser snapshots, local vision captioning, explicit confirmation gate, and an isolated browser profile.
- Coding workflows for navigation, exact-retaining context pruning, model routing, diff triage, completion evidence, classification, screening, reranking, and candidate extraction.
- English Astro site scaffold, agent setup guides, demo page, benchmark protocol, and cross-platform CI workflow.

The checked-in decision and MiniWoB records are small, locally run smoke measurements. They do not establish broad task quality, calibration, cross-provider parity, or the latency target. This alpha has not been released to npm or published to GitHub.
