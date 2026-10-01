# Editable face paths in paper exports

## Goal

A diagrammer editing an exported flat folded figure in Inkscape (reported on
Discord, 2026-10-01) found every face written as two kinds of object: a
fill-only `<polygon>` and one `<line>` per outline edge. Reshaping a face's
outline leaves its fill behind, so after any exaggeration of the layers they
have to redraw the fill. Inkscape's node tool also gives draggable nodes only
to `<path>` elements — `MultiPathManipulator::setItems` admits `SPPath` and LPE
items, and `SPPolygon` / `SPLine` derive from `SPShape` — so neither object can
be node-edited before Object to Path.

Make every exported face a `<path>`, and let the flat figure's whole faces draw
their own outline, so a face is one object whose nodes move its fill and its
outline together.

## Approach

**Scene format.** `PaperFaceItem.outline?: PaperLineRole`: every edge of every
ring is a line of this role, drawn by the face itself, and the producer emits
no separate line for any of them. One role per face, not one per edge: a loop
of one role never erodes under the flat producer's rule — an aux end retreats
only where a border or fold of the same outline meets it — so a stroke round
the closed path is exactly the lines it stands for. A face whose outline mixes
roles keeps its per-edge lines.

**Flat producer** (`foldedFlatScene.ts`). A whole face whose edges all take one
role carries it as `outline` and pushes no outline lines; that is every whole
face today, since border and fold both draw as `edge` and the kernel never
puts a flat crease on an outline. Aux lines still follow the face.

**Woven flaps: whole faces and patches** (second step, decided with the user on
2026-10-01 after testing one-off exports of a cat in Inkscape). A cyclic
stacking used to be cut into a piece per subface and depth, every piece with
its outline as separate lines — on the user's cat (232 faces, one 144-face
cycle) that was 2,589 of 2,677 face objects, so the first step did nothing for
it. Now every face is drawn whole:

- *Order.* A woven component's faces go in the order breaking the least area of
  "this face over that ink" (`wovenDrawOrder`: Eades–Lin–Smyth's greedy
  heuristic for a minimum feedback arc set, ties to the lowest face).
- *Patches.* A subface whose top face was drawn before ink that must not show
  there gets a patch: the top face again, cut to the subface. That ink is a
  face of its stack beneath the top, the stroke of a buried edge along its
  boundary, or the rounded join of a buried corner at one of its vertices where
  no line on the page ends (`hiddenInk`, read in `wovenInk`). Only a woven
  component's faces can be drawn out of order, so only they are looked at.
- *Placement.* A patch goes right after the last face it covers, not at the end
  of the picture, so whatever is drawn later still covers it.
- *What it carries.* Every visible line along its boundary or ending at one of
  its corners whose faces were all drawn before it, round at both ends, and
  its face's aux lines inside it, under the edges.
- *Groups.* The patches that go in at one place, and what they carry, are one
  `<g id="patches-N">` (`PaperFaceItem.group` / `PaperLineItem.group`, which
  the painter writes as a group around consecutive items).

The kernel's arrangement makes this cheap and exact: subfaces sharing a vertex
give it identical coordinates, each interior subface edge belongs to exactly
two subfaces, and no face has a corner partway along a subface edge (checked
on every fixture and the cat), so a subface edge's owners are found in the two
stacks beside it.

What this gives up is the order of the buried layers inside a woven region:
deleting a face in an editor there can reveal a deeper layer than the one
directly beneath. Ordering them exactly needs the old cut — on the cat, 98 of
101 subfaces in about 2,500 pieces. And a patch is its own shape: reshaping
the face it belongs to leaves it behind.

**Painter** (`paperSvg.ts`). Every face is a `<path>`, one subpath per ring,
even-odd when there are several. A face whose outline pen is solid is filled
and stroked with that pen in the same element; the pen lies where the seam
hairline would, so it takes the seam's place. A dashed pen keeps one line per
edge after the fill, each dash centred on its edge as today. A role the style
leaves out draws the fill and its seam. Joins stay on the page group, as for
every other stroke.

**One expansion of an outline.** `faceOutlineLines(face)` in the painter
module returns the lines an outline stands for. The dashed fallback, the
canvas adapter (`foldedSceneLocalGeometry`) and the tests read it, so every
drawer of a scene draws an outline the same way. The `.osf` scene reader keeps
`outline`, so a stored scene round-trips (only 3D scenes are stored today, and
none carry one).

