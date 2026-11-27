# Multi-file Import CP in Fold

## Goal

Import several crease patterns into the Fold workspace at once. Each file
becomes an Import CP step after the one before it, in the order of the
numbers in the file names (`7.cp`, `8.cp` … `25.cp`, `step-2` before
`step-10`), whatever order the platform handed them in. It works the three
ways a single file arrives today:

- a drop anywhere on the Fold workspace;
- a drop on the Import CP dialog;
- the dialog's picker ("click to browse"), which now selects several files.

Each file imports exactly as it would alone: one layer order commits at once,
several ask (the Layer order dialog, or the canvas chooser), a refusal is said
in the dialog. Import starting sheet still takes one file.

## Approach

- **Order.** One natural-order helper, `src/lib/naturalFileOrder.ts`
  (`Intl.Collator` numeric, base sensitivity, exact-case tie-break, stable),
  extracted from the two copies the Diagram importers carry
  (`orderedImportFiles` in `diagram/import/importJob.ts`, `naturalFileOrder` in
  `diagram/upload/importStepPicture.ts`). They become its callers and Fold its
  third.
- **Reading.** Every Import CP file is a `PickedFile`: `pickedFileFromFile` for
  a drop, `openBinaryFiles` for the picker. A file is read whole when its turn
  comes, so a batch is never all in memory, under a 64 MiB cap. A file past it
  is refused as `file_too_large`; a pattern that big is far past the 4,096-face
  cap anyway. One helper, `foldImportFileRequest`, replaces the dialog's and
  the drop hook's copies of "read a file into a request".
- **Queue.** A new pure module, `fold/io/foldImportQueue.ts`, drives the
  existing one-request flow (`foldImportFlow.ts`) through a list of files:
  - it opens the first file, and opens the next when the flow reports `done`
    for the file it opened;
  - a refusal or failure pauses it, and Skip goes on with the next file;
  - a cancelled choice, a reset, or a request it did not open ends it.

  Each step lands after the one before, because a commit puts the cursor on
  its step (`commitFoldStep`). The flow itself is unchanged except for the
  undo batch below.
- **One undo step per batch.** The queue's batch number rides
  `flow.open(request, { batch })` → `session.commitLanded` →
  `commitFoldStep(draft, { loadId, batch })`. That call extends the batch's
  undo entry through `documentHistory.session`, the mechanism that makes a
  slider drag one undo step. Any other edit, undo or redo in between starts a
  new entry, as it does for a slider.
- **Dialog.**
  - While a batch runs, the status line reads "Importing 8.cp (2 of 19)…".
  - Paused on a refusal, it reads "Stopped at 5.cp, file 5 of 19." The notice
    keeps its own fixes (Search longer) and adds Skip this file while files
    remain after it.
  - The dialog closes when the last file lands, or at once for a single file
    as today. Closing it while paused leaves the rest unimported.
  - The picker's drop zone says "Drop .cp, .fold, .ori or .orh files" in step
    mode. The workspace's drop overlay says "Drop crease patterns to import
    them".
- **Unsupported files.** Files with no crease-pattern extension are left out
  of a batch. A drop or pick with none at all imports the first file, so the
  dialog says why it is not a crease pattern, as it does today. A workspace
  drop with none still goes on to the app's own target.
- **Analytics.** Each step is still `fold cp imported`. A batch of two or more
  files also sends `fold cp batch ended` once:
  - `files` and `imported`, bucketed;
  - `outcome`: `finished` when every file was imported or skipped, `stopped`
    when the dialog closed early or a choice was cancelled;
  - `via`: `drop` or `pick`.

## Affected Areas

- `apps/web/src/lib/naturalFileOrder.ts` (new) and its test; the Diagram
  importers that carried copies (`importJob.ts`, `importStepPicture.ts`,
  `addStepPictures.ts`, `DiagramImportDialog.tsx`, `importDialogStore.ts`).
- `apps/web/src/fold/io/`: `foldImportFiles.ts` (reader, cap, order),
  `foldImportQueue.ts` (new), `foldImportFlow.ts` (batch option, too-large
  refusal), `foldStartingSheet.ts` (too-large refusal), `foldImportRefusal.ts`
  (`file_too_large` words), `foldImportUiStore.ts` (`openFiles`),
  `useFoldDrop.ts` (every crease pattern), `useFoldImport.ts` (the queue's
  lifetime).
- `apps/web/src/fold/session/foldSession.ts` and its fixtures, and
  `apps/web/src/store/workspaceStore/` (`foldSession.ts`,
  `slices/foldSlice.ts`, `types.ts`): the batch's undo entry.
- `apps/web/src/components/fold/import/`: `FoldImportDialog.tsx` and
  `FoldImportPicker.tsx`; `components/FileDropOverlay.tsx` copy.
- `apps/web/src/analytics/` (`events.ts`, `trackFoldIo.ts`) and
  `docs/analytics.md`.
- Locales: the new and changed strings in all 8 languages.

## Checklist

- [x] Plan
- [x] Shared natural file order; Diagram importers use it
- [x] `foldImportFileRequest`, the 64 MiB cap and `file_too_large`
- [x] Batch undo entry: slice, session source, session, flow
- [x] `foldImportQueue` with tests
- [x] UI store `openFiles`; workspace drop takes every crease pattern
- [x] Dialog: multi-file drop and picker, batch status, Skip; tests
- [x] `fold cp batch ended` event and its docs row
- [x] i18n extract, translations, stamp, check
- [x] Validation: lint, typecheck, relevant tests, browser check
- [ ] Draft PR
