import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tracked = vi.hoisted(() => ({ offered: vi.fn(), refused: vi.fn() }));
vi.mock('../../analytics', () => ({
  trackFoldChoiceOffered: tracked.offered,
  trackFoldRefused: tracked.refused,
}));

import type { FoldPocket, FoldSinkOrders } from '../engine/foldEngineSinkWire';
import type { FoldFlap } from '../engine/foldEngineWire';
import type { FoldSessionSurface } from '../session/useFoldSession';
import { FOLD_TOOL_INITIAL, type FoldToolState } from '../tools/foldToolState';
import { flatSquareLandmarks, flatSquareScene } from './foldCanvas.fixtures';
import { foldSinkWindowView } from './foldCanvasModel';
import { foldPickIndex, type FoldPick } from './foldPicking';
import type { FoldStateView } from './useFoldStateView';
import { useFoldToolPreview, type FoldToolPreview } from './useFoldToolPreview';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The sink tools' step through the canvas's pipeline (`useFoldToolPreview` →
 * `useFoldSinkStep`) over a fake engine: what is asked of the engine and how
 * often, the pocket, order and sunk point each step stores, and what is
 * counted as a choice offered. The real engine's answers are the wasm
 * tests' (`tools/sink/sinkStep.wasm.test.ts`).
 */
const PARENT = { generation: 1, id: 7 };
const LINE = { n: [0, 1] as [number, number], d: 0.5 };
const POINT: FoldFlap = { faces: [0, 1], witness: [0.5, 0.75] };
const POCKETS: FoldPocket[] = [
  { upper: [0], lower: [1], seams: [3], stored: { above: [0.4, 0.7], below: [0.4, 0.8] } },
  { upper: [1], lower: [0], seams: [4], stored: { above: [0.6, 0.7], below: [0.6, 0.8] } },
];

let orders: FoldSinkOrders = { count: { orders: 1, exact: true }, components: [] };
let sunk: FoldFlap[] = [{ faces: [2], witness: [0.3, 0.6] }];

const engine = {
  axiomCandidates: vi.fn(async () => ({ status: 'ok', candidates: [] })),
  crossSection: vi.fn(async () => ({ status: 'refused' })),
  action: vi.fn(async () => ({ status: 'refused' })),
  compoundAnalysis: vi.fn(async () => ({
    status: 'ok',
    family: 'sink',
    analysis: {
      line: LINE,
      side: 'positive',
      snap: {},
      point: POINT,
      outline: [3, 4],
      exterior: 'mountain',
      apex: [0.5, 1],
      square: LINE,
      pockets: POCKETS,
      truncated: false,
    },
    open: null,
  })),
  orderSelection: vi.fn(async (_state: unknown, _op: unknown, _choices: { pocket?: unknown }, query: { index: number }) => ({
    status: 'ok', count: orders.count, index: query.index,
    completion: orders.components.length ? { faces: [[0.5, 0.6]], orders: [[0, 1, query.index === 0 ? 1 : -1]] } : null,
  })),
  sinkOrders: vi.fn(async () => ({ status: 'ok', ...orders })),
  sinkPick: vi.fn(async (_state: unknown, _op: unknown, choice: number[]) => ({
    status: 'ok',
    completion: { faces: [[0.5, 0.6]], orders: [[0, 1, choice[0] === 0 ? 1 : -1]] },
  })),
  sunkPoints: vi.fn(async () => ({ status: 'ok', line: LINE, side: 'positive', snap: {}, points: sunk })),
};

const verbs = {
  analyse: vi.fn(async () => undefined),
  preview: vi.fn(async () => undefined),
  cancel: vi.fn(),
  withState: vi.fn(async () => ({ status: 'unavailable' })),
  withCursor: vi.fn(async (call: (e: unknown, at: unknown) => Promise<unknown>) => ({
    status: 'answered',
    value: await call(engine, PARENT),
  })),
  query: vi.fn(async (state: unknown, call: (e: unknown, at: unknown) => Promise<unknown>) => ({
    status: 'answered',
    value: await call(engine, state),
  })),
  peek: vi.fn(() => null),
  resolveOrders: vi.fn(async (op: unknown, choices: { pocket?: unknown }, query: { index: number }) => ({
    status: 'answered',
    value: await engine.orderSelection(PARENT, op, choices, query),
  })),
  axiomRoots: vi.fn(async () => ({ status: 'answered', value: await engine.axiomCandidates() })),
};
const session = (): FoldSessionSurface =>
  ({
    ...verbs,
    cursor: { state: PARENT },
    analysis: { status: 'idle' },
    pending: { status: 'idle' },
  }) as unknown as FoldSessionSurface;

