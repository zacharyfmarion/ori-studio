# Layer-order constraints: the formal model and what is computable

Research slice 1 of 4 (theory) for the layer-order constraints feature,
2026-10-19. This report covers evidence and reasoning only: no UI, no feature
code. Every claim carries one of three labels:

- **Verified**: I read the code, ran it, or checked it exhaustively in this
  session.
- **Documented**: a paper, spec, or upstream document/source says it. Where I
  read a source only through a fetch summary, I say so.
- **Inferred**: my own reasoning. The argument is given, and no experiment or
  source checks it.

Code paths are relative to the worktree root. Flat-Folder is pinned at
`d50004815fb738d009e5b87b2307fbaefa717ef0` (`upstream-sync.json:75-81`).

---

## Summary: the findings that matter for the decision

1. **Every flat model here is the same object underneath.** Each pair of
   overlapping faces gets one above/below relation. On top of that sit
   transitivity within each cell and the non-crossing constraints along creases.
   FOLD `faceOrders`, Flat-Folder's variables and Oriedita's `HierarchyList`
   are three encodings of it. Akitaya–Demaine–Ku prove it equivalent to the
   pointwise definition when faces are convex. FOLD's sign is relative to the
   *second face's normal*, so a constraint stored in FOLD form is unaffected by
   flipping the view.
2. **The algebra is simple.** Everything except transitivity is affine over GF(2):
   - taco-tortilla and tortilla-tortilla are equalities;
   - taco-taco is a 4-term parity.

   Flat-Folder's 16-of-64 taco-taco table is exactly *parity ∧ acyclic triples*.
   I checked this on all 64 assignments (**Verified**). Transitivity is
   not-all-equal on 3 variables. M/V assignments are unit literals, and so are
   most user intents.
3. **"Hundreds of orders" is the median, but they factor into a few small
   choices.** Flat-Folder's published table covers 366 real designs:
   - the median model has about 260 states, spread over a median of 4
     independent components;
   - the largest single component has ≤ 10 states in 58% of models and ≤ 100
     in 80%;
   - 8% of models have a component that hits the 10,000-state cap;
   - Kamiya's Ryujin 2.1 has more than 9·10⁸⁴ states, which are 248
     components, 238 of them binary.
4. **Most intents compile *exactly* to conjunctions of pairwise relations.**
   This covers "A above B", "X on top here", "flap in front of flap", "tucked
   into a pocket", "keep everything outside R", and "component in state k".
   - Disjunctions: "show this colour here" (Oriedita already ships this) and
     "X visible somewhere".
   - Ranking objectives, not constraints: "least white", "fewest visible
     creases", "closest to before".
   - Not layer-order questions at all: the view flip, the fixed face, assigned
     M/V, and the 3D pose.
5. **Complexity.**
   - With M/V fixed, deciding existence is NP-hard, even for box pleating with
     ≤ 25 layers (Akitaya et al. 2015).
   - Verifying an order is O(n³).
   - The problem is FPT in ply + treewidth (Eppstein).
   - User constraints do not change the worst case. "Can X be on top at p" is
     NP-hard under Turing reductions; the argument is in §3.
   - I found no #P-completeness proof for counting the orders of a fixed
     crease pattern. One exists only for a toy model.
   - In practice the components are small.
6. **Live feedback is cheap and sound for unit constraints.**
   - Adding units can only shrink or split components.
   - On two fixtures, **79% and 88%** of naive "put face X on top here" requests
     contradict a relation the M/V assignment already forces. They can be
     rejected in O(1), with a provenance chain as the explanation. The feasible
     choices can be precomputed per cell.
7. **Conflict explanations (MUS / unsat cores) are sound only over a complete
   solver.**
   - Flat-Folder's per-component search is complete: propagation plus
     exhaustive backtracking (read).
   - Our Oriedita-port 3D search is not. A single-relation drop flipped
     found→not-found in 4.62% of trials, so cores computed over it are
     meaningless.
   - Deletion-based MUS over a handful of user constraints is practical, either
     with Flat-Folder's own search or with assumption cores. batsat is a
     pure-Rust MiniSat port that exposes `unsat_core()`.
8. **What a viewer sees is a function of the top face per cell only.**
   Flat-Folder draws from that alone.
   - Distinct appearances factor over "visibility blocks" of components.
   - On our fixtures: 12 states → 3 two-sided appearances (iguana); 9 → 9 from
     one side and 1 from the other (Kabuto); 3 → 1 (squash); 2 → 1 (triad).
   - I found no literature on appearance equivalence. Projected enumeration is
     the standard tool.
9. **Precedents.**
   - **Oriedita** already has user layer constraints: click a point on the
     folded figure to force which paper side shows there. Our port marks the
     mode `Unsupported` and only renders the markers. Upstream also stops
     checking these constraints once its accelerator engages (read, not run).
   - **ORIPA** filters enumerated answers by one subface's full stack.
   - **Flat-Folder** has a per-component state picker.
   - **Rabbit Ear** takes `faceOrders` from the input as initial conditions and
     returns an AND/OR tree of solutions.
10. **3D.** Order variables exist only between coplanar overlapping faces, but
    constraints still couple planes. The exactly-flat state admits strictly
    more orders than its near-flat neighbours, so a constraint chosen on the
    flat figure can become infeasible in Pose mode.
11. **Face identity is positional everywhere.**
    - FOLD indices, Flat-Folder's area-sorted faces and our one-based CP line
      ids are all positions.
    - Oriedita does not save its constraints at all.
    - Anchors must be geometric (overlap of crease-pattern polygons) or semantic
      (tree nodes for TreeMaker or Box Pleating Studio flaps).

---

## 1. Representation

### 1.1 FOLD `faceOrders` and `edgeOrders`

