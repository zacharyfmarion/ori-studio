# CP detection: where the curated-benchmark funnel loses cases (2026-09-07)

The question: from a rectified image to a fully accepted crease pattern that
converges to the truth, which stage of the product pipeline loses the most
cases, and where would work move that number most? Measured on the curated
benchmark's baseline run at `8913ccc8` (model `cp-detector-v3-v5-bp-search225-step12000`,
CoreML, `tests/corpus/cp-detect-curated-baseline.json`), re-scored from the
run's own `per_case.jsonl` and `answers/*.fold` with the crate's strict
topology metric. No detector, decoder or solver code was changed; two
analysis tools were added (below).

## Headline

**The exact solver is not the bottleneck. The decoder's small, local
topology defects are, and two mechanisms account for most of them:
boundary-contact vertices (creases that meet the paper edge) and missed
junctions where a short crease crosses a long one.** On real images a third
mechanism sits in front of both: the auto-rectified paper quad is one edge
too wide on 9 of the 25 worst cases, with a near-perfect detection underneath.

The harness's own "recovered" number over-counts convergence. Its end-to-end
test pairs vertices and counts unpaired *junctions*, and never checks edges or
assignments, so a solved output missing 30 boundary creases still reads as
recovered. Scored strictly (accepted **and** the solved output is
topology-exact against `truth.fold` at 2 px with the same M/V), the baseline
is:

| group | cases with an exact truth | harness `recovered` | strict convergence |
| --- | --- | --- | --- |
| `cpoogle` (export-style renders) | 482 | 297 (62%) | **265 (55%)** |
| `curated` (real images) | 40 | 20 | **17** |

Every count below is strict unless it says otherwise.

## The funnel, rendered group (482 truths)

| decoder bucket (recognised graph vs `topology.fold`, 4 px) | n | converged | accepted but wrong | not accepted | capped |
| --- | --- | --- | --- | --- | --- |
| exact | 256 | 233 (+1 with a wrong M/V) | 22 | 0 | 0 |
| near (edge F1 ≥ 0.95) | 174 | 31 | 117 | 3 | 23 |
| off | 48 | 1 | 29 | 9 | 7 |
| not recognised (> 4,000 creases) | 6 | | | | 6 |

The 217 non-convergences: **near topology 120 (55%)**, off topology 38 (18%),
capped by the harness's 1,500-recognised-edge / 4,000-crease limits 36 (17%),
exact topology but drifted 22 (10%), wrong assignment 1.

Solver conversion on exact topology is 233 of 256 (91%) here and 14 of 18 on
real images. The 22 drifted cases are all mirror-symmetric, equal-magnitude
displacements (flying-squirrel: dx = dy = −7.07 px at (300, 300), matched pairs
at (512, 212) / (212, 512)), i.e. the free-slide family the solver already
knows about: the gate reproduces 17 of the same 22 from the hand topology's
exact coordinates, so from noisy detected coordinates the polish lands on a
different but equally exact configuration. That is a solver-prior question
(a weak tie to the input positions kept through polish), worth ≤ 23 cases.

## What a "near" case is

Clustering the crate's missing and extra edges into repair sites (endpoints
within 2.5 px): 79 of the 174 near cases have one site, 37 have two, 23 have
three or four. The defects are:

| mechanism | near cases affected | note |
| --- | --- | --- |
| a crease that reaches the paper border is missing | **145 / 174** | the only defect in 87 cases; 48 of those did not converge and were not capped |
| a junction is missed | 63 / 174 | 118 junctions of 48,043 (recall 99.75%) |
| other interior edges missing or extra | 32 / 174 | median length 17 px |

GT crease miss rate by geometry, over all near cases: interior 0.4%; reaches
the border 4.5%; reaches the border **and** is ≤ 25 px long **30%**; also
within 25 px of a corner **44%**; runs along the border band (both ends within
25 px of the edge) **16%**. The pipeline's recall problem is the border band.

### Mechanism 1: boundary-contact vertices

Junction-first proposes a span only between two candidate vertices, so a
crease whose border endpoint has no candidate vertex is unproposable whatever
its ink. The border endpoint comes from `boundary_contact_primitives`:
`local_maxima_primitives` on the contact heatmap at threshold
`line_threshold.max(0.50)` with a 2 px NMS, a ±0.5 px `offset_refined_point`
from the legacy sub-pixel head, a snap to the nearest frame side, and a drop
when another vertex is within `vertex_merge_radius_px` (3.0)
(`evidence_extract.rs`, `junction_carrier_v1.rs::build_vertices`). Junctions
left this path in July for offset-vote clustering with a peak gate (the +66%
change); contacts never did.

