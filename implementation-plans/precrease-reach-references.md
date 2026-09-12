# Precrease steps: one crease per line, from reference to reference

## Goal

A precrease step creases exactly the pattern's segments on its line and
nothing else. Where the pattern's crease stops short of anything, the step
stops there too, and a card says *fold corner to corner* over a picture of a
crease that begins and ends in blank paper. On Xiao Dai's *Abra* the first
three steps show both halves of the defect:

- Step 1 folds the sheet in half — "fold corner Sw onto corner Se" — and
  creases the midline from `y = 0.207` to the top edge. Step 2 folds it in
  half the other way and creases from the left edge to `x = 0.793`. Each
  leaves one end of the crease nowhere a folder can find.
- Step 3 folds corner to corner along the main diagonal, and the pattern
  holds that diagonal in three runs — from the corner to (0.104, 0.104),
  from (0.25, 0.25) to (0.75, 0.75), and from (0.896, 0.896) to the far
  corner — so the card shows three dashes with 0.41 of blank paper between
  them and four ends in the middle of nowhere. Steps 14 and 57 are then
  **presses on the same diagonal**, to put marks in the gaps that later
  steps sight from. A diagram folds that diagonal once, corner to corner,
  and neither press is ever needed.

A diagram's instruction is a whole crease with a reference at each end: the
sheet's edge, or a crease already there. Where the pattern's own crease has
no such end, a diagram creases *more* than the pattern asks — out to the
nearest reference — rather than asking the folder to stop at a spot on blank
paper. That is the target: **a CP step creases one run on its line, from the
pattern's first piece to its last, and each end of that run is carried
outward to the nearest reference the folder can find at that moment.** Any
later press for a mark on that line falls away, because the crease is
already there.

`measure_ends -v` names the defect on *Abra* at HEAD: 22 of the plan's 168
crease ends are nowhere to be found (13.1%), 9 of its 74 CP steps are made
in pieces with 3.5 sheet-lengths of blank paper between the pieces, and 12
of its 86 steps are presses. The plan below makes the first two numbers
zero by construction and measures the third. Its cost, estimated on the
plan as ordered today, is 5.3 sheet-lengths of crease the pattern does not
contain — 3.5 of it the blank between pieces, 1.8 the extensions — and the
longest single extension is 0.21, step 1's midline carried to the bottom
edge. Fifteen ends extend; the other seven lost ends are interior to a hull
and vanish with it.

## What the code already knows

The machinery is in place; it is applied to presses and not to folds.

- `marks::end_is_found` is the rule for a findable end: on the sheet's
  boundary, or on a line creased there that crosses this one squarely
  (`MIN_ANGLE_SINE`). `settled_end_is_found` is the same rule counting only
  lines whose extent is settled — an edge, a CP line, a grid line — because
  an auxiliary line is recorded as creased along its whole chord until the
  pinch pass reduces it to marks, so a crossing with one is not a promise.
