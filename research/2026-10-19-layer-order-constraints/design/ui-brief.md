# Ori Studio's visual language: a brief for the Layer order dialog mockups

Read from commit `eb4b51c54` (PR #476, `claude/fold-solver-perf`, stacked on
the Fold workspace launch #475). Every path below is relative to `apps/web/src/`
unless it says otherwise. Numbers are copied from the CSS and TS at that
commit; colour values for applied themes were computed by re-running
`themes/applyTheme.ts`'s derivations on the preset JSON (script:
`ref/tools/themeVars.mjs` beside this file). Icon SVGs were generated from the
installed `lucide-react@0.563.0` icon nodes (the version `package.json` pins)
with `ref/tools/lucideSvg.mjs`.

What I did **not** do: I did not run the app or take screenshots, so nothing
here is checked against rendered pixels. Section 8 lists what is inferred
rather than read.

---

## 0. The five facts that matter most

1. **The default theme is One Dark** (`themes/index.ts`: `DEFAULT_THEME =
   DEFAULT_DARK_THEME = one-dark`). A system that asks for light gets **Atom
   One Light**. The `:root` colours in `styles/theme.css` (`#101417`…) are only
   a pre-theme fallback; no user sees them. Mock in One Dark first.
   The owner's own screenshots in the Layers pane review (2026-10-18) were in
   **Horizon**, so check Horizon too. On Horizon, `--accent-primary` and
   `--status-danger` are the **same colour** (`#e95678`), so "picked" and
   "refused" cannot be told apart by colour alone.
2. **The newer modal frame** (References browser, Fold import) is the one to
   copy: a 36px header bar on `--bg-secondary`, the body on `--bg-primary`, and a
   footer on `--bg-elevated`, with `--border-subtle` rules between them. The older
   global `.simple-modal` frame (paper export) is legacy and is being moved out
   of the global stylesheet.
3. **Controls are small and dense.** Buttons and icon buttons are 28px (`sm`)
   in every toolbar and dialog bar. Pane rows use FieldRow: 7px vertical
   padding, 11.84px labels, a rule under each row. Everything grows to 44px
   under a coarse pointer.
4. **Icons are lucide, 14–15px, stroke 2.** In Edit, "Another solution" is a
   **chevron-right**, not a cycle arrow. Flip/Turn over is `RotateCcwSquare`
   in every workspace.
5. **Highlights on paper are theme-accent tints with alpha, never paper
   colours. States never use a dash**, because a dash means a valley fold.

---

## 1. Tokens

### 1.1 Where they live

| What | File |
| --- | --- |
| Constants (spacing, radius, motion, z-tiers, header height, touch target) and the pre-theme colour fallback | `styles/theme.css`, the `:root` block at lines 1–228 |
| Base `body` font, scrollbars | `index.css` |
| Theme presets (23) | `themes/presets/*.json` |
| Preset to CSS variables, plus the derived tokens (`--border-subtle`, `--paper-back`, fold inks, `--cp-selection`, `--text-on-accent`…) | `themes/applyTheme.ts` (with `paperBack.ts`, `textOnFill.ts`, `referencesInk.ts`) |
| Default and light/dark picks | `themes/index.ts`, `themes/initialTheme.ts` |
| Paper style (paper colours and pens, independent of theme) | `lib/paper/paperStyle.ts`, `lib/paper/paperPresets.ts` |
| Styling rules (CSS modules, radius, migration) | `apps/web/docs/styling.md` |

A preset sets the `bg.*`, `text.*`, `accent.*`, `border.*` and `status.*`
values. `applyTheme` maps them onto the app's names. Two of the mappings are
surprising: `--status-warning` and `--accent-secondary` both come from
`port.color`, and `--status-info` and `--accent-tertiary` both come from
`port.image`. `--text-tertiary` and `--text-muted` are the **same** value (`text.muted`).

### 1.2 Constants (identical in every theme)

| Token | Value |
| --- | --- |
| `--space-1..6` | 4, 8, 12, 16, 20, 24px |
| `--radius` | **8px**: every control, card and floating surface |
| `--radius-sm` | 4px: a detail inside a card (swatch, thumbnail, badge, tag) |
| `--radius-md` | 6px (`--radius-lg` = 8px, `--radius-full` = 999px) |
| Concentric radius | A container that hugs controls uses `calc(var(--radius) + var(--pad))`. Toolbar: pad 4 gives 12px. Segmented pill: `calc(var(--radius) - 3px)` gives 5px |
| `--motion-duration` / `--motion-ease` | 160ms / `cubic-bezier(0.2, 0.8, 0.2, 1)` |
| `--workspace-header-height` | 36px (pane toolbars, dialog bars, Dockview tab bar) |
| `--touch-target` | 44px (coarse pointer only) |
| `--z-canvas-overlay` / `--z-modal` / `--z-portaled-popover` | 900 / 9999 / 10000 |
| UI font | `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`, `letter-spacing: 0`. **Inter is not shipped** (there is no `@font-face`) and it is not installed on this Mac, so the app renders in **SF Pro** via `system-ui`. Do not load Inter from Google Fonts: a mockup would then look different from the app. |
| Mono | `--font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`. Canvas readouts use `'SF Mono', 'Fira Code', monospace` |

**Type scale in use** (the root is 16px; rems are converted):

| Size | Where |
| --- | --- |
| 9.3px (0.58rem), weight 800, uppercase | "TOP" over the Fold cross-section |
| 10px, weight 600, uppercase, +0.06em | menu group label |
| 10.6px (0.66rem) | FieldRow note, cross-section flap tag |
| 10.9px (0.68rem) | floating tool-window body text, canvas readout (mono) |
| 11.2px (0.70rem) | descriptions and hints (option card, section hint, Fold notes) |
| 11.5px (0.72rem) | tooltip, segmented option (weight 650), small labels, panel titles (700), export labels (700) |
| **11.84px (0.74rem)** | **FieldRow label and value**, collapsible section title (600), Pose readout |
| 12px | menu row, `sm` button (0.75rem, weight 600), Fold order notes (0.75rem) |
| 12.2px (0.76rem) | dialog footer count/status, Step detail position (600) |
| 12.5px (0.78rem) | option card label (600), list row name (600) |
| 12.8px (0.80rem) | empty-state message, Fold order navigation |
| 13.1px (0.82rem), weight 650 | **dialog title** (new frame) |
| 13.6px (0.85rem) | `md` button |
| 14.4px (0.90rem), weight 750 | legacy `.simple-modal` title |

The weights in use are 600, 650, 700, 750, 760 and 800. There is no 400/500 UI text
except body copy. `font-variant-numeric: tabular-nums` is on every count and
readout.

### 1.3 Colours: four themes

`OD` = One Dark (**default**), `AL` = Atom One Light (default when the system is light),
`GL` = GitHub Light (white canvas, crisp), `HZ` = Horizon (the owner's
screenshots).

