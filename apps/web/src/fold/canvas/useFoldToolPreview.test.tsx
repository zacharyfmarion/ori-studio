import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tracked = vi.hoisted(() => ({ offered: vi.fn(), refused: vi.fn() }));
vi.mock('../../analytics', () => ({
  trackFoldChoiceOffered: tracked.offered,
  trackFoldRefused: tracked.refused,
}));

import i18n from '../../i18n';
import type { FoldAnalysis, FoldCrossSection, FoldFlap } from '../engine/foldEngineWire';
import { foldToolWindow } from '../tools/foldToolWindow';
import { foldTuckWindowView, foldWindowPreview } from './foldCanvasModel';
import { foldShownPreview } from './foldHeldPreview';
import type { FoldPendingAnalysis } from '../session/foldSessionState';
import type { FoldSessionSurface } from '../session/useFoldSession';
import { FOLD_TOOL_INITIAL, type FoldToolState } from '../tools/foldToolState';
import { flatSquareLandmarks, flatSquareScene } from './foldCanvas.fixtures';
import { foldPickIndex, type FoldPick } from './foldPicking';
import type { FoldStateView } from './useFoldStateView';
import { useFoldToolPreview, type FoldToolPreview } from './useFoldToolPreview';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PARENT = { generation: 1, id: 7 };
const FLAPS: FoldFlap[] = [
  { faces: [0], witness: [0.5, 0.75] },
  { faces: [1], witness: [0.5, 0.9] },
];
const SECTION = {
  line: { n: [0, 1], d: 0.5 },
  side: 'positive',
  from: { x: 0, y: 0.5 },
  to: { x: 1, y: 0.5 },
  intervals: [{ start: 0, end: 1, faces: [0, 1], rows: [0, 1] }],
  rows: [
    { faces: [0], spans: [[0, 1]], flap: 0 },
    { faces: [1], spans: [[0, 1]], flap: 1 },
  ],
  order: { kind: 'layered', unordered: [] },
  flaps: FLAPS,
  layers: 2,
  joins: [],
} as unknown as FoldCrossSection;

const analysisOf = (side: 'positive' | 'negative'): FoldAnalysis =>
  ({
    line: { n: [0, 1], d: 0.5 },
    side,
    snap: { kind: 'none' },
    direction: 'valley',
    flaps: FLAPS,
    picked: [0, 1],
    added: [],
    moving: [0, 1],
  }) as unknown as FoldAnalysis;

/** The compound question, of a tip whose flaps cannot open: what the reverse fold's tests ask. */
const tipCannotOpen = async (): Promise<unknown> => ({
  status: 'refused',
  refusal: { code: 'reverse_no_opening', faces: [0], cause: 'no_spine' },
  fixes: [],
});

const engine = {
  axiomCandidates: vi.fn(async () => ({
    status: 'ok',
    candidates: [
      { root: 0, line: { n: [1, 0], d: 0.5 }, side: null },
      { root: 1, line: { n: [0, 1], d: 0.5 }, side: null },
    ],
  })),
  crossSection: vi.fn(async () => ({ status: 'ok', section: SECTION })),
  action: vi.fn(async () => ({ status: 'refused' })),
  scene: vi.fn(async () => TURNED),
  stepSummary: vi.fn(async () => ({ status: 'ok', summary: null })),
  compoundAnalysis: vi.fn(tipCannotOpen),
  orderSelection: vi.fn(async () => ({ status: 'ok', count: { orders: 1, exact: true }, index: 0, completion: null })),
  // A crimp's and a tuck's own calls, which list the orders they leave.
  crimp: vi.fn(async (): Promise<unknown> => ({ status: 'ok', outcome: 'landed', state: 40, stored: {} })),
  tuck: vi.fn(async (): Promise<unknown> => ({ status: 'ok', outcome: 'landed', state: 41, stored: {} })),
  release: vi.fn(async () => 1),
};

let analysis: FoldPendingAnalysis = { status: 'idle' };
/** The session's pending step: idle unless a test lands one. */
let pending: unknown = { status: 'idle' };
/** What a query of a landed state answers: the turned scene a rotation's tests hand it. */
const TURNED = { view_transform: [0, -1, 1, 1, 0, 0], subfaces: [], creases: [] } as unknown;
const analyse = vi.fn(async () => undefined);
const verbs = {
  analyse,
  preview: vi.fn(async () => undefined),
  cancel: vi.fn(),
  withState: vi.fn(async () => ({ status: 'unavailable' })),
  withCursor: vi.fn(async (call: (e: unknown, at: unknown) => Promise<unknown>) => ({
    status: 'answered',
    value: await call(engine, PARENT),
  })),
  // A pure query, asked of the engine for the state it names (as `withCursor` names it here); nothing is held between asks.
  query: vi.fn(async (state: unknown, call: (e: unknown, at: unknown) => Promise<unknown>) => ({
    status: 'answered',
    value: await call(engine, state),
  })),
  peek: vi.fn(() => null),
  resolveOrders: vi.fn(async (...asked: unknown[]) => ({
    status: 'answered',
    value: await (engine.orderSelection as (...args: unknown[]) => Promise<unknown>)(PARENT, ...asked.filter((arg, k) => k < 3 || arg !== undefined)),
  })),
  // A plain fold's placements are a search with a ticket, stopped when no longer wanted.
  cancelSearch: vi.fn(),
  // The roots alone: no layers come with them here, so the line's section is asked for.
  axiomRoots: vi.fn(async (line: unknown) => ({
    status: 'answered',
    value: await (engine.axiomCandidates as (...args: unknown[]) => Promise<unknown>)(PARENT, line),
  })),
};
/** The session as the hook reads it: stable verbs, a snapshot that is new each render. */
const session = (): FoldSessionSurface =>
  ({
    ...verbs,
    cursor: { state: PARENT },
    analysis,
    pending,
  }) as unknown as FoldSessionSurface;

