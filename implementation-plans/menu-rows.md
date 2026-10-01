# Menu rows: one look

## Goal

Every row in a menu or a list popover looks and behaves the same, whichever
component drew it: **inset in its surface with rounded corners** (the select
list's shape) and **highlighted with a solid accent fill** (the menu bar's
colour), with text on that fill that reads in every theme.

Today the File menu and the Solutions select disagree because they are
different components, and so do three more.

## Approach

### What is there today

Four implementations draw menu rows, plus the bottom toolbar's popovers:

| Surface | Built on | Rows | Highlight |
| --- | --- | --- | --- |
| Menu bar (File, Edit, View, Help) | `MenuBar.tsx`, hand-built buttons | full width, square; surface padded `4px 0` | solid `--accent-primary`, `--text-inverse` text |
| Context menus and every toolbar dropdown (download, split button, selection export, region and folded-figure menus, the touch `⋯`) | `Menu.tsx` parts on Radix `DropdownMenu` | inset 4px pills in 4px | `--accent-primary` 16% tint |
| Select lists (Solutions, Language, the export dialogs) | `Select.tsx` on Radix `Select` | inset 4px pills in 4px | 16% tint |
| Paper dash menu (Settings › Paper) | `PaperDashMenu.tsx`, hand-built | 6px rows in 6px | 16% tint; the current dash 10% tint and accent text |
| Bottom toolbar popovers: zoom presets, view options (layers) | `ViewportToolbar.tsx`, a custom popover | 4px rows in 4px (presets) or 6px (options) | neutral `--bg-surface` |

Their surfaces differ too. The menu bar's dropdown sits on `--bg-primary` with
a long shadow (`0 12px 32px`). `Menu`, `Select` and the dash menu share
`--bg-elevated` and a short one. The toolbar popovers use `--bg-secondary` and a
third shadow. Row padding runs from 7px to 12px a side, and the shortcut column
is `--text-muted` in one place and `--text-secondary` in another.

### The finding that shapes it: white on the accent does not read

The menu bar's pair, `--text-inverse` on `--accent-primary`, is **below WCAG AA
(4.5:1) in 22 of the 23 themes**. In One Dark it is 2.36:1, and with the light
accents it is unreadable: Cobalt2 1.58:1, Monokai 1.55:1, Shades of Purple 1.49:1
(white on yellow or green). `--text-inverse` is the theme's *inverse of its
ground*, which is white in a dark theme, and a dark theme's accent is light.

The text that reads on an accent is the ground itself. `--bg-primary` on
`--accent-primary` passes in 20 of 23. The other three (Atom One Light 3.88,
Solarized Dark 4.08, Solarized Light 3.41) pass with plain black, at 5.2 to
5.7:1. So the highlight text is a **derived token**, `--text-on-accent`: computed
per theme in `themes/applyTheme.ts`, like `--paper-back` and
`--references-crease-alpha` already are. It is the ground when that reaches
4.5:1, otherwise whichever of black or white reads better. A test holds it at AA
in every preset, the way `startActionContrast.test.ts` holds the start screen's
cards.

What this changes for the look you liked: **the fill stays the menu bar's
accent, and the text on it turns dark** (One Dark: `#282c34` on `#61afef`,
5.9:1).

### The spec

One description of a menu, which every implementation follows:

- **Surface**: `--bg-elevated`, a 1px `--border-default` border, `--radius`
  (8px), 4px padding, and the short shadow `Menu` and `Select` already use.
- **Row**: 28px minimum (`--touch-target` on a coarse pointer), padding 5px
  8px, `--radius-sm` (4px, the surface's radius less its padding: concentric),
  12px text in `--text-primary`. Shortcuts are 11px `--text-secondary`.
  Separators are inset 6px either side.
- **Highlight**: a fill of `--menu-highlight` with `--menu-highlight-text` text,
  on pointer hover and keyboard focus alike. Everything in the row follows the
  text colour: icon, check, chevron, shortcut, and the dash menu's preview line.
  A disabled row never highlights.
- **Tokens**: `--menu-highlight: var(--accent-primary)` and
  `--menu-highlight-text: var(--text-on-accent)` in `theme.css`, and their
  destructive pair, `--status-danger` and `--text-on-danger`. These are
  tokens by the styling rules' own test, values that components which do not
  know about each other must agree on. They exist so that the next change to
  the menu highlight is one line rather than five modules.

### Decisions (settled 2026-10-01)

1. **Highlight text is dark**, through `--text-on-accent`: the menu bar's accent
   fill, with text that passes AA in every theme. White was 2.36:1 in One Dark
   and under 1.6:1 in three themes.
2. **Destructive rows** (Delete, Remove) **fill solid red**: `--status-danger`
   with `--text-on-danger` text, derived the same way, which reaches AA in every
   theme (worst 4.6:1, Solarized Dark). The warning stays visible under the
   pointer rather than only at rest.
3. **Current values get a check.** With a solid highlight following the
   pointer, a list needs its own mark for what is current. The select list gets
   a check in a leading column, as `Menu`'s radio rows already have (today it
   shows nothing once the highlight moves), and the dash menu's current row
   swaps its tint for the same check.
