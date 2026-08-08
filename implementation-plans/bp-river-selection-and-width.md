# BP River Selection and Width

## Goal

In the BP packing pane, make a river a **first-class selectable object** and let
the user **increase / decrease its width**, matching Box Pleating Studio's river
panel (`third_party/box-pleating-studio/src/app/vue/panel/river.vue`):

```
River
  Width  [ − ][ 3 ][ + ]      min 1, max = the dual edge's maxLength
```

Two deliverables:

1. **Selection** — a river is picked by clicking its *band* (the paper the river
   actually occupies, children punched out), it shades on hover and stays shaded
   while selected. This replaces today's behavior, where the click target is the
   river node's whole closed contour — holes included — and the only feedback is
   a recoloured outline.
2. **Width** — a floating contextual pill with `−` / value / `+`, on the same
   top-center spot the flap editor uses, shown when exactly one river is
   selected.

Upstream terminology note: BP Studio's river panel labels the field **Width**
and binds it to `River.length`, which *is* the dual tree edge's length. There is
one number here, not two. Our `OristudioBpRiver` currently carries both `width`
and `length` set to the same value (`oristudioBpSnapshotMapper.ts:360`); this
plan keeps `width` as the one the UI reads and deletes the duplicate.

## Background — what already exists (verified)

Like the flap-dimensions work
([box-pleating-flap-dimensions.md](box-pleating-flap-dimensions.md)), this is a
**frontend-only** feature. No engine, wasm, or runtime call is missing.

**Selection plumbing is complete.** `{ kind: 'bp-river', id }` and the
`bp-multi.rivers` array both exist; `bpLinkedSelection` already links a river to
its dual tree edge in both directions (`oristudioBpSelection.ts:40`, `:54`), so
selecting a river in the packing pane already highlights the edge in the tree
pane. `toggleBpRiverSelection` handles shift/meta-click.

**The band geometry is already computed.** `packingCoverage`
(`oristudioBpSnapshotMapper.ts:378`) maps every node's graphics into
`OristudioBpCoverageRegion { id, outer, holes }`, and `bpPackingCoveragePath`
(`bpPackingViewport.ts:322`) renders one as an SVG `d` with the holes as
subpaths, documented as exact under `fill-rule: evenodd` *within* a region. That
is precisely upstream's `fillContours` (`client/utils/contourUtil.ts:29`:
`beginFill(outer)` + `beginHole(inner)`), which is what `River` sets its hit
area from (`layout/river.ts`: `$setupHit(this._shade)`). Today the only consumer
is `BpPackingEmptySpaceLayer`.

**Region ids already name the river.** A river node's graphics id is
`re{n1},{n2}`, so its coverage ids are `re3,4:contour:0` — the same string
`riverIdFromPrimitiveId` (`BpPackingPanel.tsx:2145`) already parses to a river
id.

**The width path is wired.** A river's width is its dual tree edge's length, and
`setOristudioBpTreeEdgeLength(vertices, length, subtreeUpdates)`
(`oristudioBpSlice.ts:977`) already applies the length, applies the caller's
subtree repositions, mirrors both onto the symmetry partner, and records the
whole thing as **one undo entry**. The packing pane already calls it — that is
how flap radius is edited (`BpPackingPanel.tsx:700`). `maxLength` per edge is in
the snapshot (`oristudioBpSnapshotMapper.ts:324`).

**The pill UI exists.** `TreeEdgeLengthEditor`
(`tree-editor/TreeEdgeLengthEditor.tsx`) is exactly the requested control —
`−` IconButton, number input, `+` IconButton, with clamp/step/format delegated
to a `TreeLengthRule` and the ceiling deliberately never rendered. It is used by
the tree pane. Its only obstacle to reuse is that it takes the whole
`TreeEditorCopy` for four strings.

**A layer toggle is already there but inert.** `layers.rivers` maps from the
`'river'` layer id (`oristudioBpViewportSettings.ts:127`), but no primitive is
ever emitted on that layer — the mapper puts every river contour on `'hinge'`
(`oristudioBpSnapshotMapper.ts:412`). The Rivers toggle currently controls
nothing. The new band layer gives it its meaning back.

### The bugs this fixes

Both come from river hit-testing being a closed-polyline primitive rather than a
band:

- **Holes are clickable.** Each inner ring is emitted as its own closed polyline
  (`…:contour:0:inner:0`) and closed polylines get
  `.bp-packing-primitive-hit-area` — `fill: transparent; pointer-events: all`.
  So the paper *inside* a river's hole, which belongs to a nested river or flap,
  selects the enclosing river.
