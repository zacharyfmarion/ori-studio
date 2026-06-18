# CP Detect Dense-Free Recognition Results

Status: Phase 4 report, corrected June 18, 2026.

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

## Comparison

| Path | Pack | Selected recall | Assignment match | Time | Candidate/conflict profile |
| --- | --- | ---: | ---: | ---: | --- |
| dense `junction-first-v1` | clean-1024-s15 | 95.8% | 91.6% | 6.3s | 2651 candidates, 113 conflicts |
| raster carrier tight | clean-1024-s15 | 21.8% | 0.4% | 80.3s | 16986 candidates, 15559 conflicts |
| raster carrier tight | smoke-1024-s1 | 42.9% | 0.0% | 26.5s | 5363 candidates, 5007 conflicts |

This is a decisive gap. The raster path produces many more alternatives, many
more conflicts, lower recall, and almost no assignment correctness. Even the
tight budget is more than 12x slower than the dense clean baseline while
recovering less than a quarter of clean topology.

## Conclusion

`raster-carrier-v1` should not become the default recognition path.

The strict dense-free experiment still taught us something valuable: real CP
images do contain enough raster signal for a subset of clean/line-style edges,
but carrier-first extraction is the wrong default shape. The bottleneck is not
the binary line mask; it is sparse vertex/endpoint proposal and conflict-heavy
candidate generation.

The next dense-free experiment should be bounded and pair-oriented:

- keep `RasterEvidence`;
- add `raster-junction-pair-v1` or a sparse non-dense pair scorer;
- generate far fewer candidates before beam selection;
- include assignment as a separate strict track;
- benchmark on `clean-1024-s15`, `smoke-1024-s1`, and a dashed/watermark tier
  from the start.

The repo-local fixture pack remains useful for unit-test-like smoke coverage,
but it is not sufficient evidence for product decisions.
