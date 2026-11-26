#!/usr/bin/env node
/**
 * Runs the private diagram corpus before and after a change, and writes a page
 * that shows only the steps that changed. See tests/corpus/README.md
 * ("Diagram corpus") and implementation-plans/diagram-regression-corpus.md.
 *
 *   npm run diagram-corpus -- [--base <ref>] [--case <slug>[,<slug>...]] [--with-big]
 *   npm run diagram-corpus -- --remove-checkouts
 *
 * "Before" is the merge-base with origin/main, or --base: a second checkout of
 * that commit, with this working copy's harness copied in so both sides run
 * the same checks. Its results are kept per commit and reused. "After" is this
 * working copy, uncommitted edits included. Everything written lands in the
 * corpus folder (results/, reports/) or the checkout cache, never in a
 * checkout of the repository.
 *
 * Every child runs on this script's own Node (22, as CI), and vitest is
 * started from each checkout's own node_modules, so no PATH lookup can pick
 * another Node or another checkout's packages.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path';

/** The harness: copied from the working copy into the "before" checkout, so both sides check alike. */
const HARNESS = [
  'apps/web/src/diagram/dataset',
  'apps/web/src/cp-workspace/folded/folded3dWindowParity.testSupport.ts',
  'apps/web/src/layer-spread/captureWorker.testSupport.ts',
];
/** App modules the harness needs that a commit older than it lacks. */
const HARNESS_NEEDS = ['apps/web/src/workers/oristudioCpWorkerApi.ts'];
/** The wasm bridges the harness runs, by crate and the npm script that builds each. */
const BRIDGES = [
  { crate: 'oristudio-cp-wasm', script: 'build:oristudio-cp-wasm' },
  { crate: 'oristudio-layer-spread-wasm', script: 'build:oristudio-layer-spread-wasm' },
];
const SUITE = 'src/diagram/dataset/diagramDataset.test.ts';
const REPORT = 'src/diagram/dataset/diagramDatasetReport.test.ts';

/** This Node first on every child's PATH: npm's scripts then run on it too. */
const CHILD_ENV = {
  ...process.env,
  PATH: [dirname(process.execPath), process.env.PATH ?? ''].join(delimiter),
};

