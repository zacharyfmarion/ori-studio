/**
 * The global stylesheets only shrink.
 *
 * A component's styles are a CSS module beside it (`docs/styling.md`). The
 * global stylesheets hold what is global by nature — tokens, resets, the app
 * shell, third-party markup — and the rules that have not moved into modules
 * yet. Each has a ceiling here, counted in code lines: comments and blank lines
 * are free, so explaining a rule never costs anything and deleting an
 * explanation never helps.
 *
 * Growing past a ceiling fails: the new rule belongs in a module. Shrinking
 * well below one fails too, until the ceiling is lowered to match, so the room
 * a migration frees cannot quietly fill up again.
 *
 * Like `max-lines` on the panels (`eslint.config.js`), this is a prompt at the
 * moment of growth, not a budget. A rule that really is global by nature is a
 * reason to raise a ceiling, with a line in the PR saying why. The ceilings are
 * repo-wide, so a merge can trip them without either side having broken the
 * rule: take the merged count.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vitest's root is `apps/web`. Resolved from there rather than from
// `import.meta.url`, which is not a file: URL once Vite has transformed this.
const SRC = resolve(process.cwd(), 'src');

/** The code lines each global stylesheet may hold, by its path under `src/`. */
const CEILINGS: Record<string, number> = {
  'App.css': 780,
  'components/CpDetectImportModal.css': 395,
  'components/landing/WelcomeLanding.css': 602,
  'index.css': 62,
  'site/site.css': 306,
  'styles/sonner.css': 55,
  'styles/theme.css': 5572,
};

/** How far under its ceiling a stylesheet may sit before the ceiling follows it down. */
const SLACK = 25;

function codeLines(css: string): number {
  return css
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => line.trim() !== '').length;
}

function globalStylesheets(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.css') && !path.endsWith('.module.css'))
    .map((path) => path.split(sep).join('/'))
    .sort();
}

describe('global stylesheets', () => {
  it('adds none', () => {
    expect(
      globalStylesheets(),
      'a new plain stylesheet is global: every rule in it can reach every component. ' +
        'Style the component with a CSS module beside it (Name.module.css) instead'
    ).toEqual(Object.keys(CEILINGS).sort());
  });

  it.each(Object.entries(CEILINGS))('%s only shrinks', (path, ceiling) => {
    const lines = codeLines(readFileSync(resolve(SRC, path), 'utf8'));
    expect(
      lines,
      `${path} holds ${lines} code lines, past its ceiling of ${ceiling}. Style the ` +
        'component with a CSS module beside it (docs/styling.md); if the rule is global ' +
        'by nature, raise the ceiling and say why in the PR'
    ).toBeLessThanOrEqual(ceiling);
    expect(
      lines,
      `${path} is down to ${lines} code lines, more than ${SLACK} under its ceiling of ` +
        `${ceiling}. Lower the ceiling to ${lines}, so the room cannot fill up again`
    ).toBeGreaterThanOrEqual(ceiling - SLACK);
  });
});
