# Fold: reverse a corner whose walls are several plies

## Goal

Reverse fold a point whose two walls are several plies each, between the
halves of a fold in half, where the plies of one flap of the tip lie between
the plies of another in each wall. Two shapes reach this:

- a corner folded in half twice and then in half again: each half is four
  plies closed along a second edge by two wraps nested on it, so the tip is
  two flaps (the outer wraps and the inner ones, each a sheet vertex folded
  in quarters) that interleave;
- a point whose spine edge carries both joints between the halves and joints
  inside one half: a zig-zag strip hinged on the centre fold with a separate
  two-ply flap folded round the centre fold between its plies.

Today the reverse fold finds the right opening for each flap — between the
halves, along the fold in half — and then refuses `reverse_kind_infeasible`
for both kinds. The cases come from tutorial steps recreated through Import
CP; the CP landings are the targets the native fold must match physically.

## Approach

- **Why it refuses.** Each flap opens on its own, as two blocks, and pairs
  across blocks keep their absolute order unless the openings nest
  (`Tip::packet_pairs`). Interleaved halves do not nest: one flap's upper
  block has a ply above and a ply below the other flap's. Keeping the
  absolute order across the blocks while each block reverses is a cycle at
  that point, so no order fits.
- **Reading.** Two openings along one spine whose halves *interleave* turn as
  one packet, as nested ones do: they share one gap (each upper half above
  the other's lower half wherever they overlap), and some face of one half
  lies between two faces of the other's at one point. Upper blocks are
  coupled with upper blocks and lower with lower; every other pair, and every
  block against its own body, is seeded as before.
- **Steps that land today land the same.** The new reading applies only
  where a face lies between two faces of one block at a common point, which
  the old absolute-order seeds always contradict; nested coupling and every
  other rule are unchanged. A replay of every saved tutorial model (outside
  the repo) on main's build and this one agrees state by state.
- **Crimps** share `packet_pairs`; for a block that moves by a rotation the
  coupled and kept orders are the same, so crimps that land are unchanged.
- **Not changed:** the opening scan, the bodies, the completion, the bridge
  and the tool. The tool already steps through openings when a flap has
  several (the zig-zag point has five; one lands).

## Affected Areas

- `crates/oristudio-fold/src/compound/reverse.rs` (`Tip::packet_pairs`, module
  docs), `compound/mod.rs` (`Across::Packets` docs).
- `crates/oristudio-fold/tests/reverse_multi_ply.rs` (new).

## Checklist

- [x] Re-run the tutorial steps on main: all three still refuse.
- [x] Diagnose: the openings are right; interleaved halves keep absolute
      order and contradict their own reversal.
- [x] Couple interleaved halves of openings on one spine that share a gap.
- [x] Synthetic tests: an eight-ply corner of interleaved halves reverses
      between them with the expected stack, letters, replay; the same on its
      precrease and from the back (mirrored); outside refuses. They fail
      without the change.
- [x] Tutorial steps: the three land the same paper as their CP landings;
      every saved model replays identically on main and this branch.
- [x] Swap candidates written and checked with the app's reader.
- [x] App check: the Reverse tool makes each step by hand.
