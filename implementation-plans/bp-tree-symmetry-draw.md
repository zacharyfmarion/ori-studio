# BP-tree symmetry draw — architecture & implementation plan

**Goal.** Bring TreeMaker's symmetry-draw experience to the Box-Pleating **tree**
view (`BpTreePanel`): pick a symmetry axis (book / diagonal / custom), toggle a
mirror-draw mode, and have leaf **adds** and vertex **drags** on one side reflect
automatically to the other — with a live axis overlay and mirror hover preview.

This is item 5 of the app follow-ups ([app-followups-triage.md](app-followups-triage.md)).
It is the largest item and, unlike the others, is **not a mechanical port** — the BP
tree's metric semantics change what "mirror" means. This document exists to settle
the architecture *before* writing code, optimizing for long-term maintainability.

---

## 1. Why this isn't a copy-paste of DesignPanel

| | TreeMaker (`DesignPanel`) | BP tree (`BpTreePanel`) |
|---|---|---|
| Node model | free 2-D positions (`node.loc`) | metric tree: fixed **unit** leaves, edge lengths |
| Add | `add_node` at an arbitrary point | `addLeaf(parent)` (unit length) then reposition |
| Move | moves **one** node to a point | **rotates a whole subtree** rigidly around its parent (root drag translates the tree) |
| Symmetry driver | store actions `addNodeWithSymmetry` / `moveNodeWithSymmetry` | **none exist** |
| Pairing state | store `symmetryAuthoringPairs` (ephemeral) **+** persisted `nodes_paired` conditions | must be **ephemeral only** (user decision — no `.bps`/document changes) |
| Axis config | persisted in the project (`paper.symLoc`, `symAngle`, `hasSymmetry`) | must be **ephemeral only** |

The consequence that drives most decisions below: **a BP drag moves a set of
vertices (a rotated subtree), not a single node.** Mirroring it means reflecting
*every* moved vertex onto its paired vertex — so pairing has to span the subtree,
not just the grabbed leaf.

---

## 2. What we can reuse as-is

- **Pure geometry** in [symmetryAuthoring.ts](../apps/web/src/lib/symmetryAuthoring.ts):
  `SymmetryAxis`, `axisDirection` (private), `projectOntoSymmetryAxis`,
  `reflectPointAcrossSymmetryAxis`, `distanceToSymmetryAxis`, `symmetrySide`,
  `snapPointToSymmetryAxis`. These take only `Point` + `SymmetryAxis` — zero
  `TreeProject` coupling.
- **Presets** in [symmetryPresets.ts](../apps/web/src/lib/symmetryPresets.ts):
  `SymmetryPreset` (book/diagonal), variants, `paperCenter`, angle↔option mapping,
  `symmetrySelectValueForState`. Fully reusable.
- **Undo batching**: `runBpTreeMutation` already commits a compound op as one
  history entry (see the add-leaf = add + reposition precedent). No new plumbing.
- **UI shell patterns**: `DesignSymmetryMenuButton`, the axis `<line>` overlay, and
  the ghost-edge hover preview in `DesignPanel` are the visual template.

---

## 3. Key architectural decisions

### D1 — Extract a shared, model-agnostic geometry module ✅ recommended

Create `lib/symmetryGeometry.ts` holding the pure functions listed in §2 (move them
out of `symmetryAuthoring.ts`; re-export from there so `DesignPanel`'s imports don't
churn). Both the TreeMaker adapter (`symmetryAuthoring.ts`) and the new BP adapter
(`bpTreeSymmetry.ts`) import from it.

*Why:* one source of truth for the math; avoids a second, drifting copy of
reflect/snap/side. Cheap, high-leverage, low-risk.

*Rejected:* over-generalizing `symmetryAuthoring.ts` into one module parameterized
over both node models. TreeProject (free nodes, persisted conditions) and
`OristudioBpTree` (metric, ephemeral) differ enough that a single generic module
would be a leaky abstraction. Prefer **shared pure core + two thin adapters.**

### D2 — Symmetry state lives in the BP **store slice**, ephemeral ✅ DECIDED

Add to `oristudioBpSlice` (not persisted to the document/snapshot, not in `.bps`):

```ts
oristudioBpSymmetry: {
  enabled: boolean;
  axis: SymmetryAxis | null;        // derived from the active preset + sheet center
  preset: SymmetrySelectValue;      // 'none' | 'book' | 'diagonal' | 'custom'
  pairs: SymmetryAuthoringPair[];   // ephemeral vertex pairings
}
```

