# Box Pleating Studio Rust Port

## Goal

Port Box Pleating Studio's non-UI functionality into a Rust crate that can be
used by Ori Studio without reducing the behavior surface. The crate must be able
to run Box Pleating Studio workflows headlessly end to end, including project
loading, migrations, tree/layout updates, pattern generation, CP/FOLD export,
TreeMaker import, optimizer workflows, and command/history semantics.

This plan is the locked migration contract for the initial port. The work must
follow the same discipline used for the TreeMaker, Flat-Folder, and Oriedita
ports:

- Box Pleating Studio is the behavioral reference for this work.
- No simpler substitute algorithms should be used for production behavior.
- Every known behavior starts as `Unsupported` until it has a direct Rust port
  and focused tests.
- Existing upstream gaps stay explicit instead of being filled with invented
  approximations.
- Box Pleating Studio quirks should be preserved first. Suspected upstream bugs
  can be marked for later review, but parity wins for the initial port.
- Every ported algorithm needs Rust unit coverage and, where practical, oracle
  coverage against the pinned upstream implementation.

## Approach

### Source Baseline

- Repository: `https://github.com/bp-studio/box-pleating-studio`
- Inspected commit: `d86f8051812458b2c7b1ed7fac49fe7dc1d4dad4`
- Upstream version: `0.7.14`, app version `1898`
- Upstream commit date: `2026-03-11T15:02:04+08:00`
- Upstream license: MIT

The initial inspection clone lived at `/tmp/bp-studio.hZ4Phb` and was not added
to this repository. The committed port will vendor a pinned upstream snapshot
under `third_party/box-pleating-studio` with preserved MIT notices.

### Locked Decisions

- Crate name: `oristudio-bp`.
- Presentation UI scope: Vue, Pixi, browser screens, dialogs, menus, and PWA
  presentation are out of scope for the Rust crate. The crate must still expose
  enough model, command, preview, graphics, and export data to wire a frontend
  cleanly later.
- API target: design the core API for WASM/browser use first, while keeping the
  Rust-native API ergonomic. Add a separate WASM binding crate if that matches
  workspace conventions once the core API stabilizes.
- History: undo/redo, mementos, command coalescing, and partial command failure
  behavior are in scope for the Rust crate.
- Optimizer: optimizer functionality is required for the complete headless
  deliverable. Prefer a direct functionality port where licensing allows; a Rust
  optimization library may be used only if it preserves BP Studio workflow
  semantics and produces oracle-validated valid packings. Exact coordinate
  identity is tracked where stable, but valid-different packings are acceptable.
- Oracle: keep BP Studio oracle tests manual/optional for now. Use Bun where it
  can run the upstream code reliably; fall back to Node/npm where upstream
  tooling requires it.
- Source: vendor the pinned upstream source instead of fetching it during oracle
  setup.
- TreeMaker import: directly port BP Studio's TreeMaker v5 parser/import path
  first to preserve scaling and conversion quirks. Integration with
  `treemaker-core` can be evaluated after parity is established.
- Compatibility target: prefer byte-for-byte output where practical. When byte
  identity is not meaningful because of ordering, floating output, zip metadata,
  or canonical equivalent encodings, require canonical semantic parity and
  document the reason.
- Upstream TODOs: do not implement behavior BP Studio itself marks as TODO in
  the initial parity port. Preserve the gap as `Upstream-gap`,
  `UnsupportedOperation`, or an equivalent typed not-implemented result.

### Research Findings

- Upstream `HEAD` still resolves to inspected commit
  `d86f8051812458b2c7b1ed7fac49fe7dc1d4dad4`.
- Upstream source scale: 553 files under `src`, 47 files under `test`, with the
  core port surface concentrated in `src/core`, `src/shared`,
  `src/client/project/changes`, `src/client/project/components`,
  `src/client/plugins`, `src/client/patches`, and file import/export services.
- BP Studio already treats its Core as a headless worker: it mutates one
  project, runs dependency-ordered tasks, and returns `UpdateModel` deltas. The
  Rust API should mirror this worker/session shape rather than mirroring Vue or
  Pixi UI classes.
- The dependency order is fixed by upstream docs and source:
  `height -> balance -> structure -> aabb -> {junction, roughContour}
  -> {invalidJunction, stretch, traceContour} -> {pattern, patternContour}
  -> graphics`.
- The optimizer is not a loose optional tool. It is a separate C++/WASM
  pipeline using NLopt SLSQP 2.9.1, basin-hopping, hierarchy-aware random
  initial layouts, greedy grid fitting, progress events, interruption, and
  rectangular/diagonal sheet constraints.
- Upstream ships compiled optimizer artifacts and static `nlopt.slsqp.2.9.1`
  archives in `lib/`. Those artifacts are useful for the oracle, but the Rust
  implementation should not depend on opaque upstream static archives.
- The Rust workspace convention is a split core/wasm pair
  (`oristudio-cp` plus `oristudio-cp-wasm`, `treemaker-core` plus
  `treemaker-wasm`). Follow that convention here with `oristudio-bp` and
  `oristudio-bp-wasm`.
- BP's `Fraction` is not a generic arbitrary-precision rational. It is a
  number-backed rational with BP-specific continued-fraction conversion,
  normalization thresholds, mutation behavior, JSON output, and overflow
  avoidance. Port it directly as a custom `BpFraction` before depending on a
  generic rational crate.
- `.bps` JSON can target byte-for-byte output if Rust DTO field order, optional
  omission, and JSON formatting match upstream `JSON.stringify`. `.bpz` should
  compare by canonical decompressed file map unless zip metadata/compression can
  be made byte-stable.
- Upstream tests already cover data structures, migration, constants, math,
  tree, area tree, junctions, geometry, sweep/polybool, contours, traces,
  patterns, CP export, TreeMaker import, and optimizer fixtures. The Rust port
  should promote these into oracle-backed Rust tests as each stage lands.

### Target Crate

Add a separate Rust crate:

- `crates/oristudio-bp`

Do not put this functionality into `oristudio-cp`. That crate is already the
Oriedita-compatible crease-pattern editing kernel. Box Pleating Studio owns a
different model: tree/flap layout, GOPS/stretch pattern search, contour
generation, CP export, and optimizer workflows.

Likely crate modules:

- `model`: BP Studio project model, sheets, grids, tree nodes, edges, flaps,
  stretches, repositories, configurations, patterns, devices, gadgets, pieces,
  history records, and versioned file DTOs.
- `error`: typed `UnsupportedOperation`, `NotImplemented`, `InvalidInput`,
  `IncompatibleProject`, `OptimizationFailed`, and oracle mismatch errors.
- `data`: heaps, double maps, diff sets, union-find, and cache helpers where
  existing Rust equivalents do not preserve ordering or mutation semantics.
- `math`: rational arithmetic, GOPS/Kamiya generation, matrix/vector/point/line
  geometry, winding, point-in-polygon, and numeric epsilon behavior.
- `sweep`: BP Studio's sweep-line clipping, overlap detection, axis-aligned
  union, general polygon union, rounded-rectangle intersection, and stacking.
- `tree`: BP tree construction, root balancing, leaf lists, structural
  distances, AABB hierarchy, and hierarchy generation for the optimizer.
- `engine`: dependency-ordered update pipeline and update-result payloads.
- `layout`: junction validity, invalid-overlap polygons, stretch grouping,
  repositories, node sets, configuration search, partition handling, device
  generation, pattern positioning, joins, tracing, and contour composition.
- `io`: `.bps` project JSON, `.bpz` workspace zip, historical migrations,
  TreeMaker v5 import compatibility, `.cp` export, and FOLD 1.1 export.
- `optimizer`: BP Studio optimizer request/result types, SLSQP packing,
  basin-hopping, hierarchy-aware random initial layouts, greedy grid fitting,
  progress events, cancellation, and rectangular/diagonal sheet constraints.
- `oracle`: test-only canonicalization and comparison helpers.

`treemaker-fold` should remain the shared FOLD data layer. `treemaker-core` can
be used as an integration reference for TreeMaker imports, but BP Studio's
project model should not be merged into the TreeMaker engine.

Add a separate WASM crate following existing workspace conventions:

- `crates/oristudio-bp-wasm`

The WASM crate should store `BpSession` handles behind integer IDs, like
`oristudio-cp-wasm`, and expose project loading, command execution,
snapshots/update deltas, exports, optimizer progress/cancellation, and status
descriptors through `serde-wasm-bindgen`.

### Recommended Architecture

Use four layers:

1. **Vendored oracle source:** `third_party/box-pleating-studio` is an
   unmodified pinned upstream snapshot, including MIT notices and optimizer
   oracle artifacts.
2. **Oracle tooling:** `tools/bp-studio-oracle` wraps the vendored source with a
   Bun-first/Node-compatible CLI for fixtures, command traces, optimizer
   requests, random tree batches, and canonical comparison.
