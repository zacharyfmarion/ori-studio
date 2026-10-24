# Full-corpus camera spread preparation benchmark

## Goal

Save a reproducible baseline for cold Default spread preparation across every
cpoogle truth.fold without committing corpus files or derived geometry.

## Approach

Measure folding/scene extraction separately from lift construction/solve,
visibility paint plans and layer relations. Use fresh processes and sequential
jobs, explicit per-stage deadlines, raw repetitions, input/output hashes and
machine/code/WASM provenance. Keep resumable reports and private scenes under
ignored artifacts. Add a browser worker run for actual render initialization
and first bitmap, separate from the CPU run. Save a numerical baseline and
reproduction instructions for later optimization comparisons.

## Affected Areas

- scripts/camera-spread/: benchmark harness, report and instructions.
- artifacts/camera-spread/: ignored full-corpus baseline, scenes and raw trials.
- implementation-plans/: methodology and result summary; no product changes.

## Checklist

- [x] Implement resumable isolated CPU benchmark and report generation.
- [x] Validate stage accounting, hashes, failure/timeout and resume handling.
- [x] Attempt all 484 corpus models and save every outcome.
- [x] Measure actual browser render-worker cold preparation separately.
- [x] Save results, reproducibility metadata and optimization priorities.
- [x] Verify no corpus/geometry is staged; update existing draft PR.


## Results

All 484 corpus entries folded successfully and completed three cold CPU and
three cold browser-worker trials: 2,904 successful preparation measurements.
CPU per-model median distribution: p50 92 ms, p95 948 ms, p99 3.40 s, max 10.70 s.
Browser production-session load: p50 117 ms, p95 1.06 s, p99 3.60 s, max 11.00 s.
All repeated CPU geometry hashes match. The slowest case is the anatomically
precise cockroach; contact construction and solving dominate, not face count
alone. Folding was measured separately, reaching 21.07 s on Eastern Dragon.

Saved numerical baseline and analysis:
`research/benchmarks/camera-spread/2026-10-24-cpoogle.json` and
`research/2026-10-24-camera-spread-preparation.md`.
Raw scenes, bundles and the sortable report remain ignored under
`artifacts/camera-spread/benchmarks/2026-10-24-cpoogle/`.

Validation: full real-file runs; three harness/report/privacy tests; explicit
1-ms timeout; successful resume with 484 unique records; export validation of
all trials and absence of source paths/coordinate arrays. No production changes,
so full product suites, Rust/WASM rebuilds and native/oracle checks are skipped.
