/**
 * A Fold engine that can no longer be trusted, told apart from one that
 * answered with an error.
 *
 * The bridge's errors are `{ code, message }` envelopes it returns on purpose
 * (`foldEngineCalls.ts`): the call ended, the engine is sound. Anything else
 * thrown out of a call — a `WebAssembly.RuntimeError` (a Rust panic, an
 * index out of bounds, an allocation that failed), a stack overflow, a JS
 * exception that unwound through the module — left the call halfway. Rust
 * ran no destructors on the way out, so the instance's borrow flag stays set
 * and every later call throws wasm-bindgen's "recursive use of an object
 * detected"; its memory may be half-written too. That instance is dead: the
 * worker answers nothing more from it (`workers/foldSequenceWorker.ts`), and
 * the runtime replaces the worker (`store/workspaceStore/foldSequenceRuntime.ts`).
 *
 * Pure: no React, no store, no wasm.
 */

import type { WasmErrorEnvelope } from '../../engine/types';

export const FOLD_ENGINE_TRAPPED = 'fold_engine_trapped';

/**
 * How a call killed the engine: the module trapped (`wasm_trap`), it was
 * already dead when called (`engine_poisoned`, wasm-bindgen's borrow error,
 * after a failure something swallowed), or anything else that was not an
 * envelope (`unexpected_error`).
 */
export type FoldEngineTrapKind = 'wasm_trap' | 'engine_poisoned' | 'unexpected_error';

/** Why the engine's worker went away by itself: a trap, or the worker dying (its `error` event). */
export type FoldEngineCrashCause = FoldEngineTrapKind | 'worker_error';

/** What the worker throws for a trap, and for every call after it. */
export interface FoldEngineTrapped extends WasmErrorEnvelope {
  readonly code: typeof FOLD_ENGINE_TRAPPED;
  readonly trap: FoldEngineTrapKind;
  /** The failure's own stack, from the worker: frames of our code and the module, nothing of the user's. */
  readonly stack?: string;
}

/** wasm-bindgen's message for a call on an object whose borrow a trap left set. */
const RECURSIVE_USE = 'recursive use of an object detected';

export function isFoldEngineTrapped(error: unknown): error is FoldEngineTrapped {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === FOLD_ENGINE_TRAPPED;
}

/** A `{ code, message }` the bridge or the calls threw on purpose. */
function isEnvelope(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    typeof (error as { code?: unknown }).code === 'string' &&
    'message' in error
  );
}

function trapKindOf(error: unknown): FoldEngineTrapKind {
  if (typeof WebAssembly !== 'undefined' && error instanceof WebAssembly.RuntimeError) return 'wasm_trap';
  if (error instanceof Error && error.message.includes(RECURSIVE_USE)) return 'engine_poisoned';
  return 'unexpected_error';
}

/**
 * What a call's failure says of the engine: null for an envelope, which
 * leaves it sound; otherwise the trap that killed it, as the worker sends it.
 */
export function foldEngineTrapOf(error: unknown): FoldEngineTrapped | null {
  if (isFoldEngineTrapped(error)) return error;
  if (isEnvelope(error)) return null;
  const trap = trapKindOf(error);
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  return { code: FOLD_ENGINE_TRAPPED, trap, message, ...(stack ? { stack } : {}) };
}

/** A crash as the runtime reports it: why, and the failure behind it. */
export interface FoldEngineCrashReport {
  readonly cause: FoldEngineCrashCause;
  readonly message: string;
  readonly stack?: string;
}

/**
 * The crash as Sentry should see it: an `Error` named for it, carrying the
 * worker's stack where there is one, so the frames point at the module and
 * not at the runtime that noticed.
 */
export class FoldEngineCrash extends Error {
  readonly reason: FoldEngineCrashCause;

  constructor({ cause, message, stack }: FoldEngineCrashReport) {
    super(`${cause}: ${message}`);
    this.name = 'FoldEngineCrash';
    this.reason = cause;
    if (stack) this.stack = stack;
  }
}
