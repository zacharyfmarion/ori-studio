# CP Detector Correctness Benchmark Plan

## Purpose

Build a repeatable benchmark that answers the question we actually care about:
is the browser/Rust CP detector worse than the frozen Python V2 detector, or is
it merely different?

The benchmark must compare both implementations against the same ground-truth
`.fold` files rendered into images by the existing training/evaluation pipeline.
Python is the reference implementation for porting and debugging, but it is not
the benchmark truth. The source `.fold` graph is the truth.

This benchmark is meant to run repeatedly while iterating. It should have a fast
local mode for development and a slower promotion mode for high-confidence
changes.

## Non-Goals

- Do not change the frozen Python detector implementation.
- Do not treat Python output as ground truth for final correctness metrics.
- Do not require a full synthetic dataset pass for every local iteration.
- Do not use real-world scraped images for labeled accuracy metrics unless they
  acquire labels later. Real images remain product smoke and visual review cases.
- Do not include cropped-border hallucination or symmetry-recovery tasks in V2.

## Existing Assets To Reuse

Frozen detector repo:

```text
/Users/zacharymarion/.codex/worktrees/a00b/create-pattern-detector
```

Useful Python-side pieces:

- `src/data/cpline_dataset.py`
  - `CplineFoldDataset` already renders manifest `.fold` records into model
    input images and ground-truth graph tensors.
- `src/data/cpline_augmentations.py`
  - Existing profiles cover clean, original line-style, dark mode, print/photo
    styles, and V2 issue profiles: text, watermark, guide grid, dashed, faint,
    ambiguous M/V, combined, and dark combined.
- `scripts/evals/eval_stage4_checkpoint.py`
  - Existing checkpoint evaluation loop, profile sampling, model invocation,
    square topology decode, repair/report, metrics, charts, and contact sheets.
- `src/vectorization/metrics.py`
  - Existing graph matching metrics against ground truth: vertex, edge,
    assignment, border, and structural validity.
- `docs/v2-checkpoint-metrics.md`
  - Historical V2 metric snapshots and command patterns.
- `artifacts/evaluations/v2-checkpoint-comparison-20260522.json`
  - Existing machine-readable metrics snapshot for checkpoint comparison.

Useful Ori Studio/browser-side pieces:

- `scripts/cp-detect/benchmark-browser-vs-oracle.mjs`
  - Existing Playwright product-path smoke test. It currently compares browser
    output to Python oracle FOLD output; this plan will add GT-based scoring.
- `scripts/cp-detect/benchmark-browser-decode-oracle.mjs`
  - Existing WASM decode replay against Python logits.
- `scripts/cp-detect/compare-onnx-heads.mjs`
  - Existing ONNX Runtime Web vs PyTorch diagnostic path.
- `crates/oristudio-cp-detect`
  - Native Rust detector core.
- `crates/oristudio-cp-detect-wasm`
  - Browser/WASM detector entrypoints.
- `apps/web/src/workers/cpDetectWorker.ts`
  - Product model inference and detector worker integration.

## Benchmark Shape

The benchmark has three runners and one shared evaluator.

```text
source .fold records
  -> deterministic render pack with GT graph
  -> Python PyTorch runner
  -> browser/Rust ONNX runner
  -> optional product UI runner
  -> paired GT evaluator and report
```

### 1. Benchmark Pack Generator

Add a script in this repo:

```text
scripts/cp-detect/build-correctness-benchmark-pack.py
```

The script imports the frozen detector repo from `--detector-repo` and uses
`CplineFoldDataset`/`render_cpline_sample` semantics to produce a deterministic
artifact pack under ignored `artifacts/`, for example:

```text
artifacts/cp-detect-correctness/packs/iteration-1024-20260526/
  manifest.json
  manifest.jsonl
  samples/
    <sample-id>/
      input.png
      gt.fold
      gt.graph.json
      render_metadata.json
```

Each manifest row records:

```json
{
  "id": "treemaker_tree_v1-5gjmc-005676__v2-watermark__seed19",
  "source_fold_path": "...",
  "family": "treemaker-tree",
  "split": "val",
  "profile": "v2-watermark",
  "seed": 19,
  "image_size": 1024,
  "max_edges": 300,
  "input_png": "samples/.../input.png",
  "gt_fold": "samples/.../gt.fold",
  "gt_graph": "samples/.../gt.graph.json",
  "render_metadata": "samples/.../render_metadata.json"
}
```

The pack must record enough metadata to reproduce the exact samples later:
manifest path, git commit for the detector repo if available, image size,
profile list, seed, split, family sampling mode, edge-count limits, and selected
record ids.

