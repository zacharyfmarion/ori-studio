# Adding a Superset Feature (beyond the upstream tools)

Ori Studio's kernels are faithful **ports of upstream tools** — `oristudio-cp` of
Oriedita, `oristudio-bp` of Box Pleating Studio. Most editor features map onto an
upstream concept and live in the relevant kernel. Occasionally we add something
the upstream has **no concept of** — images on the canvas, mirror symmetry on a
box-pleat design. We call these **superset features**, because Ori Studio's
native `.osf` becomes a *superset* of every format it can export.

This guide is the pattern for adding one. It is written in terms of the
crease-pattern surface, which is where most of them are and where the pattern was
established, but the rules are the same on either surface: substitute the
relevant kernel, upstream, and export formats. Read it alongside
[`implementation-plans/image-support-edit-workspace.md`](../../../implementation-plans/image-support-edit-workspace.md)
(the worked CP reference) and
[`implementation-plans/bp-symmetry-persistence.md`](../../../implementation-plans/bp-symmetry-persistence.md)
(the same shape on the Design surface, where the "kernel stays pure" rule meant
symmetry never entered `oristudio-bp` and `.bps` export needed no changes at
all).

---

## The governing principle: keep the Rust kernel pure

Every Oriedita-format export — `.cp`, `.fold`, `.ori`, `.orh`, DXF, OBJ — runs
**inside the wasm CP handle**, i.e. against the `oristudio-cp` kernel (see
[`src/workers/oristudioCpWorker.ts`](../src/workers/oristudioCpWorker.ts):
`exportCp`/`exportFold`/`exportOri`/`exportOrh`). That crate is our
Oriedita-fidelity contract and export source of truth.

> **A superset feature must never enter `oristudio-cp`.**

Why this is the whole ballgame:

- If the feature isn't in the kernel, **every Oriedita export omits it
  automatically** — zero changes to any export path. Graceful degradation is a
  property of the architecture, not of per-export code.
- The feature lives in a **web-side layer**, persists only in `.osf`, renders as
  its own layer, and is edited by web-side tools.

The layering rule:

| Concept kind | Lives in | Round-trips to Oriedita? |
| --- | --- | --- |
| **Kernel-native** (creases, circles, text, grid) | `oristudio-cp` (Rust/wasm) | Yes |
| **Superset** (images, …) | web-side store + `.osf` | No — omitted, with a warning |

**Decision gate before you start:** does the new thing have a real Oriedita
equivalent? If yes, it belongs in the kernel — port it there, don't make it a
superset feature. Superset is only for concepts Oriedita genuinely lacks.

### Variant: a superset feature that *flattens onto* a kernel concept

Some features are a superset **wrapper** around a concept the kernel already
has. **Rich text** is the worked example: Oriedita text is `TextElement
{x, y, text}` (kernel-native), but Ori Studio's rich-text boxes add formatting
(bold/italic/underline, block presets, color) and a resizable, reflowing box —
none of which Oriedita can express.

The rule is the same (keep the kernel pure), with one addition — a **codec** at
the export/import boundary:

- The rich model lives web-side (`cp-workspace/annotations/`, a `text` variant of
  the unified `CanvasAnnotation`) and persists in full only in `.osf`.
- On **export**, each box **flattens** to `{x, y, text}` (box center + plain
  text, marks dropped) and is pushed into the kernel via the `set_texts` wasm
  bridge just before the Oriedita export runs, then cleared — so the kernel
  `texts` vec is used *only* as the interchange representation and stays empty
  during a session. See `flattenTextAnnotations` +
  [`oristudioCpWorker.ts`](../src/workers/oristudioCpWorker.ts) `exportWithTexts`.
- On **import**, kernel `texts` **inflate** back into default-styled boxes, and
  the kernel copy is cleared so a later `.osf` save doesn't double-count them.

So unlike images (fully omitted), a flatten-onto-kernel feature **partially
round-trips**: the content survives Oriedita export, the rich wrapper is lost —
and `collectExportLossWarnings` reports that loss (`Rich text formatting`).

---

## The checklist

### 1. Model it in the web store, attached to the right document
Add typed state to the owning slice (usually the crease-pattern document —
[`src/store/workspaceStore/slices/creasePatternSlice.ts`](../src/store/workspaceStore/slices/creasePatternSlice.ts)),
not to `OristudioCpDocumentSnapshot` (that's the kernel's shape). Express any
geometry in **CP model coordinates** so it tracks pan/zoom through the same
camera the renderer uses (`CpOverlayView`).

### 2. Persist it in `.osf` as a typed, first-class field
The native format and its migration live in
[`src/lib/nativeProjectFile.ts`](../src/lib/nativeProjectFile.ts).

- Add a **typed field** to the relevant `Native*DocumentV1` interface. Do **not**
  stuff it in the untyped `extensions` bag — that bag is reserved for
  unknown/forward-compat data (§5).
- Add validation that defaults the field for older files (e.g. absent → `[]`).
  **Name it in the reader's returned literal**: `validateFoldedFigure` and its
  siblings rebuild an explicit object while the writer spreads the whole entry,
  so a field the reader forgets is written out and lost on the way back in, with
  no type error anywhere. `contradiction` was going that way for months.
