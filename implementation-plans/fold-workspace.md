# Fold workspace

## Goal

A new workspace, **Fold**, where you fold a sheet the way a person does.

- Start from a flat sheet: a square, a rectangle or a regular polygon.
- Crease it with the Huzita–Justin axioms.
- Fold the *folded* form along a line through any number of layers.

At every step you see the crease pattern so far and the flat folded form,
including its layer order. How each kind of step gets there:

- **A plain fold** (valley or mountain) gives its result exactly, with no search.
- **A compound fold** ends at a seeded completion of the layer order.
- **Import CP** ends at a completion seeded by the imported crease letters.

When a completion has more than one result, the user picks one and the pick is
stored in the step. The steps form a tree: folding differently from an earlier
step makes a branch.

**V0** ships:

- valley and mountain folds through all layers, or down to picked flaps;
- precreases (fold and unfold), refolding a precrease, and unfolding a flap;
- turning over and rotating;
- the axioms on the flat sheet and on the folded form;
- Divide-line reference marks;
- a step tree with branches, undo and delete;
- animation of each step;
- **Import CP**, for square and rectangle sheets;
- **Send to Edit**;
- FOLD and paper export.

**V0.5** adds the inside reverse fold, the design's fourth tool.

Later phases add:

- outside reverse folds, crimps and tucks;
- squash, petal, rabbit ear and swivel;
- open and closed sinks, and unsink;
- links from Fold steps into the Diagram workspace.

Every state in this plan is flat-foldable; non-flat states are a non-goal.

**Evidence.** The research behind every decision is
[`research/2026-10-08-fold-workspace.md`](../research/2026-10-08-fold-workspace.md),
cited as §n. The working reports it summarises are in
[`research/2026-10-08-fold-workspace/`](../research/2026-10-08-fold-workspace/README.md),
cited as `r1-…`, `r2-…`, `r3-…`.

**Direction.** The UI follows the owner's design ("Ori Studio – Fold v2",
Claude Design project `acda3ed2-…`). It is directional: compose the design
system's components rather than reproducing its styles.

**Guiding rule (owner, 2026-10-08):** where using or abstracting existing work is
better, do that, even if it is harder or takes longer. Fold should be the second
or third user of a shared piece, never the author of a parallel copy. The
**Reuse map** below records every such decision and its evidence.

**Non-goals:**

- Planning a sequence from a crease pattern. That is NP-hard in general (§1,
  §2.1), and it was the removed `treemaker-sequence` attempt.
- Non-flat states as state. Animation frames are pictures only.
- Physical simulation.
- Proving that a compound fold's motion is performable. Only its end state is
  validated.

## Approach

### Settled with the owner (2026-10-08)

- **Beloch is a reference, not a port.**
  - No code is copied.
  - Its MIT FOLD fixtures may be test goldens, kept in `tests/fixtures/beloch/`
    with their own attribution row in `LICENSING.md`.
  - The engine departs from Beloch where the spikes measured its choices to be
    wrong or limiting (§14).
- **The axiom solvers move into a shared crate** (D9).
- **Paper is painted the same way as everywhere else**, from the app's paper
  settings (D11).
- **Fold sequences are saved as an array.** One is shown for now, so supporting
  several is a UI change only (D7).
- **Recommendations accepted:**
  - default fold scope: all layers on the moving side, narrowed by picking
    flaps, with a preview of what moves;
  - a near miss snaps to an offered landmark, otherwise it is refused and the
    vertex is named;
  - replay on open, with an in-memory cache;
  - Diagram step semantics are decided at the link (Phase 10).
- **A — the project file:** a first-class `workspace.foldSequences` key with a
  reader-version bump, **not** the `extensions` bag. `extensions` is a
  forward-compatibility carry-through: untyped, unvalidated and never read as a
  feature. That is exactly why `superset-features.md` keeps features out of it.
- **B — shared CSS block moves land as pre-work PRs**, so the Fold PRs carry only
  new functionality. The same applies to every behaviour-preserving extraction in
  the Reuse map.
