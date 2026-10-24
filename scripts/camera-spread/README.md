# Camera spread explorer and production validation

The local research entry remains unshipped, like `start-figure-tuner.html`. Its
renderer is now shared with production's **Default** Diagram spread. The explorer
compares flat/depth/affine drawings with the connected lift and exposes diagnostics
that production does not. See `implementation-plans/camera-spread-production.md`
for integration decisions, validation and measured performance limits.

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
vector path uses the same pieces and spatially indexed clipping for layer and
geometric visibility. The production capture worker compacts clipped fragments
and stores the full source mapping for annotations. Work is bounded to 30 million
clipping operations and 250,000 fragments; failures retain the last saved picture. The flat paint plan does
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
CAMERA_SPREAD_DPR=2 node scripts/camera-spread/check-renderer.mjs
node scripts/camera-spread/check-antialiasing.mjs
```

Open `/src/generated/camera-spread/comparison/index.html` on the same server for
all 70 pairs, model/view filters, full-resolution PNGs and a wipe slider. Capture
metadata records the exact cameras, framing and baseline revision. Artifacts stay
local and ignored. The GPU pixel check uses synthetic geometry, without corpus
files, and verifies crossing depths, ID permutation, stack reversal and hidden ink.
The antialiasing check inspects composited screenshots at 1x and 2x display pixel
density. Rendering uses twice the display resolution per axis (capped at 4x CSS
resolution), so Retina screens receive supersampling too. Full CSS stroke widths
stay at 1.1 px / 0.65 px. Coverage masks and geometry use the same sample grid;
native MSAA remains disabled to avoid inconsistent clipping at shared boundaries.

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


Production capture and review (after preparing the ignored corpus above):

```sh
node scripts/camera-spread/check-capture.mjs
node scripts/camera-spread/production-review.mjs
CAMERA_SPREAD_DPR=2 node scripts/camera-spread/production-review.mjs
# Rebuild only the gallery controls from existing captures:
node scripts/camera-spread/production-gallery.mjs
```

Open `/src/generated/camera-spread/production/index.html`. It compares the live
worker bitmap with the vector picture after storage and file reopening, with
model/view/DPR filters, settings and SVG links. The historical before/after
gallery is linked from it. `CAMERA_SPREAD_MODEL=<id-fragment>` and
`CAMERA_SPREAD_VIEW=<view-id>` narrow a review run; a narrowed run replaces that
DPR's report, so rerun without filters for the complete gallery.

Benchmark the production worker separately from builds/tests to avoid resource
contention. This records bitmap RPC completion and compositor presentation
separately, cold preparation, available JS heap and a main-thread heartbeat.
Presentation includes two animation frames; it is not hardware input-to-photon
or a GPU timer measurement. Results go under ignored `performance/`.

```sh
CAMERA_SPREAD_BENCH=local node scripts/camera-spread/benchmark-production.mjs
CAMERA_SPREAD_BENCH=local CAMERA_SPREAD_BROWSER=webkit node scripts/camera-spread/benchmark-production.mjs
```

Use the simulator package's camera tests and the full web suite for the shared
orbit/pan/cube, persistence, capture, annotation and export contracts. Node 26
needs `NODE_OPTIONS=--no-experimental-webstorage` when running Vitest without a
storage file. Actual compositor pixel tests above remain necessary: jsdom does
not supply a WebGL canvas.

Real saved diagram projects can be checked without reselecting or translating
creases. This uses the production sheet resolver and the rebuilt CP WASM bridge:

```sh
node scripts/camera-spread/audit-diagram-files.mjs /path/to/project.osf all
# Or selected one-based step positions in each diagram:
node scripts/camera-spread/audit-diagram-files.mjs /path/to/project.osf 188,189,190
```

Reports, solved scenes and exact coordinate-bit fixtures are written only under
ignored `artifacts/camera-spread/real-files/`. The audit reports files with no saved
diagrams separately. It audits every diagram in a project and checks both scope
fingerprints and fold outcomes; it does not claim that folding alone validates
camera rendering. A `*-bits.json` can also exercise the native/Oriedita parity
regression with `ORISTUDIO_FOLD_SEGMENT_BITS` and `ORIEDITA_GEOMETRY_ORACLE` set.

## Full-corpus cold preparation baseline

The full-corpus harness attempts **every `*/truth.fold`**, sorted by edge count
and then ID. It does not use the explorer's 32-model selection. Run it without
other benchmarks, builds or tests competing for CPU:

```sh
node scripts/camera-spread/benchmark-preparation.mjs \
  /absolute/path/to/cpoogle artifacts/camera-spread/benchmarks/my-baseline
