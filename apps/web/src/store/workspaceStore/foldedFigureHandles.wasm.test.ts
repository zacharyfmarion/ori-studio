import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TFunction } from 'i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  OristudioCpEstimationOrder,
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureModel,
  OristudioCpFoldedFigureRenderOptions,
} from '../../engine/oristudioCpTypes';
import { MAX_CP_HISTORY } from './cpHistory';

/**
 * Seeded random chains of folded-figure verbs, undo and redo, over the real CP
 * kernel in Node, checking after every step that each kernel slot is held as
 * often as the live list and the history refer to it:
 *
 * 1. a slot something refers to is live in the kernel;
 * 2. a live slot is referred to by something;
 * 3. each slot's count is the number of references to it;
 * 4. no slot is shared by two figures.
 *
 * The race steps hold a Refold's, a Duplicate's or a fold's answer in the
 * kernel while an undo, a redo or a Delete runs, which is when a fold lands on
 * a figure that has moved on. Then history is filled past its cap and walked
 * to the bottom and back.
 *
 * The kernel stands in for the worker as an in-process client over the same
 * wasm calls. Skipped when the bridge has not been built; CI builds it first.
 */
const WASM = resolve(process.cwd(), 'src/generated/oristudio-cp-wasm/oristudio_cp_wasm_bg.wasm');
const KABUTO = resolve(process.cwd(), '../../tests/fixtures/flat-folder/kabuto.fold');
const wasmAvailable = existsSync(WASM);
type CpWasm = typeof import('../../generated/oristudio-cp-wasm/oristudio_cp_wasm');

const kernel = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('../../engines/engineHost', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engines/engineHost')>();
  return {
    ...actual,
    connectEngine: async () => kernel.client,
    isEngineConnected: () => kernel.client !== null,
  };
});

/** Calls the in-process kernel has run and not yet answered. */
let unanswered = 0;
/** The next fold's answer, held back while a race step runs; see {@link holdNextFold}. */
let heldFold: { armed: boolean; release: (() => void) | null } = { armed: false, release: null };

/**
 * As the worker does: a call reaches the kernel the moment it is made, and its
 * answer arrives in a later task. A fold's answer can be held back further.
 */
function answerLater<T>(call: () => T, fold = false): Promise<T> {
  let outcome: { value: T } | { error: unknown };
  try {
    outcome = { value: call() };
  } catch (error) {
    outcome = { error };
  }
  unanswered += 1;
  const held =
    fold && heldFold.armed
      ? new Promise<void>((release) => {
          heldFold = { armed: false, release };
        })
      : null;
  return new Promise((resolve, reject) => {
    const answer = () =>
      setTimeout(() => {
        unanswered -= 1;
        if ('error' in outcome) reject(outcome.error);
        else resolve(outcome.value);
      }, 0);
    if (held) void held.then(answer);
    else answer();
  });
}

