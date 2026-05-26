# Exact Python Detector Web Port Plan

## Goal

Port the frozen Python `create-pattern-detector` V2 image-to-FOLD pipeline to
Rust/WASM so Ori Studio can run the same detector quality entirely in the
browser.

This is a 1:1 porting project, not a product shortcut. The Python pipeline is
the immutable oracle. Rust is complete only when each pipeline stage matches the
Python stage output within that stage's declared parity contract, and the full
browser output matches Python quality on the benchmark slices.

The target product flow remains:

```text
uploaded image
  -> crop and rectify to square CP
  -> CPLineNet-V2 ONNX inference
  -> Python-equivalent Rust/WASM evidence conversion
  -> Python-equivalent Rust/WASM square topology decoding
  -> Python-equivalent FOLD export and detector report
  -> oristudio-cp import, repair, diagnostics, and editing
```

Python may be used in oracle scripts and benchmarks. Python must not be used by
the browser runtime.

## Relationship To Existing Plans

- `BROWSER_DETECTION_ROADMAP_V1.md` tracks the product integration path.
- `opencv-houghlinesp-rust-port.md` is the exact-parity sub-plan for
  `cv2.HoughLinesP`; checkpoints 1 through 5 are already complete.
- `rust-cp-detector-quality-parity.md` was the earlier "comparable quality"
  plan. This exact-port plan supersedes it for remaining detector work.

## Non-Negotiable Guardrails

- Python detector code is frozen. Do not change Python to make Rust parity
  easier.
- No mock detector, fallback graph, fake success path, or "best effort" product
  runtime is allowed. The real model is a hard requirement.
- Do not ship or default-wire a stage until its oracle gate passes.
- Do not tune thresholds to hide a porting mismatch. Threshold changes are
  allowed only after the Rust implementation matches Python semantics for the
  existing threshold values.
- Do not implement partial sketches and mark them complete. Missing behavior is
  explicitly recorded as `Not implemented`.
- Do not hallucinate unrecoverable geometry. Missing/cropped borders and
  symmetry recovery remain out of V2 scope unless the Python oracle already does
  that exact behavior.
- Keep generated datasets, model weights, screenshots, and large reports out of
  git. Commit small source files, fixtures, manifests, docs, and deterministic
  benchmark summaries.
- Every checkpoint ends with tests, benchmark notes, and a focused commit.
- If a dependency's behavior is unknown, isolate it with an oracle fixture or
  source-level trace before porting the next layer.
- If native Rust and WASM disagree, stop and fix the divergence before running
  browser product tests.

## Exactness Contract

Different stages need different notions of exactness. The plan uses the
strictest useful contract for each layer.

| Stage | Contract |
| --- | --- |
| Discrete masks, labels, warning codes, statuses, graph topology, edge assignments | Exact unless a documented dependency makes exactness impossible. |
| Hough raw segments | Exact ordered integer parity with Python OpenCV. This is already achieved for the current fixture set. |
| Rectified pixels | Exact for nearest/integer paths; bounded max/mean pixel delta for interpolation paths, with deltas reported. |
| Neural network output | Numeric close between PyTorch and ONNX Runtime Web for every head. Exact bit parity is not expected across runtimes. |
| Geometry floats | Tiny tolerances, declared per checkpoint. Tolerances must be much smaller than graph merge/snap thresholds. |
| Final FOLD | Same graph after canonicalization: same vertex count, edge count, assignments, border cycle, and coordinates within tolerance. |

Debug-only looser modes such as unordered matching or geometry-equivalent
matching are useful for diagnosis. They are not acceptance gates.

## Source Of Truth Inventory

Frozen Python repo:

```text
/Users/zacharymarion/.codex/worktrees/a00b/create-pattern-detector
```

Primary Python modules to port or match:

```text
src/inference/pipeline.py
src/inference/rectifier.py
src/vectorization/cpline_adapter.py
src/vectorization/evidence.py
src/vectorization/square_topology_decoder.py
src/vectorization/planar_graph_builder.py
src/vectorization/edge_assignment.py
src/vectorization/constraint_repair.py
src/vectorization/diagnostics.py
src/vectorization/quality_report.py
src/vectorization/fold_writer.py
```

Current Rust/Ori Studio implementation targets:

