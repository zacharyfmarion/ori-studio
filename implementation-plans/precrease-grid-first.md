# Precrease: the grid first, for box- and hex-pleated designs

## Goal

A box-pleated design is precreased the way every folder precreases one: the
whole grid first — every line of it, edge to edge, alternating mountain and
valley as a pleat does — and only then the diagonals and the rest, which then
have a grid crossing to be sighted from at every step. The planner today folds
the grid lines one at a time as the closure reaches them, interleaved with
everything else, each as "fold P onto Q" with its own card, and only where the
pattern draws them. A 32-grid is 62 cards before the model starts.

An option, **Precrease grid**, on by default. When it is on and the design is
box-pleated (or hex-pleated), the plan opens with one step per grid family —
"Pleat the sheet into 16ths this way, alternating mountain and valley" — and
the rest of the plan is built on the grid. The alternation's phase (which
parity is mountain) is the one that disagrees with the pattern's own
assignment over the least crease length: those lines reverse as the model
collapses, and the card says how many.

## Approach

**Detection (`grid.rs`).** From a component's target lines (post-snap, so the
same lines the closure works on), sorted by the angle of their normal into
twelve 15° buckets. *Box:* the vertical and horizontal families with square
cells; the design is box-pleated when ≥ 75 % of its creased length lies on
those two directions or the two 45° diagonals. *Hex:* the equilateral
triangular grid — three families 60° apart with **one** perpendicular spacing
`s`, one of them axis-aligned (vertical + the two families 60° from it, or
horizontal + its two); the oblique offsets are multiples of `s` from a corner,
or from half a cell in (the lattice anchored on an edge midpoint); the design
is hex-pleated when ≥ 75 % of its creased length lies on the six hex
directions (the three families and their perpendiculars, which are the
model's own folds through the lattice points, as the 45° lines are on a box
grid). Measured: hex-tiger, zebra, crocodile, okapi (Terao) and
neel-les-flours are vertical + ±30° at 1/16, 1/8 or 1/32; hex-14 is two
oblique families of a 16-column grid whose verticals the pattern never uses.

