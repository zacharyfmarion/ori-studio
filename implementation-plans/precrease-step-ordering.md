# Precrease step ordering

## What is changing, in plain English

**Today**, the planner works out a folding order by asking one question over and
over: *of all the lines in this pattern, which could I fold right now?* A line is
foldable when you can line it up against something already on the paper — bring
a corner onto a corner, an edge onto a crease. It folds everything it can, which
puts new creases on the paper, which makes more lines foldable, and so on until
the pattern is finished.

That question has a gap in it. It asks whether you can find the fold **line**. It
never asks whether you can find where the crease is supposed to **start and
stop**.

Most creases run right across the paper, edge to edge, and there is nothing to
find — you crease the whole fold. But plenty of creases stop partway, somewhere
in the middle of the sheet. To stop in the right place you need a landmark there:
a point where two creases already cross. Without one, the instruction is "crease
along here and stop… somewhere", and you are guessing.

On the markhor pattern this happens immediately. Step 2 says to fold the
diagonal — but the pattern only wants the two ends of it, so you are meant to
stop a quarter of the way in, at a spot where nothing exists yet. Steps 4 and 5
are creases that run the full width of the paper, and they cross the diagonal at
exactly the points you needed. They just happen to come four steps too late.

**The change is to ask the missing half of the question.** Before folding
anything, the planner will now ask: *can I find the line, **and** can I find
where each crease on it begins and ends?* Folds that pass both go first. Folds
that pass only the first wait a while, in case something folded in the meantime
gives them the landmark they were missing.

On markhor that reorders the opening to 1, 4, 5, 2, 3 on its own. The two
full-width creases go first because both their ends are on the paper's edge, and
by the time the diagonals come round, all four of the points they need to stop
at exist.

**When no landmark is possible, the fold happens anyway and you stop by eye** —
exactly what the plan does today. Some patterns genuinely contain creases that
can only end in mid-air, and the alternative — creasing further than the pattern
asks in order to reach an edge — would put a crease in the paper that the design
does not have. An eyeballed endpoint is imprecise; an extra crease bought only
to make it precise is wrong. Here there is a choice, and imprecision is the
cheaper half of it.

So this can only improve a plan or leave it alone. No fold is dropped, none is
added, no pattern becomes unplannable. The only thing that moves is the order,
and only where a better order exists.

## Goal

Every step sighted from marks that are on the paper, and every crease ending
somewhere the folder can find — as often as the pattern allows, and never
creasing more of the paper than correctness requires.

## Why the current order is wrong

The planner's test for "can I fold this yet" is about the infinite line. The
thing the folder actually performs is a crease of finite length. Those are
different, and the gap between them is where the unfollowable instructions live.

It is not a presentation problem. Two earlier attempts treated it as one —
reordering the finished plan — and both were wrong:

- A general dependency-graph reshuffle regressed the crate's own
  reference-quality measure by 60% (230 → 367 steps sighted from marks that are
  not on the paper), worse on 24 of 38 designs and better on 1. The plan's early
  folds are the long ones, they lay down the grid of crossings everything later
  sights from, and promoting short folds to fix endpoints destroys that grid.
- A narrower "delay a step until its endpoints are referenced" repair had the
  same shape and the same risk, and it repaired the symptom in the presentation
  while the plan itself stayed wrong.

Fixing the test instead is smaller than either, and it fixes the cause.

## The change

### D1 — the constructibility test gains an endpoint condition

A target is **fully constructible** when its line can be sighted *and* every
crease the pattern wants on that line has both ends findable: on the sheet's
edge, or at a point where two already-folded creases physically cross.

"Physically cross" is the existing notion, not a new one — a crease covers only
the parts of its line the pattern asks for, so two chords meeting is not the same
as two creases meeting. That distinction is already implemented and tested.

### D2 — it is a preference, applied per sweep, never a requirement

Each sweep folds the fully constructible targets if there are any, and otherwise
falls back to the current test and folds what it can sight.

Per sweep rather than per target, so a fold waits only while something else is
making progress. And the fallback admits exactly what today's test admits, which
gives the property the whole design rests on: **the closure can never stall on
this, and no pattern that plans today stops planning.**

### D3 — never crease more than correctness requires

A crease that cannot find its end is made anyway, ending by eye. Creasing past
what the pattern wants — to reach an edge and gain a landmark — is out *in that
case*, because there is an alternative: the fold gets made either way, and the
extra crease buys only precision. A change to the model is the dearer of the
two, so it loses.

**This is a minimum, not a ban**, and reading it as a ban is a mistake this
paragraph has already caused once. Where there is no alternative, the extra
crease is what correctness costs and it gets made. The case that proves it: a
step sighted from a mark that is not on the paper cannot be performed at all —
you cannot stop by eye at a point that is not there — so a pinch is pressed to
put the mark where the fold needs it. What is never allowed is creasing *more*
than that: a pinch where a pinch will do, never a crease run out to an edge.

This is also what makes D2's fallback safe: there is always something to fall
back *to*.

### D4 — the sweep index stops being called a round

