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

## 1. Every step is sighted from marks that are on the paper

### The invariant

**No plan ever contains a step sighted from a mark that is not on the paper.**

Not "most steps". Not a coverage figure. The end state is a test that replays
every fixture's finished plan onto a bare sheet and asserts zero steps with
`marks_exist == false` — and if a pattern cannot meet it, the planner says so as
a finding rather than shipping an instruction nobody can follow.

The percentages below are not a menu of which cases get fixed. Every case gets
fixed. They say **how much ink each case costs**, which is a different question
and the only one worth optimising.

### Why it is always achievable — a theorem, not a measurement

A mark `P` is in `State` only because some pair of lines crossed there at
`MIN_ANGLE_SINE` or steeper (`state.rs:258-268`), and a line is in `State` only
because it was folded. A witness certified in round *r* names only points minted
in rounds before *r*. So for every phantom mark, **both of its lines are already
folded before the step that sights it.**

The material is therefore always present. What is missing is never a fold — only
a *press*: the pattern does not ask for crease at that spot, so the folder never
made one there. Pressing along a line you are already folding costs ink and
nothing else.

Measuring 4,094 of 4,094 phantom marks across 148 designs confirmed this rather
than discovering it.

### The rule

For a phantom mark `P` at the crossing of `A` and `B`:

**(c) Nothing**, when a later step creases through `P` before the step that needs
it — the plan already fixes itself.

**(a) One pinch**, when one of `A`/`B` already has a crease reaching `P`. The
other gets a pinch at `P`, located by the crossing the folder can now see.
`2 × PINCH_HALF_LENGTH` = 0.06 of the sheet's side.

**(b) A press, then the pinch of (a)**, when neither reaches `P`. One of them is
pressed from its nearest existing run end, **through `P`**, to the nearest end a
folder can find on that line.

### The press does not stop at the mark

This is the correction that matters, and the first version of this plan had it
wrong. `end_is_found` (`marks.rs:232`) accepts a crease end only on the sheet's
boundary, or where an already-creased line crosses it steeply. `crease_runs`
merges an abutting press into the adjacent run, so a press that *stopped at* `P`
would make `P` a run end — and at that moment nothing is creased through `P`;
that is the premise of case (b). The instruction would read "crease along here
and stop at a point that is not there", which is the original defect moved from
the mark to the crease end.

So the press runs **past** `P`, to the nearest findable end beyond it: another
creased crossing on that line, or the sheet's edge, which always qualifies
because a chord's ends are on the boundary. **No press end is ever eyeballed.**

That is a D3 exception and the plan takes it deliberately. D3's prose still names
"a crease run out to an edge" as the thing never allowed, while D3's rescope
authorises exactly this repair — an extra crease that buys performability, not
precision. `precrease-step-ordering.md` needs that reconciled in the same change.

### Reordering is out

The first version proposed swapping two folds so the sighting line comes first.
It is neither available nor needed: there is no dependency graph over steps to
topologically sort — there is a *total* order of closure rounds — and the one
time reordering was tried for this class of problem it was measured **losing**,
taking turn-overs 130 → 168. Case (a) covers the same ground by attaching the
pinch to a later step instead of moving a fold.

### A press is a step

The pinch does not always land on the later-folded of the pair. When the line
needing the pinch was folded *earlier* than the line whose crease reaches `P`,
the crossing only becomes visible after the later fold — on markhor, Q is on the
diagonal from step 7, in a gap that only step 10's crease locates. The diagonal
has to be refolded and pinched there, after step 10 and before step 15.

That is an ordinary physical action and a real diagram numbers it: *"pinch
here"* is one step, *"fold to the pinch"* is the next. So it is a **step**, not a
field smuggled onto some other step's line:

```rust
pub enum StepKind {
    Cp,     // realises pattern crease on a new line
    Aux,    // a new auxiliary line
    Press,  // more crease on a line already made, to put a mark on the paper
}
```

A press step has `line_id` = the line being re-pressed, `extent: Pinches` with
the short span at `P` (or the run out to a findable end, in case (b)),
`cp_spans` **empty** because the pattern asks for nothing there — that is the
whole point — and a witness that is the sighting: *this line exists; that one
crosses it here.* It sits immediately before the step that needs the mark. Case
(b) is two press steps.

`LineEntry.step` keeps meaning *the step that made the line* — a press does not
make it — so `planner.rs:684`'s one-slot-per-line map is untouched. Everything
downstream already handles a pinched step because auxiliary lines are pinched
today: `plannerDiagram.ts` draws `extent.kind === 'pinches'` as short marks, the
sentence says *"Pinch only — just the mark is needed."*, and the visibility
build-up adds whatever a step creases. `Totals` gains a `press` count so extra
ink is countable and never mistaken for `aux` or `cp`, which keeps the D3 guard
(`no_step_creases_more_than_the_pattern_contains`) exactly as meaningful as it
is now.

