# Reversible Fold steps

## Goal

Add **Unfold to step…** to Ori Studio's Fold workspace. From the current
diagram step, choose an earlier step on the same path and append a step
that returns the paper to that earlier pose while retaining every physical
crease made along the history. Earlier steps and branches remain intact.
The user can continue folding from the new state.

Status: **implemented and verified locally**, 2026-10-14. See the
[validation and local test instructions](../research/origami-me-flat-catalog/batches/unfold-to-step-2026-10-14.md).
Decisions confirmed 2026-10-14:

- Append an unfold step and retain the intervening creases.
- Finish the in-flight Dove continuation, then plan this foundation.
- Working backward from an imported CP is deferred. Keep an extension path,
  without implementing recognition or reverse authoring now.
- Flat endpoints, one sheet, no cuts or assembly. Local work only.

Dove is [complete through source 16 / Fold 17](../research/origami-me-flat-catalog/batches/dove-completion-2026-10-14.md),
with 24 replayed states. Further diagram work is paused for this plan.

## Approach

### Behavior

For `Sheet → A → B → C`, selecting **Unfold to A** at C appends:

`Sheet → A → B → C → Unfold to A → subsequent folds`

The result has A's material positions, exposed paper sides, and layer order,
plus the creases made through C. Creases open in A become flat precreases;
creases folded in A keep A's folded configuration. It is not byte-identical
to A because it contains more crease history.

| Action | Meaning |
| --- | --- |
| Navigate to A | Inspect A; change no document content. |
| Editor Undo | Undo an authoring edit, including adding an unfold step. |
| Unfold last step | Append a return to the current node's immediate parent. |
| Unfold to A | Append one return for the contiguous suffix after A. |
| Reverse a fold found in an imported CP | Future work without a recorded target. |

Recommended rules for this delivery:

- Targets are **strict ancestors**, or the starting sheet. A range is the
  suffix between that target and the current step. Selectively undoing a
  middle step while keeping subsequent folds applied is deferred.
- Starting from an earlier node uses normal branch semantics; existing
  children remain untouched. A range adds one numbered diagram step.
- Restore the target's model orientation, including turns/rotations. Keep
  the viewport camera and presentation settings under normal viewer controls.
- Preserve physical pinch/segment creases and inherited reference marks.
  Notes and layer spread remain annotations, outside physical state.
- A precrease-only range can produce the same state: show **Already in this
  pose; creases retained** and do not append a redundant step.
- Returning across a prior unfold can close folds again. Use **Return to
  step X** as the neutral sentence when “Unfold” would misdescribe the result.
- Reopen offline from the normal saved `.osf` operations; do not depend on a
  cached engine snapshot or the original external CP file.

### Existing support and the missing foundation

The engine already has immutable validated states, original-sheet coordinates,
per-face isometries, explicit layer order, and face lineage.
`CreaseKind::Flat(Letter)` remembers an opened crease's last fold direction.
`CreaseMark` stores partial precreases beside the face graph. The document
already has an append-only tree, stable node IDs, saved choices, deterministic
replay, branch handling, and changed/broken fingerprints.

Existing `unfold` and `refold` use the plain fold engine along one crease.
`unsink` is another specialized operation. None is a general history-based
inverse. Loading an earlier state would lose later creases; swapping M/V or
calling an opposite compound tool would not restore all pockets and layers.

`StepMotion` is presentation data. Some compound animations explicitly have
illustrative intermediate frames. Playing an animation backward cannot be
the source of truth for the returned state.

### Engine primitive: restore a known material pose

Add a focused module, provisionally `reversal/`, with a checked operation:

`restore_pose(current, target_pose, retained_crease_inventory) → State + report`

These are engine values. Rust should not know sequence IDs, diagram numbers,
React state, or worker handles. Initially extract the target pose from a
validated historical `State`; do not expose arbitrary unchecked transforms.
The report describes material correspondence and crease-state changes.
Do not serialize a second full state for every step or require a bespoke
inverse implementation for every existing tool.

**Retain the paper's history and subdivide it consistently.**

1. Collect physical graph edges and partial crease marks along the current
   branch, from its sheet through the current node. Exclude auxiliary CP
   guides and UI annotations.