| Token | OD | AL | GL | HZ | Used for |
| --- | --- | --- | --- | --- | --- |
| `--bg-primary` | `#282c34` | `#fafafa` | `#ffffff` | `#1c1e26` | app ground, **canvas ground**, dialog body, pane toolbars |
| `--bg-secondary` | `#21252b` | `#f0f0f0` | `#f6f8fa` | `#16161c` | side panes, dialog header bar, rails |
| `--bg-tertiary` = `--bg-elevated` | `#2c313a` | `#d7dae0` | `#d0d7de` | `#2e303e` | raised toolbar, menu, tooltip, secondary button, dialog footer, list hover |
| `--bg-surface` | `#2d323b` | `#e5e5e6` | `#eaeef2` | `#232530` | hover on rows and buttons |
| `--bg-canvas` | `#1b1f27` | `#fafafa` | `#ffffff` | `#13141a` | wells: segmented track, field ground |
| `--bg-canvas-grid` | `#3a3f4b` | `#d7dae0` | `#d0d7de` | `#2e303e` | |
| `--text-primary` | `#abb2bf` | `#383a42` | `#1f2328` | `#e0e0e0` | |
| `--text-secondary` | `#828997` | `#696c77` | `#656d76` | `#d5d8da` | labels |
| `--text-tertiary` = `--text-muted` | `#5c6370` | `#a0a1a7` | `#8c959f` | `#6c6f93` | hints, tags |
| `--text-inverse` | `#ffffff` | `#1a1a1a` | `#1a1a1a` | `#ffffff` | **primary button text** (see the note below) |
| `--text-on-accent` | `#282c34` | `#000000` | `#ffffff` | `#1c1e26` | text on a highlighted menu row |
| `--text-on-danger` | `#000000` | `#000000` | `#ffffff` | `#1c1e26` | text on a highlighted destructive row |
| `--accent-primary` | `#61afef` | `#4078f2` | `#0969da` | `#e95678` | selection, focus, picked, primary |
| `--accent-hover` | `#74baff` | `#a626a4` (magenta, as shipped) | `#0550ae` | `#f09383` | primary button hover |
| `--border-default` | `#3e4452` | `#e5e5e6` | `#d0d7de` | `#2e303e` | control borders, surface borders |
| `--border-subtle` | `color-mix(in srgb, #3e4452 48%, transparent)` | `… #e5e5e6 72% …` | `… #d0d7de 72% …` | `… #2e303e 48% …` | rules between sections and rows |
| `--border-strong` | `#528bff` | `#4078f2` | `#0969da` | `#e95678` | hover border on cards (a blue or the accent in most themes) |
| `--status-success` | `#98c379` | `#50a14f` | `#1a7f37` | `#29d398` | |
| `--status-warning` | `#e5c07b` | `#986801` | `#bf8700` | `#fab795` | |
| `--status-danger` | `#e06c75` | `#e45649` | `#cf222e` | `#e95678` | refusal, conflict |
| `--status-info` | `#56b6c2` | `#0184bc` | `#0969da` | `#26bbd9` | |
| `--cp-selection` | `#e5c07b` | `#12848d` | `#8250df` | `#b877db` | a **selected crease** (never blue or red; see 4.4) |
| `--fold-mountain` | `#ff4d5d` | `#d91f3a` | `#d91f3a` | `#ff4d5d` | Edit's crease ink |
| `--fold-valley` | `#60a5fa` | `#2563eb` | `#2563eb` | `#60a5fa` | |
| `--fold-flat` (aux) | `#64c8c8` | `#2f9c9c` | `#2f9c9c` | `#64c8c8` | |
| `--fold-border` (edge) | `#abb2bf` | `#383a42` | `#1f2328` | `#e0e0e0` | the theme's text colour |
| `--fold-unassigned` | `#9aa4ad` | same | same | same | |
| `--shadow-overlay` = `--overlay-dim` | `rgba(0,0,0,0.55)` | `rgba(0,0,0,0.2)` | `rgba(0,0,0,0.2)` | `rgba(0,0,0,0.6)` | modal backdrop, floating shadows |
| `--shadow-context-menu` | `0 4px 12px rgba(0,0,0,0.5)` | `0 4px 12px rgba(0,0,0,0.12)` | same as AL | same as OD | dialog and context surfaces |
| `--domain-overlay-bg` | `color-mix(in srgb, #282c34 82%, transparent)` | `… #fafafa 88% …` | `… #ffffff 88% …` | `… #1c1e26 82% …` | see-through toolbars and readouts over a canvas |
| `--bg-paper` | `#f2f0e7` | `#fffdf7` | `#fffdf7` | `#f2f0e7` | |
| `--paper-back` | `#1c1f24` | `#c0c0c3` | `#bcbdbf` | `#14151b` | References' "colour side" only |

**The primary button's text is `--text-inverse`, not `--text-on-accent`.** In One
Dark that is white on `#61afef`, about 2.4:1. That is what ships, and
`theme.css` says it on purpose. Copy it for parity, and flag it as a separate
issue if it matters.

### 1.4 Derived mixes components use

These are written inline in the modules. For mockups they are named
`--mock-*` below so nobody mistakes them for app tokens.

| Mock name | Expression | Where |
| --- | --- | --- |
| `--mock-chosen` | `color-mix(in srgb, var(--accent-primary) 17%, var(--bg-elevated))` | segmented chosen pill, toolbar toggle that is on, secondary button `[data-active]`, Pose's Spread Layers on |
| `--mock-option-hover` | `color-mix(in srgb, var(--accent-primary) 8%, transparent)` | segmented option hover |
| `--mock-card-checked` | `color-mix(in srgb, var(--accent-primary) 12%, var(--bg-elevated))` | OptionCard checked |
| `--mock-current-row` | `color-mix(in srgb, var(--accent-primary) 14%, transparent)` | References rail current row |
| `--mock-panel-fill` | `color-mix(in srgb, var(--bg-secondary) 92%, var(--bg-primary))` | floating tool window |
| `--mock-panel-bar` | `color-mix(in srgb, var(--bg-tertiary) 78%, transparent)` | tool window title bar |
| `--mock-moved-along` | `color-mix(in srgb, var(--accent-primary) 55%, var(--bg-primary))` | Fold cross-section: moves but not picked |
| `--mock-left-behind` | `color-mix(in srgb, var(--text-muted) 60%, transparent)` | Fold cross-section: excluded (grey, dim) |
| `--mock-warning-bg` / `-border` | `color-mix(in srgb, var(--status-warning) 8%, var(--bg-secondary))` / `… 40%, var(--border-subtle)` | Notice warning |
| `--mock-danger-bg` / `-border` | the same with `--status-danger` | Notice danger (refusal) |
| `--mock-menu-shadow` | `0 4px 12px color-mix(in srgb, var(--shadow-overlay) 28%, transparent)` | Menu surface |

### 1.5 Shadows, focus and disabled states

- **Shadows:** dialogs use `var(--shadow-context-menu)`. Menus use the
  `--mock-menu-shadow` value. Tooltips, the floating tool window and overlay
  toolbars use `0 8px 24px var(--shadow-overlay)`. Raised toolbars (the selection
  toolbar) use `0 2px 8px rgb(0 0 0 / 30%)`. Viewport popovers use
  `0 10px 28px var(--shadow-overlay)`.
- **Focus ring:**
  - Buttons: `box-shadow: 0 0 0 2px var(--accent-primary)`.
  - List rows and options: `outline: 2px solid var(--accent-primary); outline-offset: -2px`.
  - Select trigger: `border-color: var(--accent-primary)` plus `0 0 0 2px color-mix(accent 24%, transparent)`.
  - Switch: `0 0 0 2px color-mix(accent 48%, transparent)`.
  - Chip: `outline 2px` at offset 1px.
  - Always `:focus-visible`, never `:focus`.
- **Disabled:**
  - Buttons: `background: var(--bg-secondary); border-color: var(--border-default); color: var(--text-muted); opacity: .68; cursor: not-allowed`.
  - Segmented option and menu row: opacity .5. Option card: .55. Switch: .55.
  - FieldRow `[data-disabled]` dims label and readout to .5, but a **reason** note keeps full ink and is not dimmed.
  - "Refused but focusable" uses `aria-disabled="true"`, not `disabled`. Pose's pager and segmented options do this so the tooltip can still say why.

### 1.6 Ready-to-paste CSS

Paste **block A** once, then **one theme block**. For a mockup published with
a light/dark switch, map dark to One Dark and light to Atom One Light (the app's
own rule).

```css
/* A. Ori Studio constants and mock helpers (every theme) */
:root {
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 20px; --space-6: 24px;
  --radius: 8px; --radius-sm: 4px; --radius-md: 6px; --radius-lg: 8px; --radius-full: 999px;
  --motion-duration: 160ms; --motion-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  --workspace-header-height: 36px;
  --touch-target: 44px;
  --z-canvas-overlay: 900; --z-modal: 9999; --z-portaled-popover: 10000;
  --font-ui: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --font-readout: 'SF Mono', 'Fira Code', monospace;

  /* Tokens the app defines as aliases of others */
  --menu-highlight: var(--accent-primary);
  --menu-highlight-text: var(--text-on-accent);
  --segmented-track: var(--bg-canvas);
  --settings-well: var(--bg-canvas);

  /* Paper style "Default" (Settings ▸ Paper; not a theme token). pt × 4/3 = CSS px */
  --mock-paper-front: #ffff32;          /* Oriedita yellow */
  --mock-paper-back: #e9e9e9;
  --mock-paper-edge: #000000;           /* 0.9pt = 1.2px */
  --mock-paper-aux: #9aa4ad;            /* 0.5pt = 0.67px */
  --mock-diagram-mountain: #db1f24;     /* 0.825pt = 1.1px, dash 8,2,1,2 × width */
  --mock-diagram-valley: #1c5cd9;       /* 0.825pt = 1.1px, dash 4,2 × width */
  --mock-diagram-mountain-dash: 8.8 2.2 1.1 2.2;  /* px, for stroke-dasharray */
  --mock-diagram-valley-dash: 4.4 2.2;
  /* Paper style "Diagram" (the Diagram workspace's default): white #ffffff / back #b3b3b3,
     ink #231f20; edges 0.5pt, folds 0.25pt, diagram creases 0.75pt in ink with the same dashes */

  /* Derived mixes, as the modules write them */
  --mock-chosen: color-mix(in srgb, var(--accent-primary) 17%, var(--bg-elevated));
  --mock-option-hover: color-mix(in srgb, var(--accent-primary) 8%, transparent);
  --mock-card-checked: color-mix(in srgb, var(--accent-primary) 12%, var(--bg-elevated));
  --mock-current-row: color-mix(in srgb, var(--accent-primary) 14%, transparent);
  --mock-panel-fill: color-mix(in srgb, var(--bg-secondary) 92%, var(--bg-primary));
  --mock-panel-bar: color-mix(in srgb, var(--bg-tertiary) 78%, transparent);
  --mock-moved-along: color-mix(in srgb, var(--accent-primary) 55%, var(--bg-primary));
  --mock-left-behind: color-mix(in srgb, var(--text-muted) 60%, transparent);
  --mock-warning-bg: color-mix(in srgb, var(--status-warning) 8%, var(--bg-secondary));
  --mock-warning-border: color-mix(in srgb, var(--status-warning) 40%, var(--border-subtle));
  --mock-danger-bg: color-mix(in srgb, var(--status-danger) 8%, var(--bg-secondary));
  --mock-danger-border: color-mix(in srgb, var(--status-danger) 40%, var(--border-subtle));
  --mock-menu-shadow: 0 4px 12px color-mix(in srgb, var(--shadow-overlay) 28%, transparent);
}
html { -webkit-tap-highlight-color: transparent; }
body { margin: 0; background: var(--bg-primary); color: var(--text-primary); font-family: var(--font-ui); letter-spacing: 0; }
button, input, select, textarea { font: inherit; }
* { box-sizing: border-box; }
```

