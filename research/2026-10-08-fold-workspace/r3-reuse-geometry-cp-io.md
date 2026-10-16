# Fold workspace: reuse report for geometry, crease-pattern storage and file I/O

**Scope.** This covers the shared axiom crate, whether Fold's crease pattern should be the CP kernel's model, Import CP as a step, sheet shapes, Divide-line marks, and FOLD export.

**Evidence.** Two throwaway probes under `artifacts/fold-spike/reuse/geometry/` (gitignored), plus file reads. Every claim is marked VERIFIED (read or ran) or INFERRED.

- `cargo run --release --manifest-path artifacts/fold-spike/reuse/geometry/Cargo.toml --bin reuse-geometry-probe` tests whether the axiom filters can move behind a trait with no change to precrease's output.
- `… --bin kernel_roundtrip` tests whether the CP kernel is a lossless boundary for a Fold crease pattern.

---

## 1. The agreed shared axiom/geometry crate

### What exists

- **Pure geometry with no planner dependencies.**
  - `crates/oristudio-precrease/src/tol.rs:17` holds `TOL = 1e-6`.
  - `line.rs:21` holds `Line`; `line.rs:233` holds `LineIndex`.
  - `pointgrid.rs:48` holds `PointGrid`.
  - `construct.rs` has `Construction`, `Root`, `Certificate`, `real_roots` and `line_residual`.
  - VERIFIED.
- **What the filters actually ask of the paper.** `construct.rs` touches the rectangle `Sheet` in only three ways (VERIFIED):
  - `sheet.crosses` (`:136`);
  - `sheet.clip` and `clip_parameters`, inside O3's `folded_overlap` (`:172-183`);
  - `sheet.contains(p, TOL)` (`:231`, `:257`, `:408-409`, `:441`).
- **`Sheet` is a rectangle with its longer side equal to 1** (`sheet.rs:67-75`) and depends on `Frame` (`sheet.rs:8`).
- **`Frame`** (`frame.rs:49`) maps Oriedita model space to the unit frame. The unit frame is y-up with its origin at the lower left. VERIFIED: unit (0,0) maps to model (−200, 200).
- **Call sites.** 9 calls to `.lines(&sheet)` / `.certify(&sheet)` and 17 files that reach these modules through `crate::` paths. VERIFIED by grep.
- **One crate-private method blocks a move.** `Line::folded_angle_offset` is `pub(crate)` and is used by `order.rs:234`, `grid.rs:378` and `planner.rs:1546`. It would have to become `pub`. VERIFIED.

### The probe: a `Paper` trait changes nothing in precrease

- **The trait.** `trait Paper { contains(p, pad); intervals(line) -> Vec<(t0,t1)>; crosses() }`. `Sheet` implements it by calling its own existing methods.
- **Bit-identical.** The generic copy of the O1–O7 filters was run against `Construction::lines(&sheet)`:
  - 600,000 random constructions on three sheets (square, 1:√2 and 3:4);
  - 586,300 roots, covering all seven axioms;
  - **0 bit mismatches** in `(n, d, root)`.
  - VERIFIED.
- **A union of convex polygons implements the same trait.** On a single rectangle it agrees with `Sheet` with residual 0. On a square folded in half, 4,460 of 50,000 O4/O5/O7 constructions on folded landmarks get a different root set. This is the intended "material must be there" filter. VERIFIED.

### Recommended design: `crates/oristudio-geometry`

`MIT OR Apache-2.0`, depending only on serde and thiserror. The name is the plan's own working name.

**Moved verbatim:**
- `tol` (only `TOL` and its Oriedita derivation; `SNAP_RADIUS` and the paper fallback stay in precrease, which re-exports `TOL`);
- `line` (`Line`, `LineIndex`);
- `pointgrid`.

**Moved, and slightly opened up:**
- `frame`, with a small `GeometryError` for `DegenerateFrame` and `InvalidPaperFallback`. Precrease's `PrecreaseError` gets a `From` for it.
- `sheet`: the `Sheet` rectangle, `EdgeSide`, `CornerName`, `flap_aspects`. Its serde shape is unchanged.