2. Usually the current graph contains this inventory and refines the target
   graph. Use that as a checked fast path.
3. A CP import can replace and renumber the graph, including omitting older
   creases. Retain the historical union: an omitted line must not disappear
   merely because the latest CP snapshot left it out.
4. Split the material at retained boundaries until each output convex face
   lies within one target face. Map whole polygons in original-sheet
   coordinates; a centroid alone is not a proof of containment.
5. Use existing tolerances and minimum-feature rules. Reject ambiguous
   coverage, gaps, duplicated area, sheet mismatch, or unresolved slivers.
   Never silently drop a real crease. Preserve graph IDs where possible and
   assign deterministic new IDs when needed; do not persist IDs as material
   correspondence.
6. Preserve partial marks beside the graph using existing carry/subsume rules.
   Never extend a pinch into a full crease or draw an edge and mark twice.

Keep crease history separate from its current folded/flat state. An opened
crease retains its most recent front-relative fold direction along the
source history, including opposite refolds. Preserve creation provenance
when splitting. Active target hinges take their direction from the target
pose/order. The return does not manufacture these creases anew.

**Restore geometry and layers, then validate.**

1. Give each refined face its containing target face's isometry. Preserve
   target registration and view, choosing a refined root with that transform.
2. Adjacent pieces with the same transform are flat across their retained
   crease. Restore target hinge relations where the transforms differ.
3. For pairs overlapping with positive area, inherit their target material
   faces' order. Subdivisions of one target face do not become extra layers.
4. Construct through the full `State::make` gate. Never bypass geometry,
   hinge, or layer-order validation or copy pairs by obsolete face IDs.
5. Compare original-sheet positions, front/back orientation, and full overlap
   stacks with the target, allowing subdivision. A matching silhouette is
   insufficient; raw state hashes cannot establish pose equivalence either.
6. Return atomically: a checked state, or a specific refusal with no mutation.

Begin with full validation rather than incremental optimization. Bound
pathological refinement work and support cancellation; return a limit
refusal rather than an approximation.

### Saved operation and replay

Add `unfold-to`; keep the existing line-based `unfold` semantics:

```ts
{
  kind: 'unfold-to',
  target: string | null, // ancestor node ID; null means starting sheet
  source: {
    path: string,       // parent's path digest at commit
    state: string,      // parent's state fingerprint at commit
    targetState: string // target's state fingerprint at commit
  }
}
```

The node's existing `parent` is the source. Never store step numbers,
worker handles, transient face IDs, or duplicate source IDs. Keep the normal
result `expect` fingerprint. Exact field names can change during implementation.

- Resolve the target against the source's ancestor path before the engine
  call. Reject missing, self, descendant, sibling, and foreign targets,
  including malformed saved files.
- Add an explicit resolved return call to `FoldEnginePort`. Ordinary
  one-parent operations keep their interface. The bridge receives
  generation-checked handles for current/target/history states.
- Keep those states alive until completion. Preserve latest-run cancellation,
  worker-restart replay, cache eviction, and sibling isolation.
- Include target and pinned dependency identity in the return path key;
  check source drift before using cached success. Annotations must not
  invalidate a physical return.
- An explicit **Update from CP** may change a dependency. Do not silently
  change an unfold's promised result: report dependency drift and offer
  **Rebuild unfold** with a fresh preview. This is one undoable edit followed
  by normal descendant changed/broken replay. Detect actual source/target
  state drift after engine changes too; a version bump alone is insufficient.
- Offline replay uses the saved Collapse revision, never a newer Edit CP.
- There is no circular digest: the pinned source path ends at the parent,
  before the new return node.

Compatibility with old files is not a product requirement here. Prefer
existing unknown-op handling if sufficient; bump the sequence format only
when required by changed semantics. Migrate agent-authored fixtures as
needed and preserve all user-edited native files.

### Complete operation coverage

The reconstruction primitive should cover every row. These are acceptance
requirements, not a list of guessed opposite tools.

