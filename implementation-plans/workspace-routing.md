# Workspace routing — URL routes for each workspace

## Goal

Give every workspace a real URL so navigation is bookmarkable, back/forward
works, and deep links land in the right place:

```
/                      → redirect to /welcome
/welcome               → StartScreen (engine-loading gate lives here)
/design                → Design workspace, method chooser (NUX) — "design welcome"
/design/treemaker      → Design workspace, Circle-packed (TreeMaker) variant
/design/bp             → Design workspace, Box-pleated variant
/edit                  → Edit workspace (crease-pattern canvas)
/simulate              → Simulate workspace
```

The **URL becomes the source of truth** for which workspace is active and
whether we've left the welcome screen. Deep-linked workspaces **auto-provision**
a sensible empty document instead of bouncing the user back to `/welcome`.

`/share` is explicitly **out of scope** (spiked separately — an inline `?cp=`
encoding is feasible for small CPs, with a server-stored `/s/:id` fallback for
large ones; punted for now).

## Current state (what we're replacing)

There is **no router and no URL state**. Navigation is two pieces of in-memory
state:

| Concept | Lives in | Values | Drives |
|---|---|---|---|
| `workspaceStarted` | `App.tsx` `useState` | bool | StartScreen vs. the Dockview shell |
| `activeWorkspace` | `layoutStore` | `design`/`edit`/`simulate` | Which Dockview layout mounts |
| `pendingDesignChoice` + `workflowTarget` | `workspaceStore` | nux / `treemaker` / `box-pleat` | Design layout **variant** + which design doc exists |

Switching runs `handleMenuAction('view.edit')` → `layout.activatePanel('crease-pattern')`
→ `activateWorkspace('edit')` ([layoutStore.ts:199](../apps/web/src/store/layoutStore.ts)),
which **saves the current layout, `dockviewApi.clear()`s, and rebuilds from JSON**
— destructive and non-idempotent, guarded only by `workspace === activeWorkspace`.

The Design layout **variant** is derived, not stored as a route
([store.ts:31](../apps/web/src/store/workspaceStore/store.ts)):

```
pendingDesignChoice === true            → 'nux'      (method chooser)
workflowTarget === 'box-pleat'          → 'box-pleat'
otherwise                               → 'treemaker'
```

Provisioning entry points already exist and are exactly what routes will call:
- `createNewCreasePattern()` — blank CP, opens Edit ([projectSlice.ts:1296](../apps/web/src/store/workspaceStore/slices/projectSlice.ts)).
- `startNewDesign()` — sets `pendingDesignChoice`, enters Design NUX ([projectSlice.ts:1936](../apps/web/src/store/workspaceStore/slices/projectSlice.ts)).
- `chooseDesignMethod('treemaker' | 'box-pleat')` — establishes a design surface, `preserveEditCanvas` ([projectSlice.ts:1944](../apps/web/src/store/workspaceStore/slices/projectSlice.ts)).

## Constraints that shape the design

1. **Dual runtime.** Same bundle runs on **web** (browser, real address bar) and
   **desktop** (Tauri v2, served over the `tauri://localhost` custom protocol —
   [tauri.conf.json:16](../apps/tauri/src-tauri/tauri.conf.json); no server, no
   URL rewrite). A hard `GET /edit` in Tauri hits a missing asset → blank page.
2. **Cross-origin isolation.** COOP/COEP headers are required
   ([vite.config.ts:4](../apps/web/vite.config.ts)) for wasm threads. Any web
   host rewrite of unknown paths → `index.html` must preserve these headers.
3. **Base path.** The app may be served under a sub-path;
   `import.meta.env.BASE_URL` is already used ([StartScreen.tsx:5](../apps/web/src/components/StartScreen.tsx)).
   The router `basename` must honor it.
4. **Engine gate.** Provisioning (`createNewCreasePattern`, `chooseDesignMethod`)
   needs the wasm engine ready. A cold deep link to `/edit` must wait for
   `engineReady` before provisioning.

## Resolved decisions (from the author)

