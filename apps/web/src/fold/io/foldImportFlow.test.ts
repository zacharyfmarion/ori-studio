/**
 * Import CP's flow over the session and a fake engine with Import CP's
 * calls: one order commits at once, several wait for a choice and are
 * pictured, an empty sequence adopts the pattern's sheet, Edit's figure
 * commits as it lands, a refusal is said, and every import and preview the
 * engine held is let go.
 */
import type { TFunction } from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import { initialFoldReaderState, withFoldCursor } from '../document/foldReaderState';
import { sequenceOf, step, valleyAt } from '../document/foldSequence.fixtures';
import type { FoldCpJumpOp, FoldSequenceDocument } from '../document/foldSequenceDocument';
import type {
  FoldImportLayerOpening,
  FoldImportOpened,
  FoldImportSource,
  FoldImportTarget,
} from '../engine/foldEngineIoWire';
import type { FoldEngineOutcome, FoldScene } from '../engine/foldEngineWire';
import { FOLD_MAX_FACES } from '../foldFaceCap';
import { createFoldSession, type FoldSession } from '../session/foldSession';
import {
  fakeFoldEngine,
  inProcessFoldRuntime,
  memoryFoldDocument,
  settle,
  type FakeFoldEngine,
} from '../session/foldSession.fixtures';
import {
  createFoldImportFlow,
  foldOrderChoiceKey,
  foldShapeOfOutline,
  type FoldImportFlow,
  type FoldImportLayerOrderAnswer,
  type FoldImportLayerOrderAsk,
  type FoldImportRequest,
  type FoldProjectCpImport,
} from './foldImportFlow';
import { foldImportNotice } from './foldImportRefusal';

/** Import CP's calls over the fake engine: each import lists `orders` per component. */
interface FakeIo {
  engine: FakeFoldEngine;
  /** Imports the engine holds now. */
  held: Set<number>;
  calls: string[];
}

interface FakeIoOptions {
  orders?: number[];
  truncated?: boolean;
  refuse?: string;
  /** The sheet an empty target adopts. */
  paper?: FoldImportOpened['paper'];
  /** The engine can't open an import onto the Layer order dialog's faces. */
  layerUnavailable?: boolean;
  /** The engine refuses the order the Layer order dialog chose, with this code. */
  layerRefuse?: string;
}

/** The digest the fake engine's Layer order openings name their faces by. */
const DIGEST = '00c0ffee00c0ffee';

