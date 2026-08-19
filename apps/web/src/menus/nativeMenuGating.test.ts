import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The app's menu commands must reach the user on exactly one surface, and which
 * one is a *platform* question rather than a desktop/web one.
 *
 * This is the shape of a bug that shipped. `WorkspaceShell` rendered
 * `{isDesktop ? <span/> : <MenuBar />}`, where `isDesktop` was
 * `getRuntimeSurface() === 'desktop'` — every desktop runtime, not just macOS.
 * The native menu that was supposed to replace it is built from macOS-only
 * predefined items (`Services`, `HideOthers`, `ShowAll`) and attached with
 * `setAsAppMenu`, so on Windows and Linux there was no menu at all: File ▸ Open,
 * every export format, and Settings — which has no toolbar affordance — were
 * unreachable, and the attachment failure went to `console.warn`.
 *
 * The two sides have to agree, or the failure is silent in both directions: gate
 * them differently and you get either no menu or two menus, and neither shows up
 * in a unit test that renders one of them. `usesNativeAppMenu` is the single
 * predicate, so what is checkable is that both sides ask it.
 */

const here = dirname(new URL(import.meta.url).pathname);
const shell = readFileSync(join(here, '../components/WorkspaceShell.tsx'), 'utf8');
const nativeMenuHook = readFileSync(join(here, 'useTauriNativeMenu.ts'), 'utf8');

/** Runtime checks that answer "is this the desktop app", ignoring platform. */
const PLATFORM_BLIND = /getRuntimeSurface\(\)\s*===\s*'desktop'|isDesktopRuntime\(\)/;

describe('native menu gating', () => {
  it('renders the in-app MenuBar unless the OS menu can host the commands', () => {
    // The ternary that chooses between the plain title and <MenuBar />.
    const branch = /\{(\w+)\s*\?\s*<span className="toolbar__title">[\s\S]*?<MenuBar \/>\}/.exec(
      shell,
    );
    expect(branch, 'the MenuBar branch in WorkspaceShell has moved').not.toBeNull();

    const condition = branch![1];
    // Whatever the local is called, it must be bound to the platform predicate.
    expect(shell).toMatch(new RegExp(`const ${condition}\\s*=\\s*usesNativeAppMenu\\(`));
  });

  it('does not decide the menu surface from the runtime alone', () => {
    // `isDesktop` here would hide <MenuBar /> on Windows and Linux, which have
    // no native menu to fall back to.
    expect(PLATFORM_BLIND.test(shell)).toBe(false);
  });

  it('builds the native menu only where it can attach', () => {
    // Not merely "on desktop": building it on Windows/Linux would raise a second
    // menu alongside the in-app one the user is already using.
    expect(nativeMenuHook).toMatch(/if\s*\(!usesNativeAppMenu\(\)\)\s*return;/);
    expect(PLATFORM_BLIND.test(nativeMenuHook)).toBe(false);
  });

  it('reports a native menu failure instead of only logging it', () => {
    // On macOS this is the only menu, so a swallowed failure removes every
    // command from the app with nothing to show for it.
    expect(nativeMenuHook).toMatch(/reportError\(\s*error,\s*\{\s*surface:\s*'shell:native-menu'/);
    expect(nativeMenuHook).not.toMatch(/console\.warn/);
  });
});
