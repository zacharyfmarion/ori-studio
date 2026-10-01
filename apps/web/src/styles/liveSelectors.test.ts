/**
 * Every class a global stylesheet styles is one something still renders.
 *
 * A rule for a class nothing names matches nothing, and nothing says so: not
 * the browser, and not the ratchet beside this test, which counts lines rather
 * than whether they do anything. That is how `theme.css` came to hold 820 code
 * lines for a sequence panel deleted months before, an SVG canvas the WebGL
 * renderer replaced, and a selection-transform menu with no component left
 * (found 2026-10-01).
 *
 * It matters more now that the CSS is moving into modules (`docs/styling.md`).
 * A move hashes a block's class names, so a global rule left behind for that
 * block goes dead the moment the move lands. This is what notices.
 *
 * "Names" is deliberately loose, so a failure here is never a false alarm about
 * a class that is merely hard to find: a class counts as used if its name
 * appears anywhere in the app's source, its scripts or `index.html`, comments
 * included. A class built at runtime from a prefix
 * (`step-diagram__line--${kind}`) counts through the prefix. Tests do not count:
 * a test that checks a class is absent would otherwise keep its rule alive.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vitest's root is `apps/web`. Resolved from there rather than from
// `import.meta.url`, which is not a file: URL once Vite has transformed this.
const WEB = process.cwd();
const SRC = resolve(WEB, 'src');

/** Markup a library renders, so its classes are named in the library, not here. */
const THIRD_PARTY = /^(dv-|dockview-)/u;

/**
 * Classes set at runtime without being spelled out anywhere this scan can see,
 * each with where they come from. A new entry needs that reason; "the test
 * failed" is not one.
 */
const RUNTIME_CLASSES: Record<string, string> = {};

function filesUnder(dir: string, keep: (path: string) => boolean): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter(keep)
    .map((path) => resolve(dir, path));
}

function sourceText(): string {
  const app = filesUnder(
    SRC,
    (path) => /\.(tsx?|jsx?|mjs|html)$/u.test(path) && !/\.test\.|(^|[\\/])test[\\/]/u.test(path)
  );
  const scripts = filesUnder(resolve(WEB, 'scripts'), (path) => /\.(m?js|ts)$/u.test(path));
  return [...app, ...scripts, resolve(WEB, 'index.html')]
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
}

/**
 * The classes a stylesheet's selectors name. At-rule preludes, attribute values
 * and quoted strings are not selectors, and a class inside `:not(…)` is not one
 * the rule needs to exist: `:not(.gone)` still matches.
 */
function styledClasses(css: string): Set<string> {
  const classes = new Set<string>();
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//gu, '');
  for (const match of uncommented.matchAll(/([^{}]+)\{/gu)) {
    const selector = (match[1] ?? '').trim();
    if (selector.startsWith('@')) continue;
    const bare = selector
      .replace(/\[[^\]]*\]/gu, '')
      .replace(/(['"]).*?\1/gu, '')
      .replace(/:not\((?:[^()]|\([^()]*\))*\)/gu, '');
    for (const name of bare.matchAll(/\.([A-Za-z_][\w-]*)/gu)) {
      if (name[1]) classes.add(name[1]);
    }
  }
  return classes;
}

describe('global stylesheets', () => {
  it('style only classes something still names', () => {
    const source = sourceText();
    const words = new Set(source.match(/[A-Za-z_][\w-]*/gu));
    const prefixes = [
      ...source.matchAll(/([A-Za-z_][\w-]*?(?:--|__|-))\$\{/gu),
      ...source.matchAll(/['"`]([A-Za-z_][\w-]*(?:--|__|-))['"`]\s*\+/gu),
    ].map((match) => match[1] ?? '');
    const used = (name: string) =>
      words.has(name) ||
      THIRD_PARTY.test(name) ||
      name in RUNTIME_CLASSES ||
      prefixes.some((prefix) => prefix !== '' && name.startsWith(prefix) && name !== prefix);

    const sheets = filesUnder(
      SRC,
      (path) => path.endsWith('.css') && !path.endsWith('.module.css')
    );
    // Guard against passing vacuously on a wrong path.
    expect(sheets.length, 'found no global stylesheet under src/').toBeGreaterThan(0);

    const unused: Record<string, string[]> = {};
    for (const sheet of sheets) {
      const dead = [...styledClasses(readFileSync(sheet, 'utf8'))].filter((name) => !used(name));
      if (dead.length > 0) unused[sheet.slice(SRC.length + 1)] = dead.sort();
    }

    expect(
      unused,
      'these classes are styled but nothing renders them, so their rules match nothing. ' +
        'Delete the rules — or, if the class is set at runtime where no scan can see it, ' +
        'add it to RUNTIME_CLASSES with where it comes from'
    ).toEqual({});
  });
});
