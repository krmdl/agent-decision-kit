# Benchmarks

Every result must include its raw episode data and enough environment detail to reproduce it. Do not turn a small smoke run into a broad quality or performance claim. No aggregate charts are published until repeated, comparable runs support them.

## Decision quality and latency

`fixtures/decision-cases.jsonl` contains a small, human-labeled fixture set. Run it from a built checkout:

```sh
npm run build
node benchmarks/run-decisions.mjs > decision-report.json
```

The script reports per-case labels, probabilities, calibration labels and latency, then aggregates accuracy, Brier score, the first call including pipeline initialization, and within-process warm p50/p95 separately. The warm label only means later calls in the same process; it does not establish a pre-cached model or accelerator state. Record hardware, accelerator, model-cache state, and provider setup. Run each provider as a separate explicit condition; don't mix results. For a fair Jev comparison, use the same cases, request batching, network conditions, and label rubric. Never use provider responses as training data or to tune an imitation.

The starter fixtures are public and tiny. They are useful for verifying the harness, not for proving broad quality, calibration or performance. Keep additional test cases held out and source their labels independently from both tested providers.

`results/decision-cases-smoke.json` is a raw run over the included 11 starter labels using the default local provider on CPU. This particular run scored 8/11 (72.7%) with a 0.370 mean Brier score; first call was 484 ms and later within-process p95 was 25 ms on the recorded Ryzen 5 5600H machine. The artifacts were cached before the process started. The labels are not held out, the estimates are uncalibrated, and these measurements do not establish real-world quality, general speed, or the consumer-GPU target. Recreate it with `npm run build` followed by `node benchmarks/run-decisions.mjs --output benchmarks/results/decision-cases-smoke.json`.

## Browser task success

`results/miniwob-smoke-suite.json` contains a reproducible eight-task MiniWoB smoke suite with one raw JSON episode file per task. The runner attaches the real Agent Decision Kit `BrowserManager` to BrowserGym's live Chromium page through loopback CDP, calls the task validator after each bounded decision/action round, and confirms that detaching does not close BrowserGym's browser. The suite keeps failures, ambiguous choices, and visual-only pages as results instead of omitting them. It is a small smoke suite, not a representative BrowserGym benchmark, model-quality estimate, or speed claim. `latencyMs` includes environment reset; `agentActionLatencyMs` measures the bounded browser decision/action loop; `decisionCallLatencyMs` aggregates model-call latency separately. Synthetic approvals are allowed only for the exact local MiniWoB `file://` task URL.

Raw records redact local file URLs and home-directory paths before writing them to disk. The live approval check still verifies the exact unredacted local MiniWoB URL before confirming any benchmark action.

The checked-in run completed 7/8 tasks (87.5%) with no harness timeouts. End-to-end latency, including environment reset, was p50 1,822 ms and p95 3,154 ms. The browser action path was p50 305 ms and p95 689 ms; the three provider calls were p50 202 ms and p95 208 ms. Each task used a fresh Node bridge process, so its first inference was cold even though model files were cached. Four deterministic local selections (an exact quoted label, a numbered tab, a checkbox target, and an expand/submit step) are excluded from provider-call latency and do not report probabilities. The separate 11-label local decision loop measures its warm within-process p95 at 25 ms. These small CPU smoke fixtures do not establish consumer-GPU performance, calibration, or broad browser quality. The remaining click-link page exposed no DOM control and was recorded as `visual-only-page`.

To reproduce the recorded smoke suite, use Node.js 20.19 or newer, Python 3.10+, and the exact MiniWoB++ revision from the raw records. Install BrowserGym in a separate virtual environment (it is not a runtime dependency of this package):

```sh
python -m venv .venv-browsergym
# Activate the environment, then:
python -m pip install "browsergym-miniwob==0.14.3" "playwright==1.44.0"
python -m playwright install chromium
git clone https://github.com/ServiceNow/miniwob-plusplus.git /tmp/miniwob-plusplus
git -C /tmp/miniwob-plusplus checkout 7fd85d71a4b60325c6585396ec4f48377d049838
npm ci
npm run build
python benchmarks/run-browsergym-miniwob-suite.py \
  --miniwob-root /tmp/miniwob-plusplus/miniwob/html/miniwob \
  --approve-synthetic-actions \
  --output benchmarks/results/miniwob-smoke-suite.json
```

Use a PowerShell-appropriate path for `--miniwob-root` on Windows. Use `--tasks` to select other task IDs, `--max-actions` to change the per-task action cap, and `--timeout-seconds` to bound each runner process. The approval flag is guarded by an exact local `file://` task URL in the episode runner. The recorded package version comes from BrowserGym 0.14.3, whose source commit is recorded in each JSON episode. For larger runs, follow BrowserGym's [official setup](https://github.com/ServiceNow/BrowserGym#setup), the specific [WebArena setup](https://github.com/ServiceNow/BrowserGym/blob/main/browsergym/webarena/README.md), and the [VisualWebArena setup](https://github.com/ServiceNow/BrowserGym/blob/main/browsergym/visualwebarena/README.md). Both WebArena suites need their own configured servers and URLs; BrowserGym documents API-key-dependent fuzzy evaluators, so this repository's open local run does not invoke them. Record exact BrowserGym and environment revisions, browser version, OS, model/provider, cold/warm status, and service configuration. Capture success, action count, elapsed time, timeouts, and failure reasons for every episode. Evaluate visual and DOM paths separately. Exclude payments, account changes, and any live external side effects.

Aggregate a JSON file with `benchmarks/aggregate-browsergym.py`:

```json
[
  {"benchmark":"miniwob","task":"click-test","success":true,"actions":3,"latencyMs":842}
]
```

Report task success rate, action-count distribution, latency p50/p95, and timeout rate separately. Publish raw episode records along with every chart. Never present elapsed time alone as “speed” without controlling for task success.

## Calibration

For labeled outcomes, report Brier score and reliability bins alongside accuracy. Do not call `confidence` calibrated unless the provider explicitly identifies its calibration source and the measured reliability backs that up on held-out examples. The local semantic model reports `uncalibrated-estimate`.