const view = { index: foldPickIndex(flatSquareScene(), flatSquareLandmarks(), []) } as unknown as FoldStateView;

let seen: FoldToolPreview | null = null;
/** Captured in an effect, which `act` flushes. */
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
  analysis = { status: 'idle' };
  pending = { status: 'idle' };
  seen = null;
  vi.clearAllMocks();
  engine.orderSelection.mockImplementation(async () => ({ status: 'ok', count: { orders: 1, exact: true }, index: 0, completion: null }));
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

const render = async (tools: FoldToolState) => {
  await act(async () => root?.render(<Probe tools={tools} />));
  // The engine's answers, and the renders they make.
  for (let k = 0; k < 3; k += 1) await act(async () => {});
};

const free = (x: number, y: number): FoldPick => ({ kind: 'free', pane: 'folded', scene: { x, y }, sheet: [x, y] });
const FREE_LINE: FoldToolState = { ...FOLD_TOOL_INITIAL, lineMode: 'free', picks: [free(0, 0.5), free(1, 0.5)] };

/** The analysis slot answering the step the hook last asked about. */
function answer(status: 'working' | 'analysed', side: 'positive' | 'negative' = 'positive'): void {
  const op = (analyse.mock.calls.at(-1) as unknown as [never] | undefined)?.[0];
  if (!op) throw new Error('nothing asked');
  analysis =
    status === 'working'
      ? { status, op, parent: PARENT }
      : { status, op, parent: PARENT, analysis: analysisOf(side) };
}

const point = (x: number, y: number): FoldPick => ({
  kind: 'point',
  provenance: 'vertex',
  sheet: [x, y],
  mark: null,
  scene: { x, y },
});

describe('the axiom’s roots', () => {
  it('are asked once per set of picks, and their choice counted once', async () => {
    let tools: FoldToolState = { ...FOLD_TOOL_INITIAL, lineMode: 'axiom-2', picks: [point(0, 0), point(1, 1)] };
    await render(tools);
    expect(engine.axiomCandidates).toHaveBeenCalledTimes(1);
    expect(tracked.offered).toHaveBeenCalledTimes(1);
    expect(tracked.offered).toHaveBeenCalledWith('axiom_root', 2);
    expect(seen?.candidates).toHaveLength(2);

    // Shift+→, a flap hovered and let go, Swap, the fold's kind: the same picks.
    for (const next of [{ root: 1 }, { hoveredFlap: 0 }, { hoveredFlap: null }, { swapped: true }, { tool: 'mountain' as const }]) {
      tools = { ...tools, ...next };
      await render(tools);
    }
    expect(engine.axiomCandidates).toHaveBeenCalledTimes(1);
    expect(tracked.offered).toHaveBeenCalledTimes(1);
    expect(seen?.candidates).toHaveLength(2);

    // Another pair of points is another line: asked, and offered, again.
    tools = { ...tools, picks: [point(1, 0), point(0, 1)] };
    await render(tools);
    expect(engine.axiomCandidates).toHaveBeenCalledTimes(2);
    expect(tracked.offered).toHaveBeenCalledTimes(2);
  });
});

describe('the layers at the line', () => {
  it('stay on show while a new seed of the same line is analysed', async () => {
    await render(FREE_LINE);
    answer('analysed');
    await render(FREE_LINE);
    expect(seen?.section).toBe(SECTION);

    // A flap left out: the same line and side, another step to analyse.
    const oneFlap: FoldToolState = { ...FREE_LINE, seed: { scope: 'flaps', flaps: [FLAPS[1]!] } };
    await render(oneFlap);
    expect(seen?.analysis).toBeNull();
    expect(seen?.section).toBe(SECTION);
    answer('working');
    await render(oneFlap);
    expect(seen?.section).toBe(SECTION);
    answer('analysed');
    await render(oneFlap);
    expect(seen?.section).toBe(SECTION);
    // The same line and side: nothing asked twice.
    expect(engine.crossSection).toHaveBeenCalledTimes(1);
  });

  it('stay on show for a reverse fold’s tip the engine refused, so its flaps can be narrowed there', async () => {
    const reverse: FoldToolState = { ...FREE_LINE, tool: 'inside-reverse' };
    await render(reverse);
    expect(engine.compoundAnalysis).toHaveBeenCalledTimes(1);
    expect(seen?.refused?.refusal.code).toBe('reverse_no_opening');
    // Refused, the tip is still a step: analysed like any other, its layers shown.
    expect(analyse).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'inside-reverse' }), undefined);
    answer('analysed');
    await render(reverse);
    expect(seen?.section).toBe(SECTION);
    expect(seen?.refused?.refusal.code).toBe('reverse_no_opening');
  });

  it('take a reverse fold along a fix’s line in place of the picks’, asked about and folded along it', async () => {
    const fixed = {
      kind: 'inside-reverse' as const,
      line: { via: 'free' as const, through: [[0.25, 0.5], [0.75, 0.5]] as [[number, number], [number, number]] },
      moving: [0.5, 0.75] as [number, number],
      seed: { scope: 'all' as const },
    };
    const reverse: FoldToolState = {
      ...FOLD_TOOL_INITIAL,
      tool: 'inside-reverse',
      lineMode: 'axiom-2',
      picks: [point(0, 0), point(0, 1)],
      override: { op: fixed },
    };
    await render(reverse);
    // Asked about along the fix's line, not the axiom's.
    expect(engine.compoundAnalysis).toHaveBeenLastCalledWith(
      PARENT,
      expect.objectContaining({ line: fixed.line }),
      undefined
    );
    // Folded along it, with no root: a free line has none.
    expect(seen?.step?.op).toMatchObject({ kind: 'inside-reverse', line: fixed.line });
    expect(seen?.step?.choices?.root).toBeUndefined();
  });

  it('let the other side’s section go until it is asked for', async () => {
    await render(FREE_LINE);
    answer('analysed');
    await render(FREE_LINE);
    expect(seen?.section).toBe(SECTION);

    // The other side's section, asked as soon as the side is swapped, and not yet in.
    const other = deferredSection();
    const swapped: FoldToolState = { ...FREE_LINE, swapped: true };
    await render(swapped);
    expect(engine.crossSection).toHaveBeenLastCalledWith(PARENT, expect.anything(), 'positive');
    expect(seen?.section).toBeNull();
    other.resolve({ ...SECTION, side: 'positive' });
    await render(swapped);
    expect(seen?.section).toMatchObject({ side: 'positive' });
  });
});

