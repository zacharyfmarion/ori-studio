# Floating Toolbar Bounds and Stacking

## Goal

A canvas object's floating bar should behave like what it is — chrome belonging
to the crease-pattern **editing viewport** — instead of a window-level overlay
that outranks the whole app.

Two symptoms reported on Discord (thread: "Folded rendering bar on top of
everything"):

1. **It paints over every menu and popup.** Open the Crease Pattern menu with a
   folded figure selected and the bar sits on top of the dropdown.
2. **It spills out of the edit pane** — over the View inspector on the right,
   over the tool rail on the left.

Target behaviour: the bar draws *under* menu bar dropdowns, modals, context
menus and tooltips, *above* everything inside a pane, and never leaves the
crease-pattern viewport's rectangle.

These are two independent bugs with two independent fixes, and **both are
needed** — see below.

## Diagnosis

### Symptom 1 — stacking

`.floating-toolbar` ([theme.css:3261](apps/web/src/styles/theme.css:3261)) is
`z-index: var(--z-portaled-popover)` = **10000**, the top tier in the app. That
tier is meant for transient portaled popovers, and the bar is not one — it is
persistent chrome. It therefore outranks:

| Surface | Selector | z-index |
| --- | --- | --- |
| Menu bar dropdowns | `.menu-dropdown` ([MenuBar.css:54](apps/web/src/components/MenuBar.css:54)) | 9999 |
| Settings / help / confirm modals | `--z-modal` ([theme.css:59](apps/web/src/styles/theme.css:59)) | 9999 |
| CP-detect import modal | `.cp-detect-modal` ([CpDetectImportModal.css:4](apps/web/src/components/CpDetectImportModal.css:4)) | 80 |

Nothing between `.app-layout` and `.menubar__menu-wrapper` sets `z-index`,
`transform`, `filter` or `will-change`, so the dropdown's 9999 and the
body-portaled bar's 10000 land in the **same** (root) stacking context and
compare directly. 10000 wins. That is the whole of symptom 1.

`CpSelectionToolbar` already documents a workaround for this
([CpSelectionToolbar.tsx:150-153](apps/web/src/cp-workspace/CpSelectionToolbar.tsx:150)):
every action clears the selection so the bar cannot linger "over the export
modal, which it out-z-indexes". That comment is describing this bug.

### Symptom 2 — bounds

[`FloatingToolbar`](apps/web/src/components/ui/FloatingToolbar.tsx:82) configures
collision handling as:

```ts
flip({ padding: 8 }),
shift({ padding: 8, limiter: limitShift() }),
```

Neither passes a `boundary`, so `detectOverflow` falls back to
`clippingAncestors`. The pill is body-portaled with `strategy: 'fixed'` (both
deliberate — it has to escape Dockview's transformed panels), so its only
clipping ancestor **is the browser window**. floating-ui is doing exactly what
it was asked: keep the bar inside the *window*. Nobody ever told it about the
pane.

### Why one fix is not enough

A body-portaled, positively-z-indexed element paints above every Dockview panel
regardless of the number, because the panels themselves sit at `z-index: auto`
in the root stacking context. So lowering the z-index alone will **not** stop
the bar covering the View pane or the tool rail — only the bounds clamp does
that. Conversely the clamp does nothing about menu dropdowns, which overlap the
viewport rectangle legitimately. Fix 1 orders the bar against portaled chrome;
fix 2 keeps it off everything else.

## Approach

### 1. Give the bar its own z tier

Add a token beside the two that exist, and document the scale in the same block:

```css
/* In-pane chrome: 1–20, plain z-index inside a pane's own stacking context. */
--z-canvas-overlay: 900;   /* Body-portaled chrome belonging to one pane. */
--z-modal: 9999;
--z-portaled-popover: 10000;
```

900 is not a new invention — it is the tier
[`.cp-context-panel`](apps/web/src/styles/theme.css:5376) already occupies, with
the comment *"Above all in-pane chrome (max 17), below `--z-modal`"*. That is
precisely the description of a floating object toolbar. Point both at the token.

Menus opened **from** the bar are unaffected: `ExportMenu` and `ChoiceMenu`
portal their content as `.context-menu` at 10000, so they still open above the
pill that spawned them.

Two consequences worth stating:

- The `runAndDismiss` workaround in `CpSelectionToolbar` is no longer
  load-bearing for modal overlap. **Leave it** — dismissing the selection after
  acting on it is good behaviour on its own merits — but update the comment so
  it stops citing a bug that no longer exists.
- `.cp-detect-modal` at 80 is currently covered by the bar and would still be
  covered at 900. Point it at `--z-modal`; it is a one-line fix to a real
  pre-existing bug in the same family, and leaving it means the "bar covers
  modals" report is only half fixed.

`.cp-tool-option__header` also wears `.floating-toolbar`
([CpToolOptionLayer.tsx:118](apps/web/src/cp-workspace/toolOptions/CpToolOptionLayer.tsx:118))
for its look, but lives inside a transformed ancestor, so its stacking is
already contained and the token change is inert for it. No action.

### 2. Teach `FloatingToolbar` about a boundary

Add one prop:

```ts
/**
 * The element the toolbar must stay inside. Omitted, it stays inside the
 * browser window — the floating-ui default for a fixed, body-portaled pill.
 */
boundary?: Element | null;
```

Thread it into the overflow-aware middleware:

```ts
const overflow = { boundary: boundary ?? 'clippingAncestors', padding: 8 };
middleware: [
  offsetMiddleware(offsetPx),
  flip(overflow),
  shift({ ...overflow, crossAxis: true, limiter: limitShift() }),
  size({ ...overflow, apply: ({ availableWidth, elements }) => { … } }),
]
```

Three notes on that list:

- **`crossAxis: true` on `shift` is new and required.** `shift`'s main axis for
  a `top-*` placement is horizontal; without the cross axis, a figure taller
  than the pane leaves `flip` with no fitting side and the bar overflows
  vertically. With it, the bar slides inside and overlaps the figure — the
  standard behaviour for a selection toolbar in a design tool.
- **`size` caps `max-width` to the space available.** The inline-simulation
  inspector (slider plus seven controls) is wider than a narrow CP pane, and no
  amount of shifting fixes an element that does not fit. Pair it with
  `flex-wrap: wrap` on `.floating-toolbar` so a constrained bar becomes two rows
  rather than overflowing its own boundary.
- **The middleware array must be memoized on `[boundary, offsetPx]`**, or every
  render hands `useFloating` a fresh array and forces a recompute.

Then pass `boundary={container}` at all five call sites. Every one of them
already receives that element and forwards it to
[`useCanvasObjectAnchor`](apps/web/src/cp-workspace/canvasObjects/useCanvasObjectAnchor.ts:32),
so this is a one-line addition each:

| Call site | Line |
| --- | --- |
| `CpSelectionToolbar` | [:162](apps/web/src/cp-workspace/CpSelectionToolbar.tsx:162) |
| `CpFoldedFigureToolbar` | [:149](apps/web/src/cp-workspace/folded/CpFoldedFigureToolbar.tsx:149) |
| `CpImageInspector` | [:41](apps/web/src/cp-workspace/CpImageInspector.tsx:41) |
| `CpTextEditor` (`TextToolbar`) | [:263](apps/web/src/cp-workspace/CpTextEditor.tsx:263) |
| `InlineSimulationInspector` | [:145](apps/web/src/cp-workspace/InlineSimulationInspector.tsx:145) |

The container is
[`.cp-panel__viewport`](apps/web/src/components/panels/CreasePatternPanel.tsx:2861),
which excludes `CpToolRail` (a sibling) and every other pane. So clamping to it
answers both halves of "not into the View pane or any other part of the UI"
without needing to know what else is on screen.

### 3. Vanish when the object leaves the pane

`limitShift()` deliberately lets the pill detach and follow its object off the
edge rather than sliding along the boundary pointing at nothing. Good — but the
object can be panned fully outside the pane, and then the bar is a pill floating
over the View pane attached to nothing visible.

Add a pure predicate beside the component and return `null` when it fails:

```ts
// floatingToolbarBounds.ts
export function anchorIntersectsBoundary(
  anchor: FloatingAnchorRect,
  boundary: DOMRect,
  padding: number
): boolean
```

Pure and DOM-free, following
[`toolHintPlacement.ts`](apps/web/src/cp-workspace/toolHint/toolHintPlacement.ts:71)
and `toolOptionPlacement.ts` — which is what makes this testable at all, since
jsdom gives floating-ui nothing but zero rects. Preferred over floating-ui's
`hide({ strategy: 'referenceHidden' })` for exactly that reason.

### 4. Reposition on pane resize

`autoUpdate` observes the reference and the floating element, not the boundary.
Dragging the Dockview splitter between the CP pane and the View pane changes the
boundary without necessarily changing anything React re-renders on. Attach a
`ResizeObserver` to the boundary element and call `update()`.

## Explicitly out of scope

Named so a reviewer does not read them as oversights:

- **The bottom viewport toolbar.** A figure at the bottom of the pane can still
  put the bar on top of `.viewport-toolbar`
  ([theme.css:5951](apps/web/src/styles/theme.css:5951)) — it is *inside* the
  boundary, so the clamp does not move it. The precedent for fixing this is
  `cpToolHintPlacement`'s `obstacle` parameter. Deferred: it needs a measured
  rect threaded to five call sites, and the bar is centred-ish while the zoom
  controls are centred exactly, so they mostly miss each other today.
- **The tool hint window.** `.cp-context-panel` overhangs the CP/View seam *by
  design* — `CP_TOOL_HINT_OVERHANG` exists to make it do that, and it is visible
  doing so in the second report screenshot. If that overhang is also unwanted,
  it is a separate product decision, not a bug in this mechanism.
- **Menus opened from a bar near the pane's right edge** still open across the
  View pane. They are transient popovers with their own collision handling, and
  the report is about the persistent bar.

## Affected Areas

- `apps/web/src/components/ui/FloatingToolbar.tsx` — `boundary` prop, middleware,
  memoization, boundary `ResizeObserver`, empty render when out of bounds.
- `apps/web/src/components/ui/floatingToolbarBounds.ts` *(new)* + `.test.ts`.
- `apps/web/src/styles/theme.css` — `--z-canvas-overlay` token and scale comment;
  `.floating-toolbar` and `.cp-context-panel` point at it; `flex-wrap` on the pill.
- `apps/web/src/components/CpDetectImportModal.css` — `z-index: var(--z-modal)`.
- Five call sites: `CpSelectionToolbar.tsx`, `folded/CpFoldedFigureToolbar.tsx`,
  `CpImageInspector.tsx`, `CpTextEditor.tsx`, `InlineSimulationInspector.tsx`.
- `apps/web/src/cp-workspace/CpSelectionToolbar.tsx` — comment refresh only.
- Tests: `FloatingToolbar.test.tsx`, `CpFoldedFigureToolbar.test.tsx`.

No engine, wasm, Rust, i18n or analytics surface is touched — no new user-facing
strings, and no new user-facing feature to instrument.

## Checklist

- [x] Add `--z-canvas-overlay: 900` with the tier comment; repoint
      `.floating-toolbar` and `.cp-context-panel` at it.
- [x] Repoint `.cp-detect-modal` at `--z-modal`.
- [x] Add `anchorIntersectsBoundary` + unit tests over plain rects (inside,
      straddling each edge, fully outside, zero-size boundary).
- [x] Add the `boundary` prop; thread it through `flip` / `shift` / `size`;
      memoize the middleware; add `crossAxis: true`.
- [x] `max-width` via `size` + `flex-wrap: wrap` on the pill.
- [x] `ResizeObserver` on the boundary → `update()`.
- [x] Return `null` when the anchor no longer intersects the boundary.
- [x] Pass `boundary={container}` at all five call sites.
- [x] Refresh the `runAndDismiss` comment in `CpSelectionToolbar`.
- [x] `FloatingToolbar.test.tsx`: pill unmounts when the stubbed container rect
      no longer contains the anchor; existing wheel tests still pass.
- [x] `CpFoldedFigureToolbar.test.tsx`: the boundary reaches `FloatingToolbar`.
      Mutation-checked — removing `boundary={container}` fails the new case.
- [x] `npm run lint:web`, `npm run typecheck:web`, `npm run test:web`.

### Manual verification (browser)

The whole change is layout and paint order, so the tool-checkable part above
proves the wiring and not the result. In the Edit workspace with the View pane
open:

- [ ] Select a folded figure, open **Crease Pattern** in the menu bar — the
      dropdown and its submenu draw over the bar.
- [ ] Open Settings and the CP-detect import modal with a figure selected — both
      draw over the bar.
- [ ] Pan a selected figure toward the right edge — the bar stops at the pane
      seam and never enters the View pane.
- [ ] Pan toward the left edge — the bar never enters the tool rail.
- [ ] Pan the figure fully off the pane — the bar disappears rather than sticking
      to the seam.
- [ ] Drag the CP/View splitter with a bar showing — it re-clamps as the pane
      narrows.
- [ ] Narrow the CP pane hard with an inline simulation selected — the inspector
      wraps instead of overflowing.
- [ ] Repeat the first and third checks with a box-select crease selection, a
      selected reference image, and a text annotation being edited.
