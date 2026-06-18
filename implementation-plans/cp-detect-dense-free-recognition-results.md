# CP Detect Dense-Free Recognition Results

Status: Phase 4 report, June 18, 2026.

## Summary

The strict dense-free path is implemented far enough to benchmark:

- `RasterEvidence` extracts deterministic luma, line probability, binary line
  mask, and extraction diagnostics from rectified pixels.
- `raster-carrier-v1` emits a compiler `CandidateGraph` without reading model
  dense heads.
- `compare_raster_candidate_coverage` benchmarks correctness-pack PNG inputs
  against GT graph JSON.
- `scripts/cp-detect/build-raster-fold-fixture-pack.py` builds a reproducible
  repo-local raster pack from committed FOLD fixtures when the external
  correctness pack is unavailable.

The result is useful but not default-ready. On simpler repo fixtures,
`raster-carrier-v1` recovers meaningful topology candidates, but selected recall
is still low, assignments are unresolved, exact solve fails on noisy selected
graphs, and dense diagrams need aggressive candidate budgets to finish.

## Environment Limits

The intended same-run comparison against the standard `clean-1024-s15` pack and
the current dense `junction-first-v1` default was blocked in this worktree:

```bash
node scripts/cp-detect/check-local-model-assets.mjs
```

failed because `apps/web/public/models/cp-detector-v3/manifest.json` is
missing. `artifacts/cp-detect-correctness/dense-cache` is also absent. The
benchmarks below therefore use a deterministic repo-local fallback pack and
should be treated as dense-free signal, not a replacement for the missing
standard dense baseline.

Historical in-repo context still matters: the current dense default documents
`junction-first-v1` at strict topology edge F1 `0.942` on `clean-1024-s15`,
versus `0.902` for the legacy threshold path. The older dense candidate coverage
report in `implementation-plans/cp-detect-junction-carrier-strategy.md` recorded
candidate oracle recall around `0.91` for legacy dense strategies. Those are not
same-run numbers, but they frame the gap.

## Benchmark Pack

Generated packs:

```bash
python3 scripts/cp-detect/build-raster-fold-fixture-pack.py \
  --out artifacts/cp-detect-correctness/packs/raster-fold-fixtures-1024

python3 scripts/cp-detect/build-raster-fold-fixture-pack.py \
  --out artifacts/cp-detect-correctness/packs/raster-fold-fixtures-1024-no-clean-smoke \
  --fixtures \
  crates/oristudio-cp/resources/default-molecules/blintz.fold \
  crates/oristudio-cp/resources/default-molecules/bird_base.fold \
  crates/oristudio-cp/resources/default-molecules/fish_base.fold \
  crates/oristudio-cp/resources/default-molecules/frog_base.fold \
  crates/oristudio-cp/resources/default-molecules/dove_base.fold \
  tests/fixtures/folding-sequence/fold/simple-valley.fold \
  tests/fixtures/folding-sequence/fold/kite-rabbit-ear-local.fold \
  tests/fixtures/folding-sequence/fold/squash-local.fold \
  tests/fixtures/folding-sequence/fold/accordion-book-fold.fold \
  tests/fixtures/folding-sequence/fold/simultaneous-collapse-unsupported.fold \
  tests/fixtures/folding-sequence/fold/treemaker-triad-base.fold

python3 scripts/cp-detect/build-raster-fold-fixture-pack.py \
  --out artifacts/cp-detect-correctness/packs/raster-fold-fixtures-1024-clean-smoke-only \
  --fixtures crates/oristudio-cp-detect/tests/fixtures/cp-detect-oracle/clean-smoke.fold
```

The fallback renderer uses 1024 px images, a 32 px inset, and 3 px colored
creases. It writes `input.png`, `gt.graph.json`, and normalized `gt.fold` per
sample.

## Candidate-Only Results

Command:

```bash
cargo run -p oristudio-cp-detect --release \
  --bin compare_raster_candidate_coverage -- \
  --pack artifacts/cp-detect-correctness/packs/raster-fold-fixtures-1024-no-clean-smoke/manifest.json \
  --out artifacts/cp-detect-correctness/reports/raster-fold-fixtures-1024-no-clean-smoke-raster-carrier-v1-2026-06-18 \
  --skip-exact-solve
```

Result:

| Pack | Samples | GT edges | Candidate oracle recall | Selected recall | Assignment matches | Total time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| repo FOLD fixtures, excluding `clean-smoke` | 11 | 82 | 78.0% | 59.8% | 0.0% | 33.3s |

Per-sample selected topology recall:

| Sample | Candidate | Selected | Candidates | Conflicts | Total time |
| --- | ---: | ---: | ---: | ---: | ---: |
| `blintz` | 4/4 | 3/4 | 318 | 350 | 0.29s |
| `bird_base` | 8/12 | 5/12 | 996 | 1142 | 2.84s |
| `fish_base` | 6/6 | 3/6 | 803 | 925 | 1.42s |
| `frog_base` | 17/24 | 14/24 | 2072 | 2295 | 18.38s |
| `dove_base` | 3/7 | 2/7 | 1376 | 1534 | 5.86s |
| `simple-valley` | 1/1 | 1/1 | 483 | 317 | 0.39s |
| `kite-rabbit-ear-local` | 4/4 | 4/4 | 567 | 319 | 0.54s |
| `squash-local` | 6/8 | 6/8 | 505 | 429 | 0.68s |
| `accordion-book-fold` | 2/2 | 2/2 | 484 | 240 | 0.41s |
| `simultaneous-collapse-unsupported` | 8/8 | 5/8 | 554 | 456 | 0.71s |
| `treemaker-triad-base` | 5/6 | 4/6 | 792 | 918 | 1.57s |