Per near case, the worst contact defect, against strict convergence:

| worst contact defect in the case | cases | converge |
| --- | --- | --- |
| absent (no candidate vertex within 8 px of the truth's border point) | 57 | 0 |
| displaced 4–8 px along the edge | 58 | 16 of the 33 with no other defect |
| doubled (two contacts 5–12 px apart for one crease) | 30 | 13 of the 23 with no other defect |
| no contact defect | 29 | |

The displaced half is benign in the end: the solver's `BoundaryOnly` slide
repairs a 4–5 px offset and the strict comparison passes. Absent contacts
never converge. The contact sheets show what each looks like: a single
oblique crease gets a contact 4–5 px off along the edge; two creases meeting
at one border point get two contacts 10 px apart; 21 px grid stubs to the edge
and the first grid line running parallel to the edge vanish entirely. The
giants the harness caps are the same story at scale (batmobile 131 of 131
missing creases reach the border, carp 140 of 144, arowana 154 of 165).

Replaying the candidate pool (`dump_candidate_pool`, product options) for the
151 near cases under 1,500 creases settles where each of their 1,033 missing
border-reaching creases died:

| fate in the pool | share |
| --- | --- |
| no contact vertex within 4 px of the truth's border point, but one 4–12 px away (displaced or doubled) | 39.5% |
| no contact vertex, contact heatmap peak between 0.10 and 0.50 at that point (under the 0.50 threshold) | 31.3% |
| no contact vertex, contact heatmap below 0.10 (the head did not fire) | 7.1% |
| present, but attached to a duplicate vertex | 8.1% |
| both vertices exist, ink mean ≥ 0.42, span never proposed | 6.9% |
| the other endpoint is a missed junction | 3.5% |
| proposed and dropped by selection | 2.8% |
| covered by a longer selected span | 0.9% |

Roughly 78% is the contact vertex itself — localisation and threshold, in
that order — and under 3% is selection. The "never proposed" row is the same
defect seen from the other side: in 76 of those 100 spans the crease is in
the output as two selected spans through a third candidate vertex sitting
within 3 px of it (42 a second boundary contact, 34 a duplicate junction),
which the adjacency corridor honours and the strict metric cannot dissolve
because that vertex carries other edges. On the non-misregistered real
images the shape is the same (123 of 371 border misses have a contact 4–12 px
away, 39 a sub-threshold peak, 6 no peak), and the corridor class is larger:
180 spans with both endpoints and strong ink were split through a spurious
interior junction (thick strokes and dense patterns produce many).

### Mechanism 2: missed junctions at short crossing creases

All 118 missed junctions are degree 4 (one degree 6). 97 sit on a predicted
pass-through: the long crease survives as one span through the junction and
the crossing crease is gone, both halves uncovered in 88 of them. The crossing
crease is short: the shorter half has median 14 px (p25 8 px), the longer
half median 31 px. Only 2 sit where two predicted edges actually cross, so
"split at crossings" is not the fix; 9 are displaced 4–8 px, 10 are absent
with all four incident creases missing.

Two levers already exist for this class. The junction re-tune measured in
August (peak floor 0.40 → 0.25, merge radius 3 → 5, +22% candidate exact
topology on native-cp-v1) is commit `b927bc47` on
`claude/crease-pattern-detection-analysis-dee14c` only; main and the product
still run `JUNCTION_PEAK_THRESHOLD_FLOOR = 0.40` and
`vertex_merge_radius_px: 3.0`. In the pool replay, 54 of the 73 missed
junctions in the replayed near cases have a junction-heatmap peak between 0.10
and 0.40 at the truth's position, 18 have a peak at or above 0.40 with no
candidate vertex within 4 px (merged or displaced by the 3 px radius), and
1 has no peak. Of the 438 missing interior creases in those cases, 40% end at
a vertex with such a sub-threshold peak and 15% at a peak ≥ 0.40 that lost its
vertex, so the un-landed re-tune addresses the bulk of this class.
Replaying the same 169 near cases (both groups, under 1,500 creases) with
that re-tune through `dump_candidate_pool` and scoring the selection with the
strict metric: **28 cases become decoder-exact** (27 of them had a missed
junction; 26 rendered, 2 real), 138 stay near, 3 fall to off; 50 cases end
with fewer defects and 27 with more (missing edges 1,652 → 1,602, extra
913 → 891 in total, unmatched truth vertices on the worsened cases 95 → 140),
so the 5 px merge radius swallows some genuinely close vertices while the
lower floor recovers the junctions. The floor alone (0.25 with the product's
3 px radius) makes 25 cases exact but adds spurious junctions the wider
radius was consolidating: extra edges 913 → 1,104, unmatched predicted
vertices 153 → 228, 33 cases worse (wolf 56 → 139 defects). Neither variant
is a free win at the decoder stage; the pair is the better one, and both need
to be judged on strict convergence after the solve, per case, before landing.

## Real images (curated, 61 scored topologies, 40 exact truths)

Decoder exact 18, near 18, off 25. Of the 25 off cases, **9 are not detection
failures**: fitting a homography between the recognised graph and the truth
lifts vertex recall from 0.01–0.32 to 0.88–1.00, and the fitted transform is
the unit paper with one edge pushed out by 35–70 px (crocodile left −35,
water-boatmen top −49, turkey-vulture bottom +31, common-wildebeest right +26,
roadrunner and helmeted-hornbill top −50, swift-dragon top −71 and bottom −63)
or, for the two `full_frame_resize` cases (ubu, u-waluigi001), a uniform
16–21 px margin. Today's decode is identical to the curation-time
`detected.fold` (drift 1.0), so the curator re-cropped and the harness's
auto-rectification did not: a `rectify.rs` quad-edge error that distorts every
angle by a few percent on one axis, after which the solve is refused or lands
wrong. That is the first lever for real images (9 of 61).

Among the moderate curated cases the border mechanism dominates as it does on
renders: salamander 42 of 42 missing creases reach the border, crocodile
(naoki-terao) 34 of 35, hex-tiger 22 of 22, okapi 18 of 20, helioprion 12 of
14, reza-dreamworks-1 10 of 10, pegasus 8 of 8, poison-dart-frog 8 of 8. Three
curated off cases have vertex recall ≥ 0.84 under a homography but < 0.4
without it and a partial fit (roadrunner 0.98, hornbill 0.94, swift-dragon
0.88); the rest of the curated off bucket is genuine detection quality on hard
inputs (thick strokes, dense patterns, `dense_input_evidence` warnings).

## Ranked levers, by strict convergence at stake

1. **Boundary contacts** (decode, `evidence_extract.rs` /
   `junction_carrier_v1.rs`). Present in 145 of 174 rendered near cases and
   most curated near cases; alone blocks 48 uncapped rendered cases and is a
   necessary part of ~90 more, plus most of the capped giants. Candidate
   fixes, in order of evidence: offset-vote clustering for contacts (the
   junction recipe), a contact-threshold sweep, and border-band coverage in
   the training renders for ≤ 25 px stubs.
2. **Paper quad accuracy on real images** (`rectify.rs`). 9 of 61 curated
   cases, detection underneath ~perfect. One-edge errors of 3–7%.
3. **Missed junctions at short crossings** (63 rendered near cases). The
   August junction re-tune, replayed here, turns 28 of 169 near cases exact
   and worsens 27 — a real lever with a regression tail that needs a per-case
   strict-convergence check before it lands; the residual is a model-recall
   question for 8–30 px creases (74% of the missed junctions do have a
   sub-threshold peak).
4. **Free-slide prior in the solver** (≤ 23 cases): tie the polish weakly to
   the input positions so a noisy start resolves the slide the way the exact
   start does.
5. **Compute for giants** (36 capped): the harness cap, not the product,
   stops them, but their compiler stage takes 11–110 s and their solve
   minutes; their defects are border creases again, so lever 1 helps them
   too.

The solver's own conversion rate (91% on exact topology) leaves ~10% and is
mostly the free-slide family; there is no solver work that beats lever 1.

## Lever 1, landed (2026-09-08)

The contact defect turned out to be a systematic bias of the contact head,
not noise: the head fires where the crease stroke meets the border stroke,
which sits along the edge, in the direction the crease leans, by about a
stroke half-width over tan(angle) — +3.1 px in mean at 15–30°, nothing near
90°. Two shallow creases meeting at one contact therefore decode as two ink
corners 6–8 px apart, which is the doubled class. The `boundary_coord` and
`boundary_offset` heads could not help (supervised on one pixel per
contact; `boundary_coord` is 12.6 px off in median). The fix is geometric:
after span proposal, each contact's incident spans give the crease
direction, the ink centreline is fitted across the span at radii clear of
the border stroke, and its intersection with the edge replaces the contact;
contacts that then coincide within 3 px, at least one of them moved, merge.
Details, guards and the sweep table are in
`implementation-plans/cp-detect-boundary-contact-decode.md`.

| | baseline | with re-localisation |
| --- | --- | --- |
| rendered decoder exact | 256 | 298 |
| rendered strict convergence | 265 | 288 |
| rendered contacts the solver still slides over 2 px | 5.1% | 1.6% |
| real-image strict convergence | 17 | 16 |
| harness recovered, both groups | 317 | 335 |

The one real-image loss (reza-squirrel-1) is a correct V merge after which
selection keeps three auxiliary-line creases the harness ignores in the
truth; the rendered loss (wind-dragon) is a solver slide on a design whose
gate reproduces. The full run's curated `recovered 20 → 18` (bat and the
squirrel) raised the right question — a correction tuned on our renders
that fails on real scans — and the curated group cannot answer it. Its
truths are the detection fixed up by eye, and on the seven real cases
replayed their contacts sit a median 0.07 px from the contact head's
position: for contact placement, `recovered` on that group is a regression
test against main's own output, and the solver-slide check is anchored to
the same positions. Judged against the ink instead
(`scripts/cp-detect/contact_ink_referee.py`, an independent centreline fit
on the rectified grayscale, 0.5 px from the design truth on renders), the
corrected contacts sit 0.28 px from the crease's crossing against the
head's 0.93, closer in 70 of 86, and 30 of 32 at creases under 35° — the
same picture as the renders. The exceptions were one image with creases
running into a thick black band, where a lone passing span moved contacts
the referee could not verify; an unreadable incident span now vetoes the
move (the plan has the numbers). An angle gate was tried and dropped: no
correction below 35° keeps 4 of the 41 rendered decoder conversions.

