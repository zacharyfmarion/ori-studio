# Fold: a tuck leaves layers beyond its target where they are

## Goal

Two kinds of tuck that real tutorials draw are refused today, though the
Valley and Mountain tools' layer-order chooser is where they belong (there is
no Tuck tool; a tuck is a landing the chooser offers):

- **A second block against one already inside a flap.** One corner of a
  multi-ply flap is folded into the pocket between its halves; the other
  half's corner then folds in against it. The chooser lists the second
  corner against the first ply of the flap only, which lands it in the wrong
  place, never against the first block.
- **A corner folded under its own plies, past layers that cross the fold.**
  The top plies' corner goes behind them and in front of the layers under
  them, which also cross the fold line. The chooser offers nothing.

Both refuse for one reason. The tuck's closure (Beloch's rule ii, ADR 0052)
brings along every moving-side layer between the block and its target T,
deciding "between" where the layer's piece on the moving side meets T. When
T lies wholly on the stationary side (the first block, or the top layer
under the plies), no piece meets it, so every layer in the block's way comes
along, including layers that cross the fold and lie beyond T on the
stationary side. Carried along, they wrap around T's hinge or the block's,
which no order allows.

## Approach

- Read "between" a second way: by the layer's whole face. A layer that
  crosses ℓ and lies beyond T where its face meets T stays. The pocket the
  block goes into opens against T, and what is beyond T stays with it, so
  the block never passes that layer.
- Use it only where today's tuck refuses: when the closure read by pieces
  would move T, or lands in no order, and the closure read by faces lands.
  When the two closures agree, or the first lands (or is undecided within
  the budget), the tuck is today's. Every tuck that landed lands as it did,
  and every saved step replays the same, stored order or not.
- One helper picks the moving set for landing, the analysis (what the
  preview shows moving), and the targets' listing, so they agree. The
  refusal's suggested targets keep the reading by pieces: they are offered
  only for a tuck that refused, whose moving set is that one.
- No new tool, op, document field or UI. The Valley and Mountain chooser
  (the placement search over tuck recipes) offers the new landings because
  its recipes land them.

## Affected Areas

- `crates/oristudio-fold/src/compound/tuck.rs`: `Reach`, the closure's
  reach, `State::tuck_moving`, the landing, the analysis and the listing.
- `crates/oristudio-fold/tests/tuck.rs`, `tests/fold_placements.rs`:
  synthetic cases (a square folded in half twice).

## Checklist

- [x] Diagnose the refusals on real tutorial steps (outside the repo): the
      closure sweeps layers that cross ℓ beyond a target on the stationary
      side.
- [x] Closure read by faces, used only where the reading by pieces refuses.
- [x] Landing, analysis and listing share the choice.
- [x] Synthetic tests: the second block against the first; a corner under
      its own ply past layers crossing the fold; the chooser offering the
      second block. Each fails with the reading by pieces alone.
- [x] Every saved model step and fold fixture replays with identical
      canonical keys on this engine and on main's (133 sequences, 3,074
      steps).
- [x] The real steps land the same paper as their saved collapses, through
      the chooser's own listing.
- [x] Checked in the app: the Mountain and Valley tools offer the landings
      (made by hand, they land the scripted steps' canonical keys).