**New:**
- `paper`: `trait Paper`, implemented for `Sheet`.
- `construct`, made generic: `lines<P: Paper>` and `certify<P: Paper>`.
- `Construction::nearest_root(paper, target)`, for D10's "pick the nearest root on replay".
  - Today's `certify` only accepts a root within `TOL` of the target.
  - An inserted earlier step can move a stored line further than that.

**How precrease keeps its exact behaviour:**
- `pub use oristudio_geometry::{line, pointgrid, construct, sheet, frame};` in its `lib.rs`. Every `crate::line::Line` path still resolves, so other modules need no edits.
- `&Sheet` satisfies `P: Paper`, so none of the 9 call sites change.
- The wire shapes (`Line {n, d}`, `EdgeSide`) are identical, so `oristudio-precrease-wasm` and the TypeScript side do not change. INFERRED from the serde derives moving unchanged.

**Gates, in order:**
1. **`dump_closure` output byte-identical.** Baseline sha256 prefixes recorded today (deterministic across two runs):
   - `bird_base.fold` 8edde06ef9e6183e
   - `kabuto.fold` b9a8d2ac16a9c6cc
   - `grid6.fold` fbb17a7bd9bd5fcb

   Extend this to every file in `tests/fixtures/precrease/`.
2. `cargo test -p oristudio-precrease`.
3. `node tools/precrease-rf-crosscheck/crosscheck.mjs --strict`.
4. `apps/web/src/cp-workspace/references/precreasePlan.wasm.test.ts`.

Gate 1 is the strongest. The RF cross-check's default fixtures exercise **O1–O5 only** (its README), so O6 and O7 depend on gate 1 and the unit tests. VERIFIED.

**Frame convention for Fold.** Use precrease's unit frame: y-up, origin at the lower left, longer side 1.
- `TOL` and μ are fractions of that sheet.
- Root numbers are not invariant under a y-flip: O5 orders its roots along `m1.direction()`, which follows the canonical normal. Fold and References therefore have to agree on one frame. INFERRED from `construct.rs:250-256` and `line.rs:38-41`.
- "Viewer at +z, det = +1 is front" (research §3.1) is right-handed in y-up.

**Who depends on it:**
- `oristudio-precrease` and `oristudio-fold`.
- **Not** `oristudio-cp`'s construction ops or snapping. They are Oriedita ports: `geometry/mod.rs:1-5` says parity-sensitive code uses Oriedita's helpers, with its own `Epsilon` table (`epsilon.rs`) and `Point` equality via `total_cmp`, under which −0.0 ≠ 0.0 (`point.rs`). VERIFIED.
- A future *native* Edit axiom tool, in `operations/native/`, could use the crate. Not V1.

**Licensing tiers.** These move with `construct.rs`:
- Tier 2: derived from the Huzita–Justin definitions.
- Tier 3: no ReferenceFinder expression copied, and not a clean room. The evidence is the cross-check harness, which sits inside the GPL whole.
- The O5 trivial-Haga exclusion is enforced inside `construct.rs:239`. Precrease's `lib.rs` lists that rule among the tier-1 facts, so the new crate's header must restate it.
- Tier-1 constants (`constants.rs`) stay in precrease.
- Lang's O6 rule (both moving points on the same side) is a published rule taken as fact. Keep it in Fold's who-moves filter, labelled tier 1, not in the shared crate.
- Add rows to `LICENSING.md` ("Which Crates Are Actually GPL") and update the crate path the harness docstring cites.
- No edge from the new crate reaches `treemaker-*`. VERIFIED: `LICENSING.md:156-166`, precrease `Cargo.toml:5-12`.

**Cost.** About 2,200 lines moved (line 482, pointgrid 288, construct 771, sheet 282, frame 324, tol 50) and about 150 new. **Risk: low.** INFERRED.

**Later extractions, each when a second user appears:**
- `outline.rs` (border loop to frame, with typed `RefusalReason`) when polygon sheets arrive. Fold's Import CP and References V1.1 would both use it.
- The kernel's `folding3d/overlap.rs` convex clip plus the non-convex fan area (`:80`, `:121`), made generic over a point trait, when Fold needs non-convex overlap. That module is Ori Studio native, not a port, so it can move. Its gate is the 3D census.