/** The worker's API, the parts these verbs reach, over the wasm calls the worker makes. */
function inProcessClient(wasm: CpWasm) {
  const client = {
    operationDescriptors: () => answerLater(() => wasm.cp_operation_descriptors()),
    loadFoldFile: (text: string) => answerLater(() => wasm.load_fold_file(text)),
    documentGeometry: (handle: number) => answerLater(() => wasm.document_geometry(handle)),
    summary: (handle: number) => answerLater(() => wasm.document_summary(handle)),
    sheetIndex: (handle: number) => answerLater(() => wasm.sheet_index(handle)),
    freeDocument: (handle: number) => answerLater(() => wasm.free_document(handle)),
    foldFigure: (
      handle: number,
      startingFaceId = 1,
      order: OristudioCpEstimationOrder = 'Order5',
      model?: OristudioCpFoldedFigureModel,
      selectedLineIds: number[] = [],
      runId = 0
    ) =>
      answerLater(
        () =>
          selectedLineIds.length > 0
            ? wasm.folded_figure_fold_selected(handle, selectedLineIds, startingFaceId, order, model ?? null, runId)
            : wasm.folded_figure_fold(handle, startingFaceId, order, model ?? null, runId),
        true
      ),
    foldedFigureSnapshot: (handle: number) => answerLater(() => wasm.folded_figure_snapshot(handle)),
    foldedFigureRenderSnapshot: (
      handle: number,
      displayStyle?: OristudioCpFoldedFigureDisplayStyle,
      options?: OristudioCpFoldedFigureRenderOptions
    ) => answerLater(() => wasm.folded_figure_render_snapshot(handle, displayStyle ?? null, options ?? null)),
    setFoldedFigureModel: (handle: number, model: OristudioCpFoldedFigureModel) =>
      answerLater(() => wasm.folded_figure_set_model(handle, model)),
    duplicateFoldedFigure: (handle: number) => answerLater(() => wasm.folded_figure_duplicate(handle), true),
    foldFigureAnother: (handle: number, runId = 0) => answerLater(() => wasm.folded_figure_fold_another(handle, runId)),
    foldFigureToCase: (
      handle: number,
      objective: number,
      order: OristudioCpEstimationOrder = 'Order5',
      runId = 0
    ) => answerLater(() => wasm.folded_figure_fold_to_case(handle, objective, order, runId)),
    freeFoldedFigure: (handle: number) => answerLater(() => wasm.free_folded_figure(handle)),
  };
  // A call these verbs were not expected to make fails loudly. `then` stays
  // undefined: the client is resolved from a promise.
  return new Proxy(client, {
    get: (target, name) =>
      name in target || name === 'then'
        ? target[name as keyof typeof target]
        : () => Promise.reject(new Error(`the in-process kernel has no ${String(name)}`)),
  });
}

