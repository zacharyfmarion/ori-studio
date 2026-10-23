import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoldPetalAnalysis } from '../../engine/foldEngineSquashWire';
import type { FoldSessionSurface } from '../../session/useFoldSession';
import { FOLD_TOOL_INITIAL, type FoldToolState } from '../../tools/foldToolState';
import { flatSquareLandmarks, flatSquareScene } from '../foldCanvas.fixtures';
import { foldPickIndex, type FoldHit, type FoldPick } from '../foldPicking';
import { useFoldPetalMarks, type FoldPetalMarks } from './useFoldPetalMarks';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const index = foldPickIndex(flatSquareScene(), flatSquareLandmarks(), []);

/** The flap below a hinge across the square at y = ½: the kite down to a corner at its middle. */
const FLAP: FoldPetalAnalysis = {
  line: { n: [0, 1], d: 0.5 },
  ends: [
    [0.2, 0.5],
    [0.8, 0.5],
  ],
  corner: [0.5, 0.1],
  kites: [
    { n: [0.8, -0.6], d: -0.14 },
    { n: [0.8, 0.6], d: 0.94 },
  ],
  top: [0],
  second: [],
  scores_line: true,
  scores_kites: [true, true],
};

const engine = {
  // Below the hinge, a flap; above it, none.
  compoundAnalysis: vi.fn(async (_at: unknown, op: { petal: [number, number] }): Promise<unknown> =>
    op.petal[1] < 0.5
      ? { status: 'ok', family: 'vertex', analysis: { kind: 'petal', ...FLAP }, emergents: [], orders: null }
      : { status: 'refused', refusal: { code: 'petal_no_flap', faces: [0], cause: 'no_corner' }, fixes: [] }
  ),
};
const session = {
  cursor: { state: { generation: 1, id: 7 } },
  withCursor: vi.fn(async (call: (e: unknown, at: unknown) => Promise<unknown>) => ({
    status: 'answered',
    value: await call(engine, { generation: 1, id: 7 }),
  })),
} as unknown as FoldSessionSurface;

const point = (x: number, y: number): FoldPick => ({ kind: 'point', provenance: 'free', sheet: [x, y], mark: null, scene: { x, y } });
const free = (x: number, y: number): FoldPick => ({ kind: 'free', pane: 'folded', scene: { x, y }, sheet: [x, y] });
const hit = (pick: FoldPick): FoldHit => ({ pane: 'folded', at: pick.kind === 'segment' ? pick.scene[0] : pick.scene ?? { x: 0, y: 0 }, pick });

let host: HTMLDivElement;
let root: Root;
let seen: FoldPetalMarks | null;

function Harness({ tools }: { tools: FoldToolState }) {
  const marks = useFoldPetalMarks(session, index, tools);
  useEffect(() => {
    seen = marks;
  });
  return null;
}

const render = async (tools: FoldToolState) => {
  await act(async () => root.render(<Harness tools={tools} />));
  for (let k = 0; k < 3; k += 1) await act(async () => {});
};
const hover = async (pick: FoldPick | null) => {
  await act(async () => seen?.onHover(pick ? hit(pick) : null));
  for (let k = 0; k < 3; k += 1) await act(async () => {});
};

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  seen = null;
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const petal = (picks: readonly FoldPick[]): FoldToolState => ({ ...FOLD_TOOL_INITIAL, tool: 'petal', petalHinge: 'points', picks });

describe('a petal fold’s marks', () => {
  it('draws the hinge in its pen as its ends are clicked: to the point under the pointer, then between both', async () => {
    await render(petal([point(0.2, 0.5)]));
    expect(seen?.regions).toBeNull();
    await hover(point(0.8, 0.5));
    expect(seen?.pending?.folded).toEqual([{ line: [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }], letter: 'valley' }]);
    await render(petal([point(0.2, 0.5), point(0.8, 0.5)]));
    await hover(null);
    expect(seen?.pending?.folded).toEqual([{ line: [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }], letter: 'valley' }]);
    // Any other tool: nothing.
    await render({ ...FOLD_TOOL_INITIAL, tool: 'rabbit-ear', picks: [point(0, 1)] });
    expect(seen?.regions).toBeNull();
    expect(seen?.pending).toBeNull();
  });

  it('asks the engine about the flap under the pointer once, lights it with its creases in their pens, and lights nothing where none lifts', async () => {
    await render(petal([point(0.2, 0.5), point(0.8, 0.5)]));
    expect(seen?.regions?.folded.polygons).toEqual([]);
    await hover(free(0.5, 0.3));
    expect(engine.compoundAnalysis).toHaveBeenCalledTimes(1);
    expect(engine.compoundAnalysis.mock.calls[0]?.[1]).toMatchObject({
      kind: 'petal',
      ends: [
        [0.2, 0.5],
        [0.8, 0.5],
      ],
      petal: [0.5, 0.3],
    });
    const regions = seen?.regions;
    if (!regions) throw new Error('no regions');
    expect(regions.folded.polygons).toHaveLength(1);
    expect(regions.folded.at(hit(free(0.45, 0.2)))).toBe(0);
    // The flap on the sheet too: the kite, on the one face.
    expect(regions['crease-pattern'].polygons[0]?.length).toBeGreaterThan(0);
    // The hinge the direction's way, the kite creases the other.
    expect(seen?.pending?.folded.map((crease) => crease.letter)).toEqual(['valley', 'mountain', 'mountain']);
    expect(seen?.hovered?.corner).toEqual([0.5, 0.1]);
    // Elsewhere below the hinge, the same flap: asked nothing more.
    await hover(free(0.3, 0.2));
    expect(engine.compoundAnalysis).toHaveBeenCalledTimes(1);
    // Above it, the engine names none: nothing lit, and the hinge alone pending.
    await hover(free(0.5, 0.8));
    expect(engine.compoundAnalysis).toHaveBeenCalledTimes(2);
    expect(seen?.regions?.folded.at(hit(free(0.5, 0.8)))).toBeNull();
    expect(seen?.pending?.folded).toHaveLength(1);
  });

  it('lights the flap picked while it is previewed, its creases the preview’s own', async () => {
    await render(petal([point(0.2, 0.5), point(0.8, 0.5), free(0.5, 0.3)]));
    expect(engine.compoundAnalysis).toHaveBeenCalledTimes(1);
    expect(seen?.regions?.folded.picked).toBe(0);
    expect(seen?.pending).toBeNull();
  });
});
