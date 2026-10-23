import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tracked = vi.hoisted(() => ({ added: vi.fn(), offered: vi.fn() }));
vi.mock('../../analytics', () => ({ trackFoldStepAdded: tracked.added, trackFoldChoiceOffered: tracked.offered }));

import type { FoldOp } from '../document/foldSequenceDocument';
import type { FoldSessionSurface } from '../session/useFoldSession';
import {
  createFoldTools,
  FOLD_COMPOUND_CHOICES_INITIAL,
  FOLD_TOOL_INITIAL,
  type FoldTools,
} from '../tools/foldToolState';
import { buildReverseStep } from '../tools/reverse/reverseStep';
import { seedForTool } from '../tools/topFlapSeed';
import { flatSquareLandmarks, flatSquareScene } from './foldCanvas.fixtures';
import { foldAlongLine } from './foldAlongLine';
import { foldPickIndex } from './foldPicking';
import {
  compoundListed,
  foldCanvasChoice,
  queuedCommit,
  useFoldCanvasVerbs,
  type FoldCanvasVerbBinding,
} from './useFoldCanvasVerbs';
import type { FoldStateView } from './useFoldStateView';
import type { FoldToolPreview } from './useFoldToolPreview';
import type { FoldVertexAnalysed } from '../engine/foldEngineSquashWire';
import {
  SWIVEL_REACH_ASKING,
  swivelReachView,
  type FoldSwivelLanding,
  type FoldSwivelReachView,
} from '../tools/vertex/swivelReach';
import type { FoldVertexPreview } from './vertex/useFoldVertexStep';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BOOK: FoldOp = {
  kind: 'valley',
  line: { via: 'free', through: [[0.5, 0], [0.5, 1]] },
  moving: [0.75, 0.5],
  seed: { scope: 'all' },
};

function preview(extra: Partial<FoldToolPreview> = {}): FoldToolPreview {
  return {
    candidates: null,
    build: { status: 'unlocated' },
    seed: { scope: 'all' },
    step: { op: BOOK, key: 'book' },
    analysis: null,
    section: null,
    action: null,
    landed: null,
    refused: null,
    landing: false,
    reverse: null,
    crimp: null,
    tuck: null,
    vertex: null,
    sink: null,
    extent: null,
    turned: null,
    ...extra,
  };
}

function session(commitStep: FoldSessionSurface['commitStep']): FoldSessionSurface {
  return {
    cursor: { status: 'ok', path: null, state: null, fingerprint: null, summary: null, report: null, refusal: null },
    cursorId: null,
    readOnly: false,
    pending: { status: 'idle' },
    analysis: { status: 'idle' },
    error: null,
    analyse: vi.fn(),
    preview: vi.fn(),
    commitStep,
    cancel: vi.fn(),
    withState: vi.fn(),
    withNode: vi.fn(),
    withCursor: vi.fn(),
    query: vi.fn(),
    retry: vi.fn(),
  } as unknown as FoldSessionSurface;
}

let host: HTMLDivElement;
let root: Root;
let bound: FoldCanvasVerbBinding | null;

