# Two swivels that share one crease

## Goal

Tutorials often swivel both sides of a model at once: fold a strip up and
squash the corner out on each side. On the layer in front, each side is a
swivel by its valley and mountain, on its own folded edge, and one crease of
each runs across to the other side's folded edge and is the same crease:

- **the hinge on the front layer** (`b`): a valley across the front layer
  from one folded edge to the other, a mountain at each end (a kite's bottom
  corner folded up, each side squashed);
- **the crease behind** (`s`): a cupboard's two flaps, each with its own
  valley and mountain, and the layer behind them creased once across
  (the strip folds up behind both flaps, their corners swing out).

Either swivel lands alone today, but it is not that step: the shared crease
runs on to the other folded edge and the other side's flap is carried with
the strip, creased along the crease's image. The other swivel then refuses
`swivel_line_meeting`: its lines now meet where the strip's new fold and the
carried flap's crease end, four folds whose flap the hinge-end reading
cannot name (its hinges show one letter, or two coincident flaps both
qualify).

Land the two swivels together, as one fold, exactly.

## Approach

- **The motion.** Each swivel has its three rays from its own vertex and its
  four motions (near `R_s`, turn `R_s ∘ R_h`, beyond `R_b`, stays). The
  shared crease is one cut; the paper between the two vertices along it is
  one wedge of both swivels with one motion (the near wedge where `s` is
  shared, the wedge beyond where `b` is). Paper whose two swivels' motions
  disagree holds them (`fan_ray_blocked`).
- **One reading for one or two fans.** `folded_swivel`'s two-layer reading
  takes a list of fans: cuts on coincident lines are one cut, the paper that
  stays is one part, a part joined to two wedges is held unless their
  motions are one. A single swivel reads exactly as before.
- **Resolution.** Each swivel's lines meet on a folded edge as the swivel by
  its valley and mountain reads them (`folds_at`, `build`); where several
  folded edges qualify, the pair that compiles. Then one compiled fold
  (`Compiled::land_checked`, every offered order landed first).
- **Not yet.** Paper beyond the four layers that holds the wedges (the stack
  reading of `folded_swivel::assign`) refuses `fan_ray_blocked`; the
  multi-ply case waits for a real need of it.

### Open product question (not built)

How the folder names the pair. Options:

1. **One step, the second swivel named with the first**: the
   valley-and-mountain op takes an optional second pair
   (`also: { valley, mountain }`); the Swivel tool, once the first pair's
   preview shows its shared crease running to another folded edge, offers
   the other end's two lines (the valley pre-filled when it is shared).
   Diagram-faithful (every one of these steps draws both sides at once);
   a document-format change (the reader rejects the field today) and new
   tool UI.
2. **Two steps, the second made after the first**: no format change, but the
   second swivel's lines lie on the carried paper, where no diagram draws
   them, and the engine needs a new reading of that corner (a flap whose
   hinges show one letter, or two coincident flaps) in
   `swivel_hinge_end.rs`.
3. **A new op kind** (`swivel-pair`): as 1, in its own op.

Recommendation: 1.

## Affected Areas

- `crates/oristudio-fold/src/compound/folded_swivel.rs` (the two-layer
  reading over several fans)
- `crates/oristudio-fold/src/compound/swivel_pair.rs` (new)
- `crates/oristudio-fold/src/compound/swivel_valley_mountain.rs` (resolution
  helpers shared)
- `crates/oristudio-fold/tests/swivel_pair.rs` (synthetic cases)

## Checklist

- [x] Re-run the four nodes on main: all four still refuse or land different
      paper
- [x] Diagnose: three share a crease between two swivels on two folded edges
      (one `b`, two `s`); the fourth's flaps are multi-ply
- [x] The two-layer reading over several fans, single swivels unchanged
- [x] The pair: resolution, compile, land; refusals
- [x] Synthetic tests: a shared hinge and a shared crease behind (each
      side's creases are its own swivel's, the figure its own mirror image,
      not the single swivel's paper, order-independent, replays); refusals
- [x] Every saved swivel in real models still replays identically
- [x] Real-design check outside the repo (provisional, local wire field):
      the three pairs, and a fourth step of the same shape, land the
      imported paper exactly, and every later step still lands
- [ ] The product question answered; then the wire op, the tool, its
      preview and picture, words, analytics
- [ ] A pair through the stack (multi-ply flaps), when a step needs it
