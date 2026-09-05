// Reusable Node driver for MuTsunTsai's ref.wasm (Emscripten, ENVIRONMENT=worker, ASYNCIFY).
// Shims a worker global, feeds the C++ ReadNumber() queue, and parses JSON-line solutions.
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const LIB = process.env.RF_LIB ? (process.env.RF_LIB.endsWith("/") ? process.env.RF_LIB : process.env.RF_LIB + "/") : new URL("./rf/src/lib/", import.meta.url).pathname;

// --- one-time worker-environment shim (idempotent) ---
if (!globalThis.WorkerGlobalScope) {
  globalThis.self = globalThis;
  globalThis.WorkerGlobalScope = class WorkerGlobalScope {};
  globalThis.location = { href: `file://${LIB}ref.js` };
}

const wasmBinary = readFileSync(`${LIB}ref.wasm`);

/**
 * createFinder — build one ReferenceFinder database and return a query handle.
 * Every option mirrors the web app's DbSettings (store.ts) and the order main.cpp reads them.
 */
export async function createFinder({
  width = 1, height = 1,
  rank = 6, maxLines = 600000, maxMarks = 600000,
  axiomPriority = [2, 3, 7, 6, 5, 4, 1], // default priority order; 0 disables a slot
  useDivision = 1, numX = 5000, numY = 5000, numA = 5000, numD = 5000,
  minAspectRatio = 0.1, minAngleSine = 0.342, visibility = 1,
  seedMarks = [],           // [[x,y],...]
  seedLines = [],           // [[[x1,y1],[x2,y2]],...]
  onProgress = null,
} = {}) {
  const queue = [];
  let valueResolve = null;
  const put = (n) => { if (valueResolve) { const r = valueResolve; valueResolve = null; r(n); } else queue.push(n); };
  const send = (arr) => { for (const v of arr) put(Number(v)); };

  let onLine = null;
  const stderr = [];
  const Module = {
    // instantiateWasm works on every emcc version; emcc>=6 rejects an incoming Module.wasmBinary.
    instantiateWasm: (imports, cb) => { WebAssembly.instantiate(wasmBinary, imports).then(r => cb(r.instance, r.module)); return {}; },
    print: (t) => { if (onLine) onLine(t); },
    printErr: (e) => { stderr.push(e); if (onLine) onLine("ERR " + e); },
    get: async () => queue.length ? queue.shift() : await new Promise(res => { valueResolve = res; }),
    checkCancel: () => new Promise(res => setTimeout(() => res(false), 0)),
    clear: () => { queue.length = 0; },
  };
  const collectUntilReady = (timeoutMs = 600000) => new Promise((res, rej) => {
    const out = [];
    const timer = setTimeout(() => { onLine = null; rej(new Error(`rf timeout after ${timeoutMs}ms; got ${out.length} lines`)); }, timeoutMs);
    onLine = (t) => {
      if (t === "Ready") { clearTimeout(timer); onLine = null; res(out); }
      else out.push(t);
    };
  });

  const ref = (await import(`file://${LIB}ref.js`)).default;
  const t0 = performance.now();
  const readyP = collectUntilReady();
  // emcc>=6 glue throws "not compiled for this environment" whenever `process` exists (worker-only build).
  // The check runs synchronously at the top of Module(); hide `process` just for that call.
  const savedProcess = globalThis.process;
  globalThis.process = undefined;
  try { ref(Module); } finally { globalThis.process = savedProcess; }
  send([
    0, 0, width, height, rank, maxLines, maxMarks,
    ...axiomPriority, useDivision, numX, numY, numA, numD,
    minAspectRatio, minAngleSine, visibility,
    seedMarks.length, ...seedMarks.flat(),
    seedLines.length, ...seedLines.flat(2),
  ]);
  const progress = await readyP;
  const buildMs = performance.now() - t0;
  const last = [...progress].reverse().find(l => l.startsWith('{"rank"'));
  const dbInfo = last ? JSON.parse(last) : null;
  if (onProgress) onProgress(progress);

  const parse = (lines) => lines
    .filter(l => l.startsWith("{"))
    .map(l => JSON.parse(l));

  async function solvePoint(x, y, { count = 5, goodEnoughError = 0.005, worstCase = 1 } = {}) {
    const t = performance.now();
    const p = collectUntilReady();
    send([1, goodEnoughError, count, worstCase, x, y]);
    const out = await p;
    return { solutions: parse(out), ms: performance.now() - t, stderr: out.filter(l => l.startsWith("ERR")) };
  }
  async function solveLine(p1, p2, { count = 5, goodEnoughError = 0.005, worstCase = 1 } = {}) {
    const t = performance.now();
    const p = collectUntilReady();
    send([2, goodEnoughError, count, worstCase, p1[0], p1[1], p2[0], p2[1]]);
    const out = await p;
    return { solutions: parse(out), ms: performance.now() - t, stderr: out.filter(l => l.startsWith("ERR")) };
  }

  return { buildMs, dbInfo, solvePoint, solveLine, stderr };
}

// CLI smoke: node rf.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const f = await createFinder({ rank: Number(process.env.RANK ?? 5) });
  console.log(`build ${f.buildMs.toFixed(0)}ms`, f.dbInfo);
  const r = await f.solveLine([0, 0.25], [1, 0.75], { count: 2 });
  console.log(`line query ${r.ms.toFixed(1)}ms →`, r.solutions.map(s => ({ err: s.err, rank: s.rank, steps: s.steps.length })));
  process.exit(0);
}
