# Benchmarks

Every result must include its raw episode data and enough environment detail to reproduce it. Do not turn a small smoke run into a broad quality or performance claim. No aggregate charts are published until repeated, comparable runs support them.

## Decision quality and latency

`fixtures/decision-cases.jsonl` contains a small, human-labeled fixture set. Run it from a built checkout:

```sh
npm run build
node benchmarks/run-decisions.mjs > decision-report.json
```

The script reports per-case labels, probabilities, confidence source, calibration labels and latency. It separates choice/yes-no accuracy from ordinal Score mean absolute error, within-half-point rate, and rounded exact-match rate. Brier score is reported by question type. For Choice and yes/no, it also reports ten-bin confidence reliability and expected calibration error (ECE), grouped by confidence source and calibration label; Score confidence is retained in raw records but excluded from this binary correctness analysis. ECE is descriptive and does not fit a post-hoc calibration. The script records the first call including pipeline initialization and within-process warm p50/p95 separately. Before timing, it records whether the model's cache directory exists; this does not prove that every required file is present. The first call may include model retrieval, and the warm label only means later calls in the same process. Record hardware, accelerator, cache state, and provider setup. Run each provider as a separate explicit condition; don't mix results. For a fair Jev comparison, use the same cases, request batching, network conditions, and label rubric. Never use provider responses as training data or to tune an imitation.

The starter fixtures are public and tiny. They are useful for verifying the harness, not for proving broad quality, calibration or performance. `fixtures/decision-cases-independent.jsonl` adds 30 human-authored examples (10 of each question type). Labels were written from the documented product behavior without consulting provider output. This small project-specific fixture is still not held out from the codebase or pretraining corpus and does not establish general quality. Keep future evaluation cases held out and source labels independently from both tested providers.

`results/decision-cases-smoke.json` is a raw run over the included 11 starter labels using the default local provider on CPU. This particular run scored 8/11 (72.7%) with a 0.370 mean Brier score; first call was 246 ms and later within-process p95 was 14 ms on the recorded Ryzen 5 5600H machine. Its model cache directory existed before the run, though individual files were not checked. The labels are not held out, the estimates are uncalibrated, and these measurements do not establish real-world quality, general speed, or the consumer-GPU target.

`results/decision-cases-independent-smoke.json` records the local provider on the 30-case project-specific fixture: choice accuracy 7/10, yes/no accuracy 5/10, and Score MAE 1.04 on the 0–4 scale (2/10 within half a point). The mean Brier scores were 0.403 for choice, 0.506 for yes/no, and 0.689 for Score. First call was 246 ms; within-process p95 was 21 ms on the same CPU. Its model cache directory existed before the run, though individual files were not checked. This modest result is included as a visible limitation, not a broad benchmark claim. All estimates remain uncalibrated. A newer run is recorded in `results/decision-cases-independent-reliability-smoke.json`: it repeats the same labels with confidence source included per case, reports ten-bin reliability for the 20 Choice/yes-no answers, and found 0.061 ECE. Eleven answers landed in the 0.5–0.6 confidence bin and seven in 0.6–0.7; because this sample is small and not a frozen holdout, those numbers do not validate calibration. The Windows run's first call was 210 ms and warm p95 was 17 ms. Recreate the reports with `npm run build`, then run:

`results/decision-cases-linux-docker-smoke.json` repeats the 11 starter labels in the pinned Playwright Docker image on a Linux x64 CPU host (Node 24.20.0, Xeon Gold 6140). It scored 8/11 with mean Brier 0.370; first call was 310 ms and within-process p95 was 19 ms. The model cache directory existed before the run, but individual files were not checked. This is one small integration run, not a cross-platform performance comparison or general quality claim.

```sh
node benchmarks/run-decisions.mjs --output benchmarks/results/decision-cases-smoke.json
node benchmarks/run-decisions.mjs --fixtures benchmarks/fixtures/decision-cases-independent.jsonl --output benchmarks/results/decision-cases-independent-smoke.json
node benchmarks/run-decisions.mjs --fixtures benchmarks/fixtures/decision-cases-independent.jsonl --output benchmarks/results/decision-cases-independent-reliability-smoke.json
```

The Linux Docker repeat is `results/decision-cases-independent-reliability-linux-docker-smoke.json`. It used the same 30 labels on Node 24.20.0 and an x64 Xeon CPU: Choice 7/10, yes/no 5/10, Score MAE 1.037, mean Brier 0.533, and ECE 0.061 over the 20 Choice/yes-no confidence values. First call was 329 ms and within-process warm p95 was 31 ms. This single Linux sample is consistent with the Windows run, but it does not establish cross-platform parity. Reproduce it from a Linux shell in the repository root with:

```sh
docker run --rm --ipc=host \
  -v "$PWD:/work" -v "$HOME/.cache:/root/.cache" -w /work \
  mcr.microsoft.com/playwright:v1.63.0-noble \
  bash -lc 'npm ci && node benchmarks/run-decisions.mjs --fixtures benchmarks/fixtures/decision-cases-independent.jsonl --output benchmarks/results/decision-cases-independent-reliability-linux-docker-smoke.json'
```

The cache mount keeps downloaded model files between local runs; on a cold cache, the first call includes model retrieval. Container dependency installation and execution are part of the reproduction, while the per-case latency numbers cover provider calls only.

For the local Transformers.js provider, `AGENT_DECISION_DEVICE` selects the requested ONNX Runtime device (`cpu` by default; `auto`, `dml`, `cuda`, `coreml`, `webgpu`, `gpu`, or `wasm` are also accepted). The report records the requested device, not the execution provider selected for every ONNX node; ONNX Runtime can place unsupported nodes on CPU. Compare only runs on the same labeled cases and host. A GPU name or requested device alone does not prove acceleration.

