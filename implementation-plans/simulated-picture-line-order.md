# Simulated pictures: lines drawn after the faces that only touch them

## Goal

A Diagram step shown as Simulated looks clean in Pose's live simulator and
janky on the page: fold lines go thin and shift sideways along each piece,
kink at every crease that crosses them, and break into gaps and blobs where
creases meet (step 14 of `flapping_fan.osf`). The page should draw them as the
live view does, for new captures and for pictures already saved.

## Approach

**Root cause.** The live view draws every face, then every crease,
depth-tested with a small bias toward the eye, so a crease shows at full width
wherever no paper is in front of it. The page is painted from a vector scene
(`meshToPaperScene`), whose painter's order comes from a BSP tree. That order is
valid but not unique: between a crease and a face that does not cover it, the
tree picks a side by half-space, and often draws the crease first. Where that
face touches the crease — its own face along its length, or any face meeting
it at a vertex — the face's edge and the painter's 0.4 pt seam stroke (each face
stroked in its own colour to hide antialiasing seams) paint over part of the
crease's ink. Measured on a 45% pose of step 14: 58 of 104 fold and edge lines
had a later face over their ink that covered none of the line. A line painted
over on both sides was marked buried and dropped altogether. `BuildBspOptions.edgeInk`
already named the fault and called itself a tie-break, not a fix.

**Fix.** After the tree, move each line to just before the first face drawn
after it that covers some of it (`coversLine`: the segment runs inside the
face by more than 0.02 px), or to the end when none does. Every face it passes
covers none of it, so the order stays valid; only which ink lies on top where
they touch changes, and it is the line's, as on the GPU. Runs only on the
simulator's path; the 3D folded figure (`layers`) keeps `creasesAfterOwnFace`,
because its coplanar stacks lie exactly over one another and only the kernel's
order says which layer's crease is on top.

So that a line does not split a face the producer merges back together, a line
whose cover is a later piece of a face also goes before that face's earlier
pieces when none of them reaches ink of the line that the cover does not.

**Saved files.** A simulated step cannot be captured again without posing it
(the solve is path-dependent), so a stored simulated scene is painted through
the same pass (`withLinesDrawnLate`, via `paintedScene`). Lines an old capture
dropped as buried stay gone.

## Affected Areas

- `packages/origami-simulator/src/lineDrawOrder.ts` (new): the pass and the cover test.
- `packages/origami-simulator/src/paperScene.ts`: runs it on the simulator path; `withLinesDrawnLate` for stored scenes.
- `apps/web/src/diagram/pictures/storedScene.ts` (new, moved out of `pictureFrame.ts`): `storedScene`, `paintedScene`.
- `apps/web/src/diagram/pictures/paintDiagramStep.ts`, `apps/web/src/diagram/pages/pagePictures.ts`: paint through `paintedScene`.
- `apps/web/src/simulator/__fixtures__/simulatorExportGolden.json`: re-blessed.

## Checklist

- [x] Reproduce: capture a pose of step 14, paint it with the app's painter, compare with the live view
- [x] Root-cause: lines drawn before faces that only touch them; seam stroke eats the ink
- [x] `linesAsLateAsUncovered` + `coversLine`, unit tests
- [x] Run it in `meshToPaperScene` (simulator path); Miura invariant test fails without it (94–124 lines), passes with it
- [x] Keep face merges: line goes before a run's earlier pieces when they reach none of its uncovered ink
- [x] Re-bless the simulator export golden: same elements, new order, plus two crease pieces no longer buried
- [x] Paint saved simulated scenes through the same pass
- [x] Verify in the browser: fresh capture and the saved step 14, before/after zooms