### 2. Python PyTorch Runner

Add:

```text
scripts/cp-detect/run-python-correctness-baseline.py
```

This runner invokes the frozen Python detector on each `input.png` from a pack,
using the same checkpoint and decoder settings as current V2 evaluation. It
writes:

```text
artifacts/cp-detect-correctness/runs/<run-id>/python/
  predictions/<sample-id>.fold
  reports/<sample-id>.json
  evidence/<sample-id>/...        # optional, only with --debug-evidence
  run_manifest.json
```

Implementation should reuse the same pipeline pieces as
`scripts/evals/eval_stage4_checkpoint.py` rather than inventing a second Python
evaluation path. If the runner cannot directly call the pipeline for arbitrary
rendered images, the first implementation may wrap the existing dataset loop and
write the same per-sample FOLD/report artifacts while preserving the benchmark
pack sample order.

### 3. Browser/Rust Fast Runner

Add:

```text
scripts/cp-detect/run-browser-correctness-fast.mjs
```

This is the main iteration runner. It should avoid modal automation and run the
same browser runtime components in a controlled path:

```text
input.png
  -> browser preprocessing / model tensor path
  -> ONNX Runtime Web
  -> WASM detector decode
  -> FOLD/report JSON
```

The output layout mirrors the Python runner:

```text
artifacts/cp-detect-correctness/runs/<run-id>/browser-fast/
  predictions/<sample-id>.fold
  reports/<sample-id>.json
  tensors/<sample-id>/...         # optional, only with --debug-tensors
  run_manifest.json
```

This runner is the best signal for day-to-day detector quality because it
exercises the actual ONNX Runtime Web plus WASM code without paying the
Playwright product UI overhead for every sample.

### 4. Product UI Smoke Runner

Extend or add:

```text
scripts/cp-detect/run-browser-product-smoke.mjs
```

This runner drives the actual Ori Studio upload/crop/detect UI with Playwright.
It should run only a small subset by default because it is slower and flakier
than the fast runner.

Use it to answer product integration questions:

- Does the modal finish instead of timing out?
- Does upload to crop to detect to import work?
- Does the crop/rectification path behave consistently on arbitrary images?
- Does the emitted FOLD import into the app and render without UI regressions?

This runner reports product failures separately from detector graph accuracy.

## Shared Evaluator

Add:

```text
scripts/cp-detect/evaluate-correctness-pair.py
```

The evaluator reads one benchmark pack plus one or more implementation runs:

```bash
python scripts/cp-detect/evaluate-correctness-pair.py \
  --pack artifacts/cp-detect-correctness/packs/iteration-1024-20260526/manifest.json \
  --python-run artifacts/cp-detect-correctness/runs/iteration-1024-20260526/python/run_manifest.json \
  --browser-run artifacts/cp-detect-correctness/runs/iteration-1024-20260526/browser-fast/run_manifest.json \
  --out artifacts/cp-detect-correctness/reports/iteration-1024-20260526
```

For the first implementation, reuse Python's `src/vectorization/metrics.py`
instead of porting the evaluator. The benchmark is developer tooling, not
browser runtime, and the existing metric implementation already matches the V2
training/eval pipeline. A later Rust metric port is useful only if we need
native CI without Python.

The evaluator must compute both absolute metrics and paired deltas:

```text
python vs GT
browser/Rust vs GT
browser/Rust minus Python
```

Primary metrics:

- vertex precision, recall, F1;
- edge precision, recall, F1;
- assignment accuracy and per-class assignment metrics;
- border precision, recall, F1;
- boundary-contact precision/recall/F1 where GT contacts are derivable;
- parseable FOLD rate;
- structural-validity rate;
- complete square-border rate;
- duplicate-edge and zero-length-edge rates;
- warning/status code rates;
- exact canonical graph match rate where coordinates and topology match within
  tolerance.

Breakdowns:

- by augmentation profile;
- by source family;
- by edge-count bucket;
- by assignment class;
- by light/dark rendering mode;
- by "issue" family: text, watermark, guide grid, dashed, faint, ambiguous M/V,
  combined.

The vertex matching tolerance should default to the current V2 convention and
scale with image size:

```text
vertex_tolerance_px = max(5.0, image_size * 5.0 / 1024.0)
```

Changing tolerances must be explicit in the report.

## Report Artifacts

Each benchmark report directory should contain:

```text
summary.json
summary.md
per_sample.jsonl
by_profile.json
by_family.json
by_edge_count_bucket.json
paired_deltas.json
regressions.jsonl
contact_sheets/
  worst_browser_edge_f1.png
  worst_browser_border_f1.png
  python_wins.png
  browser_wins.png
  profile_examples_<profile>.png
```

