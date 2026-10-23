import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoldSwivelEdgeAnalysis } from '../../engine/foldEngineSquashWire';
import type { FoldSessionSurface } from '../../session/useFoldSession';
import { FOLD_TOOL_INITIAL, type FoldToolState } from '../../tools/foldToolState';
import { swivelReachView, type FoldSwivelLanding, type FoldSwivelReachView } from '../../tools/vertex/swivelReach';
import { flatSquareLandmarks, flatSquareScene } from '../foldCanvas.fixtures';
import { foldPickIndex, type FoldHit, type FoldPick, type FoldSegmentPick } from '../foldPicking';
import type { FoldCanvasInks } from '../useFoldCanvasInks';
import { useFoldSwivelMarks, type FoldSwivelMarks } from './useFoldSwivelMarks';
import { useFoldSwivelReach } from './useFoldSwivelReach';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const index = foldPickIndex(flatSquareScene(), flatSquareLandmarks(), []);
const INK = [0.2, 0.5, 0.9, 1] as const;
const inks: FoldCanvasInks = { accent: [...INK], danger: [...INK], overlay: { accent: [...INK], mark: [...INK], outline: [...INK], selection: [...INK] }, ground: 'black' };

/** A swivel the engine described: its vertex, where its edge lands, a piece that turns. */
const analysis = (d: number): FoldSwivelEdgeAnalysis => ({
  pivot: [0.5, 0.5],
  vertex: [0.5, 0.5],
  meet: [0, 0],
  edge: [
    [0, 0],
    [0, 1],
  ],
  edge_faces: [0],
  foot: [0, 0.5],
  target: { n: [0, 1], d },
  rotation: 0.5,
  landed: [
    [
      [0, d],
      [1, d],
    ],
  ],
  creases: [{ ray: 'foot', direction: [-1, 0], from: [0.5, 0.5], to: [0, 0.5], letter: 'valley', ridge: false }],
  ridges: [[-1, 0]],
  ridge: 0,
  layers: [0],
  regions: [
    {
      wedge: 'turn',
      polygon: [
        [0, 0.5],
        [0.5, 0.5],
        [0, 1],
      ],
    },
  ],
});

const landing = (edge: number, target: number, d = 0.5): FoldSwivelLanding => ({
  edge,
  target,
  directions: [true, false],
  op: { kind: 'swivel', via: 'edge', pivot: [0.5, 0.5], edge: [0, 0.5], target: { via: 'crease', at: [0.5, d] }, seed: { scope: 'all' }, direction: 'valley' },
  answer: { analysis: { kind: 'swivel-by-edge', ...analysis(d) }, emergents: [true], orders: null },
});

const segment = (edge: number): FoldSegmentPick => index.creasePattern.segments.find((each) => each.edge === edge)!;
const meet: FoldPick = { kind: 'point', provenance: 'vertex', sheet: [1, 1], mark: null, scene: { x: 1, y: 1 } };
const hit = (pick: FoldPick | null): FoldHit => ({ pane: 'crease-pattern', at: { x: 0, y: 0 }, pick });

let host: HTMLDivElement;
let root: Root;
let seen: FoldSwivelMarks | null;

function Harness({ tools, reach }: { tools: Pick<FoldToolState, 'tool' | 'picks'>; reach: FoldSwivelReachView | null }) {
  const marks = useFoldSwivelMarks(index, tools, reach, inks);
  useEffect(() => {
    seen = marks;
  });
  return null;
}

