import { describe, expect, it } from 'vitest';
import { bookScene } from '../canvas/foldCanvas.fixtures';
import { foldPickIndex, type FoldPick, type FoldSegmentPick } from '../canvas/foldPicking';
import type { RepeatSymmetry } from './repeatGeometry';
import { drawnRepeatAxis, nearestRepeatAxis, repeatAxisAlong, repeatDrawnLines, repeatHit, sheetLineUnder } from './repeatDrawn';

const vertical: RepeatSymmetry = { sheet: { n: [1, 0], d: 0.5 }, side: 'same' };
const horizontal: RepeatSymmetry = { sheet: { n: [0, 1], d: 0.5 }, side: 'behind' };
const AXES = [vertical, horizontal];

const free = (pane: 'folded' | 'crease-pattern', x: number, y: number, sheet: [number, number] | null = null): FoldPick => ({
  kind: 'free',
  pane,
  scene: { x, y },
  sheet,
});

const crease = (pane: 'folded' | 'crease-pattern', sheet: [[number, number], [number, number]]): FoldSegmentPick => ({
  kind: 'segment',
  pane,
  edge: 9,
  segment: 'crease',
  sheet,
  scene: [
    { x: sheet[0][0], y: sheet[0][1] },
    { x: sheet[1][0], y: sheet[1][1] },
  ],
});

describe('an axis drawn for Repeat', () => {
  // The book: its right half folded over its left, mirrored, on top.
  const index = foldPickIndex(bookScene(), null, []);

  it('is the sheet line drawn on the crease pattern, and on the folded pane the line on the top layer under it', () => {
    const onSheet = repeatDrawnLines('free', [free('crease-pattern', 9, 9, [0.5, 0]), free('crease-pattern', 9, 9, [0.5, 1])], index, null);
    expect(onSheet?.[0]?.pane).toBe('crease-pattern');
    expect(drawnRepeatAxis(AXES, onSheet!)).toBe(0);
    // Drawn on the folded pane at x = 0.4: on the right half on top, mirrored, the sheet's x = 0.6.
    const onFolded = repeatDrawnLines('free', [free('folded', 0.4, 0.1), free('folded', 0.4, 0.9)], index, null)!;
    expect(onFolded[0]?.pane).toBe('folded');
    expect(Math.abs(onFolded[0]!.sheet.n[0] * 0.6 - onFolded[0]!.sheet.d)).toBeLessThan(1e-12);
    expect(drawnRepeatAxis(AXES, onFolded)).toBe(-1);
    // One end only: no line yet.
    expect(repeatDrawnLines('free', [free('folded', 0.4, 0.1)], index, null)).toBeNull();
  });

  it('is a crease’s own sheet line, picked on either pane', () => {
    const along = crease('folded', [
      [0.5, 0],
      [0.5, 1],
    ]);
    expect(drawnRepeatAxis(AXES, repeatDrawnLines('crease', [along], index, null)!)).toBe(0);
    expect(repeatAxisAlong(AXES, along)).toBe(0);
    expect(repeatAxisAlong(AXES, crease('crease-pattern', [[0, 0], [1, 1]]))).toBe(-1);
  });

  it('reads an axiom’s roots on the flat sheet when picked on the crease pattern, and waits for them', () => {
    const corners: FoldPick[] = [
      { kind: 'point', pane: 'crease-pattern', provenance: 'vertex', sheet: [0, 0.5], mark: null, scene: null },
      { kind: 'point', pane: 'crease-pattern', provenance: 'vertex', sheet: [1, 0.5], mark: null, scene: null },
    ];
    expect(repeatDrawnLines('axiom-1', corners, index, null)).toBeNull();
    const roots = { lines: [{ n: [0, 1] as const, d: 0.5 }], sheetOfModel: [1, 0, 0, 0, 1, 0] as const };
    const drawn = repeatDrawnLines('axiom-1', corners, index, { lines: roots.lines, sheetOfModel: [...roots.sheetOfModel] })!;
    expect(drawnRepeatAxis(AXES, drawn)).toBe(1);
  });

  it('takes the top layer under a line of the folded pane, where it crosses the paper nearest the point given', () => {
    const line = sheetLineUnder(index, { n: [0, 1], d: 0.3 }, { x: 0.25, y: 0.3 })!;
    expect(Math.abs(line.n[1]) * 0.3).toBeCloseTo(Math.abs(line.d), 12);
    expect(sheetLineUnder(index, { n: [1, 0], d: 3 }, { x: 3, y: 0 })).toBeNull();
  });

  it('is refused when it is no axis, the nearest offered only when it is near', () => {
    const near = [{ sheet: { n: [1, 0] as const, d: 0.51 } }];
    expect(drawnRepeatAxis(AXES, near)).toBe(-1);
    expect(nearestRepeatAxis(AXES, near, Math.SQRT2)).toBe(0);
    const far = [{ sheet: { n: [Math.SQRT1_2, Math.SQRT1_2] as const, d: 0 } }];
    expect(nearestRepeatAxis(AXES, far, Math.SQRT2)).toBe(-1);
  });
});

describe('what a click does with Repeat in hand', () => {
  const index = foldPickIndex(bookScene(), null, []);
  const radii = { point: 0.02, line: 0.02 };
  const tools = { lineMode: 'free' as const, picks: [] as FoldPick[], freeLineSnap: false };
  const repeat = (axisAt: number) => ({ view: { drawing: true, axes: AXES }, axisAt: () => axisAt });

  it('takes an axis drawn under the pointer, and otherwise starts a line', () => {
    expect(repeatHit(index, 'crease-pattern', { x: 0.5, y: 0.3 }, radii, tools, repeat(0), false)).toMatchObject({ pick: null, repeatAxis: 0 });
    const started = repeatHit(index, 'crease-pattern', { x: 0.2, y: 0.3 }, radii, tools, repeat(-1), false);
    expect(started.pick?.kind).toBe('free');
    expect(started.repeatAxis).toBeUndefined();
  });

  it('takes the line mode’s pick alone once a line is under way, and nothing while no axis may be taken', () => {
    const under = { ...tools, picks: [free('crease-pattern', 0.1, 0.1, [0.1, 0.1])] };
    const second = repeatHit(index, 'crease-pattern', { x: 0.5, y: 0.3 }, radii, under, repeat(0), false);
    expect(second.pick?.kind).toBe('free');
    expect(second.repeatAxis).toBeUndefined();
    const idle = { view: { drawing: false, axes: AXES }, axisAt: () => 0 };
    expect(repeatHit(index, 'crease-pattern', { x: 0.5, y: 0.3 }, radii, tools, idle, false)).toEqual({ pane: 'crease-pattern', at: { x: 0.5, y: 0.3 }, pick: null });
  });
});
