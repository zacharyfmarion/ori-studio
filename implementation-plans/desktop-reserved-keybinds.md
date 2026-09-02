# Desktop Reserved Keybinds

## Goal

Let the desktop build bind the chords the web build has to refuse, because the
reason for refusing them — browser chrome owns the key — does not exist in a
Tauri window.

`classifyReservedKey` (`apps/web/src/keyboard/shortcuts.ts:1167`) is a pure
function of the chord. It answers "does the browser own this" for both surfaces,
so the desktop app inherits a restriction it does not have.

## What is refused today

Two lists, both hardcoded in `classifyReservedKey`:

**Hard-reserved** — Settings ▸ Shortcuts refuses the capture outright
(`SettingsModal.tsx:700`), and an Oriedita import marks the row `reserved-chord`
(`importPlan.ts:341`):

| Chord | What the browser does with it |
| --- | --- |
| `Mod+L` | Focus the address bar |
| `Mod+W` | Close the tab |
| `Mod+T` | New tab |
| `Mod+Shift+T` | Reopen closed tab |
| `Mod+Shift+I` | DevTools |
| `F5` | Reload |

**Soft-reserved** — assigned, with a warning toast:

| Chord | What the browser does with it |
| --- | --- |
| `Mod+R` | Reload |
| `Mod+Shift+R` | Hard reload |

`Mod+R` is not hypothetical: it is a *shipped default* — `optimize.scale` under
the Ori Studio layout (`shortcuts.ts:262`) and `continuousSymmetricDrawAction`
(Reflect Through Lines) under the Oriedita layout (`shortcuts.ts:182`). It is
the one entry `getShortcutRegistryDiagnostics().reservedDefaultChords` reports,
and on the web it reloads the page instead of running the action.

### Resolved: the web list was missing one of its own defaults

Two shipped defaults sit next to each other in the File menu and look alike;
only one is actually taken. Confirmed by hand:

- `file.new` → `Mod+N` (`shortcuts.ts:238`) — **taken.** Opens a new browser
  window; the page never sees the keydown. So the accelerator is inert on the
  web build today, and has been.
- `file.settings` → `Mod+,` (`shortcuts.ts:248`) — **not taken.** Chrome's
  Preferences does not claim it away from a focused page.

Nothing about the shape of a chord predicts which it is, so `Mod+N` is added to
the web table and nothing else is added on suspicion.

`Mod+N` stays the default for New rather than moving: it is the conventional
chord everywhere, it is live in the desktop app, and the menu item is reachable
by mouse in both. The registry guard therefore records it as a known-inert web
default (`WEB_INERT_DEFAULTS` in `shortcutRegistry.test.ts`) instead of failing
— which keeps the set from growing by accident, since a *new* browser-inert
default fails the guard until someone adds it there deliberately.

## What the desktop actually allows — measured

Measured in real macOS WKWebView (`swiftc` harness, `NSApp.sendEvent` with
synthesized `NSEvent`s, page-side `keydown` listener reporting through a
`WKScriptMessageHandler`):

- **Every chord in both tables above reaches the page**, plus `Mod+N`, `Mod+M`,
  `Mod+H`, `Mod+Q`, `Mod+Alt+I`, `Mod+Shift+N`, `Mod+1`, `Mod+[`, `Mod+Shift+W`.
  Nothing in a bare WKWebView is reserved.
- **A page-level `preventDefault()` beats a native menu key equivalent.** With a
  menu item on `Cmd+T`, the item fired only while the page let the event pass;
  with `preventDefault()` the item never fired.
- **That includes `Cmd+Q`.** Without `preventDefault()` the app terminated at
  `Cmd+Q`; with it, the app survived the whole sweep. The shortcut dispatcher
  calls `event.preventDefault()` on every claimed chord
  (`shortcutDispatcher.ts:107`), so a user who binds `Cmd+Q` **kills Quit**.

This is the Tauri path, not just a bare WKWebView: `wry`'s `WryWebView`
overrides `performKeyEquivalent:` only for *child* webviews and otherwise calls
`super` (`wry-0.55.1/src/wkwebview/class/wry_web_view.rs:44`). Ori Studio has
one main webview.

So on macOS the desktop reserved set is not the browser's — it is the three
predefined items in our own app submenu (`nativeMenu.ts:158-162`): `Cmd+Q`,
`Cmd+H`, `Cmd+Alt+H`. Tauri's default menu, which does carry `Cmd+W`
(Close Window) and `Cmd+M` (Minimize), is installed at startup and then replaced
wholesale by `setAsAppMenu` (`useTauriNativeMenu.ts:70`), so after first render
neither chord is claimed by anything.

### Windows and Linux — unmeasured

Tauri's default menu is `#[cfg(target_os = "macos")]` (`tauri-2.11.2/src/app.rs:2236`)
and `useTauriNativeMenu` is a no-op off macOS, so on Windows and Linux **no
native menu exists** and nothing app-level claims a chord. What is left is the
engine:

- **Windows / WebView2** ships browser accelerator keys on by default
  (`F5`, `Ctrl+R`, `Ctrl+Shift+I`, `F12`, `Ctrl+P`, `Ctrl+F`, `Ctrl+S`,
  `Ctrl+O`, zoom). They can be turned off wholesale — `wry` exposes
  `with_browser_accelerator_keys(false)` (`wry-0.55.1/src/lib.rs:1720`), and
  although Tauri 2.11.2 does not surface it on its own builder, the escape hatch
  is `PlatformWebview::controller()` → `ICoreWebView2Settings3::SetAreBrowserAcceleratorKeysEnabled(false)`
  (`tauri-2.11.2/src/webview/mod.rs:180`). Note `Ctrl+S` and `Ctrl+O` are
  *already* app defaults, so this may be an existing Windows bug.
- **Linux / WebKitGTK** binds editing commands and, with developer extras on,
  the inspector (`Ctrl+Shift+I` / `F12`).

Neither is measured here. Phase 4 measures them.

## Approach

Make the classification a function of the surface, not of the chord alone, and
give the desktop its own (much shorter, macOS-only) table.

```ts
export function classifyReservedKey(
  chord: KeyChord,
  context: ReservedKeyContext = defaultReservedKeyContext()
): ReservedKeyClassification
```

with `ReservedKeyContext = { surface: RuntimeSurface; nativeAppMenu: boolean }`,
defaulted from `getRuntimeSurface()` / `usesNativeAppMenu()`
(`platform/runtime.ts`). Explicit context, defaulted — the tests need to pin
both surfaces without touching globals, and every existing call site keeps
working unchanged.

Three tables instead of one:

| Surface | Hard-reserved | Soft-reserved |
| --- | --- | --- |
| `web` | `Mod+L` `Mod+W` `Mod+T` `Mod+Shift+T` `Mod+Shift+I` `F5` | `Mod+R` `Mod+Shift+R` |
| `desktop`, native app menu (macOS) | `Cmd+Q` `Cmd+H` `Cmd+Alt+H` | — |
| `desktop`, no native menu (Win/Linux) | — | *filled by Phase 4* |

The desktop entries are hard-reserved for the opposite reason to the web ones:
the chord *is* capturable, and capturing it is what breaks Quit and Hide. The
copy has to say that, not "reserved by the browser".

**Defaults do not diverge per surface.** One shipped layout for both builds, so
the printed shortcut sheet, the Oriedita import, and the settings table mean the
same thing everywhere. The surface decides what a user may *add*, not what they
start with.

Storage needs no change: overrides are per-origin `localStorage`
(`store/shortcutStore.ts:15`), and web and desktop are different origins, so a
desktop-only binding cannot leak into a browser session. If one ever did, the
chord simply never arrives and the binding is inert.

## Affected Areas

- `apps/web/src/keyboard/shortcuts.ts` — `classifyReservedKey`, the new context
  type, and `getShortcutRegistryDiagnostics` (`:804`), which classifies without
  a surface today.
- `apps/web/src/components/SettingsModal.tsx:699` — capture path; needs
  surface-aware copy and, on web, a pointer to the desktop app.
- `apps/web/src/lib/orieditaImport/importPlan.ts:341` — `reserved-chord`
  rejection. Oriedita is a desktop Java app, so imported configs are full of
  desktop-shaped chords; this is where the win is largest.
- `apps/web/src/components/settings/OrieditaImportDialog.tsx` — the reason copy.
- `apps/web/public/locales/en/dialogs.json:348` — `reserved` /`softReserved`
  strings, plus the new desktop-side ones. Inline English source, so
  `npm run i18n:extract` then `i18n:check`.
- `apps/web/src/keyboard/shortcuts.test.ts:178,493` and
  `shortcutRegistry.test.ts:38` — pin both surfaces rather than the default.
- Phase 4 only: `apps/tauri/src-tauri/src/lib.rs` (`with_webview` hook).

## Checklist

- [x] Phase 1 — surface-aware classification. `ReservedKeyHost`, the four host
      tables, `isWindowsPlatform`, and `Mod+N` added to the web set. Registry
      guard split into a strict desktop invariant and a named web exception.
- [ ] Phase 2 — copy. "reserved by the browser" only on web, and say the desktop
      app can bind it. On desktop, a distinct message for `Cmd+Q`/`Cmd+H` naming
      the menu command that would stop working. Extract + `i18n:check`.
- [ ] Phase 3 — make the inert accelerator visible in the shortcuts table rather
      than silently printing a chord that cannot fire on this host.
- [ ] Phase 4 — the Oriedita import inherits the classification; check its
      rejection copy and tests, since an Oriedita config is full of
      desktop-shaped chords.
- [ ] Follow-up, needs a Windows machine — measure the WebView2 accelerator set
      for real and decide between the soft warnings shipped here and disabling
      them outright with `SetAreBrowserAcceleratorKeysEnabled(false)` through
      `with_webview`. `Ctrl+S`/`Ctrl+O` are shipped defaults, so if the
      documented list is right they are already broken there.
- [ ] Validation: `npm run lint:web`, `npm run typecheck:web`, `npm run test:web`,
      `npm run i18n:check`.
