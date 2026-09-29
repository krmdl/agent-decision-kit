# Contributing

Thanks for helping make small, dependable decisions useful to open-source agents.

## Development setup

- Node.js 20 or later
- npm
- Chromium only for browser tests and screenshots

```sh
npm install
npm run browser:install
npm run typecheck
npm test
npm run build
```

Keep the stdio channel free of logs; send diagnostics to stderr. Keep provider failures visible instead of silently changing models. Preserve retained context text byte-for-byte. Bound browser state, do not return field values, and require a separate confirmation for consequential actions.

## Pull requests

- Explain the behavior changed and why.
- Add or update tests for changed code paths.
- Do not submit fabricated benchmark numbers, screenshots of private accounts, or unreviewed agent setup snippets.
- Benchmark changes must include the harness version, dataset/source, sample count, system details, and raw machine-readable results.
- Never upload Jev responses or derived labels as training/evaluation data without explicit permission under the current TypeSafe terms.
- Run `npm run typecheck`, `npm test`, `npm run build`, and `npm run website:build` for affected areas.

By contributing, you agree that your contribution is provided under the Apache License 2.0 used by this repository.
