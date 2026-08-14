# Desktop window and security defaults

## Goal

Four settings in the desktop shell are unset and taking framework defaults that
are wrong for this app. Give each a deliberate value:

1. **No minimum window size** — the window drags down to a few hundred pixels,
   well past the point where the toolbar and panes are usable.
2. **No window state persistence** — size and position reset to 1400×900 on
   every launch, regardless of how the user left it.
3. **Window title does not name the open file** — the title bar shows the
   *project* title (`workspaceTitle`), so a document opened from
   `~/Documents/dragon.osf` can read `Untitled - Ori Studio`. The macOS
   convention is that a document window is titled by its file.
4. **`"csp": null`** — the webview runs with no content security policy.

Items 1, 2 and 4 live in `apps/tauri/src-tauri/tauri.conf.json`; only the first
is purely a config edit, the other two need shell wiring. Item 3 is entirely
frontend and needs no Tauri config or capability change at all.

**The title bar style itself stays as-is** — `titleBarStyle` keeps its default
`Visible`. The overlay/transparent variants and the duplicate `Ori Studio` label
in the toolbar are deferred, not rejected; see the deferred section at the end.

### Why this is low-risk right now, and where the risk actually is

There is no desktop release workflow — `.github/workflows/release.yml` only
validates that the version in `apps/tauri/package.json` matches
`tauri.conf.json`. Ori Studio ships on web only, so no released desktop build
carries these defaults and there is nothing to migrate.

The flip side is the real risk in this plan: **these settings have never been
exercised in a desktop production build.** `tauri dev` loads the frontend from
the vite dev server and, once `devCsp` exists, is governed by that relaxed
policy — so a broken production CSP is invisible during development and only
appears under `npm run build:desktop`. Every CSP item below must be verified
against a packaged build, not a dev run.

## Approach

### 1. Minimum window size

Add to the window config in `tauri.conf.json`:

```json
"minWidth": 900,
"minHeight": 640
```

Rationale for the numbers: the workspace has no layout breakpoint of its own
below the default width — the 860px/720px media queries found in the CSS belong
to `CpDetectImportModal` and `WelcomeLanding`, and `PHONE_MEDIA_QUERY` requires
`pointer: coarse`, so it never matches on desktop. The binding constraint is
therefore the toolbar's action cluster and the Dockview pane minimums, not a
declared breakpoint. 900×640 is proposed as the starting value and should be
confirmed empirically by dragging the window down and watching where the toolbar
actions start colliding; adjust before merging rather than shipping a guess.

Note this interacts with item 2 — see the clamping check there.

### 2. Window state persistence

Use the official plugin, `tauri-plugin-window-state` (currently 2.4.1). Wire it
in `lib.rs` alongside the existing dialog plugin:

```rust
.plugin(tauri_plugin_window_state::Builder::default().build())
```

Decisions to make explicitly rather than by default:

- **Which flags to persist.** `StateFlags` covers size, position, maximized,
  fullscreen, visible and decorations. Persist `SIZE | POSITION | MAXIMIZED`.
  Deliberately exclude `FULLSCREEN` (relaunching into fullscreen is disorienting
  when the app was quit from fullscreen by accident), and exclude `VISIBLE` and
  `DECORATIONS`, which interact badly with item 3.
- **No capability entry should be needed.** The plugin saves and restores from
  the Rust side; a `window-state:*` permission is only required if the frontend
  calls the plugin's JS API, which we are not doing. Confirm this after wiring —
  if the app logs a permission denial, add the plugin's default set to
  `capabilities/default.json` rather than broadening anything else.
- **Clamping against the new minimum.** A state file written before item 1
  landed can hold a size below `minWidth`/`minHeight`. Verify that restore
  clamps rather than reopening undersized; if it does not, clamp explicitly on
  restore.
- **Monitor loss.** A window restored to the coordinates of a disconnected
  display must not open offscreen. Test by saving state on an external monitor,
  disconnecting, and relaunching.

### 3. Window title names the open file