# After interruption, with exactly the same options/code/input/runtime:
node scripts/camera-spread/benchmark-preparation.mjs \
  /absolute/path/to/cpoogle artifacts/camera-spread/benchmarks/my-baseline --resume
```

Defaults are three preparation trials per model, 30 seconds for folding and
120 seconds for each preparation process. Override with `--repeats=N`,
`--fold-timeout=MS`, `--prep-timeout=MS`; `--limit=N` makes a smoke run. Failures
and timeouts are retained, including the stage reached. A timeout is a censored
observation, not evidence of an impossible fold or zero-cost preparation.

Each model folds once through the current generated Oriedita WASM (starting
face 1, layer solution 1, folding-colour creases only). Each preparation trial
then uses a **fresh Node process and immutable scene**. It calls the production
lift, front/back visibility plans and layer relations. Timings distinguish:

- WASM initialization, parsing, folding and scene extraction.
- Lift topology, matrix/solve/probes, front/back paint plans and relations.
- Cached lookup cost, process wall time and process peak RSS.

Preparation excludes importing modules, file reading/parsing, worker transfer,
GPU initialization and vector capture. It measures cold **geometry caches**, not
cold filesystem caches. The lift's existing solve diagnostic includes matrix
compilation, normalization and final probe calculations. Scene and mesh hashes
let later optimizations verify unchanged geometry. All three trial hashes
should match before timing changes are interpreted.

The output contains `run.json` (input SHA-256 manifest, code/bundle/WASM/runtime
and hardware provenance), atomic per-model results, `results.jsonl` (raw trials),
`results.csv`, `summary.json`, `README.md`, and ignored solved `scenes/`. Resume
reconstructs the journal from atomic records and rejects changed inputs,
measurement code, compiled implementation, WASM or trial settings. Reports use
nearest-rank percentiles of per-model trial medians and exclude incomplete
models from latency percentiles while preserving their outcome counts.

### Actual browser initialization

After the CPU run finishes, build its standalone browser harness and open the
printed file through the existing generated-artifact mount:

```sh
node scripts/camera-spread/prepare-browser-benchmark.mjs \
  artifacts/camera-spread/benchmarks/my-baseline
DEV_SERVER_PORT=5282 scripts/dev-server.sh start
# Open http://localhost:5282/src/generated/camera-spread/benchmarks/my-baseline/browser.html
```

Click **Start / resume benchmark**. It uses a fresh module worker for each of
three trials, sequentially, calling the actual production render session's
`load` and `render`. Surface: 800 × 640 CSS pixels at DPR 2; Diagram, 6% amount,
247° direction, 45° inclination, no page rotation. The page hashes each fetched
scene against the CPU manifest. It separately records worker startup, in-worker
preparation, first bitmap, full RPC and two-frame presentation, plus browser/GPU
identity. Keep this tab foreground; presentation is not input-to-photon timing.
`BENCH_BROWSER_REPEATS=N` changes the trial count when generating the harness.

Completed models save in local storage. **Stop after this model** leaves a
resumable result; **Save results JSON** downloads `browser-results.json`. Put
that beside the CPU report. The generated bundle is saved and hashed so the
browser run uses a fixed code snapshot even if the development checkout changes.
Browser timing excludes corpus fetch, JSON decode and scene hash verification;
those are recorded separately. Vector clipping/capture after an edit is a
separate cost, not part of this initial preparation benchmark.

Only benchmark scripts and numerical baseline data belong in Git. Corpus
inputs, solved scenes, bundles, detailed local reports and browser downloads
stay under the ignored artifact directory. Do not copy the corpus into the repo.

Harness checks (no Rust/product implementation changes):

```sh
node --test scripts/camera-spread/benchmark-preparation.test.mjs
node --check scripts/camera-spread/benchmark-preparation.mjs
node --check scripts/camera-spread/benchmark-preparation-worker.mjs
```

Export a shareable/versionable numerical baseline and regenerate the local
sortable report after saving the browser JSON:

```sh
node scripts/camera-spread/export-preparation-benchmark.mjs \
  artifacts/camera-spread/benchmarks/my-baseline \
  research/benchmarks/camera-spread/my-baseline.json
```

The exporter explicitly selects timing/count/hash fields, excluding source
paths, geometry, and raw error stacks. It writes the interactive `index.html`
only inside the artifact directory. The versioned JSON stores one line per
model for manageable diffs; all raw numerical trial values remain available.
Compare matching input, scene and mesh hashes before interpreting speedups.
The initial full-corpus baseline is documented in
`research/2026-10-24-camera-spread-preparation.md`.