```css
/* B1. One Dark — the default theme */
:root, [data-theme="one-dark"] {
  --bg-primary: #282c34; --bg-secondary: #21252b; --bg-tertiary: #2c313a; --bg-elevated: #2c313a;
  --bg-surface: #2d323b; --bg-canvas: #1b1f27; --bg-canvas-grid: #3a3f4b;
  --text-primary: #abb2bf; --text-secondary: #828997; --text-tertiary: #5c6370; --text-muted: #5c6370;
  --text-inverse: #ffffff; --text-on-accent: #282c34; --text-on-danger: #000000;
  --accent-primary: #61afef; --accent-hover: #74baff; --accent-secondary: #e5c07b; --accent-tertiary: #56b6c2;
  --border-default: #3e4452; --border-subtle: color-mix(in srgb, #3e4452 48%, transparent); --border-strong: #528bff;
  --status-success: #98c379; --status-warning: #e5c07b; --status-danger: #e06c75; --status-info: #56b6c2;
  --shadow-overlay: rgba(0,0,0,0.55); --overlay-dim: rgba(0,0,0,0.55);
  --shadow-context-menu: 0 4px 12px rgba(0,0,0,0.5);
  --domain-overlay-bg: color-mix(in srgb, #282c34 82%, transparent);
  --cp-selection: #e5c07b;
  --fold-mountain: #ff4d5d; --fold-valley: #60a5fa; --fold-flat: #64c8c8; --fold-border: #abb2bf; --fold-unassigned: #9aa4ad;
  --bg-paper: #f2f0e7; --paper-back: #1c1f24;
  color-scheme: dark;
}
```

```css
/* B2. Atom One Light — the default light theme */
[data-theme="atom-one-light"] {
  --bg-primary: #fafafa; --bg-secondary: #f0f0f0; --bg-tertiary: #d7dae0; --bg-elevated: #d7dae0;
  --bg-surface: #e5e5e6; --bg-canvas: #fafafa; --bg-canvas-grid: #d7dae0;
  --text-primary: #383a42; --text-secondary: #696c77; --text-tertiary: #a0a1a7; --text-muted: #a0a1a7;
  --text-inverse: #1a1a1a; --text-on-accent: #000000; --text-on-danger: #000000;
  --accent-primary: #4078f2; --accent-hover: #a626a4; --accent-secondary: #986801; --accent-tertiary: #0184bc;
  --border-default: #e5e5e6; --border-subtle: color-mix(in srgb, #e5e5e6 72%, transparent); --border-strong: #4078f2;
  --status-success: #50a14f; --status-warning: #986801; --status-danger: #e45649; --status-info: #0184bc;
  --shadow-overlay: rgba(0,0,0,0.2); --overlay-dim: rgba(0,0,0,0.2);
  --shadow-context-menu: 0 4px 12px rgba(0,0,0,0.12);
  --domain-overlay-bg: color-mix(in srgb, #fafafa 88%, transparent);
  --cp-selection: #12848d;
  --fold-mountain: #d91f3a; --fold-valley: #2563eb; --fold-flat: #2f9c9c; --fold-border: #383a42; --fold-unassigned: #9aa4ad;
  --bg-paper: #fffdf7; --paper-back: #c0c0c3;
  color-scheme: light;
}
```

```css
/* B3. GitHub Light — a second light theme (white canvas) */
[data-theme="github-light"] {
  --bg-primary: #ffffff; --bg-secondary: #f6f8fa; --bg-tertiary: #d0d7de; --bg-elevated: #d0d7de;
  --bg-surface: #eaeef2; --bg-canvas: #ffffff; --bg-canvas-grid: #d0d7de;
  --text-primary: #1f2328; --text-secondary: #656d76; --text-tertiary: #8c959f; --text-muted: #8c959f;
  --text-inverse: #1a1a1a; --text-on-accent: #ffffff; --text-on-danger: #ffffff;
  --accent-primary: #0969da; --accent-hover: #0550ae; --accent-secondary: #bf8700; --accent-tertiary: #0969da;
  --border-default: #d0d7de; --border-subtle: color-mix(in srgb, #d0d7de 72%, transparent); --border-strong: #0969da;
  --status-success: #1a7f37; --status-warning: #bf8700; --status-danger: #cf222e; --status-info: #0969da;
  --shadow-overlay: rgba(0,0,0,0.2); --overlay-dim: rgba(0,0,0,0.2);
  --shadow-context-menu: 0 4px 12px rgba(0,0,0,0.12);
  --domain-overlay-bg: color-mix(in srgb, #ffffff 88%, transparent);
  --cp-selection: #8250df;
  --fold-mountain: #d91f3a; --fold-valley: #2563eb; --fold-flat: #2f9c9c; --fold-border: #1f2328; --fold-unassigned: #9aa4ad;
  --bg-paper: #fffdf7; --paper-back: #bcbdbf;
  color-scheme: light;
}
```

```css
/* B4. Horizon — the theme in the owner's screenshots. NB accent === danger */
[data-theme="horizon"] {
  --bg-primary: #1c1e26; --bg-secondary: #16161c; --bg-tertiary: #2e303e; --bg-elevated: #2e303e;
  --bg-surface: #232530; --bg-canvas: #13141a; --bg-canvas-grid: #2e303e;
  --text-primary: #e0e0e0; --text-secondary: #d5d8da; --text-tertiary: #6c6f93; --text-muted: #6c6f93;
  --text-inverse: #ffffff; --text-on-accent: #1c1e26; --text-on-danger: #1c1e26;
  --accent-primary: #e95678; --accent-hover: #f09383; --accent-secondary: #fab795; --accent-tertiary: #26bbd9;
  --border-default: #2e303e; --border-subtle: color-mix(in srgb, #2e303e 48%, transparent); --border-strong: #e95678;
  --status-success: #29d398; --status-warning: #fab795; --status-danger: #e95678; --status-info: #26bbd9;
  --shadow-overlay: rgba(0,0,0,0.6); --overlay-dim: rgba(0,0,0,0.6);
  --shadow-context-menu: 0 4px 12px rgba(0,0,0,0.5);
  --domain-overlay-bg: color-mix(in srgb, #1c1e26 82%, transparent);
  --cp-selection: #b877db;
  --fold-mountain: #ff4d5d; --fold-valley: #60a5fa; --fold-flat: #64c8c8; --fold-border: #e0e0e0; --fold-unassigned: #9aa4ad;
  --bg-paper: #f2f0e7; --paper-back: #14151b;
  color-scheme: dark;
}
```

---

## 2. Components the dialog will reuse

All dimensions are for a fine pointer. Under `(pointer: coarse)` every `sm`, `md`
and `lg` control and every icon control gets `min-height` (and, for icon
controls, `min-width`) of 44px. Menu rows and segmented pills grow to 44px.
Cross-section rows grow to 28px.

### 2.1 Modal frame and backdrop

**Behaviour, shared by every modal** (`components/ui/useModalDialog.ts`):
- Root: `role="dialog" aria-modal="true" data-shortcut-barrier`. The surface inside is
  `role="document" tabIndex=-1` and takes focus as the dialog opens.
- Tab wraps inside the dialog. Escape closes it unless a field is using Escape.
  A press on the backdrop closes it. Focus returns to the opener.
- Keys never reach the workspace behind the dialog.

**The new frame. Copy this one.** Sources:
`components/diagram/DiagramReferencesBrowser.module.css` (the References
browser, `PullBrowserFrame`) and `components/fold/import/FoldImportDialog.module.css`.

