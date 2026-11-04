/**
 * Apply's carried rows over the real Fold and CP bridges, on kabuto (U10's
 * review): a restore whose record has two rows on faces that are gone carries
 * them at record indices 1 and 2, not 0..k-1. The dialog's trash, Clear all
 * and undo change only its model; Apply's save writes back the carried rows
 * the model still lists, by record index, and changes nothing in the session,
 * so a save that is refused takes nothing an undo would want back.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, createElement, type MutableRefObject } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  OristudioCpDocumentSummary,
  OristudioCpFoldedFigureResult,
  OristudioCpFoldedPaperScene,
  OristudioCpFoldSource,
} from '../../engine/oristudioCpTypes';
import type { LayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';
import type { LayerOrderRequest } from '../../lib/layerOrder/layerOrderRequest';
import { layerOrderSourceOf } from '../../lib/layerOrder/layerOrderSource';
import { DEFAULT_FOLDED_MODEL } from '../../lib/orieditaNativeMetadata';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import { createLayerOrderBridgeBackend } from '../../workers/layerOrderBridgeBackend';
import { inProcessLayerOrderWorkers } from '../engine/layerOrderEngine.fixtures';
import { LAYER_ORDER_LIMITS, type LayerConstraint } from '../engine/layerOrderEngine';
import { createLayerOrderRuntime } from '../engine/layerOrderRuntime';
import { layerOrderSceneRelations } from '../engine/layerOrderSceneRelations';
import { rowKeyOf } from '../model/layerOrderRowGroups';
import {
  beginLayerOrderDialog,
  registerLayerOrderDialogMount,
  resetLayerOrderDialogStoreForTest,
  type LayerOrderDialogOpening,
  type LayerOrderDialogOutcome,
} from './layerOrderDialogStore';
import { useLayerOrderDialog, type LayerOrderDialogBinding } from './useLayerOrderDialog';
import { useLayerOrderSession } from './useLayerOrderSession';
import { useLayerOrderSettle, type LayerOrderSettle } from './useLayerOrderSettle';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

vi.mock('../../monitoring', () => ({ reportError: vi.fn() }));
vi.mock('../../analytics/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics/runtime')>()),
  track: vi.fn(),
}));

const ROOT = process.cwd();
const FOLD_WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const CP_WASM = resolve(ROOT, 'src/generated/oristudio-cp-wasm/oristudio_cp_wasm_bg.wasm');
const FIXTURES = resolve(ROOT, '../../tests/fixtures');

type FoldWasm = typeof import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
type CpWasm = typeof import('../../generated/oristudio-cp-wasm/oristudio_cp_wasm');

/** Two points off the paper: faces a record names that no longer exist. */
const OFF_A: [number, number] = [100_000, 100_000];
const OFF_B: [number, number] = [200_000, 200_000];

