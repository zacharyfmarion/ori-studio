# Swivel choices around existing flaps

## Goal

Offer the valid above/behind orders when a swivel overlaps an already folded
flap. Preserve the stationary paper's order and the selected swivel's crease
directions. The existing layer chooser should handle these choices.

## Approach

The open swivel currently seeds every moving wedge above every stationary face
for a valley (below for a mountain). This makes an unrelated stationary flap an
implicit placement target. Scope those direction constraints to the stationary
body at the swivel's own hinges, then let the existing validated completion
pipeline resolve the remaining pairs. Keep carried stationary orders, material
continuity, collision checks, and open/inside semantics intact.

Use synthetic regression cases. Replay the supplied local model read-only as
an additional check; do not add it to the repository or overwrite it. Check that
the saved witness replays and that the existing chooser receives the ambiguity.

## Affected Areas

- `crates/oristudio-fold/src/compound/swivel_on_edge.rs`
- Fold engine and bridge regression tests for paired swivels.
- Existing layer-order resolver integration tests, if needed.

## Checklist

- [x] Reproduce the missing choice and compare operation and CP completions.
- [x] Scope swivel placement constraints and validate all resulting orders.
- [x] Cover stationary stacks, crease directions, and witness replay.
- [x] Rebuild Fold WASM and verify the actual tool/chooser flow.
- [x] Record the cause, fix, and compatibility implications.

## Results

- The defect was the Fold operation's placement seeds, not the shared chooser
  or Flat-Folder search. Swivels now seed each moving wedge against the
  stationary part of its own material layer. Flat-connected precrease pieces
  are included, so adding a precrease does not change the order choices.
- The supplied seven-step local model's matching swivel changes from one
  forced order to eight valid orders. Solving its complete CP allows twelve;
  the operation additionally preserves the stationary paper's existing order.
- Synthetic paired-kite tests verify every offered state, crease directions,
  identical geometry, stationary pair preservation, both viewing sides, and
  serialized witness replay. Existing precrease tests compare all material
  stacks across all candidates, independently of face subdivision.
- The real WASM canvas-tool test locates a matching swivel, requires order
  resolution, refuses generic commit, cycles previews without saving, accepts
  explicitly, and reopens the committed sequence in a fresh engine.
- Engine behavior version bumped to 3. Existing steps with explicit witnesses
  retain them. A previously implicit order can now require a witness; replay
  deliberately refuses to invent one. For the supplied file, a separate local
  copy records the first swivel's candidate whose fingerprint exactly matches
  the saved expectation. All seven saved results are unchanged. The original
  file is untouched, and no private model was added to the repository.
- No general legacy replay fallback, new UI controls, relaxed geometry guards,
  or solver algorithm changes were introduced.

## Validation

- `cargo test -p oristudio-fold`: 336 passed, 11 pre-existing ignored campaign
  tests; `cargo test -p oristudio-fold-wasm`: 89 passed.
- Rebuilt the Fold WASM bridge. Fold and Fold-component web suite: 155 files,
  1,160 tests passed. Node's experimental global web storage was disabled for
  this run so jsdom supplies the tests' `localStorage`.
- Web typecheck, lint, Rust formatting, targeted clippy, production web build
  and landing prerender passed. Existing warnings: TanStack React-compiler
  compatibility, the toolchain's unknown clippy lint, and bundle chunk sizes.
- Fresh replay of the updated local file matches all seven saved fingerprints;
  all eight matching-swivel candidates land through the production bridge.
- Browser file-picker automation did not open the local file in the separate
  test tab. The actual canvas hooks and commit/acceptance flow were verified
  through the real WASM integration test; no visual browser verification is
  claimed for this fix. The temporary tab was closed.
- No full unrelated Rust-workspace/oracle run or Tauri launch: changes concern
  the original Fold operation's placement seeds, with no ported solver or
  desktop-specific changes. No commits, pushes, or PRs.
