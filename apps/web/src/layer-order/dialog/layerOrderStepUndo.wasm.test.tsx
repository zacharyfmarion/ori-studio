/**
 * Undo and redo put the exact order back, on the real Fold and CP bridges
 * (#539's review, ported from its probes). Undoing a solution step used to
 * step back relatively, by picture: after › then Add then ⌘Z ×3 it answered
 * `end` for good on 3 of 5 designs, or landed on another picture; even › then
 * ⌘Z put the other side's picture back wrong now and then. Every entry that
 * moves the order now holds the order on its side of the change, and undo
 * puts that order back exactly (`layer_show`, no search).
 *
 * - **The engine contract**, over every fixture and every way of stepping:
 *   › then undo, and › then Add then undo of both, each order bit for bit
 *   and both sides' stacks as they were.
 * - **The dialog**, through its hook: › then ⌘Z, and › then Add then ⌘Z
 *   until the step is undone, back to the opening order exactly, which Apply
 *   then calls unchanged (D16).
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
import type { LayerOrderRequest } from '../../lib/layerOrder/layerOrderRequest';
import { layerOrderSourceOf } from '../../lib/layerOrder/layerOrderSource';
import { DEFAULT_FOLDED_MODEL } from '../../lib/orieditaNativeMetadata';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import { createLayerOrderBridgeBackend } from '../../workers/layerOrderBridgeBackend';
import { inProcessLayerOrderWorkers } from '../engine/layerOrderEngine.fixtures';
import { LAYER_ORDER_LIMITS, type LayerConstraint, type LayerStacks, type LayerStepBy } from '../engine/layerOrderEngine';
import { layerOrderSceneRelations } from '../engine/layerOrderSceneRelations';
import {
  beginLayerOrderDialog,
  registerLayerOrderDialogMount,
  resetLayerOrderDialogStoreForTest,
  type LayerOrderDialogOpening,
  type LayerOrderDialogOutcome,
} from './layerOrderDialogStore';
import { useLayerOrderDialog, type LayerOrderDialogBinding } from './useLayerOrderDialog';
import { useLayerOrderSession } from './useLayerOrderSession';
import { useLayerOrderSettle } from './useLayerOrderSettle';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

vi.mock('../../monitoring', () => ({ reportError: vi.fn() }));
vi.mock('../../analytics/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics/runtime')>()),
  track: vi.fn(),
}));

const ROOT = process.cwd();
const FOLD_WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const CP_WASM = resolve(ROOT, 'src/generated/oristudio-cp-wasm/oristudio_cp_wasm_bg.wasm');
const REPO = resolve(ROOT, '../..');

type FoldWasm = typeof import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
type CpWasm = typeof import('../../generated/oristudio-cp-wasm/oristudio_cp_wasm');

/**
 * The fixtures CI carries whose figures step: kabuto (nine pictures from the
 * front) and Oriedita's colorconstrainttest. solution_sample_1 and r271-s03
 * have one solution each: nothing to step through.
 */
const FIXTURES = [
  'tests/fixtures/flat-folder/kabuto.fold',
  'third_party/oriedita/oriedita-data/src/test/resources/colorconstrainttest.cp',
] as const;

const BY: readonly LayerStepBy[] = [{ picture: 'front' }, { picture: 'back' }, 'layer_order'];

const both = (front: LayerStacks, back: LayerStacks) =>
  `${Array.from(front.offsets)}|${Array.from(front.faces)}#${Array.from(back.offsets)}|${Array.from(back.faces)}`;

