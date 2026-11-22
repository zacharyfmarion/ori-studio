/**
 * The diagram corpus as the harness reads it. Test-only: imported by
 * `diagramDataset.test.ts` and nothing in the app.
 *
 * The corpus is a private folder of frozen `.osf` copies outside the repo
 * (`tests/corpus/README.md`, "Diagram corpus"). Nothing here writes into it,
 * and nothing the harness writes may land inside the checkout: a third
 * party's design must never reach a commit.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

/** The harness's settings, as env vars: vitest rejects flags it does not know. */
export const DATASET_ENV = {
  /** The corpus folder; unset, the suite skips. */
  dir: 'ORI_DIAGRAM_DATASET_DIR',
  /** Where this run writes its results; required, and outside the checkout. */
  out: 'ORI_DIAGRAM_DATASET_OUT',
  /** Comma-separated slugs to run (`--case`); unset, every default case. */
  cases: 'ORI_DIAGRAM_DATASET_CASES',
  /** `1` adds the cases run only on request (`--with-big`). */
  withBig: 'ORI_DIAGRAM_DATASET_WITH_BIG',
  /** `1` turns a skip into a failure, for a run that must not pass by doing nothing. */
  required: 'ORI_DIAGRAM_DATASET_REQUIRED',
} as const;

export interface CorpusCase {
  slug: string;
  /** Relative to the corpus folder. */
  file: string;
  sha256: string;
  bytes: number;
  run: 'default' | 'on-request';
  tags: string[];
  /** Step ids main should open locked. */
  expectedLocked: string[];
  /** Steps expected to read other than current, with why. */
  knownStatuses: { step: string; status: string; reason: string }[];
}

export interface CorpusSelection {
  dir: string;
  /** The manifest's own digest, so results say which corpus they ran on. */
  manifestSha256: string;
  cases: CorpusCase[];
  /** Cases left out of this run, and why. */
  skipped: { slug: string; reason: string }[];
}

type Env = Record<string, string | undefined>;

/** The corpus folder, or null when this run has none. */
export function corpusDir(env: Env = process.env): string | null {
  const dir = env[DATASET_ENV.dir]?.trim();
  return dir ? resolve(dir) : null;
}

/** Whether a missing corpus or a skipped case must fail the run. */
export function datasetRequired(env: Env = process.env): boolean {
  return env[DATASET_ENV.required] === '1';
}

/** The checkout this suite runs in: vitest runs from `apps/web`. */
export function checkoutRoot(cwd = process.cwd()): string {
  return resolve(cwd, '../..');
}

function inside(child: string, parent: string): boolean {
  const real = (path: string) => (existsSync(path) ? realpathSync(path) : resolve(path));
  const rel = relative(real(parent), real(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Refuses a path inside the checkout. The corpus and its results hold
 * third-party designs; inside a checkout, one `git add -A` puts them in a commit.
 */
export function assertOutsideCheckout(path: string, what: string, root = checkoutRoot()): string {
  if (!isAbsolute(path)) throw new Error(`${what} must be an absolute path, not ${path}`);
  if (inside(path, root)) throw new Error(`${what} (${path}) is inside the checkout (${root}); it must live outside it`);
  return path;
}

/** Where this run writes: required, absolute, outside the checkout. */
export function outputDir(env: Env = process.env, root = checkoutRoot()): string {
  const out = env[DATASET_ENV.out]?.trim();
  if (!out) throw new Error(`${DATASET_ENV.out} is not set: the harness writes its results there`);
  return assertOutsideCheckout(resolve(out), DATASET_ENV.out, root);
}

function asCase(value: unknown): CorpusCase {
  const raw = value as Partial<CorpusCase> & Record<string, unknown>;
  if (typeof raw.slug !== 'string' || typeof raw.file !== 'string' || typeof raw.sha256 !== 'string') {
    throw new Error(`a manifest case is missing its slug, file or sha256: ${JSON.stringify(value).slice(0, 120)}`);
  }
  return {
    slug: raw.slug,
    file: raw.file,
    sha256: raw.sha256,
    bytes: typeof raw.bytes === 'number' ? raw.bytes : 0,
    run: raw.run === 'on-request' ? 'on-request' : 'default',
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    expectedLocked: Array.isArray(raw.expectedLocked) ? raw.expectedLocked.filter((id): id is string => typeof id === 'string') : [],
    knownStatuses: Array.isArray(raw.knownStatuses) ? (raw.knownStatuses as CorpusCase['knownStatuses']) : [],
  };
}

/** The manifest's cases, and the ones this run takes (`--case`, `--with-big`). */
export function selectCases(dir: string, env: Env = process.env): CorpusSelection {
  assertOutsideCheckout(dir, DATASET_ENV.dir);
  const manifestPath = join(dir, 'manifest.json');
  const text = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(text) as { cases?: unknown[] };
  const all = (manifest.cases ?? []).map(asCase);
  const named = (env[DATASET_ENV.cases] ?? '')
    .split(',')
    .map((slug) => slug.trim())
    .filter(Boolean);
  const unknown = named.filter((slug) => !all.some((kase) => kase.slug === slug));
  if (unknown.length > 0) throw new Error(`no such case in the manifest: ${unknown.join(', ')}`);
  const withBig = env[DATASET_ENV.withBig] === '1';
  const cases: CorpusCase[] = [];
  const skipped: CorpusSelection['skipped'] = [];
  for (const kase of all) {
    if (named.length > 0 && !named.includes(kase.slug)) continue;
    if (kase.run === 'on-request' && !withBig && !named.includes(kase.slug)) {
      skipped.push({ slug: kase.slug, reason: 'runs on request (--with-big)' });
      continue;
    }
    cases.push(kase);
  }
  return { dir, manifestSha256: sha256(Buffer.from(text)), cases, skipped };
}

export function sha256(bytes: Buffer | Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A case's file, refused when its bytes are not the frozen copy's. */
export function caseText(dir: string, kase: CorpusCase): string {
  const bytes = readFileSync(join(dir, kase.file));
  const actual = sha256(bytes);
  if (actual !== kase.sha256) {
    throw new Error(`${kase.file} does not match its manifest sha256 (${actual.slice(0, 12)} vs ${kase.sha256.slice(0, 12)})`);
  }
  return bytes.toString('utf8');
}
