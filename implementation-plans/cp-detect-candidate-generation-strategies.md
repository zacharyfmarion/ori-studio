# CP Detect Candidate Generation Strategies

## Goal

Create a clean foundation for iterating on crease-pattern candidate generation
approaches. The end state should make it easy to compare the current legacy
approach, a future junction-pair approach, and future ML-assisted approaches
without mixing incompatible candidate sources into an incoherent graph.

The core principle is:

```text
candidate generation strategy -> coherent CandidateGraph -> selection -> exact solve
```

A strategy is a complete approach for producing one internally consistent
candidate hypothesis space. Strategies may use multiple internal signals, but
they must canonicalize, dedupe, and encode conflicts before producing a
`CandidateGraph`. The beam selector should not receive an undifferentiated pile
of edges from unrelated sources.

## Current Problem

The current candidate generation path is hard to reason about:

- The legacy detector decodes dense model heads into a FOLD-like graph.
- A legacy adapter turns that graph into the compiler's `CandidateGraph`.
- There is also compiler-owned candidate generation code from earlier
  experiments, but it has performed poorly and creates confusion about which
  path is authoritative.
- Benchmarking and the architecture inspector do not yet make candidate
  generation strategy selection a first-class concept.

The latest candidate-coverage benchmark shows candidate generation is the main
topology bottleneck: dense evidence often supports a true GT edge, but the
adapter candidate graph does not contain the needed carrier/span. Beam selection
is only slightly worse than the candidate oracle, so the next iteration should
make candidate generation modular and benchmarkable before adding another
generator.

## Target Architecture

Keep crate ownership explicit:

```text
oristudio-cp-detect
  dense heads / decoded evidence
  candidate_generation/
    strategy.rs
    legacy_threshold.rs
    future junction_pair.rs
    future hybrid_explicit.rs

oristudio-cp-compiler
  CandidateGraph IR
  selection
  exact solve
  report/export

oristudio-cp-eval
  candidate coverage metrics
  selected graph metrics
  exact solve metrics
```

`oristudio-cp-compiler` should not know how to read dense heads, run legacy
decode, interpret image pixels, or perform Hough-style image detection. It
should consume a `CandidateGraph` and produce selected/exact output.

`oristudio-cp-detect` should own candidate generation strategies because they
consume model heads and image-space evidence.

## Strategy Contract

Introduce a detection-side strategy boundary shaped roughly like:

```rust
pub trait CandidateGenerationStrategy {
    fn name(&self) -> &'static str;
    fn generate(&self, ctx: &CandidateGenerationContext) -> Result<CandidateGraph>;
}
```

`CandidateGenerationContext` should hold the inputs shared by strategies:

- image size
- dense model heads
- selected thresholds/options
- optional debug/sample metadata

Each strategy must return a coherent `CandidateGraph`:

- candidate vertices in normalized compiler coordinates
- candidate spans/carriers
- assignment evidence
- source/provenance labels
- support/cost priors
- dedupe/equivalence information where applicable
- conflict groups where candidates are alternatives

Important guardrail: do not merge unrelated strategy outputs by default. If a
hybrid strategy is added later, it should be an explicit strategy with clear
canonicalization and conflict semantics.

## Phase 1: Cordon Off Compiler Candidate Generation

Status: Complete.

### Work

- Audit compiler-owned candidate generation entrypoints and usages.
- Remove dead compiler candidate generation code if nothing depends on it.
- If immediate removal would be risky, move it behind an explicitly deprecated
  module/test-only path with names that make it impossible to confuse with the
  production strategy path.
- Ensure production detection flows no longer expose or route through the old
  compiler candidate generation path.

### Result

The Stage 5/5b/6 inspector backend no longer accepts `candidate_source =
"arrangement"` and the frontend no longer offers Arrangement V2 as a candidate
source. Low-level arrangement/exact-probe internals remain available for earlier
diagnostic stages and tests, but they are not exposed as a production candidate
generation path.

### Done Means

- No default code path uses compiler-owned candidate generation.
- The compiler crate still owns `CandidateGraph`, selection, exact solve, and
  export/report logic.
- Any remaining experimental code is clearly marked deprecated and not exposed
  in the inspector or benchmark strategy selectors.
- Tests/builds pass for affected crates.

## Phase 2: Add Candidate Generation Strategy Boundary

Status: Complete.

### Work

- Add `crates/oristudio-cp-detect/src/candidate_generation/`.
- Define `CandidateGenerationStrategy`, `CandidateGenerationContext`, strategy
  names, and shared strategy options.