/** The next cross-section the engine is asked for, answered when the test says. */
function deferredSection(): { resolve: (section: FoldCrossSection | null) => void } {
  let settleIt: (section: FoldCrossSection | null) => void = () => {};
  engine.crossSection.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        settleIt = (section) =>
          resolve(
            (section
              ? { status: 'ok', section }
              : { status: 'refused', refusal: { code: 'near_miss' }, fixes: [], faces: [], vertices: [] }) as never
          );
      })
  );
  return { resolve: (section) => settleIt(section) };
}

describe('the top flap a fold takes by default (owner request, 2026-10-13)', () => {
  /** The ops the session was asked to preview, in order. */
  const previewed = () => (verbs.preview.mock.calls as unknown as [Record<string, unknown>][]).map(([op]) => op);

  it('builds no step until the section at the line says which flap is on top, then folds that flap alone', async () => {
    const asked = deferredSection();
    await render(FREE_LINE);
    // The section is asked from the line and side the picks locate, before any step.
    expect(engine.crossSection).toHaveBeenCalledTimes(1);
    expect(engine.crossSection).toHaveBeenLastCalledWith(
      PARENT,
      expect.objectContaining({ n: [expect.closeTo(0), expect.closeTo(1)], d: expect.closeTo(0.5) }),
      'negative'
    );
    expect(seen?.seed).toBeNull();
    expect(seen?.step).toBeNull();
    expect(verbs.preview).not.toHaveBeenCalled();
    expect(analyse).not.toHaveBeenCalled();

    asked.resolve(SECTION);
    await render(FREE_LINE);
    // The top row's flap, Flap 1: what the step folds, what is previewed and analysed.
    expect(seen?.seed).toEqual({ scope: 'flaps', flaps: [FLAPS[0]] });
    expect(seen?.step?.op).toMatchObject({ kind: 'valley', seed: { scope: 'flaps', at: [FLAPS[0]!.witness] } });
    expect(seen?.step?.op).not.toHaveProperty('moving');
    expect(previewed()).toEqual([seen?.step?.op]);
    expect(analyse).toHaveBeenLastCalledWith(seen?.step?.op, undefined);
    // Shown from the line's own ask, whatever the analysis brings: never asked again.
    expect(seen?.section).toBe(SECTION);
    answer('analysed');
    await render(FREE_LINE);
    expect(engine.crossSection).toHaveBeenCalledTimes(1);
  });

  it('takes the same top flap for a mountain, the top as the front shows it, and for a precrease and a tuck', async () => {
    await render({ ...FREE_LINE, tool: 'mountain' });
    expect(seen?.step?.op).toMatchObject({ kind: 'mountain', seed: { scope: 'flaps', at: [FLAPS[0]!.witness] } });
    await render({ ...FREE_LINE, tool: 'precrease' });
    expect(seen?.step?.op).toMatchObject({ kind: 'precrease', seed: { scope: 'flaps', at: [FLAPS[0]!.witness] } });
  });

  it('folds every layer when the moving side is that one flap, as a fold always has', async () => {
    const one = { ...SECTION, flaps: [FLAPS[0]!], rows: [SECTION.rows[0]!] } as FoldCrossSection;
    engine.crossSection.mockImplementationOnce(async () => ({ status: 'ok', section: one }));
    await render(FREE_LINE);
    expect(seen?.seed).toEqual({ scope: 'all' });
    expect(seen?.step?.op).toMatchObject({ kind: 'valley', seed: { scope: 'all' }, moving: expect.any(Array) });
  });

  it('folds every layer when the engine refuses the section, so the fold is refused and worded as before', async () => {
    engine.crossSection.mockImplementationOnce(async () => ({
      status: 'refused',
      refusal: { code: 'near_miss' },
      fixes: [],
      faces: [],
      vertices: [],
    }) as never);
    await render(FREE_LINE);
    expect(seen?.section).toBeNull();
    expect(seen?.step?.op).toMatchObject({ seed: { scope: 'all' } });
  });

  it('keeps the folder’s own seed, and reads a widened one off the section asked once', async () => {
    await render({ ...FREE_LINE, seed: { scope: 'all' } });
    expect(seen?.step?.op).toMatchObject({ seed: { scope: 'all' } });
    await render({ ...FREE_LINE, seed: { scope: 'flaps', flaps: [FLAPS[1]!] } });
    expect(seen?.step?.op).toMatchObject({ seed: { scope: 'flaps', at: [FLAPS[1]!.witness] } });
    expect(engine.crossSection).toHaveBeenCalledTimes(1);
  });

  it('asks the section first for a reverse fold drawn as a free line: it takes every layer on the stretch drawn', async () => {
    // The line runs on past the stretch drawn, from (0, 0.5) to (0.5, 0.5), over a second flap.
    const beyond = { ...SECTION, rows: [SECTION.rows[0]!, { faces: [1], spans: [[0.6, 1]], flap: 1 }] } as FoldCrossSection;
    engine.crossSection.mockImplementationOnce(async () => ({ status: 'ok', section: beyond }));
    await render({ ...FREE_LINE, tool: 'inside-reverse', picks: [free(0, 0.5), free(0.5, 0.5)] });
    expect(engine.crossSection).toHaveBeenCalledTimes(1);
    expect(seen?.seed).toEqual({ scope: 'flaps', flaps: [FLAPS[0]] });
    expect(engine.compoundAnalysis).toHaveBeenLastCalledWith(
      PARENT,
      expect.objectContaining({ kind: 'inside-reverse', seed: { scope: 'flaps', at: [FLAPS[0]!.witness] } }),
      undefined
    );
  });

  it('takes every layer for a reverse fold whose stretch drawn crosses every flap', async () => {
    await render({ ...FREE_LINE, tool: 'inside-reverse' });
    expect(seen?.seed).toEqual({ scope: 'all' });
    expect(engine.compoundAnalysis).toHaveBeenLastCalledWith(
      PARENT,
      expect.objectContaining({ kind: 'inside-reverse', seed: { scope: 'all' } }),
      undefined
    );
  });
});

