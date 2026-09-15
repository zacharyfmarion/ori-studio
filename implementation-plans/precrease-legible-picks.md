# Precrease cards: picks a folder can see, trust and reach

## Goal

Zach folded markhor (`markhor_feedback.fold`, 163 steps, no presses, no
grid) from the References workspace and came back with 26 steps that were
hard, inaccurate or wrongly described. Every one of them traces to how the
ordering pass **picks the witness a card presents** (`order::pick_witness`)
or to what it is allowed to pick from. The plan is a per-item diagnosis,
then the rules that fix them as a class, each one measurable on the corpus
and pinned on this file.

Research method: `examples/explain_steps.rs` (new) replays the plan onto a
bare sheet, and at a step re-derives *every* construction the paper offered
(`all_witnesses_on`, not the closure's capped list), printing for each
whether it was sightable, whether it was visible (`hard`), and two numbers a
folder feels:

- **lever** — how far apart the two things being lined up are (two points
  for O1/O2, the overlap of the creases for O3/O4/O7, the swing radius for
  O5). The fold's angular accuracy is bounded by it.
- **reach** — how far the crease being made is from where the alignment
  happens (the midpoint of the pair, the vertex of the bisected lines, the
  foot of the perpendicular, the pivot). The angular error grows by it.

`cargo run --release -p oristudio-precrease --example explain_steps --
<file> 21,30,31` prints it; the full reading for this file is in the
session scratchpad and summarised below.

## What each item is

| Step | Card | What the paper offered instead | Cause |
| --- | --- | --- | --- |
| 21 | O3 fold x=¾ onto the diagonal, both interior, `hard` | O5 through (¾,¾) swinging corner Ne onto x=¾ — visible, pivot at the crease. Not in the closure's list (it recorded one witness). | ease before visibility; capped list |
| 30 | O2 two interior points, lever 0.25, reach 0.19, `hard` | O5 with the top edge moving (visible); nothing great — the crease is 0.02 long | ease before visibility |
| 31 | O2 (½,1)@edge onto (0.40,0.90): lever 0.15, **reach 0.74** | O7/O4 fold the 45° crease onto itself at the crease's own end: reach 0.04. Not recorded. | no precision term; capped list |
| 32 | O2 (0,¼)@edge onto interior, lever 0.96, reach 0.57 | O7 through the interior mark ⟂ the 45° crease, reach 0.04 | no precision term |
| 34 | O2 (0,½)@edge onto (0.15,0.65), lever 0.21, reach 0.25, for a 0.71 crease | O4 through (0,0.65)@edge folding the main diagonal onto itself — Zach's own method ("line the corner up with the diagonal") — its alignment is 0.03 because the diagonal's crease stops there; and O1 through the two edge marks 0.91 apart, both on the crease | O4-on-a-crease is ease 6 ("hinge trick"); O1 is ease 7 whatever the lever |
| 36 | O2 corner Nw onto (0,0.65)@edge, reach 0.5 for a 0.15 crease | O2s at the crease itself; O1 through its own ends (0.15 > `SHORT_CREASE`) | `SHORT_CREASE` too small; no locality |
| 37 | O2 two interior points, lever 0.07, `hard` (skinny) | O2 (½,1)@edge onto (½,0.82): lever 0.18, reach 0 — Zach's suggestion, sightable, in the list | all O2s tie on (ease, hard); the residual decides |
| 48 | O2 (0.85,1)@edge onto (0.38,0.52), reach 0.7 | O3 top edge onto x=⅜ — a bisection at (⅜,1), the crease's own end; O4 through the edge mark | ease before locality |
| 56 | O1 own ends, valley from the back | the same crease pinched as a mountain from the front | side rule folds everything as a valley |
| 58 | O2 two interior points, `hard` | O1 (0.38,0.77)–(0.46,0.56) with the crease's end; O5 with the left edge moving | ease before visibility |
| 71 | O2 (0.55,1) onto (0.46,0.96) for a 0.92 crease | O3 x=½ onto the 45° crease, bisection at (½,1) (recorded, sightable, visible, lever 0.71); O1 through both ends (0.92 apart) | ease before locality |
| 73 | O2 onto Q=(0.35,0.65) | O3 bisection at the edge; Q is where the y=0.65 crease *ends* on the antidiagonal (step 35 stopped there by the reach rule) — a T, not a crossing, and Zach did not see it as a mark | mark strength; ease before locality |
| 81 | O2 two interior points **0.06 apart**, reach 0.35, `hard` | O1 through two marks at the crease, lever 0.14, reach 0.02 | residual tie-break among equal (ease, hard) |
| 93 | O5 through (¾,0.04) swinging (0.71,0.15) onto the bottom edge: pivot 0.04 from the landing line, radius 0.11 | O4 through the crease's end ⟂ the antidiagonal (lever 0.29); O1 through two marks | no conditioning term for a swing |
| 103, 104 | O2 two interior points, `hard` | O4 top edge onto itself through (0.29,0.96) — **recorded, sightable, ease 2** — Zach's ask | (0,true) < (2,false): ease before visibility |
| 122 | O2 two interior points 0.07 apart | O1 through the crease's own ends, 0.18 apart | `SHORT_CREASE`; lever |
| 127 | O2 two interior points, `hard` | O3 45° crease onto y=0.65 at (0,0.65), the crease's end (recorded) | ease before visibility/locality |
| 129 | O2 (¾,¼) onto (0.65,0)@edge | O3 bottom edge onto the antidiagonal at corner Se, the crease's start | ease before locality |
| 136 | O2 (⅝,⅝) onto (⅝,0.95), `hard` | the mirror pair on x=⅜ is equally sightable; both together keep the fold straight | one witness per card |
| 140, 142 | O2 | O3 bisections at the crease's end (recorded) | ease before locality |
| 146 | O2 (0.65,0)@edge onto (0.60,0.04): lever **0.06** | O1 through the crease's own ends, 0.10 apart | lever |
| 147, 157 | O1 own ends, valley from the back | the same, pinched as a mountain from the front | side rule |
| 158 | O2, valley from the back | mountain pinches | side rule |

Three things are wrong, and they are the same three everywhere:

1. **The key is `(ease, hard, err)`** (`Witness::preference`). Ease first was
   deliberate — a skinny "fold P onto Q" should beat a clean hinge trick —
   but `hard` conflates *skinny* with *invisible* (no edge or corner in
   the alignment: the folder lines up something they cannot see). An
   interior-to-interior O2 outranks an edge folded onto itself through a
   mark (103, 104, 127) and a corner swing (21), and among a dozen O2s that
   tie on `(0, true)` the certificate residual — noise — decides (37, 81).
2. **Nothing measures precision or locality.** A pair 0.06 apart (146, 81)
   ranks with a pair a sheet apart; an alignment three-quarters of a sheet
   from the crease (31, 48) ranks with one at the crease. Every "should be a
   bisection" is an O3 whose vertex *is* the crease's end; every "just
   connect the points" is an O1 whose lever is the crease itself and whose
   reach is zero.
3. **The pick sees a capped, closure-ordered list.** `witnesses_on` keeps
   sixteen per axiom in scan order and the closure stops early once a line
   certifies (21 recorded one witness; 31 never saw its O7), and
   `found_witnesses` runs only when the recorded pick is not "clean". The
   construction the folder wanted often existed on the paper and was never
   scored.

Plus two things that are not about the pick: the side a short crease is
made from (56, 147, 157, 158), and one witness per card where two
symmetric ones would keep the fold straight (136).

And one thing that is not a preference at all. Zach: *"we should disallow
having the starting point of a 'fold two points together' be a point on
the interior of the paper. It's just not a practical fold."* Lining an
interior point up on another means seeing through the paper. That is
what 30 is (both points interior), and 37, 58, 81, 103, 104, 122, 127, 136
and 140 are the same fold presented nine more times; it is the single
most common card in the list.

## Approach

Each rule is one measurable change; they land in the order below, each
re-measured on the corpus (`measure_ends`, plus the new pick tallies) and
pinned on `markhor_feedback.fold` step by step.

### R0. An interior point never starts a point-onto-point fold

A constraint, not a score. An O2 is a fold only when the point that moves
is on the boundary — a corner, or a mark on an edge — with one exception,
Zach's: the moving point may be interior when **a crease already made
runs through it, parallel to the fold being made, with the opposite
assignment** (a mountain through the point when the fold is a valley, or
the reverse). Folding that crease first turns the interior point into a
point on a folded edge, and because it is parallel, folding the flap over
does not disturb what is being lined up. Nothing else qualifies: not a
crease through the point at another angle, not a mark that is merely
visible.

Where it applies:

- **The pick.** `pick_witness` never presents an O2 whose moving point is
  interior and not on such a crease, however it scores — even when the
  alternative costs a press, since a press buys a mark on the boundary or
  a crease to line up along, both of which the folder can see. `who_moves`
  already puts the boundary point first when there is one; the rule bites
  when both points are interior, and the exception decides which of the
  two moves.
- **The closure.** Such an O2 does not certify a line on its own: a line
  whose only witness is an impractical fold waits, and the stuck search
  or ReferenceFinder finds another construction — an auxiliary crease, a
  mark on the edge — the way it does for a line with no witness at all.
  This is the part with a cost: measured as extra auxiliary folds and
  steps on the corpus before it is switched on, and if the cost is bad
  the fallback is to present the fold flagged as impractical (the card
  says so) rather than to plan around it.

The predicate — `o2_start_is_practical(state, creased, fold, direction,
w)`: the moving point is `on_boundary`, or some creased line reaching it
(`Creased::reaches`) is parallel to the fold within `MIN_ANGLE_SINE` and
was made in the opposite direction (the step's own `direction`, the same
face) — lives in `marks.rs` beside the other "on the paper" questions, and
`explain_steps` prints it. Pins: 30 and the nine above stop being
interior-onto-interior O2s; 32 stays (its moving point is on the edge).

### R1. Visibility outranks ease; skinny stays behind it

Split `Witness::hard` into what it already carries: `visible` and
`skinny`. The card key becomes `(!visible, ease, skinny, …)`: a fold whose
alignment the folder can watch — something on the boundary moves, or a
crease lands on a crease it can see — beats an easier kind of fold that has
to be lined up under the paper. Skinny keeps its place after ease (the
markhor measurement that put it there stands).

R0 removes the interior-onto-interior O2s outright; R1 is the same
judgement for every other axiom, as a preference: an O5 swinging an
interior point, an O3 of two interior creases (21). Expected: 103/104
become the O4 through the mark; 21 the corner swing. Risk: designs whose
only visible witnesses are O6/O7 get two-handed folds where they had an
invisible one — measured, and R5 below is what makes the visible set big
enough for this to be a choice rather than a fallback.

### R2. Precision and locality: lever and reach

Score every sightable witness by the two numbers `explain_steps` prints:

- `lever`: O1/O2 the distance between the points; O3/O4/O7 the crease
  alignment (`witness_alignment`, already computed); O5 the swing radius,
  discounted by how squarely the arc meets the landing line (93: a pivot
  0.04 from the line it lands on is ill-conditioned however long the
  radius).
- `reach`: the distance from the alignment's anchor to the nearest point of
  the crease the step makes (`Step.made`): the pair's midpoint, the
  bisected lines' vertex, the perpendicular's foot, the pivot.

The rule, in the key after visibility: a witness is **imprecise** when
`lever < MIN_LEVER` (a pinch's length or two, ≈0.1) or `reach / lever`
exceeds a bound (≈3: an error at the alignment grows threefold by the
crease). Imprecise witnesses rank after every precise one, whatever their
ease; among precise ones the ease order still decides, with `reach / lever`
as the tie-break in place of the residual. This is what turns 31, 32, 48,
81, 146 and the residual-decided ties (37, 81) into the constructions at
the crease.

### R3. A bisection at the crease is the fold

An O3 whose vertex lies at the crease being made (reach within a pinch of
its end) and whose two creases are there to see — an edge and a crease, or
two creases the folder can align — outranks a one-motion fold of any other
kind. It is the instruction a diagram gives for exactly these lines (48,
71, 73, 127, 129, 140, 142: every one is a 22.5° or 45° line starting where
two creases meet). Encoded as a term in the key rather than a special case:
reach 0 with a lever ≥ MIN_ALIGNMENT puts it first among precise witnesses,
and the ease order is not consulted between an O3 at the crease and an O2
elsewhere.

### R4. Connect the marks, by lever not by length

`SHORT_CREASE` (0.1) becomes a comparison, not a threshold: the O1 through
the crease's own ends is presented when both are marks and no visible
one-motion witness has a lever at least as long and a reach at most as
short. On 122 (0.18 long, the O2 on offer 0.07 apart), 146 (0.10, O2 0.06
apart) and 36 (0.15, O2 half a sheet away) that is the O1; on a long crease
with a bisection at its end (71) it is the bisection. O1's ease stays 7 for
every other case — a crease through two marks a sheet apart is still the
least accurate fold there is when the marks are not the crease's own.

### R5. The pick sees the whole paper

`pick_witness` scores `all_witnesses_on(state, line, creased)` — every
construction the paper offers at that moment — not the closure's capped,
scan-ordered sixteen. The closure's list stays what it is for
certification and for the stuck search; the presentation pass, which
already re-derives witnesses in `found_witnesses` when a pick is not
"clean", does it always. Cost: one enumeration per placed fold (the same
call `measure_ends` makes per step today), bounded by the existing caps in
`witnesses_on` on the *points* side (`MAX_POINTS_FOR_PAIRS`), which are
kept but ordered marks-first as now.

### R6. Short creases are pinched as mountains

A crease no longer than `PINCH_CREASE` (≈0.12 — 56, 147, 157 are 0.03 to
0.10) with both ends on marks is made on the face where it is a
**mountain**: `forced_side` flips for it, so a valley pinch is made from
the back and a mountain pinch from the front. Zach: "it's easier to pinch
mountain folds for connecting points that are close together". The
turn-over grouping already partitions a round by forced side, so the
flipped pinches join the other block; the cost is measured in turn-overs
(this file has 11; the corpus 320). 158 is two pieces of 0.19 and 0.38 —
not a pinch by this rule, and it is listed under the same feedback; the
threshold is read off the corpus rather than set to catch it.

### R7. A mark is a crossing, not an end

73's Q is where one crease stops on another — found by the reach rule as
an end, counted by `mark_exists` as a mark, and not read as one by the
folder. `mark_exists` distinguishes a **crossing** (both creases continue a
pinch past the point) from a **T**; the pick treats a T-mark as imprecise
(R2) so a bisection or a crossing-mark witness beats it, and the card that
must use one says "where the crease ends on …" rather than lettering a
point. No change to what counts as findable for a crease *end* — a T is
exactly right for that.

### R8. Symmetric references, both shown

When a second sightable witness of the same axiom is the mirror of the
chosen one about the sheet's centre line (136: the pair on x=⅜ beside the
pair on x=⅝), the card carries it as an *also*: `Step.also: Vec<Witness>`,
one entry, drawn as a second arrow and lettered, sentence "Fold A onto B and
C onto D". One witness still decides the pick; the second is presentation.
Symmetry only — two arbitrary pairs would be an O6 and read as one.

### R9. A crease folded onto itself through its own end

34, 31, 93 and 146 all have an O4 through the crease's end perpendicular to
a *crease* (the diagonal, the antidiagonal) with a long alignment — the
fold Zach described for 34 ("line the corner up with the diagonal": the
diagonal lands on itself, the crease goes through the edge mark). It is
ease 6 today, a "hinge trick", which is right for a perpendicular to a
short interior crease and wrong when the line folded onto itself is long
and the mark is on the edge or at the crease. R2 scores it by its lever
(the alignment) and reach (zero), so it competes; the ease entry for O4 on
a crease with alignment above `LONG_ALIGNMENT` (≈0.25) moves next to the
edge case. 34's diagonal alignment is 0.03 only because the diagonal's
crease stops at the fold: that is the reach rule's business (a diagonal
made whole at step 3 is what Zach had on his paper), noted here, not fixed
here.

