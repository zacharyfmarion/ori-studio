# Phone / Tablet / PWA Follow-ups

## Goal

Five defects and gaps found by using the shipped phone/tablet/PWA work on a real
iPhone 16 Pro Max and an iPad. They are independent — each phase below stands
alone and can land on its own — but they share one theme: the touch layer got the
*controls* right and has not yet been checked against the *device*, so what is
left is the class of problem only a home-screen launch surfaces.

Ordered by confidence, not by size. Phases 4 and 5 have root causes confirmed by
reading the code; phase 3 has a confirmed structural fact plus a number that has
to be measured before the work is scoped.

## Approach

Everything here is frontend, and every phase extends a pattern the touch pass
already established rather than inventing one:

- The **pill lane** over the canvas's top-right corner (`.view-drawer-anchor__row`,
  `WorkspaceViewDrawer`, `CpToolsTrigger`) is the app's answer to "a control that
  has nowhere to dock on touch". Phases 1 and 2 both put their new affordance
  there instead of spending another band of vertical space.
- The **`useIsPhoneLayout` / `useIsCoarsePointerSurface` split** decides which
  device gets what: coarse pointer = tablet *and* phone (phase 1), phone layout =
  phone only (phase 2).
- The **service worker's stated invariants** (`pwa/sw.ts`) are the frame for
  phase 5. Its "nothing is precached" decision is measured and correct; the gap
  is that its one exception — warming the `new Worker()` scripts — does not cover
  the engine `.wasm` those workers load.

---

## Phase 1 — Undo / Redo on touch

**What is missing.** In the Edit workspace on a coarse pointer the canvas has two
pills in its top-right lane: `Tools` (phone only) and `View`. There is no undo.
The only route to it is the Edit menu, which on a phone is a truncated trigger in
a scrolling toolbar — three taps for the single most-used verb in a drawing app.

**Where it goes.** `WorkspaceViewDrawer` already renders the lane and takes a
`leading` slot precisely so more than one pill can share the row without anyone
computing View's rendered width (it changes with the locale). `WorkspaceShell`
passes `leading={<CpToolsTrigger />}`; this adds a second entry ahead of it.

- New `components/CpHistoryPills.tsx` + `hooks/useCpHistoryPills.ts`, modelled on
  `WorkspaceViewDrawer` / `useWorkspaceViewDrawer`: the hook answers *should this
  exist* and *is each side enabled*, the component renders two `IconButton`s.
- Gate on `useIsCoarsePointerSurface()` **and** `activeWorkspace === 'edit'` —
  coarse rather than phone, because the user's ask is explicitly that a tablet
  gets these even though it keeps its tool rail and so has no Tools pill.
- Enabled state comes from `useWorkspaceCapabilities()['edit.undo' | 'edit.redo']`,
  which already resolves per active editing context
  (`workspaceCapabilities.ts:374`, `capabilities.ts` `historyCountForContext`).
  Do not read the CP history stacks directly — that would answer wrongly the
  moment the active context is not the crease pattern.
- Dispatch through `handleMenuAction('edit.undo' | 'edit.redo')`, which is the
  analytics chokepoint (`commands/menuActions.ts`) — so **no hand-placed `track`
  call**, per `docs/analytics.md`.
- Icon-only buttons need a touch-reachable label: use `useTouchLabel`
  (`components/ui/useTouchLabel.ts`), the same hook the rest of the touch layer
  uses, rather than a hover `title` a finger can never see.

**One coupling to state in the PR.** The lane only mounts when the workspace has
a View pane (`viewPanelFor`), so these pills inherit that condition. In Edit it is
unconditional, so today it costs nothing; if Edit ever loses its View pane the
undo pills go with it. The alternative — promoting the lane to a shell-owned
component that any workspace can contribute pills to — is the right shape if
phase 2 also wants the lane (it does), so **do phase 2's lane generalization
first and mount these into it**.

## Phase 2 — One design pane at a time, on phones

**The problem.** A design's panes are a nested Dockview split
(`DesignPaneLayout`): box-pleat is tree + BP editor side by side, ExplOri is tree
+ results, TreeMaker is the tree canvas plus a tabbed Inspector/Diagnostics/
Conditions column. On a 440pt phone that is ~220pt per pane, which is not a
design surface. Tablets are fine and must not change.

