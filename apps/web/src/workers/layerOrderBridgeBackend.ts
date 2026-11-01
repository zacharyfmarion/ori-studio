/**
 * The Layer order engine's backend over the Fold bridge's `layer_*` calls
 * (E7, `layer-order/engine/layerOrderWire.ts`): what `layerOrderWorker.ts`
 * hands the worker shell (`layerOrderWorkerApi.ts`).
 *
 * It takes the bridge as an object, so it never imports the wasm glue
 * itself: the worker builds the engine, and the Node tests hand it one built
 * from the same bridge (`layer-order/engine/layerOrderEngine.wasm.test.ts`).
 *
 * What it keeps, so the contract needs no handles:
 *
 * - **The session.** At most one; an open or a restore closes the one
 *   before, with its cursor, before it asks for the next, so a worker never
 *   holds two figures at once. The source's model is kept for the scenes.
 * - **The solutions cursor.** Started on the first count slice, step or
 *   position; closed and started again (a new `epoch`) when the committed
 *   constraints change: a commit that committed, a restore. A step keeps it,
 *   as E6 does. Should the bridge still call a cursor stale, it is started
 *   again on the spot, so the count never stops on it. Whether its steps
 *   also count on (E9's `countInSteps`) is decided as it starts, by the
 *   pairs open then ({@link LayerOrderBridgeBackendOptions.countInSteps}).
 *
 * Everything else is the bridge's answer as it is, minus the handle, with
 * constraints as tuples and the record as `LayerOrderRecord`. A refusal is a
 * value; the bridge's thrown `{ code, message }` passes through, and a trap
 * (anything else) is the shell's to classify.
 */
import type { OristudioCpFoldedFigureModel } from '../engine/oristudioCpTypes';
import type { WasmErrorEnvelope } from '../engine/types';
import {
  LAYER_ORDER_CALL_FAILURES,
  packConstraints,
  unpackConstraints,
  type LayerConstraint,
  type LayerOrderLimits,
  type LayerOrderOpenOutcome,
  type LayerOrderRestoreOutcome,
  type LayerRefusal,
} from '../layer-order/engine/layerOrderEngine';
import type {
  LayerOpenOutcome,
  LayerOrderBridge,
  LayerRestoreOutcome,
  LayerSolutionCaps,
} from '../layer-order/engine/layerOrderWire';
import { NEWER } from '../lib/documentFile';
import { encodeLayerOrderRecord, readLayerOrderRecord, type LayerOrderRecord } from '../lib/layerOrder/layerOrderRecord';
import { kernelFoldSourceOf } from '../lib/layerOrder/layerOrderSource';
import type { LayerOrderBackend } from './layerOrderWorkerApi';

export interface LayerOrderBridgeBackendOptions {
  /** How far a count goes before it reads "at least"; E6's defaults when left out (E8 sets them). */
  readonly caps?: LayerSolutionCaps;
  /**
   * Whether a step also counts on (E9's `countInSteps`), for a cursor started
   * on a session that leaves `openPairs` pairs open, read as each cursor
   * starts: the worker's `layerOrderStepsCount` for its role. The wire's
   * default (it does) when left out.
   */
  readonly countInSteps?: (openPairs: number) => boolean;
}

/** A thrown code the bridge uses for a cursor that counted other constraints. */
const STALE_SOLUTIONS = 'session_stale_solutions';

function codeOf(error: unknown): string | undefined {
  return error && typeof error === 'object' ? (error as { code?: string }).code : undefined;
}

/** The record as the bridge reads it, or why it cannot be sent: the codec's own refusal. */
function recordJson(record: LayerOrderRecord): { json: string } | { refusal: LayerRefusal } {
  const encoded = encodeLayerOrderRecord(record);
  if (encoded.ok) return { json: encoded.json };
  if (encoded.reason === 'over-budget') {
    return { refusal: { code: 'record_over_budget', bytes: encoded.bytes, budget: encoded.budget } };
  }
  return { refusal: { code: 'record_damaged', damage: encoded.part } };
}