3. **Rust kernel:** `crates/oristudio-bp` owns DTOs, migrations, command
   history, worker-session state, geometry, pattern search, optimizer, imports,
   exports, and canonicalization helpers.
4. **WASM bridge:** `crates/oristudio-bp-wasm` exposes stable browser-worker
   entrypoints and keeps frontend integration out of the kernel.

The central Rust type should be a session object, tentatively:

- `BpSession::new_empty()`
- `BpSession::load_project_json(...)`
- `BpSession::load_workspace_zip(...)`
- `BpSession::load_treemaker_v5(...)`
- `BpSession::apply_command(...) -> UpdateModel`
- `BpSession::complete_stretch(...)`
- `BpSession::switch_config(...)`
- `BpSession::switch_pattern(...)`
- `BpSession::move_device(...)`
- `BpSession::export_bps()`
- `BpSession::export_bpz(...)`
- `BpSession::export_cp(...)`
- `BpSession::export_fold(...)`
- `BpSession::optimize(...) -> OptimizerEvents + OptimizerResult`

Public APIs should return typed errors:

- `BpError::UnsupportedOperation { upstream, reason }` for known but unported
  behavior.
- `BpError::UpstreamGap { upstream, todo }` for behavior BP Studio itself marks
  as TODO/not implemented.
- `BpError::InvalidInput`, `BpError::IncompatibleProject`,
  `BpError::OptimizationFailed`, and `BpError::OracleMismatch` for concrete
  failures.

Internal algorithms may still use `Option`, `bool`, or null-like results when
that is how BP Studio structures control flow, but public command/session
boundaries should be typed and inspectable.

### Status Values

- `Unsupported`: known behavior, not ported.
- `Porting`: implementation started, parity incomplete.
- `Unit-tested`: Rust tests exist, oracle coverage incomplete.
- `Oracle-tested`: Rust behavior matches the pinned BP Studio oracle for
  committed fixtures.
- `Documented-difference`: intentional difference with written rationale.
- `Upstream-gap`: BP Studio itself marks the behavior as TODO/not implemented.
- `Out-of-scope-ui`: Vue/Pixi/PWA presentation behavior that does not belong in
  the Rust kernel, though the kernel may need to expose data for equivalent UI.

Default status for every item is `Unsupported` unless a later stage updates it.

### Source Map