| Part | CSS |
| --- | --- |
| Backdrop | `position: fixed; inset: 0; z-index: var(--z-modal); display: grid; place-items: center; padding: max(16px, safe-area) on each side; background: var(--overlay-dim); backdrop-filter: blur(4px)` |
| Surface | `display: flex; flex-direction: column; border: 1px solid var(--border-default); border-radius: var(--radius); background: var(--bg-primary); box-shadow: var(--shadow-context-menu); overflow: hidden`. Sizes: References browser `width: min(1180px, 100%); height: min(860px, 100%)` (a fixed height, so the list scrolls inside). Fold import `width: min(560px, 100%); max-height: min(760px, 100%)` |
| Header bar | `display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 4px 8px 4px 12px; border-bottom: 1px solid var(--border-subtle); background: var(--bg-secondary)`. Order: lead (back button on a phone) + **title** (`0.82rem / 650`, `--text-primary`, ellipsis), then tools (segmented controls, ghost buttons, gap 8px), then the **close IconButton** `sm` ghost with `X` at 15px, `aria-label="Close {title}"` |
| Body | `display: grid; flex: 1; min-height: 0`. With a rail: `grid-template-columns: 188px minmax(0, 1fr)`. The rail: `padding: 8px; gap: 2px; border-right: 1px solid var(--border-subtle); background: var(--bg-secondary); overflow-y: auto` |
| Rail row | `grid 40px / 1fr; gap 8px; padding 6px; radius 8px`. Hover `--bg-tertiary`. Current `--mock-current-row`. Focus `outline 2px accent, offset -2px`. Name `0.78rem/600`, note `0.7rem --text-muted` |
| Empty or working message | centred grid, `gap 8px; padding 20px; color --text-secondary; 0.8rem; max-width 40ch`, with an optional `sm` secondary button under it |
| Footer | `display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--border-subtle); background: var(--bg-elevated)`. Left: count `0.76rem/600 --text-secondary, min-width 7ch`. Then ghost `sm` buttons ("Select all", "Clear"). Then **Cancel** (ghost `sm`, `margin-left: auto`) and the **primary** `sm` verb |
| Phone (`max-width: 720px`) | backdrop gutter 0; the surface fills the screen (`border: 0; border-radius: 0`); the tools wrap to their own row under the title; the rail becomes a horizontal strip above the list |

**The legacy frame** (`.simple-modal` in `styles/theme.css` 797–872;
`components/ui/PreviewDialog.tsx`, which `components/paperExport/ExportModalFrame.tsx`
wraps with a `Download` 15px icon before the title). It is listed so you can
recognise it, not copy it:
- Document `width: min(980px, 100vw - 24px)`, `--bg-secondary`, border-default, radius 8.
- Header `padding: 12px; border-bottom: 1px solid var(--border-default)`, title `0.9rem/750` with a 15px icon and 8px gap, close IconButton `sm`.
- Body is a grid with `gap: 12px; padding: 12px`. Export layout: `grid-template-columns: minmax(220px,1fr) minmax(240px,300px)`, `block-size: min(600px, 100vh - 160px)`.
- Preview well `--bg-primary`, radius 8. Controls column `gap 16px`. Sections are divided by `--border-subtle` with 12px under each.
- Footer is right-aligned. Enter submits.

### 2.2 Button (`components/ui/Button.tsx`, styles in `theme.css` 233–420)

- Base: `inline-flex; gap 6px; border 1px transparent; font-weight 600; line-height 1; white-space: nowrap; radius 8px; transition 0.15s` on background, border and colour.
- Sizes: `sm` 28px tall, `padding 0 10px`, `0.75rem`. `md` 32px, `0 12px`, `0.85rem`. `lg` 36px, `0 16px`, `0.95rem`.
- Icons inside are 13–14px.

| Variant | Rest | Hover |
| --- | --- | --- |
| primary | bg and border `--accent-primary`, text `--text-inverse` | `--accent-hover` |
| secondary (default) | bg `--bg-elevated`, border `--border-default`, text `--text-primary` | bg `--bg-surface`. `[data-active]` gives `--mock-chosen` with an accent border |
| ghost | transparent, text `--text-secondary` | bg `--bg-elevated`, text `--text-primary` |
| danger | bg and border `--status-danger`, text `--text-inverse` | (no hover rule) |

Dialog actions are `sm`. A text verb is preferred when an icon cannot say it
(owner rule 7).

### 2.3 IconButton (`components/ui/IconButton.tsx`)

- Square, `sm` 28×28, `md` 32×32, `lg` 36×36, `padding 0`, radius 8. Icons are 14px in toolbars and 15px in headers and the Pose bar.
- `variant="default"` is **ghost** (transparent, `--text-secondary`, hover `--bg-elevated`).
  `variant="toolbar"` is **secondary** (filled `--bg-elevated`, 1px `--border-default`), which every floating and viewport toolbar uses.
- `isActive` sets `data-active`. Only the secondary/toolbar variant has a style for it (`--mock-chosen` with an accent border).
- `title` becomes a Radix tooltip **and** the accessible name. A disabled button is wrapped in a span so its tooltip still shows (it should say why).

### 2.4 Toolbar, FloatingToolbar, viewport toolbar

**`Toolbar`** (`components/ui/Toolbar.module.css`): `display: flex; align-items: center; gap: 6px; padding: 4px; border: 1px solid var(--border-default); border-radius: 12px`.
- `tone="overlay"` (bars over a canvas): `background: var(--domain-overlay-bg); box-shadow: 0 8px 24px var(--shadow-overlay); color: var(--text-secondary)`.
- `tone="raised"` (the selection toolbar): `background: var(--bg-elevated); box-shadow: 0 2px 8px rgb(0 0 0 / 30%)`.
- Separator: 1px `--border-default`, 18px tall, `margin: 0 5px`. In a raised bar it stretches the full height with `margin: 2px`.
- Coarse pointer: the bar wraps between groups only, with gap `6px 10px`, and separators hide.

**`FloatingToolbar`** (`components/ui/FloatingToolbar.tsx`): a raised `Toolbar`,
portalled, `z-index: var(--z-canvas-overlay)`, placed by floating-ui at
**`top-start`, 8px above** the object's box. It flips and shifts inside the
canvas pane.

**Viewport toolbar** (`components/panels/ViewportToolbar.tsx`): an overlay
`Toolbar` **centred at the bottom of the pane, 12px up**
(`left: 50%; bottom: 12px; transform: translateX(-50%); max-width: calc(100% - 24px)`).
- Zoom cluster: `ZoomOut`, a percentage button (`height 28; min-width 52; padding 0 8px; 0.72rem`, hover `--bg-surface`), `ZoomIn`.
- Then **Fit** (`Maximize2`), then the surface's own groups.
- Its buttons are IconButton `sm` `toolbar` at 14px icons. A toggle shows "on" with `isActive` (the `--mock-chosen` fill).

### 2.5 SegmentedControl (`components/ui/SegmentedControl.module.css`)

- Track: `inline-flex; gap 3px; padding 3px; border 1px var(--border-default); radius 8; background: var(--segmented-track)` (the well = `--bg-canvas`).
  Height: `sm` 28, `md` 32, `lg` 36. It hugs its options unless `fill`.
- Option: `padding 0 6px (sm) / 0 8px; radius 5px; 0.72rem / 650; color --text-secondary`.
  Hover `--mock-option-hover` with `--text-primary`. Chosen: `--text-primary`, on a **sliding indicator** filled `--mock-chosen` that moves with `transform` over 160ms.
- Disabled option: opacity .5. If the chosen option is refused, the indicator dims to .5.
- `role="group"`. Options can carry a tooltip that says why they are refused.

### 2.6 FieldRow and the pane section (`components/ui/fieldRows/FieldRow.module.css`)

- Row: `display: grid; grid-template-columns: minmax(80px, 1fr) minmax(80px, auto); align-items: center; gap: 8px; padding: 7px 12px; border-bottom: 1px solid var(--border-subtle)`.
- Label `0.74rem --text-secondary`. Value `0.74rem --text-primary`, right-aligned, `tabular-nums`.
- Value kinds: toggle, input, select, segmented, slider and text all right-justify their control. Selects in a row are 26px tall. Number fields are 26px.
- Note line (under the label, second grid row): `0.66rem --text-tertiary`, one line, 1.2em tall and **always reserved** so the switch never moves. A **reason** note (why a control is disabled) uses `--text-secondary`, wraps, and is not dimmed.
- `help`: an `Info` 12px mark after the label (`--text-muted`, tooltip after 150ms).
- `nested`: `padding-left: 24px`.
- `[data-action]`: the whole row is a button, radius 4, hover `--bg-surface`.
- Coarse: columns become `minmax(0,1fr) minmax(140px, auto)` and the label truncates.

**Section** (`CollapsibleSection`, `.collapsible-section` in `theme.css` 4889–4970):
- Header `padding: 8px 12px 4px`, title `0.74rem/600 --text-secondary`. When collapsible, a `ChevronRight` 13px in `--text-tertiary` rotates 90° when open.
- Hint `0.7rem --text-tertiary, padding 0 12px 6px`.
- The section ends with a `--border-subtle` rule.

Owner rule: pane controls keep this spacing exactly (7px rows, 28px
segmented, 26px number fields, a rule under each row).

### 2.7 Menu: dropdowns and the right-click menu (`components/ui/Menu.module.css`)

