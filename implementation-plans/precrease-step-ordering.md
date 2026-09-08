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
does not have. An eyeballed endpoint is imprecise. An extra crease is wrong.

So this can only improve a plan or leave it alone. No fold is dropped, none is
added, no pattern becomes unplannable. The only thing that moves is the order,
and only where a better order exists.

## Goal

Every step sighted from marks that are on the paper, and every crease ending
somewhere the folder can find — as often as the pattern allows, and never at the
cost of creasing something the pattern does not contain.

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

### D3 — no crease is ever extended

A crease that cannot find its end is made anyway, ending by eye. Creasing past
what the pattern wants — to reach an edge and gain a landmark — is out. It puts a
crease in the paper the design does not have, which is a change to the model
rather than an imprecision in performing it.

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

Baseline over the 38 `curated/` designs of `real_benchmark` that plan, taken
from the crate directly:

| | |
| --- | --- |
| designs / steps | 38 / 2,344 |
| steps sighted from a mark not on the paper | **281** |
| turn-overs | **127** |
| crease ends with no landmark | **19.6%** of ends, on 30.9% of steps |

The change must move the third row down without moving the first two up. The
first is the one that matters: it is the measure a reordering approach already
broke once, and freezing it out of the comparison is how that nearly shipped.

It cannot be measured by simulating a reorder of an existing plan, because
changing what folds first changes what is constructible next — the plan itself
differs. So it is implemented behind an option and both are run.

## Risks

- **The order could get worse where it is currently fine.** Deferring a fold
  changes which marks exist when later folds are chosen. Expected to help here,
  because it defers *short, broken* creases and lets *full-width* ones go first
  — the same effect the sweep structure was producing by accident — but that is
  a prediction, and the measurement above is what decides it.
- **A mutual wait.** Several creases that all end on each other with no
  full-width line among them — a rabbit ear. D2's per-sweep fallback resolves it
  by folding them all with eyeballed ends, which is what a diagram does.
- **A pattern where almost nothing is fully constructible** gains nothing and
  costs a second sweep per round. Cheap, and visible in the timings.

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

- [ ] D1 — the endpoint condition, using the existing physical-crease test
- [ ] D2 — per-sweep preference with the fallback, behind an option so both
      orders can be measured
- [ ] Corpus run: crease ends with no landmark **down**; steps sighted from a
      mark that is not on the paper **not up on any design**; turn-overs **not
      up on any design**; every design that plans today still plans
- [ ] markhor emits 1, 4, 5, 2, 3
- [ ] A crate test that fails if the preference ever makes either of the two
      quality measures worse
- [ ] D3 — a test that no step's creases exceed what the pattern contains
- [ ] D4 — `round` off the step, the group and the TS type
- [ ] Option removed once the measurement decides; the losing order does not
      stay behind a flag
