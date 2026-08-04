# CP Tool Hint Floating Window

## Goal

Turn the crease-pattern tool hint / tool settings surface into a **floating
window** in the bottom right of the Edit workspace — roughly where it sits today,
but detached from the **View** dock pane and shifted ~50px left so it **overhangs
the pane's left edge onto the canvas**. Overhanging the seam is the point: a
surface that breaks the panel boundary reads as a floating window that appeared
*for the current tool*, not as one more section of the View pane.

The window must be:

- **Expandable and collapsible to just its header**, so it can be pushed out of
  the way when it covers something.
- **Persistent** in that choice — collapsed stays collapsed across tool switches
  and across reloads.
- **Absent entirely** when the active tool has nothing to say, exactly as today.

Nothing about *what* the surface shows changes: the same instructions, setting
groups, unavailable/notice messages, fold-angle control, apply and clear-seeds
buttons.

## Why it is inconspicuous today

The surface is `CpContextToolPanel`, rendered by `CreasePatternPanel` via
`createPortal` into `#cp-tool-options-pane-slot` — a slot div at the bottom of
`CpViewControlsPanel`, the 260px "View" pane the Edit layout adds to the right of
the crease pattern ([layoutStore.ts:197](apps/web/src/store/layoutStore.ts:197)).

Three things follow from that placement, and all three are the complaint:

1. It is **inside the pane, below the fold** — the last section of a scrolling
   column of grid/line-width/point-size controls, visually indistinguishable from
   them. It appears without announcing itself.
2. It is **gated on a dock pane being open**. Close or resize away the View pane
   and the tool's instructions vanish with it.
3. Its collapsed state is `useState(false)`
   ([CpContextToolPanel.tsx:179](apps/web/src/components/panels/CpContextToolPanel.tsx:179)),
   and the whole subtree unmounts whenever no command is active. So collapsing it
   lasts until you leave the tool, then it springs back open.

## Key design decisions

- **The window has to be portaled to `document.body` and positioned `fixed`.**
  This is forced, not chosen: overhanging the seam means the window must be
  clipped by neither neighbour, and both would clip it —
  `.cp-panel__viewport` is `overflow: hidden`, `.panel-body` is `overflow: auto`,
  and Dockview panels are transformed / `will-change` ancestors that trap `fixed`
  descendants. `FloatingToolbar`'s own doc comment names this exact case
  ("Body-portaled so it escapes transformed/`will-change` ancestors (e.g.
  Dockview panels)"), and `CpSelectionToolbar`, `CpImageInspector` and the
  annotation chrome all already work this way.

  So the *existing* portal still goes away — the body-wide `MutationObserver`
  that hunts for a slot inside another dock pane
  ([CreasePatternPanel.tsx:974](apps/web/src/components/panels/CreasePatternPanel.tsx:974)),
  the `toolOptionsPortalTarget` state, `cpToolOptionsPortal.ts`, the slot div.
  What replaces it is a body portal anchored to a rect, which is a mechanism the
  panel already has for four other surfaces.

- **One anchor rect, and the panel already holds it.** `toolbarContainer`
  ([CreasePatternPanel.tsx:919](apps/web/src/components/panels/CreasePatternPanel.tsx:919))
  is the `.cp-panel__viewport` element, already passed to `CpSelectionToolbar`
  and friends. Its **right edge is the seam** — the View pane's left edge is the
  same line — so the whole geometry derives from one rect the panel is already
  tracking. No cross-panel element lookup, no second observer.

