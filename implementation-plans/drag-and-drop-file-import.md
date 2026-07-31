# Drag and Drop File Import

## Goal

Drop a file onto Ori Studio and have it do the obvious thing.

- **Welcome screen** — dropping any supported document opens it and lands in the
  workspace that owns it, exactly as File ▸ Open would.
- **Edit workspace (and the other workspaces)** — dropping a crease pattern asks
  whether to *import it beside the current crease pattern* (the existing Import
  (Add) merge) or *open it as a new file*, and folds the unsaved-changes warning
  into that same prompt rather than stacking a second modal on top of it.
- Files that cannot be merged (`.osf`, `.bps`, `.tmd*`) skip the choice and go
  straight to open, still guarded by the unsaved-changes prompt.
- The gesture behaves identically on web and on the Tauri desktop shell.

Two decisions taken up front, recorded here because they shape everything below:

1. **Both surfaces use webview HTML5 drops.** `dragDropEnabled` stays `false` in
   `tauri.conf.json`, so OS file drops keep reaching the DOM on desktop and there
   is exactly one transport to build and test. The alternative — Tauri's native
   drag-drop, which is the only way to get a real filesystem path — was rejected
   because it consumes every drag before WebKit sees it and would take Dockview's
   panel dragging with it (see R1). The cost of this choice is that desktop drops
   carry no path; §5 covers how that degrades.
2. **Image drops keep today's behavior** — an image dropped on the crease-pattern
   viewport still becomes a reference image with no dialog; an image dropped
   anywhere else is rejected with a toast. No new "detect CP from image" branch.

Both decisions cut work. Because the transport is HTML5 on both surfaces, the
existing image drop and the CP-detect modal's drop zone keep working untouched,
and no Tauri config, capability, or Rust change is needed anywhere in this plan.

## Approach

### 1. What a drop decides

A new pure module `apps/web/src/lib/fileDrop.ts` owns the decision, with no React
and no store dependency. Classification is by filename extension — the app
already routes files that way (`isNativeProjectFilename`, `isBpProjectFilename`,
`isCreasePatternFilename`, `importedCreasePatternFormat`), and a dropped `.cp`
has no useful MIME type to go on.

```ts
type DroppedFileKind =
  | { kind: 'project' }                                           // .osf
  | { kind: 'box-pleat' }                                         // .bps
  | { kind: 'tree' }                                              // .tmd .tmd4 .tmd5
  | { kind: 'crease-pattern'; format: ImportedCreasePatternFormat } // .cp .fold .ori .orh
  | { kind: 'image' }                                             // image/* MIME
  | { kind: 'unsupported' };

classifyDroppedFile(file: File): DroppedFileKind;
resolveDropDecision(input: {
  kind: DroppedFileKind;
  policy: DropTargetPolicy;   // 'open-only' | 'open-or-import'
  canImportAdd: boolean;      // capability `file.importAdd`
  dirty: boolean;
}): DropDecision;             // { intent, needsChoice, warnsDiscard, rejectReason? }
```

`fileDrop.test.ts` pins the extension table against the existing predicates and
against `openProject`'s own extension list, so the two cannot drift apart
silently.

The resulting matrix — this is the whole feature, stated once:

| Dropped file | Editable CP loaded | Unsaved changes | What happens |
| --- | --- | --- | --- |
| `.cp` `.fold` `.ori` `.orh` | yes | no | Choice dialog: **Import beside the current pattern** / **Open as new file** / Cancel |
| `.cp` `.fold` `.ori` `.orh` | yes | yes | Same dialog; the Open option carries the discard warning and is toned `danger` |
| `.cp` `.fold` `.ori` `.orh` | no | no | Opens, no dialog |
| `.cp` `.fold` `.ori` `.orh` | no | yes | Existing discard confirm, then opens |
| `.osf` `.bps` `.tmd` `.tmd4` `.tmd5` | — | no | Opens, no dialog |
| `.osf` `.bps` `.tmd` `.tmd4` `.tmd5` | — | yes | Existing discard confirm, then opens |
| image, on the CP viewport | yes | — | Reference image at the drop point, no dialog (unchanged) |
| image, anywhere else | — | — | Toast: not supported here |
| anything else | — | — | Toast naming the supported extensions |