`summary.json` is the stable machine-readable artifact. `summary.md` is the
human-readable snapshot that can be copied into roadmap notes. The contact
sheets should show, in order:

```text
input image | ground truth render | Python output | browser/Rust output | diff
```

The default visual output should avoid dense diagnostic overlays. Debug overlays
can be optional, but the first contact sheet needs to be plain enough to inspect
quickly.

## Benchmark Tiers

### Smoke

Purpose: catch broken assets, missing model files, bad WASM wiring, and obvious
metric collapse.

Proposed defaults:

```text
image size: 1024
split: val
profiles: clean, line-style, v2-watermark, v2-dashed
samples per profile: 3
total samples: 12
runners: Python + browser-fast
product UI: optional 2-sample subset
target runtime: a few minutes
```

### Iteration

Purpose: normal local development signal before committing detector changes.

Proposed defaults:

```text
image size: 1024
split: val
profiles:
  clean
  line-style
  print-light
  dark-mode
  v2-text
  v2-watermark
  v2-guide-grid
  v2-dashed
  v2-faint
  v2-ambiguous-mv
  v2-combined
  v2-dark-combined
samples per profile: 8
total samples: 96
runners: Python + browser-fast
product UI: 5-sample subset
target runtime: acceptable if tens of minutes
```

### Promotion

Purpose: high-confidence decision before declaring browser parity acceptable or
before changing model/runtime architecture.

Proposed defaults:

```text
image size: 1024
split: test when available, otherwise held-out val record ids
profiles: all supported V2 and original stage profiles
samples per profile: 24 to 64 depending on runtime
family sampling: balanced
edge-count buckets: explicit low/mid/high buckets
runners: Python + browser-fast + native Rust/Node diagnostics
product UI: 10 to 20 sample subset
target runtime: can be slow if correctness requires it
```

The promotion run should write a committed small metrics note, not the full
artifact directory:

```text
implementation-plans/cp-detect-correctness-benchmark-results.md
```

or a JSON snapshot under a small tracked report location, as long as it does not
include large images or model artifacts.

## Acceptance Gates

Initial proposed gates for browser/Rust fast path versus Python, both measured
against GT:

- aggregate edge F1 delta >= `-0.01`;
- aggregate border F1 delta >= `-0.01`;
- aggregate vertex F1 delta >= `-0.01`;
- no major profile has edge F1 delta below `-0.03` without a documented reason;
- no major profile has border F1 delta below `-0.03` without a documented
  reason;
- parseable FOLD rate is no worse than Python by more than `1%`;
- complete square-border rate is no worse than Python by more than `1%`;
- product UI smoke has zero timeouts and zero missing-result cases.

These gates are starting points. The report must show the actual numbers before
we decide whether they are too strict or too loose.

## Implementation Checkpoints

Each checkpoint ends with tests, a benchmark note, and a focused commit.

### Checkpoint 1: Benchmark Pack Schema And Generator

- Add `build-correctness-benchmark-pack.py`.
- Generate smoke and iteration packs from the shared synthetic manifest.
- Store selected record ids, profiles, seeds, render parameters, and source
  metadata.
- Write `gt.fold` and `gt.graph.json` per sample.
- Add a small schema check test or validator command.

Done when a smoke pack can be regenerated deterministically and all referenced
paths exist.

### Checkpoint 2: Python Baseline Runner

- Add `run-python-correctness-baseline.py`.
- Reuse the frozen Python V2 model, batchnorm mode, threshold, square topology
  decoder, conservative repair, quality report, and FOLD writer.
- Write one prediction FOLD and report per sample.
- Record checkpoint id/hash, detector repo commit, Python package versions when
  practical, batchnorm mode, threshold, and image size.

Done when Python predictions can be scored against GT for the smoke pack and
the aggregate metrics match the existing V2 eval script within expected sample
selection differences.

### Checkpoint 3: Browser Fast Runner

- Add `run-browser-correctness-fast.mjs`.
- Load the same model asset and manifest used by the product.
- Feed pack images through ONNX Runtime Web and the WASM decoder.
- Write prediction FOLD and report per sample.
- Record model SHA-256, ONNX Runtime Web version, WASM package version, browser
  user agent, and detector thresholds.

Done when the browser-fast runner completes the smoke pack without UI automation
and produces one FOLD/report pair per sample.

### Checkpoint 4: Paired Evaluator And Reports

