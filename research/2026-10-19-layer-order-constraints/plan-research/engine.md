# Layer order dialog: the engine and the bridges

Plan research for the approved design (2026-10-20). This slice covers the Rust
crates and the two wasm bridges. It answers six questions: what the Fold
solver session gives the dialog today, how Edit's folds reach it, the Oriedita
"show this order" entry, the face bridge, the saved form, and the performance
facts that bound the design. Nothing here was built or run.

- **Base:** commit `eb4b51c54` (PR #476, `claude/fold-solver-perf`). It was
  read from the scratch snapshot of that commit. Every `path:line` below is at
  that commit, relative to the repo root.
- **Evidence labels:**
  - **Verified:** read in code at `eb4b51c54`.
  - **Documented:** a number or claim read from a plan or research doc, not
    re-run.
  - **Inferred:** reasoned from the code, not tested.
  - **Unknown:** not established.
- **The owner's latest note** ("add a constraint should clear the subject").
  It needs no engine change. Nothing below keeps the sentence: a commit takes
  the whole constraint list and returns a new state, and the sentence lives in
  TypeScript.

---

## 0. The recommendation in one page

1. **One new engine object for the dialog, the constraint session.** It goes
   in a new module of `oristudio-fold` and runs on `oristudio-fold-wasm` in a
   dedicated worker. It wraps the existing `CompletionSession`. It holds:
   - the committed constraints and the order on screen;
   - the deduced (forced) pairs;
   - a preview that is never committed by accident.

   On top of that it adds four things: open pairs, a minimal clashing set, a
   picture count, and save/restore. Today's `import_session` and
   `import_check` hang off Import CP's held imports and send counts, not data
   (§1.1). The dialog should not use them as they stand.
2. **Do not route Edit's folds through `ImportedPattern`.** Build the solver's
   folded view from **Oriedita's own wireframe, over the same segments Edit
   folded** (§2). That gives:
   - dialog face *k* = Oriedita face *k*, by construction;
   - no sheet-shape limit, no re-arrangement and no placement frame;
   - the letters straight from the line colours.

   `ImportedPattern` refuses non-rectangular sheets. It drops the letters from
   Edit's figure, and its faces are its own arrangement's (§2.1).
3. **Draw the dialog's panes from Oriedita's paper scene, with the dialog's
   order as its hierarchy.** This is a new public helper in `oristudio-cp`.
   The folded pane then looks exactly as the host draws it: its pass, colours
   and aux lines. Hit tests stay in TypeScript over that scene, as
   `fold-share.md` proposes.
4. **"Show this order" in `oristudio-cp` is a seeded variant of the shipped
   flat enumerator.** With no seeds the code path is today's, line for line.
   It is exposed as `folded_figure_show_order` on the kernel session and the
   CP wasm, with typed outcomes, and it rolls back on any failure (§3).
5. **Save** the chosen order in the existing `WitnessOrder` /
   `FoldCompletionChoice` shape, with points in the host crease pattern's
   coordinates. Save each constraint as a FOLD triple over paper faces. Each
   face also stores its paper **area**, so that a split or a merge after a
   crease edit is detected and never guessed (§4, §5).
6. **Performance bounds** (§6): the 850-face, 250-layer iguana opens in about
   1.5 s in wasm. A check takes a median of 0.66 s in wasm (2.3 s at worst).
   Its import peaked at 170 MB resident. Everything runs in a worker. The
   worker is terminated when the dialog closes, because a wasm heap never
   shrinks.

---

## 1. The Fold solver session, and what the dialog still needs from it

### 1.1 What exists (Verified)

**`treemaker_flatfold::CompletionSession`** is in
`crates/treemaker-flatfold/src/session.rs`.

- **The state** (`:84-102`):
  - the validated tables;
  - the propagation of the problem's fixed orders (letters), with parent
    pointers;
  - the independent components that are left;
  - a first order.
- **`open(problem, budget)`** (`:211-318`). It refuses a problem that breaks
  the bucket contract (`:225`). It returns
  `SessionStart::{Open, Conflict, UnsatisfiedComponent}` (`:74-80`).
- **Reads:**
  - `forced()`: the open-time forced pairs (`:325-331`);
  - `first()` (`:335-337`);
  - `components()` (`:341-343`);
  - `forced_by(variable)` (`:352-362`). It walks `self.base`, so it explains
    **open-time** forcing only (letters), not forcing by seeds.
- **`check(seeds, CheckOptions { budget { max_nodes, deadline }, fast_nodes, prefer })`**
  (`:366-652`). The options are at `:106-136`; `fast_nodes` defaults to 128
  (`:122`). It runs in five steps (module docs `:15-57`):
  1. A seed against an open-time forced pair is refused at once (`:410-425`).
  2. The other seeds are propagated from the open's state, with parents
     continuing the open's (`:427-447`).
  3. Only the components the seeds reached are searched (`:449-464`).
  4. Quick searches run, seeds' faces first, then the open's order, each with
     the preferred values and then upstream's (`:539-587`).
  5. Exactly Flat-Folder's split and search runs as a fallback (`:589-642`).
- **The outcomes of a check** (`:153-195`):
  - `Fits { order, forced, nodes, stage }`, where `forced` is what the letters
    **plus the seeds** force before any search (`:157-159`, filled at
    `:646-651`);
  - `Forced { variable, error_faces }`;
  - `Conflict(CompletionConflict)`;
  - `NoOrder { faces, error_faces, nodes, stage }`;
  - `Undecided { limit, nodes }`, which is never a verdict.
- **`prefer`** only reorders values. A steered search is always followed by
  the same unsteered search, so a preference never loses an answer
  (`:50-57`, `:545-559`). Components the seeds did not reach keep the
  preferred order without a search **only when it equals the open's first
  order** (`:500-537`).
- **The search is a loop, not recursion.** `constraints::search` keeps an
  explicit guess stack, takes a value-order closure and calls back on every
  solution, `found(&[u8])`
  (`crates/treemaker-flatfold/src/constraints.rs:1603-1678`).
- **`traced_faces`** walks parent pointers to every face a conflict traces back
  to. It marks every visited variable, including the roots (seeds and
  letters), but returns faces only (`constraints.rs:882-935`).

**`oristudio_fold::CompletionSession`** is in
`crates/oristudio-fold/src/complete.rs:969-1203`.

- It is the face-id wrapper. Its methods:
  - `open(view, problem, fixed, limits)` (`:988-1028`);
  - `forced_pairs()`, `forced(upper, lower)` and `forced_by(a, b)`, all
    open-time (`:1032-1061`);
  - `first_order()` (`:1065`);
  - `check(pairs, prefer, CheckLimits)` (`:1088-1202`).
- **`CheckLimits`** is `{ max_nodes, fast_nodes, deadline }` (`:887-907`).
- **The `Check` enum** (`:925-956`): `Fits { order, forced: Vec<[FaceId; 2]>, nodes, stage }`,
  `Forced { pair, traced }`, `Conflict { family, faces, traced }`,
  `NoOrder { faces, traced, nodes }`, `Undecided`.
- **Errors, not verdicts:** a non-overlapping pair is `FixedNotOverlapping`
  and a pair asked both ways is `FixedContradictory` (`:1106-1112`).
- An ambiguous overlap refuses the open (`:997-1001`).
- `Deadline` is a `fn() -> f64` clock plus `at_ms`, because wasm has no
  `Instant` (`:71-86`).

**The paths into a session:**

- `Unordered::session(fixed, limits)` (`crates/oristudio-fold/src/unordered.rs:261-267`);
- `ImportedPattern::session(limits)`, over the letters
  (`crates/oristudio-fold/src/import/mod.rs:605-609`);
- the letters as seeds: valley means the front-up face lies below, mountain
  above (`unordered.rs:216-241`).

**The wasm bridge** is `crates/oristudio-fold-wasm/src/io/bindings.rs:97-119`
and `io/imports.rs:244-343`.

- **`import_session(import, limits)`** returns `{ import, forced: count, nodes }`
  (`io/wire.rs:200-204`).
- **`import_check(import, pairs: [upper, lower][], { maxNodes, fastNodes })`**
  returns `Checked`. The variants are `fits { nodes, stage, changed: count, forced: count }`,
  `forced { pair, traced }`, `contradictory`, `conflict`, `no_order` and
  `undecided` (`wire.rs:209-240`).
- **Four limits for the dialog:**
  - **Every fit replaces the order shown** (`imports.rs:310`). A preview would
    therefore change the preferred order of later checks.
  - **The session hangs off an Import CP import.** That open already completed
    the whole problem at 1,000 orders per component (`imports.rs:118`). The
    dialog does not need that cost, and the import is rectangle-only (§2.1).
  - **There is no deadline on the wire.** `Limits::completion` and
    `CheckWireLimits::check` both set `deadline: None` (`wire.rs:139`,
    `:191`). The crate does have a wasm clock: `ops_crimp_tuck::clock::now_ms`,
    which reads `performance.now()` (`crates/oristudio-fold-wasm/src/ops_crimp_tuck.rs:74-97`).
  - **There is no web caller** (`bindings.rs:15-16`).

### 1.2 What the dialog needs, item by item

| Need | What exists | Gap | Where it belongs |
|---|---|---|---|
| **(a) Open faces of a subject:** overlapping faces whose pair deduction leaves open, given the user's constraints | Post-seed forced pairs exist only inside `Fits.forced` (`session.rs:646-651`; `complete.rs:928-933`). The wire reduces them to a count (`imports.rs:304-316`). `forced_by` is open-time only (`session.rs:352-362`). | (1) Keep the committed forced vector in the session, and export the **open pairs** (variables with no forced value). (2) Add a propagation-only query for removal, undo and clear, which need no search (§1.3). No post-seed `forced_by` is needed: the design has no "why is this inert" text. | Rust computes the pairs. TypeScript derives subject tint, partner lists, the "C · 3 faces to choose from" counts and object labels from one `Uint32Array` of pairs. |
| **(b) Check one candidate, returning the closest fitting order** | `check(committed ∪ {candidate}, prefer = shown)` does this (`complete.rs:1088-1202`). | (1) A **preview that does not commit**: today the shown order moves on every fit (`imports.rs:310`). (2) The **changed spots** per side, and the new stacks. (3) A deadline on the wire. (4) "Closest" is a warm-start heuristic, not a minimum (§1.4). | Rust |
| **(c) The smallest clashing set**, mapped back to constraints | Conflicts and no-order proofs name traced **faces** (`Check::{Forced, Conflict, NoOrder}`). | (1) Return the **root seed variables** in the trace, not only faces (a `traced_roots` sibling of `traced_faces`, `constraints.rs:882-935`). (2) A deletion filter over the constraints the trace names. | Rust (one call, with a deadline) |
| **(d) A background count of solutions** (distinct top-face pictures from a side), its layer-order count, a budget and cancellation | None in the session. `Completions` lists orders per component (`complete.rs:215-394`) and keeps every order as `Vec<Vec<bool>>`. The iguana at 1,000 orders of its 65,851-pair component would be about 66 MB (Inferred). | A streaming enumeration over the session that keeps only one representative per distinct picture. Group components into "look groups", count per group, and multiply. Picture *n* maps to an order (§1.5). | Rust enumerates and counts. TypeScript drives the slices with the existing `FoldSearch` runner (`apps/web/src/fold/engine/foldSearch.ts:1-26`). |
| **(e) Per-face paper polygons, folded polygons, cells with stacks** | For Fold states: `FoldScene`, a superset of the kernel's paper scene (`crates/oristudio-fold/src/scene.rs:1-56`). For Edit figures: `FoldedPaperScene`, whose `faces[].points` index `sheet_points` in crease-pattern coordinates (`crates/oristudio-cp/src/folding.rs:672-705`). | For the Oriedita-source route (§2.2): a public `oristudio-cp` helper that builds that same paper scene from the render inputs **with a given hierarchy**. Then per-order stack updates as typed arrays. | Rust builds the scene. TypeScript does the hit tests (`stackAt`, `faceAtSheetPoint`, per `design/fold-share.md` §4.2-A) and the painting. |

**Deduction is stronger than the prototype's (Inferred).** The engine's
propagation runs every constraint family plus transitivity
(`session.rs:15-48`). The prototype's `deducedOf` runs transitivity inside
cells only (`artifacts/layer-order-design/project/Round3.dc.html:707-735`). So
for the same state the product offers a **subset** of the prototype's open
faces. The faces it leaves out are truly forced, so nothing wrong is offered.

### 1.3 Proposed change: a constraint session

**New module:** `crates/oristudio-fold/src/steer/`. The name is a
placeholder; `layer_choice` would also do. It has these files:

- `mod.rs`: the constraint session;
- `source.rs`: §2.2;
- `explain.rs`;
- `pictures.rs`;
- `saved.rs`: §5.

**Additions to `treemaker-flatfold`**, all in `session.rs`. They are our code,
beside the port.

```rust
impl CompletionSession {
    /// Steps 1–2 of `check` only: the seeds' closure from the open's state,
    /// no search. Removal, undo and Clear all need nothing more, because the
    /// order on screen already satisfies every subset of the constraints.
    pub fn deduce(&self, seeds: &[(usize, PairOrder)], budget: SearchBudget)
        -> CompletionResult<Deduced>;            // Forced{..} | Conflict(..) | Ok { forced: Vec<Option<PairOrder>> }

    /// Every order of each component the seeds leave, streamed: `found(k, assignment)`
    /// per order, at most `per_component` each, within `budget`. The forced
    /// state and the components equal what `complete_layer_order` reaches
    /// from scratch with the same seeds (one closure, one split).
    pub fn enumerate(&self, seeds: &[(usize, PairOrder)], per_component: usize,
                     budget: SearchBudget, found: impl FnMut(usize, &[u8]))
        -> CompletionResult<Enumerated>;         // { forced, components, counts, truncated: Vec<bool>, nodes }
}
// Additive fields: the root seed variables a "no" traces back to
// (`traced_roots`, beside `traced_faces`):
//   CheckOutcome::Forced { roots }, CompletionConflict::roots, CheckNoOrder::roots.
```

**The constraint session in `oristudio-fold`:**

```rust
/// A constraint, in the source's frame: `subject_above` is "nearer the viewer
/// of the starting face's front" (§2.2). "In front of / behind" from the side
/// shown is converted in TypeScript.
pub struct Constraint { pub subject: FaceId, pub object: FaceId, pub subject_above: bool }

pub struct ConstraintSession {
    source: LayerSource,                       // faces, paper rings, letters, render inputs
    view: FoldedView, problem: Arc<ConstraintProblem>,
    solver: CompletionSession,                 // complete.rs, opened over the letter seeds
    committed: Committed,                      // { constraints, order: LayerOrder, forced }
}
impl ConstraintSession {
    pub fn open(source: LayerSource, limits: &CompletionLimits) -> Result<Self, SessionRefusal>;
    pub fn open_pairs(&self) -> Vec<[FaceId; 2]>;
    /// Never mutates: the candidate plus the committed constraints, preferring
    /// the committed order.
    pub fn preview(&self, candidate: Constraint, limits: &CheckLimits) -> Result<Preview, SessionRefusal>;
    /// The whole list after Add, Remove, Undo, Redo or Clear all. A list that
    /// only lost constraints keeps the order on screen and calls `deduce`;
    /// any other list calls `check` with the order on screen preferred.
    pub fn commit(&mut self, constraints: Vec<Constraint>, limits: &CheckLimits) -> Result<Committed, SessionRefusal>;
    pub fn explain(&self, candidate: Option<Constraint>, limits: &CheckLimits) -> Clash;
    pub fn stacks(&self, which: Shown) -> Stacks;  // per paper-scene subface, top first, per side
    pub fn saved(&self) -> SavedLayerOrder;        // §5
    pub fn oriedita_relations(&self) -> Vec<[u32; 2]>; // [upper, lower] for show_order, §3
}
pub enum Preview {
    Fits { order: LayerOrder, changed_front: Vec<u32>, changed_back: Vec<u32>, hidden_only: bool, stage: CheckStage },
    No { verdict: NoKind /* forced | conflict | no_order */, traced: Vec<FaceId> },  // Add disabled; explain() names the set
    Undecided { limit: BudgetLimit },                                               // "couldn't check in time"
}
pub struct Clash { pub constraints: Vec<usize>, pub minimal: bool, pub faces: Vec<FaceId> } // creases always take part
```

**The wasm calls**, in `crates/oristudio-fold-wasm/src/steer/`. They are held
by handle in a `LayerSessions` store, a sibling of `io::Imports`
(`crates/oristudio-fold-wasm/src/lib.rs:130-137`).

- `layer_open(source, limits)` returns `{ session, scene, openPairs: Uint32Array, nodes }`.
- `layer_preview(session, candidate, { maxNodes, fastNodes, deadlineMs })` and
  `layer_commit(session, constraints, limits)` return stacks and changed
  subfaces as `Uint32Array`s.
- `layer_explain(session, candidate, limits)`;
- `layer_count_*` (§1.5) and `layer_picture(session, side, n)`;
- `layer_scene(session, model)`, called on a Front/Back or style change;
- `layer_save(session)` and `layer_restore(source, saved, limits)` (§4.3);
- `layer_close(session)`.

A deadline is read through the existing `clock::now_ms`.

- **Size:** the flatfold additions are **S**. The session plus its bindings are
  **M**.
- **Risks:**
  - `Fits.forced` converts every forced pair to `[FaceId; 2]`, about 55,000
    on the iguana (45.5% of 120,825, `fold-solver-profile.md:94`). The session
    should keep the raw vector and convert lazily (Inferred cost, small).
  - A check clones about 4 MB of state on the iguana (Documented,
    `implementation-plans/fold-solver-performance.md:282`).
- **Tests:**
  1. A randomized test that `deduce` equals check's step 2. Reuse
     `checks_agree_with_completing_from_scratch` (`session.rs:858-940`).
  2. A test that `enumerate` equals `complete_layer_order` with the same seeds
     on the six in-crate problems plus kabuto: forced pairs, components and
     each component's orders, in order.
  3. A test that a list that only lost constraints keeps the order
     byte-identical.
  4. A test that a preview never changes `committed`.
  5. Native bridge tests in the shape of
     `crates/oristudio-fold-wasm/tests/import_session.rs`.

### 1.4 "Closest fitting order" is a heuristic (Documented, Inferred)

`prefer` makes the quick searches try the order on screen first
(`session.rs:50-57`). On cpoogle, chaining the previous fit cut the pairs that
change from a mean of 115 to 35. On the iguana it cut them from 20,640 to
7,156, with a median of 0 (`fold-solver-performance.md:192-196`).

It is not the minimum number of changed spots. A proven closest order is an
optimisation problem (max-agreement), and nothing like it is built.

- **When the shown order already fits** (the candidate agrees with it), a
  check returns it. Inferred: unit propagation from an assignment that the
  full shown order extends only derives values that agree with it. The quick
  search then takes the preferred value at every guess, if `fast_nodes`
  covers the guesses.
- **On a giant component** the quick attempts can run out of their 128 nodes
  and fall back to upstream's value order (`session.rs:561-587`). The order on
  screen can then change more than it needs to.
- **The proposed fast path:** before searching, test whether the shown order
  satisfies the candidate as it stands (one pair lookup). If it does, return
  it, with `deduce` for the forced pairs.

Whether "closest" must be exact is open question 3.

### 1.5 Counting pictures (proposed, M)

A **solution** is a distinct map from spots to their top face, from one side.
The prototype groups exact orders by that key (`Round3.dc.html:777-786`).

The engine does the same without listing every order:

1. **Enumerate** with `CompletionSession::enumerate(constraints, cap)`. The cap
   escalates across calls: 64, then 1,000, then 10,000 per component. Each
   call has a deadline. Only distinct projections are kept (step 4), never
   whole order lists.
2. **Open cells** are the solver's overlay cells (`Overlay::cells`,
   `crates/oristudio-layer-order/src/overlay.rs:57-77`) whose top, from a
   side, the forced pairs do not decide.
