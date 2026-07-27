# FOLD Per-Edge Array Integrity

## Goal

Stop crease types from silently scrambling when a FOLD document's edge list is
rebuilt. A crease pattern exported from the selection popover came back with
129 of its 228 creases mistyped — paper borders arriving as mountains and
valleys — while `File → Export FOLD` of the same document was correct.

The same defect, by the same mechanism, was already fixed once in `e0d7d6cf`
(2026-07-24) for `buildSegmentFold`. It recurred three days later through
`inferTopology`. This plan addresses the class rather than patching a third
instance later.

## Approach

Two independent structural problems produced one bug, so both get addressed.

**1. A trust boundary with no validation (kernel).** `edges_assignment` (FOLD
standard) and `oristudio:edges_line_colors` (our extension) both encode crease
type, and the importer trusted the extension unconditionally. When they
disagreed — 129 of 228 edges in the reported file — the wrong one silently won.

The redundancy is load-bearing and cannot simply be removed: the eight
auxiliary colours all map to `Flat`, so `edges_assignment` alone cannot
round-trip them. The *silence* is not load-bearing. Use the extension colour
only when it agrees with `edges_assignment`, and fall back to the
assignment-derived colour when it does not. This keeps auxiliary colours
everywhere they are valid, and makes a stale array unable to win.

Only cross-check when `edges_assignment` actually has an entry for that edge:
`assignment_for_edge` returns `Unassigned` for a missing or short array, so an
unconditional check would discard every colour in a file that carries only the
extension.

No parity constraint applies — `oristudio:edges_line_colors` is an Ori Studio
extension and does not appear in vendored Oriedita, which has no such key to
disagree with. A file Oriedita could produce carries no `oristudio:` key, so it
takes no new code path.

**2. An open-ended invariant nothing enforces (web).** A FOLD document keeps
several arrays indexed by edge, and the namespaced extension set is open-ended.
The idiom used at every rebuild site — `{ ...fold, edges_vertices: rebuilt }` —
makes *carrying stale data* the default and *remapping* the thing an author has
to remember, for a set of keys TypeScript cannot see behind an index signature.

Give the invariant one owner: a module whose two functions are the only
sanctioned ways to change an edge list, so keeping the arrays in step happens by
construction instead of by memory. A length check is not sufficient — the
reported bug kept 228 edges and changed only their order.

## Affected Areas

- `crates/oristudio-cp/src/io/fold.rs` — importer cross-check
- `apps/web/src/lib/foldEdgeArrays.ts` — new module owning the invariant
- `apps/web/src/lib/creasePatternImport.ts` — `inferTopology` rebuild
- `apps/web/src/lib/creasePatternSegmentation.ts` — `buildSegmentFold` rebuild
- `apps/web/src/lib/foldedExport.ts` — `foldedFoldDocument`, latent third site
- `apps/web/src/generated/oristudio-cp-wasm/**` — tracked bridge, must be
  rebuilt or the kernel change never reaches the app or CI

## Checklist

- [x] Reproduce the reported file byte-for-byte and identify the mechanism
- [x] Fix `inferTopology` to carry source-edge provenance through the rebuild
- [x] Confirm `oristudio:edges_line_colors` carries no Oriedita parity constraint
- [x] Kernel: use the extension colour only when it agrees with `edges_assignment`
- [x] Kernel: Rust tests for agreeing, conflicting, and assignment-absent inputs
- [x] Web: add `foldEdgeArrays.ts` owning remap-and-drop for per-edge arrays
- [x] Web: adopt it in `buildSegmentFold`, `inferTopology`, `foldedFoldDocument`
- [x] Web: regression test for the latent folded-export site
- [x] Rebuild and commit the tracked `oristudio-cp-wasm` bridge
- [x] Validate: cargo fmt/clippy/test, web lint/typecheck/test
- [ ] Open draft PR against `main` and drive it to green CI
