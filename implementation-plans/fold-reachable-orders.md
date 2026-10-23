# Fold: layer orders the fold can reach, combined per side

## Goal

A plain valley or mountain fold offers every layer order its motion can
reach, and only those. Today the chooser builds its list from tuck recipes
(outer, or tucked under a set of target faces), each of which pins one side,
so a fold landing across two independent sides never offers both sides
tucked: `tests/fixtures/fold-regressions/independent-sides-orders.osf` lists
six of nine (the known-gap test in
`apps/web/src/fold/orders/independentSidesOrders.wasm.test.ts`). A listing of
every flat stacking (fold-launch/solved-orders, reverted for the launch in
f029de1ec) reached all nine but also offered stackings no fold reaches by
moving: crane_new's flap folded over like a page, which can only land on top,
showed nine orders.

## Approach

- Keep the motion model the recipes encode: the moving block lands on top,
  or slides under target faces it can reach, the layers it passes coming
  along (`crates/oristudio-fold/src/compound/tuck.rs`, its target taken as
  its whole flat layer since fa3934153).
- Split the landing into the independent parts the layer-order solver finds,
  and run the recipes per part: on top, or each reachable tuck within that
  part. Offer the product of the parts' reachable placements, one choice per
  part in the chooser (the per-part UI on the reverted branch is reusable).
- Store a combined choice as the existing `against` landing with every part's
  targets, or as completion pairs only if replay is proven to pin them; keep
  the witness-orientation check (`up`) from the reverted branch so a shifted
  earlier step breaks the step instead of flipping it.
- Salvage from fold-launch/solved-orders where it applies: the per-part
  chooser rows, the honest `exact` (an exhausted search is exact), the
  listing deadline cap, and the corpus probes (never re-ask a settled order,
  reachability of every saved step).

## Affected Areas

- `crates/oristudio-fold/src/fold/placements.rs` (the recipe search, split by
  part), `compound/tuck.rs`, the bridge's `order_selection.rs`.
- `apps/web/src/fold/orders/` (per-part chooser), Repeat's mirroring of a
  combined choice.

## Checklist

- [ ] Confirm on crane_new that its flap-over fold has one reachable order,
      and list what the nine flat stackings were.
- [ ] Per-part recipes; product of reachable placements.
- [ ] Storage and replay of a combined choice, with the orientation check.
- [ ] Per-part chooser rows; no dialog when one order is reachable.
- [ ] Flip the known-gap test to pass (nine orders), and add crane_new's
      flap-over as a synthetic fixture: one order, no dialog.
- [ ] Corpus proof: every saved plain fold reachable and replaying
      identically; no settled order re-asked; no order the old recipes
      lacked except combinations of per-part recipes.
- [ ] An adversarial review before merge.