## Lever 2, landed (2026-09-08)

The nine frame errors were the panel finder's choice, not its search: in
every `detect_quad_warp` case the true paper was the finder's first-ranked
candidate (confidence 0.977–0.994, square to 0.994 or better, all four
sides on an edge) and `choose_panel`'s "largest bordered square with
`square_score ≥ 0.9`" took a box one edge wider — a title, a legend, an aux
line off the paper, a page rule — 4–8% off square, or the same-size square
shifted onto the title (swift-dragon). u-waluigi001's paper, found exactly,
was swallowed by `is_full_frame_panel`'s 2.5% tolerance (23 px on 1566);
ubu's by `frame_candidate` firing on mean border support 0.25 from a single
dark image edge. The rules now: the largest bordered box gives way to a
genuine square (within a percent) only when it fills 85% of the box; two
genuine squares within 2% in area tie on their weakest side; the frame needs
every side half on an edge; the full-frame tolerance is 0.5%. Two simpler
forms failed on the renders — a per-side gate (a border crossed by creases
reads 0.74) and a same-size band by confidence (dense grids have a
corner-anchored square a cell inside the far edges) — and the rendered group
caught both. Plan and tables:
`implementation-plans/cp-detect-rectify-paper-quad.md`.

| | after lever 1 | after lever 2 |
| --- | --- | --- |
| curated decoder exact / mean edge F1 | 15 / 0.818 | 16 / 0.943 |
| curated strict convergence | 16 | 18 |
| curated harness recovered | 18 | 21 |
| rendered decoder exact / strict convergence | 298 / 288 | 298 / 288 |

