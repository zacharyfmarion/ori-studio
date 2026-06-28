# Source Image Line Evidence

## Goal

Add an explicit CP-detect ablation that replaces dense model line evidence with
line evidence computed directly from the rectified source image.

## Approach

- Build a source-image line probability map from rectified RGBA/input PNG.
- Thread an optional line-probability override through `DenseOutputs` and
  evidence extraction.
- Use the override for `junction-first-v1` candidate generation and inspector
  stage bundles.
- Make source-image line evidence the default in the browser/product decode
  path while keeping dense-model line evidence available as an explicit
  ablation.
- Add benchmark flags so dense-cache runs can compare model-line and
  source-image-line evidence.
- Calibrate source-image probabilities so faint gray creases clear the
  selection score gate without widening support enough to introduce false
  spans.

## Affected Areas

- `crates/oristudio-cp-detect`
- `crates/oristudio-cp-detect-wasm`
- `crates/oristudio-cp-detect-inspector`
- `apps/cp-detect-architecture-inspector`
- `crates/oristudio-cp-detect/src/bin/compare_exact_solve_benchmark.rs`
- `crates/oristudio-cp-detect/src/bin/compare_candidate_coverage.rs`

## Checklist

- [x] Add source image line-probability extraction.
- [x] Add optional line evidence override to Rust dense-output plumbing.
- [x] Pass rectified upload RGBA into the inspector stage builder.
- [x] Add benchmark flag and input PNG loading.
- [x] Run focused Rust checks/tests.
- [x] Add source-image line evidence to candidate coverage diagnostics.
- [x] Iterate source-image calibration against clean-15 metrics.
- [x] Make product/browser decode use source-image line evidence by default.
- [x] Make cached architecture-inspector examples use source-image line
      evidence by default.
- [x] Document the default and benchmark escape hatch.
