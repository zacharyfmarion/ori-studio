# Browser CP Detector Assets

## Fresh checkout prerequisites

The browser-driven scripts in this directory (`run-browser-dense-cache.mjs`,
`run-browser-correctness-fast.mjs`, ...) need three things a fresh
checkout/worktree of this repo does NOT have, because they are gitignored or
build artifacts. All three failure modes used to present as a silent hang;
`run-browser-dense-cache.mjs` now fails fast with a pointer here.

1. **Node dependencies.** Run `npm install` at the repo root. Without it the
   inference worker 500s inside vite (`Failed to resolve import
   "onnxruntime-web"`) and inference never resolves. If you install while a
   vite dev server is already running, restart the server afterwards — vite's
   dependency re-optimization reloads open pages mid-run (the dense-cache
   runner re-bootstraps once when it detects this, but a clean restart is
   saner).
2. **Model assets.** `apps/web/public/models/cp-detector-*/{model.onnx,
   manifest.json}` are gitignored. The tracked source of truth for the current
   model is `scripts/cp-detect/current-model.json`. Copy the stable and
   versioned asset directories named there from a checkout that has them, or
   re-export with `scripts/cp-detect/export-cpline-onnx.py`. Verify with
   `node scripts/cp-detect/check-local-model-assets.mjs`; it reads the pointer
   file and intentionally fails if the stable `cp-detector-v3` directory
   contains an older model.
3. **Generated wasm modules.** `apps/web/src/generated/` is produced by
   wasm-pack. Either run the full `npm run dev:web` once (its `predev` builds
   everything) or build the missing crate directly, e.g.
   `npm --workspace @treemaker/web run build:oristudio-cp-detect-wasm`.

Then start the dev server the runners point at:

```bash
cd apps/web && npx vite --host 127.0.0.1 --port 5175
```

## Model layout

Phase 1 keeps the browser detector model artifact local and ignored. Put the
exported ONNX model here during development:

```text
apps/web/public/models/cp-detector-v3/model.onnx
apps/web/public/models/cp-detector-v3/manifest.json
```

The source checkpoint and Python oracle currently live in the
`create-pattern-detector` repository. Read
`scripts/cp-detect/current-model.json` for the current model ID, expected ONNX
SHA, stable and versioned local asset directories, and ML checkpoint manifest.
When promoting a new detector, update that pointer once instead of repeating the
new model in this README or helper scripts.

Run the local asset checker before app testing:

```bash
node scripts/cp-detect/check-local-model-assets.mjs
```

Export the current checkpoint from a local `create-pattern-detector` checkout.
By default the exporter reads `scripts/cp-detect/current-model.json`:

```bash
python scripts/cp-detect/export-cpline-onnx.py
```

The exporter writes both `model.onnx` and `manifest.json`, validates the ONNX
graph, and records the model size plus SHA-256 digest in the manifest. The
browser feature requires these files; there is no mock or degraded fallback.

Then verify the local assets:

```bash
node scripts/cp-detect/check-local-model-assets.mjs
```

## Browser-vs-Oracle Benchmark

With the web dev server running and real local model assets installed, compare
the browser Rust/WASM detector against frozen Python oracle fixtures:

```bash
node scripts/cp-detect/benchmark-browser-vs-oracle.mjs \
  --url http://127.0.0.1:5175/ \
  --out artifacts/cp-detect-parity/browser-vs-python-baseline.json
```

The benchmark drives the actual browser upload/crop/detect flow with
Playwright, captures the emitted FOLD JSON, and writes graph-count plus
approximate vertex/edge/border matching metrics against the frozen Python
fixture output. The generated report lives under ignored `artifacts/` by
default.

## Python Evidence Export And PHT Spike

For decoder-only parity work, export frozen Python intermediates without
modifying the Python implementation:

```bash
python scripts/cp-detect/export-python-oracle-evidence.py \
  --output-dir artifacts/cp-detect-oracle/evidence-real-smoke-v2 \
  /path/to/cp-image.png
```

The exporter writes rectified inputs, line masks, OpenCV `HoughLinesP` raw
segments, Python merged carriers, FOLD output, and reports under ignored
`artifacts/`.

Then run the Rust finite-segment spike against those masks:

```bash
cargo run -p oristudio-cp-detect --bin cp_detect_pht_spike -- \
  --manifest artifacts/cp-detect-oracle/evidence-real-smoke-v2/manifest.json \
  --out artifacts/cp-detect-parity/pht-spike-real-smoke-v2.json
```

