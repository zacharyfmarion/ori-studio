# Precrease grid: only the lines, and only the stretches, the pattern needs

## Goal

The grid step pleats the finest grid that contains every gridded crease, over
the whole sheet. On Travis Nolan's *Alebrijes* that is a 64-grid on a sheet
that is a 16-grid nearly everywhere: 63 lines each way, 33 of them in no
crease at all, and the 30 the pattern does hold creased edge to edge when
their creases occupy a tenth of their length. A folder precreasing that sheet
by hand pleats 16ths, adds 32nds across the middle half, and creases 64ths in
the central square only — three instructions, and a model without sixty
creases it never uses.

That is the target: **a grid step makes the lines the pattern uses, at the
resolution each part of the sheet needs, creased only across the stretch that
needs them.** Lines the pattern does not hold and no step sights from are not
made. The trade the plan has to keep honest is that many of those lines *are*
sighted from today (on *Alebrijes* c0, 12 of its 18 grid-only lines, by 21 of
its 65 folds), and a line that is not there costs a fold, a different
witness, or a press later. The measurement gates below are how the trade is
decided on the corpus rather than by taste.

Reviewed once already (three lenses, two refuters a finding; 23 findings
held): what follows is the corrected design. The first draft's corpus table
did not reproduce and is gone; its witness counts were wrong and are
corrected below; its shared-per-level regions, its ≥ 3-line prune, its
alternation on region steps and its stage-2 mechanism were each shown to
fail on the corpus or against the code, and are replaced.

## What the corpus says

Measured with `grid_scan -v` at HEAD over the curated benchmark plus
*Alebrijes*: 18 gridded sheets, 41 families, 949 lines made, 314 of them in
no crease. A replay of the rules below (per-family bands, exact for the box
grids) leaves about 47 unwanted lines. Per sheet of *Alebrijes* (each family):
the two 32-grids go from 31 lines / 9 unwanted to 23 / 1 (16ths whole, 32nds
across the middle half); the 64-grid from 63 / 33 to 31 / 1 (16ths whole,
32nds across the middle half, 64ths across the middle quarter); the 16-grid
is unchanged (15 / 1). The one unwanted line left per family is a halving
parent — the vertical ½, and the horizontal 7/16, which 13/32 and 15/32 are
folded between — so it stays. frog-on-lilly, a 32-grid vertically and seven
horizontal lines in a strip, goes from 62 / 25 to 31–39 lines and at most 3
unwanted, depending on the band merge; secretary-
bird's 13ths (7 of 12 used each way) and the iguana fixture's 25ths (8 of 24)
are the residue, and are odd bases the rules below also treat as levels.

Along the lines: on the 64-grid sheet the 64ths carry pattern creases over
0.09–0.22 of their length, all inside one central rectangle (x ∈ [0.39,
0.61], y ∈ [0.45, 0.67]); the 32nds over 0.19–0.44, inside the middle half.
Creased edge to edge, the 64ths alone put twelve sheet-lengths of crease
where the model has none.

The lines the pattern lacks are sighted from. Reading every presented witness
against the grid-only lines — an input that is a point on the line
(`PointEntry.lines`) or the line itself — *Alebrijes* c0 sights from 12 of
18 by 21 of its 65 folds (the horizontal 3/32 line alone by seven steps; the
bottom-band 32nds, which "the middle half" drops, by ten); c1 15 of 18; c2 33
of 66; c3 2 of 2; turtle 4 of 5; mr-rocket 7 of 8; frog-on-lilly 9 of 25;
origami-larper 16 of 22; secretary-bird 6 of 24. Those are the closure's
chosen witnesses with the whole grid on the paper; with fewer lines it
chooses others where it can. Where it cannot, the step is re-witnessed by the
stuck search or lands on a press, and both are counted (§Measurement).

## Approach

### The model: per-family levels, bands and extents

A family's lines sort into **levels** by the halving they come from, per
family from its own `cells` (a 2:1 sheet's second family halves from 8, not
from `n`): for `cells = q · 2^a` with `q` odd, the levels are `q, 2q, …,
cells`, and a level's own lines are the multiples of `cells / r` that are not
multiples of `cells / (r/2)`. An oblique hex family has no cells; its lines
are levelled by the 2-adic valuation of the index measured from the family's
corner-anchored line (`k − k_anchor`), and a family anchored half a cell in
(`phase = spacing / 2`) is one level.

