/**
 * The ReferenceFinder core, alone in a worker, spoken to over its numeric stdin.
 *
 * **What the module is.** Emscripten glue built from the vendored C++ with
 * `-sENVIRONMENT=worker -sASYNCIFY -sEXPORT_ES6` (`scripts/build-reference-finder.mjs`).
 * Its `main()` is a REPL: it reads the database configuration, builds the
 * database, then loops forever reading one command at a time. The C++ talks to
 * JavaScript only through the hooks on the module object (`src/core/utils.h`):
 * `await Module.get()` for every input number, `Module.print` per stdout line,
 * `Module.printErr` per stderr line, `Module.clear()` right before each `Ready`
 * prompt, and `Module.checkCancel()` — polled, in this core, only during the
 * statistics command (99), which the app never issues.
 *
 * **Strict one-command FIFO.** Because `clear()` runs before every `Ready`,
 * anything queued while a command is still running is discarded, and the next
 * `get()` then waits forever — a pipelined query hangs the worker. So every
 * command here goes through one promise chain, and a command's numbers are sent
 * only after the previous command's `Ready` was seen. The runtime keeps a second
 * chain on the main thread so a query's timeout starts when it is dispatched,
 * not when it was queued.
 *
 * **One database per worker.** `readDbSettings()` runs once, at startup; the only
 * way to a different database is a different worker. `ensureDatabase` with a
 * second key therefore rejects rather than pretending, and the runtime
 * (`store/workspaceStore/referenceFinderRuntime.ts`) spawns one worker per key.
 *
 * **Cancellation.** A running command cannot be interrupted from inside: it is
 * synchronous C++ that yields only at `get()`. The runtime handles a hung or
 * slow query by terminating the worker after rejecting the promises it orphans.
 * `cancelBuild` is kept for the hook contract — `checkCancel` returns its flag —
 * but with the vendored core the database build never polls it.
 *
 * **Loading the wasm.** `locateFile` answers the glue's `ref.wasm` lookup with
 * Vite's `?url` import, so the binary is a content-hashed emitted asset that the
 * service worker can warm. `wasmBinary` / `wasmMemory` are never passed in
 * (emcc ≥ 6 aborts on either as an incoming property).
 *
 * This file is the only importer of the generated glue. No test imports it.
 */
import { expose } from 'comlink';
import createReferenceFinderModule from '../generated/reference-finder/ref';
import refWasmUrl from '../generated/reference-finder/ref.wasm?url';
import {
  databaseKey,
  encodeDatabaseSettings,
  encodeLineQuery,
  encodePointQuery,
  isReadyLine,
  parseProgressLine,
  parseSolutionLine,
  type ReferenceFinderDatabaseSettings,
  type ReferenceFinderProgress,
  type ReferenceFinderQuerySettings,
} from '../cp-workspace/references/referenceFinder/protocol';
import type { RawSolution } from '../cp-workspace/references/referenceFinder/solution';
import type { WasmErrorEnvelope } from '../engine/types';

export interface ReferenceFinderDatabaseInfo {
  lines: number;
  marks: number;
  buildMs: number;
}

/** stdout of one command: everything printed before its `Ready`. */
interface CommandOutput {
  lines: string[];
  errors: string[];
}

interface Collector extends CommandOutput {
  resolve: (output: CommandOutput) => void;
}

// --- stdin -------------------------------------------------------------------

const inputQueue: number[] = [];
let inputWaiter: ((value: number) => void) | null = null;

function pushInput(values: number[]): void {
  for (const value of values) {
    if (inputWaiter) {
      const wake = inputWaiter;
      inputWaiter = null;
      wake(value);
    } else {
      inputQueue.push(value);
    }
  }
}

function nextInput(): Promise<number> | number {
  if (inputQueue.length > 0) return inputQueue.shift() as number;
  return new Promise<number>((resolve) => {
    inputWaiter = resolve;
  });
}

// --- stdout ------------------------------------------------------------------

let collector: Collector | null = null;

/** Start collecting stdout; settles with everything printed up to the next `Ready`. */
function collectUntilReady(): Promise<CommandOutput> {
  return new Promise<CommandOutput>((resolve) => {
    collector = { lines: [], errors: [], resolve };
  });
}

function onPrint(text: string): void {
  if (!collector) {
    // Nothing is listening: output between commands is a protocol violation
    // worth seeing in the console, not something to act on.
    console.warn('[ori-studio] reference-finder printed outside a command:', text);
    return;
  }
  if (isReadyLine(text)) {
    const finished = collector;
    collector = null;
    finished.resolve({ lines: finished.lines, errors: finished.errors });
    return;
  }
  collector.lines.push(text);
}

function onPrintErr(text: string): void {
  if (collector) {
    collector.errors.push(text);
  } else {
    console.error('[ori-studio] reference-finder stderr outside a command:', text);
  }
}

// --- lifecycle ---------------------------------------------------------------

