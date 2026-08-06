# ExplOri polish, and two bugs it sits on

## Goal

Eight items from the first real use of the ExplOri design kind
(`implementation-plans/explori-design-type.md`, shipped in five commits on
`claude/explori-design-type-plan-e3a0fa`). Six are the surface not yet matching
either the app around it or the tool it is a port of; two are genuine bugs, one
of them in box-pleat.

Grouped by what they are rather than by where they were reported, because three
of them are the same fix.

## Approach

### 1. The result tree thumbnail draws nothing — a bug

`ExploriGraphFigure` positions nodes from `node.pos`, and a result's `tree`
graph **has no positions**: upstream serializes it with
`serialize_graph(tree_graph)` and no `pos` argument, so every node arrives as
bare `{id}`. Nothing to lay out, nothing drawn.

Worth noting because it changes the fix: upstream's own tree thumbnail has the
same hole — its `pointForNode` falls back to `[0, 0]`, so every node stacks on
the origin. Copying upstream is not available here; we have to lay the tree out
ourselves.

We can, and better than a spring layout would: the graph carries `length` on
every edge, so the tree has a real metric. Lay it out **radially from the
tiling's own root** — walk it breadth-first, give each subtree an angular wedge
proportional to its leaf count, and place each node at its parent's position
plus `length` along the wedge's bisector. Deterministic, no iteration, and it
draws the thing the length actually describes.

The `topology` and `solved_tiling` graphs *do* carry positions, so the same
component keeps working for them if we ever show them.

### 2. Box-pleat: a snapped click sets the drawing but not the length — a bug

Reported as "snapping makes the flap look 2 or 3 units long, but its length is
still set to 1". Confirmed in the screenshot: two flaps drawn at ~3 units, both
labelled `1`.

This is fallout from the click-to-add half of the new drag model. `newLeafLocation`
quantizes the click distance and places the leaf there — the *geometry* is right
— but the engine's `add_leaf` mints an edge of length 1 and nothing tells it
otherwise. Dragging afterwards works because the drag commits through
`setEdgeLength`, which is exactly the call the add path skips.

The fix belongs in the add path, not the editor: after adding a leaf at distance
`d`, set the new edge's length to `d` in the same mutation, so it lands as one
undo entry rather than an add the user then has to correct. The mirror partner's
edge comes along, as it already does for a length edit.

This is worth a regression test at the store level — the pane cannot see the
difference, which is precisely why it shipped.

### 3. Send to Edit from a card flashes the detail view

`quickSend` calls `selectExploriResult(result, index)` — and passing an index is
what *opens* the detail. It should choose the result without opening it, which
is `selectExploriResult(result, null)`. The whole point of the card action is
that it skips the detour.

### 4. Search controls: three toggles, not twelve checkboxes

Upstream's main UI is **exactly three** buttons — Diagonal, Book, None — each
toggling that symmetry across every size, with a gear opening an advanced
per-size table (`index.html`, `db-toggle-group` and `advancedDbModal`). Ours put
the whole 4×3 matrix inline, which repeats "Diagonal Book None" four times and
reads as noise.

Match upstream's shape:

- Three toggle buttons in the query bar, styled as the app's existing segmented
  controls rather than raw checkboxes. A symmetry is on when *any* size has it.
- A gear opening the per-size grid, as a table with one set of column headers
  and a row per topology size — which is what makes twelve checkboxes legible
  when someone does want them.
- The result-count field beside them, as upstream has.

### 5. The results dropdown is unstyled

The thumbnail-mode `<select>` is a bare browser control against a themed panel.
The app has a select primitive already; use it rather than restyling a raw
`<select>` here.

### 6. Detail view: a design pass against upstream's

Upstream's detail is a modal with the id and match quality on the left of a
header, actions on the right, prev/next as large chevrons pinned to the sides,
and a two-pane body where each pane carries its own mode toggle underneath.
Ours has the same parts in a cramped single row.

Keep the drill-down (a modal is still wrong here — see the reasoning in the
first plan; comparing your tree against a candidate is why the two panes exist),
but take the layout: header with the id and quality, actions right, the two
figures large and equal, mode toggles under each.

### 7. Hide the pane headers on Design tabs

Both ExplOri panes and both box-pleat panes should lose their tab headers while
staying resizable.

`DesignPaneLayout.buildLayout` currently gives the primary pane a header only
when the kind declares a `split` peer, on the reasoning that two canvases side
by side need naming. In practice the names are noise — the panes are obviously
the tree and the results — and the divider is all that is wanted.

The pane is a dockview group, and `hideHeader` is a property of the group, so
this is a change to how the kind's panes are grouped rather than a per-pane
flag: each pane goes in its own header-hidden group, and dockview keeps the
resizable sash between them.

### 8. The chooser wraps its third card

Three kinds, two per row. `design-method-chooser__options` needs to fit three;
the cards have a fixed min width that a Design pane at its default width cannot
satisfy three of. Reduce the card's minimum and let the row hold three, wrapping
only when the pane genuinely cannot.

## Affected Areas

- `apps/web/src/explori/renderers.tsx` — radial layout for a graph with no
  positions (1)
- `apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts` — set the new
  edge's length in the add mutation (2)
- `apps/web/src/components/panels/ExploriResultsPanel.tsx` — quick send (3),
  select primitive (5), detail layout (6)
- `apps/web/src/components/panels/ExploriQueryBar.tsx` — three toggles plus the
  advanced grid (4)
- `apps/web/src/components/panels/DesignPaneLayout.tsx` — header-hidden groups (7)
- `apps/web/src/styles/theme.css` — query bar, detail, chooser (4, 6, 8)
- `apps/web/src/components/panels/DesignMethodChooser.tsx` / theme (8)

## Checklist

- [ ] Radial layout for result trees, from the graph's own edge lengths
- [ ] Box-pleat: a snapped click commits the length it drew, as one undo entry,
      with a store-level regression test
- [ ] Quick Send to Edit chooses without opening the detail
- [ ] Query bar: three symmetry toggles, gear → per-size table, result count
- [ ] Thumbnail mode uses the app's select primitive
- [ ] Detail view laid out as upstream's: header, actions, two large panes with
      their own toggles
- [ ] Design panes drop their tab headers and keep the resize sash — ExplOri and
      box-pleat both
- [ ] Chooser fits three cards on one row
- [ ] Lint, typecheck, tests, `i18n:check` with translations for any new strings
- [ ] Browser-verify each of the eight
