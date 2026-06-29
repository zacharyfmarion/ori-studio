# CP Detector Failure Attribution & Oracle Ablation

## Purpose

Decide **which component of the detect→compile pipeline is the biggest lever** for
end-to-end correctness on real crease patterns, *before* investing in improving any
one of them. We want a defensible ranking of levers (with their ceilings) plus the
mechanism behind each failure mode and its frequency across the dataset — not a hunch.

The question we must answer: *if we could make exactly one stage perfect, which one
yields the largest jump in correct reconstructions, and on which slice of the data?*

## The core method (why this design)

Counting "where each sample first fails" is **not** sufficient and will mislead us:

1. **Levers mask each other.** A CP that fails candidate recall *and* selection *and*
   the solver flips nothing if we fix only one. First-failure counting over-credits the
   first wall and under-credits everything downstream.
2. **Error mass ≠ flipping power.** A few thousand-edge CPs dominate any per-edge tally
   but are hopeless regardless; the lever that matters converts *near-correct* CPs.
3. **Ceiling ≠ ROI.** Lever size is the *ceiling*; feasibility (scoring tweak vs model
   retrain) is weighed separately by a human.

So the **primary instrument is leave-one-out oracle ablation**: give the
ground-truth-correct output to every *other* stage and measure how far below 100% the
system still is — the residual gap is that stage's fault, with no masking. Rank stages
by residual gap. Supplement with descriptive cuts (per-crease fate, near-miss blocker)
for mechanism, all stratified by density and CP family.

## Non-Goals

- Do not change the production decode path or the dense model in this work; this is
  measurement only.
- Do not treat the source-image line-evidence path as a *true* GT line oracle (it is a
  strong proxy; flag it as such — a real GT-derived line-probability oracle is optional
  follow-up).
- Do not build new UI; the inspector already exists for spot-checking. Output is
  benchmark artifacts + aggregation tables.
- Do not re-run the browser/ONNX path; use the existing dense caches.

## Existing Assets To Reuse

Harness: `crates/oristudio-cp-detect/src/bin/compare_exact_solve_benchmark.rs`
- Emits `summary.json`, `per_sample.jsonl`, `regressions.jsonl` per run.
- Per-sample already carries `family`, `profile`, `gt_edges`, selected strict-topology
  metrics, and exact-solve status.
- Strict topology via `oristudio_cp_eval::strict_topology_metrics` — **now
  canonicalized** (split at incident collinear vertices); all numbers must be
  re-baselined under it. Pixel mapping is `normalized_to_px` (inset 32).

Architecture note (matters for what each oracle means): production lines come from the
**source image**, not a learned head. `evidence_extract` resolves `line_probability` from
`line_probability_override` (the source-image map via `line_probability_from_rgba`) when
present, ignoring the model `line_logits`; the line head is only used in the
`dense-model` line-evidence ablation. So the **learned-model levers are junctions**
(junction head + offset) **and assignment** (assignment head); line evidence is a
deterministic CV step whose ceiling is set by render resolution / line extraction, not by
model training.

Oracle knobs that already exist (map to stages):
- `--oracle-vertices` → junction localization oracle (model junction head).
- `--oracle-junction-labels` → assignment-head oracle.
- `--line-evidence-source source-image` → the production line path (image-derived), the
  baseline; a *true* GT line oracle (below) overrides this map, not the model head.
- `--exact-solve-timeout-seconds N` → solver budget (use a large value to remove the
  solver as a confound when measuring *topology*).
- `--exact-solve-any-topology` → bypass the topology gate.
- `--match-tolerance-px`, `--strict-vertex-tolerance-px` → matching tolerances.

Candidate-recall diff logic to port: the inspector backend already computes
`candidate_topology` (all-candidates vs GT) in
`crates/oristudio-cp-detect-inspector/src/main.rs` (`candidate_eval_graph` +
`topology_diff`). The benchmark should emit the same per sample.

Dataset: `native-cp-v1` dense cache (563 samples, easy/medium/hard) + per-sample
`gt.graph.json`. Manifest carries `family`/`profile`/`edge_count` for stratification.

## New work

### A. Oracle selection mode (`--oracle-selection`)
Replace `select_candidate_graph_beam_from_ir` with a GT-optimal pick over the
*generated* candidate pool: for each GT crease, select the covering candidate(s) (mapped
endpoints within `--strict-vertex-tolerance-px`); drop candidates that match no GT crease.
This isolates **beam scoring** from candidate recall — residual failures are either
"no candidate existed" (recall) or geometry/solver, not scoring.
- Implementation: after `generate_candidate_graph`, build the selected-span set by
  matching candidate spans to GT edges (reuse the eval-graph mapping). Feed that
  `SelectedGraph` into the existing exact-solve path.