```text
crates/oristudio-cp-detect/src/lib.rs
crates/oristudio-cp-detect/src/rectify.rs
crates/oristudio-cp-detect/src/decode.rs
crates/oristudio-cp-detect/src/opencv_hough_lines_p.rs
crates/oristudio-cp-detect-wasm/src/lib.rs
apps/web/src/workers/cpDetectWorker.ts
```

Future Rust structure should split the long decoder into parity-testable modules:

```text
crates/oristudio-cp-detect/src/
  evidence.rs        CPLineNet heads -> Python-equivalent evidence maps
  geometry.rs        points, lines, clipping, intersections, side coordinates
  peaks.rs           Python-equivalent NMS/max-filter/contact extraction
  carriers.rs        raw segments -> merged finite carriers
  support.rs         segment support, dashed support, assignment voting
  topology.rs        square topology graph construction
  cleanup.rs         graph cleanup and conservative repair
  quality.rs         detector status, warnings, confidence/report fields
  fold_export.rs     FOLD writer parity and metadata
```

Splitting is allowed only when it preserves behavior and makes stage parity
easier to test.

## Oracle Artifact Strategy

The next work starts by improving oracle replay. A stage cannot be ported 1:1 if
we cannot compare its intermediate outputs.

Add or extend Python oracle export so each fixture can optionally include:

```text
input image
crop quad and rectifier report
rectified image
preprocessed model tensor metadata
raw PyTorch head arrays
ONNX head arrays when available
line_prob
effective_line_prob
non_crease_prob
line_style_prob
assignment_prob and assignment labels
junction_prob and extracted junction peaks
boundary_contact_prob and extracted contact peaks
line_mask
OpenCV Hough raw segments
merged raw lines
finite carriers
carrier support samples and scores
candidate vertices with source metadata
interior edge candidates before cleanup
border contact vertices and side ordering
post-cleanup vertices and edges
assignments
quality warnings and status
FOLD JSON
```

Large arrays and rendered debug images stay under ignored `artifacts/`. Small
manifests and tiny deterministic fixtures may be committed.

## Benchmark Slices

Every full-run benchmark should report aggregate metrics and slice metrics:

- clean synthetic fixtures;
- original line-style profiles;
- V2 issue profiles: text, watermark, guide grid, faint, dashed/gapped,
  ambiguous M/V;
- dark/V2 combined stress cases;
- real-world smoke cases, including the named duck/cpoogle image;
- dense CPs only as natural data, not as a synthetic "scale collapse"
  augmentation.

For labeled synthetic fixtures:

- vertex precision/recall/F1;
- edge precision/recall/F1;
- border precision/recall/F1;
- boundary-contact recall;
- assignment accuracy;
- valid/parseable FOLD rate;
- complete square-border rate.

For unlabeled real-world fixtures:

- Python-vs-Rust graph deltas;
- warning/status parity;
- complete square-border rate;
- valid/parseable FOLD rate;
- contact sheets for manual inspection.

## Checkpoints

Each checkpoint ends with a commit.

## Checkpoint Status

| Checkpoint | Status | Notes |
| --- | --- | --- |
| 0: Plan | Complete | Exact-port plan added and older quality-parity plan marked superseded. |
| 1: Oracle Replay Harness | Complete | Python evidence export and Rust replay comparison harness are in place. |
| 2: Rectifier And Crop Parity | Pending | Product crop exists, but exact Python rectifier parity is still not gated. |
| 3: Model I/O And Head Parity | Blocked | Browser ONNX runs, but ONNX Runtime Web head tensors still drift from frozen PyTorch batch-stat inference. |
| 4: Evidence Conversion Parity | Complete | Python-logit replay now matches through final graph/report/FOLD on the current replay fixtures. |
| 5: Hough Segment Extraction Parity | Complete | OpenCV-compatible Rust `HoughLinesP` has exact ordered parity on tiny and real V2 masks. |
| 6: Raw Segments To Carriers Parity | Complete | Raw lines and finite carriers match Python on the clean smoke and duck/cpoogle replay fixtures. |
| 7: Peak Extraction And Candidate Vertex Parity | Complete | Intersections, junction peaks, boundary contacts, candidate vertices, and merged vertices match Python on the same replay fixtures. |
| 8: Edge Construction And Support Parity | Complete | Interior edge enumeration, support sampling, dashed/gapped support, and assignment voting match Python on the replay fixtures. |
| 9: Square Border Chain Parity | Complete | Boundary used-contact sorting, deterministic border edges, and combined pre-cleanup edges match Python on the replay fixtures. |
| 10: Cleanup, Repair, Quality, And Status Parity | Complete | Native replay matches final report/status/warning/action codes on the two current oracle fixtures. |
| 11: FOLD Export Parity | Complete | Native canonical FOLD graph output matches Python on the two current oracle fixtures. |
| 12: Native Rust, WASM, And Node Parity | Complete | Browser WASM decode fed with Python logits reaches 1.0 graph metrics and matching reports on the two current oracle fixtures. |
| 13: Full Browser End-To-End Parity | Blocked | Full UI path is close but not exact because model/ONNX and rectifier/product-path drift remain upstream of decode. |

