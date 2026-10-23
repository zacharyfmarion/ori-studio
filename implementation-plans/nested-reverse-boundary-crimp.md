# Nested reverse packets and boundary-meeting crimps

## Goal

Resolve confirmed Fold priorities F030 (Dove nested reverse) and F039 (Squirrel boundary-meeting crimp) through the existing tools. Pause new diagram authoring. Keep all operations flat, single sheet and local; preserve user models and current unrelated changes.

## Approach

Identify selected nested openings with a common spine using actual moving-side overlap and order. Couple the corresponding halves explicitly while preserving opposite-half order and each opening's own body contacts. Keep per-flap report blocks and saved opening witnesses stable. Do not relax the layer solver or geometric/contact checks.

Permit crimp lines to meet at an exact boundary endpoint when all other contact with the first hinge lies strictly on the same side of the second. Continue rejecting interior crossings, coincident lines and near misses; retain both scoring and final validity gates.

Use saved source prefixes and independently checked CP controls as regressions. Exercise the public bridge, saved choices and replay, plus negative cases. Rebuild Fold WASM and verify in the existing local Fold workspace. Only migrate existing examples when the direct operation matches the checked material and ordering; retain checkpoints and hash guards.

The compound operations are original Ori Studio behavior, not an upstream port. The Flat-Folder search and its constraint semantics remain untouched. Existing tool action analytics already cover their use; no new UI action is introduced.

## Affected Areas

- `crates/oristudio-fold/src/compound/{reverse,crimp,pieces,mod}.rs`
- Fold native/bridge and web integration regressions; source-prefix fixtures
- Campaign examples, evidence and progress ledger

## Checklist

- [x] Inspect source, existing edits, confirmed reports and CP controls.
- [x] Add regressions that fail on Dove and Squirrel inputs before changes.
- [x] Implement nested packet order with pocket constraints preserved.
- [x] Implement exact boundary-endpoint crimp support and negative cases.
- [x] Run focused engine/bridge and full affected engine tests; rebuild WASM.
- [x] Verify public tool parity, persisted replay and browser results.
- [x] Preserve or migrate existing native examples and update findings.
- [x] Run final diff/format validation and report local testing links.

Validation and handoff: [implementation report](../research/origami-me-flat-catalog/batches/direct-compound-priorities-2026-10-14.md). F030/F039 are resolved locally; new diagram authoring remains paused.