### B. Oracle candidate-recall mode (`--oracle-candidate-recall`)
Inject the missing GT creases as synthetic candidates so the pool has full recall, then
run normal beam (or combine with `--oracle-selection`). Isolates **candidate generation /
detector recall** — the mode we most suspect dominates.
- Implementation: for each GT crease with no covering candidate, synthesize a
  `CandidateCreaseSpan` from GT geometry (invert `normalized_to_px` to unit space, add GT
  vertices not already present), labeled with the GT assignment, and append to the
  `CandidateGraph` before selection. Guard against duplicate vertices/edges.
- Note: injected candidates can still be dropped by beam — that is correct (then
  selection is the residual). The all-oracles stack (A+B+gt-vertices+gt-labels+big
  timeout) must approach ~100% exact; if not, that's a harness/metric bug to fix first.

### C. Per-sample candidate-recall attribution in `per_sample.jsonl`
For every sample, also emit the **all-candidates-vs-GT** strict diff (missing = GT crease
with no candidate = detector miss) alongside the existing selected-vs-GT diff. The gap
(`candidate_missing` − `selected_missing` is wrong sign; compute directly):
- `detector_miss` = GT creases with no candidate.
- `selection_miss` = GT creases that *have* a candidate but are not in the selected graph.
- `assignment_wrong` = matched edges with wrong M/V/B.
- `spurious` = selected edges with no GT match (+ flag close-pair duplicates).
This is the recall-vs-selection split, the crux distinction.

### D. Leave-one-out runner + aggregation
A script (`scripts/cp-detect/failure-attribution.py` or a shell driver) that:
- Runs the **experimental matrix** (below) over all three native buckets.
- Aggregates `per_sample.jsonl` across runs into:
  1. **Lever ranking** — leave-one-out residual-gap table (primary) + each-oracle-alone
     standalone table; primary metric `exact_topology_and_assignment`.
  2. **Per-crease error mass** — % of wrong GT creases by {detector / selection /
     assignment}, with the spurious/close-pair breakdown.
  3. **Near-miss blocker** — among samples with ≤K wrong creases, the dominant blocker.
  4. All of the above **stratified by GT-edge-count bins × family**.

## Experimental matrix (runs over all 563)

Baseline + singletons + leave-one-out + full stack. Oracles:
`L`=GT line-evidence (override the source-image map), `J`=oracle-vertices,
`A`=oracle-junction-labels, `S`=oracle-selection, `R`=oracle-candidate-recall,
`T`=big solve timeout.

- **P0 production** (none) — re-baseline under canonicalized metric.
- **Singletons** P0+L, +J, +A, +S, +R, +T — standalone lever.
- **Leave-one-out** ALL−L, ALL−J, ALL−A, ALL−S, ALL−R, ALL−T — masking-free residual.
- **ALL** (full oracle stack) — harness ceiling sanity check (expect ≈100% exact).

Each run is cheap relative to value; the gated exact solve keeps wall low except where
topology is correct. Use a large `--exact-solve-timeout-seconds` for the topology-target
runs so the solver does not confound selection.

## Metrics & confounds

- **Primary target:** `exact_topology_and_assignment` (geometry-independent, canonicalized).
- **Secondary:** `accepted` (with solver) — report separately; the 2s cap previously made
  medium read 25 exact-topology but 1 accepted, so always pair "exact topology achieved"
  (selection ceiling) with "accepted at timeout T" (solver).
- Re-baseline: the canonicalization change invalidates pre-fix oracle numbers
  (e.g. older clean-15 7/15); everything in this study runs under the new metric.

## Pitfalls to guard against (so we don't invest wrong)

- **Aggregate-only numbers lie** — always stratify by density × family.
- **Error mass dominated by giant CPs** — weight the near-miss view, not raw edge counts,
  when ranking *flipping* levers.
- **Oracle leakage** — verify each oracle changes only its stage (e.g. `--oracle-vertices`
  must not also fix assignment); the singleton vs leave-one-out cross-check exposes leaks.
- **Solver confound** — large timeout for topology questions.
- **Harness validity** — the ALL-oracles run must reach ≈100% exact; a shortfall means a
  representation/metric bug, fix before trusting the ranking.

## Findings (easy + medium; hard pending)

Oracle-matrix exact-topology %, topology ceiling (`--skip-exact-solve`), native-cp:

| bucket | P0 | +J (GT junctions) | +S (oracle sel) | J+S |
|--------|----|----|----|----|
| easy   | 34% | 70% | 34% | 98% |
| medium | 11% | 24% | 10% | 84% |