Almost all of this already exists and works — the gap is which store field it
reads.

`useWindowTitle` is mounted at `App.tsx:86` and drives `formatWindowTitle` →
`applyWindowTitle`, which sets `document.title` and, on desktop, calls Tauri's
`setTitle`. `core:window:allow-set-title` is already in
`capabilities/default.json`. So there is **no new wiring, no new dependency and
no capability change** — only a change to what the title is built from.

Today `formatWindowTitle` receives `workspaceTitle`, the project's own name.
It should prefer the file the project came from.

**The "if one exists" test must be `currentFilePath !== null`, not
`currentFileName`.** This is the trap in this item. Both fields exist on the
store (`types.ts:264-265`) and are maintained across every open and save path,
but `currentFileName` is *always* populated — a brand-new project gets
`defaultNativeFilename('Untitled')`, i.e. the synthesized string `Untitled.osf`
(`projectSlice.ts:2006`). Keying off the filename would therefore title an
unsaved project after a file that does not exist.

`currentFilePath` is the honest signal: `fileService.ts` returns `path: null` on
every browser path and a real path only from the Tauri open/save dialog, so this
also makes filename-titling naturally desktop-only without a runtime branch.
`formatWindowTitle` already accepts a `surface` argument that it currently
ignores (`surface: _surface`), so an explicit web/desktop split is available if
we decide we want one — but it should not be needed.

Proposed behavior:

| State | Title |
| --- | --- |
| File open, saved | `dragon.osf - Ori Studio` |
| File open, unsaved edits | `*dragon.osf - Ori Studio` |
| No file (new project) | `Untitled - Ori Studio` (unchanged) |

Decisions worth making deliberately rather than by accident:

- **Keep the extension.** `dragon.osf` rather than `dragon`. Stripping it would
  hide the distinction between the formats the app round-trips (`.osf`, `.ori`,
  `.orh`, `.cp`, `.fold`), which matters here more than it does in a typical
  document app.
- **Keep the existing `*` dirty marker** and its position. macOS convention is
  really a dot in the close button, but `*` is the current cross-platform
  behavior and changing it is a separate question.
- **Fall back to `workspaceTitle`, not to a literal.** With no file open the
  title should stay exactly what it is today.

Testing note: `useWindowTitle`'s own doc comment records that this hook exists
*because* an earlier version silently read the wrong store field and nothing
caught it. Both `windowTitle.test.ts` and `useWindowTitle.test.tsx` already
exist; the new field reads must be asserted there, including the
unsaved-project case that distinguishes `currentFilePath` from
`currentFileName`. That case is the whole point.

### 4. Content Security Policy

Replace `"csp": null` with an explicit policy, and add a separate `devCsp` so
the dev server keeps working. Tauri injects nonces into `<style>` elements and
remote `<script src="http…">` tags at runtime; Vite's output references its
bundles as same-origin `<script type="module" src="/assets/…">`, and its
modulepreload polyfill is emitted *into the bundle* rather than as an inline
script, so no inline-script hash or `'unsafe-inline'` is needed for scripts.

Proposed production policy:

```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval' blob:;
worker-src 'self' blob:;
style-src 'self' 'unsafe-inline';
style-src-attr 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'self' data: blob: ipc: http://ipc.localhost https://us.i.posthog.com https://us-assets.i.posthog.com https://*.ingest.us.sentry.io;
object-src 'none';
base-uri 'self';
frame-ancestors 'none';
form-action 'none'
```

Each non-obvious directive, and the thing in the codebase that forces it:

- **`'wasm-unsafe-eval'`** — all four wasm bridges plus onnxruntime-web
  instantiate WebAssembly. Without it the app does not boot at all.
- **`blob:` in `script-src`/`worker-src`** — `simulator/capabilityProbe.ts:111`
  builds a Worker from `URL.createObjectURL(new Blob(...))`, and onnxruntime-web
  creates blob workers of its own. The bundled workers (`new Worker(new
  URL(..., import.meta.url))`) are same-origin and need only `'self'`.
