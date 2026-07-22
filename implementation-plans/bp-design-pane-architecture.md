# BP Design Pane Architecture Cleanup

## Goal

Remove the structural causes behind a run of Box Pleating (BP) design-pane UX
bugs, rather than continuing to fix them one pane at a time.

The BP design surface is two sibling panes — `design` (BP tree) and `bp-editor`
(packing) — that were ported separately and grew parallel implementations of the
same viewport. Three consequences keep showing up in user-reported bugs:

- **Policy hidden in use sites.** The rule "a canvas click adds a leaf to the
  selected vertex, or the root" lived duplicated inside two unrelated function
  bodies, so clearing the selection left the hover ghost drawing (and a click
  still adding) at the root. Fixed in `5d4d63d5` by resolving the anchor once.
- **A second, inert selection model.** BP DTOs carry per-object `selected`
  flags that the mapper hardcodes to `false` and nothing reads. They look
  authoritative and are not.
- **Per-pane copies of the viewport.** Camera/fit, space-pan, shortcut
  registration, layer popovers, and the drag protocol exist twice. Every fix
  must be applied twice or is silently applied to one pane only.

Success looks like: one selection model, one viewport implementation, and
interaction rules that live in named, testable functions instead of inline
fallbacks.

## Non-goals

- Changing BP engine or `.bps` semantics. This is a web-layer refactor; the
  Rust port's behavior is the contract and stays fixed.
- Persisting symmetry pairs to `.bps` (see Deferred).
- Re-opening the box-pleat layout question. The two-pane split stays.

## Approach

### Phase 1 — Delete the inert selection model

`OristudioBpFlap`, `OristudioBpRiver`, `OristudioBpStretch`, and
`OristudioBpDevice` each declare `selected: boolean`, mirroring BP Studio's
engine-side model. `oristudioBpSnapshotMapper.ts` writes `false` at all four
construction sites and no consumer reads them; selection is entirely
`document.selection` plus `bpLinkedSelection`.

- Drop the four fields from `oristudioBpTypes.ts` and their writes in the
  mapper.
- Confirm by compilation plus a grep for `.selected` that no read existed.
- Leave the Rust-side field alone — this is the DTO boundary only.

Outcome: exactly one representation of "what is selected" in the web layer.

### Phase 2 — Make the selection model explicit

Selection currently has two write paths with different semantics:
`selectOristudioBp` mutates `oristudioBpDocument` with a bare `set` (no
history), while every mutation threads `selection` through the runtime into
history tags that `selectionFromHistoryTags` reconstructs on undo. So selecting
is not undoable but adding restores a selection — the same field behaving as
both view state and document state.

- Decide and document the rule. Recommended: **selection is view state**, not
  document state — it is not persisted to `.bps`, and users don't expect Undo
  to walk selections. Mutation-restored selection stays, as a *presentation*
  choice on undo, not as a stored value.
- If that rule holds, move `selection` out of `OristudioBpDocumentState` into
  its own store field alongside `oristudioBpSymmetry`, so its lifetime is
  visibly session-scoped and `replaceActiveBpDocument` can stop carrying it.
- Add a single `clearBpSelection()` used by every surface, replacing the
  per-pane `{ kind: 'bp-tree' }` literals (tree panel, packing panel).
- `{ kind: 'bp-tree' }` as the empty value is a footgun — it reads as "the tree
  is selected". Rename to an explicit `{ kind: 'bp-none' }`, or model empty as
  `null`.

### Phase 3 — Name the interaction rules

The class of bug fixed in `5d4d63d5` is "a policy expressed as an inline
fallback, duplicated across a preview and its action". Preview and action must
be derived from one source by construction.

- Keep the invariant established there: the add-anchor is exactly the selected
  vertex, with no fallback, shared by the ghost and the click.
- Audit for the same shape elsewhere in both panes — any `?? someDefault`
  inside a render body or event handler that decides *what an action would do*.
  Promote each to a named value or a pure helper in `lib/`.
- Pure interaction helpers belong beside `bpTreeAuthoring.ts` /
  `oristudioBpSelection.ts`, where they are unit-testable without a DOM.

### Phase 4 — One viewport surface

`BpTreePanel.tsx` (~1.1k lines) and `BpPackingPanel.tsx` (~2.4k lines) hold
side-by-side copies of:

| Concern | Tree | Packing |
| --- | --- | --- |
| `computeFitScale` / `fitLoadedDocument` / `lastFittedKeyRef` / ResizeObserver refit | ✓ | ✓ |
| space-pan keydown/keyup/blur effect | ✓ | ✓ |
| `registerViewportShortcutExecutor` + `handleViewportShortcut` | ✓ | ✓ |
| layers popover + outside-click effect | ✓ | ✓ |
| `TransformWrapper` configuration | ✓ | ✓ |
| pointer-capture drag protocol | ✓ | ✓ |

- Extract a `useViewportSurface({ surfaceId, worldRect, fitKey })` hook owning
  the camera: fit-on-load, refit-on-resize, zoom/fit/actual-size shortcut
  registration, and the space-pan modifier. Both panes consume it.
- Extract the layers popover (trigger + outside-click + checkbox list) into one
  component parameterized by its options; the two `LAYER_OPTIONS` tables and
  their label helpers stay pane-local.
- Extract the pointer-capture drag protocol (threshold, capture, preview map,
  commit-on-release) into a hook. The tree drags vertices and the packing drags
  flaps/devices, but the gesture bookkeeping is identical and is where the
  subtle bugs have lived.
- Only then consider splitting `BpPackingPanel` by concern (sheet controls,
  primitives, alerts). Splitting before extracting would just distribute the
  duplication.

### Phase 5 — Regression coverage for the interaction rules

Each bug in this run was invisible to the suite: they were all interaction
rules, and the tests cover pure helpers and the store.

- Component tests for the tree pane: nothing selected ⇒ no ghost and a canvas
  click is inert; selecting a vertex arms both; Escape disarms both; adding a
  leaf keeps the parent anchored and does not focus the name field.
- Component tests for the shared viewport hook: fit-on-load once per document,
  refit on resize, no camera movement during a drag (the open audit item).
- Keep them at the "rule" level, not the pixel level, so the Phase 4 extraction
  doesn't invalidate them.

## Affected Areas

- `apps/web/src/engine/oristudioBpTypes.ts`,
  `apps/web/src/engine/oristudioBpSnapshotMapper.ts` — drop inert `selected`
  fields (Phase 1).
- `apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts`,
  `apps/web/src/store/workspaceStore/types.ts`,
  `apps/web/src/store/workspaceStore/oristudioBpRuntime.ts` — selection
  ownership and `clearBpSelection` (Phase 2).
- `apps/web/src/lib/oristudioBpSelection.ts` — empty-selection representation
  (Phase 2); interaction helpers (Phase 3).
- `apps/web/src/components/panels/BpTreePanel.tsx`,
  `BpPackingPanel.tsx`, `BpEditorPanel.tsx` — rule extraction (Phase 3) and
  viewport/drag/popover extraction (Phase 4).
- New `apps/web/src/hooks/useViewportSurface.ts` (+ drag protocol hook) and
  their tests (Phases 4–5).

## Checklist

- [x] 0. Add-anchor is the selection, with no root fallback; preview and click
      share it (`5d4d63d5`).
- [x] 0b. A tree opens with nothing selected — no default anchor.
- [ ] 1. Delete the inert `selected` DTO fields and their mapper writes.
- [ ] 2. Decide selection ownership; move it to session state; add
      `clearBpSelection`; replace `{ kind: 'bp-tree' }` with an explicit empty.
- [ ] 3. Audit both panes for policy-as-fallback; promote to named helpers with
      unit tests.
- [ ] 4. Extract `useViewportSurface`, the layers popover, and the drag
      protocol; both panes consume them.
- [ ] 5. Interaction-rule component tests for the tree pane and the viewport
      hook.
- [ ] 6. Validation: `npx tsc --noEmit`, `npm run lint:web`,
      `npm run test:web`, `npm run i18n:check`, production web build; browser
      verification of select/add/Escape in both panes.

## Open question

With no default selection, a freshly opened tree is inert until the user clicks
a node — the first click on empty canvas does nothing. This is the correct model
(the anchor is always visible and explicit) but needs an affordance so it isn't
read as broken: a hint in the empty state, or a resting emphasis on the root
node. Decide during Phase 3.

## Deferred

- Persisting symmetry `pairs` to `.bps`. They are ephemeral web state, so after
  reload mirroring degrades to geometric inference — symmetry behavior depends
  on session history. Called out in `bp-studio-audit-fixes.md`; a file-format
  change is out of scope here.
- The open audit item "flap drag must not move the viewport"
  (`bp-studio-audit-fixes.md` item 6). Its root cause — the packing `viewBox`
  growing to include the dragged flap — is a camera concern, so it should be
  fixed *inside* the Phase 4 viewport hook rather than before it.
