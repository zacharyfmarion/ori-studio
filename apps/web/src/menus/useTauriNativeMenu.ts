import { useEffect, useMemo, useRef } from 'react';
import { getMenuBarDef } from './menuDefinition';
import { buildNativeMenu, nativeMenuSignature } from './nativeMenu';
import { useShortcutStore } from '../store/shortcutStore';
import { selectWorkspaceCapabilities } from '../store/workspaceStore/capabilities';
import { useWorkspaceCapabilities } from '../store/workspaceStore/useWorkspaceCapabilities';
import { useWorkspaceStore } from '../store/workspaceStore';
import { isDesktopRuntime } from '../platform/runtime';

/**
 * Keeps the native macOS menu in sync with the active editing context. On
 * desktop it rebuilds the OS menu from the same definition + capabilities as the
 * web {@link MenuBar} whenever the visible/enabled signature changes — so the
 * Design and Crease Pattern menus appear and disappear on the native bar exactly
 * as they do in-canvas. A no-op on the web surface.
 */
export function useTauriNativeMenu(): void {
  const overrides = useShortcutStore((state) => state.overrides);
  const capabilities = useWorkspaceCapabilities();
  const menuDef = useMemo(() => getMenuBarDef(overrides), [overrides]);

  // The signature collapses the frequently-churning capability object down to
  // just what changes the menu's structure/labels/enablement, so selecting a
  // line or pushing history doesn't thrash the OS menu — only a real context
  // change does. The effect keys on it and reads fresh store state at build
  // time, avoiding stale closures without widening the dependency list.
  const signature = useMemo(
    () => nativeMenuSignature(menuDef, capabilities, overrides),
    [menuDef, capabilities, overrides]
  );
  const buildToken = useRef(0);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    const token = (buildToken.current += 1);
    const freshCapabilities = selectWorkspaceCapabilities(useWorkspaceStore.getState());
    const freshOverrides = useShortcutStore.getState().overrides;
    void buildNativeMenu(freshCapabilities, freshOverrides)
      .then(async (menu) => {
        // A newer rebuild started while this one was in flight — drop this menu
        // so setAsAppMenu calls can't land out of order.
        if (token !== buildToken.current) return;
        await menu.setAsAppMenu();
      })
      .catch((error: unknown) => {
        console.warn('Failed to update native menu', error);
      });
  }, [signature]);
}
