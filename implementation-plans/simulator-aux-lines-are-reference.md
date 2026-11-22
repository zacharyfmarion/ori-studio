# Simulate: Aux Lines Are Reference Lines

## Goal

In Simulate, an auxiliary line is a reference mark drawn on the paper, never a
part of it. The simulation must be exactly what it would be if the aux lines had
never been drawn, and the lines must still show, riding on the paper as it folds.
This holds on every surface that simulates a crease pattern: the Simulate
workspace, inline simulation windows, and the Diagram's simulated Pose and
pictures.

Zach's ruling (2026-10-06), on `aux_crease_simulation_issue.fold`: a square with
one valley along its diagonal and 40 aux lines is **two rigid triangles**. Today
it is 37 vertices and 56 triangles, cut along the aux lines, and it flexes along
them.

Where Origami Simulator has a behaviour that applies, match it:

- Its SVG import never builds a line of an unrecognised colour into the mesh
  (`typeForStroke`, `third_party/origami-simulator/js/pattern.js:136`). That is
  the closest thing upstream has to an aux line.
- Its `removeRedundantVertices` merges every collinear degree-2 vertex whose two
  edges share an assignment, borders included (`pattern.js:865`).
- `F` keeps upstream's meaning inside the simulator package: a **facet**, the
  yellow triangulation line of upstream's SVGs (`pattern.js:15`), held at 0° with
  panel stiffness. Aux handling lives where the app hands geometry to the
  simulator. The solver does not change.

### What is wrong today (measured 2026-10-06)

- **Aux lines are hinges.** The kernel's FOLD export follows Oriedita's
  `FoldExporter`: aux colours export as `F`, and faces are traced with them
  (`crates/oristudio-cp/src/io/fold.rs`; `FoldExporter.java:42`). Simulate
  builds its mesh from that export, and the simulator reads `F` as a facet: a
  hinge held at 0° by `panelStiffness` 0.7, the same stiffness as a fold
  (`packages/origami-simulator/src/prepare.ts`, `buildCreaseParams`).
- **Or they float.** The kernel never splits a fold or border line where an aux
  line meets it; only the aux line is split
  (`crates/oristudio-cp/src/operations/arrangement.rs`). An aux line that
  crosses a fold, or ends partway along one, is exported as an `F` edge on
  vertices of its own and lies on no face. It keeps its beams but no face holds
  it, so it stays in the flat sheet's plane while the paper folds (recorded in
  `unified-paper-style-and-export.md`, Phase 9, "Found, not fixed here"). When
  the Euler gate fails instead, the JS fallback splits every segment at every
  crossing, and the same line becomes a hinge.
- **Nothing else folds them.** Oriedita folds only `isFoldingLine()` colours
  (`FoldLineSet.java:246`). Our flat and 3D folded figures lay aux lines over the
  faces after the fold (`crates/oristudio-cp/src/folding3d/aux_lines.rs`).
  Simulate is the only surface where an aux line is structure.
- **The flex shows in motion.** At rest the aux hinges are flat (at most 0.008°).
  On Play at the default 28%/s the bug file bends up to **15.9°** along aux
  lines, with 1.7° still left about 3 s after reaching 100%. A Pull's release
  keeps every crease angle, aux facets included (`keepShape`), so a pull can
  freeze the flex.
- **Deleting the aux lines is not enough.** The bug file's border is split at
  the points where its aux lines meet it (how the file was drawn). The border's
  points stay, because `removeRedundantVertices` was narrowed to M/V/F in
  `59be00988`, and they become triangulation diagonals, so the sheet still
  flexes about 5° on Play. With the fold lines alone the file is 4 vertices and
  2 triangles, and it folds rigidly.
- **Aux lines also trip the kernel's Euler gate.** Dangling aux ticks, or aux
  lines lying on a valley, each fail it alone. Simulate then infers faces in JS
  and logs a "rounding damage" warning that misleads.

### Since the first draft (2026-11-22)

The first draft was never committed. Two things changed under it:

- **One path feeds every surface.** Since the sheet index (2026-10-19),
  Simulate, inline windows and the Diagram's simulated Pose all mesh one sheet
  at a time through `ensureCpSheetSimulationArtifacts`
  (`cp-workspace/sheets/cpSheetArtifacts.ts`), which exports the sheet's lines
  through the kernel's `export_fold_lines`. A sheet's lines include its aux
  lines by design (`sheets.rs`,
  `lines_ending_on_the_border_and_aux_lines_belong_to_the_sheet`).
  `computeFoldArtifacts` is now only the fallback for a design's pattern or a
  canvas with no closed border.