- Move/wrap the current legacy high/low-threshold adapter flow into
  `LegacyThresholdStrategy`.
- Preserve current behavior as the default strategy.
- Keep the existing `CandidateGraph` type in `oristudio-cp-compiler`; do not
  duplicate IR types in detect.

### Result

`oristudio-cp-detect` now exposes a `candidate_generation` module with a
strategy name, context, options, trait, and `legacy-threshold` implementation.
The product legacy-candidate exact-solve backend and the inspector Stage 5 path
both call this shared strategy implementation instead of rebuilding the legacy
adapter locally.

### Done Means

- The current legacy path can be invoked through a named strategy.
- A new strategy can be added by implementing the trait and registering its
  name, without changing selection or exact solve.
- Existing detection flows produce the same selected graph for the legacy
  strategy as before the refactor, modulo intentional cleanup.
- Unit tests cover strategy dispatch and legacy strategy parity on at least one
  small fixture.

## Phase 3: Strategy-Aware Benchmarking

### Work

- Update candidate coverage benchmarks to accept a candidate generation strategy
  name.
- Record the selected strategy and strategy options in benchmark artifacts.
- Keep output files stable:
  - `summary.json`
  - `per_sample.jsonl`
  - `per_gt_edge.jsonl`
  - `README.md`
- Ensure candidate coverage metrics compare:
  - dense evidence
  - strategy candidate oracle
  - selected graph
  - root-cause buckets
  - runtime per sample

### Done Means

- We can run at least:

  ```bash
  target/release/compare_candidate_coverage \
    --strategy legacy-threshold \
    --manifest artifacts/cp-detect-correctness/dense-cache/clean-1024-s15-browser-onnx/manifest.json \
    --out artifacts/cp-detect-correctness/reports/<name>
  ```

- The benchmark report records the strategy name and options.
- Historical reports are self-contained enough to compare future runs without
  rerunning old baselines.
- The default strategy is `legacy-threshold`.

## Phase 4: Strategy-Aware Architecture Inspector

### Work

- Update `apps/cp-detect-architecture-inspector` so candidate generation
  strategy is a first-class selector.
- Remove inspector options for the old compiler candidate generation path.
- Default to `legacy-threshold`.
- Ensure stages that depend on candidate generation request the selected
  strategy from the Rust backend.
- Make the UI labels clear: the selected graph is the output of selection over
  the selected strategy's candidate graph, not a blend of all known candidate
  sources.

### Done Means

- The inspector can switch candidate generation strategy without changing the
  rest of the pipeline controls.
- The compiler-owned candidate generation path is no longer visible.
- Stage 5/5b/6 style views show the graph produced from the selected strategy.
- The backend API response records the selected strategy so screenshots and
  reports remain interpretable.

## Phase 5: Prepare For New Strategies

### Work

- Add a placeholder registration point for future strategies, but do not
  implement junction-pair generation in this cleanup phase.
- Document how to add a new strategy:
  - where the module lives
  - how it receives dense heads
  - how it emits a coherent `CandidateGraph`
  - what metrics must be run before enabling it in UI defaults
- Add a short note warning against candidate-source soup: hybrids must be
  explicit strategies with dedupe/conflict semantics.

### Done Means

- A future `JunctionPairStrategy` can be added without modifying compiler
  selection/exact solve code.
- A future ML-assisted strategy can be added as another strategy or as an
  internal scorer inside an explicit strategy.
- Docs tell future engineers where candidate generation belongs and where it
  does not belong.

## Non-Goals

- Do not implement the junction-pair generator in this refactor unless it is
  explicitly requested as a follow-up.
- Do not tune beam search weights as part of this cleanup.
- Do not change exact solve behavior.
- Do not merge multiple candidate generation strategies into one pool without
  explicit conflict/equivalence modeling.

## Validation Checklist

- [x] Compiler candidate generation code removed or explicitly deprecated and
      unreachable from production flows.
- [x] `legacy-threshold` strategy implemented in `oristudio-cp-detect`.
- [x] Default product and inspector behavior still uses legacy-threshold.
- [ ] Candidate coverage benchmark accepts `--strategy`.
- [ ] Benchmark artifacts record strategy name and options.
- [ ] Architecture inspector exposes strategy selection and removes compiler
      candidate generation options.
- [x] Rust unit tests cover strategy dispatch and legacy option conversion.
- [ ] Release benchmark runs successfully on `clean-1024-s15`.
- [ ] Documentation explains how to add and benchmark a new strategy.