describe('the crimp and the tuck', () => {
  afterEach(() => {
    engine.compoundAnalysis.mockImplementation(tipCannotOpen);
  });

  const ORDER = (k: number) => ({ faces: [[0.1 * k, 0.1] as [number, number]], orders: [[0, 1, 1] as [number, number, 1]] });
  const target = (face: number, feasible: boolean | null) => ({ face, at: [face / 10, 0.2] as [number, number], feasible });
  /** A tuck's listing; `turnedOver`, as the engine answers a valley tuck on a view turned over: in the model frame. */
  const tuckListing =
    (targets: ReturnType<typeof target>[], turnedOver = false) =>
    async (): Promise<unknown> => ({
      status: 'ok',
      family: 'tuck',
      analysis: {
        line: { n: [0, 1], d: 0.5 },
        side: 'positive',
        snap: { clusters: 0, angle: 0, max_shift: 0 },
        direction: turnedOver ? 'mountain' : 'valley',
        placement: turnedOver ? 'over' : 'under',
        moving: [0],
        targets,
      },
    });
  const TUCK: FoldToolState = { ...FREE_LINE, tool: 'tuck' };

  it('builds a crimp once its tip, its kinds and its orders are in, the first order taken and the choice counted', async () => {
    engine.compoundAnalysis.mockImplementation(async () => ({
      status: 'ok',
      family: 'crimp',
      analysis: {
        tip: { line: { n: [0, 1], d: 0.5 }, side: 'positive', snap: {}, tip: [0, 1], flaps: [{ index: 0, flap: FLAPS[0], openings: [], truncated: false }] },
        second: { n: [0, 1], d: 0.8 },
        second_side: 'positive',
        second_snap: {},
        beyond: [0, 1],
      },
      kinds: ['inside', 'outside'],
    }));
    engine.orderSelection.mockImplementation(async () => ({ status: 'ok', count: { orders: 2, exact: true }, index: 0, completion: ORDER(1) } as never));
    engine.crimp.mockImplementationOnce(async () => ({
      status: 'ok',
      outcome: 'choose_order',
      orders: 2,
      exact: true,
      candidates: [
        { state: 50, stored: { completion: ORDER(1) } },
        { state: 51, stored: { completion: ORDER(2) } },
      ],
    }));
    const crimp: FoldToolState = { ...FREE_LINE, tool: 'crimp', picks: [...FREE_LINE.picks, free(0, 0.8), free(1, 0.8)] };
    await render(crimp);
    // Its orders asked of its own call with the kind taken, every state that call landed let go.
    expect(engine.crimp).toHaveBeenCalledWith(PARENT, expect.objectContaining({ kind: 'crimp', crimp: 'inside' }), undefined);
    expect(engine.release).toHaveBeenCalledWith([50, 51]);
    expect(seen?.crimp).toMatchObject({ kind: 'inside', kinds: ['inside', 'outside'], orders: [ORDER(1), ORDER(2)] });
    expect(seen?.step?.op).toMatchObject({ kind: 'crimp', crimp: 'inside', second: { via: 'free' } });
    expect(seen?.step?.choices).toEqual({ completion: ORDER(1) });
    expect(tracked.offered).toHaveBeenCalledWith('order', 2);
    // Both lines across the paper, for the folded pane.
    expect(seen?.crimp?.lines.second).not.toBeNull();

    // The outside kind chosen: its orders asked again, and the step folds it.
    engine.orderSelection.mockImplementation(async () => ({ status: 'ok', count: { orders: 1, exact: true }, index: 0, completion: null }));
    const outside = { ...crimp, compound: { ...crimp.compound, reverseKind: 'outside' as const } };
    await render(outside);
    expect(engine.crimp).toHaveBeenLastCalledWith(PARENT, expect.objectContaining({ crimp: 'outside' }), undefined);
    expect(seen?.step?.op).toMatchObject({ crimp: 'outside' });
    expect(seen?.step?.choices).toBeUndefined();
  });

  it('builds a tuck against the first layer listed as taking it, and steps to another by its face', async () => {
    engine.compoundAnalysis.mockImplementation(tuckListing([target(2, false), target(3, true), target(4, null)]));
    await render(TUCK);
    expect(engine.compoundAnalysis).toHaveBeenCalledWith(PARENT, expect.objectContaining({ kind: 'tuck' }), undefined);
    // Only the layers that take it, never the one that does not.
    expect(seen?.tuck?.targets.map((each) => each.face)).toEqual([3, 4]);
    expect(tracked.offered).toHaveBeenCalledWith('tuck_target', 2);
    expect(engine.tuck).toHaveBeenCalledWith(PARENT, expect.objectContaining({ target: [0.3, 0.2] }), undefined);
    expect(engine.release).toHaveBeenCalledWith([41]);
    expect(seen?.step?.op).toMatchObject({ kind: 'tuck', direction: 'valley', target: [0.3, 0.2] });
    expect(seen?.refused).toBeNull();

    await render({ ...TUCK, compound: { ...TUCK.compound, tuckTarget: 4 } });
    expect(seen?.tuck?.target?.face).toBe(4);
    expect(seen?.step?.op).toMatchObject({ target: [0.4, 0.2] });
  });

  it('refuses a tuck no layer takes, with no step, its layers asked of the plain fold along its line', async () => {
    engine.compoundAnalysis.mockImplementation(tuckListing([target(2, false)]));
    await render(TUCK);
    expect(seen?.step).toBeNull();
    expect(seen?.refused?.refusal).toEqual({ code: 'tuck_infeasible', target: null, placement: 'under', faces: [] });
    // No flap is offered before the layers are in.
    expect(seen?.refused?.fixes).toEqual([]);
    expect(engine.tuck).not.toHaveBeenCalled();
    expect(verbs.preview).not.toHaveBeenCalled();
    // The picker's layers: the plain valley fold along the same line, side and seed, asked for its analysis alone.
    expect(analyse).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'valley', line: expect.anything() }), undefined);
    answer('analysed');
    await render(TUCK);
    expect(seen?.section).toBe(SECTION);
    expect(seen?.analysis).not.toBeNull();
    expect(seen?.refused?.refusal.code).toBe('tuck_infeasible');
    // Its layers in, the plain fold's two flaps are offered one at a time, as the engine offers them when nothing stays.
    expect(seen?.refused?.fixes).toEqual([{ fix: 'pick_flap', flaps: FLAPS }]);
  });

  it('words a valley tuck on a view turned over as going under, though the engine places it over in its frame', async () => {
    const window = () =>
      foldToolWindow(
        i18n.t.bind(i18n),
        {
          tool: 'tuck',
          lineMode: 'free',
          readOnly: null,
          picks: 2,
          preview: { section: null, interval: null, seed: 'all', added: [], refused: seen?.refused ?? null, landing: false },
          tuck: foldTuckWindowView(TUCK, seen!),
        },
        {
          selectTool: vi.fn(),
          selectLineMode: vi.fn(),
          includeFlaps: vi.fn(),
          foldOtherWay: vi.fn(),
          pickFlap: vi.fn(),
          useLine: vi.fn(),
          swapSide: vi.fn(),
          toggleFlap: vi.fn(),
          cancel: vi.fn(),
          commit: vi.fn(),
          stepTuckTarget: vi.fn(),
        },
        { coarse: false, alt: 'Alt' }
      );
    engine.compoundAnalysis.mockImplementation(tuckListing([target(3, true), target(4, true)], true));
    await render(TUCK);
    expect(window()?.tuck?.target?.label).toBe('Tuck under');
    expect(window()?.tuck?.note).toBe('2 layers here take the tuck under them: the folded paper lights each.');

    // None takes it: refused here, under as the viewer sees it.
    engine.compoundAnalysis.mockImplementation(tuckListing([target(3, false)], true));
    await render({ ...TUCK, picks: [free(0, 0.4), free(1, 0.4)] });
    expect(seen?.refused?.refusal.code).toBe('tuck_infeasible');
    expect(window()?.refusal?.text).toBe(
      'No layer that stays can take the flap under it here. Fold it the other way, swap the moving side, or locate another line.'
    );
  });
});