3. **Look groups.** Union-find over components: two components join when they
   both own unforced pairs among one open cell's faces. Groups are
   independent, so the picture count is the **product** of the groups'
   counts.
4. **Per group:**
   - project each member component's orders onto the pairs of the group's
     open cells, keeping one representative per distinct projection;
   - walk the product of the members' distinct projections;
   - key each combination by the tops of the group's open cells, for **both
     sides at once**. A cell's top is a tournament over its faces using a
     dense pair table (`OrderTable` style, `crates/oristudio-layer-order/src/order.rs:293-343`).
5. **The result:**
   `PictureCount { front: { n, exact }, back: { n, exact }, orders: ChoiceCount }`.
   The orders are the product of the per-component counts (`complete.rs:282-296`).
   A count is exact iff no component was truncated, no product was capped and
   nothing saturated.
6. **Stepping.** Picture *n* is a mixed-radix index over the groups' distinct
   keys. Its order is the members' representatives. Components outside every
   group keep the order on screen, which `choice_of` gives (`complete.rs:382-394`).
   `index_of(order)` puts the current picture first, so ‹ 1 of N › is what is
   on screen.

**Cancellation.** The count runs in the same worker as the checks, in calls of
about 100–500 ms, between which the `FoldSearch` runner lets queued messages
in (`foldSearch.ts:1-26`). A commit invalidates the job by generation.