function fakeIo({
  orders = [],
  truncated = false,
  refuse,
  paper = { kind: 'square' },
  layerUnavailable = false,
  layerRefuse,
}: FakeIoOptions): () => FakeIo {
  return () => {
    const base = fakeFoldEngine();
    const held = new Set<number>();
    const opened = new Map<number, { parent: number; origin: FoldCpJumpOp['origin'] }>();
    const calls: string[] = [];
    let next = 100;
    const jump = (origin: FoldCpJumpOp['origin'], order: string): FoldCpJumpOp => ({
      kind: 'cp-jump',
      cpJson: '{"vertices_coords":[]}',
      orderJson: order,
      origin,
    });
    const land = (parent: number, op: FoldCpJumpOp) => {
      const landed = base.apply(parent, op);
      if (landed.status !== 'ok') throw new Error('refused');
      return { status: 'ok' as const, state: landed.state, summary: landed.summary, op, fingerprint: base.fingerprint(landed.state) };
    };
    const parentOf = (target: FoldImportTarget) =>
      target.kind === 'after'
        ? target.state
        : (base.sheet({ shape: paper ?? { kind: 'square' }, startSide: target.startSide ?? 'front' }) as { state: number }).state;
    const engine = Object.assign(base, {
      importCp(source: FoldImportSource, target: FoldImportTarget): FoldEngineOutcome<FoldImportOpened> {
        calls.push(`importCp:${target.kind}`);
        if (refuse) return { status: 'refused', refusal: { code: refuse }, fixes: [], faces: [], vertices: [] } as never;
        const handle = (next += 1);
        held.add(handle);
        opened.set(handle, { parent: parentOf(target), origin: source.sample ? 'sample' : source.format });
        const listed = orders.filter((n) => n > 0);
        return {
          status: 'ok',
          import: handle,
          summary: {} as FoldImportOpened['summary'],
          paper: target.kind === 'empty' ? paper : null,
          count: { orders: listed.reduce((a, b) => a * b, 1), exact: !truncated },
          components: listed.map((n) => ({ orders: n, truncated })),
          nodes: 7,
        };
      },
      importPick(handle: number, choice: readonly number[]) {
        calls.push(`importPick:${choice.join(',')}`);
        const import_ = opened.get(handle);
        if (!import_ || !held.has(handle)) throw { code: 'unknown_import', message: 'gone' };
        return land(import_.parent, jump(import_.origin, JSON.stringify(choice)));
      },
      importLayerOpening(handle: number, choice: readonly number[]): FoldEngineOutcome<FoldImportLayerOpening> {
        calls.push(`importLayerOpening:${choice.join(',')}`);
        if (!held.has(handle)) throw { code: 'unknown_import', message: 'gone' };
        if (layerUnavailable) {
          const refusal = { code: 'import_layer_unavailable', reason: 'faces_differ' };
          return { status: 'refused', refusal, fixes: [], faces: [], vertices: [] } as never;
        }
        return {
          status: 'ok',
          source: { segments: [], starting_face_id: 1, aux_segments: [], digest: DIGEST },
          shown: { flipped: false, subfaces: [] } as unknown as OristudioCpFoldedPaperScene,
          look: { side: 'back', turn_deg: 90 },
        };
      },
      importTurn(handle: number, turnDeg: number) {
        calls.push(`importTurn:${turnDeg}`);
        if (!held.has(handle)) throw { code: 'unknown_import', message: 'gone' };
        return { side: 'back' as const, turn_deg: turnDeg };
      },
      importPickLayerOrder(handle: number, digest: string, relations: Uint32Array) {
        calls.push(`importPickLayerOrder:${digest}:${[...relations].join(',')}`);
        const import_ = opened.get(handle);
        if (!import_ || !held.has(handle) || digest !== DIGEST) throw { code: 'invalid_input', message: 'not opened' };
        if (layerRefuse) return { status: 'refused', refusal: { code: layerRefuse }, fixes: [], faces: [], vertices: [] } as never;
        return land(import_.parent, jump(import_.origin, `layer:${[...relations].join(',')}`));
      },
      importEditFoldedFigure(_scene: OristudioCpFoldedPaperScene, target: FoldImportTarget) {
        calls.push(`importEditFoldedFigure:${target.kind}`);
        return land(parentOf(target), jump('edit_folded_figure', '[]'));
      },
      releaseImports(handles: readonly number[]) {
        calls.push(`releaseImports:${handles.join(',')}`);
        return handles.filter((handle) => held.delete(handle)).length;
      },
      scene(state: number): FoldScene {
        calls.push(`scene:${state}`);
        return { scene: state } as unknown as FoldScene;
      },
    });
    return { engine, held, calls };
  };
}

let flows: FoldImportFlow[] = [];
let sessions: FoldSession[] = [];

afterEach(() => {
  for (const flow of flows) flow.dispose();
  for (const session of sessions) session.dispose();
  flows = [];
  sessions = [];
});

function setup(
  document: FoldSequenceDocument | null,
  cursor: string | null,
  io: FakeIoOptions = {},
  editFoldedFigure: () => Promise<OristudioCpFoldedPaperScene | null> = async () => null,
  projectCp?: () => Promise<FoldProjectCpImport | null>,
  chooseLayerOrder?: (ask: FoldImportLayerOrderAsk, signal: AbortSignal) => Promise<FoldImportLayerOrderAnswer>
) {
  const engines: FakeIo[] = [];
  const make = fakeIo(io);
  const runtime = inProcessFoldRuntime(() => {
    const made = make();
    engines.push(made);
    return made.engine;
  });
  let next = 0;
  const source = memoryFoldDocument(
    {
      held: document && { document, readOnlyRaw: null },
      reader: document && withFoldCursor(initialFoldReaderState(document.id), document, cursor),
    },
    (prefix) => `${prefix}-${(next += 1)}`
  );
  const session = createFoldSession({ document: source, runtime });
  sessions.push(session);
  const imported = vi.fn();
  const offered = vi.fn();
  const refused = vi.fn();
  const prefetched = vi.fn();
  const flow = createFoldImportFlow({
    session,
    editFoldedFigure,
    projectCp,
    onImported: imported,
    onChoiceOffered: offered,
    onRefused: refused,
    ...(chooseLayerOrder ? { chooseLayerOrder, prefetchLayerOrder: prefetched } : {}),
  });
  flows.push(flow);
  return { session, source, runtime, flow, imported, offered, refused, prefetched, io: () => engines[engines.length - 1]! };
}

