# Fold: read a tuck locally where strictly it has no order

## Goal

A tuck that folds is a Valley/Mountain layer-order choice (its landing
`against` a layer). Some tucks a diagram asks for never appear in that
chooser: folding a strip down along a precrease into the pocket between a
section and the body, where a side flap lies over the pocket's layer at the
bottom but folds into the strip's own fold at its hinge. The tuck against the
pocket's layer refuses (`tuck_infeasible`), so the step had to be an Import CP
collapse.

Make such a tuck land, through the existing chooser, without changing any tuck
that lands today. (A re-order with no fold is not this: it is the Adjust order
tool.)

## Approach

A tuck places its block against T by the strict reading of "immediately
under T" (`compound::tuck::placements`): against every layer that meets T
anywhere, by which side of T that layer is on. For the pocket above, the side
flap meets T at the bottom, on T's side, so the strict reading puts the whole
strip under it, while at the hinge the strip's middle must wrap round it. No
order fits.

- **Local reading** (`tuck::Reading::Local`): a layer's side of T constrains a
  block face only where that face, the layer and T overlap together. Elsewhere
  the pair is the completion's.
- **Strict first, everywhere.** `land_placed` completes the strict placements;
  only when they have no order at all (not a budget run out) does it try the
  local ones. A stored choice replays strictly; only when the strict reading
  has no order at all is it replayed locally, so a choice the strict reading
  breaks stays broken. The closure a tuck moves (`tuck_moving_given`) is still
  decided strictly. So every tuck that landed before lands as it did.
- The targets' listing and a refusal's fixes ask the same question
  (`lands_read`: strict, else local), so they offer what lands.

The placement search runs tucks against sets of targets, so it finds these
orders with no change of its own. On the independent-sides known gap it now
lists seven of the nine orders: both sides between is one of them.

## Affected Areas

- `crates/oristudio-fold/src/compound/tuck.rs`: `Reading`, `placements`,
  `placements_all`, `lands_read`, `land_placed`.
- `crates/oristudio-fold/README.md`: the tuck's paragraph.
- Tests: `crates/oristudio-fold/tests/tuck_local_reading.rs` (an invented
  model: two flaps folded in at two opposite corners, the third corner tucked
  between both sides' flaps at once);
  `apps/web/src/fold/orders/independentSidesOrders.wasm.test.ts` and
  `tests/fixtures/fold-regressions/README.md` (seven orders).

## Checklist

- [x] Local reading, strict first, stored choices and closure unchanged
- [x] Rust test on an invented model; the strict reading on main refuses it
- [x] The pocket step lands the same paper as its Import CP (scratch swap
      script); every saved model replays unchanged
- [x] Browser check by hand; test page
- [ ] Owner review; corpus install of the swap script after merge
