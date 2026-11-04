# A spread stays on when its layers can't be spread

## Goal

A Diagram step folded flat starts with its layers spread by Default
(`DEFAULT_LAYER_SPREAD`, the connected spread), which needs a solve. When that
solve fails — over a resource limit ("Spread resource limit exceeded: overlap
regions"), out of time, the worker gone — or its clip does, the whole capture
failed: "The picture couldn’t be captured", and no folded step could be added
for that model at all.

Instead, the step is captured anyway: the fold drawn unspread, its spread kept.
Spread layers stays on and says "These layers couldn’t be spread", Spread by
stays on Default with Affine and Depth — which need no solve — still to pick.
Turning Spread layers off would leave no way to Affine on a model Default can
never solve (Zach's review of the first version, which did that).

Edit's folded figure and the Export and Share dialogs' had the same dead end:
Edit held Spread by with the rest of a spread its canvas could not draw, and
Export and Share turned the spread off. They now do what a Diagram step does.

## Approach

**The picture says it.** A capture whose Default spread could not be made is
the fold drawn unspread, marked `spreadFailed: true` on the stored picture (a
scene, or the bitmap of one too detailed: `DiagramScenePicture` and
`DiagramAssetPicture`). The mark lives and dies with the picture it describes:
written only by a capture that fell back, gone with the next capture that
spreads the layers, saved and read with the file. A build without the field
carries such a step locked, as any picture field it has no name for.

**The render keeps the spread.** The step's render keeps the spread asked
(`spreadFailedRender`), so the Step pane shows Default chosen, and every pose
verb asks for it again — the session forgets a failed solve, so the next
capture solves again. It drops a presentation: Perspective 3D turns the
toolbar and rows into a camera's, which an unspread picture has none of.

One shared stage, `connectedFlatPicture` in `diagram/capture/captureFolded.ts`,
gives a Default spread's picture or `failed` with why; every path that spreads
a flat fold by Default goes through it and marks the unspread picture
(`spreadFailedPicture`):

1. A linked pattern's one-shot capture (`captureStep`, with or without a
   layer order) — Link, Relink, Refresh, Show as, Duplicate as.
2. A Fold step's capture (`captureFoldStep`) — Refresh, Show as, poses, and a
   pull from Fold (`pullFoldTargets`).
3. A step open in Pose (`captureSession.flatPicture` → `poseLinkedStep`) —
   every flat pose, a switch from Affine to Default among them.

**What reads the picture reads the mark.** An enlarged step's faces
(`paperFacesOf`) and the file's check of a picture's faces against its scene
(`withFittingFaces`) treat a marked picture as drawn unspread; a bitmap keeps
no spread's frame. Pose solves no live view for a marked step
(`useDiagramLinkedPose`, `useDiagramFoldStepPose`): its picture is all there is.

**The Step pane says it.** `DiagramLinkedPoseState.spreadFailed` gives Spread
layers a note ("These layers couldn’t be spread", Edit's words for the same
thing) and holds Default's own values — Amount, Reveal, Presentation — with
the same words, while Spread by stays open (`LayerSpreadControls.valuesHeld`,
`spreadValuesHold`).

**Every surface the same way.** What a failed spread holds, and the words
for it, are the shared spread controls' (`layerSpreadControls.ts`):
`valuesHeld` is an input of `layerSpreadControls`, so a depth spread's
direction and an affine one's layer held still wait with the sliders and the
reveal pad (`spreadValuesHold`), and `spreadFailedReason` is the one place
the words live. Each surface says when its layers could not be spread:

- **A Diagram step:** its picture's mark (`DiagramLinkedPoseState.spreadFailed`).
- **Edit's folded figure:** its canvas's status, `unavailable`
  (`foldedFigureSpreadStatus.ts`). The figure's spread stays the document's,
  as before; Spread by now stays open (`foldedFigureSpreadSection`).
- **The Export and Share dialogs' figure** (`useExportFoldedSpread`): a
  spread that cannot be prepared, solved, clipped or drawn keeps its setting,
  and the figure is drawn unspread — `picture` null, which the file and the
  share card paint too, so they agree with the preview. `failed` gives the
  rows their note and held values (`exportSpreadControls`). A new setting or
  fold ends it, and so does a picture that lands — a turn that captures what
  the last frame could not.

**Said once.** `commitStepCapture` compares the picture landed with the one
the step had: `spreadFailed` is `new` where the step's layers were spread or
it showed something else, `again` where they already could not be. A toast
says `new` only — "Its layers couldn’t be spread by Default, so the step shows
them unspread. Try Affine or Depth instead." — so turning or posing such a
step says nothing new. A pull from Fold counts them. `diagram picture
captured` gains the outcome `spread_failed`, counted for both.

## Affected Areas

- `apps/web/src/diagram/document/diagramDocument.ts`, `diagramFile.ts`
- `apps/web/src/diagram/capture/captureFolded.ts`, `captureSession.ts`,
  `linkedPose.ts`, `poseController.ts`, `stepCaptureActions.ts`,
  `useDiagramLinkedPose.ts`
- `apps/web/src/diagram/actions/diagramLinkedPoseActions.ts`
- `apps/web/src/diagram/fold/foldStepCapture.ts`, `foldPull.ts`,
  `foldStepActions.ts`, `foldBrowserActions.ts`, `useDiagramFoldStepPose.ts`
- `apps/web/src/diagram/zoom/zoomImprint.ts`
- `apps/web/src/cp-workspace/folded/layerSpreadControls.ts`,
  `foldedFigureSpreadFields.ts`, `components/paper/LayerSpreadRows.tsx`,
  `LayerRevealControl.tsx`, `components/diagram/DiagramStepPose.tsx`
- `apps/web/src/cp-workspace/export/exportSpreadControls.ts`,
  `useExportFoldedSpread.ts`
- `apps/web/src/store/workspaceStore/diagramCapture.ts`,
  `diagramFoldCapture.ts`, `types.ts`
- `apps/web/src/analytics/events.ts`, `docs/analytics.md`
- i18n catalogs for the toasts

## Checklist

- [x] `spreadFailed` on scene and bitmap pictures, read and written by the file
- [x] `connectedFlatPicture` + `spreadFailedPicture`, used by every Default capture
- [x] The render keeps its spread, drops its presentation (`spreadFailedRender`)
- [x] Faces read a marked picture as unspread (enlarged steps, the file's check)
- [x] No live Default view is solved for a marked step
- [x] Spread layers' note and Default's held values; Spread by stays open
- [x] `new` / `again` from the commit; toasts say `new`, analytics both
- [x] Unit tests for each path
- [x] i18n extract + translations
- [x] lint, typecheck, relevant tests
- [x] Browser check with a model whose spread fails (a 500-pleat accordion
      hits "overlap regions": linked on Default, marked, Affine spreads it,
      Default again says so once, a turn says nothing; a 5-pleat one still
      spreads)
- [x] `valuesHeld` an input of `layerSpreadControls`; `spreadFailedReason` shared
- [x] Edit: Spread by open while the canvas could not spread the layers
- [x] Export and Share: a failed spread stays on, drawn unspread, with the note
- [x] Browser check, Edit and Export, on the same accordion: Default says so
      with Spread by open, Affine spreads it, Default again says so again
