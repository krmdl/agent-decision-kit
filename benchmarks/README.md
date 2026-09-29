# Benchmarks

Every result must include its raw episode data and enough environment detail to reproduce it. Do not turn a small smoke run into a broad quality or performance claim. No aggregate charts are published until repeated, comparable runs support them.

## Decision quality and latency

`fixtures/decision-cases.jsonl` contains a small, human-labeled fixture set. Run it from a built checkout:

```sh
npm run build
node benchmarks/run-decisions.mjs > decision-report.json
```

The script reports per-case labels, probabilities, calibration labels and latency. It separates choice/yes-no accuracy from ordinal Score mean absolute error, within-half-point rate, and rounded exact-match rate. Brier score is reported by question type. It also records the first call including pipeline initialization and within-process warm p50/p95 separately. Before timing, it records whether the model's cache directory exists; this does not prove that every required file is present. The first call may include model retrieval, and the warm label only means later calls in the same process. Record hardware, accelerator, cache state, and provider setup. Run each provider as a separate explicit condition; don't mix results. For a fair Jev comparison, use the same cases, request batching, network conditions, and label rubric. Never use provider responses as training data or to tune an imitation.

The starter fixtures are public and tiny. They are useful for verifying the harness, not for proving broad quality, calibration or performance. `fixtures/decision-cases-independent.jsonl` adds 30 human-authored examples (10 of each question type). Labels were written from the documented product behavior without consulting provider output. This small project-specific fixture is still not held out from the codebase or pretraining corpus and does not establish general quality. Keep future evaluation cases held out and source labels independently from both tested providers.

`results/decision-cases-smoke.json` is a raw run over the included 11 starter labels using the default local provider on CPU. This particular run scored 8/11 (72.7%) with a 0.370 mean Brier score; first call was 246 ms and later within-process p95 was 14 ms on the recorded Ryzen 5 5600H machine. Its model cache directory existed before the run, though individual files were not checked. The labels are not held out, the estimates are uncalibrated, and these measurements do not establish real-world quality, general speed, or the consumer-GPU target.

`results/decision-cases-independent-smoke.json` records the same local provider on the 30-case project-specific fixture: choice accuracy 7/10, yes/no accuracy 5/10, and Score MAE 1.04 on the 0–4 scale (2/10 within half a point). The mean Brier scores were 0.403 for choice, 0.506 for yes/no, and 0.689 for Score. First call was 246 ms; within-process p95 was 21 ms on the same CPU. Its model cache directory existed before the run, though individual files were not checked. This modest result is included as a visible limitation, not a broad benchmark claim. All estimates remain uncalibrated. Recreate either report with `npm run build`, then run:

`results/decision-cases-linux-docker-smoke.json` repeats the 11 starter labels in the pinned Playwright Docker image on a Linux x64 CPU host (Node 24.20.0, Xeon Gold 6140). It scored 8/11 with mean Brier 0.370; first call was 310 ms and within-process p95 was 19 ms. The model cache directory existed before the run, but individual files were not checked. This is one small integration run, not a cross-platform performance comparison or general quality claim.

```sh
node benchmarks/run-decisions.mjs --output benchmarks/results/decision-cases-smoke.json
node benchmarks/run-decisions.mjs --fixtures benchmarks/fixtures/decision-cases-independent.jsonl --output benchmarks/results/decision-cases-independent-smoke.json
```

## Browser task success

`results/miniwob-smoke-suite.json` contains a reproducible eight-task MiniWoB smoke suite with one raw JSON episode file per task. The runner attaches the real Agent Decision Kit `BrowserManager` to BrowserGym's live Chromium page through loopback CDP, calls the task validator after each bounded decision/action round, and confirms that detaching does not close BrowserGym's browser. The suite keeps failures, ambiguous choices, and visual-only pages as results instead of omitting them. It is a small smoke suite, not a representative BrowserGym benchmark, model-quality estimate, or speed claim. `latencyMs` includes environment reset; `agentActionLatencyMs` measures the bounded browser decision/action loop; `decisionCallLatencyMs` aggregates model-call latency separately. Synthetic approvals are allowed only for the exact local MiniWoB `file://` task URL.

Raw records redact local file URLs and home-directory paths before writing them to disk. The live approval check still verifies the exact unredacted local MiniWoB URL before confirming any benchmark action.

