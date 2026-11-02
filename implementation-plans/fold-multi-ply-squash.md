# Fold: squash a flap whose walls are several plies

## Goal

Squash a flap whose two walls are several plies each — nested wraps on one
spine line — opened between the walls rather than between its top two faces,
and let the Squash tool say which pair of layers opens. The engine took the
flap's lower layer as the face under the click (`stack[1]`) and found the
spine from the creases joining those two, so a lifted unit of nested wraps
(outer wrap round inner wrap, the top two plies on no common crease) was
refused `squash_no_flap` / `no_spine` although a flat landing exists. The
case comes from a model's step recreated through Import CP; the CP landing is
the target the native squash must match physically.

## Approach

- **Walls.** At the flap point, take the top two layers when a folded crease
  joins them (today's flap, unchanged). Otherwise the first 2m layers for the
  least m whose walls nest: layer m − 1 − i wrapped round layer m + i by
  folded creases on one line, for every i < m. That line is the spine; the
  vertex and hinge are found from the lower wall as before.
- **Opening.** Unasked it opens between the walls (m layers above). The op's
  new `opening` asks for another depth, 1 to 2m − 1: the wraps on one side of
  it ride closed with that wall. Plies joined across the opening anywhere but
  on the spine or the hinge would tear, so that is refused up front
  (`NoFlap::OpeningOutside`), as is a depth outside the flap.
- **Partition by wall, not by facing.** Each ply's region (flat creases off
  the hinge) takes its wall from its place in the stack; paper reached across
  the spine from paper that is no ply's is the other wall's. For a two-layer
  flap this is exactly the old facing test, so every existing squash is
  unchanged. Free, hinged, covered and rider checks read the wall.
- **Bridge.** `FoldSquashOp.opening` (absent between the walls; an older
  build locks the step), the analysis' `layers` and `opening`, and the
  question's `openings` (which depths land).
- **Tool.** An "Opens under" stepper in the Squash tool window ("Opens
  over" for a mountain), shown only when more than one opening lands,
  stepping through those alone, its value counted as the rabbit ear's Layers
  stepper counts ("Top 2 of 4"); a `squash_opening` choice event.
- **Closed-flap plan** (`fold-closed-flap-squash.md`): not covered. Its walls
  are joined through folded-in side layers on the centre line, not wrapped
  round each other on one spine, and the motion (front wall up, tip folded
  back to the hinge's midpoint) is a different fold. Left as planned.

## Affected Areas

- `crates/oristudio-fold/src/compound/squash.rs`, `random.rs`; tests in
  `tests/squash.rs`, `tests/vertex/cases.rs`; the vertex oracle.
- `crates/oristudio-fold-wasm/src/ops_squash_family.rs` and its tests.
- Web: `foldSequenceDocument.ts`, `foldSequenceFile.ts`,
  `foldEngineSquashWire.ts`, `vertexStep.ts`, `vertexToolWindow.ts`,
  `vertexRefusal.ts`, `foldToolState.ts`, `useFoldVertexStep.ts`,
  `foldCanvasModel.ts`, `useFoldCanvasVerbs.ts`, `FoldVertexControls.tsx`,
  analytics (`squash_opening`), locales.

## Checklist

- [x] Reproduce the refusal on the real case (read-only, outside the dataset).
- [x] Walls of several plies, wall partition, opening, tear guard.
- [x] Synthetic tests: two-ply walls land with the expected images, sides,
      layer order and creases, from the front and the back; openings off the
      walls land and check; outside ones refuse; a held flap is not free; a
      two-layer flap is unchanged.
- [x] Vertex oracle (Oriedita and Flat-Folder) verifies the new landings.
- [x] Real case: native squash physically equal to the saved CP landing.
- [x] Bridge: `opening`, `layers`, `openings`; tests.
- [x] Tool: Opens stepper, step builder, document read/write, refusal text,
      analytics; tests.
- [x] Browser check of the tool flow: a synthetic two-ply-walls project,
      the stepper offered, stepped, previewed and committed both ways.