**Measured cost of the biggest slice** (Documented): the iguana at 1,000
orders per component took 1,424 ms natively (`fold-solver-performance.md:139`)
and 2.29 s in wasm through `import_cp` (`:148-151`). So that one slice blocks
checks for about 2 s. The alternatives:

- a resumable cursor over the loop in `constraints::search`: move its locals
  into a struct. That is a port-internal refactor. It must keep node counts
  identical, which the existing differential harness
  `crates/oristudio-fold-wasm/examples/solver_differential.rs` proves.
- a second worker, at double the memory.

**Tests:**

- **On the fixtures, against the measured picture counts:** kabuto 9 front / 1
  back; `solution_sample_1` 1 / 16; Oriedita's `colorconstrainttest` 12 / 2.
  These come from engines.md §5, measured over Oriedita's subfaces. Compare
  them, and a brute force over `complete` with every order listed.
- A property test: the product rule equals the brute force on random small
  problems with several components sharing a cell.

---

## 2. Importing what Edit and the Diagram fold

### 2.1 What exists, and why it does not fit (Verified)

**How Edit folds:**

- `folded_figure_fold` folds every document segment.
  `folded_figure_fold_selected` folds only the **folding colours** among the
  selection (`crates/oristudio-cp/src/session.rs:955-992`, filter at
  `:1375-1393`, `is_folding_line` = `Black0 | Red1 | Blue2` at
  `crates/oristudio-cp/src/geometry/line_color.rs:75-77`).