| Existing operation | Required history-based return |
| --- | --- |
| Valley/mountain; existing-crease fold/refold/unfold | Restore previous pose/order with opened crease direction retained. |
| Whole precrease; Segment/Pinch | Retain all marks; report pose-only no-ops honestly. |
| Inside/outside reverse, including nested pairs | Restore both sides and earlier pocket contacts and stationary layers. |
| Crimp | Restore both hinges atomically, including boundary-meeting multi-pair crimps. |
| Tuck | Restore the flap outside its pocket with the prior order. |
| Squash, petal, rabbit ear, swivel | Restore every sector across precreases, including sides and order. |
| Open sink, closed sink, unsink | Restore the known tip/pocket arrangement without guessing another pocket. |
| Turn/rotate | Restore orientation without changing front-relative crease letters. |
| Import CP / linked Collapse | Restore the known predecessor across graph replacement, retaining history. |
| Previous history-based return | Preserve the accumulated inventory; returning to an older folded pose can close folds again. |

A recorded Collapse has a known predecessor. Reversing it is within this
history-based feature, distinct from discovering a predecessor from an
arbitrary CP. Collapse supplies checked endpoints, not a proven continuous
physical motion. Keep that distinction; do not invent a reverse rabbit-ear
label or animation for it.

### Fold UI

- Add **Unfold last step** and **Unfold to step…** through the shared action
  catalog/menu. Keep editor Undo unchanged.
- Show ancestor labels plus **Starting sheet** in the target picker, with a
  thumbnail of the selected target. Distinguish unnumbered turn/rotate nodes.
- Preview the actual reconstructed state in the normal Fold canvas, with
  retained lines in the CP view. Show the target/range and **Returns to
  step X; keeps the creases made since then.**
- Commit through the normal append workflow with its result fingerprint and
  one editor-undo entry. Timeline cards always show the folded result.
- Link to the target from the inspector; offer rebuild when drift requires
  it. A refused preview retains the last valid state and explains why.
- Keep action/target logic pure, bindings in focused hooks, panels as
  composition, and new styling in adjacent CSS modules. Route keyboard
  actions through the shortcut registry.
- Use automatic menu analytics where available; any extra structured event
  uses only enums/buckets, never geometry, text, paths, or node IDs.

Initially show the two exact flat endpoints for playback. Continuous reverse
animation is not a prerequisite and must not introduce non-flat authoring.
Any later illustrative playback must be remapped to retained material and
remain separate from state construction.

### Incremental delivery

**A — Ordinary folds and ranges, end to end.** Build the checked return for
refining graphs, bridge call, saved op/replay, and target picker together.
Cover ordinary folds, precreases, turns/rotations, one-step and range returns.
Explicitly refuse graph replacements until milestone C.

Acceptance: fold vertically, fold horizontally, return to the vertical fold.
Its pose/order matches; both creases remain; a new fold along the retained
horizontal crease works. Returning to the sheet leaves both flat. Save/open,
branching, and undo/redo work.

**B — All compound operations.** Test the same material reconstruction
against every compound row. Expand it where evidence requires; avoid a
separate handwritten inverse for each tool. Include nested reverse,
boundary crimp, tuck contacts, and rabbit ears across precreases.

Acceptance: each operation can return to its predecessor; mixed ranges also
work. Retained creases are usable by subsequent public operations.

**C — Recorded CP graph changes.** Add common subdivision across CP imports
and Collapse, missing historical edges, changed IDs, and partial marks.
Complete explicit dependency rebuild after CP updates. Do not claim all
operations are reversible until this milestone passes.

Acceptance: Witch Hat's recorded Collapse and Pumpkin/Squirrel CP checkpoints
return to known earlier poses with verified material/order and crease
inventory. No automatic read of a newer Edit CP or operation inference.

**D — Native-file and UI verification.** Verify representative real sequences,
fresh offline replay, exports, and normal Fold actions. Use fixture copies,
not the user's working Heart/Cicada files. Update evidence and provide a
local handoff; no new diagrams, PR, push, or schedule.

### Tests and validation

Engine acceptance:

- Material area/coverage, sheet-point positions, front/back sides, hinge
  geometry, and complete layer stacks in every overlap cell.
- Monotonic crease retention, including opposite refolds, partial marks,
  histories with prior unfolds, and fully returning to the sheet.
- Pose/order equivalence despite extra faces; repeated return to the same
  target is materially idempotent. Subsequent folds use the retained edges.
- Both starting sides, rotated/mirrored views, rectangular and supported
  polygon sheets.