There is no round in a crease pattern; there are steps, numbered from one. The
sweep index is bookkeeping that leaked into the output — nothing outside the
ordering pass reads it, not the workspace, not the bridge — so it comes off the
step and out of the wire type.

It stays inside the ordering pass, under a name that says what it is, with the
measurement below recorded beside it: it is a proxy for "fold long lines before
short ones", and that proxy is currently what makes marks exist.

## What this is measured against

Over the 39 `curated/` designs of `real_benchmark` that plan, taken from the
crate directly (`cargo run --release -p oristudio-precrease --example
measure_ends -- <corpus dir>`; a crease end counts once per *merged* run, since
a CP splits a line at every change of assignment and those joints are not ends):

| | before | after |
| --- | --- | --- |
| designs / steps | 39 / 2,366 | 39 / 2,366 |
| sweeps | 164 | 250 |
| steps sighted from a mark not on the paper | 281 | **185** |
| crease ends with no landmark | 1,223 of 6,058 (20.2%) | **985 (16.3%)** |
| turn-overs | 130 | **168** |

The two quality measures both move the right way — a third of the phantom marks
and a fifth of the unfindable ends are gone — and markhor, the design this
started from, opens with every end of every crease found, where before its two
diagonals each had two ends in mid-air.

**Turn-overs move the wrong way, by 29%**, and that was a stated bar. The
mechanism is exact and not a tuning accident: waiting costs sweeps (164 → 250),
a sweep boundary is where the ordering pass may turn the sheet over, and a
plan's turn-overs are close to a count of the sweeps that need both faces. No
reordering *within* the sweep structure can recover them — an exact two-state
dynamic program over the per-sweep block choice was written and measured, and it
matched the existing greedy rule to the fold, so it was removed again.

Per design: ends improve on 27 and worsen on 2; phantom marks improve on 17 and
worsen on 9; turn-overs improve on 4 and worsen on 21. `iguana-c0` is the clean
loss — three more turn-overs, three more phantom marks and not one end
recovered — and it is pinned as a fixture so the trade stays visible.

The comparison cannot be made by simulating a reorder of an existing plan,
because changing what folds first changes what is constructible next — the plan
itself differs. So it is implemented behind `PlannerOptions::prefer_findable_ends`
and both are run. **The flag stays until the turn-over trade is ruled on**; it is
the only reason it exists, and the losing order does not get to live behind it.

### The turn-over cost is recoverable, but not here

A fold may always be presented *later* than its sweep, provided nothing later
sights it — that is monotonicity read in the other direction, and it is the
missing degree of freedom. A pass that delays a lone minority-side fold into the
next sweep's block of the same face, with that dependency check, would collapse
the extra boundaries without touching what the closure decided. It needs its own
measurement (delaying can only *help* the two quality measures, since more paper
is creased by then, but that has to be shown rather than argued), so it is
written down here rather than smuggled in.

## Risks

- **The order could get worse where it is currently fine.** Measured: it does,
  on 9 designs for phantom marks and 21 for turn-overs, against gains on the
  corpus as a whole. The per-design table above is the record.
- **A mutual wait.** Several creases that all end on each other with no
  full-width line among them — a rabbit ear. D2's per-sweep fallback resolves it
  by folding them all with eyeballed ends, which is what a diagram does.
- **A pattern where almost nothing is fully constructible** gains nothing and
  costs a second pass over the sweep's targets. Cheap, and the sweep counts
  above are what it looks like when it happens.

## Affected areas

- `crates/oristudio-precrease/src/closure.rs` — the sweep's partition, and the
  endpoint condition.
- `crates/oristudio-precrease/src/order.rs` — the sweep index renamed; the
  ordering objective written down.
- `crates/oristudio-precrease/src/sequence.rs`, `planner.rs` — `round` off the
  step and the group.
- `apps/web/src/cp-workspace/references/precreaseSequence.ts` — the wire type.
- `crates/oristudio-precrease/tests/planner_direction.rs` — the regression.

## Checklist

- [x] D1 — the endpoint condition, using the existing physical-crease test
      (`marks.rs`, shared with the ordering pass so the two cannot disagree)
- [x] D2 — per-sweep preference with the fallback, behind an option so both
      orders can be measured
- [x] Corpus run: crease ends with no landmark **down** (20.2% → 16.3%); steps
      sighted from a mark that is not on the paper **down** (281 → 185, up on 9
      designs); every design that plans today still plans (39/39)
- [ ] Turn-overs **up**, 130 → 168 — the one bar the change does not clear; see
      "The turn-over cost is recoverable, but not here"
- [x] markhor opens with every crease end found; its two diagonals move behind
      the full-width creases that give them their stopping points
- [x] A crate test that pins the preference never losing a landmark and never
      changing which lines get folded
- [x] D3 — a test that no step's creases exceed what the pattern contains
- [x] D4 — `round` off the step, the group and the TS type; `sweep` inside the
      ordering pass
- [ ] Option removed once the turn-over trade is ruled on; the losing order does
      not stay behind a flag
