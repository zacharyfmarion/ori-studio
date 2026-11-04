# A Diagram step keeps its spread when its layers can't be spread

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
  `components/paper/LayerSpreadRows.tsx`, `LayerRevealControl.tsx`,
  `components/diagram/DiagramStepPose.tsx`
- `apps/web/src/store/workspaceStore/diagramCapture.ts`,
  `diagramFoldCapture.ts`, `types.ts`
- `apps/web/src/analytics/events.ts`, `docs/analytics.md`
- i18n catalogs for the toasts

## Not here

Edit's folded figure already keeps a spread its canvas could not draw on, with
the same note, but holds Spread by with the rest of its values; Export and
Share turn the spread off. Both have the same dead end on a model Default can
never solve, and are left as they are.

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