---

## 2. Should Fold's crease pattern be the CP kernel's model?

**Recommendation: no internally. Convert losslessly at one boundary, written once in Rust.**

### Why the kernel model cannot be Fold's state (VERIFIED)

1. **No stable edge identity.** `LineId` is a 1-based index (`model/mod.rs:22`) that is renumbered on delete. There are no faces either: `FoldGraph` re-derives them on every call, behind an Euler gate (`fold_graph.rs:459`). Fold needs face lineage and provenance that survive splits.
2. **No "flat crease that remembers its letter."** The direction hint lives only on `LineColor::None`:
   - `with_line_color` clears it on any other colour (`line_segment.rs:300-318`);
   - `with_direction_hint` does nothing elsewhere (`:349`).

   So Fold's F crease can only be written as U + hint. FOLD's `F` maps to `Cyan3`, an auxiliary line, which loses the letter (`model/mod.rs:694-720`). There is nowhere to put `madeAt` per crease, and `model.points` is a bare point list that the FOLD writer does not export.
3. **Oriedita numerics and coordinates.** Tolerances come from the `Epsilon` table, coordinates are model space (y-down, ±200), and folded points are averaged (`fold_graph.rs:314-333`), which research §3 says hides an inconsistent state.

### Why the boundary works (VERIFIED by `kernel_roundtrip`)

The probe built a planar Fold-style crease pattern in the unit frame: a folded valley diagonal plus two precreases that remember M and V.

- **Mapping.**
  - Coordinates go through `Frame::axis_aligned([-200,-200,200,200]).unit_to_model`.
  - Precreases become `LineSegment::…with_direction_kept()`, which yields `None` plus a hint.
- **FOLD round trip.** Through the kernel's own `export_fold_json` and `import_fold_json`:
  - 12 segments in, 12 out;
  - coordinate drift **0**;
  - colours and hints preserved;
  - `edges_assignment` written as U for precreases, plus `oristudio:edges_fold_direction_hint` [1,1,2,2];
  - 6 faces.
- **Oriedita fold.**
  - On the folding colours only, the estimate is **Solved** with 1 case.
  - On all segments it is **Contradiction**: `folding_estimate_from_segments` folds whatever it is given.
  - Edit filters to `is_folding_line()` first (`model/mod.rs:615-625`). The Oriedita oracle in D9 must do the same.
- **Margins.** μ = 10⁻³ of the sheet is 0.4 model units, which is 1,600 times `Epsilon::POINT` (2.5e-4). The kernel will not merge Fold vertices. Arithmetic from the constants.

### The boundary

Add a `kernel` module, or a cargo feature, in `oristudio-fold` that depends on `oristudio-cp`. Both are MIT OR Apache-2.0, so there is no licence issue.

`fold_cp_to_model(state, frame) -> CreasePatternModel` maps:
- B to `Black0`, M to `Red1`, V to `Blue2`;
- F with remembered letter X to `None` plus hint X.

One function then serves four jobs:

- **Send to Edit.**
  - `io::fold::export_fold_json` produces a `SendToEditPayload {format:'fold', mergeExtraVertices:true, unassignedAsAuxiliary:<choice>}`.
  - That goes to the existing chokepoint `importAddOristudioCpText` (`projectSlice.ts:2478`, which calls `oristudioCpRuntime.ts:432`), the same one TreeMaker, Box Pleating and ExplOri use (`creasePatternSlice.ts:1607-1613`, `oristudioBpSlice.ts:1065-1071`, `exploriSlice.ts:538-543`).
  - "Precreases as auxiliary lines" already exists as `unassignedAsAuxiliary`, which recolours `None` to `Cyan3` (`oristudioCpRuntime.ts:569-580`).
- **Exports to .cp, .ori and .orh** go through the kernel's existing writers.
- **The Fold crease-pattern pane.** `geometry_transport::encode` (`:410`) produces a `CpGeometryTransport`, which the existing CP renderers read (`ReferencesCpView.tsx`, `cpGeometryStrokesToScene`, `LineHitIndex`).
- **Oracle tests.** The same conversion feeds the Oriedita pipeline in `crates/oracle-tests`.