describe('a vertex fold’s step', () => {
  const CANDIDATES: [number, number][] = [
    [1, 0],
    [-0.8824, -0.4706],
    [0.8824, -0.4706],
  ];
  /** The compound question of a rabbit ear: three candidates, the first not landing, no orders. */
  const fanAnswer = (op: { emergent: [number, number] }) => ({
    status: 'ok',
    family: 'vertex',
    analysis: {
      kind: 'rabbit-ear',
      center: [0.7, 0.7],
      given: [
        [-0.92, 0.38],
        [0.71, 0.71],
        [0.38, -0.92],
      ],
      candidates: [op.emergent, ...CANDIDATES.slice(1)],
      // The engine names the candidate nearest the ray asked for.
      emergent: 0,
      layers: [0],
    },
    emergents: [true, true, true],
    orders: null,
  });
  const EAR: FoldToolState = {
    ...FOLD_TOOL_INITIAL,
    tool: 'rabbit-ear',
    picks: [point(0, 1), point(1, 1), point(1, 0), free(0.3, 0.3)],
  };
  const RIDGES: [number, number][] = [
    [0, -1],
    [0.5, -0.5],
  ];
  /** The compound question of a swivel by its edge: its two ridges, as `emergents` says each lands. */
  const swivelAnswer = (op: { ridge?: [number, number] }, emergents: boolean[]) => ({
    status: 'ok',
    family: 'vertex',
    analysis: {
      kind: 'swivel-by-edge',
      pivot: [0.8, 0.3],
      vertex: [0.8, 0.33],
      meet: [0, 0],
      edge: [
        [0, 0],
        [1, 0],
      ],
      edge_faces: [0],
      foot: [0.8, 0],
      target: { n: [1, 0], d: 0 },
      rotation: 0.78,
      landed: [],
      creases: [],
      ridges: RIDGES,
      // The engine names the ridge nearest the one asked for: the foot's when none is.
      ridge: op.ridge ? 1 : 0,
      layers: [0],
      regions: [],
    },
    emergents,
    orders: null,
  });
  const edges = view.index!.folded.segments;
  const SWIVEL: FoldToolState = {
    ...FOLD_TOOL_INITIAL,
    tool: 'swivel',
    // The pivot, the bottom edge, the left edge it lands on.
    picks: [point(0.8, 0.3), edges.find((edge) => edge.edge === 0)!, edges.find((edge) => edge.edge === 3)!],
  };

  const reverseTip = engine.compoundAnalysis.getMockImplementation();
  const unpictured = engine.action.getMockImplementation();
  afterEach(() => {
    if (reverseTip) engine.compoundAnalysis.mockImplementation(reverseTip);
    if (unpictured) engine.action.mockImplementation(unpictured);
  });

  it('automatically changes the stationary anchor while keeping the selected hinge', async () => {
    let picked: string | null = null;
    engine.compoundAnalysis.mockImplementation((async (_at: unknown, op: { emergent: [number, number]; stayer: [number, number] }) => {
      const stayer = op.stayer.join();
      picked ??= stayer;
      // None lands with the paper picked; one does with other paper staying.
      return { ...fanAnswer(op), emergents: stayer === picked ? [false, true, true] : [true, false, false] };
    }) as never);
    await render(EAR);
    for (let k = 0; k < 3; k += 1) await render(EAR);
    expect(seen?.step).not.toBeNull();
    expect(seen?.refused).toBeNull();
    expect(seen?.vertex).toMatchObject({ emergent: 0, fourths: [0], elsewhere: null });
    expect(verbs.preview).toHaveBeenCalled();
    const rays = engine.compoundAnalysis.mock.calls.map(call => (call as unknown as [unknown, { emergent: number[] }])[1].emergent);
    expect(rays[1]).toEqual(rays[0]);
    // The fan, then another region as the paper that stays — the first that has one is enough.
    const stayers = engine.compoundAnalysis.mock.calls.map((call) => (call as unknown as [unknown, { stayer: number[] }])[1].stayer.join());
    expect(stayers).toHaveLength(2);
    expect(stayers[1]).not.toBe(stayers[0]);
    expect(tracked.refused).not.toHaveBeenCalled();
  });

  it('previews the selected hinge after one analysis when its first anchor works', async () => {
    engine.compoundAnalysis.mockImplementation((async (_at: unknown, op: { emergent: [number, number] }) =>
      fanAnswer(op)) as never);
    const PICTURE = {
      kind: 'fold',
      direction: 'valley',
      line: [
        { x: 0.5, y: 0.3 },
        { x: 0.5, y: 1 },
      ],
      spans: [],
      moving: [0],
      grip: null,
    };
    engine.action.mockImplementation((async () => ({ status: 'ok', action: PICTURE })) as never);
    await render(EAR);
    for (let k = 0; k < 3; k += 1) await render(EAR);
    expect(engine.compoundAnalysis).toHaveBeenCalledTimes(1);
    const asked = (engine.compoundAnalysis.mock.calls[0] as unknown as [unknown, { emergent: number[] }])[1].emergent;
    expect(seen?.step?.op).toMatchObject({ kind: 'rabbit-ear', emergent: asked, seed: { scope: 'all' } });
    expect(seen?.vertex).toMatchObject({ emergent: 0, fourths: [0], layers: 1, orders: [] });
    // Previewed through the session and pictured; a vertex fold has no line to analyse.
    expect(verbs.preview).toHaveBeenCalledWith(seen?.step?.op, undefined);
    expect(analyse).not.toHaveBeenCalled();
    expect(engine.action).toHaveBeenLastCalledWith(PARENT, seen?.step?.op, undefined);
    expect(seen?.action).toEqual(PICTURE);
    expect(tracked.offered).not.toHaveBeenCalled();
    expect(seen?.refused).toBeNull();
  });

  it('never substitutes a different hinge when both anchors reject the selected region', async () => {
    engine.compoundAnalysis.mockImplementation((async (_at: unknown, op: { emergent: [number, number] }) =>
      ({ ...fanAnswer(op), emergents: [false, true, true] })) as never);
    await render(EAR);
    for (let k = 0; k < 3; k += 1) await render(EAR);
    expect(engine.compoundAnalysis).toHaveBeenCalledTimes(2);
    expect(seen?.step).toBeNull();
    expect(seen?.vertex?.fourths).toEqual([]);
    expect(verbs.preview).not.toHaveBeenCalled();
  });

  it('asks a swivel by its edge, takes the foot’s ridge by storing none, and still folds its own when no ridge lands', async () => {
    let lands = [true, true];
    engine.compoundAnalysis.mockImplementation((async (_at: unknown, op: { ridge?: [number, number] }) =>
      swivelAnswer(op, lands)) as never);
    await render(SWIVEL);
    for (let k = 0; k < 3; k += 1) await render(SWIVEL);
    // Asked once: the foot's ridge is the one asked with.
    expect(engine.compoundAnalysis).toHaveBeenCalledTimes(1);
    expect((engine.compoundAnalysis.mock.calls[0] as unknown as [unknown, unknown] | undefined)?.[1]).toMatchObject({
      kind: 'swivel',
      via: 'edge',
      pivot: [0.8, 0.3],
      edge: [0.5, 0],
      target: { via: 'crease', at: [0, 0.5] },
      seed: { scope: 'all' },
    });
    expect(seen?.step?.op).not.toHaveProperty('ridge');
    expect(seen?.vertex).toMatchObject({ emergent: 0, fourths: [0, 1], layers: 0 });
    expect(tracked.offered).toHaveBeenCalledWith('ridge', 2);
    // The other ridge taken: stored as its direction, asked again.
    await render({ ...SWIVEL, compound: { ...SWIVEL.compound, emergent: 1 } });
    for (let k = 0; k < 3; k += 1) await render({ ...SWIVEL, compound: { ...SWIVEL.compound, emergent: 1 } });
    expect(seen?.step?.op).toMatchObject({ ridge: RIDGES[1] });
    // Neither lands: the step is the foot's, previewed, so the engine's refusal says why.
    lands = [false, false];
    const other = { ...SWIVEL, vertexDirection: 'mountain' as const };
    await render(other);
    for (let k = 0; k < 3; k += 1) await render(other);
    expect(seen?.vertex).toMatchObject({ emergent: 0, fourths: [] });
    expect(seen?.step?.op).toMatchObject({ kind: 'swivel', via: 'edge', direction: 'mountain' });
    expect(verbs.preview).toHaveBeenLastCalledWith(seen?.step?.op, undefined);
  });

  it('says why before the engine is asked: a click that names no paper', async () => {
    const off: FoldToolState = { ...FOLD_TOOL_INITIAL, tool: 'squash', picks: [free(1.5, 0.5)] };
    await render(off);
    expect(engine.compoundAnalysis).not.toHaveBeenCalled();
    expect(seen?.step).toBeNull();
    expect(seen?.refused).toMatchObject({ refusal: { code: 'point_off_paper' } });
    expect(tracked.refused).toHaveBeenCalledWith('point_off_paper');
  });

  it('counts a refusal with no step each time it is shown anew, and once while it stays', async () => {
    const squash: FoldToolState = { ...FOLD_TOOL_INITIAL, tool: 'squash', picks: [free(1.5, 0.5)] };
    await render(squash);
    await render({ ...squash, hoveredFlap: 1 });
    expect(tracked.refused).toHaveBeenCalledTimes(1);
    // Escape lets it go; the same click shows it again, and another click off the paper is another refusal.
    await render({ ...squash, picks: [] });
    await render(squash);
    expect(tracked.refused).toHaveBeenCalledTimes(2);
    await render({ ...squash, picks: [free(1.6, 0.5)] });
    expect(tracked.refused).toHaveBeenCalledTimes(3);
    expect(tracked.refused.mock.calls.every(([code]) => code === 'point_off_paper')).toBe(true);
  });
});