`results/decision-cases-independent-ryzen5600h-cpu-smoke.json` and `results/decision-cases-independent-ryzen5600h-dml-smoke.json` compare the same 30 labeled examples on one Windows 10 laptop (Ryzen 5 5600H; operator-reported GeForce GTX 1650 with 4 GB VRAM; Node 22.14.0). The model-cache directory existed before each process, but individual files were not checked. CPU scored 7/10 Choice, 5/10 yes/no, and 1.042 Score MAE; first call was 198 ms and the 29 later calls had p50 10 ms / p95 17 ms. Choice/yes-no Brier scores were 0.403 / 0.506. A DirectML device was requested for the second run; it scored 7/10 Choice, 5/10 yes/no, and 1.038 Score MAE; first call was 435 ms and warm p50 90 ms / p95 132 ms. Choice/yes-no Brier scores were 0.399 / 0.505. The Choice/yes-no ECE over 20 answers was 0.061 on CPU and 0.065 on the DirectML request. On this small embedding workload, requesting DirectML was slower than CPU. This is one paired run on a project-specific fixture that is not held out; the DML request does not prove all ONNX nodes ran on the GPU, and neither result is a general speed, quality, or calibration claim. Reproduce both reports with the same fixture:

```sh
AGENT_DECISION_DEVICE=cpu AGENT_DECISION_BENCHMARK_ACCELERATOR="NVIDIA GeForce GTX 1650 (4 GB VRAM; manually reported)" \
  node benchmarks/run-decisions.mjs --fixtures benchmarks/fixtures/decision-cases-independent.jsonl \
  --output benchmarks/results/decision-cases-independent-ryzen5600h-cpu-smoke.json
AGENT_DECISION_DEVICE=dml AGENT_DECISION_BENCHMARK_ACCELERATOR="NVIDIA GeForce GTX 1650 (4 GB VRAM; manually reported)" \
  node benchmarks/run-decisions.mjs --fixtures benchmarks/fixtures/decision-cases-independent.jsonl \
  --output benchmarks/results/decision-cases-independent-ryzen5600h-dml-smoke.json
```

## Browser task success

`results/miniwob-smoke-suite.json` contains a reproducible eight-task MiniWoB smoke suite with one raw JSON episode file per task. The runner attaches the real Agent Decision Kit `BrowserManager` to BrowserGym's live Chromium page through loopback CDP, calls the task validator after each bounded decision/action round, and confirms that detaching does not close BrowserGym's browser. The suite keeps failures, ambiguous choices, and visual-only pages as results instead of omitting them. It is a small smoke suite, not a representative BrowserGym benchmark, model-quality estimate, or speed claim. `latencyMs` includes environment reset; `agentActionLatencyMs` measures the bounded browser decision/action loop; `decisionCallLatencyMs` aggregates model-call latency separately. Synthetic approvals are allowed only for the exact local MiniWoB `file://` task URL.

The pinned Linux runner image matches BrowserGym 0.14.3's Python Playwright browser revision while retaining the repository's Node 24 Playwright runtime. Build it with `docker build -f benchmarks/Dockerfile.browsergym -t adk-browsergym-miniwob:0.14.3 .`; run a focused local integration set with:

```sh
docker run --rm --ipc=host \
  -v "$PWD:/work" -v /tmp/miniwob-plusplus:/tmp/miniwob-plusplus:ro -w /work \
  -e ONNXRUNTIME_NODE_INSTALL=skip adk-browsergym-miniwob:0.14.3 \
  bash -lc 'npm ci && npm run build && python3 benchmarks/run-browsergym-miniwob-suite.py --miniwob-root /tmp/miniwob-plusplus/miniwob/html/miniwob --output benchmarks/results/miniwob-post-reward-fix-smoke.json --tasks click-checkboxes-large copy-paste use-slider-2 --multi-tool --approve-synthetic-actions --timeout-seconds 120'
```

