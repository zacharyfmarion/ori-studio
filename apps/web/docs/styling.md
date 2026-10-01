# Styling

A component's styles live beside it in a CSS module and reach nothing else, and
nothing else reaches them. Variation — a size, a stretched layout, a context's
density — is a prop the component offers, never a selector another screen
writes against its class names.

This is where the app is going, not where it is: almost all of today's CSS is
global (`src/styles/theme.css` and the stylesheets `main.tsx` imports). There is
no migration project. It moves as the code is worked on: whoever changes a
component's styles first moves that component into a module
([Moving a block into a module](#moving-a-block-into-a-module)), and new
components start in one. The decision and its background are in
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
6. **Tokens stay global, and only tokens do.** A module reads `var(--…)`.
   - **A token** is a value that one of these must agree on:
     - components that do not know about each other (`--touch-target`, the
       spacing scale, `--workspace-header-height`: Design's tab strip, a
       panel's toolbar and the dock's tab bar meet in one line because they
       read one number)
     - third-party markup
     - a theme (`--segmented-track` differs between light and dark)

     It is declared with the others in `theme.css`, in both themes.
   - **Everything else about a component** stays in its module, as a local
     custom property if it repeats. A toolbar's padding belongs to the toolbar
     however many screens use one, and so does the radius derived from it. A
     global for it would be a selector by another name: something any file can
     reach.

## Radius

**One number: `--radius`**, the icon buttons' 8px. The rest of `theme.css`'s
scale derives from it. What a thing is decides what it wears:

- **A control: `--radius`.** Anything you type into, pick from or press, at
  any size. That covers an input, a number field and its steppers, a select,
  a button, the outer edge of a joined group, and a segmented control's track.
- **A surface: `--radius`.** A card, a notice, a table, a preview well, and
  every floating surface: menus, popovers, tooltips, toasts and readouts.
- **A detail inside a card: `--radius-sm` (4px).** A swatch strip, a
  thumbnail, a sample, a badge or an index chip. At 8px a 14px strip would
  round into a pill.
- **A pill stays a pill:** switches, chips, counters, the match-quality tags.
  Checkboxes and focus rings keep their own small radii.

**A container that hugs controls is concentric with them.** Its radius is
theirs plus its padding, so the gap around a corner control is as even as the
gap along an edge. That radius belongs to the container, so it is computed in
the container's module from its own padding, not read from a token:

```css
.bar {
  --pad: 4px;
  padding: var(--pad);
  border-radius: calc(var(--radius) + var(--pad));
}
```

**A row or a part inside a surface or a control is concentric the other way**:
the outer radius less its padding. A part that sits right against a border,
with no padding, takes the radius less the border.

- An 8px menu with 4px padding has 4px rows.
- The segmented control's 8px track with 3px padding has 5px pills.
- The square tool's 8px anchor picker with 2px padding has 6px cells.
- A colour field's swatch, inside its 1px border, is 7px.

## Menus

Every menu draws its rows one way: inset in its surface, rounded, and filled
solid under the pointer or the keyboard.

**Build a new menu from `components/ui/Menu.tsx`, and a value picker from
`Select.tsx`.** Both are Radix underneath, so focus, roving, type-ahead and
dismissal come with them. Two menus are hand-built and draw the same rows
through their own modules: the menu bar, whose phone layout expands submenus in
place and whose menus switch on hover, and the paper dash menu, whose custom
field Radix's type-ahead would swallow (`PaperDashMenu.tsx` has the detail).

- **Surface**: `--bg-elevated`, a 1px `--border-default` border, `--radius`,
  4px padding, and a short shadow.
- **Row**: 28px tall (`--touch-target` on a coarse pointer), padding `5px 8px`,
  `--radius-sm` (the surface's radius less its padding), 12px text. A shortcut
  is 11px `--text-secondary`. A separator is inset 6px either side.
- **Highlight**: a `--menu-highlight` fill with `--menu-highlight-text` on it,
  for the pointer and the keyboard alike. Everything in the row takes the
  text's colour: icon, check, shortcut, chevron. A submenu's trigger stays lit
  while its submenu is open. A disabled row never highlights.
- **A destructive row** (`data-danger`) fills `--status-danger` with
  `--text-on-danger` on it.
- **The current value** is a check in the row's leading slot, never a tint. The
  fill follows the pointer, so it cannot also say which row is current.
- **Width**: a menu of commands is at least 180px. A short list of values is
  at least as wide as its trigger, as a select list is (`MenuContent`'s
  `fitTrigger`).

**Text on a solid fill is a derived token.** `themes/applyTheme.ts` sets
`--text-on-accent` and `--text-on-danger` per theme (`themes/textOnFill.ts`):
the theme's ground where it reads at 4.5:1 on the fill, otherwise black or
white, whichever reads better. `textOnFill.test.ts` holds every preset to it.
`--text-inverse` is not the same thing. It is the inverse of the ground, white
in a dark theme, and on a dark theme's light accent it falls below 4.5:1 in 22
of the 23 presets.

The primary and danger buttons still set `--text-inverse` on the accent and on
danger: 2.36:1 and 3.2:1 in One Dark. Moving them to these tokens changes every
button in the app, so it is a decision of its own, not made yet.

## What holds it

- **ESLint** (`no-restricted-imports`) rejects importing a plain `.css` file.
  The files that already did are listed in `eslint.config.js`
  (`GLOBAL_STYLESHEET_IMPORTERS`); the list only shrinks.
- **A ratchet** (`src/styles/globalStylesheets.test.ts`) fails when a global
  stylesheet grows past its recorded ceiling, and when it shrinks well below it
  until the ceiling is lowered — so the global CSS only goes down.
- **A dead-selector test** (`src/styles/liveSelectors.test.ts`) fails when a
  global stylesheet styles a class that no source file names. That is what a
  rule left behind by a move looks like: once its class is hashed it matches
  nothing, and nothing else would say so.
- Nothing enforces the move itself. That is `AGENTS.md`'s "Migrate what you
  touch", and review.

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

## Moving a block into a module

A component's **block** is every selector for its classes, wherever it is. When
it moves depends on who uses it:

- **One owner**: only that component (and its own tests) names the classes. The
  block moves when somebody changes the component's styles — adding, editing or
  deleting a rule that styles it, or giving its markup a class to be styled —
  as a commit of its own, made before the change, after which nothing on screen
  differs.
- **Shared**: another component wears the classes, looks elements up by them,
  or restyles them. Moving it means designing what those users get instead, so
  it moves in a PR of its own, never inside an unrelated fix. The known ones are
  listed in `implementation-plans/scoped-css.md`. Until then a fix may edit
  their rules in place, but never add one.

Either way, the steps are the same:

1. **Collect the whole block.** That is every selector for the component's
   classes, wherever it is:
   - its own rules and its media queries
   - its copies in the coarse-pointer blocks at the end of `theme.css`
   - every other screen's rule that restyles it, which becomes a prop
     (rule 3)
2. **Find what leans on the class names.** Grep `src/` and `scripts/` for each
   one; a stale class name matches nothing, and nothing says so. TypeScript and
   ESLint cannot see these:
   - A `querySelector` or `closest` by class becomes a data attribute.
   - A test query becomes a role, an accessible name or a data attribute
     (rule 5).
   - Another component wearing the class for its look wears a component
     instead. A look several components share goes in `components/ui/`, so
     look there first. Never import another component's module.
3. **Move it.** Locals are camelCase, and state and variants are data
   attributes (rules 1–2). Delete every global rule you collected: a rule left
   behind is dead the moment the class is hashed, and the dead-selector test
   fails on it. No `:global(...)`, except for
   third-party markup the component renders.
4. **Do not lean on precedence.** A module's CSS loads with the chunk that
   imports it.
   - The modules in the lazily loaded workspace come after `theme.css`.
   - `main.tsx` imports the router before `theme.css`, so a module in the
     entry chunk can come before it.
   - A tie between a module rule and a global one can therefore go either way.
     This is why the overrides and coarse-pointer copies move with the block
     rather than staying behind to win by source order.
5. **Prove nothing changed.** In the browser, snapshot the computed styles of
   the component's elements before the move and compare after it. Do it in
   both themes and, if the component has touch rules, under a coarse pointer:

   ```js
   // In the console, with `root` the component's root element.
   const snap = (root) =>
     [...root.querySelectorAll('*')].map((el) => {
       const s = getComputedStyle(el);
       return [el.tagName, s.display, s.width, s.height, s.padding, s.margin,
         s.border, s.borderRadius, s.background, s.color, s.font].join('|');
     });
   ```

6. **Lower the ratchet** in `src/styles/globalStylesheets.test.ts` to the count
   the move leaves. A ceiling is one number per stylesheet, so moves made in
   parallel conflict there; take the merged count.

**A hotfix** may leave a move for later, saying so in the PR.

**Not by this route:**

- Tokens, resets, the app shell and third-party overrides are global by nature
  (rule 4).
- The landing and site pages move under the landing step of
  `implementation-plans/scoped-css.md`, because their prerendered copy must
  match the live page pixel for pixel (see below).

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
