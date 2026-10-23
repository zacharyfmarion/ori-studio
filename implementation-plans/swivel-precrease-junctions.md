# Swivels at precrease junctions

## Goal

Let a swivel meet a folded edge at an existing flat-precrease junction without
changing its geometry or selecting a different angle bisector.

## Approach

First reproduce the failure on the existing public kite-base swivel cases.
Treat coplanar faces joined by flat creases as material layers when locating
the hinge intersection, tracing rays and identifying moving wedges. Reuse
existing crease segments while retaining near-miss and attachment guards.
Keep private diagram geometry out of the tests and implementation notes.

## Affected Areas

- Original Fold engine swivel-on-edge resolution and compilation.
- Synthetic swivel integration tests and the local Fold WASM build.

## Checklist

- [x] Reproduce the junction failure independently.
- [x] Resolve junctions and ray starts over flat subdivisions.
- [x] Verify geometry, material order, replay and unsafe refusals.
- [x] Run relevant engine checks and rebuild the local bridge.
- [x] Reassess the private authoring operation with the corrected primitive.

## Result and validation

The hinge intersection can use an exact interior subdivision vertex while
retaining the minimum-feature exclusion near vertices and the physical run's
ends. Ray starts and wedge witnesses resolve over connected flat subdivisions;
rays continue through internal precrease vertices and reuse existing crease
segments as moving-block boundaries. Folded attachments remain boundaries.

The independent kite-base reproducer failed with `swivel_misses_fold` before
the fix. Regression coverage compares 361 material positions and full layer
stacks per case, including both sides, turned paper, exact ray reuse, an inside
swivel, and stored-choice replay. Existing refusal and seeded-campaign tests
continue to pass.

- 443 Fold engine and bridge tests pass; 11 existing extended tests stay ignored.
- Scoped Clippy, formatting and diff checks pass. Clippy reports the existing
  workspace configuration's unknown-lint warning on this installed toolchain.
- Fold WASM rebuilt, and native sequences freshly replayed and opened in Fold.
- No web source, wire format or vendored algorithm changed. Full unrelated
  workspace, web and upstream-oracle suites were not repeated.

The private authoring operation still needs its compound moving-layer
construction established. Its remaining refusal is not evidence that this
fix completes that operation, nor grounds to relax the angle guard.