- **The placement rule, stated once:**

  ```
  left   = cpViewportRect.right - OVERHANG        // OVERHANG = 50px
  bottom = viewportHeight - cpViewportRect.bottom + INSET
  width  = 288px (fixed)
  ```

  So the window always breaks the seam by exactly 50px whatever width the user
  drags the View pane to — the property the request is actually about. At the
  default 260px pane its right edge lands ~22px short of the app edge, which
  reads as a normal window inset. Bottom-aligned with the canvas so it shares a
  baseline with the viewport toolbar.

  **Amended during implementation** (the browser found it): sharing that baseline
  only works while the viewport toolbar stays clear of the corner. The toolbar is
  centred in the viewport, so at 1280px — a 431px viewport under a 407px toolbar —
  it reaches the corner and the window sat on top of it, covering 38px. The rule
  gained a fourth line: when the window's horizontal span overlaps the toolbar's,
  its bottom clears the toolbar's top instead of the canvas's. Flush wherever
  flush is possible, which at any normal desktop width is everywhere.

- **Plain fixed positioning, not `FloatingToolbar`.** The existing floating
  chrome is collision-aware — it flips and shifts to stay in view, because it
  tracks an object that moves under a camera. This window is pinned to a corner
  and must *not* move; flipping it would be a bug. It needs one clamp (keep the
  right edge on screen when the View pane is narrow or closed), which is three
  lines, versus adopting a placement engine whose whole job is the behaviour we
  don't want.

- **`CpDiagnosticHud` is the visual template.** It is already a collapsible
  overlay window in the *top right* of this viewport, with its bindings in a
  `use*` hook beside its own modules (`cp-workspace/diagnostics/`). The tool hint
  window should read as the same family — same border, translucent background,
  soft shadow, chevron summary row — so the canvas gains a second member of a
  set rather than a second unrelated box.

- **`CpContextToolPanel.tsx` stays in `components/panels/`.** Moving it to
  `cp-workspace/` would silently drop it out of the `max-lines` rule, which
  AGENTS.md names as the illegitimate way to make a number go down. Its
  `OVERSIZED_PANELS` entry and the note above it — that the seam this file wants
  is `CpContextToolGroup`, as its own change — stay as they are.

- **The window chrome is its own component** (`CpToolHintWindow`), added during
  implementation. The first pass put the portal, placement, collapse state and
  header inline in `CpContextToolPanel` and tripped its line cap by 8, which is
  the prompt that number exists for. The plan said that was a stop-and-reconsider
  rather than an edit-the-number, and reconsidering found a real seam: positioning
  and collapse are one concern, and the same one whatever the tool has to say. So
  the chrome went to `cp-workspace/toolHint/` beside the placement rule and the
  collapse preference, and what stayed behind is the tool's content. Both caps
  came *down* — 1110 → 1097 and 2687 → 2669.

- **Element class names stay `cp-context-panel__*`.** Only the root block's own
  rules change, from "full-width strip at the bottom of a pane" to "floating
  window". Renaming ~60 selectors plus every `className` in a 1,190-line file is
  churn with no behavioural payoff, and it would bury the rules that actually
  matter in the diff.

- **One collapse preference, not one per tool.** The user collapses it because it
  is in the way, which is a property of the window, not of the tool. Per-tool
  state would also mean the window silently re-opens as you cycle tools — the
  behaviour being fixed. Stored through `lib/storage.ts` like every other
  persisted preference.

- **Default expanded.** The instructions are the discoverable half of several
  tools (the three-crease fold-angle solve is unusable without them). A first-run
  collapsed default would trade one discoverability problem for a worse one.

## Approach

### Phase 0 — Verification (done, by source trace)

- [x] **Neither neighbour can host an overhanging child.** `.cp-panel__viewport`
      sets `overflow: hidden` ([theme.css:2455](apps/web/src/styles/theme.css:2455));
      `.panel-body` sets `overflow: auto` ([theme.css:449](apps/web/src/styles/theme.css:449)).
      Body portal + `fixed` is the only mechanism that spans the seam.
- [x] **The anchor element is already plumbed.** `attachViewport` stores the
      viewport element in `toolbarContainer` state, already passed as `container`
      to four body-portaled surfaces.