describe.skipIf(!existsSync(FOLD_WASM) || !existsSync(CP_WASM))('carried rows at Apply, on the real engine', () => {
  let fold: FoldWasm;
  let cp: CpWasm;

  beforeAll(async () => {
    fold = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
    fold.initSync({ module: readFileSync(FOLD_WASM) });
    cp = await import('../../generated/oristudio-cp-wasm/oristudio_cp_wasm');
    cp.initSync({ module: readFileSync(CP_WASM) });
  });

  function kabuto() {
    const text = readFileSync(resolve(FIXTURES, 'flat-folder/kabuto.fold'), 'utf8');
    const document = cp.load_fold(text, '');
    const summary = cp.document_summary(document) as OristudioCpDocumentSummary;
    const lines = Array.from({ length: summary.line_segments }, (_, index) => index + 1);
    const figure = cp.folded_figure_fold_selected(document, lines, 1, 'Order5', null, 0) as OristudioCpFoldedFigureResult;
    const source = cp.folded_figure_source(figure.handle, document) as OristudioCpFoldSource;
    const scene = cp.folded_figure_paper_scene(figure.handle) as OristudioCpFoldedPaperScene;
    cp.free_folded_figure(figure.handle);
    cp.free_document(document);
    return { source: layerOrderSourceOf(source, DEFAULT_FOLDED_MODEL), scene };
  }

  /** In-process workers over the real bridge; with `refuseOnce`, the first save is refused as over budget. */
  function spawner({ refuseOnce = false } = {}) {
    let refuse = refuseOnce;
    return inProcessLayerOrderWorkers(() => {
      const backend = createLayerOrderBridgeBackend(new fold.FoldEngine());
      return {
        ...backend,
        save: (keepCarried?: readonly number[]) => {
          if (!refuse) return backend.save(keepCarried);
          refuse = false;
          return { status: 'refused' as const, refusal: { code: 'record_over_budget' as const, bytes: 2_000_000, budget: 1_000_000 } };
        },
      };
    }).spawn;
  }

  /** A record of three constraints that fit, then two of them pointed at faces off the paper (gone). */
  async function recordWithTwoGone(): Promise<LayerOrderRequest> {
    const { source, scene } = kabuto();
    const runtime = createLayerOrderRuntime({ role: 'host', spawn: spawner() });
    const opened = await runtime.engine.openShowing(source, layerOrderSceneRelations(scene), LAYER_ORDER_LIMITS.open);
    if (opened.status !== 'ok') throw new Error('refused');
    const shown = await runtime.engine.relations();
    const constraints: LayerConstraint[] = [];
    const used = new Set<number>();
    for (let p = 0; p + 1 < opened.open_pairs.length && constraints.length < 3; p += 2) {
      const [a, b] = [opened.open_pairs[p]!, opened.open_pairs[p + 1]!];
      if (used.has(a) || used.has(b)) continue;
      for (let i = 0; i + 1 < shown.length; i += 2) {
        const [upper, lower] = [shown[i]!, shown[i + 1]!];
        if ((upper === a && lower === b) || (upper === b && lower === a)) {
          constraints.push([upper, lower, opened.front_up[lower] === 1 ? 1 : -1]);
          used.add(a);
          used.add(b);
          break;
        }
      }
    }
    expect(constraints).toHaveLength(3);
    expect((await runtime.engine.commit(constraints, LAYER_ORDER_LIMITS.commit)).verdict).toBe('committed');
    const saved = await runtime.engine.save();
    if (saved.status !== 'ok') throw new Error('save refused');
    runtime.dispose();
    const base = saved.record;
    const faces = [...base.faces, { at: OFF_A, area: 1 }, { at: OFF_B, area: 1 }];
    const [c0, c1, c2] = base.constraints;
    const record: LayerOrderRecord = {
      ...base,
      faces,
      constraints: [c0!, [faces.length - 2, c1![1], c1![2]], [faces.length - 1, c2![1], c2![2]]],
    };
    return {
      source,
      record,
      look: {
        style: DEFAULT_PAPER_STYLE,
        policy: PAPER_STYLE_POLICIES['folded-flat'],
        turnDeg: 0,
        side: 'front',
        xray: false,
        lineStyle: 'color',
        lineWidth: 1,
      },
      shown: scene,
    };
  }

  /** Which of the two gone rows a saved record wrote back: 1 for OFF_A's, 2 for OFF_B's. */
  function goneWritten(saved: LayerOrderRecord): number[] {
    return saved.constraints
      .map(([subject]) => saved.faces[subject]!.at[0])
      .filter((x) => x >= OFF_A[0])
      .map((x) => (x === OFF_A[0] ? 1 : 2));
  }

  it('the engine removes a carried row by its record index, and a save keeps what it is told', async () => {
    const request = await recordWithTwoGone();
    const runtime = createLayerOrderRuntime({ role: 'dialog', spawn: spawner() });
    const restored = await runtime.engine.restore(request.source, request.record!, LAYER_ORDER_LIMITS.restore);
    if (restored.status !== 'ok') throw new Error('refused');
    expect(restored.carried.map((row) => row.index)).toEqual([1, 2]);
    const kept = await runtime.engine.save([2]);
    if (kept.status !== 'ok') throw new Error('save refused');
    expect(goneWritten(kept.record)).toEqual([2]);
    // The save changed nothing in the session.
    expect((await runtime.engine.carried()).map((row) => row.index)).toEqual([1, 2]);
    expect(await runtime.engine.removeCarried(2)).toBe(true);
    expect(await runtime.engine.removeCarried(0)).toBe(false);
    expect((await runtime.engine.carried()).map((row) => row.index)).toEqual([1]);
    runtime.dispose();
  }, 60_000);

  interface Mounted {
    readonly out: MutableRefObject<{ dialog: LayerOrderDialogBinding; settle: LayerOrderSettle } | null>;
    readonly outcome: Promise<LayerOrderDialogOutcome>;
    readonly done: () => Promise<void>;
  }

  async function mount(request: LayerOrderRequest, spawn: () => Worker): Promise<Mounted> {
    resetLayerOrderDialogStoreForTest();
    const leave = registerLayerOrderDialogMount();
    const begun = beginLayerOrderDialog(request);
    if (!('opening' in begun)) throw new Error('no opening');
    const out: Mounted['out'] = { current: null };
    function Harness({ opening }: { opening: LayerOrderDialogOpening }) {
      const session = useLayerOrderSession(opening.request, { spawn });
      const settle = useLayerOrderSettle(opening, session);
      out.current = { dialog: useLayerOrderDialog(opening, session, settle), settle };
      return null;
    }
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => root.render(createElement(Harness, { opening: begun.opening })));
    await vi.waitFor(() => expect(out.current?.dialog.state.phase.kind).toBe('open'), { timeout: 20_000 });
    expect(out.current!.dialog.state.rows.carried.map((row) => row.facts.index)).toEqual([1, 2]);
    return {
      out,
      outcome: begun.outcome,
      done: async () => {
        await act(async () => root.unmount());
        leave();
      },
    };
  }

  async function applied(mounted: Mounted): Promise<LayerOrderRecord> {
    await act(async () => mounted.out.current!.dialog.apply());
    const outcome = await mounted.outcome;
    await mounted.done();
    if (outcome.kind !== 'applied') throw new Error(`outcome ${outcome.kind}`);
    return outcome.applied.record;
  }

  function trash(mounted: Mounted, recordIndex: number) {
    const { dialog } = mounted.out.current!;
    const row = dialog.state.rows.carried.find((r) => r.facts.index === recordIndex)!;
    dialog.dispatch({ type: 'row_removed', key: rowKeyOf(row, dialog.state.figure) });
  }

  it.each([1, 2])('Apply after the trash on record index %i writes back the other row only', async (index) => {
    const mounted = await mount(await recordWithTwoGone(), spawner());
    await act(async () => trash(mounted, index));
    expect(mounted.out.current!.dialog.state.rows.carried.map((row) => row.facts.index)).toEqual([1, 2].filter((i) => i !== index));
    const saved = await applied(mounted);
    expect(saved.constraints).toHaveLength(2);
    expect(goneWritten(saved)).toEqual([3 - index]);
  }, 60_000);

  it('Apply after Clear all writes no constraint back', async () => {
    const mounted = await mount(await recordWithTwoGone(), spawner());
    await act(async () => mounted.out.current!.dialog.dispatch({ type: 'clear_all' }));
    await vi.waitFor(() => expect(mounted.out.current!.dialog.state.commit.kind).toBe('idle'), { timeout: 20_000 });
    expect(mounted.out.current!.dialog.state.rows).toEqual({ committed: [], carried: [] });
    const saved = await applied(mounted);
    expect(saved.constraints).toHaveLength(0);
  }, 60_000);

  it('a refused Apply takes nothing: undo brings the row back, and the next Apply writes it', async () => {
    const mounted = await mount(await recordWithTwoGone(), spawner({ refuseOnce: true }));
    await act(async () => trash(mounted, 1));
    await act(async () => mounted.out.current!.dialog.apply());
    await vi.waitFor(() => expect(mounted.out.current!.settle.applyRefusal?.code).toBe('record_over_budget'), { timeout: 20_000 });
    expect(mounted.out.current!.dialog.state.phase.kind).toBe('open');
    await act(async () => mounted.out.current!.dialog.history.undo());
    expect(mounted.out.current!.dialog.state.rows.carried.map((row) => row.facts.index)).toEqual([1, 2]);
    const saved = await applied(mounted);
    expect(saved.constraints).toHaveLength(3);
    expect(goneWritten(saved)).toEqual([1, 2]);
  }, 60_000);
});
