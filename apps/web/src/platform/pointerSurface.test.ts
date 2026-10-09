import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { COARSE_POINTER_QUERY, TOUCH_TARGET_PX, isCoarsePointerSurface, type MediaHost } from './pointerSurface';

/** A host that answers one query and records what it was asked. */
function host(matches: boolean, asked: string[] = []): MediaHost {
  return {
    matchMedia: ((query: string) => {
      asked.push(query);
      return { matches } as MediaQueryList;
    }) as MediaHost['matchMedia'],
  };
}

describe('the coarse-pointer surface', () => {
  it('asks about the primary pointer, not about any pointer', () => {
    // `any-pointer: coarse` would answer "is a finger available at all", which is
    // true of every touchscreen laptop — a mouse-driven device that has no need
    // for the touch fallbacks this predicate turns on.
    const asked: string[] = [];

    isCoarsePointerSurface(host(true, asked));

    expect(asked).toEqual([COARSE_POINTER_QUERY]);
    expect(COARSE_POINTER_QUERY).toBe('(pointer: coarse)');
  });

  it('reports coarse on a touch-first device and fine on a pointer one', () => {
    expect(isCoarsePointerSurface(host(true))).toBe(true);
    expect(isCoarsePointerSurface(host(false))).toBe(false);
  });

  it('falls back to the pointer behaviour where media queries cannot be answered', () => {
    // A host with no `matchMedia` must not be told it is a touch device: the
    // fallbacks it would switch on (a locked dock, fat sashes) are worse than
    // the default for anything headless.
    expect(isCoarsePointerSurface(null)).toBe(false);
  });

  it('reads the live host when none is given', () => {
    const matchMedia = vi.fn(() => ({ matches: true }) as MediaQueryList);
    vi.stubGlobal('matchMedia', matchMedia);

    expect(isCoarsePointerSurface()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith(COARSE_POINTER_QUERY);

    vi.unstubAllGlobals();
  });
});

describe('the touch target', () => {
  it('is the stylesheet’s `--touch-target`, which sizes every control on a coarse pointer', () => {
    // Vitest's root is `apps/web` (as `styles/globalStylesheets.test.ts` reads it).
    const theme = readFileSync(resolve(process.cwd(), 'src/styles/theme.css'), 'utf8');
    expect(theme.match(/--touch-target:\s*(\d+)px;/)?.[1]).toBe(String(TOUCH_TARGET_PX));
    expect(TOUCH_TARGET_PX).toBe(44);
  });
});
