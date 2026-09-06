/**
 * The precrease planner bridge (`crates/oristudio-precrease-wasm`), alone in a
 * worker.
 *
 * Phase 3 uses the crate's *frames* slice only: the sheet frame(s) hidden in a
 * crease pattern's border creases, its segments merged into distinct lines, an
 * exactness verdict, and the two point maps between Oriedita model space and a
 * component's ReferenceFinder rectangle. The closure planner (Phase 4/5 of
 * `implementation-plans/reference-finder-integration.md`) adds its methods to
 * this same `api` object — `PrecreasePlanner` handles held across chunks,
 * `close(budget_ms)`, `fold`, `remaining`, `sequence` — so the runtime that
 * owns this worker (`store/workspaceStore/precreaseRuntime.ts`) does not change
 * shape when it lands.
 *
 * Every argument is validated here, at the boundary. wasm-bindgen reads a
 * `&[f64]` straight out of the typed array it is handed, so a plain array or a
 * `Float32Array` in that position is not a type error but an opaque
 * "memory access out of bounds" trap (see the `wasm-bindgen argument traps`
 * note). Errors leave as `{ code, message }` envelopes like every other bridge.
 *
 * Same shape as `oristudioCpWorker.ts`: lazy `init()`, one `call()` wrapper.
 */
import { expose } from 'comlink';
import init, {
  model_to_rf,
  precrease_tolerances,
  rf_to_model,
  sheet_frames,
} from '../generated/oristudio-precrease-wasm/oristudio_precrease_wasm';
import type { WasmErrorEnvelope } from '../engine/types';
import type {
  PrecreaseFrame,
  PrecreaseTolerances,
  SheetAnalysis,
} from '../cp-workspace/references/sheetFrames';

let ready: Promise<void> | null = null;

async function ensureReady(): Promise<void> {
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
    code: 'oristudio_precrease_wasm_error',
    message: error instanceof Error ? error.message : String(error),
  };
}

function invalidInput(message: string): WasmErrorEnvelope {
  return { code: 'invalid_input', message };
}

async function call<T>(fn: () => T): Promise<T> {
  await ensureReady();
  try {
    return fn();
  } catch (error) {
    throw normalizeError(error);
  }
}

function requireFloat64Array(name: string, value: unknown): Float64Array {
  if (!(value instanceof Float64Array)) {
    throw invalidInput(`${name} must be a Float64Array`);
  }
  return value;
}

function requireInt32Array(name: string, value: unknown): Int32Array {
  if (!(value instanceof Int32Array)) {
    throw invalidInput(`${name} must be an Int32Array`);
  }
  return value;
}

function requireFinite(name: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidInput(`${name} must be a finite number`);
  }
  return value;
}

function requirePair(name: string, value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw invalidInput(`${name} must be a [x, y] pair`);
  }
  return [requireFinite(`${name}[0]`, value[0]), requireFinite(`${name}[1]`, value[1])];
}

/**
 * The frame as the Rust side deserialises it. Checked field by field so a frame
 * that came back from `sheetFrames` and was then mangled (a `null` where a
 * component was refused, say) is a readable error rather than a serde one.
 */
function requireFrame(value: unknown): PrecreaseFrame {
  if (!value || typeof value !== 'object') {
    throw invalidInput('frame must be an object');
  }
  const frame = value as Record<string, unknown>;
  return {
    origin: requirePair('frame.origin', frame.origin),
    x_axis: requirePair('frame.x_axis', frame.x_axis),
    y_axis: requirePair('frame.y_axis', frame.y_axis),
    width: requireFinite('frame.width', frame.width),
    height: requireFinite('frame.height', frame.height),
  };
}

const api = {
  /**
   * Sheet frames, merged lines and exactness for a crease pattern.
   *
   * `segments` is `[x1, y1, x2, y2, …]` in Oriedita model space; `colors` has
   * one Oriedita colour code per segment (0 border, 1 mountain, 2 valley, 3
   * auxiliary, negative unassigned); `paperFallback` is `[x0, y0, x1, y1]`,
   * used only when the pattern has no border creases.
   */
  async sheetFrames(
    segments: Float64Array,
    colors: Int32Array,
    paperFallback?: Float64Array
  ): Promise<SheetAnalysis> {
    const segs = requireFloat64Array('segments', segments);
    const cols = requireInt32Array('colors', colors);
    if (segs.length % 4 !== 0) {
      throw invalidInput(`segments must hold 4 values per segment, got ${segs.length}`);
    }
    if (cols.length !== segs.length / 4) {
      throw invalidInput(
        `colors must have one entry per segment: ${cols.length} colors for ${segs.length / 4} segments`
      );
    }
    let fallback: Float64Array | undefined;
    if (paperFallback !== undefined) {
      fallback = requireFloat64Array('paperFallback', paperFallback);
      if (fallback.length !== 4) {
        throw invalidInput(`paperFallback must be [x0, y0, x1, y1], got ${fallback.length} values`);
      }
    }
    return call(() => sheet_frames(segs, cols, fallback) as SheetAnalysis);
  },

  /** Model point → the component's ReferenceFinder rectangle. */
  async modelToRf(frame: PrecreaseFrame, x: number, y: number): Promise<[number, number]> {
    const f = requireFrame(frame);
    const px = requireFinite('x', x);
    const py = requireFinite('y', y);
    return call(() => {
      const out = model_to_rf(f, px, py);
      return [out[0], out[1]];
    });
  },

  /** ReferenceFinder rectangle point → model space. */
  async rfToModel(frame: PrecreaseFrame, x: number, y: number): Promise<[number, number]> {
    const f = requireFrame(frame);
    const px = requireFinite('x', x);
    const py = requireFinite('y', y);
    return call(() => {
      const out = rf_to_model(f, px, py);
      return [out[0], out[1]];
    });
  },

  /**
   * `rfToModel` over many points in one round trip: `points` is `[x, y, …]`
   * and the result is parallel. A candidate's steps are a few dozen points,
   * and mapping them one comlink message at a time was the only thing on the
   * critical path between a query answering and its steps drawing.
   */
  async rfToModelMany(frame: PrecreaseFrame, points: Float64Array): Promise<Float64Array> {
    const f = requireFrame(frame);
    const pts = requireFloat64Array('points', points);
    if (pts.length % 2 !== 0) {
      throw invalidInput(`points must hold 2 values per point, got ${pts.length}`);
    }
    for (let i = 0; i < pts.length; i += 1) {
      if (!Number.isFinite(pts[i])) throw invalidInput(`points[${i}] must be a finite number`);
    }
    return call(() => {
      const out = new Float64Array(pts.length);
      for (let i = 0; i < pts.length; i += 2) {
        const mapped = rf_to_model(f, pts[i], pts[i + 1]);
        out[i] = mapped[0];
        out[i + 1] = mapped[1];
      }
      return out;
    });
  },

  /** `{ tol, snap_radius }` — the crate's tolerance constants, never restated in TS. */
  async tolerances(): Promise<PrecreaseTolerances> {
    return call(() => precrease_tolerances() as PrecreaseTolerances);
  },
};

export type PrecreaseWorkerApi = typeof api;

expose(api);