*Why (revising the triage note's "panel-local map"):* the paired **mutations must be
store actions** — they call the runtime and need atomic undo via `runBpTreeMutation`,
and they need the axis + pairs at mutation time. Putting axis/pairs in the store makes
them the single source the actions read, mirrors TreeMaker's proven
`symmetryAuthoringPairs` pattern, and survives panel remounts (workspace switches) —
which panel React state does not. It is **still ephemeral**: nothing lands in the
document, so the user's "don't persist it" requirement holds. Panel-local state would
force the mutation logic up into the component or a fragile prop-drill.

*Filtering:* every BP tree mutation must prune `pairs` to vertices that still exist
(port `filterSymmetryAuthoringPairs`), so deletes/loads can't leave dangling pairs.

### D3 — Pairing = explicit pairs + geometric inference

A vertex's mirror is resolved by (in order): an explicit ephemeral pair (recorded on
mirror-add), else geometric inference — a vertex whose `symmetrySide == 0` is its own
mirror (on the axis), and a vertex with a partner at `reflect(loc)` (within tolerance)
pairs to it. Port `findMirrorNodeId` semantics against `OristudioBpTree`.

*Why include geometric inference:* lets symmetry work on a tree that was built (or
loaded) before mirror mode was enabled, not only on branches drawn inside it — matching
TreeMaker's `mirroredNodeForEdgeEndpoint`.

### D4 — Metric mirror semantics (the crux)

**Mirror-add** (`addOristudioBpTreeLeafWithSymmetry`): add the leaf to `parent` at
`loc`; if `parent` is on-axis or has a mirror `parent'`, also add a leaf to `parent'`
at `reflect(loc)`, record the new pair, select both. One `runBpTreeMutation`. This is
a faithful analogue of `addNodeWithSymmetry`.

**Mirror-move** (`moveOristudioBpTreeVerticesWithSymmetry`): the panel already computes
`updates: {id, loc}[]` for the whole dragged subtree. The action reflects it:

- For each `{id, loc}` in updates, look up `mirror(id)`; if found, emit
  `{ id: mirror(id), loc: reflect(loc) }`.
- Apply the union (primary updates + mirrored updates) in one mutation. Skip a
  mirrored update whose target is inside the primary set (a self-paired / on-axis
  vertex moves once).

Decision — **what if the subtree isn't fully paired?** ✅ DECIDED: **partial mirror** —
mirror the vertices that *do* resolve a pair, and leave the rest, rather than refusing
the whole drag. Least surprising, keeps the tool usable on partially-symmetric trees.

Root drag (rigid translation) mirrors the same way: reflect each translated vertex to
its pair; an on-axis root translated along the axis stays consistent, translated off
the axis simply moves the whole mirrored tree too.

### D5 — Reusable presentational `SymmetryMenuButton`

Extract a **presentational** menu component (props: current mode/angle/loc, enabled,
mirror active, callbacks) shared by both panels, or — if `DesignSymmetryMenuButton` is
too entangled with TreeMaker specifics — a BP-specific button that reuses the same CSS
classes. Prefer extraction if the diff is small; otherwise duplicate the ~1 screen of
JSX and share only styles. **Decide during implementation** by attempting the
extraction first.

### D6 — Mirror tool mode in `BpTreePanel`

`BpTreePanel` has no explicit tool modes today (select + click-to-add). Add a minimal
`toolMode: 'select' | 'symmetry'` local to the panel; `symmetry` turns on the axis
overlay, the mirror hover preview, and routes add/drag through the `*WithSymmetry`
store actions. This matches `DesignPanel`'s `toolMode === 'symmetry'`.

---

## 4. Proposed module / layer map

```
lib/symmetryGeometry.ts        (NEW) pure math: axis, reflect, project, side, snap
lib/symmetryPresets.ts         (reuse) book/diagonal/custom, paper center
lib/symmetryAuthoring.ts       (slim) TreeMaker adapter; re-exports geometry
lib/bpTreeSymmetry.ts          (NEW) BP adapter: axisForSheet(preset), mirror lookup
                                     over OristudioBpTree + pairs, buildMirroredUpdates,
                                     filterPairs
store/.../oristudioBpSlice.ts  (edit) ephemeral symmetry state + two paired actions +
                                     pair-filtering hooked into every tree mutation
components/panels/BpTreePanel.tsx (edit) tool mode, menu button, axis overlay, hover
                                     preview, route add/drag to *WithSymmetry
components/panels/SymmetryMenuButton.tsx (NEW, maybe) shared presentational control
```