MiniWoB success is counted only when `RAW_REWARD_GLOBAL >= 1.0`; partial rewards count as failures even if the BrowserGym wrapper reports a positive binary reward. The episode record preserves both the wrapper reward and raw task reward. This guards against the reward-threshold issue documented by [BrowserGym](https://github.com/ServiceNow/BrowserGym/issues/392). An audit of the checked-in MiniWoB records found no successful episode with a positive partial raw reward.

`results/miniwob-post-reward-fix-smoke.json` is a three-task Linux Docker integration check captured after the reward guard was added. All three selected tasks (`click-checkboxes-large`, `copy-paste`, and `use-slider-2`) reached raw task reward 1.0. The run exercised checkbox batching, local field copy, keyboard slider setting, and the separately approved local submit path. End-to-end latency including reset was p50 1,812 ms / p95 1,920 ms; browser tool-action latency was p50 927 ms / p95 1,005 ms. There were no semantic model calls, so this run provides no decision-model latency measurement. It used a four-vCPU Intel Xeon Gold 6140 Linux host, Node 24.20.0, Python 3.12.3, BrowserGym 0.14.3, Python Playwright 1.44.0, Node Playwright 1.63.0, and Chromium 125. This is a small, explicitly selected integration smoke test, not a representative task sample, autonomous-agent score, general speed claim, or consumer-GPU result. The summary and three task episodes are stored together.

Raw records redact local file URLs and home-directory paths before writing them to disk. The live approval check still verifies the exact unredacted local MiniWoB URL before confirming any benchmark action.

The checked-in run completed 7/8 tasks (87.5%) with no harness timeouts. End-to-end latency, including environment reset, was p50 1,822 ms and p95 3,154 ms. The browser action path was p50 305 ms and p95 689 ms; the three provider calls were p50 202 ms and p95 208 ms. Each task used a fresh Node bridge process, so its first inference was cold with respect to in-process pipeline initialization; pre-run model cache state was not recorded separately for this older suite. Four deterministic local selections (an exact quoted label, a numbered tab, a checkbox target, and an expand/submit step) are excluded from provider-call latency and do not report probabilities. These small CPU smoke fixtures do not establish consumer-GPU performance, calibration, or broad browser quality. The remaining click-link page exposed no DOM control and was recorded as `visual-only-page`.

`results/miniwob-postfastpath-smoke.json` repeats the same eight tasks and seed in the pinned Playwright Docker image on Linux x64 (Node 24.20.0, BrowserGym 0.14.3, Chromium 125). It also completed 7/8 with no timeouts. End-to-end latency was p50 1,206 ms and p95 1,584 ms; browser action latency was p50 333 ms and p95 706 ms; three model calls had p50 225 ms and p95 285 ms. Four choices resolved by exact local rules; three used the semantic provider; the visual-only page remained unacted. This is a Linux integration record, not a speed comparison with the Windows run or a representative quality benchmark. Eight per-task raw files are stored alongside the summary.

`results/miniwob-expanded-smoke-suite.json` and the 26 per-task files preserve a broader curated run across visual-only, menu, tab, form, search, and widget tasks. It completed 3/26 tasks with no harness timeouts. End-to-end latency was p50 3,318 ms and p95 4,658 ms; the bounded browser action loop was p50 840 ms and p95 2,147 ms; 51 provider calls had p50 111 ms and p95 789 ms. Five episodes ended on pages with no DOM action candidates, six ended with ambiguous selection, and the action cap was eight rounds. This CPU run used Windows 10 with a Ryzen 5 5600H; its pre-run cache state was not recorded separately.

`results/miniwob-expanded-multi-tool-followup.json` and its 26 episode files record a multi-tool integration run over the same task mix on Linux x64 CPU. It completed 10/26 tasks with no harness timeouts. End-to-end latency was p50 1,288 ms and p95 22,142 ms; the browser/tool action loop was p50 494 ms and p95 21,325 ms; 33 semantic decision calls had p50 97 ms and p95 542 ms. Two local vision descriptions account for the long visual-only tail. Each task used a fresh Node bridge, so its semantic call includes cold process/model initialization; this CPU p95 does not represent warm throughput or the consumer-GPU target. The harness only copies explicit values from synthetic task instructions and visible options, so this is not an autonomous-agent score. It used Agent Decision Kit commit `0b721e9`, BrowserGym 0.14.3, MiniWoB++ commit `7fd85d7`, Node 24.20.0, and Chromium 125. The earlier email-task locator timeout did not recur after the dynamic DOM reference fix; the task still failed its goal, and all failures remain in the raw records.

The earlier `results/miniwob-expanded-multi-tool-8490bd7.json` run and its 26 episode files recorded 17/26 tasks (65.4%) on Linux x64 CPU with no harness timeouts. End-to-end latency was p50 1,120 ms and p95 26,303 ms; the browser/tool action loop was p50 344 ms and p95 25,505 ms; 13 decision calls had p50 38 ms and p95 1,884 ms. Two CPU local-vision descriptions took about 25 and 30 seconds and account for the long tail. The later run below supersedes these measurements. The earlier result used Agent Decision Kit commit `8490bd750e7f8741e779ae329c6ba1eb832e1b8c`, BrowserGym 0.14.3, MiniWoB++ commit `7fd85d71a4b60325c6585396ec4f48377d049838`, Node 24.20.0, Python 3.12.3, and Chromium 125. The local model cache was populated; no remote decision provider was used. The two raw vision descriptions are not evidence that visual actions work: the vision API only described the pages.

The native-select and pre-submit follow-up `results/miniwob-expanded-multi-tool-ce87fba.json` and its 26 episode files completed 18/26 tasks (69.2%) with no harness timeouts on Linux x64 CPU. End-to-end latency, including environment reset, was p50 1,153 ms / p95 28,747 ms; browser action-loop latency was p50 346 ms / p95 27,874 ms; ten measured decision calls had p50 57 ms / p95 1,909 ms. Two CPU local-vision descriptions took tens of seconds and did not act. `use-autocomplete-nodelay` still failed to complete within the eight-action cap on this commit; the repeated-action guard was generalized in the next commit. This interim run used Agent Decision Kit commit `ce87fba4a31c2938e74b5b7d00cb088e3242c403`, BrowserGym 0.14.3, MiniWoB++ commit `7fd85d71a4b60325c6585396ec4f48377d049838`, Playwright Python 1.44.0 / Node 1.63.0, Node 24.20.0, Python 3.12.3, and Chromium 125. Its cache was populated before episodes; no remote provider was used.

The `results/miniwob-expanded-multi-tool-361f236.json` run and its 26 episode files completed 19/26 tasks (73.1%) with no harness timeouts on Linux x64 CPU. End-to-end latency, including environment reset, was p50 1,195 ms / p95 22,142 ms; browser action-loop latency was p50 358 ms / p95 21,246 ms; six measured decision calls had p50 200 ms / p95 400 ms. The two CPU local-vision descriptions took 22,142 ms and 35,955 ms end-to-end and described visual-only pages without taking actions. The run exercised native select and pre-submit paths, but did not call `browser_set_range`; `use-slider-2` had no safe slider candidate. This historical run used Agent Decision Kit commit `361f236928a07a78d723ec8021526ea78e1b8780`, BrowserGym 0.14.3, MiniWoB++ commit `7fd85d71a4b60325c6585396ec4f48377d049838`, Playwright Python 1.44.0 / Node 1.63.0, Node 24.20.0, Python 3.12.3, and Chromium 125. The local model cache was populated before each episode and no remote decision provider was used.

The `results/miniwob-expanded-multi-tool-b901f05.json` run and its 26 episode files are the same-task-set baseline before support for MiniWoB's keyboard-operated jQuery UI sliders. It completed 19/26 tasks with no harness timeouts; its tool coverage did not include `browser_set_range`, and `use-slider-2` failed without changing the task outcome. It used seed 7, eight actions per task, the same pinned BrowserGym/MiniWoB++ environment, and Linux x64 CPU. The complete summary and all per-task episodes are retained so the later run can be checked task by task.

The prior `results/miniwob-expanded-multi-tool-60bec66.json` run and its 26 episode files completed 20/26 tasks (76.9%) with no harness timeouts on Linux x64 CPU. End-to-end latency, including environment reset, was p50 1,207 ms / p95 23,011 ms; browser action-loop latency was p50 360 ms / p95 22,147 ms; six measured decision calls had p50 211 ms / p95 471 ms. Local CPU vision described the visual-only `ascending-numbers` and `daily-calendar` pages without acting; their end-to-end times were 23,011 ms and 36,712 ms. Other misses were the eight-action cap on `click-checkboxes-large`, unmet explicit field prerequisites on `copy-paste` and `read-table-2`, and the no-progress guard on `email-inbox-noscroll`. `use-slider-2` passed after three direct `browser_set_range` calls and a separate approval-gated Submit action; it was the only task whose outcome differed from the `b901f05` run. This paired observation is not a broad success estimate or an isolated causal benchmark. The harness copies explicit values from synthetic instructions and visible choices, so these results measure bounded tool integration, not an autonomous-agent score. The run used Agent Decision Kit commit `60bec668aaa1f5fa73a3ea863e2ada3193446367`, BrowserGym 0.14.3, MiniWoB++ commit `7fd85d71a4b60325c6585396ec4f48377d049838`, Playwright Python 1.44.0 / Node 1.63.0, Node 24.20.0, Python 3.12.3, Chromium 125, and CPU only. The local model cache was populated before each episode; no remote decision provider was used. All tool traces, versions, and machine details are in the raw records.

`results/miniwob-expanded-multi-tool-790aa2a.json` and its 26 per-task files are the earlier 22/26 run, retained as history. It used the same curated task set, seed 7, eight-action cap, synthetic local approvals, and CPU environment; `click-checkboxes-large` and `copy-paste` changed from failures to passes relative to its 20/26 predecessor. See its raw records for the complete measurements and source verification.

`results/miniwob-expanded-multi-tool-00b7b13.json` and its 26 per-task files record a later same-task-set run that also completed 22/26 with no timeouts. The exact-sender email path passed, but the custom pointer-target path introduced a duplicate for the nested menu item, so `click-menu-2` regressed. End-to-end latency including reset was p50 1,216 ms / p95 22,676 ms; browser action-loop latency was p50 379 ms / p95 21,628 ms; five measured decision calls had p50 292 ms / p95 1,091 ms. The two visual-only tasks still failed after local CPU descriptions; `read-table-2` was the other failure. This run exposed a menu-target ambiguity and is kept alongside the repaired result rather than omitted.

`results/miniwob-expanded-multi-tool-8ffc709.json` and its 26 per-task files preserve the prior full curated run on source commit `8ffc7093c3b7732589bfb33a48a123c0514c9ddb`. It completed 23/26 (88.5%) with no harness timeouts on Linux x64 CPU. End-to-end latency including reset was p50 1,130 ms / p95 25,838 ms; browser action-loop latency was p50 351 ms / p95 25,015 ms; four timed decision calls had p50 241 ms / p95 2,190 ms. It included `ascending-numbers` and `daily-calendar`, which received local visual descriptions without browser actions, and `read-table-2`, which stopped before filling its fields. This older run is retained as a 26-task reference, not as the latest result.

`results/miniwob-dom-table-24-5b52abc-utf8.json` and its 24 per-task records are the latest DOM-focused integration run. The curated task set excludes the two visual-only pages `ascending-numbers` and `daily-calendar`; it completed all 24 selected tasks with no harness timeouts. `read-table-2` now succeeds through bounded visible table rows and explicit adjacent field labels, and `click-checkboxes-large` selects ten named checkboxes in one batch call. End-to-end latency including BrowserGym reset was p50 1,665 ms / p95 2,598 ms; browser action-loop latency was p50 323 ms / p95 907 ms; four local semantic calls had p50 191 ms / p95 430 ms. This Windows 10 Pro CPU run used an AMD Ryzen 5 5600H, Node 22.14.0, Python 3.10.0, BrowserGym 0.14.3, MiniWoB++ commit `7fd85d71a4b60325c6585396ec4f48377d049838`, Playwright Python 1.44.0 / Node 1.63.0, and Chromium 125. The records identify base commit `5b52abc1c261d13ed4619a96beebf9522f1c4aea` and mark that the working tree was modified. The multi-tool harness uses explicit synthetic task instructions and visible rows; synthetic approval is limited to the exact local MiniWoB file URL. These 24 selected tasks do not establish a full MiniWoB score, autonomous-agent quality, general speed, GPU performance, or visual task success. All visual tools remain outside this run.

`results/miniwob-expanded-multi-tool-78e53ae.json` and its 26 per-task files are the previous same-task-set run. It also completed 23/26 (88.5%) with no harness timeouts on Linux x64 CPU, using BrowserGym 0.14.3, MiniWoB++ commit `7fd85d71a4b60325c6585396ec4f48377d049838`, Node 24.20.0, Python 3.12.3, Playwright Python 1.44.0 / Node 1.63.0, and Chromium 125. The source commit was `78e53ae5c92ef15c772a09691939d1a3b812aefa`. End-to-end latency including reset was p50 1,192 ms / p95 23,342 ms; browser action-loop latency was p50 361 ms / p95 22,317 ms; four measured decision calls had p50 239 ms / p95 692 ms. This prior run remains available for comparison, but these two samples do not establish a speed change. The bounded harness is not a full autonomous agent or representative quality benchmark. Raw episode files preserve tool traces, approvals, versions, and failures.

`results/miniwob-targeted-browser-fixes-8490bd7.json` and six per-task records preserve a separate focused regression run of `click-collapsible-2`, `click-menu-2`, `click-test-2`, `click-widget`, `focus-text-2`, and `form-sequence-2`. All six passed, with zero semantic decision-provider calls. Browser action-loop latency was p50 258 ms and p95 721 ms on Linux CPU. This deliberately selected regression set is not representative and must not be compared to the 26-task success rate.

Interpret these as limited tool-loop integration results, not full coding-agent task-success scores. The older decision/action-only runner repeatedly invokes `browser_decide_and_act`; the newer 26-task run also orchestrates explicit synthetic form and slider values, visible native select options, local visual descriptions, and a separately approved explicit submission, while still not completing visual-only tasks autonomously. The runs record ambiguous and visual-only states instead of guessing. The focused regression set and varied 26-task run are not directly comparable; neither represents the full benchmark distribution or verifies the GPU latency target. The raw suite metadata lists exactly which tools each harness exercises.

`results/miniwob-multi-tool-smoke.json` exercises the form and visual tools in a separate five-task curated run: `enter-text-2`, `choose-date-easy`, `choose-list`, `search-engine`, and `click-link`, with seed 7 and an eight-action cap. The harness copies only explicit values from these synthetic task instructions, chooses an exact enabled visible select label, opens a read-only date picker before selecting its visible day, and clicks the requested paginated search result. It completed 4/5 tasks without harness timeouts. The visual-only `click-link` page triggered local screenshot description but remained unacted, as the vision API does not click controls. End-to-end latency, including environment reset and vision, was p50 2,195 ms and p95 34,812 ms; the browser/tool action loop was p50 698 ms and p95 33,411 ms. No semantic decision-provider call was made in this run; the single visual call took 33,344 ms on CPU. These numbers describe this explicit-value integration harness, not an autonomous agent, general browser success, or speed advantage. Raw records omit the entered fake field values.

Reproduce the expanded multi-tool run with the same BrowserGym and MiniWoB++ setup:

```sh
python benchmarks/run-browsergym-miniwob-suite.py \
  --miniwob-root /tmp/miniwob-plusplus/miniwob/html/miniwob \
  --tasks ascending-numbers choose-date-easy choose-list click-button \
    click-checkboxes-large click-collapsible-2 click-dialog-2 click-link \
    click-menu-2 click-option click-scroll-list click-tab-2-easy click-test-2 \
    click-widget copy-paste daily-calendar email-inbox-noscroll enter-date \
    enter-text-2 focus-text-2 form-sequence-2 navigate-tree read-table-2 \
    search-engine use-autocomplete-nodelay use-slider-2 \
  --seed 7 --max-actions 8 --timeout-seconds 180 \
  --multi-tool --approve-synthetic-actions \
  --output benchmarks/results/miniwob-expanded-multi-tool-8ffc709.json
```

Reproduce the current DOM-focused subset (omitting the two visual-only tasks that are covered separately):

```sh
python benchmarks/run-browsergym-miniwob-suite.py \
  --miniwob-root /tmp/miniwob-plusplus/miniwob/html/miniwob \
  --tasks choose-date-easy choose-list click-button click-checkboxes-large \
    click-collapsible-2 click-dialog-2 click-link click-menu-2 click-option \
    click-scroll-list click-tab-2-easy click-test-2 click-widget copy-paste \
    email-inbox-noscroll enter-date enter-text-2 focus-text-2 form-sequence-2 \
    navigate-tree read-table-2 search-engine use-autocomplete-nodelay use-slider-2 \
  --seed 7 --max-actions 8 --timeout-seconds 120 \
  --multi-tool --approve-synthetic-actions \
  --output benchmarks/results/miniwob-dom-table-24-5b52abc-utf8.json
```

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

Use a PowerShell-appropriate path for `--miniwob-root` on Windows. Use `--tasks` to select other task IDs, `--max-actions` to change the per-task action cap, and `--timeout-seconds` to bound each runner process. The approval flag is guarded by an exact local `file://` task URL in the episode runner. The recorded package version comes from BrowserGym 0.14.3, whose source commit is recorded in each JSON episode. Record exact BrowserGym and environment revisions, browser version, OS, model/provider, cold/warm status, and service configuration. Capture success, action count, elapsed time, timeouts, and failure reasons for every episode. Evaluate visual and DOM paths separately. Exclude payments, account changes, and any live external side effects.

### WebArena and VisualWebArena prerequisites

MiniWoB is self-contained in a local checkout. The original multi-site WebArena and VisualWebArena are separate services; installing their BrowserGym packages does not provision their sites. BrowserGym's [WebArena guide](https://github.com/ServiceNow/BrowserGym/blob/main/browsergym/webarena/README.md) expects domain URLs in `WA_SHOPPING`, `WA_SHOPPING_ADMIN`, `WA_REDDIT`, `WA_GITLAB`, `WA_WIKIPEDIA`, `WA_MAP`, and `WA_HOMEPAGE`. Its [VisualWebArena guide](https://github.com/ServiceNow/BrowserGym/blob/main/browsergym/visualwebarena/README.md) expects `VWA_CLASSIFIEDS`, `VWA_SHOPPING`, `VWA_REDDIT`, `VWA_WIKIPEDIA`, and `VWA_HOMEPAGE`; optional reset URLs are documented there too. Neither full suite has configured domains or a task result in this repository.

WebArena Verified is a separate, containerized single-site benchmark. The repository includes `run-browsergym-webarena-verified.py`, which accepts only `shopping_admin` tasks tagged `navigate`; it refuses retrieval and mutation tasks and never auto-approves actions. An initial smoke on task 157 (`View the details of all customers`) received partial reward 0.5 after five actions cycled between the visible `Customers` and `All Customers` links. A follow-up stopped when an exact visible heading matched the all-items request and completed task 157 once with reward 1.0 after two browser actions (`Customers` then `All Customers`). The latest run on commit `ad6e1b3` covers 18 read-only navigation tasks in the synthetic admin site: 1/18 received full reward, 8 received partial reward 0.5, 9 received zero, and none timed out. The mean reward increased from 0.056 in the initial 18-task baseline to 0.278, while the full-success count stayed at one. Report tasks that expose a matching report link receive at most two actual clicks before the repeat guard refuses to toggle a visited menu; report date filters and two unmatched report targets remain incomplete. The 18 episodes ran on Windows CPU with BrowserGym and WebArena Verified 0.14.3, Python Playwright 1.44.0, Node Playwright 1.63.0, HeadlessChrome 125, and the shopping-admin image digest recorded in each raw episode. End-to-end latency, including BrowserGym reset, was p50 13.366 s / p95 14.202 s; 37 decision/action calls had p50 316 ms / p95 2.197 s. Those calls include inspection and local selection overhead; they are not pure model inference. These measurements are a narrow single-site tool integration sample, not an aggregate WebArena score, a speed comparison, or a Jev comparison. The [latest 18-task aggregate JSON](results/webarena-verified-shopping-admin-ad6e1b3-summary.json) and [initial 18-task baseline JSON](results/webarena-verified-shopping-admin-initial-18-task-baseline.json) each embed raw episodes without evaluator internals or expected answers. The earlier one-task records remain [`webarena-verified-shopping-admin-157-target-visible.json`](results/webarena-verified-shopping-admin-157-target-visible.json) and [`webarena-verified-shopping-admin-157-loop-guard.json`](results/webarena-verified-shopping-admin-157-loop-guard.json).

To reproduce the same single-site smoke on a machine with Docker space for the image, Node.js, and Python 3.12:

```sh
npm run build
python -m venv .venv-browsergym-hosted
# Activate the environment, then:
python -m pip install -r benchmarks/requirements-browsergym-hosted.txt
python -m playwright install chromium
python -c "import nltk; nltk.download('punkt_tab')"
docker run --rm -d --name adk-webarena-verified --memory=4g --cpus=2 --shm-size=512m \
  -p 127.0.0.1:7780:80 -p 127.0.0.1:7781:8877 \
  am1n3e/webarena-verified-shopping_admin@sha256:d0531dd27ed98d0c459ff9e88118bf2ed8b660b0ed99c38837db46c065a5be13
python benchmarks/run-browsergym-webarena-verified.py --task-id 157 \
  --shopping-admin-url http://localhost:7780/admin \
  --output benchmarks/results/webarena-verified-shopping-admin-157-target-visible.json
docker stop adk-webarena-verified
```

To rerun the same read-only task subset after the services and the pinned BrowserGym environment are ready, keep the episode files separate and aggregate them after the loop. The runner returns exit code 1 when BrowserGym reward is below 1, even though it writes a valid episode JSON; `Test-Path` distinguishes a recorded task failure from a runner failure:

```powershell
$taskIds = @(157, 374, 375, 676, 677, 678, 679, 680, 704, 705, 706, 707, 708, 709, 710, 711, 712, 713)
foreach ($taskId in $taskIds) {
  $record = "benchmarks/results/webarena-verified-shopping-admin-$taskId.json"
  python benchmarks/run-browsergym-webarena-verified.py --task-id $taskId `
    --shopping-admin-url http://localhost:7780/admin --max-actions 12 --output $record
  if (-not (Test-Path $record)) { throw "Runner did not write task $taskId" }
}
$records = $taskIds | ForEach-Object { "benchmarks/results/webarena-verified-shopping-admin-$_.json" }
python benchmarks/aggregate-browsergym.py @records --output benchmarks/results/webarena-verified-shopping-admin-summary.json
```

The recorded task IDs are a curated subset of navigation-only `shopping_admin` entries. Do not interpret this site-specific sample as coverage of the original multi-site WebArena, VisualWebArena, retrieval tasks, or mutation tasks.

Install the pinned BrowserGym wrappers in a dedicated Python environment; this does not start or download the original WebArena or VisualWebArena website services:

```sh
python -m venv .venv-browsergym-hosted
# Activate the environment, then:
python -m pip install -r benchmarks/requirements-browsergym-hosted.txt
python -m playwright install chromium
python -c "import nltk; nltk.download('punkt_tab')"
```

The wrappers are pinned to BrowserGym 0.14.3. Set the domain URLs using the upstream guides, then run the read-only preflight below before any task evaluation.

The upstream WebArena setup asks for an OpenAI API key and warns that some fuzzy-match evaluators call GPT-4. The default Agent Decision Kit benchmark path is local and free, so it does not enable those paid evaluators. Any future run must record which evaluator was used and avoid a remote judge unless the operator deliberately configures one.

After setting the documented variables, verify URL reachability without printing configured values:

```sh
python benchmarks/check_browsergym_services.py --suite all
```

Use `--suite webarena` or `--suite visualwebarena` to check one benchmark. The preflight sends read-only `HEAD` requests (and a one-byte ranged `GET` only when a server rejects `HEAD`), prints only variable names and HTTP statuses, and does not call any evaluator.

Aggregate a JSON file with `benchmarks/aggregate-browsergym.py`:

```json
[
  {"benchmark":"miniwob","task":"click-test","success":true,"actions":3,"latencyMs":842}
]
```

Report task success rate, action-count distribution, latency p50/p95, and timeout rate separately. Publish raw episode records along with every chart. Never present elapsed time alone as “speed” without controlling for task success.

## Visual-only fallback

`npm run vision:verify` opens the local synthetic canvas demo, confirms it has no DOM action candidates, and asks the local vision model to read the main button label. The test passes only when the returned description contains the expected `Open task` label. Its raw one-sample record is `results/vision-smoke.json`.

The checked-in run recognized the label on CPU in 14,813 ms with model files already present in the local cache. The timing includes model initialization and generation. Confidence is unavailable; this is an integration smoke check, not a quality, calibration, or speed benchmark. If the model is not cached, the first run downloads its weights. The screenshot and model inference remain local. This is one run and does not represent typical latency.

`results/ocr-smoke.json` is a one-page local OCR and approval-gated visual-click integration check on the synthetic canvas demo. It recognizes the prominent `Save draft` and `Delete draft` labels, proposes the exact unique `Save draft` phrase without clicking, checks cancellation, then separately approves that local click. A second pending proposal is rejected after the screenshot changes. OCR missed the smaller `Open task` label. The current single Windows CPU sample took 1,060 ms overall (73 ms screenshot, 199 ms engine initialization, 788 ms recognition); a sparse-text retry took 678 ms. These are one-sample smoke timings, not a general OCR quality or speed claim; engine confidence is uncalibrated and OCR may miss small labels.

`results/miniwob-ocr-click-link-smoke.json` and `results/miniwob-ocr-click-link-smoke-click-link.json` record the quoted-target OCR integration run on the pinned MiniWoB `click-link` page. On Linux x64 CPU, the default pass recognized four short lines but missed the requested `adipiscing.` link. The sparse-text retry recognized seven lines in 82 ms but also missed the target. The task therefore failed validation (0/1 success, zero clicks); end-to-end latency including reset was 2,085 ms and the bounded tool loop took 807 ms. No semantic model call occurred. This is a single integration smoke sample, not a quality or speed benchmark. The runner extracts only the explicitly quoted link label, and synthetic confirmation is refused unless the page URL is the exact local `file://` task. Keep this separate from the historical vision-only result; retain OCR misses and unsuccessful task validation as failures.