Every (family, level) has a **region**: a set of **bands** (index intervals
of that level's lines) each with an **extent** (an interval along the lines).
It is computed from that family's own lines, finest level first:

1. **Need.** A level-`r` line with pattern creases along it needs the band
   cell it sits in (between its two level-`r/2` neighbours) over the stretch
   its creases span — the target's snapped spans, not the chord. Bands are
   the union of needed cells, merged across a gap of one cell; the extent of a
   band is the union of its lines' stretches.
2. **Dependency, within the family.** Halving needs the parents: the
   level-`r/2` region covers the level-`r` region, bands and extents both, so
   the two lines a region line is folded between are on the paper, creased
   where it is creased. The half line therefore exists wherever anything
   finer does — the technique needs it, and a pleat with no centre line is not
   a pleat (the first draft's prune removed it).
3. **Bounds.** A band's ends are lines of the same family's coarser levels
   (its parents' level or coarser) — what the folder can see: "between the ¼
   and ¾ lines". An extent's ends are snapped outward to the nearest line of
   another family that is made across that crossing: a whole pleat line
   always qualifies, a region line only where its own extent covers the
   crossing, and the sheet edge always does. Bands and extents are named by
   fraction of the side for an axis family, and by "the 4th and 12th of the
   family's 21 lines" for an oblique one.
4. **Pleat or region, by lines.** A level whose bands hold at least three
   quarters of the level's lines, or all but two, is **pleated whole** — edge
   to edge, both ways; consecutive whole levels of a family collapse into one
   pleat step, today's "Pleat the sheet into 16ths vertically". A level that
   leaves out a real share (*Alebrijes*' 32nds, 8 of 16; its 64ths, 8 of 32;
   frog-on-lilly's horizontal 32nds, 3 of 16) is a **region step**. Turtle's
   vertical 16ths (6 of the level's 8 lines in the band) and mr-rocket's
   horizontal 16ths (6 of 8) are pleats: a second step to save two creases
   is a bad trade.
5. **Prune, region steps only.** A region step with fewer than three lines is
   not a step: that level and every finer level of the family are demoted to
   ordinary targets, and the closure folds them as it folds any line — "fold
   the edge onto the ¼ line" is one card, and a better one than a pleat of
   one. A pleat is never pruned.

An odd base `q ≥ 5` (13ths, 25ths) is not a halving and is treated like any
other level: pleated whole if it uses three quarters of its lines, a region
step otherwise, with the sheet edges as its bounds — its lines are made by
folding the edge onto a reference, and a folder can stop at the strips
needed as easily as with a halving.

**Direction.** A pleat alternates over its lines with the phase that
disagrees with the pattern over the least creased length — today's rule; its
sentence says so and `reversed` counts the lines the pattern wants the other
way. A region step's lines are not adjacent on the sheet (a parent sits
between each pair), so "alternating" would name a rhythm with no physical
meaning and force half the lines against the pattern (*Alebrijes* c2's
horizontal 32nds are all valley; the first draft's rule read "8 lines,
alternating … 4 of them the other way"). A region line takes the pattern's
own majority direction (`pattern_direction`, `pattern_share` for a mixed
line, exactly as a CP step reports it); a line the pattern lacks takes the
step's majority; the sentence says "creased as shown"; `reversed` is 0 by
construction.

**Witnesses.** A pleat line has none — it is made by pleating, as now. A
region line carries a real witness: the O3 fold of its two parents onto each
other, which `found_witnesses` can certify since both are in the state. So a
region line has a sentence of its own when one is needed — a press on it
reads "Fold A onto B again and crease the part shown" through the existing
press machinery, rather than the "This line is already on the sheet" a
witness-less press produces today — and the invariant that a step is sighted
from marks on the paper can cover region steps: their parents are on the
paper before them.

**Order.** Pleats first, one per family; then region steps, coarse to fine,
families interleaved; then the closure's steps as now. Grid steps are
numbered and grouped in `planner.rs::grid_steps` (with `group`,
`step_of_line`, `exact_lines` and `unlocks`, which iterate them); `order.rs`
never places a grid line and needs no ordering change.

### Stage 1 — which lines

Bands only: every band's extent is the whole chord. `Closure::fold_grid`
takes the levels and adds each step's lines — as the target where the pattern
has the line, as `LineTag::Grid` elsewhere, `GridRef { family, level, line }`
— and nothing outside the bands, with `add_whole` as today. The closure, the
stuck search and ReferenceFinder run over that state unchanged. Demoted
lattice lines are plain targets and get plain folds; a grid-only line a step
used to sight from is not there, and the closure picks another witness or the
stuck search makes an auxiliary line the pinch pass may cut to a pinch.

### Stage 2 — how far along

Extents. Four readers of "where is this grid line creased" have to agree, and
the first draft changed one:

- `GridLine.spans: Vec<[[f64; 2]; 2]>` carries the creased extent — a list,
  because a line in two bands of one region is creased in two runs, and one
  `segment` cannot say so. `GridStepLine.spans` carries it to the bridge;
  `segment` stays the chord.
- `Closure::fold_grid` records it with `Creased::add_spans`. The state's line
  is whole, so every lattice point on it exists as a witness.
- `order.rs::record` builds the ordering pass's own `Creased` and today sends
  every line with `f.grid` to `add_whole`; it reads the spans instead. This
  is the reader the presses come from: a later step sighting from a point off
  the extent gets it the way any mark off a creased run is got —
  `presses_for_mark` — with one preference added: on a grid line, extend the
  crease from its run end past the mark to the edge rather than pinch it in
  isolation, which is what a diagram says ("extend the crease to the edge").
- The two replays in `tests/planner_direction.rs` — the sighting invariant,
  which today inserts every grid line into `whole`, and the press test, which
  adds only a grid step's first line — replay every `GridStepLine` by its
  spans; `examples/measure_ends.rs` the same. A unit test in `order.rs` puts
  a witness point on the uncreased stretch of a region line and asserts a
  press: case (a) a pinch sighted from the crossing line that reaches it,
  case (b) the run-out.

Press cards draw `StepPress.sighted_from` as a highlighted line, which
nothing on the web side reads today. `Totals.presses` and the count of
presses on grid lines are the stage's signal: a region cut too tight shows up
there.

Stage 2 is for box grids. An oblique family's extent would be bounded by its
crossings with the axis family's made lines, which is a different rule; hex
grids get stage 1, whole chords, until that is designed.

### Stage 3 (optional) — pinches for a halving parent

A pleat line the pattern does not hold and nothing finer halves between
(*Alebrijes*' vertical ½ on all four sheets; not its horizontal 7/16, which
13/32 and 15/32 need) could be a pair of edge pinches. The pinch pass cannot
do it — it never sees grid lines, and its pinches are marks around consumed
points, not edge marks — so it would be `GridLine.spans` as two edge spans,
recorded with `add_pinch`, and then a check of which later witnesses use the
line *as a line* (O3, O4, O7 inputs, `witness_alignment` / `crease_reaches`),
which a pinched line can no longer serve. Decided from `measure_grid`'s
per-family count of such lines; one per sheet on *Alebrijes* says no.

### Sequence and bridge

`GridStep` gains `level: u32` (the level's cells: "32nds"), `pleat: bool`
(whole sheet, levels collapsed; `cells` then names the finest, as today) and
`regions: Vec<GridRegion { band: [i32; 2], bounds: [GridBound; 2], extent:
[f64; 2], along: [GridBound; 2] }>` where a `GridBound` names a line (family,
index, fraction of the side) or an edge, for the sentence and the card.
`GridStepLine` gains `spans`; `witnesses` / `chosen` are set for region
lines. `GridSummary` gains `levels` and `steps`. `Totals` gains
`grid_unwanted_length` — creased length on grid lines the pattern has no
crease on, in sheet units — and `grid_presses`.

`PlannerOptions.precrease_grid: bool` becomes `precrease_grid: GridMode {
Off, Whole, WhereNeeded }`, default `WhereNeeded`; the options JSON keeps
`precrease_grid` as a bool and adds `grid_where_needed: bool`, so an old
caller still gets a grid. The TS types follow (`PrecreaseGridStep.level /
pleat / regions`, `PrecreaseGridStepLine.spans`).

### Browser

- Settings: a second toggle under **Precrease grid**, *Only where needed*
  (default on, disabled when the grid is off), keyed on the plan record like
  `precreaseGrid` is, so a toggle mid-run is never swallowed
  (`useReferencesBreakdown.ts`, `ReferencesSettingsMenu.tsx`, the store).
- Sentences (`referencesStepSentences.ts`): the pleat sentence as today; the
  region sentence names the level, the direction, the band ("between the ¼
  and ¾ lines"), the extent when it is not edge to edge ("from the ⅜ line to
  the ⅝ line"), the count, and "creased as shown"; several bands are listed.
  A press on a grid line gets the witness sentence with "crease the part
  shown". Eight locales, ordinal cells as today.
- Cards and canvas (`plannerDiagram.ts`, `diagramFrames.ts`,
  `referencesPlanGeometry.ts`): a region step draws its lines over their
  spans, its bounds in `highlight`, and the region as a light fill — a new
  `region` primitive (`StepDiagramPrimitive`), under the lines on the card,
  an outline on the canvas; region corners travel through `planModelPoints`
  / `decodePlanModel`. `plannerDiagram.creasedSpans` already complements
  against the line's drawn geometry, so the grey uncreased stretch follows
  from `spans` without a rule change; `modelFrame.gridLines` recovers
  `cp_spans` as ratios along the drawn segment, which stays right only
  because every `cp_span` lies within the line's spans — asserted in a crate
  test. `gridLines(step)` and the sighting replays iterate `spans`.
- Filmstrip badge stays "Grid"; `folding steps completed` gains
  `grid_steps_bucket`, `grid_presses_bucket` and `grid_unwanted_bucket`
  (creased length on lines the pattern does not hold, in tenths of a
  sheet-length); `docs/analytics.md` updated.

### Measurement

`examples/measure_grid.rs`: per design and mode — `whole`, stage 1, stage 2
— lines made, lines not in the pattern, unwanted creased length, steps,
turn-overs, presses and presses on grid lines, re-witnessed steps (a step
whose chosen witness differs from the whole-grid plan's), lost ends,
findings, and the per-family count of unwanted pleat lines (for stage 3).
Run over the curated corpus, *Alebrijes*'s four sheets and the `PLEATED`
fixtures before anything changes — the baseline replaces the table the first
draft could not reproduce — and after each stage, recorded in the checklist.
Gates:

- Stage 1 ships if unwanted lines fall by at least half on the pleated corpus
  and the lines saved are at least four per step added. Every design whose
  level count rises is read by hand, not only those whose steps rise 20 %.
- Stage 2 ships if unwanted creased length falls by at least a third more,
  presses on grid lines stay under 5 % of steps, and stage 1's unwanted-line
  gate still holds (a rule that re-makes lines to bound an extent is caught
  here). (Outcome: see the checklist — the length gate held on the
  motivating design and not on a corpus whose bands mostly run edge to
  edge; the press and line gates held everywhere.)

## Affected Areas

- `crates/oristudio-precrease/src/grid.rs` (levels per family, bands,
  extents, bounds, pleat/region, prune), `closure.rs` (`fold_grid` over
  levels; `add_spans`; region-line witnesses; `GridRef`), `planner.rs`
  (`GridMode`, options JSON, `grid_steps` per (family, level) and its
  ordering; `group`, `step_of_line`, `exact_lines`, `unlocks`), `order.rs`
  (`record` reads spans; grid-line press preference), `sequence.rs`
  (`GridStep.level / pleat / regions`, `GridRegion`, `GridBound`,
  `GridStepLine.spans`, `GridSummary`, `Totals.grid_unwanted_length /
  grid_presses`), `marks.rs` (stage 3 only); `examples/grid_scan.rs`,
  `measure_ends.rs`, new `measure_grid.rs`; `tests/planner_grid.rs`,
  `planner_direction.rs` (both replays), `planner_fixtures.rs`,
  `tests/fixtures/precrease/manifest.json` (`grid.levels`).
- `crates/oristudio-precrease-wasm` (options JSON), `apps/web/src/generated`
  rebuilt (`build:oristudio-precrease-wasm`).
- `apps/web/src/cp-workspace/references/`: `precreaseSequence.ts`,
  `precreasePlan.wasm.test.ts`, `referencesStepSentences.ts`,
  `diagram/plannerDiagram.ts`, `diagram/diagramFrames.ts`,
  `referenceFinderDiagramToPrimitives.ts` (`region` primitive),
  `diagram/DiagramPrimitives.tsx`, `diagram/diagramToScene.ts`,
  `referencesPlanGeometry.ts`, `useReferencesBreakdown.ts`,
  `ReferencesSettingsMenu.tsx`; the store slice and types;
  `analytics/events.ts`, `docs/analytics.md`; eight locales.

## Checklist

- [x] `measure_grid.rs`, and the baseline. Over the curated corpus (its
      three `.fold` files a design), *Alebrijes*'s four sheets and the
      fixtures, the whole grid: 2,154 grid lines, 630 of them in no crease,
      1,248.6 sheet-lengths of unwanted crease, 106 grid steps, 2,339 steps,
      125 turn-overs, 128 presses, 26 lines unsolved.
- [x] `grid.rs`: levels per family from `cells`; bands from need +
      dependency, merged across one line; bounds; pleat-or-region by line
      share; the region-only prune with demotion; an oblique family stays
      one pleat. Tests on the fixtures, the synthetic middle-band, most-of-a-
      level, thin-band, half-line, odd-base and whole cases; every band's
      bounds are on the paper before its step, or are positions for an odd
      base, and every pleat keeps its half line (`planner_grid.rs`,
      `grid.rs`).
- [x] Stage 1: `fold_grid` over the lines the steps make, whole chords;
      `GridStep.level / pleat / regions`, `GridSummary.steps`,
      `Totals.grid_unwanted_length`; band-step directions from the pattern;
      the band sentence, the card's wash and highlighted bounds, the
      *Only where needed* toggle keyed on the record, the analytics
      properties. **Measured** (`measure_grid`, same corpus): grid lines
      2,154 → 1,772, lines in no crease 630 → **275** (−56 %), unwanted
      crease 1,248.6 → 873.5 sheet-lengths, grid steps 106 → 125, steps
      2,339 → 2,390 (+51: +19 of them the band steps themselves), turn-overs
      125 → 135, presses 128 → 132, unsolved 26 → 26. **7.0 lines saved per
      step added**, against the gate's 4. *Alebrijes*: c0 62 → 46 grid lines
      (18 → 2 unwanted), c2 126 → 62 (66 → 2), steps 67 → 69 and 83 → 87 —
      exactly the band steps, no fold added. Read by hand: frog-on-lilly's
      seven horizontals are a pleat of quarters and five closure folds
      (steps 54 → 59, for 28 lines and 24 unwanted creases saved);
      secretary-bird's 13ths and 26ths are bands (111 → 115); the rest are
      the band steps and one or two folds. One thing the numbers say that
      the gate does not price: `hard` witnesses rise 385 → 422, because a
      diagonal folded from a 64th mark on the edge is folded from two
      interior lattice marks once the 64ths stop short of the edge — a fold
      a folder with a precreased grid makes routinely, but one
      ReferenceFinder's visibility rule flags, and the cards say "fold P onto
      Q" for it either way. Region-line witnesses (the plan's O3 of the two
      parents) are not made: with whole chords nothing presses a grid line,
      and they are stage 2's to add with the extents that need them.
- [x] Stage 2: `GridLine.spans` through all four readers (`fold_grid`,
      `order::record`, both replays in `planner_direction.rs`,
      `measure_ends`), every position measured on the family's own axis
      because a pattern line's normal may point the other way; a band's
      extent is the hull of its lines' pattern spans and of what finer bands
      halved between them need, snapped outward to a whole pleat line of
      another family or the edge; the wash on the card is cut to it, the
      sentence says "from the 3/8 line to the 5/8 line", `cp_span ⊆ spans`
      is asserted in the crate and over the bridge. **One departure from the
      design above:** no press ever lands on a grid line. Instead of
      region-line witnesses and a press preference, `Planner::settle_grid`
      runs the ordering pass, folds every press that landed on a grid line
      into that line's extent — out to the nearest end findable on the paper
      the grid left — and runs it again until none does; the closure's state
      is the same lines either way, so the plan is stable under it. That is
      "the folder creases that far in the first place", with no card for it.
      **Measured** (same corpus): unwanted crease 1,248.6 → **832.6**
      sheet-lengths (stage 1 left 873.5), steps 2,339 → 2,389, presses 128 →
      131, presses on grid lines **0**, unsolved 26 → 26, and stage 1's
      275 unwanted lines untouched. The gate as written — a third more off
      the unwanted length — is **not met corpus-wide** (4.7 % more): most of
      the corpus's band lines carry pattern crease nearly edge to edge, so
      their extents snap to the edges and nothing is cut. Where the pattern
      is local it bites as designed: *Alebrijes* c2 40.6 → 20.6, c0 27.1 →
      19.1 (the 64ths creased across the central quarter only, the 32nds
      across the middle half). Shipped on that and on its cost, which is
      nil: no fold, no press, no card. Stage 3's premise is unchanged.
- [ ] Reviewed (three lenses, two refuters a finding) before either stage is
      called done.
- [ ] Stage 3 decided from the stage-2 numbers, and either done or written
      off here with the count that decided it.