- **The kernel already exports a subset of lines with faces.** So the
  structural mesh needs no new kernel entry point: the app asks
  `export_fold_lines` for the fold lines alone, and the kernel traces their
  faces and runs its Euler gate on exactly the arrangement that is simulated.
  The draft's `export_simulation_fold`, with its wasm, Tauri and worker
  bindings, is dropped.

## Decision: facet lines from Origami Simulator files

FOLD `F` means different things to different upstreams, and every one of them
reaches Simulate as the same cyan aux line, because the kernel follows
Oriedita's FOLD importer, which maps every `F` to `CYAN_3`:

- **Oriedita and Ori Studio** (`file_creator: "oriedita"`): an aux line, a
  reference mark.
- **Box Pleating Studio**: its "auxiliary" hinge lines, exported as `F`. They
  are held flat today and can fold neither way, so treating them as reference
  loses nothing a simulation could show.
- **Origami Simulator**: a **facet** the designer drew to choose where the paper
  may bend (`pattern.js:15`). Upstream's exports say
  `"Origami Simulator: http://git.amandaghassaei.com/OrigamiSimulator/"`
  (`saveFOLD.js:25`), and our `scripts/svg-to-fold.mjs` writes
  `"Ori Studio svg-to-fold"`. The corpus has hundreds (`shell14.fold` 1083).

**Chosen (2026-11-22): option A**, a per-document **"aux lines are facets"**
setting:

- Off by default. On for a document whose source FOLD identifies itself as
  Origami Simulator content: a `file_creator` starting `Origami Simulator`, or
  `Ori Studio svg-to-fold`. A FOLD that carries
  `oristudio:aux_lines_are_facets` says so outright, which is how an override
  survives a FOLD round trip.
- On means today's behaviour, which is upstream's: every aux line is a facet in
  the mesh. Off means this plan.
- A switch in Simulate's settings flips it for the open document. It is saved
  in `.osf` (additive field, no schema bump: an older file reads the value its
  source FOLD implies) and written to FOLD exports when it differs from what
  the file's creator implies. One analytics event when the user flips it.

Not chosen: B, a first-class Facet line type (a `LineColor` through the kernel,
palette, IO and i18n), and C, every aux line as reference (breaks upstream's
files).

## Approach

Three steps. Each ships alone and aux lines never disappear from Simulate in
between: step 1 changes nothing visible for a pattern with aux lines, step 2
draws a key nothing produces yet, and step 3 switches over.

### 1. Merge every redundant vertex, as upstream does

- `removeRedundantVertices` (`prepare.ts`) and `remove_redundant_vertices`
  (`crates/treemaker-fold/src/lib.rs`): remove the M/V/F narrowing
  (`DRIVEN_ASSIGNMENTS`, `is_driven_crease`), so any matching pair merges, as
  upstream's `mergeEdge` does (`pattern.js:918`). Keep the guard against merging
  into an edge that already exists.
- What the narrowing protected: a crease-free 20×1 strip triangulates to 2
  triangles at 2.86° instead of 40 at 45°. That is mesh quality, which
  `simulator-mesh-refinement.md` owns; its invariant 1 says the drawing must not
  leak into the physics, which is what this restores. Measure the strip before
  and after; a regression goes to the refinement plan.
- Tests: the two strip tests that pin the narrowing are rewritten to upstream's
  behaviour; the two that only use the strip as an n-gon get a ring whose points
  survive the merge. Mirror in Rust.
- `PORTING.md`: delete the narrowing from the Origami Simulator divergences.

### 2. Aux lines drawn on the paper (rendering only)

The simulator learns to draw lines that ride on its triangles without being part
of the mesh. The solver, its textures and the face pass do not change.

**Data.** A fold may carry `oristudio:aux_lines`: a flat array of
`[ax, ay, bx, by]` per line in the same coordinates as `vertices_coords` (2D;
a 3-component fold carries `[ax, ay, az, bx, by, bz]`, flagged by
`oristudio:aux_lines_dim`). The key holds no `:edges_`, so the per-edge remaps
leave it alone, and `cloneFold`, `buildSegmentFold` and the face orientation
pass carry it by spread. `foldScaledForSolver` scales it with the vertices.