### Checkpoint 0: Plan

- Add this exact-port plan.
- Mark the older quality-parity plan as superseded for current work.
- No runtime implementation changes.

Gate:

- `git diff --check`
- commit the plan.

### Checkpoint 1: Oracle Replay Harness

Build the tooling that makes every later stage measurable.

Tasks:

- Extend `scripts/cp-detect/export-python-oracle-evidence.py` or add a new
  exporter that records all intermediate Python stage outputs listed above.
- Add a Rust-native replay CLI, for example:

```text
cargo run -p oristudio-cp-detect --bin compare_python_detector_oracle -- \
  --manifest artifacts/cp-detect-parity/<fixture-set>/manifest.json
```

- The CLI must compare by stage, not only final FOLD.
- Add canonical JSON comparison helpers for graphs, warnings, statuses, and
  FOLD files.
- Add a small committed fixture manifest and ignored artifact convention.
- Produce a current-stage baseline that shows exactly where Rust diverges after
  the already-complete Hough stage.

Gate:

- Oracle export runs on at least one clean synthetic fixture and the named duck
  real-world image.
- Rust replay can load every exported artifact.
- Comparison report names the first divergent stage.
- No browser runtime code changes.

### Checkpoint 2: Rectifier And Crop Parity

Port and verify the Python rectifier behavior before model inference.

Tasks:

- Compare Python and Rust on manual quads first:
  - homography matrix;
  - rectified image dimensions;
  - rectified pixel deltas;
  - rectifier warnings.
- Then compare auto-crop behavior:
  - full-frame square preservation;
  - axis-aligned/projection panel detection;
  - density crop fallback;
  - low-confidence and unrecoverable-border reporting.
- Add fixtures for clean images, bordered screenshots, dark screenshots, text
  headers, and the named duck image.
- Keep manual crop override as the escape hatch when auto-crop confidence is low.

Gate:

- Manual-quad rectification matches Python within declared pixel tolerances.
- Auto-crop quads and warnings match Python on the committed fixture set or each
  mismatch is documented as a chosen Rust dependency difference.
- No hallucinated border recovery.

### Checkpoint 3: Model I/O And Head Parity

Prove that browser ONNX inference supplies the same information the Python
decoder expects.

Tasks:

- Compare Python PyTorch preprocessing with browser/Rust preprocessing:
  - RGB conversion;
  - square resize;
  - tensor layout;
  - normalization;
  - dtype.
- Compare PyTorch checkpoint heads with ONNX Runtime Web heads for the same
  rectified images.
- Report max absolute error, mean absolute error, and argmax/mask differences
  for every CPLineNet-V2 head:
  - `line_logits`;
  - `angle`;
  - `junction_logits`;
  - `assignment_logits`;
  - `non_crease_logits`;
  - `line_style_logits`;
  - `boundary_contact_logits`;
  - `vertex_type_logits`;
  - `boundary_side_logits`;
  - `boundary_offset`;
  - `boundary_coord`.

Gate:

- Numeric head deltas are small enough that downstream discrete masks match on
  supported fixtures, or the mismatch is isolated before topology work
  continues.
- Missing model assets remain a blocking product error.

### Checkpoint 4: Evidence Conversion Parity

Port Python evidence conversion exactly.

Tasks:

- Port sigmoid/softmax, label extraction, head thresholding, and configured
  defaults.
- Port effective line probability calculation, including non-crease
  suppression, dashed/gapped support hooks, and line-style weighting.
- Port line-mask construction exactly from evidence maps.
- Compare all exported dense maps and masks against Python.

Gate:

