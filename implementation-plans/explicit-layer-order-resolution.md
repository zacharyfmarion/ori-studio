# Explicit layer-order resolution in Fold

## Goal

When a new fold has more than one valid layer order, require the user to choose
the result before the step enters the sequence. Show each candidate as folded
paper on the canvas, let the user cycle through the candidates, and save the
exact accepted order for deterministic replay.

Status: **Implemented locally and validated, October 15, 2026.**

Follow-up identified October 15: ordinary M/V fixes the outer placement before
order resolution, so this chooser does not discover Tuck alternatives. See
[Unified Mountain and Valley placement](unified-mountain-valley-placement.md)
for the planned extension that searches both placements, including multi-target
insertions and their different moving sets, through one authoring workflow.

Keep this work flat and two-dimensional. Pause diagram authoring while agreeing
on this interaction. Do not add a general editor for the order of saved steps
in this version.

## Approach

### Scope decision: resolve before saving

Changing a saved step's order can change the exposed faces and the layers a
later operation selects or carries with it. Replaying later steps can therefore
produce a different result or fail, even if the earlier silhouette is unchanged.

That workflow is feasible, but needs its own preview, cancel/undo transaction,
and clear treatment of affected descendants and branches. Defer it for now, as
discussed with the user on October 15, 2026. Build the chooser independently of
the append action so a future saved-step editor can reuse it.

Existing saved orders continue to replay without prompting. The existing
explicit **Update from CP** workflow remains explicit; where that workflow
already asks for a new order, use the same resolver and preserve its existing
revision checks and descendant replay. This does not introduce a new way to
change an arbitrary saved step's order.

### What happens today

- Compound tools already obtain multiple layer orders and expose cycling
  controls, but initialize the selected index to zero. `chosenAt` falls back to
  the first result, so a valid preview can become a committable step without an
  explicit layer-order decision.
- CP import initializes every independent component to order zero. Its current
  chooser also treats these defaults as selections. The automatic path checks
  whether any component lists more than one order, which is insufficient to
  prove uniqueness when the search was truncated.
- Enter can be queued while a tool's answer is being computed. Resolving that
  queue must not accidentally accept an ambiguous result that was not visible
  when Enter was pressed.
- Tool previews currently suppress layer spreading. The resolver needs an
  inspection mode that makes hidden ordering differences visible, not just a
  different silhouette.
- Saved completion choices already store order witnesses/FOLD triples rather
  than a candidate index. Preserve that durable representation.

Relevant implementation references are listed under Affected Areas.

### Proposed interaction

1. The user locates the fold, chooses the participating paper, and makes any
   existing geometry/opening decisions as today.
2. Once those inputs are sufficient, compute the valid endpoint orders. If the
   result is ambiguous, enter **Choose layer order** automatically. The fold is
   still a preview; no timeline step has been added.
3. Keep the folded canvas visible and show the first candidate. Display a compact
   resolver beside it, in the tool controls. This required stage stays visible
   even if optional tool settings were collapsed.
4. Previous/next changes only the preview. **Use this order** accepts the exact
   displayed candidate and saves the step in one action. There is no second
   generic Fold confirmation after accepting it.
5. **Back** returns to the fold inputs with the picks preserved. The user can
   revise the operation or cancel it without adding a step.

Illustrative controls:

```text
Choose layer order
Several arrangements fit this fold.

     ‹     Order 1 of 4     ›

     Back                  Use this order
```

**Agreed:** allow the user to accept the
first candidate explicitly. Requiring a trip to candidate two and back adds
clicks without proving inspection. Merely showing the first candidate, or
cycling to another one, never counts as acceptance.

For a completed finite list, previous/next wraps so the user can cycle in either
direction. One available candidate disables cycling. Incomplete searches have
different wording and navigation as described below.

### Make the decision visually inspectable

- Always show the folded endpoint, including for CP collapse. Do not introduce
  a replacement CP-only screen or a grid of tiny previews as the main decision
  surface.
- Keep camera, scale, paper colors, orientation, and display settings stable
  across candidates. Do not fit the camera anew on each click. Pan and zoom
  remain available.
- Keep **Spread layers** exclusively in the sidebar; do not duplicate it in
  the chooser. Fold defaults to spreading off. Explicit saved spread settings
  remain respected, and the sidebar setting also controls candidate previews.