**Shape.** Under `useIsPhoneLayout()`, `DesignPaneLayout` does not mount Dockview
at all. It renders **one pane**, plus a pill in the canvas lane that names the
current pane and opens a sheet listing the rest — the `CpToolsTrigger` pattern,
verbatim: a trigger whose label is the current state, a portalled sheet, Escape
via `isShortcutEditingTarget`, dismissal on `click` not `pointerdown` (see the
comment in `WorkspaceViewDrawer` for why that one is load-bearing).

A pill and not a segmented control, and not a new row:

- TreeMaker has **four** panes. A segmented control does not fit four segments on
  a phone; a sheet does, and it is the same control for two panes and for four.
- A row of its own would cost another ~44pt of the vertical budget phase 3 is
  trying to reclaim. The lane costs zero.

**Three things the phone path must not break:**

1. **It must never write a pane layout into the document.** `DesignPaneLayout`
   persists its arrangement to `tab.paneLayout`, which travels in the `.osf` — a
   pane-less layout written on a phone would reach the author's desktop and other
   users. This is the same reasoning `reconcileViewPanel` gives for leaving the
   Design workspace out of the View-drawer treatment. So the phone branch does
   not call `setDesignPaneLayout` at all, and leaves whatever layout the file
   carried untouched.
2. **`activatePanel(id)` has to keep working.** `layoutStore.activatePanel` looks
   the id up in `dockviewApi` then `designPaneApi`; with no Dockview mounted the
   second is null and `useBpLongPressInspector`'s `activatePanel('inspector')`
   silently does nothing. Add a third fallback: a registered pane-selector
   callback, set by the phone branch the same way `setDesignPaneApi` is set by
   the Dockview branch.
3. **`setActivePanelId` has to follow the switch.** It is what drives
   `activeEditingContext`, and therefore the menus, the history stacks and the
   shortcut scope. A switch that does not report itself leaves the Edit menu
   operating on the pane the user just left.

**ExplOri gets the extra behaviour the ask names.** Search, then results, with a
way back:

- `runExploriQuery` (`slices/exploriSlice.ts:415`) activates `explori-results` on
  a successful query. Calling `activatePanel` from a slice is established here —
  `oristudioBpSlice.ts:817` and `creasePatternSlice.ts` both do it. Check what it
  does on a *desktop* first: it will focus the already-visible results pane and
  move `activeEditingContext` to `explori-results`. If that changes any menu the
  user was mid-way through, gate the call on `isPhoneLayout()` rather than
  shipping a desktop behaviour change nobody asked for.
- On a phone the results pane gets a leading `‹ Search` button in its header that
  switches back. The pill can already do it; this is the affordance the ask
  describes, and it costs one button.

**Instrumentation.** One new event, `design pane switched`, with a `pane` enum
property — the pane's declared `id` (`tree` / `packing` / `results` / `inspector`
/ …), never a title. Follows `viewDrawerOpened` / `cpToolPickerOpened`, which are
the two events this control is modelled on.

### Two corrections from using it

- **The visible pane needed its own state.** It was first derived from
  `activePanelId`, which is a *cache of what Dockview owns* — and
  `activateWorkspace` re-reports it on every call, including the no-op path
  `activatePanel` takes on the way to a design pane. The Design workspace's one
  dock panel is `design-workspace`, which no workspace claims in
  `WORKSPACE_BY_PANEL_ID`, so that reconcile answered `primaryPanelIdFor(
  'design')`. On a desktop the design dock corrects it a moment later; with no
  dock it stuck, and selecting a flap in the BP editor — which activates a panel
  to move dock focus — threw the user back to the tree editor. It is
  `layoutStore.designPaneId` now, which only the switcher and a validated
  `activatePanel` touch, and `activePanelId()` consults it before falling back.
- **ExplOri declines the pill.** Its two panes are a flow, not a split: Search
  takes you to the results and Back brings you home, both inside the panes, so a
  floating control in the corner was a third affordance for the same move. The
  kind says so with `phonePaneSwitcher: false`, which makes the back button the
  only way home — so it renders in every non-detail state, not just over the
  grid.

**Out of scope:** the tablet layout, and the `.osf` pane-layout format.

## Phase 3 — The vertical budget on a phone

