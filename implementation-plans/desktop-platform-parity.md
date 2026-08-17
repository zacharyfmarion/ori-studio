# Desktop Platform Parity (Windows and Linux)

## Goal

Make Ori Studio actually usable on Windows and Linux, before it is distributed
there. Everything in this plan is a **prerequisite** for
[desktop-ci-release.md](desktop-ci-release.md) — a weekly, auto-updating release
train pointed at a build that cannot open a file or show a menu is worse than no
release at all.

The desktop shell has only ever run on macOS. `bundle.targets: "all"` has been
set in `tauri.conf.json` the whole time, which makes the other two platforms look
supported. They are not: three of the four items below are load-bearing features
that are `#[cfg]`-gated to macOS or built from macOS-only primitives.

## Approach

Fix the platform gates first, then prove them with a launch smoke that runs in
CI on all three platforms. Nothing here is speculative — each item was verified
against the current source and is cited below.

### 1. The menu bar does not exist on Windows or Linux

`WorkspaceShell.tsx:121` is:

```tsx
{isDesktop ? <span className="toolbar__title">Ori Studio</span> : <MenuBar />}
```

`isDesktop` is `getRuntimeSurface() === 'desktop'` (`:104`) — every desktop
runtime, not just macOS. So the in-app `<MenuBar />` is suppressed on all three
platforms, and the only replacement is the native menu, which is built from
macOS-only `PredefinedMenuItem`s (`nativeMenu.ts:144` `{ item: 'Services' }`,
`:147` `HideOthers`) and attached with `menu.setAsAppMenu()`
(`useTauriNativeMenu.ts:61`), whose attachment semantics differ off macOS. The
failure is swallowed into `console.warn` at `:63`.

`File ▸ Open`, `Save As`, every export format, Oriedita import, all View
toggles, Help and Settings (`menuDefinition.ts:97`) exist **only** in the menu.
The toolbar carries about six icon buttons and a gear.

**Fix (smaller of the two options):** change the `WorkspaceShell.tsx:121` gate
from `isDesktop` to `isDesktop && isApplePlatform()`, so the web `MenuBar`
renders as desktop chrome on Windows and Linux — it is code that already works
on every other surface. Gate `appSubmenu()` on macOS. Replace the `.catch` at
`useTauriNativeMenu.ts:63` with `reportError(err, { surface: 'shell:native-menu' })`
so an attachment failure is visible instead of silent.

The alternative — `setAsWindowMenu()` under `#[cfg(not(target_os = "macos"))]`
— gives a true native menu bar but is more work and more surface to test. Prefer the
first; revisit if Windows users ask for a native menu.

### 2. `.osf` file association is registered but cannot work

`lib.rs:62` gates `handle_opened_event` on
`#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]`,
and `:76` is a no-op stub for everything else. `RunEvent::Opened` is a
macOS/mobile event. There is no argv reading anywhere in `apps/tauri/src-tauri/src`,
and `tauri-plugin-single-instance` is not in the repo.

Windows and Linux pass the file path as `argv[1]`. Nothing reads it. Three
consequences:

- Double-clicking a `.osf` opens the app to an empty welcome screen.
- Doing it twice launches a **second** copy, and both fight over
  `tauri-plugin-window-state`'s single state file.
- `bundle.resources` maps only `icons/osf.icns`. `icon.ico` exists but
  **`osf.ico` does not**, so `.osf` files get no document icon on Windows. On
  Linux the generated `.desktop` declares `MimeType=application/vnd.oristudio.project+json`,
  but nothing installs a `shared-mime-info` XML mapping the `*.osf` glob to that
  type, so `xdg-mime query filetype x.osf` never resolves and the association is
  inert regardless.

CHANGELOG 0.1.2 reads "Register `.osf` as a **macOS** document type" — this was
always macOS-scoped, and `bundle.targets: "all"` made it look otherwise.

**Fix:** add `tauri-plugin-single-instance`, and an argv path in `lib.rs` under
`#[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]`
that pushes `.osf` paths into the existing `OpenedFiles` state and emits
`opened-files`. The frontend side (`hooks/useTauriOpenedFiles.ts`) already works
and needs no change. Ship `icons/osf.ico` and a hicolor PNG set, and install a
MIME XML via a Linux bundle resource.

