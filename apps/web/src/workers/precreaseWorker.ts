/**
 * The precrease planner bridge (`crates/oristudio-precrease-wasm`), alone in a
 * worker.
 *
 * The sheets themselves are the CP kernel's (its sheet index): this frames
 * their outlines, merges one sheet's segments into distinct lines with an
 * exactness verdict, and maps points between Oriedita model space and a
 * sheet's ReferenceFinder rectangle. The closure planner (Phase 4/5 of
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
  outline_components,
  precrease_tolerances,
  PrecreasePlanner,
  rf_to_model,
  sheet_component,
} from '../generated/oristudio-precrease-wasm/oristudio_precrease_wasm';
import type { WasmErrorEnvelope } from '../engine/types';
import type {
  PrecreaseComponent,
  PrecreaseFrame,
  PrecreaseTolerances,
  SheetAnalysis,
} from '../cp-workspace/references/sheetFrames';
import type {
  PrecreaseCloseReport,
  PrecreaseDriverState,
  PrecreasePlanAction,
  PrecreaseExplanation,
  PrecreaseFoldOutcome,
  PrecreasePlannerInfo,
  PrecreasePlannerOptions,
  PrecreaseSequence,
  PrecreaseStuckSummary,
} from '../cp-workspace/references/precreaseSequence';
import { PRECREASE_UNAVAILABLE } from '../cp-workspace/references/precreaseFailures';

let ready: Promise<void> | null = null;

/**
 * The bridge, started once. A start that failed — its `.wasm` did not arrive,
 * or did not compile — is forgotten, so the next call starts it again: the
 * References workspace keeps this worker for as long as it is open, and
 * nothing replaces a worker that is alive (ORI-STUDIO-1B).
 */
function ensureReady(): Promise<void> {
  if (ready) return ready;
  const starting = init().then(() => undefined);
  ready = starting;
  starting.catch(() => {
    if (ready === starting) ready = null;
  });
  return starting;
}

/**
 * A start that failed, as a call answers it: the browser's words under the
 * bridge's own code, so References can tell a planner that did not load from
 * a planner that failed, and not a bare `TypeError` crossing comlink.
 */
function startFailure(error: unknown): WasmErrorEnvelope {
  return {
    code: PRECREASE_UNAVAILABLE,
    message: error instanceof Error ? error.message : String(error),
  };
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
  try {
    await ensureReady();
  } catch (error) {
    // Nothing ran, and the next call starts the bridge again.
    throw startFailure(error);
  }
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

function requireUint32Array(name: string, value: unknown): Uint32Array {
  if (!(value instanceof Uint32Array)) {
    throw invalidInput(`${name} must be a Uint32Array`);
  }
  return value;
}

/**
 * One sheet's lines as the bridge takes them: coordinates, one colour code and
 * one document index per segment, and an outline of `[x, y]` pairs.
 */
function requireSheet(
  outline: unknown,
  segments: unknown,
  colors: unknown,
  indices: unknown
): { outline: Float64Array; segments: Float64Array; colors: Int32Array; indices: Uint32Array } {
  const ring = requireFloat64Array('outline', outline);
  if (ring.length % 2 !== 0) {
    throw invalidInput(`outline must hold 2 values per point, got ${ring.length}`);
  }
  const segs = requireFloat64Array('segments', segments);
  const cols = requireInt32Array('colors', colors);
  const ids = requireUint32Array('indices', indices);
  if (segs.length % 4 !== 0) {
    throw invalidInput(`segments must hold 4 values per segment, got ${segs.length}`);
  }
  if (cols.length !== segs.length / 4 || ids.length !== segs.length / 4) {
    throw invalidInput(
      `colors and indices must have one entry per segment: ${cols.length} colors and ${ids.length} indices for ${segs.length / 4} segments`
    );
  }
  return { outline: ring, segments: segs, colors: cols, indices: ids };
}

function requireUint8Array(name: string, value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw invalidInput(`${name} must be a Uint8Array`);
  }
  return value;
}

/** `[nx, ny, d]` triples: the length is checked here, the values in Rust. */
function requireLines(name: string, value: unknown): Float64Array {
  const lines = requireFloat64Array(name, value);
  if (lines.length % 3 !== 0) {
    throw invalidInput(`${name} must hold 3 values per line, got ${lines.length}`);
  }
  return lines;
}

function requireFinite(name: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidInput(`${name} must be a finite number`);
  }
  return value;
}

function requireComponentId(value: unknown): number {
  const id = requireFinite('id', value);
  if (id < 0 || !Number.isInteger(id)) {
    throw invalidInput(`id must be a non-negative integer, got ${String(value)}`);
  }
  return id;
}

function requirePair(name: string, value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw invalidInput(`${name} must be a [x, y] pair`);
  }
  return [requireFinite(`${name}[0]`, value[0]), requireFinite(`${name}[1]`, value[1])];
}