Source: [FOLD spec](https://github.com/edemaine/fold/blob/main/doc/spec.md),
read via two fetch summaries with short verbatim quotes. **Documented.**

- **Entries.** Each `faceOrders` entry is `[f, g, s]`:
  - `+1` means "face `f` lies *above* face `g`", i.e. "on the side pointed to
    by `g`'s normal vector in the folded state";
  - `−1` means below;
  - `0` means unknown.
- **Omitted pairs** count as `0`. The reverse triple `[g, f, t]` may also
  appear. Its sign depends on whether the two faces have the same normal
  direction: `t = −s` if the normals are parallel and `t = s` if they are
  antiparallel (my derivation from the definition; **Inferred**).
- **Normals and M/V.** Normals come from the counter-clockwise order of
  `faces_vertices`. M/V is defined relative to normals: a valley "points the two
  face normals into each other", and a mountain makes them point away.
  `edges_foldAngle` is positive for valleys and negative for mountains.
- **Completeness is not required.** If `f`, `g`, `h` share a point, the `f`–`h`
  order "can be derived, or explicitly specified".
- **Cycles are legal.** The spec names the square twist. A face-level relation
  is therefore *not* a partial order; only the order inside each cell is total.
  Our own 3D research reached the same conclusion
  (`research/2026-08-07-3d-fold-feasibility.md:611-625`, quoting He & Guest).
- **Consistency needs one connected overlap.** "Two faces have a consistent
  above or below relationship only if they overlap in a single connected
  region." Otherwise the spec says to subdivide with `"J"` join edges.
- **`edgeOrders`** is the 1D analogue, `[e, f, s]` with left/right relative to
  `f`'s orientation, and applies to 2D linkages only. It is not relevant to face
  layering.

**Consequence (Inferred).** A constraint stored as a FOLD-style triple is
invariant under a global view flip, because "above" and the normals flip
together. A constraint stored as "above as seen from the screen" is not. A
mirror of the crease pattern itself does change normals: Flat-Folder's import
`side` option flips Y and swaps M/V (`third_party/flat-folder/src/io.js:250-276`).

### 1.2 The facewise model of Akitaya–Demaine–Ku

Source: H. A. Akitaya, E. D. Demaine, J. S. Ku, *Computing Flat-Folded
States*, Origami⁸ (8OSME 2024), [PDF](https://erikdemaine.org/papers/FlatFolder_OSME2024/paper.pdf),
read in full. **Documented.** I abbreviate it "ADK".

- **Variables.** `Λij ∈ {+1, −1}` for every pair of faces whose images overlap.
- **Constraints.** There are five types:
  - antisymmetry;
  - transitivity: `Λij, Λjk, Λki` are not all equal;
  - tortilla-tortilla: `Λik = Λjk` or `Λik = Λjl`;
  - taco-tortilla: `Λik = Λjk`;
  - taco-taco: `Λik + Λjk + Λil + Λjl ≡ 0 (mod 4)`.
- **Theorem 1.** For face-convex crease patterns, a valid facewise order exists
  if and only if a valid pointwise order exists (Demaine–O'Rourke's
  definition). This is the formal licence for "one Boolean per overlapping
  pair".
- **Theorem 2.** A facewise order can be checked in O(min{n²p, n² + mp²}) =
  O(n³), where p is the ply and m the number of cells. The proof builds each
  cell's total order incrementally across the cell-adjacency graph.

**When are faces convex? (Inferred.)**
- At an interior vertex with ≥ 4 folded creases, Kawasaki makes every sector
  between consecutive folded creases strictly less than π.
- A vertex with exactly 2 folded creases is straight (π, π).
- Unfolded creases only subdivide sectors.

So on convex paper, every face of a flat-foldable crease pattern is convex
unless some interior vertex has *only* unfolded (`F`) creases. Under that
condition, "one relation per pair" is exact, and "A above B wherever they
overlap" is a single literal. Non-convex paper or holes break the argument;
FOLD's remedy is `"J"` edges.

### 1.3 Flat-Folder: variables, constraint tables, propagation

**Verified** by reading `third_party/flat-folder/src/`.

- **Variables.** `BF` holds every pair of faces that share a cell. It is built
  by a BFS over cells (`conversion.js:533-589`). A value is `0` (unassigned),
  `1` ("A over B", A < B) or `2` ("B over A") (`constraints.js:2-5`).
- **Constraint tables.** Each type has an explicit table of valid tuples
  (`constraints.js:9-32`):
  - taco-taco: 6 pairs, 16 of 64 valid;
  - taco-tortilla: 2 pairs, the third face is above both or below both;
  - tortilla-tortilla: 2 pairs, equal;
  - transitivity: 3 pairs, 6 of 8 valid.
- **Propagation.** `CON.build` precomputes, for every partial assignment, one
  of: conflict, entailed ("dead"), undecided ("alive"), or the list of implied
  values (`constraints.js:35-100`). This is generalised arc consistency per
  constraint.
  - Propagation is a BFS to a fixpoint (`solver.js:28-72`).
  - The initial pass records a back-pointer to the constraint that implied each
    value (`solver.js:194-240`, `BP[i_] = [type, i, ci]` at `:225`).
- **Generating constraints.**
  - Edge–edge and edge–face overlaps generate taco/tortilla constraints
    (`conversion.js:603-692`).
  - Transitivity triples are generated lazily per pair. Triples already implied
    by taco-tortilla chains are dropped (`conversion.js:705-770`).
  - I checked that this reduction is sound: when `f2` and `f3` lie in one
    taco-tortilla component around `f1`, they have the same order relative to
    `f1`, so not-all-equal holds automatically (**Inferred**, from the code's
    semantics).
- **M/V seeding.** Each M or V crease fixes the variable of its two adjacent
  faces, with the sign taken from `faces_flip` (`solver.js:181-193`).
- **Export.**
  - `FO = [f1, f2, Ff[f2] ? 1 : −1]`, where `f1` is over `f2` in the solver's
    global stacking direction (`conversion.js:783-788`). This is exactly FOLD
    `faceOrders`.
  - Each cell's stack is the cell's face list sorted with the pair relation as
    comparator (`conversion.js:789-795`).
  - `io.js:25` notes "TODO: remove implied face orders?". Flat-Folder exports
    every pair, not a minimal set.

**Algebraic structure.** Map each relation to a bit. Then:
- taco-tortilla and tortilla-tortilla are affine equalities over GF(2);
- ADK's taco-taco is a 4-term XOR, since four ±1 values sum to 0 mod 4
  exactly when an even number of them are −1;
- transitivity is not-all-equal on 3 variables (NAE-3).

I enumerated all 64 assignments of Flat-Folder's 6-variable taco-taco table.
It equals *(ADK 4-term parity) ∧ (no 3-cycle among the four faces)* on 64/64
(**Verified**, `node` check this session). The whole flat problem is therefore
an XOR system plus NAE-3 plus unit literals.
- The XOR part alone is polynomial: Gaussian elimination decides it.
- NAE-3SAT alone is NP-complete (Schaefer 1978, standard reference, not
  re-read).
- The mix is where the hardness lives.

ADK §5.3 mention a follow-up, Ku, Terao & Terao, *An Algebraic Approach to Layer
Ordering Constraints for Origami Flat-Foldability* (8OSME 2024). It "treats the
set of the nontransitivity constraints as a linear system to infer the initial
assignment of a larger number of variables". I could not find that paper
online; its content here is **Documented only via ADK**.

### 1.4 Oriedita: subfaces, HierarchyList, 3EC and 4EC, CustomConstraint

**Verified** by reading `third_party/oriedita/origami/src/main/java/origami/`.

- **Subfaces.** A subface is a cell of the overlap arrangement. Each holds a
  list of faces and a permutation generator, and the permutation is the cell's
  stack. Subfaces whose face sets are subsets of others are dropped, unless
  they carry a custom constraint (`crease_pattern/worker/FoldedFigure_Configurator.java:222-248`).
- **`HierarchyList`.** A symmetric matrix over all pairs of faces, with values
  `ABOVE_1 = 3`, `BELOW_0 = 1`, `UNKNOWN_N50 = 2` (overlap, undecided) and
  `EMPTY_N100 = 0` (no overlap) (`folding/HierarchyList.java:16-27`). This is
  the facewise relation. Cross-subface consistency comes from checking each
  subface's permutation against it.
- **`EquivalenceCondition`** records `hierarchyList[a][b] = hierarchyList[c][d]`
  (`folding/util/EquivalenceCondition.java:3`).
  - The 3EC list `tL` holds conditions of the form "face `im` overlapping crease
    `ib` is not sandwiched between the two faces of `ib`", which is
    taco-tortilla (`HierarchyList.java:85-89`).
  - The 4EC list `uL` forbids the interleavings `i,j,i,j` and `j,i,j,i` of two
    overlapping creases, which is taco-taco (`HierarchyList.java:121-127`; the
    check is `folding/element/SubFace.java:323-337`).
  - Transitivity is implicit, because every subface is a permutation.
- **`CustomConstraint`** (`folding/constraint/CustomConstraint.java:9-32`)
  records "some face in `top` lies above every face in `bottom`", where
  `top ∪ bottom` is the whole face set of one subface. It also stores a click
  point, a `FaceOrder` (`NORMAL` or `FLIPPED`) and a `Type` (`COLOR_BACK`,
  `COLOR_FRONT` or `CUSTOM`). Details are in §4.

### 1.5 How the three relate

For flat folds with convex faces, all three describe **a total order of the
faces in every cell, with every pair of faces ordered the same way in every
cell they share**. That is equivalent to a pairwise relation that satisfies
transitivity within each cell plus the crease constraints (ADK Theorems 1–2;
**Documented**).

| | Unknowns | Search |
| --- | --- | --- |
| Flat-Folder | One Boolean per overlapping pair | Over the pair Booleans |
| ORIPA / Oriedita | Per-cell permutations, made consistent through the pair table | Over the permutations |
| FOLD | A possibly partial list of the pair relations | n/a (a file format) |

None of these encodings is a global partial order of faces, because square
twists are cyclic.

---

## 2. Solution-space structure

### 2.1 What a component is

Flat-Folder defines components only *after* M/V seeding and propagation (**Verified**,
`solver.js:73-114`; `compute.js:110-139`):

- the nodes are the unassigned variables;
- two nodes are linked when they share a constraint that is not yet entailed
  (`if (I == CON.state.dead) continue;` at `solver.js:91-92`);
- each component is solved separately by a complete DFS with propagation
  (`solver.js:120-180`, `:241-266`);
- the state count is the product of the per-component counts (ADK Theorem 3,
  **Documented**). Storing per-component solution lists represents
  ∏ sᵢ states in O(Σ sᵢ) space.

Three consequences:

- **The decomposition comes from the determinations, not from the geometry.**
  Kabuto's raw constraint graph is a single component of 117 variables. After
  propagation it is 81 fixed variables plus two free groups of 18 (`research/2026-08-07-3d-fold-feasibility.md:931-945`;
  matches my run below).
- **Unit constraints can only split or shrink components (Inferred, from the
  code's semantics).**
  - Assigning a variable removes a node.
  - A dead constraint stays dead under any consistent extension.
  - No new links can therefore appear.

  So user constraints that are literals make the solve *cheaper*. Disjunctive
  constraints add hyperedges and can merge components.
- **The structure is nested.** Fixing one variable can split a component again.
  - Rabbit Ear's solver re-splits after every guess. It returns
    `{orders, branches}`, where each branch is an array of forks and each fork
    may carry its own branches: an AND/OR tree whose count is
    ∏ (Σ children). (**Documented**, via fetch summaries of
    `rabbit-ear/src/layer/solver.js` and `prototype.js`.)
  - Flat-Folder flattens each component into a list of solutions.

### 2.2 Published numbers

**ADK §5.4 (Documented)**, Kamiya's *Ryujin 2.1*:
- 5,773 faces and 453,998 pair variables;
- 119,105 taco-taco, 586,781 taco-tortilla and 30,523,575 transitivity
  constraints;
- 248 components after pruning: 238 with 2 states, 3 with 3, 4 with 4, 1 with
  5, 1 with 950 and 1 with 633,184;
- in total more than 9·10⁸⁴ states.

ADK also report that Flat-Folder finds at least one state for every model in
their datasets "within seconds or minutes", and that "in many practical crease
patterns, the tᵢ's and sᵢ's turn out to be relatively small".

**Flat-Folder's `examples/instagram_data.csv`** ([upstream main](https://github.com/origamimagiro/flat-folder/tree/main/examples))
covers 366 flat-foldable, M/V-assigned designs by 58 designers. The solver
capped each component at 10,000 states.

- **Provenance.** I transcribed the needed columns through three fetch passes
  and summarised them with `node`.
- **Spot checks:**
  - the Kabuto row (117 variables, `|1|3|3|`, 9 states) matches my local run
    exactly;
  - the 30 capped rows were confirmed by an independent pass;
  - the 56 single-state rows were confirmed too. The second pass missed row
    172, whose raw line confirms a single state.
- **Label.** **Documented** (upstream data), with my arithmetic on top.

| Statistic | Value |
| --- | --- |
| Faces, median (max) | 216 (11,859) |
| Pair variables, median (max) | 4,788 (1,011,971) |
| Exactly 1 state | 56 models (15%) |
| ≤ 10 / ≤ 100 / ≤ 10⁴ states | 31% / 46% / 67% |
| > 10⁶ / > 10¹² states | 20% / 10% |
| Median state count | ≈ 10^2.4 ≈ 260 |
| 90th percentile state count | ≈ 10^11 |
| Free components, median (max) | 4 (248) |
| Largest component ≤ 2 / ≤ 10 / ≤ 100 / ≤ 1000 states | 31% / 58% / 80% / 87% |
| Some component hit the 10,000 cap | 30 models (8%); their counts are lower bounds |
| Solve time on their machine, median / 90th percentile | 3 ms / 3.7 s |
| Solves over 10 s / over 60 s | 32 / 14 (mostly capped models) |

Recognisable traditional models from the same table: the crane has 5 states in
one component (`|1|5|`); the sailboat has 4.

### 2.3 Our fixtures, through the vendored Flat-Folder

**Verified.** These are throwaway `node` probes in the session scratchpad,
not committed. They import `third_party/flat-folder/src` unmodified and repeat
the pipeline of `tools/flat-folder-oracle/oracle.mjs`.

"dof" is the dimension of the affine solution space of the GF(2) part
(variables minus rank). The state count is at most 2^dof.

| Fixture | Faces | Cells | Max ply | Pair variables | Fixed after propagation (seeded by M/V) | Free components | States | GF(2) rank → dof |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `tests/fixtures/flat-folder/kabuto.fold` | 18 | 22 | 12 | 117 | 81 (20) | 18, 18 | 9 = 3·3 | 113 → 4 (≤ 16) |
| `packages/origami-simulator/tests/fixtures/iguana-split-crease.fold` | 36 | 23 | 26 | 418 | 407 (56) | 11 | 12 | 412 → 6 (≤ 64) |
| `tests/fixtures/folding-sequence/fold/squash-local.fold` | 8 | 1 | 8 | 28 | 20 (8) | 8 | 3 | 26 → 2 (≤ 4) |
| `tests/fixtures/folding-sequence/fold/treemaker-triad-base.fold` | 6 | 1 | 6 | 15 | 11 (6) | 4 | 2 | 14 → 1 (≤ 2) |

On these four fixtures:
- propagation already found the **complete backbone**: no free variable is
  constant across all of its component's solutions;
- GF(2) elimination pinned no additional variable;
- the remaining freedom is a handful of linear degrees of freedom, which
  transitivity then prunes. For example, Kabuto's 16 linear combinations
  shrink to 9 states.

This sample is too small to generalise. Other repository fixtures fail
Flat-Folder's import or M/V check: the default molecules, `bad_twist`,
`grid6`, and the folding-sequence 3D steps.

### 2.4 Bounds and counting results

**Documented.**
- A crease pattern with n convex faces has at most 2^{O(n²)} folded states.
- There are M/V-assigned patterns on convex (rectangular) paper with 2^{Ω(n²)}
  states.
- There are M/V-assigned patterns on square paper with 2^{Ω(n log n)} states.

These are ADK Theorems 4–6. The square construction formalises a sketch in
Bern–Hayes. A 1×n stamp strip with given M/V has 2^{Θ(n)} folded states
(Uehara, *Stamp Foldings with a Given Mountain-Valley Assignment*, Origami⁵,
2010, as cited by ADK).

Related enumeration work, read at abstract level only:
- Nakajima, statistical-mechanics enumeration for random single vertices,
  [arXiv:2409.03240](https://arxiv.org/abs/2409.03240);
- Fofonov, exact layer-order classification for period-2 M/V on 2×2k maps,
  with counts 0, 1, 6k−5 and 4k−3, [arXiv:2609.16776](https://arxiv.org/abs/2609.16776).

---

## 3. Complexity

| Question | Status | Source | Label |
| --- | --- | --- | --- |
| Verify a given facewise order | O(min{n²p, n²+mp²}) = O(n³) | ADK Thm 2 | Documented |
| Does a valid order exist? (M/V fixed) | NP-hard, even for box pleating with ≤ 25 layers | Akitaya, Cheung, Demaine, Horiyama, Hull, Ku, Tachi, Uehara, *Box Pleating is Hard*, JCDCGG 2015 (LNCS), [PDF](https://scripts.mit.edu/~jasonku/pdf/BOXPLEATINGHARD_LNCS2016.pdf) | Documented |
| The same question, M/V unassigned | NP-hard; the same paper also found an error in Bern–Hayes's crossover gadget | as above; Bern & Hayes, SODA 1996, pp. 175–183 (not read) | Documented |
| Is the whole problem in NP? | Finding an order is in NP given the folded geometry. Whether crease-pattern flat-foldability is in NP is open (precision of the geometry) | ADK §1 | Documented |
| Parameterised | (p!)^{O(w)}·n², with p the ply and w the treewidth of the cell-adjacency graph; labelled or unlabelled. The w dependence is ETH-tight; a better p dependence would advance map folding | Eppstein, CCCG 2023 [arXiv:2306.11939](https://arxiv.org/abs/2306.11939); journal version [arXiv:2410.07666](https://arxiv.org/abs/2410.07666) | Documented |
| Count the states | #P-complete for Eppstein's "flaps and flips" toy model, under counting (Turing) reductions; FPT in ply and treewidth | arXiv:2410.07666, Thm 5 (fetch summary) | Documented |
| Count the orders of a fixed M/V-assigned crease pattern | Exact counting is at least NP-hard, because a count > 0 decides existence. I found no #P-completeness proof | — | Inferred |
| Existence with user-pinned pair relations | NP-hard: the unconstrained problem is the special case, and M/V seeds are themselves pinned pairs. In NP given the geometry | — | Inferred |
| Can face X be on top at point p? | NP-hard under Turing reductions; argument below | — | Inferred |
| Is relation (A,B) forced in every state? (backbone) | coNP-hard under Turing reductions: an instance is unsatisfiable exactly when (A,B) is forced both ways | — | Inferred |
| Count distinct appearances; maximise visible area | NP-hard, since it contains existence | — | Inferred |
| Special cases | A single vertex and 1D strips are linear time; general map folding is open | Bern–Hayes; Arkin et al., *When can you fold a map?* (2004); Eppstein | Standard results, not re-read |

**The argument for "X on top at p" (Inferred).**
- Fix any cell c. Every valid state has exactly one top face in c.
- So the pattern is flat-foldable exactly when some X ∈ S_c can be on top at c.
- That is at most |S_c| ≤ n oracle calls.
- Therefore the visibility query, even restricted to unit-literal requests, is
  NP-hard under Turing reductions.

**What this means in practice.** The hardness is worst-case. On real designs,
propagation fixes most variables and leaves small components (§2.2). Eppstein
shows bounded ply plus bounded treewidth is tractable, and box pleating is hard
at ply 25 only through treewidth.

---

## 4. Mapping user intents to constraints

Notation:
- `x ≻ y` means "x is above y". It is stored normal-relative, as
  `[x, y, s]` in FOLD form.
- `S_c` is the set of faces in cell c.
- "Exact" means the intent and the encoding have the same set of states.

1. **"A is above B wherever they overlap."** **Exact, one unit literal**
   `A ≻ B` (convex faces, §1.2). *Inferred*, from ADK's definitions.
   - It is vacuous if A and B do not overlap. A UI should say so rather than
     store a no-op.
   - It does not imply `A ≻ C` from `B ≻ C` unless A, B and C share a cell.
     Cycles are legal.
   - If A and B are adjacent across a crease, the literal *is* that crease's
     M/V: a no-op or infeasible on an assigned crease, an assignment on a
     `U` crease.
2. **"At this point, face X is on top."** **Exact conjunction:**
   `⋀_{Y ∈ S_c∖{X}} X ≻ Y`, after point location in the overlap graph. A point
   on a cell boundary is ambiguous. Prescribing the full stack at a point is
   k−1 consecutive literals; transitivity supplies the rest. *Inferred.*
3. **"At this point, the white (or coloured) side shows."** This is what
   Oriedita ships.
   - **Encoding: a disjunction**, `⋁_{t∈T} ⋀_{b∈B} t ≻ b`, where T are the
     faces of the wanted orientation in `S_c` and B the rest.
   - It equals "the top of `S_c` lies in T", because the top is unique.
   - It needs auxiliary top-indicator variables (O(|T|·|B|) clauses) or a
     dedicated propagator.
   - Oriedita merges two constraints on the same subface by intersecting the
     T sets and uniting the B sets
     (`crease_pattern/worker/FoldedFigure_Configurator.java:213-220`). That is
     correct: `top ∈ T₁ ∧ top ∈ T₂ ⇔ top ∈ T₁∩T₂`.
   - *Verified* for the upstream semantics, *Inferred* for the encoding.
4. **"Face X is visible from the front."**
   - **Somewhere:** a disjunction over X's cells of item 2's conjunctions.
   - **Wherever it is:** "X lies above every face it overlaps". This is an
     **exact conjunction** of literals.
   - **Everywhere it *could* be:** *not a constraint*. The cells where X can be
     on top are computable, but they may be pairwise compatible and not jointly
     so. This is the optimisation "maximise X's visible area". *Inferred.*
5. **"This flap is tucked inside that pocket."** Given the flap's faces F and
   the pocket's two walls W_front and W_back:
   - **Exact conjunction:** `w ≻ f` for every w ∈ W_front, and `f ≻ w` for
     every w ∈ W_back, for each overlapping pair.
   - If the flap crosses the pocket's fold line, taco-tortilla forbids "between"
     (the flap must lie above both or below both). The request is then
     immediately infeasible, with a one-constraint explanation (`constraints.js:13-15,29`).
   - *Inferred.*
6. **"This flap lies in front of that flap."**
   - **Strong form:** every overlapping pair `f₁ ≻ f₂`, an exact conjunction.
   - **Weak form:** "where both appear, F₁'s topmost layer is above all of F₂"
     allows interleaving. Per cell it is the disjunction of item 3, with
     T = F₁∩S_c and B = F₂∩S_c.
   - The two differ on interleaved flaps, so a UI must pick one. *Inferred.*
7. **"Keep the current order everywhere except this region R."**
   - **Hard form:** unit literals that pin σ₀ on every pair whose overlap lies
     entirely outside R. Pairs that straddle R's boundary must stay free: a
     pair has one relation across its whole overlap, so changing it inside R
     changes it outside.
   - **Soft form:** minimise the Hamming distance to σ₀, optionally weighted by
     overlap area. This is MaxSAT.
   - When the hard form conflicts, a core over the "keep" literals names *which
     outside relations would have to move*, which is useful feedback.
   - *Inferred.*
8. **"This whole component should be in state k."**
   - It is a conjunction of the component's literals: trivially exact.
   - **Store the literals, not k.** The enumeration order depends on the
     variable order, and components split when constraints are added.
   - Flat-Folder exposes exactly this as an index picker (`third_party/flat-folder/README.md:130-149`,
     **Documented**).
9. **"Which side of the paper faces the viewer."** *Not a layer constraint.*
   - It is the global flip, a camera operation. FOLD orders are invariant
     under it.
   - Flat-Folder's "Flip" only chooses which end of each cell's stack is drawn
     (`gui.js:214-215`, **Verified**).
   - Likewise, which face stays fixed (Flat-Folder's face 0, Oriedita's
     standard face) changes only the rigid placement.
   - It still matters for *interpreting* screen-relative input and for ranking
     objectives, which should evaluate both flips.
10. **Ranking: "least white showing", "fewest visible creases", "closest to
    before".** Objectives over the top-face indicators, not constraints.
    - Least white: Σ_c area(c)·[the top face of c shows white]. This is linear
      and additive over cells.
    - Fewest visible creases: Σ over segments of length × [visible line].
      Each segment depends on the tops of its two adjacent cells, so this is
      pairwise.
    - Closest to before: Hamming distance.
    - Optimise exactly by enumerating per visibility block (§5) where blocks are
      small; otherwise use weighted MaxSAT or pseudo-Boolean optimisation.
    - *Inferred.*

**Not layer-order questions at all.** These are *Inferred*, except where noted.
- **Changing an assigned crease's M/V** is a crease-pattern edit.
  - With M/V fixed, the inside/outside reverse-fold distinction is already
    decided.
  - In a flat fold the 2D geometry (where faces land) depends only on which
    creases fold, not on M vs V. So "swing this flap to the other side" needs
    a different set of folded creases.
- **Pose** (spreading layers, opening a flap, 3D angles) and **view
  transforms** (flip, rotation, fixed face).

---

## 5. Visible-appearance equivalence

**Definition and renderer fact (Verified).** Flat-Folder's folded rendering is
a function of `Ctop` alone, the top face of every cell (`third_party/flat-folder/src/gui.js:214-229`):
- region polygons and colours come from `Ctop` (`conversion.js:819-880`);
- line types come from `Ctop` of the two adjacent cells (`conversion.js:797-818`);
- flipping draws the bottom face of every cell instead.

So two states with equal top-face vectors are drawn identically. A coarser
"drawn image" equivalence (same colour per cell, same line type per segment)
can merge even different top faces.

**What appearance means depends on the renderer and the pose.** X-ray or
translucent modes, shadows, and Pose mode's spread layers all expose hidden
layers (*Inferred*).

**Factorisation (Inferred; proof sketch).**
- The state set is σ₀ × S₁ × … × S_k.
- In cell c, drop the faces that a fixed relation puts below another face.
  The remaining candidates T_c contain the top. The top is the maximum of T_c,
  so it depends only on the pairs within T_c.
- Let D(c) be the set of components that own a pair within T_c.
- Join components i and j whenever some D(c) contains both. The connected
  groups are **visibility blocks**.
- The appearance vector splits into per-block sub-vectors, and the blocks are
  independent. Hence

  `#appearances = ∏_B |image of block B|`.

  Components that appear in no D(c) are invisible from that side: they
  multiply states but not appearances.
- For the drawn image, also join the blocks of adjacent cells, because each
  line type couples two cells.

**Cost.**
- Enumerate per block: Σ_B ∏_{i∈B} sᵢ, instead of ∏ over everything.
- When a block is too large, use *projected enumeration*:
  - branch only on per-cell top choices and check at each leaf that some
    completion exists (one satisfiability call per distinct appearance); or
  - add a blocking clause over the top indicators after each new appearance.

  These are standard techniques. Gebser, Kaufmann & Schaub, *Solution
  Enumeration for Projected Boolean Search Problems*, CPAIOR 2009, covers
  enumeration; Aziz, Chu, Muise & Stuckey, *#∃SAT: Projected Model Counting*,
  SAT 2015, covers counting. Both are standard references, not re-read.

**Measured on our fixtures (Verified, scratchpad probe).** Side A is Flat-Folder's
unflipped view and side B the flipped view.

| Fixture | States | Distinct tops, side A | Distinct tops, side B | Both sides | Drawn image A / B / both |
| --- | --- | --- | --- | --- | --- |
| Kabuto | 9 | 9 | 1 | 9 | 9 / 1 / 9 |
| iguana-split-crease | 12 | 2 | 2 | 3 | 2 / 2 / 3 |
| squash-local | 3 | 1 | 1 | 1 | 1 / 1 / 1 |
| triad base | 2 | 1 | 1 | 1 | 1 / 1 / 1 |

- In every fixture, every cell's top depended on at most one component. So
  blocks equal components.
- Kabuto's free components are both visible from side A and both invisible from
  side B.
- The collapse ratio ranges from none to 4–12×.

I found **no paper** on grouping flat-folded states by appearance.

Nearest precedent: ORIPA's current answer filter groups enumerated answers per
subface by the *full* stacking order of that subface's faces, which is finer
than the top face. Each answer lands in exactly one group per subface.
- Classes: `SubfaceToOverlapRelationIndicesFactory`, wired through
  `EstimationResultUIView.setFilterInitializationListener`.
- Sources: [factory](https://raw.githubusercontent.com/oripa/oripa/master/src/main/java/oripa/gui/presenter/estimation/logic/SubfaceToOverlapRelationIndicesFactory.java),
  [presenter](https://raw.githubusercontent.com/oripa/oripa/master/src/main/java/oripa/gui/presenter/estimation/EstimationResultUIPresenter.java).
- **Documented** via fetch summaries of the source; I did not run ORIPA.

---

## 6. Feedback mechanisms

### 6.1 What can be shown live, cheapest first

1. **Instant rejection.**
   - A requested literal that contradicts a relation already fixed by M/V and
     propagation can be rejected with an O(1) lookup.
   - The explanation is the provenance chain: Flat-Folder's back-pointers walked
     to the seeds by `error_faces` (`solver.js:267-301`; surfaced as "Faces
     participating in conflict" in `compute.js:119-125`).
   - ORIPA's `EstimationResultRules` similarly tags faces with the rule they
     violated: MV, transitivity, penetration, stack4Faces or cover3Faces
     ([source](https://raw.githubusercontent.com/oripa/oripa/master/src/main/java/oripa/domain/fold/EstimationResultRules.java),
     **Documented**).

   **Measured (Verified), "put face X on top at this cell" for every
   (cell, face) pair:**

   | Fixture | Requests | Contradict a fixed relation | Propagation conflict | Search conflict | Feasible (already forced on top) |
   | --- | --- | --- | --- | --- | --- |
   | Kabuto | 172 | 136 (79%) | 0 | 0 | 36 (8) |
   | iguana-split-crease | 200 | 175 (88%) | 0 | 0 | 25 (21) |
   | squash-local | 8 | 7 | 0 | 0 | 1 (1) |
   | triad base | 6 | 5 | 0 | 0 | 1 (1) |

   All feasible verdicts agreed with full enumeration.

   **Implication (Inferred):** the feasible top faces per cell can be
   precomputed (from enumeration, or with |S_c| satisfiability probes), so the
   tool can offer only valid choices. A naive "click to bring to front" would
   mostly fail.
2. **Forced consequences.**
   - Propagate from the new literals. Every newly fixed relation is a sound
     consequence.
   - Propagation is local generalised arc consistency, so it may miss forced
     relations. It missed none on our fixtures (§2.3), but that is anecdotal.
   - The exact backbone is free when a component's solutions are enumerated:
     the variables constant across the filtered list.
   - Otherwise it costs SAT probes (Janota, Lynce & Marques-Silva, *Algorithms
     for Computing Backbones of Propositional Formulae*, AI Comm. 2015;
     standard reference, not re-read).
   - A GF(2) elimination pass over the XOR part is a cheap, complete closure of
     that part (§1.3). An inconsistent row subset is an "inconsistent cycle"
     certificate, the kind Nakajima uses as a sufficient non-foldability test
     ([arXiv:2506.12659](https://arxiv.org/abs/2506.12659)).
3. **Remaining count.**
   - It is exact when the affected components are fully enumerated: filter each
     component's list and multiply.
   - It is a lower bound when Flat-Folder's per-component cap was hit. Our port
     defaults to 10 solutions per component (`crates/treemaker-flatfold/src/lib.rs:42-52`).
   - Only components that contain constrained variables need recomputing.
   - Approximate counting with guarantees exists if ever needed (Chakraborty,
     Meel & Vardi, ApproxMC, CP 2013; standard reference, not re-read).
   - The count of distinct appearances (§5) is probably the more meaningful
     number to show.
4. **Deep conflicts.** Propagation is silent but a component's complete search
   finds nothing. The verdict is exact; the explanation needs §6.2.

### 6.2 Explaining infeasibility: when cores are sound

- Over a **complete** procedure, "base ∧ S is unsatisfiable" is monotone in S:
  supersets of unsatisfiable sets are unsatisfiable.
- Deletion, QuickXplain and MARCO enumeration therefore return true *minimal
  unsatisfiable subsets*, i.e. proofs that "these k constraints cannot hold
  together". MCS duality gives "drop one of these".
- References (standard, not re-read for this report):
  - Liffiton & Sakallah, J. Automated Reasoning 2008;
  - Junker, QuickXplain, AAAI 2004;
  - Marques-Silva, Janota & Belov, *Minimal Sets over Monotone Predicates*,
    CAV 2013;
  - Liffiton et al., MARCO, Constraints 2016.
- **Group cores.** Treat each user constraint as one group, and optionally each
  crease's M/V seed as another, with the geometric constraints hard. The result
  is actionable: "your constraint 3 conflicts with the valley at crease e".

**Flat-Folder's per-component search is complete (Verified by reading
`solver.js:120-180`).**
- It tries both values of every unforced variable in a fixed order.
- It propagates after every guess.
- It backtracks chronologically.
- Every constraint is checked when its last variable is assigned.
- Propagation removes only values that cannot extend.

Every "no solution" is therefore exact relative to the generated constraint
set. Correct geometry and ε are a separate assumption.

**Contrast: our Oriedita-port 3D search is not complete.**
- In the 3D configuration, dropping one hierarchy relation (which only enlarges
  the feasible set) flipped found→not-found in **697 of 15,096 trials
  (4.62%)**, and in 0% without quadruple conditions (`research/2026-08-fold3d-layer-order-investigation.md:101-106`).
- The predicate "the search did not find a solution" is therefore non-monotone.
- Deleting constraints until the search succeeds returns an arbitrary failing
  set. It is not a core, and it can even be satisfiable (`…:4464`, R1).
- The same notebook shows the escalation strategies are mutually incomparable
  (`…:4480`).
- The flat Oriedita path was not measured. The same search design means it
  should be treated as unproven (Inferred).
- The notebook's one sound minimal-unsatisfiable-subset result was obtained the
  sound way: all 720 stackings checked against a 15-constraint set, then
  exhaustive enumeration over all 2¹⁵ subsets (`…:3913-3923`).

**Practicality at our sizes (Inferred, with documented inputs).**
- User constraints number tens at most, so deletion needs k+1 solves of the
  *affected* components.
- With Flat-Folder's own search those are milliseconds on the median model
  (§2.2), but exponential in the worst case. Chronological backtracking without
  learning can be slow at *proving* unsatisfiability in a big component.
- A CDCL solver with one assumption literal per user constraint returns a core
  in one call and minimises it by deletion. batsat 0.6.0, a pure-Rust MiniSat
  port, exposes `solve_limited(&assumps)` and `unsat_core()`, the latter
  documented as "a subset of assumptions" ([docs.rs](https://docs.rs/batsat/latest/batsat/interface/trait.SolverInterface.html),
  **Documented**). I could not confirm varisat's equivalent API.
- **Encoding size.** Taco-tortilla and tortilla-tortilla need 2 binary clauses
  each. Taco-taco needs 8 four-literal clauses for the parity, plus its
  triangles. Transitivity needs 2 three-literal clauses per triple.
  - Encode only the free components. Flat-Folder itself generates
    transitivity lazily because Ryujin has 30.5M triples.
  - A free component with a few thousand variables gives on the order of 10⁵
    clauses, routine for CDCL.
- Our 3D notebook's objection R2 ("a SAT oracle would be a second
  implementation… drifting silently", `…:4465`) was about re-deriving
  *Oriedita's* semantics. A CNF generated mechanically from Flat-Folder's
  constraint objects (`BF`, `BT`, the `CON` tables), and gated by count
  agreement with Flat-Folder's enumerator on fixtures, does not re-derive
  anything. *Inferred.*

---

## 7. Non-flat (3D) folded states

From our own measured research (**Documented, internal**), plus Rabbit Ear:

- **Variables.** Layer order exists only where paper coincides with paper.
  Two-dimensional coincidence requires coplanarity, so the variables partition
  by plane. A flat fold is the single-plane case
  (`research/2026-08-07-3d-fold-feasibility.md:143-157`).
- **Coupling.** Constraints still couple planes. Two creases can have
  coincident images while their faces lie in different planes. The solving unit
  is the constraint-graph component, not the plane, and per-plane counting
  over-counts (384 vs 16 on a nested-sheet case) (`…:579-590`).
  - Rabbit Ear's 3D solver clusters coplanar overlapping faces, runs the 2D
    taco/tortilla rules per cluster, and adds cross-plane `taco_tortilla3D` /
    `tortilla_tortilla3D` and a fixed order where a 3D edge crosses a coplanar
    face. **Documented**, via a fetch summary of
    `rabbit-ear/src/layer/constraints3D.js`.
- **The wall rule.** A crease carrying paper out of a plane forces in-plane
  faces whose interior it crosses to one side. That is a unary constraint
  (`…:524-531`).
- **Flat is special.** At exactly 180° the taco-tortilla "above both" branch
  reopens, so the flat state admits **strictly more** orders than any nearby
  posed state (`…:532-537`).
  - **Consequence for Pose mode (Inferred).** A constraint satisfied in the flat
    figure can become infeasible after a small opening. Re-validate the
    constraint set per pose, and scope constraints to a coplanar stack: plane
    plus cell.
- **"Above" in 3D.** FOLD's normal-relative sign works unchanged for coplanar
  pairs.
  - "Visible from the camera" in 3D is mostly occlusion between non-coplanar
    faces, a rendering and depth question.
  - Layer order only resolves ties within coplanar stacks.
- **Cyclic orders** remain legal (square twist) (`…:611-625`). Search
  completeness (§6.2) matters even more here.

---

## 8. Face identity across edits

**What exists today (Verified unless noted):**
- **FOLD.** Ids are zero-based array positions. Custom data must use a
  namespaced key with a colon, e.g. `"faces_tm:…"`. Frames that inherit a
  parent's mesh share its ids. Nothing else persists. (**Documented**, spec via
  fetch summary.)
- **Flat-Folder** reorders faces by area on import (`third_party/flat-folder/README.md`,
  "on import, will reorder faces to be increasing by area"). So solver face ids
  do not even equal the file's ids, and any stored reference needs a mapping.
- **Our crease pattern.** Line ids are one-based *positions* into
  `line_segments` (`crates/oristudio-cp/src/session.rs:1385-1407`). There is no
  stable crease identity to hang faces on.
- **Oriedita.**
  - A constraint stores face-index sets plus a folded-space click point
    (`CustomConstraint.java:24-32`).
  - It lives on the per-figure `HierarchyList`. `reset()` does not clear it
    (`HierarchyList.java:38-41`; `FoldedFigure_Worker.java:17,51`).
  - Nothing in `oriedita-data` serialises it: grep finds no reference to it.
  - After an edit, `findContainingSubface` ends in `.findFirst().get()`
    (`FoldedFigure_Configurator.java:209`), which would throw when the face set
    no longer matches a subface (Inferred; not run).
- **Our port.** Only the marker renders (`crates/oristudio-cp/src/folding.rs:430,448-468,4128`).
  The mode is listed `Unsupported` (`crates/oristudio-cp/src/lib.rs:1662-1669`).

**Re-identification options (Inferred), from most to least robust:**
1. **Store the intent, recompile after every edit.** Keep "flap P in front of
   flap Q" or "top at point p shows colour c", not the literals. Literals are
   derived data.
2. **Semantic anchors where a design model exists.** TreeMaker and Box Pleating
   Studio flaps map to tree leaves and flap ids, which survive re-optimisation
   even when every face changes.
3. **Crease-pattern-space polygon matching.** Keep each referenced face's paper
   polygon; after an edit, map it to the new faces it overlaps by area. This
   handles splits (one → many) and merges.

   *But* a new folded crease inside face A can move part of A elsewhere in the
   folded state. Re-derive the overlaps and drop pairs that no longer overlap,
   saying so.
4. **A crease-pattern-space interior point**, such as a pole of inaccessibility.
   It is cheap, but it silently picks one piece after a split.
5. **A folded-space point plus side (Oriedita's approach).** It is fragile:
   nearly any edit moves the folded geometry, and stacks are ambiguous in
   depth.

Every edit should end with a three-way classification per constraint (intact,
remapped ambiguously, broken), followed by a satisfiability re-check.

CAD's "persistent naming problem" is the same issue (Kripac, *Computer-Aided
Design* 29(2), 1997; standard reference, not re-read). Its lesson is to surface
broken references rather than guess.

---

## Constraint vocabulary

| User intent | Formal encoding | Cost to check / enforce | Explainable on conflict? | Notes |
| --- | --- | --- | --- | --- |
| A above B | 1 literal `[A,B,s]`, normal-relative | O(1) check against fixed relations; propagation; per-component search | Yes: unit, provenance chain or core | Exact for convex faces. Vacuous if no overlap. On an adjacent pair it is the M/V |
| X on top at point p | Conjunction of `X ≻ Y` for Y ∈ S_c∖{X} | Same | Yes | Exact. Precompute the feasible tops per cell: 79–88% of naive requests are infeasible on our fixtures |
| Full stack at p | k−1 consecutive literals | Same | Yes | Exact |
| This colour shows at p (Oriedita) | Disjunction: top(c) ∈ T | Auxiliary variables, or a custom propagator; O(|T||B|) | Yes, as one selector | Upstream exists; not ported to the solver; upstream skips it once its accelerator engages |
| X visible somewhere | Disjunction over X's cells | Auxiliary variables per cell | Yes, as one selector | Weak; consider an area threshold |
| X on top wherever it is | Conjunction: X above everything it overlaps | Literals | Yes | Exact |
| X as visible as possible | Objective: maximise X's top area | Per-block enumeration, or MaxSAT | n/a | Not a hard constraint |
| Flap F tucked in pocket (W_front, W_back) | Conjunction over overlapping pairs | Literals | Yes | Infeasible by taco-tortilla if F crosses the pocket's fold |
| Flap F₁ in front of F₂ | Strong: conjunction. Weak: per-cell disjunction | Literals / auxiliary variables | Yes | Differ on interleaved flaps |
| Keep order outside R | Hard: literals on pairs entirely outside R. Soft: MaxSAT | Many units (cheap) / optimisation | Hard: yes, and the core names the outside relations that must move | Pairs straddling R stay free |
| Component in state k | Conjunction of the component's literals | Literals | Trivially | Store literals, not k; components change |
| Which side faces the viewer | None (view transform) | — | — | Store constraints normal-relative; ranking evaluates both flips |
| Least white / fewest visible creases / closest to before | Pseudo-Boolean objective over top indicators | Exact per visibility block; MaxSAT beyond | n/a | Depends on renderer, pose and flip |
| Make crease e a mountain | Not layer order (crease-pattern edit); on a `U` crease, 1 literal | — | — | Reverse-fold direction is M/V, not order |
| Spread or rotate a flap; pose | Not layer order (3D pose) | — | — | 3D re-validation (§7) |

---

## What I could not verify

- **Bern & Hayes 1996**: read only through Akitaya et al. and ADK.
- **Ku–Terao–Terao 2024**: not found online.
- **#P-completeness for fixed assigned crease patterns**: not found.
- **Fetch-summary-only reads**: ORIPA's filter and rules, Rabbit Ear's solver
  and 3D constraints, and the FOLD spec. None of them was run.
- **The instagram table** was transcribed through fetch summaries; I
  spot-checked it and did not re-derive it.
- **Appearance factorisation, propagation completeness and the bring-to-front
  rates** are measured on four small fixtures only.
- **Oriedita's custom constraint going unchecked** when its accelerator engages
  is read from code (`SubFace.java:152-160,349-360`;
  `CombinationGenerator.java:38-75` gathers only 3EC and 4EC), not reproduced.
- **Lang & Demaine 2006** (*Facet Ordering and Crease Assignment in Uniaxial
  Bases*, Origami⁴, pp. 189–205) describe a facet-ordering algorithm for
  TreeMaker uniaxial bases. I read the introduction only, and the authors
  defer the proof.
- **The probe scripts** live in the session scratchpad, not the repository.
  They reproduce in about 100 lines each against `third_party/flat-folder/src`.
