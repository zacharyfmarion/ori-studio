# Styling refinements: one header height, one radius, a tool card that resizes

## Goal

Four changes from one pass over the app's chrome:

1. **One header height.** Design's tab strip (32px) meets References and
   Simulate (36px).
2. **The tool card resizes smoothly.** The floating tool hint window in Edit
   animates its height when its content changes — Extend Line's Active ↔ Same
   is the case that prompted this — and when it collapses and expands. The
   control you just pressed does not move.
3. **One radius: the icon buttons' 8px.** Controls and floating surfaces wear
   it. A toolbar that hugs its buttons is concentric with them (8 + its 4px
   padding = 12px), and rows inside a menu are concentric inward (4px). The
   toolbars become one shared `Toolbar` component with more vertical padding,
   and the tool rail's buttons take the radius.
4. **Scoped as it goes.** Every component whose styles change here moves into a
   CSS module (`apps/web/docs/styling.md`), so nothing can restyle it from
   outside again.

## Base

Branched from `claude/unified-rendering-export-abb3c9` (PR #417, draft, 89
commits ahead of `main`), which brings the scoped-CSS setup
(`implementation-plans/scoped-css.md`) and the segmented control's module. This
branch's PR targets that branch while #417 is open, and is retargeted to `main`
once #417 has merged (`gh pr view 417 --json state,mergedAt` first).

## What is there today

Measured on the base branch in the Browser pane, 1440×900, dark theme.

| Surface | Today |
| --- | --- |
| Design tab strip (`.design-tab-strip`) | 32px (`min-height: 32px`); its 28px `+` button has 1.5px above and below it |
| References header (`.panel-toolbar`, holding the mode tabs) | 36px |
| Simulate header (`.panel-toolbar`) | 36px |
| Simulate and References dock tab bars | 36px, raised from the dock's 28px in `App.css` to meet `.panel-toolbar` |
| Edit dock tab bar (View / Properties) | 28px — stays (decision 4) |
| Tool card (`CpToolHintWindow`, `.cp-context-panel`) | Extend Line: 234px in Active, 187px in Same, and the change is a jump. The card is pinned by `bottom`, so its top edge jumps 47px |
| Floating bottom toolbar (`.viewport-toolbar`) | 34px tall, `padding: 2px 6px`, radius 6px (`--radius-md`). Its icon buttons are 8px; the zoom readout, Symmetry and the rotation readout are 4px |
| Tool rail buttons (`.cp-tool-rail__button`) | 38px, radius 4px (`--radius-sm`) |
| Icon buttons (`IconButton`, `.ui-control--rounded`) | 8px (`--radius-lg`) — the target |
| Selection toolbar (`FloatingToolbar`) | 8px, `padding: 4px 8px` |
| Floating surfaces at 6px | tool card, diagnostic HUD, context menu, select list, tooltip, the bottom toolbar's dropdowns, canvas status readout, BP packing alerts |
| Other floating radii | BP canvas pills 10px, Paper dash menu 9px, menu bar dropdown 4px, update card 12px |

Three things that shape the work:

- **The global stylesheets are at their ratchet ceilings**: `theme.css` holds
  9,165 code lines and `App.css` 1,009, exactly their limits in
  `globalStylesheets.test.ts`. New tokens net out against blocks that leave for
  modules, and each phase lowers the ceilings to what it leaves (the test also
  fails 25 lines under).
- **Global classes other components lean on.** A module class is hashed and
  private, so each of these has to become a component, a prop or a data
  attribute before its block can move:
  - `.viewport-toolbar` — `useCpToolHintAnchor` finds the bar with
    `querySelector`. `viewport-toolbar__menu-anchor` and `__dropdown` are used
    by DesignPanel, BpPackingPanel and BpPackingSymmetryMenu.
  - `.floating-toolbar` — worn by `CpToolOptionLayer` and `CpRegionChipBar`;
    `__separator` by `CpTextEditor` and `CpFoldedFigureToolbar`.
  - `design-tab*` — `ReferencesModeSwitch` borrows them on purpose, "so the two
    strips cannot drift apart".
  - `cp-tool-rail__*` — the tool glyph (`cpToolGlyph.tsx`, which the phone
    picker also draws) and `CpShiftLatchToggle`.
  - `.viewport-status-readout` — `useCpDiagnosticHudLane` measures it.
  - `context-menu__*` — hand-applied to Radix menu parts in 12 files besides
    `ContextMenu.tsx`.