The welcome screen always uses `policy: 'open-only'`. It has to: the Edit canvas
is always-live, so `oristudioCpDocument` can still be non-null while sitting on
`/welcome`, and offering "import into the current CP" from the start screen would
be nonsense. The policy is a property of the drop target, not of store state.

Capability gating is **not** reinvented. `openProject` and
`importAddCreasePattern` already call `rejectDisabled('file.open')` /
`rejectDisabled('file.importAdd')`, which set the localized error envelope that
`GlobalToasts` renders. The controller only reads
`selectWorkspaceCapabilities(useWorkspaceStore.getState())['file.importAdd'].enabled`
to decide whether the *choice* is worth offering, and otherwise lets the store
reject.

### 2. One controller behind DOM bubbling

`apps/web/src/commands/fileDropController.ts` — a sibling of the existing
`startScreenController.ts` — is the only place that knows what to *do*:

1. Pick the single document to act on (first document-kind entry; if others were
   dropped, say so in a toast rather than silently ignoring them).
2. `resolveDropDecision(...)`.
3. If `needsChoice`, `await requestChoice(...)`.
4. Wrap the `File` in a `FileService` and call the existing store action:
   - open → `openProject(service, { confirmDiscard: false })` (its own prompt is
     suppressed because the drop dialog already covered discard), then
     `navigateTo(openedProjectPath())`;
   - import → `importAddCreasePattern(service)`, then `navigateTo(EDIT_PATH)` if
     the current route is not already Edit;
   - reject → set the error envelope, which the existing toast renders.

The `FileService` indirection is what makes this cheap: `openProject` and
`importAddCreasePattern` both already take an optional `FileService`, so neither
needs a drop-specific code path. One new adapter,
`createDroppedFileService(file: File)` in `platform/fileService.ts`, resolves
`openTextFile`/`openBinaryFile` from the `File` (path `null`) and delegates saves
to the browser service.

Targets are ordinary DOM nodes and ordering is ordinary event bubbling — no
registry and no hit-testing, because there is no window-level transport that
needs to work out what it hit. `useFileDropTarget({ policy, onDrop })`
(`apps/web/src/hooks/`) returns `{ dropTargetProps, isDragActive }` and is
mounted twice:

| Target | Element | Policy |
| --- | --- | --- |
| Welcome | wrapper around `StartScreen` in `WelcomeRoute` | `open-only` |
| Workspace | `workspace-shell__canvas` in `WorkspaceShell` | `open-or-import` |

The workspace target is mounted on the shell rather than on the Edit panel, so
dropping a `.cp` while in Design or Simulate also works — the "can I import?"
question is answered by store state, not by which workspace is visible.

The CP viewport keeps its existing image handler in `useCpAnnotations` and gains
exactly one line: `stopPropagation()` when it consumes an image, so a handled
image does not also bubble to the workspace target. Non-image drops fall through
to the workspace target untouched. Per `AGENTS.md`, nothing new lands in
`CreasePatternPanel` — it keeps the two handler props it already passes.

### 3. The choice dialog

`commandDialogStore.ts` gains a `choice` dialog type alongside `confirm`,
`confirm-option`, `number`, and `crease-export`, following the same
`pending`-union + `resolveCommandDialog`/`cancelCommandDialog` protocol and the
same no-host-mounted fallback (`null`):

```ts
requestChoice(options: {
  title: string;
  message: string;
  options: { id: string; label: string; description?: string; tone?: 'default' | 'danger' }[];
  cancelLabel?: string;
}): Promise<string | null>;
```

`CommandDialogModal` renders it with the existing `simple-modal` classes — a
vertical stack of option buttons, each with a description line — so it matches
the confirm and number dialogs without new chrome.

