# Adding a Superset Feature (beyond Oriedita)

Ori Studio's crease-pattern kernel (`oristudio-cp`, in `crates/`) is a faithful
**port of Oriedita**. Most editor features map onto an Oriedita concept and live
in that kernel. Occasionally we add something Oriedita has **no concept of** —
images on the canvas, and whatever comes next. We call these **superset
features**, because Ori Studio's native `.osf` becomes a *superset* of every
format it can export.

This guide is the pattern for adding one. It generalizes the first
implementation (images); read it alongside
[`implementation-plans/image-support-edit-workspace.md`](../../../implementation-plans/image-support-edit-workspace.md),
which is the worked reference.

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
- **Bump `NATIVE_PROJECT_SCHEMA_VERSION`** and add validation + a migration that
  defaults the field for older files (e.g. absent → `[]`).
- **Keep `minimumReaderSchemaVersion` at 1** so older app builds can still *open*
  new files (they ignore the field and drop it on re-save — the accepted
  degradation). Only raise it if a file is genuinely unreadable without the new
  feature, which is rarely true for an additive layer.

### 3. Register it as *lossy-on-export*
Add the feature to the shared **superset-feature registry**
(`src/lib/supersetFeatures.ts`) so every non-`.osf` export warns the user before
dropping it:

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
