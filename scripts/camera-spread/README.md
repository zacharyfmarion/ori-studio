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
- **Preserve layer order** suppresses buried faces and ink in Diagram mode.
  In 3D the same preference becomes **3D depth · resolve layer ties**: actual
  surfaces occlude each other, with only a small depth bias for near-coplanar
  layers. **Raw 3D depth** removes that correction. A flat global order must not
  force distant surfaces over nearer ones after orbiting; physical intersections
  in the approximate lift can consequently remain visible in 3D.
- Enable the bending mesh to inspect interior degrees of freedom.
- Read edge extension and *withheld* layer-order sample failures. These are not a
  full triangle-intersection certificate; small residuals can also lie below the
  numerical threshold (1e-6 of unit lift).
- Save validation notes with exact settings in browser storage; export JSON.
  No telemetry or uploads are initialized by this standalone entry.

Mesh preparation runs in a worker that is terminated when models change.
Direction, camera and amount change WebGL uniforms; they do not rerun the solver.
The displayed timing is CPU draw submission, **not GPU completion or FPS**.
The original/legacy comparison is drawn through the existing PaperScene producer.
Front/back visibility plans also prepare in the worker, including local patches
for woven folds and auxiliary ink split along bending triangles. The layer-ordered
vector path uses the same pieces; the 3D/raw BSP paths have a 2,000-triangle budget.
These are research adapters, not production exports. The flat paint plan does
not represent every buried order in a woven component, so newly exposed woven
regions at large distortions still require visual review.

A `?model=<manifest-id>` query opens a particular example directly; for the
supplied CP use `camera-spread.html?model=ldm-layer-issue`.

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