### Measurement

`measure_ends -v` gains a pick tally per plan and in total: witnesses
presented that are invisible, imprecise (R2), bisections at the crease,
O1 through own ends, mountain pinches, cards with an *also*; and the mean
`reach / lever` of the presented witnesses. Gates against the state before
this plan (steps 3,973, presses 172, turn-overs 320, pinches-while-folding
573, reach 94):

1. invisible picks down to what has no visible alternative (reported);
2. imprecise picks: zero where a precise witness existed;
3. steps, presses and turn-overs not up beyond R6's pinches (reported
   separately);
4. `markhor_feedback.fold`: a pinned table — step → axiom and, where Zach
   named it, the inputs — for every item above, as an integration test
   like the iguana pins, so the next rule cannot silently undo this one.

Then Zach folds it again.

## Affected Areas

- `crates/oristudio-precrease/src/predicates.rs` — `Witness` gains
  `visible`/`skinny` in the key (`preference`), `lever`/`anchor` helpers
  (from `explain_steps`), O4-on-a-long-crease ease; `all_witnesses_on` for
  the pick.
- `crates/oristudio-precrease/src/order.rs` — `pick_witness` rewritten on
  the new key over the whole paper; `crease_between_marks` by comparison;
  `forced_side` flip for pinches; `Placed.also`.
