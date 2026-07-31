# BP Symmetry Persistence

## Goal

Save a box-pleat design's symmetry with the design, so reopening an `.osf`
restores which flaps mirror which, whether mirror draw is on, and which fold of
the paper the mirror represents — without changing a single byte of what we
write to Box Pleating Studio's own formats.

Today all of it is session state. `oristudioBpSymmetry` is reset on every
document load, and the fold lives in `localStorage` as an app-wide preference.
Close the tab and a symmetric design comes back as an ordinary one, with nothing
recording that it was ever symmetric.

## Approach

### What is actually state

Most of `OristudioBpSymmetryState` is derivable and should not be written:

| Field | Persist? | Why |
| --- | --- | --- |
| `pairs` | **yes** | The only non-derivable part. Inference (`mirrorBpTreeVertexId`) falls back to matching a vertex against the reflected position within `BP_TREE_SYMMETRY_TOLERANCE = 0.02` — on unit-length leaves that is a 2% drift budget, so any editing with mirror draw off silently loses the partner. The explicit pair is the durable record; inference is the fragile fallback. |
| `enabled` | **yes** | Reopening a symmetric design with mirror draw quietly off invites breaking the symmetry without noticing. |
| `fold` | **yes**, moved | Currently a global `localStorage` preference in `bpOptimizerUiStore`, modelled on `useDimension` and the layout method. But those are *how you like to run the optimizer*; the fold is a fact **about the design**. Setting "diagonal" once should not follow you into every other model you open. |
| `angle` | no | Always `BP_TREE_SYMMETRY_ANGLE` (90). Derive it. |
| `loc` | no | The sheet centre. Derive it — a stored copy goes stale the moment the sheet is resized. |

On-axis-ness needs no storage either. Snapping projects the point *exactly* onto
the line, so `symmetrySide(...) === 0` is an exact test there, not a fuzzy one.

### Where it goes — a correction

