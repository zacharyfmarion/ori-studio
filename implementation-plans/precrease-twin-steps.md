# Precrease cards: symmetric folds on one card

## Goal

A diagram folds a symmetric pair — the left corner to the centre and the
right corner to the centre, the two diagonals, the four edges to the four
creases — as **one step**, with one number and an arrow for each fold. The
References plan makes them one at a time: markhor's steps 12 and 13 are the
mirror images of each other and get two cards, and so do 45 and 46, 47 and
51, 49 and 50. Zach (2026-09-15, with three diagram excerpts): "if two steps
in the same round are symmetrical, then generally a diagram does them in one
step", and the arrows should not overlap when that can be helped.

This is not the *also* of `precrease-legible-picks.md` (R8): that is one
fold with two alignments. This is two folds — two lines, two creases — made
at once because each is the other's mirror image.

## Approach

### What makes a twin

Two placed CP folds `A` and `B` are twins when all of these hold:

1. **Mirror lines.** `B.line` is the image of `A.line` under a symmetry of
   the sheet: the vertical or horizontal centre line, or — for a square —
   either diagonal. The excerpts are diamond-oriented squares, where "the
   same fold on the other side" is a reflection about a diagonal of the
   CP; the two bird-base diagonals are each other's image about the
   vertical *and* the horizontal. `order::mirror_witness` already reflects
   about the two centre lines; it becomes a `Symmetry` with four axes and
   both R8 and this use it.
2. **Mirror witnesses.** `B`'s presented witness is the image of `A`'s:
   same axiom, every input the mirror of the other's (the same matching
   `mirror_witness` does, one axis for both). A pair that folds the same
   line kinds but is sighted differently reads as two instructions and
   stays two cards.
3. **Free together.** Both are sightable on the paper as it stands *before
   either is made* — neither's marks come from the other, no press between
   them (`witness_cost == 0` for both against the same paper). The folder
   makes them "at once"; the order between them has to be immaterial.
4. **Same block.** Same closure round, same forced side, so they are
   already in one sweep block and no turn-over separates them. The
   ordering pass places them adjacently (twins are pulled together inside
   the block after `order_round`; the angle-cluster sweep is otherwise
   untouched).
5. **Same kind of crease.** Both CP (an auxiliary fold and a CP fold are
   never twins), and `made` of one the mirror of the other's within a
   pinch — a pair whose creases stop at different references is two
   different instructions. *Not* the same majority direction in the
   finished pattern: the block already fixes the face both are made from,
   and a mixed line's majority says nothing about that. Angelfish's two
   diagonals (2026-09-16) are a weak mountain and a weak valley, both
   folded on the front as corner-to-corner valleys, and comparing the
   majorities kept them on two cards — Zach: "they are functionally
   symmetric. We should be merging based on the actual creases that are
   folded." Angelfish reads as 52 cards, not 53; gigantura and markhor
   are unchanged.
6. **Still mirrored at the end.** Rules 2 and 5 are checked when the pair
   is placed; a fold sighted again later for a pinch it could not vouch
   for (R10, `repick_to_vouch`) may come to present a witness that is no
   longer the other's image, or leave a longer crease. Such a pair is
   parted at the end of the ordering pass
   (`order::part_twins_no_longer_mirrored`) and each is a card of its own
   — markhor-detailed 113 (2026-09-16) read "fold through P, bringing Q
   onto A; fold B onto C", a perpendicular through a mark beside a
   bisection, and Zach: "both the
   creases made and the way the creases are made need to be symmetric".
   The parted pair gets no `also`: the mirror that stood in for it was
   checked on the paper as it was, not as it is.

Quads (the four edge-to-crease folds of the Terao excerpt, step 4) are two
twin pairs that are twins of each other about the other axis. Phase 1 is
pairs; quads are phase 2, gated on how a four-arrow card reads.

### How the crate says it

`Step` keeps one entry per fold — `id`, `line_id`, `lines[].step` and every
lookup stay unique — and gains

- `card: u32` — the number the folder sees, 1-based in presentation order,
  **shared by twins**; every other step's `card` is its own. The filmstrip,
  the sentences and the sidebar number by `card`, never by `id`.
- `twin: Option<u32>` — the `id` of the step made at once with this one.

`order::Placed` gains the same, and the ordering pass finds twins inside a
block after `sight` (both witnesses known, both costs zero), as the last
step before `record`. Turn-over cards number as they do now (they are not
steps). `Sequence.totals` gains `cards` beside `folds`; `measure_ends`
prints it, and the corpus gate is cards down, nothing else up.

### How the web shows it

- **View steps.** `referencesSequenceView` merges consecutive steps with one
  `card` into one view step (the fold card for the pair); crease visibility,
  the CP highlight (`highlightLineIds` is the union of both `cp_line_ids`)
  and "folded so far" all move by card. Navigation, keyboard shortcuts and
  the filmstrip count cards.
- **The picture.** `plannerStepDiagram` draws both folds on one card: both
  creases in their direction, both witnesses through `drawWitness` with
  letters carrying on (`alsoLetters`), one motion arrow each. An *also* on
  a twin is dropped — the twin is the symmetric alignment, and four arrows
  is too many.
