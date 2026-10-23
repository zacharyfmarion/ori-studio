# Linked CP Collapse step

## Goal

Let a Fold step refer to a crease pattern already saved in the project. The
step's Fold view and timeline card show the folded result, labeled **Collapse**.
Subsequent folds continue from its resolved flat state. The workflow is implemented locally; Witch Hat completion remains an authoring investigation.

The user chose **explicit Update from CP** on 2026-10-14. Editing the source
must not silently alter saved steps or their results.

## Approach

### Authoring and presentation

1. Add **Collapse from CP…** to the existing Fold import/action surface. Pick
   the project's CP and insert after the current step, using normal branching.
   For Witch Hat this is the CP the user added beside the Fold sequence.
2. Snapshot its crease data and resolve a flat result through the existing CP
   import and layer-order chooser. If several orders work, preview and choose
   one; a silhouette alone cannot choose hidden layers. No new fold animation
   or 3D state is needed.
3. Always show the resolved folded state in the Fold canvas and timeline,
   with the **Collapse** label. The user rejected the separate CP-only screen
   during the 2026-10-14 audit. The ordinary CP side pane and Steps grid
   remain available. The inspector offers **Open source CP** and
   **Update from CP**, with no result/CP screen toggle.
4. A CP that cannot yet resolve to a valid flat state must not produce a fake
   continuation. Show the specific import/completion failure and retain the
   prior valid sequence. Whether to allow a CP-only draft marker is a separate
   optional extension, not required for the first version.

### Document and replay

- Build on `FoldCpJumpOp`: it already stores `cpJson`, `orderJson` and origin,
  and replay uses the saved crease data and witness-based layer order.
- Add a project-CP source reference (stable workspace/document identity and a
  revision/content hash) and collapse presentation metadata. The embedded
  snapshot remains authoritative for replay. A moved or unavailable source
  therefore cannot break a previously saved step.
- A linked CP is a target crease pattern for the same sheet. Reuse import's
  outline matching, coordinate normalization, front/back interpretation and
  root placement against the parent. Keep existing sheet and geometry guards.
  Auxiliary guide lines stay guides; they do not become folds.
- Detect source edits by content/revision and offer **Update available**.
  **Update from CP** snapshots the current source, resolves/picks its layer
  order again, and replays descendants. Preserve source-step notes and branch
  identities. Report the first broken/changed descendant; never drop or retarget
  later folds silently. Updating is an undoable document transaction, with the
  old snapshot intact if solving fails or the user cancels.
- Reopening the `.osf` must render the exact saved CP and replay the exact
  chosen flat result without access to the live CP editor or a network fetch.

### Existing implementation to reuse

- `apps/web/src/fold/io/foldImportFlow.ts` already handles imported CPs,
  completion choices, cancellation and committing an imported flat state.
- `crates/oristudio-fold/src/import/` already matches the sheet and derives
  geometry/layer orders. This is a state transition; it does not claim to
  prove a continuous physical collapse from the parent.
- `apps/web/src/fold/document/foldSequenceDocument.ts` and its file reader,
  writer and replayer store the CP jump and chosen result.
- `apps/web/src/fold/sequence/` builds timeline cards and inspector data.
  Add CP presentation here and in the Fold canvas, keeping presentation
  separate from the flat state used to author the following fold.
- Use shared command/session patterns for browser and desktop. Extend the
  existing import analytics origin enum for project CPs; use only enums/counts,
  never names, hashes or geometry. New/changed presentation follows CSS modules.

## Affected Areas

- Fold import flow and project CP adapter
- Fold operation document, serialization and replay
- Timeline thumbnails, main Fold canvas and step inspector
- Shared actions, translations and import analytics
- Native file fixtures and real-WASM save/load/update regression tests

## Checklist

- [x] Inspect the user-edited Witch Hat file: one 36-line CP plus the intact
  13-node Fold prefix through source 7 / Fold step 10.
- [x] Confirm explicit Update from CP; retain snapshots until requested.
- [x] Identify existing CP import, layer-order chooser and replay paths.
- [x] Implement source linking and snapshot persistence after design agreement.
- [x] Implement Collapse linking and explicit update/replay workflow.
- [x] Apply user audit feedback: always show the folded result; remove the CP-only screen and view toggle.
- [x] Test unique/multiple orders, existing sheet guards, cancellation, undo,
  stale source, descendant replay and offline reopening.
- [x] Verify Witch Hat source 8–10, preserve the original CP and save a fresh-replayed native prefix.
- [ ] Finish Witch Hat source 11–14 after resolving F032; keep the unverified candidate separate.

The original Witch Hat is preserved in models/archive/checkpoints/witch-hat-before-linked-collapse.osf. Its current SHA-256
is `393e372da04d78201012f0dec2d436b61505c2f390ce608c682fe8d803fecce9`.
No required cuts, multiple sheets, non-flat behavior, PR, push or schedule.

See [implementation and validation](../research/origami-me-flat-catalog/batches/linked-cp-collapse-2026-10-14.md).
