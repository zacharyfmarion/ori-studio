# Rust CP Detector Quality Parity Plan

## Goal

Bring the browser/Rust CP detector to quality parity with the frozen Python
`create-pattern-detector` V2 pipeline.

Python is the immutable reference implementation. Do not modify Python detector
code to make parity easier. Rust does not need bit-for-bit Hough parity, but it
must reach comparable accuracy metrics on the same benchmark slices before this
feature is considered ready.

## Non-Negotiables

- The browser feature requires the real ONNX model artifact. No mock detector,
  fallback graph, or fake success path is allowed in product runtime.
- The Rust implementation must be benchmarked against ground truth and the
  frozen Python baseline. Visual inspection is useful, but not sufficient.
- If Rust cannot reach comparable metrics with a browser-safe architecture, stop
  and document the limitation instead of shipping a weak approximation.
- Python stays frozen. Rust may call Python only from benchmark/oracle tooling.
- Runtime dependencies must work in native Rust and WASM unless explicitly gated
  behind dev/test-only features.

## Runtime Library Choices

Use browser-safe Rust crates:

- `imageproc`: canonical pure-Rust Hough line detection.
- `image`: image buffers and dev/test fixture loading.
- `nalgebra`: small linear algebra and geometric solves where the local code
  benefits from structured math.
- `rstar`: spatial indexing for crossing, nearest-vertex, and cleanup queries.
- existing `serde`, `serde_json`, `thiserror`, `wasm-bindgen`.

Use dev/test-only crates:

- `ndarray` and `ndarray-npy` if dense Python tensor fixtures are exported as
  `.npy`/`.npz`.
- `approx` for float/geometry assertions.

Avoid native `opencv` in the browser runtime. It is useful as the Python frozen
baseline, but Rust OpenCV bindings and OpenCV.js would add a large packaging and
WASM risk. If pure-Rust line extraction cannot reach quality parity, evaluate
OpenCV.js as an explicit architectural fallback, not as the default path.

## Architecture

The Rust detector core should be split into small deterministic modules:

```text
crates/oristudio-cp-detect/src/
  evidence.rs       CPLineNet logits -> probabilities/labels
  hough.rs          imageproc-backed polar line detection
  carriers.rs       finite support runs and carrier merge
  geometry.rs       points, lines, clipping, intersections
  peaks.rs          max-filter/NMS for junction/contact maps
  topology.rs       full square topology decoder
  support.rs        segment support, dashed support, assignment voting
  cleanup.rs        planar cleanup, edge/vertex pruning
  quality.rs        warnings, compile gates, conservative repair report
  fold_export.rs    FOLD JSON + detector metadata
  metrics.rs        graph matching metrics for benchmarks
```

`decode.rs` should become a public API wrapper rather than a long file that
contains the full implementation.

## Benchmark Modes

### Decoder-Only

Saved dense tensors from the frozen Python model feed both decoders:

```text
dense tensors -> frozen Python decoder -> FOLD/report
dense tensors -> Rust decoder          -> FOLD/report
```

This isolates topology/post-processing from ONNX, preprocessing, and browser
image handling.

### End-To-End Python

```text
image -> frozen Python CLI -> FOLD/report
```

This is the reference quality baseline.

### End-To-End Rust/Browser

```text
image -> Rust rectifier -> ONNX Runtime Web -> Rust decoder -> FOLD/report
```

This validates product behavior after native Rust decoder quality is close.

## Metrics

For labeled synthetic fixtures, compare Python and Rust to ground truth:

- vertex precision/recall/F1
- edge precision/recall/F1
- border precision/recall/F1
- boundary-contact recall
- assignment accuracy where labels are reliable
- valid/parseable FOLD rate
- complete square-border rate
- warning-code rates

For unlabeled real-world fixtures, compare:

- graph counts and warning codes
- valid/parseable FOLD rate
- complete square-border rate
- visual contact sheet review
- named regressions such as the duck CP

Rust is acceptable when it is within an agreed tolerance of Python on supported
synthetic metrics, with no large clean/line-style regressions and no obvious
browser-only structural failures on real-world review cases.

## Checkpoints

Each checkpoint ends with a focused commit.

### Checkpoint 0: Plan

- Add this plan.
- Commit before implementation.

### Checkpoint 1: Benchmark Harness And Baseline

- Add a Rust CLI or example binary for decoding fixtures through
  `oristudio-cp-detect`.
- Add scripts that can:
  - run frozen Python predictions/metrics from an existing detector checkout;
  - run Rust predictions/metrics;
  - compare and write a delta report.
- Add a fixture manifest format that supports:
  - synthetic labeled fixtures;
  - unlabeled real-world smoke fixtures;
  - optional dense-output fixture paths.
- Generate a baseline report for the current Rust decoder.
- Commit the harness and baseline report.

Current checkpoint-1 baseline using
`scripts/cp-detect/benchmark-browser-vs-oracle.mjs` against the frozen
`clean-smoke` Python oracle fixture:

```text
Python oracle: 63 vertices, 101 edges, 16 B edges, status outside_v1_envelope
Rust/browser:  80 vertices, 148 edges, 65 B edges, status valid

vertex P/R/F1: 0.525 / 0.667 / 0.587
edge   P/R/F1: 0.399 / 0.584 / 0.474
border P/R/F1: 0.108 / 0.438 / 0.173
```

This confirms the current Rust/browser path is materially below Python quality,
especially on border topology. The next checkpoint must reduce full-frame
carrier/contact over-generation before product claims can be made.

### Checkpoint 2: Imageproc Hough And Finite Carriers

- Replace the simplified hand-rolled Hough accumulator with
  `imageproc::hough::detect_lines`.
- Add finite carrier extraction:
  - walk/sample pixels near each polar line;
  - split support runs by `hough_max_line_gap`;
  - keep runs longer than `hough_min_line_length`;
  - score runs using `line_prob`;
  - merge nearby finite carriers by angle/rho/overlap.
- Re-run metrics and commit only if the delta is meaningful or diagnostically
  useful.

Current checkpoint-2 result using the same `clean-smoke` browser-vs-Python
oracle benchmark:

```text
Python oracle: 63 vertices, 101 edges, 16 B edges, status outside_v1_envelope
Rust/browser:  46 vertices, 76 edges, 12 B edges, status valid

vertex P/R/F1: 0.913 / 0.667 / 0.771
edge   P/R/F1: 0.789 / 0.594 / 0.678
border P/R/F1: 0.583 / 0.438 / 0.500
```

This is a meaningful improvement over checkpoint 1. The hand-rolled full-frame
carrier behavior was over-producing border contacts; finite imageproc carriers
reduced false vertices/edges sharply. The remaining gap is recall and Python
topology behavior: Rust now under-splits/under-recovers some Python edges and
does not yet emit comparable quality warnings. Continue to the full square
topology decoder port rather than tuning Hough thresholds blindly.

### Checkpoint 3: Full Square Topology Decoder Port

- Port the missing Python `SquareTopologyDecoder` behavior:
  - finite carrier extents with padding;
  - boundary-contact side-band peak extraction;
  - junction NMS and snapping to analytic intersections;
  - carrier endpoint handling only for finite frame contacts;
  - drop unused non-border vertices before border-chain construction;
  - deterministic side-sorted border chain;
  - border assignments forced to `B`.
- Re-run metrics and commit.

Current checkpoint-3/4 implementation note:

The Rust port now follows the Python topology ordering more closely:

- compute analytic carrier intersections and snap nearby junction peaks;
- drop unused non-border vertices before constructing the deterministic border
  chain;
- keep side-sorted square border edges deterministic;
- run a conservative planar cleanup after border construction.

One attempted direct Python behavior was rejected for the browser Rust path:
unconditionally merging all same-family carrier runs by angle/rho increased false
edges with imageproc polar Hough. Rust keeps a finite-run overlap/padding gate
because imageproc produces different primitives than OpenCV `HoughLinesP`.

Benchmark against the same `clean-smoke` frozen Python oracle:

```text
Python oracle: 63 vertices, 101 edges, 16 B edges, status outside_v1_envelope
Rust/browser:  46 vertices, 72 edges, 12 B edges, status valid

vertex P/R/F1: 0.913 / 0.667 / 0.771
edge   P/R/F1: 0.819 / 0.584 / 0.682
border P/R/F1: 0.583 / 0.438 / 0.500
```

This improves precision and overall edge F1 slightly over checkpoint 2, but it
does not close the recall gap. The remaining parity issue is not just cleanup:
Rust is missing vertices/edges that Python produces, so the next work should
either add a larger benchmark suite or improve carrier/contact recall with
clear metrics.

### Checkpoint 4: Cleanup, Quality, And Repair

- Add planar cleanup:
  - duplicate edge removal;
  - illegal crossing handling;
  - zero/short edge gates;
  - unused vertex pruning;
  - optional near-endpoint snap if metrics justify it.
- Add quality warnings comparable to Python:
  - missing square corners;
  - invalid border cycle;
  - boundary contact not split;
  - non-square border edges;
  - illegal crossings;
  - low-confidence/unknown assignments.
- Add conservative square-border repair report.
- Re-run metrics and commit.

### Checkpoint 5: WASM And Product Validation

- Rebuild `oristudio-cp-detect-wasm`.
- Add WASM fixture tests for small and medium decode fixtures.
- Add browser smoke tests for upload, crop, detect, visible preview, import.
- Compare browser-native Rust output to native Rust for the same fixture.
- Commit if product path matches native Rust.

### Checkpoint 6: Parity Decision

- Produce final Python-vs-Rust metrics:
  - aggregate;
  - clean;
  - line-style;
  - V2 issue slices;
  - dark/combined stress slices;
  - named real-world cases.
- If Rust is comparable, mark the browser detector ready for manual review.
- If not, document the blocker and the smallest architectural choice that could
  plausibly close the gap, such as OpenCV.js for line segments or a different
  model output/decoder contract.

## First Implementation Target

Start with the benchmark harness, then replace only line extraction with
`imageproc` Hough plus finite carrier extraction. The current browser failure
shows too many full-frame carrier contacts; finite carriers are the highest
leverage first decoder fix.
