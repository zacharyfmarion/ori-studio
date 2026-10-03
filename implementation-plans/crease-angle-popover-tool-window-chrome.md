# Crease angle popover: the tool window's chrome

## Goal

The crease-angle popover (`Shift+A`, or the caret beside the bar's angle
readout) should look like the rest of the crease-pattern UI, and specifically
like the tool window Box Select shows a selection's fold angle in: the same
title bar, the same ground, the same chips and the same field row. On a phone,
where the popover is a centred modal, the same.

Today it wears a different surface entirely. It is a `FloatingToolbar` pill,
so it has the raised toolbar's ground (`--bg-elevated`) and short shadow, an
uppercase caption for a title, a 28px input, and the `md` chips. Measured side
by side in One Dark at 1280×800:

| Part | Popover | Box Select's window |
| --- | --- | --- |
| Ground | `--bg-elevated`, `0 2px 8px` shadow | `--bg-secondary` 92% over `--bg-primary`, `0 8px 24px` shadow |
| Title | 10.88px uppercase caption, no bar | 30px bar on `--bg-tertiary` 78%, rule under it, 760 weight |
| Body | 12px padding | 8px padding, 8px gap |
| Input | 28px, `--bg-surface`, 12.48px | 22px `cp-context-panel__field` row, `--bg-secondary`, labelled "Degrees" |
| Chips | `md`: 6px 12px, 12.48px, 28.5px tall | `sm`: 2px 7px, 10.56px, 18px tall |

On a phone the centred frame has a second problem: it is not portaled, so its
`z-index` is trapped in `.cp-panel__viewport`'s stacking context and the tool
window (body-portaled at `--z-canvas-overlay`) paints above its backdrop.

## Approach

**One chrome, in `components/ui/`.** The window look lives only in
`CpToolHintWindow.module.css`. Copying it into the popover's module would make
two looks that agree by accident, which is how they came apart in the first
place. Per `docs/styling.md` ("a look several components share goes in
`components/ui/`"), it moves into a `FloatingPanel` primitive:

- `FloatingPanel`: the frame (border, radius, ground, shadow, type, the
  header-then-scrolling-body grid). Placement stays the owner's, through a
  `className` on the root and inline style. A `pin="bottom"` prop says which
  edge holds still while `useAnimatedHeight` moves the frame, so the body can
  sit on it mid-resize (the rule that was `.window[data-resizing] .body`).
- `FloatingPanelHeader`: the title bar. With `onCollapsedChange` it is the
  tool window's collapse toggle (a button with the chevron, the header action
  floated over its reserved gutter, exactly as now); without, a static bar with
  the action in flow at its end.
- `FloatingPanelBody`: the padded, scrolling body and its content grid, with
  refs for `useAnimatedHeight`.
- `FloatingPanelClose`: a compact close button sized for the bar.

`CpToolHintWindow` keeps its behaviour (placement, the collapse preference, the
animated height) and composes these. That step changes nothing on screen, and
is proved by computed-style snapshots before and after.

**Positioning without the toolbar.** The popover is a dialog, not a toolbar; it
only wore `FloatingToolbar` for its anchoring. That half moves into
`useAnchoredFloating` (virtual anchor rect, flip/shift inside a boundary, hide
once the anchor leaves it, max-width clamp). `FloatingToolbar` uses it and
renders the same DOM as before; the popover uses it around a `FloatingPanel`.

**The popover's body is Box Select's.** The input becomes a "Degrees" row in
the same `cp-context-panel__field` shape the fold-angle group uses, and the
chips drop to `sm`, so the presets read as the same control they are. The row
comes before the chips, unlike the fold-angle group: focus opens in the input
and `Tab` walks on to the chips, and visual order must match focus order. The
panel takes the tool window's width (`CP_TOOL_HINT_WIDTH`), which is what fits
all six presets on one row there.

**Phone.** The centred frame keeps its backdrop (`.simple-modal`) but wears the
`FloatingPanel` instead of `.simple-modal__document`, and is portaled to the
body so it stacks above the tool window like every other modal.

**Chip sizes.** Nothing uses `md` once the popover is `sm`, so the size goes
(`CHIP_SIZE_CLASSES`, and the `.ui-chip--md` rule edited out of the shared
block in place). So does `Toolbar`'s `inset` prop, which existed only so the
popover could sit its own padded form inside a toolbar pill.

**Chips on touch (added after review).** On a phone the field grows to the
44px touch target and the chips stayed 18px, in Box Select's window as much as
here. Every other control primitive grows on a coarse pointer; chips now do
too. That meant moving `ui-chip` out of theme.css, which Settings → Paper
restyled from a global rule (`.settings-paper__slot-action`), so it is a move
of a shared block, done in this PR at the user's call: first `Chip.module.css`
with the override as `size="md"` and no change on screen, then the touch size
— 44px tall, 14px type, on every chip. The popover's six presets wrap four and
two at that size, so on touch they lay out three a row instead.

## Affected Areas

- `apps/web/src/components/ui/FloatingPanel.tsx`, `FloatingPanel.module.css` (new)
- `apps/web/src/components/ui/useAnchoredFloating.ts` (new), `FloatingToolbar.tsx`,
  `Toolbar.tsx` (the `inset` prop only the popover used)
- `apps/web/src/cp-workspace/toolHint/CpToolHintWindow.tsx`, `.module.css`
- `apps/web/src/cp-workspace/foldAngle/CreaseAnglePopover.tsx`, `.module.css`, test
- `apps/web/src/components/ui/Chip.tsx`, `controlStyles.ts`, `styles/theme.css`
- `apps/web/public/locales/*/tools.json` (one new label)
- `implementation-plans/scoped-css.md` (the popover now wears the tool card's
  field row; `ui-chip` moved)
- `apps/web/src/components/ui/Chip.module.css` (new), `Chip.tsx`,
  `components/settings/PaperSlotHeader.tsx` and its test

## Checklist

- [x] `FloatingPanel` primitive; `CpToolHintWindow` composes it with no change
      on screen (computed styles before/after in five states: Box Select, a
      Reset showing, collapsed, coarse, Atom One Light — only the empty action
      slot's resolved `bottom` differs, its box does not)
- [x] `useAnchoredFloating` out of `FloatingToolbar`; toolbar DOM and tests
      unchanged (20 before/after captures pixel-identical after both refactors)
- [x] Popover on `FloatingPanel`: title bar + close, Degrees row, `sm` chips,
      tool-window width; keyboard contract unchanged (Tab order, Escape, Enter,
      focus restore checked in Chromium)
- [x] Phone frame portaled and wearing the panel; the tool window is now under
      its backdrop on phone and tablet
- [x] Drop the unused `md` chip size, and the toolbar `inset` prop that only
      the popover used
- [x] i18n: the "Degrees" label, translated (the fold-angle group's wording in
      every locale) and stamped
- [x] Tests: panel primitive, popover (portal, label, close, backdrop), hint
      window still green; the two new popover regression tests fail on the old
      popover
- [x] Lint, typecheck, unit tests (8930 passed), i18n check
- [x] Browser: desktop in One Dark, Catppuccin Mocha and Atom One Light, phone,
      coarse tablet; before/after images
- [x] Draft PR (zacharyfmarion/ori-studio#435)
- [x] `ui-chip` into `Chip.module.css`, Settings → Paper's override as
      `size="md"`; computed styles of every chip identical at rest, hover,
      focus and pressed, in both themes and coarse; screenshots identical
- [x] Chips are 44px touch targets on a coarse pointer; the popover's presets
      three a row on touch; desktop unchanged (0 diffs, identical pixels)
