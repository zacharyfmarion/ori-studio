# Scoped CSS: CSS Modules and the convention

## Goal

A component's styles live beside it and reach nothing else, and nothing else
reaches them. Variation — a size, a stretched layout, a context's density — is
a prop the component offers, never a selector another screen writes against
its class names. Global CSS keeps only what is global by nature.

## Why

The web app's CSS is almost all global: `src/styles/theme.css` is 12,903 lines
holding ~278 BEM blocks, beside `App.css` (1,514), `WelcomeLanding.css` (901),
`CpDetectImportModal.css` (499), `MenuBar.css` (267), `sonner.css` and
`index.css`. Nothing is scoped. Any rule anywhere can restyle any component,
and does: `SegmentedControl` has one look of its own and seven context rules
that restyle it, one of them — `.simulator-view-settings .segmented__option` —
matching nothing any more and never noticed. The look the user prefers exists
only as a Settings-tab override (`implementation-plans/one-segmented-control.md`).
A primitive cannot be trusted to look like itself, and dead rules cannot be
found.

## Decision: CSS Modules

Vite supports CSS Modules natively: a `Name.module.css` file's class names are
hashed at build time and exported as an object. No dependency, no plugin, and
the typing already exists (`vite/client` is in `tsconfig.json`). The app's
design tokens are CSS custom properties, which cross module boundaries
unchanged, so theming keeps working as it does.

Considered and not chosen:

- **vanilla-extract / Linaria** (typed, zero-runtime CSS in TS): new build
  plugin and dependency, and every style rewritten in TS. Worth revisiting only
  if typed style contracts become the goal.
- **Tailwind**: a different paradigm and a rewrite of every component; nothing
  about the problem asks for utility classes.
- **Runtime CSS-in-JS** (styled-components, emotion): a runtime cost on a
  canvas-heavy app, and a new dependency.
- **Native `@scope` / cascade layers**: `@scope` limits how far a rule reaches
  but does not stop another file from reaching in, and its support in the
  desktop shell's WKWebView depends on the user's macOS. Layers order
  precedence; they do not scope. Either can complement modules later.

## The convention

1. **A component's styles are a module beside it**: `Button.tsx` +
   `Button.module.css`, imported as `import styles from './Button.module.css'`.
   Locals are camelCase (`styles.track`, `styles.option`).
2. **State and variants are data attributes on the component's own elements**
   (`data-active`, `data-size="sm"`), styled inside the module — not extra
   modifier classes, and never a selector from outside.
3. **A parent never styles a child's internals.** A parent may place a child —
   its margin, its grid cell, its width — through its own wrapper element, or
   through a `className` the child applies to its *root* only. Anything else a
   context needs is a prop on the child.
4. **Global CSS is for what is global**: design tokens (custom properties) and
   their light/dark mapping, resets and base element styles, typography, the
   app shell's layout scaffolding, and overrides of third-party markup we do not
   render (dockview, sonner). A new global rule needs one of those reasons.
5. **Tests find elements by role, accessible name or data attribute**, never by
   a module class — the class is an implementation detail and is hashed.
6. **Tokens stay global.** A new token (e.g. `--segmented-track`) is declared
   with the others in `theme.css`, in both themes.

These go into `AGENTS.md` (the "Web and Tauri" rules) and a longer
`apps/web/docs/styling.md` with examples.

## Setup

