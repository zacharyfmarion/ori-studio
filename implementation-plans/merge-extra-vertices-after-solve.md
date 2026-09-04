# Merge extra vertices after an accepted solve

## Goal

When a solve is accepted, the degree-2 vertices that only exist because
detection split every crease at every junction should go away by themselves,
the way Mod+Shift+V (Delete Extra Vertices) removes them by hand — but only
among the creases the solve produced, never the user's other work in the same
document.

Two places accept a solve:

- the detect dialog's **Add** (`add`, `addImproved`, `addPartial`), which
  imports the solved FOLD beside the existing pattern;
- a suppression region's **Accept**, which retires the region after the solve
  wrote its coordinates (and writes a timed-out solve's partial first).

## Approach

**Kernel.** `del_v_all` already exists as the port of Oriedita's whole-document
sweep. Add `del_v_among_lines(model, line_indices)`: the same sweep, walking
the same vertex index in the same order, with one restriction — a vertex merges
only when *both* creases meeting there are in the set, and the merged crease
joins the set so a chain of collinear pieces still collapses to one. A vertex
where an in-set crease meets a crease outside the set is left alone: that is
the boundary with the user's own creases. `del_v_all` itself is untouched.

Expose it as `OperationId::DeleteExtraVerticesAmong`, an Ori Studio-original
operation taking `line_ids` (the one-based ids every other line command uses).
No menu, tool, or shortcut: it is reached only from the two accept paths.

**Import (add).** The runtime already knows which lines the import added: on a
non-blank target they are exactly the lines past the pre-merge count, and on a
blank target every line. So `importAddOristudioCpDocumentFromText` takes a
`mergeExtraVertices` flag and, when set, runs the scoped sweep over those ids
before returning — inside the same history entry, so one undo takes the whole
add back. The dialog sets the flag for the three solver-output modes and not
for Review & Fix or Add as-is, which add the raw detection.

**Region accept.** `onAccept` runs the sweep over the region's owned creases
(the ones wholly inside its box, re-read from the document at that moment)
after the partial write and before the region and its image are removed. It is
its own history entry, in keeping with the existing rule that accepting a
partial writes first so an undo walks back through the coordinates.

## Affected Areas

- `crates/oristudio-cp/src/operations/arrangement.rs` — `del_v_among_lines`,
  the sweep generalised over an optional scope mask.
- `crates/oristudio-cp/src/lib.rs` — `OperationId::DeleteExtraVerticesAmong`,
  its descriptor and execute arm.
- `crates/oristudio-cp/tests/operations.rs` — scoped sweep tests.
- `apps/web/src/lib/oristudioCpCommands.ts` (+ action / input-model
  registries) — the operation id, registered without a UI placement.
- `apps/web/src/store/workspaceStore/oristudioCpRuntime.ts`,
  `types.ts`, `slices/projectSlice.ts` — `mergeExtraVertices` on import (add).
- `apps/web/src/components/CpDetectImportModal.tsx` — sets the flag per mode.
- `apps/web/src/cp-workspace/regions/useCpRegionSolve.ts` — the sweep on
  Accept.
- Tests beside each of the above.

## Checklist

- [x] Kernel: `del_v_among_lines` with tests (in-set pair merges; out-of-set
      pair untouched; boundary pair untouched; in-set chain collapses).
- [x] Kernel: `DeleteExtraVerticesAmong` operation, descriptor, command test.
- [x] Web registries accept the new id; existing registry tests green.
- [x] Import (add): `mergeExtraVertices` runs the sweep over the added lines
      inside the same history entry; runtime tests for blank and non-blank
      targets and for the flag being off.
- [x] Detect dialog: flag set for `add` / `addImproved` / `addPartial` only.
- [x] Region Accept: sweep over the owned creases, after the partial write,
      before the region goes; hook tests.
- [x] wasm rebuilt; verified in the browser through the real kernel: a flagged
      import merged three collinear pieces into one crease in one history
      entry, and the scoped command merged only the listed creases.
