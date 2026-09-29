# Benchmarks

No benchmark numbers are published. The files here define a reproducible start point and report schema; the repository does not include mock timings or charts.

## Decision quality and latency

`fixtures/decision-cases.jsonl` contains a small, human-labeled fixture set. Run it from a built checkout:

```sh
npm run build
node benchmarks/run-decisions.mjs > decision-report.json
```

The script reports per-case labels, probabilities, calibration labels and latency, then aggregates accuracy, Brier score, the first call including pipeline initialization, and within-process warm p50/p95 separately. The warm label only means later calls in the same process; it does not establish a pre-cached model or accelerator state. Record hardware, accelerator, model-cache state, and provider setup. Run each provider as a separate explicit condition; don't mix results. For a fair Jev comparison, use the same cases, request batching, network conditions, and label rubric. Never use provider responses as training data or to tune an imitation.

The starter fixtures are public and tiny. They are useful for verifying the harness, not for proving broad quality, calibration or performance. Keep additional test cases held out and source their labels independently from both tested providers.

## Browser task success

The included Playwright integration test covers a local, fake-data browser demo and the approval gate. It is not a BrowserGym benchmark.

BrowserGym provides MiniWoB, WebArena and VisualWebArena environments. Follow its [official setup](https://github.com/ServiceNow/BrowserGym#setup); each suite has further environment setup. Record the exact BrowserGym commit, environment/task IDs, browser version, OS, model/provider, cold/warm status, and any required service configuration. For each episode, capture success, action count, elapsed milliseconds, timeouts, and failure reason. Evaluate visual and DOM paths separately. Exclude payments, account changes, and any live external side effects.

Aggregate a JSON file with `benchmarks/aggregate-browsergym.py`:

```json
[
  {"benchmark":"miniwob","task":"click-test","success":true,"actions":3,"latencyMs":842}
]
```

Report task success rate, action-count distribution, latency p50/p95, and timeout rate separately. Publish raw episode records along with every chart. Never present elapsed time alone as “speed” without controlling for task success.

## Calibration

For labeled outcomes, report Brier score and reliability bins alongside accuracy. Do not call `confidence` calibrated unless the provider explicitly identifies its calibration source and the measured reliability backs that up on held-out examples. The local semantic model reports `uncalibrated-estimate`.
