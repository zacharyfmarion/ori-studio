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
puts a flat crease on an outline. Aux lines still follow the face. Split
pieces of a cyclic component are unchanged: their rings include cuts that are
not outline, and their on-top lines must wait for the component (the
2026-09-25 half-cover fix in `unified-paper-style-and-export.md`).

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

Out of scope, each its own change:

- Faces of a cyclic stacking (twists, tessellations) stay split into subface
  pieces; on `glitch.cp`'s back 35 of 200 face items are whole. Whole faces
  plus patches over the cycle would keep them editable.
- The 3D figure and the simulator: the tree cuts faces into pieces (`box_90`:
  11 faces, 21 face items) and a face's lines rarely follow it directly, so
  folding outlines into faces there is work in `meshToPaperScene`.
- A flat figure reopened from a file and not refolded has no handle, and
  exports its stored render snapshot through `foldedFigureSvgBody` — one fill
  per subface. Refolding it before export would take it down this path.
- Crease lines stay `<line>`; as `<path>` they would be node-editable too.

## Affected Areas

- `packages/origami-simulator/src/paperScene.ts` — `PaperFaceItem.outline`
- `apps/web/src/cp-workspace/folded/foldedFlatScene.ts` — whole faces carry
  their outline
- `apps/web/src/lib/paper/paperSvg.ts` — faces as paths, outline stroke,
  `faceOutlineLines`
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
- [ ] Draft PR