- Discrete masks and label rasters match Python exactly on the fixture set.
- Float evidence maps match within declared tolerances.
- Hough input masks match before calling the already-parity-tested
  `HoughLinesP` port.

### Checkpoint 5: Hough Segment Extraction Parity

This checkpoint is already complete and remains a dependency for the rest of the
plan.

Current complete state:

- `opencv_hough_lines_p.rs` ports OpenCV CPU `HoughLinesP`.
- Tiny fixture parity: `14/14` exact ordered.
- Real V2 mask parity: `5/5` exact ordered.
- The decoder now uses the OpenCV-compatible segment source.

Gate for future changes:

- Any change touching `opencv_hough_lines_p.rs` must keep exact ordered parity
  on tiny fixtures and real V2 masks.

### Checkpoint 6: Raw Segments To Carriers Parity

This is the current highest-value downstream parity work.

Tasks:

- Port Python raw segment normalization and merging exactly:
  - line equation convention;
  - segment orientation;
  - angle/rho grouping;
  - overlap and gap rules;
  - carrier extent padding;
  - line ordering and tie-breakers;
  - confidence/support fields.
- Compare:
  - raw `HoughLinesP` segments;
  - merged raw lines;
  - finite carriers;
  - carrier scores and extents.
- Do not tune graph thresholds until this layer matches Python.

Gate:

- Same carrier count and canonical order on clean fixtures.
- Same carrier count and geometry within tolerance on real-smoke fixtures.
- Any non-identical carrier is traceable to an accepted dependency-level
  floating difference, not an algorithm sketch.

### Checkpoint 7: Peak Extraction And Candidate Vertex Parity

Port the Python vertex evidence path.

Tasks:

- Port junction NMS/max-filter behavior:
  - neighborhood size;
  - thresholding;
  - plateau/tie handling;
  - ordering.
- Port boundary-contact extraction:
  - side-conditioned contact scores;
  - side coordinate and offset handling;
  - side bands;
  - corner/contact treatment;
  - duplicate contact merge rules.
- Port analytic intersections between finite carriers.
- Port snapping of junction/contact peaks to analytic intersections.
- Preserve source metadata for each candidate vertex.

Gate:

- Python and Rust emit the same candidate vertex set after canonicalization.
- Border contacts match by side and side coordinate.
- Corner behavior is explicitly matched: corners are square boundary vertices,
  not green contact dots unless Python emits them as crease-boundary contacts.

### Checkpoint 8: Edge Construction And Support Parity

Port how the decoder decides that a crease edge exists.

Tasks:

- Port candidate edge enumeration along carriers.
- Port support sampling:
  - sample step;
  - sampling width;
  - endpoint exclusion;
  - line probability aggregation;
  - dashed/gapped support handling;
  - non-crease penalties;
  - assignment voting.
- Port acceptance thresholds exactly after the sampling semantics match.
- Compare all pre-cleanup interior edge candidates and scores.

Gate:

- For every fixture, accepted/rejected interior edges match Python after
  canonicalization.
- Missing obvious lines must be explainable by matching Python scores, not Rust
  threshold drift.

### Checkpoint 9: Square Border Chain Parity

Port deterministic square topology construction.

Tasks:

- Fix square corners exactly as Python does.
- Sort boundary-contact vertices per side using Python side-coordinate
  semantics.
- Split border edges deterministically.
- Force border assignments/status exactly as Python does.
- Preserve the V2 policy of not hallucinating missing/cropped source borders
  beyond the Python oracle behavior.

Gate:

- Border edge count, ordering, side ownership, and assignments match Python.
- Border F1 vs Python is effectively `1.0` on supported oracle fixtures.
- The named duck/cpoogle example has the same border topology as Python.

### Checkpoint 10: Cleanup, Repair, Quality, And Status Parity

Port post-graph behavior that affects whether Ori Studio receives a usable FOLD.

Tasks:

- Port duplicate edge removal, unused vertex pruning, crossing handling, short
  edge filtering, and collinear/near-duplicate behavior.
- Port conservative repair, but only where Python already applies it.
- Port diagnostics and quality report fields:
  - warning codes;
  - confidence fields;
  - supported-envelope status;
  - ambiguity reporting;
  - assignment-source reporting.
- Ensure inferred M/V labels remain flagged separately from observed labels if
  Python does so.

Gate:

- Final graph and detector report match Python on stage fixtures.
- Warning/status parity is exact.
- The browser UI can display warnings without changing detector output.

### Checkpoint 11: FOLD Export Parity

Port export semantics exactly enough for Ori Studio import and external tools.

Tasks:

- Port coordinate normalization and vertex ordering.
- Port edge ordering, assignments, metadata, and detector report embedding.
- Add canonical FOLD comparison that ignores only harmless JSON key ordering.
- Verify output parses through `oristudio-cp-wasm` and can be exported again.

Gate:

- Canonical FOLD output matches Python for supported fixtures.
- Ori Studio import succeeds without hidden product-side graph invention.
- `.fold` and `.cp` export validation passes.

### Checkpoint 12: Native Rust, WASM, And Node Parity

Before browser UI validation, prove Rust behaves the same across compilation
targets.

Tasks:

- Run the replay harness natively.
- Run the same replay through `wasm32-unknown-unknown` in Node.
- Compare all stage outputs.
- If floating behavior differs, isolate the operation and either make it
  deterministic or record a declared tolerance before proceeding.

Gate:

- Native and WASM outputs match each other under the same canonicalization used
  against Python.
- No browser-only math divergence is hiding under the UI.

### Checkpoint 13: Full Browser End-To-End Parity

Only after native and WASM stage parity should the product path be judged.

Tasks:

- Run full browser upload/crop/detect/review/import on the benchmark slices.
- Compare browser output against frozen Python full-pipeline output.
- Produce contact sheets:
  - input image;
  - Python output;
  - browser output;
  - diff overlay, opt-in only.
- Exercise manual crop override and low-confidence crop UI.
- Verify detection progress/error states:
  - upload empty state;
  - crop review;
  - detection spinner;
  - review;
  - import.

Gate:

- Browser Python-vs-Rust graph metrics are effectively parity on supported
  fixtures.
- The named duck/cpoogle example matches Python quality.
- No hidden timeout or blank preview after detection.
- Manual testing can proceed in Ori Studio.

## Required Commands

Use these as the baseline validation suite, expanding per checkpoint:

```text
cargo fmt --check
cargo test -p oristudio-cp-detect
cargo check -p oristudio-cp-detect --target wasm32-unknown-unknown
cargo check -p oristudio-cp-detect-wasm --target wasm32-unknown-unknown
wasm-pack test --node crates/oristudio-cp-detect-wasm
npm --workspace @treemaker/web run build:oristudio-cp-detect-wasm
npm --workspace @treemaker/web run build
```

Benchmark/oracle commands should write small JSON summaries under committed
`artifacts/cp-detect-parity/` only when the summary is intentionally useful for
future comparison. Large raw artifacts remain ignored.

## Current State

Completed:

- Browser feature skeleton exists and requires a real ONNX model.
- Crop/review/detect/import UI exists but needs exact parity validation.
- The OpenCV-compatible Rust `HoughLinesP` port has exact ordered parity on the
  current tiny and real V2 mask sets.
- The decoder uses the OpenCV-compatible segment source.
- Checkpoint 1 oracle replay harness exists:
  - the Python oracle exporter now writes rectification metadata and evidence
    summaries in addition to line masks, raw segments, raw lines, carriers,
    FOLD, and report artifacts;
  - `compare_python_detector_oracle` reads a Python evidence manifest and
    compares stage outputs directly against Rust;
  - `decode_stage_snapshot_from_line_mask` exposes Rust raw Hough segments and
    current carrier construction for replay.

Most recent 5-fixture browser-vs-Python real-smoke report after replacing the
Hough source:

```text
fixture_count: 5
vertex_f1: 0.3959
edge_f1: 0.2674
border_f1: 0.2199
```

Interpretation:

- Hough segment extraction is no longer the primary exactness blocker.
- The remaining gap is downstream: carrier merging, vertex/contact extraction,
  edge support decisions, border-chain construction, cleanup/status, and FOLD
  export semantics.

Checkpoint 1 replay baseline, generated locally under ignored
`artifacts/cp-detect-parity/python-oracle-replay-20260526/`:

```text
fixture_count: 2
raw_segment_exact_ordered_matches: 2
carrier_ordered_geometry_matches: 0
first_divergence_counts:
  raw_lines_not_implemented: 2
```

