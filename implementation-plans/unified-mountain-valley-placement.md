# Unified Mountain and Valley placement

## Goal

Move all of Tuck's authoring capabilities into Mountain and Valley. A folder
chooses the fold line and participating paper, then chooses among valid folded
results when there is more than one. Remove Tuck as a separate authoring tool;
do not require a Tuck toggle, target-layer mode, or a different tool to reach
results that Tuck supports today.

Status: **Implemented and verified locally, October 15, 2026.**
Chipmunk diagramming remains paused; its checkpoint and investigation notes are
saved privately. This work remains local, without a push or PR.

This extends [explicit layer-order resolution](explicit-layer-order-resolution.md).
That implementation only asks for orders within the operation already chosen;
ordinary M/V currently fixes the placement before that question is asked.

## Approach

### 1. Verified problem and preservation contract

The supplied two-fold example was replayed through the production Fold WASM
engine. Its second Valley and its valid Tuck alternative have identical moving
paper, face geometry, exposed paper sides, crease assignments, and lineage.
Their overlap changes from new flap / earlier flap / body to earlier flap /
new flap / body. The original file was not modified.

The current split is substantive:

- `fold/mod.rs` and `fold/apply.rs` implement a closed-form plain fold. The
  default placement puts the moving block on top for Valley, underneath for
  Mountain, relative to the current view.
- `compound/tuck.rs` computes a moving set bounded by stationary target layers,
  imposes placement constraints, and completes remaining layer relations. It
  supports a primary target plus additional targets, not just one pocket wall.
- The existing order-selection bridge and React hook admit compound operations
  only. A deterministic plain fold never enters that chooser.
- The current plain `Placement::Under/Over` is not a replacement for the compound
  Tuck pipeline. Merely exposing that field would lose Tuck's generality.

Acceptance invariant: for the same parent, direction, line, side, and user seed,
every result reachable through the current Tuck UI must be reachable through
M/V. Preserve all existing ordinary M/V results as well. Verify full states and
selected moving paper, not just silhouettes. Keep the old engine entry points
available during implementation as comparison references.

The user selects the seed paper. The engine computes any additional connected
or obstructing paper that must accompany it for each placement. Do not freeze
the ordinary fold's expanded moving set before searching insertions: this is
exactly where a valid tuck can move less paper than the ordinary fold.

### 2. Proposed interaction

1. Select **Valley** or **Mountain**. Use the existing Locate line tools,
   including Existing crease, with the active axiom highlighted as today.
2. Choose the moving side and paper using the existing layer picker. Keep top
   flap defaults, depth selection, explicit flap selection, and Swap.
3. Search the ordinary landing and valid inserted landings automatically.
4. If the complete search has exactly one distinct result, use the ordinary
   preview and Fold confirmation. Otherwise enter the existing required chooser.
5. Cycle full-size folded previews. **Use this order** accepts the currently
   loaded result and adds one Valley or Mountain step. Back preserves the line
   and seed selections; Cancel adds nothing.

Proposed copy:

```text
Choose layer order
‹  Order 1 of 2  ›

Back                         Use this order
```

There is one list combining outer and inserted placements and their completion
orders. Do not expose separate target and order steppers. Multiple targets are
an engine detail, not another mandatory selection stage. Remove the old
"Also tuck under/over layer" checkboxes only after their results are included
in this list.

Each preview must use that candidate's actual moving set, geometry, stack,
action overlay, and layer highlights. Keep seed selection stable while cycling;
show any engine-added paper with the existing added-layer highlighting. If it
differs from the previous candidate, include a concise notice that additional
paper moves, so order cycling cannot conceal a geometry change. Do not relabel
the user's seed as though they selected those extra layers themselves.

Keep the folded result on screen. Spread controls remain in the sidebar, off
by default; no duplicate control or forced spread in this chooser. Preserve
explicit user spread settings on existing steps.

Use the existing resolver's keyboard and acceptance rules: queued Enter cannot
accept an ambiguous result, loading results cannot be accepted, and merely
cycling is not confirmation. Route keys through the shortcut runtime. Update
accessible labels and announcements for changes in result, moving paper, and
search status.

