# Layer-order steering in other origami software

Research slice for the layer-order-constraints feature, 2026-10-19. The question:
how existing tools let a user **see**, **choose** and **constrain** the layer
order of a folded figure. This is evidence only; it proposes no UI.

## Evidence levels

Every claim carries one of these.

- **V**: Verified. I read the code or doc in the vendored tree. `path:line` is
  relative to the worktree root.
- **V-r**: Verified remotely. I read upstream source through a web fetch on
  2026-10-19. Line numbers are approximate or omitted.
- **D**: Documented. Release notes, README, help page or issue thread, not
  checked in source. "D (snippet)" means I saw only a search-result summary,
  not the page.
- **I**: Inferred.

Nothing was built or run. Every behaviour claim comes from reading code or docs.
Third-party prose is paraphrased; names in backticks are UI labels or
identifiers.

---

## Summary

| Tool | Multiple orders? | How "several exist" is shown | Ways to steer | Click semantics | Saved form | Evidence |
|---|---|---|---|---|---|---|
| **Oriedita** | Yes. Complete stackings are enumerated lazily, one at a time. | Canvas text with the number of solutions found so far, plus a no-more-solutions note once exhausted. No total. | Next solution (forward only). Go to N (forward only). Export the next 100 as images. **Add Color Constraints**: at a clicked point, which paper side must show; needs a re-fold. Starting face. Flip view. Drag folded vertices, then re-solve. | Folded figure: the constraint tool adds, inverts or removes a dot at a point. Modify Fold marks the CP vertices under a folded vertex. CP: click a face to make it the starting face. | Nothing. Constraints and the solution index live in memory. FOLD export is the CP only. | V |
| **ORIPA** | Yes. Eager enumeration ("all folded states" mode), or first state, or X-ray. | `i/n` label beside Prev and Next. | Prev/Next. Fold mode. **Filter**: pick a subface **by number**, then one of its distinct local stack orders **by number**. Filters combine by AND. Order-flip and exploded ("distortion") views. | None on the folded model: drag pans or rotates, the wheel zooms. A checkbox outlines the subface picked in the combo. | FOLD of the selected state, or all states as multi-frame, with `faceOrders` per frame (D). SVG or picture of the current state. | V-r, D |
| **Flat-Folder** | Yes. All states, held implicitly as independent components (each capped by `Limit`). | Total states found (an exact product). Per component, a count of its states. | `Limit` per component. Component dropdown (`none`/`all`/`i`). **State number 1…n per component.** Flip and rotate. Paper side at import. | CP face: highlights its cells and every face that overlaps it. A second face shows that pair's constraints. Overlap-graph cell: highlights the cell's preimage on each face and logs its face list (the stack, after a solve). Folded render: no clicks. `Visible` checkbox paints visible regions on the CP. | `state` FOLD: folded coordinates plus `faceOrders` of the current pick. `cp` FOLD, SVG, log. The picks themselves are not saved. | V |
| **Rabbit Ear** (library) | Yes. A recursive tree of forced orders, AND-groups and OR-alternatives, in 2D and 3D. | `count()` returns the nested choice structure. No single total. | API only. `faceOrders(...pattern)` takes one index per choice point. A `faceOrders` array on the input graph is treated as hard seed orders. | No UI found. | `faceOrders` | V-r |
| **TreeMaker 5** | No. One "rooted" (dangle) arrangement. | Help notes the arrangement is not unique. | Choose the root node, which reorders the whole base. | The folded-form window is display only. Selecting in the CP or the tree highlights there. | Tree file (I) | V |
| Origami Simulator | No layer order at all | — | — | — | — | V |
| Box Pleating Studio | No stacking order | — | — | Repeated clicks cycle selection through overlapping objects (UI analogue). | — | V |
| Origami Editor 3D | One state per step, set by the fold sequence | — | Selection Mode: click a CP point to confine the next fold to that region or layer. | CP point mirrored in the 3D view | Step file (I) | D |

### Findings that matter most

