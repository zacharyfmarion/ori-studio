#!/usr/bin/env node
/**
 * ReferenceFinder parity oracle: our from-source wasm vs upstream's committed artifact.
 *
 * Builds the same database in both modules, runs every query in queries.json through both —
 * under every entry of its `searches` list, so both line metrics (`worstCase` 0 and 1), both
 * counts and both good-enough thresholds the app uses are covered — and exits non-zero unless
 * each solution list is identical — error, rank and the full per-step JSON. Byte identity of
 * the binaries is not a goal (a different emcc produces different code); identical answers
 * are. The mean query time per module is printed as well: the vendored core carries a local
 * search patch (third_party/reference-finder/README.treemaker.md, "Local changes") whose only
 * claim is that same answers arrive faster, and this is where both halves are checked.
 *
 *   node tools/reference-finder-oracle/equiv.mjs [--ours <dir>] [--upstream <dir>]
 *                                                 [--queries <file>] [--rank N] [--verbose]
 *
 * `--ours` defaults to apps/web/src/generated/reference-finder (run
 * `node scripts/build-reference-finder.mjs` first). Without `--upstream` the artifact at
 * the commit pinned in scripts/reference-finder-emsdk.json is downloaded once into
 * artifacts/reference-finder-upstream/ and SHA-256 verified against the same file.
 *
 * Dependency-free. The driver runs Emscripten's `-sENVIRONMENT=worker` glue under Node by
 * shimming a worker global scope and hiding `process` for the synchronous part of the module
 * call (emcc >= 6 glue refuses to start when it sees Node), and supplies the wasm through
 * `instantiateWasm` so the glue never tries to fetch it.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pinPath = join(repoRoot, 'scripts/reference-finder-emsdk.json');
const defaultOurs = join(repoRoot, 'apps/web/src/generated/reference-finder');
const defaultUpstreamCache = join(repoRoot, 'artifacts/reference-finder-upstream');
const defaultQueries = join(repoRoot, 'tools/reference-finder-oracle/queries.json');

const options = parseArgs(process.argv.slice(2));
const queries = JSON.parse(readFileSync(options.queries, 'utf8'));
if (options.rank !== undefined) queries.database.rank = options.rank;
// `searches` (a list) supersedes the older single `search`; either spelling works.
const searches = queries.searches ?? [queries.search];

const oursDir = options.ours;
if (!existsSync(join(oursDir, 'ref.js')) || !existsSync(join(oursDir, 'ref.wasm'))) {
  fail(`${oursDir} has no ref.js/ref.wasm; run \`node scripts/build-reference-finder.mjs\` first`);
}
const upstreamDir = options.upstream ?? (await fetchUpstream(defaultUpstreamCache));

console.log(`ours:     ${oursDir}`);
console.log(`upstream: ${upstreamDir}`);
console.log(
  `database: rank ${queries.database.rank}; ${queries.points.length} point + ${queries.lines.length} line queries` +
    ` × ${searches.length} search setting(s)`
);

const ours = await runAll(oursDir, 'ours');
const upstream = await runAll(upstreamDir, 'upstream');

let mismatches = 0;
for (const [s, search] of searches.entries()) {
  const settings = JSON.stringify(search);
  for (const [i, point] of queries.points.entries()) {
    mismatches += compare(`point ${JSON.stringify(point)} ${settings}`, ours.points[s][i], upstream.points[s][i]);
  }
  for (const [i, line] of queries.lines.entries()) {
    mismatches += compare(`line ${JSON.stringify(line)} ${settings}`, ours.lines[s][i], upstream.lines[s][i]);
  }
}
if (JSON.stringify(ours.dbInfo) !== JSON.stringify(upstream.dbInfo)) {
  mismatches += 1;
  console.error(`MISMATCH database summary: ours ${JSON.stringify(ours.dbInfo)} vs upstream ${JSON.stringify(upstream.dbInfo)}`);
}

const total = (queries.points.length + queries.lines.length) * searches.length;
if (mismatches > 0) {
  console.error(`reference-finder oracle: ${mismatches} mismatch(es) across ${total} queries`);
  process.exit(1);
}
console.log(
  `reference-finder oracle: identical — ${total} queries, ` +
    `${ours.solutionCount} solutions (ours ${ours.buildMs} ms build, upstream ${upstream.buildMs} ms build)`
);
process.exit(0);

// ---------------------------------------------------------------------------------------

function compare(label, a, b) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa === sb) {
    if (options.verbose) console.log(`  ok ${label}: ${a.length} solutions`);
    return 0;
  }
  console.error(`MISMATCH ${label}`);
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = JSON.stringify(a[i]);
    const y = JSON.stringify(b[i]);
    if (x !== y) {
      console.error(`  solution ${i}:`);
      console.error(`    ours:     ${x ?? '(none)'}`);
      console.error(`    upstream: ${y ?? '(none)'}`);
    }
  }
  return 1;
}

async function runAll(libDir, label) {
  const finder = await createFinder(libDir, queries.database);
  // `points[s][i]` / `lines[s][i]`: the i-th query's solutions under the s-th search setting.
  const out = { buildMs: Math.round(finder.buildMs), dbInfo: finder.dbInfo, points: [], lines: [], solutionCount: 0 };
  const summarize = (solutions) =>
    solutions.map((s) => ({ err: s.err, rank: s.rank, steps: s.steps }));
  const timing = { point: [], line: [] };
  const timed = async (kind, run) => {
    const started = performance.now();
    const solutions = await run();
    timing[kind].push(performance.now() - started);
    return solutions;
  };
  for (const search of searches) {
    const points = [];
    for (const [x, y] of queries.points) {
      const solutions = await timed('point', () => finder.solvePoint(x, y, search));
      points.push(summarize(solutions));
      out.solutionCount += solutions.length;
    }
    out.points.push(points);
    const lines = [];
    for (const [p1, p2] of queries.lines) {
      const solutions = await timed('line', () => finder.solveLine(p1, p2, search));
      lines.push(summarize(solutions));
      out.solutionCount += solutions.length;
    }
    out.lines.push(lines);
  }
  if (finder.stderr.length > 0) {
    console.warn(`${label}: stderr from the module:\n  ${finder.stderr.join('\n  ')}`);
  }
  const mean = (values) => (values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) : '-');
  console.log(
    `${label}: database built in ${out.buildMs} ms, ${out.solutionCount} solutions; ` +
      `mean query ${mean(timing.point)} ms/point, ${mean(timing.line)} ms/line`
  );
  return out;
}

// ---------------------------------------------------------------------------------------
// Module driver (see the header for why each shim exists)

function installWorkerShim(libDir) {
  if (!globalThis.WorkerGlobalScope) {
    globalThis.self = globalThis;
    globalThis.WorkerGlobalScope = class WorkerGlobalScope {};
  }
  globalThis.location = { href: pathToFileURL(join(libDir, 'ref.js')).href };
}

async function createFinder(libDir, db) {
  installWorkerShim(libDir);
  const wasmBinary = readFileSync(join(libDir, 'ref.wasm'));

  const queue = [];
  let valueResolve = null;
  const put = (n) => {
    if (valueResolve) {
      const r = valueResolve;
      valueResolve = null;
      r(n);
    } else {
      queue.push(n);
    }
  };
  const send = (values) => {
    for (const v of values) put(Number(v));
  };

  let onLine = null;
  const stderr = [];
  const Module = {
    instantiateWasm: (imports, receive) => {
      WebAssembly.instantiate(wasmBinary, imports).then((r) => receive(r.instance, r.module));
      return {};
    },
    print: (text) => onLine?.(text),
    printErr: (text) => {
      stderr.push(text);
      onLine?.('ERR ' + text);
    },
    get: async () => (queue.length ? queue.shift() : await new Promise((r) => (valueResolve = r))),
    checkCancel: () => new Promise((r) => setTimeout(() => r(false), 0)),
    clear: () => {
      queue.length = 0;
    },
  };
  const collectUntilReady = (timeoutMs = 600000) =>
    new Promise((resolvePromise, reject) => {
      const lines = [];
      const timer = setTimeout(() => {
        onLine = null;
        reject(new Error(`timeout after ${timeoutMs} ms waiting for "Ready"; got ${lines.length} lines`));
      }, timeoutMs);
      onLine = (text) => {
        if (text === 'Ready') {
          clearTimeout(timer);
          onLine = null;
          resolvePromise(lines);
        } else {
          lines.push(text);
        }
      };
    });

  const glueUrl = pathToFileURL(join(libDir, 'ref.js')).href;
  const createModule = (await import(glueUrl)).default;
  const started = performance.now();
  const readyPromise = collectUntilReady();
  // The environment check runs synchronously at the top of the module function; hide
  // `process` for exactly that long so the worker-only glue does not refuse to start.
  const savedProcess = globalThis.process;
  globalThis.process = undefined;
  try {
    createModule(Module);
  } finally {
    globalThis.process = savedProcess;
  }

  // Input order is main.cpp's readDbSettings(): useDatabase, forceRebuild, paper, ranks
  // and limits, seven axiom slots, division grid, filters, then seed marks and lines.
  send([
    0, 0, db.width, db.height, db.rank, db.maxLines, db.maxMarks,
    ...db.axiomPriority,
    db.useDivision, db.numX, db.numY, db.numA, db.numD,
    db.minAspectRatio, db.minAngleSine, db.visibility,
    0, 0,
  ]);
  const progress = await readyPromise;
  const buildMs = performance.now() - started;
  const last = [...progress].reverse().find((l) => l.startsWith('{"rank"'));
  const dbInfo = last ? JSON.parse(last) : null;

  const parse = (lines) => lines.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
  const query = async (numbers) => {
    const pending = collectUntilReady();
    send(numbers);
    return parse(await pending);
  };

  return {
    buildMs,
    dbInfo,
    stderr,
    solvePoint: (x, y, s) => query([1, s.goodEnoughError, s.count, s.worstCase, x, y]),
    solveLine: (p1, p2, s) =>
      query([2, s.goodEnoughError, s.count, s.worstCase, p1[0], p1[1], p2[0], p2[1]]),
  };
}

// ---------------------------------------------------------------------------------------
// Upstream artifact (same pin and hashes as scripts/build-reference-finder.mjs)

async function fetchUpstream(cacheDir) {
  const pin = JSON.parse(readFileSync(pinPath, 'utf8'));
  const base = `https://raw.githubusercontent.com/MuTsunTsai/reference-finder/${pin.pinnedUpstreamCommit}/src/lib/`;
  mkdirSync(cacheDir, { recursive: true });
  // ref.js is ES module syntax; without a nearby "type": "module" Node reparses it and warns.
  const marker = join(cacheDir, 'package.json');
  if (!existsSync(marker)) writeFileSync(marker, '{ "type": "module" }\n');
  for (const name of ['ref.js', 'ref.wasm']) {
    const expected = pin.fallbackSha256[name];
    const target = join(cacheDir, name);
    if (existsSync(target) && sha256(readFileSync(target)) === expected) continue;
    console.log(`fetching upstream ${name} at ${pin.pinnedUpstreamCommit.slice(0, 7)}`);
    const response = await fetch(base + name);
    if (!response.ok) fail(`download of ${base + name} failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const actual = sha256(bytes);
    if (actual !== expected) {
      fail(`SHA-256 mismatch for upstream ${name}: expected ${expected}, got ${actual}`);
    }
    writeFileSync(target + '.tmp', bytes);
    renameSync(target + '.tmp', target);
  }
  return cacheDir;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// ---------------------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { ours: defaultOurs, upstream: undefined, queries: defaultQueries, rank: undefined, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) fail(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case '--ours':
        out.ours = absolute(value());
        break;
      case '--upstream':
        out.upstream = absolute(value());
        break;
      case '--queries':
        out.queries = absolute(value());
        break;
      case '--rank':
        out.rank = Number(value());
        if (!Number.isInteger(out.rank) || out.rank < 1) fail('--rank must be a positive integer');
        break;
      case '--verbose':
        out.verbose = true;
        break;
      case '--help':
      case '-h':
        console.log(
          'usage: node tools/reference-finder-oracle/equiv.mjs [--ours <dir>] [--upstream <dir>] ' +
            '[--queries <file>] [--rank N] [--verbose]'
        );
        process.exit(0);
        break;
      default:
        fail(`unknown argument ${arg}`);
    }
  }
  return out;
}

function absolute(path) {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

function fail(message) {
  console.error(`reference-finder oracle: error: ${message}`);
  process.exit(1);
}
