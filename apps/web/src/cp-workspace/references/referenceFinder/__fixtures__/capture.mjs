#!/usr/bin/env node
/**
 * Captures REAL ReferenceFinder output as replay fixtures for the extractor and client tests.
 *
 *   node scripts/build-reference-finder.mjs --node
 *   node apps/web/src/cp-workspace/references/referenceFinder/__fixtures__/capture.mjs
 *
 * Drives the `-sENVIRONMENT=worker,node` link in artifacts/reference-finder-node/ with the
 * same shims as tools/reference-finder-oracle/equiv.mjs (worker-scope globals, `process`
 * hidden for the synchronous environment check, wasm through `instantiateWasm`). Every
 * fixture file records the database settings, the query that produced it, and the module's
 * solution lines verbatim — the tests never talk to the module, they replay these.
 *
 * Fixtures (one JSON file each):
 *   line-exact.json        a line target with an exact (err <= 1e-9) solution
 *   mark.json              a point target (carries the trailing standalone mark diagram)
 *   line-diagonal.json     the sw_ne diagonal as a line target: steps = [], err 0
 *   mark-centre.json       the centre as a point target: axiom-0-only steps on the two diagonals
 *   consecutive-marks.json a solution whose steps contain two adjacent axiom-0 entries
 *   line-pinch.json        a line target whose solution renders an earlier line as a pinch
 *   line-approximate.json  a line target with no exact solution at rank 6 (err > 1e-9)
 *
 * The consecutive-marks case is found by scanning deterministic pseudo-random targets; the
 * file records which target hit so the scan does not need to be repeated.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../'.repeat(7));
const libDir = join(repoRoot, 'artifacts/reference-finder-node');

// Mirrors DEFAULT_DATABASE_SETTINGS in ../protocol.ts (unit square, rank 6).
const database = {
  width: 1,
  height: 1,
  maxRank: 6,
  maxLines: 600000,
  maxMarks: 600000,
  axiomPriority: [2, 3, 7, 6, 5, 4, 1],
  useDivision: true,
  numX: 5000,
  numY: 5000,
  numA: 5000,
  numD: 5000,
  minAspectRatio: 0.1,
  minAngleSine: 0.342,
  visibility: true,
};
// Planner-grade query settings: exact hits rank above approximations, five candidates.
const search = { goodEnoughError: 1e-9, count: 5, worstCase: 1 };

const finder = await createFinder(libDir, database);
console.log(`database built in ${Math.round(finder.buildMs)} ms: ${JSON.stringify(finder.dbInfo)}`);

const fixtures = [];

const lineExact = await capture('line', [
  [0, 0.25],
  [1, 0.25],
]);
fixtures.push(['line-exact.json', lineExact]);

const mark = await capture('point', [1 / 3, 1 / 3]);
fixtures.push(['mark.json', mark]);

const diagonal = await capture('line', [
  [0, 0],
  [1, 1],
]);
fixtures.push(['line-diagonal.json', diagonal]);

const centre = await capture('point', [0.5, 0.5]);
fixtures.push(['mark-centre.json', centre]);

// A line at an odd angle through two rational points: several O1 routes between
// intersection marks, one of which is a pinch.
const pinch = await capture('line', [
  [0, 1 / 3],
  [1, 0.5],
]);
fixtures.push(['line-pinch.json', pinch]);

const approximate = await capture('line', [
  [0.123, 0],
  [0.789, 1],
]);
fixtures.push(['line-approximate.json', approximate]);

const consecutive = await scanForConsecutiveMarks();
fixtures.push(['consecutive-marks.json', consecutive]);

for (const [name, fixture] of fixtures) {
  writeFileSync(join(here, name), JSON.stringify(fixture, null, 2) + '\n');
  const summary = fixture.solutions
    .map((s) => `err=${s.err} rank=${s.rank} steps=${s.steps.length} diagrams=${s.diagrams.length}`)
    .join('; ');
  console.log(`${name}: ${summary}`);
}
if (finder.stderr.length > 0) console.warn(`stderr:\n  ${finder.stderr.join('\n  ')}`);
process.exit(0);

// ---------------------------------------------------------------------------------------

async function capture(kind, target) {
  const solutions =
    kind === 'point'
      ? await finder.solvePoint(target[0], target[1], search)
      : await finder.solveLine(target[0], target[1], search);
  return {
    database,
    search,
    query: kind === 'point' ? { kind, point: target } : { kind, a: target[0], b: target[1] },
    solutions,
  };
}

function hasConsecutiveMarks(solution) {
  for (let i = 1; i < solution.steps.length; i += 1) {
    if (solution.steps[i - 1].axiom === 0 && solution.steps[i].axiom === 0) return true;
  }
  return false;
}

async function scanForConsecutiveMarks() {
  // Deterministic LCG so the scan replays identically.
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const a = [round(rand()), 0];
    const b = [round(rand()), 1];
    const fixture = await capture('line', [a, b]);
    const index = fixture.solutions.findIndex(hasConsecutiveMarks);
    if (index >= 0) {
      console.log(`consecutive marks found on attempt ${attempt}: solution ${index} of line ${JSON.stringify([a, b])}`);
      return { ...fixture, note: `solution index ${index} has two adjacent axiom-0 steps` };
    }
  }
  throw new Error('no solution with consecutive axiom-0 steps in 200 random lines');
}

function round(value) {
  return Math.round(value * 16) / 16;
}

// ---------------------------------------------------------------------------------------
// Module driver, after tools/reference-finder-oracle/equiv.mjs.

function installWorkerShim(dir) {
  if (!globalThis.WorkerGlobalScope) {
    globalThis.self = globalThis;
    globalThis.WorkerGlobalScope = class WorkerGlobalScope {};
  }
  globalThis.location = { href: pathToFileURL(join(dir, 'ref.js')).href };
}

async function createFinder(dir, db) {
  installWorkerShim(dir);
  const wasmBinary = readFileSync(join(dir, 'ref.wasm'));

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

  const createModule = (await import(pathToFileURL(join(dir, 'ref.js')).href)).default;
  const started = performance.now();
  const readyPromise = collectUntilReady();
  const savedProcess = globalThis.process;
  globalThis.process = undefined;
  try {
    createModule(Module);
  } finally {
    globalThis.process = savedProcess;
  }

  // readDbSettings() order; see ../protocol.ts encodeDatabaseSettings.
  send([
    0, 0, db.width, db.height, db.maxRank, db.maxLines, db.maxMarks,
    ...db.axiomPriority,
    db.useDivision ? 1 : 0, db.numX, db.numY, db.numA, db.numD,
    db.minAspectRatio, db.minAngleSine, db.visibility ? 1 : 0,
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
