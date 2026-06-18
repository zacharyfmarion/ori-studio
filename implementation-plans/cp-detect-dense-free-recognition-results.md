# CP Detect Dense-Free Recognition Results

Status: Phase 6 blocker report, corrected June 18, 2026.

## Summary

The strict dense-free path is implemented far enough to benchmark on the real
CP-detect correctness packs:

- `RasterEvidence` extracts deterministic luma, line probability, binary line
  mask, and extraction diagnostics from rectified pixels.
- `raster-carrier-v1` emits a compiler `CandidateGraph` without reading model
  dense heads.
- `compare_raster_candidate_coverage` benchmarks correctness-pack PNG inputs
  against GT graph JSON.
- The current dense `junction-first-v1` baseline was run from the existing
  `clean-1024-s15-browser-onnx` dense cache.

Result: `raster-carrier-v1` should not become the default recognition path. On
the real `clean-1024-s15` pack, tight-budget raster carrier selection recovered
only `21.8%` of topology edges, while dense `junction-first-v1` selected
`95.8%` and matched assignments on `91.6%` of evaluated edges.

The ablation ladder found the deterministic image-only blocker: the raster line
evidence is strong enough when true vertices are known, but current
Hough/carrier vertex proposal is not competitive. With GT vertices, raster
support reaches `100.0%` topology recall on both real packs. With raster
vertices and GT adjacency, clean recall tops out at `66.0%` even with `360`
carriers, no span budget, and an extremely loose `1px` merge radius that emits
more than `140k` proposed vertices across 15 samples. That is not a
default-ready shape.

I also audited the existing `create-pattern-detector` close-pair and graph-head
assets. They are useful learned-vertex diagnostics, but not a strict
dense-free runtime path: the close-pair checkpoints decode `junction_logits`
and `junction_offset`, and the old graph head consumes dense pixel-head
segmentation/backbone features. A true sparse approach would require training
or distilling a new non-dense head.

## Data Used

Real benchmark inputs were found under:

```text
/Users/zacharymarion/.codex/worktrees/cp-detect-browser-v1/tree-maker-rust/artifacts/cp-detect-correctness
```

The benchmarked data:

- `packs/clean-1024-s15/manifest.json`
- `packs/smoke-1024-s1/manifest.json`
- `dense-cache/clean-1024-s15-browser-onnx/manifest.json`

The clean pack samples reference the actual generated CP-detect validation data
under `/Users/zacharymarion/Documents/datasets/create-pattern-detector`, for
example:

```text
/Users/zacharymarion/Documents/datasets/create-pattern-detector/synthetic/cp_training_mix_v1/folds/...
```

The earlier repo-local FOLD fixture benchmark is superseded by this report. It
remains useful only as a fast local smoke/debug path.

## Dense Baseline

Command:

```bash
cargo run -p oristudio-cp-detect --release \
  --bin compare_candidate_coverage -- \
  --manifest /Users/zacharymarion/.codex/worktrees/cp-detect-browser-v1/tree-maker-rust/artifacts/cp-detect-correctness/dense-cache/clean-1024-s15-browser-onnx/manifest.json \
  --strategy junction-first-v1 \
  --out artifacts/cp-detect-correctness/reports/real-clean-1024-s15-junction-first-v1-2026-06-18
```

Result:

| Strategy | Pack | Samples | GT edges | Candidate recall | Selected recall | Assignment match | Candidates | Conflicts | Total time |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| dense `junction-first-v1` | `clean-1024-s15` | 15 | 2240 | 95.9% | 95.8% | 91.6% | 2651 | 113 | 6.3s |

Per-sample selected recall was high across the pack. The worst cases were still
well above the raster path:

| Sample | Candidate | Selected | Candidates | Conflicts | Total time |
| --- | ---: | ---: | ---: | ---: | ---: |
| `treemaker_tree_v1-5gjmj-000148__clean__000` | 256/257 | 256/257 | 280 | 17 | 0.61s |
| `rabbit_ear_fold_program_v1-5wk0f-000086__clean__002` | 65/72 | 65/72 | 103 | 2 | 0.31s |
| `rabbit_ear_fold_program_v1-5wk0c-000181__clean__007` | 165/187 | 162/187 | 224 | 20 | 0.43s |
| `rabbit_ear_fold_program_v1-5wk0b-000080__clean__008` | 31/42 | 31/42 | 57 | 0 | 0.20s |

## Raster Carrier On Real Smoke

The unbudgeted `raster-carrier-v1` run on `smoke-1024-s1` was interrupted after
more than one minute with no completed sample. This means default carrier
generation is not usable on real correctness-pack images.