1. **Auto-provision deep-linked workspaces** (don't bounce to `/welcome`).
2. **Design subroutes:** `/design/treemaker` and `/design/bp`; **`/design`
   lands on the method-chooser (NUX) "design welcome" state.**
3. **`/share` is punted.**

## Router choice: react-router, history impl per surface

Add `react-router-dom`. Choose the history implementation by runtime surface at
the app root:

- **Web** → `createBrowserRouter` with `basename: import.meta.env.BASE_URL`.
  Clean paths; the only cost is one SPA-fallback rewrite rule on the host (below).
- **Desktop (Tauri)** → `createMemoryRouter`. Routing is purely in-memory — no
  address bar to serve, nothing shareable by URL, so this sidesteps the
  custom-protocol 404 with **zero Tauri config**. Menus/shortcuts still
  `navigate()`; they just don't touch a real URL.

Surface is already detectable via `getRuntimeSurface()`
([runtime.ts](../apps/web/src/platform/runtime.ts)).

**Why not HashRouter:** it works everywhere with no host config, but bakes
`/#/…` into every URL, which is uglier for the eventual `/share`. Per-surface
routing gives clean web URLs where they matter and no protocol headaches on
desktop. **Why not hand-rolled:** we need bidirectional URL↔state sync,
back/forward, and (later) query parsing — the loop-prone parts react-router
already solves. It's ~15KB; the app is otherwise dependency-light.

## Route → state mapping (the core of the change)

A single **route effect** is the *only* place that drives workspace/variant
state. Everything else (`navigate`) just changes the URL.

| Route | Workspace | Variant / provisioning if resource absent |
|---|---|---|
| `/welcome` | — (StartScreen) | none |
| `/design` | design | `pendingDesignChoice = true` (NUX chooser) — `startNewDesign()` |
| `/design/treemaker` | design | ensure a TreeMaker design exists → `chooseDesignMethod('treemaker')` |
| `/design/bp` | design | ensure a BP design exists (`oristudioBpDocument`) → `chooseDesignMethod('box-pleat')` |
| `/edit` | edit | ensure a CP exists (`oristudioCpDocument \|\| importedCreasePattern`) → `createNewCreasePattern()` |
| `/simulate` | simulate | **cannot sensibly provision from nothing** — see below |

**Provisioning is presence-guarded, never unconditional.** Navigating to `/edit`
with a CP already loaded just shows it; only a genuinely-absent resource is
provisioned. This keeps navigation non-destructive.

**`/simulate` is the exception.** Simulation needs a folded model; there's
nothing coherent to fabricate from an empty state. On a cold deep link with no
document, `/simulate` **redirects to `/welcome`**. (Later we can auto-fold the
active CP if one exists; out of scope here.)

### Auto-provision safety

- **Gate on `engineReady`.** If the engine isn't ready when a provisioning route
  mounts, show the existing "Preparing the editor…" state (reuse StartScreen's
  `loading_engine` UI or a lightweight splash), then provision once ready.
- **Cold start is clean** (`dirty === false`), so provisioning never discards
  work. The dirty-guard matters for *leaving* a workspace (below), not entering.
- **Idempotency.** The route effect must compare before acting (`activateWorkspace`
  already early-returns on no-op; provisioning must check resource presence) so a
  re-render or Strict-Mode double-invoke can't double-provision or thrash Dockview.

## Navigation & bidirectional sync

- **Rail / menu / shortcut** stop calling `activatePanel`/`activateWorkspace`
  directly and instead `navigate('/edit')` etc. `handleMenuAction('view.*')`
  becomes a `navigate` so keyboard and native menus keep working.
- **In-canvas state changes push to the URL.** Picking a method in the NUX
  chooser navigates to `/design/treemaker` or `/design/bp` (instead of calling
  `chooseDesignMethod` directly). "Send to Edit" navigates to `/edit`.
- **One-way data flow, no loops.** URL is the input; the route effect reconciles
  store state to match; store changes that should alter the URL do so by
  `navigate`, not by mutating then re-deriving. The route effect must be a no-op
  when state already matches the route.
- **Rail "Design" target.** To avoid sending a user with an in-progress design
  back to the destructive chooser, the rail Design button navigates to the
  **active variant's subroute if a design exists**, else `/design`. `/design`
  bare remains reachable/bookmarkable as the chooser. (Recommended default;
  easy to flip to always-`/design` if you prefer.)

## Leaving a workspace: preserve the dirty guard

`showStartScreen()` currently confirms discard of unsaved changes before
returning to StartScreen ([App.tsx:242](../apps/web/src/App.tsx)). Navigating to
`/welcome` (or any route that abandons a dirty doc) must run the same guard via
react-router's `useBlocker` — block the transition, run `requestConfirmation`,
then proceed or cancel. This replaces the imperative confirm currently inlined in
`showStartScreen`.

## Phases

Each phase is independently shippable and tool-verifiable (tsc + vitest).

### Phase 1 — Router shell, no behavior change
- Add `react-router-dom`.
- Root picks `createBrowserRouter` (web, `basename` from `BASE_URL`) vs
  `createMemoryRouter` (desktop) by `getRuntimeSurface()`.
- Routes defined; every workspace route renders the **same** shell as today.
  `/welcome` renders StartScreen. `/` redirects to `/welcome`.
- `activeWorkspace`/`workspaceStarted` still drive rendering — routing is inert.
- **Verify:** app loads at `/welcome`; tsc + existing tests green.

### Phase 2 — Route drives workspace state
- Add the single route effect: route → `activateWorkspace(id)` (+ Design variant
  reconciliation). Delete `workspaceStarted` local state; derive "started" from
  "not on `/welcome`".
- Rail/menu/shortcut → `navigate`. `handleMenuAction('view.*')` → `navigate`.
- **Verify:** clicking the rail changes the URL and the workspace; back/forward
  moves between workspaces; `layoutStore.test` + `menuActions` paths updated.

### Phase 3 — Design subroutes + variant sync
- `/design` → NUX chooser; `/design/treemaker`/`/design/bp` → variants.
- NUX chooser picks navigate to the subroute; the route effect calls
  `chooseDesignMethod`. URL follows in-canvas method changes.
- Rail Design → active variant subroute if a design exists, else `/design`.
- **Verify:** each design URL mounts the correct layout variant; picking a method
  updates the URL; reload of `/design/bp` restores the BP split.

### Phase 4 — Auto-provision + engine gate
- Presence-guarded provisioning per the mapping table; `engineReady` gate with
  the "Preparing…" splash; `/simulate` cold → redirect `/welcome`.
- **Verify:** cold deep links to `/edit`, `/design`, `/design/treemaker`,
  `/design/bp` each land in a usable state with a fresh doc; `/simulate` cold
  redirects; a loaded doc is shown (not clobbered) on navigation.

### Phase 5 — Dirty guard via `useBlocker` + cleanup
- Move the discard-confirm into a route blocker; delete the inlined confirm in
  `showStartScreen`.
- Delete now-dead `workspaceStarted`/`enterWorkspace` plumbing in `App.tsx`.
- **Verify:** navigating away from a dirty doc prompts; discard/cancel both
  behave; full test suite + tsc green.

### Post-merge (web host only)
- Add the SPA-fallback rewrite (unknown path → `/index.html`) **with COOP/COEP
  preserved** on whatever hosts web (Vercel/Netlify/Cloudflare rewrite rule).
  Desktop needs nothing (memory router).

## Open questions / considerations

- **Chooser is destructive.** Re-entering `/design` and picking a method runs
  `createNewProject`/`createOristudioBpProject`, which creates a *fresh* design.
  Routing preserves today's behavior; a "resume existing design" affordance is a
  separate product change. The rail-Design-to-active-variant default above
  mitigates accidental loss.
- **Layout persistence is unchanged** — still per-workspace/-variant in
  localStorage ([layoutStore.ts](../apps/web/src/store/layoutStore.ts)); routes
  don't touch it.
- **`/share` groundwork:** when built, it's the one route needing a data
  `loader` that resolves the CP → hydrates the store → redirects to `/edit`.
  Nothing here blocks that; the per-surface router already supports loaders.