- Every compound operation, especially nested pockets and stationary order.
- Changed CP topology/IDs, collinear splits, crossing creases, numerical
  edge cases, and atomic refusals.

Document, WASM, and UI acceptance:

- Serialized round trips and fresh-engine offline reopening with no cache.
- Ancestor/range/branch selection, starting sheet, no-op precreases, one-edit
  undo/redo, and invalid/self/cyclic/foreign dependency rejection.
- Drift/rebuild after CP updates, cancellation, stale worker generations,
  cache keys, handle lifetime, and unaffected siblings.
- Notes/spread edits do not invalidate physical returns.
- Actual folded-result preview, retained CP lines, meaningful labels,
  accessibility, and shared browser/Tauri command behavior.
- FOLD and Send to Edit include retained opened creases with existing
  direction hints and the new folded state. Preserve the distinction between
  physical precreases and auxiliary guide lines.

During implementation run focused Rust/WASM tests, then relevant workspace
tests and the Fold oracle regression suite. Rebuild the Fold WASM bridge
before browser validation. Run web lint, typecheck, unit tests, and production
build when bridge/bundling changes warrant it. Document skipped checks.
Validation completed: workspace Rust tests, focused Fold clippy, rebuilt WASM,
1,225 relevant web tests, web lint/typecheck, translations, production build,
fresh native-file replay and browser preview/append/rebuild/cancel checks.
The native audit exercised 1,102 returns from 570 saved steps across 38 models.
All 72 pre-existing native files were preserved byte for byte. The linked
report records the evidence and checks not run.

### Future reverse authoring

Reusable foundations are original-sheet material correspondence, crease
inventory separate from current state, a target-pose/order contract, and a
checked transition report. A future tool can derive candidate predecessors
and submit them to the same checker.

That later work still needs operation recognition, user-selected material,
pocket/layer ambiguity handling, and predecessors without history. None is
scoped now. Do not build a speculative solver or call checkpoint restoration
a general “reverse rabbit ear.”

## Affected Areas

| Area | Planned work |
| --- | --- |
| `crates/oristudio-fold/src/reversal.rs` (new) | Inventory, material refinement, pose/order restoration, checked report. |
| `crates/oristudio-fold/src/{pattern.rs,crease_marks.rs,state/}` | Reuse invariants; narrow helper/provenance extensions as needed. |
| `crates/oristudio-fold/tests/` | One-step/range, compound and CP-topology fixtures. |
| `crates/oristudio-fold-wasm/src/` | Public return call, handle validation, wire/report and canonical state coverage. |
| `apps/web/src/fold/document/` | Op, reader/writer, ancestor validation, replay, digest/cache, append/rebuild. |
| `apps/web/src/fold/engine/` and Fold worker/client | Generation-safe calls, cancellation and lifetime. |
| `apps/web/src/fold/sequence/` | Targets/actions, sentences, timeline and inspector bindings. |
| `apps/web/src/components/fold/` | Picker and preview composition. |
| Commands, keyboard, analytics, locales | Shared action routing, accessible strings, privacy-safe event. |
| Fold IO/export and native-file tests | Retained CP output and fresh reopening of campaign fixture copies. |

This is original Fold functionality. Do not alter vendored upstreams or
weaken CP/layer-order port behavior to accommodate a failed return.

## Checklist

- [x] Confirm append-with-retained-creases semantics with the user.
- [x] Defer imported-CP reverse authoring while keeping an extension path.
- [x] Finish Dove and preserve other native files.
- [x] Inspect state, crease marks, history, replay, digests, and motion code.
- [x] Record scope, contract, milestones, affected areas, and acceptance tests.
- [x] A: Implement checked restoration for refining histories.
- [x] A: Add saved op, replay dependencies, bridge and basic UI.
- [x] A: Verify ordinary folds/ranges/partial precreases/views end to end.
- [x] B: Verify all compound operations, sides, and layer order.
- [x] C: Handle recorded CP graph replacement and full crease retention.
- [x] C: Add explicit dependency rebuild after CP updates.
- [x] D: Verify native sequences, fresh reopening and exports.
- [x] D: Complete relevant Rust/WASM/web checks and browser audit.
- [x] D: Provide local test instructions and documented limitations.