- `crates/oristudio-precrease/src/marks.rs` — `o2_start_is_practical`;
  crossing vs T in `mark_exists`; swing conditioning.
- `crates/oristudio-precrease/src/closure.rs` — impractical O2s do not
  certify alone (behind the corpus measurement).
- `crates/oristudio-precrease/src/sequence.rs`, `planner.rs` — `Step.also`.
- `crates/oristudio-precrease/examples/{explain_steps,measure_ends}.rs` —
  the tool and the tallies.
- `crates/oristudio-precrease/tests/` — the markhor_feedback pins (fixture
  copied under `tests/fixtures/precrease/`).
- `apps/web/src/cp-workspace/references/` — `also` in `precreaseSequence.ts`,
  drawn by `diagram/plannerDiagram.ts` (second arrow, letters), said by
  `referencesStepSentences.ts`; locales.
- `implementation-plans/precrease-reach-references.md` — cross-reference.

## What landed, and where it differs from the above

The rules live in `crates/oristudio-precrease/src/judge.rs` (one
`Judgement` per witness, read by the pick, `measure_ends` and
`explain_steps` alike) and `order::pick_witness`. The key, in order:
practical (R0); free before pressed (one press may buy a one-motion fold);
visible (R1); precise (R2); at the crease (R3, R4); a crossing to sight
from (R7); the ease order; then the skinny flap, the error, the residual.
Then the override: among what is visible and precise with the same presses
— the same *cost*, not the same tier, so a free two-handed O1 competes —
the candidate the key likes best of those at least three times as accurate
as the ease-preferred pick. Refinements found on the way:

- **R3** asks that the angle be one the folder can see: the bisection's
  vertex on the sheet's edge, or one arm the edge itself. Two interior
  creases meeting inside the sheet are lined up under the paper, and a
  short crease between them is joined (R4) instead.
- **R4** own-ends outranks R7: a short crease pinched between the two
  creases it runs between is read off them, even where one end is a T
  (146, 157). And joining a crease's own marks is one motion.
- **R7** a pinch is a mark made to be read — a pinch's length centred on
  the point counts as continuing — else every mark pinched while folding
  read as a T. The override ignores R7: a fold sighted from a crease's end
  three times nearer the crease beats one from a crossing a sheet away.
- **Marks already there** before a spot still to be pinched while its
  crease is made, among free folds — after R7, before the ease order. A
  pinch made while folding costs no step but is ink, and without the term
  the corpus made 254 more of them; with it 103 and 104 are the top edge
  onto itself through the crease's start point, Zach's own words.
- **R8** the mirror is a *different* witness: an O1 through a symmetric
  pair read from the other end is not one. `Step.also: Option<Witness>`,
  drawn with letters carrying on from the first's, sentence "Fold P onto
  Q. Fold R onto S. Line up both at once, so the fold stays straight."
- **R9** a long crease folded onto itself through a mark is one motion, as
  the edge is — without that the ease it gained meant nothing at the tier.
