# Fold: tuck a folded flap in place

## Goal

Make a diagram's "tuck the flap behind that layer" step natively when the flap
is already folded: no new crease, the flap moves to another place among the
layers (behind a layer, into a pocket). Six steps of a private recreation
corpus were Import CP collapses for exactly this, and every native route the
triage tried landed other orders (`tuck_target_moves` / `tuck_infeasible`, and
unfold-then-refold in every listed order).

Within the product rule that a tuck is a behaviour of Valley/Mountain, never a
tool: no rail button, no key, one fold tool per diagram arrow. Old saved files
replay unchanged.

## Approach

The six were two gaps, not one:

- **Re-seat at the same geometry (five steps).** The crease pattern is the
  parent's; only the order of one flap's layers against the paper that stays
  changes. The flap is folded along an edge, and either hinged there to paper
  that stays (a side panel tucked under a strip folded over it) or folded in
  two there and joined elsewhere to paper that stays (a corner flap folded in
  two along the model's bottom edge, a swivel's small flap folded onto the
  strip it came from). No line fold can move the second kind: its hinges are
  not collinear, so an unfold refuses.
- **A tuck into a pocket whose strict reading has no order (one step).** The
  plain valley along an existing precrease lands the right creases, but the
  tuck against the pocket's layer reads "on T's side" for a side flap that
  lies over T at the bottom yet folds into the strip's own fold at its hinge.

So:

- **Tuck in place** (`compound::tuck_in_place`): a block moved by the
  identity, through the compound pipeline unscored (`Scoring::unscored`), its
  hinges to the paper that stays kept as the parent has them
  (`Prepared::carry`), placed against a target as a tuck is
  (`tuck::placements`), the completion deciding the rest. The block is named
  by the seed and `InPlace`: `Flap`, the seed's flap as a plain fold along the
  line names it, hinged there to paper that stays (an unfold and a tuck in one
  step); `Fold`, the seed's layers and every layer folded against them along
  the line. Its report is a tuck's; its motion turns the block out about the
  line and back in.
- **Reached through Valley/Mountain.** A new landing,
  `{ kind: 'in_place', targets, moves }`, beside `outer` and `against`. The
  placement search lists the tucks in place once, after the outer landing and
  before any insertion, when the fold's line runs along a folded edge of the
  seed (`FoldPlacementSearch::in_place`), so the chooser offers them as more
  layer orders ("These orders move different layers" where they do). A pleat's
  legs never take one.
- **A tuck's local reading.** Where the strict reading lands in no order, a
  layer's side of T is read only where the block, the layer and T overlap
  together (`tuck::Reading::Local`). Strict first everywhere, and the closure a
  tuck moves is still decided strictly, so every tuck that landed before lands
  as it did; a stored choice the strict reading breaks stays broken unless the
  strict reading has no order at all.

## Affected Areas

- `crates/oristudio-fold/src/compound/tuck_in_place.rs` (new),
  `compound/tuck.rs` (local reading, shared placing and landing, in-place
  motion), `compound/mod.rs` (`Prepared::carry`), `fold/placements.rs`
  (`FoldLanding::InPlace`, the search's in-place listing), `refusal.rs`
  (`tuck_not_at_fold`), README.
- `crates/oristudio-fold-wasm/src/ops_tuck_in_place.rs` (new), `resolve.rs`,
  `wire.rs`, `order_selection.rs` (a landing in place explores its own order
  only), `ops_crimp_tuck.rs` (shared helpers).
- Web: the document's `FoldLanding` and reader, Repeat's mapping, the pleat's
  legs, the step's sentence and words, the refusal notice, `fold step added`'s
  `in_place` property, locale catalogs.
- Tests: `crates/oristudio-fold/tests/tuck_in_place.rs` (synthetic strips),
  `apps/web/src/fold/engine/foldTuckInPlace.wasm.test.ts`, the landing reader,
  words, sentence, refusal and analytics tests. The independent-sides known
  gap now lists seven of nine (both sides between is one of them).

## Checklist

- [x] Triage the six steps: crease diff, layer diff, which faces move
- [x] Local reading for tucks, strict first
- [x] Tuck in place engine op, both readings, refusal `tuck_not_at_fold`
- [x] `FoldLanding::InPlace` in the placement search and the bridge
- [x] Web document reader/writer, Repeat, pleat, words, sentence, refusal, analytics
- [x] Locale catalogs (`i18n:check`)
- [x] Rust tests on synthetic models; web wasm test
- [x] Six corpus steps land the same paper (scratch swap scripts); corpus replay unchanged
- [x] Browser check of one case; test page with before/after screenshots
- [ ] Owner review; corpus install of the swap scripts after merge