The two fixtures were the clean smoke fixture and the named duck/cpoogle image.
Both match Python exactly through raw OpenCV Hough segments. Both diverge at the
next layer because Rust does not yet expose or port Python's `_merge_segments`
raw-line stage separately from carrier construction. Current carrier counts also
diverge:

```text
clean-smoke: Python carriers 104, Rust carriers 83
duck/cpoogle: Python carriers 150, Rust carriers 122
```

Checkpoint 6 raw-line/carrier parity is now complete on the same two-fixture
oracle replay set:

```text
fixture_count: 2
raw_segment_exact_ordered_matches: 2
raw_line_ordered_geometry_matches: 2
carrier_ordered_geometry_matches: 2
first_divergence_counts: {}
```

The post-port browser product benchmark on those same two fixtures:

```text
vertex precision/recall/F1: 0.8871 / 0.6465 / 0.7479
edge precision/recall/F1:   0.8227 / 0.5530 / 0.6600
border precision/recall/F1: 0.5182 / 0.3299 / 0.4021
```

Interpretation:

- The classical evidence stack is now exact through Python raw segments, raw
  lines, and finite carriers for the initial replay fixtures.
- Remaining product gap is downstream of carriers: candidate vertex extraction,
  edge support/assignment decisions, square border chain, cleanup/status, and
  final FOLD export.

Checkpoint 7 candidate-vertex parity is now complete on the same two-fixture
oracle replay set:

```text
fixture_count: 2
raw_segment_exact_ordered_matches: 2
raw_line_ordered_geometry_matches: 2
carrier_ordered_geometry_matches: 2
candidate_vertex_ordered_matches: 2
merged_vertex_ordered_matches: 2
first_divergence_counts: {}
```

This covers Python/Rust parity for:

- analytic carrier intersections;
- junction peak extraction;
- boundary-contact peak extraction;
- candidate vertex source/order;
- post-merge vertex source/order.

The Rust default `line_vertex_distance_px` was aligned to the Python V2
1024-pixel value, `4 * 1024 / 768 = 5.333px`, which was required for the
duck/cpoogle candidate-junction replay.

The post-Checkpoint-7 browser product benchmark on the same two fixtures:

```text
vertex precision/recall/F1: 0.8871 / 0.6465 / 0.7479
edge precision/recall/F1:   0.8279 / 0.5817 / 0.6810
border precision/recall/F1: 0.5105 / 0.3299 / 0.4001
```

Compared with the post-carrier product benchmark, edge F1 improved from
`0.6600` to `0.6810`; border F1 is effectively unchanged. That is expected:
candidate-vertex parity helps edge recall, but border quality still depends on
edge support and border-chain parity in later checkpoints.

Checkpoint 8 and 9 edge/border parity is now complete on the same two-fixture
oracle replay set:

```text
fixture_count: 2
raw_segment_exact_ordered_matches: 2
raw_line_ordered_geometry_matches: 2
carrier_ordered_geometry_matches: 2
candidate_vertex_ordered_matches: 2
merged_vertex_ordered_matches: 2
initial_interior_edge_ordered_matches: 2
vertices_after_drop_ordered_matches: 2
interior_edge_ordered_matches: 2
border_edge_ordered_matches: 2
combined_edge_ordered_matches: 2
first_divergence_counts: {}
```

This covers Python/Rust parity for:

- carrier-ordered interior edge enumeration;
- Python's 1px segment sampling step and 3px perpendicular support band;
- dashed/gapped style support contribution;
- assignment voting from Python-style thresholded assignment labels;
- unused non-border vertex pruning before border construction;
- deterministic boundary-contact side ordering and square border-chain edges;
- combined pre-cleanup edge topology and support values.

The post-Checkpoint-9 browser product benchmark on the same two fixtures:

```text
vertex precision/recall/F1: 0.8871 / 0.6465 / 0.7479
edge precision/recall/F1:   0.8279 / 0.5817 / 0.6810
border precision/recall/F1: 0.5105 / 0.3299 / 0.4001
```

These browser metrics are unchanged from Checkpoint 7 even though native stage
replay now matches through combined pre-cleanup edges. That means the remaining
browser-vs-Python delta is no longer in carrier, vertex, edge-support, or
border-chain construction for these replay inputs. The next likely gap is
cleanup/repair/report/FOLD export parity or an earlier ungated product-path
difference such as crop/model/evidence parity.

