# Precrease step ordering

## Goal

Order a precrease sequence so that a folder can perform every step: each fold
sighted from marks that are on the paper, each crease ending somewhere they can
find, and the paper turned over as seldom as the pattern allows.

And say what the order is *for*. Today the order comes out of the closure's
sweep structure, which is a search artifact, and the qualities above are things
it happens to produce rather than things it is asked for.

## The question this plan answers

Zach, on markhor: steps 2 and 3 crease part of a line and stop in mid-paper with
no reference for where; steps 4 and 5 create exactly those references. Ordering
`1, 4, 5, 2, 3` would fix it. `order.rs` cannot: 2 and 3 are closure round 1, 4
and 5 are round 2, and the pass permutes only *inside* a round.

The proposal was to replace the round with a dependency DAG for correctness and
an explicit objective for legibility. **Measurement says do not.** What follows
is why, and what to do instead.

## Measured

Baseline over the 38 `curated/` designs of `real_benchmark` that plan (4 plan
nothing — `partial_off_lattice` with an empty closure), verified directly
against the crate:

| | |
| --- | --- |
| designs / steps | 38 / 2,344 |
| steps sighted from a mark not on the paper (`marks_exist == false`) | **281 (12.0%)** |
| turn-overs | 127 |
| `cp_span` endpoints with no reference (corrected definition) | **19.6%** |
| steps with at least one such endpoint | **30.9%** |
| of those endpoints, referenced by a fold the plan makes *later* | 78.3% (89.1% on `complete` plans) |

The last row is the one that made the reorder look obviously right: four fifths
of the unreferenced endpoints have a reference the plan already builds, just
afterwards.

### What a dependency schedule actually does

A greedy over the true dependency DAG — a step runs as soon as its chosen
witness's inputs exist, preferring the side already up, then referenced
endpoints — with **the presentation witness recomputed the way `order.rs`
recomputes it**:

| | baseline | greedy |
| --- | ---: | ---: |
| phantom-mark steps | 230 | **367 (+60%)** |
| designs improved / regressed on phantom marks | — | **1 / 24** |
| unreferenced endpoints | 996 | 984 |
| designs regressed on endpoints | — | 4 |

`markhor-detailed`, the largest design in the corpus at 197 steps: unreferenced
65 → 67 **and** phantom 25 → 35. Strictly worse on both, for two turn-overs.

The first study missed this because it held the witness frozen, "so the
comparison is schedule-only". It is not schedule-only: `order.rs` re-picks each
step's presentation witness against the creases that physically exist by then,
so a scheduler upstream of that changes which witnesses are sightable at all.

### Why — and this is the part that matters

`Creased` is order-dependent in the **opposite direction** to the endpoint
objective.

The closure's early rounds fold long lines that cross the whole sheet. Those lay
down a dense grid of real crossings, and the later, finer folds sight from that
grid. A scheduler that promotes short-span folds early presses only short spans,
so the crossing a later O2 or O3 witness needs is not a physical mark, the
re-pick falls through, and the step ships as a phantom.

**Coarse-before-fine is not an aesthetic side-effect of the round. It is the
mechanism that makes marks exist.** Optimising for endpoint references fights
it directly, and on this corpus the fight is lost 24 designs to 1.

### Two more things the round is quietly doing

- **It makes the witness pick order-independent.** Every witness of a round-*r*
  fold was certified against the pre-round state — 0 of 40,920 recorded
  witnesses names a same-or-later-round line — so every member of a round sees
  the same paper and the choice does not depend on the order within it. Break
  the barrier and `marks_exist` becomes order-dependent, and the plan stops
  being a stable artifact.
- **It is the unit of grouping.** `order::group` merges consecutive steps
  sharing round, side, kind, direction, axiom and pattern into "fold the
  sixteenths horizontally: 7 creases". Grouping needs those runs consecutive,
  and the greedy moves 88% of steps.

## The decision

**Do not replace the round with a general scheduler.** The evidence does not
support it, and the failure it produces — a fold told to stop at a mark that is
no longer on the paper — is the same class of defect the reorder was meant to
cure, moved from the end of the crease to the start of the fold.