The nine cases' decoder edge F1 went from 0.01–0.24 to 0.82–1.00.
common-wildebeest is exact and converges, ubu converges, roadrunner is
recovered by the harness (3 missing / 2 extra edges at 2 px, strictly), and
the rest are ordinary detection cases now — the border-contact class again
(crocodile 8 missing / 23 extra, water-boatmen 17 / 28).

## Lever 3, landed (2026-09-09)

With the border and the frame fixed, the rendered near cases' defects had
moved inside: 1,175 missing interior creases in 93 of 136 cases, 181
missed junctions in 70, and 126 of those junctions on a crease the decoder
already drew through the point — the head firing there under the 0.40
floor. Four sweeps on the 137 near cases separated the August re-tune into
its halves: the floor at 0.25 converts 28 (with 28 regressions), the merge
radius at 5 px converts 1 and worsens 26 (it merges real close pairs), so
the radius stays at 3 px. The floor's regressions were two mechanisms read
off the dumps: a junction firing twice — a 0.26–0.32 peak 3.6–6.6 px from
the real 0.8–0.95 vertex, with 3–6 px stub spans selected between the pair
— and peaks 3 px inside the paper edge at 0.26–0.45 where a crease meets the
border (one case went from 14 to 82 defects). A peak under 0.40 now merges
into any vertex within 8 px, and a peak under 0.50 within 6 px of the edge
makes no vertex; real junctions that close to the edge all fire at 0.49 or
more. Plan and sweep table: `implementation-plans/cp-detect-junction-weak-peaks.md`.

