# Box Pleating Color Theming

## Goal

Make the Box Pleating surfaces use the app's existing semantic design tokens
instead of a parallel `--bp-*` palette, so the BP tree and packing views read as
part of the same system as the Edit (CP) workspace and follow the theme
correctly. Also make the packing "paper" use the same background as the Edit
workspace canvas.

## Background / problem

- The BP CSS carries a **parallel palette of ~19 `--bp-*` variables** (ported
  verbatim from the reference branch). They shadow the app's real tokens and
  were mis-mapped to UI **accent** colors, which is why the packing shows a
  jarring bright **teal** (flaps/rivers = `--accent-primary`) and **gold**
  (axis-parallel = `--accent-secondary`) that are hard to read and theme-fragile.
- The packing **paper is light/cream** (`--bg-paper`) even in the dark app
  theme, so it doesn't match the Edit workspace canvas (`--bg-canvas`, a dark
  ink surface) and the shared crease colors would land on a different backdrop.

The app already exposes exactly the tokens we need (from the Edit view):
`--fold-mountain`, `--fold-valley`, `--fold-ridge`, `--fold-hinge`,
`--fold-flat`, `--fold-border` (neutral ink), `--fold-unassigned`,
`--cp-color-green`, plus `--status-danger`, `--accent-*`, `--border-*`,
`--text-*`, `--bg-canvas`, `--bg-canvas-grid`.

## Approach

Two independent parts, both confined to CSS (`apps/web/src/styles/theme.css`)
plus one small class already present in the packing markup.

### Part A — Delete `--bp-*`, wire rules to semantic tokens

1. Remove the entire `--bp-*` variable block (19 declarations).
2. Replace each `var(--bp-…)` usage (48 occurrences across the `.bp-packing-*`
   and `.bp-tree-*` rules) with the mapped app token below.

Packing (BP Editor):

| Element / class | Was `--bp-*` | → App token |
| --- | --- | --- |
| Flap edges/contours (`.bp-packing-flap`) | `--bp-flap` = accent (teal) | `--fold-border` (neutral ink) |
| Flap fill (`.bp-packing-flap`) | `color-mix(bg-canvas, --bp-flap)` | `color-mix(--bg-canvas, --fold-border)` |
| Flap clearance (`.bp-packing-flap-clearance`) | `--bp-flap-clearance` = accent-tertiary | `--fold-unassigned` (muted) |
| Ridge creases (`.bp-packing-primitive--ridge`) | `--bp-ridge` = `--fold-ridge` | `--fold-ridge` (direct) |
| Hinge / circles (`.bp-packing-primitive`) | `--bp-hinge` = `--fold-hinge` | `--fold-hinge` (direct) |
| Axis-parallel (`.bp-packing-primitive--axis-parallel`) | `--bp-axis-parallel` = accent-secondary (gold) | `--cp-color-green` |
| Rivers (`.bp-packing-river-shade`, label) | `--bp-river` = accent | low-alpha `--fold-hinge` shade / `--text-secondary` label |
| Grid lines (`.bp-packing-grid-line`) | `--bp-grid` | `--bg-canvas-grid` |
| Grid major/diagonal | `--bp-grid-major/-diagonal` | `--bg-canvas-grid` (stronger/dashed) |
| Invalid junction (`.bp-packing-conflict`) | `--bp-invalid-junction` = danger | `--status-danger` (direct) |
| Device (`.bp-packing-device-*`) | `--bp-device` = accent-tertiary | `--fold-flat` (or `--accent-tertiary`) |
| Dot (`.bp-packing-flap-dot`) | `--bp-dot` = accent | `--fold-border` / `--text-primary` |
| Label (`.bp-packing-label`) | `--bp-label` / `--bp-label-stroke` | `--text-primary` / `--bg-canvas` (halo) |
| Selection (`.*--selected`) | `--bp-selection` = accent | `--accent-primary` (direct) |
| Hover (`:focus-visible`) | `--bp-hover` = accent-hover | `--accent-hover` (direct) |

Tree (BP tree editor):

| Element / class | Was `--bp-*` | → App token |
| --- | --- | --- |
| Leaf edges (`.bp-tree-edge--leaf`) | `--bp-tree-leaf-edge` | `--tree-edge` |
| River edges (`.bp-tree-edge--river`) | `--bp-border` | `--tree-edge` (muted) |
| Root node (`.bp-tree-node--root`) | `--bp-tree-root` | `--accent-secondary` over `--tree-node` |
| Node dot | `--bp-dot` | reuses base `.tree-node` (`--tree-node` / `--tree-node-stroke`) |
| Node/edge labels | `--bp-label` | `--text-primary` |
| Hover / selected | `--bp-hover` / `--bp-selection` | `--accent-hover` / `--accent-primary` |

Notes:
- Ridge and hinge already pointed (indirectly) at `--fold-ridge` / `--fold-hinge`,
  so their appearance is unchanged — we just drop the indirection.
- Net visible change: **teal flaps → neutral ink**, **gold axis-parallel →
  green**; everything else keeps its hue but now shares the Edit view's exact
  tokens.

### Part B — Packing paper = Edit workspace surface

Discovery during implementation: the **editable CP paper is transparent**, so
the Edit workspace draws creases directly on the dark **`--bg-primary`**
(`#101417`) pane. "Match the edit background" therefore means the packing paper
becomes **dark**, not the cream `--bg-paper`.

- Override only `.bp-packing-sheet` (not the shared `.paper`):
  - `.bp-packing-sheet { fill: var(--bg-primary); stroke: var(--border-strong); }`
  - Packing grid lines → `--bg-canvas-grid`.
- Consequence for Part A: on a dark surface the **neutral** elements must be
  **light**, so flaps/dots/labels map to `--text-primary` (not `--fold-border`,
  which is near-black for a light paper). The bright `--fold-*` crease colors are
  already legible on dark — the whole point of matching the Edit surface.
- The BP **tree** pane already has no paper (infinite canvas on the pane
  background), so it needs no paper change — only the token rewrite in Part A.

## Affected areas

- `apps/web/src/styles/theme.css` — delete `--bp-*` block; rewire ~48 usages;
  add `.bp-packing-sheet` background override + grid token swap.
- No TSX changes expected (classes already exist). If a color is set inline in
  `BpPackingPanel.tsx`/`BpTreePanel.tsx` rather than via a class, move it to a
  token-driven class.

## Risks / notes

- `.paper` is shared with the TreeMaker design canvas and the editable CP paper;
  scope the dark-background change to `.bp-packing-sheet` only.
- Legibility: verify the `--fold-*` hues (mountain red, valley blue, ridge,
  hinge, green axis-parallel, ink flaps) read well on `--bg-canvas` at packing
  zoom — they're the Edit view's own colors, so they should, but confirm in both
  light and dark app themes.
- Keep the accent tokens strictly for **selection/hover**, nothing structural.

## Checklist

- [ ] Delete the `--bp-*` variable block from `theme.css`.
- [ ] Rewire all `.bp-packing-*` color usages to the mapped tokens.
- [ ] Rewire all `.bp-tree-*` color usages to the mapped tokens.
- [ ] Add `.bp-packing-sheet` background = `--bg-canvas`, grid = `--bg-canvas-grid`.
- [ ] Grep confirms zero remaining `--bp-` references.
- [ ] Visual pass: packing + tree in dark and light app themes; selection/hover
      still use the accent; flaps ink, axis-parallel green, ridge/hinge unchanged.
- [ ] `npm run lint:web`, `typecheck`, `test:web`, production build.