Checkpoint 10 and 11 cleanup/repair/report/FOLD parity are now complete on the
same two-fixture oracle replay set:

```text
fixture_count: 2
raw_segment_exact_ordered_matches: 2
raw_line_ordered_geometry_matches: 2
carrier_ordered_geometry_matches: 2
candidate_vertex_ordered_matches: 2
merged_vertex_ordered_matches: 2
initial_interior_edge_ordered_matches: 2
vertices_after_drop_ordered_matches: 2
interior_edge_ordered_matches: 2
border_edge_ordered_matches: 2
combined_edge_ordered_matches: 2
cleanup_edge_ordered_matches: 2
final_vertex_ordered_matches: 2
final_edge_ordered_matches: 2
final_fold_matches: 2
final_report_matches: 2
first_divergence_counts: {}
```

This covers the current replay fixtures for:

- cleanup edge ordering and support-preserving dedupe behavior;
- conservative repair action codes;
- square-border canonicalization report plumbing;
- final warning/status/report code parity;
- final FOLD graph parity.

Checkpoint 12 browser WASM decode parity is also complete when the browser is
fed the exact frozen Python dense logits:

```text
fixture_count: 2
report_matches: 2
vertex precision/recall/F1: 1.0000 / 1.0000 / 1.0000
edge precision/recall/F1:   1.0000 / 1.0000 / 1.0000
border precision/recall/F1: 1.0000 / 1.0000 / 1.0000
```

This isolates the remaining full-product mismatch to stages before the Rust
decoder: crop/rectification, browser preprocessing, or model inference.

The model-inference isolation result is the current blocker. The exporter now
supports an `explicit-batch-stats` mode that rewrites `BatchNorm2d` into
explicit per-image mean/variance ops before ONNX export. That ruled out ONNX
training-mode BatchNorm as the blocker, because the head drift is unchanged:

```text
line_logits max/mean abs error:             0.0681086 / 0.0041510
line_logits threshold mask diffs at 0.65:   30
junction_logits max/mean abs error:         0.0558589 / 0.0030738
assignment_logits max/mean abs error:       0.0443964 / 0.0021552
non_crease_logits max/mean abs error:       0.1068382 / 0.0074808
line_style_logits max/mean abs error:       0.0931141 / 0.0026217
boundary_contact_logits max/mean abs error: 0.0302668 / 0.0018361
```

Running the real browser UI path with the explicit-BatchNorm ONNX asset gives:

```text
Original uploads:
vertex precision/recall/F1: 0.9478 / 0.9113 / 0.9283
edge precision/recall/F1:   0.8912 / 0.8742 / 0.8823
border precision/recall/F1: 0.9319 / 0.9333 / 0.9294

Python-rectified inputs through the same UI:
vertex precision/recall/F1: 0.9697 / 0.8773 / 0.9201
edge precision/recall/F1:   0.9320 / 0.8633 / 0.8961
border precision/recall/F1: 0.9444 / 0.9556 / 0.9473
```

Interpretation:

- The browser decoder and final FOLD/report export are no longer the parity
  blocker for the current fixtures.
- ONNX Runtime Web inference is close but not exact relative to frozen PyTorch
  batch-stat inference. The remaining logit drift is enough to alter line masks
  and final graphs.
- The arbitrary-upload path still also needs exact rectifier/crop parity before
  full end-to-end parity can be claimed.

Remaining required phases:

- Build a direct browser model benchmark that starts from Python's exported
  `input_tensor.f32` and writes browser ONNX outputs plus evidence maps. This
  removes canvas/image preprocessing from model parity.
- Decide the model runtime strategy for exact parity. Current ONNX Runtime Web
  is not exact enough for a strict Python-identical graph; options are a
  declared tolerance gate, a different browser runtime/export path, or accepting
  product-level metric parity rather than exact PyTorch parity.
- Port/gate the Python rectifier behavior for arbitrary uploads. The current
  product rectifier is usable but not proven 1:1.

## Next Implementation Target

Checkpoint 10, 11, and 12 closed the Rust/browser decoder path on the initial
replay set. Proceed only on upstream parity now: direct model-runtime evidence
maps, then exact crop/rectifier parity.

The first important question is now:

```text
Given identical Python input tensors, which browser model/evidence operation
first changes the final graph?
```

Do not spend more time tuning product thresholds until the upstream
model/evidence path has a stage-level parity answer.
