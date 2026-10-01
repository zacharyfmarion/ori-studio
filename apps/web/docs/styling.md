# Styling

A component's styles live beside it in a CSS module and reach nothing else, and
nothing else reaches them. Variation — a size, a stretched layout, a context's
density — is a prop the component offers, never a selector another screen
writes against its class names.

This is where the app is going, not where it is: almost all of today's CSS is
global (`src/styles/theme.css` and the stylesheets `main.tsx` imports), and it
moves into modules block by block. New and changed components follow the rules
below from the start. The decision and its background are in
`implementation-plans/scoped-css.md`.

## Why

In a global stylesheet any rule can restyle any component. The segmented
control is what that looks like: one look of its own, restyled by seven rules
in other screens' CSS — one of them matching nothing any more, which nobody
could tell — and the look people liked existed only as a Settings-tab
override. A primitive could not be trusted to look like itself.

## The rules

1. **A component's styles are a module beside it.** `Button.tsx` and
   `Button.module.css`, imported as `import styles from './Button.module.css'`.
   Its class names are hashed (`scripts/cssModuleNames.mjs`), so no other file
   can select them. Locals are camelCase: `styles.track`, `styles.option`.
2. **State and variants are data attributes** on the component's own elements
   — `data-active`, `data-size="sm"`, `data-fill` — styled inside the module
   with attribute selectors. Not modifier classes, and never a selector from
   outside.
3. **A parent never styles a child's internals.** A parent places a child — its
   margin, its grid cell, its width — through a wrapper of its own, or through a
   `className` the child puts on its *root* only. Anything else a context wants
   is a prop on the child. If the prop does not exist, add it; do not reach in.
4. **Global CSS is for what is global:** design tokens (custom properties) and
   their light and dark values, resets and base element styles, typography, the
   app shell's layout, and overrides of third-party markup we do not render
   (dockview, sonner). A new global rule needs one of those reasons.
5. **Tests find elements by role, accessible name or data attribute**, never by
   a module class. The class is an implementation detail, and under Vitest it
   resolves to a hashed name of Vitest's own, not the local one.
6. **Tokens stay global.** A module reads `var(--…)`; a token a module needs
   (`--segmented-track`) is declared with the others in `theme.css`, in both
   themes.

## What holds it

- **ESLint** (`no-restricted-imports`) rejects importing a plain `.css` file.
  The files that already did are listed in `eslint.config.js`
  (`GLOBAL_STYLESHEET_IMPORTERS`); the list only shrinks.
- **A ratchet** (`src/styles/globalStylesheets.test.ts`) fails when a global
  stylesheet grows past its recorded ceiling, and when it shrinks well below it
  until the ceiling is lowered — so the global CSS only goes down.

## A module, start to finish

`SegmentedControl` is the first component styled this way:

```tsx
import styles from './SegmentedControl.module.css';

<div className={styles.track} data-size={size} data-fill={fill || undefined}>
  <button className={styles.option} data-active={active || undefined} … />
</div>
```

```css
.track { display: inline-flex; gap: 3px; padding: 3px; background: var(--segmented-track); … }
.track[data-size='sm'] { height: 28px; }
.track[data-fill] { display: flex; width: 100%; }
.option[data-active] { background: color-mix(in srgb, var(--accent-primary) 17%, var(--bg-elevated)); }
```

The track is `width: fit-content`, so it hugs its options even inside a grid
or a flex column that would stretch it. The export dialog, which used to
stretch it with `.export-modal .segmented`, now simply lets it hug; the context
panel, which needs it stretched, passes `fill`.

## Where a module's CSS goes

A module's CSS ships with the chunk that imports it. Once the workspace loads
on demand, a component only the workspace uses has its styles load with the
workspace rather than in the landing page's render-blocking stylesheet — which
is most of what that stylesheet holds today.

The landing page is the last thing to move. It is prerendered
(`scripts/prerender-landing.mjs`), and the markup the prerender writes has to
carry the class names the client bundle ships. The prerender starts Vite
without `vite.config.ts`, so both import the names from
`scripts/cssModuleNames.mjs`, which hashes a module's path from `apps/web`:
Vite's own `[hash]` pattern hashes it from the working directory, and the dev
server (run from the repo root) and a build (run from `apps/web`) named the same
class differently. Anything that selects into the prerendered page from a
script selects a data attribute, never a class.