One dialog, not two. When the file is mergeable the dialog presents the choice
and, if the project is dirty, states the consequence on the Open option; the
subsequent `openProject` call passes `confirmDiscard: false` so the store does not
prompt again. When the file is not mergeable the dialog degrades to the existing
`confirmDiscardDirty` prompt, or to nothing at all when the project is clean.

### 4. Drop affordance, and what it can honestly say

`FileDropOverlay` renders while `isDragActive`: a dashed inset border over the
target and a short label.

The label has to be **generic**, and this is a real constraint rather than a
style choice. During `dragover` the browser withholds `dataTransfer.files` for
security; only `dataTransfer.items` is readable, which exposes each entry's MIME
type but **not its filename**. Since `.cp`, `.fold`, `.ori`, and `.orh` all
report an empty or `application/octet-stream` type, the overlay cannot know which
document is inbound. So:

- Copy is per-policy, not per-file: "Drop to open a file" (welcome) or
  "Drop to open or import a file" (workspace).
- Precision arrives on drop, as a toast — the unsupported-file message names the
  file and the supported extensions.
- The overlay suppresses itself for **image-only** drags, which *are* detectable
  from `items[].type`. That keeps the existing reference-image gesture exactly as
  silent as it is today and avoids the workspace overlay claiming "not supported"
  over a viewport that is about to accept the image.

Drags that carry no files are ignored outright — the handlers check that
`dataTransfer.types` includes `'Files'` before calling `preventDefault`, as the
existing image handler already does. That is what keeps Dockview tab drags and
ordinary text drags working.

The handlers must count `dragenter`/`dragleave` (or compare `event.target`) so
moving the cursor over a child element does not flicker the overlay off.

### 5. What the desktop gives up, and how it degrades

A webview HTML5 drop yields a `File` with no filesystem path — there is no
supported way to recover one from inside WKWebView. So a document opened by drop
on desktop has `currentFilePath: null`, while the same file opened through
File ▸ Open or Open With carries its path.

Verified: this degrades gracefully with **no new code**. The loaders set
`currentFileName: filename` and `currentFilePath: source.path ?? null`
(`projectSlice.ts:744`, `:896`, `:1021`). `nativeSaveTarget()` (`:1153`) then
uses `currentFileName` as the suggested name and `currentFilePath` as the
overwrite target — so a dropped `.osf` gets a null path, `saveTextFile` falls
through to `chooseSavePath`, and the first Cmd+S opens a native Save dialog
already pre-filled with the dropped filename. Second and subsequent saves
overwrite normally, because the save result writes `currentFilePath` back
(`:1216`).

The residual gap is one extra dialog on the first save after a drop, only on
desktop, only for files opened by dragging. That is the whole price of keeping
Dockview working.

## Risks and mitigations

### R1 — Native drag-drop would break Dockview (resolved by decision)

Recorded because it is the reason for decision #1, and because anyone revisiting
`dragDropEnabled` needs the evidence rather than the conclusion:

- `dockview-core/dist/cjs/dnd/abstractDragHandler.js` and `dnd/dnd.js` use native
  HTML5 drag-and-drop (`dragstart`, `dragover`, `drop`, `dataTransfer`). Panel
  and tab rearranging depends on it.
- `wry-0.55.1/src/wkwebview/drag_drop.rs` overrides the NSDraggingDestination
  methods (`draggingEntered:`, `draggingUpdated:`, `performDragOperation:`,
  `draggingExited:`) and forwards to `super` — letting WebKit handle the drag —
  **only when the handler returns `false`**.
- `tauri-runtime-wry-2.11.2/src/lib.rs:4864` installs that handler when
  `drag_drop_handler_enabled` and returns `true` unconditionally, including when
  `collect_paths` found no file paths on the pasteboard — exactly the in-page
  drag case.