- **C — build in parallel on #436.** Fold branches off #436's current head
  (`568e02a60`, which includes #442) and resolves conflicts when #436 lands on
  `main`. Nothing in this plan waits for the merge: #436's primitives,
  `keepsOriedita`, schema-3 scenes and `DiagramStepsGrid` are all available on
  the base.

### Branching and PR sequence

1. **Base:** a Fold branch from #436's head. When #436 merges, rebase the Fold
   branch and its open PRs onto `main`.
2. **Pre-work PRs**, each small and behaviour-preserving unless marked, landing
   before the Fold feature PRs:
   - the shared Rust crates and the Flat-Folder entry point (Phase 1);
   - the front-end extractions (Phase 5);
   - the CSS-module moves (decision B).

   They change no product behaviour Fold does not need, and each is gated by its
   existing users' tests.
3. **Fold feature PRs**, in order:
   - the engine (Phases 2–3);
   - bridge and document (Phase 4);
   - shell and UI (Phase 6);
   - animation (Phase 7);
   - Import CP and exports (Phase 8);
   - the inside reverse fold (Phase 9);
   - the Diagram link (Phase 10, which can also proceed in parallel);
   - compound folds (Phase 11).

### D1 — An original engine crate

`crates/oristudio-fold` (pure Rust, typed errors, MIT OR Apache-2.0) and
`crates/oristudio-fold-wasm`.

- It owns its geometry, topology and layer order.
- It depends on `oristudio-geometry` (D9) and `oristudio-layer-order` (D8).
- Behind a `kernel` feature it depends on `oristudio-cp`, for the one conversion
  in D10.
- **`oristudio-fold-wasm` enables `kernel` by default**, so the browser reuses
  the kernel's own writers and loaders. This follows the guiding rule, and
  `oristudio-cp-detect-wasm` already links `oristudio-cp` the same way.
  - Phase 4a measures the `.wasm` size with and without `kernel` and records a
    budget. The PWA precaches every emitted `.wasm`.
  - **Fallback**, if the difference is large: `kernel` stays native and
    test-only. Send to Edit, export and Import CP then go through the existing
    CP worker as FOLD text. Fold's FOLD writer then emits the
    `oristudio:edges_fold_direction_hint` key, with a round-trip test through
    the kernel's reader.

It is not a mode of Edit's folded figure. That engine:

- has no history;
- recomputes everything from scratch;
- averages vertex images;
- merges faces across precreases;
- misses valid layer orders (§7.1).

### D2 — State

As §3:

- **Sheet:** a convex polygon in the precrease unit frame (y-up, origin at the
  lower left, longer side 1).
- **Crease-pattern vertices** in sheet coordinates.
- **Edges `B | M | V | F`.**
  - An F edge remembers its last letter.
  - Every edge records the step that made it.
  - Letters are **front-relative**: V iff the front-up face lies below. That is
    what is stored and exported.
- **Convex faces**, each with its lineage.
- **An antisymmetric order** on overlapping face pairs.
- **The view:** a turn-over and a rotation, applied for display only. Fold
  operations are given in the view and converted to the model frame (D6
  Frames).

Derived from that:

- **Isometries**, by breadth-first search from a stationary root that keeps its
  previous isometry. Checked, never averaged.
- **Letters**, from the order.
- **The display cells (`subfaces`)**, from the shared convex overlay (D8).

Rejected: a global z-index. It cannot hold cyclic orders.

**Divide-line marks are not state** (D6). They are reference annotations a
step's descendants can see.

**The crease-pattern pane** shows the sheet from the front, with stored letters.
- When `startSide` is back, the Step pane says which side its M/V counts refer
  to: always the front.
- The UI may offer a mirrored back view. That is display only, with letters
  swapped.

### D3 — The plain fold is closed-form

As §4.2:

1. Snap ℓ. The snap must not change any vertex's class (D5).
2. Classify each vertex once.
3. Compute the moving set U by closure:
   - (i) adjacency across crease-pattern edges that have at least one endpoint
     on the moving side;
   - (ii) layers overlapping a moving piece above it (valley) or below it
     (mountain).
4. Split the moving faces, once per crossed edge.
5. Toggle hinges on ℓ.
6. Re-derive the isometries.
7. Carry and place the order.
8. Derive the letters.

There is no solver call. Fold-and-unfold, refold, unfold and turn-over are this
operation, or trivial.

**Flaps** are what the UI shows and picks: the connected parts of the moving
side, joined across crease-pattern edges that are not on ℓ. This is the same
rule as closure (i).
- A hinge on ℓ separates two flaps.
- The chips and every layer picker use this engine-supplied grouping, never one
  of their own.

**Unfolding** is a plain fold whose ℓ lies on an existing bend, with the top
flap picked. The tools make it reachable with an "existing crease" line mode
(D14); D18's `via: crease` names that mode.

The call returns:

- U, the flaps, and which flaps the closure **added** beyond the pick;
- the landed state;
- or a refusal with fixes (D14).

**"Everything would move" is a refusal from U**, never from where ℓ sits. Its fix
is "pick a flap", not "turn over".

### D4 — One pipeline, one validating constructor

§5.1: **macro → score → hinge diff → derive → gate → carry → seed → complete →
letters → validate.**

- **Every macro declares a partition into *blocks*.** A block is a set of faces
  whose mutual stacking moves as one stack, together with its motion.
  - Plain fold: U is one block.
  - Reverse fold, crimp, tuck: the opening's blocks (one pair per flap).
  - Open sink: one block per layer. Closed sink: two.
  - Squash, petal, rabbit ear, swivel: the motion classes.
- **Carry** only pairs that are both stationary or in the same block. Keep the
  order under a rotation; reverse it under a reflection. Never carry a pair
  because two isometries happen to be equal: in a reverse fold every tip piece
  has the same isometry, yet the blocks keep their absolute order (§5.2).
- **Seed** the cross-block pairs and placements per operation:
  - reverse, crimp, tuck: cross-block pairs kept in absolute terms, and each
    block against its own body or target;
  - sinks: from per-face anchors, or from letters;
  - squash and petal: a direction seed;
  - rabbit ear: a ridge.
- **Complete** whatever is left (D8). A plain fold leaves nothing to complete.
- **`State::make` is the only way to produce a state.** A failure is a typed
  refusal that names faces, never a crash and never an approximation.
- **More than one completion** is offered as a choice. The chosen *result* is
  stored (D6).

### D5 — Numerics: f64 with snapping and a minimum feature

As §6:

- `tol = 1e-6` of the sheet, the shared `TOL`.
- **Snapping ℓ** through landmarks within tol is accepted only if no vertex
  changes class. Classify every vertex against both the original line and the
  snapped one, using the same tol/μ bands:
  - a vertex crossing sides, or landing in (tol, μ) of either line, turns the
    snap into a near miss (offer the landmark line, otherwise refuse and name
    the vertex);
  - the snap actually applied (cluster count, angle, largest displacement) is
    returned for display.
- **Minimum feature μ = 1e-3** of the sheet, about a paper thickness:
  - refuse near misses (tol < d < μ), edges shorter than μ, and pieces thinner
    than μ/2;
  - **image–image check:** after every operation, for each pair of faces whose
    relative isometry changed (moving × stationary, and cross-block), refuse
    with `sliver` when tol < penetration < μ. The overlap code already computes
    this number. The refusal names the vertex and face. When the construction
    leaves one degree of freedom, offer the exact line that lands the vertex on
    the edge (O5 or O7) as the remedy.
- **One new vertex per crossed edge**, placed by edge parameter.
- **A residual gate and a hinge-consistency gate.**

Exact arithmetic is rejected for now: Beloch's crane takes 112 s in a browser.

### D6 — Steps form an append-only tree; inputs are anchors; choices are results

```
steps: FoldStepNode[]   // flat list, parent-linked
FoldStepNode { id, parent, op, choices?, expect?: 'fs1:…', note?, marks?, unknown? }
```

- **No synthetic root.** `parent: null` folds from the flat sheet.
- **A node's state is fixed by its path**, so a node id is a complete link
  target.
- **Committing is append-only.** "Fold differently here" makes a branch.
  - Committing *any* step at a non-tip node (a turn, a rotate) makes a branch;
    the UI says so.
  - No middle step is edited in place.

**Frames.**

- The *model frame* of a node is its folded frame, given by the root-carried
  isometries before any view transform.
- **Stored lines** are model-frame lines of the parent node; `nearest_root`
  compares in that frame.
- **Direction** is `valley | mountain` as seen in the parent's view, which is
  part of the parent's state.

**Inputs are anchors in sheet coordinates.** Never face, flap or enumeration ids.

- Axiom references are a sheet point, an edge by its end points, or the resolved
  sheet point of a mark.
  - A mark id may ride along, for the sentence and for provenance only.
- Axiom inputs are in the crate's axiom order. Click order maps to slots in the
  tool, never in the file.
- A **free line** is two sheet points on ℓ, at least μ apart. Each is the
  preimage of a point of ℓ inside the silhouette.
- An Alt-free point on the paper is a sheet point.
- **Moving side**, stored only when the seed does not imply it: one sheet point
  whose image lies on the moving side.
- **Seed** is one of:
  - `all`;
  - a depth at a sheet point (k counted from the side the direction implies);
  - flaps, each named by an interior sheet point of one of its faces.

**Choices are stored as results, never as indices or digests.**

- **Axiom root:** the resulting line; replay takes the nearest root.
- **Opening** (reverse fold, crimp, tuck): the faces of each opening's upper
  block, per flap, each named by an interior sheet-point witness.
- **Completion:** the assignments of the pair variables that seeds and
  propagation left free. Each face is named by an interior sheet-point witness.
  - Replay applies them as fixed pairs and completes.
  - Exactly one result means it resolved. A conflict, or more than one result,
    means *broken*.
- **Sink pocket:** sheet points on the two faces that bound it.
- **Import CP:** the full order, stored in the op as `orderJson` (D16), not in
  `choices`, keyed the same way.
- **Witnesses:** a witness that lands in no face, or two witnesses in one face,
  means *broken*. Sheet points survive replay because later faces are subsets of
  earlier ones (§10).

**Status (derived, never stored):**

- A node whose inputs no longer resolve is *broken*, and so is its subtree.
  Siblings are unaffected.
- `expect` holds `fs1` for drift only. A mismatch (same inputs, different state,
  usually after an engine change) is *changed*, not broken.
- An unknown op kind locks its node and subtree. Locked nodes can be deleted, not
  edited.

**Marks** (Divide line) are reference annotations stored in `marks` on the node
where they were made, or in the sequence's `sheetMarks` when made on the flat
sheet.

- They are visible to that node's descendants and excluded from `fh1` and `fs1`.
- Adding or clearing marks, and editing a step's note, are the only in-place
  edits allowed. Each is one undo entry. Neither can break a step: inputs store
  resolved points, and notes are outside `fh1` and `fs1`.
- On a folded form, a mark goes on the top visible layer at the pick.

**Undo, delete, reader state:**

- **"Delete this step and what follows"** works on any node, locked subtrees
  included. It is one undo entry.
- **Reader state** (cursor, active child per node) lives in
  `workspace.viewState.fold`, outside the document and outside undo. After every
  undo, redo or delete it is reconciled:
  - a cursor whose node is gone moves to its nearest surviving ancestor, or to
    the sheet;
  - an active child that is gone is dropped (the newest child applies);
  - redo moves the cursor to the node it restores.
- **The active path** (root → active child … → tip) is what exports, the Steps
  grid, the strip and Send to Edit follow.

### D7 — The document: an array of sequences

```
FoldSequenceDocument { formatVersion: 1, id: 'fold-<uuid>', title,
  paper: { shape: square | rectangle(aspect) | polygon(points), startSide: front | back },
  appearance?: PaperStyleOverrides,   // reserved; never written in this plan; carried verbatim
  sheetMarks?: FoldMark[],            // marks made on the flat sheet (D6)
  steps: FoldStepNode[] }
```

- **One `formatVersion` per sequence**, so a newer sequence opens read-only on
  its own.
- **The key is omitted when the array is empty**, so other files stay
  byte-identical.
- **Shapes:**
  - rectangle `aspect` is normalised to longer side 1 (the design's presets
    1:√2, 3:4, 2:1, and custom w:h with both positive);
  - a polygon is stored as points (regular, 3–8 sides, first vertex at −π/2);
  - the side count is derived from the points.
- **Changing the shape** of a sequence with steps replaces `paper.shape` and
  empties `steps`, as one undoable edit. It never appends a hidden sequence.
  Whether it asks first is a UI call.
- **Lenient reading for a tree:**
  - a node with a malformed structure (id or parent) is dropped with its
    subtree;
  - a node with a malformed op is kept verbatim and locked;
  - the first duplicate id wins;
  - orphans and cycles are dropped;
  - unknown sequence-level keys are carried verbatim.
- **Where the array lives:** `workspace.foldSequences` (decision A).
  - Writing a non-empty array raises `minimumReaderSchemaVersion` to the next
    `NATIVE_PROJECT_READER_VERSION`: **10**. #436 takes 9 for the Diagram, and the
    two may ship in different releases.
  - A build that cannot read the key then refuses the file rather than dropping
    the sequences on its next save.
  - The empty array writes no key and needs no bump.
- **Imported crease patterns** are embedded as compact JSON strings, about a
  third the size of nested arrays in the pretty-printed `.osf` (the Diagram's
  `sceneJson` precedent).

### D8 — Layer order: a shared crate, Fold's own checker, Flat-Folder's search

From §7.1 and §7.2.

**`crates/oristudio-layer-order`** (original, MIT OR Apache-2.0, depends on
`oristudio-geometry`) holds:

- **the order type**: cyclic relations allowed, undetermined pairs reported.
  Conversions to FOLD `faceOrders` and to Oriedita's convention (calibrated
  1,685 of 1,685).
