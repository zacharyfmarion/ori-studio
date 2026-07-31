# Tree-view selection highlighting

## Goal

Make the selected tree node — typically a flap tip in the BP tree pane — the
loudest mark on the canvas, and make everything else quiet. Today the reverse is
true: every leaf dot is painted in a full-strength accent while the selected dot
is the only one that dims.

## Approach

Two defects produce the reported look, and both are in the shared `.tree-node`
styling used by the BP tree pane and the TreeMaker design pane:

1. **A dot's identity outranks its state.** `.tree-node[data-leaf]` (0-2-0) and
   `.bp-tree-node--root` beat `.tree-node--selected` (0-1-0 — the specificity of
   a selector list is per-selector, so sharing a block with `.tree-node:hover`
   buys it nothing). Verified in Chromium: a selected leaf's computed fill is
   byte-identical to an unselected leaf's.
2. **The selected ring is the canvas colour.** Unselected dots get a bright ink
   ring and the selected dot gets a canvas-dark one, so on a dark canvas
   selection reads as *recessed*. On the BP surface even the compensating
   `stroke-width: 3` is lost, because the panel sets `strokeWidth` inline
   (counter-scaling against the camera) and an inline style beats author CSS.

The fix reverses the emphasis and removes the cascade fragility:

- Identity colours become a tint of their accent mixed into the canvas, so
  "leaf" and "root" still read without shouting.
- Identity rules opt out of the interactive states with `:not(...)` rather than
  relying on source order, so no future rule can outrank selection by accident.
- Selection takes the full accent fill, the bright ink ring, a heavier stroke,
  and a larger dot — four cues, at least two of which are strong in every theme
  polarity.
- Hover sits between the two, instead of being identical to selection.

## Affected Areas

- `apps/web/src/styles/theme.css` — `.tree-node` state rules and
  `.bp-tree-node--root`.
- `apps/web/src/components/panels/BpTreePanel.tsx` — selected dot radius and
  ring weight (both counter-scaled), label offset follows the dot.
- `apps/web/src/components/panels/DesignPanel.tsx` — same emphasis for the
  TreeMaker tree, which shares the stylesheet and had the same inversion.
- `apps/web/src/components/panels/BpTreePanel.test.tsx` — coverage for the
  DOM-side emphasis.

## Checklist

- [x] Reproduce the cascade loss in a real browser engine, not jsdom
- [x] Reverse the identity/state emphasis in `theme.css`
- [x] Guard identity rules with `:not(:hover, .tree-node--selected)`
- [x] Grow and thicken the selected dot in the BP tree pane
- [x] Match the emphasis in the TreeMaker design pane
- [x] Tests: selected dot is larger and heavier than its siblings, for a leaf
      vertex and for a non-leaf vertex
- [x] `npx tsc --noEmit`, web lint, web unit tests
