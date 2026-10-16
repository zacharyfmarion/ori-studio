# Software prior art for sequential, human-style folding through layers

**Scope:** fold-the-folded-form engines, how each one picks the layers that move, how it updates the layer order, and what our Fold workspace should borrow or avoid.
**Evidence tags:** VERIFIED means I read the source code or the paper text myself. INFERRED means it is my own reasoning.

## Summary

- **Beloch is the closest prior art, and it is very new.** The repo was created 2026-09-21 and is MIT-licensed OCaml (https://github.com/tophcodes/beloch). It does what we want, but as a language rather than a GUI. It starts from a square, uses all seven Huzita–Justin axioms, and folds through some or all layers. Its verbs are `fold`, `reverse`, `flatten` (a multi-ray "fan" that covers squash and petal), `unfold` and `flip`. It works in exact real-algebraic arithmetic and writes FOLD output with one frame per step. Its `spec/MODEL.md` is a written formal model, and it answers almost every question we face (VERIFIED). Our engine should take that model as its starting point. We should not copy its representation shortcut, explained in the next bullet.
- **Layer order should be stored per pair, not as one global stack.** Several systems keep a single total stack of faces: Miyazaki 1996, Orimath, Rabbit Ear's legacy `flatFold` (`faces_layer`), paperfold-lab, and Beloch's own kernel (`rank`). Beloch's model explains why a total stack cannot represent every flat state: a square twist has a cyclic layering. Its kernel lists that as a known ceiling (issue #83). The FOLD spec's `faceOrders` is a per-pair format and explicitly allows cycles (VERIFIED).
- **Every system builds its folds the same way.** It splits faces along the fold line, chooses a set of faces to move, reflects them, and then places that block in the stack.
  - The systems differ almost entirely in how they compute the moving set.
  - Rabbit Ear only folds all layers.
  - Origami Editor 3D (OE3D) moves only faces hinge-connected to the one picked.
  - Miyazaki adds faces that overlap on the rotating side.
  - Beloch adds faces "outward" of the picked one, plus faces hinged off the fold line, up to an optional target layer.
- **Classic compound folds are built from simple ones, in two different ways.**
  - Eos builds a squash, a reverse fold or a rabbit ear as CutEdge, then a few simple folds, then GlueEdges. The intermediate states in that sequence are not valid paper.
  - Beloch performs one atomic reflection of two blocks for a reverse fold, and a general fan for squash and petal. Every result is a valid flat state.
- **Mountain/valley should be read off the resulting state, not taken from the command.** Beloch, Rabbit Ear and the Akitaya and Shimanuki papers all agree on this. When a fold goes through layers, the new crease reads valley on layers that were face-up and mountain on layers that were face-down. A crease that runs into an existing crease continues as its mirror image with the opposite letter (VERIFIED in all four).
- **No surveyed software implements open or closed sinks as a validated operation (VERIFIED for the code I read).** That includes Eos, Beloch, Rabbit Ear, OE3D and OriSim3D. Sinks are where we would be breaking new ground.

---

## Per-project details

### 1. Rabbit Ear (Robby Kraft), JavaScript, GPL-3.0

Repo: https://github.com/rabbit-ear/rabbit-ear. Version 0.9.4. License GPL-3.0, confirmed through the GitHub API.

**Data model (VERIFIED).**
- A plain FOLD graph in crease-pattern coordinates.
- The folded form is not stored. It is derived from the crease pattern by walking a minimum spanning tree of faces from a root face and reflecting across each folded edge (`src/graph/vertices/folded.js` L90–125).
- Layering uses either the non-standard `faces_layer` (one global z-index per face, legacy) or FOLD `faceOrders` triples.

**Current fold operation: `foldGraph`, `foldLine`, `foldRay`, `foldSegment`** (`src/graph/fold/foldGraph.js` L89–366, VERIFIED).
1. It temporarily swaps in the folded vertex coordinates.
2. It splits every face crossed by the line, ray or segment. The fold therefore always goes through all layers along the line.
3. It moves the new vertices back to crease-pattern space. Points on an edge are moved by the edge parameter `b`, for precision. Points inside a face use trilateration (L176–210).
4. It assigns M/V by face winding. Faces wound counter-clockwise (face-up) get the requested assignment, and clockwise faces get the opposite (L218–236).
5. It updates `faceOrders` in `src/graph/fold/general.js`:
   - Adjacent faces across the new crease get `[f0,f1,±1]` (L91–99).
   - Pairs from split faces that now sit on opposite sides of the line are re-signed using `faces_winding[b]` and valley/mountain (L164–232).

**Limits.**
- There is no way to choose which side moves; the root face determines it (INFERRED).
- There is no some-layers fold. `src/graph/flaps.js`, which would have found the flaps a line passes through, is entirely commented out (VERIFIED).
- **Probable gap in `faceOrders` (INFERRED).** Order pairs are only created for faces that were split, or pairs that were already ordered. Suppose a moving face that was not split lands on a stationary face it never overlapped before. No relation is recorded between them. The repo's own layer test comments "did not check this yet" on the third fold (`tests/graph.fold.foldGraph.layers.test.js`, VERIFIED). We should not use Rabbit Ear as an oracle for layer order.

**Legacy `flatFold`** (`src/graph/fold/flatFold.js`, VERIFIED).
- `foldFacesLayer` (L117–135) reverses the folding faces and stacks them on top of the stationary ones.
- It never looks at the assignment (L338–341). A mountain fold through all layers therefore also lands on top. INFERRED: this is wrong for mountain folds.

**Axioms.**
- All seven are in `src/axioms/axioms.js`, as floating-point implementations. Axiom 6 is a cubic solve.
- `validate.js` clips solutions to the paper boundary (VERIFIED).

**Diagrams and export.**
- `src/diagrams/axiomArrows.js` contains arrow helpers for axioms 1–5.
- `src/fold/frames.js` handles `file_frames` (VERIFIED).
- The related `amkraft/origami-diagrams` repo encodes diagram steps as `file_frames` with `frame_classes: ["diagrams"]` (VERIFIED README).

**Borrow:**
- Do the split in folded coordinates and map new points back by edge parameter.
- Derive M/V from face winding.

**Avoid:**
- An all-layers-only model.
- A partial `faceOrders` that has no completion step.
- Porting its code, because of GPL-3.0 (see the licence note under Lessons).

### 2. Beloch (Christopher Mühl, 2026), OCaml kernel + FLINT, MIT

Repo: https://github.com/tophcodes/beloch, with a browser playground at https://belochlang.org/playground/ (VERIFIED README).

**State, from `spec/MODEL.md` §2 (VERIFIED).**
- A triple: convex faces in paper coordinates, one plane isometry per face, and λ, an antisymmetric ±1 value on each pair of faces that overlap.
- States are considered equal up to "refinement", meaning splitting a face along a flat hinge changes nothing.
- A **flap** is a maximal set of faces joined by flat (angle 0) hinges. Programs address flaps, not faces.
- The remark on linear extensions shows that a stored total order cannot hold all states, citing the square twist.

**Validity, from §3 (VERIFIED).**
- The checks are the Akitaya et al. / Hull non-crossing conditions: order transitivity, taco-tortilla and taco-taco, plus hinge closure and connectivity.
- The spec cites Hull for these conditions being necessary and sufficient, and Demaine for a valid end state being reachable by a continuous motion.

**One fold primitive, from §5 `def-reflection` (VERIFIED).**
- Split every face along the fold line (a table line).
- Pick one or more **blocks**: faces on one side, each with a **placement** of *top*, *bottom*, *over T* or *under T*.
- Reflect them. Pairs within a block reverse their order, stationary pairs keep theirs, and block-versus-stationary pairs follow the placement.
- Keep the result only if it passes the §3 checks.

**`fold`, from `def-fold` (VERIFIED).** The moving set is the smallest set of faces on the moving side that:
- contains the "depth" flap, or every candidate face if no depth is given;
- is closed under hinges that do not lie on the fold line (otherwise the paper would tear);
- is closed outward: everything above for *top*, everything below for *bottom*;
- for *over/under T*, stops at the target T.

**`unfold`.** Reflects a block back across folded hinges that lie on the fold line. Lemma `lem-toggle` shows those hinges switch between 0 and ±π (VERIFIED).

**`reverse` (inside/outside).**
- The "tip" is cut at an "opening" between consecutive layers whose hinges are all folded and lie on one "spine" line.
- The two halves are reflected in one step, inside as *over B1* / *under B2*, outside as *bottom* / *top*.
- When there are several possible openings, the program must give letters to choose one, or the write is undefined (VERIFIED).

**`flatten` (fan).**
- Several rays from one vertex. An even ray count must satisfy Kawasaki's condition; with an odd count, the missing ray is derived.
- Each piece moves by the composition of reflections along its path on the paper.
- The kernel enumerates hinge-change combinations and stackings. The spec states that a candidate state is flat-folded, so Maekawa's theorem holds in every candidate (VERIFIED `def-flatten`; `KERNEL.md` "Fan"). This is how Beloch does squash, petal and swivel/rabbit-ear folds.

**M/V letter, from `def-letter` (VERIFIED).**
- The letter is valley when the face-up face is below, and mountain when it is above.
- No command takes a letter as an input; every letter is read off the state.
- `cor-fold-letters`: a *top* fold reads valley on faces that were face-up and mountain on faces that were face-down.

**Default fold scope changed over time (VERIFIED).**
- `notes/2026-07-20-default-fold-scope.md` moved from "all layers on that side" to "the outside layers down to the anchor's layer".
- ADR 0036 (2026-09-29) went back to all layers by default, with `up to <flap>` to narrow the fold. This is a real design tension, and the UI has to settle it.

**Exactness (VERIFIED README).**
- FLINT `qqbar` real-algebraic numbers. 10–30-statement programs evaluate in 0.13–0.24 s.
- The browser build runs FLINT compiled to wasm and refuses rather than returning a wrong answer.

**Kernel limits (VERIFIED `KERNEL.md`).**
- λ is stored as a total `rank`, so cyclic layerings cannot be represented (issue #83).
- Hinge scoring under a fan is partial.
- 3D states are not supported.

**Maturity risks (VERIFIED).**
- `MODEL.md` §5 is marked "draft".
- `lem-fold-closed` ("an outward-closed fold crosses nothing") has a pending proof.
- The repo has 2 stars and is two weeks old.

**Borrow:**
- The state definition.
- The reflection-of-blocks primitive.
- The moving-set closure rules.
- Letters derived from the state.
- The reverse fold as an atomic two-block reflection.
- The fan as the general multi-crease collapse.
- One FOLD frame per step, with each crease tagged with the step that made it.

The MIT licence lets us port ideas and code.

### 3. Eos / Orikoto (Ida, Takahashi, Ghourabi, Marin, Kasem), Mathematica

**Model (VERIFIED, Ida & Takahashi, ADG 2021, https://arxiv.org/abs/2201.00536 §2).**
- An "abstract origami" is (faces, adjacency, superposition). A fold is a rewrite from one such origami to the next.
- When face n is divided, it becomes faces 2n and 2n+1.
- Superposition is drawn as a directed graph (Fig. 6b).

**Fold algorithm (summarised from a search snippet of the JSC 2010 paper, which returned HTTP 403 when fetched).** Divide the faces the line passes through, classify them as rotated or not rotated, and rotate the selected ones by ±π.

**Choosing the faces.**
- `MountainFold` and `ValleyFold` take a list of faces plus a fold line. Eos "automatically computes the target faces".
- When the side is ambiguous, a ray is used and faces to the right of the ray move (VERIFIED ADG 2021 §5.2; SYNASC 2021 tutorial).
- `HO[...]` takes the keyword arguments below (VERIFIED, Ghourabi, Ida & Takahashi, https://ist.ksc.kwansei.ac.jp/~ktaka/LABO/DRAFTS/OSME2014ghourabi.pdf p. 5):
  - `Handles`: a point on the side that moves.
  - `Direction`: valley or mountain.
  - `InsertFace`: the face the moving block is inserted above or below.
  - `Case`: which axiom solution to use.

**Classical folds (VERIFIED ADG 2021 §4–5).** Squash fold = `CutEdge`, `ValleyFold`, `ValleyFold`, `HO[O2]`, `GlueEdges`. Inside and outside reverse folds, rabbit ear, and pleat/crimp follow the same cut, fold, glue pattern.

**Exactness (VERIFIED).**
- Folds are solved numerically.
- Correctness proofs use Gröbner bases or cylindrical algebraic decomposition, run over the constraints recorded during construction (OSME 2014 draft §5).

**Availability (VERIFIED, https://www.i-eos.org/).** Eos 3.9.1 needs Mathematica 14.3. It ships as notebooks, with no open-source licence and no source code.

**Borrow:**
- The idea of inserting a block above or below a named face.
- Storing each step's construction so it can be proved later.

**Avoid:** cut/glue composition as our internal model. It builds composite folds out of physically invalid intermediate states (INFERRED).

### 4. Miyazaki, Yasuda, Yokoi & Toriwaki, "An Origami Playing Simulator in the Virtual Space" (JVCA 1996)

PDF read in full: https://www.cs.upc.edu/~robert/teaching/origami/literatura/miyazaki.pdf. All points below are VERIFIED from it.

**Data model.**
- A face-cell binary tree records face splits.
- Coplanar faces form a "face group", and each group keeps an ordered "face stack".
- Separate edge-cell trees and vertex lists, with texture coordinates kept per vertex.

**Operations.**
- *Bending* (any angle), *folding up* (180°), *tucking in* (limited to a symmetric case), and *curving* (an elastic-energy ribbon model).

**Choosing the moving faces (pp. 33–34).**
- The face that was picked.
- Faces connected to the moving part of any moved face.
- For bending and folding up, faces that overlap the moving part on the rotating side.
- For tucking in, the two outside faces, then every face between them.

**Updating the order (p. 35, Fig. 8).** Folding up reverses the moving faces and piles them on top. Tucking in reorders them into the middle of the stack.

**UI.**
- Drag a corner vertex. The fold line is where the face meets the plane equidistant from the vertex's old and new positions; the rotation angle is twice the angle between those two planes.
- Snapping: vertex to vertex, edge to edge, fold line through vertices, and special angles.

**Limits.** No collision detection. No "inserting the tip of a face into the slit" between other faces.

**Borrow:** the moved-face search (connectivity plus overlap on the rotating side) and the snapping set.

Uchida & Itoh and Komori et al. are known only through Miyazaki's related-work section; I did not find primary sources.

### 5. Shimanuki, Kato & Watanabe (MVA 2002), Kato et al. drill-book recognition

PDF: https://www.mva-org.jp/Proceedings/CommemorativeDVD/2002/papers/2002068.pdf. VERIFIED.

**Unfolded plan: generating creases through layers.**
- When a generated crease reaches an existing crease, the next crease is generated as its mirror image across that crease, with the opposite M/V.
- This continues until it reaches the paper edge.

**Origami-section method.**
- Take a 1-D cross-section perpendicular to the new crease, giving segment lengths dᵢ and crease signs aᵢ.
- Walk along it to decide whether the moving face can "interfold" into a trench or "fold up" over a wall.
- This gives the set of feasible depths at which a flap can be inserted.

**Complex operations.**
- Tucking in and covering are symmetric crease pairs with some letters reversed.
- "Expanding" is completed with local flatness conditions.

**Borrow:** a cross-section test is a cheap way to list the feasible insertion depths to offer as UI choices.

### 6. Akitaya, Mitani, Kanamori & Fukui, ORIZU (2012–13)

Sources: https://www.npal.cs.tsukuba.ac.jp/~akitaya/CSSeminarAkitaya.pdf and https://cgg.cs.tsukuba.ac.jp/projects/2013/generation_diagrams/index.html. VERIFIED.

- **Direction.** It works backwards: it unfolds a crease pattern by graph rewriting, using one rule per maneuver, and builds a step-sequence graph.
- **Maneuvers.** Inside reverse, outside reverse, squash, petal, plus simple folds. The cost grows explosively; the frog base gives 22,665 nodes in 1.78 s.
- **Reflection path.** A simple fold through several layers adds a chain of creases. Each crease in the chain is the mirror of the previous one across an existing crease, with the opposite letter. A complete path ends on the paper boundary or closes into a cycle.
- **Rendering.** Folded forms are drawn with ORIPA. Animation uses vertex-local spherical trigonometry to compute dihedral angles.

**Borrow:** the reflection-path invariant as a unit-test oracle. The crease-pattern change from a through-layers fold must be a set of complete reflection paths (INFERRED application).

### 7. Origami Editor 3D (Attila Bágyoni), Java, GPL-3.0

Repo: https://github.com/bagyoni/origamieditor3d. I read the code in the fork `chz100p/OrigamiEditor3D` (VERIFIED).

**Operations** (`Origami.java` L163–169):
- `FOLD_REFLECTION`, `FOLD_ROTATION`: through all layers.
- `_P` variants: only the connected component of the picked polygon.
- `FOLD_CREASE`.
- `FOLD_MUTILATION`: a cut.

**Model.**
- A 3D fold plane (point and normal), and polygons over 3D vertices.
- `polygonSelect` (~L896) collects polygons that share a vertex not on the plane. That is hinge connectivity only; there is no closure over overlapping layers.
- There is no layer order: no "layer" or "order" structure exists in `Origami.java` (VERIFIED by grep).

**History and export.**
- The history is a compressed command stream (`.ori`).
- `Export.exportPDF` (L307) generates diagrams from that history.

**Avoid:** connectivity-only flap selection. It can move a flap through layers that lie outside it (INFERRED).

### 8. Orimath (mino-ri), F#, no OSS licence file

Repo: https://github.com/mino-ri/Orimath.

**Model (VERIFIED).** `Paper` is a list of `Layer` polygons. Each layer has a matrix and a front or back side (`Orimath.Plugins/Core/Paper.fs`, `Layer.fs`). This is a single global stack.

**UI gesture mapping for the axioms (VERIFIED `Documents/en/manual.md`).** This is the best of any tool surveyed:

| Gesture | Axiom |
|---|---|
| Left-drag point to point | 2 |
| Left-drag line to line | 3 (alternatives shown in gray, nearest one chosen) |
| Point to line, with a point selected first | 5 |
| Point to line, with a line selected first | 7 |
| Shift-select a point and a line, then drag | 6 |
| Right-drag through two points | 1 |
| Right-drag through a point and a line | 4 |

Modifier keys:
- **Shift** folds instead of only creasing.
- **Ctrl** limits the action to the front-most layer.
- **Alt** turns off alignment snapping.

### 9. OriSim3D (Rémi Koutcherawy), JS / Android / iOS

Repo: https://github.com/RemiKoutcherawy/OriSim3D. The LICENSE file is GPL-3.0, while the README badge says MIT (VERIFIED).

- A scripted command language: crease by points, rotate around a segment by an angle, and `o` to offset a face in 3D.
- Templates exist for reverse, squash, petal and rabbit ear. Each is hand-composed from rotations; the layers are separated by depth offsets rather than an order relation (VERIFIED `templates/*.txt`).

**Avoid:** depth offsets as a substitute for layer order.

### 10. Older and less accessible tools

- **Lang, "Origami Simulation"** (Mac, ~1992, Object Pascal). Dragging corners or edges gives mountain/valley folds, turn-over and rotation with animation. It is personal-use only (VERIFIED https://langorigami.com/article/origami-simulation/).
- **eGami** (Fastag, Origami⁴ 2009). Simulates sequential folding of flat models in real time. Practically unavailable (VERIFIED from a forum thread and the chapter metadata; I did not get the text).
- **Fisher 1994, "Origami On Computer".** A textual folding language whose executor tracks face layering, with Huzita fold types. Known only as cited in Beloch's ADR 0009 (VERIFIED citation only).
- **Kishi & Fujii 1998.** Bibliographic details only.
- **Doodle** (Gout et al., ~2001). A diagram language. Its compiler "does not control feasibility, nor the folding coherence" (VERIFIED https://doodle.sourceforge.net/about.html).

### 11. Non-sequential tools, for contrast

- **Origami Simulator** (Ghassaei, MIT). Folds all creases at once with a GPU physics solver. It has no notion of steps.
- **ORIPA** (GPL-3.0), **Oriedita** (MIT, vendored here) and **Flat-Folder** (MIT, ported here). All three compute folded state and layer order from a complete crease pattern.
- Oriedita's mouse modes include no fold-the-folded-form operation. The nearest are `MOVE_CALCULATED_SHAPE_102` and `ADD_FOLDING_CONSTRAINT` (`third_party/oriedita/oriedita-common/src/main/java/oriedita/editor/canvas/MouseMode.java:87-89`, VERIFIED).
- **Consumer apps** ("e Folding", "Paper Fold" puzzle, OriSim3D iOS) are guided or scripted, not general engines (VERIFIED App Store listings, shallow look).
- **paperfold-lab** (MIT, TypeScript). One integer `layerOrder` per face and a `'single' | 'stack'` target mode (`src/model/origami.ts`, VERIFIED).

### 12. Theory touchpoint

Akitaya, Demaine & Ku, "Simple Folding is Really Hard" (https://scripts.mit.edu/~jasonku/pdf/SIMPLEFOLDS_JCDCGGG2016.pdf, VERIFIED):
- A simple fold is a rigid 180° rotation of a subset of the paper about an axis.
- Three models: one-layer, some-layers, all-layers.
- The hardness results are about finding a fold sequence for a whole crease pattern. Checking one user-chosen fold comes down to checking the end state, which takes polynomial time (INFERRED, consistent with Beloch's `rem-simple-fold`).

---

## Comparison table

| System | Folded-state model | Layer order | Which layers move | Compound folds | Exactness | Export | License |
|---|---|---|---|---|---|---|---|
| Rabbit Ear `foldGraph` | Crease pattern + derived spanning-tree folding | `faceOrders` per pair, possibly incomplete | All layers along a line, ray or segment | None | f64 + epsilon | FOLD, `file_frames` | GPL-3.0 |
| Rabbit Ear `flatFold` (legacy) | Crease pattern + `faces_matrix2` | Global `faces_layer` | All; folded side always goes on top | None | f64 | FOLD | GPL-3.0 |
| Beloch | Faces + isometry + λ per pair (kernel stores a total rank) | λ in the model; total rank in the kernel | Depth flap + hinge closure + outward closure; placement top, bottom, over/under | Reverse (2 blocks), fan (squash, petal, swivel), unfold, flip | Exact `qqbar` | FOLD, one frame per statement, crease provenance | MIT |
| Eos / Orikoto | Faces, adjacency, superposition graph | Superposition DAG | Face list / `Handles` / ray side; `InsertFace` | Cut, simple folds, glue (squash, reverse, rabbit ear, crimp) | Numeric folds, Gröbner proofs | Mathematica graphics | None (closed) |
| Miyazaki 1996 | Face-cell tree, coplanar face groups | Stack per group | Picked face + connected faces + faces overlapping on the rotating side | Tuck-in (symmetric only) | f64 | — | Research only |
| Shimanuki 2002 | Unfolded plan | Implicit (section test) | Section test lists feasible depths | Tuck-in, cover, expand | f64 | — | Research only |
| ORIZU (Akitaya) | Crease-pattern graph (backwards) | Via ORIPA | n/a (generates sequences) | Reverse, squash, petal | f64 | Diagrams, animation | Research only |
| OE3D | 3D polygons | None | All, or connected component | None (rotation fold) | f64 (quantised planes) | PDF, CTM, GIF, `.ori` | GPL-3.0 |
| Orimath | Global list of layers | Global stack | All, or front-most | None | f64 | `.orimath` | No licence file |
| OriSim3D | 3D faces | Depth offsets | Scripted | Hand scripts | f64 | Text, SVG | GPL-3.0 (README says MIT) |

---

## Lessons for our engine

1. **State: store per-pair order, render with a linear extension when one exists.** Represent each face as a convex polygon in paper coordinates with an isometry, plus antisymmetric λ over overlapping pairs. This is Beloch's §2 model and matches the FOLD `faceOrders` semantics. Build a linear extension only for rendering, and only when one exists. INFERRED: simple folds alone may never produce cycles, but fans/collapses (twists) can, so the per-pair model is the safe choice from day one. Be explicit about sign conventions:
   - FOLD's sign is relative to g's normal.
   - Beloch's sign is relative to the table's "up".
   - Akitaya's sign is the opposite of Demaine's.
   - All three are VERIFIED.

2. **One primitive: reflect blocks of faces with a placement, then validate the end state.**
   - V0 valley/mountain through any layers = one block, placement *top* or *bottom*.
   - Tucks = *over/under T*.
   - Reverse folds = two blocks in one reflection.
   - Squash, petal, rabbit ear, swivel = Beloch-style fan.
   - Open and closed sinks need new design, because no prior art covers them.

   Validate every candidate with the non-crossing conditions. Return a typed "not foldable" error with the reason, in line with the repo rule against approximate fallbacks.

3. **Moving set.** Follow Beloch's `def-fold`: start from the depth layer, then close over hinges not on the fold line and outward. Miyazaki's overlap-on-rotating-side rule is the same idea. OE3D's connectivity-only rule is the failure case. Default to all layers on the side being moved ("a finger through the stack", Beloch ADR 0036). Offer a depth pick (the layer under the cursor) and a placement choice. Shimanuki's section test can list the valid insertion depths.

4. **Crease-pattern change and M/V.**
   - The new crease is made of the hinges on the fold line between moving and stationary faces.
   - Letters come from the state: face-up vs. above.
   - Tests should check that through-layer creases form complete reflection paths (Akitaya), and that Maekawa and Kawasaki hold at each new interior vertex.
   - `unfold` sets those hinges back to flat but keeps them as precrease marks (Beloch `lem-toggle`).

5. **Precision.** Rabbit Ear's trick of splitting in folded space and transferring back by edge parameter limits drift. Beloch shows exact algebraic arithmetic is affordable for sequences of 10–30 steps. Decision needed: f64 with robust predicates and snapping to named constructions, or exact rationals plus quadratic/cubic algebraic numbers for axioms 5–7 (INFERRED trade-off).

6. **Use our existing Flat-Folder port as an independent oracle.** After each step, export the crease pattern and call `solve_flat_fold` (`crates/treemaker-flatfold/src/lib.rs:166`). Check that our λ is one of its solutions. `infer_edge_assignments_from_face_orders` (L190) can cross-check the letters.

7. **Store the operation log as the source of truth.** Each step records:
   - the axiom construction and its inputs;
   - the side, depth and placement;
   - the chosen candidate.

   Computed states are cached FOLD frames (`file_frames` + `frame_parent` / `frame_inherit`, VERIFIED FOLD spec), and every crease is tagged with the step that created it (as Beloch does). This feeds the Diagram workspace directly: arrows (Rabbit Ear has axiom-arrow helpers), and per-step "before" and "after" states.

8. **UI.**
   - Orimath's gesture-to-axiom mapping and modifier keys.
   - Miyazaki's snapping set.
   - Eos's `Handles` (a point on the side that moves) and `InsertFace`.
   - When there are several axiom solutions or several reverse-fold openings, show them as gray candidates (Orimath) instead of guessing (Beloch makes the write undefined).

9. **Licensing (INFERRED, needs owner confirmation).**
   - Our workspace is GPL-2.0-or-later (`Cargo.toml:27`). Porting GPL-3.0 code (Rabbit Ear, ORIPA, OE3D, OriSim3D) would make the combined work GPLv3.
   - Beloch, Flat-Folder and Oriedita are MIT. Eos is closed: ideas only.

## Open questions / risks

- **Cyclic layer orders.** Can the operations we plan (fans, collapses) reach states with no linear extension? Beloch's kernel already has this ceiling. Our renderer and Diagram export must cope with a per-pair order.
- **Default fold scope.** Beloch reversed its default twice in three months. Our UI needs an explicit, visible depth control, and a decision for when the picked point sits on a crease shared by several layers.
- **Ambiguity is normal.** Axioms 3, 5, 6 and 7 have multiple solutions. Reverse folds can have several openings. Fans can have several valid stackings. Each needs a choice presented to the user, and the choice must be recorded in the step.
- **Sinks.** Open and closed sinks invert a nested stack inside a region, and an open sink's motion is not flat. No surveyed software validates them. This needs design work beyond the prior art.
- **End state checked, motion not.** Beloch's model cites Demaine's theorem that a valid flat end state is reachable by some motion. Animating that motion, especially for reverse folds and squashes, which are not rigid, needs separate heuristics. Akitaya used spherical trigonometry; Miyazaki used rigid rotation.
- **Beloch's maturity.** `MODEL.md` §5 is a draft, a key lemma has a pending proof, and the project is two weeks old. Treat it as a strong blueprint, not a verified oracle.
- **Rabbit Ear's `faceOrders`.** Its layer relations can be incomplete after a fold. Do not use it as a reference without a solver to complete it.
- **Numeric robustness vs. exactness.** Long sequences that build on axiom 5–7 constructions accumulate error in f64. Exact arithmetic costs performance and adds complexity to the wasm build. This needs an early decision.
- **Sources not read.** Ida & Takahashi JSC 2010 (HTTP 403), Kishi & Fujii 1998, Uchida & Itoh, the eGami chapter, and Fisher 1994 were seen only through citations or snippets.