function fail(message) {
  console.error(`\ndiagram-corpus: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', env: CHILD_ENV, maxBuffer: 256 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  return result;
}

function git(cwd, ...args) {
  const result = run('git', args, { cwd });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function step(message) {
  console.log(`\n==> ${message}`);
}

function parseArgs(argv) {
  const options = { base: null, cases: [], withBig: false, removeCheckouts: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[++index];
      if (!next || next.startsWith('--')) fail(`${arg} needs a value`);
      return next;
    };
    if (arg === '--base') options.base = value();
    else if (arg === '--case') options.cases.push(...value().split(',').map((slug) => slug.trim()).filter(Boolean));
    else if (arg === '--with-big') options.withBig = true;
    else if (arg === '--remove-checkouts') options.removeCheckouts = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'usage: npm run diagram-corpus -- [--base <ref>] [--case <slug>[,<slug>...]] [--with-big]\n' +
          '       npm run diagram-corpus -- --remove-checkouts'
      );
      process.exit(0);
    } else fail(`unknown option ${arg}`);
  }
  return options;
}

function inside(child, parent) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function filesUnder(root, path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) return [];
  if (statSync(absolute).isFile()) return [path];
  return readdirSync(absolute, { withFileTypes: true })
    .flatMap((entry) => filesUnder(root, join(path, entry.name)))
    .sort();
}

function digestFiles(root, paths) {
  const hash = createHash('sha256');
  for (const path of paths.flatMap((item) => filesUnder(root, item))) {
    hash.update(`${path}\0`);
    hash.update(readFileSync(join(root, path)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Every path a bridge is built from: its crate's workspace path dependencies (not dev ones), transitively, and the workspace files. */
function bridgeSources(repo, crate) {
  const result = run('cargo', ['metadata', '--format-version', '1', '--no-deps', '--offline'], { cwd: repo });
  if (result.status !== 0) throw new Error(`cargo metadata: ${result.stderr.trim()}`);
  const { packages } = JSON.parse(result.stdout);
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const seen = new Set();
  const queue = [crate];
  while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    const pkg = byName.get(name);
    if (!pkg) throw new Error(`no workspace crate named ${name}`);
    seen.add(name);
    for (const dependency of pkg.dependencies) if (dependency.path && dependency.kind !== 'dev') queue.push(dependency.name);
  }
  const dirs = [...seen].map((name) => relative(repo, dirname(byName.get(name).manifest_path)));
  const workspace = ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', 'rust-toolchain'].filter((file) => existsSync(join(repo, file)));
  return [...dirs, ...workspace];
}

/** Whether the working tree's sources for these paths are those of `commit`, untracked files included. */
function sameAsCommit(repo, commit, paths) {
  const diff = run('git', ['diff', '--quiet', commit, '--', ...paths], { cwd: repo });
  if (diff.status !== 0) return false;
  return git(repo, 'ls-files', '--others', '--exclude-standard', '--', ...paths) === '';
}

/** The newest modification time among the tracked and untracked files under `paths`. */
function newestSource(repo, paths) {
  const listed = git(repo, 'ls-files', '--cached', '--others', '--exclude-standard', '--', ...paths);
  let newest = 0;
  for (const file of listed.split('\n').filter(Boolean)) {
    const path = join(repo, file);
    if (existsSync(path)) newest = Math.max(newest, statSync(path).mtimeMs);
  }
  return newest;
}

function bridgeWasm(checkout, crate) {
  return join(checkout, 'apps/web/src/generated', crate, `${crate.replaceAll('-', '_')}_bg.wasm`);
}

function npm(checkout, args, env = {}) {
  const result = run('npm', args, { cwd: checkout, stdio: 'inherit', env: { ...CHILD_ENV, ...env } });
  if (result.status !== 0) fail(`npm ${args.join(' ')} failed in ${checkout}`);
}

/** The node_modules trees of `from`, cloned into `to` (copy-on-write on APFS, as scripts/setup-worktree.sh does). */
function cloneNodeModules(from, to) {
  const trees = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(from, dir), { withFileTypes: true })) {
      if (!entry.isDirectory() || ['.git', '.claude', 'target', 'artifacts'].includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.name === 'node_modules') trees.push(path);
      else walk(path);
    }
  };
  walk('.');
  for (const tree of trees) {
    const target = join(to, tree);
    if (existsSync(target)) continue;
    mkdirSync(dirname(target), { recursive: true });
    // cp -c keeps symlinks verbatim; cpSync would point relative links back into the source.
    const clone = run('cp', ['-cRp', join(from, tree), target]);
    if (clone.status !== 0) cpSync(join(from, tree), target, { recursive: true, verbatimSymlinks: true });
  }
  return trees.length;
}

function cacheRoot() {
  if (process.env.ORI_DIAGRAM_DATASET_CHECKOUTS) return resolve(process.env.ORI_DIAGRAM_DATASET_CHECKOUTS);
  return platform() === 'darwin'
    ? join(homedir(), 'Library/Caches/ori-studio-diagram-corpus')
    : join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'ori-studio-diagram-corpus');
}

function removeCheckouts(repo) {
  const root = join(cacheRoot(), 'checkouts');
  if (!existsSync(root)) {
    console.log('diagram-corpus: no checkouts to remove');
    return;
  }
  for (const name of readdirSync(root)) {
    const checkout = join(root, name);
    step(`Removing ${checkout}`);
    const removed = run('git', ['worktree', 'remove', '--force', checkout], { cwd: repo });
    if (removed.status !== 0) console.log(`    ${removed.stderr.trim()}`);
  }
  git(repo, 'worktree', 'prune');
}

/** The working copy, rebuilt where it is stale: the "after" side, and the source of every bridge "before" reuses. */
function prepareWorkingCopy(repo, sourcesByBridge) {
  step('Building the simulator and layer-spread packages in the working copy');
  npm(repo, ['--workspace', '@treemaker/web', 'run', 'build:simulator']);
  for (const { crate, script } of BRIDGES) {
    const wasm = bridgeWasm(repo, crate);
    const built = existsSync(wasm) ? statSync(wasm).mtimeMs : 0;
    if (built > newestSource(repo, sourcesByBridge.get(crate))) {
      console.log(`    ${crate}: built after its last source change`);
      continue;
    }
    step(`${crate}: stale or missing in the working copy; building it`);
    npm(repo, ['--workspace', '@treemaker/web', 'run', script]);
  }
}

/** A detached checkout of `commit`, made ready to run the harness: the "before" side. */
function prepareBaseCheckout(repo, commit, reuse) {
  const checkout = join(cacheRoot(), 'checkouts', commit.slice(0, 12));
  git(repo, 'worktree', 'prune');
  if (existsSync(checkout)) {
    if (git(checkout, 'rev-parse', 'HEAD') !== commit) fail(`${checkout} is not at ${commit}; npm run diagram-corpus -- --remove-checkouts`);
  } else {
    step(`Checking out ${commit.slice(0, 12)} for "before" in ${checkout}`);
    mkdirSync(dirname(checkout), { recursive: true });
    git(repo, 'worktree', 'add', '--detach', checkout, commit);
  }
  if (!existsSync(join(checkout, 'node_modules'))) {
    step('Cloning node_modules from the working copy');
    console.log(`    ${cloneNodeModules(repo, checkout)} trees`);
    if (!sameAsCommit(repo, commit, ['package-lock.json', ':(glob)**/package.json'])) {
      step('The package manifests differ from the working copy: npm install');
      npm(checkout, ['install']);
    }
  }
  step('Copying the generated artifacts from the working copy');
  const generated = join(repo, 'apps/web/src/generated');
  if (!existsSync(generated)) fail('the working copy has no apps/web/src/generated; run npm --workspace @treemaker/web run build:wasm');
  rmSync(join(checkout, 'apps/web/src/generated'), { recursive: true, force: true });
  const copied = run('cp', ['-cRp', generated, join(checkout, 'apps/web/src/generated')]);
  if (copied.status !== 0) cpSync(generated, join(checkout, 'apps/web/src/generated'), { recursive: true });
  for (const { crate, script } of BRIDGES) {
    if (reuse.get(crate)) {
      console.log(`    ${crate}: the same Rust on both sides; reusing the working copy's build`);
      continue;
    }
    step(`${crate}: the Rust differs on "before"; building it there, in that checkout's own target`);
    npm(checkout, ['--workspace', '@treemaker/web', 'run', script], { CARGO_INCREMENTAL: '0' });
  }
  step('Building the simulator and layer-spread packages on "before"');
  npm(checkout, ['--workspace', '@treemaker/web', 'run', 'build:simulator']);
  step('Copying this working copy\'s harness into "before"');
  for (const path of HARNESS) {
    const from = join(repo, path);
    const to = join(checkout, path);
    rmSync(to, { recursive: true, force: true });
    if (existsSync(from)) cpSync(from, to, { recursive: true });
  }
  return checkout;
}

