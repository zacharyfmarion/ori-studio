# oristudio-cp-eval

Product-side evaluation metrics for Ori Studio crease-pattern detection and
compiler work.

This crate lives in the Rust/product codebase because it evaluates the pipeline
that must run in the browser:

```text
model outputs or dense cache -> Rust detection -> candidate graph -> selection -> exact solve -> FOLD/export verification
```

The Python research repo can still evaluate training runs, but strict compiler
quality should be measured here.

## Current Metric: Strict Topology

`strict_topology_metrics(predicted, ground_truth, options)` answers a stricter
question than tolerant segment F1:

> Did the predicted CP recover the same graph as GT, with vertices in the same
> places, the same edges between those vertices, and the same assignments?

The metric works in three passes:

1. **Vertex matching**
   - One-to-one predicted-to-GT vertex matching under
     `StrictTopologyOptions::vertex_tolerance`.
   - Reports vertex precision/recall/F1 plus mean/max matched vertex error.

2. **Edge matching**
   - A predicted edge only matches GT if both predicted endpoints map to GT
     vertices and that exact GT endpoint pair exists as an edge.
   - Reports matched, missing, and extra edges plus edge precision/recall/F1.
   - Duplicate predicted edges count as extras after the first match.

3. **Assignment matching**
   - On strictly matched edges, assignment labels must match exactly when
     `compare_assignments` is true.
   - Reports assignment accuracy and mismatch diagnostics.

The report also includes diagnostics for common recognition errors:

- `missing_edges`: GT edges absent from the predicted graph.
- `extra_edges`: predicted edges absent from GT.
- `wrong_assignments`: strict edge matches with wrong M/V/B/U label.
- `split_edges`: one GT edge represented as multiple collinear predicted edges.
- `merged_edges`: one predicted edge spanning multiple GT edges/junctions.

The split/merged diagnostics are intentionally explanatory; the core precision
and recall numbers come from exact endpoint graph matching.

## Coordinate Space

The metric is coordinate-space agnostic. Pass GT and prediction in the same
coordinate system:

- use pixels if comparing detector outputs to rendered GT;
- use normalized paper coordinates if comparing compiler internals;
- set tolerances in that same unit.

For the exact-solve benchmark, the intended default is a tight pixel tolerance,
for example:

```rust
StrictTopologyOptions {
    vertex_tolerance: 2.0,
    split_merge_tolerance: 2.0,
    compare_assignments: true,
}
```

## Minimal Example

```rust
use oristudio_cp_eval::{
    EvalAssignment, EvalEdge, EvalGraph, EvalPoint, StrictTopologyOptions,
    strict_topology_metrics,
};

let gt = EvalGraph::new(
    vec![EvalPoint::new(0.0, 0.0), EvalPoint::new(1.0, 0.0)],
    vec![EvalEdge::new([0, 1], EvalAssignment::Valley)],
);
let predicted = gt.clone();

let metrics = strict_topology_metrics(
    &predicted,
    &gt,
    StrictTopologyOptions::default(),
);

assert!(metrics.exact_topology_and_assignment);
```

## FOLD Input

For simple FOLD documents:

```rust
let graph = EvalGraph::from_fold_json(fold_json)?;
```

Supported fields:

- `vertices_coords`
- `edges_vertices`
- `edges_assignment`
- optional `cp_detector.edge_boundary_role`

## Adding A New Metric

1. Add a new module under `src/`, for example `local_flatfold.rs`.
2. Define:
   - an options struct,
   - a serializable per-sample metrics struct,
   - optional aggregate and diagnostic structs.
3. Re-export the public API from `src/lib.rs`.
4. Add focused unit tests in the metric module.
5. Add a short section to this README describing:
   - what question the metric answers,
   - what coordinate/unit assumptions it makes,
   - how to interpret failures.
6. Wire the metric into benchmark binaries only after the standalone crate tests
   are green.

Prefer adding a new metric family over changing the meaning of an existing
metric. Historical benchmark results should remain comparable.

## Candidate Coverage

`candidate_coverage_metrics(...)` answers an earlier pipeline question than
strict topology:

> Did candidate generation ever offer the correct GT edge before beam selection
> and exact solve?

It compares each non-boundary GT crease against four candidate stages:

1. **High-threshold legacy**: the normal legacy decode.
2. **Low-threshold legacy**: the recall-oriented legacy decode used to add weak
   candidates.
3. **Adapter candidates**: the source-neutral `CandidateGraph` before beam
   selection.
4. **Selected candidates**: the spans chosen by beam selection.

For each GT edge, the metric records:

- dense line/non-crease support along the GT segment;
- whether both GT endpoints exist in each candidate stage;
- whether an aligned carrier exists;
- whether the GT edge is represented as one span, a fragmented chain, or an
  overlong span;
- whether beam selection selected a matching span/chain;
- a deterministic first-failure/root-cause label.

The aggregate summary highlights the main bottleneck:

- `candidate_oracle_recall`: percent of evaluated GT creases represented by any
  adapter candidate before selection.
- `selected_recall`: percent represented after beam selection.
- root-cause counts such as `carrier_missing_high_and_low`,
  `low_threshold_found_but_adapter_lost`, and
  `candidate_available_but_rejected`.

The current benchmark runner is:

```bash
cargo run --release -p oristudio-cp-detect --bin compare_candidate_coverage -- \
  --strategy legacy-threshold \
  --manifest artifacts/cp-detect-correctness/dense-cache/clean-1024-s15-browser-onnx-v3-dense-edges-max1200-probe-20260618/manifest.json \
  --out artifacts/cp-detect-correctness/reports/clean-1024-s15-candidate-coverage-YYYY-MM-DD
```

It writes:

- `summary.json`: aggregate metrics and worst samples;
- `per_sample.jsonl`: one full report per sample;
- `per_gt_edge.jsonl`: one attribution row per evaluated GT edge;
- `README.md`: human-readable summary.

Candidate coverage intentionally ignores boundary GT edges by default because
paper borders are handled by a deterministic border path. Pass
`--include-boundary-edges` when debugging border-specific regressions.