| | after lever 2 | after lever 3 |
| --- | --- | --- |
| rendered decoder exact / strict convergence | 298 / 288 | 328 / 314 |
| curated decoder exact / strict convergence | 16 / 18 | 18 / 18 |
| decoder cases moved the wrong way | | 0 |
| strict conversions gained / lost | | 29 / 3 |

The three losses: pegasus, whose caption text under the paper now yields
two junction peaks, and two renders whose recognised graph is unchanged
to the vertex and whose solve lands elsewhere — the free-slide noise, set
off by the sub-pixel shift the lower vote threshold gives every junction's
centroid. (A contended first run also read pseudoscorpion `failed`; alone
it solves and is recovered — the harness's 25 s solve budget under load.)
The lever costs no time: on sixteen cases run alone with one worker, the
compiler stage took 321 s against 396 before and the exact solve 57 s
against 63. Two conversions the floor alone made are given back by the weak
merge (fox-girl, rhino-beetle: a real close pair with a weak member) and one
by the border rule (horse-1-1); those are the known cost.

## Lever 4, landed (2026-09-09): the box-pleat grid as a prior for the border

Of the 69 box-pleated cases (65 renders, 4 real images; the family read
from the truth's crease angles, at least 97% at multiples of 45°), 31 have
a thousand creases or more, and those giants are where the rendered losses
concentrate: 1,131 missing creases over 49,078, 719 of them the last cell
of a grid line from the first interior junction to the paper edge. The
line evidence sees them (median support 0.88 along a lost border crease,
the same as along a found one) and the contact head does not (median peak
0.28 against 0.89 at a found contact; 1% over the 0.50 floor); 93% sit on
a grid position. Lowering the floor for everyone had already failed (the
0.30 sweep: three cases gained, two real-image solves broken by contacts
beside a corner), so the admission is restricted to where a box-pleat
design licenses it.

The prior is read from the candidate graph after span proposal and contact
re-localisation (`candidate_generation/grid_prior.rs`): the family from
the proposed spans' angles (spans of 12 px or more that pass the line
gate, at least 85% within 5° of a multiple of 45°), the grid from the
interior junctions, and its hold on the border from the contacts the head
found. The grid fit needs a chance correction: with a 1 px band either
side of every line, a 160-cell grid covers a third of the edge by chance
and the raw fit picks the top of the range on every design; the corrected
score (fit above chance, rescaled) with a 0.02 margin for the coarser
grid finds the truth's grid or a divisor of it on 48 of 52 pool cases. At
every empty grid position on each side, a crease may leave the edge along
the grid line or either diagonal: the line evidence along the first cell
must average 0.5 and be a **ridge** — 0.15 above the same reading 3 px to
either side along the edge, which is what separates a crease from the
solid ink between two strokes of a 7.5 px pleat (without it, 29 spurious
contacts on dwarf, basilisk and mantis-shrimp, every one with a ridge of
0.03 or less against 0.31 at the true completions' tenth percentile) —
must reach a candidate vertex within 3 px of the ray between half a cell
and four cells in, and the span to it must pass the adjacency gate. The
contact head's peak is recorded, not required: a floor of 0.05 gave up a
third of the true completions for nothing.

On the candidate pools of the box-pleated cases (the selected spans against
the truth, strict at 2 px, tokyo-skytree excluded as over the cap):

| 68 cases | grid prior off | grid prior on |
| --- | --- | --- |
| rendered decoder exact / near / off | 32 / 27 / 2 | 40 / 20 / 1 |
| real images exact / near | 2 / 2 | 2 / 2 |
| cases to exact / lost exact | | 8 / 0 |
| cases with fewer / more defects | | 24 / 0 |
| missing creases / unmatched truth vertices | 7,391 / 2,614 | 6,305 / 2,164 |
| cases with a prior; contacts completed, of them within 2 px of a truth contact | | 60; 443 / 443 |

The eight conversions: centaur-3-0, diamond-sword, earwig, genos, girl-6,
origami-by-xiao-dai, rat-skeleton, skeleton-shrimp. The largest defect
reductions are the giants: arowana 181 → 19, batmobile 145 → 8, carp 155 →
60, tank-girl 107 → 32, dark-magician 187 → 114. The four extra unmatched
predicted vertices (basilisk-1-2, dwarf) are not the completed contacts,
which all match; they are selection changes downstream on two 128-grids.

On the full curated benchmark (run `2026-09-09-bp-grid-prior`, scored
strictly against the work-budget run):

| | after lever 3 | after lever 4 |
| --- | --- | --- |
| rendered decoder exact / strict convergence | 328 / 314 | 338 / 319 |
| curated decoder exact / strict convergence | 18 / 18 | 18 / 18 |
| decoder cases moved the wrong way | | 0 |
| strict conversions gained / lost | | 5 / 0 |

Ten rendered cases went near → exact and one off → near (dark-magician,
131 → 82 missing creases). Five of the exact decodes converge strictly
(centaur-3-0, dorcus-titanus, genos, girl-6, rat-skeleton). Four are over
the solve's crease cap (diamond-sword, earwig, origami-by-xiao-dai,
skeleton-shrimp): exact graphs waiting on the compute lever. One,
wizard-by-ryo7262 — a hybrid whose diagonals run at 1:2, family vote 0.90
— decodes exactly and its solve rejects its first stage where it had
accepted a wrong answer on the near graph: the start has an 8.6° Kawasaki
error at the junction one cell inside the top-left corner, identical in
both runs (the same six creases at the same angles), and the exact graph
leaves the solver no unconstrained vertex to absorb it. Not a regression
in `recovered`; an honest failure where there was a wrong answer. The
real images are untouched: three of the four box-pleated ones show no
prior (too few spans to vote, or a grid the junctions do not confirm) and
executioner's 28-cell grid finds nothing to complete.

## Harness findings to fix alongside

- `end_to_end.recovered` scores strict topology and assignment on
  `pipeline.fold` at 2 px since 2026-09-09; the vertex-correspondence
  verdict it replaced had 34 cases recovered with a different topology and
  8 with a wrong M/V.
- 38 of the 317 harness-recovered solves are `ambiguous`; the product does not
  auto-apply those (Review & Fix is primary, "add improved" secondary), so the
  product converts fewer than the harness says.
- The harness's solve budget is a work count since 2026-09-09 (5·10⁸
  vertex²·checks, the 25 s the clock used to allow), so its verdicts no
  longer move with the machine's load; it still ends the largest solves
  `ambiguous` at the budget, where the product, which has had no deadline
  since 2026-09-02, keeps going.