This does not affect product runtime. It measures whether a browser-safe Rust
segment extractor can get close enough to the Python OpenCV segment/carrier
evidence before we wire anything into detection.

Useful tuning flags include `--vote-threshold`, `--max-peaks`,
`--line-distance-px`, `--min-line-length-px`, `--max-line-gap-px`,
`--line-merge-angle-degrees`, `--line-merge-rho-px`, and
`--max-line-hypotheses`. Matching tolerance flags are separate:
`--segment-tolerance-px`, `--line-angle-tolerance-degrees`,
`--line-rho-tolerance-px`, and `--line-overlap-tolerance`.

## OpenCV HoughLinesP Oracle

The OpenCV `HoughLinesP` Rust port uses Python OpenCV as its exact oracle. Build
the tiny fixture set with:

```bash
python scripts/cp-detect/export-houghlinesp-oracle.py \
  --output-dir crates/oristudio-cp-detect/tests/fixtures/houghlinesp_tiny \
  --generate-tiny-fixtures \
  --threshold 2 \
  --min-line-length 6 \
  --max-line-gap 2
```

Then compare a Rust candidate against the oracle:

```bash
cargo run -p oristudio-cp-detect --bin compare_houghlinesp_oracle -- \
  --manifest crates/oristudio-cp-detect/tests/fixtures/houghlinesp_tiny/manifest.json \
  --candidate custom-spike \
  --allow-mismatch \
  --out artifacts/cp-detect-parity/houghlinesp-custom-spike-negative-control.json
```

`custom-spike` is a negative control, not the OpenCV port. It should fail exact
ordered parity so the harness can prove it catches non-identical behavior.

Once the oracle fixtures exist, run the OpenCV-compatible Rust port:

```bash
cargo run -p oristudio-cp-detect --bin compare_houghlinesp_oracle -- \
  --manifest crates/oristudio-cp-detect/tests/fixtures/houghlinesp_tiny/manifest.json \
  --candidate opencv-port \
  --out artifacts/cp-detect-parity/houghlinesp-opencv-port-tiny.json
```

The ignored real-mask oracle set from the V2 smoke evidence should also pass
exact ordered parity:

```bash
cargo run -p oristudio-cp-detect --bin compare_houghlinesp_oracle -- \
  --manifest artifacts/cp-detect-oracle/houghlinesp-real-smoke-v2-20260525/manifest.json \
  --candidate opencv-port \
  --out artifacts/cp-detect-parity/houghlinesp-opencv-port-real-smoke-v2-20260525.json
```

For source-level debugging, `houghlinesp_cpp_trace.cpp` is a standalone C++
tracer derived from OpenCV's CPU implementation. It is not product runtime; it
exists to verify whether a mismatch is in the Rust port or in the Python/OpenCV
oracle setup.

## Correctness Benchmark Against FOLD Ground Truth

The browser-vs-oracle scripts above are useful for port debugging, but final
detector quality should compare both implementations against the same source
`.fold` ground truth. The repeatable benchmark flow is:

```text
source .fold records
  -> deterministic rendered image pack with GT graph
  -> frozen Python PyTorch detector
  -> browser ONNX Runtime Web + WASM detector
  -> paired GT metrics and contact sheet
```

Build the default clean iteration pack. This is the first topology benchmark to
use when tuning detector/compiler behavior because it gives 15 unique CPs with
no augmentation repeats:

```bash
python scripts/cp-detect/build-correctness-benchmark-pack.py \
  --tier clean \
  --out artifacts/cp-detect-correctness/packs/clean-1024-s15
```

Build the smaller varied-profile smoke pack:

```bash
python scripts/cp-detect/build-correctness-benchmark-pack.py \
  --tier smoke \
  --samples-per-profile 3 \
  --out artifacts/cp-detect-correctness/packs/smoke-1024-s3
```

Run the frozen Python baseline:

```bash
/Users/zacharymarion/Documents/code/create-pattern-detector/.venv/bin/python \
  scripts/cp-detect/run-python-correctness-baseline.py \
  --pack artifacts/cp-detect-correctness/packs/smoke-1024-s3/manifest.json \
  --out artifacts/cp-detect-correctness/runs/smoke-1024-s3/python \
  --device auto
```

With the web app running locally, run the browser-fast path:

```bash
node scripts/cp-detect/run-browser-correctness-fast.mjs \
  --url http://127.0.0.1:5175/ \
  --pack artifacts/cp-detect-correctness/packs/smoke-1024-s3/manifest.json \
  --out artifacts/cp-detect-correctness/runs/smoke-1024-s3/browser-fast
```

