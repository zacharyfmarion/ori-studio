# Swivels through a stack of several plies

## Goal

Tutorials swivel flaps that are several plies thick, and swivel where the
folded edge the lines meet on is covered by other paper. Three things refuse
those steps today:

- **The meeting rule.** Where the lines meet, a ply that wraps the fold on
  one side ends bare on its raw edge, or every fold in view ends there over a
  hidden fold that runs on. The rule refuses `swivel_line_meeting`, and the
  hinge-end reading finds no flap to turn.
- **A pair through the stack.** Two swivels made together (#582) read only
  their four layers. Paper beyond them that holds the wedges refuses
  `fan_ray_blocked`: the reading through the stack is a single swivel's.
- **Nested plies.** Several folds lie along the swivel's folded edge through
  the vertex, nested in it. Every ply opens with the fold and takes the same
  three creases at the vertex. The stack reading carries the inner plies
  rigidly instead, and the landing has no order (`no_order`).

Land those steps exactly, and change nothing that lands today.

## Approach

- **The meeting-rule fallback.** Only where the meeting rule refuses and the
  hinge-end reading names no flap, retry on the folds that run on through the
  point (their run's ends away from it): those in view, or where none in view
  does, the hidden ones. Exactly one that compiles is the swivel; otherwise
  the meeting's refusal stands. A pair's swivels take the same fallback.
- **The stack reading over several fans.** `folded_swivel::assign` and
  `through_the_stack` take a list of fans, as the two-layer reading already
  does: motions shared by isometry (the first fan's three wedges and the
  paper that stays keep their indices, so one fan reads exactly as before),
  sector modes per fan, probes cut by every fan's lines, and each fan's own
  `beyond`, layer and group rules. A pair tries it where its two-layer
  reading is held.
- **The search backjumps.** The stack reading's search for motions was
  chronological with a step budget. On the second side of a two-sided step
  a face chose to move with a neighbour, and the face that contradicts it
  came dozens of faces later, so the budget ran out undoing unrelated
  faces. A face with no motion left now goes back to the latest face whose
  motion its failure reads: a neighbour, or a face of its sheet or a
  neighbour's sheet, which are all its agreement looks at. The choices
  skipped all fail there alike, so the search finds the motions the plain
  one finds, in no more steps; it can only succeed where the plain one ran
  out of budget.
- **Nested plies open with the fold.** Where a swivel's fold has other folds
  along it through the vertex, nested between its two layers, each nested
  fold is a fan of its own with the same three rays, made together with it
  through the list-of-fans reading. Only in readings no swivel had before:
  a swivel read through the meeting-rule fallback, and a pair whose
  two-layer reading is held. A swivel read as before (on a fold the meeting
  rule settles) reads its folded edge alone, even where it then has no
  order: changing that would change what those lines land today, so it is
  left for a decision.

## Affected Areas

- `crates/oristudio-fold/src/compound/swivel_valley_mountain.rs` (meeting
  fallback, nested fans)
- `crates/oristudio-fold/src/compound/folded_swivel.rs` (stack reading over
  several fans)
- `crates/oristudio-fold/src/compound/swivel_pair.rs` (fallback, the pair
  through the stack, nested fans at each end)
- `crates/oristudio-fold/README.md`
- Tests: `crates/oristudio-fold/tests/swivel_through_plies.rs`

No wire, document or UI change.

## Checklist

- [x] Re-run the five nodes on the branch: all refuse
      (`swivel_line_meeting`, `fan_ray_blocked`)
- [x] Meeting-rule fallback, single and pair; synthetic tests (a ply ending
      bare beside the fold; folds in view ending over a hidden one), each
      refusing without the fallback
- [x] Stack reading over several fans, single swivels unchanged (every
      fold test, every corpus model replays unchanged)
- [x] The search backjumps (the second of two mirror-image pairs on hidden
      folds ran out of budget)
- [x] A pair through the stack: synthetic (each flap's raw-edge strip
      folded over, holding its wedges), refused without it; a pair on
      hidden folds in a real design
- [x] Nested plies opening with the fold: synthetic (four plies in each
      side's folded edge of a pair; four plies under a corner that ends at
      the vertex), each refused without them
- [ ] Real-design check outside the repo: each node lands the saved paper,
      every later node still lands, every corpus model replays unchanged
- [ ] App check: each step made by hand from its before file; a single
      swivel and a #582 pair made fresh
