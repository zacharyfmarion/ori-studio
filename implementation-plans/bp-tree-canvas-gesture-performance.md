# BP Tree Canvas Gesture Performance

Dragging a node in the BP tree editor is unusable on large trees. This is the
plan to fix the cause rather than the symptom, and to make the fix a property
the test suite enforces instead of a number that drifts back.

## Goal

**A gesture on the BP tree canvas must cost the same on a 500-flap design as on
a 5-flap one.** Concretely, per pointer sample: zero React renders, work
proportional to what actually moved, one rAF, latest-wins.

That bar covers all three continuous gestures on the canvas — dragging a node,
hovering it, and zooming — because all three fail today for the same reason.

## Evidence

Measured in the running app (dev and production builds) by dispatching synthetic
`PointerEvent`s, yielding through a `MessageChannel`, and taking the timestamp of
the first `MutationObserver` callback as "React finished". Absolute ms are from a
loaded machine and are indicative; the ratios and the scaling are not.

### The whole scene re-renders on every pointer sample

| Tree vertices | React render per `pointermove` | DOM attributes actually changed |
| --- | --- | --- |
| 47 | ~7 ms | 8 |
| 100 | ~9 ms | 8 |
| 160 | ~12 ms | 8 |
| 260 | ~24 ms | 8 |

The cost tracks tree size, not the gesture. At n=260, dragging a **leaf** changes
8 attributes and costs ~24 ms; dragging an **internal node near the root**
changes **776** attributes and costs ~25 ms. Doing 97× more real work is free —
the fixed re-render is the entire bill.

`BpTreePanel` holds the drag preview in its own `useState`, and the vertex and
edge groups are inline `.map()`s in the panel body with no memo boundary, so
every pointer sample re-derives and re-reconciles all ~2n groups.

### It is React, not the DOM

All of the time elapses *before* the first DOM mutation. Forced style+layout
after the commit is ~0.01 ms, and `Worker.postMessage` count across an entire
drag is **0** — the Rust kernel is not involved. Drag *end* is fine too: the
commit fires seven engine calls (`exportBps` for the undo snapshot,
`moveTreeVertex`, then `summary`/`treeData`/`layoutSnapshot`/`packingValidation`/
`creasePatternSnapshot`) totalling ~54 ms of worker time and ~12 ms to first
mutation.

### Memoizing the children is only half of it

A/B at n=160, adding `React.memo` to the per-vertex/per-edge subtrees with stable
handler identities:

| Variant | React render per `pointermove` |
| --- | --- |
| Today | ~12 ms |
| `React.memo` children | ~6.7 ms |
| Floor: memo + *nothing* changed at all | ~6.5 ms |

The floor is the panel body itself rebuilding the drawing description — 2n
element creations, 2n memo comparisons, per-element geometry. Memoizing children
without stopping the parent leaves that behind, which is why this plan moves the
gesture out of React rather than making React cheaper. Smaller terms at n=260,
both inside that floor: the per-element i18n `t()` aria-labels ≈2.1 ms per
render, and `findVertex`'s `tree.vertices.find()` inside the edge map (O(n²))
≈0.6 ms.

### The same defect, twice more

- **Hover.** `onCanvasPointerMove` calls `setHoverPoint` on every move, so moving
  the mouse across the pane costs the same full re-render — ~24 ms per move at
  n=260 — while nothing on screen changes. The ghost it feeds only draws when
  mirror-draw is on with a vertex selected.
- **Zoom.** `onTransformed` calls `setZoomPercent`, and every counter-scaled
  stroke width, dot radius and font size derives from it. One trackpad zoom step
  costs 19.4 ms and rewrites 195 attributes at only 60 vertices / 242 elements.
  At 260 vertices that is a ~1000-element rewrite per wheel tick.
- **The packing pane** has the drag half of this (~28 ms per `pointermove` at
  1129 elements on a 60-vertex design) but not the hover half (plain hover there
  is 0.02 ms). Phase 6.

### Two measurement traps, recorded so they are not re-learned

- The automated Browser pane runs `visibilityState: hidden`, which **clamps
  `setTimeout`**. A "wait until quiet" loop polling every 25 ms reported a
  1.0–1.5 s drag-end commit that a mutation-timestamp probe then showed to be
  ~12 ms. Yield through `MessageChannel`, never `setTimeout`.
