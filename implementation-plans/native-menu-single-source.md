# Native menu drift — one menu definition for web and native

## Goal

Make the **frontend `menuDefinition.ts` the single source of truth** for the
application menu on *both* surfaces (the web/in-canvas `MenuBar` and the native
macOS menu bar). Today the native menu is a hand-maintained Rust copy that is
**built once, statically, with no workspace awareness** — so the Design and
Crease Pattern menus are always visible and always show TreeMaker/CP actions
regardless of the active editing context, while the web menu correctly hides
them. Generating both surfaces from one definition fixes the visibility bug as a
*consequence* and makes structural drift impossible going forward.

There are **no users yet**: we do not preserve backwards compatibility and can
delete the Rust menu outright.

## Current state (what we're replacing)

Two independent menu definitions that only share a set of action-id strings:

| | Web menu | Native macOS menu |
|---|---|---|
| Defined in | [menuDefinition.ts](../apps/web/src/menus/menuDefinition.ts) — data-driven `MenuDef[]` | [menu.rs](../apps/tauri/src-tauri/src/menu.rs) — hand-built Rust, static |
| Rendered by | [MenuBar.tsx](../apps/web/src/components/MenuBar.tsx) | Tauri `app.set_menu` at startup, never mutated |
| Context-aware? | **Yes** — masked per `activeEditingContext` | **No** — always shows everything |
| Click dispatch | `handleMenuAction(id)` | Rust emits `menu-action` event → same `handleMenuAction(id)` |

### How the web menu gates visibility (the behavior native must match)

Two layers in [workspaceCapabilities.ts](../apps/web/src/lib/workspaceCapabilities.ts):

- Design items are given `visible = treeMode`
  (`activeEditingContext === 'treemaker-tree'`).
- `maskCapabilitiesForContext` force-hides whole command families
  (`optimize.*`, `cp.*`, most `edit.*`) in `bp-tree` / `bp-packing` / `simulate`
  contexts.

Then [MenuBar.tsx](../apps/web/src/components/MenuBar.tsx) prunes: `pruneMenuItems`
drops `visible: false` items and collapses orphan separators, and
`menuHasVisibleItems` drops an **entire top-level menu** when nothing in it is
visible. That is what makes the Design and Crease Pattern menus disappear
outside their context on the web.

### The bug

[menu.rs](../apps/tauri/src-tauri/src/menu.rs) builds every item once in
`setup_menu` with a fixed label/accelerator, calls `app.set_menu`, and never
touches it again (no `set_enabled` / `set_visible` / workspace logic exists
anywhere in `src-tauri`). Native clicks emit a `menu-action` event
([menu.rs:328](../apps/tauri/src-tauri/src/menu.rs)) routed into `handleMenuAction`
via [tauriMenuListener.ts](../apps/web/src/menus/tauriMenuListener.ts). The only
runtime guard is the `capability.enabled` check inside `handleMenuAction`
([menuActions.ts:327](../apps/web/src/commands/menuActions.ts)) — so a Design item
clicked in the Edit workspace is **shown, clickable, and silently no-ops**. This
is the reported "Design menu always visible showing TreeMaker stuff in Edit
workspace."

### Structural drift already present (maintained-by-hand cost)

- **Native-only item:** `cp.foldedPreview` ("Show Folded Preview", ⌘⇧F) at
  [menu.rs:212](../apps/tauri/src-tauri/src/menu.rs) — no entry in
  `menuDefinition.ts`, `MenuActionId`, or a handler.
- **Web-only File items** missing from native: `file.importAdd`,
  `file.detectCpImage`, the `Examples ▸` submenu, and export formats
  `file.exportBps` / `file.exportOri` / `file.exportOrh`.
- **File ▸ Export** is a submenu on web, a flat list on native.
- Design-menu separator before `cp.build` on web, absent on native (cosmetic).

## Decisions (resolved)

1. **`cp.foldedPreview` → dropped.** Folded preview already has a keyboard
   shortcut (`f`) and a UI button, so the native-only menu item is redundant. It
   disappears automatically when `menu.rs` is deleted; nothing is added to
   `menuDefinition.ts`.

## Why generate from the frontend (not teach Rust about workspaces)

The alternative — push capability snapshots over IPC and have Rust toggle
`set_enabled`/`set_visible`, or port the masking logic to Rust — keeps two menu
trees alive and re-introduces drift the moment either side changes. The
capability machinery (`getWorkspaceCapabilities`, `maskCapabilitiesForContext`,
`resolveEditingContext`) already lives in the frontend where the state is. Tauri
is **v2** and `@tauri-apps/api` **^2** is already a dependency, so the JS
`@tauri-apps/api/menu` API can build and set the app menu — including per-item
`enabled`/`visible` and per-item `action` callbacks. Generating from one
definition makes drift structurally impossible.