- Add `evaluate-correctness-pair.py`.
- Score Python and browser predictions against `gt.graph.json`.
- Write aggregate, by-profile, by-family, edge-bucket, and per-sample reports.
- Write regression lists sorted by browser-minus-Python metric deltas.
- Generate basic contact sheets with input, GT, Python, browser, and diff.

Done when smoke and iteration summaries clearly show whether browser/Rust is
worse, better, or merely different on each profile.

### Checkpoint 5: Product UI Smoke

- Adapt `benchmark-browser-vs-oracle.mjs` or add
  `run-browser-product-smoke.mjs`.
- Use the same benchmark pack, but run only a selected subset.
- Score against GT, not Python oracle FOLD.
- Track timeout, missing-result, import, and visualization failures separately
  from graph accuracy.

Done when product UI smoke can be run before manual testing and failure output
points to either detector quality or app integration.

### Checkpoint 6: Developer Ergonomics

- Add documented commands to `scripts/cp-detect/README.md`.
- Add npm/script aliases if they fit the repo conventions.
- Add `.gitignore` coverage for large benchmark artifacts if missing.
- Add a small committed results note for the first smoke and iteration run.

Done when the benchmark can be rerun from a fresh worktree with only the frozen
detector repo path, model assets, and shared synthetic data configured.

## Suggested Commands

Smoke pack:

```bash
python scripts/cp-detect/build-correctness-benchmark-pack.py \
  --detector-repo /Users/zacharymarion/.codex/worktrees/a00b/create-pattern-detector \
  --manifest /Users/zacharymarion/.codex/worktrees/a00b/create-pattern-detector/data/generated/synthetic/cp_training_mix_v1/raw-manifest.jsonl \
  --tier smoke \
  --image-size 1024 \
  --out artifacts/cp-detect-correctness/packs/smoke-1024
```

Python baseline:

```bash
python scripts/cp-detect/run-python-correctness-baseline.py \
  --detector-repo /Users/zacharymarion/.codex/worktrees/a00b/create-pattern-detector \
  --pack artifacts/cp-detect-correctness/packs/smoke-1024/manifest.json \
  --checkpoint /path/to/v2/checkpoint.pt \
  --out artifacts/cp-detect-correctness/runs/smoke-1024/python
```

Browser fast:

```bash
node scripts/cp-detect/run-browser-correctness-fast.mjs \
  --pack artifacts/cp-detect-correctness/packs/smoke-1024/manifest.json \
  --out artifacts/cp-detect-correctness/runs/smoke-1024/browser-fast
```

Evaluate:

```bash
python scripts/cp-detect/evaluate-correctness-pair.py \
  --detector-repo /Users/zacharymarion/.codex/worktrees/a00b/create-pattern-detector \
  --pack artifacts/cp-detect-correctness/packs/smoke-1024/manifest.json \
  --python-run artifacts/cp-detect-correctness/runs/smoke-1024/python/run_manifest.json \
  --browser-run artifacts/cp-detect-correctness/runs/smoke-1024/browser-fast/run_manifest.json \
  --out artifacts/cp-detect-correctness/reports/smoke-1024
```

Product UI smoke:

```bash
node scripts/cp-detect/run-browser-product-smoke.mjs \
  --url http://127.0.0.1:5175/ \
  --pack artifacts/cp-detect-correctness/packs/smoke-1024/manifest.json \
  --limit 5 \
  --out artifacts/cp-detect-correctness/runs/smoke-1024/product-ui
```

## Known Risks

- ONNX Runtime Web currently diverges from PyTorch because the checkpoint uses
  inference-time batch-stat BatchNorm. The benchmark should measure whether that
  divergence hurts final graph correctness, not just whether tensor values
  differ.
- Product crop/rectification can fail independently of the detector. Keep the
  fast rectified/image runner and the product UI runner separate so we do not
  confuse model quality with modal/crop bugs.
- The evaluator must canonicalize FOLD coordinates and assignment labels
  consistently before scoring.
- Contact sheets need to stay visually simple. Dense overlays are useful for
  debugging but bad for first-pass inspection.
- Promotion runs may be slow. That is acceptable, but smoke and iteration tiers
  need to stay cheap enough to run during normal development.

## Definition Of Complete

The benchmark is complete when:

- a smoke pack can be generated deterministically;
- Python and browser-fast runs both produce FOLD/report output for every sample;
- both implementations are scored against GT with the same metric code;
- the report shows absolute metrics and browser-minus-Python deltas by profile;
- worst-case contact sheets make the differences inspectable;
- product UI smoke covers upload/crop/detect/import separately;
- commands are documented and reusable from this worktree;
- the first smoke and iteration results are summarized in a small tracked note.