`results/miniwob-visual-digits-5-seed-smoke.json` and its five per-seed episodes check digit-only OCR on BrowserGym's visual-only `ascending-numbers` task. Four of five seeds (7–10) earned full raw reward after five separately approved local clicks; seed 11 was safely stopped with zero clicks because OCR misread a visible `1` as `4`. End-to-end latency including reset was p50 2,535 ms / p95 2,871 ms; the bounded browser/OCR/action loop was p50 1,178 ms / p95 1,258 ms. The five synthetic approvals per successful episode were restricted to the exact local MiniWoB file URL. This is one task repeated on one Windows CPU host, not a representative success rate, general OCR reliability, or a speed claim. The task used BrowserGym 0.14.3, MiniWoB++ commit `7fd85d7`, Node 22.14.0, Python 3.10.0, Playwright Python 1.44.0 / Node 1.63.0, Chromium 125, and a Ryzen 5 5600H CPU. The Tesseract language data was already cached. Keep the failed seed with the passing episodes.

`results/miniwob-main-8-seed7-smoke.json` and its eight episode files rerun the standard bounded browser loop on the current `8a4f3a1` source: eight curated MiniWoB tasks passed with full raw reward and no timeouts. The Windows CPU host was a Ryzen 5 5600H; the run used Node 22.14.0, Python 3.10.0, BrowserGym 0.14.3, Playwright Python 1.44.0 / Node 1.63.0, and Chromium 125. End-to-end latency including reset was p50 1,763 ms / p95 2,295 ms; the browser action loop was p50 333 ms / p95 737 ms. Three semantic decisions used the cached local `Xenova/all-MiniLM-L6-v2` model (p50 184 ms / p95 197 ms); five other decisions resolved with local rules. The three-call model sample is too small for a general latency claim, and the curated tasks are not representative BrowserGym coverage. This run does not exercise the new visual actions.

