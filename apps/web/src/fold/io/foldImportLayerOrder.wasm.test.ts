import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import { layerOrderSceneRelations } from '../../layer-order/engine/layerOrderSceneRelations';
import type { LayerCommitted, LayerOpenOutcome, LayerStacks } from '../../layer-order/engine/layerOrderWire';
import type { FoldSequenceDocument } from '../document/foldSequenceDocument';
import { createFoldEngineCalls } from '../engine/foldEngineCalls';
import { createFoldEngineIoCalls } from '../engine/foldEngineIoCalls';
import type { FoldImportLayerOpening } from '../engine/foldEngineIoWire';
import { createFoldSession, type FoldSession } from '../session/foldSession';
import { inProcessFoldRuntime, memoryFoldDocument, settle } from '../session/foldSession.fixtures';
import { selectFoldCursorNode } from '../session/foldSessionState';
import { foldImportFileSource } from './foldImportFiles';
import {
  createFoldImportFlow,
  type FoldImportFlow,
  type FoldImportFlowState,
  type FoldImportLayerOrderAnswer,
  type FoldImportLayerOrderAsk,
} from './foldImportFlow';

/**
 * Import CP choosing its order in the Layer order dialog over the built
 * bridge (`implementation-plans/layer-order-dialog.md`, row H10): the flow as
 * the app runs it, over the session and the engine Fold's worker runs, and a
 * second engine standing in for the dialog's own worker, which opens on what
 * the import hands it and commits a constraint, as a user's Add does.
 *
 * What holds, on kabuto and `solution_sample_1`: the dialog opens on the
 * import's default order, held whole; Apply lands one step whose state is
 * the one Fold's own chooser lands for the order the dialog shows, stack for
 * stack; an Apply that changed nothing lands the default pick.
 *
 * Skipped when the Fold bridge has not been built.
 */
const ROOT = process.cwd();
const FOLD_WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const FIXTURES = resolve(ROOT, '../../tests/fixtures');
const available = existsSync(FOLD_WASM);

type Wasm = typeof import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');

let sessions: FoldSession[] = [];
let flows: FoldImportFlow[] = [];
afterEach(() => {
  for (const flow of flows) flow.dispose();
  for (const session of sessions) session.dispose();
  flows = [];
  sessions = [];
});

async function bridge(): Promise<Wasm> {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(FOLD_WASM) });
  return wasm;
}

function file(relative: string) {
  const name = relative.split('/').at(-1)!;
  const source = foldImportFileSource(name, new Uint8Array(readFileSync(resolve(FIXTURES, relative))));
  if (!source) throw new Error(`${relative}: no format`);
  return { kind: 'file' as const, name, source };
}

/** Wait for the flow to stop working. */
async function settled(flow: FoldImportFlow): Promise<FoldImportFlowState> {
  for (let round = 0; round < 400; round += 1) {
    const phase = flow.store.getState().phase;
    if (phase !== 'working' && phase !== 'ordering') break;
    await settle(1);
  }
  await settle();
  return flow.store.getState();
}

/** Per spot, its faces from the top. */
function spots(stacks: LayerStacks): number[][] {
  return Array.from({ length: stacks.offsets.length - 1 }, (_, i) =>
    Array.from(stacks.faces.subarray(stacks.offsets[i]!, stacks.offsets[i + 1]!))
  );
}

function sceneSpots(scene: OristudioCpFoldedPaperScene): number[][] {
  return scene.subfaces.map((subface) => [...subface.faces_top_to_bottom]);
}

/**
 * The dialog's worker, in-process: opens on what the import hands it, and
 * either Applies untouched or commits one constraint that turns over a pair
 * the creases leave open, as Add does, then Applies.
 */
function dialogOf(wasm: Wasm, touch: boolean, turnBy?: number) {
  const engine = new wasm.FoldEngine();
  const seen: { opened?: LayerOpenOutcome; front?: number[][]; look?: FoldImportLayerOpening['look'] } = {};
  const choose = async ({ opening }: FoldImportLayerOrderAsk): Promise<FoldImportLayerOrderAnswer> => {
    const shown = layerOrderSceneRelations(opening.shown);
    const opened = engine.layer_open_showing(opening.source, shown, undefined) as LayerOpenOutcome;
    seen.opened = opened;
    seen.look = opening.look;
    if (opened.status !== 'ok') return { kind: 'cancelled' };
    if (!touch) {
      seen.front = spots(engine.layer_stacks(opened.session, 'front') as LayerStacks);
      // Rotate pressed: the host's turn, from the side the dialog opened on.
      return turnBy === undefined
        ? { kind: 'unchanged' }
        : { kind: 'unchanged', turnDeg: (opening.look.turn_deg + turnBy + 360) % 360 };
    }
    const upper = new Map<string, number>();
    for (let i = 0; i < shown.length; i += 2) {
      const [a, b] = [shown[i]!, shown[i + 1]!];
      upper.set(`${Math.min(a, b)},${Math.max(a, b)}`, a);
    }
    for (let i = 0; i < opened.open_pairs.length; i += 2) {
      const [lo, hi] = [opened.open_pairs[i]!, opened.open_pairs[i + 1]!];
      const above = upper.get(`${lo},${hi}`);
      if (above === undefined) continue;
      // "The face below now in front of the one above", from the front.
      const subject = above === lo ? hi : lo;
      const object = above;
      const sign = opened.front_up[object] === 1 ? 1 : -1;
      const committed = engine.layer_commit(opened.session, Int32Array.from([subject, object, sign]), undefined) as LayerCommitted;
      if (committed.verdict !== 'committed') continue;
      seen.front = spots(committed.stacks.front);
      const relations = Uint32Array.from(engine.layer_oriedita_relations(opened.session) as Uint32Array);
      return { kind: 'applied', relations, digest: opening.source.digest };
    }
    throw new Error('no open pair could be turned over');
  };
  return { choose, seen };
}