### 3. Engine: search complete operations, not arbitrary final stacks

Introduce a public M/V placement-search surface in `oristudio-fold` beside the
existing fold operations. Inputs are parent state, direction, located line,
moving side, seed, and search limits. The authoring request has no preselected
placement. A returned candidate has:

- A resolved outer or inserted landing, with material-space target witnesses
  for an insertion, including all targets needed for a multi-target result.
- The resolved moving set and normal analysis/action data.
- The exact completion witness, if the placement itself leaves choices.
- A validated endpoint and a stable identity based on semantic state/motion,
  not a transient list index.

Build the search as a union of the ordinary fold and the compound Tuck outcomes:

1. Evaluate the ordinary landing through the existing closed-form path.
2. Discover potential stationary targets and target combinations independently
   of whether the ordinary fold succeeded.
3. For each target set, run Tuck's bounded closure, preparation, placement
   constraints, completion, and admission checks. The target set can change
   closure, so analyze it before deciding geometry and layer order.
4. Enumerate each placement's completion choices through the existing bounded
   layer solver. Preserve multi-target intersections of placement constraints.
5. Deduplicate equivalent results across targets and completion paths. Two
   different targets that produce the same full state and moved material should
   appear once. Distinct moved material or intermediate operation semantics
   must not disappear merely because their visible outlines match.

Use lazy, deterministic target-subset exploration with shared work budgets.
Start with the ordinary candidate, then single-target and multi-target cases;
keep all previously returned candidates stable when extending the search.
Cache preparation by resolved moving set where safe. Do not materialize the
power set up front, cap silently at single targets, or discard combinations
because a target was infeasible by itself. Adding targets changes closure, so
such pruning requires proof.

Candidate discovery must use a conservative target pool. Start with parent
material faces and exclude only provably irrelevant targets; optimize with
geometric bounds after parity coverage exists. Do not use only the ordinary
fold's stationary set or the existing list of individually feasible targets.
Maintain the current per-operation target-count admission limit explicitly.

Preserve material connectivity, stationary-stationary relations, reversal of
the moving block's internal order, direction relative to the view, target
stationarity, required overlap, and all geometric/numerical admission checks.
Every candidate passes the normal gate. Do not weaken guards or feed the final
CP into an unconstrained global reorder: that could reshuffle unrelated paper
or admit arrangements unsupported by either operation.

This describes valid flat endpoints using the existing motion semantics. It
does not add a continuous physical-motion solver or new 3D behavior.

### 4. Search completeness, failures, and responsiveness

Generalize the order chooser's response to count **distinct validated results
across all placements**, not orders for only the first target. Track both the
target search and completion search; the result is exact only when both are
exhausted and duplicates have been removed.

| Search state | Behavior |
| --- | --- |
| One distinct result, exhaustive | Ordinary preview and commit. |
| Several results, exhaustive | Required chooser, exact count. |
| At least one result, incomplete | Required chooser, "N found — search incomplete"; accept a valid result explicitly or Find more. |
| No result, incomplete | Search-limit notice and bounded retry; not "impossible." |
| No result, exhaustive | Relevant refusal with existing actionable fixes. |

An outer-fold refusal does not terminate the insertion search. An insertion
refusal does not hide a valid outer result. Do not report an unrelated failed
target's refusal as the whole operation's failure.

Run search in bounded worker requests, reuse a parent/input-keyed search
session, and release it on cancellation or invalidation. A synchronous WASM
search must return between batches so cancellation is effective. Share the
budget across target combinations and completions rather than resetting it
for every target. "Find more" continues or deterministically extends the
search while preserving the selected candidate by semantic identity.

Invalidate on parent/generation, line/root, direction, side, or seed change.
Discard stale asynchronous responses. Acceptance binds to the exact displayed
candidate and parent; it must never re-run a search and choose candidate zero.

### 5. Saved operations and migration

Separate **authoring intent** (search possible landings) from **saved operation**
(apply this resolved landing). Newly saved operations remain `valley` or
`mountain` and explicitly store their landing. Proposed document shape:

```ts
landing:
  | { kind: 'outer' }
  | { kind: 'against'; targets: SheetPoint[] };
// Existing choices.root and choices.completion remain durable witnesses.
```

