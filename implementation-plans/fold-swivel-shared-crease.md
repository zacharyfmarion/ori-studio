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
- **Where the other end is.** A single swivel's analysis names it
  (`other_end`): the first of its hinge, its crease behind and its other
  named crease whose run through its own paper stops at a fold of that
  paper, inside the folded edge and away from its ends (not one that leaves
  at the paper's edge, whatever other paper lies there), and which crease
  that is, by its letter as seen or `behind`.
- **Preview and picture.** The pair's analysis is a swivel's: both sets of
  creases (the shared one once, a shared crease behind hidden from each end
  as far as that end's layer in front covers it), the moving paper by the
  first swivel's wedge of each block, `other_end` the second's vertex. Its
  picture is the strip's: the shared crease, the arrow from the paper both
  swivels move across it.
- **Not yet.** Paper beyond the four layers that holds the wedges (the stack
  reading of `folded_swivel::assign`) refuses `fan_ray_blocked`.

### The format (decided: one step)

The valley-and-mountain swivel op takes an optional `otherEnd: { valley,
mountain }`: the swivel at the other end of the crease the two share,
located as the first's lines are, of the first's kind. Named for what it is
in the fold — the other end of the shared crease — beside `valley`,
`mountain` and `swivel`, and the tool's own words. Written last and only when
there is one, so a single swivel is written as it always was. No
`formatVersion` bump: as with `fold` and `swivel` before it, a build that
does not know the key reads the op as one it cannot read and locks the step,
written back unchanged, rather than fold one swivel of the two. The wasm
bridge denies unknown fields in it too.

### The tool

In the Swivel tool's Valley and mountain, once the swivel is previewed and
its analysis names an other end, the window offers **Other end: Swivel there
too** (with which crease runs on). It takes the swivel as the first of two
(`FoldToolState.otherEnd`) and goes on to the second's lines: the valley
already taken when it is the shared crease; where the mountain is shared,
the valley located last, which folds. While they are located the first's
lines stay drawn in their pens and the second's lines meet, dotted, where the
shared crease crosses the other folded edge. Escape lets go of both. The
committed step is one swivel op with its `otherEnd`; analytics adds
`swivel_shared` to `fold step added`.

## Affected Areas

- `crates/oristudio-fold/src/compound/folded_swivel.rs` (the two-layer
  reading over several fans)
- `crates/oristudio-fold/src/compound/swivel_pair.rs` (new: fold, preview,
  picture)
- `crates/oristudio-fold/src/compound/swivel_valley_mountain.rs` (resolution
  helpers shared, `other_end`)
- `crates/oristudio-fold-wasm/src/ops_squash_family.rs` (`otherEnd`)
- `apps/web/src/fold`: document type, reader and writer, wire type, tool
  state, vertex step, window, canvas verbs, overlay, Repeat, step sentences
- `apps/web/src/components/fold/vertex/FoldVertexControls.tsx`
- `apps/web/src/analytics`, `docs/analytics.md`, locales (8)
- Tests: `crates/oristudio-fold/tests/swivel_pair.rs`,
  `crates/oristudio-fold-wasm/tests/vertex.rs`, the web unit tests and
  `swivelPairToolFlow.wasm.test.tsx`

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
- [x] Real-design check outside the repo: the three pairs, and a fourth step
      of the same shape, land the saved paper exactly, and every later step
      still lands
- [x] The product question answered (one step); the `otherEnd` field through
      the bridge and the reader and writer, with tests (round trip, a single
      swivel unchanged, malformed or foreign keys locked)
- [x] The analysis' `other_end`, the pair's preview and picture
- [x] The tool: Other end offered, the second's lines, Escape; overlay,
      Repeat, sentences, words in all 8 locales, `swivel_shared`
- [x] Tool flow over the real bridge (the pair, the single swivel alone,
      Escape), and in the app by hand: each of the three real steps from its
      before file, the same paper as the scripted step; a single swivel made
      fresh
- [x] A pair through the stack (multi-ply flaps): the stack reading
      (`assign`) over two fans (`fold-swivel-through-plies.md`)