Measured on a probe before building (throwaway, not committed): the kabuto
goes from 18 `<polygon>` + 56 `<line>` to 18 `<path>`, the Oriedita solution
sample from 21 + 72 to 21. Chrome renders of the two pages differ in about
0.04% of pixels, at the corners: the butt-capped per-edge lines left a notch at
every corner where the fill showed through, and a joined path does not.

Measured for the woven step, every page rendered by Inkscape against the
previous producer's: the cat's front is 232 whole faces and 16 patches in two
groups carrying 20 lines, its back has no patch, `glitch.cp`'s back is 68 whole
faces and 35 patches in five groups; nothing that was ink became paper, and
what became ink is the figure's tips (rounded where the butt-capped lines left
a notch) and one pinhole filled. The cat builds in 17 ms. Two faults found on
the way and fixed before shipping, each now a test: a patch at the end of the
picture with only its own edges carried bit the lines it touched at its
corners (the user saw these in Inkscape), and a buried face's rounded corner
showed as a crescent where no line ends (`glitch.cp`'s back, five of them).

Out of scope, each its own change:

- The 3D figure and the simulator: the tree cuts faces into pieces (`box_90`:
  11 faces, 21 face items) and a face's lines rarely follow it directly, so
  folding outlines into faces there is work in `meshToPaperScene`.
- A flat figure reopened from a file and not refolded has no handle, and
  exports its stored render snapshot through `foldedFigureSvgBody` — one fill
  per subface. Refolding it before export would take it down this path.
- Crease lines stay `<line>`; as `<path>` they would be node-editable too.

## Affected Areas

- `packages/origami-simulator/src/paperScene.ts` — `PaperFaceItem.outline`,
  `group` on faces and lines
- `apps/web/src/cp-workspace/folded/foldedFlatScene.ts` — whole faces carry
  their outline; woven components drawn whole with patches
- `apps/web/src/lib/paper/paperSvg.ts` — faces as paths, outline stroke,
  `faceOutlineLines`, groups
- `apps/web/src/cp-workspace/adapters/cpFoldedToScene.ts` — the canvas draws
  an outline
- `apps/web/src/lib/nativeProjectFile.ts` — the stored scene keeps `outline`
- Tests that pinned `<polygon>` faces or per-edge outline lines

## Checklist

- [x] Plan
- [x] `PaperFaceItem.outline`; flat producer sets it on whole faces
- [x] Painter: every face a `<path>`; outline stroked on the face; dashed and
      hidden-pen fallbacks; `faceOutlineLines`
- [x] Canvas adapter and `.osf` reader honour `outline`
- [x] Tests: painter, producer (the half-cover detector reads a face's outline
      as lines drawn over its fill), canvas, reader; re-pinned `<polygon>`
      assertions. Three byte-for-byte goldens repainted, each checked to
      differ only as intended: the folded-figure export (3D pages a
      polygon → path rewrite and nothing else; each flat face's polygon and
      its four edge lines became one path in the edge pen; the legacy page
      untouched), the References step (its sheet), and the simulation (its
      faces).
- [x] Validation: web lint, typecheck, unit tests (674 files); simulator
      package build and tests
- [x] Browser: kabuto folded flat in the app and exported through the
      dialog's own path — 18 `<path>` faces, each filled and stroked in the
      0.9 pt edge pen, no `<polygon>`, no `<line>`. Inkscape 1.4.4 reads the
      file as 18 path objects and renders it as the app does.
- [x] Draft PR: zacharyfmarion/ori-studio#422
- [x] Woven flaps drawn whole with patches: order, hidden ink (fill, buried
      edges, buried corners), placement, carried lines and aux, groups; the
      split-piece code removed
- [x] Tests: the weave's order, patches, placement, carried lines, group and
      aux; every subface's top drawn last; an ink detector (buried lines and
      corners that show, lines on the page painted over) over every fixture,
      shown live by dropping the patches and by switching the corner rule off;
      `wovenDrawOrder`; the painter's groups
- [x] Validation: web lint, typecheck, unit tests; simulator package build and
      tests
- [x] Browser: `glitch.cp` folded flat in the app, turned over and exported
      through the dialog's own path — 68 faces each drawing its outline, 35
      patches in five `patches-N` groups carrying 83 lines, no `<polygon>`;
      the file is byte-identical to the one the Node build rendered in
      Inkscape against the previous producer
- [x] PR updated
