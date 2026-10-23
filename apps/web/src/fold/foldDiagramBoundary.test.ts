/**
 * Fold does not reach into the Diagram.
 *
 * The two workspaces share a vocabulary — a turn, a step card, a pattern drawn
 * small, which control owns the arrow keys — and that vocabulary lives where
 * neither owns it: `components/ui`, `lib`, `keyboard`, `cp-workspace/sheets`.
 * A Fold module that imports from the Diagram's own directories makes Fold
 * depend on how the Diagram prints a page, and a change there breaks Fold
 * from a distance. The link the plan designs between them (D17) runs the
 * other way: the Diagram takes Fold steps as a source.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vitest's root is `apps/web`, as the stylesheet ratchet reads it.
const SRC = resolve(process.cwd(), 'src');

/** Fold's own sources: its modules, its components and its panels. */
const FOLD_ROOTS = ['fold', 'components/fold'];
const FOLD_PANELS = /^components\/panels\/Fold\w*\.tsx$/;

/** The Diagram workspace's own directories. */
const DIAGRAM_ROOTS = ['diagram', 'components/diagram'];

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = resolve(dir, name);
    if (statSync(path).isDirectory()) return sourcesUnder(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const posix = (path: string) => path.split(sep).join('/');

function foldSources(): string[] {
  const panels = readdirSync(resolve(SRC, 'components/panels'))
    .map((name) => `components/panels/${name}`)
    .filter((path) => FOLD_PANELS.test(path))
    .map((path) => resolve(SRC, path));
  return [...FOLD_ROOTS.flatMap((root) => sourcesUnder(resolve(SRC, root))), ...panels];
}

/** Every relative module a file imports, statically or dynamically, resolved under `src/`. */
function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const specifiers = [...text.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)].map((match) => match[1]!);
  return specifiers.map((specifier) => posix(relative(SRC, resolve(dirname(file), specifier))));
}

describe('Fold and the Diagram', () => {
  it('finds Fold’s sources to check', () => {
    expect(foldSources().length).toBeGreaterThan(50);
  });

  it('imports nothing from the Diagram workspace’s own directories', () => {
    const reaches = foldSources().flatMap((file) =>
      importsOf(file)
        .filter((target) => DIAGRAM_ROOTS.some((root) => target === root || target.startsWith(`${root}/`)))
        .map((target) => `${posix(relative(SRC, file))} → ${target}`)
    );
    expect(reaches).toEqual([]);
  });
});