So enabling it consumes every drag entering the webview before WebKit sees it.
**Mitigation: don't enable it.** If real paths on desktop ever become worth
revisiting, the prerequisite is confirming WKWebView's in-page drag routing
empirically first (flip the flag, `npm run dev:desktop`, drag a Dockview tab) —
not reasoning about it.

### R2 — A drop can silently preempt an open dialog (medium)

`commandDialogStore` holds one dialog at a time, and every `request*` entry point
calls `clearPendingWithFallback()`, resolving whatever was pending with its
fallback value. A file dropped while the export dialog is open would silently
cancel that export.

**Mitigation:** the drop controller refuses (with a toast) when
`useCommandDialogStore.getState().dialog !== null`, and the overlay does not
appear. Covered by a controller test.

### R3 — Folder drops (low, but ugly)

A dropped directory appears in `dataTransfer.files` as a zero-byte entry with an
empty `type`, and reading it rejects with a `NotReadableError` that would surface
raw in a toast.

**Mitigation:** classification rejects entries with no recognized extension
before any read, which catches folders as a side effect, with the standard
unsupported-file message.

### R4 — Dropping makes it easier to hit a known large-file failure (low–medium)

Not caused by this work, but opening becomes a gesture rather than a deliberate
dialog: large `.osf` files exhaust WKWebView/JSC memory on desktop (a 47MB /
52k-edge file reproduces it), and the failure presents as an unrelated
destructuring error rather than an out-of-memory message.

**Mitigation:** none in scope — flagged so it is not misdiagnosed as a drag-drop
bug. The existing large-file guard work is where a real fix belongs.

### R5 — Import (Add) does not place the pattern where you dropped it (low)

Faithful to Oriedita, `import_add` shifts the merged pattern to
`existing.maxX + 100` — beside the current pattern, not at the cursor and not
overlaid. Someone dropping a file onto the canvas may reasonably expect it to
land under the cursor, and at some zoom levels it will arrive off-screen.

**Mitigation:** name the option for what it does — "Import beside the current
pattern", matching the existing capability label. Do **not** change the placement
maths; it is upstream parity. A zoom-to-fit after import is a reasonable
follow-up, not part of this work.

### R6 — `confirmDiscard: false` is a footgun (low)

Adding a prompt-suppressing option to `openProject` means any future caller can
silently discard unsaved work.

**Mitigation:** it is passed from exactly one call site, mirroring the option
`createOristudioBpProject` already carries, and a store test asserts the default
still prompts.

### Checked and *not* a risk

- **HTML5 file drops already work on desktop.** The CP viewport's reference-image
  drop is live today with `dragDropEnabled: false`, so the transport this plan
  relies on is proven on both surfaces rather than assumed.
- **The `dirty` flag is trustworthy.** Annotation edits set `dirty: true`
  (`creasePatternSlice.ts:2155`), as do CP mutations, so "unsaved changes" really
  does cover reference images and text boxes, not just creases.
- **Import (Add) handles all four CP formats.**
  `importAddOristudioCpDocumentFromText` dispatches `cp`/`ori`/`orh`/`fold` to
  the kernel, so offering Import for a dropped `.ori` or `.orh` is sound.
- **No Tauri or Rust change at all.** No config flag, no capability, no new
  command — dropped files never cross the IPC.

## Affected Areas

**New**

- `apps/web/src/lib/fileDrop.ts` + `fileDrop.test.ts` — classification, intent
  matrix, extension table.
- `apps/web/src/commands/fileDropController.ts` + test — the dispatcher.
- `apps/web/src/hooks/useFileDropTarget.ts` — DOM handlers, drag-active state,
  file-only and image-only detection.
- `apps/web/src/components/FileDropOverlay.tsx` — the affordance.

**Changed**

- `apps/web/src/store/commandDialogStore.ts` + `components/CommandDialogModal.tsx`
  — the `choice` dialog type and `requestChoice`.
- `apps/web/src/store/workspaceStore/slices/projectSlice.ts` +
  `workspaceStore/types.ts` — `openProject(fileService?, { confirmDiscard? })`,
  mirroring the option `createOristudioBpProject` already has.