**What is confirmed, by reading the stylesheet.** The phone Design workspace
spends these bands, top to bottom:

| Band | Cost | Where |
| --- | --- | --- |
| `--safe-top` | ~62pt on a 16 Pro Max | `.app-layout` padding (`App.css:23`) |
| Toolbar | 36pt min, ~45pt on touch | `.toolbar` (`App.css:596`) + the coarse-pointer `--touch-target` clamp |
| Design tab strip | 32pt min | `.design-tab-strip` (`theme.css:2987`) |
| *canvas* | | |
| Attribution footer | 23pt | `.design-attribution` (`theme.css:5422`) |
| Workspace rail | 44pt | `.workspace-rail__button` min-height (`App.css:1266`) |
| `--safe-bottom` | 34pt | `.workspace-rail` padding, painted rail background (`App.css:1242`) |

That is ~240pt of 956 — a quarter of the screen — before the design gets any.

**The bottom, specifically.** The rail already *paints* through the home-indicator
inset (padding + a negative margin that hands the space back), so it reads as a
tab bar rather than a floating strip. But the inset holds nothing: the buttons
occupy the 44pt above it, so the bar costs 78pt to present a 44pt control. That
is what "the bottom safe area is not used at all" describes, and it is also what
a native iOS tab bar does (49 + 34) — so the honest levers are small:

- Let the inset count toward the target: move it from `.workspace-rail`'s padding
  onto `.workspace-rail__button`, so the button's box and hit area cover the
  inset and the visible icon/caption block can shrink below 44pt while the
  *target* stays at or above it. Worth ~8–10pt and makes the bottom strip
  tappable, which today it is not.
- Drop the captions under the icons on the narrowest phones (~12pt).

**Measured, and the "~60pt more" reading of the screenshot was wrong.** Taken in
a real engine at 375×812 with a coarse pointer and the 16 Pro Max insets stood
up (`--safe-top: 62px`, `--safe-bottom: 34px`), the Design workspace was:

| Band | height | note |
| --- | --- | --- |
| `--safe-top` | 62 | status bar; not reclaimable |
| Toolbar | **55** | for a 44pt row — 10pt of leftover padding |
| Design tab strip | 45 | |
| *the design* | **549** | 68% of the screen |
| Attribution footer | 22 | one line of prose, nothing interactive |
| Tab bar buttons | 44 | |
| `--safe-bottom` | 34 | painted rail background, **inert** |

Chrome is 262 of 812 — a third of the screen, but there is no unexplained gap:
the rail's border box ends exactly at 812 and the 34pt below the buttons is the
home-indicator inset, painted with the bar's own background. So this is the
budget question, not a bug.

What landed, and why the bottom is the smallest of the three:

- **Toolbar, −10pt.** `@media (max-width: 680px)` pads 5px top and bottom, which
  was right while that width also stacked the toolbar into two rows. The phone
  block puts it back on one row whose contents are already `--touch-target`
  tall, so the padding was 10px of nothing.
- **Attribution footer, −22pt, phone only.** Box Pleating Studio is MIT, and MIT
  asks for the notice to travel with the software rather than to be on screen:
  `NOTICE` carries it and the Help dialog credits Mu-Tsun Tsai by name with a
  link. A tablet keeps the band.
- **The bottom inset now belongs to the buttons.** This saves nothing and is
  still the item the report named: 34pt at the very bottom edge — where a thumb
  rests — looked like part of the tab bar and answered no taps, because the inset
  was padding on the rail rather than on the tabs. It is inside the button box
  now, so the strip is tappable, which is what a native tab bar does. Verified:
  a tap 12px above the bottom edge answers "Edit workspace".

Together the Design canvas went **549 → 581pt (+5.8%)**, and Edit's gained the
toolbar's 10.

Original measurement plan, kept because it is what a repeat would need:

- Launch standalone (Add to Home Screen) on a 16 Pro Max — or the 17 Pro Max
  simulator, which is the same 440×956pt class — and read back
  `getComputedStyle(document.documentElement)` for the four `--safe-*` values,
  `innerHeight`, `visualViewport.height`, and each band's
  `getBoundingClientRect()`. Standalone matters: in Safari the top inset is 0 in
  portrait because the browser chrome sits above the page, so the browser will not
  reproduce it.
