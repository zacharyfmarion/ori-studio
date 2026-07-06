# Edge/span reconstruction: the missing edges are already in the pool — selection is the wall

**Date:** 2026-07-05
**Scope:** Starting premise (from the 2026-07-01 report): with perfect
junctions (`--oracle-vertices`) exact topology only reaches 206/563 on
`native-cp-v1` (easy 134/191, medium 56/232, hard 16/140), so the span
stage — hypothesized as over-conservative *gates* — looked like the binding
constraint on medium/hard import. This session builds a per-edge
**missing-edge census** (which GT edges are absent from the selected graph,
with candidate-pool attribution and a replay of every proposal gate), uses it
to bound what is recoverable, refutes the gate hypothesis, implements the fix
the census actually points at (selection completion repair), and separates
the oracle-mode selection wall from the production-mode junction wall.
**Branch:** `claude/priceless-leakey-f6707e`, on top of main `9249b581`.

> Confidence discipline as in the 2026-06-30/07-01 reports: every headline is a
> measurement from the named artifact; hypotheses are labelled. §7 lists what
> was *not* measured.

---

## TL;DR

1. **The proposal gates are NOT the problem.** Under oracle vertices, of all
   missing GT edges, only 0.3% (easy) / 3.1% (medium) / 16.0% (hard) were
   rejected by the junction-first span-proposal gates. The rest were **proposed
   and then lost by selection**: 63–69% dropped outright, 19–33% displaced
   (a wrong near-twin span selected instead, plus canonicalization collateral —
   §3). The starting hypothesis ("support threshold 0.42 is too
   conservative") is refuted: `support_mean`/`support_min` rejections are
   ~0.1% of missing-edge mass. *(High — direct census measurement.)*
2. **The pool is nearly complete on easy/medium.** For 56/57 easy and 155/176
   medium oracle failures, the candidate pool contains a subset that exactly
   reproduces GT topology (hard: 58/124). A perfect selector over today's pool
   would lift oracle exact topology from 206 to ~475/563. *(High.)*
3. **Mechanism found (code-verified):** (a) beam selection only ever explores
   the **top-56 candidates** (`max_beam_candidates`); dense junction-first
   graphs have 10²–10⁴ candidates, so true-but-faint spans are never
   *considered*; (b) the weak-rescue pass filters on
   `CandidateCreaseSourceKind::LegacyLowThreshold`, which junction-first graphs
   never produce — **the rescue pass is a no-op in the production path**;
   (c) true spans' standalone selection scores sit at ≈0±0.3 because
   `line_support_mean` (≈0.55–0.75 for genuine anti-aliased strokes) is
   penalized twice (once as the score base, once through
   `-ln(presence_probability)`), so most are never seeded either. *(High.)*
4. **Missing edges come in adjacent pairs/chains, so single-span repair
   stalls.** On the 61 medium "pure addition" failures (all missing edges in
   pool, zero extras), the missing edges form connected components of size ≥2
   in 109 of 110 cases (74 are exactly pairs). Adding either edge of a pair
   alone strands an odd/dangling vertex at the shared endpoint and scores
   negative; **a degree-0 vertex costs nothing**, so leaving whole structures
   out is a local minimum. Any local repair must make paired moves. *(High.)*
5. **Fix implemented and measured: a completion-repair pass in selection**
   (single + atomic-pair moves over the *entire* optional pool, exact local
   deltas, hard-conflict-safe, `SelectionOptions::completion_repair`, default
   on). Under oracle vertices: exact topology **206 → 311 (+105, zero
   regressions)**, medium **56 → 125**; end-to-end (25s solver)
   `solve_recovered_original` **178 → 260 (+46%)**, medium recovery
   **43 → 95**, zero recovery regressions. Under production (decoded)
   vertices: **no change (150→150 topology, 121→121 recovered)** — because
   the production wall is junction-level, not selection-level (§5b): 95–98%
   of production missing edges have no pool entry at all, and every
   production failure carries ≥1 unmatched vertex. The two walls are now
   separated and measured; this removes half of the selection wall and is
   end-to-end neutral in production. *(High.)*
6. **Truly lost information is small outside hard.** No-ink (`line_max<0.25`)
   missing edges: 0% easy, 0% medium, ~0% hard; sub-min-length (<1px) edges:
   ~0.05% medium, 0.1% hard; blended strokes (parallel GT edge <3px):
   0.1% medium, 5.0% hard, plus 3.9% hard corridor-ambiguous. The resolution
   wall is real but hard-only. *(High for the census's definitions of
   these classes.)*

---

## 1. The census tool (new, reusable)

`compare_exact_solve_benchmark --dump-edge-census` writes `edge_census.jsonl`:
one row per missing/extra edge of the selected graph vs canonicalized GT.
Ingredients:

- `oristudio-cp-eval`: `EdgeDiagnostic` now carries **endpoint coordinates**
  (`endpoints`) — the `vertices` indices refer to the canonicalized graph,
  which callers cannot reconstruct, so diagnostics were previously
  geometrically unusable.
- `oristudio-cp-detect`: `OracleSpanProber` (junction-first) replays the exact
  production gate sequence — min-length → border-aligned → preflight →
  corridor → support-mean/min → non-crease — for any pixel-space segment
  against the same evidence and vertex set the generation used, recording all
  gate inputs (not just the first failure).
- Census row: pool attribution (`not_in_pool` / `dropped` / `selected`), the
  pool span's policy/support/conflicts, the gate probe, and GT-context
  distances (nearest parallel GT stroke = blending proxy; nearest other GT
  segment = crowding proxy).

Run config (all runs): full 563-CP pack, `--candidate-source
junction-first-v1 --line-evidence-source source-image --parity-repair
--skip-flat-folder`, strict 2px, dense cache
`native-cp-v1-pytorch-mps-v3-tess15-weighted`. Topology iteration adds
`--skip-exact-solve`; the end-to-end A/Bs run the solver at the 25s default
budget. All A/B pairs are same-commit, `--no-completion-repair` vs on.

## 2. Where missing edges die (oracle vertices)

30,568 missing-edge rows across 357 failed samples:

| bucket | missing rows | dropped (in pool, not selected) | "selected" (§3) | not in pool |
|---|---|---|---|---|
| easy | 314 | 69.4% | 30.3% | 0.3% |
| medium | 2,445 | 63.6% | 33.3% | 3.1% |
| hard | 27,809 | 65.0% | 19.1% | 16.0% |

Of the few not-in-pool rejections, the gates that bite are `non_crease`
(model's non-crease head firing on dense regions; medium 42, hard 2,178),
`corridor` (a third GT vertex within the 3px corridor of a real edge; hard
2,197, median parallel-neighbor distance 2.8px — genuinely ambiguous
geometry), and `min_length` (<1px GT edges — sub-resolution). The classic
support gates are irrelevant: **1 medium + 0 hard `support_mean` rejections**
out of 30.5k missing edges.

Dropped-span breakdown (the dominant class): mostly **no hard conflict with
anything selected** — medium 65% WeakOptional + 32% StrongOptional
no-conflict; hard 61% StrongOptional no-conflict. These are spans selection
would keep if it ever evaluated them; it doesn't (§4 mechanism). Their ink is
solid: dropped medium `line_support_mean` p25/50/75 = 0.53/0.56/0.64 (vs
selected true spans 0.90/0.95/1.00) — faint-but-real anti-aliased strokes.

## 3. The "selected"-but-missing anomaly is mostly collateral

19–33% of missing rows match a span that IS selected (endpoints within 1.5px)
yet strict topology counts the GT edge missing. Two verified sub-cases:

- **Border collateral** (32/95 easy, 229/814 medium, 664/5298 hard rows probe
  as `border_aligned`): a boundary-contact vertex whose interior edge was
  dropped becomes degree-2-collinear on the paper border, is dissolved by
  canonicalization, and the border segmentation stops matching GT. Fixing the
  dropped interior edge fixes these for free.
- The rest probe as `proposed` with matched endpoints — near-twin/vertex-
  matching displacement in dense regions (hard length p50 = 17px, easy/medium
  are longer edges entangled with merges: med merges per affected sample = 2,
  hard = 11).

Both are downstream of the same dropped-edge mass, not independent failures.

## 4. Why selection drops proposed true spans (code-verified mechanism)

- `select_candidate_graph_beam_from_ir` seeds Locked + StrongOptional spans
  with `selection_score >= 0`, then the beam explores only the top
  **`max_beam_candidates = 56`** candidates by seed-relative priority.
  Junction-first graphs on medium/hard have hundreds to tens of thousands of
  candidates.
- `rescue_ir_weak_candidates` only considers
  `source_kind == LegacyLowThreshold`. Junction-first emits
  `ArrangementObserved` — **the rescue pass never fires in production**.
- `selection_score = line_support_mean − (−ln presence) − source_prior(0.18) −
  assignment_cost`: at the true-span support levels the census measures
  (0.55–0.75), this sits at ≈0±0.3, i.e. the seed threshold cuts through the
  middle of the true-span distribution.
- `ir_state_residuals` gives **zero penalty to degree-0 vertices**, and
  parity repair only flips spans at odd-degree vertices — so a vertex missing
  *two* edges (parity intact) or an entirely unconnected junction triggers
  nothing.

## 5. The fix: completion-repair pass (+ atomic pair moves)

`completion_repair_ir_state` (oristudio-cp-compiler `selection.rs`), runs
after beam+rescue, before parity repair; `SelectionOptions::completion_repair`
(default on), `--no-completion-repair` in the benchmark for A/B:

- **Single moves:** lazily revalidated max-heap over every unselected
  non-Discouraged optional span; add when standalone score + exact local
  residual relief at its two endpoints ≥ `IR_RESCUE_MIN_IMPROVEMENT` (0.02).
- **Pair moves:** when singles stall, the best pair of adjacent eligible spans
  (sharing an endpoint, not conflicting with each other or the selection) is
  added atomically if the joint delta clears the same bar; single and pair
  phases interleave (chains resolve inductively). Dirty-vertex tracking keeps
  rescans local.
- Additions are pure (no hard conflict with current selection), so local
  deltas are exact; the per-vertex penalty code is shared with
  `ir_state_residuals` (`accumulate_ir_vertex_residuals`) so the two cannot
  disagree.

Unit tests: a faint bridge unreachable by beam (`max_beam_candidates: 0`),
rescue (wrong source kind), and parity (disabled) is added by the pass and
not without it; an adjacent faint pair is added atomically; hard-conflicted
spans are never added.

### Results (topology-only runs, strict 2px, full 563 pack)

**Oracle vertices (the census population):** exact topology **206 → 311
(+105, zero regressions)** — easy 134→165, medium **56→125**, hard 16→21.
Missing edges 30,568→18,097 (−41%); extra edges 13,663→13,479 (slightly
*down* — the pass does not hallucinate net extras here). Exact topology **and
assignment** 180→265 (+85); the added spans do not degrade assignment
accuracy (wrong-assignment rate 13.12%→12.99%). 11,935 spans added pack-wide,
median 2 per sample, max 575. The pass captures 105 of the 269
selection-complete failures (39% of the §2 bound) in one greedy sweep.
*(High — A/B at the same commit, per-sample flip lists checked, zero
exact→non-exact regressions.)*

**Oracle vertices, solver-on (25s budget, same-commit A/B):**
`solve_recovered_original` **178 → 260 (+82, +46%)** — easy 129→159, medium
**43→95**, hard 6→6; **zero recovery regressions** (no sample recovered at
baseline fails with the pass on). The solver converts 260/311 = 84% of exact
topologies, in line with the ~81% conversion at defaults. The 178 baseline is
consistent with the 2026-07-01 report's 174 at a 3s cap (older solver
priors), re-measured here at 25s with the PR#74 solver.

**Production (decoded junctions): no change — 150 → 150, zero flips**
(missing −147/99,744, extras +523/14,601, selection time ~unchanged), and the
solver-on run (25s budget) lands `solve_recovered_original` = **121 — exactly
the PR#74 baseline** (per-bucket 70/49/2), so the pass is end-to-end neutral
in production and safe to ship default-on. This is
not a failure of the pass; it is the census result of §5b below: in
production, 95–98% of missing edges are **not in the pool at all** because
their endpoint junctions were not decoded (or sit >2px off), and essentially
every production failure carries ≥1 vertex-level defect. Selection repair is
an enabler that becomes binding exactly when junction decode improves — which
is the measured oracle gap it now closes half of.

Method note: the first iteration of the pass (single moves only) was a wash
in the production-mode A/B (zero flips; missing −131/99,744) — the direct
trigger for the chain analysis in TL;DR-4 and the pair-move extension.

### 5b. Production failures are vertex-level, not selection-level

Running the same census on the production path (decoded junctions,
`--no-completion-repair`) inverts the oracle attribution:

| bucket | missing rows | not in pool | dropped | "selected" |
|---|---|---|---|---|
| easy | 843 | **97%** | 1% | 2% |
| medium | 2,641 | **95%** | 2% | 3% |
| hard | 96,260 | **98%** | 1% | 1% |

And at the sample level, **0 of 112 easy / 1 of 173 medium / 0 of 128 hard
production failures have clean vertex matching** (unmatched GT = unmatched
predicted = 0). The production near-band is junction-shaped: 121 easy+medium
failures sit within ≤2 total vertex defects, splitting into ~51
spurious-junction-only (gt=0, pred 1–2), ~37 displaced (gt=1, pred=1 — the
same junction decoded >2px off), and ~32 missed-junction-only. Median edge
damage attached to those defects: 4 missing + 4 extra.

So the 2026-07-01 framing "junction detection is NOT the bottleneck anymore"
needs sharpening: **both walls exist and are now measured separately.**
Production exact topology is blocked by 1–2 junction defects per failed
sample (recall + 2–4px localization tail + spurious suppression); once
vertices are right, selection was the next wall, and this session halved it.

## 6. Recoverable / ambiguous / lost bounds (census classification)

Cut points stated: recoverable-selection = in pool; recoverable-gate = gated
but `line_mean ≥ 0.25` and no <3px parallel neighbor; ambiguous-blend =
parallel GT stroke <3px; ambiguous-corridor = corridor-rejected;
lost = `line_max < 0.25`.

| bucket | recoverable-selection | recoverable-gate | ambiguous | lost (no ink) |
|---|---|---|---|---|
| easy (n=314) | 99.7% | 0.3% | 0% | 0% |
| medium (n=2,445) | 96.9% | 2.4% | 0.7% | 0% |
| hard (n=27,809) | 84.0% | 7.1% | 8.9% | 0% |

"Lost" at 1024px is essentially empty under this ink definition; the genuine
hard-bucket walls are stroke blending (5.0%) and corridor ambiguity (3.9%),
consistent with the prior sub-2px close-pair findings. Near-miss band
(≤2 missing, ≤2 extra): 16 easy + 20 medium + 2 hard samples, and their
missing edges are 100% recoverable-selection on easy/medium.

## 7. Not measured / open

- Whether raising `max_beam_candidates` alone reproduces part of the gain
  (the completion pass subsumes the beam's job here, but the beam can also
  *remove* seeded spans; not swept).
- The extras/hallucination side on hard (12,972 extra edges, nearest-GT
  median 1.9px) — the census records them but no removal pass was attempted.
- The residual oracle selection gap after the pass (easy 26 / medium 107 /
  hard 119 failures; medium residual median 6 missing + 2 extra): larger
  connected structures, conflict-entangled additions, and extras that need
  *removal* moves — the pass only adds. A removal phase (and/or triple moves)
  is the obvious next increment.
- Medium's next wall after topology is **assignment**: 125 exact-topology but
  only 98 exact-topology-and-assignment under oracle+completion (hard: 21 vs
  6). Wrong M/V on strict-matched edges is 13% pack-wide. **(Addressed in the
  2026-07-06 addendum, §8: Maekawa propagation takes topo+assign 265→293.)**

---

## 8. Addendum (2026-07-06): removal/swap is a dead end; assignment completion is not

Follow-up session on the two §7 levers, same benchmark discipline.

### 8a. Removal/swap moves: three iterations, closed as a dead end

The completion pass got opt-in destructive phases (`SelectionOptions::
completion_removal_moves`, default **off**): pure removals and
conflict-partner swaps, targeting the extras and the wrong-twin selected
anomaly. Three acceptance rules were measured (oracle, topology-only, vs the
311 adds/pairs baseline):

| variant | oracle exact topology | regressions |
|---|---|---|
| score-improvement only | 297 (−14) | 15 (exact samples → up to 12 missing/4 extra) |
| + total penalty-relief > 0 required | 297 (−14) | 15 (identical) |
| + STRUCTURAL relief only (odd/dangling/degree) | 310 (−1) | 1, and **0 gains** |

Mechanism of the failures, in order of discovery: (1) near-collinear twins
share the same ink, so selection score cannot distinguish the true span from
the spurious one — swaps "improve" healthy regions into broken ones;
(2) penalty relief cannot be trusted either, because **exact-topology samples
are not penalty-free**: Unknown assignment labels make Maekawa nonzero and
rectified-angle error makes Kawasaki nonzero on perfectly correct topology,
so destructive moves score-shop through label noise; (3) even restricted to
structural terms (which ARE zero on correct topology), the moves gain
nothing — the swap-shaped misses the census counted (medium 16, hard 1,711)
sit on samples that are too broken for one swap to flip. Additional guards
implemented along the way (isolated-segment erasure ban, new-dangling /
chain-nibbling ban) are necessary but not sufficient. The code stays in tree
flag-gated for future work; it does not ship. *(High — three A/Bs.)*

### 8b. Assignment: the errors are Unknown-shaped, and constraints fix them

Confusion matrix on strict-matched edges (oracle+completion): genuine M↔V
swaps are rare (443 edges); the mass is labels collapsing to **Unknown**
(39.2k edges; 18.9% of hard checked edges), because `assignment_from_sums`
needs confidence ≥0.60 and margin ≥0.12 and the head is genuinely uncertain
on real strokes. 46 samples (easy 4 / medium 27 / hard 15) had exact
topology but were blocked purely by assignment, ~92% of their wrong edges
being `X → unknown`.

Two topology-preserving post-selection fixes (both cannot touch a
non-Unknown label, so they cannot un-fix anything):

1. **Ink-weighted relabel** (`AssignmentEvidence::ink_label`, promoted over
   Unknown post-selection; benchmark `--relabel-unknown-assignments`): safe
   (topology exactly 311=311) but weak — wrong edges only 40,032→39,342.
   The ink-weighted label is also Unknown ~98% of the time: the low
   confidence is model-bound on-stroke, not sampling dilution. (Making the
   weighted evidence PRIMARY — `ink_weighted_assignment` — was also measured:
   −11 oracle topology through score/Maekawa coupling; kept off.)
2. **Maekawa / pass-through constraint propagation**
   (`selection::propagate_forced_assignments`; benchmark
   `--propagate-forced-assignments`): at an even-degree interior vertex with
   exactly one Unknown crease, M−V=±2 pins the label when the known
   difference is ±1 or ±3; a degree-2 pass-through copies its partner's
   label; iterate to fixpoint. Result: **topo+assign 265 → 293 (+28)** —
   medium 98→115, hard 6→16 — wrong edges 40,032→26,536 (−34%), zero
   topology losses (one gain via label-dependent canonicalization). *(High.)*

Production has 10 assignment-blocked samples (easy 3 / medium 1 / hard 6 of
the 150 exact topologies), so the propagation lever also applies there —
solver-on numbers below.

### 8c. Final end-to-end numbers (25s solver, completion + relabel + propagation)

| config | oracle `solve_recovered` (easy/med/hard) | production |
|---|---|---|
| baseline (pre-session) | 178 (129/43/6) | 121 (70/49/2) |
| + completion pass | 260 (159/95/6) | 121 |
| + assignment stack | **288 (160/112/16)** | 121 |

**Zero recovery regressions at every step, both modes.** Oracle end-to-end is
up **+110 (+62%)** across the session; medium 2.6×, hard 2.7×. The
assignment stack converts 28 of the 46 assignment-blocked oracle samples.
Production stays exactly 121: its 10 assignment-blocked samples did not
convert (their Unknowns sit at vertices with multiple unknowns or alongside
genuinely wrong labels, where single-unknown forcing does not apply) — the
production numbers remain junction-bound on every axis measured.

### 8d. Revised residual picture

- Oracle selection residual: 107 medium failures (median 6 missing + 2
  extra), substantially **cycle-shaped** — a missing closed cycle produces no
  parity/dangling signal at any vertex, so local repair driven by structural
  residuals is blind to it; only evidence-score or global reasoning can find
  it. This, not pairs, is the next selection frontier.
- Assignment residual after propagation: 26.5k wrong edges, still
  Unknown-dominated on hard — vertices with 2+ unknowns or non-flat-foldable
  label neighborhoods; a full per-vertex 2-coloring/CSP (or line-style/color
  evidence) is the next assignment increment.
- Production remains junction-bound (§5b) for topology; the assignment stack
  is the first pipeline lever in this line of work that should move
  production recovery (via its 10 blocked samples).

### 8e. Product wiring: one shared codepath

The full stack now ships through a single entry point:
`selection::select_and_finalize_candidate_graph` = beam + completion pass +
parity repair + `finalize_selected_assignments` (ink-label promotion +
Maekawa propagation, both `SelectionOptions` fields, default on). Callers:

- **product**: `decode.rs::legacy_candidate_exact_solve_from_generation`
  (all `decode_dense_outputs*` variants funnel here; the wasm crate rebuilds
  automatically via the web app's `predev`/`prebuild`);
- **stage inspector**: both selection sites (stage-3 example flow and the
  uploaded-image flow) use the same wrapper;
- **benchmark**: same options + the shared `finalize_selected_assignments`
  (applied after the optional `--oracle-selection` override, which is why it
  cannot use the wrapper verbatim); `--no-relabel-unknown-assignments` /
  `--no-propagate-forced-assignments` / `--no-completion-repair` disable for
  A/B.

Parity verified: a full-pack run of the new default path is per-sample
identical (topology, edge counts, wrong-assignment counts) to the measured
explicit-flag config. Production pre-solve topo+assign rises 140 → 146 from
the assignment stack; recovery stays 121 (§8c).