I previously said to fill the hardcoded `extensions: {}` at
`nativeProjectFile.ts:327`. That was wrong, and `apps/web/docs/superset-features.md`
says so in two places: §2 ("Do **not** stuff it in the untyped `extensions` bag —
that bag is reserved for unknown/forward-compat data") and the anti-pattern list
("Persisting via the `extensions` bag as a typed feature"). Every CP superset
feature is a **typed field with a schema bump** — `images` (v3), `textAnnotations`
(v4), `inlineSimulations` (v5). Symmetry follows the same route:

- A typed `symmetry` field on `NativeBoxPleatDocumentV1`, validated on read.
- `NATIVE_PROJECT_SCHEMA_VERSION` 5 → **6**, with older files defaulting the
  field.
- `minimumReaderSchemaVersion` stays **1**, so an older build still opens the
  file — it ignores symmetry and drops it on re-save, the accepted degradation.

`extensions` stays what it is: the forward-compat passthrough.

### Why this costs nothing in BP Studio compatibility

Verified, not assumed:

- **`.bps`/`.bpz` are exports, not the save path.** `.osf` is the native
  container and already carries the whole BP project as `{engine: 'oristudio-bp',
  format: 'bps', text}`. Symmetry never enters the Rust `Project` model, so every
  BP Studio export stays byte-faithful with **no changes to the export path at
  all**.
- **BP Studio has no symmetry concept**, so by the doctrine's decision gate this
  is a pure superset feature like images (omitted whole), not a flatten-onto-kernel
  feature like rich text (partially round-trips).
- **The version string is a landmine.** `$getVersionIndex` does a `findIndex` and
  throws `"Unrecognized version"` on a miss, so a `.bps` must always carry a
  version upstream knows. We never touch it.
- **Their writer is lossy by construction.** `Project.toJSON()` rebuilds a fresh
  `{version, design, history, state}`, so anything extra we smuggled into a
  `.bps` would die the moment someone saves in BP Studio anyway. That is the
  tempting shortcut — a namespaced key inside the `.bps` — and it is exactly what
  the superset doctrine exists to prevent. Not doing it.

The accepted consequence: `.osf` → open in real BP Studio → save → back here, and
symmetry is gone. Same deal as images; the export warning is what keeps it from
being silent on our side.

### Vertex ids survive the round trip

The load-bearing assumption is that `pairs` — which are just vertex ids — still
point at the right vertices after the design is re-parsed from BPS text on load.
Checked in the kernel: `Edge { n1: NodeId, n2: NodeId, length }` and
`Flap { id: NodeId }` are serialized with explicit `u32` ids
(`crates/oristudio-bp/src/model.rs`), so ids are stored in the `.bps` text rather
than derived from ordering. They are stable across our round trip.

`filterBpTreeSymmetryPairs` already prunes pairs to live vertices on load, which
covers the case where a design is replaced under stale pairs.

### The registry is not a one-line addition

I said earlier that registering the loss was one line in `supersetFeatures.ts`.
It isn't — that file is entirely CP-shaped:

- `ExportFormat` is the Oriedita set (`cp|fold|ori|orh|dxf|obj|svg|png`); there
  is no `bps`/`bpz`.
- `SupersetPresence` is CP state (images, rich text, inline sims, line segments).
- The single `guardExportLoss` call site (`projectSlice.ts:1311`) samples CP
  store fields, and no BP export path calls it.

So Phase 3 has to make the registry surface-aware: add the BP export formats,
add symmetry to the presence, and add a guard call on the BP export actions.
Symmetry is **non-blocking** — like an image, losing it leaves a design that
still means what it meant; what's lost is the authoring aid, and the user keeps
the `.osf`.

### Two consequences worth naming

- **Dirty tracking.** Symmetry edits don't mark the document dirty today, because
  nothing persisted them. Once they are document data, toggling mirror draw or
  unpairing must set `dirty: true` or the user loses the change silently on close.
- **Undo.** Unpair becomes the only BP edit that undo can't reverse unless
  symmetry joins `oristudioBpHistoryPast`. Doctrine §6 says join the shared
  snapshot history, one entry per completed gesture.

## Affected Areas

- `apps/web/src/lib/nativeProjectFile.ts` — typed `symmetry` field on the
  box-pleat document, schema v6, validation and default-on-old-files.
- `apps/web/src/store/workspaceStore/slices/projectSlice.ts` — write symmetry on
  save (`saveNativeWorkspaceProject`), restore on load (the `box-pleat` branch),
  guard the BP export paths.
- `apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts` — symmetry
  becomes document state: stop resetting it blindly on load, mark dirty on
  change, carry `fold`. The "Ephemeral mirror-draw state (never persisted)"
  comments at lines 182 and 309 become wrong and must change with it.
- `apps/web/src/store/workspaceStore/types.ts` — `OristudioBpSymmetryState` gains
  `fold`, loses `angle`/`loc` if they are derived rather than stored.
- `apps/web/src/store/bpOptimizerUiStore.ts` — drop `symmetryFold` from the
  persisted options and its merge.
- `apps/web/src/components/BpOptimizerModal.tsx` — read/write the fold from the
  document rather than the UI store.
- `apps/web/src/lib/supersetFeatures.ts` — BP export formats, symmetry presence.
- `apps/web/docs/superset-features.md` — it is written as a CP/Oriedita document;
  note that the same rules now govern the BP surface, with symmetry as the
  worked example.
- `PORTING.md` — the Box Pleating Studio section already records symmetry as an
  Ori Studio extension; add where it is persisted and what exports drop.

## Checklist

### Phase 1 — symmetry becomes document state
- [ ] Add `fold` to `OristudioBpSymmetryState`; derive `angle` and `loc` instead
      of storing them (or leave them in the runtime state but exclude them from
      what is written — decide at the type, not at the serializer).
- [ ] Move `symmetryFold` out of `bpOptimizerUiStore`'s persisted options; ignore
      the stale `localStorage` key on read.
- [ ] Point `BpOptimizerModal` and `optimizeOristudioBpLayout` at the document's
      fold.
- [ ] Mark the document dirty when symmetry changes (toggle, pair, unpair, fold).
- [ ] Correct the "ephemeral / never persisted" comments.
- [ ] Tests: the fold survives a document swap; a new document does not inherit
      the previous one's fold.

### Phase 2 — persist in `.osf`
- [ ] Typed `symmetry` field on `NativeBoxPleatDocumentV1`, with the same
      doc-comment shape as `images`/`textAnnotations`/`inlineSimulations`.
- [ ] `NATIVE_PROJECT_SCHEMA_VERSION` → 6; accept 6 in `validate`; default the
      field when absent; `minimumReaderSchemaVersion` stays 1.
- [ ] Write it in `saveNativeWorkspaceProject`; restore it in the `box-pleat`
      load branch, pruning pairs to live vertices.
- [ ] Tests: round trip preserves pairs/enabled/fold; a v5 file loads with the
      default; a file with garbage in `symmetry` is rejected the way other
      malformed fields are; ids still resolve after the BPS text round trip.

### Phase 3 — register the loss
- [ ] Extend `ExportFormat` with `bps`/`bpz` (and the other BP export formats
      that drop symmetry: `cp`, `fold`, `svg`, `png`).
- [ ] Add a `symmetry` entry to the registry, non-blocking, counting pairs (plus
      `enabled` — a symmetric design with no explicit pairs still loses the fold).
- [ ] Call the guard from the BP export actions in `projectSlice.ts`.
- [ ] Tests: exporting `.bps` with symmetry warns; without symmetry it does not;
      `.osf` save never warns.

### Phase 4 — undo and docs
- [ ] Include symmetry in `BpHistorySnapshot` so unpair/toggle are undoable, one
      entry per completed gesture.
- [ ] Update `apps/web/docs/superset-features.md` to cover the BP surface.
- [ ] Update `PORTING.md` with where symmetry is persisted and what drops it.