The tight-budget run:

```bash
cargo run -p oristudio-cp-detect --release \
  --bin compare_raster_candidate_coverage -- \
  --pack /Users/zacharymarion/.codex/worktrees/cp-detect-browser-v1/tree-maker-rust/artifacts/cp-detect-correctness/packs/smoke-1024-s1/manifest.json \
  --out artifacts/cp-detect-correctness/reports/real-smoke-1024-s1-raster-carrier-v1-tight-2026-06-18 \
  --skip-exact-solve \
  --max-carriers 60 \
  --max-total-spans 1500
```

Result:

| Strategy | Pack | Samples | GT edges | Candidate recall | Selected recall | Assignment match | Candidates | Conflicts | Total time |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `raster-carrier-v1`, tight | `smoke-1024-s1` | 4 | 212 | 54.2% | 42.9% | 0.0% | 5363 | 5007 | 26.5s |

Per-profile result:

| Sample | Candidate | Selected | Candidates | Conflicts | Total time |
| --- | ---: | ---: | ---: | ---: | ---: |
| clean | 36/53 | 35/53 | 1422 | 1391 | 8.27s |
| line-style | 36/53 | 35/53 | 1500 | 1390 | 8.40s |
| watermark | 24/53 | 18/53 | 1009 | 847 | 3.12s |
| dashed | 19/53 | 3/53 | 1432 | 1379 | 6.73s |

The clean and line-style profiles show some topology signal. The dashed profile
breaks the carrier-first assumption badly: candidate chains exist, but the beam
selector does not recover the underlying topology.

## Raster Carrier On Real Clean

Command:

```bash
cargo run -p oristudio-cp-detect --release \
  --bin compare_raster_candidate_coverage -- \
  --pack /Users/zacharymarion/.codex/worktrees/cp-detect-browser-v1/tree-maker-rust/artifacts/cp-detect-correctness/packs/clean-1024-s15/manifest.json \
  --out artifacts/cp-detect-correctness/reports/real-clean-1024-s15-raster-carrier-v1-tight-2026-06-18 \
  --skip-exact-solve \
  --max-carriers 60 \
  --max-total-spans 1500
```

Result:

| Strategy | Pack | Samples | GT edges | Candidate recall | Selected recall | Assignment match | Candidates | Conflicts | Total time |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `raster-carrier-v1`, tight | `clean-1024-s15` | 15 | 2240 | 25.8% | 21.8% | 0.4% | 16986 | 15559 | 80.3s |

Per-sample selected recall:

| Sample | Candidate | Selected | Candidates | Conflicts | Total time |
| --- | ---: | ---: | ---: | ---: | ---: |
| `treemaker_tree_v1-5gjmj-000148__clean__000` | 63/257 | 51/257 | 1288 | 1261 | 7.03s |
| `treemaker_tree_v1-5gjme-012950__clean__001` | 46/98 | 44/98 | 1500 | 1460 | 9.16s |
| `rabbit_ear_fold_program_v1-5wk0f-000086__clean__002` | 38/72 | 29/72 | 1500 | 1538 | 8.15s |
| `rabbit_ear_fold_program_v1-5wk0e-000354__clean__003` | 79/212 | 74/212 | 1356 | 1337 | 7.87s |
| `rabbit_ear_fold_program_v1-5wk0a-000270__clean__004` | 15/198 | 13/198 | 548 | 300 | 1.47s |
| `rabbit_ear_fold_program_v1-5wk0a-000346__clean__005` | 36/54 | 33/54 | 1500 | 1552 | 8.68s |
| `treemaker_tree_v1-5gjmc-016496__clean__006` | 60/181 | 43/181 | 1464 | 1386 | 8.53s |
| `rabbit_ear_fold_program_v1-5wk0c-000181__clean__007` | 44/187 | 35/187 | 996 | 859 | 3.52s |
| `rabbit_ear_fold_program_v1-5wk0b-000080__clean__008` | 17/42 | 17/42 | 1323 | 1346 | 7.04s |
| `treemaker_tree_v1-5gjmj-005471__clean__009` | 35/216 | 19/216 | 1057 | 979 | 4.02s |
| `treemaker_tree_v1-5gjmi-003673__clean__010` | 51/166 | 47/166 | 1058 | 860 | 4.07s |
| `treemaker_tree_v1-5gjmb-011364__clean__011` | 21/149 | 17/149 | 877 | 724 | 2.91s |
| `rabbit_ear_fold_program_v1-5wk0a-000048__clean__012` | 29/162 | 26/162 | 716 | 500 | 1.62s |
| `treemaker_tree_v1-5gjma-007269__clean__013` | 12/153 | 10/153 | 665 | 469 | 1.85s |
| `rabbit_ear_fold_program_v1-5wk08-000155__clean__014` | 32/93 | 30/93 | 1138 | 988 | 4.44s |