- **The override takes the best-by-key candidate**, not the most accurate:
  past three times better, the bird base's corner swing (O5) is still the
  fold over a crease sighted through two marks (O1).
- **R6** flips `forced_side` for a firm pattern crease no longer than
  `PINCH_CREASE`; the step keeps the pattern's direction (a mountain from
  the front is the mountain pinch) and the side test knows the case.
- **R0's closure half** is not done: an impractical O2 still certifies a
  line; the pick presents it only when nothing practical exists and flags
  the step `impractical` (markhor has none).

Second round, from Zach's next fold of markhor (2026-09-14):

- **R1 at the flap's edge** (`judge::landings_seen`, folded into
  `Judgement::visible`). Whatever is carried onto a crease lands *under*
  the flap — what moves is part of it — so the folder can only watch the
  alignment where the crease landed on comes out from under the flap's
  edge: it has to be there at the point where the folded flap's boundary
  crosses it (the image of the moving mark, or of the moving arm's end on
  the sheet's edge) and for a pinch's length beyond. Markhor 48 folded a
  crease onto itself whose other arm lay wholly under the flap; it is now
  the right edge swung onto a mark. An edge landed on is there everywhere;
  a flap's own edge is seen wherever it overlaps; a line folded onto itself
  is judged for the shorter arm, the one the card swings.
- **A crease through two marks runs from the one to the other**
  (`order::through_marks`): "fold through P and Q" creases all the way to
  both, whatever the pattern wants between them (markhor 50), and the
  paper carries that crease for the folds after it. Which made the cost of
  a far-apart pair visible: volant-penguin joined two marks 0.92 apart for
  a 0.065 pinch, and the corpus's crease past the pattern went from 86 to
  129 sheet-sides. So an O1 whose marks lie beyond the crease by more than
  the crease's own length (and more than a fifth of the sheet) is
  **overlong** (`Judgement::overlong`), and sorts after every other free
  fold, seen or unseen — Zach's rule for a crease carried to references,
  twice as long as it need be and he would rather have no reference,
  applied to the marks a card joins. It is still made mark to mark when it
  is all there is.
- **Held back for a nearer anchor** (`Closure::near_anchored`,
  `PlannerOptions::defer_far_anchors`, on by default; `measure_ends
  --no-defer`). The closure folded a line in the first round it could be
  constructed and the crease was made with whatever the paper had:
  markhor's x = ⅛ was constructible in round 2 and carried a quarter sheet
  to the edge for a crease a twelfth long, its ends on lines eighty steps
  later. The older rule (`prefer_findable_ends`) waits only while some
  other line in the sweep has *every* end found, which in that round
  nothing had. Now a line whose crease would be carried past the
  pattern's outer ends by more than twice that crease's length waits
  while a line still to come crosses it at an unfound end within that bar
  — never a requirement, and at most sixteen sweeps. Twice, not once, and
  the ends only: at one crease's length (with the gaps the reach rule
  joins counted in) x = ⅜ and ⅝ deferred too, and the lines that used
  them as references — 48's bisection, 103's edge mark — picked something
  worse; ten pins moved and iguana turned over three times more. At twice
  the ends' overrun the pins all hold: x = ⅛ moves to step 135 and
  creases exactly its pattern piece (both ends found) instead of 0.345,
  markhor turns over 8 times instead of 7; iguana line by line trades its
  three presses for three turn-overs — the same 101 cards, less ink.