4. **The bottom toolbar's popovers are rebuilt on `Menu` parts**: zoom presets
   and view options. The touch `⋯` menu already renders those toggles as `Menu`
   checkbox rows, so desktop and touch become one list, with real menu
   keyboarding. Restyling them in place was the alternative, but the view
   options' rows are labels around native checkboxes; a checked box is drawn in
   the accent, so it would vanish into an accent fill, and they would have had
   to keep a neutral hover: a fifth look.

### Not in this pass

- **The menu bar stays hand-built.** Its phone layout expands submenus in
  place, its touch dismissal swallows the dismissing tap, and it switches menus
  on hover. Rebuilding it on Radix `Menubar` would be a behaviour change with
  its own tests. It follows the spec through its module.
- **The dash menu stays hand-built**: its custom-dash field cannot live inside a
  `role="menu"` (see `PaperDashMenu.tsx`).
- **In-page selection lists**: References' findings, the sheet grid, and the
  export dialog's format list. A selected row there is state, not a pointer
  highlight.
- **Native `<select>`s** (the tool card's, the site footer's): the OS draws
  their lists. The symmetry and sheet popovers are panels of controls, not lists
  of rows. The macOS menu bar is native.
- **The primary and danger buttons** have the same `--text-inverse` problem:
  One Dark's primary button is 2.36:1, its danger button 3.2:1. A
  follow-up can point them at the new tokens; it changes buttons across the app,
  so it is its own decision.

## Affected Areas

- **Tokens**: `apps/web/src/themes/applyTheme.ts`, a new `themes/textOnFill.ts`
  and its test (the rule, every preset at AA, and the `theme.css` defaults),
  `styles/theme.css` (the defaults and the menu tokens)
- **Menus**: `components/ui/Menu.module.css`, `components/ui/Select.tsx` and its
  module, `components/MenuBar.module.css`, `components/settings/PaperDashMenu.tsx`
  and its module
- **Toolbar popovers**: `components/panels/ViewportToolbar.tsx` and
  its module and tests, sharing with `ViewportToolbarOverflowMenu.tsx`
- **Docs**: `apps/web/docs/styling.md` (a "Menus" section: the spec, the tokens,
  and "build a new menu from `Menu`, a value picker from `Select`")

## Checklist

### Phase 1 — Tokens

- [x] `--text-on-accent` and `--text-on-danger` derived per theme, with a
      default in `theme.css` for first paint
- [x] `--menu-highlight` and `--menu-highlight-text` in `theme.css`
- [x] A test: every preset's menu highlight text reaches 4.5:1 on its fill
- [x] Validate; commit

### Phase 2 — `Menu` and `Select`

- [ ] Highlight through the tokens; shortcut, icon and chevron follow it;
      destructive rows fill red
- [ ] `Select`: row padding to the spec; the current-value check
- [ ] Browser: a canvas context menu with a submenu, a colour row and a
      destructive row; the download, split-button and selection-export
      dropdowns; the Solutions and Language selects; keyboard highlight matches
      the pointer's
- [ ] Validate; commit

### Phase 3 — Menu bar

- [ ] The spec's surface (`--bg-elevated`, the short shadow), 4px padding,
      inset 4px rows with 8px sides, the shared shortcut and separator; the
      square corner under the trigger stays
- [ ] Fly-outs and the phone's expanded groups follow
- [ ] Browser: File, View and Export's fly-out on desktop; a group expanded on
      a phone
- [ ] Validate; commit

### Phase 4 — Paper dash menu

- [ ] 4px padding and 4px rows; the highlight; the current dash's check
- [ ] Browser: the dash menu, by pointer and by keyboard
- [ ] Validate; commit

### Phase 5 — Bottom toolbar popovers on `Menu`

- [ ] Zoom presets and view options on `Menu` parts, sharing the touch `⋯`
      menu's rows; tests on roles
- [ ] Browser: presets, layer toggles (staying open across toggles), and the
      `⋯` menu on touch
- [ ] Validate; commit

### Phase 6 — Close out

- [ ] `docs/styling.md` "Menus"; the follow-up for the buttons noted
- [ ] Browser: every menu above in One Dark, GitHub Light, Solarized Light and
      Cobalt2 (the contrast edge cases), and on a touch phone