const SAMPLE: FoldImportRequest = { kind: 'sample', sample: 'waterbomb-base' };
const FILE: FoldImportRequest = { kind: 'file', name: 'crane.cp', source: { format: 'cp', text: '1 0 0 1 1' } };

describe('Import CP’s flow', () => {
  it('holds the engine while it lives, and lets it go with every import it held', async () => {
    const { flow, runtime, io } = setup(sequenceOf([step('a', null)]), 'a', { orders: [2] });
    expect(runtime.holders()).toBe(1);
    await flow.open(FILE);
    await settle();
    expect(io().held.size).toBe(1);
    flow.dispose();
    await settle();
    expect(runtime.holders()).toBe(0);
  });

  it('commits a pattern with one order at once, after the step on screen, as it landed', async () => {
    const { flow, source, io, imported, offered, session } = setup(sequenceOf([step('a', null)]), 'a');
    await flow.open(SAMPLE);
    await settle();
    // Nothing to choose, so no choice offered.
    expect(offered).not.toHaveBeenCalled();

    expect(flow.store.getState()).toMatchObject({ phase: 'done', origin: 'sample', stepId: 'fstep-1' });
    expect(source.commits).toEqual([
      { parent: 'a', op: expect.objectContaining({ kind: 'cp-jump', origin: 'sample' }), expect: expect.stringMatching(/^fs1:/) },
    ]);
    expect(io().calls).toEqual(['importCp:after', 'importPick:', `releaseImports:${101}`]);
    expect(io().held.size).toBe(0);
    expect(imported).toHaveBeenCalledExactlyOnceWith('sample');
    // The replay took the state the pick landed: no second fold of the jump.
    expect(io().engine.log.filter((call) => call === 'step:cp-jump')).toEqual([]);
    expect(session.store.getState().cursor).toBe('fstep-1');
  });

  it('adopts the pattern’s sheet for an empty sequence', async () => {
    const rectangle = { kind: 'rectangle' as const, aspect: [1, 0.5] as [number, number] };
    const { flow, source, session } = setup(null, null, { paper: rectangle });
    await flow.open(FILE);
    await settle();

    expect(flow.store.getState()).toMatchObject({ phase: 'done', origin: 'cp' });
    expect(source.commits).toEqual([expect.objectContaining({ parent: null, adopt: rectangle })]);
    expect(session.store.getState().paper.shape).toEqual(rectangle);
  });

  it('waits for a choice among several orders, pictures each, and commits the one chosen', async () => {
    const { flow, source, io, offered } = setup(sequenceOf([step('a', null)]), 'a', { orders: [3, 1, 2] });
    await flow.open(FILE);
    await settle(10);

    const choosing = flow.store.getState();
    expect(choosing).toMatchObject({ phase: 'choosing', choice: [0, 0, 0], committing: false });
    // The analytics' choice offered, once for each part the chooser asks about.
    expect(offered.mock.calls).toEqual([[3], [2]]);
    if (choosing.phase !== 'choosing') throw new Error('not choosing');
    // The chosen one first, then each component's orders with the others as
    // chosen; a component with one order has nothing to choose.
    expect([...choosing.previews.keys()]).toEqual(['0,0,0']);
    expect([...choosing.previews.values()].every((preview) => preview.status === 'ready')).toBe(true);
    // Every preview's state was let go once pictured: the engine holds the sheet and step a.
    expect(io().engine.live()).toBe(2);

    flow.choose(2, 1);
    flow.choose(0, 2);
    await settle(10);
    const chosen = flow.store.getState();
    if (chosen.phase !== 'choosing') throw new Error('not choosing');
    expect(chosen.choice).toEqual([2, 0, 1]);
    expect(chosen.previews.get(foldOrderChoiceKey([2, 0, 1]))?.status).toBe('ready');

    // Choices outside the listed orders change nothing.
    flow.choose(1, 1);
    flow.choose(2, 2);
    flow.choose(5, 0);
    expect(flow.store.getState()).toBe(chosen);

    await flow.commit();
    expect(source.commits).toHaveLength(0);
    await flow.accept(0);
    expect(source.commits).toHaveLength(0);
    await flow.accept(2);
    await settle();
    expect(flow.store.getState()).toMatchObject({ phase: 'done' });
    expect(source.commits).toEqual([
      expect.objectContaining({ parent: 'a', op: expect.objectContaining({ orderJson: '[2,0,1]' }) }),
    ]);
    expect(io().held.size).toBe(0);
    // The sheet, step a and the imported step: the pick committed is the state the replay took.
    expect(io().engine.live()).toBe(3);
  });

  it('cancels an unresolved choice when the cursor changes and releases its import', async () => {
    const document = sequenceOf([step('a', null), step('b', 'a')]);
    const { flow, source, io } = setup(document, 'b', { orders: [2] });
    await flow.open(FILE);
    await settle(10);
    source.set({ reader: withFoldCursor(initialFoldReaderState(document.id), document, 'a') });
    await settle();
    expect(flow.store.getState().phase).toBe('idle');
    await flow.accept(0);
    expect(source.commits).toHaveLength(0);
    expect(io().held.size).toBe(0);
  });

  it('says why a pattern was refused, and asks again with a larger budget when the search ran out', async () => {
    const { flow, io } = setup(sequenceOf([step('a', null)]), 'a', { refuse: 'import_budget_exceeded' });
    await flow.open(FILE);
    expect(flow.store.getState()).toMatchObject({
      phase: 'refused',
      refusal: { kind: 'engine', refused: { refusal: { code: 'import_budget_exceeded' } } },
    });
    await flow.searchLonger();
    expect(io().calls).toEqual(['importCp:after', 'importCp:after']);
  });

  it('bounds repeated retries when no order is found within the search budget', async () => {
    const { flow, io } = setup(sequenceOf([step('a', null)]), 'a', { refuse: 'import_budget_exceeded' });
    await flow.open(FILE);
    for (let attempt = 0; attempt < 12; attempt += 1) await flow.searchLonger();
    expect(flow.store.getState()).toMatchObject({ phase: 'refused', searchLimited: true });
    const count = io().calls.length;
    await flow.searchLonger();
    expect(io().calls).toHaveLength(count);
  });

  it('refuses a file it cannot read before the engine is asked', async () => {
    const { flow, io } = setup(sequenceOf([step('a', null)]), 'a');
    await flow.open({ kind: 'file', name: 'photo.png', source: null });
    expect(flow.store.getState()).toMatchObject({
      phase: 'refused',
      refusal: { kind: 'local', code: 'unsupported_file', name: 'photo.png' },
    });
    await flow.open({ kind: 'file', name: 'crane.cp', source: null, unreadable: true });
    expect(flow.store.getState()).toMatchObject({ refusal: { code: 'unreadable_file' } });
    expect(io().calls).toEqual([]);
  });

  it('starts from Edit’s folded figure, committing it as it landed', async () => {
    const figure = { faces: [] } as unknown as OristudioCpFoldedPaperScene;
    const { flow, source, imported } = setup(sequenceOf([step('a', null)]), 'a', {}, async () => figure);
    await flow.open({ kind: 'edit-folded-figure' });
    await settle();
    expect(flow.store.getState()).toMatchObject({ phase: 'done', origin: 'edit_folded_figure' });
    expect(source.commits).toHaveLength(1);
    expect(imported).toHaveBeenCalledWith('edit_folded_figure');
  });

  it('refuses Edit’s folded figure over the face cap before the engine is asked, as the engine would', async () => {
    const faces = Array.from({ length: FOLD_MAX_FACES + 1 }, () => ({}));
    const figure = { faces } as unknown as OristudioCpFoldedPaperScene;
    const { flow, io, refused } = setup(sequenceOf([step('a', null)]), 'a', {}, async () => figure);
    await flow.open({ kind: 'edit-folded-figure' });
    const refusal = { code: 'import_too_many_faces', face_count: FOLD_MAX_FACES + 1, limit: FOLD_MAX_FACES };
    expect(flow.store.getState()).toMatchObject({ phase: 'refused', refusal: { kind: 'engine', refused: { refusal } } });
    expect(io().calls).toEqual([]);
    expect(refused).toHaveBeenCalledOnce();
    expect(refused).toHaveBeenCalledWith({ kind: 'engine', refused: { refusal } });

    // At the cap, it goes to the engine.
    const atCap = { faces: faces.slice(1) } as unknown as OristudioCpFoldedPaperScene;
    const second = setup(sequenceOf([step('a', null)]), 'a', {}, async () => atCap);
    await second.flow.open({ kind: 'edit-folded-figure' });
    await settle();
    expect(second.io().calls).toContain('importEditFoldedFigure:after');
    expect(second.refused).not.toHaveBeenCalled();
  });

  it('hears every refusal once, the engine’s and its own', async () => {
    const { flow, refused } = setup(sequenceOf([step('a', null)]), 'a', { refuse: 'import_no_order' });
    await flow.open(FILE);
    await flow.open({ kind: 'file', name: 'photo.png', source: null });
    expect(refused.mock.calls).toEqual([
      [{ kind: 'engine', refused: expect.objectContaining({ refusal: { code: 'import_no_order' } }) }],
      [{ kind: 'local', code: 'unsupported_file', name: 'photo.png' }],
    ]);
  });

  it('says when Edit has no folded figure to start from', async () => {
    const { flow, io } = setup(sequenceOf([step('a', null)]), 'a');
    await flow.open({ kind: 'edit-folded-figure' });
    expect(flow.store.getState()).toMatchObject({ refusal: { kind: 'local', code: 'no_folded_figure' } });
    expect(io().calls).toEqual([]);
  });

  it('refuses to add after a step that has no state', async () => {
    // A newer build's step: locked, so it lands nothing.
    const locked = { id: 'b', parent: 'a', unknown: { id: 'b', parent: 'a', op: { kind: 'sink' } } };
    const { flow } = setup(sequenceOf([step('a', null, valleyAt(0.5)), locked]), 'b');
    await flow.open(SAMPLE);
    expect(flow.store.getState()).toMatchObject({ refusal: { kind: 'local', code: 'no_state' } });
  });

  it('drops an import a newer request or a reset replaced, letting it go', async () => {
    const { flow, io } = setup(sequenceOf([step('a', null)]), 'a', { orders: [2] });
    await flow.open(FILE);
    await settle(10);
    expect(io().held.size).toBe(1);
    flow.reset();
    await settle();
    expect(flow.store.getState()).toEqual({ phase: 'idle' });
    expect(io().held.size).toBe(0);
  });
});