- **One class-name generator for every build**, in
  `apps/web/scripts/cssModuleNames.mjs` (`SegmentedControl__track__FnzQS`: file,
  local name, and a hash of the module's path). `vite.config.ts` and the landing
  prerender both import it, because the prerender starts Vite with
  `configFile: false` and would otherwise name every class its own way — the
  painted page would carry names the bundle does not ship. A function rather
  than Vite's `[name]__[local]__[hash]` string: that pattern hashes the path
  from the working directory, and measured, the dev server (run from the repo
  root) and a build (run from `apps/web`) gave the same class different names.
  The function hashes from `apps/web` wherever the process runs. Verified: the
  prerender's SSR path, a build, and the dev server all give the name above.
- Vitest: nothing required. Measured under the current config, a module import
  resolves to a stable hashed name (`styles.track` → `_track_1c28cb`).
  `test.css.modules.classNameStrategy: 'non-scoped'` would keep a migrated
  block's old BEM local names visible to the tests that still query them. It is
  not used: a move rewrites those queries to roles, names and data attributes
  (see "Migration" below).
- **Enforcement**, so the convention holds without review catching it:
  - ESLint `no-restricted-imports` forbids importing a non-module `.css` file
    from components; the existing global entry points (`main.tsx`, `App.tsx`,
    the five component stylesheets) are the allowlist, shrinking as they
    migrate.
  - A ratchet on the global files' line count (the idea behind the panels'
    `max-lines`): a unit test fails if `theme.css` grows past its recorded
    ceiling, and when it shrinks well below, until the ceiling is lowered to
    match — so the number only goes down and slack cannot build up. A test
    rather than a CI step, so it runs everywhere the tests do. Landed as
    `src/styles/globalStylesheets.test.ts`: every global stylesheet has a
    ceiling in code lines (comments and blanks free) with 25 lines of slack,
    and a plain stylesheet that is not on the list fails it.
  - `themeTokens.test.ts` also reads every `*.module.css`: a module's `var()`
    must name a token `theme.css` defines, or the browser drops the
    declaration without a word.

## Beside PR #412 (landing performance)

- **One job.** #412 kept every stylesheet eager on purpose and deferred "the CSS
  restructure" to a separate PR: 38 KB of the landing's 42 KB render-blocking
  stylesheet is unused there. A module's CSS ships with the chunk that imports
  it, so every block that moves into a module leaves the landing's stylesheet.
  The migration below is that restructure, carried out a block at a time, and
  the landing budget (`scripts/landing-budget.mjs`, which counts only the
  stylesheets `index.html` links) is one of its measures.
- **The first lazy CSS is safe.** A workspace-only module is the app's first
  lazily loaded CSS. The service worker's warm set already carries each lazy
  chunk's CSS (`viteMetadata.importedCss`), so an offline launch still has it,
  and Vite loads a chunk's CSS before its `import()` resolves, so nothing
  flashes unstyled.
- **The landing is last, and guarded.** Its prerendered copy is its first paint,
  the inline scripts (`seo/staticPaint*.ts`) select into it, and
  `scripts/static-paint-check.mjs` demands zero differing pixels between the copy
  and the live page. A landing module needs the pinned class names and data
  attribute hooks for those scripts, and that check proves both.
- **Merge order.** #412 moves the global stylesheet imports into `main.tsx`; the
  ESLint allowlist is reconciled when this branch merges main.

## Migration (decided 2026-10-01)

There is no migration project. The global CSS moves the way the rest of the
code improves, and how depends on who uses a block:

- **A block with one owner** moves when somebody changes that component's
  styles: the whole block into its module, as a commit of its own that changes
  nothing on screen, then their change. A scan on 2026-10-01 found 170 of
  `theme.css`'s 287 blocks (about 4,100 code lines) like this.
- **A shared block** — worn, looked up or restyled by another component —
  moves only in a PR of its own, because moving it means designing what those
  users get instead. Until then, fixes may edit its rules in place but never
  add one. The known ones are below.
- **Dead blocks** go at once, and `src/styles/liveSelectors.test.ts` keeps
  them from coming back: the same scan found 43 blocks (about 820 code lines)
  that no source file names. The styling-refinements branch deletes them.
- The rule and its checklist are in `AGENTS.md` ("Migrate what you touch") and
  `apps/web/docs/styling.md` ("Moving a block into a module").
- The landing and site pages are the exception. They still move last, under
  the guard above.

### Known shared blocks

From the 2026-10-01 scan (a class named in a string literal in two or more
source files), with generic words such as `crease` and `paper` left out. Not
exhaustive: check before you assume a block has one owner.

Moved by `implementation-plans/styling-refinements.md`: `viewport-toolbar`
(with the chrome of `symmetry-menu`, `bp-sheet-menu` and `design-layer-menu`),
`floating-toolbar`, `design-tab` / `design-tab-strip`, `cp-tool-rail`,
`context-menu` (onto the parts in `components/ui/Menu.tsx`), the chrome of
`cp-context-panel`, `viewport-status-readout`, `bp-name-editor`, `update-card`,
and the whole of `MenuBar.css`.

