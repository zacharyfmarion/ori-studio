# Complete the five origami trials in the Fold workspace

## Goal

**Scope update (2026-10-13, owner instruction): keep Fold entirely flat/2D.**
The active implementation is A–D plus the flat portions of H. Sections 5–6,
spatial work in section 7, and phases E–G are deferred, not acceptance gates for
this change. Masu box stops at its complete flat preparation; crane stops at its
flat finished form. No spatial states, angle folds, 3D controls, or spatial schema
changes will be added. Preserve the deferred design below as future research.

**Implementation baseline:** merged source `aa736f95d` into
`codex/fold-origami-trials` and rebuilt the matching Fold WASM bridge.

Make it possible to author, save, reopen, inspect, and continue all five
Origami.me designs in **Fold**: cicada, swan, heart, masu box, and crane. The
finished models must match the intended paper construction and layer order,
not merely have a recognizable outline or return an engine success code.

This plan was requested on 2026-10-13. The flat-only implementation is complete;
the spatial sections below remain deferred research. The initial trials and reproduction inputs are in
[the research report](../research/2026-10-13-origami-fold-trials/REPORT.md).

Completion means:

- Cicada: all seven tutorial stages, including the separate head layers and
  side folds behind the wings.
- Swan: the intended outward neck construction and head orientation, with the
  correct layers wrapping around or remaining outside the body. The former
  inside-reverse neck is retained as a comparison case, **not an accepted completion**.
- Heart: release the side pockets while lowering the upper flap, finish the
  corner folds, and turn the model over to its completed heart outline.
- Masu box: complete flat preparation through tutorial stage 6. Upright walls,
  corner collapse and securing flaps are deferred by the owner.
- Crane: the intended neck, tail and head construction with both wings folded
  down flat. Opening the wings is deferred by the owner.
- Every model is an editable native `.osf` sequence, uses the same operations
  and choices exposed by the UI, and opens directly in Fold on browser and
  desktop. Exporting pictures into Edit is not a substitute.

The required target is the core tutorial's finished design. Optional swan
sculpting, rounded paper shaping, box lids, and shallow-lid variants are not
required. The crane tutorial ends by opening its wings; the earlier report's
suggestion that body inflation was necessarily required was too broad. Include
body articulation only where it is geometrically necessary to open those wings.
No diagram authoring is included.

## Approach

### 1. Baseline, evidence, and corrected gap inventory

The trials were built on source commit `ad3b1265b`, with research/handoff changes
through `25808cab4` on `codex/fold-origami-trials`. During this planning pass the
source worktree was at `aa736f95d`; its intervening changes include folded-edge
swivel picking, a shared tool-flow test harness, and top-flap defaults. Before
implementation, integrate the then-current Fold source through the normal Git
workflow, preserve the trial files, rebuild the bridge, and reproduce each
finding. Do not implement a UI fix already present there.