`against` uses the existing Tuck meaning relative to the stored direction and
parent view: under the target(s) for Valley, over them for Mountain. It routes
to the existing compound validation, not the simpler plain-placement helper.
Store all target witnesses even when that placement has only one completion.
Completion alone is insufficient to reproduce a different moving-set closure.

Replay applies this resolved recipe directly. It never opens a chooser or
searches for a nearby substitute. Invalid targets or orders report a broken
step. Preserve deterministic replay, lineage, source-step notes, and existing
unfold-to-step behavior.

Normalize existing files at the document boundary:

- Legacy M/V -> same direction and inputs with explicit `outer` landing.
- Legacy Tuck -> M/V according to `direction`, with `target` and all
  `additionalTargets` retained in `against`, plus the original choices.
- Existing `unfold`/`refold` steps retain their saved behavior. New M/V actions
  along Existing crease must participate in placement search; do not bypass it
  through the builder's current automatic conversion to those operation kinds.
- Preserve step IDs, parent links, branches, cursor, annotations, linked CPs,
  document metadata, and unknown data. Do not silently unlock malformed steps.

Use a sequence-format version bump for the new required saved landing and the
repository's versioned reader/writer rules; older readers should lock rather
than ignore semantic fields. Bump the engine behavior version as appropriate
for the new authoring/replay contract and test its cache invalidation.
Migration must preserve every valid step's state fingerprint and descendants;
do not mask differences by regenerating expected fingerprints blindly.

Inventory previously authored local designs, prepare backups, normalize without
regenerating models, and fresh-replay all branches before replacing each file.
Preserve user edits, especially Heart/Cicada and private Chipmunk files. Keep
private derivatives excluded from Git. Leave the user's supplied diagnostic
file unchanged and validate a temporary copy. Migration can remain a small
boundary adapter; preserving an old standalone authoring tool is unnecessary.

### 6. Frontend integration and cleanup

Add a cohesive placement-search binding alongside the Fold canvas/tool hooks.
Extend the existing order resolver to accept candidate operations plus choices,
rather than assuming that cycling only changes `choices.completion` on one op.
Keep session/store bindings out of panel components.

Extend the bridge's operation types, choice admission, query/analysis/action
dispatch, worker calls, preview, commit, and replay together. The current
`is_compound`/`takes` checks and order-selection endpoint reject plain M/V order
choices; changing only the React predicate would be insufficient.

After equivalence is proven, remove standalone Tuck entries from the tool rail,
tool registry/state, menu and command palette, shortcuts, help, and authoring
controls. Fold direction and line-mode bindings must behave consistently with
the existing M/V tools. Show migrated steps as Valley/Mountain; explanatory
step text can still say that a flap goes beneath another layer.

Keep useful Tuck geometry/validation helpers internally. Remove unused frontend
target-selection state after migration. Precrease remains a separate tool and
does not acquire insertion choices. Other compound tools retain their existing
order behavior. Editing the order of already-saved steps remains deferred.

Reuse existing UI primitives and CSS modules; follow the repository's migration
rules for any styles actually touched. Add translations and central analytics
for offered/resolved M/V placements using enums and bucketed counts only; never
target coordinates, file names, or geometry. Avoid duplicate commit events.

### 7. Validation and implementation order

First build the engine union and prove inclusion of old outcomes. Next expose
it through the bridge and saved operation representation, then connect the UI.
Remove the separate Tuck tool only after end-to-end parity is demonstrated.

Required regression cases:

- A synthetic two-flap example equivalent to the reported issue: both results
  offered with identical geometry and different local orders; reverse direction
  and turned-over views covered. Keep the real user file external.
- The existing bottom-layer corner case: ordinary closure moves two layers,
  insertion moves one. The chooser highlights the correct paper for each.
- Multi-target insertion beneath separate pockets, plus infeasible combinations.
  Every result formerly reachable through pinned targets remains reachable.
- A placement that has several completion orders, duplicate target descriptions,
  multiple placements producing different moving sets, and no target at all.
- Valid insertion despite an outer refusal; valid outer despite insertion
  refusals; targets that would move; target not overlapped; invalid connections.