- **Nesting is decided by draw order, not containment.** The outer contour is
  also a filled hit area covering everything it encloses, so which of two nested
  rivers wins a click is whichever the mapper emitted last.

## Approach

### Part A — selection

**A1. Extract the river-id helper.** Move `riverIdFromPrimitiveId` (private in
`BpPackingPanel.tsx`) into a new `lib/bpPackingRivers.ts` as
`bpRiverIdFromGraphicsId(id, rivers)`, with unit tests: `re3,4:contour:0` and
the reversed-vertex form resolve; `f2:contour:0` and garbage return null. The
panel and the new layer both use it. (`lib/` is correct — no CP-workspace
dependency, and the panel is a composition site.)

**A2. `BpPackingRiverBandLayer.tsx`** (new, beside
`BpPackingEmptySpaceLayer.tsx`). Props: `coverage`, `rivers`, `sheet`,
`paperRect`, `linkedSelection`, `onPointerDown`. It:

- keeps only coverage regions whose id resolves to a river, and groups the
  regions **by river id** (a river can contribute more than one contour);
- renders one `<path>` per region with `fill-rule="evenodd"` and
  `d = bpPackingCoveragePath(region, sheet, paperRect)`;
- classes: `bp-packing-river-band`, plus `--selected` when
  `linkedSelection.rivers.has(id)`;
- carries the group's `aria-label` (`panels:bpPacking.selectRiverShort`, the
  existing key) and `data-bp-select={`river:${id}`}` so click-cycling and the
  a11y labels keep working. **Not focusable** — same rule as every other hit
  target in this canvas (`BpPackingPanel.test.tsx` asserts it).

CSS in `theme.css`, next to `.bp-packing-selection-shade`, translating
upstream's `style.shade` (`client/services/styleService.ts:35`: `alpha 0.3`,
`hover 0.15`) into our accent token — the tints match `.bp-packing-selection-shade`'s
formula so a shaded river and a shaded flap read as the same thing:

```css
.bp-packing-river-band { fill: transparent; cursor: pointer; }
.bp-packing-river-band:hover { fill: color-mix(in srgb, var(--accent-primary) 9%, transparent); }
.bp-packing-river-band--selected { fill: color-mix(in srgb, var(--accent-primary) 18%, transparent); }
```

Hover is pure CSS — no React hover state, no re-render per pointer move. These
panes have twice regressed from state updates on pointer events; see
[bp-tree-canvas-gesture-performance.md](bp-tree-canvas-gesture-performance.md).

**A3. Mount it** in `BpPackingPanel` immediately **after** the `paper-hit-area`
and **before** the graphics group (`BpPackingPanel.tsx:1428`). That z-order is
the whole point: the band beats a marquee start on paper, and loses to every
crease, gadget, flap and flap-hit drawn above it — so the things inside a river
stay clickable, which is the invariant the comment at
`BpPackingPanel.tsx:1128` records from the last time this went wrong.

Gating: the band renders and hit-tests when `layers.rivers` is on (matching how
`layers.flaps` gates flap hits); the selected/hover tint additionally requires
`layers.selectionShade`, matching flaps. **Call this out in the PR** — it is a
behavior change: turning Rivers off now disables river selection, where before
it did nothing and `layers.hinges` was the accidental gate.

**A4. Stop filling closed hinge contours.** In `Primitive`
(`BpPackingPanel.tsx:1875`), give `.bp-packing-primitive-hit-area` only to
**device** contours — which is what its CSS comment already says it is for — and
give closed hinge contours `.bp-packing-primitive-hit-polyline` (stroke-only).
The river outline stays grabbable; its interior and its holes are now owned by
the band layer. This is what fixes both bugs above.

`primitiveSelectedByRiver` stays: a selected river keeps its accent outline, now
with the band shaded underneath.

**Not changed:** multi-select (shift/meta-click still routes through
`toggleBpRiverSelection`), marquee behavior, the linked tree-pane highlight.

### Part B — width

**B1. Make the pill reusable.** `TreeEdgeLengthEditor` currently takes
`copy: TreeEditorCopy` for four strings. Replace that prop with the four it
actually uses — `title`, `label`, `increaseLabel`, `decreaseLabel`,
`groupLabel` — and have `TreeEditor.tsx` pass them from its `copy`. Small,
mechanical, and it makes the control usable from any surface. Everything else
(clamp, step, format, ceiling-never-rendered) stays as is.

