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

Baseline (before any change), on the bug file:

- [ ] vertices, triangles, minimum angle; Play peak bend at aux lines.

Step 1 — merge:

- [ ] Remove the narrowing in `prepare.ts` and `treemaker-fold`, keeping the
      existing-edge guard.
- [ ] Rewrite the two strip tests; re-fixture the two n-gon tests; mirror in Rust.
- [ ] Golden traces unchanged.
- [ ] Measure the strip; `PORTING.md`.

Step 2 — drawing:

- [ ] Clip into an overlay of virtual vertices, with tests: a line across
      triangles, on a crease, on the border, partly off the paper, a dangling
      tick, across a fold; shared joints; the mesh identical with and without
      the key.
- [ ] Topology, GPU table and shader branch, CPU positions, paper scene.
- [ ] `foldScaledForSolver`, segment scoping, face orientation carry the lines.
- [ ] Canvas-2D fallback; Export Folded FOLD keeps aux lines.

Step 3 — switch:

- [ ] Sheet artifacts from the fold lines plus the overlay; the setting in the
      cache key; every caller.
- [ ] Whole-canvas fallback and the read-only import.
- [ ] Option A: derivation from the source FOLD, `.osf` field, FOLD key, the
      switch, eight locales, `i18n:check`, analytics event.
- [ ] Rewrite the inline-simulation staleness comment; close the paper-style
      plan's note.

Verification:

- [ ] Bug file before and after, in the app: two rigid triangles with the aux
      lines drawn on them; Play shows no bend along them.
- [ ] Inline window and Diagram Pose on the same file.
- [ ] An Origami Simulator FOLD with facets is unchanged (switch on).
- [ ] Canvas-2D fallback draws the pieces; SVG export draws aux lines.
- [ ] `npm run lint:web`, `npm run typecheck:web`, relevant web and simulator
      package tests, `cargo test -p treemaker-fold`, `cargo clippy`.
