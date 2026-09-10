# Two corrections to the precrease planner

Both came out of one question — *"step 15 references a point Q which does not
actually have a reference"* — and they are unrelated defects that the same
investigation happened to expose. They are written together because the second
one is why the first one's measurements cannot be trusted at face value.

## Goal

1. Every step of a plan is sighted from marks a folder can actually find, and
   where one is missing the plan says how to make it rather than pretending it
   is already there.
2. There is one set of rules for how a plan is driven, so the plan you get does
   not depend on who ran the planner.

---

## 1. Steps sighted from marks that are not on the paper

### What is wrong

A step says "fold P onto Q" and Q is not on the paper. Not "not yet" — **never**.
Replaying markhor fold by fold, and then asking again against the finished
pattern with every crease of the whole plan made:

```
fold 15  POINT#28 (0.6464, 0.6464)   on the paper at the end of the plan: NO
fold 21  POINT#31 (0.3536, 0.6464)   on the paper at the end of the plan: NO
fold 24  POINT#23 (0.7071, 0.2929)   on the paper at the end of the plan: NO
fold 26  POINT#28 (0.6464, 0.6464)   on the paper at the end of the plan: NO
```

Point 28 is where CP lines 14 and 8 cross: line 14 is creased through that spot,
line 8 never is. Point 23 is where lines 13, 7 and 39 cross and **not one of the
three** is ever creased through it — a point in empty space, which is exactly how
it reads on screen.

So this is not an ordering problem (waiting never helps) and not a drawing
problem. The step cannot be performed as written.

### Root cause

`State` records a point wherever two lines cross, where "line" means the infinite
line clipped to the sheet. That is the right model for *is this fold
constructible* and the wrong one for *can a folder find this spot*, and
`marks.rs:4-8` already says so in as many words: **"Two chords meeting is not two
creases meeting."**

The module exports the test — `mark_exists`, `point_mark_exists`, `Creased` — and
`closure.rs:55` imports exactly two things from it:

```rust
use crate::marks::{Creased, ends_are_found};
```

The closure keeps a live `Creased` and spends all of it on one question: does this
crease's **ends** land somewhere findable (`closure.rs:328`). It never asks the
same question about a witness's **inputs**. That is the whole defect, in one
missing call.

`order.rs:280` catches it afterwards, sets `Step.marks_exist = false`, and the
sidebar prints *"pinch it in first"* — but by then the step is in the plan, and
for these four there is nothing to pinch.

### What was ruled out, and why

- **"Pick a different witness."** `order.rs:280` already searches *every*
  recorded witness for a sightable one and overrides the closure's pick. So
  `marks_exist == false` already means every witness was tried and none worked.
  There is nothing left to promote, and a gate at certification time would find
  exactly the same thing.
- **"Refuse the fold and let the stuck search repair it."** It will not. The
  goal-directed generator's anchors are `t ∩ m` — crossings with the *target*
  line (`candidates.rs:12-16`). A phantom Q is an O2 *input*, and an O2's Q never
  lies on its own perpendicular bisector, so the search is not aimed at creating
  that mark.
- **"Refuse and report it as unplannable."** Throws away a fold that is one pinch
  short of legitimate.

### The fix: make the mark

Press a pinch at the crossing, on the line that is not creased there, sighted
against the line that is. A pinch is `2 × PINCH_HALF_LENGTH = 0.06` of the
sheet's side (`pinch.rs:27`) — you press *at* the mark, not from the existing
crease out to it.

This is not forbidden by D3 of `precrease-step-ordering.md`. D3 is about a crease
whose *end* has no landmark, where the fold happens either way and the extra
crease buys only precision; that is a bad trade and stays out. A phantom
reference has no alternative at all — you cannot stop by eye at a point that is
not there — so the pinch is what correctness costs. D3 was rescoped to say this
(`a6eb3a29`).

The mechanism has been checked independently and holds for markhor 15, 21 and 26:
both lines are folded before the round that sights the point (guaranteed — that
is *why* the closure certified it), one of them is creased through the spot, and
the pair crosses at ≥ `MIN_ANGLE_SINE` because that is the same test that minted
the point in the first place (`state.rs:268-271`).

### Which route actually works — measured, and measured wrong the first time

**The ReferenceFinder figures below the fold are answering the wrong question.**
I asked RF to construct each point *from a bare sheet*, which of course costs
rank 3–4 and two to four folds. The plan has already folded most of the
construction. Asked what is missing *given the state*, the answer for markhor's
step 15 is: **nothing**.