| Upstream path | Behavior | Rust target | Status |
| --- | --- | --- | --- |
| `src/shared/json/*` | Project, tree, layout, history, pattern, and versioned DTOs. | `model`, `io::bps` | Unit-tested |
| `src/shared/types/{constants,direction,geometry,cp}.ts` | Points, paths, contours, arc paths, directions, CP line types, and hard-limit constants. | `shared`, `model`, `math`, `sweep` | Unit-tested |
| `src/shared/types/*.d.ts` and type-only aliases | TypeScript declaration/type helper surface. | Rust static types | Documented-difference |
| `src/shared/data/*` | Heaps, RAVL/AVL/RB trees, double maps, diff sets, union-find. | `data` | Unit-tested |
| `src/shared/utils/{array,color,map,pattern,set}.ts` | Shared array/map/set/scalar helpers with observable behavior. | `shared` | Unit-tested |
| `src/shared/utils/{clone,copy}.ts` | JavaScript structural clone/copy helpers. | Rust `Clone` and serde-owned values | Documented-difference |
| `src/client/patches/*` | File migrations `beta`, `rc0`, `rc1`, `0`, `0.4`, `0.6`, `0.7`, and hard-limit checks. | `io::migrations` | Unit-tested |
| `src/app/services/importService.ts` | `.bps` JSON and `.bpz` workspace opening semantics. | `io::bps`, `io::bpz` | Unit-tested |
| `src/app/services/exportService.ts` | `.bps` and `.bpz` writing semantics. | `io::bps`, `io::bpz` | Unit-tested |
| `src/client/project/changes/{commands/*,step.ts}` | Command JSON, signatures, field/move coalescing, edit commands, mementos, step serialization, and partial operation results. | `engine::history` | Unit-tested |
| `src/client/project/changes/history.ts` | History queue/flush, selection tags, save index, max history depth, undo/redo truncation. | `engine::history::HistoryManager` | Porting |
| `src/client/project/components/grid/*` | Rectangular and diagonal sheets, constraints, grid transforms. | `grid` | Unit-tested |
| `src/client/project/components/sheet.ts` pure helpers | Subdivide, rotate, flip, relative-point scaling, and image dimension math. | `grid` | Unit-tested |
| `src/client/project/components/tree/*` | Interactive tree component behavior and dual layout mapping. | `tree`, `engine::commands` | Unsupported |
| `src/client/project/components/layout/*` | Flaps, rivers, stretches, device movement, layout transforms. | `layout`, `engine::commands` | Unsupported |
| `src/core/controller/treeController.ts` | Tree edit, leaf add/remove, join/split/merge, child-id lookup, and optimizer hierarchy requests. | `engine::BpSession tree commands` | Unit-tested |
| `src/core/controller/designController.ts` | Design init/update request surface for tree/flap/edge/stretches. | `engine::BpSession design init/update` | Porting |
| `src/core/controller/layoutController.ts` | Layout CP/config/pattern/device operations. | `layout`, `engine::api` | Unsupported |
| `src/core/service/{updateModel.d.ts,updateResult.ts}` | Update payload DTOs, ordered record fields, accumulator methods, tree export, and flush reset. | `engine::update` | Unit-tested |
| `src/core/service/processor.ts` | Dependant-task priority calculation, heap-set scheduling, and successful-run state reset. | `engine::processor` | Unit-tested |
| `src/core/service/state.ts` | Persistent/semi-persistent/temporary state containers and reset/full-reset semantics. | `engine::state` | Unit-tested |
| `src/core/design/context/{tree,treeNode,treeUtils}.ts` | BP tree nodes, root balancing, editing, distances, BFS JSON, and distance maps. | `tree::BpTree` | Unit-tested |
| `src/core/design/context/aabb/{aabb,aabbSide}.ts` | AABB side margins, child propagation, rounded-rect/path conversion. | `tree::Aabb` | Unit-tested |
| `src/core/design/context/areaTree/*` | Optimizer hierarchy area tree, area balancing, and hierarchy expansion. | `tree::AreaTree`, `optimizer::hierarchy` | Unit-tested |
| `src/core/design/context/index.d.ts` | TypeScript tree/context declarations. | Rust tree/model static types | Documented-difference |
| `src/core/design/tasks/{height,balance,structure,aabb}.ts` | Tree height, root balancing, distance/leaf recompute, and AABB propagation tasks. | `tree::BpTree::recompute` | Unit-tested |
| `src/core/design/tasks/invalidJunction.ts` | Invalid junction diff/update task and polygon emission. | `layout::InvalidJunction plus engine task TODO` | Porting |
| `src/core/design/tasks/stretch.ts` | Stretch grouping, covering checks, create/update/remove shell. | `layout::{group_junctions, uncovered_junction_indices, LayoutStretch}` | Porting |
| `src/core/design/tasks/*` | Remaining ordered update pipeline: junctions, stretches, patterns, contours, graphics. | `engine::tasks` | Unsupported |
| `src/core/design/layout/junction/validJunction.ts` | Valid junction construction, covering, oriented JSON, and structure signatures. | `layout::ValidJunction` | Unit-tested |
| `src/core/design/layout/junction/{junction,invalidJunction}.ts` | Valid/invalid branch selection, canonical id ordering, invalid junction polygons, and processed state. | `layout::{create_junction, InvalidJunction}` | Unit-tested |
| `src/core/design/layout/stretch.ts` | Stretch lifecycle, repository caching, completion. | `layout::LayoutStretch` | Porting |
| `src/core/design/layout/repository.ts` | Repository signatures, quadrants, node sets, validity, origin updates, generated configuration storage, and tree-aware init/complete lifecycle. | `layout::LayoutRepository` | Porting; restored selected pattern initialization is unit-tested |
| `src/core/design/layout/nodeSet.ts` | Covered nodes, quadrant coverage, LCA/distance lookup. | `layout::NodeSet` | Unit-tested |
| `src/core/design/layout/store.ts` | Lazy generator cache and completion state. | `layout::Store` | Unit-tested |
| `src/core/design/layout/configuration.ts` | Partitions, overlap cleanup, overlap map, serialization shell, pattern store, side diagonals, free corners. | `layout::LayoutConfiguration` | Porting |
| `src/core/design/layout/partition.ts` | Corner maps, connection targets, exposed overlaps, constraints, external corners. | `layout::LayoutPartition` | Porting |
| `src/core/design/layout/generators/configGeneratorContext.ts` | Temporary overlap ids, junction-to-overlap conversion, x/y cuts, configuration make cleanup/raw handling. | `layout::generators::ConfigGeneratorContext` | Unit-tested |
| `src/core/design/layout/generators/searchUtils/relay.ts` | Relay x/y partition rewrites, split filtering, strategy variants, shifted non-oriented relays. | `layout::generators::search_relay` | Unit-tested |
| `src/core/design/layout/generators/searchUtils/splitJoin.ts` | Split item extraction, cover checks, exposed remaining partitions, join mutation side effect. | `layout::generators::{to_split_items, get_exposed_part}` | Unit-tested |
| `src/core/design/layout/generators/*` | Config search, single/double relay, general multi-junction search, ranked search. | `layout::generators` | Porting |
| `src/core/design/layout/generators/generalConfigGenerator.ts` | Rank-bucket general search, first-valid filtering, and prototype signature skip for the upstream-supported one-joint/two-junction case. | `layout::generators::general_config_generator` | Porting |
| `src/core/design/layout/generators/generalConfigGeneratorContext.ts` | Junction-code grouping, rank combinations, relay/join/relay-join/split-join search, and upstream one-joint/two-junction precondition gate. | `layout::generators::GeneralConfigGeneratorContext` | Porting |
| `src/core/design/layout/generators/deviceGenerator.ts` | Single-overlap GOPS, universal GPS with finite no-fit guard, Kamiya half-integral, simple/base/standard joins. | `layout::generators::device_generator` | Porting |
| `src/core/design/layout/generators/deviceGenerator.ts` | General device generation for more than two overlaps. | `layout::devices` | Upstream-gap |
| `src/core/design/layout/joiner/*` | Joinee construction, relay-join intersections, simple/base/standard join logic. | `layout::joiner` | Porting |
| `src/core/design/layout/pattern/quadrant.ts` | Quadrant metadata, ordering, basic validity, overlap-corner geometry, and tracing start/end points. | `layout::Quadrant` | Porting |
| `src/core/design/layout/pattern/region.ts` | Region contour/ridge shape and axis-parallel crease generation. | `layout::pattern::axis_parallels` | Unit-tested |
| `src/core/design/layout/pattern/piece.ts` | Piece SCR dimensions, anchors, direction, contour, detours, reverse, shrink. | `layout::pattern::PatternPiece` | Unit-tested |
| `src/core/design/layout/pattern/addOn.ts` | Add-on contour/ridges, reduced direction, and axis-parallel behavior. | `layout::pattern::PatternAddOn` | Unit-tested |
| `src/core/design/layout/pattern/gadget.ts` | Gadget pieces, sparse anchors, slacks, spans, contours, reverse GPS, connection slack. | `layout::pattern::PatternGadget` | Porting |
| `src/core/design/layout/pattern/device.ts` | Device assembly, transformed anchors, local/transformed regions/ridges/contours, signature, and movement shell. | `layout::pattern::PatternDevice` | Porting |
| `src/core/design/layout/pattern/pattern.ts` | Seeded pattern assembly, flattened gadgets, origin-dirty shell, positioning dispatch, connection targets, and initialized device ridge extraction. | `layout::pattern::LayoutPattern` | Porting |
| `src/core/design/layout/pattern/positioners/singleJunctionPositioner.ts` | Single-junction positioning; one or two devices supported. | `layout::pattern::LayoutPattern` | Porting |
| `src/core/design/layout/pattern/positioners/singleJunctionPositioner.ts` | Integral single-junction patterns needing four or more devices. | `layout::position` | Upstream-gap |
| `src/core/design/layout/pattern/positioners/twoJunctionPositioner.ts` | Two-junction relay, split-join positioning, join-device push, relative delta checks, and slack/span offset calculations. | `layout::pattern::LayoutPattern::new_positioned_with_repo` | Porting |
| `src/core/design/layout/pattern/positioners/twoJunctionPositioner.ts` | More general two-junction positioning. | `layout::position` | Upstream-gap |
| `src/core/design/layout/trace/hingeSegment.ts` | Hinge contour segmentation by slash direction. | `layout::trace::create_hinge_segments` | Unit-tested |
| `src/core/design/layout/trace/{trace,traceContext}.ts` | Ridge filtering, reflection tracing, start/end resolution, raw-mode checks. | `layout::trace::Trace` | Unit-tested |
| `src/core/design/layout/trace/repoTrace.ts` | Repository pattern-ridge trace context and start/end resolution. | `layout::trace::RepoTrace` | Porting |
| `src/core/design/tasks/roughContour.ts` | Rough axis-aligned contours, path expansion, simplification, RoughUnion grouping, child preservation, and leaf propagation. | `layout::contours` | Porting; full bottom-up headless rough construction is unit-tested |
| `src/core/design/tasks/traceContour.ts` | Critical-corner detection, shared-leaf grouping, and raw contour splitting. | `layout::contours` | Porting; critical-corner collection and recursive trace-contour construction are unit-tested |
| `src/core/design/tasks/patternContour.ts` | Pattern contour start/end maps, hinge processing, trace output metadata, and raw-component skip behavior. | `layout::contours` | Porting; repository/node orchestration and no-pattern skip are unit-tested |
| `src/core/design/tasks/utils/combine.ts` | Rational contour composition, pattern contour insertion, role rearrangement, raw-mode general union, cleanup, stacking, graphical contour output. | `layout::contours` | Unit-tested; extended graphical contours preserve outer path metadata for graphics/CP consumers |
| `src/core/design/tasks/graphics.ts` | Flap/river/device graphics payloads and final ridges. | `layout::graphics` | Unit-tested |
| `src/core/math/fraction.ts` | Number-backed rational arithmetic and overflow normalization quirks. | `math::rational` | Unit-tested |
| `src/core/math/invalidParameterError.ts` | Fraction invalid-parameter exception. | `math::rational`, `BpError::InvalidInput` | Unit-tested |
| `src/core/math/gops.ts` | Integral GOPS search and ranking. | `math::gops` | Unit-tested |
| `src/core/math/kamiya.ts` | Half-integral Kamiya gadget search. | `math::kamiya` | Unit-tested |
| `src/core/math/geometry/*` | Point, vector, matrix, line, rational paths, winding, rectangles. | `math::geometry` | Unit-tested |
| `src/core/math/sweepLine/stacking/stacking.ts` | Non-intersecting path stacking and contour grouping. | `sweep::stacking` | Unit-tested; extended stacker preserves original path metadata |
| `src/core/math/sweepLine/clip/clip.ts` | CP clipping, intersection subdivision, duplicate-line filtering, and border/crease inside rules. | `sweep::clip` | Unit-tested |
| `src/core/math/sweepLine/clip/{overlap,overlapIntersector}.ts` | Cross-polygon overlap detection, same-polygon floating-error skip, and BP containment quirk. | `sweep::overlap` | Unit-tested |
| `src/core/math/sweepLine/polyBool/aaUnion/{aaUnion,aaEventProvider,aaIntersector}.ts` | Axis-aligned polygon union, self-intersection mode, event keys, and AA intersections. | `sweep::aa_union` | Unit-tested |
| `src/core/math/sweepLine/polyBool/aaUnion/roughUnion.ts` | Rough contour connected components, source grouping, and hole marking. | `sweep::rough_union` | Unit-tested |
| `src/core/math/sweepLine/polyBool/generalUnion/{generalUnion,generalComparators,generalEventProvider,generalIntersector}.ts` | General polygon union, enter-first ordering, relaxed-epsilon intersections, and epsilon path chaining. | `sweep::general_union` | Unit-tested |
| `src/core/math/sweepLine/{classes/chainer/arcChainer,classes/segment/arcSegment,polyBool/rrIntersection/*}.ts` | Rounded-rectangle intersection, arc sweep comparison, arc/line subdivision, and arc-path reconstruction. | `sweep::rr_intersection` | Unit-tested |
| `src/core/math/sweepLine/{sweepLine,divideAndCollect,classes/event*,classes/intersector,classes/orientation,polyBool/{polyBool,unionBase,initializer,index}}.ts` | Shared TypeScript sweep-line class hierarchy. | Concrete Rust sweep modules | Documented-difference |
| `src/client/plugins/cp/*` | Clipped CP generation, 400-unit transform, `.cp` export, FOLD 1.1 export. | `io::cp`, `io::fold_export` | Porting; 400-unit transform, BP floating cleanup, ORIPA `.cp`, FOLD 1.1 JSON, assignment/fold-angle mapping, line component helpers, stretch-free project export, generated active-stretch export, and materialized-graphics project export are unit-tested |
| `src/client/plugins/treeMaker/*` | TreeMaker v5 import into BP project. | `io::treemaker_import` | Unit-tested |
| `src/client/plugins/optimizer/*` | Browser worker bridge, progress events, cancellation, request/result conversion. | `optimizer::api` | Unit-tested; request creation, view/random layout DTOs, request-aware packing validation, template writing, seed guardrail, progress report collection, and native cancellation boundary are unit-tested |
| `src/client/plugins/optimizer/src/*` | C++ NLopt SLSQP optimizer, basin-hopping, random candidates, greedy grid fitting, sheet constraints. | `optimizer` | Oracle-tested for packing validity; exact coordinate differences are classified as valid-different |
| `test/specs/*` | Upstream unit and integration fixtures. | `tools/bp-studio-oracle`, Rust tests | Unsupported |
| `e2e/*`, `src/app/vue/*`, `src/client/screen/*` | Browser/Pixi/Vue rendering, menus, dialogs, PWA behavior. | App integration later | Out-of-scope-ui |

