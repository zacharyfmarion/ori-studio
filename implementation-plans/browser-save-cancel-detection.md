# Browser save cancel detection

## Goal

A save the user cancels must leave the project dirty, so the close-tab warning
still fires.

Today it does not, on the browser surface. `BrowserFileService.saveTextFile`
saves by clicking an `<a download>`: the click returns whether or not a file is
ever written, so the service returns a `SaveFileResult` unconditionally. Every
save site in `projectSlice` reads a non-null result as "the write happened" and
sets `dirty: false`. A browser configured to ask where to save each download —
or any other reason the download does not complete — therefore marks a dirty
project clean, and `App.tsx`'s `beforeunload` guard (which reads exactly that
flag) then lets the tab close without a word.

The desktop surface is already correct: `TauriFileService.chooseSavePath`
returns `null` when the native dialog is dismissed, so the callers keep `dirty`
true. This is a gap in one implementation of `FileService`, not in the save flow
above it.

`withExportTracking` already documents the contract the browser service breaks:
"A null result means the user cancelled the picker; nothing is emitted." On web
that null was unreachable, so a cancelled export still emitted `file exported`.

## Approach

Split the project's own save out of the generic file write, and give it the one
browser save API that can report its own outcome.

**A new `FileService.saveProjectFile`**, used by the four sites whose success
clears `dirty` — the workspace `.osf` save, the crease-pattern `.osf` save, and
the `.ori` / `.orh` saves. Exports keep `saveTextFile` / `saveBinaryFile` and
their silent download: nothing clears `dirty` on an export, so a picker per PNG
would be friction with no correctness payoff.

**The browser implementation asks `showSaveFilePicker`.** It rejects with
`AbortError` when dismissed and the write is only complete when the writable
stream closes, so both a cancel and a success are real. Where the API is
unusable — no `showSaveFilePicker` (Firefox, Safari, Chrome on Android), an
insecure or cross-origin context, a rejected `suggestedName` — it falls back to
today's `<a download>`, where a cancel is undetectable by any means available to
a page. So this fixes Chromium desktop and leaves every other surface exactly as
it was.

**The target is settled before the contents are produced**, which is why
`contents` is a thunk rather than a string. Serializing a workspace means wasm
exports, base64 images and a large stringify; on a big project that outruns the
~5s of transient activation a save picker needs, and the picker would then be
refused — reintroducing the bug for precisely the saves worth keeping. It also
means a cancelled dialog no longer costs a full serialize, on either surface.

A denied write-permission prompt counts as a cancel. Any other write failure
throws, so the caller's existing `catch` surfaces an error and leaves `dirty`
alone; a failed save must not quietly become a download.

`path` stays `null` on web, so each save re-prompts. Retaining the
`FileSystemFileHandle` to give web the desktop's silent-overwrite `Save` is a
real improvement, but a separate UX change — it needs a save-target concept that
does not leak a fake path into `currentFilePath` and the `.osf` format.

## Affected Areas

- `apps/web/src/platform/fileService.ts` — `saveProjectFile` on the interface
  and all four service implementations.
- `apps/web/src/store/workspaceStore/slices/projectSlice.ts` — the four project
  saves serialize inside a thunk; the workspace file's `activeDesignId` now uses
  the id captured before the dialog, so serialization is order-independent.
- `apps/web/src/platform/fileService.test.ts` — cancel, denied permission,
  success, failed write, and both fallback routes.
- `apps/web/src/store/workspaceStore/store.test.ts`,
  `designTabRoundTrip.test.ts` — fakes and assertions moved to
  `saveProjectFile`, plus the regression guard for a cancelled save.

## Checklist

- [x] Confirm the desktop path already reports cancellation correctly.
- [x] Confirm every `dirty: false` save site is gated on a non-null result.
- [x] Add `saveProjectFile` with the picker, the download fallback, and
      pick-before-serialize ordering.
- [x] Move the four project-save call sites onto it.
- [x] Unit-test cancel, denied permission, success, failed write, no-picker and
      lost-activation outcomes, and that exports stay on the download.
- [x] Add the store-level regression test for a cancelled save.
- [x] Run web lint, typecheck, and unit tests.
- [x] Browser-verify: edit → cancelled save leaves `dirty` true, no download, no
      error, `beforeunload` still armed, title still `*Untitled`; a real save
      writes and disarms it; and with no picker the download path is unchanged.