- **`style-src 'unsafe-inline'` *and* `style-src-attr 'unsafe-inline'`** — React
  inline `style={{}}` attributes appear in 20 files, and Dockview positions panes
  with inline styles. The separate `style-src-attr` is not redundant: once Tauri
  injects its style nonce into `style-src`, CSP ignores `'unsafe-inline'` there,
  and style *attributes* would be blocked. Declaring `style-src-attr` explicitly
  keeps that channel open.
- **`ipc: http://ipc.localhost` in `connect-src`** — Tauri's IPC transport
  (`ipc://localhost`, per `tauri/src/ipc/protocol.rs`). Included in the portable
  form Tauri documents.
- **`data:`/`blob:` in `img-src` and `connect-src`** — reference images and file
  reads come back through `read_binary_file` as bytes and become blob URLs;
  exports go out through `createObjectURL`.
- **`font-src 'self'`** — the one `@font-face` (Oriedita Icons) is a bundled
  `.ttf`, not a remote font.
- **PostHog and Sentry hosts** — deliberately included even though they are
  *inert on desktop today*: the desktop build sets no `VITE_PUBLIC_*` env vars,
  so both are firewalled off by env absence. Omitting them would bake a latent
  trap that silently kills telemetry the day desktop gets those vars. Confirm
  the Sentry region from the real DSN before merging — the wildcard above
  assumes US (`ingest.us.sentry.io`); an EU org needs `ingest.de.sentry.io`.
- **`form-action 'none'`** — verify no form in the app actually submits; relax
  to `'self'` if one does.

Dev policy (`devCsp`) is the same with the dev server and HMR socket added, and
scripts relaxed for vite's dev-time injection:

```
script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:;
connect-src 'self' data: blob: ipc: http://ipc.localhost ws://127.0.0.1:* http://127.0.0.1:* ws://localhost:* http://localhost:*;
```

The wildcard ports matter: the dev server does not reliably run on 5173, because
`devUrl` is hardcoded to that port while parallel worktrees compete for it.

## Affected Areas

- `apps/tauri/src-tauri/tauri.conf.json` — `minWidth`/`minHeight`,
  `security.csp`, `security.devCsp`.
- `apps/tauri/src-tauri/Cargo.toml` — add `tauri-plugin-window-state`.
- `apps/tauri/src-tauri/src/lib.rs` — register the plugin with explicit
  `StateFlags`.
- `apps/web/src/platform/windowTitle.ts` — `formatWindowTitle` takes the
  filename and path.
- `apps/web/src/hooks/useWindowTitle.ts` — subscribe to `currentFileName` and
  `currentFilePath` alongside `workspaceTitle` and `dirty`.
- `apps/web/src/platform/windowTitle.test.ts`,
  `apps/web/src/hooks/useWindowTitle.test.tsx` — extend, including the unsaved
  project case.

No capability change is required by any item in this plan; the existing
`capabilities/default.json` already grants `core:window:allow-set-title`.

## Checklist

### Minimum window size
- [x] Determine the real floor by dragging the running app down; adjust 900×640
      if the toolbar or panes break earlier or survive longer.
      **Measured at 900px:** Dockview's default split gives the right inspector
      164px and its controls clip — so 900 is where the app is broken out of the
      box rather than merely cramped. Fixed chrome (rail 50 + tool palette 184 +
      a usable ~260px inspector) leaves ~400px of canvas. The toolbar is *not*
      the constraint: its action cluster needs only 137px. 640 height keeps the
      toolbar, canvas and bottom zoom controls on screen with the palette
      scrolling. Confirmed 900×640.
- [x] Add `minWidth`/`minHeight` to `tauri.conf.json`.

### Window state persistence
- [x] Add `tauri-plugin-window-state` to `Cargo.toml`.
- [x] Register it in `lib.rs` with `SIZE | POSITION | MAXIMIZED`.
- [x] Confirm no capability entry is required; add the plugin default set only
      if a denial appears. **No denial — the plugin restores from Rust.**
