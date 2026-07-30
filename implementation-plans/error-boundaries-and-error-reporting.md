# Error boundaries and error reporting

## Goal

A crash in one surface should cost the user that surface, not the app — and
whatever it cost them, they should be able to hand a developer everything needed
to debug it in one click.

Three outcomes:

1. **Containment.** A render/lifecycle throw anywhere in the tree is caught by
   the nearest boundary. A broken Crease Pattern panel leaves the toolbar, the
   rail, and the other panels alive and interactive. A broken modal closes
   itself, not the app.
2. **A fallback worth looking at.** Not a stack dump. A quiet pane-shaped panel
   that says what broke, offers **Try again**, and hides the technical detail
   behind a disclosure.
3. **A copyable report.** One **Copy details** button yields a markdown block
   with the stack, the component stack, the app version and build, the runtime
   surface, the active workspace/editing context, and document *shape* (counts,
   never contents) — paste-ready into a GitHub issue.

Plus the non-React half of the same problem: today nothing listens for
`window.onerror`, `unhandledrejection`, or worker `error`/`messageerror`, so a
dead worker or a throw inside a `requestAnimationFrame` callback is invisible
outside devtools.

## Current state

**There are zero error boundaries in this app.** The only `ErrorBoundary` in the
tree is Lexical's own, inside the rich-text editor
([CpTextEditor.tsx:120](../apps/web/src/cp-workspace/CpTextEditor.tsx#L120)),
which only guards Lexical's reconciler.

Consequences today:

| Failure | What the user sees |
|---|---|
| Any panel throws while rendering | React 19 unmounts the **entire** tree → blank window. On desktop there is no address bar, so the only recovery is quitting the app. |
| A modal throws | Same — whole app. |
| A worker dies (`error` / `messageerror`) | Nothing. The in-flight comlink call never settles; the surface hangs on its spinner forever. |
| Throw in a rAF / event callback / detached promise | Console only. |
| WebGL context loss | Nothing; canvas goes blank. |

What already works and should **not** be rebuilt: engine errors raised inside
store actions set `error: WasmErrorEnvelope` on the workspace store, and
[GlobalToasts.tsx](../apps/web/src/components/GlobalToasts.tsx) toasts them
through `humanizeError`
([toastMessages.ts](../apps/web/src/lib/toastMessages.ts)), with per-code
plain-language translations. That is the async path and it stays. This plan adds
the *synchronous render* path and the *unowned async* path around it.

Useful pieces already in the repo:

- `copyTextToClipboard` ([clipboardText.ts](../apps/web/src/lib/clipboardText.ts))
  — already handles the `NotAllowedError` case and reports failure honestly.
- The issues URL, already used by the About dialog
  ([HelpModal.tsx:135](../apps/web/src/components/HelpModal.tsx#L135)).
- `SurfaceLoading` ([SurfaceLoading.tsx](../apps/web/src/components/ui/SurfaceLoading.tsx))
  — the per-pane state component to visually rhyme with; `.surface-loading` in
  [App.css:370](../apps/web/src/App.css#L370) is the CSS pattern to follow.
- `panelComponents` ([PanelComponents.tsx](../apps/web/src/components/panels/PanelComponents.tsx))
  — a single 25-line registry mapping 10 panel ids to components. This is the
  one composition site where every dock panel can be wrapped by construction.

## Approach

### Where boundaries go

Five tiers, outermost first. Each tier's fallback is sized to what it lost.

| Tier | Site | Fallback | Rationale |
|---|---|---|---|
| Root | [main.tsx](../apps/web/src/main.tsx), wrapping `<RouterProvider>` | `app` | Last resort — catches router-internal and provider-level throws. |
| Route | `errorElement` on the `/` route in [appRouter.tsx](../apps/web/src/routing/appRouter.tsx) | `app` | Catches loader/route errors, which never reach a React boundary. |
| Shell chrome | `Toolbar` in [WorkspaceShell.tsx](../apps/web/src/components/WorkspaceShell.tsx) | `strip` | A thrown capability selector in the toolbar must not take the canvas with it. |
| Shell chrome | `WorkspaceRail` in the same file | `mini` | The rail is a ~48px vertical column; see the variant note below. |
| **Panel** | The `panelComponents` registry — every entry, via one HOC | `pane` | The main event. All 10 dock panels, including the five big ones. |
| Overlay | The five always-mounted modals + the toast host in [App.tsx](../apps/web/src/App.tsx) | `overlay` | A crashing dialog dismisses itself and leaves the document open. |

Panel tier covers, by size: `CreasePatternPanel` (3333 lines),
`BpPackingPanel` (2308), `SimulatorPanel` (2003), `DesignPanel` (1331),
`BpTreePanel` (1001), plus inspector/diagnostics/conditions/sequence/view-controls.

Wrapping happens **in the registry, not in the panels**. Per AGENTS.md, panels
are composition sites; a boundary is chrome around a panel, not behavior inside
one. `PanelComponents.tsx` maps id → component, so
`withPanelErrorBoundary(Component, id)` applied there means a panel added later
is wrapped without anyone remembering to do it — and a test asserts that.

### New modules

```
src/components/errors/
  ErrorBoundary.tsx           # the one class component
  ErrorFallback.tsx           # the visual, 4 variants (app|pane|strip|overlay)
  withPanelErrorBoundary.tsx  # HOC for the Dockview registry
  ErrorBoundary.test.tsx
  ErrorFallback.test.tsx
src/lib/
  errorReport.ts              # pure report builder + context collector
  errorReport.test.ts
  globalErrorHandlers.ts      # window error / unhandledrejection
  globalErrorHandlers.test.ts
  workerDiagnostics.ts        # attachWorkerDiagnostics(worker, name)
  workerDiagnostics.test.ts
  appBuildInfo.ts             # __APP_VERSION__ / __APP_COMMIT__ accessors
```

`ErrorBoundary` is the only class component we add — `getDerivedStateFromError`
for the render swap, `componentDidCatch` for the side effects (console.error,
context capture). It keeps `console.error` in dev: containment must not mean
silence. Reset works by clearing state **and** bumping an internal `attempt`
counter used as the child `key`, so children genuinely remount rather than
re-rendering into the same broken state. Optional `resetKeys` clears
automatically when the underlying document changes — a panel that died on a bad
document should come back when a good one is opened.

Two rules the fallback has to obey, or the boundary makes things worse:

- **The fallback takes plain props only.** No store reads, no `t()` on
  potentially-missing catalogs beyond inline defaults, no engine calls. A throw
  inside a fallback escalates to the *parent* boundary, so a fallback that
  touches the same broken state cascades the failure upward.
- **Context is captured in `componentDidCatch`, defensively.** Every store read
  in the collector is individually try/caught and degrades to `"unavailable"`.
  The reporter can never be the thing that throws.

### The report payload

`buildErrorReport(input): string` returns markdown, e.g.:

```
### Ori Studio error report

**When**       2026-07-27T18:22:04.113Z
**Surface**    panel:crease-pattern
**Version**    0.1.2 (build a1b2c3d)
**Runtime**    web · Chrome 141 · macOS
**Locale**     en
**Workspace**  edit · context cp-canvas
**Document**   crease pattern · 1284 edges · 640 vertices · dirty

**Error**
TypeError: Cannot read properties of undefined (reading 'length')

**Stack**
    at buildSelectionSegments (creasePatternSelectionSegment.ts:88:21)
    ...

**Component stack**
    at CreasePatternPanel
    ...
```

Privacy rules, enforced by a test:

- **Never** document contents, geometry, node/edge labels, or project titles.
- **Never** filesystem paths (a desktop `openedPath` leaks a home directory and
  a real name). Document identity is expressed as counts and kind only.
- Version, commit, UA, runtime surface, locale, workspace, editing context, and
  the two stacks are in.

`__APP_VERSION__` / `__APP_COMMIT__` come from a `define` in
[vite.config.ts](../apps/web/vite.config.ts) (package version + `git rev-parse
--short HEAD`, both with safe fallbacks so a build outside a git checkout still
works), declared in a new `src/vite-env.d.ts`. `appBuildInfo.ts` wraps them so
nothing else touches the globals.

### The fallback UI

`pane` variant — fills the dock panel, matching `.surface-loading`'s centered
layout and theme tokens:

- `AlertTriangle`, heading "This panel stopped working"
- One-line message: the error's `message`, truncated — enough to recognize a
  repeat, not a wall of text
- **Try again** (primary) — resets the boundary
- **Copy details** — `copyTextToClipboard(buildErrorReport(...))`; flips to
  "Copied" for ~2s, and on failure says so rather than lying
- **Report an issue** — link to the existing issues URL
- `<details>` disclosure holding the full stack + component stack in a
  monospace, scrollable, selectable box

`app` adds **Reload** and **Reset layout** (`clearAllPersistedLayouts` — a corrupt
persisted Dockview layout is a plausible cause of a crash that repeats through a
reload, and it is otherwise unreachable once the app won't render). `strip` is a
single inline row. `overlay` is a compact card with **Dismiss**.

**`mini`** was added during the design walkthrough, when `strip` turned out to be
wrong for the workspace rail: `strip` is a *horizontal* row and the rail is a
~48px vertical `<aside>`, so it wrapped the message to one character per line.
`mini` is the column-shaped answer — an alert icon over two icon buttons, with
the message moved into `title` tooltips rather than dropped. Anything mounted in
a narrow column wants `mini`, not `strip`.

Two constraints it surfaced, both now enforced:

- **The variant→title lookup is an exhaustive `switch`** over the union, not a
  ternary chain with a default. `mini` initially fell through to "This panel
  stopped working" — the rail is a sidebar, not a panel. Adding a variant is now
  a type error rather than a fallback quietly naming the wrong thing.
- **`mini` uses `IconButton`'s style classes but not the component.** `IconButton`
  renders a Radix tooltip, which needs `TooltipProvider` in context; a fallback
  that throws for want of a provider escalates to the parent boundary — exactly
  the cascade this component exists to prevent. Native `title` works anywhere.

All five share one component and one CSS block in `App.css` (`.error-fallback*`).

### The non-React half

**Global handlers** (`globalErrorHandlers.ts`, installed once from `App.tsx`,
returns a disposer): `error` and `unhandledrejection` listeners → a sonner toast
with a **Copy details** action reusing the same `buildErrorReport`. Deduped by
`name+message+first stack frame` and rate-limited (a throw inside a rAF loop
fires every frame; three toasts is informative, three hundred is a denial of
service). Deliberately does **not** call `preventDefault` — devtools should keep
its normal behavior.

**Worker diagnostics** (`workerDiagnostics.ts`): `attachWorkerDiagnostics(worker,
name)` at each of the six `new Worker(...)` sites (`engineRuntime`,
`oristudioCpRuntime`, `oristudioBpRuntime` ×2, `simulatorRuntime`,
`cpDetectRuntime`), none of which listen for failure today. On `error` or
`messageerror` it sets the store error envelope with a code identifying the
worker, so a dead engine reads as "The crease-pattern engine stopped responding"
through the existing `humanizeError` path instead of an eternal spinner.

## Affected areas

- **New**: `src/components/errors/*`, `src/lib/errorReport.ts`,
  `src/lib/globalErrorHandlers.ts`, `src/lib/workerDiagnostics.ts`,
  `src/lib/appBuildInfo.ts`, `src/vite-env.d.ts`
- **Edited**: `main.tsx`, `App.tsx`, `routing/appRouter.tsx`,
  `components/WorkspaceShell.tsx`, `components/panels/PanelComponents.tsx`,
  `App.css`, `vite.config.ts`, the five `*Runtime.ts` worker-creation sites,
  `lib/toastMessages.ts` (worker-failure codes)
- **i18n**: new `errors:boundary.*` and `errors:worker.*` keys → `i18n:extract`,
  translations for all 8 non-English locales, `i18n:stamp`, `i18n:check`
- **Not touched**: panel internals (no behavior moves into or out of a panel),
  the Rust/wasm crates, the Tauri shell

## Risks and things to verify

- **Cleanup on crash.** `CreasePatternPanel` and `DesignPanel` register
  viewport shortcut executors and set the active shortcut surface
  (`registerViewportShortcutExecutor`, `setActiveShortcutViewportSurface`).
  When a boundary swaps a panel for its fallback, React unmounts the subtree and
  effect cleanups run — but this must be *verified*, not assumed. A stale
  executor pointing at a dead surface would make shortcuts misfire app-wide.
- **Dockview + portals.** Dockview renders panels through React portals, so
  they remain inside the React tree and a panel throw does propagate to the
  route boundary today. That is exactly why the per-panel tier is the load-
  bearing one.
- **StrictMode double-invocation** in dev will run `componentDidCatch` side
  effects twice; the toast/report path must be idempotent.
- **Test noise.** React logs caught errors via `console.error`; boundary tests
  need to silence it deliberately rather than letting it look like a failure.

## Out of scope for this pass

- **WebGL context loss** (`webglcontextlost` on the CP and simulator canvases).
  It is not an exception, so no boundary sees it, and real recovery means
  rebuilding regl resources. Phase 5 below adds *surfacing* only — a banner that
  explains the blank canvas and offers a reload. Full restore is a separate plan.
- Remote error telemetry / crash reporting service. Everything here is local and
  user-initiated; the copy button is the transport.
- Retrying failed engine operations. The boundary offers remount, not replay.

## Checklist

### Phase 1 — Primitives

- [x] `src/lib/appBuildInfo.ts` + `vite.config.ts` `define` + `src/vite-env.d.ts`.
      Only the **commit** needed a define — `constants/release.ts` already
      imports the version from package.json, so `APP_VERSION` was reused.
- [x] `src/lib/errorReport.ts` (pure builder) + `components/errors/errorContext.ts`
      (the store binding, every read individually guarded, never throws)
- [x] `errorReport.test.ts`: payload shape; redaction; hostile `toString`;
      unavailable context rendered honestly rather than guessed
- [x] `src/components/errors/ErrorBoundary.tsx` — `resetKeys`, `console.error`
      retained. **No `attempt` key**: React unmounts the failed subtree when the
      fallback renders, so clearing `error` already remounts children. The key
      was redundant and was removed rather than kept as insurance.
- [x] `src/components/errors/ErrorFallback.tsx` with `app|pane|strip|mini|overlay`
      (`mini` added after the walkthrough — see the variant note above)
- [x] `.error-fallback*` styles in `App.css`. Needed an explicit `height: 100%`,
      not just `flex: 1` — Dockview's `.dv-react-part` is `display: block`, so
      the fallback otherwise collapsed to its content at the top of the pane.
      (`.surface-loading` gets away with `flex: 1` only because panels nest it
      inside their own flex containers.)
- [x] `ErrorBoundary.test.tsx` (9) / `ErrorFallback.test.tsx` (11)

### Phase 2 — Placement

- [x] `withPanelErrorBoundary` + applied across the `panelComponents` registry
- [x] `PanelComponents.test.tsx` — every registry entry wrapped;
      `withPanelErrorBoundary.test.tsx` — a throwing panel leaves siblings alive
- [x] Root boundary in `main.tsx`; `errorElement` on the `/` route
- [x] `Toolbar` / `WorkspaceRail` / Dockview boundaries in `WorkspaceShell`
- [x] Overlay boundaries around the five modals + the toast host in `App.tsx`
- [x] **Verified** (not assumed) that a crashed panel releases its global
      registrations: a boundary test drives the real `shortcutRuntime` and
      asserts the viewport executor stops answering after the fallback renders

### Phase 3 — Unowned async

- [x] `globalErrorHandlers.ts` (dedupe + rate limit) + `GlobalErrorReporter.tsx`
      (the toast with Copy details), installed from `App.tsx`
- [x] `globalErrorHandlers.test.ts`: dedupe, rate limit, throwing reporter,
      disposer removes listeners
- [x] `workerDiagnostics.ts` + wired into all six `new Worker(...)` sites
- [x] Worker-failure codes in `humanizeError` with plain-language messages
- [x] `workerDiagnostics.test.ts`

### Phase 4 — i18n and validation

- [x] All new strings as `t('errors:…', 'English default')` — 22 new keys
- [x] `i18n:extract`, translated 8 locales, `i18n:stamp` (176 hashes = 22 × 8)
- [x] `npm run i18n:check` passes
- [x] `npx tsc --noEmit`, `npx eslint .`, full `vitest run` (150 files, 1242
      tests) all clean
- [x] Browser pass over **every** variant, driven by a temporary URL-param crash
      probe (since removed). Each fallback rendered in its real mount site with
      the rest of the app alive; the report carries surface + version + build sha
      + component stack and leaks no home directory; a trusted click on Copy
      details wrote the report and showed "Copied" (an untrusted click correctly
      showed "Couldn't copy" rather than claiming a copy that never happened).
      Three layout bugs were found and fixed this way: the collapsed pane
      fallback, `strip` in the vertical rail, and the app fallback's stranded
      icon.

### Phase 5 — Stretch (not done)

- [ ] `webglcontextlost` listeners on the CP and simulator canvases → surfacing
      banner (not recovery)