- All seed scopes and supported line modes, axiom-root changes, Existing crease,
  refolding precreases, unfolding along bends, and view transforms.
- Exact versus budget-limited counts after deduplication, including one found
  result with more targets unsearched; shared-budget enforcement and cancellation.
- UI stale-answer rejection, queued Enter, Back/Cancel, double acceptance,
  sidebar-only spreading, keyboard and touch access, and undo/redo.
- Save/open/fresh replay of accepted outcomes and migrated single/multi-target
  Tucks; branches and later unfolds remain identical. Broken choices stay broken.

For small synthetic states, exhaustively compare the new result set with the
union of legacy outer and all admissible legacy target combinations/orders.
Use larger deterministic generated cases to check inclusion under explicitly
reported limits. Measure search work on deep stacks; never infer completeness
from a convenient sample or the initial page of results.

Run focused Rust engine/bridge tests while developing, then workspace tests and
the appropriate format/clippy checks for the engine change. Rebuild the Fold
WASM bridge through `npm --workspace @treemaker/web run build:oristudio-fold-wasm`
before browser verification. Run web lint, typecheck, unit/WASM flow tests,
i18n checks, and the web build for changed bindings. Inspect the real local
example in the browser using a copy. Report any unrelated failures separately.
No upstream solver changes are planned; if they become necessary, inspect the
vendored implementation and add the applicable oracle coverage first.

## Affected Areas

- `crates/oristudio-fold/src/fold/`: plain-fold entry points, analysis, action,
  and existing-crease behavior; new placement-search module beside them.
- `crates/oristudio-fold/src/compound/tuck.rs`, completion support, and tests:
  reuse bounded closure, multi-target placement, and validation.
- `crates/oristudio-fold-wasm/src/{wire,resolve,order_selection,ops_crimp_tuck}.rs`,
  query/compound dispatch, versioning, and bridge tests.
- `apps/web/src/fold/{engine,session,document,orders}/` and
  `apps/web/src/workers/foldSequenceWorker.ts`: search transport, saved recipes,
  migration, stable candidate selection, and replay.
- `apps/web/src/fold/{canvas,tools}/`: M/V builder, seed/crease handling, tool
  state/catalog, preview binding, Tuck cleanup, and user-facing refusals.
- `apps/web/src/components/fold/`, menus, commands, keyboard registry,
  sentence/summary formatting, translations, and analytics.
- Local model inventory/migration evidence; private model files remain ignored.

## Checklist

- [x] Reproduce the supplied example and establish the missing placement choice.
- [x] Inspect ordinary fold, compound Tuck, multi-target support, and chooser seams.
- [x] Record the unified UX, preservation contract, migration, and validation plan.
- [x] Add synthetic equivalence regressions before changing behavior.
- [x] Implement lazy placement enumeration with target-dependent moving sets.
- [x] Include multi-target outcomes and completion choices; deduplicate accurately.
- [x] Expose bounded, resumable search with honest counts and candidate identity.
- [x] Add resolved M/V landing serialization and deterministic replay/migration.
- [x] Connect M/V inputs, layer highlights, action previews, and required chooser.
- [x] Verify Existing crease, hidden flap selection, all seeds, and flipped views.
- [x] Remove the standalone Tuck UI after parity checks pass.
- [x] Update summaries, localization, accessibility, keyboard flows, and analytics.
- [x] Migrate existing local designs with backups and fresh replay of all branches.
- [x] Finish production build and final browser verification.


## Implementation evidence — October 15, 2026

- `FoldPlacementSearch` enumerates the legacy outer/Tuck union with conservative
  adjacency/overlap pruning, lazy target subsets, completion witnesses and exact
  full-state/moving-set deduplication. Existing candidates keep their indices as
  search continues. The saved landing and completion are the durable identity.
- Worker batches share a node allowance and a 150 ms deadline. Interrupted
  targets stay pending; incomplete searches never claim uniqueness. A new input
  or cancellation releases the parent-scoped authoring search. Replay never
  searches.