- `apps/web/src/platform/fileService.ts` — `createDroppedFileService`.
- `apps/web/src/routing/WelcomeRoute.tsx` — mount the `open-only` target.
- `apps/web/src/components/WorkspaceShell.tsx` — mount the `open-or-import`
  target on the canvas.
- `apps/web/src/cp-workspace/annotations/useCpAnnotations.ts` — `stopPropagation()`
  on a consumed image drop.
- `apps/web/src/App.css` — overlay and choice-dialog styles.
- i18n: new strings in `dialogs`, `toasts`, `common`; all 8 locales.

**Deliberately untouched**

`apps/tauri/**` (no config, capability, or command change),
`CpDetectImportModal.tsx` and `cpImageImport.ts` (their HTML5 drop paths keep
working), and `CreasePatternPanel.tsx`.

## Checklist

**Phase 1 — Classification (pure, no UI)**

- [x] `lib/fileDrop.ts`: `classifyDroppedFile`, `resolveDropDecision`,
      `DropTargetPolicy`.
- [x] `fileDrop.test.ts`: the full matrix above, plus the pin test asserting the
      extension table agrees with `isCreasePatternFilename`,
      `isNativeProjectFilename`, `isBpProjectFilename`, and `openProject`'s list.

**Phase 2 — Choice dialog**

- [x] `choice` dialog type + `requestChoice` in `commandDialogStore`.
- [x] Render it in `CommandDialogModal` with the existing `simple-modal` styles.
- [x] Test: resolves the chosen id, `null` on cancel/Escape, `null` with no host.

**Phase 3 — Store and platform seams**

- [x] `openProject(fileService?, options?: { confirmDiscard?: boolean })`.
- [x] `createDroppedFileService(file)`.
- [x] Tests: `store.test.ts` (the option skips the prompt and still opens; the
      default still prompts), `fileService.test.ts` (dropped service yields
      text/bytes and a null path).

**Phase 4 — Controller**

- [x] `commands/fileDropController.ts`: pick the document, resolve the decision,
      prompt, dispatch, navigate.
- [x] Test with a mocked store and `requestChoice`: choice offered only when
      `file.importAdd` is enabled; `confirmDiscard: false` on the open path;
      navigation target per outcome; refusal while another dialog is open;
      unsupported, folder, and multi-file messaging.

**Phase 5 — Transport, targets, affordance**

- [x] `useFileDropTarget` with dragenter/dragleave counting, files-only guard,
      and image-only suppression.
- [x] `FileDropOverlay` + `App.css`.
- [x] Mount on `WelcomeRoute` (`open-only`) and `WorkspaceShell`
      (`open-or-import`).
- [x] `stopPropagation()` on the consumed-image path in `useCpAnnotations`.
- [ ] ~~Extend `StartScreen.test.tsx` for the drop zone.~~ Not done: the target
      landed on the `WelcomeRoute` wrapper, not inside `StartScreen`, so
      `useFileDropTarget.test.tsx` covers the behaviour where it actually lives.

**Phase 6 — i18n and validation**

- [x] `npm run i18n:extract`, translate the new keys in all 8 locales,
      `npm run i18n:stamp`, `npm run i18n:check`.
- [x] `npm run lint:web`, `npx tsc --noEmit`,
      `npm --workspace @treemaker/web exec -- vitest run`.
- [ ] Manual web verification (drag-drop cannot be driven from the automated
      browser pane): drop each file kind on welcome and on Edit, with and without
      unsaved changes; confirm one modal, not two; confirm an image still lands
      at the cursor with no overlay and no dialog.
- [ ] Manual desktop verification via `npm run dev:desktop`: the same passes,
      plus Dockview tab dragging still works, the CP-detect modal drop zone still
      works, and the first Cmd+S after a dropped `.osf` opens a Save dialog
      pre-filled with the dropped filename.
