# Camera spread visibility for unrelated surfaces

## Goal

Protect solved stacks while resolving newly overlapping, unrelated surfaces by
geometric depth at the overlap. Show 70 matched before/after comparisons: seven
camera/settings combinations on ten private corpus/example models.

## Approach

- Capture the current committed renderer before modifying its visibility.
- Cache the transitive stack relation, retaining the existing local woven patch
  plans. Never turn arbitrary topological tie breaks into over/under constraints.
- Mask a surface or its ink only where an authoritative covering surface in the
  same local-facing group projects over it. Reverse constraints for back-facing
  groups; resolve all remaining fragments with the actual depth buffer/BSP.
- Use projected-triangle spatial bins for GPU coverage queries, cached topology
  and reusable textures. Keep the lift, stiffness and corpus fold solutions fixed.
- Apply the same rule to the vector research path and test geometry, hidden ink,
  symmetry, crossing depths, transitive protection, local reversal and weaving.
- Generate an interactive gallery with matching framing and settings, plus
  inspectable images and timings. Private geometry/images stay ignored/local.

## Affected Areas

- Shared experimental camera visibility and vector masking modules.
- Local WebGL camera renderer and reusable visibility buffers.
- Camera spread capture/gallery tooling and ignored comparison artifacts.

## Checklist

- [x] Capture 70 baseline renders and record revision/settings.
- [x] Implement cached partial relationships and per-overlap GPU/CPU masking.
- [x] Add focused regressions and pass lint, typecheck and relevant tests.
- [x] Capture 70 updated renders; inspect all comparisons and record limitations.
- [x] Display the gallery and representative comparisons; update draft PR.

## Validation and limits

- 100 focused unit tests, 32 actual WebGL pixel cases, web lint and TypeScript
  pass. Pixel tests include ID permutations, depth crossings, hidden auxiliary
  ink, forward/reversed protection and nonzero panning in all camera modes.
- All 33 prepared examples have finite geometry/planes and zero missing forward
  or reverse stack relationships. Relationship preparation is cached; the largest
  4,722-face example used 22.3 MB and about 866 ms for that one-time matrix build.
- The gallery contains all 70 pairs, captured before changing the renderer and
  after the fix. Every pair uses identical mesh/camera/amount/framing. Stroke
  slope, raster depth bias and supersampling also correct ink disappearance, so
  line antialiasing can differ even in the zero-depth controls.
- Inspected all ten seven-view contact sheets and the reported crane detail.
  The left flap is restored, and the opposite-direction comparison behaves
  consistently. Existing large-amount strain, intersections and newly exposed
  buried woven ordering remain limitations of the fitted mesh/flat patch plan.
- Measured CPU draw submission in the capture run: median 0.84 ms, maximum
  11.89 ms. These are not GPU completion times or an interactive FPS guarantee.
- Rust/oracle, native shell and production build checks are unnecessary here:
  no upstream solver, WASM, native behavior, production entry or route changed.
