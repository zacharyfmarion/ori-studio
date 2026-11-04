# Spatial spread experiment

A local numerical and visual prototype for
[`connected-3d-layer-spread.md`](../../../implementation-plans/connected-3d-layer-spread.md).
The original numerical experiment is independent of the app. Production check
pages in this directory now exercise the implemented application modules too;
see **Production checks** below. Generated geometry stays under ignored
`artifacts/`, including all private corpus examples.

## Run

From the worktree root:

```sh
python3 -m venv artifacts/spatial-spread-prototype/venv
artifacts/spatial-spread-prototype/venv/bin/python -m pip install \
  -r scripts/layer-spread/spatial/requirements.txt
cargo build -p oristudio-cp --release --example fold3d_spread_source
artifacts/spatial-spread-prototype/venv/bin/python -B \
  scripts/layer-spread/spatial/build.py --corpus "$ORISTUDIO_NON_FLAT_CORPUS_DIR"
python3 -m http.server 8743 --bind 127.0.0.1 \
  --directory artifacts/spatial-spread-prototype/site
```

Open <http://127.0.0.1:8743/>. `?example=penguin` selects a case directly.
This static study is independent of the shared app's Vite server. Its browser
code has no external assets, uploads or telemetry. Keep its listener local.
To regenerate only one case, pass `--only penguin`; this replaces the viewer's
example list, so omit the flag to restore the full set.

The Rust example reads a `.fold` using the existing importer and `Fold3dSession`.
`--strip` produces a synthetic four-panel strip with a coupled two-plane order.
The optional second positional argument selects a 1-based ordering solution.
OSF extraction uses the existing saved-projection script at full precision.
It evaluates the whole saved projection; it does not infer a user's selection.

## Experiment

`solver.py` assembles a single sparse convex QP with three displacements per
material vertex, a six-variable infinitesimal rigid-motion fit per display
layer, and nonnegative crossing slacks. Display layers join only across
zero-angle material edges. Gap rows interpolate the upper/lower displacement
along the original cell plane's normal. Adjacent layers get positive target
gaps; all ordered pairs get negative-gap penalties at triangle-overlap corners.
Triangle intersections are clipped to the originating arrangement cell.

The shape fit is `d = t + omega cross (p - center)`. The scalar fit weights are
15 (Firm), 3 (Balanced), and 0.6 (Relaxed). All use the same gap budget and
geometric bounds. The current target is `0.18 / (max_stack_depth - 1)` after
normalizing the longest folded extent to two. Residual components are bounded
by 2.5% of each display layer's `2 * area / perimeter`; rotation components by
0.35 radians and displacement components by 0.22 normalized units. Translation
and infinitesimal rotation of the whole figure are constrained to zero.

