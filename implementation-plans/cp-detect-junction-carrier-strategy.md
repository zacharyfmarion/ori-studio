# CP Detect Junction/Carrier Candidate Strategy

## Goal

Build a non-ML candidate generation strategy that starts from detector evidence
primitives instead of a decoded legacy FOLD graph. The strategy should maximize
the chance that beam selection receives clean topology choices:

```text
dense heads -> vertices + carriers -> vertex-pair edge candidates -> CandidateGraph -> selection
```

The immediate benchmark target is not perfection. It is to learn whether a
junction/carrier-first strategy can beat or complement `legacy-threshold` on
clean synthetic CPs without hallucinating topology.

## Strategy: `junction-carrier-v1`

### Inputs

- Line probability and non-crease probability.
- Junction probability and optional junction offsets.
- Boundary contact probability and optional boundary metadata.
- Assignment and line-style probabilities.

### Algorithm

1. Extract compiler-native evidence primitives with the existing dense evidence
   extractor.
2. Create candidate vertices:
   - four locked square corners;
   - boundary contacts from boundary-contact peaks, snapped to the appropriate
     unit-square side;
   - interior junctions from junction peaks, with offset refinement handled by
     the evidence extractor when available.
3. Cluster/merge nearby vertices by a small pixel radius so a single visual
   junction does not become several graph vertices.
4. Build long carrier hypotheses from Hough line primitives:
   - canonicalize by angle/rho;
   - group nearby collinear primitives;
   - keep carriers with enough aggregate support and length.
5. For each carrier, find vertices close to that carrier and sort them along
   the carrier.
6. Generate candidate crease spans between vertex pairs on that carrier:
   - adjacent pairs are the primary candidates;
   - longer skip pairs are allowed only when the line support is strong through
     the whole interval;
   - spans receive dense line support, non-crease support, assignment evidence,
     and source-carrier provenance;
   - overlapping alternatives on the same carrier receive hard conflicts.
7. Add deterministic locked square-border spans between corners and boundary
   contacts.
8. Emit a complete `CandidateGraph` with explicit provenance and benchmarkable
   diagnostics.

## Guardrails

- Do not use the legacy decoded graph as topology input.
- Do not merge multiple strategies into a single candidate pool unless the
  hybrid strategy explicitly owns dedupe/conflict semantics.
- Do not force topology-clean candidates when benchmark correctness regresses.
- Keep generated candidates inspectable in Stage 5/5b/6.
- Benchmark before claiming improvement.

## Done Means

- [x] `junction-carrier-v1` is registered as a `CandidateGenerationStrategyName`.
- [x] The architecture inspector can select it.
- [x] `compare_candidate_coverage --strategy junction-carrier-v1` runs on
  `clean-1024-s15`.
- [x] Benchmark artifacts include the strategy name, options, timing, and candidate
  diagnostics.
- [x] The implementation has focused unit tests for:
  - vertex clustering;
  - carrier grouping;
  - direct vertex-pair span generation;
  - conflict generation for overlapping alternatives.
- [x] A dated benchmark report compares `legacy-threshold`,
  `legacy-topology-v2`, and `junction-carrier-v1`.

## Evaluation Criteria

Primary:

- Candidate oracle recall.
- Selected recall.
- Assignment-correct selected edges.

Topology cleanliness:

- Selected chain matches.
- Selected normalized/merged spans.
- Degree-2 and odd-degree diagnostics from later stages.

Performance:

- Strategy generation seconds per sample.
- Total benchmark seconds.

## Iteration Policy

If `junction-carrier-v1` underperforms, diagnose in this order:

1. Are GT endpoints missing from candidate vertices?
2. Are GT carriers missing from carrier hypotheses?
3. Are vertex-pair spans generated but rejected by support thresholds?
4. Are candidates generated but rejected by beam selection?
5. Are false candidates too dense because conflicts are incomplete?

Stop and discuss if the benchmark shows that dense heads do not provide enough
reliable junction/carrier evidence for a non-ML strategy to compete.

## 2026-06-08 Benchmark Result

Benchmarked on `clean-1024-s15` with cached browser ONNX dense heads.

Reports:

- `artifacts/cp-detect-correctness/reports/clean-1024-s15-candidate-coverage-legacy-threshold-2026-06-08-junction-carrier-baseline`
- `artifacts/cp-detect-correctness/reports/clean-1024-s15-candidate-coverage-legacy-topology-v2-2026-06-08-junction-carrier-baseline`
- `artifacts/cp-detect-correctness/reports/clean-1024-s15-candidate-coverage-junction-carrier-v1-2026-06-08-final-default`

Summary:

| Strategy | Candidate oracle recall | Selected recall | Selected assignment match | Runtime |
| --- | ---: | ---: | ---: | ---: |
| `legacy-threshold` | 0.9089 | 0.9054 | 1826 | 17.76s |
| `legacy-topology-v2` | 0.9094 | 0.9054 | 1827 | 17.79s |
| `junction-carrier-v1` | 0.7634 | 0.7580 | 1551 | 11.13s |

What we learned:

- The default non-ML junction/carrier strategy is not competitive with legacy.
- Main default bottlenecks are candidate endpoints and carriers:
  - `endpoint_missing_from_adapter`: 279 GT edges.
  - `carrier_missing_from_adapter`: 204 GT edges.
- Making evidence extraction more permissive helped, but did not close the gap.
- A broad Hough-line-endpoint fallback increased candidate oracle recall to
  0.9018 and selected recall to 0.8741, which proves the dense line evidence can
  cover much more topology. But it also produced thousands of candidates per
  sample, many chain matches instead of clean single spans, and a 251s runtime.
- A narrower interior-only endpoint fallback was still slow and worse
  (`selected_recall` 0.7741), so endpoint fallback remains disabled by default.

Conclusion:

`junction-carrier-v1` is useful as a diagnostic baseline, not as a replacement
strategy. The next promising direction is not simply "more candidates from
Hough endpoints"; it needs a cleaner vertex proposal layer or an edge proposal
layer that can offer true junction-to-junction spans without flooding selection
with fragment chains.
