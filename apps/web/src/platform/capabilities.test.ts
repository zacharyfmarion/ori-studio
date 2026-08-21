import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { surfaceSupports } from './capabilities';

describe('surface capabilities', () => {
  it('keeps both Tauri shells on the native engine', () => {
    // The reason the iOS port is worth doing at all: the same fold measured 18s
    // through the wasm worker and ~1.5s natively. A widening that quietly moved
    // iOS onto the worker would have removed the win and left the app looking
    // like a slow PWA.
    expect(surfaceSupports('nativeCpEngine', 'desktop')).toBe(true);
    expect(surfaceSupports('nativeCpEngine', 'ios')).toBe(true);
    expect(surfaceSupports('nativeCpEngine', 'web')).toBe(false);
  });

  it('does not let iOS inherit desktop-only window chrome or the updater', () => {
    // The two things an iPad genuinely does not have, and the two it took by
    // default while it reported `'desktop'`.
    expect(surfaceSupports('nativeWindowChrome', 'ios')).toBe(false);
    expect(surfaceSupports('selfUpdate', 'ios')).toBe(false);
    expect(surfaceSupports('nativeWindowChrome', 'desktop')).toBe(true);
    expect(surfaceSupports('selfUpdate', 'desktop')).toBe(true);
  });

  it('keeps browser-shaped behaviour on the browser', () => {
    expect(surfaceSupports('browserHistoryRouting', 'web')).toBe(true);
    expect(surfaceSupports('shareLinks', 'web')).toBe(true);
    expect(surfaceSupports('phoneGate', 'web')).toBe(true);
    expect(surfaceSupports('nativeFileIo', 'web')).toBe(false);
  });
});

/**
 * The widening is only worth anything if it stays audited.
 *
 * `RuntimeSurface` gaining `'ios'` broke every row of `SURFACE_CAPABILITIES` and
 * every `isDesktopRuntime()` call, which is what forced each site to be decided
 * rather than inherited. A bare `surface === 'desktop'` written afterwards gets
 * none of that: it compiles, it reads as deliberate, and it silently answers
 * "no" for a surface nobody considered — which is exactly how an iPad ended up
 * with the desktop menu bar, the desktop updater and the desktop close guard.
 *
 * So the comparison is confined to `platform/`, where the surface is the subject
 * rather than a proxy for something else. Everywhere else, ask
 * {@link surfaceSupports} for the capability the code actually needs.
 */
describe('no surface comparisons outside platform/', () => {
  const platformDir = dirname(new URL(import.meta.url).pathname);
  const srcDir = join(platformDir, '..');
  const SURFACE_COMPARISON = /[!=]==\s*'(web|desktop|ios)'|'(web|desktop|ios)'\s*[!=]==/;

  /**
   * Comments are prose about this rule as often as they are code, so matching
   * them produces false alarms — the first run of this test flagged the comment
   * explaining why the line below it had stopped comparing surfaces.
   *
   * Crude on purpose. It also eats the tail of a `'https://…'` literal, which can
   * only ever cause a *missed* offender on that one line, never a spurious one.
   */
  function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  }

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return full === platformDir ? [] : sourceFiles(full);
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
      return [full];
    });
  }

  it('routes every platform branch through a named capability', () => {
    const offenders = sourceFiles(srcDir)
      .filter((file) => SURFACE_COMPARISON.test(withoutComments(readFileSync(file, 'utf8'))))
      .map((file) => relative(srcDir, file));

    expect(offenders).toEqual([]);
  });
});