describe('Rotate’s turn', () => {
  const rotating = (rotation: FoldToolState['rotation']): FoldToolState => ({ ...FOLD_TOOL_INITIAL, tool: 'rotate', rotation });

  it('is previewed through the session from the moment Rotate is in hand, with nothing analysed or pictured', async () => {
    const thirty = { amount: 'degrees', degrees: 30, direction: 'cw' } as const;
    await render(rotating(thirty));
    const op = { kind: 'rotate', rotate: thirty };
    expect(seen?.step?.op).toEqual(op);
    expect(verbs.preview).toHaveBeenCalledWith(op, undefined);
    // A rotation moves no paper: no layers to find, no line or arrow to draw.
    expect(analyse).not.toHaveBeenCalled();
    expect(engine.action).not.toHaveBeenCalled();
    expect(seen?.landing).toBe(true);
    expect(seen?.turned).toBeNull();

    // Another amount is another turn, previewed in its place.
    await render(rotating({ amount: 'half', direction: 'ccw' }));
    expect(verbs.preview).toHaveBeenLastCalledWith({ kind: 'rotate', rotate: { amount: 'half', direction: 'ccw' } }, undefined);
  });

  it('shows the model turned on the folded pane once it lands, and leaves the crease pattern front up', async () => {
    const thirty = { amount: 'degrees', degrees: 30, direction: 'ccw' } as const;
    const op = { kind: 'rotate', rotate: thirty };
    pending = { status: 'landed', request: { op }, parent: PARENT, state: { generation: 1, id: 8 }, summary: { step: 1 } };
    await render(rotating(thirty));
    expect(seen?.landing).toBe(false);
    expect(seen?.turned).toBe(TURNED);
    // The crease pattern does not turn: no landed state for its pane.
    expect(seen?.landed).toBeNull();
  });
});

