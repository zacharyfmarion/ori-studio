# Preserve auxiliary precreases when importing CPs

## Goal

Keep Edit's cyan auxiliary lines as visible, selectable flat precreases in a
Fold Collapse step, including lines ending inside the paper.

## Approach

Export all lines in the selected CP region. Adapt cyan/F lines to the Fold
engine's existing crease marks, which travel with the paper without adding
hinges or changing the layer-order problem. Keep active M/V and remembered
topological precreases unchanged. Preserve these marks in the saved CP snapshot;
old snapshots missing the lines require the user's explicit Update from CP.
Construction annotations in the separate aux collection remain guides.

## Affected Areas

- Fold region capture and CP import adapter/persistence.
- Engine import of non-topological flat precreases.
- Existing-crease and line-reference picking of crease marks.

## Checklist

- [x] Preserve cyan lines through region capture, import, and saved replay.
- [x] Cover full, partial, crossing and duplicate lines without changing folded geometry/order.
- [x] Make visible crease-mark stretches selectable in both panes.
- [x] Rebuild Fold WASM and run focused engine, bridge, and web validation.
- [x] Document how to refresh an existing Collapse step.

## Result and validation

Region captures now use `scopedLineIds`, including cyan lines. The Fold adapter
keeps cyan/F lines in `cpJson` and imports them as crease marks. Marks are clipped
to the sheet, deduplicated, merged after export fragmentation, and removed where
an active crease or border already owns that stretch. They do not split faces
or participate in layer completion. Their import provenance is existing paper
(`made_at: 0`), so Collapse does not draw them as new M/V instructions. Cyan/F
has no remembered direction; the engine uses Valley as a memory convention,
while subsequent M/V tools explicitly choose their own direction.

Picking indexes each mark's visible stretch in Fold and each carrying face's
stretch in the CP pane. Existing-crease M/V operations save its sheet endpoints,
and line-location axioms use the same anchors. Physical-edge-only swivel reach
continues to query actual edges; marks use the normal Locate line path.

- `cargo test -p oristudio-fold -p oristudio-fold-wasm`: 469 passed.
- Full import suite rerun after the provenance adjustment: 16 passed.
- Fresh Fold WASM build; 10 web suites, 59 tests passed. Coverage includes native
  sequence save/open, fresh-engine replay, CP and folded rendering, both-pane
  picking, M/V refolding, linked-region export/update, and swivel reach.
- TypeScript, targeted ESLint, Rust formatting and targeted Clippy passed.
  Clippy retains the pre-existing unknown `chunks_exact_to_as_chunks` lint warning.
- `git diff --check` passed. Broader workspace/oracle tests were not run: no
  ported solver, CP-kernel semantics or unrelated crates changed.

The current local build is served at `http://localhost:5328/fold`; 5327 still
serves the previous worktree. For a saved Collapse that already lost these lines,
open its source project and explicitly choose **Update from CP** on that step,
then save. No source files or user models were modified automatically. Old
snapshots cannot recover the omitted geometry without their source CP.
