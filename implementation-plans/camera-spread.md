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
  in Diagram mode uses the original flat drawing exactly; 3D cameras can orbit
  the flattened paper. Compare with existing depth/affine modes.
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
- [x] Document findings and the default-spread integration path; open draft PR.
- [x] Lock camera visibility to diagram layer ordering, including woven patches and hidden ink.
- [x] Add the supplied CP example without changing its source or committing private data.
- [x] Validate the clipping regression, underside ordering, woven regions and live explorer.
- [x] Reduce within-face bending and validate LDM auxiliary-line straightness.
- [x] Add free orbit on the 3D preview, keeping camera controls and saved poses synchronized.
- [x] Validate pole crossing, pointer cleanup, layer ordering and the live LDM interaction.
- [x] Extend amount to 50%, expose actual depth span and evaluate all 33 examples.
- [x] Explain model-dependent opening using local stack-depth measurements.
- [x] Restrict strict flat ordering to Diagram; validate geometric 3D occlusion on the reported frog angle.

## Result and remaining product work

32/32 sampled corpus folds succeeded; 86 targeted geometry/style tests, web
lint and web typecheck passed. The interactive explorer is running on port 5281.
The experiment found withheld layer-order failures in every sampled lift and
unacceptable worst-edge strain on complex models. Production default integration
is intentionally deferred pending a feasible contact/strain solve and user
visual acceptance; this research branch does not claim to complete that feature.
The concrete follow-on design is in `research/2026-10-21-camera-spread.md`.

Draft PR: https://github.com/zacharyfmarion/ori-studio/pull/490

Clipping follow-up: the explorer defaults to layer-ordered visibility, carries
local woven patches and auxiliary ink, and reverses stacks for underside views.
Raw geometric depth remains an explicit diagnostic. The additional CP folds to
151 faces without repairing the source; all 33 examples produce finite front/back
paint geometry. There are now 89 focused tests. Physical strain/contact validity
and newly exposed buried woven ordering remain research limits, described in the
research note; this does not change the production spread default.

Bending follow-up: a per-face affine-plane penalty keeps panels nearly planar
while allowing tilt and retaining shared paper vertices. At the same 6% amount,
LDM's worst sampled auxiliary-line bow falls about 95%, and its worst mesh-edge
stretch falls from 216.75% to 0.59%. All 33 examples still produce finite paint
geometry; 81 focused geometry tests, web lint and typecheck pass. The unchanged
style/native/production surfaces were not revalidated for this solver-only change.

Orbit follow-up: both 3D modes accept a primary-pointer drag with continuous
rotation through the poles. Camera angles and saved roll stay synchronized, with
a shared CPU/GPU transform and no geometry recomputation. Zero-depth 3D paper
remains orbitable; Diagram's exact zero path remains intact. All 102 focused
geometry, pointer and style tests, web lint and typecheck pass. Browser checks
cover the supplied LDM example; native/oracle/production checks remain outside
this local preview change.

Amount/visibility follow-up: the range now reaches 50%, with an actual depth-span
readout and unchanged stiffness. All 33 examples pass finite/height/depth-range
checks at the maximum. Local overlap measurements explain why the supplied CP
opens less than the frog despite similar overall depth. Strict flat-order slots
were invalid for arbitrary 3D overlaps: they now apply only in Diagram. The 3D
policy uses geometric depth and bounded layer tie correction, with a matching
BSP vector path. This fixes the oblique forced-order artifact, while physical
mesh crossings remain a documented limitation. All 103 focused tests, web lint
and typecheck pass; native/oracle/production checks remain out of scope.
