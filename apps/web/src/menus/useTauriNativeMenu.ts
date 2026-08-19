import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { getMenuBarDef, type MenuTranslate } from './menuDefinition';
import { buildNativeMenu, nativeMenuSignature } from './nativeMenu';
import { useShortcutStore } from '../store/shortcutStore';
import { selectWorkspaceCapabilities } from '../store/workspaceStore/capabilities';
import { useWorkspaceCapabilities } from '../store/workspaceStore/useWorkspaceCapabilities';
import { useWorkspaceStore } from '../store/workspaceStore';
import { usesNativeAppMenu } from '../platform/runtime';
import { reportError } from '../monitoring';

/**
 * Keeps the native macOS menu in sync with the active editing context. On
 * desktop it rebuilds the OS menu from the same definition + capabilities as the
 * web {@link MenuBar} whenever the visible/enabled signature changes — so the
 * Design and Crease Pattern menus appear and disappear on the native bar exactly
 * as they do in-canvas. A no-op on the web surface.
 *
 * **macOS only, and that is load-bearing on both sides.** `buildNativeMenu`
 * prepends the standard app submenu, whose `Services` / `HideOthers` / `ShowAll`
 * items are macOS-only predefined items, and `setAsAppMenu` does not attach the
 * same way elsewhere. Windows and Linux therefore render `<MenuBar />` in the
 * toolbar instead — so running this there would not merely fail, it would build a
 * *second* menu alongside the one the user is already using. `usesNativeAppMenu`
 * is the single predicate both sides read.
 */
export function useTauriNativeMenu(): void {
  const { t } = useTranslation();
  const translate = useCallback<MenuTranslate>((key, defaultValue) => t(key, defaultValue), [t]);
  const overrides = useShortcutStore((state) => state.overrides);
  // Accelerators come from the same resolution the canvas uses, so the native bar
  // follows the Oriedita-defaults toggle. Subscribed, not read at build time, or
  // the menu would keep the chords it was built with until something else
  // happened to invalidate the signature.
  const defaultsSource = useShortcutStore((state) => state.defaultsSource);
  const resolution = useMemo(() => ({ overrides, defaultsSource }), [overrides, defaultsSource]);
  const capabilities = useWorkspaceCapabilities();
  // Translated menu labels so the native macOS bar localizes with the app; the signature
  // below then includes the localized text, so switching language rebuilds the OS menu.
  const menuDef = useMemo(() => getMenuBarDef(resolution, translate), [resolution, translate]);

  // The signature collapses the frequently-churning capability object down to
  // just what changes the menu's structure/labels/enablement, so selecting a
  // line or pushing history doesn't thrash the OS menu — only a real context
  // change does. The effect keys on it and reads fresh store state at build
  // time, avoiding stale closures without widening the dependency list.
  const signature = useMemo(
    () => nativeMenuSignature(menuDef, capabilities, resolution),
    [menuDef, capabilities, resolution],
  );
  const buildToken = useRef(0);

  useEffect(() => {
    if (!usesNativeAppMenu()) return;
    const token = (buildToken.current += 1);
    const freshCapabilities = selectWorkspaceCapabilities(useWorkspaceStore.getState());
    const { overrides: freshOverrides, defaultsSource: freshSource } = useShortcutStore.getState();
    void buildNativeMenu(
      freshCapabilities,
      { overrides: freshOverrides, defaultsSource: freshSource },
      translate,
    )
      .then(async (menu) => {
        // A newer rebuild started while this one was in flight — drop this menu
        // so setAsAppMenu calls can't land out of order.
        if (token !== buildToken.current) return;
        await menu.setAsAppMenu();
      })
      .catch((error: unknown) => {
        // Reported, not warned: on macOS this is the *only* menu, so a failure
        // here silently removes every File/Edit/View command from the app. A
        // console warning in a packaged desktop build reaches nobody.
        reportError(error, { surface: 'shell:native-menu' });
      });
  }, [signature, translate]);
}
