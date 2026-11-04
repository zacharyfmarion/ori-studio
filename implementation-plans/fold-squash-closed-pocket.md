# Fold: squash a closed pocket

## Goal

Squash a pocket whose two walls are joined along two lines through one
corner: a paper hat opened from its open edge and pressed flat the other way,
into a square, and then the triangle that square makes with its flaps folded
up, opened and pressed flat again. One joint is the squash's spine and the
other its hinge; the corner is its vertex. Today the squash refuses: a click
on the hat names the corner flap's own two layers first (covered by the
brim), and deeper openings find no flap (the walls are joined on two lines,
not nested on one spine; the brims and corner flaps folded flat on the walls
hold them). Real tutorial steps, rebuilt outside the repo, land this only
through Import CP.

Stacked on `fold-squash-shared-lower-layer.md` (#583), whose split of the
squash's reading from its checks it reuses.

## Approach

- **Today's readings first.** `squash_flap` runs the squash exactly as
  before (the first reading, then pockets on one lower layer); only where
  that refuses does it try a closed pocket. Every squash that lands today
  lands the same way.
- **Only an opening asked.** Which layers part is the folder's choice, so a
  closed pocket is read only for an explicit `opening`, with no drawn hinge
  and no target (the fold is symmetric about its corner).
- **The walls.** The layers at the flap point above and below the opening.
  Each grows across every crease off the spine and the hinge, flat or
  folded, so a wall carries what is folded flat on it: a brim, a corner
  flap, the wall's own far half folded under. Every other piece of paper
  joins the wall it stacks with across the opening (never under the lower
  wall's paper: the upper wall's; never over the upper wall's: the lower's);
  a piece that could be either, or neither, is no closed pocket. The opening
  must part the walls everywhere.
- **The spine and the vertex.** Each line of folded creases joining the
  walls is a spine to try; the vertex is an end of it where the lower wall
  folds over a hinge, and the walls must be joined on that hinge too. The
  half clicked folds over. Exactly one reading must hold, or the refusal
  stands.
- **Motions and order.** The squash's own four motions. The lower wall's
  folding block is placed against the lower wall's paper (the side of the
  opening), so the brims folded over the stationary wall do not seed the
  wrong side. The compound pipeline checks the motion and the layer order as
  for every squash; where the brims' ends leave several orders, the folder
  chooses one.
- **Bridge and tool: a deeper opening at the click.** No new op field. When
  the op as asked refuses, the bridge asks each opening of the stack at the
  click and answers with those that land (`deeper: true`), the one between
  the walls first (the opening nearest half the stack). The tool's Opens
  stepper appears for a deeper opening even when it is the only one (its
  arrows greyed), and offers no spine target for a closed pocket.

## Affected Areas

- `crates/oristudio-fold/src/compound/squash.rs` (`Growth`, the walls of a
  reading, `closed` flaps, the placement of the lower wall's block),
  `compound/squash_closed.rs` (new)
- `crates/oristudio-fold/tests/squash_closed.rs`, `tests/vertex/cases.rs`
  (`paper_hat`, `hat_triangle`): synthetic, a 1 × 1.6 rectangle
- `crates/oracle-tests/tests/fold_vertex_oracle.rs` (the new landings
  verified by Oriedita and Flat-Folder)
- `crates/oristudio-fold-wasm/src/ops_squash_family.rs` (the deeper answer)
- `apps/web/src/fold/engine/foldEngineSquashWire.ts`,
  `tools/vertex/vertexStep.ts`, `tools/vertex/vertexToolWindow.ts`,
  `canvas/vertex/useFoldVertexStep.ts`, `canvas/foldCanvasModel.ts`

## Not covered

- A closed pocket with a drawn hinge or a spine target: refused as today.
- The ghost's closed flap (`fold-closed-flap-squash.md`): its walls are
  joined through side layers on the flap's centre line, a different
  arrangement.
- The tool window's own "Layer order" arrows do nothing before the fold is
  pressed, for every vertex fold whose order is chosen in the Choose layer
  order dialog (as on main).

## Checklist

- [x] Re-run the slice's nodes on #583: still refused
      (`squash_flap_covered` at the click; `squash_no_flap` or
      `squash_flap_not_free` deeper).
- [x] Walls of a reading grown flat (today) or folded (closed pocket).
- [x] Closed-pocket reading: joints by line, wall pieces by stacking, closed
      on both lines, the half clicked folds over, exactly one reading.
- [x] Place the lower wall's folding block on its side of the opening.
- [x] Synthetic tests: the hat (4 orders, each a square, both halves), only
      between its walls, no target, the triangle (valley and mountain).
- [x] Vertex oracle (Oriedita, Flat-Folder) verifies the new landings.
- [x] Bridge: a deeper opening at the click when the op as asked refuses.
- [x] Tool: the Opens stepper for a deeper opening; no spine target.
- [x] Real steps (outside the repo): both land the same paper and layer
      order as the saved Import-CP nodes; every saved step of 112 real
      models replays identically.
- [x] Browser check: both real steps made by hand (the hat in the saved
      order, 4 of 4; the triangle at the default opening), each the same
      state as the scripted squash.
