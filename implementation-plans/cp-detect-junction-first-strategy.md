# CP Detect Junction-First Candidate Strategy

Status: Proposed implementation plan, June 9, 2026.

## Goal

Implement a true junction-first candidate generation strategy for crease-pattern
topology:

```text
dense heads -> junction/contact vertices -> plausible vertex pairs -> scored edges -> CandidateGraph -> selection -> exact solve
```

This is intentionally different from `junction-carrier-v1`.
`junction-carrier-v1` starts with junctions, but it still requires a Hough-style
carrier before it emits a candidate edge. The new strategy should test whether
the existing dense heads already contain enough evidence to connect detected
junctions directly, without losing true creases when Hough misses, truncates, or
mis-groups a carrier.

## Why This Plan Exists

The current clean-data evidence suggests junctions are not the main bottleneck.
Candidate edge generation is.

Latest local diagnostic run:

```text
/tmp/cp-detect-junction-carrier-v1-edge-diagnostics
strategy: junction-carrier-v1
dataset: clean-1024-s15-browser-onnx
date: 2026-06-09
```

Summary:

```text
GT edges evaluated:        2240
Candidate oracle recall:   0.9049
Selected recall:           0.9027
Selected assignment match:  1885
Runtime:                   ~12.4s release
```

The `carrier_missing_from_adapter` bucket had `182` GT edges. The new diagnostic
split was:

| Cause | Count | Meaning |
| --- | ---: | --- |
| Raw carrier exists, but no emitted span | 66 | Hough found a related line, but the carrier-to-vertex span builder did not emit the GT edge. |
| No collinear raw carrier | 59 | Dense line evidence/endpoints may be present, but the Hough carrier layer did not produce a matching line. |
| Below min span length | 26 | The GT edge is shorter than `min_span_length_px = 8`. |
| Emitted span exists, but wrong endpoint interval | 21 | Nearby spans exist, but not the correct endpoint-to-endpoint crease. |
| Raw carrier collinear but wrong extent | 8 | Hough found the infinite line but only over the wrong image interval. |
| Other | 2 | Small residual bucket. |

For clean-15, candidate vertices are close to GT vertices:

```text
GT vertices per sample:        37-149, median 91
Candidate vertices per sample: 33-140, median 90
Candidate/GT vertex ratio:     median 0.975
```

GT-edge endpoint availability is high:

```text
Both endpoints strict:  2079 / 2240 = 92.8%
Both endpoints relaxed: 2230 / 2240 = 99.6%
Median nearest endpoint error: ~0.44 px
90th percentile:              ~1.3-1.4 px
```

All-pairs scale on the same data is not obviously prohibitive:

```text
Candidate vertices per sample: 33-140
All vertex pairs per sample:   528-9730
Median pairs/sample:           4005
Total pairs over 15 samples:   64,325
```

Interpretation:

- The “too many noisy vertices” concern is not supported by the current clean
  benchmark.
- The dominant failure mode is that the current generator fails to propose true
  edges even when vertices are present.
- A true junction-pair strategy is now plausible enough to test directly.

## Current Strategy vs Target Strategy

### Current `junction-carrier-v1`

```text
junctions + boundary contacts
-> Hough line primitives
-> grouped carrier hypotheses
-> vertices incident to each carrier
-> local/skip vertex-pair spans on that carrier
```

This is carrier-gated. A true edge is impossible to emit if:

- no raw Hough carrier exists;
- the carrier extent does not overlap the GT edge;
- the carrier exists but admits too few incident vertices;
- the span builder emits nearby fragments but not the desired endpoint interval.

### Target `junction-first-v1`

```text
junctions + boundary contacts
-> candidate vertex set
-> plausible vertex pairs
-> dense segment scoring
-> dedupe/conflict encoding
-> CandidateGraph
```

Hough/carriers may still be used as features or diagnostics, but they must not
be required for edge proposal.

## Strategy Contract

Add a new candidate generation strategy:

```text
junction-first-v1
```

It should implement the existing `CandidateGenerationStrategy` boundary and
produce a coherent `CandidateGraph`. It must not mix its output with
`legacy-threshold` or `junction-carrier-v1` unless a future hybrid strategy
explicitly owns dedupe/conflict semantics.

## Algorithm

### 1. Vertex Proposal

Use the existing compiler-native evidence extractor:

- square corners;
- boundary contacts, using boundary-side/offset/coordinate heads when present;
- interior junction peaks, using `junction_offset`;
- `vertex_type_logits` to suppress obvious background peaks.

No Hough line endpoint fallback by default. Endpoint fallback can be a later
ablation, but the first version should test whether model junction/contact
heads are enough.

Output:

```text
CandidateVertex[]
```

### 2. Pair Preflight

For every unordered non-boundary-duplicate vertex pair:

- reject degenerate/too-short pairs below a configurable minimum;
- keep long diagonals possible, because real CPs contain them;
- reject paper-boundary-to-paper-boundary pairs that are exactly border-like
  unless they are deterministic border spans;
- cheap sample midpoint and quarter points first;
- reject early if line support is dark or non-crease support is high.

This phase is allowed to be `O(N^2)` initially. The clean-15 all-pairs count is
small enough for a correctness-first implementation.

### 3. Full Segment Scoring

For surviving pairs, sample along the straight segment and compute:

- line support min/mean/max;
- line hit fraction;
- non-crease mean/max;
- assignment probabilities;
- line-style probabilities;
- endpoint support/confidence;
- optional raw-carrier agreement features:
  - nearest carrier angle delta;
  - nearest carrier line distance;
  - carrier overlap fraction.

The first version can use deterministic thresholds. The scoring function should
be written so a future learned edge-pair classifier can replace or augment it
without changing the `CandidateGraph` contract.

### 4. Candidate Edge Emission

Emit a `CandidateCreaseSpan` for each accepted pair:

- endpoints are exactly the two proposed vertices;
- carrier geometry is the analytic line through those endpoints;
- `t_interval` is the actual endpoint projection interval;
- assignment evidence comes from the segment samples;
- source kind should distinguish this strategy, for example an arrangement
  source kind plus provenance reason `junction-first-v1`;
- presence probability derives from segment score, not Hough carrier score.

### 5. Dedupe And Alternatives

Before selection, canonicalize candidates:

- remove exact duplicate endpoint pairs;
- if multiple candidates have near-identical endpoints/assignment, keep the
  best-scoring one and preserve provenance;
- mark crossing/incompatible alternatives where the selector must choose;
- mark overlapping same-line alternatives where they cannot coexist cleanly;
- do not rely on beam selection to discover basic duplicate geometry.

### 6. Border Handling

Keep deterministic square-border handling separate:

- corners fixed;
- boundary contact vertices sorted per side;
- locked border spans generated between adjacent boundary contacts/corners.

`junction-first-v1` should propose interior/non-border crease spans. It should
not learn or hallucinate paper borders.

### 7. Selection And Exact Solve

Feed the resulting `CandidateGraph` into the existing selector and exact solver.
Do not add a second selector or hidden fallback path.

## ML Extension Point

If deterministic segment scoring is too noisy, add a learned edge-pair
classifier after the pair preflight and before candidate emission.

Input features:

- endpoint types and confidences;
- sampled line/non-crease/style/assignment values;
- segment length and angle;
- boundary-contact flags;
- raw-carrier agreement features;
- nearby competing vertex count along the same segment;
- local degree/topology context if available.

Output:

- edge probability;
- assignment probabilities;
- optional uncertainty score.

This keeps the architecture stable:

```text
vertex pairs -> deterministic features -> optional ML edge classifier -> CandidateGraph
```

Avoid jumping directly to a full graph neural network until the non-ML
junction-first benchmark tells us whether candidate recall or false positives
are the actual blocker.

## Benchmark Plan

### Required Benchmark Sets

Start with:

- `clean-1024-s15-browser-onnx`

Then expand to:

- clean-15 with varied families/profiles;
- V2 issue profiles after clean behavior is understood;
- real-world visually inspected examples when labeled enough.

### Required Strategy Comparisons

Run:

```bash
target/release/compare_candidate_coverage \
  --strategy legacy-threshold \
  --manifest artifacts/cp-detect-correctness/dense-cache/clean-1024-s15-browser-onnx/manifest.json \
  --out artifacts/cp-detect-correctness/reports/<date>-legacy-threshold

target/release/compare_candidate_coverage \
  --strategy legacy-topology-v2 \
  --manifest artifacts/cp-detect-correctness/dense-cache/clean-1024-s15-browser-onnx/manifest.json \
  --out artifacts/cp-detect-correctness/reports/<date>-legacy-topology-v2

target/release/compare_candidate_coverage \
  --strategy junction-carrier-v1 \
  --manifest artifacts/cp-detect-correctness/dense-cache/clean-1024-s15-browser-onnx/manifest.json \
  --out artifacts/cp-detect-correctness/reports/<date>-junction-carrier-v1

target/release/compare_candidate_coverage \
  --strategy junction-first-v1 \
  --manifest artifacts/cp-detect-correctness/dense-cache/clean-1024-s15-browser-onnx/manifest.json \
  --out artifacts/cp-detect-correctness/reports/<date>-junction-first-v1
```

### Metrics To Track

Primary:

- candidate oracle recall;
- selected recall;
- selected assignment match;
- root cause buckets;
- candidate count;
- selected count;
- runtime per sample.

Topology quality:

- duplicate/overlapping candidate counts;
- degree-2 selected vertices;
- odd selected vertices;
- crossing diagnostics;
- exact-solve status;
- strict GT isomorphism score when available.

Diagnostic outputs:

