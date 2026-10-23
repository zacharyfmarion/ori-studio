# Rabbit-ear hinge regions and existing precreases

## Goal

After picking three triangle corners, pick the region containing the hinge
(fourth) crease. Remove the separate fourth-crease chooser. Support compatible
precreases in the selected triangle, including the Whale source-5 reproduction.
Keep the work local and flat, with no cuts, multi-sheet assembly, or PR.

## Approach

- Resolve the unique Kawasaki ray in the picked region, then determine a valid
  stationary anchor automatically. Never silently substitute another region.
  Save the resolved public operation so replay retains the exact fold choices.
- Treat coplanar subdivisions of a triangular layer as one layer. Score its fan
  while retaining existing vertices, crease history, material ancestry, and
  flat subdivisions. Keep the existing motion, residual, and layer-order gates.
- Preserve existing research files and user branches. Migrate saved operations
  only if the persisted schema changes; validate every affected file freshly.
- Exercise valley/mountain and selected-layer behavior, actual saved preparation
  states, refusals for incompatible material, and the complete UI pick flow.

## Affected Areas

- `crates/oristudio-fold/src/compound/`: rabbit ear, fan scoring and layer grouping.
- `apps/web/src/fold/tools/vertex/` and `canvas/vertex/`: region selection,
  preview, hints, and controls; shared web/desktop behavior.
- Fold regression fixtures, research evidence, local native model validation.

## Checklist

- [x] Inspect checkout, existing engine/UI workflow, and recorded failures.
- [x] Add precreased triangular-layer support and focused engine regressions.
- [x] Replace stayer selection with hinge-region selection and remove its chooser.
- [x] Add UI/bridge regressions and update authored instructions.
- [x] Rebuild Fold WASM and verify the actual Fold workspace interaction.
- [x] Replay saved models, migrate if necessary, and update F012 evidence.
- [x] Complete appropriate Rust/web checks and local handoff.

## Validation and handoff

See [local implementation report](../research/origami-me-flat-catalog/batches/rabbit-ear-precreases-2026-10-14.md) for engine, bridge, web, browser and saved-file checks. Both Whale ears and the recorded Dolphin ear succeed; unchanged native models replay with no hash mismatches. No migration was needed because the resolved operation schema remains unchanged. Tool adoption and commits continue through existing Fold analytics; there is no new user-facing command requiring a separate event. Work remains local on `codex/fold-origami-trials`.