### Oracle Strategy

Use BP Studio as the behavioral oracle. Prefer byte-for-byte comparison where
the output format and metadata make that stable; otherwise compare canonical
semantic output.

Add `third_party/box-pleating-studio` as a pinned source snapshot plus
preserved MIT notices, and add `tools/bp-studio-oracle` as the wrapper for
building and invoking the vendored oracle.

The oracle should expose a Bun-first, Node-compatible headless CLI that can:

- Load `.bps`, `.bpz`, TreeMaker v5, and compact JSON fixtures.
- Apply deterministic command sequences for tree, flap, sheet, stretch,
  configuration, pattern, device, and export operations.
- Return canonical project/update-model/stretch/graphics/CP/FOLD/optimizer
  payloads.
- Run BP Studio's upstream Mocha fixtures as a baseline health check.
- Generate deterministic random tree batches and compare hundreds of resulting
  packings side by side against the Rust port.

Comparison should canonicalize:

- Project JSON ordering, optional session-only fields, and mementos.
- Floating-point output using BP Studio's own precision rules where relevant.
- Rational paths and contours by exact numerator/denominator where possible.
- Polygon path rotation/orientation where semantic equality allows it.
- Device, configuration, and pattern order only where upstream order is
  behaviorally significant.
- Optimizer outputs by exact result for fixed seeds where stable. When the Rust
  optimizer produces a different integer placement, compare all observable
  request constraints and final packing validity, then classify the result as
  `valid-different` rather than a mismatch.

Oracle-gated tests should not be required for the default Rust test run:

- `cargo test -p oristudio-bp`
- `wasm-pack test --node crates/oristudio-bp-wasm`
- `BP_STUDIO_ORACLE=tools/bp-studio-oracle/build/... cargo test -p oracle-tests --test bp_studio_oracle`
- `cargo test -p oristudio-bp --test optimizer_oracle optimizer_batch_produces_valid_packings_against_bp_studio_oracle -- --ignored --nocapture`
- `BP_STUDIO_CORPUS=/private/path cargo test -p oristudio-bp --test optimizer_oracle optimizer_external_corpus_produces_valid_packings_when_enabled -- --ignored --nocapture`

The oracle should have four fixture classes:

- **Upstream fixtures:** direct translations of `test/specs/*` and
  `test/samples/*`.
- **Command traces:** deterministic sequences of tree/layout/history commands
  that compare `UpdateModel`, session JSON, history, graphics, stretches, and
  exported files after each step.
- **Optimizer fixtures:** upstream optimizer requests, fixed seeds, progress
  logs, interruption paths, final integer layouts, and failure statuses.
- **Random trees:** deterministic generated tree batches that run BP Studio and
  Rust side by side, classify exact versus valid-different layouts, and fail on
  invalid complete packings.

Use Bun for custom oracle commands where it can execute vendored modules
directly. Keep Node/pnpm available for upstream Mocha tests because BP Studio's
test loader and build scripts are Node-oriented.

### Recommended Optimizer Path

The optimizer should be ported as a first-class Rust module, not called through
upstream JavaScript/WASM at runtime.

Recommended path:

1. Add an optimizer parity spike before implementing the full layout engine.
   Feed the same upstream `OptimizerRequest` fixtures to:
   - vendored BP Studio optimizer oracle,
   - a native Rust probe using the `nlopt` crate or direct NLopt 2.9.1 linkage,
   - a Rust SLSQP candidate based on the MIT `slsqp` crate and/or a direct port
     of the NLopt 2.9.1 SLSQP subset.
2. Use the native NLopt probe only to understand parity. Do not make the shipped
   WASM/browser kernel depend on full NLopt unless the release/license
   implications are explicitly accepted.
3. Prefer a local Rust SLSQP implementation for production/WASM. Start from the
   minimal SLSQP surface BP Studio uses: scalar and vector constraints,
   lower/upper bounds, maxeval `200`, `xtol_abs1 = 1e-6`, `ftol_abs = 1e-5`,
   BP's success/failure status interpretation, and BP's objective/gradient
   callbacks.
4. Port BP's optimizer pipeline around SLSQP directly:
   - `Problem`, `Hierarchy`, `Parent`, and `Flap`.
   - rectangular/diagonal sheet constraints.
   - circle, rounded, and fixed constraints.
   - pre-solve scale setup.
   - basin-hopping parameters and acceptance behavior.
   - hierarchy-aware random candidate generation.
   - greedy integer grid fitting and fallback annulus search.
   - progress events: `start`, `pack`, `cont`, `fit`.
   - cancellation/interruption checks.
5. Port BP's random source deliberately. Upstream uses `std::srand(seed)` and
   `std::rand()` inside Emscripten-built C++; Rust `rand` will not be identical.
   Measure the vendored oracle's random sequence and implement a matching
   BP-specific PRNG for deterministic parity.
6. Parallelism is optional for parity but not for event ordering. First match
   single-threaded deterministic behavior; then add optional native parallelism
   only if it preserves chosen oracle outputs or is hidden behind an explicit
   documented mode.

External optimizer findings:

- NLopt documents the combined library as LGPL, even though portions have looser
  licenses.
- The `nlopt` Rust crate is MIT but bundles NLopt 2.9.1, so the underlying
  native library license still matters for distribution.
- The `slsqp` Rust crate is MIT and is adapted from NLopt 2.7.1's SLSQP path,
  which makes it a useful candidate/reference, but it is not automatically
  parity-equivalent to BP Studio's NLopt 2.9.1 build.
- A first Rust adapter around the `slsqp` crate can reproduce BP's local packer
  bounds/objective/status surface for unconstrained cases, but the public crate
  API does not expose equality constraints and an active circle-constraint
  smoke case currently reports `RoundoffLimited` instead of a positive NLopt
  status. Keep this as a parity spike path until equality constraints and
  active-constraint statuses are proven or a local NLopt-SLSQP subset is
  exposed directly.
- The `slsqp-rssl` crate is MIT, pure Rust, and supports equality constraints.
  It succeeds on a minimal active circle-constraint case and a fixed-coordinate
  equality case, but it estimates derivatives by finite differences instead of
  using BP's explicit NLopt callbacks. Treat it as the practical greedy-fitting
  candidate while oracle parity is measured, not as a final equivalence proof.
- The first single-threaded greedy integer-fitting pass on top of the
  `slsqp-rssl` adapter matches the pinned BP optimizer oracle for a two-flap
  rectangular active-distance view-mode case. The tie-break rule must preserve
  BP's strict first-best behavior when multiple branches have equal scale.
- The public Rust/WASM `solve` boundary now supports the proven view-layout
  non-basin-hopping slice and still returns explicit unsupported errors for
  random layouts and basin-hopping. Keep widening this boundary only after each
  optimizer path has oracle-backed parity.
- BP's Emscripten optimizer uses musl's `rand()`/`srand()` stream. The Rust
  optimizer now has a matching `BpRandom` generator for deterministic
  basin-hopping and random-candidate parity work.
- View-mode basin-hopping is now ported over the equality-capable adapter with
  BP's adaptive-step and Metropolis parameters. It matches the pinned oracle for
  the simple two-flap view fixture with seed `0`; random layout still requires
  hierarchy-aware candidate generation before the public random path can open.
- Random layout candidate generation and sequential global basin-hopping are now
  ported over the BP random stream. The Rust and WASM public solve boundaries
  match the pinned oracle for a simple two-flap random fixture with seed `0`.
- Additional optimizer oracle coverage now includes the committed one-flap
  random fixture, dimensioned rectangular flaps, and diagonal sheet output.
- A deterministic ignored optimizer oracle batch now compares 410 fixed-seed
  cases against the pinned BP Studio optimizer artifact: two-flap view/random
  fixtures plus 200 generated random-tree requests with three to six leaves.
  The current run reports `exact=209`, `valid_different=201`, and zero invalid
  packings under the request-aware validator. Coordinate drift is therefore a
  documented diagnostic, not a blocker, as long as the result satisfies the
  sheet and tree-distance constraints.