- **the convex overlay** that yields cells (`faces_cells` / `cells_faces`), with
  one tolerance. It is solver-grade, and it is also the source of Fold's
  `subfaces`.
- **the constraint problem**: variables (overlapping pairs) and the taco-taco,
  taco-tortilla and tortilla-tortilla buckets per variable, built from convex
  face images. It can be built incrementally over touched faces.
  - Transitivity is derived from shared cells, so the checker and the search
    agree on it by construction.
- **one checker that names faces.**

Its users are Fold's `State::make`, the "start from Edit's folded figure" bridge,
and the oracle tests.

**Completion uses Flat-Folder's search** (`propagate_*`, `variable_groups`,
`guess_vars`) through one new `treemaker-flatfold` entry point.

- **Input**, in plain index types (no dependency on the layer-order crate):
  variables, constraint buckets, cell incidence, and fixed assignments each
  tagged *carried* or *seed*.
  - Transitivity stays derived inside the search from the caller's cells,
    exactly as today, including the taco-tortilla component filter.
  - Explicit triples are not passed: they grow cubically with depth.
- **Carried pairs are not re-propagated; seeds are.**
  - Reason **[derived]**: a constraint made only of carried pairs is the image
    of one the previous valid state already had.
  - The checker in `State::make` is the backstop.
- **Output:** per-component solutions and counts, with truncation reported, and
  conflict faces (a port of upstream `error_faces`, which needs cells).
- **A node or time budget** returns a typed "budget exceeded".
- **Existing stages stay bit-for-bit** under the JS oracle. The search's
  transitivity source becomes a parameter. That is a small, gated change to a
  ported inner loop, not purely additive.
- **Untested:** the prototype ran over Flat-Folder's *own* arrangement and
  re-propagated seeds. That caller-built constraints avoid both measured defects
  is **[derived]**. Before D16 relies on "a true n of m", Phase 1c attributes the
  unexplained `r069-s07` miss (§7.1).

**Not reused, by measurement:**

- **Edit keeps Oriedita for both its paths.** The 2D path, for parity. The 3D
  path (`folding3d`) because it is 3D-only, Oriedita-searched, and merges faces
  across precreases (§7.2).
- `oristudio-layer-order` replaces neither path. It takes `folding3d`'s lessons:
  - cyclic orders;
  - undetermined pairs reported;
  - a per-component ‹ n of m ›;
  - refusing contradictory seeds.

**Oracles** (all wired into CI):

- **Oriedita seeded verification, folding colours only.** The spike's
  `or_seeded` recipe: `initial_hierarchy_from_segments`, plus our relations,
  then `validate_initial_hierarchy`, then `configure_subfaces_from_segments` and
  `equivalence_condition_candidates_from_segments`, then
  `WorkerOverlapEnumerator`.
  - Never "must reach Solved": that gave false "no solutions" and stalls.
  - The recipe skips the shipped closure step (`close_hierarchy_with_removal`
    is `pub(crate)`), so add one additive public function beside
    `overlap_enumerator_from_segments` that runs it.
  - Runs in-process, no env var.
- **Flat-Folder JS**, through a new `verify <fold> <order.json>` command in
  `tools/flat-folder-oracle`. It validates the arrangement, retries at halved ε,
  and reports retries and precision errors.
  - It lives in its own `oracle-tests` binary gated on `FLATFOLDER_ORACLE`, added
    to the CI "Flat-Folder oracle parity" step.
- **Beloch frames**, from `tests/fixtures/beloch/`.

### D9 — Shared geometry crate (agreed)

**`crates/oristudio-geometry`** (MIT OR Apache-2.0; serde and thiserror only).

**Moved from `oristudio-precrease`:**
- `tol` (`TOL`);
- `line` (`Line`, `LineIndex`);
- `pointgrid`;
- `frame`, which now returns a new `GeometryError` (`DegenerateFrame`,
  `InvalidRect`), with `From<GeometryError> for PrecreaseError`;
- `sheet`;
- `outline`, unchanged and rectangle-only. Import CP needs it, which keeps
  `oristudio-fold` free of the planner crate. `SNAP_RADIUS` moves with it, or
  becomes a parameter.
- `construct`, made generic over a new **`Paper` trait** (`contains`,
  `intervals`, `crosses`).

**New:**
- `Construction::nearest_root`;
- a **`convex` module**, the single owner of convex-polygon primitives for the
  new crates: CCW normalisation, convex–convex clip, an ε-aware half-plane split,
  SAT penetration against `TOL`, point-in-convex. It is ported from the measured
  spike. `folding3d/overlap.rs`'s clip may move into it later, gated by the
  `fold3d_census` example. Until then the two stay separate because one is
  Oriedita-parity 3D code.

**Effect on precrease:**
- **No wire shape changes.** Precrease re-exports the moved modules.
- **One call site changes:** `oristudio-precrease-wasm/src/lib.rs:550` maps the
  frame error with `.into()`.
- `Line::folded_angle_offset` becomes `pub`.
- The licensing-tier header moves with `construct.rs`. Lang's O6 same-side rule
  stays in Fold (tier 1).

**Evidence:**
- the probe showed the `Paper`-trait filters bit-identical over 600,000
  constructions;
- the **committed `dump_closure` baselines** (Phase 1a, first commit) are the
  evidence for the move itself.

**Not moved:** `oristudio-cp`'s construction ops and snapping. They are Oriedita
parity code.

**Later:** generalise `outline` to convex polygon outlines, shared with
References V1.1. That is new fitting code, not a move.

### D10 — One conversion to the CP kernel, written in Rust

`fold_cp_to_model(state) -> CreasePatternModel` maps:
- B → `Black0`, M → `Red1`, V → `Blue2`;
- F remembering letter X → `None` plus hint X.

It is lossless through the kernel's own FOLD writer and reader. It serves
**three** jobs:

1. **Send to Edit**: a `SendToEditPayload` (`format: 'fold'`) through the
   existing `importAddOristudioCpText` chokepoint. "Precreases as auxiliary
   lines" is the existing `unassignedAsAuxiliary` flag.
2. **`.cp` / `.ori` / `.orh` export**, through the kernel's writers.
3. **The Oriedita oracle**, folding colours only.

The crease-pattern pane does **not** go through the kernel. It hit-tests Fold's
own geometry (D13).

**The inverse, for Import CP:**
- B → B, M → M, V → V;
- `None`/U with hint X → F remembering X;
- `None`/U without a hint → a folded crease whose letter is unknown, decided by
  D16's letter-seeded completion (unlike Edit, which does not fold unassigned
  lines);
- every aux colour → a guide line (dropped, or a mark), never an edge;
- any remaining F/U segment that is not a full chord of its face is refused with
  a named code. A non-convex face is never built.

**Test:** Send to Edit, then Import CP, gives back the same state.

### D11 — Paint only through `PaperStyle` and `PaperScene` (owner requirement)

Fold follows **Settings ▸ Paper** like every other surface. It goes through the
same `PaperScene` and the same `paperFaceFill` / `penForRole` as the SVG export,
so the canvas and the file cannot disagree about what a style means. Export may
still use its own Settings slot, by design.