- In both cases the aux (`Cyan3`) lines come from the whole document
  (`session.rs:986-990`). The session stores `segments` and `starting_face_id`
  verbatim (`crates/oristudio-cp/src/folding.rs:1426-1431`, `:1905-1922`).
- The Diagram folds the same way, by line ids (`apps/web/src/diagram/capture/captureFolded.ts:469-499`).
- **Unknown:** whether a whole-document fold lets non-folding colours into the
  graph. `FoldGraph::from_sheet_segments` takes the segments as given
  (`crates/oristudio-cp/src/fold_graph.rs:252-258`). The source export below
  ships `session.segments` verbatim, so both engines see the same input
  whatever the answer.

**What `ImportedPattern` does with Edit's patterns:**

- **The sheet must be a square or a rectangle.** A non-rectangular border is
  refused as `ShapeUnsupported` (`crates/oristudio-fold/src/import/placement.rs:94-101`).
- **Fold's `Sheet` is convex by design** (`crates/oristudio-fold/src/sheet.rs:1-7`).
- **Real fixtures hit this limit.** `iguana-split-crease.fold` was refused as
  `import_shape_unsupported` (Documented, `fold-solver-profile.md:98`).
- **The kinds:**
  - an unassigned line without a hint is **folded**, its letter decided by the
    completion (`import/mod.rs:8-12`, `:90-107`). The kernel map turns
    `LineColor::None` into exactly that, and `Cyan3` into a `CreaseMark` with a
    placeholder `Valley` (`crates/oristudio-fold-wasm/src/io/kernel.rs:92-112`).
  - Edit's rules differ: Edit never folds `None` lines.
- **Fold's "Start from Edit's folded figure" (`read_figure`) needs a solved
  figure.** `isFoldStartingFigure` requires `outcome === 'Solved'`
  (`apps/web/src/fold/io/foldEditFigure.ts:20-24`).
  - It imports every fold edge as `Unassigned { hint: None }`, so **the letters
    are dropped** and the order fixes them (`crates/oristudio-fold-wasm/src/io/figure.rs:81-86`).
  - It then demands a unique order (`import/mod.rs:692-711`).
- **The root** is the face at the bbox centre (`import/mod.rs:190-200`,
  `:738-759`), not Oriedita's starting face. So Fold's folded image can be
  turned relative to Edit's.
- **Fold builds its own faces** with its own arrangement. It refuses:
  - non-chord creases;
  - non-convex faces (`import/mod.rs:242-254`);
  - more than 4,096 faces (`crates/oristudio-layer-order/src/view.rs:30`);
  - more than 12M stacked triples (`crates/oristudio-layer-order/src/problem.rs:235`).

**Route I: extend `ImportedPattern`.** This is **L**. It needs:

- convex polygon sheets in `placement`;
- an identity placement frame;
- Edit's kind rules;
- letters carried from the source;
- a root at Oriedita's starting face;
- a witness-matched face bridge.

Non-convex sheets would still be refused, because Fold's states assume a
convex sheet. This route is right for Fold's own "Start from Edit's figure",
which must land a Fold *state*. The dialog does not need a state.

### 2.2 Recommended: the solver's folded view from Oriedita's wireframe (route II, M)

The layer-order crate only needs a `FoldedView`: convex face images, front-up
flags, and creases between faces with kinds. It needs no sheet, history or
isometry (`view.rs:1-9`, `:79-90`). Oriedita's wireframe has all of that:

- `FoldedRenderInputs::from_segments` (`folding.rs:2412-2445`, public) builds
  the fold graph, the folded wireframe and the subface arrangement;
- `FoldedWireframe` gives `points` (folded), `faces` (rings),
  `face_positions` (parity) and `lines` with colours (`folding.rs:60-82`);
- the flat graph's `points` are the crease-pattern coordinates, the same
  values the paper scene sends as `sheet_points` (`folding.rs:2924-2927`).

`oristudio-fold-wasm` already links `oristudio-cp`
(`crates/oristudio-fold-wasm/Cargo.toml`), so the dialog's worker can run
Oriedita's own code on the same segments.

**Proposed `LayerSource::from_oriedita(segments, starting_face_id, aux)`**, in
`steer/source.rs`, behind `oristudio-fold`'s `kernel` feature:

1. **Build the render inputs.** Add three additive public accessors on
   `FoldedRenderInputs`: `flat_points()`, `wireframe()` and
   `subface_face_ids()`. They avoid building the graph twice.
2. **Normalize the coordinates.** Map crease-pattern points to y-up units, with
   the paper's longer side 1, as `x' = (x − x0)/s` and `y' = −(y − y0)/s`. This
   keeps `TOL` = 1e-6 equal to Edit's line-identity tolerance, which is how it
   was derived: Oriedita's 2.5e-4 over its 400-unit side
   (`crates/oristudio-geometry/src/tol.rs:4-19`).
3. **Faces:** face *k* gets `FaceId(k)`. Its polygon is its ring through the
   **folded** points. `front_up` is set by Oriedita's parity:
   `position % 2 == 1` in the front pass, exactly what the drawer colours by
   (`folding.rs:3011-3018`). The starting face is therefore front-up, and the
   view's +z viewer is the front-pass viewer.
4. **Edges:** for each ring edge shared by two faces, the line colour sets the
   kind:
   - `Red1` is `Folded(Mountain)`;
   - `Blue2` is `Folded(Valley)`;
   - any non-black colour is `Flat`;
   - a `Black0` edge is paper boundary, which "constrains nothing" and is not
     an edge (`view.rs:79-86`).
5. **Letters:** the seeds come from the edges. Move `Unordered::letter_seeds`
   (`unordered.rs:216-241`) into a free function over a `FoldedView`, so that
   both callers share one rule.
6. **Build the problem:** `FoldedView::new` (`view.rs:109-160`), then
   `ConstraintProblem::build_within(&view, MAX_STACKED_TRIPLES)`
   (`problem.rs:429-439`). The face and stacking caps refuse here.
7. **Aux lines** (Edit's F lines): pass them to the paper-scene helper (§3.2).
   It already folds them face by face (`folding.rs:686-696`, `:2923`). They
   **never enter the problem**, as in Edit.
8. **Check the overlaps.** Every face pair sharing an Oriedita subface must be
   a variable of the problem (`ConstraintProblem::is_variable`,
   `problem.rs:695`). Otherwise refuse with `overlap_disagrees`. A Fold pair
   that Oriedita does not overlap is harmless for drawing, and is left out of
   the seeds of §3.

**What this route gives:**

- Faces identical to Edit's figure, the scene and `FoldContradiction`. All
  three index the same graph faces (`folding.rs:681`, `:1342-1350`).
- Any paper shape, any selection, and an unsolved figure: a `NoSolutions` or
  contradiction figure still has a wireframe.
- The letters straight from the source.

**What it still refuses:**

- **Non-convex faces.** `FoldedView::new` refuses them
  (`LayerOrderError::NonConvexFace`, `view.rs:139-141`). Oriedita faces are
  bounded by M, V and B lines only, so they are convex except at a reflex
  corner of the paper, or of a selection, with no crease into it (Inferred).
  - **v1:** refuse, naming the face.
  - **Later (M):** cut such a face into convex pieces along diagonals that
    become `Flat` edges. The layer-order model already treats flat edges as
    tortillas (`problem.rs:780`, `:844-865`). The pieces are then grouped back
    to one face for picking and labels, the "display layer" rule of
    `fold-share.md` §3.
- **An inconsistent wireframe**, such as same-parity adjacent faces. Edit
  cannot draw these anyway. The spec records Crane and Heart as failing in
  Oriedita with `SameParityAdjacentFaces`; why is not explained.
- **An ambiguous overlap** (`complete.rs:997-1001`). The rate on real Edit
  files is **Unknown**: the spec's "tolerances on real files untested".

**Kernel exports needed** (`crates/oristudio-cp/src/session.rs`, CP wasm):

- `folded_figure_source(handle)` returns
  `{ segments, starting_face_id, aux_segments }`. It reads the stored session,
  plus additive accessors `FoldingEstimateSession::segments()` and
  `starting_face_id()`.
- `fold_source_of_selection(document, selected_line_ids, starting_face_id)`
  serves "Fold with layer order…" before a figure exists. It reuses
  `selected_folding_segments` (`session.rs:1375-1393`).

Both are **S**.

**The frame.** The dialog's folded pane is drawn through the host's own
`FoldedFigureModel` (§3.2). Front and back match Edit's passes by
construction: the rear pass flips stacks (`folding.rs:674-676`, `:756-757`).

**Risks:**

- **The two wasm instances must number faces identically** (Inferred: the same
  crate and commit run on the same input). `FoldGraph` uses `HashMap`s, but
  only as keyed lookups (`fold_graph.rs:198`, `:548-619`); this was not proven
  order-free.
  - **The gate:** both kernels compute one shared digest of the face rings,
    for example an FNV over the rings' point coordinates. The dialog refuses
    on a mismatch. The PWA could serve one bridge stale; CI builds both from
    one tree.
- **Fold's import and this route can disagree** on patterns with unfolded
  creases. Fold splits faces at precreases and Oriedita does not.

**Tests:**

1. **A differential on square fixtures.** Use those without precreases:
   kabuto, `solution_sample_1`, `colorconstrainttest`, squash, triad, the
   iguana. Through `ImportedPattern` and through `LayerSource::from_oriedita`,
   compare forced pairs, component counts and orders, with faces matched by
   witness.
2. **A convention test.** Oriedita's own first order on each fixture, mapped
   with `LayerOrder::from_oriedita(rel, true)` (`order.rs:260-272`), passes
   `check_problem` on the new view (`crates/oristudio-layer-order/src/check.rs:122`).
3. **A corpus census:** refusal counts by code over cpoogle's 484 CPs (never
   committed). This is the Phase 0 gate for "tolerances on real files".

---

## 3. The Oriedita "show this order" entry (`crates/oristudio-cp`)

### 3.1 The seam (Verified)

**`overlap_enumerator_from_segments`** (`folding.rs:3247-3300`) builds the
flat path's enumerator:

1. `initial` from the letters (`:3263`);
2. `HierarchyTable::from_initial` (`:3278`);
3. the removeMode AEA closure (`:3283-3288`);
4. `WorkerOverlapEnumerator::from_subfaces` over the closed hierarchy
   (`:3290-3297`).

`from_initial` **silently drops** the second of two contradicting relations
(`let _ =`, `:5264-5266`). `validate_initial_hierarchy` exists for exactly
this case (`:5230-5254`).

**The public stages already reproduce the shipped search.** The only
difference is that relations can be appended (`close_initial_hierarchy`,
`:3302-3320`). The unit test
`the_public_stages_and_the_closure_rebuild_the_shipped_search` holds the
assembled enumerator to the shipped one's first order (`:6141-6177`). A seed
against a derived pair passes validation but fails the closure (`:6181-6203`).
This is the step the spec's §13 says the spike skipped. It is in the stages
now.

**The oracle-tests harness already seeds a whole order** and classifies the
answer:

- `Verified`, `Unrepresentable`, `Contradiction`, `NotFound`,
  `Disagrees { reversed, open }` and `Failed`
  (`crates/oracle-tests/tests/fold_support/oriedita.rs:57-74`, `:197-250`);
- an iteration budget of 100,000 (`:55`), through
  `WorkerOverlapEnumerator::within_iteration_budget`
  (`crates/oristudio-cp/src/folding/permutation.rs:619-623`).

**The render reads one source of truth.** `estimate.overlap.hierarchy` when
found, otherwise it **searches again unseeded**: `HierarchySource::Search`
(`folding.rs:2448-2481`, `:2804-2825`). The paper scene answers `None` without
a solved order (`:2841-2886`).

**The drawer places a face** by counting how many faces of the subface it lies
above (`subface_top_stack`, `:4750-4770`). A pair missing from a subface drops
faces from the stack.

**Cancellation.** The session is transactional: a cancel rolls the estimate
and the worker back (`:1959-1984`).

### 3.2 Proposed change (additive, M)

```rust
// folding.rs — Ori Studio native
pub struct FoldingEstimateSession { …, seeds: Vec<HierarchyRelation> }   // empty = upstream
fn overlap_enumerator_from_segments_seeded(segments, start, seeds: &[HierarchyRelation])
    -> Result<Option<WorkerOverlapEnumerator>, WorkerOverlapSearchError>;
    // seeds.is_empty(): exactly today's body (the old fn becomes a call with &[]).
    // else: initial.relations.extend(seeds); validate_initial_hierarchy(&initial)?;
    //       then the same from_initial → AEA removeMode → from_subfaces, with
    //       within_iteration_budget(SHOW_ORDER_BUDGET).
impl FoldingEstimateSession {
    pub fn segments(&self) -> &[LineSegment];
    pub fn starting_face_id(&self) -> i32;
    /// Re-fold with `relations` seeded, in a scratch copy; swap on success, so
    /// any failure leaves the figure exactly as it was (never a contradiction
    /// picture for a bad seed).
    pub fn show_order(&mut self, relations: Vec<HierarchyRelation>) -> Result<FoldingEstimate, ShowOrderRefusal>;
    pub fn clear_order(&mut self) -> Result<FoldingEstimate, FoldingEstimateError>; // = restart() unseeded
}
pub enum ShowOrderRefusal { AgainstLetters{upper,lower}, InClosure{upper,lower}, NotFound, Disagrees{reversed, open}, Budget, Cancelled }
/// The paper scene of `inputs` drawn with a given hierarchy: what the dialog
/// panes and the seeded figure both draw.
pub fn folded_paper_scene_with_order(inputs: &FoldedRenderInputs, order: &InitialHierarchy,
                                     aux: &[LineSegment], model: &FoldedFigureModel)
    -> Result<Option<FoldedPaperScene>, FoldingEstimateError>;   // wraps paper_scene_impl (:2892) with HierarchySource::Solved
```

**Other changes:**

- **The render's fallback.** `HierarchySource::Search` carries the session's
  seeds, so a render fallback never shows the default order on a seeded
  figure (`:2453-2456`).
- **The restart.** `restart_inner` (`:2118-2150`) uses `self.seeds`, so a wrap
  through `fold_another` stays on the given order.
- **Exposure:**
  - `Engine::folded_figure_show_order(handle, relations: &[[u32; 2]])` and
    `folded_figure_clear_order(handle)`, beside `folded_figure_fold_another`
    (`crates/oristudio-cp/src/session.rs:1139-1146`);
  - CP wasm `folded_figure_show_order(handle, relations, run_id)` through
    `with_fold` (`crates/oristudio-cp-wasm/src/lib.rs:411-415`).
- **The snapshot** gains `#[serde(default)] shown_order: "searched" | "given"`,
  beside `outcome` (`folding.rs:364-390`).

**The frame and sign:**

- Oriedita's `upper_face` is nearer a viewer of the **starting face's front**.
  This is calibrated on 1,685 states (`crates/oristudio-layer-order/src/order.rs:16-20`;
  oracle doc `fold_support/oriedita.rs:28-33`).
- With the source of §2.2 the starting face is front-up, so Oriedita's upper is
  the dialog's above. `oriedita_relations()` is `LayerOrder::to_oriedita(true)`
  (`order.rs:240-256`), with face ids as Oriedita indices.
- Seed only pairs that share an Oriedita subface, which are the pairs the
  drawer and the AEA read. This avoids spurious AEA contradictions from extra
  pairs (Inferred).

**"Another solution" on a seeded figure.** A whole order seeded leaves one
permutation, so "Another solution" becomes a no-op (Inferred from
`run_folding_estimated_05`, `:2153-2186`, and `fold_another`, `:2197-2206`).
Under decision 4 the host routes it to the constraint session's picture
stepper for constrained figures, then calls `show_order`.

**When Oriedita cannot reproduce the order:**

- The kernel returns the typed refusal and the figure keeps its picture.
- The dialog checks first, on Apply, against a duplicate handle
  (`folded_figure_duplicate`, `session.rs:1129-1137`). Apply then fails inside
  the dialog with a blocking message, never after it closes.
- **The fallback is the owner's decision** (open question 4): draw the given
  order directly through `HierarchySource::Solved`. That is exact only when
  the order covers **every pair of every Oriedita subface**, which is a
  deterministic coverage check (`subface_top_stack`, `:4750-4770`).

**The size:** M. The seeding and the wasm entry are S. Transactions, the
scene helper and the refusals are the rest.

**Risks:**

- Oriedita's search with a whole order seeded is untested on real Edit files.
  The spike's 1,685 of 1,685 were Fold-generated states (spec §13).
- `show_order` on large figures re-folds: the iguana's first solution took
  0.51 s (Documented, engines.md §5).

### 3.3 The gates

**No constraints, no change:**

- `crates/oristudio-cp/tests/oriedita_folding_oracle.rs` (29 tests, from
  `wireframe_folding_matches_oriedita_oracle` at `:21` to
  `subface_swapper_matches_oriedita_oracle` at `:1258`);
- `tests/oriedita_render_oracle.rs` and `tests/folding.rs`;
- a new property test: on every flat fixture,
  `overlap_enumerator_from_segments_seeded(.., &[])` gives the same case
  sequence as the unseeded enumerator through Order 6.

**Fidelity:** a new
`crates/oracle-tests/tests/layer_order_show_oracle.rs` (name proposed). On
every fixture, and on cpoogle as an ignored campaign, it reuses the `Seeded`
verify (`fold_support/oriedita.rs:197-250`):

- every order the constraint session returns (first, plus sampled pictures),
  seeded through `show_order`, reaches `shown_order: given`;
- its paper-scene tops equal the session's stacks.

The target is 0 failures on the fixtures. Report the rate on cpoogle.