- [x] Verify a saved size below the new minimum is clamped on restore, not
      reopened undersized. **It was not.** Seeding a 400x300 state file reopened
      the window at 200x150 against a 900x640 minimum, because the plugin
      replays a saved *physical* size with `set_size`, which does not consult
      the configured minimum. Fixed with `clamp_window_to_min`; re-seeding the
      same file now reopens at exactly 900x640.

      Two dead ends worth recording, because both *look* right: a clamp in the
      app's `setup` hook runs before the plugin's restore (which happens in its
      `on_window_ready`), and a clamp in a plugin registered behind it still
      reads the pre-restore size, because `set_size` reaches the platform window
      asynchronously. Only the `Resized` event carries a size that cannot be
      read too early.
- [x] Verify restore after the saved monitor is disconnected does not open
      offscreen. **Already handled upstream** — the plugin restores a position
      only if some currently-available monitor intersects the saved rect, and
      otherwise leaves placement to the OS.
- [x] Save-on-quit. Initially unverifiable here — it runs on `RunEvent::Exit`,
      which `SIGTERM` does not trigger — but a real quit during testing produced
      it: the state file was written as `2800x1800` physical, exactly the
      1400x900 logical window at 2x, with its position. Relaunching restored the
      window to 1400x900. Round trip closed: save, restore, and clamp are all
      confirmed end to end.

### Window title
- [x] Extend `formatWindowTitle` to prefer the filename, gated on
      `currentFilePath !== null`, falling back to `workspaceTitle`.
- [x] Subscribe `useWindowTitle` to `currentFileName` and `currentFilePath`.
- [x] Assert in tests: saved file shows the filename; a **new, never-saved**
      project shows `Untitled` and *not* the synthesized `Untitled.osf`; the
      dirty marker still applies. Also Save As, and the web fallback. 6 → 13
      tests across the two files.
- [ ] Verify in the running desktop app: open a `.osf`, confirm the title bar
      names it; edit, confirm the dirty marker; Save As, confirm it follows the
      new name. **Needs a hand** — the filename branch is reachable only through
      the native file dialog, which needs UI automation this environment does
      not have, and `currentFilePath` is null on every browser path by
      construction, so the browser cannot stand in for it.
- [x] Confirm the browser tab title is unchanged (no path exists on web, so it
      should fall through to the current behavior).

### CSP
- [x] Add `csp` and `devCsp` to `tauri.conf.json`.
- [x] Confirm the Sentry DSN region and fix the ingest wildcard accordingly.
      **Could not** — the DSN is a CI secret and the repo carries no region
      hint (org `zachary-marion`, project `ori-studio`). Covered US, EU and
      legacy ingest hosts instead, all narrow. Both telemetry vendors are inert
      on desktop today anyway: no desktop build sets `VITE_PUBLIC_*`.
- [x] Confirm no form relies on `form-action`. All three `<form>`s
      (`CommandDialogModal`, `CreaseExportDialog`, `SelectByIndexModal`)
      `preventDefault`, so `'none'` is a backstop rather than a behavior change.
- [x] **Verify against a production build**, not `tauri dev` — `devCsp` masks
      production CSP failures entirely. Done by serving the real `dist/` bundle
      under the exact shipped CSP string and reading the console, which is
      strictly more inspectable than a packaged `.app` whose devtools cannot be
      driven here. Faithful because Tauri only appends nonces when the HTML
      contains its nonce tokens, and the Vite output has neither a `<style>`
      element nor a `script[src^=http]` — verified against the built
      `index.html`.
- [x] Exercise with zero CSP violations: app boot (wasm bridges), entering the
      CP workspace, the simulate workspace (blob worker).

      **This found a hard break.** Without `'unsafe-eval'` the CP canvas renders
      nothing at all — solid black. `regl`, which the WebGL renderer is built
      on, generates its draw commands as source at runtime and compiles them
      with `Function.apply(null, …)` (`regl/dist/regl.js:6015`), which
      `script-src` governs. There is no CSP-safe mode for it. Adding
      `'unsafe-eval'` restores rendering and brings violations to zero across
      boot, `/edit` and `/simulate`.