Root causes:

| Root cause | Count | Share |
| --- | ---: | ---: |
| Endpoint missing from raster adapter | 1210 | 54.0% |
| Candidate selected, assignment unresolved/wrong | 479 | 21.4% |
| Carrier missing from raster adapter | 431 | 19.2% |
| Overlong candidate available but not selected | 64 | 2.9% |
| Candidate chain available but not selected | 26 | 1.2% |
| Edge missing despite endpoint and carrier | 21 | 0.9% |
| Candidate selected with matching assignment | 9 | 0.4% |

The raster line mask reported support for all evaluated GT edges, so the issue
is not simply foreground thresholding. The main miss is endpoint proposal:
Hough carriers and raster intersections do not recover enough true vertices on
real correctness-pack CPs, especially larger generated tree patterns.

## Ablation Ladder

The benchmark runner now supports diagnostic modes via `--ablation`:

- `gt-edges-raster-support`: emit only GT edges whose segment is supported by
  raster evidence.
- `gt-vertices-raster-pairs`: emit all GT-vertex pairs that pass raster support.
- `hough-segments-raster`: emit direct Hough segments from the raster mask.
- `raster-vertices-gt-adjacency`: use raster-proposed vertices, then connect
  nearest proposed vertices with GT adjacency.

These are oracle/debug modes, not product strategies. Assignment results are
not meaningful in these modes because they deliberately isolate topology.

| Ablation | Pack | Samples | GT edges | Candidate recall | Selected recall | Candidates | Time |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| GT edges with raster support | `clean-1024-s15` | 15 | 2240 | 100.0% | 100.0% | 2649 | 5.2s |
| GT vertices plus raster-supported pairs | `clean-1024-s15` | 15 | 2240 | 100.0% | 100.0% | 46639 | 6.1s |
| Direct Hough segments from raster | `clean-1024-s15` | 15 | 2240 | 30.3% | 30.3% | 23858 | 20.1s |
| Raster vertices plus GT adjacency, tight | `clean-1024-s15` | 15 | 2240 | 30.8% | 30.8% | 2488 | 20.1s |
| Raster vertices plus GT adjacency, 360 carriers | `clean-1024-s15` | 15 | 2240 | 61.1% | 61.1% | 2607 | 20.7s |
| Raster vertices plus GT adjacency, 360 carriers, `1px` merge | `clean-1024-s15` | 15 | 2240 | 66.0% | 66.0% | 2623 | 22.1s |
| GT edges with raster support | `smoke-1024-s1` | 4 | 212 | 100.0% | 100.0% | 316 | 0.9s |
| GT vertices plus raster-supported pairs | `smoke-1024-s1` | 4 | 212 | 100.0% | 100.0% | 1442 | 0.8s |
| Direct Hough segments from raster | `smoke-1024-s1` | 4 | 212 | 49.1% | 49.1% | 6166 | 3.5s |
| Raster vertices plus GT adjacency, tight | `smoke-1024-s1` | 4 | 212 | 65.1% | 65.1% | 310 | 3.5s |

Merge-radius sweep for `raster-vertices-gt-adjacency` on
`clean-1024-s15`, with `360` carriers and span emission disabled:

| Vertex merge radius | Proposed vertices | Selected recall | Time |
| ---: | ---: | ---: | ---: |
| `1px` | 141046 | 66.0% | 22.1s |
| `2px` | 99834 | 64.2% | 21.5s |
| `4px` | 60139 | 61.1% | 20.7s |
| `8px` | 29096 | 51.5% | 22.0s |
| `12px` | 16418 | 44.0% | 21.6s |

Takeaways:

- Raster line evidence is not the limiting factor on these packs: GT-edge and
  GT-vertex support both recover all topology edges.
- Direct Hough segment vectorization is much weaker than the dense baseline.
- Raster-proposed vertices are the limiting factor. Even with GT adjacency,
  the clean pack misses roughly one third of topology edges.
- The best deterministic vertex recall requires an impractically large vertex
  set and still falls nearly `30` points below dense selected recall.
- More carrier threshold tuning is unlikely to close the gap. The next
  competitive path needs a better vertex/edge proposal source, most likely a
  sparse non-dense model.

## Skeleton Topology Probe

As a second deterministic path, I ran the detector repo's older skeleton
topology extractor directly on the real rectified PNGs. The input was a
thresholded raster line mask; no model dense heads were used.

