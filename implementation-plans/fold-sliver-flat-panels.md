# Sliver checks across flat precreases

## Goal

Keep a valid fold from being refused solely because a flat precrease subdivides
one of its overlapping panels. Preserve the minimum-feature guard at actual
paper and folded boundaries, and preserve all existing saved states.

## Approach

The current image guard measures every moving/stationary face pair separately.
A small overlap with one subdivision can be part of a substantial overlap with
the same connected, flat panel. On a potential sliver, collect faces joined by
flat creases that undergo the same motion. Use the exact boundary of that panel
when it is convex, then apply the existing penetration and thin-piece tests.
Do not take the convex hull of a concave panel or join disconnected coincident
paper. Concave components retain the conservative face-level check for now.

Share the calculation between ordinary folds and compound placements. Only
guard admission changes: no geometry, layer ordering, tolerance, or saved recipe
is changed. No upstream solver behavior changes.

## Affected Areas

- Fold and compound landing image guards in `crates/oristudio-fold`.
- Shared internal panel-boundary helper and synthetic regression tests.
- Local private diagram checkpoint and replay evidence (ignored).

## Checklist

- [x] Reproduce the same fold with and without flat subdivisions.
- [x] Add public synthetic moving/stationary subdivision regressions.
- [x] Share exact convex-panel guard logic; preserve genuine sliver refusals.
- [x] Test both directions, compound placement, concave and motion boundaries.
- [x] Rebuild WASM and verify the private fold through public operations.
- [x] Fresh replay and open the new native checkpoint in Fold.
- [x] Record progress and remaining diagram work privately.


## Validation and limits

Implemented in the shared internal `flat_panels` helper, used lazily only when
a face pair would otherwise fail the sliver guard. It joins actual flat
adjacency with identical motion, walks the exact boundary, and rejects concave,
multiple-loop or non-simple boundaries from the panel optimization. It never
changes the crease graph, face IDs, geometry, order, or numeric thresholds.
Engine behavior version is 7 to invalidate stale replay caches.

- The synthetic strip regression fails before the change and passes after it.
- 466 Fold engine/bridge tests passed; one additional genuine-insertion-sliver
  regression subsequently passed with the other three integration cases.
- 15 focused web WASM/session/import tests pass; Fold WASM rebuilt.
- Formatting, targeted Clippy and diff checks pass; Clippy has the existing
  unknown configured-lint warning.
- Workspace tests stop at the two previously failing `fold_vertex_oracle`
  uniqueness assertions (six orders rather than one), unrelated to this guard.
- Private continuation freshly replays all 50 states twice, preserves its old
  42-node prefix, and opens in Fold. Private model/evidence remain ignored.

Remaining limitation: concave flat components still use the conservative
face-pair test. This patch does not approximate their union by a convex hull.