- The request-aware validator checks finite integer dimensions/anchors,
  positive sheet dimensions, diagonal-sheet squareness, one result per requested
  flap id, anchor bounds, and all final hierarchy distance constraints. It
  intentionally validates the flap anchor against the sheet, not the full
  dimensioned rectangle, because BP Studio's own dimensioned rectangular fixture
  permits an anchor on the sheet boundary with nonzero flap dimensions. Mark
  full-rectangle containment as a future product question, not an initial-port
  requirement.
- A follow-up local SLSQP equality spike was intentionally rejected. Encoding
  fixed coordinates as paired inequalities reduced exact-coordinate differences
  slightly, but it relies on a non-BP equality approximation and can return
  `RoundoffLimited` where BP intentionally treats the layout as a failure.
  Vendoring the MIT `slsqp` crate with vector equality support matched BP's
  fixed-constraint callback shape more closely, but changed an existing
  dimensioned rectangular view oracle placement from `(10, 9)` to `(10, 10)`.
  Both variants were reverted rather than shipping a hybrid solver solely for
  coordinate identity.
- `argmin` is pure Rust and MIT/Apache-2.0, but it is a framework/library, not a
  direct BP Studio SLSQP parity implementation. Treat it as a possible support
  dependency only if the local SLSQP path fails.

### Major Complications To Track

- **Upstream gaps:** BP Studio itself has TODO paths for generalized pattern
  positioning and multi-overlap/multi-joint cases. These should be tracked as
  `Upstream-gap` or `Unsupported`, not approximated.
- **Optimizer dependency:** The upstream optimizer depends on NLopt SLSQP plus
  Emscripten/OpenMP behavior. The complete port must include optimizer
  functionality. Acceptable paths are linking/porting the upstream-compatible
  optimizer stack or using a Rust optimization library only when it can preserve
  BP Studio behavior under oracle tests.
- **Exact arithmetic:** Pattern geometry depends on rational `Fraction`,
  rational paths, and exact line intersections. A float-only Rust port is not
  acceptable for the kernel.
- **Incremental worker state:** Upstream separates Client validation from Core
  mutation and relies on persistent/semi-persistent/temporary state sets for
  performance. Rust APIs need typed validation while preserving equivalent
  update semantics.
- **Search ordering:** Configuration and pattern generators are ranked and
  lazy. Early first-pattern results and later complete-repository results are
  observable behavior.
- **Contour algorithms:** Rough contours, raw-mode splitting, tracing, polygon
  union, and stacking are tightly coupled. Porting only CP line emission without
  the contour path would miss real functionality.
- **File compatibility:** Historical `.bps` migrations and hard-limit checks
  affect user files. Importing only current JSON would be incomplete.
- **TreeMaker overlap:** This repo already has a TreeMaker parser/engine. The
  initial BP Studio TreeMaker v5 import should be a direct BP Studio parser port
  for parity, with later comparison against `treemaker-core` once behavior is
  locked.
- **History semantics:** Undo/redo coalescing, mementos, partial failures, and
  selection tags are app-facing behavior, but they are still part of the Rust
  port so headless command sessions match upstream.
- **Progress/cancellation:** Optimizer and lazy pattern completion need progress
  and cancellation APIs that work natively and through WASM.
- **Performance:** The TS implementation uses specialized heaps, RAVL trees,
  sweep-line algorithms, caches, and early exits. A direct but naive port may be
  functionally correct but unusable interactively.
- **Licensing:** BP Studio is MIT, but this workspace is GPL because of the
  TreeMaker port. Optimizer dependency licensing and source distribution need a
  release review before publishing artifacts.

### Byte Parity Policy

Target byte-for-byte output where stable:

- `.bps` JSON after migration/load/save round trips.
- `.cp` text export line ordering and float formatting.
- FOLD JSON field ordering, assignment ordering, vertex indexing, and fold
  angles.
- Optimizer integer result payloads and deterministic progress logs where the
  solver path is stable.

Use canonical semantic parity where byte identity is not stable or not
meaningful:

- `.bpz` zip container bytes, unless compression metadata can be controlled
  exactly; compare decompressed path names and file contents first.
- Floating values that BP emits through JavaScript formatting and Rust emits
  through serde; if byte formatting differs, document the formatting rule and
  compare canonical numbers.
- Equivalent polygon paths whose rotation/orientation is semantically
  irrelevant, but only when BP Studio itself treats them as equivalent.
- Valid-different optimizer placements that satisfy the same sheet and
  tree-distance constraints but choose a different integer arrangement.
- Parallel optimizer event interleavings if optional parallel execution is added
  after deterministic single-thread parity is established.

## Affected Areas

- New `crates/oristudio-bp` Rust crate.
- New `crates/oristudio-bp-wasm` Rust/WASM bridge crate.
- `crates/oracle-tests` for BP Studio oracle parity tests.
- `tools/bp-studio-oracle` and `third_party/box-pleating-studio`.
- `implementation-plans/box-pleating-studio-source-map.md` for generated
  file-level parity tracking.
- `crates/treemaker-fold` for shared FOLD output reuse if needed.
- `crates/oristudio-bp-wasm` for browser-worker bindings.
- `apps/web` only after the Rust crate exposes stable command/export APIs.
- `LICENSING.md` if vendoring or linking optimizer dependencies changes the
  dependency inventory.

## Implementation Plan

### Stage 0: Implementation-Start Setup

Goal: make the repository ready for safe implementation.

- Vendor `third_party/box-pleating-studio` at
  `d86f8051812458b2c7b1ed7fac49fe7dc1d4dad4`.
- Preserve upstream MIT notices and record optimizer artifact/license notes in
  `LICENSING.md`.
- Add a generated source-map/parity matrix that enumerates every relevant
  vendored source/test file with owner module, status, and notes. UI files can
  be `Out-of-scope-ui`, but any non-UI data contract needed for future frontend
  wiring must point to a Rust target.
- Scaffold `tools/bp-studio-oracle` with a Bun-first custom CLI and Node/pnpm
  fallback for upstream Mocha health checks.
- Add seed fixtures for migrations, `.bps`, `.bpz`, CP, FOLD, TreeMaker import,
  optimizer, and random-tree generation.

Exit gate:

- `git diff --check`
- Vendored source commit and license recorded.
- Oracle CLI can print upstream version/commit and run at least one fixture.
- Source map exists and defaults all unported non-UI behavior to `Unsupported`.

### Stage 1: Crate Skeleton And File Model

Goal: lock the public model and unsupported/error behavior before algorithms.

- Add `crates/oristudio-bp` and `crates/oristudio-bp-wasm`.
- Define typed DTOs for current `JProject`, `JDesign`, `JLayout`, `JTree`,
  components, history, pattern, sheet/grid, and command payloads.
- Implement `BpError`, status descriptors, and unsupported/upstream-gap
  reporting.
- Implement `.bps` current-version JSON parse/serialize with field-order and
  optional-field behavior chosen for BP compatibility.
- Implement full migration chain: unversioned, `beta`, `rc0`, `rc1`, `0`,
  `0.4`, `0.6`, `0.7`, and hard-limit checks.
- Implement `.bpz` read/write as canonical workspace maps.
- Scaffold WASM handle storage and basic load/snapshot/free APIs.

Exit gate:

- Rust unit tests for DTO serialization and all migration samples.
- Oracle tests for migration fixtures and simple `.bps`/`.bpz` round trips.
- WASM node test can load a project and return a snapshot.

### Stage 2: Shared Data, Exact Math, And Geometry

Goal: port foundations with direct tests before layout logic depends on them.

- Port heap variants, heap sets, diff sets, double maps, valued double maps,
  union-find, BST/AVL/RAVL/RB semantics where BP order matters.
- Port `BpFraction` directly, including continued-fraction conversion,
  normalization thresholds, JSON/string output, and mutation semantics.
- Port points, vectors, matrices, lines, rectangles, rational paths, winding,
  point-in-polygon, float epsilon helpers, GOPS, and Kamiya generation.
- Port sweep-line primitives, clipping, overlap detection, axis-aligned union,
  rounded-rectangle intersection, general union, and stacking.

Exit gate:

- Rust unit tests translated from upstream data/math/geometry specs.
- Oracle tests for rational path, line intersections, sweep/polybool, GOPS, and
  Kamiya fixtures.

### Stage 3: Tree, Engine, Commands, And History

Goal: reproduce the BP worker/session model.

- Port tree nodes, tree construction, root balancing, structure/distance maps,
  AABB/area tree, flap dimensions, and sheet/grid constraints.
- Implement persistent, semi-persistent, and temporary state sets.
- Implement dependency-ordered task processor and `UpdateModel`.
- Port tree/layout command validation needed by the frontend-facing API.
- Port command history, command coalescing, mementos, undo/redo, selection tags,
  save index, max history depth, and partial failure truncation.