let database: { key: string; info: ReferenceFinderDatabaseInfo } | null = null;
let databaseBuild: { key: string; promise: Promise<ReferenceFinderDatabaseInfo> } | null = null;
let buildCancelRequested = false;
let queue: Promise<unknown> = Promise.resolve();

/** Run `task` after every earlier command has seen its `Ready`. */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function normalizeError(error: unknown): WasmErrorEnvelope {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    'message' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    return error as WasmErrorEnvelope;
  }
  return {
    code: 'reference_finder',
    message: error instanceof Error ? error.message : String(error),
  };
}

function failure(message: string): WasmErrorEnvelope {
  return { code: 'reference_finder', message };
}

async function buildDatabase(
  settings: ReferenceFinderDatabaseSettings,
  key: string
): Promise<ReferenceFinderDatabaseInfo> {
  const encoded = encodeDatabaseSettings(settings);
  const started = performance.now();
  const output = collectUntilReady();
  // Queue the configuration before the module starts: `main()` asks for its
  // first number during `createReferenceFinderModule`, and the promise below
  // resolves while `main()` is suspended in that first `get()`.
  pushInput(encoded);
  try {
    await createReferenceFinderModule({
      locateFile: (path, scriptDirectory) =>
        path.endsWith('.wasm') ? refWasmUrl : scriptDirectory + path,
      print: onPrint,
      printErr: onPrintErr,
      get: nextInput,
      checkCancel: () => buildCancelRequested,
      clear: () => {
        inputQueue.length = 0;
      },
    });
  } catch (error) {
    inputQueue.length = 0;
    collector = null;
    throw failure(
      `the ReferenceFinder module failed to start: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const { lines, errors } = await output;
  let progress: ReferenceFinderProgress | null = null;
  for (const line of lines) {
    progress = parseProgressLine(line) ?? progress;
  }
  if (errors.length > 0) {
    console.warn('[ori-studio] reference-finder stderr during the database build:', errors);
  }
  if (!progress) {
    throw failure('the database build finished without reporting its size');
  }
  const info = { lines: progress.lines, marks: progress.marks, buildMs: performance.now() - started };
  database = { key, info };
  return info;
}

function requireDatabase(): void {
  if (!database) {
    throw failure('no database: call ensureDatabase before querying');
  }
}

async function runQuery(encoded: number[]): Promise<RawSolution[]> {
  requireDatabase();
  const output = collectUntilReady();
  pushInput(encoded);
  const { lines, errors } = await output;
  if (errors.length > 0) {
    // Validation failures (`ValidateMark` / `ValidateLine`) print to stderr and
    // yield no solutions; the core then prints `Ready` and carries on.
    throw failure(errors.join('\n'));
  }
  const solutions: RawSolution[] = [];
  for (const line of lines) {
    const solution = parseSolutionLine(line);
    if (solution) solutions.push(solution);
  }
  return solutions;
}

const api = {
  /**
   * Build the database for `settings`, or return the one already built for the
   * same key. A different key on a worker that already holds a database is an
   * error: this worker cannot rebuild, and the caller owns the worker-per-key map.
   */
  async ensureDatabase(
    settings: ReferenceFinderDatabaseSettings
  ): Promise<ReferenceFinderDatabaseInfo> {
    const key = databaseKey(settings);
    if (database) {
      if (database.key === key) return database.info;
      throw failure('this worker already holds a database built with different settings');
    }
    if (databaseBuild) {
      if (databaseBuild.key === key) return databaseBuild.promise;
      throw failure('this worker is already building a database with different settings');
    }
    const promise = enqueue(() => buildDatabase(settings, key)).catch((error: unknown) => {
      databaseBuild = null;
      throw normalizeError(error);
    });
    databaseBuild = { key, promise };
    return promise;
  },

  solvePoint(x: number, y: number, settings: ReferenceFinderQuerySettings): Promise<RawSolution[]> {
    return enqueue(() => runQuery(encodePointQuery(x, y, settings))).catch((error: unknown) => {
      throw normalizeError(error);
    });
  },

  solveLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    settings: ReferenceFinderQuerySettings
  ): Promise<RawSolution[]> {
    return enqueue(() => runQuery(encodeLineQuery(x1, y1, x2, y2, settings))).catch(
      (error: unknown) => {
        throw normalizeError(error);
      }
    );
  },

  /**
   * Ask a running database build to stop. Honoured only if the core polls
   * `checkCancel` during the build, which the vendored core does not (it polls
   * during statistics runs alone); the runtime's real cancel is `terminate()`.
   */
  cancelBuild(): void {
    buildCancelRequested = true;
  },

  /**
   * Forget the database. The module's memory cannot be released from here — the
   * suspended `main()` holds it — so the owner terminates the worker after this.
   */
  dispose(): void {
    database = null;
    databaseBuild = null;
    collector = null;
    inputQueue.length = 0;
  },
};

export type ReferenceFinderWorkerApi = typeof api;

expose(api);