The alternative was to write FOLD text or kernel line segments in TypeScript. That would copy a file-format contract: the hint-extension key names are private constants in `io/fold.rs:17-30`. Rejected.

### What Fold needs that the kernel model lacks, so Fold owns it

Face lineage, stable crease ids, `madeAt` per crease, the remembered letter on F edges, marks with provenance, the layer order, and per-face isometries. None of these reach Edit, which has no representation for them. "Lossless" means lossless for everything Edit can hold.

### Painting

The folded-form scene contract already has a slot for F creases.
- `FoldedPaperFaceEdge.kind = flat` is documented for "a face split by one" (`folding.rs:716-727`).
- `foldedFlatScene.ts:890` paints `flat` edges with the **aux** role.

So Fold's precreases on the folded form get the same `PaperStyle.auxCreases` pen and the same `erode` as Edit's folded figure. VERIFIED.

Paper colours come from `PaperStyle.paper.{front,back}` (`paperStyle.ts:49-51`). The design's colour-side swatches should become the app paper style, not a colour stored with the sequence. "Colour side up / white side up" is a starting side, stored in the sequence. INFERRED design call.

---

## 3. Import CP as a step (the "CP jump")

### Existing APIs (VERIFIED)

- **Formats.** All four readers already exist, and `export_fold(handle)` normalises any of them to a FOLD crease pattern with `faces_vertices`, provided the Euler gate passes. The probe got 6 faces.
  - Wasm: `load_cp`, `load_fold_file`, `load_ori`, `load_orh` (`oristudio-cp-wasm/src/lib.rs:53-73`), each loading into a throwaway handle as import-add already does.
  - `fold_graph.rs:92`.
- **Sheet frame.** `oristudio-precrease-wasm` `sheet_frames` returns rectangle frames, affines and typed refusals (`components.rs:214`, `outline.rs:30-40`).
- **Edit's folded figure.**
  - `folded_figure_fold`, `_fold_another`, `_fold_to_case` (`lib.rs:279-398`).
  - `folded_figure_paper_scene` gives folded outlines in *camera* coordinates plus per-subface stacks (`folding.rs:669-697`).
  - The pair order lives in the private dense `HierarchyTable` (`folding.rs:5211+`).
  - **The kernel knows no total.** `foldedFigureState.ts:13-14`: "the kernel does not know one, so no 'k of N' is expressible." The design's "‹ n of m ›" cannot be met by the Oriedita path.
- **Drop and samples.**
  - Drag-and-drop classification is reusable: `classifyDroppedFile` and `resolveDropDecision` in `fileDrop.ts`, with one policy for the whole shell (`WorkspaceShell.tsx:72`).
  - The kernel already bundles five base FOLD files: bird, frog, fish, dove, blintz (`generators.rs:482-491`).

### Missing

- A crease-pattern-coordinate face list plus pair orders for a solved flat figure. Only 3D figures get `foldedForm` frames: `export_fold_file` names "the 3D folded figures" (`lib.rs:218-224`).
- Picking solution *k*. `treemaker-flatfold`'s `SolveResult` returns the first solution's `face_orders` plus `solution_counts` (`lib.rs:116`).

### Recommendation

The pipeline:
1. Kernel loader.
2. `export_fold`.
3. `sheet_frames` affine, rejected unless its (w, h) matches the sequence sheet.
4. The Fold engine importer builds faces and isometries itself, then generates its own constraints.
5. **Completion with zero seeds**, through the `treemaker-flatfold` entry point D9 already plans.

This gives a true m (the product of per-component counts), choosing a solution is the same mechanism as compound-fold choices, and it avoids Flat-Folder's ε-heuristic arrangement (research §7).

Unassigned or auxiliary lines in the imported pattern:
- full chords are scored as F with Fold's own split primitive;
- the rest become marks.

Store the imported crease pattern **and the chosen pair orders** in the step, keyed by sheet points, rather than a bare solution index. Replay then does not depend on enumeration order across engine versions. This mirrors why the Diagram stores pictures.