Exit gate:

- Unit tests for tree, area tree, AABB, command traces, and history JSON.
- Oracle command traces comparing `UpdateModel`, session JSON, history, and
  selections after every command.

### Stage 4: Junctions, Stretches, Repositories, And Search Stores

Goal: reproduce stretch grouping and repository search state.

- Port valid/invalid junctions and invalid-overlap polygons.
- Port stretch lifecycle, repository signatures, node sets, quadrants,
  partitions, origin updates, lazy/ranked stores, and cleanup/cache behavior.
- Preserve upstream TODO/gap behavior as explicit `Upstream-gap` status.

Exit gate:

- Unit/oracle tests for junctions, node sets, repository indexes, stretch
  completion, configuration switching, and dragging cleanup.

### Stage 5: Pattern Search, Devices, Joins, And Positioning

Goal: reproduce all BP-implemented stretch pattern generation.

- Port config generators, filters, single/general config contexts, relay,
  split-join, single/double relay paths, and search ordering.
- Port GOPS/universal GPS/Kamiya device generation, pieces, gadgets, devices,
  add-ons, regions, slacks, anchors, and axis-parallel/ridge outputs.
- Port simple/base/standard joins, joinee construction, join logic, and
  positioning contexts.
- Port single-junction and two-junction positioners exactly where BP supports
  them; keep four-or-more-device and more-general two-junction paths as
  upstream gaps.

Exit gate:

- Upstream pattern/searching/two-flap/three-flap/positioning/rendering specs
  translated or oracle-backed.
- Repository and pattern ordering verified where observable.

### Stage 6: Contours, Graphics, CP, FOLD, And TreeMaker Import

Goal: produce complete headless layout/export behavior.

- Port rough contours, raw contour splitting, hinge segmentation, tracing,
  pattern contours, contour composition, graphical contours, flap/river/device
  graphics, and final ridges.
- Port CP clipping, 400-unit transform, auxiliary/valley hinge option, ORIPA
  `.cp` text output, and FOLD 1.1 export.
- Directly port BP Studio's TreeMaker v5 parser/import path, including scaling,
  denominator LCM, minimum sheet checks, and rounding quirks.

Exit gate:

- Oracle tests for trace/contour specs, CP export specs, FOLD fixtures, and
  TreeMaker sample import.
- `.bps`, `.cp`, and FOLD outputs byte-match where stable.

### Stage 7: Optimizer Port

Goal: reproduce BP Studio optimizer functionality in Rust/WASM.

- Complete the optimizer parity spike and choose the production SLSQP path.
- Port BP optimizer model conversion, constraints, basin-hopping, random
  candidate generation, greedy fitting, progress/cancellation, rectangular and
  diagonal sheets, and fixed-seed behavior.
- Add deterministic BP-compatible PRNG.
- Add WASM progress/cancellation APIs.

Exit gate:

- Upstream optimizer fixtures produce request-valid results for fixed seeds;
  exact result matches are tracked where stable and valid-different layouts are
  reported.
- Native and WASM tests cover success, no-solution failure, interruption, view
  mode, random mode, flap dimensions, rectangular sheet, and diagonal sheet.

### Stage 8: Random Packing Validity And Corpus Harness

Goal: prove the end-to-end headless port, not just isolated components.

- Add deterministic random tree generation against both BP Studio oracle and
  Rust.
- Compare hundreds of generated packings side by side.
- Emit reports for exact matches, valid-different packings,
  unsupported/upstream-gap paths, optimizer nondeterminism, and invalid results.
- Add ignored external corpus support for private `.bps`, `.bpz`, and TreeMaker
  files.

Exit gate:

- Hundreds of deterministic random-tree packings pass request-aware validity
  checks, with exact versus valid-different classifications reported.
- Corpus harness produces actionable mismatch reports without committing private
  files.

### Stage 9: Frontend-Ready API Freeze

Goal: make the headless kernel practical to wire into Ori Studio later.

- Review frontend data contracts from BP presentation code and expose non-UI
  equivalents: graphics payloads, selection tags, candidate previews, progress
  events, command descriptors, unsupported descriptors, and snapshot/delta
  APIs.
- Freeze `oristudio-bp-wasm` worker-facing API shape.
- Document supported, upstream-gap, and unsupported surfaces.

Exit gate:

- Browser/Node WASM tests exercise session load, commands, exports, optimizer,
  cancellation, and random packing fixture entrypoints.
- No React/Vue/Pixi UI code is required by the Rust crates.

## Checklist

- [x] Clone and inspect upstream Box Pleating Studio.
- [x] Record pinned upstream baseline and high-level source map.
- [x] Decide whether the source snapshot is vendored or fetched by oracle setup.
- [x] Research optimizer, file migration, oracle, WASM, and dependency
      complications enough to recommend an implementation sequence.
- [x] Stage 0: Vendor upstream, add oracle scaffold, add generated parity matrix,
      and seed fixtures.
- [x] Stage 1: Scaffold `oristudio-bp`/`oristudio-bp-wasm`, typed errors, DTOs,
      migrations, `.bps`, and `.bpz`.
- [x] Stage 2a: Port BP `Fraction` and integer `gcd`/`lcm` helpers with
      direct unit coverage.
- [x] Stage 2b: Port BP heap, double-map, diff-set, and union-find foundations
      with direct unit coverage.
- [x] Stage 2c: Port BP RAVL search tree predecessor/successor behavior with
      direct unit coverage.
- [x] Stage 2d: Port BP exact geometry primitives for fractions-backed points,
      vectors, matrices, lines, rectangles, and float epsilon helpers.
- [x] Stage 2e: Port BP path, rational-path, point-in-polygon, and winding
      helpers with direct unit coverage.
- [x] Stage 2f: Port BP GOPS and Kamiya generator math with direct unit
      coverage; leave universal GPS/device wrappers for layout stages.
- [x] Stage 2g: Port BP AVL search tree insert/delete/pop/adjacency behavior
      with direct unit coverage.
- [x] Stage 2h: Port BP red-black search tree insert/delete/adjacency behavior
      with direct unit coverage.
- [x] Stage 2i: Port BP sweep-line stacking for non-intersecting paths with
      direct unit coverage; keep clipping, overlap, and polybool unsupported.
- [x] Stage 2j: Port BP overlap detection and overlap intersector behavior,
      including the oracle-confirmed full-containment false result.
- [x] Stage 2k: Port BP CP clipping and subdivision behavior with oracle-confirmed
      count parity for the upstream spec and duplicate-line filtering.
- [x] Stage 2l: Port BP AAUnion event keys, AA segment subdivision, outside-boundary
      collection, and path chaining with direct upstream spec coverage.
- [x] Stage 2m: Port BP RoughUnion source grouping and hole marking with direct
      upstream spec coverage.
- [x] Stage 2n: Port BP GeneralUnion enter-first sweep behavior, relaxed
      general intersections, and epsilon path chaining with direct upstream
      spec coverage.
- [x] Stage 2o: Port BP RRIntersection arc sweep behavior, rounded-rectangle
      intersection, and arc-path reconstruction with direct upstream spec
      coverage.
- [x] Stage 2p: Port shared constants, direction/quadrant encodings, and
      low-level utility helpers; document Rust replacements for type-only and
      structural clone/copy helpers.
- [x] Stage 2: Port shared data structures and exact math/geometry/sweep
      primitives.
- [x] Stage 3a: Port BP tree context, tree node editing, root balancing,
      distances, BFS JSON output, and AABB propagation with direct upstream
      tree spec coverage.
- [x] Stage 3b: Port BP AreaTree optimizer hierarchy simplification, area
      balancing, and hierarchy expansion with direct upstream spec coverage.
- [x] Stage 3c: Port BP update payload/result accumulator, engine state reset,
      and priority task scheduler with direct service-contract coverage.
- [x] Stage 3d: Port BP tree controller and initial `BpSession` design/tree
      command surface with direct command-trace coverage.
- [x] Stage 3e: Port BP command, step, and history queue semantics with direct
      unit coverage; leave project-object mutation wiring for later session/UI
      integration.
- [x] Stage 3f: Port BP rectangular/diagonal sheet grid constraints, transforms,
      and pure sheet geometry helpers with direct unit coverage.
- [x] Stage 3: Port tree, session engine, commands, update payloads, and history.
- [x] Stage 4a: Port BP lazy search store, valid-junction JSON/signature and
      covering semantics, quadrant grouping/geometry foundations, and NodeSet
      LCA/distance coverage with direct unit tests.
- [x] Stage 4b: Port BP junction creation and invalid junction rounded-rectangle
      polygon calculation with direct unit tests; leave State diff/update task
      wiring marked as porting.
- [x] Stage 4c: Port BP stretch grouping, geometric covering checks, repository
      signature/origin/quadrant/NodeSet shell, drag-time repository cache/reuse,
      and unsupported config-search boundary with direct unit tests.
