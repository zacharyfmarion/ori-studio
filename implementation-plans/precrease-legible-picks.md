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

## Approach

Each rule is one measurable change; they land in the order below, each
re-measured on the corpus (`measure_ends`, plus the new pick tallies) and
pinned on `markhor_feedback.fold` step by step.

### R1. Visibility outranks ease; skinny stays behind it

Split `Witness::hard` into what it already carries: `visible` and
`skinny`. The card key becomes `(!visible, ease, skinny, …)`: a fold whose
alignment the folder can watch — something on the boundary moves, or a
crease lands on a crease it can see — beats an easier kind of fold that has
to be lined up under the paper. Skinny keeps its place after ease (the
markhor measurement that put it there stands).

Expected: 103/104 become the O4 through the mark; 21 the corner swing; 30,
37, 58, 127 leave the interior-onto-interior O2s. Risk: designs whose only
visible witnesses are O6/O7 get two-handed folds where they had an
invisible O2 — measured, and R5 below is what makes the visible set big
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
- `crates/oristudio-precrease/src/marks.rs` — crossing vs T in
  `mark_exists`; swing conditioning.
- `crates/oristudio-precrease/src/sequence.rs`, `planner.rs` — `Step.also`.
- `crates/oristudio-precrease/examples/{explain_steps,measure_ends}.rs` —
  the tool and the tallies.
- `crates/oristudio-precrease/tests/` — the markhor_feedback pins (fixture
  copied under `tests/fixtures/precrease/`).
- `apps/web/src/cp-workspace/references/` — `also` in `precreaseSequence.ts`,
  drawn by `diagram/plannerDiagram.ts` (second arrow, letters), said by
  `referencesStepSentences.ts`; locales.
- `implementation-plans/precrease-reach-references.md` — cross-reference.

## Checklist

- [x] Diagnose all 26 items against the paper as it stood
  (`explain_steps`); the table above.
- [ ] R1 visibility before ease — measure, pin 21, 30, 37, 58, 103, 104, 127.
- [ ] R2 lever and reach — measure, pin 31, 32, 48, 81, 146.
- [ ] R3 bisection at the crease — pin 48, 71, 73, 127, 129, 140, 142.
- [ ] R4 connect the marks by comparison — pin 36, 122, 146.
- [ ] R5 the pick over the whole paper — measure the cost; pin 21, 31.
- [ ] R6 mountain pinches — measure turn-overs; pin 56, 147, 157.
- [ ] R7 crossing vs T — pin 73.
- [ ] R8 symmetric *also* — crate, bridge, web; pin 136.
- [ ] R9 O4 through the crease's end on a long crease — pin 34, 93.
- [ ] Corpus gates 1–3; the markhor_feedback pin table as a test.
- [ ] Zach folds markhor again.