- [x] **Decided: ship the CSP with `'unsafe-eval'`.**

      The alternative was to leave `csp: null`, and that is worse. Every other
      directive still does real work with `'unsafe-eval'` present: `connect-src`
      is what stops a compromised dependency exfiltrating a user's designs to an
      arbitrary host, and `object-src`, `frame-src`, `frame-ancestors`,
      `base-uri` and `form-action` all still hold. `script-src 'self'` continues
      to block *loading* remote script; what is opened is the eval sink alone,
      and regl's is the only one in the bundle.

      Worth being clear about what is given up: `'unsafe-eval'` is the single
      largest weakening available in a CSP, and it removes the protection that
      would stop an injected string becoming executable code. The reason it is
      acceptable here rather than in a typical web app is that this webview
      loads no third-party content and makes no unsanctioned network requests —
      there is no obvious route by which attacker-controlled text reaches that
      sink. Tightening it means replacing regl with a renderer that does not
      code-generate, which is a large job so soon after the SVG-to-WebGL
      migration.

### Validation
- [ ] `npm run check:desktop`
- [ ] `npm run lint:web`, `npm run typecheck:web`, `npm run test:web`
- [ ] `cargo fmt --check` and clippy for the shell crate

## Deferred: title bar style and the duplicate app name

Not being done now, kept because the research is done and the option is real.

`titleBarStyle` stays `Visible`. The alternative is `"Overlay"` with
`"hiddenTitle": true`, which moves the macOS traffic lights into the existing
36px toolbar row and reclaims a full title bar of vertical space — attractive
because on desktop `WorkspaceShell.tsx:121` renders the `MenuBar` slot as a
static `Ori Studio` label (the menus having moved to the native menu bar), so
the product name currently appears twice, one row apart.

What it would cost, if revisited:

- A traffic-light spacer (~78px) replacing that label, and
  `data-tauri-drag-region` on the toolbar. Tauri's `drag.js` already exempts
  `A`, `BUTTON`, `INPUT`, `SELECT`, `TEXTAREA`, `LABEL` and `SUMMARY`, so the
  existing `IconButton`s need no special handling.
- **`core:window:allow-start-dragging` added to `capabilities/default.json`** —
  verified against the generated ACL manifest, it is *not* among the 28
  permissions in the `core:window` default set, and the drag region silently
  fails without it.
- Toolbar `min-height` raised from 36px to ~38–40px so the ~28px traffic-light
  band centers.

And the caveats from Tauri's own `TitleBarStyle` docs that make it a judgement
call rather than an obvious win: title bar height varies across macOS versions,
a custom drag region is mandatory, and **an Overlay window cannot be dragged
while unfocused** (tauri-apps/tauri#4316).

`"Transparent"` is the cheaper middle option — no drag region, no capability
change, no frontend work — but it only blends the title bar into the window
background and keeps its full height.

The duplicate `Ori Studio` label is worth removing on its own merits even if the
title bar never changes, especially once the window title names the open file.

## Adjacent findings, deliberately out of scope

Recorded because they were found while researching this, not proposed as part of
it:

- **ExplOri is likely broken on desktop.** `exploriService.ts` talks only to
  `/api/explori/*`, which is a Cloudflare Pages Function in production and a
  vite proxy in dev. A packaged desktop build has neither, and the upstream
  archive sends no CORS headers, so the request cannot succeed. Needs its own
  investigation.
- **Cross-origin isolation on desktop.** `crossOriginIsolationHeaders` is
  applied by the vite dev server, which a packaged build does not use. If
  `SharedArrayBuffer` is unavailable there, onnxruntime-web's threaded wasm
  (`ort.env.wasm.numThreads`) will silently fall back to single-threaded. Worth
  measuring, and unrelated to CSP.