- `import('/src/store/workspaceStore/store.ts')` from a console probe returns a
  **second live store** whose mutations never reach the UI. The app imports
  `/src/store/workspaceStore.ts`; use that exact specifier and verify against a
  value visible in the DOM.

## Approach

One boundary, applied three times:

> **The tree canvas renders committed document state and nothing else.**
> Everything continuous — drag preview, hover ghost, camera scale — is written
> imperatively onto the DOM React already rendered, coalesced to one rAF.

This is what upstream does. Box Pleating Studio draws the tree with PixiJS and
keeps each vertex's position in its own `shallowRef`, with the comment in
`third_party/box-pleating-studio/src/client/project/components/tree/vertex.ts`
that vertex movement "does not concern the Core" — one cell mutated, one object
redrawn, O(1) per sample. We can have the same asymptotics without the renderer.

### Phase 1 — Give the scene a memo boundary and a stable identity

Extract the `<svg>` contents into a `BpTreeScene` whose props are committed data
only: tree, selection, layers, paper rect, world rect. `memo` it. The panel stays
a composition site and stops owning gesture state.

Tag every element a gesture needs to move with `data-bp-vertex={id}` /
`data-bp-edge={id}` (and a marker on the labels). Resolving the moving set with
one `querySelectorAll` at gesture start is better than ref callbacks here: it
costs nothing per render, and the references can be re-read if React does commit
mid-gesture.

### Phase 2 — Drag becomes an imperative controller

- `lib/bpTreeDragController.ts` — no React. Holds the session (pivot, subtree
  ids, start point, resolved elements) and a writer that takes the
  `Map<id, Point>` that `bpTreeDragUpdates` already produces and writes `cx`/`cy`
  on circles, `x1`/`y1`/`x2`/`y2` on lines, `x`/`y` on labels.
- `hooks/useBpTreeDrag.ts` — binds it: `pointerdown` opens the session,
  `pointermove` records the latest client point and nothing else, one rAF applies
  the writer, `pointerup` commits through the existing
  `moveOristudioBpTreeVertices[WithSymmetry]`.

`bpTreeDragUpdates` is reused unchanged, so the live preview and the committed
move stay the same computation — the property its doc comment already promises.
Click-vs-drag disambiguation (`hasPassedDragThreshold`, `paperDownRef`) moves
into the controller intact.

Once the writes are the only per-frame work, they are ~400 cheap attribute sets
in the worst case. If a real trace ever shows that mattering, a rigid rotation is
expressible as a single `transform="rotate(θ, px, py)"` per moving element — but
do not build that first; the measurement above says attribute writes are free
and the per-point sheet clamp is not rigid anyway.

### Phase 3 — Hover ghost off the React path

The mirror ghost's elements are rendered once by the scene and moved by the same
gesture layer, which also toggles their visibility. `setHoverPoint` leaves the
`pointermove` path entirely, so hovering with mirror-draw off costs nothing.

### Phase 4 — Camera scale off the React path

Publish the counter-scale as a CSS custom property on the `<svg>` root
(`--bp-chrome-scale`), written imperatively from `onTransformed`. Stroke widths,
dot radii, font sizes and label offsets derive from it in `theme.css`, so a zoom
step is one style write on one element instead of a full re-render. `zoomPercent`
stays as React state but only the toolbar readout reads it.

This is the phase with a real cost attached — see Risks.

### Phase 5 — Make the committed render cheap too

It still runs on every edit, and edits are frequent:

- Replace `findVertex`'s linear scan with the id→vertex map the panel already
  builds alongside `vertexLocationsById`.
- Compute the aria-label `t()` calls inside the memoized child so they are not
  recomputed for every element on every committed render.

### Phase 6 — The packing pane, same shape

Its flap drag has the identical defect and a 4.7× larger scene, plus it drives
the engine per rAF, so each snapshot triggers another full re-render. Separate
PR; it should reuse Phases 1–2's controller shape rather than reinventing it.

## Affected Areas

