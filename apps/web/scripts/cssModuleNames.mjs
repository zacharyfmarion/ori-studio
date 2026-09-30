/**
 * How a CSS module's class names are generated (`docs/styling.md`).
 *
 * Shared by `vite.config.ts` and the landing prerender (`prerender-landing.mjs`),
 * which starts Vite without that config: the class names the prerender writes into
 * the painted page have to be the ones the client bundle ships.
 *
 * A function rather than Vite's `[name]__[local]__[hash]` pattern, because that
 * pattern hashes the file's path from the working directory — the dev server runs
 * from the repo root and a build from `apps/web`, and each named the same class
 * differently. This hashes the path from `apps/web`, wherever the process runs.
 */
import { createHash } from 'node:crypto';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * `SegmentedControl__track__x8Gg1`: the file and the local name, readable in the
 * inspector, and a hash of the file's path that keeps two same-named modules in
 * different folders apart.
 */
export function generateScopedName(local, file) {
  const path = relative(webRoot, file.split('?')[0]).split(sep).join('/');
  const hash = createHash('sha256').update(`${path}\0${local}`).digest('base64url').slice(0, 5);
  return `${basename(path).replace(/\.module\.css$/u, '')}__${local}__${hash}`;
}
