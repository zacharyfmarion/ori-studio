# Camera spread research explorer

A local, unshipped research entry, like `start-figure-tuner.html`. It compares
Ori Studio's current flat/depth/affine drawings with a shared-vertex height lift
and layer-ordered camera projection. It does **not** change Diagram's default.
See `research/2026-10-21-camera-spread.md` for the findings and production design.

From the worktree root:

```sh
scripts/setup-worktree.sh
npm --workspace @treemaker/web run build:oristudio-cp-wasm
npm --workspace @treemaker/origami-simulator run build
node scripts/camera-spread/prepare.mjs /absolute/path/to/cpoogle /absolute/path/to/extra.cp
node scripts/camera-spread/evaluate.mjs
DEV_SERVER_PORT=5281 scripts/dev-server.sh start
```

Open `http://localhost:5281/camera-spread.html`. Check the port is unused by
another checkout first; `dev-server.sh` reuses an existing healthy listener.
The script keeps the server alive independently of the agent session.

The preparation script selects 24 deterministic edge-count quantiles plus eight
named regression cases from `truth.fold`, folds through the current Oriedita
WASM kernel, and records a 12-second per-model timeout/refusal. It never modifies
or exactizes the input. Each fold runs in its own process; two run concurrently.
`manifest.json` records all attempted models, including failures. The explorer
lists the successful folds. For the supplied 484-pattern corpus all 32 selected
models succeeded. Optional additional `.cp` or `.fold` paths are listed separately
from that sample. CP folds select folding-colour segments, preserving auxiliary
lines as ink without feeding them to face tracing. Selection is deliberately varied, not a statistical sample.

Private scenes, the manifest, machine-readable diagnostics and logs live in
ignored `artifacts/camera-spread/`. A symlink under ignored
`apps/web/src/generated/camera-spread/` makes them available to Vite. Nothing
from the corpus is included in the production entry or committed.

In the explorer:

- Choose a model and compare against original, affine or depth spread.
- Drag the direction dial or slider. Adjust amount; zero uses the original
  drawing in Diagram mode and flattens the paper in the two 3D modes.
- Amount now ranges to 50%, with a readout of the actual overall depth span.
  It caps whole-model depth relative to the longest folded extent, not each
  layer gap. Model tilt, connectivity and stiffness affect local separation.
- Diagram camera compensates foreshortening; orthographic and perspective cameras
  allow top-down, side and underside views. Diagram inclination is capped at 80°.
- Drag directly on either 3D preview with a mouse, pen or one finger to orbit
  freely, including through both poles. Direction and inclination stay in sync;
  full orientation (including roll) is saved with validation notes. Presets reset
  roll, and Reset camera restores the initial Diagram settings. Zoom uses its slider.
- **Preserve layer order** suppresses buried faces and ink in every camera mode.
  In 3D, each lifted triangle selects the forward or reversed stack according
  to its own facing. Known layer relationships stay authoritative; unrelated
  surfaces compete by depth at each projected overlap, including in Diagram.
  Face IDs and arbitrary flat draw priorities cannot hide unrelated surfaces.
  Opposite-facing protected surfaces also compete geometrically.
  **Raw 3D depth** disables this protection.
- Enable the bending mesh to inspect interior degrees of freedom.
- Read edge extension and *withheld* layer-order sample failures. These are not a
  full triangle-intersection certificate; small residuals can also lie below the
  numerical threshold (1e-6 of unit lift).
- Save validation notes with exact settings in browser storage; export JSON.
  No telemetry or uploads are initialized by this standalone entry.

Mesh preparation runs in a worker that is terminated when models change.
Direction, camera and amount update uniforms and a screen-tiled triangle index;
they do not rebuild vertex buffers or rerun the solver. The transitive layer
relationships are cached in a byte texture. Each fragment tests only candidate
covering triangles in its tile, then surviving fragments use geometric depth.
The displayed timing is CPU draw submission, **not GPU completion or FPS**.
The original/legacy comparison is drawn through the existing PaperScene producer.
Front/back visibility plans also prepare in the worker, including local patches
for woven folds and auxiliary ink split along bending triangles. The layer-ordered
vector path uses the same pieces and masks each facing group before BSP sorting;
positive-depth vector paths have a 2,000-triangle budget, plus a 50,000-fragment masking cap.
These are research adapters, not production exports. The flat paint plan does
not represent every buried order in a woven component, so newly exposed woven
regions at large distortions still require visual review.

A `?model=<manifest-id>` query opens a particular example directly; for the
supplied CP use `camera-spread.html?model=ldm-layer-issue`.

The partial-order visibility review captures seven matched settings on ten models:

```sh
# Run before changing the renderer to freeze the baseline, then after the change.
node scripts/camera-spread/compare.mjs before
node scripts/camera-spread/compare.mjs after
node scripts/camera-spread/gallery.mjs
node scripts/camera-spread/check-renderer.mjs
```

Open `/src/generated/camera-spread/comparison/index.html` on the same server for
all 70 pairs, model/view filters, full-resolution PNGs and a wipe slider. Capture
metadata records the exact cameras, framing and baseline revision. Artifacts stay
local and ignored. The GPU pixel check uses synthetic geometry, without corpus
files, and verifies crossing depths, ID permutation, stack reversal and hidden ink.

Validation:

```sh
npx --workspace @treemaker/web vitest run \
  src/cp-workspace/folded/cameraSpread.test.ts \
  src/cp-workspace/folded/cameraSpreadCamera.test.ts \
  src/devtools/camera-spread/useCameraSpreadOrbit.test.tsx \
  src/cp-workspace/folded/foldedFlatScene.test.ts \
  src/cp-workspace/folded/foldedLayerSpread.test.ts
npm run lint:web
npm --workspace @treemaker/web run typecheck --ignore-scripts
```

The last command assumes all generated bindings have been rebuilt from the
current checkout; use the ordinary typecheck entry with hooks on a fresh setup.
