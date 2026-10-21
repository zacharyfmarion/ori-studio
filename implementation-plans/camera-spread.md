# Camera-based diagram distortion

## Goal

Research and prototype connected layer lifting followed by camera projection,
using the external Cpoogle ground-truth corpus. Provide an interactive comparison
for Zach to validate before making this the default diagram spread.

## Approach

- Keep Oriedita's fold and layer solution unchanged. This is original presentation
  geometry downstream of the kernel, not a replacement folding algorithm.
- Build a shared-vertex mesh from paper identities, with interior degrees of
  freedom for bending. Fit small heights to the existing layer stacks, enforce
  sampled separation constraints, and cache topology and the unit-height solve.
- Project the lifted mesh from a continuous direction and inclination. Amount zero
  uses the original flat drawing exactly. Compare with existing depth/affine modes.
- Recompute ordering using the existing BSP renderer, including line splitting.
  Distinguish correct visibility from a physically valid, intersection-free lift.
- Use a local-only explorer and generated artifacts. Never commit corpus files.
- Record solver residuals, edge strain, timings, refusals and coverage. Recommend
  default integration only to the extent supported by visual and numeric evidence.

## Affected Areas

- `apps/web/src/cp-workspace/folded/`: reusable experimental lift and projection.
- `scripts/camera-spread/`: corpus preparation, evaluation and interactive explorer.
- `research/`: sources, findings, limitations and production integration design.
- Ignored `artifacts/camera-spread/`: private folded scenes, reports and screenshots.

## Checklist

- [x] Inspect current spread pipeline, shared mesh renderer and corpus.
- [x] Research lifting, constraint solves, cameras and visibility.
- [x] Implement and test connected lifting and arbitrary projection.
- [x] Fold a varied corpus sample with recorded failures and time limits.
- [x] Build interactive comparison with direction, amount and view controls.
- [x] Evaluate continuity, separation, strain, zero amount and responsiveness.
- [x] Inspect the explorer in a real browser and leave it running.
- [ ] Document findings and the default-spread integration path; open draft PR.

## Result and remaining product work

32/32 sampled corpus folds succeeded; 86 targeted geometry/style tests, web
lint and web typecheck passed. The interactive explorer is running on port 5281.
The experiment found withheld layer-order failures in every sampled lift and
unacceptable worst-edge strain on complex models. Production default integration
is intentionally deferred pending a feasible contact/strain solve and user
visual acceptance; this research branch does not claim to complete that feature.
The concrete follow-on design is in `research/2026-10-21-camera-spread.md`.
