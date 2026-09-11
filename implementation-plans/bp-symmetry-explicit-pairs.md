# BP Symmetry: Explicit Pairs Only

## Goal

"Unpair from mirror" currently changes what the UI says and nothing that the
editor does. Every behaviour that mirrors an edit — tree drag, delete, edge
length, flap drag, resize, reshape, the drag side-clamps, the partner marks, the
drag preview, and the optimizer's pair resolver — asks `mirrorBpTreeVertexId`,
whose third branch pairs a vertex with whatever vertex sits at its reflection.
Unpair deletes the explicit record and moves nothing, so the two vertices are
still reflections, the third branch rediscovers the partner, and every mirrored
edit keeps them reflected. The trap never opens. Only the three explicit-only
readers — `partnerOf` in the tree pane, `unpairableId` in the packing pane, and
the dotted pair segment — say "unpaired".

After this plan:

- A vertex mirrors another vertex **only** through an explicit, persisted pair.
  Nothing at edit time infers a partner from position: not the BP tree pane,
  not the packing pane, not the optimizer, not ExplOri.
- Geometric matching survives as a **pair-creation tool the user invokes**:
  *Pair with mirror* on one vertex, *Pair all mirrored* on the design.
  Mirror-add keeps recording pairs exactly as it does today.
- The on-axis self-mirror stays a positional fact, unchanged: a vertex on the
  mirror line is its own reflection while it sits there, and the toggle remains
  the way to move it off.
- UI and behaviour read one predicate, so the Unpair button can never again
  disagree with the drag.

Root cause was traced on 2026-09-09 and reproduced against the library with a
temporary vitest: after `removeBpTreeSymmetryPair`, `buildMirroredBpTreeUpdates`
still emits the partner's move, `bpTreeMirrorHeldIds` still holds the dragged
vertex on its side, and `bpTreeDeleteIdsWithSymmetry` still returns both ids.

## Approach

### Why the model, not the button