```
fold  7  line #8   (0,0)-(1,1)          creased (0,0)-(0.25,0.25) and (0.75,0.75)-(1,1)
fold 10  line #14  (0.9142,0)-(0.5,1)   creased (0.75,0.3964)-(0.5,1)

            they cross at (0.646447, 0.646447)   <- exactly Q
            step 7  crease STOPS SHORT OF the crossing
            step 10 crease REACHES the crossing
```

Q is the sheet's main diagonal crossed with step 10's line. Both are folded
before step 15. The diagonal is creased at both *ends* and Q sits in its
uncreased middle. Every one of these points is on the 22.5° lattice and is the
crossing of two lines the plan already contains — that is *why* the closure
certified the fold.

So the three routes, cheapest first:

**Ordering.** To press a mark at `P = A ∩ B` you fold along B and press where you
can see A's crease, so A must be creased through P before B is folded. When the
plan folds B first, that is often incidental rather than forced. markhor's step
10 (line 14) depends only on lines 4 and 11 — not on the diagonal — so folding it
before step 7 is legal, and then the diagonal's fold can pinch at the visible
crossing. **Three of markhor's four phantom marks need only this. No extra
crease at all.**

**A pinch**, where the order is already right: press `2 × PINCH_HALF_LENGTH` =
6% of the sheet's side at the crossing, during a fold already scheduled.

**A construction**, for the rest.

Over 148 designs and 4,094 phantom marks:

| what the mark needs | | |
|---|---|---|
| the crossing gets creased later anyway | 321 | 7.8% |
| a pinch at a crossing already visible | 2,283 | 55.8% |
| swap the two folds, then pinch — no extra crease | 345 | 8.4% |
| a genuine construction | 1,145 | 28.0% |

markhor's step 24 is in that last 28%: its Q lies on lines 13, 7 and 39, and none
of the three is ever creased through it.

**Caveat on the swap column.** "A does not transitively depend on B" is a
*necessary* condition for trading their places, not a sufficient one — steps
between them may depend on the current order. Proving it needs an actual reorder
and replan, which is the first thing to build.

### One thing this dissolves

Once the mark is real, `Step.marks_exist` is true and the ring the diagram draws
round it is honest. No separate drawing change is needed, and the entry under
"Still open" in `references-step-diagram-unification.md` can come out.

---

## 2. One planner, two drivers with different rules

### What is wrong

The engine is one Rust implementation. The ~15-line loop that decides *what to
try next* exists twice, and the two have drifted. The clearest symptom is that
"why did we stop" is modelled by two enums that are not the same shape:

| | |
|---|---|
| Rust `Status` (`sequence.rs`) | `Complete`, `PartialUnsolved`, `PartialOffLattice`, `RefusedSheet`, `InvalidInput` |
| TS `PrecreasePlanStopReason` (`precreasePlan.ts:172`) | `complete`, `off_lattice`, `unsolved`, `budget`, `aborted`, `refused_sheet`, `point_cap` |

The crate cannot express "ran out of budget" or "you pressed Stop" as an outcome
— it collapses both into `PartialUnsolved` behind a separate `budget_hit` flag —
and the browser invented three states the crate has never heard of. The same
crease pattern can therefore stop for different reasons depending on which driver
ran it.

The browser's loop also has an arm the Rust one does not: when the stuck search
fails, **it asks ReferenceFinder**.

### Why the loop cannot simply move into Rust

Three reasons, all real:

1. **ReferenceFinder is browser-only.** Vendored C++ compiled to wasm, reached
   through an async transport. The crate has no dependency on it — `Cargo.toml`
   does not mention it — and cannot synchronously call back into async JS.
2. **The loop is chunked.** `planner.close(closeChunkMs)` is called repeatedly
   with a small budget, reporting progress between chunks, so a large pattern
   does not freeze the UI. Rust's `close()` is one blocking call.
3. **The loop is abortable.** `checkAbort()` runs between chunks so Stop actually
   stops. Nothing can interrupt a synchronous Rust loop from JS.

So the loop *body* has to be TypeScript. Only its *decisions* need not be.

### The fix: one decision function, two executors

Pull the rules into the crate and let each driver just do as it is told:

```rust
pub enum PlanAction {
    Close,
    StuckSearch,
    AskReferenceFinder,
    Stop(StopReason),
}

/// What only the driver knows.
pub struct DriverState {
    pub out_of_time: bool,
    pub aborted: bool,
    pub reference_finder: bool,
    pub rf_events: u32,
    pub last_close_stalled: bool,
}

impl Planner {
    pub fn next_action(&self, driver: DriverState) -> PlanAction { … }
}
```

