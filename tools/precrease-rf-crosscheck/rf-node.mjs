/**
 * Drive the ReferenceFinder wasm module from Node.
 *
 * Adapted from `tools/reference-finder-oracle/equiv.mjs`, which has no exports;
 * the shims are the same and the reasons for them are the same:
 *
 * - the glue is linked `-sENVIRONMENT=worker` (the browser build) or
 *   `worker,node` (the `--node` variant), so a worker global scope has to
 *   exist before it loads;
 * - emcc >= 6 glue refuses to start when it can see `process`, so `process` is
 *   hidden for exactly the synchronous part of the module call;
 * - the wasm is handed in through `instantiateWasm`, so the glue never fetches;
 * - `main.cpp` clears its stdin queue before printing `Ready`, so exactly one
 *   command may be in flight — every call here waits for `Ready`.
 *
 * This file is part of the GPL whole (it links nothing, but it drives Lang's
 * engine and mimics its filters); the planner crate it checks does not depend
 * on it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Database settings matching `tools/reference-finder-oracle/queries.json`. */
export const DEFAULT_DATABASE = {
  width: 1,
  height: 1,
  rank: 6,
  maxLines: 600000,
  maxMarks: 600000,
  axiomPriority: [2, 3, 7, 6, 5, 4, 1],
  useDivision: 1,
  numX: 5000,
  numY: 5000,
  numA: 5000,
  numD: 5000,
  minAspectRatio: 0.1,
  minAngleSine: 0.342,
  visibility: 1,
};

function installWorkerShim(libDir) {
  if (!globalThis.WorkerGlobalScope) {
    globalThis.self = globalThis;
    globalThis.WorkerGlobalScope = class WorkerGlobalScope {};
  }
  globalThis.location = { href: pathToFileURL(join(libDir, 'ref.js')).href };
}

/**
 * Build a ReferenceFinder database and return a small query interface.
 *
 * @param {string} libDir directory holding `ref.js` and `ref.wasm`
 * @param {object} db database settings (see {@link DEFAULT_DATABASE})
 */
export async function createFinder(libDir, db) {
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
        reject(
          new Error(`timeout after ${timeoutMs} ms waiting for "Ready"; got ${lines.length} lines`)
        );
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
  const savedProcess = globalThis.process;
  globalThis.process = undefined;
  try {
    createModule(Module);
  } finally {
    globalThis.process = savedProcess;
  }

  // Input order is main.cpp's readDbSettings(): useDatabase, forceRebuild, paper,
  // ranks and limits, seven axiom slots, division grid, filters, then seed marks
  // and lines (none).
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