But two things are still wrong, and both get fixed.

### D1 — `round` leaves the model

There is no round in an origami crease pattern; there are steps, numbered from
one. `Step.round` is a closure sweep index wearing a domain word, and nothing
outside `order.rs` reads it — not the workspace, not the wasm bridge, not the
sequence consumers. It goes from `Step`, from the TypeScript type, and from
`Group`.

Inside `order.rs` the sweep index stays, because it is load-bearing, and it gets
named for the thing it actually is: `frontier` — which fold of the closure first
made this line constructible. The doc says what it is a proxy for (fold long
lines before short ones, so that later folds have marks to sight) and what
breaks if it is removed (the numbers above).

This is not a rename for its own sake. The field is currently an invitation to
reason about rounds as though a folder had them.

### D2 — markhor's case, narrowly and without the general rewrite

markhor is not a counter-example to the finding; it is a genuine local win. The
same greedy emits `1, 4, 5, 2, 3, 6, 7, …` and improves markhor on every axis:
unreferenced endpoints 27 → 17, turn-overs 4 → 2, phantom marks 9 → 9.

What distinguishes it: steps 2 and 3 are **delayed**, not promoted. Nothing is
pulled forward into a state that has fewer creases in it, so `Creased` is never
made poorer — which is exactly the mechanism that breaks the general case.

So: **delay only, and only past folds that make the delayed step's own endpoints
referenced.** A step may be emitted later than its frontier when

1. no later-emitted step depends on it (the DAG edge, from
   `pinch.rs::downstream_uses`'s relation), and
2. the steps it is delayed past give at least one of its span endpoints a
   reference it did not have, and
3. it does not cross a turn-over — the delay stays inside its side block, so
   Revision 4's turn-over counts are untouched by construction.

Condition 2 makes this a targeted repair rather than a scheduler: it fires only
where the defect is, and it can only add creases before the delayed step, never
remove them, so `marks_exist` cannot regress.

### D3 — the objective is named, whether or not it is optimised

Whatever the ordering does, the file should say what it is trying to achieve,
in priority order, so the next request lands as a term and not as an argument:

1. every step sighted from marks that are on the paper (`marks_exist`);
2. as few turn-overs as the pattern allows;
3. as few creases as possible ending in mid-paper with no reference;
4. a readable sweep across the sheet.

Today 1 is served by coarse-before-fine, 2 by the side partition, 3 not at all,
4 by `order_round`. Writing that down is most of the value of the original
proposal, and it costs nothing.

## Affected areas

- `crates/oristudio-precrease/src/order.rs` — `Placed.round` → `frontier`, the
  D2 delay pass, the D3 objective doc.
- `crates/oristudio-precrease/src/sequence.rs` — `Step.round` and `Group.round`
  removed.
- `crates/oristudio-precrease/src/planner.rs` — the step assembly.
- `apps/web/src/cp-workspace/references/precreaseSequence.ts` — the wire type.
- `crates/oristudio-precrease/tests/planner_direction.rs` — the regression.

## Checklist

- [ ] D1 — `round` out of `Step`, `Group` and the TS type; `frontier` inside
      `order.rs`, documented as a proxy with the measurement that justifies it
- [ ] D3 — the objective, written down in `order.rs`'s module doc
- [ ] D2 — the delay pass, under all three conditions
- [ ] Corpus regression: phantom-mark steps must not rise on any of the 38
      curated designs, and turn-overs must not rise on any
- [ ] markhor: `1, 4, 5, 2, 3` in the emitted order, unreferenced endpoints down
- [ ] A crate test that fails if a delay ever makes `marks_exist` worse

## What would change this decision

The measurement is of *one* greedy with *one* objective ordering. A scheduler
that put `marks_exist` first — preferring folds that press long spans early,
with endpoint references as a tie-break rather than the driver — might beat the
proxy rather than fight it. That is a real experiment and it is worth running
before anyone concludes the round is irreplaceable.

What it must beat, on all 38 curated designs: **281 phantom-mark steps and 127
turn-overs**, with the presentation witness recomputed as `order.rs` recomputes
it. Freezing the witness makes any scheduler look good and is how this proposal
nearly shipped.