The one piece of plumbing: `Placed.folded` indexes a `FoldedLine`, and a press
has no fold of its own. `Placed` has to be able to say *a press of this line at
this point* as well as *this fold*.

### What it costs — measured after the fact

Same 122 corpus designs, shipping setting, before → after: 2,646 presses at
246.6 sheet-sides against 4,213 sheet-sides of pattern crease — **5.9% more
creased length**, almost all of it 0.06-long pinches. Turn-overs unchanged.

**The 8.13% figure previously in this document was withdrawn** before that
measurement existed; it was wrong three ways, all confirmed against the
harness:

1. **The pinch was never priced** — the whole "order is already right, one pinch"
   case scored zero, and the pinch is that case's entire cost. Up to
   4,094 × 0.06 = 245.6 more sheet-sides, taking the total toward ~14%.
2. **The press was charged to the wrong line** — the harness picked the presser by
   presentation order and then asked whether *that* line reaches `P`, so it
   charged presses that a pinch on the other line would have avoided. The "needs
   a press" bucket is an over-count by an unknown amount.
3. **The press was measured to `P`, not to a findable end** — so even where a
   press is genuinely needed, the number is a floor.

The denominator was wrong too: it summed `cp_spans` only, so every auxiliary
crease and existing pinch counted as zero length.

A re-measurement must report **press length and pinch length as two numbers**,
over both `landmarks_first` settings and all components, not just the largest.

### Prerequisites — real bugs found while checking this

- **`pinch_pass` reads the wrong witness.** It uses `closure.folded()[j].chosen`
  (`pinch.rs:63`) — the closure's global argmin, fixed at fold time — while the
  plan presents `order()`'s re-pick over the *sightable* subset
  (`order.rs:301`). The two disagree exactly on the steps this work is about, so
  an aux line is pinched at points no presented step uses. Fix before building on
  it.
- **`Creased::add_spans` replaces, it does not union** (`marks.rs:64`), and empty
  spans silently mean "creased everywhere". The ordering pass calls it once per
  step, so the first press step on a line would **wipe that line's pattern
  creases and leave only the pinch**. This is the bug that bites first, and it
  goes first.
- **The hoist branch does not search for a sightable witness** the way the round
  loop does (`order.rs:252`), so a hoisted step can be flagged phantom while a
  sightable witness sits unused.

### The test that ends this

Replay the finished plan onto a bare sheet, exactly as `measure_ends::measure`
does but accumulating the **pressed** extent rather than `cp_spans`, and assert
at every step:

1. every point its presented witness names has two creases reaching it, crossing
   at `MIN_ANGLE_SINE` or steeper — i.e. **zero `marks_exist == false`**;
2. every merged run end of every step passes `end_is_found` against that same
   replay — so the repair has not moved the defect to the crease ends.

And a fixed-point check: planning again over the pressed plan produces an
identical press set. It terminates because presses accumulate and are never
retracted, over a finite set of (step, witness, point) triples.

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

**Correction 1 — every step sighted from marks that exist.** Done, in
`75e8d3f3`, `522b2e4c`, `c884cdf3`, `1001e9b9`.

- [x] Surface which marks are missing and where: `Step.missing_marks` (`53d041b5`).
- [x] The prerequisites: `add_spans` is a union, `pinch_pass` reads the
      presented witness, the hoist branch prefers a sightable one.
- [x] `StepKind::Press` and a `Placed` that carries one; empty `cp_spans`;
      `Totals.presses`. On the wire, in the sentence, on the card.
- [x] The rule: (a) a pinch at a visible crossing; (b) a press through `P` to a
      findable end, then (a). Unit tests pin both cases and that (b) stops at
      the nearest findable end rather than always the edge.
- [x] **The invariant test.** Every fixture's plan replayed onto a bare sheet
      using each step's *pressed* extent; every mark every step sights has two
      creases through it; zero exceptions. A second test pins what a press is.
- [x] Re-measured, before → after on the same 122 corpus designs, shipping
      setting: **phantom 2,319 → 0**, turn-overs 755 → 755, lost ends
      8,610 → 8,491, 2,646 presses at 246.6 sheet-sides (mostly 0.06 pinches).
      Iguana-c0: 13 presses, turn-overs 9 → 9.
- [x] Watched turn-overs: unchanged. Presses take the moment's side and never
      advance it.
- [x] Found and fixed on the way: the snappable path put the line back on the
      lattice but not its crease endpoints, so a crease ending at the edge
      arrived stopping 5 × 10⁻⁴ short, and a press would have been made to close
      a gap in the file rather than the design. Endpoints now snap to the
      boundary or a crossing within `SNAP_RADIUS`.
- [x] Reconcile D3's prose in `precrease-step-ordering.md` with the exception
      case (b) takes.

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
