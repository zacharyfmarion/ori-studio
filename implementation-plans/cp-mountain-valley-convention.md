# CP Mountain/Valley Convention

## Goal

A `.cp` file exported from Oriedita (or ORIPA, or Box Pleating Studio, or any
other tool that speaks the format) must import into Ori Studio with its
mountains as mountains and its valleys as valleys.

Reported as: *"When I export a .cp file from Oriedita and then import-add it
into Ori Studio, the mountains and valleys are flipped."*

## Approach

The `.cp` line-type codes are ORIPA's, and Oriedita reads them through the
`io.github.oriedita:fold` library's `CreasePatternReader`:

| `.cp` code | `FoldEdgeAssignment` | Oriedita `LineColor` |
| --- | --- | --- |
| 1 | `BORDER` | `BLACK_0` |
| 2 | `MOUNTAIN_FOLD` | `RED_1` |
| 3 | `VALLEY_FOLD` | `BLUE_2` |
| 4 | `FLAT_FOLD` | `CYAN_3` |

`crates/oristudio-cp/src/io/cp.rs` had 2 → `Blue2` and 3 → `Red1`, and its
exporter had the matching inverse. Ori Studio therefore round-tripped its own
`.cp` files consistently and disagreed with every other tool in the ecosystem —
which is why this survived: only a cross-tool exchange reveals it.

The bug is in the shared codec, so it is not specific to Import (Add): File ▸
Open of a `.cp`, drag-and-drop, and Export CP were all affected the same way.

Fix the codec at the source and delete the compensating shim that was added
downstream of it:

- Correct `import_cp_str` / `export_cp_string` to the upstream mapping.
- Pin the behaviour with a real oracle test that runs Oriedita's own
  `CpImporter`, not just a hand-written table (a hand-written table is what
  encoded the bug in the first place).
- Delete `apps/web/src/lib/bpCreaseConvention.ts`. Box Pleating Studio is
  explicitly ORIPA-conventioned upstream (`shared/types/cp.ts`: "This follows
  ORIPA's format", Mountain = 2, Valley = 3) and our `oristudio-bp` port writes
  `crease_type as i32` faithfully. The 2↔3 swap on the Send-to-Edit hand-off was
  cancelling the kernel bug, so with the kernel fixed it becomes the bug.

`apps/web/src/lib/creasePatternImport.ts` (the read-only viewer path) already
used the correct mapping, so the two `.cp` readers in the repo disagreed with
each other; after this change they agree.

### Compatibility

A `.cp` has no version marker, so a `.cp` **exported by a previous Ori Studio
build** will now import with its mountains and valleys swapped — it was written
in the flipped convention. This is the correct trade: the format's convention is
set by every other tool that reads it, and `.osf`, `.ori`, and FOLD (the formats
Ori Studio saves to by default) were never affected. Affected users can flip a
selection with the existing Change M/V tool.

## Affected Areas

- `crates/oristudio-cp/src/io/cp.rs` — the codec.
- `crates/oristudio-cp/tests/io.rs` — the unit test that asserted the flip.
- `crates/oristudio-cp/tests/oriedita_io_oracle.rs` — new parity test.
- `tools/oriedita-oracle/src/OrieditaNativeIoOracle.java` — `cp-import-summary`.
- `tools/oriedita-oracle/README.md` — document the new command.
- `apps/web/src/lib/bpCreaseConvention.ts` — deleted.
- `apps/web/src/designKinds/boxPleat.ts`, `treemaker.ts` — shim call and the
  comments that referenced it.
- `apps/web/src/designKinds/codec.test.ts` — the test that asserted the swap.

`PORTING.md` is untouched on purpose: its Oriedita section catalogues
*deliberate* divergences, and this was an unintended one. The new oracle command
is documented in `tools/oriedita-oracle/README.md` instead.

## Checklist

- [x] Reproduce against Oriedita's real `CpImporter` via the native IO oracle
- [x] Add `cp-import-summary` to the Oriedita native IO oracle
- [x] Fix `import_cp_str` / `export_cp_string`
- [x] Correct the unit test that encoded the flipped mapping
- [x] Add the Oriedita CP-import parity test
- [x] Delete the Box Pleating Studio 2↔3 compensation shim
- [x] Update stale comments in the design-kind Send-to-Edit paths
- [x] Document the new oracle command in `tools/oriedita-oracle/README.md`
- [x] Validate: cargo fmt/clippy/test, Oriedita IO oracle, web lint/typecheck/test
- [x] Verify Import (Add) of an Oriedita `.cp` in the browser
- [x] Open draft PR