- [x] Stage 4d: Port BP configuration/partition data shells, raw overlap cleanup,
      flat overlap maps, corner maps, constraint/external filters,
      exposed-overlap trimming, resolve-division behavior, and unsupported
      pattern/device boundaries with direct unit tests.
- [x] Stage 4: Port junctions, stretch grouping, repositories, node sets, and
      ranked lazy stores.
- [x] Stage 5a: Port BP pattern region, piece, add-on, and gadget primitives,
      including sparse anchor DTOs, detour substitution, axis parallels,
      contour joining, reverse GPS, ray intersection, and conservative
      connection-slack boundary with direct unit tests.
- [x] Stage 5b: Port BP device and seeded-pattern assembly shells, local
      region/ridge/contour geometry, device signature simplification, offset
      shell behavior, and explicit unsupported boundaries for positioning,
      connection targets, draw/trace ridges, and dragging ranges.
- [x] Stage 5c: Port BP configuration generator context overlap id allocation,
      junction-to-overlap conversion, x/y cuts, raw single-mode configuration
      make, cleanup make, and explicit unsupported config-search boundary.
- [x] Stage 5d: Port BP relay search utility x/y partition rewrites, split
      filtering, strategy-order variants, non-oriented shifts, and
      socket/internal/intersection corner rewrites.
- [x] Stage 5e: Port BP split-join helper cover checks, raw split item
      extraction, horizontal split detection, exposed remaining-part shrinkage,
      intersection replacement, and preserved join-partition mutation side
      effect.
- [x] Stage 5f: Port BP single-overlap device generator paths for GOPS, Kamiya
      half-integral with BP fallthrough behavior, universal GPS scaling/reverse
      slack, DTO conversion, and explicit unsupported join/general boundaries.
- [x] Stage 5g: Port BP positioning context slack setup, junction span checks,
      and single-junction one/two-device positioner behavior with direct unit
      tests, while preserving the four-or-more-device upstream gap.
- [x] Stage 5h: Port BP pattern generator seeded-prototype reuse, device
      cartesian search, duplicate prototype signature skip, valid-positioned
      pattern filtering, and explicit-context configuration generation.
- [x] Stage 5i: Port BP config-filter semantics and single-config generator
      ordering for single-gadget, half-integral, and universal groups.
- [x] Stage 5j: Port BP repository-level config generator stored-repo recovery,
      prototype signature seeding, invalid-repo early return, and one-junction
      search dispatch, preserving the context-free multi-junction boundary for
      later tree-aware wiring.
- [x] Stage 5k: Wire BP repository configuration storage, first-entry init,
      completion serialization, selected configuration/pattern access, and
      stored-repository completion behavior for the ported one-junction path.
- [x] Stage 5l: Port BP joiner metadata shell, GOPS piece candidate collection,
      reverse-shift handling, quadrant-pair selection, relay-intersection
      helper, and explicit unsupported join-result boundaries.
- [x] Stage 5m: Port BP Joinee and JoineeBuilder gadget wrappers, including
      shifted ridges, detour transforms, original-contour containment checks,
      join anchors, fractional slack quirk, relay setup boundary checks, and
      additional-offset anchor lookup.
- [x] Stage 5n: Port BP shared JoinLogic plus simple, base, and standard join
      algorithms, including sorted candidate dispatch, base intersections,
      detour/anchor result construction, standard add-ons, nearest-grid
      transform search, and strategy preconditions.
- [x] Stage 5o: Add repository-aware two-overlap device and pattern generation
      entry points, dispatching simple, perfect, base, and standard joins while
      preserving an explicit unsupported boundary for context-free join calls.
- [x] Stage 5p: Port BP two-junction positioner for repository-aware patterns,
      including join-device push, two-device relay offsets, split-join offsets,
      relative delta checks, and span-without-immediate-slack calculations.
- [x] Stage 5q: Port BP general config generator and context for the
      upstream-supported one-joint/two-junction case, including rank
      combinations, relay/join/relay-join/split-join searches,
      repository-aware filtering, and explicit remaining upstream-gap
      boundaries.
- [x] Stage 5r: Wire BP repository tree-aware init/complete lifecycle through
      the repository-aware config generator, preserving explicit unsupported
      behavior for context-free multi-junction completion.
- [x] Stage 5s: Port BP even-area double relay generation, including
      first-cut pattern validation, symmetric partner yielding, and a finite
      no-fit guard for BP's unbounded universal GPS fallback edge case.
- [x] Stage 5: Port pattern search, devices, joins, and positioning.
- [x] Stage 6a: Port BP rough contour path expansion/simplification, leaf AABB
      rough contours, RoughUnion component grouping, child preservation, and
      leaf propagation with direct tests; leave State task wiring for a later
      checkpoint.
- [x] Stage 6b: Port BP hinge contour segmentation by slash direction with
      direct tests; leave ridge filtering and reflection tracing unsupported
      for later trace checkpoints.
- [x] Stage 6c: Port BP pure Trace/TraceContext ridge filtering, initial ray
      selection, reflection tracing, trimming, and raw-mode final checks with
      the upstream intersection-ridge fixture; leave RepoTrace/device ridge
      wiring for a later checkpoint.
- [x] Stage 6d: Port BP rational contour composition, pattern contour
      insertion, raw-mode graphical contour general-union cleanup, and stacking
      output with direct tests including the upstream floating-error fixture;
      leave node graphics task wiring for a later checkpoint.
- [x] Stage 6e: Port BP quadrant overlap-corner geometry and partition
      external connection target/target-pair selection, including intersection
      distance handling and exposed-overlap reuse; leave initialized device
      ridge extraction for a later checkpoint.
- [x] Stage 6f: Port BP RepoTrace start/end resolution over directional
      quadrants, including adjacent intersection-ridge substitution by
      division metadata; leave RepoTrace construction from positioned pattern
      devices for a later checkpoint.
- [x] Stage 6g: Port BP repository-positioned device initialization,
      transformed anchors, pattern connection target resolution, transformed
      contours/axis-parallels, connection/raw/draw/trace ridge extraction, and
      neighbor-ridge subtraction; leave dragging ranges and graphics task
      orchestration for later checkpoints.
- [x] Stage 6h: Wire BP configuration side-diagonal extraction and RepoTrace
      construction from repository-selected positioned pattern trace ridges,
      preserving the no-pattern boundary; leave pattern-contour task traversal
      and partial processing for later checkpoints.
- [x] Stage 6i: Port BP pattern-contour start/end map creation, raw-component
      relevance skip, hinge-segment traversal, trace generation, and
      PatternContour metadata emission as explicit headless functions; leave
      stateful repo process queues and trace-contour raw construction for
      later checkpoints.
- [x] Stage 6j: Port BP trace-contour corner signatures, critical-corner
      checking, and createLeafSets shared-leaf grouping including the
      overlapping-leaf early-break quirk; leave raw contour construction and
      climb/task orchestration for later checkpoints.
- [x] Stage 6k: Port BP raw trace-contour construction helpers, including
      single-leaf expansion, covered-junction detours, recursive child-contour
      expansion, AA union grouping, shared-leaf breakouts, and leaf metadata
      packing; leave critical-corner collection and climb/task orchestration
      for later checkpoints.
- [x] Stage 6l: Port BP graphics-task pure ridge helpers for flap ridges,
      right-angle river ridges, corresponding-point lookup, and free-corner
      ridge shortcuts; leave device graphics payload assembly, dragging ranges,
      and UpdateResult task orchestration for later checkpoints.
- [x] Stage 6m: Port BP device graphics payload assembly and device dragging
      range calculation, including contours, draw ridges, axis-parallels,
      location, range, forward flag, and stretch-device graphics keys; leave
      global UpdateResult task orchestration for later checkpoints.
- [x] Stage 6n: Port BP CP/FOLD serializer boundary, including line-component
      crease typing, 400-unit transform, sixteenth-snapping floating cleanup,
      ORIPA `.cp` text, FOLD 1.1 vertex de-duplication, assignment mapping, and
      explicit unsupported project-level export until graphics tasks are wired.
- [x] Stage 6o: Directly port BP Studio TreeMaker v5 visitor/parser import,
      including version checks, skip-array parsing, leaf flap creation,
      denominator LCM scaling, sheet minimum checks, and final rounding quirks.
- [x] Stage 6p: Port BP rough/trace contour task orchestration as headless
      helpers, including bottom-up rough construction, repository critical
      corner collection, recursive trace contour creation, raw-mode switching,
      and child-trace inner contour assembly.
- [x] Stage 6q: Port BP pattern-contour task orchestration over repositories
      and trace-contour maps, preserving the selected-pattern requirement and
      pattern-less repository skip behavior.