describe.skipIf(!existsSync(FOLD_WASM) || !existsSync(CP_WASM))('undo puts the exact order back, on the real engine', () => {
  let fold: FoldWasm;
  let cp: CpWasm;

  beforeAll(async () => {
    fold = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
    fold.initSync({ module: readFileSync(FOLD_WASM) });
    cp = await import('../../generated/oristudio-cp-wasm/oristudio_cp_wasm');
    cp.initSync({ module: readFileSync(CP_WASM) });
  });

  function figure(relative: string) {
    const text = readFileSync(resolve(REPO, relative), 'utf8');
    const document = relative.endsWith('.cp') ? cp.load_cp(text, '') : cp.load_fold(text, '');
    const summary = cp.document_summary(document) as OristudioCpDocumentSummary;
    const lines = Array.from({ length: summary.line_segments }, (_, index) => index + 1);
    const folded = cp.folded_figure_fold_selected(document, lines, 1, 'Order5', null, 0) as OristudioCpFoldedFigureResult;
    const source = cp.folded_figure_source(folded.handle, document) as OristudioCpFoldSource;
    const scene = cp.folded_figure_paper_scene(folded.handle) as OristudioCpFoldedPaperScene;
    cp.free_folded_figure(folded.handle);
    cp.free_document(document);
    return { source: layerOrderSourceOf(source, DEFAULT_FOLDED_MODEL), scene };
  }

  /** The faces `[upper, lower]` the opening order had one way and `now` has the other. */
  function reversed(opening: Uint32Array, now: Uint32Array): [number, number][] {
    const kept = new Set<string>();
    for (let i = 0; i + 1 < now.length; i += 2) kept.add(`${now[i]}>${now[i + 1]}`);
    const out: [number, number][] = [];
    for (let i = 0; i + 1 < opening.length; i += 2) if (!kept.has(`${opening[i]}>${opening[i + 1]}`)) out.push([opening[i]!, opening[i + 1]!]);
    return out;
  }

  it('the engine contract: › then undo, and › then Add then undo of both, each order exactly, on every fixture', async () => {
    const tally: string[] = [];
    for (const relative of FIXTURES) {
      const { source, scene } = figure(relative);
      for (const by of BY) {
        const engine = createLayerOrderBridgeBackend(new fold.FoldEngine());
        const opened = await engine.openShowing(source, layerOrderSceneRelations(scene), LAYER_ORDER_LIMITS.open);
        if (opened.status !== 'ok') throw new Error(`${relative}: open refused`);
        const sides = async () => both(await engine.stacks('front'), await engine.stacks('back'));
        const shows = async (list: readonly LayerConstraint[], order: Uint8Array) =>
          (await engine.show(list, order, LAYER_ORDER_LIMITS.commit)).verdict;
        const opening = await engine.order();
        const openingSides = await sides();
        const openingRelations = await engine.relations();
        const step = async (direction: 'next' | 'previous') =>
          (await engine.step(by, direction, LAYER_ORDER_LIMITS.step)).verdict === 'moved';
        if (!(await step('next')) && !(await step('previous'))) {
          engine.close();
          continue;
        }
        const what = `${relative} ${JSON.stringify(by)}`;
        const stepped = await engine.order();
        expect(stepped, `${what}: a step that moved`).not.toEqual(opening);
        const steppedSides = await sides();

        // › then undo: the opening order, both sides; then redo.
        expect(await shows([], opening)).toBe('shown');
        expect(await engine.order()).toEqual(opening);
        expect(await sides(), what).toBe(openingSides);
        expect(await shows([], stepped)).toBe('shown');
        expect(await sides(), what).toBe(steppedSides);

        // › then Add: up to six of the opening's pairs the step turned over, put back as constraints.
        const list: LayerConstraint[] = reversed(openingRelations, await engine.relations())
          .slice(0, 6)
          .map(([upper, lower]) => [upper, lower, opened.front_up[lower] === 1 ? 1 : -1]);
        const added = list.length > 0 ? (await engine.commit(list, LAYER_ORDER_LIMITS.commit)).verdict : null;
        if (added === 'committed') {
          // Undo the Add: the stepped order exactly. Undo the step: the opening order exactly.
          expect(await shows([], stepped)).toBe('shown');
          expect(await engine.order()).toEqual(stepped);
          expect(await sides(), what).toBe(steppedSides);
          expect(await shows([], opening)).toBe('shown');
          expect(await engine.order()).toEqual(opening);
          expect(await sides(), what).toBe(openingSides);
          // The stepper's cursor counts the same constraints again, and steps on from the opening order.
          expect((await step('next')) || (await step('previous'))).toBe(true);
          tally.push(`${what}: › Add undo undo`);
        } else {
          tally.push(`${what}: › undo`);
        }
        engine.close();
      }
    }
    expect(tally).toEqual(
      expect.arrayContaining([
        `${FIXTURES[0]} {"picture":"front"}: › Add undo undo`,
        `${FIXTURES[0]} "layer_order": › Add undo undo`,
        `${FIXTURES[1]} {"picture":"front"}: › Add undo undo`,
      ])
    );
  }, 120_000);

  interface Mounted {
    readonly out: MutableRefObject<{ dialog: LayerOrderDialogBinding } | null>;
    readonly outcome: Promise<LayerOrderDialogOutcome>;
    readonly done: () => Promise<void>;
  }

  async function mount(relative: string): Promise<Mounted> {
    const { source, scene } = figure(relative);
    const request: LayerOrderRequest = {
      source,
      record: null,
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
    const spawn = inProcessLayerOrderWorkers(() => createLayerOrderBridgeBackend(new fold.FoldEngine())).spawn;
    resetLayerOrderDialogStoreForTest();
    const leave = registerLayerOrderDialogMount();
    const begun = beginLayerOrderDialog(request);
    if (!('opening' in begun)) throw new Error('no opening');
    const out: Mounted['out'] = { current: null };
    function Harness({ opening }: { opening: LayerOrderDialogOpening }) {
      const session = useLayerOrderSession(opening.request, { spawn });
      const settle = useLayerOrderSettle(opening, session);
      out.current = { dialog: useLayerOrderDialog(opening, session, settle) };
      return null;
    }
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => root.render(createElement(Harness, { opening: begun.opening })));
    await vi.waitFor(() => expect(out.current?.dialog.state.phase.kind).toBe('open'), { timeout: 30_000 });
    return {
      out,
      outcome: begun.outcome,
      done: async () => {
        await act(async () => root.unmount());
        leave();
      },
    };
  }

  it.each(FIXTURES)(
    'the dialog on %s: › then ⌘Z, and › then Add then ⌘Z to the step and past it, back to the opening order exactly',
    async (relative) => {
      const mounted = await mount(relative);
      try {
        const d = () => mounted.out.current!.dialog;
        const quiet = () =>
          vi.waitFor(
            () => {
              const s = d().state;
              expect(s.commit.kind === 'pending' || s.solutions.step.kind === 'pending').toBe(false);
            },
            { timeout: 30_000 }
          );
        const shown = () => both(d().state.shown!.front, d().state.shown!.back);
        const tops = () => {
          const { offsets, faces } = d().state.shown!.front;
          return Array.from(offsets.subarray(0, -1), (start, i) => (start < offsets[i + 1]! ? faces[start]! : -1));
        };
        const opening = shown();
        const openingTops = tops();
        const openingOrder = d().state.shownOrder;
        // By the picture from the front, or, on a figure with one picture, by layer order (X-ray).
        const step = async () => {
          for (const xray of [false, true]) {
            if (xray) await act(async () => d().dispatch({ type: 'xray_set', on: true }));
            for (const direction of ['next', 'previous'] as const) {
              await act(async () => d().dispatch({ type: 'step', direction }));
              await quiet();
              if (d().state.history.past.length > 0) return true;
            }
          }
          return false;
        };
        expect(await step(), `${relative}: no step moves`).toBe(true);
        const stepped = shown();
        const steppedTops = tops();
        expect(stepped).not.toBe(opening);

        // › then ⌘Z: the opening order exactly, both sides; then ⇧⌘Z: the stepped one.
        await act(async () => d().history.undo());
        await quiet();
        expect(shown()).toBe(opening);
        expect(d().state.shownOrder).toEqual(openingOrder);
        await act(async () => d().history.redo());
        await quiet();
        expect(shown()).toBe(stepped);

        // › then Add: the old top back in front of the new one, at a spot the step changed (the review's case).
        const open = d().state.open;
        const spot = openingTops.findIndex((a, i) => {
          const b = steppedTops[i]!;
          return a >= 0 && b >= 0 && a !== b && open.partners.get(a)?.includes(b) === true;
        });
        if (spot >= 0) {
          const [a, b] = [openingTops[spot]!, steppedTops[spot]!];
          await act(async () => d().dispatch({ type: 'face_picked', face: a, origin: 'pattern' }));
          await act(async () => d().dispatch({ type: 'face_picked', face: b, origin: 'folded' }));
          await vi.waitFor(() => expect(d().state.previews).not.toEqual({}), { timeout: 30_000 });
          await vi.waitFor(
            () => expect(Object.values(d().state.previews).some((entry) => entry.kind !== 'pending')).toBe(true),
            { timeout: 30_000 }
          );
          if (Object.values(d().state.previews).some((entry) => entry.kind === 'fits')) {
            await act(async () => d().dispatch({ type: 'add' }));
            await quiet();
            expect(d().state.rows.committed.length).toBe(1);
          }
        }
        // Kabuto is the review's case: 5 in front of 12 fits, and is added.
        if (relative === FIXTURES[0]) expect(d().state.rows.committed.length).toBe(1);
        // ⌘Z until the step is undone, three or four times (the Add and its picks, then the step): never stuck.
        for (let guard = 0; guard < 6 && d().state.history.past.length > 0; guard += 1) {
          expect(d().history.canUndo()).toBe(true);
          await act(async () => d().history.undo());
          await quiet();
        }
        expect(d().state.history.past).toEqual([]);
        expect(d().state.rows.committed).toEqual([]);
        expect(shown()).toBe(opening);
        expect(d().state.shownOrder).toEqual(openingOrder);
        // Back to the opening, Apply changes nothing (D16).
        await act(async () => d().apply());
        await expect(mounted.outcome).resolves.toEqual({ kind: 'unchanged' });
      } finally {
        await mounted.done();
      }
    },
    120_000
  );
});