- [x] **Workspace switching tears the window down for free.**
      `activateWorkspace` calls `dockviewApi.clear()`
      ([layoutStore.ts:256](apps/web/src/store/layoutStore.ts:256)), unmounting
      the CP panel and its portal. No "hide when not in Edit" gate needed — but
      confirm in Phase 5 that the window does not survive a workspace switch.
- [x] **Focus stealing is already handled.** `.cp-panel__body`'s
      `onPointerDownCapture` focuses the container unless
      `isViewportInteractiveTarget(event.target)`, which matches
      `button, input, textarea, select, [role="menu"], [contenteditable]` — every
      control in the window. Body-portaled, the window is outside that subtree
      anyway, so the handler no longer fires for it at all.
- [x] **The portal has exactly one producer and one consumer.**
      `CP_TOOL_OPTIONS_PANE_SLOT_ID` appears only in `CreasePatternPanel.tsx`,
      `CpViewControlsPanel.tsx`, and `CpViewControlsPanel.test.tsx:94`.
- [x] **`cpLineTypeStatusLabel` has a second consumer**
      ([CreasePatternPanel.tsx:3103](apps/web/src/components/panels/CreasePatternPanel.tsx:3103))
      and its own test, so it must keep its current export path.

### Phase 1 — Placement rule (pure) + anchor hook

New `apps/web/src/cp-workspace/toolHint/toolHintPlacement.ts`:

- [x] `cpToolHintPlacement(viewportRect, windowSize): { left, bottom, width }` —
      the rule above, plus the clamp: `left` is capped so the right edge stays
      `>= 8px` inside the window, and floored at `8px` so a very narrow Edit pane
      pins it to the left instead of pushing it off-screen.
- [x] Unit tests: default 260px pane overhangs exactly 50px; a widened pane still
      overhangs exactly 50px; a closed View pane (seam at the app edge) clamps
      instead of overflowing; a viewport narrower than the window floors at 8px.

New `apps/web/src/cp-workspace/toolHint/useCpToolHintAnchor.ts`:

- [x] Takes the container element, returns the placement. Tracks the element with
      a `ResizeObserver` (sash drags, pane open/close) and `window` `resize`.
      Deliberately **not** subscribed to `cpOverlayViewStore` — the window is
      pinned to the pane, not to the camera, so it must not re-render per pan
      frame the way the object toolbars do.

### Phase 2 — Persisted collapse state

New `apps/web/src/cp-workspace/toolHint/useCpToolHintCollapsed.ts`:

- [x] `useCpToolHintCollapsed(): [boolean, (collapsed: boolean) => void]` —
      reads once on mount, writes through on change. Absent or non-boolean stored
      values fall back to `false` (expanded), matching the per-key validation in
      `lib/cpToolOptionPersistence.ts` / `cp-workspace/measurePreferences.ts`
      rather than adding a version field.
- [x] Add `cpToolHint: 'cp-tool-hint'` to `STORAGE_KEYS` in `lib/storage.ts`.
- [x] Unit test: default expanded; round-trips a write; ignores a corrupt value;
      survives unavailable storage.

### Phase 3 — The window shell

In `CpContextToolPanel.tsx` — small, local changes only:

- [x] Accept a `container: HTMLElement | null` prop, call the anchor hook, and
      wrap the existing `<section>` in a `createPortal(…, document.body)` with the
      computed `left` / `bottom` / `width` as inline style.
- [x] Swap `useState(false)` for `useCpToolHintCollapsed()`; add `data-collapsed`
      on the root so CSS can size both states.
- [x] Keep the early `return null` when there are no groups, no instructions, no
      unavailable message and no notice
      ([CpContextToolPanel.tsx:192](apps/web/src/components/panels/CpContextToolPanel.tsx:192)) —
      an empty floating window over the canvas would be worse than the status quo.
- [x] Keep the `onPointerDown` / `onClick` `stopPropagation` guards. They stop
      mattering for the panel body (the window is portaled out of it) and start
      mattering for anything listening at `document`.