- **R6 undone** (2026-09-15): Zach folded with the mountain pinches and
  wanted them back as valleys — every fold is a valley from the face it is
  made on, a short one between two marks included. `forced_side` no longer
  flips; the pinch pins lost their sides.
- **The key, reordered.** Undoing R6 changed the intra-round order, and
  31, 32 and 48 came back as folds lined up half a sheet from their
  crease: a free one-motion fold outranked a free two-handed one *before*
  visibility and precision were asked. Now: practical; free before pressed
  (one press may buy a fold the folder can watch, and nothing else — not
  one motion); corner to corner (below); not overlong; visible; precise;
  at the crease; a crossing; marks already there; **then** one motion
  before two hands; then the ease order. And precision has an absolute bar: the crease within a quarter
  sheet of the alignment (`MAX_REACH`), whatever the lever — two points a
  sheet apart fix the line well, but a crease half a sheet from where the
  folder holds them together is pinched blind. The sheet's edge folded
  onto itself with its foot at the crease's end is *local* (103, 104).
- **The card's pool sees the marks.** The closure's lander caps (96, in
  scan order) filled with points no crease reaches on a design this size,
  and the swing a folder would make — an edge mark onto a crease that is
  there (32) — was past them. The card enumerates landers over marks on
  the paper only, under wider caps (`full_facts_on`).