- **Dead CSS**: 43 of `theme.css`'s blocks (about 820 code lines) style classes
  that no source file, script or `index.html` names. The largest are the
  deleted sequence prototype's (`sequence-panel`, `sequence-diagram-step`, …),
  `cp-selection-transform` and the old diagnostics overlay
  (`cp-diagnostic-point`, …).

## Decisions (2026-10-01)

1. **Radius scope: floating chrome.** The bottom toolbars and the controls on
   them, the tool rail's buttons, and every floating surface at 6–10px today.
   Rows inside menus keep a nested radius. Inputs, number fields, modal
   internals, chips and toggles are not in this pass.
2. **Corners: concentric.** A toolbar that hugs its buttons takes their radius
   plus its padding — 12px for the bottom toolbars, the selection toolbar and
   the canvas pills. Cards, menus, popovers, tooltips and readouts are 8px.
3. **CSS modules: everything touched moves.** This includes the tool rail, the
   Design tab strip with References' mode tabs (onto one shared component), and
   every menu or popover whose radius changes. This is now the rule for every
   change: `AGENTS.md` › "Migrate what you touch". Each move is its own commit,
   with no visual change, ahead of the restyle.
4. **Extras.** The tool card's collapse and expand animate too. Edit's dock tab
   bar stays at 28px.
5. **A toolbar's padding is the toolbar's, not a token.** It lives in one
   shared `Toolbar` component's module, and so does the concentric radius
   derived from it. The bottom toolbar, the floating toolbars and the canvas
   pills compose that component. A token is only for a value that independent
   components, or third-party markup, must agree on.
6. **Open: one toolbar look.** Today the three toolbar looks differ:
   - The bottom toolbar is translucent (`--domain-overlay-bg`), with a long,
     soft overlay shadow.
   - The floating toolbar is opaque (`--bg-elevated`), with a short shadow
     hard-coded in `rgb()`.
   - The BP pills are opaque, with `--border-strong` and the context-menu
     shadow. `--border-strong` is the theme's *active* border, which makes an
     idle surface read as focused; the tool card avoids it for that reason.

   **Recommendation**: one look, the bottom toolbar's, with `--border-default`
   everywhere. A `tone` prop only if one of the differences turns out to be
   deliberate.

## Approach

### The rule

One number, and containers derive from it:

- A **control or a floating surface** is `--radius` (8px).
- A **container that hugs controls** is concentric with them: their radius plus
  its padding (12px for the toolbars).
- A **row inside a surface** is the surface's radius minus its padding. An 8px
  menu with 4px padding has 4px rows, which is already the case for the context
  menu and the select list.

Only `--radius` is global. The derived radii are computed in each container's
own module, from `--radius` and the container's own padding:

```css
.bar {
  --pad: 4px; /* module-local: the toolbar's own padding */
  padding: var(--pad);
  border-radius: calc(var(--radius) + var(--pad));
}
```

The segmented control is the precedent: an 8px track, 3px padding, 5px pills.
The rule goes into `docs/styling.md`, so the next surface follows it without
having to rediscover it.

### Phase 1 — Tokens, and the dead CSS

In `theme.css` `:root` (tokens are global; styling rule 6):

```css
--radius: 8px;                  /* the icon buttons' radius: controls and floating surfaces */
--radius-lg: var(--radius);
--radius-md: calc(var(--radius) - 2px);
--radius-sm: calc(var(--radius) - 4px);

--workspace-header-height: 36px;

--motion-duration: 160ms;
--motion-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
```

- Each of these is shared by components that do not know about each other, and
  that is what makes it a token (decision 5):
  - **`--radius`**: everything wears it.
  - **The header height**: the dock's tab bar (third-party; it only takes a
    variable), the panel toolbars and the tab strip all need it.
  - **The motion pair**: the segmented pill and the tool card both use it.