Everything about the plan's own state — `is_complete`, `off_lattice`, `refused` —
the crate already has. Everything else comes in through `DriverState`. Then:

- `Planner::plan()` becomes a `loop { match next_action(…) }` with
  `reference_finder: false`, so its inability to call RF is **written down** as a
  `Stop(Unsolved)` instead of implied by a missing branch.
- The TypeScript loop becomes the same `match`, keeping its async body, chunking
  and abort — which is the part that genuinely belongs there.

`StopReason` replaces both enums and covers every state a driver can be in, so
`budget`, `aborted` and `point_cap` stop being browser inventions.

Honest limit: this does not make drift *impossible*. Nothing short of moving the
whole loop into Rust would, and that is blocked on async. What it does is leave
one copy of the rules, which is the part that actually drifted.

### The test that guards the rest

With `referenceFinder: null` the two drivers are supposed to be the same planner.
`precreasePlan.wasm.test.ts:126` already runs `planPrecrease` that way over
grid6 and iguana c0 with recorded expectations. Add the mirror: a Rust test
running `Planner::plan()` over the same fixtures, both reading one shared
manifest of fold count and stop reason. Drift then shows up as a red test.

### And the thing that would have caught this today

`Planner::plan()` is named as though it is the planner. It is not — the wasm
bridge does not export it, and its only callers in the repo are tests, examples
and benchmarks. Rename it to say so, and have `measure_ends.rs` and any corpus
harness print in their own output that their numbers exclude the ReferenceFinder
fallback.

---

## Affected Areas

- `crates/oristudio-precrease/src/closure.rs` — the missing sight test; the
  pinch that creates a mark.
- `crates/oristudio-precrease/src/marks.rs` — `witness_marks_exist` lifted out of
  `order.rs` so one implementation answers "is this on the paper".
- `crates/oristudio-precrease/src/pinch.rs`, `sequence.rs` — the mark step's
  shape, and the `Step` fields that describe it.
- `crates/oristudio-precrease/src/planner.rs`, `sequence.rs` — `PlanAction`,
  `DriverState`, `StopReason`; `plan()` rebuilt on them and renamed.
- `crates/oristudio-precrease-wasm/src/lib.rs` — export `next_action`.
- `apps/web/src/cp-workspace/references/precreasePlan.ts` — the loop becomes an
  executor; `PrecreasePlanStopReason` derives from the crate.
- `apps/web/src/cp-workspace/references/referenceFinder/client.ts` — `solvePoint`
  for marks, if the hard case goes that way.
- `crates/oristudio-precrease/tests/planner_direction.rs`,
  `apps/web/src/cp-workspace/references/precreasePlan.wasm.test.ts` — the
  agreement test and the mark-existence assertions.
- `crates/oristudio-precrease/examples/measure_ends.rs` — the honesty banner.

## Checklist

**Correction 1 — marks that exist**

- [x] Measure first: can ReferenceFinder construct markhor's points 23, 28 and
      31 at the depth we run it at? **Yes — all three exact, rank ≤ 4.** And
      Route A covers 0 of markhor's 4, so Route B is the fix.
- [x] Lift `witness_marks_exist` into `marks.rs` so the closure and the ordering
      pass cannot disagree about what is on the paper. Done in `53d041b5`, with
      `witness_missing_marks` beside it.
- [x] Surface *which* marks are missing: `Step.missing_marks`, the sighted points
      that are not on the paper, in the planner's unit frame — which
      `Planner::line_to_rf` notes **is** the ReferenceFinder frame, so they need
      no conversion before a query. `Step.marks_exist` is its emptiness, pinned
      by a test.
- [ ] **Order the folds so the sighting line comes first.** The cheapest fix and
      the one that covers markhor: no extra crease, no construction, just a
      different order. Needs a real reorder-and-replan to confirm the swap is
      safe, not the necessary-condition proxy measured above.
- [ ] **Press a mark-pinch during a fold already scheduled**, where the order is
      already right (55.8%). Its `Step` shape needs its own field — three
      verifiers read `cp_spans.is_empty()` as "creased whole"
      (`planner_direction.rs:352`, `:602`, `measure_ends.rs:89`), so the extra
      press must not be a `cp_spans` entry.