- Highlight the overlap regions whose ordering differs between candidates.
  The highlight must come from actual local order relations, not pixel changes
  or a guessed global face stack.
- When the difference is entirely hidden, make that explicit and provide a
  local layer-stack readout at the highlighted region, with corresponding faces
  highlighted on the paper. Reuse the existing layer-picking/stack geometry;
  this inspection must not alter the fold's moving-layer selection.
- Two candidates with the same exterior are still different choices if their
  internal order differs. Never merge them on silhouette alone. Some models
  have no single global top-to-bottom face order; show local stacks honestly.

### Unique, ambiguous, incomplete, and impossible answers

| Solver result | User experience |
| --- | --- |
| Exactly one valid order, search complete | Ordinary fold preview and commit; no extra chooser. |
| Multiple valid orders | Required chooser; preview is not acceptance. |
| One or more valid orders found, search incomplete | Required chooser, labeled **Order 1 of N found — search incomplete**; explicitly accept a valid found order or search further. Never call it unique. |
| No order found before a search limit | Explain that search was incomplete; offer a bounded retry/cancel, not “this fold is impossible.” |
| No valid orders, exhaustive result | Keep the existing refusal and allow revising the fold. |

Do not claim the listed count is exhaustive unless the engine proves it.
Distinguish an incomplete solver search from a UI list truncated after the
engine has already found more orders. Every order already found must be
reachable; do not preserve the CP chooser's 24-thumbnail limit as a selection
limit.

For incomplete lists, reaching the end exposes **Find more orders** rather than
silently wrapping as though all possibilities were visited. Repeated searches
are bounded, cancellable, and preserve the displayed candidate by its actual
local layer relations, not by its old index. The operation and parent remain
fixed while those relations are matched; saved steps still use sheet-point
witnesses. If a bridge cannot yet request more results, extending
that bridge is part of this work; do not show a nonfunctional control or relax
solver validity guards.

### Independent CP regions

CP import can expose independent order components with a very large product of
valid combinations. Avoid materializing or making the user traverse that entire
product.

- Use the same full-size folded preview and order cycling controls.
- When several independent regions need choices, label the active one
  **Region 1 of 2** and highlight it on the model.
- **Use this order** confirms that region and moves to the next unresolved
  region. On the last region, label the action **Use orders and add step**.
- Show which regions are confirmed; allow revisiting one without losing the
  other confirmations. Unreviewed default orders can be used for the combined
  preview but never silently count as confirmed.
- Exactly unique regions need no confirmation. Incomplete regions do.
- Add one saved CP-collapse step only after all required regions are resolved.
  Canceling leaves the document unchanged.

### Keyboard and cancellation

- Route commands through the existing shortcut registry/executor and action
  binding. Do not add a panel-level keydown listener.
- While resolving, candidate navigation targets the order chooser rather than
  the timeline. Text fields and controls that own arrow keys retain their keys.
- Enter pressed before analysis finishes may continue the existing queued-commit
  behavior only if the answer is provably unique. An ambiguous/incomplete
  answer consumes that request by opening the chooser; it never accepts it.
- Make **Use this order** a normal focusable button. Enter/Space on that button
  accepts the ready candidate. Generic canvas Enter does not bypass this
  explicit action; it directs the user to the chooser.
- Disable acceptance while the displayed candidate's endpoint is still loading
  or has failed. A click or keypress during loading is not queued as acceptance
  of a later candidate. Suppress held-key repeat from committing a newly opened
  chooser accidentally.
- Escape first exits order resolution back to inputs; a subsequent cancellation
  follows the existing tool cancel behavior. Switching tools, navigating the
  timeline, undoing, or replacing the document cancels the pending resolution.
- Announce candidate/region counts, loading, incomplete search, and errors to
  assistive technology. Restore sensible focus after Back or completion.

### State and commit boundaries

Use shared engine query types and a common chooser, with a tool controller
and a React-free CP-import flow. The operation adapters share the bounded
order-selection query. Separate these concepts explicitly:

1. The operation and parent state being resolved.
2. Candidate witnesses, completeness metadata, and the previewed candidate.
3. Whether the user has explicitly accepted that candidate for those inputs.
4. The preview handle/state that corresponds to that exact witness.