- Surface: `min-width 180px; padding 4px; border 1px var(--border-default); radius 8; background var(--bg-elevated); box-shadow var(--mock-menu-shadow); z-index var(--z-portaled-popover)`.
- Row: `flex; gap 8px; min-height 28px; padding 5px 8px; radius 4; 12px; --text-primary`. Leading icon slot is 16px wide.
- Highlighted row: `background: var(--menu-highlight)` (the accent), `color: var(--menu-highlight-text)`. Icon, check, shortcut and chevron all take the text colour.
- Danger row: `--status-danger` text. Highlighted, it fills danger with `--text-on-danger`.
- Disabled: `opacity .5`. Its `hint` becomes the native `title`.
- Shortcut: `11px --text-secondary`. Separator: 1px `--border-default`, `margin 4px 6px`. Group label: `10px/600 uppercase .06em --text-tertiary, padding 6px 8px 2px`.
- A submenu arrow is `ChevronRight` 12px. Radio and checkbox rows show a `Check` in the leading slot. An exclusive set always reserves that column, so labels never shift.
- The toolbar dropdowns are non-modal: a press outside closes the menu **and** acts.

### 2.8 OptionCards (`components/ui/OptionCard.module.css`)

- `role="radiogroup"`. Grid `repeat(var(--option-columns, 2), minmax(0,1fr)); gap 8px`.
- Card: `grid; gap 4px; min-height 44px; padding 10px; border 1px var(--border-default); radius 8; background --bg-elevated`.
  Hover `--border-strong`. Checked: accent border, `--mock-card-checked` fill, icon in the accent. Disabled: opacity .55.
- Icon `--text-secondary`. Label `0.78rem/600`. Description `0.7rem --text-tertiary, line-height 1.35`.
- Arrow keys move **and choose**.

### 2.9 Tooltip (`components/ui/Tooltip.module.css`)

`max-width: 220px; padding: 6px 8px; border: 1px solid var(--border-default); radius 8; background: var(--bg-elevated); color: var(--text-primary); box-shadow: 0 8px 24px var(--shadow-overlay); font-size: 0.72rem`.
It sits **above** the trigger by default, 6px away. The provider uses the Radix
default delay (700ms);
FieldRow help uses 150ms. Long-press shows the tooltip on touch.

### 2.10 Notice, Chip, Switch

- **Notice** (`components/ui/Notice.module.css`), a standing message in a fixed place:
  `flex; gap 8px; padding 8px 12px; border 1px var(--border-subtle); radius 8; background --bg-secondary; color --text-secondary; 0.74rem / line-height 1.45`.
  - Icons are 14px, offset 2px from the top: info `Info` in `--text-tertiary`, warning `TriangleAlert` in `--status-warning`, danger `CircleAlert` in `--status-danger`.
  - The warning and danger tones use the `--mock-*-bg/-border` tints.
  - Actions are `sm` secondary buttons under the sentence, `margin-top 8px`.
  - Danger is `role="alert"`.
- **Chip** (`components/ui/Chip.module.css`): pill `radius 999; border 1px --border-subtle; transparent; --text-secondary`.
  - `sm` is 24px tall (`0 9px`, `0.72rem/600`, border-default). `md` is 28px (`0 7px`, `0.72rem`).
  - Hover: accent border. Pressed: accent fill with `--bg-secondary` text.
- **Switch** (`.toggle-switch` in `theme.css` 603–653): `44×24; radius 999; border 1px --border-default; bg --bg-secondary`.
  The thumb is 20px white with `0 1px 4px var(--shadow-overlay)`. When checked: accent fill, border `color-mix(accent 68%, border-default)`, and the thumb moves to 21px.

### 2.11 The floating tool window (`components/ui/tools/ToolHintWindow.tsx`, `components/ui/FloatingPanel.module.css`)

This is where Fold's layer-order chooser and cross-section picker live today.
- Width **288px**, fixed to the canvas's bottom-right corner, 12px up, `z-index 900`, `max-height: min(60vh, 520px)` (a phone caps it at `min(36vh, 320px)`).
- Frame: `border 1px --border-default; radius 8; background --mock-panel-fill; box-shadow 0 8px 24px var(--shadow-overlay); color --text-secondary; 0.68rem`.
- Title bar: `min-height 30px; padding 5px 8px; border-bottom 1px --border-subtle; background --mock-panel-bar`, title centred `760` weight, meta `0.62rem/700 --text-tertiary`.
- Body: `padding 8px`, scrolls. A dock sticks to the bottom with a top rule.

### 2.12 Fold's layer controls (exist at eb4b51c54)

**Cross-section picker** (`components/fold/FoldCrossSectionPicker.tsx` + `.module.css`).
The layers at a fold *line*, as a `role="listbox"`:

- Frame: `padding 6px 0; gap 2px; border 1px --border-subtle; radius 4; background --bg-primary`.
- "TOP" label, right-aligned over the tag column: `0.58rem / 800 / uppercase --text-muted`.
- Rows have **no gap** between them (so brackets can count in rows). Each row is `grid: 1fr 52px; gap 8px; height 18px; padding 0 8px`.
  - Hover `--bg-surface`. Focus `outline 2px accent, offset -2px`.
  - The **bar** is `3px` tall, `radius 999`, `min-width 3px`, and spans `left: from%; width: (to-from)%` along the line.
  - Tag (flap name): `0.66rem --text-tertiary`, right-aligned with an ellipsis. It turns `--text-secondary` when the row moves.
- Bar ink by state:

| State | Bar | Meaning |
| --- | --- | --- |
| `picked` | `--accent-primary` | the user picked this flap |
| `added` | `--mock-moved-along` (accent 55% into the ground) | moves along with what is picked |
| `excluded` | `--mock-left-behind` (muted 60%) | stays: **grey and dim, never dashed** |
| `data-needed` | `--status-danger` | in the way of the fold asked for |
| `data-unordered` | a 1px `--border-subtle` hairline over the track | beside the row above, not under it |

- **Brackets** where a bend joins two rows: SVG `C` curves bulging 4% of the track, `stroke-width 1.5`, non-scaling. They take the upper row's ink (`picked` accent, `added` moved-along, otherwise left-behind).
- Keys: ↑/↓, Home/End, Space toggles. Hovering a row lights its flap on the canvas.
- Coarse pointer: rows are 28px.
- Under the picker, **flap chips** (`FoldFlapChips`): a wrap of chips with `gap 6px`, and a `CircleAlert` 12px in danger on a chip that is in the way.

**Order chooser** (`components/fold/orders/FoldOrderChooser.tsx`), inside the tool window:
- A note (`0.75rem --text-secondary lh 1.4`): "Preview the arrangements, then choose the order you want."
- The navigation row, `space-between`: IconButton `sm` ghost with `ChevronLeft` at 16px; then `role="status"` text "Order 2 of 5" / "Order 2 of 5 found" / "Loading order…" / "No order found yet"; then `ChevronRight`.
- "Search incomplete. More orders may exist.", then a secondary `sm` button "Find more orders".
- Right-aligned actions: **Back** (secondary `sm`) and **Use this order** (primary `sm`).

**Stack inspector** (`components/fold/orders/FoldOrderStacks.tsx`):
- A `<details>` "Inspect layer stacks" (`0.75rem`, `max-height 180px`, scrolls).
- Help text: "Select a region to highlight it. Layers are listed from front to back…".
- One ghost `sm` button per stacked region, `aria-pressed`, reading "Region 3: 4 → 1 → 2", with a trailing " •" when that region differs from the first preview.
- The pressed region is tinted on the folded pane (accent at 0.42, and the hovered region at 0.26; see 4.4).

**Choice stepper** (`components/fold/reverse/FoldReverseControls.tsx`, `FoldChoiceStepperRow`):
- A FieldRow, `divider={false}`. The label is "Layer order" (or "Opening", "Pocket"…).
- Value: **secondary `sm` Buttons** (28px, `0 10px`) with `ChevronLeft`/`ChevronRight` at 13px.
- The count between them is `min-width 3.5em; 0.7rem --text-secondary; tabular-nums; centred`, reading "2 of 3".

### 2.13 Canvas readouts

- **`ViewportStatusReadout`**, top-left of a canvas, 12px in: `min-height 24px; padding 3px 8px; border 1px --border-subtle; radius 8; background --domain-overlay-bg; box-shadow 0 8px 24px var(--shadow-overlay); --text-secondary; 'SF Mono','Fira Code',monospace 0.68rem; tabular-nums; pointer-events: none`.
  A good model for "3 layers here" on hover.
- **`CanvasContextBar`**, top-centre, 12px in: `--pad 4px; min-height 38px; padding 4px 8px; border 1px --border-strong; radius 12; --bg-elevated; --shadow-context-menu; 12px`. Title `600 --text-secondary`.

---

## 3. Icons

Every icon is lucide 0.563.0 unless marked. The rendered markup is `viewBox 0 0 24 24`,
`stroke="currentColor"`, `stroke-width="2"`, round caps and joins, `fill="none"`.
The size attribute is what the app passes: 14 in toolbars and menus, 15 in
headers, the Pose bar and the close button, 16 for Fold's order chevrons.
Colour comes from `currentColor`, which is the button's text colour
(`--text-secondary` at rest for ghost, `--text-primary` for toolbar/secondary).