Solutions use [Clarabel's Python API](https://clarabel.org/stable/python/getting_started_py/)
and are accepted only on Solved/AlmostSolved with an independently checked
linear constraint residual below `2e-6`. Production's flat solver also uses
Clarabel; this prototype is a separate objective and version, not a backend
port or a replacement for `normalized-50-v1`.

`topology.py` follows the existing flat spread triangulator: restore collinear
material boundary vertices omitted by Earcut and repair ill-conditioned ears
by flipping internal diagonals. Every original boundary subedge must exist in
the final triangles. Merely retaining shared vertex IDs is insufficient when
a triangulator has omitted a crease vertex on one incident face.

`viewer.js` and `renderer.mjs` provide a small WebGL inspection renderer. The
left view, and the right at zero, draw the kernel's cell skins. At positive
amount, the right draws every material face with deformed normals. Only source
edges are stroked, with a copy owned by each incident material face. Cameras
stay linked and their frame is based on the unspread model. The slider updates
cached positions; neither the browser nor an orbit gesture runs a solve.

**Enforce layer order** is on by default. Turn it off for the original geometric
depth view. `render_order()` carries each source plane's determined lower/upper
pairs, cell witnesses, normal, origin and zero-angle display groups. `order.mjs`
reverses those pairs using `normal · (eye - origin)`, with an edge-on hysteresis
band. Source plane orientation governs stack order; deformed triangle winding
continues to govern paper side and shading.

At each pixel, a face is masked wherever a known blocker on the same source
plane covers it. Zero-angle pieces share their layer's blockers. Remaining
faces compete by geometric depth, including between different planes. There
are no global rank bands and no inferred relation through a missing blocker.
This uses the flat spread's local-mask policy, scoped per plane; it deliberately
does not copy the flat acyclic global-rank policy to a spatial figure.

The GPU uses one stencil bit for a face's blockers and another for the union
of surviving coverage. In an all-masked projected cycle, it draws that plane's
physical baseline only where the union is empty. Coverage is recorded even
when another plane occludes the survivor; otherwise the fallback could leak
through unrelated foreground paper. Fill and crease passes use the same masks
and the same physical depth buffer. Correction never changes vertex positions.

The prototype applies witnessed relations to whole display-layer pieces on
their source plane, including their newly projected overlaps. It retains cell
witnesses but does not yet subdivide masks by source-cell support. There is no
order correction for unrelated cross-plane contacts. Production integration,
cell-local ambiguous relations, picking, hidden-paper semantics and export
parity are covered in
[`ordered-3d-spread-rendering.md`](../../../implementation-plans/ordered-3d-spread-rendering.md).

**100% means the full experimental displacement field, not a material strain,
fold percentage, production default or validated safe amount.** The prototype
does not clamp away geometric failures. Unavailable source states are shown
explicitly. The no-stack control returns exactly zero displacement.

The slider and animation now extend to **200%**, doubling the original maximum
by scaling the same displacement field. The recorded crossing and face-warp
diagnostics still describe their labeled sample amounts through 100%.

## Findings from the first sweep

Seven drawable examples, three profiles each, plus two explicit refusals:

| Example | Balanced mean gap at 100%, as % of folded extent | Maximum edge-length change | New detected crossing face pairs at 25% / 50% / 100% |
| --- | ---: | ---: | --- |
| Joined strip | 7.91% | 1.69% | 0 / 0 / 0 |
| Waterbomb | 7.33% | 4.73% | 0 / 0 / 0 |
| Three-plane stacks | 0.34% | 1.62% | 0 / 0 / 0 |
| Spikes | 0.22% | 3.86% | 0 / 0 / 0 |
| Penguin | 0.31% | 3.33% | 78 / 56 / 49 |
| Kirigami cylinder | 8.96% | 0.57% | 240 / 240 / 240 |
| Separated rectangles | 0% | 0% | 0 / 0 / 0 |

All 21 variants converged or returned the exact no-stack result. No reversed
triangles were reported after the material-preserving triangulation repair.
The ordered but complicated penguin retains local negative gaps (maximum
0.26% of extent for Balanced at 100%). The cylinder has no sampled local order
violation, but many newly detected transverse intersections: coplanar-order
constraints alone cannot protect other spatial contacts. Increasing shape
preservation is not a collision fix; the firm penguin has more detected
intersecting pairs, even though it moves less.

The reported triangle check uses AABB broad-phase filtering, intersecting
triangle-plane slices and a normalized `1e-7` tolerance. It excludes intentional
coplanar contact, boundary-only contact and triangles sharing a material edge;
counts are unique material face pairs, with baseline detections subtracted.
It is a diagnostic, not a complete intersection certificate. Lower amounts can
produce more pairs because they retain more of the original crowded contacts.
The source engine's acceptance verdict remains separate.

These results support a connected visual opening on the simpler cases. The
next numerical experiment should add contact-aware cross-plane constraints
and compare opening quality on the penguin/cylinder. The camera-dependent
visibility correction added on 2026-11-03 is a separate presentation rule:
it does not improve or invalidate the geometry measurements in this table.
The implementation plan now prioritizes shared rendering and visibility.

## Checks

```sh
artifacts/spatial-spread-prototype/venv/bin/python -B -m unittest discover \
  -s scripts/layer-spread/spatial -v
rustfmt --edition 2024 --check crates/oristudio-cp/examples/fold3d_spread_source.rs
cargo clippy -p oristudio-cp --example fold3d_spread_source -- -D warnings
node --check scripts/layer-spread/spatial/viewer.js
node --test scripts/layer-spread/spatial/order.test.mjs
git diff --check
```

The seven Python tests cover material subedges and sliver repair, the
independent crossing diagnostic, coupled-stack opening, exact zero for no
stacks, refusal of unknown order, covariance under a rigid world-frame
change, and plane-scoped orders with cell witnesses. Six Node tests cover the
camera-conditioned CPU visibility policy. `render-check.html` runs eleven
actual WebGL pixel checks against that CPU reference, including reversed
depth, opposite camera, unrelated foreground/background, partial/full cycles,
occluded cycle survivors, uncovered paper and buried ink. No private files
are needed for these tests.

The external sweep also checks finite candidates, linear constraint residuals,
edge strain, face warp, reversed triangles, local order errors and proper
triangle crossings. `report.json` contains the measured diagnostics;
`sources/` retains extractor outputs for inspection. They are generated data.

The prototype viewer is manually checked for model selection, linked orbit, amount zero
and full, profiles, no-stack identity, source refusals and animation. Full app
tests, WASM rebuilds and upstream parity are unnecessary for this prototype:
no production source or ported algorithm is changed. A production integration
is documented in the separate renderer plan, including its validation results.

## Production checks

Start this worktree's Vite server with `scripts/dev-server.sh start`. Pass its
URL if it is not on the review port 5234:

```sh
ORISTUDIO_SPATIAL_URL=http://localhost:5234 \
  node scripts/layer-spread/spatial/check-production.mjs
```

This runs twelve synthetic WebGL2 pixel cases using the production material
renderer and CPU visibility reference, without private files. Visit
`/@fs/<absolute-worktree-root>/scripts/layer-spread/spatial/production-check.html`
on that server to see the tiles.

For the real examples, regenerate the prototype sources above with the current
Rust example (the render model must include `material`) and copy their JSON
into the production harness's ignored directory:

```sh
mkdir -p artifacts/spatial-production
cp artifacts/spatial-spread-prototype/sources/*.json artifacts/spatial-production/
ORISTUDIO_SPATIAL_URL=http://localhost:5234 \
  node scripts/layer-spread/spatial/check-production.mjs --examples
```

`production-examples.html`, beside the checks page, shows the live GPU image
and settled vector capture. Drag to orbit, change amount, or use Front/Back.
Production controls show 0–100%, with 100% scaling the original unit field by
four. The script sweeps seven models at displacement multipliers 0, 0.001,
0.25, 1, 2 and 4, from both sides, then checks material picks against GPU face
IDs at the new maximum. It also
exercises the raster fallback and refusal of unknown ordering. Reports and
screenshots go to `artifacts/spatial-production/`.

Use `--model pangolin` to sweep that case alone after extracting its OSF
projection with `scripts/osf-fold-projection.mjs` and running the current
`fold3d_spread_source` example into `artifacts/spatial-production/pangolin.json`.
The viewer accepts `?model=pangolin&size=1600` for corner inspection; optional
`yaw`, `pitch` (radians) and `zoom` reproduce a specific camera. Amount/camera
sweeps retain source identity and reuse the solve, as the app does.

Tortoise is another local review case. Extract its OSF projection and run the
same Rust example into `artifacts/spatial-production/tortoise.json`, then use
`--model tortoise` or open the viewer with `?model=tortoise`. Its dense stacks
exercise the solver's compacted-sample budget; no private fixture is committed.
The solver's memory investigation and production measurements are in
[`spatial-spread-solver-efficiency.md`](../../../implementation-plans/spatial-spread-solver-efficiency.md).

Near-coincident independent surfaces are reported as `contactTies` separately
from visibility failures, using a `2e-5` normalized depth tolerance. This
exception never excuses a known blocker violation and does not change the
production winner. The current seven-model run checks 12,977 interior pixels,
with four such cylinder ties and no ordering mismatches. At high amounts the
fixed camera frame can crop the model; this is separate from the capture's
geometry bounds. The application has its usual zoom control.

### Orbit performance

`orbit-benchmark.html?model=penguin&size=1600&interval=8` uses the same local
fixtures and Vite `/@fs/<absolute-worktree-root>/scripts/layer-spread/spatial/`
prefix. It first times production GPU draws over a full orbit, then mounts the
actual Edit folded-mesh hook and drives its worker with three seconds of camera
input. `size` is in device pixels; `interval` is milliseconds between inputs.
Use `interval=4` to overload rendering deliberately.

The page reports command counts, CPU submission and blocking readback times,
worker render timings, presentation gaps and trailing delay. Presentation
callbacks can exceed monitor refresh rate; their count is not screen FPS.
JSON also appends to the dev-only `artifacts/sim-perf/sim-perf.log`. Run timing
comparisons without other GPU checks or builds running. See
[`spatial-spread-orbit-performance.md`](../../../implementation-plans/spatial-spread-orbit-performance.md)
for the diagnosis and recorded before/after measurements.