- per-edge candidate diagnostics should include whether a missed GT edge had:
  - endpoints present;
  - line support;
  - a candidate pair tested;
  - a candidate pair rejected by threshold;
  - a candidate pair emitted but rejected by selection.

## Phases

### Phase 0: Preserve Baseline Diagnostics

Status: Not started.

Work:

- Keep the new `compare_candidate_coverage` per-edge diagnostics.
- Archive a dated report for the current `junction-carrier-v1` diagnostic run
  under `artifacts/cp-detect-correctness/reports/`.
- Ensure `summary.json`, `per_sample.jsonl`, and `per_gt_edge.jsonl` are stable
  enough to compare future strategy runs.

Done means:

- The current carrier-gated bottleneck breakdown is recoverable after `/tmp`
  files disappear.
- No runtime/product code path gets slower from benchmark-only diagnostics.

### Phase 1: Register `junction-first-v1`

Status: Not started.

Work:

- Add `CandidateGenerationStrategyName::JunctionFirstV1`.
- Add strategy options:
  - min segment length;
  - cheap preflight thresholds;
  - full support thresholds;
  - max candidates per vertex, default unlimited or high for correctness-first;
  - optional top-K mode, disabled by default.
- Register CLI/inspector strategy selectors.

Done means:

- `compare_candidate_coverage --strategy junction-first-v1 --limit 1` runs.
- The architecture inspector can select the strategy.
- Empty/smoke candidate graph tests pass.

### Phase 2: Vertex-Only All-Pairs Candidate Generation

Status: Not started.

Work:

- Reuse existing evidence extraction for vertices.
- Generate all plausible vertex pairs after basic geometric exclusions.
- Score each pair with dense line/non-crease support.
- Emit candidate spans directly between junction/contact vertices.
- Generate deterministic locked border spans.

Done means:

- Unit tests prove:
  - a bright line between two junctions emits a span without a Hough carrier;
  - a dark midpoint rejects a pair;
  - high non-crease evidence rejects a pair;
  - duplicate endpoint pairs are deduped;
  - deterministic borders are still locked and not learned.

### Phase 3: Benchmark And Diagnose Candidate Recall

Status: Not started.

Work:

- Run clean-15 benchmarks against legacy and `junction-carrier-v1`.
- Compare candidate oracle recall before looking at beam selection.
- Inspect root causes for remaining missed GT edges.

Done means:

- We know whether junction-first improves candidate oracle recall.
- Remaining misses are classified as:
  - endpoint missing;
  - pair rejected by preflight;
  - pair rejected by full score;
  - emitted but rejected by selection;
  - assignment mismatch.

### Phase 4: Precision Controls

Status: Not started.

Only after Phase 3 shows recall is promising.

Work:

- Add per-vertex top-K pruning as an optional mode.
- Add sector-aware top-K if many false rays come from the same vertex.
- Add overlap/crossing conflict quality improvements.
- Add optional raw-carrier agreement as a score bonus, not a hard gate.

Done means:

- Candidate oracle recall stays close to Phase 3.
- Selected recall/assignment improve or false positives decrease.
- Runtime remains acceptable in release mode.

### Phase 5: Exact-Solve Impact

Status: Not started.

Work:

- Run exact-solve benchmark for selected graphs.
- Compare strict topology/isomorphism metrics against legacy.
- Manually inspect representative wins/losses in the architecture inspector.

Done means:

- We know whether better edge proposal leads to more exact-solvable CPs.
- If exact solve still fails despite improved topology, the next bottleneck is
  exact geometry rather than candidate generation.

### Phase 6: Optional ML Edge-Pair Classifier

Status: Deferred.

Enter this phase only if deterministic junction-first has high recall but too
many false positives.

Work:

- Create edge-pair feature extraction fixtures from the same benchmark packs.
- Train/evaluate a small classifier on candidate pairs.
- Replace deterministic thresholding with classifier probability as candidate
  presence evidence.

Done means:

- The classifier improves selected recall or assignment-correct selected edges
  without materially increasing false positives.
- Browser inference/runtime remains acceptable.

## Stop Conditions

Pause and discuss if:

- all-pairs runtime is unexpectedly large in release mode on clean-15;
- candidate oracle recall does not improve over `junction-carrier-v1`;
- recall improves but false positives make selected topology worse than legacy;
- benchmark diagnostics show endpoint/junction recall is worse on non-clean
  profiles than clean-15 suggests;
- implementing ML becomes necessary before the non-ML strategy gives a useful
  signal.

## Open Questions

- Should `junction-first-v1` initially allow very short spans below 8 px, or
  keep the current min-length guard and test short-span recall separately?
- Should boundary-contact-to-interior pairs use different thresholds from
  interior-to-interior pairs?
- Should top-K pruning be disabled in the first benchmark for correctness, even
  if candidate count is high?
- How strict should non-crease suppression be on clean CPs versus text/watermark
  profiles?