Use Edit's folded figure only as an oracle. A kernel flat-state FOLD frame (about 150 lines, using `face_orders` in the convention of `interchange.rs:329-376`) is worth building only if Edit's own FOLD export should include 2D figures. INFERRED.

Samples: reuse the five molecule files, and add square base, waterbomb base and pleat-in-eighths beside them.

Drops: a CP file dropped on the Fold canvas should add one decision outcome, "add as step", to `resolveDropDecision`.

---

## 4. Sheet shapes

**The kernel (VERIFIED):**
- **Holes:** dropped after the Euler gate (`fold_graph.rs:251-257`, `:521`).
- **Annular faces:** unsupported, refused as `FacesUnresolved` (holes report §4).
- **Non-convex faces:** handled exactly in 3D overlap by fan decomposition (`overlap.rs:121`; 52 of 26,030 corpus faces).

**References:** refuses non-rectangular sheets ("polygon sheets are V1.1", `outline.rs:31-33`).

**The design's "Polygon":** regular n-gons, 3 to 8 sides (`design-script.js` `sheetFor`), so always convex. VERIFIED.

**V1 scope:**
- The engine accepts any **convex** polygon: square, rectangle, regular n-gon. Chords keep faces convex, and the silhouette implements `Paper`.
- A non-convex sheet is a typed refusal when the sheet is created.
- Import CP is rectangles only. Shared polygon outline detection comes with References V1.1.
- Holes and non-convex sheets wait for a sheet-outline representation (holes report §5/§6 item 6). Non-convex would also need convex decomposition with virtual edges that never fold, which is new.

---

## 5. Divide-line reference points and pinches

**Nothing existing models user-placed marks with provenance (VERIFIED):**
- **`marks.rs`** is planner-internal: `Creased`, held as parameters along planner `State` lines. It answers "do two chords meet as creases?" (`:1-20`). That question does not arise for Fold, whose crease pattern is planar.
- **`pinch.rs`** has `Extent {Full, Pinches}` and `PINCH_HALF_LENGTH = 0.03`. Reuse the constant when Fold gets pinches, so pinches look the same as in References.
- **The kernel's division ops** (`operations/point.rs:42-106`, Oriedita DIVISION_27 and RATIO_SET_28) **add creases**. They are topological, not marks.
- **`model.points`** carries no provenance and is not in FOLD.

**Reuse:**
- **Ratio model.** Edit's exact (a + b√c) ratio expression (`ratioExpressionFromHalves`, `oristudioCpToolSettings.ts:440`) and its presets (`:240`). The design's 1/√2, √2−1, 2−√2, 1/3 and 1/5 all fit that form, so the step records an exact ratio.
- **Rendering.** References' marker overlay (`markersToOverlayPoints`).
- **Diagram link.** On #436, the `divisions` annotation (2–32 parts, `31e1d6d84:…/annotationModel.ts:57,516`).

**Store marks as:**
- `{madeAt step, target edge by sheet points, count | ratio + end, face it lies on}`;
- visible to descendant steps, as in the design's `anc()` filter;
- one point per marked layer. Beloch's `named_points` has the same `{paper, table, step}` shape (VERIFIED in its fixture).

The math is a lerp in sheet coordinates. New engine code is correct here; there is nothing worth sharing in Rust.

---

## 6. FOLD export of a step sequence

**Reuse (VERIFIED):**
- **`treemaker-fold::FoldDocument`** (`lib.rs:140`), with `file_frames`, `face_orders` and `extra`.
- **The root frame** comes from the kernel writer through §2. It carries the U + hint extension and opens in Edit exactly like Send to Edit.
- **Edit preserves Fold's step frames.** Probe [3]: a `diagrams` file with a Fold-marked step frame, opened and saved through `import_fold_file_document_json` and `export_fold_file_document_json`, kept the frame verbatim and kept `file_classes` (see `io/fold.rs:421-439`).
- **Copy the 3D writer's conventions** (`interchange.rs`):
  - `frame_inherit: false`, because each step has its own topology (`:16-28`);
  - `faceOrders` as `[upper, lower, facing(lower)]`, the same rule as research §3.1 (`:329-376`);
  - a marker key like `FOLDED_FORM_MARKER` (`:51`);
  - the size cap `FOLDED_FORM_MAX_ELEMENTS` and `FoldedFormTooLarge` (`:71`). These matter: O(F²) orders per frame.