The checked-in run completed 7/8 tasks (87.5%) with no harness timeouts. End-to-end latency, including environment reset, was p50 1,822 ms and p95 3,154 ms. The browser action path was p50 305 ms and p95 689 ms; the three provider calls were p50 202 ms and p95 208 ms. Each task used a fresh Node bridge process, so its first inference was cold with respect to in-process pipeline initialization; pre-run model cache state was not recorded separately for this older suite. Four deterministic local selections (an exact quoted label, a numbered tab, a checkbox target, and an expand/submit step) are excluded from provider-call latency and do not report probabilities. These small CPU smoke fixtures do not establish consumer-GPU performance, calibration, or broad browser quality. The remaining click-link page exposed no DOM control and was recorded as `visual-only-page`.

`results/miniwob-expanded-smoke-suite.json` and the 26 per-task files preserve a broader curated run across visual-only, menu, tab, form, search, and widget tasks. It completed 3/26 tasks with no harness timeouts. End-to-end latency was p50 3,318 ms and p95 4,658 ms; the bounded browser action loop was p50 840 ms and p95 2,147 ms; 51 provider calls had p50 111 ms and p95 789 ms. Five episodes ended on pages with no DOM action candidates, six ended with ambiguous selection, and the action cap was eight rounds. This CPU run used Windows 10 with a Ryzen 5 5600H; its pre-run cache state was not recorded separately.

Interpret these as limited tool-loop integration results, not full coding-agent task-success scores. The original runners repeatedly invoke `browser_decide_and_act`; the 26-task run does not orchestrate field values, native select options, or visual inspection. Both record ambiguous and visual-only states instead of guessing. The focused eight-task and varied 26-task runs are not directly comparable; neither represents the full benchmark distribution or verifies the GPU latency target. The raw suite metadata lists exactly which tools each harness exercises.

`results/miniwob-multi-tool-smoke.json` exercises the form and visual tools in a separate five-task curated run: `enter-text-2`, `choose-date-easy`, `choose-list`, `search-engine`, and `click-link`, with seed 7 and an eight-action cap. The harness copies only explicit values from these synthetic task instructions, chooses an exact enabled visible select label, opens a read-only date picker before selecting its visible day, and clicks the requested paginated search result. It completed 4/5 tasks without harness timeouts. The visual-only `click-link` page triggered local screenshot description but remained unacted, as the vision API does not click controls. End-to-end latency, including environment reset and vision, was p50 2,195 ms and p95 34,812 ms; the browser/tool action loop was p50 698 ms and p95 33,411 ms. No semantic decision-provider call was made in this run; the single visual call took 33,344 ms on CPU. These numbers describe this explicit-value integration harness, not an autonomous agent, general browser success, or speed advantage. Raw records omit the entered fake field values.

Reproduce the multi-tool fixture with the same BrowserGym setup:

```sh
python benchmarks/run-browsergym-miniwob-suite.py \
  --miniwob-root /tmp/miniwob-plusplus/miniwob/html/miniwob \
  --tasks enter-text-2 choose-date-easy choose-list search-engine click-link \
  --seed 7 --max-actions 8 --timeout-seconds 180 \
  --multi-tool --approve-synthetic-actions \
  --output benchmarks/results/miniwob-multi-tool-smoke.json
```

Reproduce the expanded task mix with the same runner and action cap:

```sh
python benchmarks/run-browsergym-miniwob-suite.py \
  --miniwob-root /tmp/miniwob-plusplus/miniwob/html/miniwob \
  --tasks ascending-numbers choose-date-easy choose-list click-button \
    click-checkboxes-large click-collapsible-2 click-dialog-2 click-link \
    click-menu-2 click-option click-scroll-list click-tab-2-easy click-test-2 \
    click-widget copy-paste daily-calendar email-inbox-noscroll enter-date \
    enter-text-2 focus-text-2 form-sequence-2 navigate-tree read-table-2 \
    search-engine use-autocomplete-nodelay use-slider-2 \
  --max-actions 8 --approve-synthetic-actions \
  --output benchmarks/results/miniwob-expanded-smoke-suite.json
```

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

## Visual-only fallback

`npm run vision:verify` opens the local synthetic canvas demo, confirms it has no DOM action candidates, and asks the local vision model to read the main button label. The test passes only when the returned description contains the expected `Open task` label. Its raw one-sample record is `results/vision-smoke.json`.

The checked-in run recognized the label on CPU in 21,634 ms with model files already present in the local cache. The timing includes model initialization and generation. Confidence is unavailable; this is an integration smoke check, not a quality, calibration, or speed benchmark. If the model is not cached, the first run downloads its weights. The screenshot and model inference remain local.

## Calibration

For labeled outcomes, report Brier score and reliability bins alongside accuracy. Do not call `confidence` calibrated unless the provider explicitly identifies its calibration source and the measured reliability backs that up on held-out examples. The local semantic model reports `uncalibrated-estimate`.