const render = async (tools: Pick<FoldToolState, 'tool' | 'picks'>, reach: FoldSwivelReachView | null) => {
  await act(async () => root.render(<Harness tools={tools} reach={reach} />));
};
const hover = async (pick: FoldPick | null) => {
  await act(async () => seen?.onHover(hit(pick)));
};

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  seen = null;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('a swivel’s marks before its fold is previewed', () => {
  // The left edge (3) lands on the bottom edge (0) and on the top one (2): two lines, nothing implied.
  // The right edge (1) lands only on the bottom edge: its swivel is implied.
  const reach = swivelReachView({ landings: [landing(3, 0, 0), landing(3, 2, 1), landing(1, 0, 0)] });

  it('lights the edges that can swing on both panes, and previews one whose line is implied as the pointer crosses it', async () => {
    await render({ tool: 'swivel', picks: [meet] }, reach);
    expect(seen?.offered?.['crease-pattern'].map((line) => line.edge).sort()).toEqual([1, 3]);
    expect(seen?.offered?.folded.map((line) => line.edge).sort()).toEqual([1, 3]);
    // Two lines it may land on: the edge is lit brighter by the pane, but no swivel is drawn.
    await hover(segment(3));
    expect(seen?.hovered).toBeNull();
    expect(seen?.pending).toBeNull();
    // One line implied: the whole swivel, in the pens, its paper lit, its vertex and landing marked.
    await hover(segment(1));
    expect(seen?.hovered?.target).toBe(0);
    expect(seen?.pending?.folded).toEqual([{ line: [{ x: 0.5, y: 0.5 }, { x: 0, y: 0.5 }], letter: 'valley' }]);
    expect(seen?.tint?.count).toBe(3);
    expect(seen?.marks?.dots).toHaveLength(1);
    expect(seen?.marks?.strokes[0]).toMatchObject({ a: { x: 0, y: 0 }, b: { x: 1, y: 0 } });
    // A line not offered draws nothing.
    await hover(segment(0));
    expect(seen?.hovered).toBeNull();
  });

  it('lights the lines the edge picked lands on, and previews the swivel under the pointer', async () => {
    await render({ tool: 'swivel', picks: [meet, segment(3)] }, reach);
    expect(seen?.offered?.['crease-pattern'].map((line) => line.edge).sort()).toEqual([0, 2]);
    await hover(segment(2));
    expect(seen?.hovered).toMatchObject({ edge: 3, target: 2 });
    expect(seen?.marks?.strokes[0]).toMatchObject({ a: { x: 0, y: 1 }, b: { x: 1, y: 1 } });
    // Its fold previewed: the tool's own preview draws it, and nothing is offered.
    await render({ tool: 'swivel', picks: [meet, segment(3), segment(2)] }, reach);
    expect(seen?.offered).toBeNull();
    expect(seen?.pending).toBeNull();
    // Any other tool: nothing.
    await render({ ...FOLD_TOOL_INITIAL, tool: 'rabbit-ear', picks: [meet] }, reach);
    expect(seen?.offered).toBeNull();
  });
});

describe('a swivel’s reach', () => {
  it('is asked once for a meeting point on a state, the worker answering for every edge and line', async () => {
    const swivelReach = vi.fn(async () => ({ landings: [landing(1, 0, 0)] }));
    const session = {
      withCursor: vi.fn(async (call: (engine: unknown, at: number) => Promise<unknown>) => ({
        status: 'answered',
        value: await call({ swivelReach }, 7),
      })),
    } as unknown as FoldSessionSurface;
    let reach: FoldSwivelReachView | null = null;
    function Asker({ tools }: { tools: Pick<FoldToolState, 'tool' | 'swivelTarget' | 'picks' | 'vertexDirection'> }) {
      const answer = useFoldSwivelReach(session, '1:7', index, tools, true);
      useEffect(() => {
        reach = answer;
      });
      return null;
    }
    const tools = { tool: 'swivel' as const, swivelTarget: 'crease' as const, vertexDirection: 'valley' as const };
    await act(async () => root.render(<Asker tools={{ ...tools, picks: [] }} />));
    expect(reach).toBeNull();
    await act(async () => root.render(<Asker tools={{ ...tools, picks: [meet] }} />));
    for (let k = 0; k < 3; k += 1) await act(async () => {});
    expect(reach).toMatchObject({ status: 'ready' });
    expect([...(reach as FoldSwivelReachView | null)!.edges]).toEqual([1]);
    // The next clicks ask nothing again.
    await act(async () => root.render(<Asker tools={{ ...tools, picks: [meet, segment(1)] }} />));
    for (let k = 0; k < 3; k += 1) await act(async () => {});
    expect(swivelReach).toHaveBeenCalledTimes(1);
    const [state, ask] = swivelReach.mock.calls[0] as unknown as [number, { at: unknown; edges: unknown[]; targets: unknown[] }];
    expect(state).toBe(7);
    expect(ask.at).toEqual({ pivot: [1, 1] });
    // The square's four raw edges, each an edge and a line.
    expect(ask.edges).toHaveLength(4);
    expect(ask.targets).toHaveLength(4);
    // A target named by two points asks nothing: any line may be drawn.
    await act(async () => root.render(<Asker tools={{ ...tools, swivelTarget: 'points', picks: [meet] }} />));
    expect(reach).toBeNull();
  });
});