/**
 * The frame as the Rust side deserialises it. Checked field by field so a frame
 * that came back from `outlineComponents` and was then mangled (a `null` where
 * a component was refused, say) is a readable error rather than a serde one.
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

/**
 * The live planner, held across chunks.
 *
 * One at a time: the workspace plans one component — the picked one, or each in
 * turn for the whole-pattern breakdown — and a planner's point store is the
 * expensive thing here (up to the 600,000-point cap). `plannerCreateForSheet`
 * disposes whatever was there, and the References workspace disposes on leaving.
 */
let planner: PrecreasePlanner | null = null;
let plannerToken = 0;

function requirePlanner(token: number): PrecreasePlanner {
  if (!planner || token !== plannerToken) {
    throw invalidInput(
      `no planner for token ${token}; create one with plannerCreateForSheet before using it`
    );
  }
  return planner;
}

function disposePlanner(): void {
  planner?.free();
  planner = null;
}

const api = {
  /**
   * Sheets already found — the CP kernel's sheet index — framed from their
   * outlines alone: one component per outline, with its frame or the reason
   * it is refused, and no lines. Sheet `i`'s outline is points
   * `outlineOffsets[i]..outlineOffsets[i + 1]` of `outlineCoords`.
   */
  async outlineComponents(
    outlineCoords: Float64Array,
    outlineOffsets: Uint32Array
  ): Promise<PrecreaseComponent[]> {
    const coords = requireFloat64Array('outlineCoords', outlineCoords);
    const offsets = requireUint32Array('outlineOffsets', outlineOffsets);
    return call(() => outline_components(coords, offsets) as PrecreaseComponent[]);
  },

  /**
   * One sheet already found — its outline and only its lines — framed, merged
   * and probed: what the planner reads of it. `indices` is each line's
   * 0-based number in the document, the numbering the result is in; the one
   * component's id is `id`.
   */
  async sheetComponent(
    id: number,
    outline: Float64Array,
    segments: Float64Array,
    colors: Int32Array,
    indices: Uint32Array
  ): Promise<SheetAnalysis> {
    const sheet = requireSheet(outline, segments, colors, indices);
    const component = requireComponentId(id);
    return call(
      () =>
        sheet_component(
          component,
          sheet.outline,
          sheet.segments,
          sheet.colors,
          sheet.indices
        ) as SheetAnalysis
    );
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

  // --- The planner ---------------------------------------------------------
  //
  // A handle rather than one `plan()` call, because the orchestration is
  // TypeScript's (plan decision D6): the closure runs in resumable chunks so
  // the UI can show progress and stay cancellable, and the stuck loop reaches
  // out to the ReferenceFinder worker between them. `token` is what makes a
  // late call from a superseded run a readable error instead of an answer
  // about the wrong component.

  /**
   * Create the planner for one sheet already found, from its outline and only
   * its lines (as `sheetComponent` takes them), replacing any previous one:
   * nothing else of the pattern crosses to the worker or is analysed. Returns
   * the token every other planner call must carry.
   */
  async plannerCreateForSheet(
    id: number,
    outline: Float64Array,
    segments: Float64Array,
    colors: Int32Array,
    indices: Uint32Array,
    options?: PrecreasePlannerOptions
  ): Promise<{ token: number; info: PrecreasePlannerInfo }> {
    const sheet = requireSheet(outline, segments, colors, indices);
    const component = requireComponentId(id);
    if (options !== undefined && (typeof options !== 'object' || options === null)) {
      throw invalidInput('options must be an object');
    }
    const optsJson = options ? JSON.stringify(options) : '';
    return call(() => {
      disposePlanner();
      planner = PrecreasePlanner.for_sheet(
        component,
        sheet.outline,
        sheet.segments,
        sheet.colors,
        sheet.indices,
        optsJson
      );
      plannerToken += 1;
      return { token: plannerToken, info: planner.info() as PrecreasePlannerInfo };
    });
  },

  /** Free the planner and its point store. Idempotent. */
  async plannerDispose(): Promise<void> {
    // Behind a start in flight, so a planner it goes on to create is the one
    // freed. A start that failed made no planner to free.
    await ensureReady().catch(() => undefined);
    disposePlanner();
  },

  /** Status, sheet, target counts and what the exactness policy did. */
  async plannerInfo(token: number): Promise<PrecreasePlannerInfo> {
    const id = requireFinite('token', token);
    return call(() => requirePlanner(id).info() as PrecreasePlannerInfo);
  },

  /**
   * Run the closure for at most `budgetMs` (0: unbounded). Resumable — a call
   * that stops on its deadline keeps every fact, so the orchestrator drives it
   * in chunks and reports progress between them.
   */
  async plannerClose(token: number, budgetMs: number): Promise<PrecreaseCloseReport> {
    const id = requireFinite('token', token);
    const budget = requireFinite('budgetMs', budgetMs);
    return call(() => requirePlanner(id).close(budget) as PrecreaseCloseReport);
  },

  /** Seven numbers per remaining CP line: `nx, ny, d, ax, ay, bx, by`. */
  async plannerRemaining(token: number): Promise<Float64Array> {
    const id = requireFinite('token', token);
    return call(() => requirePlanner(id).remaining());
  },

  /** One decimal `u64` cache key per remaining line, in `remaining()`'s order. */
  async plannerLineKeys(token: number): Promise<string[]> {
    const id = requireFinite('token', token);
    return call(() => requirePlanner(id).line_keys());
  },

  /**
   * What to do next, by the crate's `drive::next_action`.
   *
   * The rules live there so this driver's loop and the headless one cannot
   * drift; see `precreasePlan.ts` for what stays on this side and why.
   */
  async plannerNextAction(
    token: number,
    driver: PrecreaseDriverState
  ): Promise<PrecreasePlanAction> {
    const id = requireFinite('token', token);
    return call(() => requirePlanner(id).next_action(driver) as PrecreasePlanAction);
  },

  /** Forward-first search from the stuck state; applies what it chooses. */
  async plannerStuckSearch(
    token: number,
    depth: number,
    budgetMs: number
  ): Promise<PrecreaseStuckSummary | null> {
    const id = requireFinite('token', token);
    const d = requireFinite('depth', depth);
    const budget = requireFinite('budgetMs', budgetMs);
    return call(
      () => requirePlanner(id).stuck_search(d, budget) as PrecreaseStuckSummary | null
    );
  },

  /** `0` for "not constructible from here", else `1 + unlocks`. Folds nothing. */
  async plannerScore(token: number, lines: Float64Array): Promise<Uint32Array> {
    const id = requireFinite('token', token);
    const values = requireLines('lines', lines);
    return call(() => requirePlanner(id).score(values));
  },

  /**
   * Fold supplied lines in order — each only if the current state constructs
   * it — then re-close. `tags`: 0 cp, 1 aux, 2 rf_aux.
   */
  async plannerFold(
    token: number,
    lines: Float64Array,
    tags: Uint8Array,
    budgetMs: number
  ): Promise<PrecreaseFoldOutcome[]> {
    const id = requireFinite('token', token);
    const values = requireLines('lines', lines);
    const codes = requireUint8Array('tags', tags);
    if (codes.length !== values.length / 3) {
      throw invalidInput(
        `tags must have one entry per line: ${codes.length} tags for ${values.length / 3} lines`
      );
    }
    const budget = requireFinite('budgetMs', budgetMs);
    return call(
      () => requirePlanner(id).fold(values, codes, budget) as PrecreaseFoldOutcome[]
    );
  },

  /**
   * Fold the remaining target equal to `target` by the closest construction
   * there is — `constructed`, a line the current state reproduces exactly,
   * `err` from the target in the planner's unit frame — then re-close.
   */
  async plannerFoldApproximation(
    token: number,
    target: Float64Array,
    constructed: Float64Array,
    err: number,
    budgetMs: number
  ): Promise<PrecreaseFoldOutcome> {
    const id = requireFinite('token', token);
    const targetValues = requireLines('target', target);
    const constructedValues = requireLines('constructed', constructed);
    if (targetValues.length !== 3 || constructedValues.length !== 3) {
      throw invalidInput('target and constructed must each be one [nx, ny, d] triple');
    }
    const error = requireFinite('err', err);
    if (error < 0) throw invalidInput(`err must be non-negative, got ${error}`);
    const budget = requireFinite('budgetMs', budgetMs);
    return call(
      () =>
        requirePlanner(id).fold_approximation(
          targetValues,
          constructedValues,
          error,
          budget
        ) as PrecreaseFoldOutcome
    );
  },

  /** The plan in its wire shape. */
  async plannerSequence(token: number, landmarksFirst: boolean): Promise<PrecreaseSequence> {
    const id = requireFinite('token', token);
    if (typeof landmarksFirst !== 'boolean') {
      throw invalidInput('landmarksFirst must be a boolean');
    }
    return call(() => requirePlanner(id).sequence(landmarksFirst) as PrecreaseSequence);
  },

  /** Everything known about one `[nx, ny, d]` line. */
  async plannerExplain(token: number, line: Float64Array): Promise<PrecreaseExplanation> {
    const id = requireFinite('token', token);
    const values = requireLines('line', line);
    if (values.length !== 3) {
      throw invalidInput(`explain takes one [nx, ny, d] triple, got ${values.length} values`);
    }
    return call(() => requirePlanner(id).explain(values) as PrecreaseExplanation);
  },

  /** `[nx, ny, d]` triples → two points per line in the ReferenceFinder rectangle. */
  async plannerToRf(token: number, lines: Float64Array): Promise<Float64Array> {
    const id = requireFinite('token', token);
    const values = requireLines('lines', lines);
    return call(() => requirePlanner(id).to_rf(values));
  },

  /** Four numbers per line (two points) → canonical `[nx, ny, d]` triples. */
  async plannerFromRf(token: number, points: Float64Array): Promise<Float64Array> {
    const id = requireFinite('token', token);
    const values = requireFloat64Array('points', points);
    if (values.length % 4 !== 0) {
      throw invalidInput(`points must hold 4 values per line, got ${values.length}`);
    }
    return call(() => requirePlanner(id).from_rf(values));
  },
};

export type PrecreaseWorkerApi = typeof api;

expose(api);
