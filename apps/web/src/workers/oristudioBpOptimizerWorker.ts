import { expose } from 'comlink';
import init, {
  bp_optimizer_solve_report_with_progress,
} from '../generated/oristudio-bp-wasm/oristudio_bp_wasm';
import type { OristudioBpOptimizerEvent } from '../engine/oristudioBpTypes';
import type { WasmErrorEnvelope } from '../engine/types';

let ready: Promise<void> | null = null;

async function ensureReady() {
  ready ??= init().then(() => undefined);
  await ready;
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
    code: 'oristudio_bp_optimizer_worker',
    message: error instanceof Error ? error.message : String(error),
  };
}

async function call<T>(fn: () => T): Promise<T> {
  await ensureReady();
  try {
    return fn();
  } catch (error) {
    throw normalizeError(error);
  }
}

const api = {
  async solveReportWithProgress(
    request: unknown,
    seed: number | null,
    onEvent: (event: OristudioBpOptimizerEvent) => void,
  ): Promise<unknown> {
    return call(() => bp_optimizer_solve_report_with_progress(request, seed, onEvent));
  },
};

export type OristudioBpOptimizerWorkerApi = typeof api;

expose(api);