function runtimeOf(wasm: Wasm) {
  return inProcessFoldRuntime(() => {
    const engine = new wasm.FoldEngine();
    return { ...createFoldEngineCalls(engine), ...createFoldEngineIoCalls(engine) };
  }, wasm.fold_engine_version());
}

async function importThroughDialog(wasm: Wasm, relative: string, touch: boolean, turnBy?: number) {
  const runtime = runtimeOf(wasm);
  const source = memoryFoldDocument();
  const session = createFoldSession({ document: source, runtime });
  sessions.push(session);
  const dialog = dialogOf(wasm, touch, turnBy);
  const flow = createFoldImportFlow({ session, editFoldedFigure: async () => null, chooseLayerOrder: dialog.choose });
  flows.push(flow);
  await flow.open(file(relative));
  const state = await settled(flow);
  return { source, session, state, seen: dialog.seen };
}

/**
 * Fold's own chooser, on a fresh engine: the choice whose order the engine
 * draws over the dialog's faces as `front`, and the fingerprint its pick
 * lands. Every choice is looked at, so exactly one must draw it.
 */
function choosersPick(wasm: Wasm, relative: string, front: number[][]) {
  const io = createFoldEngineIoCalls(new wasm.FoldEngine());
  const opened = io.importCp(file(relative).source, { kind: 'empty' });
  if (opened.status !== 'ok') throw new Error(`${relative}: ${JSON.stringify(opened)}`);
  let choices: number[][] = [[]];
  for (const component of opened.components) {
    choices = choices.flatMap((choice) => Array.from({ length: component.orders }, (_, k) => [...choice, k]));
  }
  const matching = choices.filter((choice) => {
    const opening = io.importLayerOpening(opened.import, choice);
    if (opening.status !== 'ok') throw new Error(JSON.stringify(opening));
    return JSON.stringify(sceneSpots((opening as FoldImportLayerOpening & { status: 'ok' }).shown)) === JSON.stringify(front);
  });
  expect(matching, `${relative}: one of ${choices.length} orders draws the dialog's`).toHaveLength(1);
  const picked = io.importPick(opened.import, matching[0]!);
  if (picked.status !== 'ok') throw new Error(JSON.stringify(picked));
  return { choice: matching[0]!, fingerprint: picked.fingerprint, orders: choices.length };
}

function committedStep(source: ReturnType<typeof memoryFoldDocument>) {
  const document = source.read().held?.document as FoldSequenceDocument;
  expect(document.steps).toHaveLength(1);
  const [step] = document.steps;
  return step && 'expect' in step ? step : null;
}

describe.skipIf(!available)('Import CP’s order chosen in the Layer order dialog, over the built bridge', () => {
  for (const relative of ['flat-folder/kabuto.fold', 'oriedita/solution_sample_1.cp']) {
    it(`${relative}: Apply lands one step in the order the dialog chose, stack for stack`, async () => {
      const wasm = await bridge();
      const { source, session, state, seen } = await importThroughDialog(wasm, relative, true);
      expect(seen.opened).toMatchObject({ status: 'ok', opened_on: { kind: 'held', ignored: 0 } });
      expect(state).toMatchObject({ phase: 'done', origin: relative.endsWith('.fold') ? 'fold' : 'cp' });
      // One step: the one undo entry the import makes.
      const step = committedStep(source);
      expect(step?.op).toMatchObject({ kind: 'cp-jump' });
      const node = selectFoldCursorNode(session.store.getState());
      expect(node.status).toBe('ok');

      const chooser = choosersPick(wasm, relative, seen.front!);
      expect(chooser.orders).toBeGreaterThan(1);
      expect(chooser.choice.some((k) => k > 0), 'a constraint moved it off the default').toBe(true);
      expect(step?.expect).toBe(chooser.fingerprint);
      expect(node.fingerprint).toBe(chooser.fingerprint);
    });

    it(`${relative}: an Apply that changed nothing lands the default pick`, async () => {
      const wasm = await bridge();
      const { source, state, seen } = await importThroughDialog(wasm, relative, false);
      expect(state).toMatchObject({ phase: 'done' });
      const chooser = choosersPick(wasm, relative, seen.front!);
      expect(chooser.choice.every((k) => k === 0)).toBe(true);
      expect(committedStep(source)?.expect).toBe(chooser.fingerprint);
    });

    it(`${relative}: an Apply the dialog's Rotate turned stores the imported step itself at the turn`, async () => {
      const wasm = await bridge();
      // Rotate Left twice: 30° anticlockwise as seen.
      const { source, state, seen } = await importThroughDialog(wasm, relative, false, -30);
      expect(state).toMatchObject({ phase: 'done' });
      const step = committedStep(source);
      expect(step?.op).toMatchObject({ kind: 'cp-jump', turnDeg: -30 });
      // The same order as the untouched pick, seen turned: only the view's key differs.
      const chooser = choosersPick(wasm, relative, seen.front!);
      expect(chooser.choice.every((k) => k === 0)).toBe(true);
      expect(step?.expect).not.toBe(chooser.fingerprint);
      // Opened again, the stored step replays to the step as it landed, turned.
      const again = createFoldSession({ document: source, runtime: runtimeOf(wasm) });
      sessions.push(again);
      const release = again.retain();
      for (let round = 0; round < 200 && selectFoldCursorNode(again.store.getState()).status === 'pending'; round += 1) {
        await settle(1);
      }
      const node = selectFoldCursorNode(again.store.getState());
      expect(node).toMatchObject({ status: 'ok', fingerprint: step?.expect });
      release();
    });
  }
});