- [ ] **The driver asks RF for each missing mark and folds the constructions**,
      for the 28% that neither of the above reaches.
      Not started, and it needs a measurement first — see below. The shape is
      settled: `DriverState` gains `missing_marks`, the rules gain
      `AskReferenceFinderForMarks` after a complete close, and the driver reuses
      `candidateLinesFrom` / `score` / `bestCandidate` / `fold` exactly as the
      line fallback does. What is *not* settled is whether it should run at all.

      **What that costs is still unmeasured**, and the earlier estimate here
      (forty to eighty extra folds per design) was wrong because it priced every
      phantom mark at a from-scratch construction. Only 28% need one at all, and
      even those should be asked what is missing *given the state* rather than
      from a bare sheet. Sizing it honestly needs the shipping loop, which means
      RF, which means the harness below.
- [ ] Route A as an optimisation afterwards, if the extra aux folds prove
      expensive: press the pinch during a fold already scheduled, where the
      ordering allows (61.1%). Decide its `Step` shape deliberately — three
      verifiers read `cp_spans.is_empty()` as "creased whole"
      (`planner_direction.rs:352`, `:602`, `measure_ends.rs:89`), so the extra
      press needs its own field, not a `cp_spans` entry.
- [ ] Re-measure. Watch turn-overs: the last tightening of this test cost
      130 → 168, and `iguana-c0` is the pinned clean loss.
- [ ] Remove the "Still open" entry in
      `references-step-diagram-unification.md` once `marks_exist` is honest.

**Correction 2 — one set of rules.** Done, in `d7e23280`, `a80008dc`, `8ebcb252`.

- [x] `StopReason` in the crate, covering budget, abort and the point cap.
- [x] `PlanAction` / `DriverState` / `LastStep` / `next_action`, with the rules
      moved in as a pure function and unit-tested there.
- [x] `Planner::plan` rebuilt on it and renamed `plan_without_reference_finder`,
      declaring `reference_finder: false` so its one difference from the real
      driver is a stated fact rather than a missing branch.
- [x] `next_action` exported from the wasm bridge; `precreasePlan.ts` is an
      executor. `PrecreasePlanStopReason` is now the crate's `StopReason`
      instead of a second list of the same idea.
- [x] Agreement: both drivers answer to the same fixture manifest for grid6 and
      iguana-c0, and a wasm test runs all 224 combinations of driver inputs
      through the unit tests' rules double and the real crate and asserts they
      match — so the double cannot quietly drift either.
- [x] The honesty banner on `measure_ends.rs`.

**Still to build — the harness that makes a corpus number real**

- [ ] Drive the *shipping* loop headlessly: the precrease bridge and
      ReferenceFinder together, under Node. This was thought impossible and is
      not — `tools/reference-finder-oracle/equiv.mjs` has driven RF under Node
      all along, and the planner's unit frame is already RF's frame. Until this
      exists every corpus figure in this document is a ceiling, and the mark
      construction above cannot be sized at all.

## Measured, and what the numbers are worth

Over 148 corpus designs, 17,998 steps:

| | |
|---|---|
| steps sighted from a mark not on the paper | **2,952 (16.4%)** |
| of those, never findable at all | 2,681 (91%) |
| referencing a point with no crease through it, ever | 899 |
| designs with at least one | **131 of 148** |
| phantom marks with a visible crossing to pinch against | 72.2% |
| phantom marks with nothing running through the spot | 27.8% |

**Every one of these is a ceiling, not a measurement.** They were taken through
`Planner::plan()`, which is the weaker driver — it gives up one step before the
real one, because it cannot ask ReferenceFinder.

That is fixable, and I had said it was not. **ReferenceFinder runs perfectly well
under Node** — `tools/reference-finder-oracle/equiv.mjs` has driven it that way
all along, and the measurements above were taken the same way. What cannot call
RF is the *Rust crate*; a Node harness can drive the wasm bridge and RF together
and reproduce the shipping loop exactly. Worth building once the driver rules are
shared, because then there is one loop to reproduce rather than two.

## Not in scope

Carried from `references-step-diagram-unification.md`, unchanged and still true:

- `--fold-unassigned` is a hard literal in `theme.css:118` that `applyTheme`
  never sets, so the context-crease ink cannot follow a per-theme rule.
- `referencesSheets.ts:125` is a fourth SVG renderer of CP creases, uncapped.

And from `precrease-step-ordering.md`: whether to accept the 130 → 168 turn-over
regression and drop `PlannerOptions::prefer_findable_ends`. The losing order
should not stay behind a flag, and Correction 1 will move those numbers again —
so it is worth settling after, not before.
