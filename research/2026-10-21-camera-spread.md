# Camera-based diagram distortion: research and corpus experiment

2026-10-21. Implemented on `codex/camera-spread`. This is a research prototype
for visual validation, not an approved replacement for the default spread.

## Finding

A connected 3D presentation mesh and arbitrary camera are practical. The existing
Oriedita paper scene already provides the essential information: original paper
vertex identities, folded face outlines, paper-side orientation, and local layer
stacks. These should remain the canonical folding result.

A height fit alone is **not sufficient for a safe default**. In the experiment,
all 32 sampled patterns folded and lifted, but every lifted model had some layer
order inversions at withheld samples. Shared vertices prevent cracks; they do
not ensure nonintersection, rigid faces, or small stretch. A correct depth buffer
then renders those incorrect intersections faithfully. Do not confuse a better
visibility algorithm with a valid deformation.

The reference screenshot establishes a useful interface and visual target. It
does not establish the implementation behind it; no claim is made that this
prototype reproduces that application's algorithm.

## Sources and their implications

- Bouaziz et al., [Projective Dynamics](https://users.cs.utah.edu/~ladislav/bouaziz14projective/bouaziz14projective.html)
  (2014): separate local constraint projections from a global solve with a fixed
  matrix. This motivates caching the matrix structure/preconditioner when topology
  and weights stay fixed. The prototype is a static scalar least-squares fit
  using this pattern, not an implementation of their physical integrator.
- Macklin et al., [XPBD](https://matthias-research.github.io/pages/publications/XPBD.pdf)
  (2016): explicit compliance addresses iteration/time-step dependent stiffness.
  Appropriate for a nonlinear interactive refinement with membrane and hinge
  constraints; an arbitrary number of ordinary PBD iterations is a poor contract
  for persistent diagram settings.
- Li et al., [Codimensional Incremental Potential Contact](https://arxiv.org/abs/2012.04457)
  (2020): thin-structure contact, thickness offsets, strain limiting and continuous
  collision detection are separate requirements. This is a strong reference for
  the production collision/strain stage, not evidence that our lift has those
  guarantees. Starting from a fully coincident flat stack requires a feasible
  initialization; applying a positive-distance barrier directly is unsuitable.
- [Origami Simulator](https://origamisimulator.org/) describes a displacement-based
  simulation of crease forces starting from a flat sheet. Ori Studio already has
  its port. Reusing its rendering infrastructure makes sense; solving all creases
  again under that simulator does not automatically reproduce the chosen flat
  layer solution or the intended diagram pose.
- Local references read: `third_party/step-folder/src/distortionfolder/distortion.js`
  for the existing affine alternative; the Oriedita paper-scene contract and
  `PORTING.md`; `packages/origami-simulator/src/bsp.ts` for split-based vector
  ordering. This work changes no upstream port or vendored code.

## What the prototype actually solves

1. Normalize the folded coordinates by the model's longest extent. Weld by
   **paper vertex ID**, never by coincident folded coordinates.
2. Triangulate each face, add a centre inside each triangle and connect it to the
   corners. The centres provide a limited bending space. No artificial interior
   edges are inked unless the mesh overlay is requested.
3. Obtain face-level targets from the existing longest-chain layer levels. These
   are an initial preference, not proof of a global ordering: cyclic local stacks
   need spatially varying heights.
4. Fit vertex/interior heights with target, smoothness and overlap rows. At each
   triangulated overlap-cell centroid, barycentric interpolation gives a sparse
   row `r` for upper height minus lower height. Its preferred minimum is
   `g = 0.35 / max(1, deepest_level)`.
5. Fit one freely tilting affine height plane per face, with three auxiliary
   unknowns (offset and two slopes in a centered, radius-normalized frame). Add
   `100 * sum((h_vertex - plane_face(vertex))^2)` over that face's mesh vertices,
   alongside target/smoothness energies and
   `30 * sum(max(0, g - r*h)^2)`. Local contact projection and a global normal
   solve alternate 16 times. The normal matrix is constant; Jacobi-preconditioned
   conjugate gradients use up to 70 iterations per global solve. These are soft
   contacts and an iteration budget, **not hard feasibility constraints**.
6. Remove rigid Z translation, cap the unit-height range at one, and use
   `z = amount * model_size * h`. Amount zero in Diagram mode calls the exact
   original flat PaperScene path; the two 3D modes retain camera rotation around
   a zero-depth sheet. The model and fold solution are never edited.
7. Evaluate separate inset-corner probes (80% triangle corner, 20% centroid) that
   were not used in fitting. Measure every mesh edge's relative 3D extension.

The simple mesh has coarse bending triangles and a soft panel-planarity penalty,
not a physical bending-energy or dihedral model. It discourages within-face bow
while allowing a panel to tilt, and preserves shared heights at every hinge.
It does not enforce a hard curvature/strain bound. The current slider is a
thickness bound; it does not claim a physical hinge-opening angle.

## Camera and visibility

The primary diagram camera is an orthographic view with planar foreshortening
compensated. In direction `u=(cos(phi), sin(phi))`, inclination `theta`, its
screen position is `p' = p - z*tan(theta)*u`. This is a genuine affine camera
projection of the lifted surface, not an arbitrary per-face 2D offset. It keeps
`z=0` unchanged for all directions. Inclination is capped at 80° because the
compensation diverges at 90°.

Uncompensated orthographic and perspective cameras allow top, oblique, side and
underside views. A purely vertical lift has no separation in orthographic
exactly top-down; perspective can produce modest separation through depth-scaled
size. Rich top-down opening requires in-plane motion as well, hence a nonlinear
shell refinement. Perspective uses a finite eye at 2.5 model extents and proper
reciprocal depth interpolation for the GPU depth test.

The two 3D previews support free orbit by dragging. Each drag composes a rotation
around a screen-plane axis with the camera frame captured at pointer-down, using
the simulator's CSS-pixel sensitivity. There are no polar clamps: the complete
frame is converted back to direction, inclination and roll, preserving orientation
through the top and bottom poles. Direction/inclination controls reflect the view;
notes retain all three angles. CPU projection and the WebGL shader consume the
same transform. Camera changes only update uniforms, never the cached lift or
visibility plans. Presets reset roll. Diagram mode ignores roll and retains its
original compensated camera.

The live explorer now defaults to **Preserve layer order**. It lifts the existing
flat diagram paint plan rather than trusting the approximate heights for
visibility. Each paint item has a disjoint GPU depth interval; geometric depth
only resolves triangles within that interval. Consequently an inverted buried
face and its ink cannot win the depth test against a later covering item.
Front and underside plans are prepared once in the worker; the underside plan
reverses each supplied local stack. Camera controls still change only uniforms.

A global face sort alone would break woven folds. The adapter therefore carries
the existing renderer's local overlap patches as well as whole faces. It clips
patches against bending triangles and interpolates their heights, without inking
the artificial seams. Auxiliary lines and crease edges are split at the same
triangulation and use their owner's paint order. Barycentric clipping tolerances
prevent near-degenerate triangles from extrapolating ink into long spikes.

This is **diagrammatic visibility**, not a repaired 3D surface. The inherited
flat paint plan guarantees its original visible stacks, but deliberately does
not encode every buried order inside a woven component. New overlaps/exposures
under large distortions and arbitrary cameras still need visual validation;
this is not a general proof of collision-free, layer-consistent 3D unfolding.
The UI retains the physical inversion and strain diagnostics for that reason.

**Raw 3D depth** is an explicit comparison mode showing the underlying fit's
crossings. The separate BSP experiment also remains available through
`visibility: 'depth'`; its unit-height tree is reusable for positive depth scales
by transforming the eye inversely. That path refuses meshes over 2,000 triangles
because splitting was expensive even on the 76-face frog (10,857 pieces in an
initial probe). The layer-ordered vector experiment uses the same lifted paint
pieces as the GPU. Neither path is wired into production SVG/PDF export.

## Corpus evidence

Input: the supplied Cpoogle directory, 484 nonempty `truth.fold` files. Select 24
fixed edge-count quantiles plus eight named prior spread regressions. No
exactization, repair or input modifications. Two isolated fold processes,
12-second limit each. **32/32 folds succeeded**, ranging from 16 to 4,722 faces.
All 32 produced finite lifts. This is a selected sample, not full-corpus coverage.

Original fit, before the panel-planarity follow-up below. Single local run,
Node/Vite module loading, wall times dependent on the machine:

| Measurement | Median over models | Worst model |
| --- | ---: | ---: |
| Height solve | 330 ms | 12,180 ms |
| Withheld probes with inverted layer order | 12.88% | 45.54% |
| Edge extension, 95th percentile, amount 3% | 0.166% | 1.081% |
| Largest edge extension, amount 3% | 1.239% | 31.549% |
| Edge extension, 95th percentile, amount 6% | 0.664% | 4.257% |
| Largest edge extension, amount 6% | 4.868% | 98.042% |

Across all models, 81,780 of 491,124 withheld probes invert the supplied ordering.
These are sample failures, not counts of intersecting triangles or failed folds.
The numerical threshold is 1e-6 in the unit lift. Scaling amount down reduces the
visible defect but does not remove its sign. Even 3% therefore cannot be called
safe merely because most edge strains are small.

Examples at 6%:

| Model | Faces | Probe inversions | 95th / maximum edge extension |
| --- | ---: | ---: | ---: |
| Gen Hagiwara frog | 76 | 21 / 1,386 | 1.00% / 2.95% |
| Jordan Langerak crane | 921 | 5,813 / 31,782 | 4.26% / 96.74% |

The worker keeps model preparation off the UI thread. Browser checks covered the
frog and crane, amount zero, changing direction, top-down perspective, side and
underside, mesh overlay and model switching. Draw timing displayed in the UI is
CPU submission time, not a claim of GPU frame rate. Timing does not include a
new model's preparation. Private per-model reports remain in ignored
`artifacts/camera-spread/evaluation.json`.

## Clipping follow-up and supplied example

The reported pale triangular breakthroughs on the frog motivated the explicit
layer-order display policy above. The explorer offers both policies at identical
camera settings so the difference can be inspected directly.

`ldm_layer_issue.cp` is an additional external example, separate from the
32/484 corpus sample. It folds to 151 faces with 266 carried auxiliary segments.
No repair or rounding was needed: the research importer must use the app's
selected-fold entry with folding-colour IDs, so auxiliary ink is excluded from
face tracing but retained in the paper scene. Passing every segment to the raw
fold entry had caused `fold_faces_unresolved`. The source file is unchanged.

All 33 examples folded and produced front/back paint plans with finite points
and heights inside the lifted mesh's range. Before the stiffness change, LDM's fit had 1,744/10,005 inverted
probes and 1.27% / 216.75% 95th/worst edge extension at 6%; layer clipping hides
visibility errors, but does not make that deformation physically acceptable.
Private data and screenshots remain under ignored `artifacts/camera-spread/`.

## Reduced bending follow-up

The original centre-height targets allowed auxiliary ink to bow strongly within
otherwise flat panels. The added per-face affine-plane penalty raises panel
stiffness while preserving the single shared height at every paper vertex. It
allows rigid panel tilt; simply penalizing all height differences would suppress
that opening too. Visibility clipping is unchanged.

At the same 6% amount on LDM, sampling 19 interior points on each of its 266
auxiliary segments gives:

| Measurement | Before | Stiffer panels |
| --- | ---: | ---: |
| Aux bow, 95th percentile | 11.57% | 1.13% |
| Aux bow, maximum | 41.67% | 2.07% |
| Mesh edge stretch, 95th percentile | 1.27% | 0.31% |
| Mesh edge stretch, maximum | 216.75% | 0.59% |

Bow is the height departure from the segment's lifted endpoint chord, divided
by its original length, at amount 6%. It isolates within-panel warp; projected
pixel deviation also depends on camera direction/inclination. These are samples,
not certified maxima. Worst sampled bow falls about 95% while total lift range
retains 87% of its prior value, so the improvement is not just a smaller amount.
The existing contacts remain soft: LDM's inverted probe count is 1,937/10,005,
which the unchanged layer-order display policy masks. No physical validity claim
follows from straighter ink.

The corpus evaluator now records sampled auxiliary-line bow beside strain and
visibility diagnostics. A synthetic hinged-panel regression checks nearly
straight cross-panel lines while requiring the hinge to remain substantially
open, guarding against a trivial flattened result.

## Recommended production implementation

1. **Feasible height initialization.** Use local stack constraints at all vertices
   of the overlap of the *render triangles*, not just cell centroids. For fixed
   XY, height differences are affine on each triangle overlap: its vertices are
   the places to certify the inequality. Common paper hinges have zero clearance;
   unrelated layers need a gap. Treat cyclic stacks locally. Use a constrained
   QP/active-set method or a converged projection method and report feasibility,
   rather than silently breaking a cycle or accepting a soft penalty.
2. **Nonlinear shell refinement.** Allow XYZ motion; enforce shared identity,
   membrane strain limits, bending within faces and mild crease dihedral opening.
   Anchor one chosen face/region. Use continuation from a feasible small lift,
   not an unconstrained jump from coincidence. Bound requested displacement.
   Cache topology, triangulation, sparse structure/preconditioner and collision
   acceleration; warm-start nearby amounts. Use a worker with cancellation and
   latest-request wins. Camera-only changes must never invoke this solve.
3. **Validate contact and shape.** Add edge-edge and vertex-face collision
   checks/continuous collision detection during nonlinear motion. Adaptive
   subdivision near wrapped creases can provide needed bending degrees of freedom.
   Measure residuals and strain; refuse or limit the requested amount when bounds
   cannot be met. A valid projection can still be a bad diagram, so retain visual
   corpus review.
4. **One projected picture.** Reuse the product's paper style and renderer. Use GPU
   depth testing during dragging; rebuild a vector PaperScene after release.
   Clip hidden lines against the same deformed triangles. Preserve face identities
   through split pieces for annotations and x-ray tools. Test front/back colours,
   auxiliary lines, PDF/SVG and reopened documents against the preview.
5. **Default integration only after those gates.** Add a `camera` spread kind to
   `foldedLayerSpread.ts`, `diagramDocument.ts`, `diagramFile.ts` and the pose
   controller/catalog. Store amount, direction, camera and anchor parameters;
   retain old spread kinds and the exact zero path. Extend remembered poses,
   refresh, turn-over, undo/redo, annotation carry and file forward-compatibility.
   Add CSS-module controls to `DiagramSpreadRows`, translations and enum/bucketed
   analytics through the existing pose event. Then select it in `SPREAD_KINDS`
   and `DEFAULT_LAYER_SPREAD` for new poses, preserving saved diagrams.

These are engineering recommendations inferred from the experiments and sources,
not claims that a fully collision-free general origami opening has been solved.

## Validation status

- Synthetic geometry tests: identity-based connectivity, independent coincident
  layers, ordering, cache/purity, exact zero, view reversal/arbitrary cameras,
  malformed-topology refusal, deliberately inverted layers/hidden ink, woven
  crossings from both sides, bounded auxiliary ink on very thin triangles, and
  nearly straight panel ink while opening a shared hinge, rolled visibility,
  and zero-depth 3D viewing independent of Diagram's exact zero path.
- Free-orbit math and pointer lifecycle tests cover full revolutions, continuous
  pole crossing, reversibility, repeated drags, touch/secondary-pointer isolation,
  capture cancellation, mode changes and unmount. With existing flat/spread tests
  and CSS-module ratchets, all 102 focused tests pass after the orbit change.
- Browser verification on LDM: perspective dragging updates both angle controls,
  passes to the underside at zero depth, keeps preparation cached, and resets
  correctly. The preview is left in perspective mode for further visual review.
- Web lint and typecheck run after rebuilding stale/missing local generated APIs.
- No Rust behavior, native shell, production route or shipping bundle changed.
  Rust workspace/oracle, Tauri and production build validation are out of scope.
- User visual acceptance and production default integration remain open.