- `order::press_span` already searches outward from a run end **past a mark
  to the nearest findable end** ("stopping at the mark would be the original
  defect moved from the mark to the crease end"), by exactly the settled
  rule. It is only ever run for a press.
- `Placed.pressed_on` / `Step.pressed_on` is crease a step makes past the
  pattern's own because a later step lines up against it, absorbed into the
  making step when the far end was findable at the time (`make_marks_real`).
  The web draws it in the step's made style (`plannerDiagram.ts`) and the
  card says so in one sentence.
- `marks::crease_runs` merges a line's pieces into runs, and the grid's
  stage-2 extents (`grid::snap_outward` to `grid::stops()`) already carry a
  band line's ends out to the nearest crossing with another family's pleat
  line or the sheet's edge — the same rule, for grid lines only.
- The closure prefers targets whose pattern ends are findable
  (`Closure::ends_findable`, `prefer_findable_ends`); a target that never
  passes is folded anyway, with its ends lost. That preference is measured
  by `measure_ends` at 9.9% lost ends with it and 12.2% without over four
  designs; the preference moves the number, it cannot make it zero.

What is missing is one rule, applied when a CP fold is recorded on the paper
in both places the paper is kept — the closure's `record_crease` and the
ordering pass's `record` — and one field on a step that says how far it
creased.

## What the corpus says

`measure_ends -v` at HEAD over the curated benchmark, *Abra*, *Wolpertinger*
and the crate's fixtures — 56 designs, 4,512 steps, through
`plan_without_reference_finder`, so ceilings: 863 of 8,630 crease ends are
nowhere to be found (10.0%), 588 CP steps are made in pieces with 195
sheet-lengths of blank paper between the pieces, and 711 steps are presses
(53.5 sheet-lengths of crease). The worst sheets are the ones with the most
steps — *markhor-detailed* 88 lost ends and 41 steps in pieces of 231
steps, *frigate-bird* 59 and 25 of 196, *Wolpertinger* 47 and 40 of 169.

The rule's estimated cost on today's order: joining the pieces is those 195
sheet-lengths, and carrying the 573 lost hull ends out to a reference adds
111 more — 233 of them under 0.1, 192 between 0.1 and 0.25, 97 between
0.25 and 0.5, 48 between 0.5 and 1, and 3 over a sheet-length. The long
ones are the first steps on a blank sheet: *halibut*'s step 1 folds corner
Se onto corner Nw and the pattern wants 0.12 of that diagonal at one
corner, so the rule creases the whole diagonal, 1.29 more than the pattern
has. That is "fold in half diagonally", which is how a diagram opens — but
it is also a crease across the finished model that the pattern does not
contain, and it is the case the by-hand reading in §Measurement is for.

## Approach

### The rule: *reach*

For a CP fold along line `L` whose target holds pattern spans `S` (non-empty;
an empty `S` is the whole chord and already ends on the edge), against the
paper `P` as it stands when the fold is made:

1. **One crease.** `runs = crease_runs(L, S)`, sorted along `L`. The step
   creases `[t_lo, t_hi]` = from the start of the first run to the end of
   the last: the pieces and the blank paper between them.
2. **Each end reaches a reference.** If `settled_end_is_found(P, L,
   point_at(t_lo))`, the low end stays. Otherwise it moves *outward* — never
   inward — to the nearest `t < t_lo` at which it would be found: the
   sheet's boundary (`clip_parameters`), or a crossing with a line of
   settled extent (tag `Edge`, `Cp` or `Grid`, never `Aux`/`RfAux`) that
   crosses `L` squarely and is creased at the crossing (`Creased::reaches`).
   The high end the same way, toward `t > t_hi`. The boundary always
   qualifies, so the search always terminates on the sheet.
3. The step's crease is recorded on the paper as that one run and reported
   as `Step.made`.

Every CP step then has both ends findable at the moment it is made, by
construction, and no CP step is made in pieces. This is `press_span`'s
far-end search factored out and run for the fold itself: a press ran from a
run end past a mark to a findable end; a fold now runs from reference to
reference in the first place. Presses for marks *on the fold's own line*
that the hull covers disappear; presses for marks beyond the reach, and
`presses_for_lines` for alignment further out, still work exactly as now
(they start from the larger runs, so they are shorter) and `pressed_on`
still absorbs them when it can.

The rule extends *outward only*: it never shortens the pattern's crease, and
it never crosses the boundary. Its cost is crease the pattern does not
contain — the blank between pieces plus the two extensions — and that cost
is measured, per step and in total, not reasoned about.

### What is deliberately not done

- **No cap on the extension.** A short crease in the middle of the sheet
  with no reference nearby is extended to the edge. That is the bias the
  request asks for ("fold more line than is actually necessary"), and it is
  what a diagram does; the alternative — stop somewhere on blank paper — is
  the defect. The extension is bounded by the sheet, and its length is
  reported so the worst cases can be read by hand. If the reading says a
  cap is wanted, it is one constant in `marks::reach` — and it must mean
  *leave the end where the pattern has it* when the nearest reference is
  further than the cap, never *stop part way*: a crease carried half way
  to a reference has a lost end and more crease, the worse of both. The
  finer alternative, if the long extensions turn out to be ends nothing
  later sights from, is to extend only an end a later step uses — that
  keeps *halibut*'s step 1 a corner crease, at the price of a rule the
  reader has to know about. Not first.
- **Nearest reference, not best.** An end 0.02 from the edge with a
  crossing 0.01 beyond it stops at the crossing. Preferring the edge when
  it is within a hair is a refinement to measure separately, not a first
  rule.
- **Auxiliary lines are not references** for an end, per the settled rule,
  even when the pinch pass will later leave them visible. Using them means a
  second ordering pass after the pinch pass, which is not in scope; the
  cost is a longer extension in the cases where an aux line is the nearest
  crossing.
- **Auxiliary folds and presses are unchanged.** An aux fold is recorded
  whole and pinched later; a press is already made by this rule.
- **A crease whose ends are marks stays as it is.** "Fold through P and Q"
  for a short crease between two marks on the paper (`crease_between_marks`)
  has both ends found, so nothing extends; the bias toward more line is
  only for an end that has nothing, never for one that has a reference.
- **No sentence.** A diagram shows how far a crease goes and does not say
  it. The card's sentence stays what it is ("Fold corner Sw onto corner
  Se"), the picture draws the crease the step makes, and the existing
  `pressed_on` sentence stays for the residual case it describes.

### Where it lives

**Crate (`crates/oristudio-precrease`)**

- `marks.rs`: `pub fn findable_end_beyond(state, creased, line, t, forward)
  -> f64` — the far-end search lifted out of `order::press_span`, which then
  calls it — and `pub fn reach(state, creased, line, spans) ->
  Option<[[f64; 2]; 2]>`: the hull of `crease_runs(line, spans)` with each
  end carried by `findable_end_beyond` unless `settled_end_is_found`.
  `None` for empty spans. Unit tests: three pieces become one run; an end
  on the edge stays; an end on a squarely creased crossing stays; an end
  nowhere goes to the nearest settled crossing beyond, not to an aux line's
  crossing nearer in; an end with nothing beyond goes to the edge; nothing
  ever moves inward.
- `closure.rs`: `reach_references: bool` beside `prefer_findable_ends`,
  with `set_reach_references`; `record_crease` records `reach(...)` when on,
  so the closure's own paper — what `ends_findable` judges the next sweep's
  targets against — is the paper the folder will have. The stuck search's
  and the candidates' sub-closures are built with `Closure::new` and keep
  the default (on); the option is threaded to them only if the measurement
  says it matters there. A line the grid step made keeps the grid's extent
  (`fold_grid`, and `order::record`'s grid branch): its bands were already
  carried out to stops, and the rule is for the folds sighted after it.
- `order.rs`: `record` records the same run and returns it; `Placed.made:
  Vec<[[f64; 2]; 2]>` carries it (one span when reach is on; the pattern's
  own runs when off, so the web has one path). `press_span` uses
  `findable_end_beyond`. Test: a fixture shaped like *Abra*'s opening —
  half, half, diagonal in three pieces — orders with no press on the
  diagonal, the diagonal made corner to corner, and the midlines made edge
  to edge.
- `sequence.rs`: `Step.made: Vec<[[f64; 2]; 2]>` (`serde(default)`; empty
  for aux and press steps, whose `extent` already says), doc'd as "the
  crease this step leaves on its line: the pattern's pieces joined, each
  end carried to the reference it stops at; `cp_spans` lies within it".
  `Totals.reach_length: f64`: crease made past the pattern by the rule, in
  sheet-lengths, summed over CP steps (length of `made` minus length of
  `crease_runs(cp_spans)`), the way `grid_unwanted_length` is kept.
- `planner.rs`: `PlannerOptions.reach_references: bool` (default `true`),
  `PlannerOptionsJson.reach_references`, `from_json`; passed to every
  closure the planner builds (`plan`, `plan_without_reference_finder`, the
  RF-fallback path); `sequence()` copies `Placed.made` and sums the total.
  `settle_grid` is unaffected — presses on grid lines are still folded into
  the grid's spans, and a reach end may land on a grid line's crossing.
- `crates/oristudio-precrease-wasm`: nothing but the option passing through
  `PlannerOptionsJson`; rebuild
  (`npm --workspace @treemaker/web run build:oristudio-precrease-wasm`).
- Fixtures: `tests/fixtures/precrease/manifest.json` step counts and press
  counts move (down); `tests/planner_fixtures.rs` `folds_only` zeroes
  `reach_length` as it does `presses`.
- `examples/measure_ends.rs`: replays `made` (not `cp_spans`) and
  `pressed_on`; `-v` names lost ends and steps in pieces, and the reach
  estimate — what the rule would add on today's order, per end and in total
  — is already there (added with this plan) to be replaced by the measured
  `reach_length` once the rule exists. `examples/dump_steps.rs` prints
  `made`.

**Web (`apps/web/src`)**

- `cp-workspace/references/precreaseSequence.ts`: `PrecreaseStep.made`,
  `PrecreaseTotals.reach_length`, `PrecreasePlannerOptions.reach_references`.
- `diagram/diagramFrames.ts`: `DiagramFrame.made(step)` — unit frame maps
  `step.made`; the model frame recovers it by ratio along the mapped chord
  exactly as `creases` and a grid line's `spans` are, so
  `referencesPlanGeometry.ts` needs no new points.
- `diagram/plannerDiagram.ts`: the step's own crease is `made` when
  non-empty, else `creases` (a plan with the rule off, or an old record);
  `creasedSpans(frame, step, patterned)` — what an earlier step left, for
  context creases and the witness-line highlight — is `made ∪ pressed_on`
  when patterned and `uncreased(made, creases) ∪ pressed_on` when the
  canvas already draws the pattern's creases (the grid line's own case,
  reused). The comment that "the pattern only wants creases where its own
  segments are, so that is all the picture draws" is revised: the picture
  draws the crease the *step* makes — more than the pattern's pieces, still
  never the bare chord.
- Settings: `ReferencesSettings.reachReferences` (default `true`), a
  checkbox in `ReferencesSettingsMenu.tsx` ("Crease to references"),
  `ReferencesPlanRecord.reachReferences`, `useReferencesBreakdown.ts`
  passes `reach_references` and re-plans on change (the `gridWhereNeeded`
  pattern). Off is for a folder who wants the precrease to match the
  pattern exactly, and it is what the measurement compares against.
- Analytics: `reach_bucket` on `folding steps completed` — crease past the
  pattern by the rule, in tenths of a sheet-length, bucketed like
  `grid_unwanted_bucket`; `analytics/events.ts` and `docs/analytics.md`.
- i18n: the one settings label through `i18n:extract` → 8 locales →
  `i18n:stamp` → `i18n:check`.
- Tests: `plannerDiagram.test.ts` (a step in pieces draws one run; an
  earlier step's context shows its reach; unpatterned draws only what the
  pattern lacks), `diagramFrames` model recovery of `made`,
  `precreasePlan.wasm.test.ts` (`made` present, one span, covering
  `cp_spans`; `reach_references: false` gives the pieces back),
  `__fixtures__/plannerSequence.ts` gains `made`, `precreasePlan.test.ts`.

### Measurement

`measure_ends -v` over the curated benchmark, *Abra*, *Wolpertinger* and
the crate's fixtures, with the option on and off (the `prefer_findable_ends`
comparison it already runs stays), planned through
`plan_without_reference_finder` as every number here is — ceilings, not the
shipped driver. Gates, read against the baseline recorded below:

1. **Lost ends on CP steps: 0.** By construction; any residue is a bug in
   the rule or the replay, not a trade.
2. **Steps in pieces: 0.** Same.
3. **Presses: down**, and the presses that remain are pinches on the
   *other* line of a mark, or presses for alignment beyond the reach — none
   on a stretch the hull covers. A mark neither line reached used to cost a
   press on one and a pinch on the other; when the hull now reaches it, the
   pinch alone remains. *Abra*: 12 at HEAD, with the two on the diagonal
   (steps 14 and 57) among those expected to go.
4. **Steps: down by the presses removed.** No step turns phantom
   (`marks_exist` false) and nothing becomes unsolved: reach only adds
   crease, and a witness certified against the geometry is certified still.
   Turn-overs not up.
5. **Extra crease (`reach_length`): reported**, total and per step, with
   the ten longest single extensions listed to be read by hand (*Abra*'s
   step 79, two pieces with a whole sheet-length between them, is one).
   There is no gate on it — the request is to pay it — but the reading
   decides whether a cap or an edge preference is wanted next. The
   estimate in the baseline below is the ceiling to read it against: the
   rule's own paper carries more crease, so its references are nearer.
6. `measure_grid`: grid steps and lines unchanged (the grid is detected
   before anything is folded); `grid_unwanted_length` not up — it can only
   fall, since the presses `settle_grid` folds into a grid line's spans are
   fewer.