Moved by `implementation-plans/crease-angle-popover-tool-window-chrome.md`:
`ui-chip`, into `Chip.module.css`, with Settings → Paper's
`settings-paper__slot-action` override as `Chip`'s `size="sm"`.

Moved by `implementation-plans/simulator-tool-rail-and-pins.md`:
`cp-tool-picker`, into the tool kit's modules (`components/ui/tools/`:
`ToolPickerSheet`, `ToolPickerGroup`, `ToolPickerRow`, `ToolsTriggerButton`)
and Edit's adapters (`CpToolPickerSheet`, `CpToolFavoriteToggle`); and
`cp-tools-trigger`, out of the shared `canvas-pill` selector list. And
`control-row`, into `FieldRow.module.css`: the simulator colour groups'
last-row override is `FieldRow`'s `divider={false}`, `ColorField`'s row layout
composes `FieldRow`, its inline layout has a label of its own
(`color-field__label`, which Settings → Paper's override now names), and the
design inspector's rows are `FieldRow`s and `TextRow`s. `control-row__input`
stays global; see below.

Still shared:

- **Panel frame**: `panel-shell`, `panel-toolbar`, `panel-body`,
  `panel-title`, `empty-note` (15+ panels) — likely a `Panel` component
- **Rows and fields**: `collapsible-section`, `field-row`, `settings-section`,
  `settings-toggle-row`, `settings-checkbox`; and `control-row__input`, the row
  input look, which fields that are not rows wear too (`TextRow`, `NumberField`'s
  bare field, the preset name, the design inspector) and the View pane's scale
  formula restyles. It moves with an input primitive that has those as props.
- **Dialogs**: `simple-modal` (9 files), `export-modal` (6),
  `settings-shortcuts`, `settings-paper` (5)
- **The select trigger**: `select-trigger`. The export dialogs restyle it
  through `.export-modal__select` (padding, border, ground, radius) and place
  it from their field rows, so it stayed global when `Select`'s list and
  options moved. It moves with a `SelectTrigger` prop for that look, in the
  dialogs' own PR.
- **The CP tool card's content**: `cp-context-panel` groups and fields
  (`CpContextToolPanel` and the controls it renders, and the crease-angle
  popover, which wears the field row so it reads as the fold-angle group it
  mirrors)
- **CP workspace**: `cp-panel` (looked up by the tool card and the HUD lane),
  `cp-tool-option`, `cp-inline-simulation` and
  `cp-folded-figure-window` (with `canvasWindowPlacement`), `cp-webgl-layer`,
  `cp-operation-frame`
- **References**: `step-diagram`, `references-card`, `sheet-card`,
  `sheet-grid`
- **Design scene** (TreeScene, sceneDom, DesignPanel, BpPackingPanel):
  `tree-node`, `tree-edge`, `node-label`, `edge-label`, `symmetry-*`,
  `design-canvas`, `design-panel`, `paper-hit-area`, `paper-shadow`
- **Primitives**: `ui-button` (Button, IconButton, ErrorFallback),
  `ui-control`, `ui-split-button` (the landing's static paint names it)
- **App.css**: `error-fallback`, `workspace-rail`, `canvas-pill`,
  `file-drop-region` (the landing uses it)

## Affected Areas

- `apps/web/vite.config.ts`, `apps/web/eslint.config.js`
- `AGENTS.md`, `apps/web/docs/styling.md` (new)
- The ratchet test beside the global stylesheet
- The first module: `SegmentedControl` (see
  `implementation-plans/one-segmented-control.md`)

## Checklist

- [x] One class-name generator shared by the build and the prerender; the SSR
      path the prerender uses and the built CSS name the same class the same
      way (the landing has no module yet, so this is checked on
      `SegmentedControl`)
- [x] ESLint rule and allowlist; the global-stylesheet ratchet test; module
      tokens checked
- [x] Convention in `AGENTS.md` and `apps/web/docs/styling.md`
- [x] First module lands with it: `SegmentedControl.module.css`, its context
      overrides replaced by props (the segmented-control plan's Phase 1)
- [x] Validate (lint, typecheck, tests, `build:web` with the prerender); commit