function opened(outcome: LayerOpenOutcome): LayerOrderOpenOutcome {
  if (outcome.status !== 'ok') return outcome;
  const { session: _session, ...rest } = outcome;
  return rest;
}

function restored(outcome: LayerRestoreOutcome): LayerOrderRestoreOutcome {
  if (outcome.status !== 'ok') return outcome;
  const { session: _session, constraints, ...rest } = outcome;
  return { ...rest, constraints: unpackConstraints(constraints) };
}

/** The bridge's limits: the contract's, which name the same fields. */
function limitsOf(limits: LayerOrderLimits) {
  return { maxNodes: limits.maxNodes, fastNodes: limits.fastNodes, deadlineMs: limits.deadlineMs };
}

interface Session {
  readonly handle: number;
  readonly model: OristudioCpFoldedFigureModel;
}

interface Cursor {
  readonly handle: number;
  readonly epoch: number;
}

export function createLayerOrderBridgeBackend(
  bridge: LayerOrderBridge,
  options: LayerOrderBridgeBackendOptions = {}
): LayerOrderBackend {
  let session: Session | null = null;
  let cursor: Cursor | null = null;
  let epoch = 0;

  const current = (): Session => {
    if (session) return session;
    throw {
      code: LAYER_ORDER_CALL_FAILURES.sessionNotOpen,
      message: 'No layer order session is open.',
    } satisfies WasmErrorEnvelope;
  };

  /** Let the cursor go: the committed constraints changed, or the session is going. */
  const dropCursor = () => {
    const gone = cursor;
    cursor = null;
    if (gone && session) bridge.layer_solutions_close(session.handle, gone.handle);
  };

  /** What a cursor starts with on `now`: the caps, and whether its steps count on, by the pairs open now. */
  const capsOf = (now: Session): LayerSolutionCaps | undefined => {
    const { caps, countInSteps } = options;
    if (!countInSteps) return caps;
    return { ...caps, countInSteps: countInSteps(bridge.layer_open_pairs(now.handle).length / 2) };
  };

  /** The session's cursor, started if there is none. */
  const cursorOf = (now: Session): Cursor => {
    if (!cursor) {
      epoch += 1;
      cursor = { handle: bridge.layer_solutions_start(now.handle, capsOf(now)), epoch };
    }
    return cursor;
  };

  /** Ask the cursor; a cursor the bridge calls stale is replaced once, and asked again. */
  const withCursor = <T>(ask: (now: Session, asked: Cursor) => T): T => {
    const now = current();
    try {
      return ask(now, cursorOf(now));
    } catch (error) {
      if (codeOf(error) !== STALE_SOLUTIONS) throw error;
      dropCursor();
      return ask(now, cursorOf(now));
    }
  };

  /** Close the session open, if any, with its cursor. */
  const closeSession = () => {
    const gone = session;
    if (!gone) return;
    dropCursor();
    session = null;
    bridge.layer_close(gone.handle);
  };

  /** Hold the session an open answered, replacing none (the one before is already closed). */
  const hold = <T extends LayerOpenOutcome>(outcome: T, model: OristudioCpFoldedFigureModel): T => {
    if (outcome.status === 'ok') session = { handle: outcome.session, model };
    return outcome;
  };

  return {
    open(source, limits) {
      closeSession();
      return opened(hold(bridge.layer_open(kernelFoldSourceOf(source), limitsOf(limits)), source.model));
    },

    openShowing(source, relations, limits) {
      closeSession();
      return opened(
        hold(bridge.layer_open_showing(kernelFoldSourceOf(source), relations, limitsOf(limits)), source.model)
      );
    },

    restore(source, record, limits) {
      closeSession();
      const sent = recordJson(record);
      if ('refusal' in sent) return { status: 'refused', refusal: sent.refusal };
      return restored(hold(bridge.layer_restore(kernelFoldSourceOf(source), sent.json, limitsOf(limits)), source.model));
    },

    restoreRecord(record, limits) {
      const now = current();
      const sent = recordJson(record);
      if ('refusal' in sent) return { status: 'refused', refusal: sent.refusal };
      const outcome = bridge.layer_restore_record(now.handle, sent.json, limitsOf(limits));
      // A restore commits the record's intact constraints, or none: either way, other constraints.
      if (outcome.status === 'ok') dropCursor();
      return restored(outcome);
    },

    openedOn: () => bridge.layer_opened_on(current().handle),
    openPairs: () => bridge.layer_open_pairs(current().handle),
    constraints: () => unpackConstraints(bridge.layer_constraints(current().handle)),

    preview: (candidate, limits) =>
      bridge.layer_preview(current().handle, packConstraints([candidate]), limitsOf(limits)),

    previewList: (constraints, limits) =>
      bridge.layer_preview_list(current().handle, packConstraints(constraints), limitsOf(limits)),

    commit(constraints, limits) {
      const committed = bridge.layer_commit(current().handle, packConstraints(constraints), limitsOf(limits));
      if (committed.verdict === 'committed') dropCursor();
      return committed;
    },

    order: () => bridge.layer_order(current().handle),

    show(constraints, order, limits) {
      const now = current();
      const before = bridge.layer_constraints(now.handle);
      const sent = packConstraints(constraints);
      const shown = bridge.layer_show(now.handle, sent, order, limitsOf(limits));
      // A cursor counting the same constraints stays good (a step's undo); other constraints, a new count.
      const same = before.length === sent.length && before.every((value, i) => value === sent[i]);
      if (shown.verdict === 'shown' && !same) dropCursor();
      return shown;
    },

    commitPreview(token, constraints, limits) {
      const committed = bridge.layer_commit_preview(
        current().handle,
        token,
        packConstraints(constraints),
        limitsOf(limits)
      );
      if (committed.verdict === 'committed') dropCursor();
      return committed;
    },

    carried: () => bridge.layer_carried(current().handle),
    removeCarried: (index) => bridge.layer_remove_carried(current().handle, index),
    clearCarried: () => bridge.layer_clear_carried(current().handle),

    stacks: (side) => bridge.layer_stacks(current().handle, side),

    scene(side) {
      const now = current();
      return bridge.layer_scene(now.handle, side, now.model);
    },

    save(keepCarried) {
      const keep = keepCarried ? Uint32Array.from(keepCarried) : undefined;
      const saved = bridge.layer_save(current().handle, keep);
      if (saved.status !== 'ok') return saved;
      const read = readLayerOrderRecord(saved.json);
      if (read === NEWER || !read.ok) {
        throw {
          code: 'session_internal',
          message: `The record the engine saved does not read here (${read === NEWER ? 'newer' : read.damage}).`,
        } satisfies WasmErrorEnvelope;
      }
      return { status: 'ok', record: read.record, json: saved.json };
    },

    relations: () => bridge.layer_oriedita_relations(current().handle),

    close() {
      closeSession();
    },

    explain(candidate: LayerConstraint | null, limits) {
      const now = current();
      return candidate
        ? bridge.layer_explain(now.handle, packConstraints([candidate]), limitsOf(limits))
        : bridge.layer_explain_list(now.handle, bridge.layer_constraints(now.handle), limitsOf(limits));
    },

    explainList: (constraints, limits) =>
      bridge.layer_explain_list(current().handle, packConstraints(constraints), limitsOf(limits)),

    countSlice: (limits) =>
      withCursor((now, asked) => ({
        epoch: asked.epoch,
        count: bridge.layer_solutions_advance(now.handle, asked.handle, limitsOf(limits)),
      })),

    position: (by) => withCursor((now, asked) => bridge.layer_solutions_position(now.handle, asked.handle, by)),

    step: (by, direction, limits) =>
      withCursor((now, asked) => bridge.layer_step(now.handle, asked.handle, by, direction, limitsOf(limits))),
  };
}