## Plan

### Phase 1 — Native menu builder from the shared definition

Add `apps/web/src/menus/nativeMenu.ts`:

- `buildNativeMenu(def: MenuDef[], capabilities, overrides)` walks the same
  `getMenuBarDef(overrides)` output the web `MenuBar` uses and constructs a Tauri
  `Menu` via `@tauri-apps/api/menu` (`Menu`, `Submenu`, `MenuItem`,
  `PredefinedMenuItem` for separators).
- Reuse the existing pruning helpers from `MenuBar.tsx` (extract
  `pruneMenuItems` / `menuHasVisibleItems` / `isMenuItemVisible` into a shared
  `menus/menuVisibility.ts` if they're currently local to the component) so web
  and native apply **identical** visible/enabled/prune logic. Set each item's
  `enabled` from `capability.enabled`; omit `visible:false` items entirely
  (macOS submenus don't reflow hidden items cleanly — prune instead of hide).
- Each leaf `MenuItem`'s `action` calls `handleMenuAction(id)` directly, so the
  `menu-action` event round-trip is no longer needed. `command`-type items
  (examples, `file.openExample:<id>`) route by their `actionId` the same way the
  web dropdown does.
- Map shortcuts to Tauri `accelerator` strings (they already come through
  `shortcutLabelForAction`; add a small formatter to the `CmdOrCtrl+…` form Tauri
  expects if the display form differs).

### Phase 2 — Reactive sync hook

Replace `useTauriMenuListener` with `useTauriNativeMenu`:

- Desktop-only (`isDesktopRuntime()` guard, as today).
- Subscribe to the same capability signal `useWorkspaceCapabilities` produces.
- Rebuild and `menu.setAsAppMenu()` whenever the **visible/enabled signature**
  changes — memoize on a cheap serialization of `{id → {visible, enabled}}` so
  the only trigger is a real context/state change (workspace switch, doc gains
  edges, engine ready). Rebuilds are infrequent and native calls are cheap, so no
  flicker concern.
- Delete the `menu-action` event listener; clicks now dispatch via item
  `action` callbacks.

### Phase 3 — Retire the Rust menu

- Delete `setup_menu` / [menu.rs](../apps/tauri/src-tauri/src/menu.rs) and the
  `on_menu_event` emitter.
- Remove `menu::setup_menu(app)?` and the `mod menu;` from
  [lib.rs](../apps/tauri/src-tauri/src/lib.rs).
- If a default-menu flash appears before React mounts, set a minimal
  empty/placeholder app menu at startup and let the frontend replace it on first
  render; otherwise omit.

### Phase 4 — Reconcile leftover drift

- Apply the `cp.foldedPreview` decision (add-with-handler or drop).
- The File-menu gaps (`importAdd`, `detectCpImage`, Examples, `exportBps/Ori/Orh`,
  Export-as-submenu) disappear automatically — native now renders the same
  definition. Confirm each still dispatches.

## Verification

Tool-checkable (self-verify, proceed autonomously):
- `cd apps/web && npx tsc --noEmit` clean.
- `cargo build` for the tauri crate clean after menu.rs removal.
- Any menu unit tests updated to the shared builder.

Browser/desktop checklist (author-owned):
- In each context — Design NUX, TreeMaker tree, BP tree, BP packing, Crease
  Pattern, Simulate — the **native menu bar matches the web `MenuBar` exactly**:
  Design and Crease Pattern menus hidden outside their context; every item's
  enabled/disabled state identical between the two surfaces.
- Native clicks fire the same actions as the web dropdown (spot-check
  `optimize.scale`, `cp.build`, `file.open`, an Examples entry, `cp.checkCamv`).
- Keyboard accelerators still fire (⌘R, ⌘B, ⌘⇧M, etc.).

## Files

- `apps/web/src/menus/menuDefinition.ts` — source of truth (add `cp.foldedPreview`
  if decision = keep)
- `apps/web/src/menus/nativeMenu.ts` — **new**, native builder
- `apps/web/src/menus/menuVisibility.ts` — **new**, shared prune/visibility
  helpers extracted from `MenuBar.tsx`
- `apps/web/src/menus/tauriMenuListener.ts` → `useTauriNativeMenu` (rewritten)
- `apps/web/src/components/MenuBar.tsx` — consume shared helpers (no behavior
  change)
- `apps/tauri/src-tauri/src/menu.rs` — **deleted**
- `apps/tauri/src-tauri/src/lib.rs` — drop `mod menu;` + `setup_menu` call