Then the live check Zach owns, on *Abra* at `http://localhost:5224/`: step 1
creases the whole midline, step 3 the whole diagonal in one dash, no press
on the diagonal anywhere in the sequence, and the quarter line of step 40 —
two pieces at HEAD, with 0.43 blank between — made as one run.

## Affected Areas

- `crates/oristudio-precrease/src/marks.rs` — `findable_end_beyond`,
  `reach`, tests
- `crates/oristudio-precrease/src/closure.rs` — option, `record_crease`
- `crates/oristudio-precrease/src/order.rs` — `record`, `Placed.made`,
  `press_span`, test
- `crates/oristudio-precrease/src/sequence.rs` — `Step.made`,
  `Totals.reach_length`
- `crates/oristudio-precrease/src/planner.rs` — options, `sequence()`
- `crates/oristudio-precrease/examples/{measure_ends,dump_steps}.rs`
- `crates/oristudio-precrease/tests/{planner_fixtures,planner_grid,common}`,
  `tests/fixtures/precrease/manifest.json`
- `crates/oristudio-precrease-wasm` (rebuild)
- `apps/web/src/cp-workspace/references/precreaseSequence.ts`,
  `diagram/diagramFrames.ts`, `diagram/plannerDiagram.ts`,
  `ReferencesSettingsMenu.tsx`, `useReferencesBreakdown.ts`,
  `referencesResults.ts`, `store/workspaceStore/{types,slices/referencesSlice}.ts`,
  `analytics/events.ts`, `docs/analytics.md`, locales, tests and fixtures