/** Mulberry32: a seeded stream, so a failing chain replays from its seed. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

describe.skipIf(!wasmAvailable)('folded-figure handles through random verbs, undo and redo', () => {
  let wasm: CpWasm;
  let store: typeof import('./store').useWorkspaceStore;
  let handles: typeof import('../../cp-workspace/folded/foldedFigureHandles');
  let gesture: typeof import('../../cp-workspace/folded/foldedFigureGesture').foldedFigureGesture;
  let verbs: typeof import('../../cp-workspace/folded/foldedFigureVerbs');
  let endOpenCanvasSessions: typeof import('../../cp-workspace/canvasObjects/canvasSessions').endOpenCanvasSessions;

  beforeAll(async () => {
    wasm = await import('../../generated/oristudio-cp-wasm/oristudio_cp_wasm');
    wasm.initSync({ module: readFileSync(WASM) });
    kernel.client = inProcessClient(wasm);
    store = (await import('./store')).useWorkspaceStore;
    handles = await import('../../cp-workspace/folded/foldedFigureHandles');
    gesture = (await import('../../cp-workspace/folded/foldedFigureGesture')).foldedFigureGesture;
    verbs = await import('../../cp-workspace/folded/foldedFigureVerbs');
    endOpenCanvasSessions = (await import('../../cp-workspace/canvasObjects/canvasSessions')).endOpenCanvasSessions;
    const { useSettingsStore } = await import('../settingsStore');
    useSettingsStore.getState().setFoldWarningEnabled(false);
  });

  const state = () => store.getState();

  /** Let every call in flight land, and whatever its answer goes on to call. */
  async function settle() {
    do {
      await new Promise((resolve) => setTimeout(resolve, 0));
    } while (unanswered > 0 || Object.keys(state().oristudioCpFoldRuns).length > 0);
  }

  async function open(): Promise<number[]> {
    await handles.resetFoldedFigureHandles();
    const { loadOristudioCpDocumentFromText } = await import('./oristudioCpRuntime');
    const document = await loadOristudioCpDocumentFromText(readFileSync(KABUTO, 'utf8'), {
      format: 'fold',
      filename: 'kabuto.fold',
    });
    store.setState({
      oristudioCpDocument: document,
      oristudioCpFoldedFigures: [],
      oristudioCpActiveFoldedFigureId: null,
      oristudioCpHistoryPast: [],
      oristudioCpHistoryFuture: [],
      activePanelId: 'crease-pattern',
    });
    return Array.from({ length: document.summary.line_segments }, (_, index) => index + 1);
  }

  /** What is wrong with the slots now, if anything; empty when all four rules hold. */
  function violations(): string[] {
    const lists = [
      state().oristudioCpFoldedFigures,
      ...state().oristudioCpHistoryPast.map((entry) => entry.foldedFigures ?? []),
      ...state().oristudioCpHistoryFuture.map((entry) => entry.foldedFigures ?? []),
    ];
    const references = new Map<number, number>();
    const owners = new Map<number, Set<string>>();
    let highest = -1;
    for (const list of lists) {
      for (const figure of list) {
        if (figure.handle == null) continue;
        references.set(figure.handle, (references.get(figure.handle) ?? 0) + 1);
        owners.set(figure.handle, (owners.get(figure.handle) ?? new Set()).add(figure.id));
        highest = Math.max(highest, figure.handle);
      }
    }
    const problems: string[] = [];
    // Past the highest referred to, for a slot taken and never referred to.
    for (let handle = 0; handle <= highest + 3; handle += 1) {
      const count = references.get(handle) ?? 0;
      let live = true;
      try {
        wasm.folded_figure_snapshot(handle);
      } catch {
        live = false;
      }
      if (count > 0 && !live) problems.push(`slot ${handle} is referred to ${count}x but free`);
      if (count === 0 && live) problems.push(`slot ${handle} is live but nothing refers to it`);
      const counted = handles.foldedFigureHandleRefCount(handle);
      if (counted !== count) problems.push(`slot ${handle} is counted ${counted}x, referred to ${count}x`);
      if ((owners.get(handle)?.size ?? 0) > 1) {
        problems.push(`slot ${handle} is shared by ${[...(owners.get(handle) ?? [])].join(', ')}`);
      }
    }
    return problems;
  }

  /** Hold the next fold's answer until the returned release runs. */
  async function whileFolding(start: () => Promise<unknown>, meanwhile: () => Promise<unknown>) {
    heldFold = { armed: true, release: null };
    const running = start();
    await vi.waitFor(() => expect(heldFold.release).not.toBeNull());
    await meanwhile();
    heldFold.release?.();
    await running;
  }

  async function undoAsMenu() {
    endOpenCanvasSessions('history');
    await state().undo();
  }

  async function redoAsMenu() {
    endOpenCanvasSessions('history');
    await state().redo();
  }

  function chain(seed: number, steps: number) {
    const random = seeded(seed);
    const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
    const live = () =>
      state().oristudioCpFoldedFigures.filter((figure) => figure.status === 'ready' && figure.handle != null);
    let lineIds: number[] = [];

    const fold = () =>
      gesture.run('verb', 'Fold model', () =>
        state().foldOristudioCpDocument({ startingFaceId: 1 + Math.floor(random() * 6), lineIds })
      );
    const refold = (figure: OristudioCpFoldedFigureEntry) =>
      gesture.run('verb', 'Refold folded model', () => state().refoldOristudioCpFoldedFigure(figure.id));
    const duplicate = (figure: OristudioCpFoldedFigureEntry) =>
      gesture.run('verb', 'Duplicate folded model', () => state().duplicateOristudioCpFoldedFigure(figure.id));
    const another = (figure: OristudioCpFoldedFigureEntry) =>
      gesture.run('verb', 'Show another solution', () => state().foldAnotherOristudioCpFigure(figure.id));
    const move = (figure: OristudioCpFoldedFigureEntry) =>
      verbs.setFoldedFigurePlacementAsEntry(figure.id, { rotation: random() * 6 }, 'Rotate folded form');
    const placeholder = () => state().oristudioCpFoldedFigures.find((figure) => figure.status === 'loading');

    const ops: Record<string, (figure: OristudioCpFoldedFigureEntry) => Promise<unknown>> = {
      fold,
      refold,
      duplicate,
      another,
      move,
      delete: (figure) => verbs.deleteFoldedFigure(figure.id, t),
      previous: (figure) =>
        gesture.run('verb', 'Show previous solution', async () => {
          const shown = figure.snapshot?.current_fold_case ?? figure.snapshot?.discovered_fold_cases ?? 1;
          return shown > 1 ? state().foldOristudioCpFigureToCase(figure.id, shown - 1) : false;
        }),
      restyle: (figure) =>
        verbs.setFoldedFigureDisplayStyle(figure.id, pick(['Paper5', 'Transparent3', 'Wire2'] as const), t),
      flip: (figure) =>
        verbs.updateFoldedFigureModelAsEntry(
          figure.id,
          { state: figure.snapshot?.model.state === 'Front0' ? 'Back1' : 'Front0' },
          t
        ),
      undo: undoAsMenu,
      redo: redoAsMenu,
      // The races: a fold in flight while history moves or the figure goes.
      'refold, undo': (figure) => whileFolding(() => refold(figure), undoAsMenu),
      'refold, undo, redo': (figure) =>
        whileFolding(
          () => refold(figure),
          async () => {
            await undoAsMenu();
            await redoAsMenu();
          }
        ),
      'refold, delete': (figure) => whileFolding(() => refold(figure), () => verbs.deleteFoldedFigure(figure.id, t)),
      'duplicate, undo': (figure) => whileFolding(() => duplicate(figure), undoAsMenu),
      'duplicate, delete the copy': (figure) =>
        whileFolding(
          () => duplicate(figure),
          async () => {
            const copy = placeholder();
            if (copy) await verbs.deleteFoldedFigure(copy.id, t);
          }
        ),
      'fold, undo': () => whileFolding(fold, undoAsMenu),
    };
    const weights: Record<keyof typeof ops, number> = {
      fold: 8,
      refold: 6,
      duplicate: 5,
      another: 7,
      move: 6,
      delete: 7,
      previous: 3,
      restyle: 5,
      flip: 4,
      undo: 14,
      redo: 8,
      'refold, undo': 4,
      'refold, undo, redo': 3,
      'refold, delete': 3,
      'duplicate, undo': 3,
      'duplicate, delete the copy': 2,
      'fold, undo': 3,
    };
    const bag = Object.entries(weights).flatMap(([name, weight]) => Array<string>(weight).fill(name));

    const log: string[] = [];
    const expectSound = (step: string) => {
      expect(violations(), `after ${step}; the chain so far: ${log.slice(-12).join(' → ')}`).toEqual([]);
    };
    const figureless = ['fold', 'undo', 'redo', 'fold, undo'];

    /** `steps` random steps, checked after each. */
    async function walk() {
      lineIds = await open();
      for (let step = 0; step < steps; step += 1) {
        const figures = live();
        let name = pick(bag);
        if (!figureless.includes(name) && figures.length === 0) name = 'fold';
        if (figures.length > 6 && name === 'fold') name = 'delete';
        const figure = figures.length > 0 ? pick(figures) : (null as unknown as OristudioCpFoldedFigureEntry);
        // A run of undos now and then, so a long chain travels back through refolds and deletes.
        const repeat = name === 'undo' && random() < 0.2 ? 2 + Math.floor(random() * 8) : 1;
        for (let again = 0; again < repeat; again += 1) await ops[name]!(figure);
        await settle();
        log.push(`${name}${repeat > 1 ? ` x${repeat}` : ''}${figureless.includes(name) ? '' : ` (${figure.id})`}`);
        expectSound(`step ${step}, ${name}`);
      }
    }

    /** History past its cap, from cheap entries, then all the way down and back. */
    async function overTheCap() {
      if (live().length === 0) await fold();
      await settle();
      for (let entry = 0; entry < MAX_CP_HISTORY + 20; entry += 1) {
        const figure = live()[0];
        if (!figure) break;
        await [refold, move, another][entry % 3]!(figure);
        await settle();
      }
      expectSound('filling history');
      expect(state().oristudioCpHistoryPast).toHaveLength(MAX_CP_HISTORY);
      for (let entry = 0; entry < MAX_CP_HISTORY; entry += 1) await undoAsMenu();
      await settle();
      expectSound('undoing to the bottom');
      for (let entry = 0; entry < MAX_CP_HISTORY; entry += 1) await redoAsMenu();
      await settle();
      expectSound('redoing to the top');
      // A new edit after an undo drops the redo stack.
      for (let entry = 0; entry < 30; entry += 1) await undoAsMenu();
      const figure = live()[0];
      if (figure) await move(figure);
      await settle();
      expectSound('an edit after undo');
      expect(state().oristudioCpHistoryFuture).toHaveLength(0);
    }

    return { walk, overTheCap };
  }

  it.each([2, 3])('seed %i', async (seed) => {
    await chain(seed, 100).walk();
  });

  it('seed 1, then past the history cap and back', async () => {
    const run = chain(1, 100);
    await run.walk();
    await run.overTheCap();
  });
});
