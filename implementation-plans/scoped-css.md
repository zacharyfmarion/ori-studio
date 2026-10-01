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
  resolves to a stable hashed name (`styles.track` → `_track_1c28cb`). For the
  migration, `test.css.modules.classNameStrategy: 'non-scoped'` would keep a
  migrated block's old BEM local names visible to the tests that still query
  them — a crutch the migration plan decides whether to use.
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
  it, so every block that moves into a module leaves the landing's stylesheet —
  the migration plan is that restructure, and the landing budget
  (`scripts/landing-budget.mjs`, which counts only the stylesheets `index.html`
  links) is one of its measures.
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
