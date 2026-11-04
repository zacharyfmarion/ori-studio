# Production 3D spread checks

These browser checks import the application's Rust/WASM spread solver,
TypeScript material/visibility modules and WebGL renderer. There is no separate
solver or renderer in this directory. The standalone numerical prototype and
its Python dependencies have been removed.

The implementation and resource limits are documented in
[`ordered-3d-spread-rendering.md`](../../../implementation-plans/ordered-3d-spread-rendering.md)
and
[`spatial-spread-solver-efficiency.md`](../../../implementation-plans/spatial-spread-solver-efficiency.md).
Private corpus geometry and generated reports stay under ignored `artifacts/`.

## Synthetic rendering checks

Start the worktree's Vite server with `scripts/dev-server.sh start`. Pass its
URL if it is not on the review port 5234:

```sh
ORISTUDIO_SPATIAL_URL=http://localhost:5234 \
  node scripts/layer-spread/spatial/check-production.mjs
```

This runs twelve WebGL2 ordering/ink cases against the production CPU visibility
policy, plus two real-worker shared-context cases, without external files. Visit
`/@fs/<absolute-worktree-root>/scripts/layer-spread/spatial/production-check.html`
on that server to inspect the tiles. These checks cover opposite camera sides,
partial/full cycles, unrelated surfaces, and exposed/buried shared hinges.
The worker cases open ordinary and spatial meshes in both orders, verify visible
bitmaps, and repeatedly release/reopen spatial meshes while ordinary rendering
stays live. The worker uses one stencil-capable canvas for both kinds of mesh;
releasing spatial meshes must leave that shared context usable.

## Model capture and picking checks

The Rust example exports the production `Fold3dSession` render model and
snapshot directly. It does not solve spread or implement a second geometry
pipeline. Generate the synthetic strip from the worktree root:

```sh
mkdir -p artifacts/spatial-production
cargo run -p oristudio-cp --release --example fold3d_spread_source -- --strip \
  > artifacts/spatial-production/strip.json
```

For an external OSF model, extract its saved projection with the existing file
utility, then run the same Rust exporter. Replace `input.osf` with the local
source and `tortoise` with its review name:

```sh
node scripts/osf-fold-projection.mjs /path/to/input.osf \
  > artifacts/spatial-production/tortoise.fold
cargo run -p oristudio-cp --release --example fold3d_spread_source -- \
  artifacts/spatial-production/tortoise.fold \
  > artifacts/spatial-production/tortoise.json
```

A FOLD file can be passed directly to the Rust example. An optional second
argument selects a 1-based layer-order solution. The exporter uses the entire
input projection; use the extraction utility's `--component` option when a
source contains unrelated designs.

The existing review corpus uses these input names relative to
`$ORISTUDIO_NON_FLAT_CORPUS_DIR`:

| JSON basename | Input |
| --- | --- |
| `strip` | Synthetic `--strip` case above |
| `waterbomb` | `known-good/waterbombBase.fold` |
| `three-plane` | `non-flat-test.osf` |
| `spikes` | `personal/non-flat-harder_final.osf` |
| `penguin` | `fold-angle-3d/penguin_freeform.fold` |
| `cylinder` | `kirigami/kirigami-cylinder.fold` |
| `rectangles` | `personal/stacked_rectangles.fold` |
| `airplane` | `known-good/airplane.fold` (unknown-order refusal) |

Once those JSON files exist, run:

```sh
ORISTUDIO_SPATIAL_URL=http://localhost:5234 \
  node scripts/layer-spread/spatial/check-production.mjs --examples
```

This sweeps seven models at displacement multipliers 0, 0.001, 0.25, 1, 2 and
4, from both camera sides, and compares interior GPU face IDs with material
picks at the maximum. It also checks raster fallback and unknown-order refusal.
Use `--model tortoise` or `--model pangolin` for an additional locally generated
case. Single-model runs also need `strip.json` and `airplane.json` for those
shared checks. Reports and screenshots go to `artifacts/spatial-production/`.

`production-examples.html`, beside the checks page, shows the live GPU image and
settled vector capture. Drag to orbit, change amount, or use Front/Back. The
controls show 0–100%, with 100% scaling the accepted unit field by four. Use
`?model=tortoise&size=1600` to select a case and resolution; optional `yaw`,
`pitch` (radians) and `zoom` reproduce a camera. Amount/camera sweeps retain
source identity and reuse the cached solve, as the app does.

Near-coincident independent surfaces are reported as `contactTies` separately
from visibility failures, using a `2e-5` normalized depth tolerance. This never
excuses a known blocker violation or changes the production winner. The fixed
camera frame may crop the model at high amounts; the application has its usual
zoom control.

## Orbit performance

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
for the diagnosis and measurements.