**Two levers in series (clean oracles only):**
1. **Junction recall — the gate.** Model junctions miss junctions, so the candidate pool is
   missing creases. P0 detector_miss/sample = 6.1 (easy) / 17.8 (medium); GT junction
   positions (`--oracle-vertices`) drop it to ~0, lifting exact 34→70 / 11→24. This is what
   the vertex refiner targets; its ceiling is the `+J` column.
2. **Beam drops real candidates.** Even with a complete pool (GT junctions), the beam drops
   real creases — under `J`, `selection_miss` = 218 (easy) / **1576** (medium), dwarfing
   spurious/assignment. An oracle that just keeps the real candidates lifts 70→98 / 24→**84**.
   Bigger than the junction lever on medium; the refiner does nothing for it.

`detector_miss == 0 ⟺ exact at P0` (64/64 easy, 25/25 medium) — pool completeness is the
P0 gate; the beam only starts dropping real candidates once a *denser* pool is forced
complete (lever 2 is masked at P0 by lever 1).

**Caveat — oracle leakage:** `--oracle-junction-labels` is NOT a clean assignment oracle; it
paints GT into the junction heatmap and thereby fixes junction *recall* (det_miss/sample
17.8→1.2 on medium). Its column and any leave-one-out using it are discarded. A clean
assignment lever would need a real assignment-only oracle (deferred).

**Open / next:** the vertex refiner is **unmeasured** — the benchmark runs the dense head
only. The decisive experiment is to cache refined vertices over the 563 samples and add a
`--vertices-from <cache>` benchmark input (reuses `generate_junction_first_with_vertex_pixels`,
same path as `--oracle-vertices`), then compare **P0 → refined → GT(J)** per density: the
refined point's position in [P0, J] is exactly how much of lever 1 the refiner captures.
Lever 2 (beam dropping valid creases on dense pools) is a separate beam-scoring
investigation.

## Done Criteria

- `--oracle-selection` and `--oracle-candidate-recall` modes implemented with targeted
  unit tests (oracle selection of a known graph; recall injection adds exactly the missing
  creases).
- `per_sample.jsonl` carries detector/selection/assignment/spurious attribution per sample.
- ALL-oracles run reaches ≈100% exact_topology_and_assignment (harness validity).
- Aggregation produces the four tables, stratified by density × family, from one command.
- A written readout: ranked levers with ceilings, the recall-vs-selection split, and the
  recommended highest-ROI lever per density regime.

## Checklist

- [x] Emit per-sample candidate-recall + failure attribution in `per_sample.jsonl`
      (`FailureAttribution`: detector_miss / selection_miss / assignment_wrong / spurious /
      recovered / unmatched vertices; identity recovered+detector+selection == gt_edges
      verified). Early read on easy bucket: of lost creases, detector_miss ≫ selection_miss
      (1158 vs 16) — candidate recall, not selection, is the dominant lever.
- [x] Add `--oracle-selection` (GT-optimal pick over generated candidates: keep candidates
      whose whole pixel span lies on GT creases). Validated: on easy, selection_miss 16 → 0
      but **sample-level exact unchanged (63/191)** — perfect selection flips *zero* samples,
      because the failing samples are blocked by missing candidates (detector recall), not
      selection. Selection is a near-non-lever; candidate recall is the wall.
- [~] `--oracle-candidate-recall` — **not built (superseded by data).** With
      `--oracle-vertices --oracle-selection` on easy, the residual detector_miss is **1**
      across 191 samples: given GT junctions, candidate generation already has ~full recall,
      so "candidate recall" is junction-bound, not a separate generation-logic lever. The
      `--oracle-vertices` + `--oracle-selection` combination IS the perfect-upstream oracle,
      so the invasive per-crease injection (constructing valid `CandidateCreaseSpan`s) buys
      nothing and is skipped.
- [ ] Add unit tests for both oracle modes.
- [ ] Write the leave-one-out runner + aggregation script (4 tables, stratified).
- [ ] Run the full matrix over easy/medium/hard; validate ALL-oracles ≈100%.
- [ ] Write the readout: lever ranking + mechanism + recommendation.

## Open questions

- GT line oracle: rasterize GT creases into a perfect `line_probability` map and set it as
  the `line_probability_override` (replacing the source-image map — NOT the model line head,
  which production does not use). This isolates the line-extraction ceiling, which is a
  *render-resolution / CV* lever (close-pair creases unresolved at 1024px on dense CPs),
  categorically different from a model-training fix. Worth including, but expect it to
  matter mainly in the hard bucket since native renders are clean.
- Family taxonomy granularity: bucket scraped-native by source site vs treat as one?
- Near-miss threshold K (e.g. ≤3 wrong creases) — pick from the distribution, not a priori.
