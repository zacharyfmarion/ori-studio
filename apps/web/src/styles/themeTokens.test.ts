/**
 * Every custom property the stylesheet reads must be one it defines.
 *
 * A `var()` naming a property that does not exist, with no fallback, makes the
 * whole declaration invalid at computed-value time — the browser drops it and
 * uses the inherited or initial value instead. Nothing is logged, and the rule
 * simply does not apply.
 *
 * The bug that motivated this: `.cp-diagnostic-hud` asked for
 * `width: min(420px, calc(100% - var(--space-8)))`, and the spacing scale stops
 * at `--space-6`. Both `width` and `max-width` were dropped, so the panel was
 * `width: auto` with `max-width: none` and the 420px cap had never once applied.
 * It went unnoticed for as long as it did because shrink-to-fit happened to look
 * reasonable — the in-flow rows made the box about as wide as the longest
 * message. Windowing the list moved the rows out of flow, they stopped
 * contributing intrinsic width, and the panel collapsed to the width of its
 * headline.
 *
 * Failing loudly here is cheap; the alternative is finding out through a layout
 * that looks slightly wrong in a way nobody can place.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vitest's root is `apps/web`. Resolved from there rather than from
// `import.meta.url`, which is not a file: URL once Vite has transformed this.
const THEME_CSS = resolve(process.cwd(), 'src/styles/theme.css');

/** `--foo: value;` — a definition, not a use. */
const DEFINITION = /^\s*(--[\w-]+)\s*:/gmu;
/** `var(--foo)` or `var(--foo, fallback)`; the fallback makes it safe. */
const REFERENCE = /var\(\s*(--[\w-]+)\s*([,)])/gu;

/** Set on the element by Radix at runtime; a stylesheet never defines these. */
const RUNTIME_INJECTED = /^--radix-/u;

/**
 * Undefined tokens this check has found but not fixed, with the number of
 * declarations each one silently kills. Every entry is a real bug —
 * `--shadow-soft` alone means several panels render with no shadow — but fixing
 * them means choosing values, which is a design decision rather than a typo
 * correction, and usually one for whoever owns that surface.
 *
 * The point of listing them is that the number is visible in a diff when it
 * changes. Lower one as it is fixed; delete the entry at zero. It works like
 * `OVERSIZED_PANELS` in `eslint.config.js`, including the part where a merge can
 * grow it: this list is repo-wide, so a branch that never touched `theme.css`
 * can still trip it after merging a branch that did.
 *
 * **If that is why you are here:** the offending token was almost certainly
 * introduced by the change you merged, not by yours. Add it with a one-line note
 * saying where it came from and what it breaks, and move on — or fix it, if the
 * right value is obvious.
 */
const KNOWN_MISSING: Record<string, number> = {
  '--border-muted': 2,
  '--font-sans': 4,
  // From main's share-a-CP-as-URL feature (97d709db), caught on merge. Kills
  // `font-family` on the share-link input, so the base64 payload — the one place
  // a monospace font actually matters — renders proportional.
  '--font-mono': 1,
  '--shadow-soft': 1,
  '--surface-base': 1,
  '--surface-raised': 1,
};

describe('theme.css custom properties', () => {
  it('defines every property it reads without a fallback', () => {
    const source = readFileSync(THEME_CSS, 'utf8');
    // Guard against the whole test passing vacuously on a wrong path or an
    // empty read — an assertion over nothing is worse than no assertion.
    expect(source.length, 'theme.css looks empty; check THEME_CSS').toBeGreaterThan(10_000);

    // Comments are prose, not declarations. This one names `--space-8` while
    // explaining that it does not exist, which the scanner would otherwise
    // report as the very bug the comment is describing.
    const css = source.replace(/\/\*[\s\S]*?\*\//gu, '');

    const defined = new Set<string>();
    for (const match of css.matchAll(DEFINITION)) {
      if (match[1]) defined.add(match[1]);
    }

    const missing = new Map<string, number>();
    for (const match of css.matchAll(REFERENCE)) {
      const name = match[1];
      // `var(--x, fallback)` still renders when `--x` is absent, so it is not a
      // silent drop and not this test's business.
      if (!name || match[2] === ',' || defined.has(name)) continue;
      if (RUNTIME_INJECTED.test(name)) continue;
      missing.set(name, (missing.get(name) ?? 0) + 1);
    }

    expect(
      Object.fromEntries(missing),
      'a var() here names a property theme.css never defines, so every declaration ' +
        'using it is dropped by the browser and the rule silently does not apply — ' +
        'define the token, give the var() a fallback, or, if it arrived with a merge ' +
        'and is not yours to value, add it to KNOWN_MISSING with a note'
    ).toEqual(KNOWN_MISSING);
  });
});