**3D is out of scope (Verified).** `Fold3dSession` is a separate path
(`session.rs:1173-1260`). Its seeds would enter as one more `Fold3dSeed` kind
(engines.md §2). Nothing proposed here touches it. The dialog's entry is
disabled for 3D figures, with the reason.

---

## 4. The face bridge

### 4.1 What exists (Verified)

- **`ImportedPattern::oriedita_seeds(start, relations)`** maps Oriedita
  relations onto Fold faces by **interior points**. It uses
  `LayerOrder::from_oriedita(.., start_front_up)` (`import/mod.rs:629-686`).
  `from_oriedita` demands a unique completion (`:692-711`).
- **The oracle's `Seeded`** maps each Fold face to the Oriedita face that
  contains its centroid. It uses an even-odd point-in-polygon test, because
  Oriedita faces "need not be convex" (`fold_support/oriedita.rs:105-142`,
  `:264-279`). Two Fold pairs that land on one Oriedita pair and disagree are
  `Unrepresentable` (`:171-195`).
- **`Unordered::face_at(p)`** finds the face whose convex sheet polygon holds
  `p` by more than `TOL`; it answers none on a crease (`unordered.rs:186-193`).
  `face_witness` is the centroid (`:198-201`).
- **`WitnessOrder::resolve`** maps witnesses to faces. It breaks on
  `NoFace`, `SharedFace` (a merge), `UnknownWitness`, `SelfPair` and
  `InvalidSign` (`crates/oristudio-fold/src/witness.rs:47-62`, `:150-195`).
  **It cannot see a split**: a point in a face split by a new crease still
  lands in one piece.
- **`apps/web/src/fold/io/foldEditFigure.ts`** only selects flat, solved
  figures (`:20-24`) and reads their paper scene.

### 4.2 Proposed

**Between the engines: identity.** With route II, dialog face *k* is Oriedita
face *k* (§2.2). That is checked at open by the ring digest. The only mapping
left is pieces to faces, if convexification lands later.

**Paper point to face:** `LayerSource::face_at_paper(p)` (S).

- It runs even-odd over the **flat** rings in crease-pattern coordinates.
- It requires a unique hit, and a hit more than `TOL × s` away from every
  edge. Otherwise the point is on a crease.
- The same function serves restore and, later, any kernel-side fast path.

**After a crease edit:** every saved face carries `{ at, area }` in paper
coordinates (§5). Each saved constraint then resolves to one status:

| Status | When |
|---|---|
| **intact** | The point is in exactly one face, and its area matches within 1e-6 relative. |
| **ambiguous** | One face, but its area shrank (the face was split) or grew (merged with a neighbour). The constraint is not applied, and it is shown as needing attention. Never guessed. |
| **gone** | The point is off the paper or on a crease; or subject and object now resolve to one face; or they no longer overlap (`is_variable` false, `problem.rs:695`). |
| **clashing** | Every intact constraint is applied in saved order. One whose check fails is skipped and flagged. This is deterministic and drops nothing silently (spec §8.2). |

**The restore** (M):

1. Open the session over the new source.
2. Resolve the faces.
3. Apply the intact constraints greedily, in order.
4. Show the order closest to the saved one: `check` with `prefer` set to the
   saved `WitnessOrder`, resolved pair by pair, leaving out unresolved pairs.
5. Return statuses, the order and `oriedita_relations()`.

The host runs it after a refold, a reopen or a Diagram Refresh, then calls
`show_order`.

**The Fold workspace, later:** `LayerSource::from_state(&State)` uses Fold's
own faces (`State::folded_view`, `problem`). The Fold-to-Oriedita bridge is
needed only if a Fold order must be drawn in Edit, and the oracle's centroid
mapping is that bridge.

**Tests:**

- unit tests per status on synthetic splits and merges of kabuto: add a crease
  inside a face, remove one;
- a round trip: save, reopen and restore gives the same order and every
  constraint intact.

---

## 5. Persistence types

### 5.1 What exists (Verified)

- **`WitnessOrder`** is `{ faces: Vec<[f64; 2]>, orders: Vec<(u32, u32, i8)> }`
  (`witness.rs:33-42`). Each pair is a FOLD `faceOrders` triple: s = +1 iff f
  lies on g's front side. That reads the same from either root orientation
  (`witness.rs:11-15`, `order.rs:15`).
- **The JSON** is `{"faces":[[x,y]],"orders":[[f,g,s]]}` (`witness.rs:248-253`).
  It is the web's `FoldCompletionChoice`
  (`apps/web/src/fold/document/foldSequenceDocument.ts:745-748`), which Import
  CP stores as `orderJson`.
- **The validation errors** are `BrokenWitness` (`witness.rs:47-62`) and
  `Broken::{Completion, NotUnique, Gate, …}` (`:67-88`).
- `Unordered::replay` demands **exactly one** order (`unordered.rs:297-330`),
  through a full `complete`. That is the wrong semantics for the dialog, whose
  saved order is a preference.

### 5.2 Proposed

**The saved form.** TypeScript owns the document field; Rust validates it on
`layer_restore`.

```ts
interface SavedLayerOrder {
  /** Faces on the paper, in the host crease pattern's coordinates (Edit's model space). */
  faces: { at: [number, number]; area: number }[];
  /** One per constraint, in the order made: [subject, object, s], FOLD's rule — s = +1 iff
   *  the subject lies on the object's front side. Read back as "in front of / behind" per side. */
  constraints: [number, number, 1 | -1][];
  /** The order on screen at Apply: the WitnessOrder / FoldCompletionChoice shape, same frame. */
  chosen: { faces: [number, number][]; orders: [number, number, 1 | -1][] };
}
```

**The reuse decision: reuse the shape, not the replay.**

- `chosen` is literally `WitnessOrder`. Rust deserializes it into that type and
  resolves it with `resolve`, which gives the sign checks.
- `constraints` reuses the triple, but keeps the **subject first**. The list
  reads back the sentence that made it, which the prototype also keeps
  (`Round3.dc.html:761-767`).
- Faces add `area` for split detection (§4.2).
- The point frame differs from Fold's: host crease-pattern coordinates, not the
  unit sheet frame. Document that on the type.

**Where Rust validates:** `steer/saved.rs`.

- serde into `SavedLayerOrder`;
- finite points, areas above 0, indices in range, signs ±1, no self pairs;
- these map onto `BrokenWitness` variants plus the §4.2 statuses.

The result is a typed report, never a panic or a silent drop. The size is
**S**.

**Size on disk** (Inferred): a full order of the iguana is 120,825 triples,
about 1.5–2 MB of JSON per figure or step.

- **The alternative (S–M):** store a **determining subset**. Seed the order's
  pairs one at a time, in variable order, and keep only those that propagation
  does not already imply. Letters, constraints and that subset then propagate
  to exactly the chosen order, which can be checked at save time.
- **Its catch:** it depends on the solver's propagation. A future change to it
  would turn a determining subset into a mere preference. That is safe, but no
  longer exact.