describe('a flap picked or unpicked on a fold already answered (owner report, 2026-10-21)', () => {
  /** The session's answer for the step the hook last asked to preview: landed, or refused as too close to a point. */
  function settle(outcome: 'landed' | 'refused'): void {
    const step = seen?.step;
    if (!step) throw new Error('no step');
    const request = step.choices ? { op: step.op, choices: step.choices } : { op: step.op };
    pending =
      outcome === 'landed'
        ? { status: 'landed', request, parent: PARENT, state: { generation: 1, id: 9 }, summary: { step: 20 } }
        : { status: 'refused', request, parent: PARENT, refused: { refusal: { code: 'near_miss' }, fixes: [] } };
  }

  /** The next layer orders the engine is asked for, answered when the test says. */
  function deferredOrders(): () => void {
    let answerIt: () => void = () => {};
    engine.orderSelection.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerIt = () => resolve({ status: 'ok', count: { orders: 1, exact: true }, index: 0, completion: null });
        })
    );
    return () => answerIt();
  }

  /** The window the shown preview draws: its layers and refusal, as the folder sees them. */
  const windowOf = (tools: FoldToolState) =>
    foldToolWindow(
      i18n.t.bind(i18n),
      {
        tool: 'valley',
        lineMode: 'free',
        readOnly: null,
        picks: 2,
        preview: foldWindowPreview(tools, foldShownPreview(seen!)),
      },
      {
        selectTool: vi.fn(),
        selectLineMode: vi.fn(),
        includeFlaps: vi.fn(),
        foldOtherWay: vi.fn(),
        pickFlap: vi.fn(),
        useLine: vi.fn(),
        swapSide: vi.fn(),
        toggleFlap: vi.fn(),
        cancel: vi.fn(),
        commit: vi.fn(),
      },
      { coarse: false, alt: 'Alt' }
    );

  const BOTH: FoldToolState = { ...FREE_LINE, seed: { scope: 'flaps', flaps: [FLAPS[0]!, FLAPS[1]!] } };

  it('keeps the last fold on show, and with the session, until the new seed’s lands', async () => {
    await render(FREE_LINE);
    answer('analysed');
    settle('landed');
    await render(FREE_LINE);
    const last = seen!;
    expect(last.landed).not.toBeNull();
    expect(last.held).toBeNull();

    // Flap 2 picked: its orders are asked, and not in yet. No step, but one coming.
    const orders = deferredOrders();
    await render(BOTH);
    expect(seen?.step).toBeNull();
    // The session keeps the last preview, for the strip and the panes, until the next supersedes it.
    expect(verbs.cancel).not.toHaveBeenCalled();
    const shown = foldShownPreview(seen!);
    expect(shown.landed).toBe(last.landed);
    expect(shown.analysis).toBe(last.analysis);
    expect(shown.section).toBe(SECTION);
    expect(shown.action).toBe(last.action);
    // Nothing to commit until it has its own answer.
    expect(shown.landing).toBe(true);
    // The chips say what was pressed at once; the layers stay where they were.
    expect(windowOf(BOTH)?.layers?.chips.map((chip) => chip.pressed)).toEqual([true, true]);
    expect(windowOf(BOTH)?.held).toBe(true);

    // Its orders in: the new step is previewed, and the last fold stands in while it lands.
    orders();
    await render(BOTH);
    expect(seen?.step?.op).toMatchObject({ seed: { scope: 'flaps', at: [FLAPS[0]!.witness, FLAPS[1]!.witness] } });
    expect(verbs.preview).toHaveBeenLastCalledWith(seen?.step?.op, seen?.step?.choices);
    expect(foldShownPreview(seen!).landed).toBe(last.landed);

    // Landed: its own fold, nothing held.
    settle('landed');
    await render(BOTH);
    expect(seen?.held).toBeNull();
    expect(seen?.landing).toBe(false);
    expect(foldShownPreview(seen!)).toBe(seen);
  });

  it('keeps a refusal in its place, dimmed, until the new seed’s answer replaces it', async () => {
    await render(FREE_LINE);
    answer('analysed');
    settle('refused');
    await render(FREE_LINE);
    expect(windowOf(FREE_LINE)?.refusal?.title).toBe('Too close to a point');

    const orders = deferredOrders();
    await render(BOTH);
    // Not this seed's refusal yet, so the commit waits for it (`queuedCommit`), but it keeps its slot in the window.
    expect(seen?.refused).toBeNull();
    const held = windowOf(BOTH);
    expect(held?.refusal?.title).toBe('Too close to a point');
    expect(held?.held).toBe(true);
    expect(held?.layers?.picker).not.toBeNull();
    expect(held?.footer?.commit.disabled).toBe(true);

    orders();
    await render(BOTH);
    settle('landed');
    await render(BOTH);
    expect(windowOf(BOTH)?.refusal).toBeNull();
    expect(windowOf(BOTH)?.held).toBeUndefined();
  });

  it('lets the last fold go when the line itself changes', async () => {
    await render(FREE_LINE);
    answer('analysed');
    settle('landed');
    await render(FREE_LINE);

    // Another line, its section still being asked: no step, and nothing of the last line's held.
    deferredSection();
    const other: FoldToolState = { ...FREE_LINE, picks: [free(0, 0.25), free(1, 0.25)] };
    await render(other);
    expect(seen?.step).toBeNull();
    expect(seen?.held).toBeNull();
    expect(verbs.cancel).toHaveBeenCalled();
  });
});