In `theme.css`, rewrite `.cp-context-panel`'s own rules (leaving every
`__element` rule untouched):

- [x] `position: fixed` with `left`/`bottom`/`width` supplied inline;
      `z-index: 900` — above all in-pane chrome (the highest is the viewport
      toolbar at 17) and safely below `--z-modal` (9999).
- [x] Window chrome matching `.cp-diagnostic-hud`: full border (not the current
      `border-top`), `border-radius: 6px`, translucent `color-mix(...)`
      background, `var(--shadow-soft)`, `overflow: hidden`.
- [x] Cap the height and let the body scroll: the expanded body can be tall (the
      measure list, the six-field angle-system grid) and it no longer sits in a
      scrolling pane. `max-height` on the root plus `overflow-y: auto` on
      `.cp-context-panel__body`. Check nothing depended on the body's current
      `overflow: visible` — Radix `Select` portals out, so the likely answer is
      no, but the `<details>` "Exact form" block and the reset button's
      `--cp-context-reset-gutter` positioning are worth an eye.
- [x] Drop `width: 100%` and `border-top`.

### Phase 4 — Move the mount, delete the old portal

- [x] `CreasePatternPanel.tsx`: render `<CpContextToolPanel container={toolbarContainer} …/>`
      alongside the other body-portaled surfaces, gated on
      `editableCp && activeCpCommand`. All existing props unchanged.
- [x] Delete `toolOptionsPortalTarget` state, the `MutationObserver` effect, and
      the `CP_TOOL_OPTIONS_PANE_SLOT_ID` import.
- [x] `CpViewControlsPanel.tsx`: delete the slot div and its import.
- [x] Delete `apps/web/src/components/panels/cpToolOptionsPortal.ts`.
- [x] `theme.css`: delete `.cp-view-controls-panel__tool-options-slot` and its
      `:empty` rule.
- [x] `CpViewControlsPanel.test.tsx`: drop the slot assertion (the rest of that
      test — grid/snapping toggles — stays).

### Phase 5 — Tests and validation

- [x] Component test in `cp-workspace/toolHint/`: renders into the body portal;
      header toggles collapse; collapsed hides the body but keeps the title and
      meta; the collapse choice survives an unmount/remount cycle (the regression
      this change exists to fix); renders nothing when the active command has no
      groups, instructions, message or notice; renders nothing with a null
      container.
- [x] **i18n: no new strings expected.** The header already names the tool and
      says `Instructions` / `N settings`, and its accessible name comes from that
      text. If anything is added anyway, follow `apps/web/CLAUDE.md` —
      `i18n:extract`, translate all 8 locales, `i18n:stamp`, `i18n:check`.
- [x] `npx tsc --noEmit` + `npx vitest run` in `apps/web` (per
      `web-typecheck-regenerates-wasm`, the npm wrappers rebuild tracked
      `generated/**`), plus `npm run lint:web`.
- [x] The caps moved *down*, not up: `CreasePatternPanel.tsx` 2687 → 2669 and
      `CpContextToolPanel.tsx` 1110 → 1097. The first pass did trip the second cap
      by 8, which is what produced `CpToolHintWindow` — see Key design decisions.

### Phase 6 — Browser pass

Verified in the automated pane (measured, not eyeballed — it reports layout even
though it suspends rAF):

- [x] The overhang is exactly 50px, the window is a child of `document.body`, and
      it visibly crosses the View pane's left edge onto the canvas.
- [x] It clears the viewport toolbar — 0px vertical overlap where there was 38px
      of coverage before the step-over rule.
- [x] The border resolves to `--border-default` (`#3e4452`), not the blue active
      token it wore first.
- [x] Collapse leaves the header, title and setting count; the choice is written
      to `oristudio:cp-tool-hint-collapsed` and survives a reload.

Left for the author — these need a real window, a mouse, and a look:

- [ ] Drag the View pane's sash wider and narrower: the window should follow the
      seam and keep its 50px overhang. Close the pane entirely — it should stay,
      pinned near the app edge, and the step-over should release once the toolbar
      is clear.
- [ ] A tall tool (Angle system, or Measure after several readings): the body
      should scroll inside the window rather than run off the top of the canvas.
- [ ] Switch to Design and Simulate — the window should be gone, not floating over
      them.
- [ ] Open a modal (export image) — the modal should cover the window.
- [ ] Type into a numeric field, then press a canvas shortcut (`Esc`, tool
      chords) — focus and shortcut routing should behave as they did in the pane.
- [ ] Light theme, and against the diagnostic HUD in the opposite corner: the two
      should read as the same family.

## Affected Areas

- **New**: `apps/web/src/cp-workspace/toolHint/` — `toolHintPlacement.ts`,
  `useCpToolHintAnchor.ts`, `useCpToolHintCollapsed.ts`, `CpToolHintWindow.tsx`,
  and tests for the placement rule, the collapse preference and the window.
- **Edit**: `apps/web/src/components/panels/CpContextToolPanel.tsx` (content
  only now — the chrome moved out), `CreasePatternPanel.tsx` (mount moves, old
  portal machinery out), `CpViewControlsPanel.tsx` (slot out),
  `CpViewControlsPanel.test.tsx` (assertion out), `lib/storage.ts` (one key),
  `styles/theme.css` (root block rewritten, slot rules deleted),
  `eslint.config.js` (both caps lowered).
- **Delete**: `apps/web/src/components/panels/cpToolOptionsPortal.ts`.
- **Unchanged**: every `cp-context-panel__*` element rule, `CpContextToolGroup`,
  `CpContextToolReset`, `FoldAngleControl`, `cpLineTypeStatusLabel` and its
  export path, `lib/oristudioCpToolSettings.ts`,
  `lib/oristudioCpToolInstructions.ts`, `FloatingToolbar` and
  `useCanvasObjectAnchor` (not reused — see Key design decisions).

## Open risks

- ~~**Collision with the viewport toolbar.**~~ Resolved: it was real (38px of
  coverage at 1280px), and the placement now steps over the toolbar when the two
  would overlap. See the amended placement rule.

- **The window covers the View pane's own controls.** That is the request — but
  the bottom of that pane is where point size and line width live, and they will
  now sit behind the window whenever a tool with settings is active. Collapse is
  the escape hatch the user asked for; if it turns out to be the wrong trade, the
  cheaper fix is bottom-padding on `.cp-view-controls-panel__body` equal to the
  collapsed header height, so the pane always scrolls clear of it.

- **Sash-drag smoothness.** The window repositions from a `ResizeObserver`, which
  fires per frame during a sash drag. The window subtree is small and does not
  re-render (only its inline style changes), but this is worth watching in the
  Phase 6 pass — if it lags the sash, the fix is to write `left`/`bottom` to CSS
  custom properties imperatively rather than through React state.

- **Body scrolling vs. the reset button.** `.cp-context-panel` is the positioning
  context for the header's reset button (`--cp-context-reset-gutter`). Adding
  `overflow-y: auto` to the *body* should not touch it, but the root sets
  `overflow: hidden`, so verify the button is not clipped once the root becomes a
  rounded floating window.

## Deliberately out of scope

- **Dragging and resizing.** The request names a position and one interaction
  (collapse). A drag would bring position persistence, viewport-bound clamping,
  and its own collision rules — a separate change if it is ever wanted.
- **A keyboard shortcut to toggle the window.** If added later it goes in
  `apps/web/src/keyboard/` (registry + surface executor), never a listener on the
  panel — AGENTS.md is explicit, and the eslint rule enforces it.
- **Splitting `CpContextToolGroup` out of `CpContextToolPanel.tsx`.** The real
  seam in that file, already documented in `eslint.config.js`, and already called
  out there as a change of its own rather than a rider on the next feature.