Store actions to add (mirroring `editingSlice`):
`setOristudioBpSymmetry(update)`, `addOristudioBpTreeLeafWithSymmetry(parentId, loc)`,
`moveOristudioBpTreeVerticesWithSymmetry(updates, dragging)`.

---

## 5. Phased implementation

> **Progress:** Phases 1–5 landed (geometry extraction, BP adapter + tests, store
> state + paired mutations, tool menu + axis overlay, add/drag wiring, shared menu
> CSS). Deferred to a follow-up: the **mirror hover ghost** (Phase 5's preview) and
> Phase 6 polish (empty-state, custom-angle field). Needs browser verification.


1. **Geometry extraction (D1).** Move pure fns to `symmetryGeometry.ts`, re-export
   from `symmetryAuthoring.ts`. No behavior change; `DesignPanel` + tests stay green.
   *Unit tests: reflect/snap/side round-trips (move existing coverage).*
2. **BP symmetry adapter + store state (D2, D3).** `bpTreeSymmetry.ts`
   (`axisForSheet`, `mirrorVertexId`, `buildMirroredUpdates`, `filterBpSymmetryPairs`)
   + ephemeral slice state + `setOristudioBpSymmetry` + pair-filtering in
   `runBpTreeMutation`'s commit path. *Unit tests for the adapter — pure and highly
   testable (axis from sheet, mirror lookup incl. on-axis, mirrored-update building).*
3. **Paired mutations (D4).** `addOristudioBpTreeLeafWithSymmetry` and
   `moveOristudioBpTreeVerticesWithSymmetry`, each one `runBpTreeMutation`. *Store-level
   tests with a fake runtime if feasible; else covered via the adapter + browser.*
4. **UI: mode, menu, axis overlay (D5, D6).** Tool-mode toggle, the symmetry menu
   (presets/flip/custom/enable), and the axis `<line>` overlay in `BpTreePanel`.
5. **UI: mirror hover preview + wire add/drag.** Ghost mirror edge on hover; route
   `onCanvasAddPointerUp` and `finishDrag` through the `*WithSymmetry` actions when
   mirror mode is on. *Browser verification (Zach): draw a branch → mirrors; drag a
   subtree → pair follows; on-axis vertex stays put; book vs diagonal; undo is one step.*
6. **Polish:** empty-state (enabling symmetry with an asymmetric tree), delete keeping
   pairs consistent, status messages ("Added mirrored branch").

Phases 1–3 are tool-verifiable (types + unit tests) and can land independently; 4–6 are
the browser-verified interaction layer.

---

## 6. Risks & open questions

- **Subtree pairing completeness (D4).** The mirrored drag is only as good as the
  pairing. Branches drawn *in* mirror mode are fully paired; trees built before
  enabling it rely on geometric inference, which can be ambiguous when two vertices sit
  near `reflect(loc)`. Mitigation: tolerance-gated inference + partial-mirror (DECIDED).
- **Engine invariants on mirror-add.** Each `addLeaf` reseeds the parent's flap
  (flap⟺leaf invariant, per the BP oracle notes). Two adds in one mutation must leave
  the engine consistent — validate the second add doesn't invalidate the first's flap.
- **Diagonal sheet interaction.** With the new diagonal-grid work, a "diagonal"
  *symmetry* axis on a *diagonal* sheet needs a sanity check (axis is in tree/paper
  coordinates, independent of grid rendering, so expected to be orthogonal — verify).
- **Reflected point may fall off-sheet.** `constrainBpTreePoint` clamps; a mirrored
  point clamped differently from its source would break symmetry. Reflect *then*
  constrain both endpoints identically, or constrain in axis-symmetric fashion.
- **D5 extraction feasibility** — resolved during implementation, not blocking.

---

## 7. Summary of recommendations

1. Extract `symmetryGeometry.ts` (shared pure core); keep two thin model adapters.
2. Symmetry state (axis/preset/pairs) in the **BP store slice, ephemeral** — not the
   document, not panel React state. Revises the triage note's "panel-local map."
3. Pairing = explicit (from mirror-add) + geometric inference; filtered every mutation.
4. Paired add/move as **store actions batched into one undo** via `runBpTreeMutation`;
   mirror-move reflects the whole moved-vertex set (partial mirror when unpaired).
5. Reuse `symmetryPresets`; extract a presentational `SymmetryMenuButton` if clean.
6. Add a `select | symmetry` tool mode to `BpTreePanel`; port axis overlay + hover ghost.
