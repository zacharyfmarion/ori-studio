# Axis-pinned dragging, live mirroring, and the results redesign

## Goal

Nine reports. Two are engine-level (dragging a vertex that sits on the mirror;
mirroring that only appears on release), one is a third copy of a control that
already exists twice, and six are the ExplOri results and detail views.

Grouped by what they actually are, rather than by the order they were reported.

## A. The tree canvas

### 1. A vertex on the mirror line cannot be dragged at all

Not a subtle failure — it is an explicit refusal in
`TreeEditor.onVertexPointerDown`:

```ts
// A vertex on the mirror line is its own mirror. Dragging it off would break
// that silently, so while mirror draw is on it stays put.
if (symmetry?.isOnAxis(vertexId)) {
  paperDownRef.current = null;
  return;
}
```

The invariant it protects is real: a vertex on the axis *is* its own mirror, and
a rotate-and-extend drag would take it off the line and silently break that. But
freezing is the wrong answer to it, because there is a whole family of motions
that keep the invariant — every point along the axis.

So the fix is a third drag mode beside "rotate and extend": **slide along the
axis**. The admissible positions are the points that are (a) on the axis, and
(b) at a distance from the pivot the length rule admits. That single description
covers both surfaces:

- Continuous lengths (ExplOri): every point on the axis is admissible, so the
  vertex tracks the cursor's projection and the length reads out of the drawing.
- Snapped lengths (box-pleat): only the points where the radius is a whole
  number, so it steps between them and the packing engine still gets integers.

The geometry is one function: project the cursor onto the axis, quantize the
radius that implies, then place the tip back on the axis at that radius —
choosing the intersection nearer the cursor, and clamping up to the foot of the
perpendicular when the circle cannot reach the line at all. The subtree still
travels rigidly, through the existing `rotateAndExtend`, so this is a new way to
choose `(angle, extension)` rather than a second way to move a tree.

### 2. A mirrored partner only moves when the drag lands

`startTreeDrag` collects DOM targets for `subtreeIds` and writes those. The
partner is added by the *commit* (`withMirroredMoves` in the ExplOri slice, the
symmetry-aware actions in box-pleat's), so it jumps into place on release.

The reflection is the same on both surfaces — `reflectPointAcrossSymmetryAxis`
across `symmetry.axis` — and `TreeSymmetryHost` already exposes `resolveMirrorOf`
and `axis`. So `TreeEditor` can hand the controller a `reflect` alongside the ids
to collect, and neither surface needs to know. Re-reflecting at commit is
harmless: `withMirroredMoves` skips a partner already in the moved set.

### 3. Circle-packing says "Sym"

Third copy of one control. Box-pleat and ExplOri share `TreeEditorToolbar`;
circle-packing has its own `DesignSymmetryToggle` with its own class and its own
abbreviation. Rather than a fourth divergence, the toggle moves into
`ViewportToolbar.tsx` — where the shared toolbar vocabulary lives — and all three
render the same thing. The box-pleating *editor*'s mirror button stays icon-only
on purpose: it is the second appearance of the control in a denser toolbar.

## B. The results grid

### 4. The tiling id is noise

`4b.23841` names a row in someone else's database. It is worth keeping in the
`aria-label`, the React key and the exported filename, and worth showing nowhere.
Dropped from the card and from the detail header.

### 5. Tree and crease pattern, side by side, by default

A card shows one figure chosen by the pane-wide dropdown. Comparing a candidate
against the tree you drew is the whole point, so the default becomes both at
once, and the four single views stay in the dropdown behind it.

### 6. The quality pill stretches

`.explori-result-card__meta .explori-quality { flex: 1 }`. It was carrying the
slack so the send button sat at the right edge; with the id gone the slack should
go to a margin instead, and the pill should be as wide as its text.

## C. The detail view

### 7. Four figures, not two radio groups

The two panes each have a radio group choosing what to show, and the radios are
raw `<input type="radio">` — unstyled, and a control where none is needed. There
are exactly four figures; show four figures.

### 8. Prev/next belong in the header

They are absolutely positioned against the body edges. In the header they sit
beside the other controls and stop overlapping the figures.

### 9. Open in ExplOri

Upstream has no route for a result, but it does have a deep link:
`view.js` reads `?id=` and parses it as `^(\d)([nbd])(\d+)$` — N, the symmetry
letter, the tiling id. That is exactly what `exploriTilingLabel` already composes
(minus the dot), so the link is
`https://225.designorigami.net/view?id=4b23841`.

Built from the same parts as the label, in `explori/types.ts`, so the two cannot
drift.

## Affected Areas

- `apps/web/src/tree-editor/dragRule.ts` — axis-pinned sliding
- `apps/web/src/tree-editor/dragController.ts`, `TreeEditor.tsx` — the pin, and
  the live reflection
- `apps/web/src/components/panels/ViewportToolbar.tsx`,
  `tree-editor/TreeEditorToolbar.tsx`, `components/panels/DesignPanel.tsx` — one
  symmetry toggle
- `apps/web/src/components/panels/ExploriResultsPanel.tsx` — cards and detail
- `apps/web/src/explori/types.ts` — the upstream deep link
- `apps/web/src/styles/theme.css` — pill, card figures, detail layout

## Checklist

- [x] A vertex on the axis slides along it, keeping both the axis and the length
      rule; a test for each of the two length rules
- [x] The upstream deep link is built from the label's own parts, with a test
- [x] Mirrored partners move during the drag, not on release
- [x] One symmetry toggle, used by all three tree toolbars
- [x] Result cards show tree and crease pattern together by default
- [x] The tiling id is gone from the card and the detail header
- [x] The quality pill is as wide as its text
- [x] The detail shows all four figures, with no radio groups
- [x] Prev/next live in the detail header
- [x] Lint, typecheck, tests, `i18n:check`
- [x] Browser-verify — ran a real search against the archive: the grid opens
      paired, carries no tiling id and the pill is content-width; the detail
      header reads `Distant match | 1 of 5 | Open in ExplOri | Send to Edit`
      with four captioned figures and zero radios. The deep link was checked
      against the live service rather than only its shape (the `/view` page
      answers 200, and the API it calls with the parsed parameters returns that
      exact tiling). **Not** verifiable there: anything driven by
      `requestAnimationFrame` — the pane suspends it — so both drag behaviours
      are covered by unit tests instead, each shown to fail against the old code