### 3. Nothing has ever run on WebView2 or WebKitGTK

Two recorded defects in this codebase were webview-engine-specific and were found
only by running the app: a Dockview portal-teardown crash that reproduced *only*
in Safari/WKWebView, and WKWebView memory exhaustion on large `.osf` files. Both
were on the one engine that has ever been exercised.

Concrete macOS-derived assumptions that Windows and Linux users will now meet:

- `projectSlice.ts:465` `LARGE_PROJECT_WARN_CHARS = 25MB`, and `:481`'s message
  *"Very large crease patterns can fail to open in the desktop app; the web
  version has more headroom."* Both are calibrated against WKWebView. WebView2
  and WebKitGTK have different heap ceilings, so the number is wrong and the
  sentence may be backwards on Windows.
- The CP canvas is WebGL2/regl with no capability fallback. `capabilityProbe.ts`
  has a `'no webgl2 in worker'` path for the *simulator* only. WebKitGTK under
  software rendering or NVIDIA proprietary drivers routinely has no usable
  WebGL2, and `WEBKIT_DISABLE_COMPOSITING_MODE=1` — the standard Tauri-on-Linux
  blank-window workaround — is not set anywhere.
- `tauri-plugin-window-state` persists a physical size, and `lib.rs:81-138`'s
  `clamped_to_min` was verified against macOS scale-factor changes. Wayland does
  not honor programmatic window positioning at all, so the `POSITION` flag is a
  no-op there.

**Fix:** add a WebGL2 capability check with a visible failure state to the CP
canvas (a blank canvas with no console error is the worst possible failure), make
the 25MB threshold and its message conditional on the actual webview, and set
`WEBKIT_DISABLE_COMPOSITING_MODE=1` for the Linux build.

### 4. The engine crates have never been compiled or tested on Windows

`ci.yml`'s `native-oracle` job is Linux-only. `cargo test --workspace` — including
every Oriedita `.ori`/`.cp` parser test and the `encoding_rs` paths those parsers
use — has never run on Windows or macOS.

`.ori` and `.cp` files are Java- and Windows-authored in the wild. CRLF handling,
`encoding_rs` decode paths, and `Path` separators in the fixture loaders are all
untested on the platform most likely to produce those files. A parse failure here
reads to a user as "Ori Studio corrupted my crease pattern."

**Fix:** one job in `ci.yml` (not the release workflow) running
`cargo test -p oristudio-cp -p treemaker-core -p treemaker-fold` on
`windows-latest`. It then runs on every PR rather than once a week at tag time.

## Affected Areas

| Area | Files |
| --- | --- |
| Menu | `apps/web/src/components/WorkspaceShell.tsx:121`, `apps/web/src/menus/nativeMenu.ts:140-150`, `apps/web/src/menus/useTauriNativeMenu.ts:55-65`, `apps/web/src/platform/runtime.ts` (add `isApplePlatform`) |
| File association | `apps/tauri/src-tauri/src/lib.rs:62-80`, `apps/tauri/src-tauri/Cargo.toml`, `apps/tauri/src-tauri/tauri.conf.json` (`bundle.resources`, Linux bundle files), new `apps/tauri/src-tauri/icons/osf.ico`, new hicolor PNGs, new MIME XML |
| Webview parity | `apps/web/src/store/workspaceStore/slices/projectSlice.ts:465-482`, CP canvas mount, `apps/web/src/simulator/capabilityProbe.ts` (pattern to copy) |
| CI | `.github/workflows/ci.yml` (Windows Rust job, launch smoke) |

## Checklist

### Phase 1 — Make the app work