Use an operation revision/key covering the parent state, operation geometry,
participating layers, non-order choices (opening, hinge, direction, pocket,
tuck target, etc.), and source-CP revision where relevant. Changing any of these
invalidates acceptance. Panning, zooming, or inspecting layers does not.

The UI commit boundary must require either a provably unique answer or explicit
acceptance for the current revision and witness. Apply this consistently to
buttons, shortcuts, queued commits, and CP's landed-preview commit path. A
disabled button alone is insufficient. Keep the low-level engine usable by
headless callers supplying an explicit valid witness; replay must never require
a UI acknowledgment.

Separate preview construction from commit eligibility: building a first-order
preview is valid; treating it as consent is the bug. Index zero, a fallback to
the first result, and clamping a stale index must never manufacture acceptance.
Discard stale worker responses, cancel obsolete searches, release discarded
preview handles, and make acceptance idempotent while a commit is pending.

Keep the chooser controller independent of append vs. replace persistence for
future saved-step editing. Do not implement replacement or descendant-repair UI
now. No file migration is expected: accepted choices use the existing durable
witness format; transient review state is not serialized.

### Operation coverage and exclusions

Cover all existing sources of layer-order choices: reverse folds, crimps,
tucks, sinks, squash/petal/rabbit-ear/swivel operations, CP import, and linked CP
collapse. Audit ordinary mountain/valley operations too; use the chooser only
if they actually return order ambiguity. Do not invent ambiguity for a
deterministic operation.

Keep geometry choices separate from order choices. This work does not redesign
opening selection, inside/outside intent, or hinge selection. Any change to
those choices invalidates the dependent order result.

Starting from a folded figure that already supplies an explicit order, loading
a saved sequence, and deterministic replay do not require a new confirmation.
No 3D behavior, cuts, assembly, private model fixtures, automatic saved-step
rewriting, or new general layer-order editor is included.

### Validation

- State-machine tests for exact uniqueness, multiple results, incomplete lists
  with only one found result, empty exhaustive vs. budget-limited results, and
  invalidation after every relevant input change.
- Commit tests covering direct buttons, canvas shortcuts, queued Enter,
  candidate loading, repeated acceptance, cancellation, document navigation,
  stale worker replies, and independent CP-region confirmations.
- Integration coverage for each adapter's metadata and witness plumbing;
  representative public engine flows for a compound fold and a CP collapse.
- Save/reload/fresh replay preserves the chosen witness and resulting local
  stacks. Use synthetic/public fixtures, including alternatives with identical
  exterior silhouettes and different internal orders.
- Browser review of the full-size preview, stable camera, hidden-layer
  inspection, keyboard flow, narrow layouts, and canceled operations. Shared
  browser/Tauri action paths must behave the same.
- Run web lint, typecheck, and affected unit/integration tests. If bridge or
  solver-query changes are needed, add focused Rust coverage, rebuild the Fold
  wasm bridge, and validate against that rebuilt artifact before browser review.
- Reuse existing choice-offered analytics; add accepted/canceled events only
  where not already captured. Use operation enums and bucketed counts, never
  geometry, witnesses, filenames, or private model information.

## Affected Areas

- `apps/web/src/fold/tools/foldToolState.ts` and pure step builders, including
  `tools/reverse/reverseStep.ts` and `tools/vertex/vertexStep.ts`.
- `apps/web/src/fold/canvas/useFoldReverseStep.ts`, `useFoldCrimpStep.ts`,
  `useFoldTuckStep.ts`, `useFoldSinkStep.ts`, and
  `canvas/vertex/useFoldVertexStep.ts`: normalize candidates/completeness.
- `apps/web/src/fold/canvas/useFoldToolPreview.ts`, `useFoldCanvasPaint.ts`,
  `useFoldCanvasVerbs.ts`, and `useFoldCanvasShortcuts.ts`: preview, inspection,
  commit gating, and queued Enter behavior.
- `apps/web/src/components/fold/FoldToolWindow.tsx` and a small dedicated
  resolver component with a colocated CSS module. Keep state/control logic out
  of panel composition sites; follow repository CSS migration rules if an
  existing styling block must change.