The pairing model has two sources of truth under the precedence "explicit, else
infer". Under that rule the explicit list can only *widen* pairing; there is no
way to record "these two are not partners", which is precisely what commit
20ef56e2 said Unpair was for ("there has to be a way to say these two are not
partners without deleting a flap").

The design was reasonable when it was made. `bp-tree-symmetry-draw.md` D2 made
pairs session-only by decision, so D3's geometric inference was the only pairing
that survived a reload. Pairs became persisted design state on 2026-08-03
(`bp-symmetry-persistence.md`, which already calls inference "the fragile
fallback"), and the fallback stayed. The same day Unpair landed, commit
b2ff41ae removed the explicit-pairing panel because "drawing already says it",
so both philosophies have coexisted since.

A negative "exclusions" record would make Unpair work but adds a third source
of truth that must survive moves, deletes, undo, and file round-trips, and it
leaves the UI and the behaviour reading different lists. Removing edit-time
inference removes the contradiction instead of managing it.

The target shape already exists in this codebase. TreeMaker's
`symmetryAuthoring.ts` resolves a mirror as *persisted pair condition, else
explicit authoring pair, else self when on the axis* — it has no geometric
partner branch. D3 said it was porting that; the BP adapter added the third
branch on top of it.

### The model after

`mirrorBpTreeVertexId(tree, pairs, axis, id)` resolves, in order:

1. the explicit partner, if that vertex still exists;
2. `id` itself when the vertex sits on the axis within
   `BP_TREE_SYMMETRY_TOLERANCE`;
3. `null`.

The name and signature stay, so every existing caller keeps compiling and the
behaviour change reads as what it is: the deletion of one branch.

Two new pure functions carry what that branch used to do, as an explicit step:

- `inferBpTreeSymmetryPartner(tree, pairs, axis, id)` — the vertex *Pair with
  mirror* would pair `id` with, or `null`. `id` must be unpaired and off-axis;
  the candidate must be unpaired, off-axis, within tolerance of `reflect(loc)`,
  and the match must be **mutual-best** (a's nearest candidate is b and b's is
  a). Mutual-best turns the ambiguity D4 worried about ("two vertices near
  `reflect(loc)`") into a refusal instead of a guess.
- `inferBpTreeSymmetryPairs(tree, pairs, axis)` — *Pair all mirrored*: the same
  rule over every unpaired vertex, each used at most once, returning the new
  pair list.

The invariant, to be written into the module header: **a pair exists because one
of three verbs made it** — mirror-add, Pair with mirror, Pair all mirrored —
**and stops existing through Unpair, delete-pruning, or load-pruning.** Nothing
else reads position to decide pairing.

### Decisions

**D1 — No silent pairing on open.** A `.bps` import gets BP Studio semantics:
nothing mirrors until the user pairs it. That is upstream parity for a format
with no pairing concept, and it is what the user who filed this expected
("things move that I did not ask to move"). `.osf` files saved before
2026-08-03 lose their auto-mirroring until *Pair all mirrored*, which is one
click. There is no legacy signal to key on anyway — `nativeProjectFile.ts`
collapses a missing symmetry block into the default before the slice sees it —
and the feature was three days old when persistence landed. *Alternative
considered:* thread `null` through for a missing block and materialize once at
load. Rejected: it is a fourth pair-creation path that runs with nobody
watching, which is the class of surprise this plan removes.

**D2 — The toggle gets no side effect.** Turning mirror draw on does not pair
anything. Commit 9c1c38f2 fixed the toggle's contract as "decides exactly one
thing: whether the next node is drawn with a twin". A materialize-on-enable
would also mean *unpair → toggle off → toggle on* silently re-pairs.

**D3 — The optimizer reads the same pairs.** `resolveOptimizerSymmetry` stops
inferring. A leaf with no explicit pair that is not on the axis is unresolved,
and the message points at the Pair verbs rather than at drawing. Without this,
Unpair still never reaches the optimizer, which the root-cause session found
was already the case today.

**D4 — One predicate in the shared host.** `TreeSymmetryHost` loses
`resolveMirrorOf`. It keeps `partnerOf` (explicit) and `isOnAxis`, and gains
`pairableWith(id)` and `pair(id)`. The editor's two `resolveMirrorOf` callers
become: the drag preview reads `partnerOf`; the add-leaf ghost's mirror parent
reads `partnerOf(parent) ?? (isOnAxis(parent) ? parent : null)`, which is
exactly what the slice's mirror-add computes once branch three is gone.

**D5 — ExplOri changes in the same PR.** The host interface change forces a
touch there, and leaving `mirrorExploriNodeId` inferring while the host stops
would recreate the "preview says no, commit says yes" mismatch for one release.
Its surgery is four call sites plus the same two new verbs.

**D6 — Self-mirror stays geometric, and toggle-gated where it refuses a
gesture.** `bpIsSelfMirrored`, `isOnAxis`, and `selfMirrored` are unchanged. It
is a fact about where a node is, there is no user-facing "un-self-mirror" to
promise, and the toggle is the documented way to drag a node off the line.

**D7 — One PR, one commit per phase.** The interface change couples the BP and
ExplOri work, and a half-landed state is worse than a larger review.

### UX

- **Per-vertex verb, one slot.** The slot after the Symmetry toggle — tree
  toolbar, packing toolbar, and both context menus — shows *Unpair from mirror*
  when the selection has an explicit partner, *Pair with mirror* (icon `Link`)
  when it has none but `pairableWith` resolves, and nothing otherwise.
- **Design-level verb.** *Pair all mirrored* in the packing pane's symmetry
  menu under the fold buttons, showing the count it would create and disabled
  at zero; the same row in the tree pane's empty-canvas context menu, which
  already carries the mirror toggle.
- **Status copy.** The unresolved message becomes: "Nothing is paired with
  {names}. Select it and choose Pair with mirror, use Pair all mirrored, draw it
  with mirror draw on, or move it onto the mirror line."
- **Undo and dirty.** Pair and Pair all record through `recordSymmetryHistory`
  like Unpair, labelled "Pair with mirror" and "Pair all mirrored", and set
  `dirty`.
- **Analytics.** Unpair has no event today, and these rows do not dispatch
  through a `MENU_ACTION_ID`, so the chokepoint does not see them. Add one
  hand-placed event at the store actions: `bp symmetry pair changed` with
  `action: 'pair' | 'pair_all' | 'unpair'` and, for pair-all, a bucketed
  `pair_count`. If mirror-add is not otherwise captured, `'mirror_add'` joins
  the enum. Enums and buckets only, per `docs/analytics.md`.
- **i18n.** Three new strings (two verbs, one message): `i18n:extract`,
  translations in the eight non-English locales, `i18n:check`.

### What the tests say now, and what they will say

The library spec encodes the contradiction: `bpTreeSymmetry.test.ts` passes
"infers the reflected vertex geometrically when unpaired", and no store test
asserts that a move after Unpair leaves the partner alone. The existing
"unpaired" fixtures pass only because their lone vertex has no geometric twin.

- Seven store and library tests titled "honours an explicit pair over the
  geometric guess" become "only the explicit pair counts": an explicit pair to a
  vertex that is *not* at the reflection still mirrors, and a vertex at the
  reflection with no pair does not.
- `bpOptimizerSymmetry.test.ts` "infers a partner from where the flap is drawn"
  flips to unresolved with the Pair message.
- `BpPackingPanel.test.tsx` "draws whenever mirror draw is on, with no pairs
  needed" keeps its assertion (the axis line never depended on pairs) and loses
  its comment about inference doing the work for `.bps` designs.

Leftover to delete while there: the resolver accepts a self-pair `{v1: n, v2:
n}` as an on-axis declaration "when inference is off". That mode no longer
exists, and no path can produce such a pair — `addBpTreeSymmetryPair`,
`validateBpDocumentSymmetry`, and `filterBpTreeSymmetryPairs` all reject it.

## Affected Areas

- `apps/web/src/lib/bpTreeSymmetry.ts` — remove branch three; add the two
  inference-on-request functions; module doc.
- `apps/web/src/lib/bpTreeSymmetry.test.ts` — flip three tests; add coverage
  for the new functions.
- `apps/web/src/lib/bpPackingSymmetry.ts` — no code change expected
  (`buildMirroredBpFlapMoves` and the side constraints call the lookup); one
  test retitled.
- `apps/web/src/lib/bpOptimizerSymmetry.ts` (+ test) — explicit-or-self;
  unresolved copy; drop the self-pair declaration.
- `apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts` — two new
  actions; analytics; readers unchanged in code.
- `apps/web/src/store/workspaceStore/slices/oristudioBpSymmetric{FlapMove,
  Resize,Delete}.test.ts`, `oristudioBpFlapReshape.test.ts`,
  `oristudioBpSymmetryDocument.test.ts` — Phase 0 regressions; retitled tests;
  pair/pair-all coverage.
- `apps/web/src/tree-editor/host.ts`, `TreeEditor.tsx`,
  `TreeEditorToolbar.tsx`, `treeContextMenu.ts` (+ tests,
  `hostContract.test.tsx`) — interface, preview, ghost, slot, menus.
- `apps/web/src/hooks/useBpTreeSymmetry.ts`, `useBpPackingSymmetry.ts`,
  `useBpTreeEditorHost.ts` — new bindings; drop `resolveMirrorOf`.
- `apps/web/src/components/panels/BpPackingPanel.tsx`,
  `BpPackingSymmetryMenu.tsx`, `apps/web/src/lib/bpPackingContextMenu.ts`
  (+ tests), `components/panels/viewportToolbarLayout.test.ts`.
- `apps/web/src/components/BpOptimizerModal.tsx` (+ test) — status copy.
- `apps/web/src/explori/symmetry.ts`, `useExploriTreeHost.ts`,
  `deletion.ts`, `apps/web/src/store/workspaceStore/slices/exploriSlice.ts`
  (+ tests) — the same change.
- `apps/web/src/analytics/events.ts`, `docs/analytics.md`.
- `apps/web/public/locales/*/panels.json` — three strings × nine locales
  (the existing `bpPacking.unpair` / `bpTree.unpair` keys live there).
- `implementation-plans/bp-tree-symmetry-draw.md`,
  `implementation-plans/bp-design-pane-architecture.md` — supersession notes.

Not touched: `apps/web/src/lib/symmetryAuthoring.ts` (already the target
shape), the `.osf` schema (pairs are already persisted; nothing new is written),
the Rust kernels, Tauri.

## Checklist

### Phase 0 — Pin the bug (these fail on `main`)

- [x] Packing: pair 1–2, `unpairOristudioBpTreeSymmetry(1)`, move flap 1 →
      no single move issued for flap 2; same for
      `resizeOristudioBpLayoutFlap` and `reshapeOristudioBpFlap`.
- [x] Tree: after Unpair, `moveOristudioBpTreeVerticesWithSymmetry` moves one
      vertex; `setOristudioBpTreeEdgeLength` touches one edge;
      `deleteOristudioBpTreeNode` deletes one id.
- [x] Library: `mirrorBpTreeVertexId(tree, [], axis, id)` with a vertex at the
      reflection returns `null`; an on-axis vertex still returns itself.
- [x] ExplOri: after `unpairExploriNode`, the mirrored-updates helper returns
      only the primary move.

### Phase 1 — Library

- [x] Delete branch three of `mirrorBpTreeVertexId`; rewrite its doc, the
      tolerance doc, and the module header with the three-verbs invariant.
- [x] Add `inferBpTreeSymmetryPartner` and `inferBpTreeSymmetryPairs`. Tests:
      mutual-best; two candidates within tolerance → `null`; already-paired and
      on-axis vertices skipped; each vertex used once; tolerance edge; the
      partner of a partner is not re-proposed.
- [x] Retitle and re-fixture the seven "honours an explicit pair over the
      geometric guess" tests; flip the three inference tests.
- [x] `explori/symmetry.ts`: same deletion in `mirrorExploriNodeId`; same two
      functions; tests.

### Phase 2 — Store

- [x] `pairOristudioBpTreeSymmetry(vertexId)` and
      `pairAllOristudioBpTreeSymmetry()`: undoable via
      `recordSymmetryHistory`, `dirty: true`, no-op and no history entry when
      nothing pairs. Tests beside `oristudioBpSymmetryDocument.test.ts`.
- [x] Confirm each reader is explicit-or-self with no code change:
      `bpMirrorPartnerId`, `moveOristudioBpTreeVerticesWithSymmetry`,
      `deleteOristudioBpTreeNode`, `setOristudioBpTreeEdgeLength`,
      `resizeOristudioBpLayoutFlap`, `reshapeOristudioBpFlap`,
      `moveOristudioBpLayoutFlapsWithSymmetry`,
      `addOristudioBpTreeLeafWithSymmetry`. Phase 0 goes green here.
- [x] Analytics event in `events.ts` and `track(...)` at the three actions;
      taxonomy note in `docs/analytics.md`.
- [x] `exploriSlice.ts`: `pairExploriNode`, `pairAllExploriNodes`; the move,
      add-leaf, and delete paths and `explori/deletion.ts` need no code change.

### Phase 3 — Shared tree editor and BP UI

- [x] `tree-editor/host.ts`: drop `resolveMirrorOf`; add `pairableWith`,
      `pair`; document the invariant on the interface.
- [x] `TreeEditor.tsx`: preview reads `partnerOf`; add-leaf ghost reads
      `partnerOf ?? on-axis self`; the toolbar and vertex-menu slot chooses
      Pair or Unpair; `treeCanvasMenuItems` gains Pair all mirrored.
- [x] `TreeEditorToolbar.tsx`, `treeContextMenu.ts`, `TreeEditorCopy`
      (`pair`, `pairAll`); tests in `treeContextMenu.test.ts`,
      `hostContract.test.tsx`, and the `canPair` permutation in
      `viewportToolbarLayout.test.ts`.
- [x] `useBpTreeSymmetry.ts`, `useBpPackingSymmetry.ts`: `pairableWith` /
      `pairableId`, `pair`, `pairAllCount`, `pairAll`; drop `resolveMirrorOf`.
- [x] `BpPackingPanel.tsx` symmetry toolbar group, `bpPackingContextMenu.ts`,
      `BpPackingSymmetryMenu.tsx` (Pair all row with count);
      `useBpTreeEditorHost.ts` and `useExploriTreeHost.ts` copy.
- [x] i18n: `i18n:extract`, translate the three strings in eight locales,
      `i18n:check`.

### Phase 4 — Optimizer

- [x] `resolveOptimizerSymmetry`: explicit-or-self only; new unresolved copy;
      delete the self-pair declaration branch and its test; flip "infers a
      partner from where the flap is drawn".
- [x] `BpOptimizerModal.test.tsx` and the symmetry-menu status: a design with
      mirrored-but-unpaired flaps reads unusable with the Pair message; after
      Pair all it reads ready.

### Phase 5 — Docs and memory

- [x] `bp-tree-symmetry-draw.md` D3: add "superseded by
      `bp-symmetry-explicit-pairs.md`" without rewriting the history.
- [x] `bp-design-pane-architecture.md` ~line 201: the "degrades to geometric
      inference after reload" note is obsolete.
- [ ] Update the session memory `bp-unpair-noop-geometric-inference` to point
      at the landed PR.

### Validation

- [x] `npm run lint:web`, `npm run typecheck:web`, `npm run i18n:check`, and
      `npm run test:web` (Node 22, run from `apps/web`).
- [ ] Browser, owner Zach: tree pane — draw with mirror draw on, Unpair, drag
      the left node: the right node stays; set a length 2→3: the partner edge
      stays; Pair with mirror restores both. Packing pane — Unpair, drag and
      resize: the partner stays; `.bps` import: nothing mirrors until Pair all;
      the optimizer status flips from unusable to ready after Pair all.
      ExplOri tree: the same Unpair-then-drag check.

## Outcome

Implemented 2026-09-10 on `claude/box-pleating-mirroring-bugs-a5839f`, one
commit per phase (`eee45395` tests, `635fdf31` library, `3cfd4367` store,
`461c70d4` UI, `ceab728e` optimizer), full web suite green at each step.

The user-visible rules now:

- A vertex mirrors another only through a pair. A pair is made by mirror-add,
  *Pair with mirror*, or *Pair all mirrored*, and broken by *Unpair from
  mirror*, by deleting a member, or by a load that no longer has both vertices.
  Where two vertices happen to sit never pairs them.
- After Unpair, the tree drag, the length edit, the flap drag, resize, reshape,
  delete, the drag clamps, the partner marks, the drag preview and the optimizer
  all treat the two as unrelated.
- The slot after the Symmetry toggle shows Unpair or Pair, never both. *Pair all
  mirrored* lives in the packing pane's symmetry menu (with the count it would
  make, disabled at zero) and the tree canvas's context menu.
- A vertex on the mirror line is still its own mirror while it sits there; the
  toggle remains the way to move it off.
- A `.bps` import mirrors nothing until paired. Files saved before pairs were
  persisted (before 2026-08-03) likewise need one *Pair all mirrored*.

Where the work departed from the plan above:

- The analytics event is `symmetry pair changed`, not `bp symmetry pair
  changed`: it is shared by the box-pleat and ExplOri trees and carries
  `design_kind`, following the `design sent to edit` precedent.
- Phase 4 went one step further than "new unresolved copy". The resolver's three
  refusals were raw English; it now reports a structured
  `OptimizerSymmetryProblem` and one describer, `symmetryProblemLabel`, puts it
  into words for the status line, the dialog and the refused run — so the
  wording change also closed the only unlocalized copy on the symmetry path.
- The host contract gained `pairAllCount` and `pairAll` as well as
  `pairableWith` and `pair`, so the tree canvas menu can offer Pair all without
  a second store binding in the editor.
- The store test fixtures that had `pairs: []` beside two leaves at reflected
  positions now declare the pair. Seven tests titled "honours an explicit pair
  over the geometric guess" became "follows the explicit pair, not the vertex
  at the reflected spot".