**B2. Extract the length→repositions computation.** `TreeEditor.setEdgeLength`
(`TreeEditor.tsx:450`) does the length-faithful part: re-place the child at
`length` along the current direction and translate the child's whole subtree by
the same delta. Lift it, unchanged, into a tested helper next to the tree model:

```ts
// tree-editor/lengths.ts (or dragRule.ts, wherever `leafLocationAt` lands best)
export function edgeLengthRepositions(
  tree: EditableTree, topology: TreeTopology, edgeId: number, length: number
): TreeVertexUpdate[]
```

`TreeEditor` then calls it, and so does the packing pane. `OristudioBpTreeView`
is a structural superset of `EditableTree` (`tree-editor/model.ts:11` says so
explicitly), so the packing panel passes `document.snapshot.tree` straight in
with no adapter.

This also **subsumes the leaf-only special case** the packing pane wrote for
flap radius (`BpPackingPanel.tsx:700`, `leafLocationAt` + a single update): a
leaf's subtree is just the leaf, so the general helper returns the same list.
Collapse that call site onto the helper in the same change — one implementation
of "set an edge length and keep the tree faithful", not three.

**B3. `BpRiverEditor.tsx`** (new, beside `BpFlapEditor.tsx`): mounts the pill
for a single selected river. Shown when `selection.kind === 'bp-river'` (or a
`bp-multi` that normalizes to one river — `singleBpSelection` already does that
collapse, `oristudioBpSelection.ts:321`) and the river's dual edge resolves.

- `edge` = the dual `OristudioBpTreeEdge` found by `river.edgeId`.
- `rule` = `SNAPPED_LENGTHS` (integer grid units, min 1) — the same rule the BP
  tree pane uses, so a river's width steps identically from both panes.