- Mountain/Valley use the required order chooser, including Existing crease.
  Analysis and action overlays come from the selected full operation. A notice
  identifies lists whose candidates move different paper. Spread stays in the
  sidebar. The rail and shortcut catalog no longer expose Tuck. Internal legacy
  Tuck engine/adaptor types and their comparison tests remain available; no
  standalone Tuck entry point is offered in the application.
- Sequence format 2 stores `landing: outer | against`; engine behavior version 6.
  Legacy Tucks normalize to M/V, including all targets and completion choices.
  `fh1` keeps its old semantic spelling so saved unfolds and Diagram links keep
  working. Unknown inputs remain locked/rejected, not silently discarded.
- The native Heart fixture's two-target insertion is reachable by cycling the
  Valley chooser and matches the legacy state fingerprint exactly. Small-model
  tests exhaust all target subsets independently of the new pool, over both
  directions, start sides, turned/rotated views, all/depth/flap seeds and
  precreases. Search-budget tests preserve the candidate prefix on continuation.
- The external user example yields exactly two distinct replayable placements.
  Its original file is unchanged. The browser also displayed both arrangements
  for an equivalent overlapping-flap fold and required explicit acceptance.

### Local migration

`node scripts/fold/migrate-landings.mjs <models-directory> --write` backs up
original bytes, checks for concurrent edits, minimally rewrites known operations,
and fresh-replays both old and new recipes over every branch before replacement.

All **119** `.osf` files under the canonical models directory were migrated:
**918** operation spellings changed, **2,472** saved nodes replayed identically,
with zero broken, changed or locked nodes. IDs, parents, source notes, appearance,
expected fingerprints and CP snapshots are preserved. No diagrams were advanced.
Private files and backup/evidence artifacts remain ignored.

Local evidence (not committed):

- `artifacts/fold-placement-migration/2026-10-15T20-33-31.958Z/report.json`
- `artifacts/fold-placement-migration/2026-10-15T20-33-31.958Z/originals/`
- `artifacts/fold-placement-audit/user-example-results.json`
- `artifacts/fold-placement-audit/valley-order-choice.png`

### Validation

- Focused Fold/components/keyboard/analytics web suite: **1,342 passed**;
  the subsequently added M/V continuation/release test and migration suite also pass.
- Fold engine suite: **344 passed** before two additional exhaustive-union and
  budget tests, both of which pass. Fold bridge: **12 unit tests + 1 new placement
  integration test passed**.
- TypeScript, web lint (one existing StepFilmstrip compiler warning), i18n checks,
  Rust formatting and targeted clippy pass. Clippy emits the existing toolchain
  warning about an unknown configured lint.
- Production `npm run build:web` passes, including WASM rebuilds and landing
  prerender. Final browser verification offers both orders for the overlapping
  Valley fold, requires acceptance, and saves the inserted result as `VALLEY`.
- `cargo test --workspace` stops at `fold_vertex_oracle`: its two existing vertex
  fixtures require a unique order but receive six from the earlier swivel/order
  changes. This work does not change vertex operations or those fixtures.

## Follow-up — October 20, 2026: forced folds and Find more orders

A plain mountain fold in half of a precreased flat sheet (69 faces) asked for
a layer order it did not have a choice of: "Order 1 of 1 found", search
incomplete, on every press of Find more orders. The target pool held one
target per stationary face the half landed on (33–51), the search tried their
subsets 128 a batch, and every one turned the hinge the wrong way and was
discarded, so the search could never call itself exhaustive.

- The search now counts, up front and without a clock, every order its exact
  selection can land in: the tuck preparation of those flaps, each hinge
  seeded in the requested direction, placed against nothing, under a node
  budget. Every landing the search can find is one of them, so it is
  exhaustive once its candidates cover them all, and a forced fold (one order;
  the precreased half above needs no search node) before any target is tried.
  Replay is unchanged: it never searches.
- A query names how long its batch may search (`searchMs`); the bridge spends
  it in calls of at most 150 ms and says while it is still searching. The
  worker runs those calls as a cancellable search in slices. Each press of
  Find more orders asks four times longer than the last (150 ms up to 9.6 s,
  then 9.6 s more each press), shows that it is searching with Stop, and says
  there are no other orders once a search for more finishes.
