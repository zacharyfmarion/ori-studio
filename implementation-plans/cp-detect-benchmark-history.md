# CP Detect Benchmark History

This file records small, committed benchmark summaries so future runs do not
need to rerun older checkpoints just to recover headline numbers.

## 2026-06-04 - Exact Solve Comparison

Report directory:

```text
artifacts/cp-detect-correctness/reports/exact-solve-comparison-2026-06-04
```

Command:

```bash
cargo run -p oristudio-cp-detect --bin compare_exact_solve_benchmark -- \
  --dense-manifest artifacts/cp-detect-correctness/dense-cache/smoke-1024-s3-browser-onnx/manifest.json \
  --candidate-source legacy \
  --threshold 0.65 \
  --legacy-low-threshold 0.35 \
  --out artifacts/cp-detect-correctness/reports/exact-solve-comparison-2026-06-04
```

Dense cache:

```text
artifacts/cp-detect-correctness/dense-cache/smoke-1024-s3-browser-onnx/manifest.json
```

Samples: 12 smoke-pack samples at 1024px.

Runtime: 848.439 seconds.

| Implementation | Edge F1 | Border F1 | Assignment Acc | CAMV | Flat-folder solved | Degree-2 | Odd | Max Kawasaki |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| legacy adapted | 0.8651 | 0.9588 | 0.9966 | 459 | 0/12 | 61 | 103 | 156.1668 |
| Stage 5 selected | 0.8650 | 0.9588 | 0.9974 | 459 | 0/12 | 59 | 106 | 156.1668 |
| Stage 6 exact solved | 0.8444 | 0.9588 | 0.9983 | 459 | 0/12 | 59 | 106 | 0.0330 |

Regressions captured in `regressions.jsonl`:

- `rabbit_ear_fold_program_v1-5wk0b-000109__line-style__000`: exact solve
  edge F1 0.7824 -> 0.6580.
- `treemaker_tree_v1-5gjmj-004937__line-style__001`: exact solve edge F1
  0.7304 -> 0.5913.
- `rabbit_ear_fold_program_v1-5wk0b-000109__v2-watermark__000`: Stage 5
  selected edge F1 0.8783 -> 0.8756 versus legacy adapted baseline.

Conclusion:

- Stage 5 is not yet materially improving topology over the legacy adapter on
  this smoke pack.
- Stage 6 exact solve strongly reduces Kawasaki residual, but still solves zero
  samples globally and can regress GT edge matching.
- Keep Stage 6 diagnostic-only until exact solve preserves edge matching and
  topology/assignment stages reduce CAMV and flat-folder failures.