describe('foldShapeOfOutline', () => {
  it('reads a square, a rectangle normalised to longer side 1, and nothing from no area', () => {
    expect(foldShapeOfOutline([[0, 0], [1, 0], [1, 1], [0, 1]])).toEqual({ kind: 'square' });
    expect(foldShapeOfOutline([[0, 0], [1, 0], [1, 0.5], [0, 0.5]])).toEqual({ kind: 'rectangle', aspect: [1, 0.5] });
    expect(foldShapeOfOutline([[0, 0], [1, 0]])).toBeNull();
  });
});


describe('Linked Collapse transactions', () => {
  const link = { documentId: 'crease-pattern', revision: 'revision-1' };
  const cp: FoldProjectCpImport = { source: { format: 'fold', text: '{}' }, link, current: () => true };
  it('commits the captured source with the chosen order', async () => {
    const { flow, source, imported } = setup(null, null, { orders: [2] }, undefined, async () => cp);
    await flow.open({ kind: 'project-cp' });
    expect(source.commits).toHaveLength(0);
    flow.choose(0, 1);
    await settle(10);
    await flow.accept(0);
    expect(source.commits[0]?.op).toMatchObject({ source: link, orderJson: '[1]', origin: 'project_cp' });
    expect(imported).toHaveBeenCalledWith('project_cp');
  });
  it('cancels without replacing the saved step', async () => {
    const replace = vi.fn((_landed: import('../engine/foldEngineIoWire').FoldImportFingerprinted) => true);
    const { flow, source } = setup(null, null, { orders: [2] }, undefined, async () => ({ ...cp, replace }));
    await flow.open({ kind: 'project-cp', stepId: 'collapse' });
    flow.reset();
    await flow.commit();
    expect(replace).not.toHaveBeenCalled();
    expect(source.commits).toHaveLength(0);
  });
  it('refuses a stale capture and does not replace or append', async () => {
    let current = true;
    const replace = vi.fn((_landed: import('../engine/foldEngineIoWire').FoldImportFingerprinted) => true);
    const { flow, source } = setup(null, null, { orders: [2] }, undefined,
      async () => ({ ...cp, replace, current: () => current }));
    await flow.open({ kind: 'project-cp', stepId: 'collapse' });
    current = false;
    await settle(10);
    await flow.accept(0);
    expect(flow.store.getState()).toMatchObject({ phase: 'refused', refusal: { code: 'changed' } });
    expect(replace).not.toHaveBeenCalled();
    expect(source.commits).toHaveLength(0);
  });
  it('lands an explicit refresh against the target parent and replaces once', async () => {
    const replace = vi.fn((_landed: import('../engine/foldEngineIoWire').FoldImportFingerprinted) => true);
    const { flow, source, imported } = setup(sequenceOf([step('a', null), step('b', 'a')]), 'b', {}, undefined,
      async () => ({ ...cp, at: 'a', replace }));
    await flow.open({ kind: 'project-cp', stepId: 'b' });
    expect(flow.store.getState()).toMatchObject({ phase: 'done', stepId: 'b' });
    expect(replace).toHaveBeenCalledOnce();
    expect(replace.mock.calls[0]?.[0]).toMatchObject({ op: { source: link, origin: 'project_cp' } });
    expect(source.commits).toHaveLength(0);
    expect(imported).toHaveBeenCalledWith('project_cp', 'update');
  });
});