1. **No shipped tool lets a user say "this face goes on top here" by clicking
   faces.** Oriedita's maintainers specified exactly that in 2021: pick a point,
   see the faces stacked there, click them in the order wanted. They shipped
   only the colour-at-point subset (PR #205). The issue (#187) is still open.
   (D)
2. Three shipped steering primitives exist, at three granularities.
   - **Global** next/prev: Oriedita, ORIPA.
   - **Per independent component**: Flat-Folder, and the Rabbit Ear API.
   - **Per region**: ORIPA's local-order filter and Oriedita's colour
     constraint.

   Only Oriedita's is driven by clicking the model. ORIPA's is the most
   expressive but entirely numeric. (V, V-r)
3. Index-based navigation does not scale. In the Flat-Folder paper, Kamiya's
   Ryujin 2.1 has 248 independent components. One of them has 633,184 states.
   The total exceeds 9·10^84. (D, paper §5.4)
4. Pairwise "A above B" is already the solvers' native input: the same
   mechanism as M/V assignment. Flat-Folder's initial assignment (paper §5.2),
   Rabbit Ear's seed `faceOrders`, and Oriedita's M/V-seeded hierarchy table
   all accept it. **No tool exposes it in UI.** (V, V-r, I)
5. Nothing persists the user's intent. Oriedita forgets constraints and the
   chosen index. Flat-Folder and ORIPA export the resolved `faceOrders`, but not
   the choices that produced them. No tool explains an infeasible user
   constraint. Oriedita's code has a TODO for exactly that. (V)

---

## 1. Oriedita

Vendored at `third_party/oriedita` (commit `c02a544`).

**How the pipeline works (V).** Folding runs in stages
(`origami/src/main/java/origami/folding/FoldedFigure.java:83-116`):

1. Starting face.
2. Folded wireframe.
3. Subdivision into **SubFaces**, the cells of the folded arrangement.
4. A pairwise above/below **hierarchy table**, seeded from M/V creases
   (`origami/.../worker/FoldedFigure_Configurator.java:359-379`). The
   **Additional Estimation Algorithm (AEA)** then deduces more pairs; it runs
   twice (`FoldedFigure_Configurator.java:293-323`).
5. A search over per-SubFace permutations for a consistent stacking
   (`FoldedFigure.java:235-264`).

AEA is internal deduction. This snapshot has no user control called
"additional estimation" (V, from the action list in `FoldingTab.form`).

**(a) Multiple orders: yes (V).**

- Each successful search yields one complete stacking. The worker then advances
  the search to prepare the next (`FoldedFigure.java:242-250`).
- The CP fixes the folded geometry; solutions differ only in stacking.
- The advance step moves the lowest-priority SubFaces first (comment at
  `FoldedFigure.java:248`). Consecutive solutions therefore probably differ in
  small, late-searched regions (I).

**(b) How several are shown (V).**

- Canvas text gives the number of solutions found so far, and says when no
  further solution exists (`FoldedFigure.java:255-259`, drawn at
  `oriedita-ui/.../CanvasUI.java:303`).
- The count is lazy: no total and no estimate.
- If the first search finds nothing, the display falls back to the X-ray view
  (`FoldedFigure.java:104-111`).

**(c) Ways to steer.**

Buttons in the Folding tab are `Fold`, `Stop`, `Trash`, `AS100`, a number field
with `Go`, and `a_s` (`oriedita-ui/.../swing/tab/FoldingTab.java:515-575`) (V).

- **Find Next Available Solution** (`a_s`) re-enters the search at its last
  stage (`AnotherSolutionAction.java:26-31`, `FoldingServiceImpl.java:176-178`).
  There is no "previous". (V)
- **Go to Specific Solution.** A number field is bound to `foldedCases`, with a
  `Go` button (`FoldingTab.java:127-135`). The task behind it only advances
  forward until the N-th solution is found (`FoldingEstimateSpecificTask.java:38-48`),
  so a smaller N does nothing. I found no caller of
  `executeFoldingEstimateSpecificTask` in this snapshot, so the button may be
  unwired here. (V for the code; wiring not found)
- **Export Next 100 Solutions** (`AS100`, `name.properties:95`) enumerates up to
  100 more solutions and writes one image per solution, suffixed `_<n>`
  (`As100Action.java:26-33`, `FoldingEstimateSave100Task.java:45-64`). This is
  batch export for comparing offline. The button's command id (`as100Action`)
  differs in case from the registered action (`As100Action`,
  `ActionType.java:121`), so its wiring is also unverified. (V code; I wiring)
- **Add Color Constraints**, detailed below. (V)
- **Set Starting Face**: click a CP face. It becomes the fixed reference face;
  the figure is marked stale, and the next fold uses the new face
  (`MouseHandlerChangeStandardFace.java:42-67`, `FoldedFigure_Drawer.java:59-61`,
  `ActionRegistrationService.java:338-345`, help text at
  `help.properties:368-372`). (V) It changes the frame of reference, not the
  set of stackings. (I)
- **Flip Fold** cycles the view: front, back, both, transparent
  (`FoldedFigure.java:312-322`, `FlipAction.java`). View only. (V)
- **Modify Fold**: drag a vertex of the folded wireframe. The geometry changes,
  for example a flap swings, and the layer order is re-estimated
  (`MouseHandlerModifyCalculatedShape.java:97-125`). This is a geometry edit,
  not a layer constraint. (V)
- **Duplicate Fold** re-solves the copy from scratch. The copy shows the first
  solution and carries no constraints (`FoldingServiceImpl.java:186-202`). (V)

**Add Color Constraints in detail.** All V unless marked.

- **Entry point.** A one-letter `C` button in the Folding tab
  (`FoldingTab.java:480-489`, named `Add Color Constraints` at
  `name.properties:101`). It enters mouse mode `ADD_FOLDING_CONSTRAINT`
  (`ActionRegistrationService.java:107`, `oriedita-common/.../MouseMode.java:89`).
- **Help text** (`help.properties:749-760`):
  - Click a point on the folded shape to fix the colour that shows there.
  - A white dot means the white side; a black dot means the coloured side.
  - Fold again to apply.
  - Left-click a dot to toggle it, Ctrl+click to add one near others,
    right-click to remove.
- **What a click records** (`oriedita/.../handler/MouseHandlerAddFoldingConstraints.java:45-117`):
  - Every face under the point in the folded figure, split by which paper side
    faces up (face-position parity).
  - The constraint's allowed-top set is the faces showing the requested side.
  - It is tagged NORMAL when clicked in the front view and FLIPPED in the back
    view. In the "both" view the back image is tested first (lines 65-71).
- **Meaning.** The topmost face of that cell must be one of the allowed faces;
  for FLIPPED, the bottommost (`origami/.../constraint/CustomConstraint.java:9-14`).
  In practice: "at this point, this colour shows".
  - It is **not** "face A above face B".
  - It is **not** "this particular face on top": any face showing the requested
    side satisfies it.
  - The enum has an unused `CUSTOM` type (`CustomConstraint.java:68-71`). The UI
    never creates it.
- **How the solver enforces it.**
  - Each constraint attaches to the SubFace whose face set equals the clicked
    set (`FoldedFigure_Configurator.java:147-166,191-211`).
  - Two constraints on the same SubFace and side merge: their allowed-top sets
    are intersected (`FoldedFigure_Configurator.java:213-220`).
  - Constrained SubFaces are never pruned from the reduced set
    (`FoldedFigure_Configurator.java:245-248`), and they get a priority boost
    in search order (`SubFacePriority.java:28-32`).
  - The permutation generator admits only allowed faces in the first or last
    position (`ChainPermutationGenerator.java:175-191`, `SubFace.java:281-319,448-456`).
  - Constraints are never fed to AEA deduction:
    `AdditionalEstimationAlgorithm.java` has no reference to them. They prune
    the search; they do not propagate.
- **Drawing.** 8 px dots at the click point, shown only on their own side of
  the figure (`oriedita-ui/.../FoldedFigure_Worker_Drawer.java:384-417`).
- **Feedback when impossible.** The configure step returns status
  `CONSTRAINT_5`, next to a TODO to add an indication for impossible
  constraints (`FoldedFigure_Configurator.java:344-349`).
  - Contradictions found by deduction *are* drawn, as red SubFaces and faces
    (`FoldedFigure_Worker_Drawer.java:129-143`).
  - Unsatisfiable user constraints are not.
- **Lifetime.**
  - Stored in memory on the figure's `HierarchyList`
    (`HierarchyList.java:31,109-136`).
  - They survive a re-fold of the same, unchanged CP: `reset()` does not clear
    them (`FoldedFigure_Worker.java:50-55`, `FoldingServiceImpl.java:84-89`).
  - They are dropped when the CP changes, because the figure is replaced
    (`FoldingServiceImpl.java:91-93,111-112`).
  - They are not on the folded-figure undo stack. The handler never calls
    `record()`; Modify Fold does (`MouseHandlerModifyCalculatedShape.java:110`).

**History (D).**

- PR #205, "Implement Color constraints", was merged 2021-12-06. Its
  description calls it a partial implementation of #187: only the top face's
  colour can be chosen, not the face itself. It also noted that `a_s` did not
  apply constraints, only Fold did.
  <https://github.com/oriedita/oriedita/pull/205>
- Issue #187, "Select which faces are on top before folding", is open. A
  maintainer (qurben) wrote the fuller design there:
  1. Pick a point on the folded model.
  2. Every face overlapping there is highlighted.
  3. Click them in the order wanted; the first is topmost.
  4. Each constraint appears as a small circle that can be edited or removed.
  5. The next fold uses them.

  After #205 merged, the stated next step was forcing a specific subface to be
  on top. <https://github.com/oriedita/oriedita/issues/187>
- Issue #134, "Show visible faces in creasepattern", is open. It asks to
  highlight on the CP which (sub)faces are visible when folded.
  <https://github.com/oriedita/oriedita/issues/134>

**(d) Click semantics (V).**

- On the folded figure:
  - The colour-constraint tool, described above.
  - Modify Fold picks the nearest folded vertex and marks every CP vertex that
    lands on the same point (`MouseHandlerModifyCalculatedShape.java:178-250`).
    This is Oriedita's only CP↔folded correspondence highlight, and it is
    vertex-level.
- On the CP: Set Starting Face.
- There is no face-level highlight and no readout of the stack at a point.

**(e) What is saved (V).** Nothing related to layer order.

- FOLD export writes the CP only: vertices, edges, assignments and faces
  (`oriedita-data/.../export/FoldExporter.java:54-110`).
- The save and export code has no `faceOrders`, constraints or solution index
  (checked with grep).

**(f) Known limits.**

- Forward-only navigation and a lazy count (V).
- Constraints are colour-only and give no infeasibility signal (V).
- Constraints are lost on any CP edit (V).
- Issue #187 has been open since 2021-11 (D).
- Orihime's original Japanese documentation did not turn up in searches. The
  `help_jp.properties` strings in the vendored tree are mojibake. (Not assessed)

---

## 2. ORIPA

Upstream <https://github.com/oripa/oripa>. Master was read on 2026-10-19; the
latest release is v1.80.

**(a) Multiple orders: yes.**

- Since v1.72 there are three fold modes (D, releases page):
  - all folded states;
  - first folded state, which yields one or a few;
  - X-ray only.
- Since v1.65, unassigned creases fold too, enumerating all valid states (D).
- Release notes: <https://github.com/oripa/oripa/releases>,
  <https://github.com/oripa/oripa/releases?page=2>

**(b) How several are shown (V-r).**

- `ListItemSelectionPanel` has Prev and Next buttons and an `i/n` label.
- There is no jump field.
- The buttons stay enabled at the ends and simply do nothing.
- Source: `oripa/swing/view/util/ListItemSelectionPanel.java`.

**(c) Ways to steer.**

- **Prev/Next** and the **fold mode**.
- **Filter.** v1.66 added filtering of folded states by the local layer order
  at face intersections (D). How it works (V-r):
  - A `Use filter` checkbox runs `SubfaceToOverlapRelationIndicesFactory`
    (`oripa/gui/presenter/estimation/logic/`).
  - For every subface, it groups all *computed* states by the subface's local
    stacking: the parent faces sorted by the above relation.
  - Entry 0 holds every state and is labelled "none".
  - The subface combo lists only subfaces with at least two distinct local
    orders. It shows **subface numbers**.
  - The second combo lists **local-order numbers**: `none`, `1`, `2` and so on.
  - A `Show subface` checkbox outlines the chosen subface on the folded model
    (`oripa/swing/view/estimation/EstimationResultUI.java` ≈233-253 and
    ≈369-394; `FoldedModelScreen.java`).
  - Choices on different subfaces combine by AND (`filter()`, ≈281-295).
  - The answer list is replaced by the filtered list, and the view jumps to its
    first entry.
  - Unchecking restores everything. Loading a new model resets the filter.
- **Limits of the filter.**
  - Subfaces and local orders are picked by number. The user cannot click the
    model, and cannot preview what "order 2" looks like (V-r).
  - Group numbering follows `ConcurrentHashMap` iteration. The same number may
    therefore mean a different order on another run (V-r for the code; I for
    the consequence).
  - It filters only states already enumerated, so it is useful only in the
    all-states mode (I).
- **Views.** An order-flip checkbox (`ORDER_FLIP_ID`). Distortion modes
  `NONE`, `DEPTH` and `MORISUE`, with x/y sliders, offset layers to reveal
  hidden ones (V-r for the controls). The v1.69 notes cite a depth-ordering
  method and Kei Morisue's affine method (D).

**(d) Click semantics (V-r).**

- None on the folded model. `FoldedModelScreen` handles drag (pan or rotate)
  and the wheel (zoom); `mouseClicked` is empty.
- The only highlight is the subface outline driven by the combo.
- Since v1.72, fold errors appear in the foldability window, with the faces
  involved coloured pink (D).

**(e) What is saved.**

- v1.64 added saving all folded states as one multi-frame FOLD file. Each frame
  inherits the key frame and stores its own `faceOrders` (D).
- v1.65 added saving the selected state, or all states, as single- or
  multi-frame FOLD (D).
- The CLI `--fold` writes multi-frame FOLD; `--image … -n <i>` renders state
  `i` (D, README).
- The result window's export code I read offers SVG, flipped SVG and a picture
  of the current index
  (`oripa/gui/presenter/estimation/logic/EstimationResultFilePresentationLogic.java`)
  (V-r).
- Filter choices are not saved (I).

**(f) Complaints.** An issue search for "filter" found nothing about the answer
filter, only performance PRs. <https://github.com/oripa/oripa/issues?q=filter>
(D)

---

## 3. Flat-Folder

Vendored at `third_party/flat-folder` (commit `d500048`).

**Model (V, and the paper).**

- Variables are pairs of overlapping faces.
- Four constraint kinds tie them together: taco-taco, taco-tortilla,
  tortilla-tortilla and transitivity.
- M/V creases fix some variables, and propagation fixes more.
- The remaining variables split into independent components, each
  brute-forced.
- Sources: `README.md:185-260`, `src/compute.js:110-160`, `src/solver.js:241-264`.

The paper is Akitaya, Demaine and Ku, *Computing Flat-Folded States* (OSME
2024), <https://erikdemaine.org/papers/FlatFolder_OSME2024/paper.pdf>.

- §5.2: a crease assignment prescribes the variable for the faces on either
  side. Partial knowledge of some variables lets breadth-first propagation infer
  others.
- §5.3: per-component assignments implicitly represent every state, as a
  Cartesian product.

**(a) Multiple orders: yes, all states (V).**

- This holds for assigned and unassigned CPs.
- `Limit` caps the states per component. Its options are `all`, 10000, 1000,
  100, 10 and 1 (`src/main.js:47-53`; per-group cap at `src/solver.js:250`).

**(b) How several are shown (V).**

- The total found is the product of per-component counts, computed as a BigInt
  (`main.js:225-229`). Below `all` it is a product of capped counts (I).
- The first view shows state 1 of every component (`main.js:230`).
- Each component is labelled with its own state count (`gui.js:254-256`).
- On failure the result reads zero states; the conflicting faces turn red and
  the participating ones fade (`main.js:194-224`, `gui.js:538-569`).
- The on-page console names the constraint type and the faces it could not
  resolve (`compute.js:119-125`).

**(c) Ways to steer (V).**

- **Component dropdown**: `none`, `all`, `0…k-1` (`main.js:275-292`).
- Picking a component does two things:
  - It draws that component's pair variables as coloured segments between face
    centroids on the overlap-graph panel (`gui.js:277-292`).
  - It shows a number input from 1 to n (`gui.js:254-266`). Changing it
    recomputes `faceOrders` and redraws (`gui.js:260-275`, `compute.js:161-169`).
- Component 0 holds the variables fixed by the creases, so it always has one
  state (`solver.js`, `solve`).
- Also available: flip and rotate per panel, and a `+/-` side toggle at import
  (`main.js:89-92`).
- Nothing else: no next/prev across components, no constraint input, no filter.

**(d) Click semantics** (V; `README.md:91-116`, `gui.js:294-510`).

- **CP face, first click.**
  - The face turns yellow; every face overlapping it turns blue. Each blue face
    is one pair variable.
  - Its cells are highlighted in the overlap graph.
  - Its edges and their overlap-graph segments are drawn in matching colours.
- **Second click, on a blue face.** The pair's constraints are coloured by kind
  and logged.
  - It does **not** show or set which of the two faces is above.
- **Overlap-graph cell.**
  - The cell's preimage is painted on every face in the CP.
  - The cell's face list is logged. After a solve that list is the stack:
    `main.js:232` stores the sorted lists, and `gui.js:215` reads the last
    entry as the top.
  - This is a text-only readout of the stack at a point (V for the code path;
    the bottom-to-top direction is I).
- **Folded render.** No click handlers at all. Only `flat_click` and
  `cell_click` are bound (`gui.js:495-509`).
- **`Visible` checkbox.** It paints on the CP the parts of each face that are
  visible from the top and the bottom in the current state (`gui.js:124-155`).
  - This came from issue #40 (closed) and is what Oriedita #134 asks for.
    <https://github.com/origamimagiro/flat-folder/issues?q=is%3Aissue>

**(e) What is saved (V, `io.js:7-28`).**

- The `state` FOLD holds the CP topology, folded `vertices_coords`, and the
  current selection's `faceOrders`. A TODO in the code asks whether implied
  orders should be dropped.
- Also exported: `cp` FOLD, an SVG image, and the log.
- Component and state indices are not saved. A re-import cannot restore the
  user's picks (I).

**(f) Limits.**

- Scale (paper §5.4). Kamiya's Ryujin 2.1 (5,773 faces) has 248 components:
  - 238 with 2 states;
  - 3 with 3, 4 with 4, and 1 with 5;
  - 1 with 950 and 1 with 633,184.

  Together that is over 9·10^84 states (D).
- States are bare numbers. Nothing describes what changes between state 3 and
  state 4 (V: `gui.js:254-266`).
- Issue #41, asking for a faster brute-force search, is open (D).
- Index labels help only on small inputs (`README.md:62-65`) (D).

---

## 4. Rabbit Ear

Library at <https://github.com/rabbit-ear/rabbit-ear>, `main`, read 2026-10-19.

**(a) Multiple orders (V-r).**

- `ear.layer(graph, epsilon)` and `ear.layer3D(graph, epsilon)` return every
  layer ordering (`src/layer/layer.js`).
- The 3D variant covers coplanar overlapping faces in a 3D-folded model. That
  is relevant to a Pose mode (I).

**(b) Representation (V-r: `src/layer/solver.js`, `src/layer/prototype.js`).**

- A node is `{ orders, branches? }`. `branches` is an AND-list of independent
  groups. Each group is an OR-list of alternatives, and each alternative is
  itself a node.
- After every guess the solver re-splits the unsolved variables into
  independent groups, so branches nest to any depth. This is finer than
  Flat-Folder's flat component list.
- `count()` returns the nested `{choices, branches}` structure, not one number.

**(c) Steering: API only (V-r).**

- `faceOrders(...pattern)` / `compile(...pattern)` take one index per choice
  point, in depth-first order. `compileAll()` / `gatherAll()` enumerate
  everything.
- **Seeds.** Any `faceOrders` on the input graph become solver orders and merge
  with the M/V-derived orders before solving. A conflict throws
  `noLayerSolution` (`src/layer/constraintsFlat.js` ≈164-187; `solver.js` runs
  propagation over the seeds first).
- So a partial `faceOrders` list already works as a set of hard pairwise
  constraints.
- Changelog (D, <https://rabbit-ear.github.io/rabbit-ear/changelog.html>):
  - 0.9.32 lists an earlier API (`solution(...indices)`, `allFaceOrders()`).
  - 0.9.33 adds `nudgeVerticesWithFaceOrders` for exploded rendering.

**(d) UI.** None found in the repository. rabbitear.org refused the connection
from here, so its docs and examples were not checked.

**(e) Saved form.** FOLD `faceOrders`.

---

## 5. Other tools

**TreeMaker 5 (V, vendored help).**

- One stacking per design: the "rooted", or dangle, arrangement.
- Any node can be the root (node index 1). A different root gives a different
  folded form and different M/V (`Source/help/overview.htm:262-275`,
  `windows.htm:466-473`).
- View settings can overlay the facet ordering graph and each facet's colour-up
  or colour-down state on the CP (`overview.htm:207-222`).
- The Folded Form window is an X-ray view and display only. Selecting a CP
  vertex, crease or facet, or a tree edge (its flap), highlights it there
  (`windows.htm:1296-1324`).
- Primitive: one global choice (the root) reorders everything, with a one-way
  CP→folded highlight.

**Origami Simulator (V).** It has no collision, self-intersection or
layer-order code (grep of `third_party/origami-simulator/js`; our port note at
`third_party/origami-simulator/README.treemaker.md:80-81`).

**Box Pleating Studio (V).**

- It has no stacking order.
- Its selection model is a useful analogue: with overlapping objects, repeated
  clicks move the selection from one to the next
  (`third_party/box-pleating-studio/src/client/controllers/selectionController.ts:43-53`).

**Origami Editor 3D (D).**

- Models are built from a fold sequence.
- **Selection Mode**: click a CP point (a red cross, mirrored in the 3D view).
  The next fold is then confined to the region containing it, folding one layer
  instead of all.
- <https://origamieditor3d.sourceforge.net/userguide/en/basicediting/selectionmode.html>

**Tachi's Rigid Origami Simulator and Freeform Origami (D, secondary sources).**

- Freeform Origami enforces local non-intersection between facets that share
  vertices.
- A 2015 GMU technical report says the Rigid Origami Simulator does not handle
  global self-intersection or stacking order.
  <https://cs.gmu.edu/media/techreports/GMU-CS-TR-2015-2.pdf> (snippet)
- No layer-order UI found.

**Diagramming tools and research systems.**

- **Doodle** is a text language. Its about page says the compiler checks
  neither feasibility nor folding coherence (D,
  <https://doodle.sourceforge.net/about.html>).
- **Foldinator, eGami, DIAMOND** (kei-morisue): no evidence of layer-order
  features found; not assessed in depth.
- **Research systems**, none of which exposes layer-order constraints (D):
  - Tsuruta et al. 2010: the user picks the next shape from a list of
    candidates generated with Huzita-Hatori axioms.
    <https://www.npal.cs.tsukuba.ac.jp/~tsuruta/projects/diagramming/>
  - ORIZU (Akitaya et al., SIGGRAPH 2013 poster) generates some of the possible
    folding sequences from a CP.
    <https://cgg.cs.tsukuba.ac.jp/projects/2013/generation_diagrams/index.html>
  - Kato et al. 2019 infer the layered 3D shape from the depth order of traced
    polygons. <https://cgg.cs.tsukuba.ac.jp/projects/2019/PlausibleOuterShape>

---

## 6. Analogues outside origami

### CAD sketchers: how they show constraint state

- **SolidWorks** (D, snippet;
  <https://help.solidworks.com/2019/english/SolidWorks/acadhelp/c_sketch_states_acadhelp.htm>).
  - The status bar shows under-, fully or over-defined.
  - Entities are coloured by state: blue, black or red, per secondary sources.
  - Clicking an over-defined status opens a diagnosis tool (SketchXpert).
- **Onshape** (D, <https://cad.onshape.com/help/Content/troubleshooting.htm>).
  - Blue means under-constrained, black fully constrained, red a conflict.
  - Constraint icons turn white-on-red when they are the problem.
  - The help suggests dragging entities to discover what is still free.
- **FreeCAD Sketcher** (D, snippet; <https://wiki.freecad.org/Sketcher_Dialog>,
  0.18 release notes).
  - Messages include under-constrained with *n* degrees of freedom, fully
    constrained, over-constrained, and redundant or conflicting.
  - The DoF count and the constraint indices are clickable links. They select
    the free elements, or the offending constraints.

What maps onto our problem (I):

| CAD | Layer order |
|---|---|
| DoF count | number of states remaining |
| Fully constrained | exactly one state |
| Over-constrained | zero states |
| Clickable conflict list | the conflicting user constraints, selectable |
| Clickable DoF link | the still-ambiguous regions (the components), highlighted |
| Dragging to see what's free | cycling the alternatives within one region |

### Vector tools: how they expose z-order at a point

- **Figma**: right-click, then the `Select layer` submenu lists every layer
  under the cursor in Layers-panel order (D, snippet;
  <https://help.figma.com/hc/en-us/articles/360040449873>).
- **Inkscape**: Alt+click selects the object below the current one, and
  repeated Alt+click walks down the z-order (D, snippet;
  <https://inkscape.org/forums/questions/select-path-under-or-behind>).
- **Box Pleating Studio**: repeated clicks cycle through overlapping objects
  (V, above).
- **Illustrator**: Select Behind and Next Object Below exist as I remember
  them, but Adobe's help returned 403, so this is unverified (I).

What maps (I): a menu of the stack at a point; click-through cycling; "bring to
top" as the single verb. What does not map: in origami most reorders at a point
are infeasible, and one change forces changes elsewhere. A z-order verb has to
become a constraint plus a re-solve, not a direct edit.

---

## Cross-cutting: the interaction primitives found

| # | Primitive | What it pins down | Used by | Notes |
|---|---|---|---|---|
| P1 | Global step (next/prev) | the whole state | Oriedita (next only, lazy count); ORIPA (prev/next, `i/n`) | Hopeless at scale (Ryujin: 10^84). |
| P2 | Jump to an index | the whole state | Oriedita `Go` (forward only); ORIPA CLI `-n` | Indices carry no meaning. |
| P3 | Batch enumerate and export | the whole state | Oriedita `AS100` images; ORIPA multi-frame FOLD | Comparison happens offline. |
| P4 | Choose per independent component | one component | Flat-Folder (number 1..n); Rabbit Ear (`pattern`, nested) | Needs a component→region map. Flat-Folder draws the component on the overlap graph, not on the folded render. |
| P5 | Filter by local stack order in a region | the stack inside one cell | ORIPA filter | The most expressive shipped primitive. The UI is numeric only. |
| P6 | Side or colour at a point | the top (or bottom) face's paper side in one cell | Oriedita colour constraints | Shipped, driven by clicks, and coarse. |
| P7 | Faces in order at a point | specific top faces at a point | Oriedita #187 design (unbuilt) | Specified by maintainers in 2021, never built. |
| P8 | Pairwise "A above B" | one pair variable | Rabbit Ear (seed `faceOrders`); Flat-Folder/paper (initial assignment); FOLD `faceOrders` as the data form | Native to every solver. **No UI anywhere.** |
| P9 | Global reference choice | the frame, or everything | Oriedita starting face; Flat-Folder side toggle; TreeMaker root node | TreeMaker's root is the only one that changes the stacking itself. |
| P10 | View flip, X-ray or exploded | view only | all; ORIPA distortion; Rabbit Ear nudge | Used to see hidden layers. |
| P11 | CP↔folded correspondence | — | Flat-Folder (face↔cells, cell→face preimages); TreeMaker (CP→folded); Oriedita (vertex, in Modify Fold); ORIPA (subface outline from a combo) | Only Flat-Folder goes both ways, and not on the rendered fold. |
| P12 | Stack-at-point readout | — | Flat-Folder (console text after a cell click) | No graphical stack view anywhere. |
| P13 | Visible-region map on the CP | — | Flat-Folder `Visible`; TreeMaker colour-up/down overlay; Oriedita #134 (open) | — |
| P14 | Conflict localisation | — | Flat-Folder (red faces plus constraint name); ORIPA (pink faces); Oriedita (red cells for deduction contradictions only) | Nothing explains a conflict among user constraints. |
| P15 | Change geometry, then re-solve | geometry | Oriedita Modify Fold; Origami Editor 3D Selection Mode | Adjacent to layer order: moving a flap changes the stacking. |

The constraint vocabulary in shipped or specified tools, from coarse to fine:

1. Global reference (P9).
2. Component index (P4).
3. Region side or colour (P6).
4. Region local order (P5).
5. Region top-face sequence (P7).
6. Pair order (P8).

Solver hooks already exist (V, V-r): Oriedita constrains one cell's permutation
generator; ORIPA filters an enumerated list; Flat-Folder and Rabbit Ear seed
pair variables.

---

## Gaps: what no tool does (all I)

1. **Clicking faces on the folded figure to say "this one on top here".**
   Oriedita #187 specified it and never built it. Nobody does it on the CP
   either.
2. **Pairwise "A above B" in the UI**, although every solver takes it natively.
   Data point: FOLD `faceOrders` triples are `[f, g, s]`, with `s = +1` meaning
   `f` is above `g` relative to `g`'s normal; an omitted pair means unknown
   (spec read through a fetch: <https://github.com/edemaine/fold/blob/main/doc/spec.md>).
   A partial `faceOrders` list already serves as a constraint set in Rabbit Ear.
3. **A live count of what remains.**
   - No tool updates the remaining-state count as constraints are added.
   - None says "you are down to 1" or "you are at 0, because of these two".
   - Oriedita needs a full re-fold, and its count is lazy.
4. **A map of where the ambiguity is.**
   - No tool shades the rendered fold by "this region still has N choices".
   - Flat-Folder's component segments on the X-ray panel come closest.
5. **A diff between alternatives.**
   - No tool highlights what changes between state *i* and *i+1*, or what a
     region's alternatives look like before you pick one.
   - ORIPA's local-order numbers come with no preview.
6. **Explaining infeasible constraints.**
   - Oriedita has a TODO for it.
   - Rabbit Ear throws a generic `noLayerSolution`.
   - Flat-Folder's conflict display covers only conflicts from creases and
     geometry, since it has no user constraints.
7. **Persisting intent.**
   - Oriedita forgets constraints and the chosen index.
   - Exports carry only the resolved `faceOrders`, never the choices or
     constraints behind them.
   - So a re-solve after a CP edit cannot reapply them.
   - Oriedita also drops constraints on any CP edit, and they are not undoable.
8. **A stack view at a point.** The stack is shown nowhere except as log text
   (Flat-Folder). Figma's `Select layer` list is the closest analogue.
9. **Ranked or sensible defaults.**
   - No tool orders solutions by plausibility, such as fewest colour changes,
     flaps tucked, or TreeMaker's dangle rule.
   - The first solution depends on search order. In ORIPA the numbering of
     local orders may even vary between runs.
10. **Scale-aware steering.**
    - Index navigation breaks down at Ryujin scale.
    - Our own investigation log has a real model whose constraint graph is a
      single 50,713-variable component in 3D. Its flat twin is also one
      component (`research/2026-08-fold3d-layer-order-investigation.md:1081-1095`).
    - There, a per-component index degenerates into one opaque number. Only
      constraints narrow such a space usefully.

### Context in this repo (V)

- `crates/treemaker-flatfold` already mirrors Flat-Folder's representation:
  `component_sizes`, `solution_counts` and `face_orders`
  (`crates/treemaker-flatfold/src/lib.rs:116-124`).
- It returns `Unimplemented` for a custom starting face (`lib.rs:166-171`).