- **Do not bump `NATIVE_PROJECT_SCHEMA_VERSION`** for an additive field, and do
  not read the next bullet as saying otherwise. `createNativeProjectFile` writes
  `schemaVersion` *unconditionally* and `validateNativeProjectFile`'s accept list
  is a hardcoded enumeration, so a bump is not conditional on the feature being
  present: it strands **every** file this build writes in the build before it,
  whether or not that file uses the feature. Bump only when the file's *shape*
  changes, as v8 did when it split `documents` into `designs` + `creasePattern`.
- **Keep `minimumReaderSchemaVersion` at 1** so older app builds can still *open*
  new files. What they do with them is the accepted degradation, and it is worth
  being clear-eyed about: an older reader does not merely ignore an unknown
  field, it **deletes** it on re-save, because its own literal never names it.
  Raise the minimum only when that deletion is worse than refusing the file
  outright — `unknownDesigns` is the one place we judged it so (`:588`), and note
  it also needs `NATIVE_PROJECT_SCHEMA_VERSION` to have moved, since the check is
  `minimumReaderSchemaVersion > NATIVE_PROJECT_SCHEMA_VERSION` and this build
  would otherwise refuse its own output.

### 3. Register it as *lossy-on-export*
Add the feature to the shared **superset-feature registry**
(`src/lib/supersetFeatures.ts`) so every non-`.osf` export warns the user before
dropping it. The registry spans both surfaces; because a design is only ever
exported to its own upstream's formats, each feature simply names the formats
that drop it and the two sets do not overlap:

```ts
{
  id: 'images',
  label: 'Images',
  count(doc) { /* how many are present, 0 ⇒ absent */ },
  droppedByFormats: [/* every format except 'osf' */],
}
```

Export/save handlers ([`src/commands/menuActions.ts`](../src/commands/menuActions.ts),
[`src/platform/fileService.ts`](../src/platform/fileService.ts)) call
`collectExportLossWarnings(format, doc)` before writing and show one shared
confirm dialog: *"This project uses features the CP format can't store; they'll
be omitted: Images (3). Continue?"* This registry **is** the pattern — a new
feature is a one-line addition, and the user is never silently surprised.

### 4. Render and edit it as its own layer
Follow the codebase's split: **geometry on the GPU, interaction affordances in
the DOM**.

- **Display:** add a program under
  [`src/cp-workspace/renderer/programs/`](../src/cp-workspace/renderer/programs/)
  and a `set*` seam on `CpRenderer` / `reglRenderer`. Pick an explicit z-slot in
  `render()`'s draw sequence.
- **Interaction:** for selection handles / editing chrome, add a DOM overlay
  positioned via `CpOverlayView` (see
  [`src/cp-workspace/CpTextOverlay.tsx`](../src/cp-workspace/CpTextOverlay.tsx)
  as the template). Do hit-testing on the CPU in model space.
- **Live gestures:** update only the active object's transform per frame
  (mirroring the crease move-drag: `setStrokes`/`setPoints`), coalesced to one
  render per rAF — never rebuild buffers or re-upload textures mid-gesture.

### 5. Preserve unknown `extensions` for forward-compat
So data written by a *newer* app version survives a round-trip through an
*older* one, thread the previously-loaded `extensions` back through save instead
of re-emitting `{}`. (This was a latent bug fixed alongside images; keep it
working.)

### 6. Join the undo stack
Route the feature's mutations through the same snapshot history as CP edits
([`src/store/workspaceStore/snapshotHistory.ts`](../src/store/workspaceStore/snapshotHistory.ts)),
and include the new state in the captured snapshot, so one Undo reverses the last
action regardless of which layer it touched. Record one entry per completed
gesture, not per pointer move.

### 7. Gate capabilities and menus
Add capability ids in
[`src/lib/workspaceCapabilities.ts`](../src/lib/workspaceCapabilities.ts),
enabled only in the contexts where the feature applies (the existing
`maskCapabilitiesForContext` hides them elsewhere), and wire menu entries in
[`src/menus/menuDefinition.ts`](../src/menus/menuDefinition.ts).

---

## Anti-patterns

- ❌ **Adding the concept to `oristudio-cp`** "just to persist it." That pollutes
  the Oriedita contract and forces every export path to strip it.
- ❌ **Persisting via the `extensions` bag** as a typed feature. Extensions are
  for unknown/third-party data; your feature deserves a validated field + a
  migration.
- ❌ **Skipping the export warning.** Silent data loss on export is the exact
  failure mode this architecture exists to prevent — register the feature.
- ❌ **A bespoke undo stack.** Reuse the shared snapshot history so cross-layer
  Undo stays coherent.
- ❌ **Re-uploading GPU buffers/textures every pointer-move frame.** Update
  transforms only; upload once.

## Reference implementation

Images:
[`implementation-plans/image-support-edit-workspace.md`](../../../implementation-plans/image-support-edit-workspace.md).