| Concept | Icon | Used at (source) |
| --- | --- | --- |
| Another solution / next layer order | `chevron-right` | Edit `cp-workspace/folded/foldedFigureActionIcons.tsx` ("another"); Pose `components/diagram/DiagramLinkedPoseControls.tsx` (`next-solution`); Fold order chooser |
| Back to first solution (the wrap) | `chevron-first` | `foldedFigureActionIcons.tsx` ("first-solution") |
| Previous layer order | `chevron-left` | `DiagramLinkedPoseControls.tsx`, `DiagramStepPose.tsx`, `FoldOrderChooser.tsx` |
| Flip / Turn over / Side | `rotate-ccw-square` | `foldedFigureActionIcons.tsx` (flip, side), `DiagramLinkedPoseControls.tsx` (turn-over), `components/fold/FoldActionIcon.tsx` (turn-over). **One concept, one icon** |
| Render as (display style), Pose's Spread Layers, Fold's Precreases | `layers` | `foldedFigureActionIcons.tsx`, `DiagramLinkedPoseControls.tsx`, `components/fold/canvas/FoldViewportToolbar.tsx` (**overloaded**; see the note below) |
| Fold's Spread layers | `layers-2` | `FoldViewportToolbar.tsx` |
| Fit | `maximize-2` | `components/panels/ViewportToolbar.tsx` |
| Zoom out / in | `zoom-out` / `zoom-in` | `ViewportToolbar.tsx` |
| Close | `x` (15px) | every dialog's close button (`DiagramReferencesBrowser.tsx`, `PreviewDialog.tsx`) |
| Check (chosen row) | `check` | `components/ui/ContextMenu.tsx` and others |
| Warning | `triangle-alert` | `components/ui/Notice.tsx`, `foldedFigureActionIcons.tsx` ("notice-warn") |
| Error / refused (Notice danger) | `circle-alert` | `Notice.tsx`, `components/fold/FoldFlapChips.tsx` ("in the way") |
| Error (3D verdict) | `octagon-alert` | `foldedFigureActionIcons.tsx` ("notice-error") |
| Info | `info` | `Notice.tsx`, `components/ui/fieldRows/FieldRow.tsx` (help mark, 12px) |
| Undo / Redo | `undo-2` / `redo-2` | `components/ui/TouchHistoryButtons.tsx`, `components/CanvasHistoryPills.tsx`. `undo-2` is also Pose's "Reset Pose" and Fold's "Unfold to" |
| Delete | `trash-2` | `foldedFigureActionIcons.tsx`, `FoldActionIcon.tsx`, Diagram Layers |
| Reset (a setting to default) | `rotate-ccw` | FieldRow reset, `SettingsModal.tsx`, Diagram Layers |
| Style (appearance menu) | `paintbrush` | `foldedFigureActionIcons.tsx` |
| Refold | `refresh-cw` | `foldedFigureActionIcons.tsx` |
| Export | `file-down` | `foldedFigureActionIcons.tsx` |
| Duplicate | `copy` | `foldedFigureActionIcons.tsx` |
| Reset 3D view | `focus` | `foldedFigureActionIcons.tsx` |
| Swap pane (phone) | `arrow-left-right` | `components/fold/canvas/FoldPhoneBarControls.tsx` |
| Back (phone dialog lead, Step detail) | `arrow-left` | `DiagramReferencesBrowser.tsx`, `DiagramStepDetail.tsx` |
| Working | `loader-circle` (spun) | `components/ui/PictureLoading.tsx` |
| Locked | `lock` | Diagram step cards |
| Pin | `pin` | Diagram (rejected by the owner as a *state* mark; see rule 7) |

**Notes for the dialog's icon choices**

- **"Another solution" is a chevron, not a cycle.** No cycle/shuffle icon
  means "another order" anywhere in the app. `shuffle` exists only as a CP tool glyph.
- **There is no X-ray icon for a view.** In Edit, X-ray is a word under
  Style ▸ Render as (which has the `layers` icon). The Simulator's X-ray is a
  word option in a segmented control: `Paper | X-ray`
  (`components/panels/SimulatorViewControlsPanel.tsx`). So the precedent for the
  dialog's X-ray switch is **a worded segmented control or toggle, not an icon**.
  The Diagram has an X-ray *annotation tool* glyph (a radiation symbol, below).
  It stands for a mark drawn on a diagram, so reusing it for a view switch would
  give one icon two concepts. Ask before using it.
- **`layers` already means three things** (Render as, Precreases, Pose's
  Spread Layers), and Spread is `layers` in Pose but `layers-2` in Fold. Do not
  pick `layers` for "Layer order…" without the owner's call. Rule 7 also allows
  a **word label** ("Layer order…") where no icon says the action. Edit's
  floating toolbar is icon-only today, so a word there is a visible departure:
  mock both and let him choose.

### 3.1 SVG markup

Each is shown at 14px. Change `width`/`height` for other sizes.

```html
<!-- chevron-right (Another solution / Next) -->
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
<!-- chevron-left (Previous) -->
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
<!-- chevron-first (Back to first solution) -->
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m17 18-6-6 6-6"/><path d="M7 6v12"/></svg>
<!-- chevron-down (select / disclosure) -->
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
<!-- rotate-ccw-square (Flip / Turn over / Side) -->
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 9V7a2 2 0 0 0-2-2h-6"/><path d="m15 2-3 3 3 3"/><path d="M20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/></svg>
<!-- layers -->
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/></svg>
<!-- layers-2 (Fold's Spread layers) -->
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 13.74a2 2 0 0 1-2 0L2.5 8.87a1 1 0 0 1 0-1.74L11 2.26a2 2 0 0 1 2 0l8.5 4.87a1 1 0 0 1 0 1.74z"/><path d="m20 14.285 1.5.845a1 1 0 0 1 0 1.74L13 21.74a2 2 0 0 1-2 0l-8.5-4.87a1 1 0 0 1 0-1.74l1.5-.845"/></svg>
<!-- maximize-2 (Fit) -->
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/></svg>
<!-- zoom-out / zoom-in -->
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="8" x2="14" y1="11" y2="11"/></svg>
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/></svg>
<!-- x (Close; the app passes 15) -->
<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
<!-- check -->
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
<!-- triangle-alert (warning) -->
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
<!-- circle-alert (danger / refused / in the way) -->
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
<!-- octagon-alert (3D error verdict) -->
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16h.01"/><path d="M12 8v4"/><path d="M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z"/></svg>
<!-- info -->
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
<!-- undo-2 / redo-2 -->
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/></svg>
<!-- trash-2 (Delete) -->
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
<!-- rotate-ccw (reset a setting) -->
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
<!-- paintbrush (Style) -->
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14.622 17.897-10.68-2.913"/><path d="M18.376 2.622a1 1 0 1 1 3.002 3.002L17.36 9.643a.5.5 0 0 0 0 .707l.944.944a2.41 2.41 0 0 1 0 3.408l-.944.944a.5.5 0 0 1-.707 0L8.354 7.348a.5.5 0 0 1 0-.707l.944-.944a2.41 2.41 0 0 1 3.408 0l.944.944a.5.5 0 0 0 .707 0z"/><path d="M9 8c-1.804 2.71-3.97 3.46-6.583 3.948a.507.507 0 0 0-.302.819l7.32 8.883a1 1 0 0 0 1.185.204C12.735 20.405 16 16.792 16 15"/></svg>
<!-- refresh-cw (Refold) -->
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
<!-- file-down (Export…) -->
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/></svg>
<!-- copy (Duplicate) -->
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
<!-- arrow-left-right (swap pane, phone) -->
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/></svg>
<!-- arrow-left (Back) -->
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
<!-- arrow-up / arrow-down (LayerSpreadRows direction) -->
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>
<!-- loader-circle (working; spin it) -->
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
<!-- lock -->
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
```

The Pose bar's other verbs are drawn at 15px. `rotate-ccw` (Rotate Left) and
`undo-2` (Reset Pose) are above. These are `rotate-cw` (Rotate Right) and
`arrow-up-to-line` (Upright):

```html
<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3h14"/><path d="m18 13-6-6-6 6"/><path d="M12 7v14"/></svg>
```

**App-drawn glyphs** (not lucide):

```html
<!-- Fold kind marks, components/fold/FoldKindMark.tsx (stroke 1.7, viewBox 24) -->
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 6 12 18 19 6"/></svg>  <!-- valley -->
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 18 12 6 19 18"/></svg>  <!-- mountain -->
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 19 19 5"/></svg>      <!-- precrease -->

<!-- Diagram Annotate X-ray tool glyph, components/diagram/DiagramAnnotateToolGlyph.tsx (viewBox 20, stroke 1.5).
     A MARK tool, not a view switch; see the note above before reusing it. -->
<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="10" r="8.5" stroke-width="1.3"/><circle cx="10" cy="10" r="6.8" stroke-width="0.65"/><g fill="currentColor" stroke="none"><circle cx="10" cy="10" r="1.1"/><path d="M4.8 10 A5.2 5.2 0 0 1 7.4 5.497 L9.1 8.441 A1.8 1.8 0 0 0 8.2 10 Z"/><path d="M12.6 5.497 A5.2 5.2 0 0 1 15.2 10 L11.8 10 A1.8 1.8 0 0 0 10.9 8.441 Z"/><path d="M12.6 14.503 A5.2 5.2 0 0 1 7.4 14.503 L9.1 11.559 A1.8 1.8 0 0 0 10.9 11.559 Z"/></g></svg>
```