The source tutorials, checked on 2026-10-13, are
[cicada](https://origami.me/cicada/), [swan](https://origami.me/swan/),
[heart](https://origami.me/heart/), [box](https://origami.me/box/), and
[crane](https://origami.me/crane/). Use the body of each tutorial rather than its
sometimes inconsistent headline step count. The swan page describes lifting and
flattening the neck/head; the user's correction identifies the desired outward
neck result. Establish the intended layer arrangement from the reference and a
paper-fold check before choosing a kernel primitive.

| Area | Evidence at planning time (superseded by findings below) | Classification and required response |
| --- | --- | --- |
| Outside reverse fold | Rust has `ReverseKind::Outside`; the document has `outside-reverse`; the tool builder emits it; the UI exposes Inside/Outside when both are feasible. The existing outside-reverse tool test passes. | **Exists.** Correct the swan construction and improve discovery/explicit intent; do not build a second outside-reverse engine. |
| Swan neck | `models/swan.osf` node 9 is `inside-reverse`; node 10 is already `outside-reverse` for the head. Replaying the same node-9 line, seed, and opening with Outside returns `reverse_kind_infeasible`, with faces `[16, 21, 29]` and an Inside suggestion. | **Reference mismatch, cause unresolved.** The preparation, opening, moving layers, or supported reverse configuration must change. A kind-string replacement is insufficient. Face IDs describe this reproduction only. |
| Tutorial-order swan/crane lift | Saved `compound-probes.json` records `swivel_fold_wide` and `fan_ray_blocked`; several kind/direction variants were tried. | **Reproducible restrictions, not yet proven engine defects.** Confirm the intended hinge/edge and derive the needed fold before extending the primitive. |
| Heart pocket release | Verified through source step 7. The extra one-layer valley in the exploratory file lands but changes the wrong paper. | **Unresolved compound construction.** Test existing squash/flap selection first; add a coupled pocket operation only if that cannot represent the intended endpoint. |
| Box assembly | Verified flat preparation through source step 6. Steps 7–10 require walls out of the plane, corner collapse, and securing flaps. | **Confirmed missing persistent nonflat states and operations on them.** An angle slider alone is insufficient. |
| Crane finish | Reverse-fold alternative reaches a flat crane; final wing folds are flat. | **Confirmed missing saved nonflat wing/body articulation**, plus tutorial-order swivel coverage. |
| Cicada | Existing operations reach the final flat model. | **Regression and reference audit.** No additional primitive demonstrated necessary. |
| Native handoff | Individual `.osf` files already open automatically in Fold; `.fold` interchange files open as Edit content. Exports have been separated. | **Existing capability.** Keep the native workflow as an acceptance gate, not an invented missing feature. |

The initial audit also ran
`apps/web/src/fold/tools/reverse/reverseStep.wasm.test.ts`: all three tests passed,
including the case that can only land Outside. This establishes implementation
coverage, not that the current swan is correct.


### Implementation findings (flat scope)

- The corrected swan uses existing Outside reverses with a descending neck
  crease and the balanced central-spine opening. Its former ascending line was
  an input mismatch; no reverse-kernel relaxation is needed. Both operations are
  reachable through the tool builder and reproduce the API states.
- Heart squash/plain-fold attempts changed the wrong paper. The smallest useful
  extension is **multiple stationary tuck targets**, not a new pocket macro.
  Closure is bounded by every target, retains adjacency refusal, requires overlap
  with every target, and intersects the existing strict placement constraints
  before normal completion/admission. No arbitrary fixed-face exception is used.
  The two side triangles retain face identity and isometry; only the four central
  faces split. The final corner/lobe folds and turnover now complete the heart.
- The 12 old bird swivel probes reproduce their geometric refusals on the merged
  source. These inputs do not prove a valid missing swivel configuration. Existing
  reverse folds reach the required flat endpoints; guards and algorithms remain
  unchanged. The fixtures retain the probes as negatives.
- Reverse discovery now names both kinds. Explicit intent stays selected through
  refusals; Automatic keeps the only-feasible behavior. A lazy mixed-radix chooser
  exposes all returned opening combinations, with bounded memory, safe integer
  wraparound and explicit scan truncation.
- `additionalTargets` is optional in a native tuck step; old steps remain valid.
  It is limited to 64 additional finite witnesses at the wire/file boundary.
  Unknown/malformed constraints lock and preserve the step. No native version
  change or spatial data is introduced. Existing committed-op analytics covers
  the tuck/reverse actions, with a bucketed tuck target count to distinguish
  multi-target adoption. All new control text is translated.

### 2. Establish reference cases before changing algorithms

Promote the relevant trial prefixes into a small attributed test corpus under a
proposed `tests/fixtures/fold-design-completion/` directory. Preserve the original
experiments in research; do not overwrite their evidence.

For each required operation, record:

1. Source URL and tutorial stage, parent `.osf` path, and stable node ID.
2. Paper front/back convention, camera orientation, and adjustable proportions.
   A different paper color or reflected camera is not evidence of a different
   physical layer order.
3. Selected flap, hinge/spine, stationary paper, and target using original-sheet
   anchors and existing witness formats. Store choices, not list indices or
   transient face IDs.
4. Expected geometry **and** material relationships: which layers wrap outside,
   which pockets remain open, which paper must remain uncreased, and which
   contacts are intended.
5. A positive outcome and a nearby negative case. Retain accepted-but-wrong
   heart geometry as a semantic negative, and the inside swan neck as a
   distinguishable comparison.

Use analytic measurements and explicit witness relations for assertions.
Screenshots supplement those assertions; neither pixel resemblance nor an engine
fingerprint generated from the current wrong result is a correctness oracle.
Do not copy tutorial diagram assets into the repository without suitable rights.

Classify every failure as input/selection, unavailable choice, unsupported valid
geometry, genuinely infeasible geometry, or numerical failure. An unsupported
valid case needs a derivation and a fixture before an algorithm change.

### 3. Make the intended reverse fold reachable and correct

**Reuse:** `compound/reverse.rs`, `ops_reverse.rs`, `reverseStep.ts`,
`useFoldReverseStep.ts`, and `reverseToolWindow.ts`.

First reconstruct the swan's reference preparation, including the existing
neck/head creases, body half-fold orientation, and pocket opening. Enumerate
admissible openings and validate the intended outside wrap. Test both the
original tutorial-order lift and a mathematically equivalent outside-reverse
sequence; an alternative is accepted only if its resulting material/layer
relationships match, not because its silhouette looks similar.

If the current reverse representation supports the case, fix the fixture and
selection workflow. If not, reduce the unsupported configuration and extend tip
closure/opening discovery or the compound composition with a documented
construction. Preserve the constraints that prevent the tip going through its
own body. Never turn `reverse_kind_infeasible` into unconditional success.

For the UI:

- Use a neutral **Reverse fold** entry point whose tooltip and command discovery
  mention both Inside and Outside. Keep persisted shortcut identifiers compatible.
- Offer an explicit Outside reverse command/preference through the same tool
  state and builder. Distinguish **automatic selection** from **explicit intent**.
- In automatic mode, retaining the existing “only feasible kind” selection is
  appropriate. If the user explicitly asks for Outside and it cannot land, show
  the refusal and offer alternatives; do not silently commit Inside.
- Preserve the existing design choice that a redundant kind selector is hidden
  when only one kind is available. The window title/status must still name the
  actual kind and explain why the requested kind cannot be used.
- Show the selected opening's spine and participating layers. The engine can
  report up to 64 openings per flap, whereas `reverseOpenWays` currently caps the
  UI's combined choices at 16. Audit reachability; use per-flap selection or a
  bounded paged chooser with explicit truncation rather than claiming an
  unlisted opening is infeasible. Do not merely raise the Cartesian-product cap.

**Gate:** the reference-correct swan neck and head can be selected and committed
through the real tool builder, replay with their intended kinds and witness
relations, and remain correct after turn-over and native save/open. Preserve
inside-only, outside-only, both-feasible, no-feasible-kind, and multiple-opening
regressions. Verify correct motion cues for Outside; do not reuse an Inside
“push into pocket” cue.

### 4. Support the heart's pocket release and the tutorial-order swivels

**Heart:** start from the nine-node delivered prefix, not the exploratory tenth
node. Lower the upper flap while releasing the two side pockets and keeping the
specified side triangles uncreased. Establish whether existing per-side squash
operations and a central fold can do this through valid intermediate states.
Then finish source stages 9–12 and verify both top lobes, the notch, bottom point,
and the layer arrangement on the reverse side.

If independent operations cannot preserve the required intermediate paper,
implement a reusable atomic pocket-collapse operation in the existing compound
pipeline. Its input names the moving flap, pocket sides/hinges, and retained
paper by witnesses; its result derives the cuts, rigid pieces, and seeded order
from those inputs. Construct the complete endpoint, then run the normal
validator. Do not bypass adjacency closure with an arbitrary “do not move these
faces” mask: that can tear a connected sheet. A proposal for a new public op must
include the derived crease layout and why squash/petal cannot express it.

**Swan/crane swivels:** reproduce the saved edge/hinge targets using the current
picker and explicit buried-layer selection. `swivel_on_edge.rs` intentionally
requires an acute construction and unobstructed rays; `swivel_fold_wide` is an
angle restriction, not a claim that the stack contains too many layers.

For a valid case blocked by an intervening crease, derive how its moving regions
continue through the selected connected paper. Extend the existing scoring and
block decomposition only for that proven configuration; carry its stationary
neighbors and contact/layer constraints into the compound validator. If the
requested motion is actually a reverse or another compound construction, route
it through that construction with truthful terminology. Do not delete
`fan_ray_blocked`, enlarge tolerances, or loosen layer checks to make the example
pass.

**Gate:** the heart finishes from its prefix without adding unwanted creases to
its side triangles. The crane's outward neck/tail steps work from the
source-order preparation, and the swan has the required outward construction.
Equivalent source stages may contain several atomic saved steps, but the
reference stage and resulting paper relationships must be documented. The
current failed and infeasible cases remain explicit negative tests.

### 5. [DEFERRED — nonflat]  Add persistent nonflat states without weakening flat-state correctness

This is a deliberate extension of
[the original Fold plan](fold-workspace.md), which explicitly excludes nonflat
states and treats animation frames as pictures. The box and opened crane make
that extension necessary for this request. Update those scope statements when
this work is implemented; do not reinterpret a paused animation frame as a
validated state.

#### State and validation boundary

Introduce a discriminated engine state surface, conceptually
`Flat(existing State) | Spatial(SpatialState)`. Names are provisional; keep the
existing flat constructor, constraints, and fingerprints unchanged for old
sequences. A spatial state retains the original sheet topology, face lineage,
crease history, partial crease marks, and witness identity, and adds:

- Rigid face transforms in 3D and signed crease dihedral angles in a documented,
  front-relative convention. Camera orbit never changes those values.
- Validated hinge continuity and cycle closure; lengths and face shapes remain
  those of the sheet. Separate angle, distance, and area tolerances.
- Contact/order data for coincident paper and local stacks. A global “above”
  ordering or a single depth number per face is not meaningful for every 3D pose.
- Diagnostics for closure failures, nonadjacent face intersections, invalid
  contact order, ambiguous branches, and unsupported configurations.

Add a spatial admission gate. Reuse proven geometry/checks from Ori Studio's
existing 3D implementation where they fit, but note that its `LocalCrossing`
verdict is currently drawable and is not itself a refusal. Fold must apply its
own commit contract. Distinguish permitted touching/coincident paper from
transverse intersections; reject actual crossings. Record the coverage limits
of collision predicates and do not claim a globally non-self-intersecting state
where a check is indeterminate. Required fixture endpoints need a conclusive
admission result.

At the flat/spatial boundary, preserve material identity and contact order.
Convert back to a flat state only when coplanarity, hinge angles, and the complete
flat layer-order gate agree. A user may reopen a spatial endpoint and continue
with supported spatial operations; unsupported flat-only tools must be disabled
with a reason rather than flattening the model implicitly.

#### Reuse before new infrastructure

Review `oristudio-cp/src/folding3d/{placement,admit,planes,overlap,constraints,
order,model,interchange}.rs`, spatial checks, and existing 3D rendering. These are
Ori Studio native facilities; Fold is also an original engine, not an Oriedita
port. Reuse or extract neutral geometry with behavior-preserving tests for Edit.
Do not round-trip through an Edit CP document to produce Fold states: that loses
history/lineage and may merge precreases or choose another layer order.

The simulator's `ReferenceSolver` is a port with a separate upstream contract.
It may help investigate candidate configurations, but a relaxed/deformed GPU or
CPU simulation result is not an exact folded-state oracle. Do not change its
physics to make these fixtures pass or store a transient simulated mesh as a
Fold operation. If reuse entails port changes, read its vendored implementation
and run its parity tests.

#### Operations and coupled constraints

Add authored angle-fold operations over existing creases, naming the moving
paper, stationary support, signed target angle, and any chosen solution branch.
The initial useful targets include 90-degree walls and adjustable opened wings.
An angle-fold creates a history node and can be followed by another operation.
A new fold line on a spatial face must be resolved in that face's sheet frame;
for this corpus, prefer the existing preparation creases and add any required
creases explicitly before lifting.

Use closed-form rigid rotations when the selected hinge/group has no closure
coupling. Where several hinges must move together, provide a bounded,
deterministic coupled-fold solve:

- Constraints use stable crease/face witnesses, target angles or alignments,
  stationary faces, and preserved contacts.
- Start from the parent configuration with an explicit opening direction/branch
  at flat singularities. Continue through bounded increments when needed; do not
  choose a random branch or depend on GPU scheduling.
- Enumerate or expose meaningful alternate solutions, enforce iteration/time
  limits, allow cancellation, and return structured failures with witnesses.
- Store accepted solution choices with the operation; replay validates them
  against the parent. Optional caches are not the authoritative document.
- Run admission on committed endpoints. A valid endpoint does not establish a
  collision-free continuous path; retain the existing distinction between
  illustrative motion and physically checked motion. Do not advertise the former
  as the latter.

A small kinematic spike must first establish valid rigid endpoints for the box
corner collapse and opened crane. If the intended crane pose requires body
bending beyond piecewise-rigid faces, document that requirement and design an
explicit forming representation before calling it supported. Arbitrary mesh
stretching or hidden new creases are not acceptable substitutes. Optional rounded
sculpting remains outside the completion target.

### 6. [DEFERRED — nonflat] Finish the box and crane using those spatial operations

**Masu box assembly:**

1. Lift the side walls while allowing the necessary end-corner hinges to move.
   Do not assume one wall can be rotated independently while all connected end
   paper remains fixed.
2. Collapse the two corners at one end as a coupled operation, with consistent
   material connections and the intended inside/outside contacts.
3. Fold the securing flap over the rim and onto the interior base, through valid
   spatial endpoints; retain the wall and corner geometry.
4. Repeat at the opposite end and leave the box open at the top.

Accept only a single connected sheet whose base is planar, whose four walls are
perpendicular to the base within the tested tolerance, whose corner folds agree,
and whose two securing flaps rest inside. Verify interior opening, wall heights,
base dimensions, and contact order rather than just a perspective silhouette.

**Crane finish:** use the verified neck/tail/head sequence, select both wings by
material identity, and open them to a documented angle while permitting the
necessary body hinges to move. Preserve the outward neck/tail and downturned
head. Verify wing separation, symmetry where intended, hinge closure, and no
known intersections. It must remain an authored Fold endpoint, not a camera
rotation of a flat crane or a separate simulation.

These are generic angle/coupled-fold capabilities exercised by named examples;
model-specific hard-coded vertex coordinates are not the implementation.

### 7. Connect authoring, rendering, playback, and native persistence

#### Workspace and tools

Keep `components/panels/` as composition sites. Put spatial selection,
constraints, solver lifecycle, and preview state in focused modules/hooks under
`src/fold/`; keep React-free actions and builders alongside their concern.
Keyboard actions belong in the shortcut registry/executor and must work with
focus in the inspector or a portalled tool window.

Reuse the existing 3D mesh runtime, orbit/camera conventions, PaperStyle colors,
lighting, and paper render contracts where possible. Put shared presentation
below workspace ownership; Fold must not import Edit's store-bound behavior.
Preserve the flat renderer for flat nodes. Spatial picking must resolve a visible
face/crease and map it to a stable sheet anchor; offer explicit through-layer
selection for buried flaps. The crease-pattern pane remains a synchronized
sheet-space view of the same model.

Angle and coupled-fold controls need previews of moving and retained paper,
reachable targets/branches, explicit Apply/Cancel, and clear failure diagnostics.
Camera orbit, layer spread, and playback progress are view settings; applied
fold angles are model state. New presentation uses adjacent CSS modules and
existing UI primitives. Any necessary shared-CSS migration follows its own
repository-prescribed work, rather than leaking into this feature silently.

#### Worker, document, and replay

- Extend `oristudio-fold-wasm`, the Fold worker protocol, wire decoders, and
  `FoldEnginePort` together. Browser and desktop renderer use the same engine
  behavior; do not add a second Tauri-only implementation.
- Keep append-only steps, branch creation, undo/redo, and witness-based choices.
  Add pose/solver choices to path hashing and a versioned spatial fingerprint.
  Existing flat fingerprints and version-1 documents remain valid.
- Allocate sequence/native reader versions according to the then-current schema.
  Never encode spatial data as annotations or an unvalidated `extensions` blob.
  Older readers must preserve unknown data and report a locked/read-only sequence
  through the existing forward-compatibility contract, never drop or flatten it.
- Replay saved targets/accepted choices deterministically, compare expected
  fingerprints, and report drift/broken nodes. Do not silently choose a new
  solution branch after an engine update. Releasing/cancelling previews must not
  leak engine state handles.
- Generate spatial thumbnails from the actual endpoint. Playback begins at the
  actual parent and ends at the actual committed state; saving/reopening a
  partially played step must still select the same authored endpoint.
- `.osf` remains the deliverable. Preserve automatic Fold landing with no CP or
  Diagram companion created as a side effect. Interchange export of spatial
  states may reuse the existing 3D FOLD writer conventions, but a FOLD picture
  sequence must not be presented as the editable native operation history.

Keep the five examples as separate native projects for immediate usability.
A multi-sequence selector and round-trip import of arbitrary FOLD frame sequences
are useful follow-ups, but neither is required to complete these designs.

#### Instrumentation

Extend existing Fold committed-operation and playback enums when adding new
operation kinds. Reuse menu/keyboard capture where already covered. Add only
needed properties such as operation kind, outcome/refusal code, and bucketed
step count. Do not send crease coordinates, numerical fold angles, witness data,
filenames, or tutorial/user notes. Reuse central analytics/monitoring layers and
consent handling.

### 8. Delivery sequence and acceptance gates

Each row is a reviewable change, not permission to stop before the whole goal is
met. Exact PR boundaries may shrink when an apparent missing primitive proves
to be a fixture or selection error.

| Order | Deliverable | Dependency / exit gate |
| --- | --- | --- |
| A | Synchronize baseline; reference manifest and reduced reproduction cases | Every gap classified; swan mismatch remains visible; no incorrect golden blessed. |
| B | Reverse discovery, explicit kind intent, opening selection, corrected swan | A; Outside tool-flow, correct swan material relationships, native replay. |
| C | Heart pocket release and final corner folds | A; choose reuse vs minimal compound extension from evidence; completed heart. |
| D | Tutorial-order swivel coverage and proven geometry extensions | A; complete flat neck/tail preparation on both bird examples; negative cases retained. |
| E | Neutral 3D geometry reuse plus spatial-state admission and schema contract | A; existing Edit/flat behavior unchanged; validated simple hinge and coupled-endpoint spikes. |
| F | Saved angle/coupled-fold ops, worker/session integration, spatial Fold UI | E; commit/reopen/continue a nonflat operation, bounded solves and clear failures. |
| G | Complete box assembly and crane wing opening | B/D/F as applicable; all final geometric/material criteria pass. |
| H | Final five examples, native handoff, browser/desktop coverage, updated report | B/C/D/G; every model passes the completion checklist below. |

E–G are the largest architectural work and have higher uncertainty than B–D.
Do not estimate them as a small missing-tool patch. Record the kinematic spike's
result and solver/validation design before committing to the spatial API.

### 9. Validation strategy

**Engine:** Rust tests for reference geometry, layer/contact witnesses, negative
cases, flat/spatial conversion, and solver determinism. Include turn-over/view
invariance and sheet-scale cases. Keep existing random/digest/compound campaigns
unchanged unless a documented behavioral correction requires a reviewed update.
Run the shared layer-order tests when its code changes.

**Bridge and UI:** exercise the actual tool input → builder → worker → engine →
commit path, using the existing tool-flow harness. Direct engine fixtures alone
cannot validate reachability. Compare canonical states between that flow and
API-authored equivalents. Cover automatic/explicit reverse selection, all
relevant openings, hidden-layer picks, both-sided pockets, angle entry, cancelling
or superseding solves, and turning the model over before selection.

**Native lifecycle:** save/open each final file using the ordinary project reader
and automatic landing rule; never force `/fold` in a test to hide a routing error.
Check every node, selected cursor, choices, undo/redo, a branch from an earlier
node, and continuing from a reopened spatial endpoint. Test legacy flat files and
future/unknown op preservation. Keep `.fold` exports in a separately labelled
folder.

**Visual/manual:** compare all five final models and the critical intermediate
steps with the references, with layer spread disabled first. Inspect both paper
sides and rotate spatial models. Exercise the controls with mouse and keyboard,
including inspector/menu focus and touch layouts where the new controls differ.
Verify the same native files in browser and Tauri; a native dialog check is
necessary even when renderer logic is shared.

Use the smallest checks for each implementation change, then the affected CI
surface before delivery:

```sh
cargo fmt --check
cargo test -p oristudio-fold -p oristudio-fold-wasm
npm --workspace @treemaker/web run build:oristudio-fold-wasm
# Focused Fold tool-flow, document/replay, and spatial tests during development.
npm run lint:web
npm run typecheck:web
npm run test:web
npm run build:web
# For engine/shared geometry changes, run the repository-required full gate.
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
# When native file handling or shell integration changes:
npm run check:desktop
```

Use Fold's matching wasm Node tests and the affected CP/Flat-Folder/simulator
oracle or parity suites when those subsystems change. TreeMaker's C++ oracle is
not an oracle for this original Fold engine; do not claim otherwise. Rebuild all
affected bridges before browser checks. Start the persistent dev server with
`scripts/dev-server.sh`, using an isolated port. Keep native runtime smoke checks
and any unavailable checks explicit in the handoff.

## Affected Areas

Paths below are existing owners; proposed spatial modules should live alongside
these concerns rather than adding behavior to a panel.

| Area | Files/directories and expected changes |
| --- | --- |
| Flat compound engine | `crates/oristudio-fold/src/compound/{reverse,squash,swivel,swivel_on_edge,vertex,pieces}.rs`, `refusal.rs`: only proven missing constructions and diagnostics. |
| State/geometry | `crates/oristudio-fold/src/state/`, `pattern.rs`, `scene.rs`, `isometry.rs`; new spatial state/operations/admission modules without weakening flat `State::make`. |
| Existing 3D infrastructure | `crates/oristudio-cp/src/folding3d/`, spatial checks, `crates/oristudio-geometry/`: reuse/neutral extraction with current-user regressions. |
| WASM and worker | `crates/oristudio-fold-wasm/src/`, `apps/web/src/workers/foldSequenceWorker.ts`, `src/fold/engine/`: typed operations, scene kinds, diagnostics, cancellation, and versioning. |
| Tool behavior | `apps/web/src/fold/tools/reverse/`, `tools/vertex/`, `canvas/`, `tools/foldToolCatalog.ts`, `tools/foldToolState.ts`; new spatial tool modules. |
| Presentation/rendering | `apps/web/src/components/fold/`, `src/fold/sequence/`, `src/fold/animation/`; shared facilities from `src/lib/paper/` and `src/cp-workspace/folded/folded3d*` where independently reusable. |
| Document lifecycle | `apps/web/src/fold/document/`, `src/fold/session/`, `src/store/workspaceStore/slices/foldSlice.ts`, `projectDocuments.ts`, `landingWorkspace.ts`, and native schema helpers. |
| Integration | `apps/web/src/keyboard/`, command/action catalogs, `analytics/`, locales; Tauri only if native shell behavior actually changes. |
| Evidence | `tests/fixtures/fold-design-completion/` (proposed), existing Fold example/tool-flow tests, Rust integration tests, trial report and final `.osf` projects. |
| Contracts/docs | `implementation-plans/fold-workspace.md`, Fold crate/bridge READMEs, `PORTING.md` if shared/ported surfaces change, analytics docs and fixture attribution. |

## Checklist

### Planning and audit

- [x] Inspect the saved five-design attempts and the native-file handoff.
- [x] Re-read all five source tutorials and identify their actual completion stages.
- [x] Confirm Outside reverse exists in the engine, document, builder, and UI.
- [x] Reproduce the saved swan neck's Outside refusal without changing its geometry.
- [x] Run the existing reverse tool/WASM tests: 3 passed.
- [x] Identify existing 3D placement/admission/rendering and the original flat-only scope.
- [x] Write this implementation plan; superseded by the flat scope and findings above.

### A — Establish the acceptance corpus

- [x] Integrate the current Fold source and rebuild the matching bridge.
- [x] Add attributed reference manifests, valid prefixes, and reduced negative cases.
- [x] Establish correct swan material/layer relationships and heart pocket endpoint.
- [x] Audit cicada geometry, paper sides and both-sided rendering; retain native replay regression.
- Deferred: demonstrate spatial box-corner/opened-crane endpoints in a later kinematic spike.

### B — Reverse fold and swan

- [x] Make both reverse kinds discoverable through the shared tool/commands.
- [x] Preserve explicit Outside intent and make infeasible requests actionable.
- [x] Expose the required openings without hiding them behind a combined-choice cap.
- [x] Correct or extend the swan neck construction based on the reference fixture.
- [x] Complete the head and verify the intended outside/inside relationships.
- [x] Prove tool/API equivalence and native replay for the corrected swan.

### C/D — Heart and swivel coverage

- [x] Test existing squash/flap composition for the heart pocket release.
- [x] If necessary, implement the smallest derived compound extension and its refusals.
- [x] Complete the heart's final corner folds and turnover.
- [x] Owner review correction: select the tuck completion with the lowered flap
      above the original bottom triangle. Assert exposed material on both halves,
      retain the old admissible-but-wrong order, and exercise the UI order chooser.
- [x] Reproduce the tutorial-order bird swivels with current buried-edge picking.
- [x] Extend only proven valid unsupported swivel configurations; retain negative tests.
- [x] Verify the crane neck/tail/head from the intended preparation.

### E/F — Nonflat authoring foundation (deferred by owner)

- [ ] Extract/reuse neutral 3D geometry without changing Edit's behavior.
- [ ] Define spatial states, rigid face/hinge checks, contacts, and collision diagnostics.
- [ ] Implement validated flat ↔ spatial boundaries preserving material identity.
- [ ] Add authored angle folds and bounded coupled-hinge solving with stored choices.
- [ ] Extend native schema, hashing, worker protocol, replay, and compatibility handling.
- [ ] Add spatial rendering, picking, constraints preview, Apply/Cancel, and history.
- [ ] Keep playback/view settings distinct from saved model state.
- [ ] Add privacy-preserving events for new committed operations and failures.

### G/H — Deliver flat models; spatial finishing deferred

- [x] Masu box: full flat preparation; upright assembly deferred.
- [x] Crane: flat reverse-fold neck, tail, head and both flat wings; wing opening deferred.
- [x] Cicada: completed final flat sequence, front/back visual audit and replay coverage.
- [x] Swan: reference-correct outward neck/head construction, not the trial substitute.
- [x] Heart: completed pockets, lobes/notch/corners, and final front view.
- [x] Every model uses operations exposed by Fold and saves as `.osf`; critical new
      heart/swan constructions have tool-to-API equivalence coverage. A complete
      mouse-only authoring study is separate from this implementation.
- [x] Every file opens automatically in the browser Fold workspace. Desktop heart
      open/save/reopen preserves every operation and choice; continued editing
      is exercised from the cicada endpoint.
- [x] Browser/desktop smoke checks and legacy/unknown-file regressions pass.
      Validation commands and limitations are recorded in the research report.
- [x] Replace the “partial/alternative” deliverables only after semantic acceptance;
      retain original experiments as historical evidence and update the report.