- A toolbar's padding is not shared that way, so it is not here.
- The scale keeps its values (8 / 6 / 4) but derives from `--radius`, so the
  app's radius really is one number.
- `.ui-control--rounded` reads `--radius`.
- The motion pair is the segmented pill's slide, hard-coded in its module
  today. The module reads the tokens instead, and the tool card uses the same
  pair, so a mode switch's pill and the card resizing under it move as one.
- **The dead blocks go in this phase**, every one confirmed by hand. A
  dynamically built class name would read as dead to the scan.
- **`src/styles/liveSelectors.test.ts`** keeps dead CSS from coming back.
  - Every class a global stylesheet styles must appear in some source file,
    script or `index.html`.
  - Third-party markup is allowed by prefix (`dv-`, sonner's), and a short
    allowlist covers classes built at runtime, each with its reason.
  - It is also the backstop for a move that leaves a rule behind.
- The deletions more than pay for the token lines, so `theme.css`'s ceiling is
  never raised.
- Nothing changes on screen in this phase.

### Phase 2 — Header height

- `--workspace-header-height` replaces the literal 36px in the app-shell rules
  that already measure it: `.panel-toolbar`, `.references-sidebar__header` and
  the Simulate / References dock override in `App.css`. Those stay global; they
  are the shell's layout (styling rule 4).
- **One tab strip for both strips**: `components/ui/WorkspaceTabStrip.tsx` with
  its module, on Radix Tabs. It covers the strip, list, tab, trigger and title,
  plus optional close and add slots. `DesignTabStrip` and
  `ReferencesModeSwitch` compose it. They share the classes today so they cannot
  drift; a shared component keeps that guarantee once the classes are hashed.
  - **Standalone** (Design) is the header itself: `min-height:
    var(--workspace-header-height)`, with its own bottom border and ground.
    - Tabs stretch to the full 36px, and so does the click target, since the
      trigger is the whole tab.
    - The 28px `+` button centres with 4px either side.
  - **`embedded`** (References) sits inside a `.panel-toolbar` and stretches to
    it: no border, no ground, no height of its own. This replaces the
    `.references-mode.design-tab-strip` overrides.
  - **`tone="peers"`** (References): an inactive tab keeps the secondary
    colour, with its icon at full strength. This replaces the
    `.references-mode .design-tab` rules.
  - **`fill`** (References on a phone): the tabs share the width, each one
    `--touch-target` tall. This replaces the coarse-pointer
    `.references-workspace .references-mode` rules.
- `DesignTabStrip` keeps all its behaviour (drag reorder, rename, close); only
  the classes on its markup change. `[data-design-tab]` stays, because the drag
  code and the tests read it.
- `App.css`'s `.design-tab-strip { grid-row: 1 }` is the shell placing the
  strip. It becomes a shell class passed to the strip's root (styling rule 3
  allows root placement).
- Deleted from `theme.css`: the `.design-tab*` and `.design-tab-strip*` rules,
  and both the base and coarse-pointer `.references-mode` overrides.