- [x] Add `isApplePlatform()` and `usesNativeAppMenu()` to `platform/runtime.ts` with unit tests
- [x] Gate the `WorkspaceShell` menu branch on `usesNativeAppMenu()`; the web `MenuBar` renders on Windows and Linux
- [x] Suppress the native menu off macOS — done by gating the whole `useTauriNativeMenu` effect rather than only `appSubmenu()`, because on Windows and Linux the in-app `MenuBar` now renders and building a native menu there would raise a *second* menu beside it. One predicate (`usesNativeAppMenu`) decides both sides, and `nativeMenuGating.test.ts` asserts they cannot drift apart
- [x] `useTauriNativeMenu` reports through `reportError(err, { surface: 'shell:native-menu' })` instead of `console.warn`
- [x] Add `tauri-plugin-single-instance`, registered before every other plugin, on Windows and Linux only
- [x] Add the argv `.osf` path in `lib.rs` — `argv_osf_paths` (unit-tested) feeding the existing `OpenedFiles` state from both first launch and the single-instance callback
- [x] Add `icons/osf.ico` and map it in `bundle.resources` — **but see the gap below: this does not yet give `.osf` a document icon on Windows**
- [x] Add the Linux `shared-mime-info` XML plus hicolor mimetype icons, installed through `bundle.linux.deb.files`
- [ ] ~~Set `WEBKIT_DISABLE_COMPOSITING_MODE=1` for the Linux build~~ — **deliberately not done.** It is the standard fix for blank WebKitGTK windows, but it disables accelerated compositing for a WebGL2-heavy app, and there is no Linux machine here to measure the cost. Forcing a known performance regression on every Linux user to pre-empt a failure that has not been observed is a guess in the more expensive direction. The visible WebGL2 failure state below makes the blank-window case diagnosable instead of silent; decide this during the Linux manual pass, with evidence
- [x] Add a WebGL2 failure state to the CP canvas — `CpRendererUnavailable`, replacing a `console.error`-and-return that left a blank editor with no explanation
- [x] Make the large-project memory message webview-conditional — the "the web version has more headroom" advice was measured on WKWebView and is unsupported (possibly backwards) on Chromium-based WebView2

### Phase 2 — Prove it

- [x] Add a `windows-latest` Rust test job to `ci.yml` for `oristudio-cp`, `treemaker-core`, `treemaker-fold`
- [ ] Add a per-platform launch smoke: install the built artifact, launch it (Xvfb on Linux), wait for a `window.__ORI_READY__` flag the app sets after first paint, fail the job otherwise. **No longer blocked** — the Desktop Build workflow now produces all four artifacts
- [ ] Manual pass on Windows: menu bar renders, `File ▸ Open` works, an export completes, double-click a `.osf`, open a second `.osf` and confirm one window
- [ ] Manual pass on Linux (AppImage and `.deb`): same list, plus confirm the CP canvas renders under software rendering

**Done when:** on Windows and on Linux, a user can open a `.osf` by
double-clicking it, reach every menu command, export a `.cp`, and the CP canvas
renders — with the launch smoke green in CI on all three platforms.

## Known gaps after Phase 1

- **`.osf` has no document icon on Windows.** Tauri v2's `fileAssociations` schema
  accepts only `ext`, `contentTypes`, `name`, `description`, `role`, `rank`,
  `exportedType` and the Android intent filters — there is no `icon` field, so
  there is no config-level way to point the association at `osf.ico`. The file
  is generated and shipped as a bundle resource so the asset exists; wiring it up
  needs an NSIS `installerHooks` script writing the `DefaultIcon` registry key,
  which is deliberately not written blind — a broken installer hook breaks the
  whole Windows installer, which is far worse than a generic icon. Do it during
  the Windows manual pass, where it can be tested.
- **Nothing here has run on WebView2 or WebKitGTK.** Every item above is
  reasoned from source and unit-tested; the manual passes are what convert that
  into evidence. The Wayland window-positioning no-op noted earlier is untouched.
- **The Linux `.desktop` entry needed `%F` added**, found by unpacking the built
  `.deb`. Tauri generates `Exec=ori-studio` with no field code, which the Desktop
  Entry Spec defines as "launch with no arguments" — so the `*.osf` glob, the MIME
  type and the icons were all correct and the path still never reached
  `argv_osf_paths`. Overridden via `bundle.linux.deb.desktopTemplate`. **Confirm in
  the next built `.deb` and inside the AppImage**, which shares the generated entry
  and has no `desktopTemplate` of its own.

**Effort remaining:** the two manual passes, which need a Windows machine and a
Linux machine (or VMs). CI smoke proves the app starts, not that it is usable.
