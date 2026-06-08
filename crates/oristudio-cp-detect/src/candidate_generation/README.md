# Candidate Generation Strategies

This module owns the step from dense detector outputs to a coherent compiler
`CandidateGraph`.

```text
dense heads -> candidate generation strategy -> CandidateGraph -> selection -> exact solve
```

The compiler crate intentionally does not know how to decode dense heads, run
legacy image logic, or build candidate hypotheses from pixels. It consumes the
`CandidateGraph` IR.

## Current Strategy

`legacy-threshold` is the production default. It runs the legacy decoder at the
primary threshold, optionally runs a low-threshold decode for weak recall, and
uses `LegacyCandidateAdapter` to produce a deduped candidate graph.

`legacy-topology-v2` is an experimental strategy that starts from
`legacy-threshold`, then adds structural pass-through candidates that replace
strong collinear fragment chains. The fragment spans remain as provenance and
alternatives, but the selector can choose one clean structural span instead of a
run of degree-2 micro-spans.

Initial `clean-1024-s15` benchmark signal was intentionally modest: it improved
candidate oracle recall from `0.9089` to `0.9094`, kept selected recall flat at
`0.9054`, improved assignment-correct selected edges by one edge, and reduced
selected chain matches from `62` to `60`. A stronger variant that made the
structural spans the default selected many more normalized spans but regressed
GT correctness, so the kept strategy leaves structural spans as weak
alternatives.

## Adding A Strategy

1. Add a strategy implementation in this module, for example
   `junction_pair.rs`.
2. Add a `CandidateGenerationStrategyName` enum variant and parser id.
3. Register the strategy in `generate_candidate_graph`.
4. Make the strategy emit one coherent `CandidateGraph` with:
   - normalized candidate vertices;
   - crease candidates/spans;
   - assignment evidence;
   - support and cost priors;
   - provenance labels;
   - dedupe and conflict semantics for alternatives.
5. Add strategy unit tests before wiring it into the inspector.
6. Run the candidate coverage benchmark with `--strategy <id>` and compare
   against `legacy-threshold`.

## Guardrail

Do not create candidate-source soup. If a future strategy combines legacy,
junction-pair, and ML-scored candidates, that combination must be implemented as
one explicit hybrid strategy that canonicalizes geometry and marks conflicts
before selection sees the graph.