describe('Import CP’s order chosen in the Layer order dialog (row H10)', () => {
  const PICKED = Uint32Array.from([3, 1, 4, 1]);

  /** A dialog that answers `answer`, and the asks it heard with their signals. */
  function dialog(answer: FoldImportLayerOrderAnswer | (() => Promise<FoldImportLayerOrderAnswer>)) {
    const asks: FoldImportLayerOrderAsk[] = [];
    const signals: AbortSignal[] = [];
    const choose = vi.fn(async (ask: FoldImportLayerOrderAsk, signal: AbortSignal) => {
      asks.push(ask);
      signals.push(signal);
      return typeof answer === 'function' ? answer() : answer;
    });
    return { choose, asks, signals };
  }

  /** A dialog that stays open until its test answers it: the answer, as the dialog would give it. */
  function openDialog() {
    let answer: (value: FoldImportLayerOrderAnswer) => void = () => undefined;
    const made = dialog(() => new Promise((resolve) => (answer = resolve)));
    return { ...made, answer: (value: FoldImportLayerOrderAnswer) => answer(value) };
  }

  it('opens the dialog on the import’s default order, and Apply lands the order it chose as one step', async () => {
    const { choose, asks } = dialog({ kind: 'applied', relations: PICKED, digest: DIGEST });
    const { flow, source, io, imported, offered } = setup(sequenceOf([step('a', null)]), 'a', { orders: [3, 2] }, undefined, undefined, choose);
    await flow.open(FILE);
    await settle(10);

    expect(choose).toHaveBeenCalledOnce();
    expect(asks[0]).toMatchObject({ request: FILE, opening: { source: { digest: DIGEST }, look: { side: 'back', turn_deg: 90 } } });
    expect(flow.store.getState()).toMatchObject({ phase: 'done', origin: 'cp' });
    expect(io().calls).toEqual([
      'importCp:after',
      'importLayerOpening:0,0',
      `importPickLayerOrder:${DIGEST}:3,1,4,1`,
      'releaseImports:101',
    ]);
    // One step, so one undo entry, of exactly the order the dialog chose.
    expect(source.commits).toEqual([
      expect.objectContaining({ parent: 'a', op: expect.objectContaining({ kind: 'cp-jump', orderJson: 'layer:3,1,4,1' }) }),
    ]);
    expect(imported).toHaveBeenCalledExactlyOnceWith('cp');
    // The canvas's chooser never asked.
    expect(offered).not.toHaveBeenCalled();
    expect(io().held.size).toBe(0);
  });

  it('lands the default order on an Apply that changed nothing', async () => {
    const { choose } = dialog({ kind: 'unchanged' });
    const { flow, source, io } = setup(sequenceOf([step('a', null)]), 'a', { orders: [3, 2] }, undefined, undefined, choose);
    await flow.open(FILE);
    await settle(10);
    expect(flow.store.getState()).toMatchObject({ phase: 'done' });
    expect(io().calls).toEqual(['importCp:after', 'importLayerOpening:0,0', 'importPick:0,0', 'releaseImports:101']);
    expect(source.commits).toEqual([expect.objectContaining({ op: expect.objectContaining({ orderJson: '[0,0]' }) })]);
  });

  it.each([
    ['an Apply', { kind: 'applied', relations: PICKED, digest: DIGEST, turnDeg: 120 }, `importPickLayerOrder:${DIGEST}:3,1,4,1`],
    ['an Apply that only turned it', { kind: 'unchanged', turnDeg: 120 }, 'importPick:0,0'],
  ] as const)('turns the import to the dialog’s Rotate before it lands, so the step itself is stored turned: %s', async (_what, answer, pick) => {
    const { choose } = dialog(answer);
    const { flow, source, io } = setup(sequenceOf([step('a', null)]), 'a', { orders: [3, 2] }, undefined, undefined, choose);
    await flow.open(FILE);
    await settle(10);
    expect(flow.store.getState()).toMatchObject({ phase: 'done' });
    expect(io().calls).toEqual(['importCp:after', 'importLayerOpening:0,0', 'importTurn:120', pick, 'releaseImports:101']);
    // One step, as ever: no rotate step after it.
    expect(source.commits).toHaveLength(1);
  });

  it('cancels the import on Cancel: nothing committed, the import let go', async () => {
    const { choose } = dialog({ kind: 'cancelled' });
    const { flow, source, io, imported, session } = setup(sequenceOf([step('a', null)]), 'a', { orders: [2] }, undefined, undefined, choose);
    const before = session.store.getState().cursor;
    await flow.open(FILE);
    await settle(10);
    expect(flow.store.getState()).toEqual({ phase: 'idle' });
    expect(source.commits).toEqual([]);
    expect(imported).not.toHaveBeenCalled();
    expect(io().held.size).toBe(0);
    expect(session.store.getState().cursor).toBe(before);
  });

  it('steps aside while the dialog is open, and keeps its own chooser when there is no dialog to ask', async () => {
    const { choose, answer } = openDialog();
    const { flow, source, offered } = setup(sequenceOf([step('a', null)]), 'a', { orders: [3, 1, 2] }, undefined, undefined, choose);
    void flow.open(FILE);
    await settle(10);
    expect(flow.store.getState()).toEqual({ phase: 'ordering', request: FILE });

    // Busy or unavailable: the chooser asks, as without the dialog.
    answer({ kind: 'fallback' });
    await settle(10);
    expect(flow.store.getState()).toMatchObject({ phase: 'choosing', choice: [0, 0, 0], committing: false });
    expect(offered.mock.calls).toEqual([[3], [2]]);
    expect(source.commits).toEqual([]);
  });

  it('keeps its own chooser when the engine can’t open the import onto the dialog’s faces', async () => {
    const { choose } = dialog({ kind: 'cancelled' });
    const { flow, io } = setup(sequenceOf([step('a', null)]), 'a', { orders: [2], layerUnavailable: true }, undefined, undefined, choose);
    await flow.open(FILE);
    await settle(10);
    expect(choose).not.toHaveBeenCalled();
    expect(flow.store.getState()).toMatchObject({ phase: 'choosing', choice: [0] });
    expect(io().calls.slice(0, 2)).toEqual(['importCp:after', 'importLayerOpening:0']);
  });

  it('imports a pattern with one order straight through, never asking the dialog', async () => {
    const { choose } = dialog({ kind: 'cancelled' });
    const { flow, source, io } = setup(sequenceOf([step('a', null)]), 'a', {}, undefined, undefined, choose);
    await flow.open(SAMPLE);
    await settle();
    expect(choose).not.toHaveBeenCalled();
    expect(flow.store.getState()).toMatchObject({ phase: 'done', origin: 'sample' });
    expect(io().calls).toEqual(['importCp:after', 'importPick:', 'releaseImports:101']);
    expect(source.commits).toHaveLength(1);
  });

  it('withdraws the dialog on a reset, and drops its late answer', async () => {
    const { choose, signals, answer } = openDialog();
    const { flow, source, io } = setup(sequenceOf([step('a', null)]), 'a', { orders: [2] }, undefined, undefined, choose);
    void flow.open(FILE);
    await settle(10);
    expect(signals[0]?.aborted).toBe(false);
    flow.reset();
    expect(signals[0]?.aborted).toBe(true);
    answer({ kind: 'applied', relations: PICKED, digest: DIGEST });
    await settle(10);
    expect(flow.store.getState()).toEqual({ phase: 'idle' });
    expect(source.commits).toEqual([]);
    expect(io().calls.some((call) => call.startsWith('importPickLayerOrder'))).toBe(false);
    expect(io().held.size).toBe(0);
  });

  it('withdraws the dialog when Import CP goes (a dispose, as Back to another workspace does), landing nothing', async () => {
    const { choose, signals, answer } = openDialog();
    const { flow, source, io, imported, runtime } = setup(sequenceOf([step('a', null)]), 'a', { orders: [2] }, undefined, undefined, choose);
    void flow.open(FILE);
    await settle(10);
    expect(flow.store.getState()).toMatchObject({ phase: 'ordering' });
    flow.dispose();
    expect(signals[0]?.aborted).toBe(true);
    // The dialog closed answering `cancelled`; even an Apply racing it lands nothing.
    answer({ kind: 'applied', relations: PICKED, digest: DIGEST });
    await settle(10);
    expect(source.commits).toEqual([]);
    expect(imported).not.toHaveBeenCalled();
    expect(io().calls.some((call) => call.startsWith('importPickLayerOrder'))).toBe(false);
    expect(io().held.size).toBe(0);
    expect(runtime.holders()).toBe(0);
  });

  it('withdraws the dialog when the step it imports after moves under it (an undo), and lets the import go', async () => {
    const document = sequenceOf([step('a', null), step('b', 'a')]);
    const { choose, signals, answer } = openDialog();
    const { flow, source, io } = setup(document, 'b', { orders: [2] }, undefined, undefined, choose);
    void flow.open(FILE);
    await settle(10);
    expect(flow.store.getState()).toMatchObject({ phase: 'ordering' });
    source.set({ reader: withFoldCursor(initialFoldReaderState(document.id), document, 'a') });
    await settle();
    expect(signals[0]?.aborted).toBe(true);
    expect(flow.store.getState()).toEqual({ phase: 'idle' });
    answer({ kind: 'cancelled' });
    await settle(10);
    expect(source.commits).toEqual([]);
    expect(io().held.size).toBe(0);
  });

  it('says plainly when the engine refuses the order the dialog chose, with nothing to search again', async () => {
    for (const code of ['import_order_open', 'import_budget_exceeded']) {
      const { choose } = dialog({ kind: 'applied', relations: PICKED, digest: DIGEST });
      const { flow, source, io, refused } = setup(sequenceOf([step('a', null)]), 'a', { orders: [2], layerRefuse: code }, undefined, undefined, choose);
      await flow.open(FILE);
      await settle(10);
      const state = flow.store.getState();
      expect(state).toMatchObject({ phase: 'refused', refusal: { kind: 'engine', via: 'layer_order', refused: { refusal: { code } } } });
      if (state.phase !== 'refused') throw new Error('not refused');
      const t = ((_key: string, english: string) => english) as unknown as TFunction;
      const searchLonger = vi.fn();
      const notice = foldImportNotice(t, state.refusal, { searchLonger });
      expect(notice).toMatchObject({ code, text: 'Fold couldn’t land this layer order. Nothing was imported.', actions: [] });
      // Search longer is no fix for it, whoever asks.
      await flow.searchLonger();
      expect(io().calls.filter((call) => call.startsWith('importCp'))).toHaveLength(1);
      expect(source.commits).toEqual([]);
      // The analytics hear the engine's code.
      expect(refused).toHaveBeenCalledWith(expect.objectContaining({ refused: expect.objectContaining({ refusal: { code } }) }));
    }
  });

  it('asks for the dialog’s code only once an import reports several orders', async () => {
    const one = setup(sequenceOf([step('a', null)]), 'a', {}, undefined, undefined, dialog({ kind: 'cancelled' }).choose);
    await one.flow.open(SAMPLE);
    await settle();
    expect(one.prefetched).not.toHaveBeenCalled();
    const several = setup(sequenceOf([step('a', null)]), 'a', { orders: [2] }, undefined, undefined, dialog({ kind: 'cancelled' }).choose);
    await several.flow.open(FILE);
    await settle(10);
    expect(several.prefetched).toHaveBeenCalledOnce();
  });
});

it('requires explicit acceptance even when a bounded CP search lists only one order', async () => {
  const { flow, source } = setup(null, null, { orders: [1], truncated: true });
  await flow.open(FILE);
  await settle(10);
  expect(flow.store.getState()).toMatchObject({ phase: 'choosing', confirmed: [false] });
  await flow.commit();
  expect(source.commits).toHaveLength(0);
  await flow.accept(0);
  expect(source.commits).toHaveLength(1);
});