**Clip.** `prepareFoldModel(fold, { auxLines: true })` cuts each line to the
final flat triangles, after the merge, triangulation and degenerate pass, into
`PreparedOrigamiModel.auxOverlay`, the folded-figure cut's rules
(`folded3dAuxPieces.ts`): pieces shorter than 1e-9 of the span are dust; a
grid of triangle boxes keeps the cut near-linear. Each piece end becomes a
**virtual vertex**: a triangle's three nodes and barycentric weights, which an
affine map (the lift, the solver's normalisation) leaves alone. Consecutive
pieces of one line share the virtual vertex where they meet when both
triangles hold it on a common mesh edge or vertex, so the drawn line is one
chain and a slit in the paper still parts it. Per piece: its two virtual
vertices, its triangle, and its erode flags (an end on a border or fold edge
retreats, the rule `edgeBoundary.ts` states).

**Topology.** `meshTopologyFor` appends one aux edge per piece, between virtual
vertex indices `vertexCount + v`, with its flags in `auxEnds`, its triangle in
`edgeTriangles`, and the virtual table under `virtual`. Every renderer then
draws pieces as ordinary aux creases; only positions differ:

- **GPU** (`meshRenderer.ts`): the edge shader's `fetchPosition` resolves an
  index at or past `u_virtualStart` from a small RGBA32F table (two texels per
  virtual vertex: nodes, weights) as `Σ w·node`. The face pass is untouched.
- **CPU**: `virtualVertexPositions(topology, positions)` appends the virtual
  vertices' positions. `meshToPaperScene` applies it itself, so every vector
  scene (export, Diagram pictures) gets it; `lineFaces` reads `edgeTriangles`
  for a piece. The canvas-2D fallback applies it per frame.
- **Export Folded FOLD** writes each piece as an `F` edge on two new vertices
  placed from the folded positions, and drops the flat-coordinate key.

Dashes restart per piece, centred, as they do per cut in the 3D figures; the
default aux pen is solid.

### 3. The simulation mesh is built from fold lines only

Structural: border, mountain, valley, unassigned (upstream's `U` hinge), and
every aux line when the document's facets setting is on. Reference: every aux
colour, `Cyan3` through `Grey10` (all export as `F`), which travel as
`oristudio:aux_lines`.

- **`ensureCpSheetSimulationArtifacts(document, sheet, auxLinesAreFacets)`**
  builds the simulation model from `export_fold_lines(structural ids)` plus the
  aux overlay; the artifacts' base `fold` stays the full export, so
  segmentation, thumbnails and sheet paper do not change. A sheet with no aux
  lines, or facets on, reuses the base fold as today. The cache keys on the
  setting.
- **Callers**: Simulate (`useSimulateSource`, whose source key follows the
  setting), inline windows (`creasePatternSlice`), the Diagram
  (`storeSimulationFold`).
- **`computeFoldArtifacts`** (whole canvas) does the same with every line.
- **A read-only import** (the kernel refused the file) has no kernel, so
  `buildImportedCreasePatternResult` drops the reference edges and infers the
  simulation faces from the rest in JS; the base fold is unchanged.
- **Changes meaning:** `sourceFaceGroups` sees each whole face, so pins, picking
  and the vector face merge take whole faces.
- **Comments:** the inline-window staleness comment that says aux lines "split
  faces and become facet creases" is rewritten.

Taking aux lines out of the arrangement also removes both Euler failures above.

### Not in scope

- **Faces with four or more corners still flex.** The solver triangulates them,
  and the hidden diagonals keep upstream's panel stiffness. That is upstream's
  paper model.
- **Live overlay updates.** An aux-only edit still rebuilds the simulation in
  Simulate, and inline windows ignore aux-only edits by design, so their aux
  lines go stale until refreshed. Re-clipping the overlay without resetting the
  solver is a follow-up.
- **Per-line aux colours.** The simulator draws every aux line in the one aux
  pen, as today.

## Affected Areas

- **Simulator package** (`packages/origami-simulator/src/`): `prepare.ts`
  (merge, clip), `auxOverlay.ts` (new), `types.ts`, `webgl/meshRenderer.ts`,
  `paperScene.ts`, `index.ts`, and `tests/`.
- **Rust mirror:** `crates/treemaker-fold/src/lib.rs` (merge).
- **App:** `cp-workspace/sheets/cpSheetArtifacts.ts`,
  `simulator/useSimulateSource.ts`, `simulator/simulatorSession.ts`,
  `simulator/renderModel.ts`, `simulator/canvas2dFrame.ts`,
  `store/workspaceStore/slices/creasePatternSlice.ts`,
  `store/workspaceStore/diagramCapture.ts`, `lib/creasePatternImport.ts`,
  `lib/foldedExport.ts`, `cp-workspace/inlineSimulation/inlineSimulation.ts`.
- **Option A:** the store (the setting and its derivation),
  `lib/nativeProjectFile.ts`, the FOLD export, the Simulate settings panel and
  its strings in eight locales, `analytics/`.
- **Docs:** `PORTING.md`; close the "Found, not fixed here" note in
  `unified-paper-style-and-export.md`.

## Checklist

Baseline (main, e3f5fb698), on `aux_crease_simulation_issue.fold`, CPU solver
at the app's Play rate (28%/s, 80 steps a frame):

- [x] 37 vertices, 56 triangles (38 aux edges, 34 diagonals); smallest angle
      2.29°; Play peak bend 28.5° at aux lines and 31.5° at diagonals, still
      about 14° three seconds after 100%.

Step 1 — merge:

- [x] Remove the narrowing in `prepare.ts` and `treemaker-fold`, keeping the
      existing-edge guard.
- [x] Rewrite the strip tests to upstream's behaviour; the n-gon tests use a
      band between two rows of squares; Rust mirror rewritten.
- [x] Golden traces unchanged (whole package suite passes).
- [x] Strip measured: a crease-free 20×1 strip is 2 triangles at 2.86°, as
      upstream makes it (test). `PORTING.md` updated.

Step 2 — drawing:

- [x] `cutAuxLines` into an overlay of virtual vertices, with tests: across a
      fold (shared joint), along a crease, on the border, partly off the
      paper, a dangling tick, two lines meeting, a slit parting a line, a
      3-component sheet, the mesh identical with and without the key.
- [x] Topology (`withAuxPieces`), GPU table and shader branch, CPU
      `withVirtualVertices`, paper scene (`edgeTriangles` for a piece's face).
- [x] `foldScaledForSolver` scales the lines; segment scoping and face
      orientation carry them by spread (kernel-backed test).
- [x] Canvas-2D fallback draws each triangle's pieces in its painter order;
      Export Folded FOLD writes them as `F` edges.
- [x] `bench:gpu-parity` passes (shader links in headless Chromium).

Step 3 — switch:

- [x] Sheet artifacts from the fold lines plus the overlay, cached per
      setting; Simulate, inline windows and the Diagram pass the setting.
- [x] Whole-canvas fallback and the read-only import follow the same rule.
- [x] Option A: derived from the source FOLD, saved in the document's
      extensions (`oristudio.simulation`), stated in FOLD exports when the
      file would imply the other; "Bend along auxiliary creases" in Creases;
      eight locales, `i18n:check`; `simulator aux lines changed` event.
- [x] Inline-simulation staleness comment rewritten; the paper-style plan's
      note closed.
- [ ] Not done: "Build crease pattern" still seeds Simulate's whole-canvas
      fallback with TreeMaker's own artifacts until the next refresh. Simulate
      reads the sheet path for an editable pattern, so this only reaches the
      fallback.

Verification (headless Chromium against this worktree's dev server, GPU):

- [x] Bug file: readout "4 vertices | 2 triangles", strain 0.0000; Play folds
      two flat triangles with the aux lines riding them (CPU solver: smallest
      angle 45°, no bend at all). With the setting on: "37 vertices | 56
      triangles", and it crumples along the aux lines.
- [x] `simulator_issue_gyosh_new.fold`: smallest angle 0.07° → 3.05°, 534 → 484
      vertices.
- [x] Inline window opens on the 2-triangle mesh with the aux lines drawn; the
      Diagram's 0% simulated picture is 2 faces and 45 aux line pieces (53
      faces with the setting on).
- [x] `huffmanTower.fold` (svg-to-fold, 693 facets) opens with the setting on;
      its mesh matches main's but for one merged border point. It blows up in
      the CPU solver on main too (peak strain 42.65 on both).
- [x] Canvas-2D fallback (readout "CPU") draws the pieces.
- [x] `npm run typecheck:web`, eslint on the changed files, the web tests in
      every touched area, the simulator package suite,
      `cargo test -p treemaker-fold`, `cargo fmt --check`.