- If the bottom gap is ~34pt, the levers above are the whole phase and it is
  small. If it is ~90pt, find what is spending the extra before touching any of
  them.

**Still on the table, and deliberately not taken.** Merging the design tab strip
into the toolbar row when a phone shows one tab (−45pt), and auto-hiding the
toolbar while the canvas is being manipulated (−45pt, by far the most work and
the most risk). Dropping the tab captions would buy ~12pt at the cost of the
labels; the bar is otherwise already tighter than a native one (44 + 34 against
iOS's 49 + 34), so there is very little left at the bottom.

Reclaiming `--safe-top` by painting the toolbar through it is **not** a space win
— the status bar still has to stay legible — but it does make the top band read
as chrome rather than a letterbox. Treat it as polish, not as budget.

## Phase 4 — The Settings dialog is unclosable in a standalone PWA

**Root cause, confirmed in the stylesheet.** Three rules compose into it:

1. `.settings-modal` is `position: fixed; inset: 0`, so it is outside
   `.app-layout`'s safe-area padding and insets itself —
   `padding: max(var(--space-4), var(--safe-top)) …` (`theme.css:1223`). The
   comment there says exactly why.
2. `@media (max-width: 620px)` then **overwrites that whole shorthand** with
   `padding: var(--space-2)` and sets `place-items: stretch`
   (`theme.css:2668-2671`), and gives `.settings-modal__document`
   `width: 100%; height: 100%` (`theme.css:2696-2701`). The insets are gone.
3. The phone block moves the header out of flow —
   `.settings-modal__header { position: absolute; top: 0; right: 0 }`
   (`theme.css:9844`) — so Close sits 8px from the top of the *screen*.

On a 16 Pro Max in standalone the top inset is ~62pt, so Close is entirely under
the status bar. In Safari it is reachable because the top inset is 0 in portrait
— which is exactly why the report says "when downloaded as a PWA".

**Fix.** Restore the insets in the 620px block:
`padding: max(var(--space-2), var(--safe-top)) max(var(--space-2), var(--safe-right)) max(var(--space-2), var(--safe-bottom)) max(var(--space-2), var(--safe-left))`.
Nothing else needs to move — the document stretches inside the padding box, so
its top edge lands below the status bar and the absolutely-positioned Close
lands with it.

**Then check the other three fixed overlays for the same shape**, because this is
a bug class and not an instance: `.simple-modal` (`theme.css:1341`),
`.help-modal`, and `.export-modal` all carry the same `max()` padding at full
width; grep the narrow-width blocks for any that re-declare `padding` on a
`position: fixed` overlay. A regression test is cheap and worth it: assert that
no rule inside a `max-width` block sets a bare `padding` on `.settings-modal` —
`styles/themeTokens.test.ts` already reads the stylesheet as text, so there is a
place for it.

## Phase 5 — Creating a box-pleat design offline errors, then hangs

**Three separate defects, all confirmed by reading.** The reported sequence
(install → open Edit → force quit → airplane mode → relaunch) is exactly the case
they compose into.

**(a) The BP kernel is not in the cache.** `pwa/sw.ts` deliberately precaches
nothing (invariant 3, measured: an install-time precache re-downloaded 5.83 MB in
WebKit and bought nothing). Everything is cached by the first *controlled* load —
"for free, from responses the page was fetching anyway" — with one exception, the
`new Worker()` scripts, which are warmed because WebKit answers those without a
`fetch` event (invariant 4).

That exception covers the worker **scripts** and not the `.wasm` each worker
loads. `initEngine` runs at boot (`App.tsx:74`) and pulls the CP and TreeMaker
bridges, so those two land in the cache on any session that reached a workspace —
which is why Edit works offline. The box-pleat kernel
(`/assets/oristudio_bp_wasm_bg-*.wasm`, ~1.84 MB) is fetched only when a BP
document is first created, from inside the worker. A session that never made one
never cached it, and offline `routeRequest` → `immutable` → `cacheFirst` → miss →
`fetch` → throw.

**(b) The chooser hangs because the failure never throws.**
`DesignMethodChooser.chooseMethod` (`DesignMethodChooser.tsx:35-40`) is:

```ts
setPending(target);
void chooseDesignMethod(target).catch(() => setPending(null));
```

with the comment "on failure the chooser is still here and has to become usable
again". But `createOristudioBpProject` catches its own error, sets
`oristudioBpError`, and **returns `false`** (`oristudioBpSlice.ts`), and
`chooseDesignMethod` discards that boolean (`projectSlice.ts:3362`). So the
promise resolves, `.catch` never fires, `pending` is never cleared, and every card
stays disabled with the box-pleat card spinning. That is the hang.

**(c) There is no recovery even after the network comes back.**
`oristudioBpWorker.ts:74` is `ready ??= init().then(…)` — a rejected promise is
memoized for the worker's lifetime, so every later call fails identically until
the worker is replaced. `resetEngine('oristudio-bp')` already exists and does
exactly that.

**Fix, in that order — (b) and (c) first, because they are small and they turn a
hang into an honest failure regardless of what the caching decision turns out to
be.**

- Make the failure observable to the caller. Either `chooseDesignMethod` returns
  the creator's boolean and the chooser clears `pending` on `false`, or the
  creators rethrow after setting their error state. Prefer the boolean: rethrowing
  changes the contract of three creators for the benefit of one caller.
- Surface it where the user is looking. A failed design creation should leave the
  chooser usable with the reason on it (`oristudioBpError`), not a toast that has
  already gone.
- Give it a retry that can succeed: the retry path calls
  `resetEngine('oristudio-bp')` before trying again, so (c) cannot pin the
  failure. Also fix `DesignPanel.tsx:429-449`, which on a BP error falls through
  to `TreeMakerDesignPanel` — a box-pleat tab rendering the *tree* editor is a
  worse answer than an error state.
- Detect the specific case and say so: offline plus a cache miss is not "the
  engine is broken", it is "this part has not been downloaded yet". `navigator.onLine`
  is enough to distinguish them for a message.

**Then the caching decision, which is a real trade and should be made
deliberately.** The engine `.wasm` set is ~5.2 MB (CP 2.14 + BP 1.84 + TreeMaker
1.21). Options:

1. **Extend the warm to the engine wasm.** Add a `kernels` list to
   `ServiceWorkerManifest` beside `workers` (the build already enumerates every
   `/assets/` output in `serviceWorkerManifest`), fetched sequentially on a
   navigation this worker serves — the same trigger, for the same reason. Cost:
   the BP kernel is 1.84 MB on the second load, on top of the 187 KB the worker
   warm already costs. Measure it the way invariant 4 was measured — warm on
   against warm off, counting bytes the server actually received — rather than
   asserting it.
2. **Warm on idle instead of on navigation**, via `requestIdleCallback` from the
   page, so it never competes with a load.
3. **Make it explicit**: a "Make available offline" control in Settings. Honest,
   but it puts a decision on the user that they have no way to evaluate.

Option 1 for BP only is the smallest change that fixes the reported case; option
2 is the one that scales if more kernels arrive. Do not precache on `install` —
that is the path invariant 3 already measured and rejected.

**The regression test already has a home.** `scripts/webkit-pwa-check.mjs` runs
22 checks in CI and its offline-start check runs in a page that has never loaded
the app. Add: launch offline in a fresh page, open the Design workspace, choose
box-pleat, and assert a document exists (or, if the caching decision is option 3,
assert an actionable error rather than a spinner). The check's own header
documents why the fresh-page requirement is load-bearing.

## Affected Areas

- `apps/web/src/components/WorkspaceViewDrawer.tsx`, `hooks/useWorkspaceViewDrawer.ts`
  — generalizing the pill lane (phases 1, 2)
- `apps/web/src/components/CpHistoryPills.tsx`, `hooks/useCpHistoryPills.ts` — new
  (phase 1)
- `apps/web/src/components/panels/DesignPaneLayout.tsx`, a new
  `DesignPaneSwitcher` + hook, `store/layoutStore.ts` (`activatePanel` fallback)
  (phase 2)
- `apps/web/src/store/workspaceStore/slices/exploriSlice.ts` — results focus after
  a query (phase 2)
- `apps/web/src/App.css`, `apps/web/src/styles/theme.css` — the phone bands and
  the modal inset regression (phases 3, 4)
- `apps/web/src/pwa/sw.ts`, `pwa/swRoutes.ts`, `apps/web/vite.config.ts` — the
  kernel warm (phase 5)
- `apps/web/src/components/panels/DesignMethodChooser.tsx`,
  `store/workspaceStore/slices/projectSlice.ts`,
  `store/workspaceStore/slices/oristudioBpSlice.ts`,
  `components/panels/DesignPanel.tsx` — failure handling (phase 5)
- `apps/web/src/analytics/events.ts` — one new event (phase 2)
- `apps/web/public/locales/*` — new strings, all eight locales
- `scripts/webkit-pwa-check.mjs` — the offline design-creation check (phase 5)

## Validation

Per phase, the smallest set that covers it:

- All phases: `npm run lint:web`, `npm run typecheck:web`, `npm run test:web`.
- Any phase adding a user-facing string: `npm run i18n:extract`, translate all
  eight locales, `npm run i18n:stamp`, `npm run i18n:check`.
- Phase 3 and 4: a standalone (home-screen) launch on a 440×956pt device. Safari
  cannot stand in for it — the top inset is 0 there, which is the whole bug in
  phase 4.
- Phase 5: `npm run build:web` (the service worker is emitted at build time, so
  nothing below a full build exercises it) and `npm run test:web:webkit-pwa`.

## Checklist

### Phase 1 — Undo / redo on touch

- [ ] Generalize the pill lane so a workspace can contribute more than the View
      and Tools pills
- [ ] `useCpHistoryPills` — coarse pointer + Edit workspace, enabled from
      `edit.undo` / `edit.redo` capabilities
- [ ] `CpHistoryPills` rendering two `IconButton`s with `useTouchLabel`, ahead of
      Tools in the lane
- [ ] Dispatch via `handleMenuAction`; confirm no second analytics event is added
- [ ] Tests: gating (phone, tablet, mouse), disabled state at each end of the
      stack, dispatch

### Phase 2 — One design pane at a time, on phones

- [ ] `DesignPaneSwitcher` + hook, on the `CpToolsTrigger` pattern
- [ ] `DesignPaneLayout` renders a single pane under `useIsPhoneLayout()` and
      mounts no Dockview
- [ ] The phone branch never calls `setDesignPaneLayout` — assert it in a test,
      because the failure travels in the `.osf`
- [ ] `layoutStore.activatePanel` falls back to a registered pane selector
- [ ] Switching reports `setActivePanelId`, so the editing context follows
- [ ] ExplOri: focus results on a successful query; `‹ Search` back button in the
      results header on a phone
- [ ] `design pane switched` event with a `pane` enum
- [ ] Tests: each kind's pane list (2, 2 and 4 panes), the `.osf` non-write, the
      ExplOri advance, tablet unchanged

### Phase 3 — Vertical budget

- [x] **Measure first** — done in a real engine at 375x812 with the 16 Pro Max
      insets stood up. No unexplained gap: it is a budget question, not a bug
- [x] Move `--safe-bottom` from the rail onto the rail buttons, so the inset is
      part of the touch target
- [x] Drop the attribution band on phones — MIT is satisfied by `NOTICE` and the
      Help dialog, and a tablet keeps it
- [x] Remove the toolbar's leftover two-row padding
- [ ] Decide on merging the design tab strip into the toolbar row (−45pt)
- [ ] Decide on auto-hiding the toolbar during canvas manipulation (−45pt)

### Phase 4 — Settings dialog inset

- [ ] Restore the safe-area `max()` padding in `@media (max-width: 620px)`
- [ ] Audit the other fixed overlays for a re-declared `padding` in a narrow block
- [ ] Stylesheet regression test for the bug class
- [ ] Verify on a standalone launch, not in Safari

### Phase 5 — Offline design creation

- [ ] `chooseDesignMethod` propagates the creator's result; the chooser clears
      `pending` and shows the reason on failure
- [ ] Retry path resets the engine first, so the memoized `init()` rejection
      cannot pin the failure
- [ ] `DesignPanel` stops falling through to the tree editor on a box-pleat error
- [ ] Distinguish offline-and-uncached from a broken engine in the message
- [ ] Decide and implement the caching option; measure warm-on against warm-off
      in bytes the server received, the way invariant 4 was measured
- [ ] `webkit-pwa-check.mjs`: offline, fresh page, create a box-pleat design
