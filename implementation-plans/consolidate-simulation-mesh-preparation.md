# Consolidate simulation-mesh preparation into the TypeScript path

## Goal

One implementation of "FOLD document → triangulated simulation mesh", in
`packages/origami-simulator`. Delete the Rust twin in `treemaker-fold`, which
prepared a mesh nothing simulated and gated designs the TypeScript path could
have folded.

## Approach

The Rust-built mesh never reached the solver. `SimulatorPanel` hands
`simulation_model.fold` to the simulator session, and
`simulator/simulatorSession.ts` runs TypeScript `prepareFoldModel` over it
again — so a TreeMaker design was prepared twice and only the second result was
simulated. The first pass survived only as a gate: `build_crease_params`
returned `BadCreaseTopology` for topology the TypeScript path copes with,
setting `simulation_model_error` and making the panel refuse to simulate. A gate
in front of a more capable implementation can only reject work that would have
succeeded.

So:

- `treemaker-fold` loses `prepare_simulation_model`, `triangulate_faces`,
  `build_crease_params`, `remove_redundant_vertices`, their helpers, the
  `PreparedFoldModel` / `CreaseParameter` types, the `BadCreaseTopology` and
  `Triangulation` error variants, and the `earcutr` dependency. What is left is
  FOLD data structures, validation, and adjacency construction — which is what
  the crate's own README claims it is for.
- `treemaker-core`'s `FoldArtifacts` loses `simulation_model` and `Tree` loses
  the public `simulation_model()` method (no callers). `simulation_model_error`
  **stays**: it also carries the CP-status gate ("simulation requires a full
  crease pattern; current status is …"), which is a statement about whether
  TreeMaker produced a complete crease pattern at all, not about mesh
  preparation. That gate is not redundant with anything downstream.
- The wasm `flat_fold_artifacts` binding returns `simulation_fold` — the
  untriangulated document carrying the flat-folder's inferred simulator
  assignments — in place of a prepared `simulation_model`. It keeps the
  `infer_edge_assignments_from_face_orders` coverage without a second mesh
  builder. (This binding has had no web caller since the segmentation work.)
- The web layer prepares for both document kinds. The crease-pattern branch of
  `computeFoldArtifacts` already called `foldArtifactsFromFold`; the TreeMaker
  branch now gets the same preparation inside the treemaker worker's
  `foldArtifacts`, next to the existing `withSegments`. The worker is the right
  place rather than `computeFoldArtifacts`: it covers both `api.foldArtifacts`
  call sites (`computeFoldArtifacts` and Build CP), it keeps a
  seconds-long triangulation off the main thread, and `withSegments` keeps
  segmenting the same simulation fold it does today.

`crease_params` goes from the web `FoldArtifacts` type as well: the Rust path
was its only producer, the TypeScript path always wrote `[]`, and no consumer
ever read it — `simulatorSession` recomputes crease parameters from the fold.

## Affected Areas

- `crates/treemaker-fold/{src/lib.rs,Cargo.toml,README.md}`
- `crates/treemaker-core/src/lib.rs` (`FoldArtifacts`, `Tree::simulation_model`,
  `Tree::fold_artifacts`, tests)
- `crates/treemaker-wasm/{src/lib.rs,tests/node.rs}`
- `apps/web/src/engine/types.ts`
- `apps/web/src/workers/treemakerWorker.ts`
- `apps/web/src/lib/creasePatternImport.ts`
- `apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts`
- Web tests referencing `simulation_model` / `crease_params`

## Checklist

- [x] Delete the mesh preparation from `treemaker-fold` and its tests
- [x] Drop `simulation_model` from `treemaker-core`'s `FoldArtifacts`, keep the
      CP-status gate, delete `Tree::simulation_model`
- [x] Replace `flat_fold_artifacts`'s `simulation_model` with `simulation_fold`
- [x] Prepare the simulation model in the treemaker worker
- [x] Drop the dead `crease_params` from the web `FoldArtifacts` type
- [x] Update web tests and store fixtures
- [x] `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`,
      `cargo test --workspace`
- [x] `npx tsc --noEmit`, `vitest run`, `npm run lint:web` in `apps/web`
- [x] Rebuild the wasm bridge (exported artifact shape changed)
- [ ] Browser check: Design → generate CP → Simulate