For post-inference Rust/compiler iteration, cache browser ONNX dense outputs
instead of rerunning model inference for every ablation. The dense cache writer
stores every model head currently exposed by the manifest, including optional
heads such as `angle`, `junction_offset`, `vertex_type_logits`,
`boundary_side_logits`, `boundary_offset`, and `boundary_coord`:

```bash
node scripts/cp-detect/run-browser-dense-cache.mjs \
  --url http://127.0.0.1:5175/ \
  --pack artifacts/cp-detect-correctness/packs/clean-1024-s15/manifest.json \
  --out artifacts/cp-detect-correctness/dense-cache/clean-1024-s15-browser-onnx
```

Score both runs against GT:

```bash
/Users/zacharymarion/Documents/code/create-pattern-detector/.venv/bin/python \
  scripts/cp-detect/evaluate-correctness-pair.py \
  --pack artifacts/cp-detect-correctness/packs/smoke-1024-s3/manifest.json \
  --python-run artifacts/cp-detect-correctness/runs/smoke-1024-s3/python/run_manifest.json \
  --browser-run artifacts/cp-detect-correctness/runs/smoke-1024-s3/browser-fast/run_manifest.json \
  --out artifacts/cp-detect-correctness/reports/smoke-1024-s3
```

The report directory contains `summary.json`, `summary.md`,
`per_sample.jsonl`, `regressions.jsonl`, and `contact_sheet.png`.

## Box-Pleat Native Eval

Box-pleated real-world CPs are selected by the `create-pattern-detector` repo,
not by a committed path list in this repo. The ML repo owns the deterministic
candidate recipe, canonical FOLD hashing, and expected fingerprints in
`eval_specs/box_pleat_native_v1.json`. This repo owns the product-side eval:
turning those selected FOLDs into a correctness pack, running the shipped ONNX
model in the browser, and measuring the Rust/WASM post-processing behavior.

Build a full product correctness pack from the ML repo's BP eval spec:

```bash
/path/to/create-pattern-detector/.venv/bin/python \
  scripts/cp-detect/build-box-pleat-native-pack.py \
  --detector-repo /path/to/create-pattern-detector \
  --fold-root /path/to/scraped/native/converted_fold \
  --out artifacts/cp-detect-correctness/packs/box-pleat-native-v1
```

Add `--limit 3` and use a distinct output directory for a fast smoke pack. The
builder always verifies the full BP eval fingerprints before applying the
limit, so a smoke pack still catches dataset drift.

With the web app running locally, cache the browser ONNX dense heads:

```bash
node scripts/cp-detect/run-browser-dense-cache.mjs \
  --url http://127.0.0.1:5175/ \
  --pack artifacts/cp-detect-correctness/packs/box-pleat-native-v1/manifest.json \
  --out artifacts/cp-detect-correctness/dense-cache/box-pleat-native-v1-browser-onnx-v3 \
  --manifest-url /models/cp-detector-v3/manifest.json
```

Measure whether orthogonal BP crease pixels are missing from the line head, or
are being removed by product non-crease suppression:

```bash
python3 scripts/cp-detect/evaluate-box-pleat-dense-cache.py \
  --dense-manifest artifacts/cp-detect-correctness/dense-cache/box-pleat-native-v1-browser-onnx-v3/manifest.json \
  --out artifacts/cp-detect-correctness/reports/box-pleat-native-v1-dense-heads
```

Then run the normal Rust topology benchmark against the same dense cache:

```bash
cargo run -p oristudio-cp-detect --bin compare_exact_solve_benchmark -- \
  --dense-manifest artifacts/cp-detect-correctness/dense-cache/box-pleat-native-v1-browser-onnx-v3/manifest.json \
  --out artifacts/cp-detect-correctness/reports/box-pleat-native-v1-strict-v3 \
  --candidate-source junction-first-v1 \
  --junction-first-offset-cluster-radius-px 3 \
  --skip-exact-solve \
  --strict-vertex-tolerance-px 4
```

When exact solve is enabled, it defaults to a 10 second timeout in the product
and benchmark paths. Use `--exact-solve-timeout-seconds N` to change it;
negative values disable the cap for deliberate debugging runs.

All generated packs, dense caches, and reports belong under ignored
`artifacts/`. Commit only the deterministic ML eval spec/fingerprints and the
small scripts/docs that make this product-side flow reproducible.
