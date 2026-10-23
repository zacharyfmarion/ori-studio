import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FoldVertexAnalysis } from '../../engine/foldEngineSquashWire';
import type { FoldStateSummary } from '../../engine/foldEngineWire';
import { FOLD_TOOL_INITIAL, type FoldToolState } from '../../tools/foldToolState';
import { flatSquareScene } from '../foldCanvas.fixtures';
import { foldPaneOverlay, type FoldOverlayInks } from '../foldPaneOverlays';
import { foldPickIndex, type FoldHit, type FoldPick } from '../foldPicking';
import { FOLD_PANE_DISPLAY_DEFAULT } from '../foldPaneScenes';
import { useFoldCanvasPaint, type FoldCanvasPaint } from '../useFoldCanvasPaint';
import type { FoldStateView } from '../useFoldStateView';
import type { FoldToolPreview } from '../useFoldToolPreview';
import { useFoldFanMarks, type FoldFanMarks } from './useFoldFanMarks';
import type { FoldVertexPreview } from './useFoldVertexStep';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const scene = flatSquareScene();
const index = foldPickIndex(scene, null, []);
const summary = { step: 1, sheet: [[0, 0], [1, 0], [1, 1], [0, 1]] } as unknown as FoldStateSummary;
const view = { cursorId: 'fstep-1', summary, scene, index, landmarks: null, marks: [], markPoints: [] } as unknown as FoldStateView;

const NO_PREVIEW = {
  candidates: null,
  build: { status: 'unlocated' },
  step: null,
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
} as FoldToolPreview;

const corner = (x: number, y: number): FoldPick => ({ kind: 'point', provenance: 'vertex', sheet: [x, y], mark: null, scene: { x, y } });
const free = (x: number, y: number, pane: 'folded' | 'crease-pattern' = 'folded'): FoldPick => ({
  kind: 'free',
  pane,
  scene: { x, y },
  sheet: [x, y],
});
const CORNERS = [corner(0, 1), corner(1, 1), corner(1, 0)];

let host: HTMLDivElement;
let root: Root;
let seen: { fan: FoldFanMarks | null; paint: FoldCanvasPaint } | null;

function Harness({ tools, preview = NO_PREVIEW }: { tools: FoldToolState; preview?: FoldToolPreview }) {
  const fan = useFoldFanMarks(index, tools);
  const paint = useFoldCanvasPaint(view, preview, FOLD_PANE_DISPLAY_DEFAULT, null, null, null, fan?.pending ?? null);
  useEffect(() => {
    seen = { fan, paint };
  });
  return null;
}

const render = (tools: FoldToolState, preview?: FoldToolPreview) =>
  act(() => root.render(<Harness tools={tools} preview={preview} />));

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

const ear = (picks: readonly FoldPick[], extra: Partial<FoldToolState> = {}): FoldToolState => ({
  ...FOLD_TOOL_INITIAL,
  tool: 'rabbit-ear',
  picks,
  ...extra,
});

const diagramLines = (paint: FoldCanvasPaint) =>
  (paint.folded.scene?.items ?? []).flatMap((item) => (item.kind === 'line' && item.role.startsWith('diagram') ? [item.role] : []));