Reproduce the same task set from the repository root with the pinned MiniWoB++ checkout:

```sh
python benchmarks/run-browsergym-miniwob-suite.py \\
  --miniwob-root /path/to/miniwob-plusplus/miniwob/html/miniwob \
  --tasks click-test click-button click-link click-tab click-collapsible click-dialog click-menu click-checkboxes \
  --seed 7 --max-actions 5 --timeout-seconds 120 --approve-synthetic-actions \
  --output benchmarks/results/miniwob-main-8-seed7-smoke.json
```

Reproduce one seed with the installed BrowserGym 0.14.3 environment and a MiniWoB++ checkout:

```sh
python benchmarks/run-browsergym-miniwob-suite.py \
  --miniwob-root /path/to/miniwob-plusplus/miniwob/html/miniwob \
  --output benchmarks/results/miniwob-visual-digits-seed-7.json \
  --tasks ascending-numbers --seed 7 --max-actions 8 \
  --multi-tool --visual-ocr-actions --approve-synthetic-actions
```

Repeat with seeds 7 through 11 and a distinct `--output` name per seed to recreate the five-episode summary. `contentMode: "digits"` uses Tesseract's numeric character boxes and may retry suspiciously merged characters on small local crops. The task validator requires full raw reward; ambiguous, missing, duplicate, or out-of-bounds labels prevent all clicks.