**Ink parity holds only after Phase 5.** Today the canvas painter forces the
`folded-3d` policy: it draws every fold and diagram crease in the edge pen, with
no dashes.

**The spike:** draw order matched Fold's layer order at all 21,106 sample points,
on 7 small acyclic states. It did not measure canvas ink.

**Folded pane:**

engine scene (D12) → `foldedFlatPaperScene` →
`foldedSceneLocalGeometry(scene, style, 'fold')` → `renderer.setFolded`

This is the route Edit's 3D figure takes.

**Crease-pattern pane, thumbnails, the Steps grid, export:**
- A pure web adapter in `apps/web/src/fold/` builds a per-step
  `StepDiagramModel` from D12's `creases[]` (with `madeAt`) and the step's
  `FoldActionGeometry`. Line roles:
  - earlier folds: `fold-mountain` / `fold-valley`;
  - precreases: `crease`;
  - this step's creases: `mountain` / `valley`;
  - marks and arrows: the existing primitives.
- Painting goes through the **generalised** `diagramToPaperScene`, extracted in
  Phase 5. It gains:
  - an optional polygon outline on `DiagramSheet`;
  - the policy as a parameter;
  - the aux decision and the ink tokens as parameters.
- So the pane, the thumbnails and the exports share one builder with References.

**A new `PaperSurface 'fold'`** using References' field list, extracted as
`STEP_DIAGRAM_FIELDS` so the two cannot drift. Its export target has
`surface: 'fold'`, one page per step, and `paperExportKindOf('fold') = 'step'`.

**The Paper tab:**
- It edits the **app display style**, like Simulate's pane, through a generalised
  display-style binding: `useSimulatorPaperStyle` renamed, `'fold'` added to
  `PaperStyleEditSource`, and the field list as a parameter so Fold's reset
  never clobbers pens it does not show.
- Simulate's Front/Back `ColorField` rows become a small shared component over
  that binding; Simulate is unchanged.
- **The folded-figure and inline-simulation property catalogs are untouched.**
  They pin per-object values with undo; they are not copies of this.
- Its other contents:
  - an "Edit paper style…" link to Settings ▸ Paper;
  - **"Front up / Back up"**, the sequence's `startSide` (document state). The
    presets disagree about which face is "coloured", so the label is not
    colour-based;
  - **Shape**, which is engine state (D7).
- **No per-sequence colours in this plan** (the `appearance` slot is reserved,
  D7).

**The design's teal moving-set tint** is a theme accent drawn over the paper,
never a paper colour.

Not doing:
- References' CSS-token route for Fold's canvases;
- a Fold-specific painter;
- porting the spike renderer.

### D12 — Scene contract

**Per state**, a superset of the kernel's folded paper scene:
- `faces[]`: `outline`, `points`, `front_up`, `edges[].kind`;
- **`subfaces[]` with full `faces_top_to_bottom` stacks**, from the shared
  overlay (D8);
- `sheet_points`, `sheet`, `flipped`;
- `face_transforms`;
- `creases[]` with `madeAt`;
- optional lineage.

**Schema 3** (`FoldedPaperFace.points`, `sheet_points`) comes from #436.
`main` is still schema 1. Fold is based on #436 (decision C), so it emits schema 3
directly, and the Fold-only fields live in a Fold-owned TS type that extends the
kernel's.

**Per step**, a `FoldActionGeometry`:
- the fold line, with visible and hidden spans;
- the moving faces;
- the grip and its image;
- push or pleat geometry.

**Shared painter changes** (Phase 5):
- the policy parameter on `foldedSceneLocalGeometry`;
- an exported `paperSceneToFoldedGeometry`;
- a per-face ink/alpha override (moving-set highlight, x-ray);
- **dash slots in the folded channel**, as a separate PR: it visibly changes
  Edit's 3D figure under dashed pens (Phase 5 gate).

### D13 — Canvas: `useCpSurface`, Fold-native picking

Extract **`useCpSurface`** from `ReferencesCpView`. That is about 430 lines of
glue already duplicated from the Edit canvas.

**What the hook owns:**
- renderer lifecycle, context loss, resize;
- camera seed and fit;
- pan, pinch, wheel, click versus drag;
- the per-frame hover probe;
- zoom reporting;
- `ReferencesCpView`'s coarse-pointer behaviour (touch-down mark, coarse hit
  floors).

**Its seam:** a caller-supplied `hitTest(modelPoint, radii)` and upload
callbacks. It does not choose a paint channel: References keeps its strokes
channel; Fold's panes draw through `setFolded` with the `fold` policy.

**Gate:** `ReferencesCpView.test.tsx`. Edit migrates later, if ever.

**Picking and snapping** use Fold-native geometry, in the same frame as the
pane's `PaperScene`:
- the topmost face and the stack under the cursor come from `subfaces`;
- landmarks come **from the engine, with provenance**;
- hit-testing uses `LineHitIndex` over the engine's `creases[]` (ids are Fold
  edge ids) and `cpHitRadiusModel`, scaled from model units to the sheet.

Not reused:
- `nearestCpSnapTarget` (Oriedita parity);
- the Diagram's `pictureSnap`, which recovers points from a picture without
  provenance. Its vertex/end/crossing ranking is a pattern to copy at most.

**Tools** use the surface-agnostic reducers (`ToolEngine`, `createToolRuntime`,
`createStepSequenceTool`) in a Fold-local registry with the `CpStepSnap`
vocabulary. **Not** `inputModelRegistry`, which is keyed to kernel operations.

### D14 — The UI is composed from the design system; the engine supplies the data