- **Re-importability.** Write per-face sheet-to-folded matrices in the same layout as Beloch's `beloch:faces_matrix`. One state importer then reads the Beloch goldens and Fold's own exports, differing only by key name.
- **Optional extraction.** A generic `foldedForm` frame builder in `treemaker-fold`, shared by `interchange.rs` (3D), Fold steps and a future 2D Edit export. About 100 lines. Do it when the second writer lands.

---

## Recommendations, ranked

1. **Create `oristudio-geometry`** with tol, line, pointgrid, frame, sheet, the `Paper` trait, generic axioms and `nearest_root`.
   - Precrease re-exports the modules: no call-site edits, no wire changes.
   - Gates: `dump_closure` byte-identical against the recorded baseline, the precrease tests, the RF cross-check with `--strict`, and the wasm test.
   - Evidence: 600k bit-identical constructions.
2. **Fold owns its crease pattern** and converts once in Rust to the kernel model. That single function serves Send to Edit (existing payload and chokepoint), exports, the CP pane's geometry transport, and the Oriedita oracle (folding colours only). Evidence: the round trip was lossless and the fold Solved.
3. **Persist `workspace.foldSequences: []`** plus an active id.
   - Copy v8's `workspace.designs` idioms: an array, an active id, and unknown kinds written back verbatim (`nativeProjectFile.ts:233-262`, `:448-472`).
   - Apply the Diagram's three reader rules per sequence and per step.
   - Store steps as a flat array with `parentId`, which handles the design's branches. Store the chosen branch per node.
   - Store no colours.
4. **Import CP** = kernel loaders + `export_fold` + precrease `sheet_frames` + Fold's own constraints + the D9 completion entry point with no seeds. That gives a real "n of m". Store the chosen orders in the step.
5. **FOLD export** = `FoldDocument`, a kernel root frame, Fold step frames using `interchange.rs`'s conventions and cap, and face matrices laid out like Beloch's.
6. **Divide line** is a new engine concept that reuses Edit's exact ratio expression, its presets and References' marker rendering. It maps to the Diagram's `divisions` later.
7. **Later extractions:** `outline.rs` into the shared crate with polygon sheets; `overlap.rs` into the shared crate when Fold needs non-convex overlap; a shared `foldedForm` frame writer.
8. **Do not share:**
   - the kernel's Oriedita geometry, construction ops and snapping (parity);
   - precrease's `marks.rs` and `predicates.rs` (planner-internal);
   - the kernel's averaged folded points.

## Open questions

1. **Precreases in Edit after Send to Edit.**
   - Auxiliary lines (`Cyan3`, FOLD `F`) lose the letter.
   - U + hint keeps the letter but reads as "unassigned" in FOLD and in Edit.

   Which should be the default? The flag for either already exists.
2. **Should the kernel get a "flat crease with remembered letter"?** That would mean allowing the hint on `Cyan3`. It changes an invariant `LineSegment` enforces, so it is not V1, but it would end the two FOLD spellings: U + hint at the root versus F in step frames.
3. **Layer orders for Import CP.** Fold's own constraints plus Flat-Folder give a true total m. Edit's folded figure stays consistent with what the user saw in Edit, but has no total and needs a new kernel export.
4. **Polygon sheets in V1.** The engine supports them, but Import CP and References refuse them. Ship them anyway?
5. **Fold as a design kind or its own workspace.** A `DesignKindDescriptor` (`designKinds/types.ts:242-300`) already gives several documents as tabs, the `workspace.designs` array, unknown-kind preservation, Send to Edit, history and save gating. That reuse argues against a separate workspace with about 25 registration points, but it is a shell decision.
6. **Marks on stacked layers.** Top visible layer only, or every layer under the pick?
7. **Engine dependency on the CP kernel.** Should `oristudio-fold` depend on `oristudio-cp` directly, or behind a `kernel` feature? The answer depends on the measured wasm size of `oristudio-fold-wasm`, which is unmeasured.