- This is open question 1.

**Tests:**

- serde round trips;
- every `BrokenWitness` path;
- the determining subset reproduces the order on every fixture, if adopted.

---

## 6. Performance facts that bound the design

**The timings** (Documented, `implementation-plans/fold-solver-performance.md`
at `eb4b51c54`, Apple M1 Max, a shared machine):

| Quantity | Native | wasm (Node) | Source |
|---|---|---|---|
| Iguana session open: propagation, components, first order | 1.08 s | 1.53 s | `:176-187` |
| Iguana check that fits | median 0.45 s; max 1.5 s preferred, 3.1 s cold | median 0.66 s, max 2.3 s | `:180-187` |
| Iguana search-level "no order" proof | 0.67–0.70 s | – | `:182` |
| Seed against a forced pair | 0–6 ms | – | `:183` |
| Iguana count, 1,000 orders per component | 1,424 ms | 2.29 s (whole `import_cp`) | `:139`, `:148-151` |
| cpoogle session open, median / p95 | 12 ms / 1.14 s | – | `:188-190` |
| cpoogle cold answer, median / p95 | 0.08 ms / 5.7 ms | – | `:188-190` |
| Slowest admitted open (lucanus-bright, through `import_cp`, with the count) | – | 5.5–5.6 s | `:216`, `:228-229` |
| Iguana node cost on 250-layer stacks | 10–40 ms a node | – | `:198-202` |

**Memory** (Documented):

- **The iguana:**
  - tables of 4.3 MB; dense tables up to 25 MB at 2,048 faces
    (`fold-solver-performance.md:27-33`);
  - a check clones about 4 MB (`:282`);
  - an import peaked at 170 MB resident, and the probe's session at 311 MB
    with copies (`fold-solver-profile.md:108-109`, `:362-364`).
- **The caps:**
  - 4,096 faces: 122 MB at that size, 4 GB traps the worker
    (`crates/oristudio-layer-order/src/view.rs:20-30`);
  - 12M stacked triples (`problem.rs:235`). 463 of 471 importable cpoogle
    designs are admitted (`fold-solver-performance.md:226-227`).

**What the numbers mean for the design (Inferred):**

- **The targets.** "Each choice checked within about 200 ms" holds on every
  cpoogle design except the deepest stacks. On the iguana, previews and Add
  take 0.5–2.3 s, so "couldn't check in time" needs a real deadline. Suggested:
  3 s for a preview, longer for Add.
- **The open.** The iguana takes about 1.5 s for the solver plus Oriedita's
  arrangement for the render inputs. Oriedita's whole first fold of it took
  0.51 s (engines.md §5). The dialog shows a working state and can be
  cancelled; cancelling drops the worker.
- **What runs in a worker:** everything in fold-wasm, in a dedicated
  `layerOrderWorker.ts` instance of the same wasm.
  - It is separate from `foldSequenceWorker.ts`, so a 1.5 s open never queues
    behind or in front of the Fold workspace.
  - It is terminated when the dialog closes, which is the only way to return
    a grown wasm heap (`view.rs:20-28`).
  - The count shares that worker, in sliced calls (§1.5).
  - `show_order` runs in the existing `oristudioCpWorker.ts`.
- **Explaining a clash** costs up to k checks. On the iguana that is roughly
  0.7 s each. Show "can't fit" at once, then refine it to the named set.

---

## Open questions for the owner

1. **The chosen order on disk:** every pair, which is simple and can be about
   2 MB for the largest model, or a determining subset, which is compact but
   depends on propagation (§5.2)?
2. **The count:** blocking slices in one worker, about 2 s on the iguana at
   1,000 orders, or a resumable search cursor inside the Flat-Folder port's
   loop (§1.5)? A second worker would double memory.
3. **"Closest fitting order":** is the warm start's "near, usually unchanged"
   enough (§1.4), or must the preview be provably the fewest changed spots?
   The second is an optimisation problem with no solver today.
4. **When Oriedita cannot reproduce a chosen order** in Edit: refuse Apply
   with a message (recommended for v1), or draw the order directly whenever it
   covers every Oriedita subface pair (§3.2)?
5. **Non-convex faces**, at a reflex paper corner or a selection with no
   crease into the corner: refuse in v1, or convexify into flat-joined pieces
   before the first release (§2.2)?
6. **Bundle and worker:** reuse the whole `oristudio-fold-wasm` for the dialog
   (assumed), or build a smaller dialog-only wasm? The dialog needs
   `oristudio-cp`, `oristudio-layer-order`, `treemaker-flatfold` and part of
   `oristudio-fold`.
7. **Fold's "Start from Edit's folded figure"** keeps `ImportedPattern` and
   its rectangle limit (§2.1). Should it later move onto `LayerSource`, so
   both share one Edit import?

## Suggested PR split for this slice

All PRs stack on PR #476 (`eb4b51c54`).

| PR | Contents | Size | Depends on | Gates |
|---|---|---|---|---|
| **E1. Kernel: source and show order** (`oristudio-cp`, `oristudio-cp-wasm`) | `folded_figure_source` and `fold_source_of_selection`; the `FoldedRenderInputs` accessors; `folded_paper_scene_with_order`; the seeded enumerator, `show_order` and `clear_order` with typed refusals and rollback; the `shown_order` snapshot field; PORTING.md entries ("Ori Studio native, additive") | M | – | The Oriedita folding oracle (29), the render oracle and `tests/folding.rs` unchanged; the empty-seeds identity property; seeded reproduction on fixtures |
| **E2. Solver additions** (`treemaker-flatfold`) | `deduce`, `enumerate`, `traced_roots` and the `roots` fields; the optional search cursor if question 2 picks it | S (M with the cursor) | – | The in-crate randomized test, extended; the differential harness at 0 differences; the Flat-Folder oracle and corpus |
| **E3. Constraint session** (`oristudio-fold`, `steer/`) | `LayerSource::from_oriedita` (kernel feature); the open, preview, commit, explain and restore session; the saved form and statuses; pictures | L, which could split into E3a (source, session, saved form) and E3b (explain, pictures) | E1 (scene helper, accessors), E2 | The square-fixture differential against `ImportedPattern`; the convention test; picture counts on kabuto, `solution_sample_1` and `colorconstrainttest`; status unit tests |
| **E4. Bridge** (`oristudio-fold-wasm`) | The `LayerSessions` store; the `layer_*` bindings with typed arrays and deadlines; native tests like `tests/import_session.rs`; a Node wasm test | M | E3 | Bridge tests; the face-ring digest shared with E1 |
| **E5. Phase 0 measurement** (no product code) | An `examples/` harness over the fixtures and cpoogle (never committed): source refusals by code, open and check timings in wasm, `show_order` reproduction rate, picture counts and memory | S | E1–E4 | The report feeds the spec's Phase 0 "done when" |