- **Arrows apart.** `foldArrowArc` takes the side its arc bulges toward; for
  a twin card the second arrow mirrors the first's choice about the twin
  axis, so mirrored folds get mirrored arrows and never the same lane. When
  two arcs still cross (two corners folded to the centre from adjacent
  corners can), the pair stays one card — Zach: "sometimes it's not
  [possible], which is fine" — but the arc for each is chosen from the two
  bulge sides to minimise crossings with the other's, which handles the
  markhor 12/13 case. Measured by a unit test over the excerpts' geometry.
- **The sentence.** `describePlannerStep` composes both witnesses' clauses
  with the twin's letters: "Fold P onto Q and R onto S." for two O2s (one
  template per axiom pair, the common ones; the fallback is the two clauses
  in sequence, as *also* does today). A pinch note or a press note on either
  fold is said once.
- **Sidebar and grouping.** `referencesBreakdown` counts cards; the group
  chip that today says "×3" for three parallel folds is unchanged, since a
  group is a sidebar row and a card is a card.

### Order of work

1. `Symmetry` in the crate (four axes; `mirror_witness` on it; unit tests
   on a square and a rectangle) — no behaviour change.
2. Twin detection in `order` behind `PlannerOptions::twin_steps` (default
   on), `Step.card`/`Step.twin`, totals; crate tests: a symmetric pair on
   the bare sheet becomes one card, a pair whose second needs the first's
   mark does not, a pair on different sides does not, cards number
   contiguously; markhor pins for 12/13, 45/46, 47/51, 49/50.
3. Bridge: the types in `precreaseSequence.ts`; the fixture gains a twin
   pair.
4. Web: view steps by card; the twin card's picture and sentence; arrow
   lanes; tests for each; i18n for the pair templates (8 locales).
5. Corpus: cards vs steps per design; markhor and iguana by hand in the
   browser (Zach).

## Affected Areas

- `crates/oristudio-precrease/src/order.rs` — `Symmetry`, twin detection
  after `sight`, `Placed.card/twin`.
- `crates/oristudio-precrease/src/sequence.rs`, `planner.rs` — `Step.card`,
  `Step.twin`, `Totals.cards`; `PlannerOptions::twin_steps` and its JSON.
- `crates/oristudio-precrease/examples/measure_ends.rs`, `dump_steps.rs` —
  cards.
- `crates/oristudio-precrease/tests/planner_markhor.rs` — the pairs above.
- `apps/web/src/cp-workspace/references/precreaseSequence.ts`,
  `referencesSequenceView.ts`, `referencesCreaseVisibility.ts`,
  `referencesFilmstrip.ts`, `referencesBreakdown.ts`,
  `referencesStepSentences.ts`, `diagram/plannerDiagram.ts`
  (`drawWitness` twice, arrow lanes), `__fixtures__/plannerSequence.ts`,
  locales.

## What landed (2026-09-15)

`order::Symmetry` (four axes), `twin_in_queue` and the twin placement in
`order_with`, `Step.card`/`Step.twin`/`Totals.cards`,
`PlannerOptions::merge_symmetric_steps` (on; `measure_ends --no-twins`),
the "Merge symmetric steps" setting with its help mark, the view-step
merge, the twin card (both creases, both witnesses with the letters
carrying on, an arrow each), the paired sentence for O1/O2/O3 pairs and
two sentences otherwise, eight locales. The crate's lander scan for the
card pool is over marks on the paper only, which made the mirror witness
findable at all on a design this size. Markhor: 163 steps → 97 cards;
iguana line by line: 8 twin steps. Arrow lanes — choosing each arc's
bulge to miss the other's — are not done: mirrored geometry gives
mirrored arrows, which keeps them apart in every pair looked at so far.

## Checklist

- [x] `Symmetry` with four axes; `mirror_witness` on it.
- [x] Twin detection in the ordering pass; `Step.card`, `Step.twin`,
      `Totals.cards`; option and JSON.
- [x] Crate tests and the markhor pairs pinned (as a count and the pair
      invariants; the pairs move with the order).
- [x] Bridge types and fixture.
- [x] View steps by card; CP highlight and crease visibility by card.
- [x] Twin card: both creases, both witnesses.
- [ ] Arrows in separate lanes when mirrored arcs cross.
- [x] Twin sentence and locales.
- [x] A pair made two different ways after a re-sighting is parted
      (2026-09-16): markhor-detailed 136 → 137 cards, the pair on the two
      45° lines through (½, 0.573) and (0.448, 0.521); tabby cat and
      markhor unchanged.
- [x] Corpus (54 designs, 2026-09-15): 4,035 steps read as 3,168 cards —
      867 pairs, a fifth fewer cards — with steps, turn-overs, lost ends,
      pieces and reach unchanged against the run before twins (53 common
      designs: steps 3,729 → 3,731, turn-overs 308 → 308, lost ends 142 →
      139, reach 112.9 → 113.2). With only the simple kinds one card
      (O1, O2, O3, the edge onto itself): 4,039 steps, 3,327 cards — 712
      pairs — turn-overs 320, lost ends 139, reach 118.9; mirror witnesses
      61, O2 only.
- [ ] Zach folds markhor.
- [ ] Phase 2: quads.