- `title` = `River {{id}}`, `label` = `Width` (upstream's word).
- commit → `setOristudioBpTreeEdgeLength(edge.vertices, clamped, edgeLengthRepositions(...))`.
- `onEscape` → drop the selection, matching the flap and name editors.

Keyed on the river id so a selection change remounts with a fresh draft, same as
`BpFlapEditor`.

**B4. Keyboard.** No new global shortcut. The `−`/`+` buttons and the input's
native arrows cover increase/decrease, and the pane's arrow-nudge listener
already ignores events from inputs and buttons
(`BpPackingPanel.tsx:926` → `isViewportInteractiveTarget`, which matches
`button, input, textarea, select, …`), so an arrow press in the field cannot
also nudge a flap. Upstream's `d.rd` / `d.ri` chords would need a BP scope in
`src/keyboard/` — a bigger change, and a follow-up, not this one.

### Deliberately out of scope

Both are adjacent river verbs in the same upstream panel, both currently
unwired, and neither is what was asked for. Worth their own change:

- **Delete / merge** (`bp.layout.deleteRiver`). The runtime call exists
  (`mergeOristudioBpTreeEdge`, `oristudioBpRuntime.ts:452`) but has no slice
  action and no caller.
- **Go to edge** (`bp.layout.goToDual`). Note that selecting a river *already*
  highlights its dual edge in the tree pane via `bpLinkedSelection`; what is
  missing is the explicit "take me there" verb.

### Analytics — not taken, deliberately

The plan proposed a hand-placed `bp design action { action: 'river_width' }`.
On implementation that turned out to be the wrong call, so it was not shipped:

- The event is **already deferred by a recorded decision**
  (`posthog-analytics.md:332`), and its documented shape is
  `{ action }` over `author | symmetry | pack` — a coarse bucket, not one value
  per verb.
- It has no emitter at all today, and every other BP authoring verb — flap move,
  flap resize, flap radius, leaf add, edge length — is silent. One emitter on
  river width would make a metric labelled "authoring" that only ever fires for
  one edit, which reads as a fact about authoring and is not one.

The thing worth doing is instrumenting BP authoring **as a set**, which is its
own change against the deferred decision rather than a rider on this one.

## Affected Areas

| File | Change |
| --- | --- |
| `apps/web/src/lib/bpPackingRivers.ts` | **new** — `bpRiverIdFromGraphicsId` + tests |
| `apps/web/src/components/panels/BpPackingRiverBandLayer.tsx` | **new** — the band/hit/shade layer |
| `apps/web/src/components/panels/BpRiverEditor.tsx` | **new** — the width pill |
| `apps/web/src/components/panels/BpPackingPanel.tsx` | mount both; drop the local river-id helper; stop filling closed hinge contours; collapse flap-radius onto the shared helper |
| `apps/web/src/tree-editor/TreeEdgeLengthEditor.tsx` | copy-object prop → four string props |
| `apps/web/src/tree-editor/TreeEditor.tsx` | pass the strings; call the extracted helper |
| `apps/web/src/tree-editor/lengths.ts` | **new export** `edgeLengthRepositions` + tests |
| `apps/web/src/engine/oristudioBpSnapshotMapper.ts` | drop the duplicate `river.length` |
| `apps/web/src/engine/oristudioBpTypes.ts` | `OristudioBpRiver.length` removed |
| `apps/web/src/styles/theme.css` | `.bp-packing-river-band` (+ hover, `--selected`) |
| `apps/web/eslint.config.js` | expect to raise `BpPackingPanel.tsx` past 2014 — two mounts + their memos is composition, which AGENTS.md names as the legitimate case; justify in the PR |
| `apps/web/public/locales/*/panels.json` | new keys, 8 locales |
| `apps/web/src/lib/oristudioBpCommands.ts` | `bp.layout.updateRiverWidth` → shipped; delete `bp.layout.updateRiverLength` (it is the same verb, mis-split) |

## Validation

Tool-checkable, all of which I run:

- `npx tsc --noEmit` and `npx vitest run` from `apps/web` (the npm wrappers
  regenerate tracked wasm nondeterministically — see
  `web-typecheck-regenerates-wasm`), plus `npm run lint:web`.
- `npm run i18n:extract` → translate the new keys in all 8 locales →
  `npm run i18n:stamp` → `npm run i18n:check`.
- Unit tests: `bpRiverIdFromGraphicsId`; `edgeLengthRepositions` (leaf case
  matches the old leaf-only path; internal-edge case carries the whole subtree).
- Panel tests in `BpPackingPanel.test.tsx`: a pointerdown on a river band
  selects that river; a pointerdown inside a **hole** does *not* select the
  enclosing river (the regression this fixes); the band gets
  `--selected` when selected; nothing in the band layer is focusable.
- `BpRiverEditor.test.tsx`: `+` commits `width + 1`; `−` is disabled at 1; a
  typed value commits on Enter and reverts on Escape; the commit calls
  `setOristudioBpTreeEdgeLength` with the dual edge's vertices.

Not tool-checkable — browser checklist for Zach (per
`author-owns-phase-verification`; the automated pane suspends rAF, so canvas
gestures cannot be verified there):

- [ ] Hover a river band: it tints, and the tint stops at nested flaps/rivers.
- [ ] Click it: it stays shaded, its outline goes accent, the dual edge
      highlights in the tree pane.
- [ ] Click a flap inside a river, and a crease inside a river: each selects
      itself, not the river.
- [ ] Shift-click two rivers: both shade.
- [ ] `+` / `−` / typed width: the packing re-solves, flaps move, one undo step
      reverts the whole thing.
- [ ] With symmetry on, editing one river's width moves its mirror partner too.
- [ ] Toggle the Rivers layer off: bands disappear and stop taking clicks.

## Checklist

- [x] A1 — extract `bpRiverIdFromGraphicsId` into `lib/bpPackingRivers.ts` + tests
- [x] A2 — `BpPackingRiverBandLayer` + `.bp-packing-river-band` styles
- [x] A3 — mount under the graphics group, gated on `layers.rivers` /
      `layers.selectionShade`
- [x] A4 — closed hinge contours lose the filled hit area (devices keep it)
- [x] A5 — panel tests: band selects, hole is punched out, selected class,
      paint order, non-focusable
- [x] B1 — `TreeEdgeLengthEditor` takes strings, not `TreeEditorCopy`
- [x] B2 — extract `edgeLengthRepositions` + tests; collapse flap radius onto it
- [x] B3 — `BpRiverEditor` pill, wired to `setOristudioBpTreeEdgeLength` + tests
- [x] B4 — an arrow press in the field cannot nudge: the container listener
      bails on `input` targets (`isViewportInteractiveTarget`), and a river
      selection has nothing nudgeable in the first place
- [x] Drop the duplicate `OristudioBpRiver.length`; fold
      `bp.layout.updateRiverLength` into `updateRiverWidth`
- [x] Analytics — **not taken**, see the section above for why
- [x] i18n: extract, translate 8 locales, stamp, check
- [x] The `BpPackingPanel.tsx` line cap did not fire — the two mounts landed
      within it, because the flap-radius geometry left the file at the same time
- [x] Lint / typecheck / unit tests green (2991 tests)
- [ ] Hand the browser checklist to Zach
