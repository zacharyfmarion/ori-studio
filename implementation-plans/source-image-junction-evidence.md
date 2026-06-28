# Source Image Junction Evidence

## Goal

Add a benchmarkable ablation that detects interior junctions from image-derived
line geometry instead of the dense junction head.

## Approach

- Add an evidence-extraction switch for model junctions versus line-arrangement
  junctions.
- Generate line-arrangement junctions from intersections of detected line
  primitives, gated by local line support and clustered by the existing vertex
  merge scale.
- Expose the switch in exact-solve and candidate-coverage benchmarks.
- Start evaluation on clean-1024-s15 with source-image line evidence.

## Affected Areas

- `crates/oristudio-cp-detect/src/evidence_extract.rs`
- `crates/oristudio-cp-detect/src/candidate_generation/`
- `crates/oristudio-cp-detect/src/bin/compare_exact_solve_benchmark.rs`
- `crates/oristudio-cp-detect/src/bin/compare_candidate_coverage.rs`

## Checklist

- [x] Add line-arrangement junction extraction.
- [x] Thread the junction source option through candidate generation.
- [x] Expose benchmark CLI flags and report config.
- [x] Run focused Rust checks.
- [x] Run clean-15 source-image line plus line-arrangement junction benchmark.