- `apps/web/src/components/panels/BpTreePanel.tsx` — becomes composition only.
- `apps/web/src/components/panels/BpTreeScene.tsx` *(new)* — the memoized scene.
- `apps/web/src/lib/bpTreeDragController.ts` *(new)* — React-free gesture writer.
- `apps/web/src/hooks/useBpTreeDrag.ts` *(new)* — store/panel binding.
- `apps/web/src/hooks/useViewportSurface.ts` — publish the scale imperatively.
- `apps/web/src/styles/theme.css` — chrome sizes derive from `--bp-chrome-scale`.
- `apps/web/src/components/panels/BpTreePanel.test.tsx` — 28 tests; the five
  zoom/proportion ones change shape (see Risks).
- `apps/web/src/components/panels/BpPackingPanel.tsx` — Phase 6 only.

Unchanged on purpose: `lib/bpTreeAuthoring.ts`, `lib/bpTreeSymmetry.ts`, the
store slice, the runtime, and every Rust crate.

## Non-goals

- **Porting the tree view to WebGL/regl.** It is the upstream-matching answer and
  the CP workspace already has a renderer, but the evidence says the bottleneck
  is React, not drawing: 776 attribute writes cost nothing measurable and forced
  layout after commit is 0.01 ms. It would trade DOM accessibility, CSS theming
  and free text layout for a bottleneck we do not have. Re-open only if a
  real-browser trace after Phase 4 shows paint dominating — paint could not be
  measured in the automated pane, so that check is genuinely outstanding.
- **Changing what a drag means.** Rigid subtree rotation about the parent,
  per-point clamping to the sheet, and mirroring applied at commit rather than
  live all stay exactly as they are.
- **Touching the engine or the drag-end commit.** Measured fine.

## Risks and mitigations

- **React commits mid-gesture and overwrites the imperative writes.** Possible if
  something else updates the store during a drag. Mitigation: the scene's memo
  makes it rare; the controller re-reads its element references lazily and
  re-applies on the next frame; and on commit React is the source of truth
  anyway.
- **Stale element references.** `pointerdown` changes the selection, which
  renders once. The controller must resolve its elements *after* that render, not
  before, or it caches nodes React is about to replace.
- **The `data-bp-*` attributes become an unspoken contract** between scene and
  controller, and a rename breaks dragging silently. Mitigation: a test asserting
  the controller resolves an element for every vertex in the moving set.
- **Phase 4 weakens five tests.** jsdom cannot evaluate `calc()` against a custom
  property, so "counter-scales stroke widths", "thins the stroke in proportion",
  "counter-scales every mark", "keeps the selection emphasis proportional" and
  "keeps line weight proportional to dot size" can no longer read a number out of
  an inline style. They become: the declarations derive from the shared variable
  at the intended ratios, plus one test that the variable tracks the camera. That
  is a weaker guarantee, honestly weaker, and it is the price of the phase — if
  that trade is unwanted, Phase 4 can be dropped and zoom stays as it is.

## Validation

The bar is a test, not a benchmark, so it cannot drift:

- Dragging a vertex across 20 `pointermove`s renders `BpTreeScene` **0** times.
- Hovering the pane with mirror-draw off renders it **0** times.
- A zoom step renders it **0** times (Phase 4).
- The positions committed on `pointerup` are identical to today's, for a leaf,
  an internal node, and a mirror-paired node.

Plus, once, by hand in a production build with DevTools closed: a ~300-vertex
tree, dragging a node near the root, no dropped frames.

`npm run lint:web`, `npx tsc --noEmit`, and the web unit tests cover the rest.

## Checklist

- [ ] Phase 1 — extract `BpTreeScene`, memoize it, add `data-bp-*` identity
- [ ] Phase 1 — test: a second render with the same document mutates no DOM
- [ ] Phase 2 — `bpTreeDragController.ts` (session + writer, no React)
- [ ] Phase 2 — `useBpTreeDrag.ts`, rAF-coalesced, commit unchanged
- [ ] Phase 2 — test: 0 scene renders per `pointermove`; committed positions match
- [ ] Phase 3 — hover ghost driven imperatively; `setHoverPoint` off the hot path
- [ ] Phase 3 — test: 0 scene renders while hovering with mirror-draw off
- [ ] Phase 4 — `--bp-chrome-scale` published from the camera, consumed in CSS
- [ ] Phase 4 — rewrite the five proportionality tests; note the weaker guarantee
- [ ] Phase 5 — id→vertex map replaces `findVertex`; aria-labels inside the child
- [ ] Manual check in a production build on a ~300-vertex tree
- [ ] Phase 6 (separate PR) — same treatment for the packing pane's flap drag