The spacing is `w/N` or `h/N`, `N` in 4..=64. Every candidate is scored on
**pattern lines on the grid − 0.1 per grid line**, so a finer grid wins only
when the pattern uses enough of it and a stray 32nd does not double a
16-grid. A pattern line counts as on the grid within `SNAP_RADIUS` (2e-3) —
an off-lattice file drawn a hair off its own grid (neel's 32nds at 0.25007)
is still pleated on it — and the line the pleat makes is then the pattern's
own, so everything after closes against the pattern's geometry. A family the
pattern uses < 15 % of is left out (a midline alone is not thirty-one
pleats); the grid must catch ≥ 30 % of its own lines and ≥ 6 pattern lines.
Corpus: 17 of 43 loadable designs get a grid; every 22.5° design and every
molecule base gets none.

**The grid in the closure.** `Closure::fold_grid` adds every grid line to the
state before the first close — as the target where the pattern has it, as a
`LineTag::Grid` auxiliary elsewhere — creased along its whole chord, with no
witnesses (a grid is made by pleating, not sighted line by line), and
`FoldedLine.grid = Some(GridRef { family, line })`. Grid auxiliaries are exempt
from the pinch pass: they are the technique, not marks. The closure, the stuck
search and ReferenceFinder then run as they do today, over a state that
already carries the grid.

**Direction.** Per family, lines alternate by index; the parity is the one
that disagrees with the pattern's assignment over the least creased length
(a tie goes to a mountain first). Grid lines not in the pattern have no say.
The grid is made from the front, as a pleat; it costs no turn-over.

**Sequence.** `StepKind::Grid` with `Step.grid: GridStep { kind, family, n,
normal, spacing, lines: [GridStepLine { line_id, line, segment, index,
direction, pattern_direction, cp_line_ids, cp_spans }], in_pattern,
reversed }`; the step's own `line`/`line_id`/`segment` are the family's first
line; `cp_line_ids` and `cp_spans` carry every pattern crease the family's
lines contain, so the canvas's crease visibility works unchanged. Grid steps
come first, before the hoisted landmarks, numbered from 1; `Sequence.grid:
GridSummary { kind, n, families, lines, cp_lines }`; `Totals.grid_lines`,
`grid_cp_lines`; `cp_lines` counts pattern lines the grid realises, `folds`
counts the grid's own lines too. `LineEntry.step` of a grid line is its step.

**Browser.** `referencesSettings.precreaseGrid` (default true), a toggle
beside "Landmarks first" that re-plans, `PlannerOptions.precrease_grid`
through the bridge's options JSON. The grid card draws every line of the
family full-length in its direction's style, no arrows; the sentence names
the family, the count and the alternation, and how many lines the pattern
wants the other way. The summary strip says "grid 16" / "hex grid 16". The
completed-plan analytics event carries `grid_kind` and `grid_lines_bucket`.

## Affected Areas

- `crates/oristudio-precrease/src/grid.rs` (new), `closure.rs`, `planner.rs`,
  `order.rs`, `pinch.rs`, `sequence.rs`, `state.rs` (`LineTag::Grid`);
  `examples/grid_scan.rs` (new), `examples/measure_ends.rs` (`--no-grid`);
  `tests/planner_grid.rs` (new), `planner_direction.rs`, `planner_fixtures.rs`,
  `planner_properties.rs`; `tests/fixtures/precrease/manifest.json` (`grid`)
- `apps/web/src/cp-workspace/references/`: `precreaseSequence.ts`,
  `precreasePlan.wasm.test.ts`, `referencesFilmstrip.ts`,
  `referencesStepSentences.ts`, `diagram/plannerDiagram.ts`,
  `diagram/diagramFrames.ts`, `referencesPlanGeometry.ts`,
  `ReferencesSummaryStrip.tsx`, `ReferencesSettingsMenu.tsx`, the store slice
  and types, `useReferencesBreakdown.ts`; analytics; locales

## Checklist

- [x] `grid.rs`: box and hex detection, with tests on the fixtures and the
      corpus (`ORI_PRECREASE_CORPUS`).
- [x] `Closure::fold_grid`, `FoldedLine.grid`, `LineTag::Grid`, pinch-pass
      exemption.
- [x] Alternation and phase; `StepKind::Grid`, `GridStep`, `GridSummary`,
      totals.
- [x] Ordering: grid steps first, no turn-over, no witness; landmarks-first
      leaves them in place.
- [x] Bridge option (`precrease_grid` in the options JSON); TS types.
- [x] Web setting (default on), toggle that re-plans, analytics.
- [x] Grid card, sentence, summary; locales.
- [x] Measured (`measure_ends`, product budgets, no ReferenceFinder, so
      ceilings): 54 designs — the loadable curated corpus plus the fixtures —
      go from 4,950 steps, 350 turn-overs, 852 presses and 12.8 % of crease
      ends unfindable to **4,369 steps, 288 turn-overs, 741 presses and
      9.6 %**; every design without a grid is unchanged. Per design
      (steps / turn-overs / lost ends, before → after): axolotl 35/3/12 →
      24/1/0; executioner 83/4/50 → 25/1/0; cordyceps-ant 92/6/50 →
      44/2/0; hex-tiger 129/10/29 → 76/4/0; zebra 116/6/49 → 67/4/0;
      okapi 87/6/18 → 62/4/0; turtle 69/4/30 → 42/1/0; iguana-c0 97/6/16
      → 26/1/0; grid6 15/4/0 → 6/1/0; hex-14 56/5/0 → 15/1/0.
- [x] Reviewed (three lenses, two refuters a finding): a rectangle's grid
      is named by its axis family and each family says its own strip count
      (`cells`); the tie-break pleats a mountain first as documented; a
      point cap partway through the grid reports the lines that were made
      and leaves the rest remaining, and a cap mid-round no longer leaves a
      folded target remaining; the toggle is keyed on the setting the plan
      on screen was made under, so a toggle mid-run or on another sheet is
      never swallowed, and a picked target defers it; the canvas draws the
      stretch of an in-pattern grid line the pattern does not crease; the
      strip's "no auxiliary folds needed" and the mixed-line count leave
      the grid's own lines out and count the pattern's pleated lines in.