function Harness(props: { session: FoldSessionSurface; tools: FoldTools; preview: FoldToolPreview; view?: FoldStateView }) {
  const binding = useFoldCanvasVerbs(props.session, props.tools, props.view ?? ({} as FoldStateView), props.preview);
  useEffect(() => {
    bound = binding;
  });
  return null;
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  bound = null;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('the Fold canvas’s commit', () => {
  it('queues Enter pressed while the preview lands, says so, and commits once it has landed', async () => {
    const commitStep = vi.fn<FoldSessionSurface['commitStep']>(() => Promise.resolve({ status: 'stale' as const }));
    const surface = session(commitStep);
    const tools = createFoldTools();
    const render = (shown: FoldToolPreview) => act(() => root.render(<Harness session={surface} tools={tools} preview={shown} />));
    render(preview({ landing: true }));
    // Claimed, never silently dropped: the commit waits.
    let claimed = false;
    act(() => {
      claimed = bound!.verbs.commit();
    });
    expect(claimed).toBe(true);
    expect(bound!.queued).toBe(true);
    expect(commitStep).not.toHaveBeenCalled();
    render(preview({ landing: false }));
    expect(commitStep).toHaveBeenCalledWith(BOOK, undefined);
    expect(bound!.queued).toBe(false);
  });

  it('counts a fold of the default top flap as `top`, a flap the folder picked as `flaps`, and every layer as `all`', async () => {
    const commitStep = vi.fn<FoldSessionSurface['commitStep']>(() =>
      Promise.resolve({ status: 'committed' as const, id: 'fstep-t', fingerprint: 'fs1:0' } as never)
    );
    const surface = session(commitStep);
    const tools = createFoldTools();
    const topFlap: FoldOp = { ...BOOK, seed: { scope: 'flaps', at: [[0.75, 0.5]] } };
    const commitWith = async (op: FoldOp) => {
      act(() => root.render(<Harness session={surface} tools={tools} preview={preview({ step: { op, key: JSON.stringify(op) } })} />));
      await act(async () => void bound!.verbs.commit());
    };
    // The tools still hold the default: the flap the step names is the top flap.
    await commitWith(topFlap);
    expect(tracked.added).toHaveBeenLastCalledWith('valley', { layerScope: 'top', via: 'free' });
    // The same flap pressed by the folder.
    act(() => tools.setSeed({ scope: 'flaps', flaps: [{ faces: [2], witness: [0.75, 0.5] }] }));
    await commitWith(topFlap);
    expect(tracked.added).toHaveBeenLastCalledWith('valley', { layerScope: 'flaps', via: 'free' });
    // A moving side of one flap: the default is every layer, and reads so.
    await commitWith(BOOK);
    expect(tracked.added).toHaveBeenLastCalledWith('valley', { layerScope: 'all', via: 'free' });
  });

  it('applies Rotate’s turn as a step, says how far in a bucket, and puts Rotate down; Escape puts it down unapplied', async () => {
    const commitStep = vi.fn<FoldSessionSurface['commitStep']>(() =>
      Promise.resolve({ status: 'committed' as const, id: 'fstep-r', fingerprint: 'fs1:0' } as never)
    );
    const surface = session(commitStep);
    const tools = createFoldTools();
    act(() => tools.selectTool('precrease'));
    act(() => tools.selectTool('rotate'));
    act(() => tools.setRotation({ amount: 'degrees', degrees: 30, direction: 'cw' }));
    const op: FoldOp = { kind: 'rotate', rotate: { amount: 'degrees', degrees: 30, direction: 'cw' } };
    act(() => root.render(<Harness session={surface} tools={tools} preview={preview({ step: { op, key: 'turn' } })} />));
    tracked.added.mockClear();
    let applied = false;
    await act(async () => {
      applied = bound!.verbs.commit();
    });
    expect(applied).toBe(true);
    expect(commitStep).toHaveBeenCalledWith(op, undefined);
    // Never the angle: an exact one is `other`.
    expect(tracked.added).toHaveBeenCalledWith('rotate', { amount: 'other' });
    // The tool it was taken up from is back in hand: no second turn previewed on the step just made.
    expect(tools.store.getState().tool).toBe('precrease');

    act(() => tools.selectTool('rotate'));
    let cancelled = false;
    act(() => {
      cancelled = bound!.verbs.cancel();
    });
    expect(cancelled).toBe(true);
    expect(surface.cancel).toHaveBeenCalled();
    expect(tools.store.getState().tool).toBe('precrease');
    // A preset is counted as its preset.
    act(() => tools.selectTool('rotate'));
    const quarter: FoldOp = { kind: 'rotate', rotate: { amount: 'quarter', direction: 'ccw' } };
    act(() => root.render(<Harness session={surface} tools={tools} preview={preview({ step: { op: quarter, key: 'quarter' } })} />));
    await act(async () => void bound!.verbs.commit());
    expect(tracked.added).toHaveBeenLastCalledWith('rotate', { amount: 'quarter' });
  });

  it('lets a queued commit go when the preview is refused, or the tools are asked for another fold', () => {
    const commitStep = vi.fn<FoldSessionSurface['commitStep']>(() => Promise.resolve({ status: 'stale' as const }));
    const surface = session(commitStep);
    const tools = createFoldTools();
    const render = (shown: FoldToolPreview) => act(() => root.render(<Harness session={surface} tools={tools} preview={shown} />));
    render(preview({ landing: true }));
    act(() => void bound!.verbs.commit());
    render(preview({ landing: false, refused: { status: 'refused', refusal: { code: 'layer_order' }, fixes: [], faces: [], vertices: [] } }));
    expect(bound!.queued).toBe(false);
    render(preview({ landing: true }));
    act(() => void bound!.verbs.commit());
    act(() => tools.selectTool('mountain'));
    render(preview({ landing: false, step: { op: BOOK, key: 'another' } }));
    expect(commitStep).not.toHaveBeenCalled();
  });

  it('steps a tuck’s listed layers, takes a fix’s layer, and folds it the other way', () => {
    const surface = session(vi.fn());
    const tools = createFoldTools();
    const target = (face: number) => ({ face, at: [0.1, 0.1] as [number, number], feasible: true });
    const tuck = {
      asked: null,
      direction: 'valley' as const,
      targets: [target(3), target(7)],
      target: target(3),
      orders: [],
      order: null,
    };
    act(() => root.render(<Harness session={surface} tools={tools} preview={preview({ tuck })} />));
    act(() => tools.selectTool('tuck'));
    act(() => bound!.verbs.stepTuckTarget(1));
    expect(tools.store.getState().compound.tuckTarget).toBe(7);
    // The canvas's chooser and Shift+arrows step the same list.
    act(() => void bound!.verbs.stepChoice(1));
    expect(tools.store.getState().compound.tuckTarget).toBe(7);
    act(() => bound!.verbs.tuckTarget(3));
    expect(tools.store.getState().compound.tuckTarget).toBe(3);
    act(() => bound!.verbs.foldOtherWay());
    expect(tools.store.getState().tuckDirection).toBe('mountain');
    act(() => bound!.verbs.setSecondLineMode('crease'));
    expect(tools.store.getState().secondLineMode).toBe('crease');
  });

  it('decides a queued commit from the tools’ input it was asked for', () => {
    const shown = preview({ landing: true });
    const refused = { status: 'refused' as const, refusal: { code: 'layer_order' as const }, fixes: [], faces: [], vertices: [] };
    expect(queuedCommit(null, shown, false, 'in')).toBe('idle');
    expect(queuedCommit('in', shown, false, 'in')).toBe('wait');
    expect(queuedCommit('in', { ...shown, landing: false }, false, 'in')).toBe('commit');
    expect(queuedCommit('in', { ...shown, landing: false }, true, 'in')).toBe('drop');
    expect(queuedCommit('in', shown, false, 'another')).toBe('drop');
    expect(queuedCommit('in', { ...shown, refused }, false, 'in')).toBe('drop');
    // Its step still being built: it waits for it.
    expect(queuedCommit('in', { ...shown, step: null, landing: false }, false, 'in')).toBe('wait');
  });

  /** The reverse tool with a free line located (after mount, which starts the tools over). */
  function locatedReverse(surface: FoldSessionSurface) {
    const tools = createFoldTools({ ...FOLD_TOOL_INITIAL, tool: 'inside-reverse', lineMode: 'free' });
    const render = (shown: FoldToolPreview) => act(() => root.render(<Harness session={surface} tools={tools} preview={shown} />));
    // The tip still being asked about: no step yet.
    render(preview({ step: null, landing: false }));
    const free = (x: number, y: number) => ({ kind: 'free' as const, pane: 'folded' as const, scene: { x, y }, sheet: [x, y] as [number, number] });
    act(() => {
      tools.pick(free(0.5, 0));
      tools.pick(free(0.5, 1));
    });
    render(preview({ step: null, landing: false }));
    return { tools, render };
  }

  it('queues Enter pressed before a located fold’s step is built, and commits it once it is in and landed', () => {
    const commitStep = vi.fn<FoldSessionSurface['commitStep']>(() => Promise.resolve({ status: 'stale' as const }));
    const surface = session(commitStep);
    const { render } = locatedReverse(surface);
    let claimed = false;
    act(() => {
      claimed = bound!.verbs.commit();
    });
    expect(claimed).toBe(true);
    expect(bound!.queued).toBe(true);
    render(preview({ landing: true }));
    expect(commitStep).not.toHaveBeenCalled();
    render(preview({ landing: false }));
    expect(commitStep).toHaveBeenCalledWith(BOOK, undefined);
    expect(bound!.queued).toBe(false);
  });

  it('lets a commit queued before its step go when the tools are asked for another fold', () => {
    const commitStep = vi.fn<FoldSessionSurface['commitStep']>(() => Promise.resolve({ status: 'stale' as const }));
    const surface = session(commitStep);
    const { tools, render } = locatedReverse(surface);
    act(() => void bound!.verbs.commit());
    expect(bound!.queued).toBe(true);
    act(() => void tools.swapSide());
    render(preview({ landing: false }));
    expect(commitStep).not.toHaveBeenCalled();
    expect(bound!.queued).toBe(false);
  });

  it('does not claim Enter while nothing is located', () => {
    const surface = session(vi.fn());
    const tools = createFoldTools({ ...FOLD_TOOL_INITIAL, tool: 'inside-reverse', lineMode: 'free' });
    act(() => root.render(<Harness session={surface} tools={tools} preview={preview({ step: null })} />));
    let claimed = true;
    act(() => {
      claimed = bound!.verbs.commit();
    });
    expect(claimed).toBe(false);
    expect(bound!.queued).toBe(false);
  });
});

describe('an include fix', () => {
  const flap = (face: number) => ({ faces: [face], witness: [0.1 * face, 0.5] as [number, number] });
  const FLAPS = [flap(0), flap(1), flap(2)];
  /** A reverse fold's tip, refused as not free: its analysis names the flaps the seed picked. */
  const analysed = (picked: number[]): Partial<FoldToolPreview> => ({
    analysis: { flaps: FLAPS, picked, added: [] } as unknown as FoldToolPreview['analysis'],
    section: { flaps: FLAPS } as unknown as FoldToolPreview['section'],
  });

  it('adds the flaps in the way to a stack picked by depth, keeping the flaps that stack grew into', () => {
    const tools = createFoldTools();
    act(() => root.render(<Harness session={session(vi.fn())} tools={tools} preview={preview(analysed([0]))} />));
    act(() => tools.setSeed({ scope: 'depth', at: [0.1, 0.5], scene: { x: 0.1, y: 0.5 }, choice: 2 }));
    act(() => bound!.verbs.includeFlaps([2]));
    expect(tools.store.getState().seed).toEqual({ scope: 'flaps', flaps: [FLAPS[0], FLAPS[2]] });
  });

  it('adds them to the flaps picked once each, and to every flap is every layer', () => {
    const tools = createFoldTools();
    act(() => root.render(<Harness session={session(vi.fn())} tools={tools} preview={preview(analysed([0]))} />));
    act(() => tools.setSeed({ scope: 'flaps', flaps: [FLAPS[0]!] }));
    act(() => bound!.verbs.includeFlaps([0, 1]));
    expect(tools.store.getState().seed).toEqual({ scope: 'flaps', flaps: [FLAPS[0], FLAPS[1]] });
    act(() => bound!.verbs.includeFlaps([2]));
    expect(tools.store.getState().seed).toEqual({ scope: 'all' });
  });
});

describe('a near miss’s fix', () => {
  it('puts the landmark line in place of a reverse fold’s line, as of a plain fold’s', () => {
    const surface = session(vi.fn());
    const tools = createFoldTools({ ...FOLD_TOOL_INITIAL, tool: 'inside-reverse' });
    const view = { index: foldPickIndex(flatSquareScene(), flatSquareLandmarks(), []) } as unknown as FoldStateView;
    const reverse: FoldOp = {
      kind: 'inside-reverse',
      line: { via: 'free', through: [[0.501, 0], [0.499, 1]] },
      moving: [0.75, 0.5],
      seed: { scope: 'all' },
    };
    act(() => root.render(<Harness session={surface} tools={tools} preview={preview({ step: { op: reverse, key: 'near' } })} view={view} />));
    act(() => bound!.verbs.useLine({ fix: 'use_line', line: { n: [1, 0], d: 0.5 }, side: 'positive' }));
    const override = tools.store.getState().override?.op;
    expect(override).toMatchObject({ kind: 'inside-reverse', line: { via: 'free' }, seed: { scope: 'all' } });
    if (override?.kind !== 'inside-reverse' || override.line.via !== 'free') throw new Error('no landmark line');
    // On x = ½ exactly, the side x > ½ moving.
    for (const [x] of override.line.through) expect(x).toBeCloseTo(0.5, 9);
    expect(override.moving?.[0]).toBeGreaterThan(0.5);
  });

  it('locates the landmark line as a free line when an axiom’s roots were refused, and there is no step to put it in', () => {
    const surface = session(vi.fn());
    const tools = createFoldTools({ ...FOLD_TOOL_INITIAL, tool: 'inside-reverse', lineMode: 'axiom-1' });
    const index = foldPickIndex(flatSquareScene(), flatSquareLandmarks(), []);
    const view = { index } as unknown as FoldStateView;
    act(() => root.render(<Harness session={surface} tools={tools} preview={preview({ step: null })} view={view} />));
    act(() => bound!.verbs.useLine({ fix: 'use_line', line: { n: [1, 0], d: 0.5 }, side: 'positive' }));
    const state = tools.store.getState();
    expect(state.tool).toBe('inside-reverse');
    expect(state.lineMode).toBe('free');
    expect(state.picks).toHaveLength(2);
    for (const pick of state.picks) {
      if (pick.kind !== 'free') throw new Error('not a free pick');
      expect(pick.scene.x).toBeCloseTo(0.5, 9);
    }
    // The fix's side moves: x > ½, which an even split does not take unswapped.
    // A reverse fold takes every layer of its point (`seedForTool`).
    expect(seedForTool(state.tool, state.seed)).toEqual({ scope: 'all' });
    const built = buildReverseStep(
      { ...state, seed: { scope: 'all' }, candidate: null, kind: 'inside', openings: [], completion: null },
      index
    );
    if (built.status !== 'built' || built.op.kind !== 'inside-reverse') throw new Error('not built');
    expect(built.op.moving?.[0]).toBeGreaterThan(0.5);
  });
});

describe('the canvas’s chooser', () => {
  it('shows the deepest choice with more than one answer: the order, the opening, then the root', () => {
    const tools = { ...FOLD_TOOL_INITIAL, root: 1, compound: { ...FOLD_COMPOUND_CHOICES_INITIAL, opening: 5, order: 1 } };
    const reverse = { asked: null, kind: 'inside' as const, kinds: [], ways: [], way: null, orders: [], order: null };
    const roots = [
      { root: 0, line: { n: [1, 0] as const, d: 0.5 }, side: null },
      { root: 1, line: { n: [0, 1] as const, d: 0.5 }, side: null },
    ];
    expect(foldCanvasChoice(preview(), tools)).toBeNull();
    expect(foldCanvasChoice(preview({ candidates: roots }), tools)).toEqual({ kind: 'root', index: 1, count: 2 });
    const way = { openings: [], stored: [] };
    const opening = { ...reverse, ways: [way, way, way] };
    expect(foldCanvasChoice(preview({ candidates: roots, reverse: opening }), tools)).toEqual({
      kind: 'opening',
      index: 2,
      count: 3,
    });
    const order = { faces: [], orders: [] };
    expect(foldCanvasChoice(preview({ candidates: roots, reverse: { ...opening, orders: [order, order] } }), tools)).toEqual({
      kind: 'order',
      index: 1,
      count: 2,
    });
  });

  it('steps a crimp’s opening and order as a reverse fold’s, and a tuck’s layer before its order', () => {
    const tools = { ...FOLD_TOOL_INITIAL, compound: { ...FOLD_COMPOUND_CHOICES_INITIAL, opening: 1, order: 0, tuckTarget: 7 } };
    const way = { openings: [], stored: [] };
    const lines = { first: null, second: null };
    const crimp = { asked: null, kind: 'inside' as const, kinds: [], ways: [way, way], way, orders: [], order: null, lines };
    expect(foldCanvasChoice(preview({ crimp }), tools)).toEqual({ kind: 'opening', index: 1, count: 2 });
    expect(compoundListed(preview({ crimp }))).toEqual({ ways: 2, orders: 0, targets: 0 });

    const target = (face: number) => ({ face, at: [0.1, 0.1] as [number, number], feasible: true });
    const tuck = {
      asked: null,
      direction: 'valley' as const,
      targets: [target(3), target(7), target(9)],
      target: target(7),
      orders: [],
      order: null,
    };
    expect(foldCanvasChoice(preview({ tuck }), tools)).toEqual({ kind: 'target', index: 1, count: 3 });
    const order = { faces: [], orders: [] };
    expect(foldCanvasChoice(preview({ tuck: { ...tuck, orders: [order, order] } }), tools)).toEqual({
      kind: 'order',
      index: 0,
      count: 2,
    });
    // One layer offered is no choice.
    expect(foldCanvasChoice(preview({ tuck: { ...tuck, targets: [target(7)] } }), tools)).toBeNull();
  });

  it('shows a closed sink’s pockets, then its orders, over the root', () => {
    const tools = { ...FOLD_TOOL_INITIAL, compound: { ...FOLD_COMPOUND_CHOICES_INITIAL, opening: 0, order: 4, pocket: 1 } };
    const pocket = { upper: [], lower: [], seams: [], stored: { above: [0, 0] as [number, number], below: [0, 0] as [number, number] } };
    const sink = { tool: 'closed-sink' as const, point: null, pockets: [pocket, pocket], pocket: 1, sunk: null, orders: 0, order: 0 };
    expect(foldCanvasChoice(preview({ sink }), tools)).toEqual({ kind: 'pocket', index: 1, count: 2 });
    expect(foldCanvasChoice(preview({ sink: { ...sink, orders: 3 } }), tools)).toEqual({ kind: 'order', index: 2, count: 3 });
  });
});

describe('a vertex fold’s choices on the canvas', () => {
  const fan: FoldVertexAnalysed = {
    analysis: {
      kind: 'rabbit-ear',
      center: [0.3, 0.3],
      given: [
        [-1, -1],
        [1, 0],
        [0, 1],
      ],
      candidates: [
        [1, 1],
        [-1, 0],
        [0, -1],
      ],
      emergent: 0,
      layers: [1, 2],
    },
    emergents: [true, true, false],
    orders: null,
  };
  const vertex = (extra: Partial<FoldVertexPreview> = {}): FoldVertexPreview => ({
    base: fan,
    answer: fan,
    emergent: 1,
    // The third candidate does not land: never offered.
    fourths: [0, 1],
    elsewhere: null,
    direction: 'valley',
    orders: [],
    order: null,
    layers: 2,
    ...extra,
  });

  it('offers orders and swivel ridges, but never a rabbit ear’s fourth ray', () => {
    const tools = FOLD_TOOL_INITIAL;
    expect(foldCanvasChoice(preview({ vertex: vertex() }), tools)).toBeNull();
    // One lands: nothing to step through on the canvas.
    expect(foldCanvasChoice(preview({ vertex: vertex({ fourths: [1] }) }), tools)).toBeNull();
    const order = { faces: [], orders: [] };
    const other = { faces: [], orders: [] };
    expect(foldCanvasChoice(preview({ vertex: vertex({ orders: [order, other], order: other }) }), tools)).toEqual({
      kind: 'order',
      index: 1,
      count: 2,
    });
    // A swivel's two ridges, by name on the chooser too.
    const swivel = { analysis: { kind: 'swivel-by-edge' }, emergents: [true, true], orders: null } as unknown as FoldVertexAnalysed;
    expect(foldCanvasChoice(preview({ vertex: vertex({ base: swivel, answer: swivel, emergent: 0, fourths: [0, 1] }) }), tools)).toEqual({
      kind: 'ridge',
      index: 0,
      count: 2,
    });
  });

  it('does not change a rabbit ear’s hinge through the choice shortcut', () => {
    const tools = createFoldTools();
    const shown = preview({ vertex: vertex() });
    act(() => root.render(<Harness session={session(vi.fn())} tools={tools} preview={shown} />));
    act(() => tools.selectTool('rabbit-ear'));
    // The hinge is controlled only by the region click.
    act(() => void bound!.verbs.stepChoice(1));
    expect(tools.store.getState().compound.emergent).toBeNull();
    act(() => void bound!.verbs.stepChoice(-1));
    expect(tools.store.getState().compound.emergent).toBeNull();
    expect(Object.keys(tools.store.getState().compound)).not.toContain('ridge');
  });

  it('commits nothing, and waits for nothing, while none of a fan’s fourth creases lands', () => {
    const commitStep = vi.fn<FoldSessionSurface['commitStep']>(() => Promise.resolve({ status: 'stale' as const }));
    const tools = createFoldTools();
    const stuck = { ...fan, emergents: [false, false, false] };
    const shown = preview({ step: null, vertex: vertex({ base: stuck, answer: stuck, emergent: null, fourths: [] }) });
    act(() => root.render(<Harness session={session(commitStep)} tools={tools} preview={shown} />));
    act(() => tools.selectTool('rabbit-ear'));
    let claimed = true;
    act(() => {
      claimed = bound!.verbs.commit();
    });
    expect(claimed).toBe(false);
    expect(bound!.queued).toBe(false);
    expect(commitStep).not.toHaveBeenCalled();
    // A commit queued before the answer came is let go once it says none lands.
    expect(queuedCommit('input', shown, false, 'input')).toBe('drop');
  });

  it('picks a fan’s paper that stays on the paper only, and again while previewed in another region, on either pane', () => {
    const tools = createFoldTools();
    const index = foldPickIndex(flatSquareScene(), flatSquareLandmarks(), []);
    const view = { index } as unknown as FoldStateView;
    act(() => root.render(<Harness session={session(vi.fn())} tools={tools} preview={preview({ step: null })} view={view} />));
    act(() => tools.selectTool('rabbit-ear'));
    const corner = (x: number, y: number) =>
      ({ kind: 'point', provenance: 'vertex', sheet: [x, y], mark: null, scene: { x, y } }) as const;
    for (const [x, y] of [
      [0, 1],
      [1, 1],
      [1, 0],
    ] as const) {
      act(() => void tools.pick(corner(x, y)));
    }
    const radii = { point: 0.02, line: 0.02 };
    // Off the paper, nothing a click would take; on it, the paper under the pointer.
    expect(bound!.verbs.hitTest('folded', { x: 1.3, y: 0.5 }, radii)?.pick).toBeNull();
    const below = bound!.verbs.hitTest('folded', { x: 0.3, y: 0.3 }, radii);
    expect(below?.pick).toMatchObject({ kind: 'free', sheet: [0.3, 0.3] });
    act(() => bound!.verbs.pick(below));
    expect(tools.store.getState().picks).toHaveLength(4);
    // Previewed: a click in the same region changes nothing, the choices made kept.
    act(() => tools.setEmergent(1));
    act(() => bound!.verbs.pick(bound!.verbs.hitTest('folded', { x: 0.2, y: 0.25 }, radii)));
    expect(tools.store.getState().picks[3]).toMatchObject({ scene: { x: 0.3, y: 0.3 } });
    expect(tools.store.getState().compound.emergent).toBe(1);
    // In another region — here on the crease pattern — it is the paper that stays now, its fourth creases listed anew.
    act(() => bound!.verbs.pick(bound!.verbs.hitTest('crease-pattern', { x: 0.75, y: 0.95 }, radii)));
    expect(tools.store.getState().picks).toHaveLength(4);
    expect(tools.store.getState().picks[3]).toMatchObject({ pane: 'crease-pattern', sheet: [0.75, 0.95] });
    expect(tools.store.getState().compound.emergent).toBeNull();
  });

  it('binds the chooser, the fixes and a click on the folded paper to the vertex tools', () => {
    const surface = session(vi.fn());
    const tools = createFoldTools();
    const index = foldPickIndex(flatSquareScene(), flatSquareLandmarks(), []);
    const squash: FoldVertexAnalysed = {
      analysis: {
        kind: 'squash',
        vertex: [0.5, 0.5],
        hinge: { n: [0.7071, -0.7071], d: 0 },
        spine: { n: [0.7071, 0.7071], d: 0.7071 },
        hinge_direction: [-0.7071, -0.7071],
        spine_direction: [-0.7071, 0.7071],
        upper: [1],
        lower: [2],
        upper_crease: { n: [0, 1], d: 0.5 },
        lower_crease: { n: [0, 1], d: 0.5 },
        wedge: -Math.PI / 2,
        share: 0,
      },
      emergents: [],
      orders: null,
    };
    const render = (shown: FoldToolPreview) =>
      act(() =>
        root.render(<Harness session={surface} tools={tools} preview={shown} view={{ index } as unknown as FoldStateView} />)
      );
    // A squash located: a click on the folded paper aims its spine from its vertex.
    render(preview({ vertex: vertex({ base: squash, answer: squash, emergent: null, layers: 0 }) }));
    act(() => tools.selectTool('squash'));
    act(() => void tools.pick({ kind: 'free', pane: 'folded', scene: { x: 0.2, y: 0.4 }, sheet: [0.2, 0.4] }));
    act(() => bound!.verbs.pick({ pane: 'folded', at: { x: 0.5, y: 1 }, pick: null }));
    expect(tools.store.getState().compound.squashTarget).toEqual([0, 1]);
    act(() => bound!.verbs.resetSquashTarget());
    expect(tools.store.getState().compound.squashTarget).toBeNull();
    // The other way: the direction turned, for a vertex fold as for a plain one.
    act(() => bound!.verbs.foldOtherWay());
    expect(tools.store.getState().vertexDirection).toBe('mountain');
    act(() => bound!.verbs.vertexOtherWay());
    expect(tools.store.getState().vertexDirection).toBe('valley');

    // A fan: its fourth ray stepped and taken by a fix's direction, its layers.
    render(preview({ vertex: vertex() }));
    act(() => bound!.verbs.stepEmergent(1));
    expect(tools.store.getState().compound.emergent).toBe(0);
    act(() => bound!.verbs.takeEmergent([-1, 0.1]));
    expect(tools.store.getState().compound.emergent).toBe(1);
    act(() => bound!.verbs.stepFanLayers(-1));
    expect(tools.store.getState().compound.fanLayers).toBe(1);
    act(() => bound!.verbs.stepFanLayers(-1));
    expect(tools.store.getState().compound.fanLayers).toBeNull();

    // A petal fold's hinge refused: the Precrease tool through its two ends, or on the edge-to-edge axiom.
    const end = (x: number) => ({ kind: 'point', provenance: 'free', sheet: [x, 0.5], mark: null, scene: { x, y: 0.5 } }) as const;
    act(() => tools.selectTool('petal'));
    act(() => tools.setVertexDirection('mountain'));
    act(() => bound!.verbs.setVertexLineBy('points'));
    expect(tools.store.getState().petalHinge).toBe('points');
    for (const x of [0.2, 0.8]) act(() => void tools.pick(end(x)));
    act(() => bound!.verbs.precreaseLine());
    expect(tools.store.getState()).toMatchObject({ tool: 'precrease', precreaseDirection: 'mountain', extent: 'whole', lineMode: 'axiom-1', picks: [end(0.2), end(0.8)] });
    act(() => bound!.verbs.precreaseKite());
    expect(tools.store.getState()).toMatchObject({ tool: 'precrease', precreaseDirection: 'mountain', extent: 'whole', lineMode: 'axiom-3', picks: [] });

    // Over a hinge crease whose kite is not creased: the same hinge by its ends, the flap as clicked.
    const hinge = index.folded.segments[0]!;
    const flap = { kind: 'free', pane: 'folded', scene: { x: 0.5, y: 0.3 }, sheet: [0.5, 0.3] } as const;
    act(() => tools.selectTool('petal'));
    act(() => bound!.verbs.setVertexLineBy('crease'));
    act(() => void tools.pick({ ...hinge, segment: 'crease' }));
    act(() => void tools.pick(flap));
    act(() => bound!.verbs.petalByEnds());
    const byEnds = tools.store.getState();
    expect(byEnds).toMatchObject({ tool: 'petal', petalHinge: 'points' });
    expect(byEnds.picks).toEqual([
      { kind: 'point', provenance: 'vertex', sheet: hinge.sheet[0], mark: null, scene: hinge.scene[0] },
      { kind: 'point', provenance: 'vertex', sheet: hinge.sheet[1], mark: null, scene: hinge.scene[1] },
      flap,
    ]);
  });

  it('picks a petal fold’s flap on the paper below its hinge, and again while previewed on the hinge’s other side', () => {
    const tools = createFoldTools();
    const index = foldPickIndex(flatSquareScene(), flatSquareLandmarks(), []);
    const view = { index } as unknown as FoldStateView;
    act(() => root.render(<Harness session={session(vi.fn())} tools={tools} preview={preview({ step: null })} view={view} />));
    act(() => tools.selectTool('petal'));
    act(() => tools.setPetalHinge('points'));
    const radii = { point: 0.03, line: 0.03 };
    // The hinge's ends snap to landmarks: the corners here.
    for (const at of [
      { x: 0.01, y: 0.99 },
      { x: 0.99, y: 0.01 },
    ]) {
      const hit = bound!.verbs.hitTest('folded', at, radii);
      expect(hit?.pick).toMatchObject({ kind: 'point', provenance: 'vertex' });
      act(() => bound!.verbs.pick(hit));
    }
    // Then the paper under the pointer: off it, nothing.
    expect(bound!.verbs.hitTest('folded', { x: 1.3, y: 0.5 }, radii)?.pick).toBeNull();
    const below = bound!.verbs.hitTest('folded', { x: 0.2, y: 0.2 }, radii);
    expect(below?.pick).toMatchObject({ kind: 'free', sheet: [0.2, 0.2] });
    act(() => bound!.verbs.pick(below));
    expect(tools.store.getState().picks).toHaveLength(3);
    // Previewed: the same side of the hinge changes nothing; the other side is the flap now.
    act(() => bound!.verbs.pick(bound!.verbs.hitTest('folded', { x: 0.3, y: 0.1 }, radii)));
    expect(tools.store.getState().picks[2]).toMatchObject({ scene: { x: 0.2, y: 0.2 } });
    act(() => bound!.verbs.pick(bound!.verbs.hitTest('folded', { x: 0.8, y: 0.8 }, radii)));
    expect(tools.store.getState().picks).toHaveLength(3);
    expect(tools.store.getState().picks[2]).toMatchObject({ scene: { x: 0.8, y: 0.8 } });
  });

  it('takes a swivel’s pivot, an edge — never a flat crease — and a line not parallel to it', () => {
    const tools = createFoldTools();
    const scene = flatSquareScene();
    const precreased = {
      ...scene,
      creases: [
        ...scene.creases,
        { id: 4, vertices: [0, 2] as [number, number], from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, kind: 'flat' as const, letter: 'valley' as const, made_at: 1 },
      ],
    };
    const index = foldPickIndex(precreased, flatSquareLandmarks(), []);
    const view = { index } as unknown as FoldStateView;
    act(() => root.render(<Harness session={session(vi.fn())} tools={tools} preview={preview({ step: null })} view={view} />));
    act(() => tools.selectTool('swivel'));
    const radii = { point: 0.03, line: 0.03 };
    // The pivot: a landmark — here the top-right corner.
    act(() => bound!.verbs.pick(bound!.verbs.hitTest('crease-pattern', { x: 0.99, y: 0.99 }, radii)));
    // The edge: the diagonal precrease is no edge, so a click on it picks nothing.
    expect(bound!.verbs.hitTest('crease-pattern', { x: 0.5, y: 0.5 }, radii)?.pick).toBeNull();
    const bottom = bound!.verbs.hitTest('crease-pattern', { x: 0.5, y: 0.005 }, radii);
    expect(bottom?.pick).toMatchObject({ kind: 'segment', segment: 'raw_edge' });
    act(() => bound!.verbs.pick(bottom));
    // The line it lands on: the top edge runs parallel to it, so nothing; the diagonal does not.
    expect(bound!.verbs.hitTest('crease-pattern', { x: 0.5, y: 0.995 }, radii)?.pick).toBeNull();
    expect(bound!.verbs.hitTest('crease-pattern', { x: 0.5, y: 0.5 }, radii)?.pick).toMatchObject({ kind: 'segment', segment: 'crease' });
    // Two points instead: the pivot and the edge stay.
    act(() => bound!.verbs.setVertexLineBy('points'));
    expect(tools.store.getState()).toMatchObject({ swivelTarget: 'points' });
    expect(tools.store.getState().picks).toHaveLength(2);
  });

  it('offers a swivel’s next click only what its reach lands, and takes another meeting point when nothing can swing', () => {
    const tools = createFoldTools();
    const scene = flatSquareScene();
    const precreased = {
      ...scene,
      creases: [
        ...scene.creases,
        { id: 4, vertices: [0, 2] as [number, number], from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, kind: 'flat' as const, letter: 'valley' as const, made_at: 1 },
      ],
    };
    const index = foldPickIndex(precreased, flatSquareLandmarks(), []);
    const view = { index } as unknown as FoldStateView;
    const landing = (edge: number, target: number): FoldSwivelLanding => ({
      edge,
      target,
      directions: [true, true],
      op: { kind: 'swivel', via: 'edge', pivot: [1, 1], edge: [0, 0.5], target: { via: 'crease', at: [0.5, 0.5] }, seed: { scope: 'all' }, direction: 'valley' },
      answer: { analysis: { kind: 'swivel-by-edge' }, emergents: [true], orders: null } as unknown as FoldVertexAnalysed,
    });
    const render = (reach: FoldSwivelReachView | null) =>
      act(() =>
        root.render(
          <Harness
            session={session(vi.fn())}
            tools={tools}
            preview={preview({
              step: null,
              vertex: { base: null, answer: null, emergent: null, fourths: [], elsewhere: null, direction: 'valley', orders: [], order: null, layers: 0, reach },
            })}
            view={view}
          />
        )
      );
    render(null);
    act(() => tools.selectTool('swivel'));
    const radii = { point: 0.03, line: 0.03 };
    const at = (x: number, y: number) => bound!.verbs.hitTest('crease-pattern', { x, y }, radii);
    act(() => bound!.verbs.pick(at(0.99, 0.99)));
    // While the worker is asked, nothing is offered.
    render(SWIVEL_REACH_ASKING);
    expect(at(0.005, 0.5)?.pick).toBeNull();
    // Only the left edge swings, onto the diagonal: the bottom edge is no choice.
    render(swivelReachView({ landings: [landing(3, 4)] }));
    expect(at(0.5, 0.005)?.pick).toBeNull();
    const left = at(0.005, 0.5);
    expect(left?.pick).toMatchObject({ kind: 'segment', edge: 3 });
    act(() => bound!.verbs.pick(left));
    // Of the lines, only the one it lands on: not the bottom edge, square to it though it is.
    expect(at(0.5, 0.005)?.pick).toBeNull();
    expect(at(0.5, 0.5)?.pick).toMatchObject({ kind: 'segment', edge: 4 });
    // From a point nothing can swing from, the next click takes another point in its place.
    act(() => tools.clear());
    act(() => bound!.verbs.pick(at(0.99, 0.99)));
    render(swivelReachView({ landings: [] }));
    const other = at(0.01, 0.01);
    expect(other?.pick).toMatchObject({ kind: 'point', sheet: [0, 0] });
    act(() => bound!.verbs.pick(other));
    expect(tools.store.getState().picks).toEqual([other?.pick]);
  });

  it('clicks a pinch along the located line, holds the commit until it is in, and steps back on Escape', () => {
    const commitStep = vi.fn<FoldSessionSurface['commitStep']>(() => Promise.resolve({ status: 'stale' as const }));
    const surface = session(commitStep);
    const index = foldPickIndex(flatSquareScene(), flatSquareLandmarks(), []);
    const view = { index } as FoldStateView;
    const tools = createFoldTools({ ...FOLD_TOOL_INITIAL, tool: 'precrease', lineMode: 'free', extent: 'pinch' });
    const across = { n: [0, 1] as [number, number], d: 0.5 };
    const along = { folded: foldAlongLine(index, across, 'folded'), creasePattern: foldAlongLine(index, across, 'crease-pattern') };
    const render = (shown: FoldToolPreview) =>
      act(() => root.render(<Harness session={surface} tools={tools} preview={shown} view={view} />));
    render(preview({ step: null }));
    for (const x of [0, 1]) act(() => void tools.pick({ kind: 'free', pane: 'folded', scene: { x, y: 0.5 }, sheet: [x, 0.5] }));
    render(preview({ step: null, extent: { state: { status: 'incomplete', mode: 'pinch', picked: 0, needed: 1 }, along } }));
    // Nothing to commit while the pinch is still to click, and nothing queued.
    let claimed = true;
    act(() => {
      claimed = bound!.verbs.commit();
    });
    expect(claimed).toBe(false);
    expect(bound!.queued).toBe(false);
    // Beside the line, a click picks nothing — no layer, no point: the seed is still the default top flap.
    const radii = { point: 0.03, line: 0.03 };
    act(() => bound!.verbs.pick(bound!.verbs.hitTest('folded', { x: 0.3, y: 0.8 }, radii)));
    expect(tools.store.getState()).toMatchObject({ extentPicks: [], seed: { scope: 'top' } });
    // On it, the line's middle.
    const hit = bound!.verbs.hitTest('folded', { x: 0.51, y: 0.49 }, radii);
    expect(hit?.pick).toMatchObject({ kind: 'point', provenance: 'midpoint', sheet: [0.5, 0.5] });
    act(() => bound!.verbs.pick(hit));
    expect(tools.store.getState().extentPicks).toHaveLength(1);
    // Escape takes back the point first, then the line.
    act(() => void bound!.verbs.cancel());
    expect(tools.store.getState()).toMatchObject({ extentPicks: [], extent: 'pinch' });
    expect(tools.store.getState().picks).toHaveLength(2);
    act(() => void bound!.verbs.cancel());
    expect(tools.store.getState().picks).toHaveLength(0);
    // The extent key steps it with the Precrease tool in hand, and declines otherwise.
    let stepped = false;
    act(() => {
      stepped = bound!.verbs.cycleExtent();
    });
    expect(stepped).toBe(true);
    expect(tools.store.getState().extent).toBe('whole');
    act(() => tools.selectTool('valley'));
    expect(bound!.verbs.cycleExtent()).toBe(false);
    expect(commitStep).not.toHaveBeenCalled();
  });

  it('turns a too-short segment into a pinch at its first point, or the whole line, or every layer', () => {
    const tools = createFoldTools({ ...FOLD_TOOL_INITIAL, tool: 'precrease', extent: 'segment' });
    act(() => root.render(<Harness session={session(vi.fn())} tools={tools} preview={preview()} />));
    const at = { kind: 'point' as const, provenance: 'crossing' as const, sheet: [0.5, 0.5] as [number, number], mark: null, scene: { x: 0.5, y: 0.5 } };
    act(() => {
      tools.pickAlong(at);
      tools.pickAlong(at);
      tools.setSeed({ scope: 'depth', at: [0.2, 0.2], scene: { x: 0.2, y: 0.2 }, choice: 1 });
    });
    act(() => bound!.verbs.pinchInstead());
    expect(tools.store.getState()).toMatchObject({ extent: 'pinch', extentPicks: [at] });
    act(() => bound!.verbs.throughAllLayers());
    expect(tools.store.getState().seed).toEqual({ scope: 'all' });
    act(() => bound!.verbs.useWholeLine());
    expect(tools.store.getState()).toMatchObject({ extent: 'whole', extentPicks: [] });
  });
});
