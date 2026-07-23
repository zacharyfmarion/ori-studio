# Origami Simulator Vendor Snapshot

This directory vendors Amanda Ghassaei's Origami Simulator, the upstream for
`packages/origami-simulator`, so that its solver can be read as the canonical
behavioural reference and driven as a local browser oracle.

- Upstream: <https://github.com/amandaghassaei/OrigamiSimulator>
- Pinned commit: `7855983a613c879c171b2b1557f8cd102d2640cf`
- License: MIT, preserved in `LICENSE`
- Paper: Ghassaei, Demaine, Gershenfeld, *Fast, Interactive Origami Simulation
  using GPU Computation*, 7OSME (2018)

## Why it is here

`packages/origami-simulator` is a TypeScript port of the dynamic solver only.
Upstream is not a library — it has no `package.json`, no module exports, and
`js/dynamic/dynamicSolver.js` alone makes 97 references to a browser-global
`globals` object, with the solver shaders living in `<script>` blocks inside
`index.html`. The port exists because the solver had to be lifted out of that
app to be embeddable.

Two consequences make an in-tree copy necessary:

1. **Parity reference.** Per `AGENTS.md`, the canonical behavioural reference
   for a port is the vendored upstream. Until this snapshot the simulator port
   had none, and had never been checked against the original.
2. **Browser oracle.** Upstream's GPU solver is the reference implementation for
   the WebGL2 port. Driving this copy in Playwright and capturing folded state
   gives golden traces from the original rather than from our own past output.

## What is vendored

Everything needed to load and run the page:

```text
index.html      # app shell AND the solver shader source (<script> blocks)
js/             # solver, model, GPU math, UI, importers
dependencies/   # three.js, jQuery, fold.js, earcut, and friends
css/, fonts/    # page styling
```

Deliberately omitted, to keep the snapshot small:

- `assets/` (~23 MB) — the bundled example crease-pattern corpus and
  documentation images. Nothing loads at startup; `js/importer.js` only reaches
  into `assets/` when a user picks a demo pattern from the menu, and the oracle
  injects fixtures directly. A tiny redistributable subset is kept under
  `tests/fixtures/origami-simulator/`.
- `CreasePatternScripts/` — Illustrator helper scripts for end users.
- `CNAME`, `favicon.ico` — GitHub Pages deployment metadata.

## Solver files that matter

The port tracks these; read them before changing solver behaviour.

```text
js/dynamic/dynamicSolver.js   # step order, state layout, CSR topology packing
js/dynamic/GPUMath.js         # ping-pong FBO / texture layer
js/model.js, js/beam.js       # rest lengths, crease params
js/crease.js, js/node.js
index.html                    # shader blocks:
                              #   normalCalc, thetaCalcShader, updateCreaseGeo,
                              #   velocityCalcShader, positionCalcShader,
                              #   positionCalcVerletShader, velocityCalcVerletShader
```

Note upstream's per-node topology is already CSR, not a padded fixed-stride
layout: `meta = [beamMetaIndex, numBeams, nodeCreaseMetaIndex, numCreases]` and
`meta2 = [nodeFaceMetaIndex, numFaces]` index into flat `beamMeta` /
`nodeCreaseMeta` / `nodeFaceMeta` textures. There is therefore no maximum
valence, which the port relies on for TreeMaker-generated crease patterns.

## Scope of the port

Only the dynamic solver is ported. `rigidSolver.js`, `staticSolver.js`,
`curvedFolding.js`, the importers and the exporters are present here as
reference but intentionally not ported — see
`implementation-plans/origami-simulator-performance.md`.

Upstream implements **no** collision, self-intersection or layer-ordering
physics; the model passes through itself. Do not add it in the name of parity.

## Driving it as an oracle

Verified working against this snapshot. Serve the directory statically (there is
a `upstream-oracle` entry in `.claude/launch.json` on port 5193) and drive the
page's browser globals directly:

```js
const g = window.globals;
g.pattern.setFoldData(foldDocument, true); // stashes nextFold, defers the swap
g.model.sync();                            // force the swap NOW (see below)
g.model.pause();                           // stop the rAF animation loop
g.foldPercent = 1.0;                       // NOTE: 0..1 upstream, 0..100 in our port
g.model.reset();
g.model.step(100);                         // deterministic; solver.solve(n) under the hood
const positions = g.model.getPositionsArray(); // Float32Array, xyz per node
```

Four things that will otherwise cost you an afternoon:

1. **`buildModel` is deferred.** `setFoldData` → `processFold` → `model.buildModel`
   only stashes `nextFold` and sets `globals.needsSync`; the real swap happens in
   `model.sync()`, called from the animation loop. A headless or hidden page never
   fires `requestAnimationFrame`, so the model silently never changes. Call
   `model.sync()` explicitly rather than waiting — which is also what you want for
   determinism.
2. **`foldPercent` is 0..1 here**, not the 0..100 our port uses.
3. **Positions are radius-normalised** (unit square → ±0.7071), matching
   `normalizeSimulationPositions` in the port. Compare in that space.
4. **`setFoldData` calls `gtag()`.** It is defined by the bundled analytics
   snippet, so it does not throw, but an offline harness should stub it if the
   analytics script is blocked.

`saveFOLD()` is a bare global (not on `globals`) and exports the pre-triangulated
`rawFold`, so prefer `model.getPositionsArray()` for per-node comparison.

## Modification policy

Do not edit vendored source except for clearly scoped oracle build maintenance,
per `AGENTS.md`. Any local change must be recorded here.

Local changes: none.