`results/miniwob-custom-pointer-click-smoke.json` is a one-task Linux CPU follow-up on the same pinned MiniWoB `click-link` task and quoted target. The semantic tree is empty, but the page styles its text links with `cursor: pointer`; the bounded fallback found seven non-semantic targets and the literal rule picked the unique requested label without loading the decision model. The target was clicked only after one synthetic approval on the exact local `file://` task. The harness recorded 1/1 success, a 280 ms browser action loop, 0 ms decision inference, and 1,204 ms end-to-end including environment reset. The raw summary and episode record include all versions and the target label. This single easy task shows that the custom-target path can handle this case; it is not a representative browser benchmark or a general speed comparison. The earlier OCR-only run remains recorded as a 0/1 failure.

`results/miniwob-pointer-fastpath-followup-smoke.json` and its eight per-task records repeat the focused MiniWoB set on Linux x64 CPU with the bounded DOM decision/action runner, seed 7, and a five-action cap. The run completed 8/8 tasks with no timeouts. It used Node 24.20.0, BrowserGym 0.14.3, Playwright Python 1.44.0 / Node 1.63.0, Chromium 125, and an Intel Xeon Gold 6140 host; the MiniWoB++ revision is recorded in each raw episode. End-to-end latency including reset was p50 1,165 ms / p95 3,216 ms; the browser decision/action loop was p50 328 ms / p95 2,015 ms. Three semantic-provider calls had p50 244 ms / p95 1,759 ms; five decisions used deterministic local rules, and three actions waited for synthetic approval on the exact local task URL. This is one curated integration run, not a representative browser benchmark, a full autonomous-agent score, or evidence of a general speed improvement. The suite does not exercise the form or visual tools. Earlier 7/8 and OCR 0/1 records remain unchanged for context.