const view = { index: foldPickIndex(flatSquareScene(), flatSquareLandmarks(), []) } as unknown as FoldStateView;

let seen: FoldToolPreview | null = null;
function Probe({ tools }: { tools: FoldToolState }) {
  const preview = useFoldToolPreview(session(), view, tools);
  useEffect(() => {
    seen = preview;
  });
  return null;
}

let root: Root | null = null;
beforeEach(() => {
  root = createRoot(document.createElement('div'));
  seen = null;
  orders = { count: { orders: 1, exact: true }, components: [] };
  sunk = [{ faces: [2], witness: [0.3, 0.6] }];
  vi.clearAllMocks();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

const render = async (tools: FoldToolState) => {
  await act(async () => root?.render(<Probe tools={tools} />));
  // The engine's answers in turn — the point, the orders, a pick — and the renders they make.
  for (let k = 0; k < 5; k += 1) await act(async () => {});
};

const free = (x: number, y: number): FoldPick => ({ kind: 'free', pane: 'folded', scene: { x, y }, sheet: [x, y] });
const along = (tool: FoldToolState['tool']): FoldToolState => ({
  ...FOLD_TOOL_INITIAL,
  tool,
  lineMode: 'free',
  picks: [free(0, 0.5), free(1, 0.5)],
});

describe('a sink’s point', () => {
  it('is asked once for both kinds; a closed sink takes the first pocket, then the one stepped to', async () => {
    let tools = along('closed-sink');
    await render(tools);
    expect(engine.compoundAnalysis).toHaveBeenCalledTimes(1);
    // Asked as the open sink: the point is either kind's.
    expect(engine.compoundAnalysis).toHaveBeenLastCalledWith(PARENT, expect.objectContaining({ kind: 'open-sink' }), undefined);
    expect(tracked.offered).toHaveBeenCalledWith('pocket', 2);
    expect(seen?.sink).toMatchObject({ tool: 'closed-sink', pockets: POCKETS, pocket: 0, orders: 0 });
    expect(seen?.step?.op.kind).toBe('closed-sink');
    expect(seen?.step?.choices).toEqual({ pocket: [POCKETS[0]!.stored.above, POCKETS[0]!.stored.below] });
    // Its orders are counted with the pocket it goes into.
    expect(engine.sinkOrders).toHaveBeenLastCalledWith(
      PARENT,
      expect.objectContaining({ kind: 'closed-sink' }),
      { pocket: [POCKETS[0]!.stored.above, POCKETS[0]!.stored.below] }
    );

    tools = { ...tools, compound: { ...tools.compound, pocket: 1 } };
    await render(tools);
    expect(seen?.step?.choices).toEqual({ pocket: [POCKETS[1]!.stored.above, POCKETS[1]!.stored.below] });

    // The open sink: the same point, nothing asked of it again, and no pocket.
    tools = { ...tools, tool: 'open-sink' };
    await render(tools);
    expect(engine.compoundAnalysis).toHaveBeenCalledTimes(1);
    expect(tracked.offered).toHaveBeenCalledTimes(1);
    expect(seen?.sink?.pockets).toEqual([]);
    expect(seen?.step?.op.kind).toBe('open-sink');
    expect(seen?.step?.choices).toBeUndefined();
  });

  it('starts a closed sink on the front pocket as the viewer sees it, whichever the engine lists first', async () => {
    const back: FoldPocket = { upper: [0, 1, 2], lower: [3], seams: [3], stored: { above: [0.4, 0.7], below: [0.4, 0.8] } };
    const front: FoldPocket = { upper: [0], lower: [1, 2, 3], seams: [4], stored: { above: [0.6, 0.7], below: [0.6, 0.8] } };
    const listed = await engine.compoundAnalysis();
    engine.compoundAnalysis.mockImplementationOnce(async () => ({
      ...listed,
      analysis: { ...listed.analysis, pockets: [back, front] },
    }));
    const tools = along('closed-sink');
    await render(tools);
    expect(seen?.sink).toMatchObject({ pockets: [front, back], pocket: 0 });
    expect(foldSinkWindowView(tools, seen!, false)?.pocketName).toBe('front');
    expect(seen?.step?.choices).toEqual({ pocket: [front.stored.above, front.stored.below] });
  });

  it('lands in the order the chooser steps to, each pick asked what it stores', async () => {
    orders = {
      count: { orders: 2, exact: true },
      components: [
        { orders: 2, truncated: false },
        { orders: 1, truncated: false },
      ],
    };
    const tools = along('open-sink');
    await render(tools);
    expect(tracked.offered).toHaveBeenCalledWith('order', 2);
    expect(seen?.sink).toMatchObject({ orders: 2, order: 0 });
    expect(engine.sinkPick).toHaveBeenLastCalledWith(PARENT, expect.objectContaining({ kind: 'open-sink' }), [0, 0], undefined);
    expect(seen?.step?.choices?.completion?.orders).toEqual([[0, 1, 1]]);

    await act(async () => seen?.orderResolution?.resume());
    await act(async () => seen?.orderResolution?.step(1));
    await render(tools);
    expect(engine.orderSelection).toHaveBeenLastCalledWith(PARENT, expect.anything(), expect.anything(), expect.objectContaining({ index: 1 }));
    expect(seen?.step?.choices?.completion?.orders).toEqual([[0, 1, -1]]);
    // One offer, however the folder steps through it.
    expect(tracked.offered).toHaveBeenCalledTimes(1);
  });

  it('is asked along a fix’s square line in place of the picks’, folded along it with its kind', async () => {
    const fixed = {
      kind: 'open-sink' as const,
      line: { via: 'free' as const, through: [[0.25, 0.4], [0.75, 0.4]] as [[number, number], [number, number]] },
      moving: [0.5, 0.75] as [number, number],
      seed: { scope: 'all' as const },
    };
    await render({ ...along('open-sink'), override: { op: fixed } });
    expect(engine.compoundAnalysis).toHaveBeenLastCalledWith(PARENT, expect.objectContaining({ line: fixed.line }), undefined);
    expect(seen?.step?.op).toMatchObject({ kind: 'open-sink', line: fixed.line });
    // The closed sink instead keeps the fix's line.
    await render({ ...along('closed-sink'), override: { op: fixed } });
    expect(seen?.step?.op).toMatchObject({ kind: 'closed-sink', line: fixed.line });
  });
});

describe('an unsink’s sunk point', () => {
  it('is the one the engine finds on its side while the folder has named none', async () => {
    await render(along('unsink'));
    expect(engine.sunkPoints).toHaveBeenCalledTimes(1);
    expect(engine.compoundAnalysis).not.toHaveBeenCalled();
    expect(seen?.step?.op).toMatchObject({ kind: 'unsink', seed: { scope: 'flaps', at: [[0.3, 0.6]] } });
    expect(seen?.step?.op).not.toHaveProperty('moving');
    expect(seen?.refused).toBeNull();

    // Named by the folder: nothing to find.
    const named = { ...along('unsink'), seed: { scope: 'flaps' as const, flaps: [{ faces: [5], witness: [0.6, 0.6] as [number, number] }] } };
    await render(named);
    expect(engine.sunkPoints).toHaveBeenCalledTimes(1);
    expect(seen?.step?.op).toMatchObject({ seed: { scope: 'flaps', at: [[0.6, 0.6]] } });
  });

  it('is refused, with no step, where nothing is sunk', async () => {
    sunk = [];
    await render(along('unsink'));
    expect(seen?.refused?.refusal.code).toBe('unsink_not_sunk');
    expect(seen?.step).toBeNull();
    expect(tracked.refused).toHaveBeenCalledWith('unsink_not_sunk');
  });
});
