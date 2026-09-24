import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LANDING_FIGURE_WIDTHS } from './LandingFigure';

/**
 * `srcset` names a file per width, and a missing one fails silently in the browser — it
 * falls back to a neighbouring candidate or to the 3456px master. So the variants
 * `scripts/gen-landing-images.sh` writes are checked here instead.
 */

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LANDING_DIR = join(WEB_ROOT, 'public', 'landing');
const files = readdirSync(LANDING_DIR);
const masters = files.filter((file) => /-(light|dark)\.webp$/.test(file));

describe('landing figure assets', () => {
  it('has a master for both themes of every figure', () => {
    expect(masters.length).toBeGreaterThan(0);
    for (const master of masters) {
      const twin = master.endsWith('-dark.webp')
        ? master.replace(/-dark\.webp$/, '-light.webp')
        : master.replace(/-light\.webp$/, '-dark.webp');
      expect(files).toContain(twin);
    }
  });

  it('has every responsive width for every master, and no orphaned variant', () => {
    const expected = masters.flatMap((master) =>
      LANDING_FIGURE_WIDTHS.map((width) => master.replace(/\.webp$/, `-${width}w.webp`))
    );
    const variants = files.filter((file) => /-\d+w\.webp$/.test(file));
    expect(variants.sort()).toEqual(expected.sort());
  });

  it('generates the widths the component asks for', () => {
    const script = readFileSync(join(WEB_ROOT, 'scripts', 'gen-landing-images.sh'), 'utf8');
    const widths = /^widths=\(([\d ]+)\)$/m.exec(script)?.[1].split(' ').map(Number);
    expect(widths).toEqual([...LANDING_FIGURE_WIDTHS]);
  });
});