| Probe | Pack | Vertex P/R | Edge P/R | Pred vertices | Pred edges | Time |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| skeleton-default | `smoke-1024-s1` | 19.5% / 56.4% | 15.5% / 22.8% | 544 | 464 | 1.7s |
| skeleton-merge6 | `smoke-1024-s1` | 20.2% / 55.9% | 18.4% / 25.6% | 521 | 440 | 1.7s |
| hybrid direct/skeleton | `smoke-1024-s1` | 20.0% / 55.9% | 20.3% / 9.2% | 526 | 143 | 1.0s |
| skeleton-default | `clean-1024-s15` | 57.7% / 71.1% | 39.6% / 41.7% | 1680 | 2788 | 8.5s |
| skeleton-merge6 | `clean-1024-s15` | 69.1% / 72.2% | 51.0% / 49.6% | 1423 | 2574 | 9.3s |
| hybrid direct/skeleton | `clean-1024-s15` | 64.4% / 73.1% | 29.1% / 10.6% | 1546 | 965 | 7.0s |

The clean `skeleton-merge6` result is better than tight-budget
`raster-carrier-v1` selected recall, but still misses about half the topology
and performs poorly on the smoke profile mix. It does not change the default
decision.

## Sparse Model Audit

Existing learned assets are not directly reusable as strict dense-free runtime
strategies:

- `r1_close_pair_warmstart` and `r3_close_pair_scratch` are CPLineNet
  checkpoints. Their close-pair eval decodes dense `junction_logits` and
  `junction_offset`.
- The close-pair report shows useful but limited learned vertex improvement:
  pair resolution improved from `5.4%` to `26.5%`, while strict eF1 improved
  from `0.942` to `0.953`. It did not pass the original close-pair gate.
- The older graph-head training path freezes a pixel model, extracts candidate
  graphs from dense segmentation/junction heatmaps, and samples dense
  segmentation/backbone features along nodes/edges. That violates the strict
  "no dense outputs" experiment boundary.

This leaves no existing trained sparse checkpoint that can be honestly plugged
into the dense-free benchmark. A competitive next attempt needs new training:
for example `rectified image -> sparse vertices + sparse edge probabilities`
with a JSON/export contract that feeds the existing `CandidateGraph` compiler.

## Comparison

| Path | Pack | Topology recall | Assignment match | Time | Candidate/conflict profile |
| --- | --- | ---: | ---: | ---: | --- |
| dense `junction-first-v1` | clean-1024-s15 | 95.8% | 91.6% | 6.3s | 2651 candidates, 113 conflicts |
| raster carrier tight | clean-1024-s15 | 21.8% | 0.4% | 80.3s | 16986 candidates, 15559 conflicts |
| raster carrier tight | smoke-1024-s1 | 42.9% | 0.0% | 26.5s | 5363 candidates, 5007 conflicts |
| raster vertices plus GT adjacency, best ablation | clean-1024-s15 | 66.0% | not meaningful | 22.1s | oracle adjacency over 141046 raster vertices |
| skeleton topology, best clean probe | clean-1024-s15 | 49.6% | not measured | 9.3s | 1423 vertices, 2574 edges |

This is a decisive gap. The raster path produces many more alternatives, many
more conflicts, lower recall, and almost no assignment correctness. Even the
tight budget is more than 12x slower than the dense clean baseline while
recovering less than a quarter of clean topology.

## Conclusion

No current strict dense-free strategy should become the default recognition
path.

The strict dense-free experiment still taught us something valuable: real CP
images do contain enough raster signal for a subset of clean/line-style edges,
but carrier-first extraction is the wrong default shape. The bottleneck is not
the binary line mask; it is sparse vertex/endpoint proposal. The ablation
ladder strengthens that conclusion because GT vertices recover all topology
edges while raster vertices miss too many even when GT adjacency is supplied.
The independent skeleton probe points to the same conclusion from a different
deterministic extractor.

Blocker reached: the current branch has no competitive dense-free default
candidate. The next viable attempt is outside pure deterministic tuning and
requires a true sparse non-dense predictor:

- keep `RasterEvidence`;
- generate sparse vertices, close-pair probabilities, or direct edge
  probabilities without reading dense heads;
- feed those sparse candidates into the existing compiler/selection metrics;
- include assignment as a separate strict track after topology is competitive;
- benchmark on `clean-1024-s15`, `smoke-1024-s1`, and a dashed/watermark tier
  from the start.

Until that sparse model exists, the dense `junction-first-v1` path remains the
only candidate with default-level evidence.

The repo-local fixture pack remains useful for unit-test-like smoke coverage,
but it is not sufficient evidence for product decisions.