- [x] Stage 6r: Port BP graphics-task orchestration helpers for node graphics,
      selected repository device graphics, and free-corner collection, while
      keeping hole-preserving river contour metadata internal for exact ridge
      generation.
- [x] Stage 6s: Add metadata-preserving stacking and extended graphical
      contour conversion so final node graphics and CP export can consume
      `PathEx` outers without dropping BP's `isHole` quirk.
- [x] Stage 6t: Wire project-level CP/FOLD export for stretch-free projects and
      add materialized-graphics export entry points for the future task
      pipeline.
- [x] Stage 6u: Add repository selected-pattern reinitialization from stored
      configuration/pattern JSON so saved stretch repositories can produce
      device graphics after load without relying on browser state.
- [x] Stage 6v: Wire project-level CP/FOLD component construction through the
      headless junction, stretch, repository, trace-contour, pattern-contour,
      node-graphics, and device-graphics sequence, including active-stretch
      export smoke coverage.
- [x] Stage 6: Port contours, graphics, CP/FOLD export, and TreeMaker v5 import.
- [x] Stage 7: Port optimizer functionality with progress, cancellation,
      deterministic seeds, and rectangular/diagonal sheet support.
- [x] Stage 7a: Port the optimizer request/result/event boundary, including
      hierarchy-ordered flap request creation, view-mode normalized vectors,
      duplicate-coordinate guardrails for the unported `Math.random` jitter
      quirk, result validation, template writing, seed validation, and an
      explicit unsupported solver kernel.
- [x] Stage 7b: Fix optimizer hierarchy wire compatibility to BP's `distMap`
      field and add a Node oracle command that runs the pinned BP Studio
      optimizer artifact with deterministic seeds, raw result vectors, decoded
      results, logs, and progress events.
- [x] Stage 7c: Port deterministic BP optimizer kernel primitives for initial
      scale inference, integer scale rounding, rectangular/diagonal sheet
      output, bounds enlargement, and branching coordinate conversions; keep
      the NLopt/SLSQP packer and greedy branch search unsupported until their
      full behavior is ported.
- [x] Stage 7d: Port BP optimizer scalar/vector constraint formulas and
      gradients for circle distance, rounded-rectangle distance, fixed
      coordinates, rectangular bounds, and diagonal bounds with direct unit
      coverage.
- [x] Stage 7e: Port BP optimizer problem/hierarchy/parent/flap loading from
      request DTOs, including hierarchy id-to-index distance maps, last-level
      integer flap dimensions, parent lookup maps, and view-mode initial vector
      scale setup.
- [x] Stage 7f: Port deterministic BP greedy-branching helpers for closest-flap
      selection, annulus fallback point ordering, branch rounding guards,
      hierarchy fixed-distance checks, and branch context output; keep the
      pack-driven greedy search loop unsupported until the SLSQP packer is
      available.
- [x] Stage 7g: Port deterministic BP optimizer heuristic helpers for
      hierarchy parent-circle construction, circle sampling with an injected
      random stream, random-vector construction, and total candidate estimation;
      keep the BP-compatible `std::rand()` source and pack-filtered candidate
      generation pending.
- [x] Stage 7h: Add the MIT NLopt-derived `slsqp` dependency spike and a typed
      Rust local-packer adapter for BP's bounds/objective/constraint callback
      shape, with direct unit coverage for bounds/objective behavior and typed
      invalid-input handling; keep full active-constraint parity, equality
      constraints for fixed flaps, greedy fitting, and top-level `solve`
      unsupported until the solver status mismatch is resolved.
- [x] Stage 7i: Add the MIT pure-Rust `slsqp-rssl` finite-difference adapter
      for active inequality constraints and fixed-coordinate equality
      constraints, with direct unit coverage for the minimal circle-distance
      and fixed-flap cases; keep it marked as a parity candidate until
      oracle-backed greedy fitting and random packing comparisons land.
- [x] Stage 7j: Wire the single-threaded BP greedy integer fitting loop over
      the equality-capable adapter, including branch direction filtering,
      fallback annulus search, first-best equal-scale tie behavior, and a
      simple two-flap oracle-shaped exact integer vector check.
- [x] Stage 7k: Promote the oracle-backed view-layout non-basin-hopping path
      through the public Rust and WASM optimizer `solve` boundary, while
      preserving explicit unsupported errors for random layout and
      basin-hopping paths.
- [x] Stage 7l: Port the Emscripten/musl `srand()`/`rand()` stream used by BP's
      optimizer into a deterministic `BpRandom`, with direct sequence coverage
      for fixed seeds.
- [x] Stage 7m: Port view-mode basin-hopping over the equality-capable packer,
      including random displacement, adaptive step-size adjustment, Metropolis
      acceptance, stale-minimum stopping, and simple seed-0 oracle coverage.
- [x] Stage 7n: Port random-layout candidate generation and sequential global
      basin-hopping over the BP random stream, including hierarchy-level
      candidate expansion, candidate packing, best-scale selection, public
      Rust/WASM solve support, and simple seed-0 oracle coverage.
- [x] Stage 7o: Expand optimizer oracle fixture coverage to one-flap random,
      dimensioned rectangular view mode, and diagonal view mode.
- [x] Stage 7p: Add an ignored deterministic optimizer oracle batch covering
      fixed-seed view/random cases and record coordinate drift as a diagnostic:
      exact result identity is tracked, but valid-different packings are
      acceptable when all request constraints pass.
- [x] Stage 7q: Add progress-aware optimizer solve APIs and WASM solve-report
      export, including event collection and native cancellation checks around
      candidate generation, basin-hopping, packing, and greedy fitting.
- [x] Stage 7r: Spike and reject local `slsqp` fixed-coordinate equality
      replacements that either approximate BP equality semantics or regress
      existing view-layout oracle fixtures; keep the exact-coordinate drift
      documented without making it the acceptance blocker.
- [x] Stage 7s: Add request-aware optimizer packing validation for native and
      WASM callers, including integer/finite result checks, sheet constraints,
      result flap identity, anchor bounds, and tree-distance constraints.
- [x] Stage 8: Add random-tree packing validity and external corpus harness.
- [x] Stage 8a: Expand the ignored optimizer oracle batch to 410 deterministic
      fixed-seed cases, including 200 generated random-tree packings, and report
      `exact=209`, `valid_different=201`, and zero invalid packings.
- [x] Stage 8b: Add an ignored external corpus harness gated by
      `BP_STUDIO_CORPUS` for private `.bps`, `.bpz`, and TreeMaker files,
      validating solver output without committing private corpus files.
- [x] Stage 9: Freeze frontend-ready API and WASM worker contract.
- [x] Stage 9a: Expose worker-facing WASM calls for `.cp`/FOLD export,
      optimizer request creation from loaded project handles, optimizer result
      validation/template application, handle replacement with optimizer
      template results, and the explicit unsupported solver boundary.
- [x] Stage 9b: Expose worker-facing optimizer packing validation so the future
      frontend can distinguish invalid solver output from valid-different
      layouts before applying template results.

## Acceptance Criteria

The port is complete only when:

- Every non-UI BP Studio behavior is represented in the source map.
- Every unported behavior returns a typed unsupported/not-implemented status.
- Every upstream TODO/gap is visible as `Upstream-gap` or a documented
  unsupported operation.
- Every ported primitive and algorithm has focused Rust tests.
- Every parity-sensitive behavior has BP Studio oracle coverage or a written
  reason why oracle comparison is not meaningful.
- `.bps`, `.bpz`, TreeMaker v5 import, `.cp`, and FOLD export match committed
  fixtures byte-for-byte where stable and by documented canonical parity
  otherwise.
- The optimizer produces valid packings for deterministic cases, including
  observable progress/cancellation behavior. Exact matches are tracked where
  stable; valid-different layouts are accepted when all request constraints
  pass.
- Hundreds of deterministic random-tree packing cases produce request-valid
  layouts between BP Studio and the Rust port, with exact and valid-different
  classifications reported and invalid layouts failing the harness.
- The WASM-facing API can drive the kernel without requiring React/Pixi/Vue UI
  behavior in the crate.

## Future Research Items

- If a future product requirement needs coordinate identity with BP Studio,
  investigate an NLopt 2.9.1-compatible local SLSQP equality path. This is not
  required for the initial headless port as long as packings are valid.
- If release packaging requires byte-stable `.bpz` archives, evaluate controlled
  zip metadata/compression. Current compatibility uses canonical decompressed
  workspace maps.
- During app wiring, continue reviewing BP presentation code for non-UI data
  contracts such as candidate previews and selection behavior.

## Implementation Status

The initial headless Box Pleating Studio port plan is implemented through the
crate, WASM bridge, optional oracle batch, and optional external corpus harness.
Known BP upstream gaps and context-free helper boundaries remain explicit typed
errors rather than approximate substitute implementations.