- Tests:
  - `DesignTabStrip.test.tsx` reads declarations out of `theme.css`
    (`declarations('.design-tab__trigger')`), so it reads the module instead.
  - Its DOM queries move from `.design-tab__*` to roles (`tab`, the close
    button's name) and `[data-design-tab]`.
  - `ReferencesPanel.test.tsx` gets the same treatment.

### Phase 3 — One `Toolbar`, and the bottom toolbar on it

The bottom bar is drawn by Edit (`CreasePatternPanel`), Design's tree and
packing panes (`TreeEditorToolbar`, `DesignPanel`, `BpPackingPanel`) and
References (`ReferencesViewportToolbar`), all through `ViewportToolbar`.

- **`components/ui/Toolbar.tsx` and its module**: the chrome every floating bar
  shares. It renders `role="toolbar"` and holds:
  - its padding (`--pad: 4px`, module-local) and the concentric radius
    `calc(var(--radius) + var(--pad))`, 12px
  - the border, ground and shadow (decision 6), the gap (6px, which the
    floating toolbar already uses), and wrapping
  - `ToolbarSeparator`, and `ToolbarGroup`: a run of controls that wraps as a
    unit. This is today's `.viewport-toolbar__group`: `display: contents` on a
    fine pointer, a box on a coarse one.

  Its users place it with a `className` on its root (styling rule 3), and
  nothing else.
- **`ViewportToolbar` composes it.** Its own module keeps only what is
  particular to the bottom bar: the bottom-centre placement and `max-width`,
  the zoom, Symmetry and rotation controls, the dropdowns, the overflow menu,
  and the coarse-pointer placement rules.
- **The look**:
  - The vertical padding goes from 2px to 4px, so the bar grows from 34px to
    38px.
  - The bar's radius goes from 6px to 12px.
  - The zoom readout, Symmetry and rotation readout take `--radius`
    (4px → 8px), like the icon buttons beside them.
  - The dropdowns (zoom presets, layers, symmetry, BP sheet) take `--radius`
    (6px → 8px). Their 4px rows inside 4px padding are already concentric.
- `.viewport-toolbar .ui-button--icon { margin-inline: 1px }` reaches into
  `IconButton`; the `Toolbar`'s gap replaces it.
- **One menu part for the panels.** The menus other panels hang off the bar
  (DesignPanel's layer and symmetry menus, BpPackingPanel's sheet menu,
  BpPackingSymmetryMenu) become one exported `ViewportToolbarMenu` (anchor plus
  panel). Their contents (`.symmetry-menu__*`, `.bp-sheet-menu__*`) do not
  change and stay where they are.
- **How the bar is found.**
  - The bar gets `role="toolbar"` from `Toolbar`, as `FloatingToolbar` already
    has; today it is a `div` whose `aria-label` names nothing.
  - It also gets `data-viewport-toolbar`, and `useCpToolHintAnchor` finds it by
    that instead of by its class.
  - The anchor hook already measures and observes the bar, so the taller bar
    lifts the tool card with no change to `toolHintPlacement`. No TS code
    assumes the bar's height.
- **Check**: the BP packing alerts and d-pad sit `--space-3 + 52px` up to
  clear the bar's row. 38px still clears it, by 14px instead of 18px; look at
  it in the browser.
- **Tests**: `ViewportToolbar.test.tsx`, `DesignPanel.test.tsx`,
  `ReferencesPanel.test.tsx` and `ReferencesViewportToolbar.test.tsx` move from
  `.viewport-toolbar*` to roles, names and data attributes.

### Phase 4 — Tool rail

- `CpToolRail.module.css` takes the `.cp-tool-rail*` family, including:
  - the touch header's grid rows, the minimum target heights and the
    touch-callout rule from the coarse-pointer blocks
  - the line-type group rule
- **Buttons**: `border-radius: var(--radius)` (4px → 8px). The active state's
  ring is an inset shadow plus border, so it follows the radius.
- **The glyph**: `cpToolGlyph.tsx` uses `cp-tool-rail__button-label` and
  `__oriedita-icon`, and both the rail and the phone picker draw it. It gets
  its own module (`CpToolGlyph.module.css`) rather than borrowing the rail's.
- **The latch**: `CpShiftLatchToggle` (`cp-tool-rail__latch`) gets its own
  module the same way.
- **Tests**: `CpToolRail.test.tsx`, `CpToolPickerSheet.test.tsx`.

### Phase 5 — Tool card

**Scope of the move.**

- `CpToolHintWindow.module.css` takes the window's chrome: the section, its
  collapsed state, the header, title, meta and body.
- The content classes (`.cp-context-panel__group`, `__field`, …) belong to
  `CpContextToolPanel` and the controls it renders (`FoldAngleControl`,
  `DirectionHintControl`, `SegmentedToolOption`, `SquareToolOptions`). Their
  look does not change in this pass, so they stay global.
- Radius goes from 6px to 8px (`--radius`).

**The header action becomes a slot the window positions.**

- `data-has-action` on the section reserves the header's right-hand gutter. It
  replaces `.cp-context-panel:has(.cp-context-panel__reset)
  .cp-context-panel__header`.
- The slot places whatever it holds, which replaces the reset's own
  `position: absolute`.
- The reset's look moves to `CpContextToolReset.module.css`.

**Height animation.** A hook, `hooks/useAnimatedHeight.ts` (it knows nothing
about crease patterns), does the work:

- **Measure and set.** The body gets an inner content wrapper. A
  `ResizeObserver` on the header and that wrapper gives the window's natural
  height. The hook writes it as the section's explicit `height`, and the module
  transitions `height` over `--motion-duration` / `--motion-ease`.
  `max-height: min(60vh, 520px)` still clamps it, so a tall tool still scrolls.
  - This is the segmented pill's split: JS places, CSS times.
  - `interpolate-size` / `calc-size()` would need no JS, but they were
    Chromium-only when last checked, and the desktop shell is WKWebView.
    Confirm WebKit support before preferring them.
- **Grow at the top.** The window is pinned by its bottom edge, so it grows and
  shrinks at the top.
  - While it resizes, the body's content sits at the bottom
    (`data-resizing`: `overflow: hidden`, content aligned to the end).
    Everything below the change stays where it was; only the header travels.
  - Top-aligned content would instead throw the Extend color control 47px away
    from the pointer on every press, then slide it back.
  - When a resize ends at the max height, the body ends scrolled to its bottom,
    so the pressed control is still in view.
- **What it covers.** Every height change while the window is mounted animates:
  - a mode switch
  - a group or a Reset appearing
  - a switch between two tools that both have a card. Measured: Extend Line to
    Divided Line keeps the same window node, and the content swaps while the
    frame follows.

  The window appearing and disappearing are not animated.
- **First placement and motion settings.**
  - The first measurement places without a transition, as the pill's first
    placement jumps rather than slides.
  - Under `prefers-reduced-motion: reduce`, nothing transitions.
  - An interrupted transition retargets from wherever it is.
- **Timing against the pill.** The panel's update lands as a React transition
  after the pill has moved (`useOptimistic`, from the segmented-control plan).
  So the card follows the pill by however long that commit takes, and the
  observer catches it whenever it lands.
- **Collapse and expand.**
  - Collapsing keeps the body mounted (`inert`, `aria-hidden`) until the
    height reaches the header's, then unmounts it. Expanding mounts it and
    grows from the header's height.
  - A timeout backs up `transitionend`.
  - Where nothing animates (reduced motion, or no `ResizeObserver`, as in
    jsdom), it collapses at once as it does today, so the existing collapse
    tests keep their meaning.

**Tests.**

- The hook:
  - the first placement jumps, and a change transitions
  - reduced motion jumps
  - an interruption retargets
  - collapse waits for the end, then unmounts
  - the fallback timeout fires
- `CpToolHintWindow.test.tsx` moves from `.cp-context-panel*` to the region's
  name and the header's `aria-expanded`.

### Phase 6 — The floating toolbars and canvas pills, on `Toolbar`

- **`FloatingToolbar`** renders `Toolbar` inside its floating-ui positioning,
  so its radius goes from 8px to 12px. Its padding is already 4px vertically.
  Its own `.floating-toolbar` rules go; it keeps a module only if positioning
  needs one.
  - `CpToolOptionLayer` and `CpRegionChipBar`, which wear `.floating-toolbar`
    by class today, render `Toolbar` instead. Where one is not semantically a
    toolbar, it passes a `role` of its own.
  - `CpTextEditor` and `CpFoldedFigureToolbar` use `ToolbarSeparator`.
  - Everything built on `FloatingToolbar` follows: the CP selection toolbar,
    text editor, image inspector, inline simulation inspector, folded figure
    toolbar, crease-angle popover and CP-detect suggestion pill.
- **Canvas pills**: the BP tree edge length editor, name/flap editor and
  stretch navigator are three copies of one top-centre pill (same padding,
  border, ground and shadow).
  - They become one `CanvasContextBar`, with the title and labels they all
    repeat as its parts (`CanvasContextBarTitle`, `CanvasContextBarLabel`).
    Each pill's own fields move into its own module.
  - It is not a `Toolbar`. Its look (`--border-strong`, the context-menu
    shadow) is Decision 6's to settle, and its 12px gap and 12px type are a
    bar of labelled fields', not a run of buttons'. It shares the radius rule
    rather than the component.
  - They take the toolbar's padding (6px 10px → 4px 8px) and radius
    (10px → 12px).
  - A bar holding only text (a stretch with one pattern) would come out 24px
    tall, and at 12px its corners would close into a capsule. So the bar is at
    least one row of controls tall (a 28px icon button): every pill is 38px,
    the bottom toolbar's height, whatever it holds.
  - Their inputs take `--radius` (6px → 8px), because a control inside a
    toolbar is `--radius`.
- **Tests**: `FloatingToolbar.test.tsx`, `CpFoldedFigureToolbar.test.tsx`,
  `SuppressionRegionChip.test.tsx`, `BpPackingPanel.test.tsx`,
  `BpTreePanel.test.tsx`, `BpPackingStretchNav.test.tsx`.

### Phase 7 — Menus, popovers, tooltips

All go to `--radius` (8px). Rows inside them stay 4px (4px padding, so
concentric).

- **`Tooltip`** → `Tooltip.module.css` (6px → 8px). Tests that find
  `.tooltip-content` (`CpToolRail`, `SegmentedControl`, `CpToolPickerSheet`)
  find `role="tooltip"` instead.
- **`Select`** → `Select.module.css` (list 6px → 8px).
- **Menu bar** → `MenuBar.module.css`, the whole of `MenuBar.css` (dropdown
  4px → 8px), plus its coarse-pointer row rule from `theme.css`.
  - `MenuBar.tsx` leaves the ESLint allowlist and `MenuBar.css` leaves the
    ratchet list, so one global stylesheet is gone.
- **`PaperDashMenu`** → its own module (9px → 8px).
- **`ContextMenu`** → `ContextMenu.module.css` (6px → 8px), with its
  coarse-pointer row rule. This is the largest item.
  - Twelve files hand-apply `context-menu__item / __label / __icon /
    __separator / __shortcut …` to Radix parts.
  - They move onto small exported parts beside `ContextMenu` (`MenuContent`,
    `MenuItem`, `MenuItemIcon`, `MenuItemLabel`, `MenuSeparator`, …), so the
    module stays private to it.
  - The sites: `RegionImageMenu`, `ViewportToolbarOverflowMenu`,
    `DesktopDownloadMenuItems`, `RegionRepairToolMenu`, `ContextMenuColorItem`,
    `SuppressionRegionChip`, `CpSelectionToolbar`, `SplitButton`,
    `CpFoldedFigureToolbar`, `contextMenuPicker`, `ToolbarDownloadButton`,
    `DesktopDownloadButton`.

### Phase 8 — Readouts, HUD, alerts, update card

All go to `--radius` (8px):

- **Canvas status readout**: Edit's `.viewport-status-readout` and Design's
  `.design-status-readout` share one rule today. They become one
  `ViewportStatusReadout` component and module (6px → 8px), and
  `useCpDiagnosticHudLane` finds it by data attribute.
- **`CpDiagnosticHud`** → its own module (6px → 8px).
- **BP packing alerts** (`.bp-packing-alert`, rendered inline in
  `BpPackingPanel`) → a `BpPackingAlerts` component and module (6px → 8px).
  Extracting it also takes markup out of a panel, which the panel rules want
  anyway.
- **`UpdateCard`** → its own module (12px → 8px, because it is a card:
  decision 2). `App.css` shrinks.

### Not in this pass

These were left out by decision 1:

- inputs and number fields (4px, beside 8px selects in the same View-pane rows)
- modal internals, chips and toggles
- `.file-drop-overlay` (a drop target inset in a pane, not floating chrome)
- the full-height side sheets (`.view-drawer`, `.cp-tool-picker`), which have
  no radius
- Edit's dock tab bar

No new strings, and no analytics events: nothing here is a new action.

### Verification, every phase

- **Two commits per phase**, per `AGENTS.md` › "Migrate what you touch":
  1. The move into modules. Computed styles are unchanged, which the browser
     snapshot proves.
  2. The restyle.
- **Tool gates**: `npm run lint:web`, `npm run typecheck:web` and
  `npm run test:web` (vitest under Node 22). Run `npm run build:web` (with its
  prerender) at the end of each phase that shrinks the global stylesheets,
  because the landing ships them.
- **Browser** (done by me, with screenshots):
  - measure each change as computed styles and box sizes, before and after
  - use each interaction
  - check dark and light themes, and coarse pointer / phone width where the
    component has touch rules
- This worktree needs `scripts/setup-worktree.sh` before its own dev server
  will run (no generated wasm yet). Start it with `DEV_SERVER_PORT` set to a
  port no other worktree holds.

## Affected Areas

- **Tokens and docs**: `apps/web/src/styles/theme.css`, `apps/web/src/App.css`,
  `apps/web/docs/styling.md` (the radius rule, the header token),
  `src/styles/globalStylesheets.test.ts` (ceilings), `apps/web/eslint.config.js`
  (MenuBar leaves the allowlist), `components/ui/SegmentedControl.module.css`
  (motion tokens)
- **Header**: new `components/ui/WorkspaceTabStrip.tsx` and its module;
  `components/panels/DesignTabStrip.tsx` and its test;
  `cp-workspace/references/ReferencesModeSwitch.tsx`;
  `components/WorkspaceShell.tsx`; `ReferencesPanel.test.tsx`
- **Bottom toolbar**: new `components/ui/Toolbar.tsx` and its module;
  `components/panels/ViewportToolbar.tsx` and its new module; `ViewportToolbarOverflowMenu.tsx`; `DesignPanel.tsx`;
  `BpPackingPanel.tsx`; `BpPackingSymmetryMenu.tsx`;
  `cp-workspace/toolHint/useCpToolHintAnchor.ts`; the four toolbar tests
- **Tool rail**: `components/panels/CpToolRail.tsx`;
  `cp-workspace/toolCatalog/cpToolGlyph.tsx`;
  `cp-workspace/touchModifiers/CpShiftLatchToggle.tsx`; new modules; rail and
  picker tests
- **Tool card**: `cp-workspace/toolHint/CpToolHintWindow.tsx` and its new
  module; new `hooks/useAnimatedHeight.ts` with tests;
  `components/panels/CpContextToolReset.tsx` and its new module;
  `CpToolHintWindow.test.tsx`
- **Floating toolbars and pills**: `components/ui/FloatingToolbar.tsx` (onto
  `Toolbar`); `CpToolOptionLayer.tsx`; `CpRegionChipBar.tsx`;
  `CpTextEditor.tsx`; `CpFoldedFigureToolbar.tsx`; new `CanvasContextBar`;
  `TreeEdgeLengthEditor.tsx`; `BpNameEditor.tsx`; `BpFlapEditor.tsx`;
  `BpPackingStretchNav.tsx`
- **Menus**: `components/ui/Tooltip.tsx`, `Select.tsx` and `ContextMenu.tsx`
  (new parts) with modules; the 12 menu sites above; `components/MenuBar.tsx`
  with `MenuBar.css` becoming `MenuBar.module.css`;
  `components/settings/PaperDashMenu.tsx`
- **Readouts and the rest**: new `ViewportStatusReadout`;
  `CreasePatternPanel.tsx`; `DesignPanel.tsx`;
  `cp-workspace/diagnostics/CpDiagnosticHud.tsx`;
  `useCpDiagnosticHudLane.ts`; new `BpPackingAlerts`;
  `components/UpdateCard.tsx`

## Checklist

### Phase 1 — Tokens, and the dead CSS

- [ ] `--radius` with the scale derived from it, `--workspace-header-height`
      and the motion pair in `theme.css`
- [ ] `.ui-control--rounded` and the segmented control read them
- [ ] The dead blocks deleted, each confirmed unreferenced; the ceilings
      lowered to what is left
- [ ] `liveSelectors.test.ts` (third-party prefixes, a runtime-class
      allowlist with reasons)
- [ ] Validate; commit

### Phase 2 — Header height

- [ ] `WorkspaceTabStrip` (standalone, `embedded`, `tone="peers"`, `fill`) and
      its module; Design and References compose it
- [ ] The shell rules read `--workspace-header-height`; the old strip and
      References override CSS deleted; the ceiling lowered
- [ ] Tests on roles and `[data-design-tab]`; the declaration checks read the
      module
- [ ] Browser: Design, References and Simulate headers all 36px; the strip's
      `+` centred; drag, rename and close still work; References' tabs on a
      phone; dark and light
- [ ] Validate; commit

### Phase 3 — Bottom toolbar

- [ ] Decision 6 settled (one toolbar look, or a `tone`)
- [ ] `Toolbar`: its padding and concentric radius in its module,
      `ToolbarGroup`, `ToolbarSeparator`, the decided look
- [ ] `ViewportToolbar` composes it: 4px vertical padding, 12px bar, 8px inner
      controls and dropdowns; its module keeps the placement, the controls and
      the menus
- [ ] `ViewportToolbarMenu` for the panels' menus; `role="toolbar"` and
      `data-viewport-toolbar`; the tool card's anchor reads the attribute
- [ ] Tests on roles and attributes; the ceiling lowered
- [ ] Browser: the bar in Edit, Design tree and packing, and References
      (38px, 12px); the tool card clears it; the BP alerts and d-pad clear it;
      a wrapped bar on a tablet-width coarse pointer
- [ ] Validate; commit

### Phase 4 — Tool rail

- [ ] `CpToolRail.module.css` (with its touch rules), glyph and latch modules;
      8px buttons
- [ ] Tests; the ceiling lowered
- [ ] Browser: rail hover, active and disabled states; the touch header; the
      phone picker's glyphs
- [ ] Validate; commit

### Phase 5 — Tool card

- [ ] `CpToolHintWindow.module.css`; 8px; the header action slot;
      `CpContextToolReset.module.css`
- [ ] `useAnimatedHeight` (bottom-anchored while resizing, first placement
      jumps, reduced motion, interruption, the max-height case) with tests
- [ ] Collapse and expand animate; the body stays mounted, `inert`, until
      closed
- [ ] Browser: Extend Line Active ↔ Same and Divided Line Count ↔ Ratio, with
      the pressed control holding still; a tool switch between two cards;
      collapse and expand; a tool tall enough to scroll; reduced motion
- [ ] Validate; commit

### Phase 6 — Selection toolbar and canvas pills

- [ ] `FloatingToolbar` on `Toolbar` (12px); `CpToolOptionLayer`,
      `CpRegionChipBar`, `CpTextEditor` and `CpFoldedFigureToolbar` onto
      `Toolbar` and `ToolbarSeparator`
- [ ] `CanvasContextBar` (its own chrome on the radius rule, title and label
      parts) for the three BP pills; their fields in their own modules, at
      `--radius`; one 38px height
- [ ] Tests; the ceiling lowered
- [ ] Browser: the CP selection toolbar, text editor, crease-angle popover,
      folded figure toolbar; the BP pills
- [ ] Validate; commit

### Phase 7 — Menus, popovers, tooltips

- [ ] `Tooltip`, `Select` and `PaperDashMenu` modules at 8px
- [ ] `MenuBar.module.css` (the whole file); `MenuBar.css` off the allowlist
      and the ratchet list
- [ ] `ContextMenu` module and parts; the 12 sites moved onto the parts
- [ ] Tests on roles; the ceilings lowered
- [ ] Browser: a canvas context menu, a submenu, the menu bar, a select list,
      a tooltip, the Paper dash menu; coarse-pointer rows
- [ ] Validate; commit

### Phase 8 — Readouts, HUD, alerts, update card

- [ ] `ViewportStatusReadout` (Edit and Design) with the lane hook on a data
      attribute; `CpDiagnosticHud`, `BpPackingAlerts` and `UpdateCard` modules
      at 8px
- [ ] The ceilings lowered
- [ ] Browser: the readout in both workspaces beside an expanded HUD; BP
      alerts; the update card
- [ ] Validate; commit

### Phase 9 — Close out

- [ ] `docs/styling.md`: the radius rule (one radius, concentric containers,
      nested rows) and the header token; a line in `AGENTS.md`'s Styling list
- [ ] No floating surface in this plan declares a literal radius (grep)
- [ ] `npm run build:web` with the prerender; the landing budget and the
      static-paint check pass
- [ ] Full browser pass, dark and light, desktop and phone width; draft PR
      against the base branch