The Fold tool glyphs (`components/fold/FoldToolGlyph.tsx`, 20px, stroke 1.5)
draw a fold line **dashed** `2.4 2.2` because it *is* a fold line. That is the
one place a dash is correct.

---

## 4. Canvas drawing conventions

### 4.1 Edit's crease pattern (`cp-workspace/CreasePatternWebglCanvas.tsx`, `cp-workspace/adapters/cpLineColor.ts`, `lib/oristudioCpLineStyle.ts`)

- **Ground:** `--bg-primary`. Edit draws no paper fill behind the pattern:
  the renderer's `setSheetFill` is called only by References. The grid is
  `--border-default` at 82%.
- **Line style:** the default is `'color'`: every line is solid, and the kind is told by colour.
  - Mountain `--fold-mountain`, valley `--fold-valley`, aux/flat `--fold-flat` (cyan), border/edge `--fold-border` (the theme's text colour), unassigned `--fold-unassigned` (dashed `3 7`).
  - The other styles are color-and-shape (Oriedita dashes: mountain one-dot `10 3 3 3`, valley `8 8`), black-white, black-one-dot and black-two-dot.
- **Width:** `1.5 × lineWidth` CSS px, and the default lineWidth is 1, so **1.5px**.
- **Vertices:** small dots filled `--bg-paper`, stroked `--text-secondary`, with a 1.4px outline.

### 4.2 A flat folded figure in Edit (`cp-workspace/adapters/cpFoldedToScene.ts`, `lib/paper/paperStyle.ts`, `lib/paper/paperStyleResolve.ts`)

- It sits on the same canvas beside its pattern, on the same `--bg-primary` ground.
- It is painted in the **paper style** (Settings ▸ Paper), not the theme. Default style:
  - Front `#ffff32` (Oriedita yellow), back `#e9e9e9`.
  - Edges `#000000` at 0.9pt (1.2px), butt caps.
  - Aux creases `#9aa4ad` at 0.5pt, when the aux toggle is on.
- **A folded figure draws its folds as edges** (the `folded-flat` surface policy
  gets no mountain/valley pens). So the folded view in Edit shows
  yellow/grey faces with black outlines, and no red or blue.
- **Render as:** Paper (default), Wireframe, **X-ray**, Dev 1, Dev 4, None.
  Flat X-ray is Oriedita's ply rendering: each face is drawn about 6% opaque, so a stack of 10–14 layers reaches about 59% (`folded3dStyle.ts` comment). 3D X-ray uses alpha 0.45.
- **Side:** Front or Back. Flip turns the paper over.
- **Shadow:** an optional per-figure toggle.

### 4.3 The paper settings' diagram pens (owner rule 2)

When a crease is drawn **on a folded view** (an instruction, a preview, a
constraint's crease), it uses Settings ▸ Paper's **mountain diagram crease** and
**valley diagram crease** pens, not the theme's fold colours and not the accent:

| Pen | Default style | "Diagram" style (the Diagram's default) |
| --- | --- | --- |
| Mountain diagram crease | `#db1f24`, 0.825pt (1.1px), dash `[8,2,1,2]` × width, i.e. `8.8 2.2 1.1 2.2` px | `#231f20`, 0.75pt, same dash pattern |
| Valley diagram crease | `#1c5cd9`, 0.825pt (1.1px), dash `[4,2]` × width, i.e. `4.4 2.2` px | `#231f20`, 0.75pt, same dash pattern |
| Mountain / valley fold (a pattern's own line) | `#db1f24` / `#1c5cd9`, 0.825pt, solid | ink, 0.25pt, solid |
| Edges | `#000000` 0.9pt | ink 0.5pt |
| Paper front / back | `#ffff32` / `#e9e9e9` | `#ffffff` / `#b3b3b3` |

**A crease-pattern pane keeps Edit's look** (4.1): theme fold colours, solid,
1.5px.

### 4.4 Hover and selection on canvases

- **Edit CP:**
  - Tool previews and the cursor highlight use `--accent-primary`.
  - **Selected** creases and points use **`--cp-selection`** at **2.6×** the stroke width. A theme whose accent is red- or blue-ish overrides this (One Dark uses gold `#e5c07b`) so a selected mountain never reads as a valley.
  - The erase box uses `--status-danger`. The snap ring has a 5px radius.
- **Edit canvas objects (a folded figure, an image):**
  - Selected: a 1.5px `--accent-primary` outline around the object's box (`lib/transformBox.ts` `TRANSFORM_STROKE_PX`), plus handles filled `--bg-primary` and stroked in the accent.
  - A focused (inert-body) object gets a doubled outline, 3px.
- **The Fold panes** (`fold/canvas/foldPaneOverlays.ts`, inks from `fold/canvas/useFoldCanvasInks.ts`):
  - **Every highlight is the theme accent drawn over the paper, never a paper colour** (plan D11). A refused fold's faces use `--status-danger`.

| Feedback | Draw |
| --- | --- |
| Picked point | accent dot r 4.5px with a ground-coloured outline |
| Hovered point | r 8px, accent at 28% fill with an accent stroke |
| Mark (a candidate) | r 3px accent |
| Hovered line | accent at 50%, 2.6× width |
| Located line | accent, 1.6× width (**never dashed**) |
| Offered line | accent at 70%, 2.1× width |
| Picked region (a stack cell) | accent tint **0.42** |
| Hovered region | accent tint **0.26** |
| Moving set / hovered flap | accent tint 0.30 / 0.50, clipped to the moving side of the line |
| Tuck targets / the one taken | accent tint 0.16 / 0.42 |

- **Rows and lists:** hover `--bg-surface`, current or chosen `--mock-current-row` or `--mock-chosen`.

### 4.5 The Fold workspace's two-pane canvas (`components/fold/canvas/FoldCanvas.tsx`, `FoldPane.tsx`, `FoldCanvas.module.css`)

- **The folded form is on the LEFT and its crease pattern on the RIGHT**:
  `grid-template-columns: minmax(0,1fr) minmax(0,1fr)`, split by a
  **1px `--border-subtle`** line on the second pane's left edge.
  - Each pane is a WebGL canvas (`useCpSurface`) on the `--bg-primary` ground, with its own pan and zoom. One bottom toolbar drives both.
- **There are no visible pane labels.** Each canvas has only an `aria-label`
  ("The folded form. Click its points and creases to locate a fold…" / "The
  crease pattern so far, front up…").
- The folded pane is painted through the shared paper painter in the user's paper
  style (the `fold` policy: front/back, edges, aux, M/V folds, diagram creases,
  arrows). The CP pane is drawn exactly as Edit draws one (4.1). The step's own
  creases are its "instruction", drawn at 2× width in the theme's
  valley/mountain inks.
- **Overlays:**
  - Bottom-centre viewport toolbar: Zoom out, %, Zoom in, Fit (for both panes); Step creases (`pen-line`), Precreases (`layers`), Spread layers (`layers-2`) toggles; the step's play transport; Send to Edit.
  - The 288px tool window sits bottom-right.
  - Arrows and letters are drawn as SVG over the folded pane.
- **Phone:** one pane at a time. The bar gets a pane switch (`arrow-left-right`,
  titled with the *other* pane's name: "Folded" / "Crease pattern").
- **Lettering:** Fold letters references the way References and Diagram
  cards do: a point is ringed and lettered, a line is lettered on itself, in the
  edge pen's ink, at References-view size (`FoldActionLayer.tsx`,
  `lib/stepDiagram/diagramInk.ts`). I did not extract the exact px sizes.

**Conflict to resolve:** the spec (§6.2) puts the crease pattern on the
**left** and the folded figure on the **right**, which is the reverse of the Fold
workspace. If the dialog is to share Fold's canvas, mock it Fold's way, or
mock both and ask.

---

## 5. Where the entry points sit

### 5.1 Edit: a flat folded figure

**Floating toolbar** (`cp-workspace/folded/CpFoldedFigureToolbar.tsx`; verbs
from `cp-workspace/folded/foldedFigureActions.ts`, icons from
`foldedFigureActionIcons.tsx`):
- It shows while the figure is selected: a raised Toolbar, top-start, 8px above the figure's box.
- Every control is **icon-only**: IconButton `sm` (28×28), `variant="toolbar"`
  (`--bg-elevated` fill, 1px `--border-default`), 14px icons, 6px gap, and hairline
  separators that run the bar's height. Tooltips are the labels.

A flat figure, in order:

```
[ RotateCcwSquare  Flip ]  [ Paintbrush  Style ▾ ]  │  [ ChevronRight  Another solution ]  [ RefreshCw  Refold ]*  │  [ FileDown  Export… ]  │  [ Copy  Duplicate ]  [ Trash2  Delete ]
                                                       * only when the source creases changed
```

- At the end of the enumeration, "Another solution" becomes **"Back to first
  solution"** with `chevron-first`. It is disabled only for a single-solution fold.
- Style ▾ opens a non-modal dropdown with:
  - Render as ▸ (radio, with `layers` icon)
  - Side ▸ (Front/Back, `rotate-ccw-square`)
  - ─, Front colour / Back colour / Line colour (colour rows)
  - ─, Shadow (check)
  - ─, Auxiliary creases (check)
- A 3D figure adds Reset view (`focus`) and Set upright (`axis-3d`), and leads
  with a verdict chip: `padding 2px 6px; radius 6; 11px`, `--status-warning` or
  `--status-danger` text, an icon, and its label capped at 16ch.

**Context menu:** the same catalog through the Menu renderer, in the same order:

```
Flip
Style            ▸   (Render as ▸ · Side ▸ · ─ · colours · ─ · Shadow · ─ · Auxiliary creases)
─────────
Another solution          (or "Back to first solution")
Refold                    (only when stale)
─────────
Export…
─────────
Duplicate
Delete                    (danger: red text, red fill on highlight)
```

Each row has a 16px icon slot and a 12px label.

**Per the spec (§7.1)**, "Layer order…" goes **beside Another solution**, as
one entry in `buildFoldedFigureActions`, so it appears in both the toolbar and the menu.
In the menu it is a normal row with an ellipsis label. On the icon-only toolbar
it needs an icon or a word (see the `layers` note in §3).

### 5.2 Diagram: the Step pane's "Layer order" row

`components/diagram/DiagramStepPose.tsx`. This shows while a step whose source is a linked crease pattern
(`source.kind === 'cp'`) is open in **Pose** and drawn **Folded** (flat):

- Section "**Pose**" (CollapsibleSection, non-collapsible, rows in a grid with a 4px gap):

```
Rotation        [ 157.5 ° ]          ← NumberRow, 26px field, step 15
Side            [ Front | Back ]     ← SegmentedRow, 28px
Layer order     ‹  2 of 5+  ›        ← FieldRow kind="text"
Spread layers   [ ◯— ]               ← ToggleRow 44×24, then Spread by / Amount / Direction / … when on
```

- The **Layer order** value is an inline-flex with **2px** gaps:
  - IconButton `sm` **ghost** (28×28) with `ChevronLeft` 14px.
  - The count span (`padding 0 4px; 0.74rem --text-primary; tabular-nums; nowrap`).
  - IconButton with `ChevronRight` 14px.
- The count text is "2 of 5" (exhausted), "2 of 5+" (more may exist), "2" (not yet searched), or "None".
- The chevrons **refuse** rather than disable (`aria-disabled`, focus kept). Their tooltip says why: "This is its first layer order", "This fold has one layer order", "This fold has no layer order". The labels are "Previous Layer Order" / "Next Layer Order".
- A **Fold step** (`fold-step`) has no pager: its order is the sequence's.
- Spec §7.3: this row "gains a way to open the dialog". The row's value column
  is the place, and **nothing that appears may shift the chevrons or the count**
  (rule 8).

### 5.3 Pose: the layer-order pager

`components/diagram/DiagramStepDetail.tsx` + `DiagramLinkedPoseControls.tsx`:

- **Header** (`panel-toolbar`, 36px, `--bg-primary`, bottom rule):

```
[← Steps]  [‹]  Step 3 of 12  [›]          [ Pose | Annotate ]          [Done]
```

- **Stage:** `--bg-secondary`, or **white `#ffffff`** once there is a picture. The picture has `padding: 20px 20px 64px` (the 64px leaves room for the bar).
- **Pose bar:** an overlay Toolbar centred **12px from the stage bottom** (`--domain-overlay-bg`, 12px radius, 4px pad, 6px gap, `0 8px 24px` shadow). For a linked flat fold:

```
[ Crease Pattern | Folded | Simulated ]  ⟲□ Turn Over  ↺ Rotate Left  ↻ Rotate Right  ⤒ Upright  ‹  Layer order 2 of 5+  ›  ≋ Spread Layers  ↶ Reset Pose
```

  - The segmented control is `sm`. Verbs are IconButton `sm` **ghost**, icons **15px**.
  - The readout between the chevrons is `padding 0 4px; 0.74rem; --text-secondary; tabular-nums; nowrap; aria-live="polite"`. It reads "Layer order 2 of 5+" (or "No layer order").
  - Spread Layers is a toggle. When on it is filled `--mock-chosen` with `--text-primary`; its state shows as a fill, not a changed icon.
- Spec §7.4: "Layer order…" sits **beside this pager**. The bar is already long:
  on a phone, Spread Layers moves to the Step drawer and the bar wraps by groups.
  Mock the wrap.

### 5.4 The Fold workspace (later; spec §7.5)

- Compound tools show a **"Layer order ‹ 2 of 3 ›"** stepper row (secondary buttons; see 2.12) in the tool window.
- An order that cannot be resolved opens the **order chooser** in the tool window (Back / Use this order) with **Inspect layer stacks** under it.
- The Step pane shows a static "Layer order" row once one is chosen.

---

## 6. Owner rules to obey

From the owner's own reviews (memory notes `tool-ux-consistency-rules`,
`dashes-mean-valley-folds`, `layers-pane-redesign`):

1. **One concept, one icon.** Reuse the existing icon: turn-over is
   `rotate-ccw-square`, another or next order is `chevron-right`, and so on.
   Do not draw a new glyph for an existing concept.
2. **Creases on folded views use Settings ▸ Paper's diagram pens**: mountain
   diagram crease and valley diagram crease (4.3). Never the tool accent. A
   crease-pattern pane keeps Edit's look.
3. **Offer only valid choices.** Filter them. If none is valid, show **one
   message in a fixed, reserved place**, never an error block that pushes the
   content around. (G2 applies this: forced choices are greyed out at once with
   the reason, and the rest are checked when made.)
4. **Feedback at every pick.** Hover-highlight what a click would take, and
   preview what a pick implies, before the click.
5. **Instructions name what you see, briefly**, by the thing's role. One short
   line at most. Light up the valid candidates so the words do less of the work.
6. **An icon reads as an action.** Show **state** with a non-icon mark: a
   small (6px) dot, or grey/dim. A pin at a row's end and a kind-glyph tile in a
   header were both rejected as looking clickable. Give an action whose icon
   cannot say it a **word** label.
7. **Nothing that appears may move the control being edited.** Reserve the
   space (FieldRow's note line is the model). Resets go to the *left* of inputs
   on the Layers surface.
8. **Pane controls keep FieldRow spacing**: 7px rows, 28px segmented, 26px
   number fields, a rule under each row, and 8px row margins in lists.
9. **Dashes mean valley folds.** Never use a dash (or dash-dot, or dots) for a
   *state* of paper, a layer or a fold: excluded, hidden, open spot, changed,
   forced. Use grey and lower opacity, a solid accent at another alpha, or a
   dot. Card borders and drop zones may stay dashed (his call).

These come from AGENTS.md and the app's conventions:

- One radius (8px) on every control, card and floating surface. Inner details use 4px. Concentric containers use radius plus pad.
- Every string is translatable. Do not bake text into images.
- Every interaction works by tap: 44px targets under a coarse pointer, and a phone layout below 720px.

---

## 7. Sharing with the Fold workspace: what exists, what differs

This is for the design question "share the cross-section and stack selection,
but don't over-abstract":

- **Fold's cross-section picker is a cross-section along a fold *line*.** Each
  row is a layer where it meets the line, with a bar spanning `from..to`
  along the line and brackets joining rows at bends. A pick toggles a
  *flap* (every row of it). Its states are about *moving* (picked / moves along /
  left behind / in the way).
- **The dialog's "Layers here" is a stack at a *spot*.** Each row is one face, with
  no extent along anything. A pick is about *order* (on top, above/below,
  forced, why not).
- What carries over cleanly:
  - the row metrics (18px, 28px coarse; 8px pad; 52px tag column; "TOP" header);
  - the solid-bar ink vocabulary (accent / softer accent / grey-dim / danger, **no dashes**);
  - listbox keys;
  - hover-row lights the face on the canvas;
  - the region tint for a selected stack (accent 0.42 / hover 0.26);
  - `FoldOrderStacks`' "Region n: a → b → c" listing with its changed marker.
- The brackets and the along-the-line bars have no meaning at a single spot.
- **Pane order is opposite** (4.5).

Whether to extract a shared row component is a code decision for later. The
mockups only need to *look* like one family.

---

## 8. What is inferred, not read

- I did not render anything. All values come from source, and colours are
  computed. `color-mix()` values are given as expressions, as the app writes them.
- Font rendering: the app asks for Inter first, but I found no `@font-face`
  for it and it is not installed on this Mac, so it renders in SF Pro.
- The flat X-ray opacity (about 6% per face) comes from a code comment in
  `folded3dStyle.ts`, not from the flat renderer's own constant.
- I did not trace exactly how Fold's folded pane draws a located fold line
  (`withFoldLine`). It is "painted with the paper", and the owner's rule says
  diagram pens.
- Letter and ring sizes for labels on the panes were not extracted.
- The Edit Properties pane summary ("3 constraints · decided") has no existing
  row to copy. It would be a FieldRow `kind="text"` in the folded figure's
  section, but I did not read that section's current layout.