- **Corner to corner takes precedence** (2026-09-15, markhor card 6). The
  diagonals were presented as bisections of the corners' angles — the
  right edge onto the bottom edge — because a bisection with its vertex
  at the crease is *local* and corner onto corner, anchored at the
  sheet's centre, is not. Zach: "step 6 would generally be diagrammed as
  folding corner to corner… special case that case so that it's
  diagrammed that way, like that takes precedence." So it does, as a term
  of the judgement (`Judgement::corner_to_corner`): a corner onto a
  corner, or a crease through two corners, sorts before everything else
  that is free — before overlong, visible, precise and local — when the
  fold is creased the whole way across the sheet or near enough (the
  fold's ends at the sheet's edge beyond the crease by no more than its
  own length, the overlong measure). A thumb's width of the diagonal
  between two marks in the middle of the sheet is not that fold and is
  still joined between its marks. Card 6 now reads "Fold P onto Q and R
  onto S", the two corners each onto the opposite one, still one card;
  nothing else on markhor moved. Corpus (54 designs): 49 diagonals that
  were bisections at the crease are corner to corner now (641 → 592);
  steps 4,039 → 4,038, cards 3,327 → 3,326, presses 169 → 168 — all of
  it helioprion, which lost a step, a piece and a press — and every
  other design's plan is the same to the step.
- **The card's own geometry**: `sideOf` in `diagram/plannerDiagram.ts`
  judged a point on the fold within a billionth of a unit, which the
  document frame (a 400-unit sheet) did not meet; a receiving piece that
  starts at the fold's vertex was dropped and markhor 80 showed the piece
  the edge never lands on. Relative now, and pinned at both scales.

Pins: `tests/planner_markhor.rs`, gated on `ORI_PRECREASE_MARKHOR` (the
file is not committed), one entry per item above, by line. Iguana's
line-by-line pin moved from 0 presses / 91 steps to 3 / 94: three
verticals whose only free sighting was a blind O7 are each bought a pinch
on a pattern line and made as "fold the bottom edge onto itself through P"
— R1's trade, and the fixture that says what it costs.

## Checklist

- [x] Diagnose all 26 items against the paper as it stood
  (`explain_steps`); the table above.
- [x] R0 no interior start for a point-onto-point fold, with the
  parallel-opposite-crease exception — the pick; pinned 30, 37, 58, 81,
  103, 104, 122, 127, 136, 140.
- [ ] R0 in the closure — an impractical O2 does not certify alone;
  measure first.
- [x] R1 visibility before ease — pinned 21, 58, 103, 104, 127.
- [x] R2 lever and reach — pinned 31, 32, 48, 81, 146.
- [x] R3 bisection at the crease — pinned 48, 71, 73, 127, 129, 140, 142.
- [x] R4 connect the marks by comparison — pinned 36, 122, 146.
- [x] R5 the pick over the whole paper — pinned 21, 31.
- [x] ~~R6 mountain pinches~~ — undone at Zach's request; every fold a
  valley from the face it is made on.
- [x] R7 crossing vs T — pinned 73.
- [x] R8 symmetric *also* — crate, bridge, web; 136 turned out to be one
  alignment on the centre line, and the *also* shows on 17 of markhor's
  other steps.
- [x] R9 O4 through the crease's end on a long crease — pinned 34, 93.
- [x] The markhor_feedback pin table as a test; second round: 48 (landing
  seen past the flap's edge), 50 (an O1 creased to both marks — as an
  invariant over every O1 step).
- [x] Corpus gates 1–3, measured 2026-09-14 on the 53 designs both runs
  planned (the curated set has changed since the baseline; abra and
  wolpertinger are gone from it). After the first round: steps 3,738 →
  3,715, turn-overs 308 → 312, lost ends 140 → 146, pieces 403 → 407,
  reach 86.8 → 86.4 sheet-sides. After the second (landings seen, O1 to
  both marks, overlong): steps 3,729, turn-overs 314, lost ends 146,
  pieces 399, reach 110.1 — the crease past the pattern is up by a
  quarter, which is the O1s creased mark to mark (129 before the overlong
  term). Over the 54 planned: presses 163, pinches while folding 675,
  picks 3,683 judged — invisible 109 (the landing rule finds more of
  them), imprecise 216, impractical 0, bisections at the crease 629, own
  ends 746, mountain pinches 1,155, mirrored 173, mean error 2.58. An
  invisible or imprecise pick is one with no free alternative that is
  not: the key sorts those first.
- [ ] Zach folds markhor again.