- The 1,500-recognised-edge cap skips 30 giants the product would attempt.
- The curated group's contact positions are the detector's; a change to
  contact placement has to be judged against the ink (above), or the two
  affected cases re-curated from the corrected detection.

## Tools added (uncommitted on `claude/crease-pattern-bottleneck-592cda`)

- `crates/oristudio-cp-eval/examples/strict_diff.rs`: the crate's strict
  topology diagnostics for a list of FOLD pairs, one JSON line each.
- `crates/oristudio-cp-detect/examples/dump_candidate_pool.rs`
  (`native-inference`): rectify, infer, extract evidence, generate the
  junction-first pool, run the product selection, and write per case the
  candidate vertices and spans, conflicts, selection verdict, the three dense
  maps as PNGs and every junction / contact peak down to 0.10.
  `JUNCTION_PEAK_THRESHOLD` and `VERTEX_MERGE_RADIUS_PX` env overrides for
  sweeps (and `CONTACT_THRESHOLD`, `CONTACT_RELOCALIZE=0`, `CONTACT_MERGE_PX`
  for the contact decode); the rectified input goes beside the maps as
  `<case>.rect.png`, and the full rectification report — mode, chosen quad,
  every ranked panel candidate with its per-side border support — as
  `<case>.rectify.json`. Its selection reproduces the harness's decoder
  buckets on 101 of 102 checked cases.
- `scripts/cp-detect/contact_ink_referee.py`: judges moved boundary
  contacts against the crease's ink centreline on the rectified grayscale,
  from two dumps (re-localisation off and on); the check the curated truths
  cannot make.