Root causes:

| Root cause | Count |
| --- | ---: |
| Candidate selected, assignment unresolved | 49 |
| Candidate chain available but not selected | 11 |
| Edge missing despite endpoint and carrier | 9 |
| Carrier missing | 9 |
| Overlong candidate available but not selected | 4 |

The raster line mask supported 100% of evaluated GT edges, so the first-order
failure is not thresholding. The bottlenecks are carrier/vertex proposal,
candidate conflict density, selection, and assignment.

## Dense Diagram Stress

The full 12-sample pack with default `raster-carrier-v1` options was interrupted
after more than 3.5 minutes. It completed the first 11 samples and then stalled
on `clean-smoke`, which has 101 GT edges before boundary filtering.

Budgeted `clean-smoke` runs:

```bash
cargo run -p oristudio-cp-detect --release \
  --bin compare_raster_candidate_coverage -- \
  --pack artifacts/cp-detect-correctness/packs/raster-fold-fixtures-1024-clean-smoke-only/manifest.json \
  --out artifacts/cp-detect-correctness/reports/raster-fold-fixtures-1024-clean-smoke-raster-carrier-v1-budgeted-2026-06-18 \
  --skip-exact-solve \
  --max-carriers 120 \
  --max-total-spans 3500

cargo run -p oristudio-cp-detect --release \
  --bin compare_raster_candidate_coverage -- \
  --pack artifacts/cp-detect-correctness/packs/raster-fold-fixtures-1024-clean-smoke-only/manifest.json \
  --out artifacts/cp-detect-correctness/reports/raster-fold-fixtures-1024-clean-smoke-raster-carrier-v1-tight-2026-06-18 \
  --skip-exact-solve \
  --max-carriers 60 \
  --max-total-spans 1500
```

| Budget | GT edges | Candidate oracle recall | Selected recall | Candidates | Conflicts | Total time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 120 carriers, 3500 spans | 85 | 43.5% | 32.9% | 3500 | 3956 | 61.5s |
| 60 carriers, 1500 spans | 85 | 37.6% | 35.3% | 1500 | 1666 | 10.1s |

The tighter budget selected slightly more GT topology while running much faster.
That is an important signal: adding more raster candidates can hurt the selector
because the alternative/conflict graph gets too dense.

## Exact Solve

Command:

```bash
cargo run -p oristudio-cp-detect --release \
  --bin compare_raster_candidate_coverage -- \
  --pack artifacts/cp-detect-correctness/packs/raster-fold-fixtures-1024-no-clean-smoke/manifest.json \
  --out artifacts/cp-detect-correctness/reports/raster-fold-fixtures-1024-no-clean-smoke-raster-carrier-v1-exact-2026-06-18 \
  --exact-patience 8
```

This was interrupted after the first three samples because all three exact
solves failed and exact solve time was already 53.6s:

| Sample | Selected topology | Exact status | Exact time | Selected spans |
| --- | ---: | --- | ---: | ---: |
| `blintz` | 3/4 | failed | 2.06s | 214 |
| `bird_base` | 5/12 | failed | 31.34s | 526 |
| `fish_base` | 3/6 | failed | 20.21s | 502 |

This selected graph is not yet a reliable downstream seed for the compiler.

## Implementation Findings

The first smoke run exposed a graph emission problem: endpoints and carriers
were available, but candidate oracle recall was 0%. Adding compact supported-run
spans fixed that failure mode without using dense outputs:

| Smoke variant | Candidate oracle recall | Selected recall | Total time |
| --- | ---: | ---: | ---: |
| adjacent-only spans | 0.0% | 0.0% | 2.9s |
| supported-run spans | 75.0% | 50.0% | 3.1s |

PNG decode support also had to be enabled explicitly for the native benchmark
runner because the workspace uses `image` with default features disabled.

## Conclusion

`raster-carrier-v1` should not become the default recognition path.

It does prove that a strict dense-free path can recover useful topology from
rectified pixels, especially when the CP is sparse and clean. But it is not yet
competitive with the documented dense default:

- no assignment solution yet;
- selected recall is far below the dense path's documented topology quality;
- dense diagrams require hard candidate budgets;
- exact solve fails on the selected raster graphs;
- runtime is selector-bound once conflicts exceed roughly a thousand spans.

The next experiment is warranted, but it should not be "more carriers." The
data points toward a bounded `raster-junction-pair-v1` or a sparse non-dense
model that proposes fewer, better edge hypotheses. The highest-value follow-up
is to keep the deterministic raster evidence and vertex diagnostics, then add a
pair scorer that can reject overlapping alternatives before they reach the beam
selector.
