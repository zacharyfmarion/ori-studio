# Swivel through the stack

## Goal

The swivel on a folded edge (by its edge onto a line, or by its valley and
mountain) works on two layers: the folded edge's two faces crease along the
swivel's three rays, and any other paper must move rigidly with one of the
wedges. Tutorials swivel thick, already-folded flaps, where that refuses:

- paper beyond the two layers is hinged to a moving wedge and to paper that
  stays (a tip folded behind the edge's layer, a nested pair of layers whose
  fold lies along the same folded edge) — `fan_ray_blocked` from the "held"
  rule;
- the computed crease reaches a fold before the paper's edge — `ray_run`
  refused `fan_ray_blocked` at the first fold;
- the lines meet where two folded edges abut along one line, or on a folded
  edge hidden under a layer whose raw edge lies along it —
  `swivel_line_meeting`.

Make the swivel crease or carry every layer hinged to its wedges, run its
creases on through folded-against layers, and accept a folded edge that is
hidden or abuts another, refusing only when no consistent motion exists or the
result cannot be ordered flat.

## Approach

- **Keep the two-layer reading first.** `folded_swivel::compile` still scores
  the two layers' runs and joins pieces into parts. When no paper holds two
  wedges, the result is exactly what it was, so every swivel that lands today
  lands the same way.
- **Through the stack when it is held.** Otherwise a motion assignment
  (`assign`) gives every face one of the swivel's four motions (near `R_s`,
  turn `R_s ∘ R_h`, beyond `R_b`, stays), either rigidly or by sector like the
  edge's layer (creased along `s`) or the other layer (creased along `c` and
  `b`). Across every crease the two faces must move alike, or — where the
  crease lies along a ray of that face's layer group, or the half of the
  folded edge that opens — one reflection apart (it folds or unfolds there).
  A breadth-first, backtracking search from the two layers' runs prefers
  moving with a neighbour, then creasing; faces that move by sector are scored
  along their rays. The compound pipeline then checks the motion and the
  layer order as for every compound fold.
- **Rays stop at folds instead of refusing.** `ray_run` ends a layer's run at
  a fold; the paper folded back there is creased by the assignment when it
  holds the wedges.
- **Folded edges the lines meet on.** `swivel_valley_mountain` collects every
  folded edge through the meeting point (visible ones, else hidden ones) and
  folds on the one where the swivel compiles; several that compile are still
  refused as `swivel_line_meeting`, and so is a meeting that is also the bare
  end of a flap's hinge (the hinge-end swivel, which no form folds yet).
- **Guards.** A choice of orders from the stack reading is offered only when
  every listed order lands (`Compiled::land_checked`); the edge-onto-line
  form refuses a stack reading that carries off the edge past where it meets
  the target; anything else that stops the stack reading refuses as the
  two-layer reading did (`fan_ray_blocked`), and a stack motion with no flat
  order is `no_order`.
- Out of scope, with reasons recorded in the PR: a vertex at the very end of a
  folded edge (hinge end), two coupled swivels sharing a hinge, and which of
  several stacked hinge pairs a diagram means to open.

## Affected Areas

- `crates/oristudio-fold/src/compound/folded_swivel.rs`
- `crates/oristudio-fold/src/compound/swivel_valley_mountain.rs`
- `crates/oristudio-fold/tests/swivel_valley_mountain.rs` (synthetic cases)
- `crates/oristudio-fold/README.md` (swivel notes)

## Checklist

- [x] Reproduce the refusals on main's engine against the real cases
- [x] Ray runs end at folds instead of refusing
- [x] Two-layer reading kept first; motion assignment when it is held
- [x] Toggles along a ray only in that ray's layer group
- [x] Folded-edge candidates at the meeting point (abutting, hidden)
- [x] Every swivel saved in the corpus still lands identically
- [x] Synthetic tests: crease through a folded-back layer, nested fold
      opening, hidden folded edge
- [x] Existing swivel tests pass (the campaign's letter check now covers the
      folded edge's two layers; carried layers are checked by the full gate)
- [x] Vertex oracle
- [x] fmt, clippy
- [x] Crate tests (`oristudio-fold`, `oristudio-fold-wasm`; four guarded
      probes in `bird-swivel-refusals.json` now refuse `no_order`)
- [x] Real cases compared with their saved landings; evidence rendered
- [x] Browser check of one case through the Swivel tool
- [ ] Draft PR