| Design element | Component |
|---|---|
| Left panel | `ui/ToolRail` (on #436), one `foldRailGroups()` for the rail and the phone `ToolPicker*` sheet |
| Shortcut letters | In tooltips, not badges |
| V / M / P direction | `SegmentedControl` |
| Inside reverse and later folds | Rail tools, not segments |
| Line modes | Axioms 1–7, free line, and **existing crease**: snap ℓ to a visible crease or bend |
| Tool window | `ToolHintWindow` with a React-free tool-window model and one renderer (Simulate's pattern) |
| Numbered instructions | `ToolHintInstructions` (on #436) with new `ordered` / `current` props |
| Moving-side swap | `Button` |
| Flap pills | `Chip` with `aria-pressed` |
| Refusals with fixes | `Notice` (on #436) with a new `danger` tone and an `actions` slot |
| Choices you cannot point at (axiom roots, openings, completions, Import-CP orders) | `CpToolOptionLayer`, generalised to take an injected projection instead of `useCpOverlayView` (TypeScript only, no CSS rule added) |
| Header | `WorkspaceTabStrip` "Fold \| Steps", `Button` / `SplitButton` |
| Status chips | `ViewportStatusReadout` |
| Bottom bar | `ViewportToolbar` |
| Right panes | `fold-step`, `fold-paper` side panes; `FieldRow` static rows; `CollapsibleSection` |
| Step strip with branches "1/2" | References' `ReferencesStepFilmstrip`, extracted, with a picture slot, card states and a caption tag; its "ways" become branches (shared CSS block → decision **B**) |
| Steps grid | #436's `DiagramStepsGrid` shell, extracted as pre-work. It is CSS-module based (no decision B); it numbers steps and leaves turns unnumbered; Fold supplies its card body |
| Phone two-pane switch | `PaneToggle` extracted from `DesignPaneSwitcher` into `components/ui/`. Its single-owner `.design-pane-switcher` rules move into a module; it keeps wearing the shared `canvas-pill` class. Mounted in `CanvasPillLane` |
| Touch undo | `CanvasHistoryPills`: add `'fold'` to `HISTORY_PILL_WORKSPACES` |
| Free point on touch | A coarse-pointer Alt latch modelled on `touchModifiers/shiftLatch.ts`, OR'd with `readHeldModifiers().alt` |
| Import CP | `useModalDialog` (on #436), the app's parsers, a drop policy for the Fold canvas |
| Send to Edit | The existing verb, label, `SplitButton` model and payload path |

Genuinely new, kept inside Fold: the **cross-section layer picker** and the
two-canvas split.

**The cross-section, specified:**
1. **Intervals.** Cut ℓ at subface boundaries. Each interval carries its
   `faces_top_to_bottom` stack.
2. **Display layers.**
   - A display layer is a set of faces joined across F edges (they share one
     isometry).
   - Rows, row counts ("n of m layers moving") and picker targets are display
     layers, never faces.
   - So one physical layer crossed by a precrease is one row (test: precrease a
     diagonal, then fold in half across it).
3. **Row order.**
   - Topological sort of the relation the interval stacks give. That relation is
     acyclic for faces in a valid state.
   - Ties between rows with disjoint spans are broken by span position, and such
     rows are said to be unordered.
   - If grouping into layers creates a cycle (a woven layer), return
     per-interval stacks and show the interval under the cursor.
4. **Flaps** group rows exactly as D3 defines them.
5. **"Layers"** in the Step pane is the maximum stack depth along ℓ, in display
   layers.

**Accessibility.** The picker is an HTML listbox or radio group of display
layers, top to bottom, with arrow keys, a selected state and accessible names.
The flap chips are the keyboard path for picking flaps. Tests find layers by role
and name.

**Refusals and fixes.** The engine returns each refusal with the faces it names
and its candidate fixes:
- "include flap N": the closure;
- "fold the other way": if it is valid;
- "pick a flap": when everything would move.

The UI may auto-include or explain.

**Keyboard** (a conditional `fold` scope):

| Key | Action |
|---|---|
| ←/→ | Previous/next step, as References and the Diagram |
| `[` / `]` | Aliases for ←/→ (the Diagram's) |
| ↑/↓ | The active step's branch, as References' ways |
| Shift+←/→ | Candidate roots |
| Space | Play the step |
| Enter | Commit; declines when a focused control owns the key (Diagram precedent) |
| Escape | Through the viewport cancel ladder |

- Rotate takes another key.
- Axioms on bare digits would shadow the viewport's digit keys; the UI designer
  picks Shift+digits or accepts the shadowing.
- The scope declines while focus owns the arrow keys, as the Diagram's does.

**Interaction cost**, in three tiers:
1. **Per pointer move**, main thread: snapping, picking from cached `subfaces`,
   the flap/stack highlight. Budget ≤ 4 ms.
2. **Once per (ℓ, side, direction)**, in the worker and cached: pieces, flaps,
   the cross-section, closure choices.
3. **Per (ℓ, side, direction, flaps)**, in `foldSequenceWorker`, latest request
   wins: the landed state through `State::make`, its overlay, the crease-pattern
   diff and the PREVIEW thumbnail. Budget ≤ 50 ms at 256 faces in wasm. Real
   models (the 60-face crane) are the primary target; 256 and 400 faces are the
   stress cases.

**Per-step summaries** the engine provides:
- M/V/F counts (front-relative);
- the crease-pattern diff (added, reversed, unfolded);
- "Layers";
- inputs for the generated sentence.

**Sentences** come from a pure builder in `fold/`.
- The vocabulary (compass names, axiom phrases, mover-first ordering) is
  extracted from `referencesStepSentences.ts`, with its i18n keys moved in one
  commit across all 9 locales.
- Fold has full-sentence keys of its own, because concatenating clauses breaks
  word order in ja/ko.

### D15 — Animation

- **A plain fold is two rigid groups.** Pose the `PaperScene` itself:
  - rotate the moving faces' rings about ℓ;
  - flip the side and **reverse the moving group's draw order** past edge-on
    (90°);
  - shade;
  - paint through the same painter (D11).

  Frames then match export by construction. Test frame continuity as θ → 180°.
- **Reused from the precrease animation:** the rigid hinge, tilt shade and
  face-flip rules.
- **Extract `foldPlayback` / `foldTransport`** behind a programme input. The
  References tests are the gate.
- **Compound steps** get a visual `StepMotion`: legs with exact endpoints. A
  reverse fold has no rigid motion short of unfolding the vertex (§9).
- **Import CP** animates as a crossfade.

### D16 — Import CP is a step

`op: { kind: 'cp-jump', cpJson, orderJson, origin }`. It is a snapshot, not a
link. `origin` is a closed enum (`cp | fold | ori | orh | sample |
edit_folded_figure`), never a file name.

**Pipeline:**
1. The kernel loaders (`.cp`, `.fold`, `.ori`, `.orh`) and `export_fold`, inside
   `oristudio-fold-wasm` (D1).
2. Find the sheet from the kernel model's border loop with
   `outline::detect_border_loops` (D9). Exactly one closed loop is required.
3. The recovered frame must match the sequence's shape and aspect within tol.
   - **V0 supports square and rectangle sequences only.**
   - A polygon sequence that has steps, or a non-rectangular outline, is
     refused (`import_shape_unsupported`, `import_shape_mismatch`).
   - Importing into an *empty* sequence of any shape adopts the crease
     pattern's square or rectangle shape.
4. Map the colours by D10's inverse.
5. Fold builds faces, isometries and constraints itself.
6. **Complete, seeded by the imported M/V letters** (U creases stay unknown),
   through D8.
   - The count is a true "n of m" once `r069-s07` is attributed (D8).
   - The stored order must reproduce the imported letters.

**Orientation and placement:**
- The crease pattern's front is the sheet's front, whatever `startSide` is.
- Use the frame the outline code chooses. For a square, an optional rotate/flip
  choice can come later.
- The jumped state keeps the current view.
- Its root is the face containing the previous root's sheet point, at that
  point's previous isometry.

**Marks and creases from before the jump:**
- marks made before the jump stay visible if their sheet points lie on the
  imported sheet;
- earlier creases missing from the imported crease pattern are dropped, because
  the jump replaces the state.

**`orderJson`** names faces by interior sheet-point witnesses (D6).

**Samples** are small attributed `.fold` fixtures that ship with Fold: the
square (preliminary) base, the waterbomb base and pleat-in-eighths. They are
built from the sink spike's hand-assigned crease patterns. The kernel's
`default-molecules` are stamping templates, not foldable sheets, so they are
not used.

**"Start from Edit's folded figure"** maps Edit's chosen Oriedita solution
through the shared order type. This mapping is already done in the experiment
harness.

### D17 — Diagram link

**Two seams instead of a third bespoke source kind:**
- `posedRenderOf(source)`, so `fold-step` reuses `cp`'s `render`, `remembered`
  and scene capture;
- a link descriptor keyed by kind (`statusOf`, `openSource`, `originLabel`).

**The source:**
`{kind: 'fold-step', sequence, step, moment, path: 'fh1:…', state: 'fs1:…', engine, render, remembered?, thumbnail, sentence?}`.

- `thumbnail` is a `SheetThumbnail` (role strokes, `fitSheetThumbnail`, capped
  like `captureThumbnail.ts`), matching the `cp` and `references` sources.

**Digests, one role each:**
- **`fh1`** = `keyDigest(canonical(paper), …{op, choices} for each node along the path)`.
  It is the path's identity and the in-memory cache key; the cache stores
  `FOLD_ENGINE_VERSION` beside it as a separate field.
  - Marks, notes, `expect` and `unknown` are excluded.
  - Canonical form: fixed key order, shortest-round-trip f64.
- **`fs1`** = the numbering-free canonical-state fingerprint. It decides drift
  (`expect`) and link staleness.
- **`engine`** on the link is diagnostic only. An engine bump never marks a link
  stale by itself.

**Status:**
- the node is gone, broken, or its `fh1` no longer matches → `missing`;
- the sequence is not loaded, replay is pending, or the node is locked →
  `unknown`;
- same `fs1` → `current`;
- different `fs1` → `stale`, counted by Refresh all.

**Also:**
- turn nodes become `DiagramTurn` entries;
- auto-marks carry the planned `imported: untouched | edited` tag;
- References' pull browser is generalised to take a Fold provider.

### D18 — Instrumentation

Closed enums and buckets only. Commands dispatched through `MENU_ACTION_IDS` are
already tracked at the chokepoint.

| Event | Properties |
|---|---|
| `fold step added` | `{op_kind, layer_scope: all\|flaps\|depth, via: axiom\|crease\|free}` |
| `fold refused` | `{code}` |
| `fold choice offered` | `{kind, count_bucket}` |
| `fold sequence sent to edit` | — |
| `fold cp imported` | `{origin}` (D16's enum) |
| `fold step sent to diagram` | Later |

- **Per-step axiom codes are left out.** They would add up to the axiom histogram
  `docs/analytics.md` forbids. Adding them needs the owner's explicit exception.
- **Paper events are reused, not duplicated:** `paper style changed` with
  `source: 'fold'`, and the paper-export events with `surface: 'fold'`. Add them
  to `PaperStyleEditSource` and `PaperExportSurface` in the same change that adds
  `PaperSurface 'fold'`.
- Everything is documented in `docs/analytics.md`.

### D19 — Testing strategy

- **Rust:** each crate gets unit tests beside the code, property tests with
  seeded random sequences (every state checked by the shared checker), and
  negative controls. Oracle binaries are wired into CI (D8).
- **Web:** pure modules get vitest under Node 22, run in the web workspace
  (reader/writer, replay, tool-window model, rail groups, sentences, action
  catalog, keyboard scope). The bridge gets a `foldSequence.wasm.test.ts`,
  modelled on `precreasePlan.wasm.test.ts`.
- **Extractions:** each keeps its existing users' tests green, and, where CSS
  moves, a computed-style check in both themes.
- **Browser:** checks on the dev server per Phase 6, in both themes and on a
  phone, with screenshots.
- **Builds:** `npm run build:web` without `--ignore-scripts` whenever the bridge
  changes. `wasm-pack test --node` is a local gate, since CI runs no wasm-pack
  tests.

### Reuse map

Evidence links point to §n of the research doc, or to `research/2026-10-08-fold-workspace/` (`r1-…`, `r2-…`, `r3-…`).

| Layer | Decision | Evidence |
|---|---|---|
| Axiom solvers, line, tol, frame, sheet, outline | **Extract** → `oristudio-geometry`; precrease re-exports | §14; `r3-reuse-geometry-cp-io` §1 (600k bit-identical); committed `dump_closure` baselines |
| Convex-polygon primitives | **New, shared** `oristudio-geometry::convex`; the only owner for the new crates | review; spike `geom.mjs` / `indep.mjs` |
| Layer-order type, overlay, constraints, checker | **New shared crate** `oristudio-layer-order` | §7.1, §7.2; `r3-reuse-solver` C1/C5 |
| Completion search | **Reuse** Flat-Folder's search through a new entry point (cells passed in) | §7.1; `r3-reuse-solver` C2 |
| Edit's 2D and 3D layer order | **Keep** (parity / 3D scope); seeded oracle for Fold | §7.1, §7.2 |
| Crease-pattern storage | **Fold owns it**; one lossless conversion to the kernel model | §14; `r3-reuse-geometry-cp-io` §2 |
| Send to Edit, writers, loaders | **Reuse** through the conversion | `r3-reuse-geometry-cp-io` §2–§3 |
| FOLD sequence export | **Reuse** `treemaker-fold::FoldDocument` and, through `kernel`, `interchange.rs`'s size and marker conventions. **No writer extraction**: `folded_form_frame` is 3D-internal | `r3-reuse-geometry-cp-io` §6; review |
| Paper painting | **Reuse** `PaperStyle`, `PaperScene`, `foldedFlatPaperScene`, `foldedSceneLocalGeometry`, `paperSceneToSvg`; add `PaperSurface 'fold'` | §9; `r3-reuse-rendering-paper` §1 |
| Step crease pattern → `PaperScene` | **Generalise** `diagramToPaperScene` + `referencesExportTarget` | `r3-reuse-rendering-paper` §5; review |
| Paper display-style binding and Front/Back rows | **Generalise** `useSimulatorPaperStyle`; share Simulate's rows; folded-figure and inline catalogs untouched | review (`useSimulatorPaperStyle.ts:88-102`) |
| WebGL surface glue | **Extract** `useCpSurface` from `ReferencesCpView` | §14; `r3-reuse-rendering-paper` §2 |
| Folded-channel policy, ink override | **Extend** the shared painter | `r3-reuse-rendering-paper` §3 |
| Folded-channel dashes | **Extend**, as its own PR (visible change to Edit) | review |
| Step strip with branches | **Extract** from References' filmstrip (decision **B**) | `r3-reuse-ui-design-system` §4.2 |
| Steps grid | **Extract** #436's `DiagramStepsGrid` shell (pre-work) | review (`31e1d6d84:apps/web/src/components/diagram/DiagramStepsGrid.tsx`) |
| Phone pane switch | **Extract** `PaneToggle` from `DesignPaneSwitcher` | review (`DesignPaneSwitcher.tsx`) |
| Candidate chooser | **Generalise** `CpToolOptionLayer` (TypeScript only) | `r3-reuse-ui-design-system` §4.6 |
| Tool rail, tool window, instructions, Notice, modal | **Reuse** from #436, the base (decision **C**) | `r3-reuse-ui-design-system` §2 |
| Keyboard scope | **Extract** a keyed `registerConditionalScopeExecutor` (pre-work), migrating simulator, references and diagram before Fold's scope | `r3-reuse-ui-design-system` §5; review |
| Animation transport | **Extract** `foldPlayback` / `foldTransport` | `r3-reuse-rendering-paper` §5 |
| Arrows and marks vocabulary | **Reuse** `StepDiagramPrimitive` / `stepDiagramGeometry`; move to a neutral module (pre-work) | `r3-reuse-rendering-paper` §5 |
| Sentences | **Extract** the vocabulary; Fold has its own sentence keys | `r3-reuse-ui-design-system` §4.11 |
| Divide-line marks | **New** annotation, reusing Edit's exact ratio expressions and References' marker rendering | `r3-reuse-geometry-cp-io` §5 |
| Document envelope | **Extract** `lib/documentFile/` (pre-work; `NEWER`/`hasNewerKey` lifted from `diagramFile.ts`), migrating the Diagram | `r3-reuse-steps-documents` C1 |
| Store kit, `projectSlice` document registry | **Extract** as pre-work, *before* Fold's slice, migrating the Diagram | `r3-reuse-steps-documents` C2/C3 |
| Undo | **Reuse** `snapshotHistory` as it is | `r3-reuse-steps-documents` §1.5 |
| Shared step model | **Do not share**; share the vocabulary (`Construction` and witness input order, `extent`, the turn type) | `r3-reuse-steps-documents` C4/C8/C12 |
| Turn type | **Lift** `DiagramTurnKind` to a neutral module | `r3-reuse-steps-documents` C12 |
| Touch undo pills | **Reuse** `CanvasHistoryPills` | review (`useCanvasHistoryPills.ts:16`) |

### Owner decisions

Decisions A, B and C were settled on 2026-10-08; see "Settled with the owner".
None is pending.

**Adopted unless the owner objects:**

- the Paper tab edits the app display style;
- turn and rotate steps are unnumbered;
- inside reverse is a rail tool;
- ←/→ move between steps and ↑/↓ between branches;
- engine sheets are convex only, and V0 Import CP is square or rectangle only;
- Import CP is allowed mid-sequence (it replaces the state);
- crimps are offered only with the same kind on both lines;
- no axiom codes in analytics.

## Affected Areas

**New crates:**

- `crates/oristudio-geometry`
- `crates/oristudio-layer-order`
- `crates/oristudio-fold`
- `crates/oristudio-fold-wasm`
- workspace members in `Cargo.toml`
- `LICENSING.md` rows: the new crates, and `tests/fixtures/beloch/` (MIT)

**Changed crates and tools:**

- `crates/oristudio-cp`: one additive public function exposing the closure step
  for the seeded Oriedita oracle (D8).

- `crates/oristudio-precrease`: modules move out and are re-exported. A
  `GeometryError` mapping is added.
- `crates/oristudio-precrease-wasm`: one call site (`lib.rs:550`).
- `crates/treemaker-flatfold`:
  - the completion entry point;
  - its transitivity source becomes a parameter;
  - a port of `error_faces`.
- `tools/flat-folder-oracle`: a `verify` command with arrangement validation and
  ε retry.
- `crates/oracle-tests`: new Fold oracle binaries; the committed `r271-s03`
  fixture case.
- `.github/workflows/ci.yml`: add the Fold oracle test to the Flat-Folder oracle
  step.

**Fixtures and docs:**

- `tests/fixtures/precrease/` baselines (committed hashes);
- `tests/fixtures/flat-folder/r271-s03.fold`;
- `tests/fixtures/beloch/`;
- `tests/fixtures/fold-sequences/` (goldens and samples);
- `PORTING.md`: a new Flat-Folder section covering the `ExE_fill_BT` quirk, the
  arrangement's numbering dependence, and the entry point's contract;
- `docs/analytics.md`;
- optionally, the repository layout in `AGENTS.md`.

**Web build wiring:**

- `apps/web/package.json`: `build:oristudio-fold-wasm`, appended to
  `build:wasm`.
- No workflow edits are needed: CI, the deploy workflows, `release.yml` and
  Tauri all go through `build:wasm`.
- Never commit the generated output.

**Web, new:**

- `apps/web/src/fold/`: document, reader, replay, actions catalog, tool-window
  model, tools registry, sentences, picking, motion, the step-diagram adapter
- `apps/web/src/components/fold/`
- `apps/web/src/components/panels/Fold*.tsx`
- `apps/web/src/workers/foldSequenceWorker.ts`
- `store/workspaceStore/foldSequenceRuntime.ts` and the Fold slice
- `lib/documentFile/`

**Web, shared extractions** (each behaviour-preserving unless marked):

- `useCpSurface`
- `PaperSurface 'fold'` and `STEP_DIAGRAM_FIELDS`; `PaperStyleEditSource` and
  `PaperExportSurface` gain `'fold'`
- `foldedSceneLocalGeometry`: policy parameter, `paperSceneToFoldedGeometry`, the
  per-face override. **Dashes are a separate, visible change.**
- the display-style binding and Simulate's Front/Back rows
- `diagramToPaperScene` / `referencesExportTarget`
- `foldPlayback` / `foldTransport`
- `CpToolOptionLayer`
- `sendToEditActions` taking sources
- the sentence vocabulary and its i18n keys
- the turn type (`DiagramTurnKind`)
- `PaneToggle`
- the step filmstrip (decision B)
- the `DiagramStepsGrid` shell, the store kit, the `projectSlice`
  registry, keyed conditional scopes, the arrows/marks vocabulary

**Web, registration** (as References and Diagram did):

- `workspaces/*`, `routing/*`, `store/layoutStore.ts`
- `components/panels/PanelComponents.tsx`, `WorkspaceShell.tsx`,
  `WorkspaceViewDrawer.tsx`
- `hooks/useCanvasHistoryPills.ts`
- `App.css` (the header rule, edited in place)
- `commands/menuActions.ts`, `menus/menuDefinition.ts`
- `lib/workspaceCapabilities.ts`
- `store/workspaceStore/*` (capabilities, history, types, store, landing)
- `keyboard/*`, `i18n/shortcutLabels.ts`
- `analytics/events.ts`
- `public/locales/*`
- `lib/nativeProjectFile.ts` and `slices/projectSlice.ts`, including #436's
  `keepsOriedita`: a project holding sequences must save as `.osf`, never to the
  `.ori` / `.orh` writers
- every test that enumerates workspaces

**Later, on the Diagram:** `diagram/document/*`, `capture/linkStatus.ts`,
`pictures/paintDiagramStep.ts:160`, and the pull browser.

**Not touched:** `apps/tauri`, `third_party/*`, Edit's Oriedita folding engines
(2D and 3D), apart from the one additive oracle function below.

## Checklist

### Phase 0 — Research and spikes

- [x] Codebase map, prior art and state representation (`r1-*`).
- [x] Spikes:
  - [x] plain folds (52,937 ops);
  - [x] reverse folds, crimps and tucks;
  - [x] squash, petal and rabbit ear;
  - [x] sinks;
  - [x] the Beloch fixtures (`r2-*`).
- [x] Reuse audit (`r3-*`):
  - [x] solver experiment;
  - [x] geometry probe;
  - [x] kernel round trip;
  - [x] painting spike;
  - [x] UI map;
  - [x] documents.
- [x] Adversarial review of both documents: 90 findings kept, all addressed.
- [x] Owner settled: Beloch is reference-only; the shared geometry crate; paper
  settings; the sequences array; the recommendations.
- [x] Owner decisions A (reader-version bump), B (CSS moves as pre-work), C (branch off #436's head).

### Phase 1 — Shared Rust foundations (pre-work)

- [ ] **1a `oristudio-geometry`.**
  - [ ] **First commit, on the unchanged base:** committed full sha256
    baselines of `dump_closure`, with and without `--plan`, for every fixture
    in `tests/fixtures/precrease/`, plus `bird_base.fold` and `kabuto.fold`.
  - [ ] Move `tol`, `line`, `pointgrid`, `frame` (with `GeometryError`),
    `sheet`, `outline` and `construct`.
  - [ ] Add `Paper`, the generic `lines`/`certify`, `nearest_root` and
    `convex`.
  - [ ] Precrease re-exports everything; the one wasm call-site change.
  - [ ] Gates, in order:
    - [ ] the `dump_closure` hashes;
    - [ ] `cargo test -p oristudio-precrease`;
    - [ ] the RF cross-check `--strict`;
    - [ ] `wasm-pack test --node crates/oristudio-precrease-wasm` (the
      `invalid_frame` code);
    - [ ] `precreasePlan.wasm.test.ts`.
- [ ] **1b `oristudio-layer-order`.**
  - [ ] The order type and its conversions.
  - [ ] The convex overlay into cells.
  - [ ] The constraint problem (incremental), and the checker naming faces.
  - [ ] Tests: the spike's golden conventions; negative controls; a woven
    (cyclic) state.
- [ ] **1c `treemaker-flatfold` entry point.**
  - [ ] Caller-supplied variables, buckets and cells; transitivity source
    parameterised; carried vs seed.
  - [ ] Budget; per-component solutions; `error_faces`.
  - [ ] Existing oracle tests unchanged.
  - [ ] Attribute the `r069-s07` miss (constraint generation or search).
  - [ ] Commit `tests/fixtures/flat-folder/r271-s03.fold` with an oracle case.
  - [ ] Add the `PORTING.md` Flat-Folder section.

### Phase 2 — Engine core: plain folds (`oristudio-fold`)

- [ ] **State.**
  - [ ] `State::make`: residual, hinge consistency, convexity, order
    completeness, constraints, letters. Refusal codes.
  - [ ] Isometries; the pair store with a bounding-box index; incremental update.
- [ ] **Plain fold (D3).**
  - [ ] The closure (i) qualifier, with a unit test: a strip folded at y=0.2,
    then the top layer folded at y=0.3, gives U = {that layer}.
  - [ ] Flaps; the closure report; refusals with fixes.
  - [ ] Precrease, refold, unfold, turn, rotate.
- [ ] **Numerics (D5).**
  - [ ] The snap invariant, with a property test that no applied fold changes a
    vertex's class.
  - [ ] μ checks, including image–image.
- [ ] **Output and queries.**
  - [ ] Scene emission (D12) and `FoldActionGeometry`.
  - [ ] The cross-section query (D14 spec), with a precrease-row test.
  - [ ] Per-step summaries and the crease-pattern diff.
  - [ ] Convex polygon sheets; non-convex sheets refused.
- [ ] **Kernel feature.**
  - [ ] `fold_cp_to_model` and its inverse.
  - [ ] Round-trip test: Send to Edit, then Import CP, gives the same state.
- [ ] **FOLD export.**
  - [ ] `diagrams` class and a kernel root frame.
  - [ ] Flat step frames with a `oristudio:fold-step` marker.
  - [ ] Size checked through `interchange.rs`'s types, against a whole-file cap,
    with the refusal arm tested.
  - [ ] Beloch-compatible face matrices.
- [ ] **Tests.**
  - [ ] Property tests and classic sequences as fixtures.
  - [ ] Oracle binaries (D8) wired into CI.
- [ ] Native performance recorded against real sequences.

### Phase 3 — Axioms on flat and folded forms

- [ ] Landmarks with provenance (vertices, edges, crossings, marks, existing
  creases); visibility from the order.
- [ ] O1–O7 through `Paper` on the folded silhouette:
  - [ ] who moves;
  - [ ] Lang's O6 rule;
  - [ ] `nearest_root` on replay.
- [ ] The existing-crease line mode.
- [ ] Tests:
  - [ ] each axiom on a flat sheet against precrease;
  - [ ] each axiom on folded forms;
  - [ ] replay stability.

### Phase 4a — Bridge and document

- [ ] `oristudio-fold-wasm`:
  - [ ] `kernel` enabled;
  - [ ] coarse calls; refusals as codes;
  - [ ] `wasm-pack test --node`;
  - [ ] **size measured with and without `kernel`, against a budget**.
- [ ] `build:oristudio-fold-wasm` in `apps/web/package.json`; `npm run
  build:web` in a fresh worktree; `npm run typecheck:web`.
- [ ] `foldSequenceWorker` and the runtime:
  - [ ] terminate and respawn to stop work (`precreaseRuntime`'s `dropWorker` /
    `whileClientAlive`);
  - [ ] latest request wins for previews.
- [ ] The `FoldSequenceDocument` reader and writer, with one test per D6/D7
  rule:
  - [ ] dropped subtrees;
  - [ ] locked unknown ops;
  - [ ] duplicates, orphans and cycles;
  - [ ] a newer `formatVersion` opens read-only;
  - [ ] an empty array leaves the file byte-identical;
  - [ ] unknown keys carried.
- [ ] Replay:
  - [ ] the active path first, step by step, with progress;
  - [ ] the load id;
  - [ ] the `fh1` cache;
  - [ ] `expect` drift;
  - [ ] tests: siblings differing only in `choices`, and otherwise identical
    sequences differing only in `paper`, get different `fh1`; a note edit
    leaves `fh1` unchanged; a stored choice that conflicts →
    broken; one that drifts → changed.
- [ ] Wasm performance: the plain-fold op (split, carry and place the order,
  residual) at or below the JS spike's p95 (≤ 2.2 ms at 33–64 faces, ≤ 17.2 ms
  at 129–256; research §12, `r2-spike-core`), and the full tier-3 preview (D14)
  within 50 ms at 256 faces.

### Phase 4b — Store and project file

- [ ] The Fold slice, against the store kit extracted in Phase 5.
- [ ] A `fold` branch in `historySlice`.
- [ ] Reader-state reconciliation (D6), with the undo/redo/delete tests.
- [ ] `workspace.foldSequences` with reader version 10 (decision A); a test that
  an older reader refuses the file rather than dropping the sequences.
- [ ] `keepsOriedita` extended; landing; New/Open discard.

### Phase 5 — Front-end extractions (pre-work)

Built on #436's head, so they target #436's versions of the shared files
(`paperStyleResolve.ts`, `foldedFlatScene.ts`, `cpFoldedToScene.ts`). They land
as small PRs with Phase 1, ahead of the Fold feature PRs (decision B).

Each item is behaviour-preserving, with its existing users' tests as the gate,
unless marked.

- [ ] **CSS-module moves (decision B):** References' step filmstrip
  (`references-filmstrip` / `references-card`), extracted into a shared component
  with a picture slot, card states and a caption tag. Gate: computed-style checks
  in both themes and under a coarse pointer, plus References' tests.
- [ ] `DiagramStepsGrid` shell extraction (the Diagram's grid tests are the gate).
- [ ] Keyed conditional-scope registry, migrating simulator, references and
  diagram.
- [ ] `Notice`: `danger` tone and `actions`. `ToolHintInstructions`: `ordered` and
  `current`.
- [ ] `lib/documentFile/`, migrating the Diagram's reader onto it.
- [ ] The store kit and the `projectSlice` document registry, migrating the
  Diagram.
- [ ] The arrows/marks vocabulary moved to a neutral module.

- [ ] `useCpSurface`.
- [ ] `PaperSurface 'fold'` + `STEP_DIAGRAM_FIELDS` + the analytics enums.
- [ ] `foldedSceneLocalGeometry`:
  - [ ] the policy parameter;
  - [ ] `paperSceneToFoldedGeometry`;
  - [ ] the per-face override;
  - [ ] with the `fold` policy, canvas colour, width and dash equal the SVG's for
    each role, on both panes.
- [ ] **Separate PR, a visible change:** folded-channel dashes.
  - [ ] Default and Diagram presets pixel-identical in both themes.
  - [ ] Dashed custom pens compared against the SVG export.
  - [ ] A unit test for dash runs.
- [ ] The display-style binding generalised; Simulate's Front/Back rows shared
  (Simulate unchanged).
- [ ] `diagramToPaperScene` / `referencesExportTarget` generalised: polygon
  outline, policy, aux and ink parameters. Gate: `referencesStepExport.test.ts`
  and its golden.
- [ ] `foldPlayback` / `foldTransport`.
- [ ] `DiagramTurnKind` lifted to a neutral module (the Diagram's tests are the
  gate).
- [ ] `CpToolOptionLayer` taking a projection.
- [ ] `sendToEditActions` taking sources.
- [ ] Sentence vocabulary and the i18n key move.
- [ ] `PaneToggle`:
  - [ ] first commit: move the `.design-pane-switcher` rules into a module,
    verified with a computed-style check;
  - [ ] second commit: generalise, gated by `DesignPaneSwitcher`'s tests.

### Phase 6 — Workspace shell and UI

- [ ] Registration touchpoints, including `useCanvasHistoryPills` and every test
  that lists workspaces.
- [ ] The panel:
  - [ ] the split canvas on `useCpSurface`;
  - [ ] the phone `PaneToggle`;
  - [ ] the rail and phone picker;
  - [ ] the tool-window model;
  - [ ] the accessible cross-section picker;
  - [ ] flap chips;
  - [ ] the refusal notice with fixes;
  - [ ] the candidate chooser;
  - [ ] the Alt latch.
- [ ] Header, step strip with branches, Steps grid, Step and Paper panes; delete
  step.
- [ ] The Divide-line tool (count and exact ratio; marks stored per D6; one undo
  entry per add or clear).
- [ ] Keyboard scope, action catalog, analytics, i18n (9 locales).
- [ ] Browser verification, desktop and phone (tap-only), both themes:
  - [ ] a kite base;
  - [ ] a precrease through 4 layers, then a refold;
  - [ ] **unfold a flap** (book fold, then unfold the top half);
  - [ ] a collision and its fix;
  - [ ] a branch, with undo/redo across it;
  - [ ] a free point via the Alt latch on touch.

### Phase 7 — Animation

- [ ] Posed-`PaperScene` group motion with draw-order reversal; a fixed camera.
- [ ] Play, step, scrub, Space; reduced motion; injectable-clock tests; a
  frame-continuity test.

### Phase 8 — Import CP, exports, hand-offs

- [ ] **Import CP (D16):**
  - [ ] loaders in the bridge;
  - [ ] `outline` sheet recovery;
  - [ ] shape refusals, with tests (a rectangle against a polygon sequence with
    steps);
  - [ ] colour inverse;
  - [ ] letter-seeded completion;
  - [ ] witness-keyed `orderJson`;
  - [ ] the drop policy.
- [ ] Samples as attributed fixtures, each importing to ≥ 1 order.
- [ ] An Import-CP golden through `.cp` and `.fold`, checking letters and
  front/back.
- [ ] "Start from Edit's folded figure".
- [ ] Send to Edit, with the precreases-as-aux variant.
- [ ] FOLD export and the paper export target in the menu.

### Phase 9 — Inside reverse fold (V0.5)

- [ ] The tip; per-flap openings; kind feasibility (pre-select when only one is
  valid).
- [ ] Declared blocks, cross-block seeds, completion; the §5.2 letter rules as
  tests.
- [ ] Choices stored as free-variable assignments; the replay tests (resolves,
  broken, changed).
- [ ] The candidate chooser; a visual `StepMotion`.
- [ ] Fixtures: the preliminary base (two reverses), stacked flaps, and a real
  crane-neck sequence.

### Phase 10 — Diagram link (can run in parallel)

- [ ] `posedRenderOf`, the link descriptor, the `fold-step` source with a
  `SheetThumbnail`, and the D17 status rules.
- [ ] Generalised pull browser; turns as `DiagramTurn`; auto-marks with the
  `imported` tag.

### Phase 11 — Remaining compound folds

Each item needs: preconditions checked up front; choices surfaced; a visual
motion; oracle-verified fixtures.

- [ ] Outside reverse.
- [ ] Crimp: the same kind on both lines, one op.
- [ ] Tuck: bounded closure, "immediately under T", feasible targets listed.
- [ ] Squash (per-layer axes; free and uncovered), petal, rabbit ear (ridge),
  swivel.
- [ ] Open sink (closed point, single exterior letter, exact symmetric line as a
  landmark), closed sink (pocket), unsink.
- [ ] Optional: a free "collapse" assistant.

### Later

- Import a References plan as a Fold sequence (needs pinches).
- An opt-in "complete enumeration" mode for Edit's folded figure (§7.1 finding).
- Polygon Import CP: generalise `outline`.
- Pinches.
- Facets: key the order on the folded-crease arrangement.
- Exact predicates.
- Non-convex sheets.
- A posed 3D animation.