`results/miniwob-pointer-fastpath-latest-smoke.json` and its eight per-task records rerun the same tasks, seed, and action cap against the current privacy-hardened source on Linux x64 CPU. It completed 7/8 with no harness timeouts using Node 24.20.0, BrowserGym 0.14.3, Playwright Python 1.44.0 / Node 1.63.0, and Chromium 125. The `click-test` episode terminated before the decision/action tool ran; its action loop lasted 61,753 ms and dominates the end-to-end p95 of 62,704 ms (p50 1,091 ms). Browser action-loop latency was p50 285 ms / p95 61,753 ms. Two timed semantic-provider calls had p50 229 ms / p95 1,450 ms; five choices used deterministic local rules, and three actions waited for synthetic approval on the exact local task URL. This is one curated repeat with a large failed-run outlier, not a typical latency estimate or representative benchmark. Keep it alongside the earlier 8/8 run rather than comparing the two as a speed test. The raw records preserve the failure and per-task measurements.

`results/miniwob-click-test-diagnostic-smoke.json` retries the earlier `click-test` failure by itself. It passed 1/1 in a 90-second per-task limit, with a 535 ms browser action loop and a 267 ms semantic decision call. Keep this diagnostic retry separate from the full-suite success rate.

`results/miniwob-pointer-fastpath-diagnostic-rerun-smoke.json` and its eight per-task records repeat the same focused task set, seed 7, and five-action cap using the current source and an error-reporting harness. It completed 8/8 with no timeouts on Linux x64 CPU (Node 24.20.0, BrowserGym 0.14.3, Playwright Python 1.44.0 / Node 1.63.0, Chromium 125). End-to-end latency including reset was p50 1,096 ms / p95 1,492 ms; the browser decision/action loop was p50 305 ms / p95 699 ms. Three timed semantic-provider calls had p50 230 ms / p95 251 ms; five choices used deterministic rules and three actions waited for synthetic approval on the exact local task URL. The preceding 7/8 run's 61.8-second `click-test` error was not reproduced in the isolated retry or this full repeat; both failed and passing raw records remain. The suite now records each completed child runner's exit code and a bounded stderr diagnostic on errors. These are still curated integration runs, not broad BrowserGym scores or speed guarantees.