- `apps/web/src/fold/io/foldImportFlow.ts`,
  `components/fold/import/FoldImportOrders.tsx`, and
  `fold/collapse/useFoldCollapse.ts`: CP component resolution and explicit
  acceptance of landed previews.
- `apps/web/src/fold/session/foldSession.ts`: preserve transactional commit and
  handle ownership; add no consent requirement to deterministic replay.
- `apps/web/src/fold/engine/*Wire.ts` and corresponding Fold wasm query APIs
  only where needed to expose completeness or bounded additional candidates.
- Shared analytics, localization, shortcut/action descriptors, and focused
  tests beside the changed behavior.

## Checklist

- [x] Inspect current default-choice, CP-import, preview, and commit behavior.
- [x] Evaluate saved-step editing and defer it from the first version.
- [x] Write the proposed interaction and technical boundaries for review.
- [x] Agree on the UX, including accepting the first preview, inspection, and
  independent CP-region handling.
- [x] Add the shared resolution model and operation adapters.
- [x] Add the required chooser, candidate inspection, and keyboard behavior.
- [x] Gate all new-step commit paths and handle incomplete searches honestly.
- [x] Integrate CP import/collapse and remove inaccessible-candidate limits.
- [x] Verify persisted choices, replay, cancellation, and stale-result safety.
- [x] Complete browser review, appropriate automated checks, and instrumentation.

Deferred follow-up: **Change layer order of a saved step**, with a separate
proposal for previewing downstream changes, affected branches, broken-step
repair, and atomic cancel/undo.


## Implementation and validation record

- All compound operation families use `order_selection`: selected non-order
  choices stay fixed; results return exactness, the selected witness and local
  relations. Indexing does not materialize the product of independent choices.
  Plain mountain/valley operations remain deterministic.
- `useFoldOrderResolution` separates preview navigation from acceptance. Both
  direct and queued canvas Enter are guarded. Back preserves picks; tool/input
  changes invalidate the query. Late worker results cannot accept a new fold.
- CP import/collapse confirms each independent region. The canvas draws the
  chosen folded result and its CP; local stacks expose hidden differences and
  region metadata highlights the component under review. Only the final explicit
  acceptance appends a step. Existing Update from CP retains its revision and
  replay guards and labels the final action as an update.
- Larger searches preserve the selected relations. Candidate previews stay
  visible while the next one loads; acceptance is disabled until it is ready.
  Search increases are bounded at 64,000 orders per component / 12.8 million
  nodes. Found orders remain selectable when a search is incomplete.
- Default Fold spread is off. Existing explicit saved settings are inherited as
  before. Spread controls remain outside the chooser, in the existing sidebar;
  an import at the flat sheet gets a temporary sidebar inspection setting.
  No model migration is needed.
- Native Fold bridge suite: **89 tests passed**, including representative
  replay fixtures, exact/incomplete query metadata and relation-preserving
  reselection. Rebuilt the Fold wasm bridge and exercised its production worker
  bindings in the web tests.
- Affected web suite: **177 files / 1,267 tests passed**, including Fold,
  Fold components, the Step sidebar and analytics. Additional focused runs
  cover queued Enter, explicit acceptance, independent CP regions, canceled
  navigation, stale replies, bounded retries and saved spread inheritance.
- Web typecheck, localization check, production build (including all wasm
  bridges and landing prerender), Rust formatting, and `git diff --check`
  passed. Lint has no errors; the existing StepFilmstrip/TanStack compiler
  warning remains. Clippy passes with the existing unknown-lint warning from
  the workspace toolchain configuration.
- Browser verification at `localhost:5327/fold` used a synthetic four-face CP,
  separate from the user's open models: eight reachable orders, no step on
  cycling or generic Enter, sidebar spread default off and live preview update,
  local stack inspection, ordinary left/right cycling, Escape cancellation, and
  exactly one step on explicit acceptance. The chooser also remains usable at
  640px width; the existing workspace sidebars substantially reduce canvas space
  at that width. The temporary viewport override was reset. Proof:
  `/tmp/ori-layer-order-chooser.jpg`.
- Validation was scoped to the Fold bridge and shared web surfaces. No separate
  native Tauri launch or full unrelated Rust-workspace run was needed; solver
  algorithms, ported upstream behavior and desktop-specific code did not change.
- No commits, pushes, PRs or private model changes were made by this feature.