function vitest(checkout, file, env) {
  const result = run(
    process.execPath,
    [join(checkout, 'node_modules/vitest/vitest.mjs'), 'run', '--project', 'node', '--reporter', 'default', file],
    { cwd: join(checkout, 'apps/web'), stdio: 'inherit', env: { ...CHILD_ENV, ...env } }
  );
  return result.status === 0;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const repo = git(process.cwd(), 'rev-parse', '--show-toplevel');
  if (options.removeCheckouts) return removeCheckouts(repo);
  const major = Number(process.versions.node.split('.')[0]);
  if (major !== 22) {
    fail(
      `run under Node 22 (this is ${process.version}): its jsdom and localStorage behave as CI's do. ` +
        'For example: export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"'
    );
  }
  const corpus = resolve(process.env.ORI_DIAGRAM_DATASET_DIR ?? join(homedir(), 'Documents/datasets/diagram-corpus'));
  if (!existsSync(join(corpus, 'manifest.json'))) fail(`no corpus at ${corpus} (set ORI_DIAGRAM_DATASET_DIR)`);
  if (inside(corpus, repo)) fail(`the corpus (${corpus}) must not live inside the checkout`);
  if (inside(cacheRoot(), repo)) fail(`the checkout cache (${cacheRoot()}) must not live inside the checkout`);

  const baseRef = options.base ?? git(repo, 'merge-base', 'HEAD', 'origin/main');
  const base = git(repo, 'rev-parse', `${baseRef}^{commit}`);
  for (const needed of HARNESS_NEEDS) {
    if (run('git', ['cat-file', '-e', `${base}:${needed}`], { cwd: repo }).status !== 0) {
      fail(`"before" (${base.slice(0, 12)}) is older than the harness: it lacks ${needed}. Pick a newer --base.`);
    }
  }
  const head = git(repo, 'rev-parse', 'HEAD');
  const dirty = git(repo, 'status', '--porcelain') !== '';
  const harness = digestFiles(repo, HARNESS).slice(0, 8);
  const manifest = sha256File(join(corpus, 'manifest.json')).slice(0, 8);
  console.log(
    `diagram-corpus: before ${base.slice(0, 12)}${options.base ? ` (${options.base})` : ' (merge-base with origin/main)'}, ` +
      `after ${head.slice(0, 12)}${dirty ? ' + uncommitted changes' : ''}; harness ${harness}, corpus ${manifest}`
  );

  // The working copy first: "before" reuses its bridges, so they must be fresh before they are copied.
  const sourcesByBridge = new Map(BRIDGES.map(({ crate }) => [crate, bridgeSources(repo, crate)]));
  prepareWorkingCopy(repo, sourcesByBridge);
  const reuse = new Map(BRIDGES.map(({ crate }) => [crate, sameAsCommit(repo, base, sourcesByBridge.get(crate))]));
  // What "before" runs on is part of its results' name: the bridges it reuses, by content, or built from its own sources.
  const provenance = createHash('sha256')
    .update(
      JSON.stringify({
        node: process.versions.node.split('.')[0],
        cases: [...options.cases].sort(),
        withBig: options.withBig,
        bridges: BRIDGES.map(({ crate }) => (reuse.get(crate) ? sha256File(bridgeWasm(repo, crate)) : 'built-from-base')),
      })
    )
    .digest('hex')
    .slice(0, 8);
  const caseEnv = {
    ORI_DIAGRAM_DATASET_DIR: corpus,
    ORI_DIAGRAM_DATASET_REQUIRED: '1',
    ...(options.cases.length > 0 ? { ORI_DIAGRAM_DATASET_CASES: options.cases.join(',') } : {}),
    ...(options.withBig ? { ORI_DIAGRAM_DATASET_WITH_BIG: '1' } : {}),
  };

  const results = join(corpus, 'results');
  const before = join(results, `${base.slice(0, 12)}-h${harness}-c${manifest}-r${provenance}`);
  if (existsSync(join(before, 'results.json'))) {
    step(`Reusing "before" results: ${before}`);
  } else {
    const checkout = prepareBaseCheckout(repo, base, reuse);
    const pending = `${before}.partial`;
    rmSync(pending, { recursive: true, force: true });
    step(`Running "before" in ${checkout}`);
    const ok = vitest(checkout, SUITE, {
      ...caseEnv,
      ORI_DIAGRAM_DATASET_OUT: pending,
      ORI_DIAGRAM_DATASET_LABEL: `before: ${base.slice(0, 12)}${options.base ? ` (${options.base})` : ''}`,
    });
    if (!ok || !existsSync(join(pending, 'results.json'))) fail('"before" did not finish; nothing was saved');
    renameSync(pending, before);
  }

  const after = join(results, `working-${basename(repo)}`);
  rmSync(after, { recursive: true, force: true });
  step('Running "after" in the working copy');
  const ok = vitest(repo, SUITE, {
    ...caseEnv,
    ORI_DIAGRAM_DATASET_OUT: after,
    ORI_DIAGRAM_DATASET_LABEL: `after: ${head.slice(0, 12)}${dirty ? ' with uncommitted changes' : ''}`,
  });
  if (!ok || !existsSync(join(after, 'results.json'))) fail('"after" did not finish');

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  const report = join(corpus, 'reports', `${stamp}-${base.slice(0, 8)}-vs-${head.slice(0, 8)}${dirty ? '-dirty' : ''}`);
  step('Writing the report');
  if (!vitest(repo, REPORT, { ORI_DIAGRAM_DATASET_BEFORE: before, ORI_DIAGRAM_DATASET_AFTER: after, ORI_DIAGRAM_DATASET_REPORT: report })) {
    fail('the report could not be written');
  }
  console.log(`\n${readFileSync(join(report, 'summary.txt'), 'utf8').trim()}`);
  console.log(`Report (local only; never attach it to a PR): ${join(report, 'index.html')}`);
}

main();