`results/miniwob-copy-field-1304256-copy-paste.json` is a single-task Linux CPU integration check of local field-to-field copying. The run passed 1/1 in two actions: `browser_copy_field` copied the generated textarea text into the visible textbox without returning it, then the separate submit click used one synthetic approval on the exact local `file://` task. End-to-end time was 1,307 ms including 937 ms environment reset; the browser action loop took 370 ms, with no semantic model inference. It ran from the working tree based on `675d520`; the nine exercised source, harness, and test file blobs match commit `1304256`, which the raw JSON records. This verifies one explicit workflow, not a representative BrowserGym score or speed claim.

Reproduce that focused OCR-only run from the repository root with the pinned MiniWoB++ checkout:

```sh
python benchmarks/run-browsergym-miniwob-suite.py \
  --miniwob-root /tmp/miniwob-plusplus/miniwob/html/miniwob \
  --multi-tool --visual-ocr-actions --tasks click-link \
  --approve-synthetic-actions \
  --output benchmarks/results/miniwob-ocr-click-link-smoke.json
```

Reproduce the CSS pointer-target follow-up with the same seed and action budget. The OCR flags leave that path available as a fallback, but it is not used when the page exposes an exact local text target:

```sh
python benchmarks/run-browsergym-miniwob-suite.py \
  --miniwob-root /tmp/miniwob-plusplus/miniwob/html/miniwob \
  --tasks click-link --seed 7 --max-actions 5 \
  --multi-tool --visual-ocr-actions --approve-synthetic-actions \
  --output benchmarks/results/miniwob-custom-pointer-click-smoke.json
```

## Calibration

For labeled outcomes, report Brier score and reliability bins alongside accuracy. Do not call `confidence` calibrated unless the provider explicitly identifies its calibration source and the measured reliability backs that up on held-out examples. The local semantic model reports `uncalibrated-estimate`; its current ECE is a descriptive statistic from a small project-specific sample, not a calibration guarantee.