describe('a rabbit ear’s marks from its clicks', () => {
  it('draws nothing before the third corner, then the three creases to the corners, pending, on both panes', () => {
    render(ear(CORNERS.slice(0, 2)));
    expect(seen?.fan).toBeNull();
    expect(diagramLines(seen!.paint)).toEqual([]);
    expect(seen?.paint.creasePattern.lines?.instruction).toEqual([]);

    render(ear(CORNERS));
    // In the paper's diagram pen of the way they fold — a valley ear's are valley.
    expect(diagramLines(seen!.paint)).toEqual(['diagram-valley', 'diagram-valley', 'diagram-valley']);
    const instruction = seen?.paint.creasePattern.lines?.instruction ?? [];
    expect(instruction).toHaveLength(3);
    expect(instruction.every((line) => line.letter === 'valley')).toBe(true);
    // Each from the incenter to a corner.
    const ends = instruction.map((line) => `${line.b.x.toFixed(6)},${line.b.y.toFixed(6)}`).sort();
    expect(ends).toEqual(['0.000000,1.000000', '1.000000,0.000000', '1.000000,1.000000']);

    // A mountain ear's, in the other pen.
    render(ear(CORNERS, { vertexDirection: 'mountain' }));
    expect(diagramLines(seen!.paint)).toEqual(['diagram-mountain', 'diagram-mountain', 'diagram-mountain']);
    expect(seen?.paint.creasePattern.lines?.instruction.every((line) => line.letter === 'mountain')).toBe(true);
  });

  it('leaves the crease pattern to the landed fold once it has landed', () => {
    const landed = { ...NO_PREVIEW, landed: { scene, summary, added: new Set<number>() } } as FoldToolPreview;
    render(ear([...CORNERS, free(0.3, 0.3)]), landed);
    expect(seen?.paint.creasePattern.lines?.instruction).toEqual([]);
    // The folded pane keeps them: the paper is drawn with them until the fold is committed.
    expect(diagramLines(seen!.paint)).toHaveLength(3);
  });

  it('hands the folded pane from the pending creases to the engine’s, the fourth taken among them, once it describes the fan', () => {
    const r = 1 - Math.SQRT1_2;
    const center: [number, number] = [1 - r, 1 - r];
    const toward = ([x, y]: [number, number]): [number, number] => {
      const length = Math.hypot(x - center[0], y - center[1]);
      return [(x - center[0]) / length, (y - center[1]) / length];
    };
    const analysis: FoldVertexAnalysis = {
      kind: 'rabbit-ear',
      center,
      given: [toward([0, 1]), toward([1, 1]), toward([1, 0])],
      candidates: [[-Math.SQRT1_2, -Math.SQRT1_2]],
      emergent: 0,
      layers: [0],
    };
    const vertex = {
      base: { analysis, emergents: [true], orders: null },
      answer: null,
      emergent: 0,
      fourths: [0],
      elsewhere: null,
      direction: 'valley',
      orders: [],
      order: null,
      layers: 1,
    } satisfies FoldVertexPreview;
    // The paper that stays picked; the engine's answer on its way: the pending three.
    render(ear([...CORNERS, free(0.3, 0.3)]), { ...NO_PREVIEW, vertex: { ...vertex, base: null, emergent: null, fourths: [] } });
    expect(diagramLines(seen!.paint)).toEqual(['diagram-valley', 'diagram-valley', 'diagram-valley']);
    // Described: its three given creases the direction's way and the fourth taken the other — each once.
    render(ear([...CORNERS, free(0.3, 0.3)]), { ...NO_PREVIEW, vertex });
    expect(diagramLines(seen!.paint)).toEqual(['diagram-valley', 'diagram-valley', 'diagram-valley', 'diagram-mountain']);
  });

  it('lights the region under the pointer while the paper that stays is picked, and the one picked after', () => {
    render(ear(CORNERS));
    const regions = seen?.fan?.regions;
    if (!regions) throw new Error('no regions');
    const inks: FoldOverlayInks = { accent: [0, 0, 1, 1], mark: [0, 0, 0, 1], outline: [1, 1, 1, 1], selection: [1, 0.8, 0.4, 1] };
    const hit = (pick: FoldPick | null, pane: 'folded' | 'crease-pattern' = 'folded'): FoldHit => ({ pane, at: { x: 0, y: 0 }, pick });
    const overlay = (pane: 'folded' | 'crease-pattern', hovered: FoldHit | null) =>
      foldPaneOverlay({ pane, scene, picks: [], hovered, freeFrom: null, marks: [], inks, regions: regions[pane] });
    // Nothing picked, nothing under the pointer: nothing lit.
    expect(regions.folded.picked).toBeNull();
    expect(overlay('folded', null).fills).toBeNull();
    // Over the lower-left half: its region, the triangle's diagonal side with it, lit on that pane.
    expect(regions.folded.at(hit(free(0.3, 0.3)))).toBe(1);
    const lit = overlay('folded', hit(free(0.3, 0.3)))?.fills;
    expect(lit?.count).toBeGreaterThan(0);
    expect(lit?.color[3]).toBeCloseTo(0.26, 6);
    // Off the paper: no region.
    expect(regions.folded.at(hit({ kind: 'free', pane: 'folded', scene: { x: 2, y: 2 }, sheet: null }))).toBeNull();
    // On the crease pattern too.
    expect(regions['crease-pattern'].at(hit(free(0.9, 0.6, 'crease-pattern'), 'crease-pattern'))).toBe(2);

    // Picked: lit brighter, and another under the pointer lit as well.
    render(ear([...CORNERS, free(0.3, 0.3)]));
    const picked = seen?.fan?.regions;
    expect(picked?.folded.picked).toBe(1);
    expect(picked?.['crease-pattern'].picked).toBe(1);
    const both = foldPaneOverlay({
      pane: 'folded',
      scene,
      picks: [],
      hovered: hit(free(0.72, 0.9)),
      freeFrom: null,
      marks: [],
      inks,
      regions: picked?.folded,
    }).fills;
    const alphas = new Set<number>();
    for (let k = 3; k < (both?.color.length ?? 0); k += 4) alphas.add(Number(both!.color[k]!.toFixed(2)));
    expect([...alphas].sort()).toEqual([0.26, 0.42]);
  });

  it('draws no regions for a tool that picks no paper to stay', () => {
    render({ ...FOLD_TOOL_INITIAL, tool: 'squash', picks: [free(0.3, 0.3)] });
    expect(seen?.fan).toBeNull();
  });
});