## Checklist

Baseline at HEAD (`measure_ends -v`, preference on, `plan_without_reference_finder`):

| corpus | steps | presses | lost ends | in pieces (blank) | reach est. (longest) |
| --- | --- | --- | --- | --- | --- |
| *Abra* | 86 | 12 (1.1 sheet-lengths) | 22 / 168 (13.1%) | 9 (3.5) | 1.8 (0.21) |
| curated + *Abra* + *Wolpertinger* + fixtures (56 designs) | 4,512 | 711 (53.5) | 863 / 8,630 (10.0%) | 588 (195.3) | 110.9 (1.29, *halibut* step 1) |

With the endpoint preference off the same corpus has 1,099 lost ends
(12.7%) and a reach estimate of 138 sheet-lengths: the preference already
buys a fifth of the extension, and stays.

- [x] `measure_ends -v`: names lost ends and steps in pieces, replays
      `pressed_on`, counts pieces and blank length, estimates the reach
- [ ] `marks::findable_end_beyond` + `marks::reach`, unit tests;
      `press_span` on the shared search
- [ ] Closure option and `record_crease`; `order::record` and `Placed.made`;
      *Abra*-shaped ordering test
- [ ] `Step.made`, `Totals.reach_length`, `PlannerOptions.reach_references`
      through JSON and wasm; fixtures and manifest re-recorded; `dump_steps`
      and `measure_ends` replay `made`
- [ ] Gates 1–6 measured on the corpus; the ten longest extensions read by
      hand and the reading recorded here
- [ ] Web: `made` drawn as the step's crease and in context; setting;
      analytics bucket; i18n; tests
- [ ] Live check on *Abra* (Zach)
