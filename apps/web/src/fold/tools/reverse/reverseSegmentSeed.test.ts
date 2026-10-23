import { describe, expect, it } from 'vitest';
import type { FoldFreePick, FoldPointPick, FoldSegmentPick } from '../../canvas/foldPicking';
import type { FoldCrossSection, FoldCrossSectionRow } from '../../engine/foldEngineWire';
import { flapsAlong } from '../crossSection';
import { FOLD_TOOL_INITIAL } from '../foldToolState';
import { reverseDrawnSegment, reverseSegmentSeed } from './reverseSegmentSeed';

const row = (faces: number[], spans: [number, number][], flap: number): FoldCrossSectionRow => ({ faces, spans, flap });

/**
 * Three flaps along y = 0.5, measured from its right end: two layers from
 * 0.1 to 0.3 (flap 0), one from 0.3 to 0.4 (flap 1), two from 0.6 to 0.9
 * (flap 2) — a stretch of the line across the first passes none of the rest.
 */
const section: FoldCrossSection = {
  line: { n: [0, 1], d: 0.5 },
  side: 'positive',
  from: { x: 1, y: 0.5 },
  to: { x: 0, y: 0.5 },
  flaps: [
    { faces: [0, 1], witness: [0.8, 0.6] },
    { faces: [2], witness: [0.65, 0.6] },
    { faces: [3, 4], witness: [0.25, 0.6] },
  ],
  rows: [row([0], [[0.1, 0.3]], 0), row([1], [[0.1, 0.3]], 0), row([2], [[0.3, 0.4]], 1), row([3], [[0.6, 0.9]], 2), row([4], [[0.6, 0.9]], 2)],
  intervals: [],
  order: { kind: 'layered', unordered: [] },
  layers: 2,
  joins: [],
};

const free = (x: number, y: number): FoldFreePick => ({ kind: 'free', pane: 'folded', scene: { x, y }, sheet: [x, y] });
const point = (x: number, y: number): FoldPointPick => ({ kind: 'point', pane: 'folded', provenance: 'vertex', sheet: [x, y], mark: null, scene: { x, y } });
const tools = { ...FOLD_TOOL_INITIAL, tool: 'inside-reverse' as const, lineMode: 'free' as const, picks: [free(0.85, 0.5), free(0.75, 0.52)] };

describe('flapsAlong', () => {
  it('is every flap whose paper the stretch runs over, at any depth, in either direction', () => {
    expect(flapsAlong(section, { x: 0.85, y: 0.5 }, { x: 0.75, y: 0.5 })).toEqual([0]);
    expect(flapsAlong(section, { x: 0.75, y: 0.5 }, { x: 0.65, y: 0.5 })).toEqual([0, 1]);
    // Off the line, each end is taken square onto it.
    expect(flapsAlong(section, { x: 0.95, y: 0.2 }, { x: 0.05, y: 0.9 })).toEqual([0, 1, 2]);
  });

  it('leaves out a flap whose paper an end only touches', () => {
    // 0.3 from the start is where flap 0 ends and flap 1 begins.
    expect(flapsAlong(section, { x: 0.85, y: 0.5 }, { x: 0.7, y: 0.5 })).toEqual([0]);
    expect(flapsAlong(section, { x: 0.7, y: 0.5 }, { x: 0.65, y: 0.5 })).toEqual([1]);
    expect(flapsAlong(section, { x: 0.5, y: 0.5 }, { x: 0.45, y: 0.5 })).toEqual([]);
  });
});

describe('reverseSegmentSeed', () => {
  it('seeds the flaps the drawn stretch crosses; every layer when that is all of them, or none', () => {
    expect(reverseSegmentSeed(section, [{ x: 0.85, y: 0.5 }, { x: 0.75, y: 0.5 }])).toEqual({ scope: 'flaps', flaps: [section.flaps[0]] });
    expect(reverseSegmentSeed(section, [{ x: 1, y: 0.5 }, { x: 0, y: 0.5 }])).toEqual({ scope: 'all' });
    expect(reverseSegmentSeed(section, [{ x: 0.5, y: 0.5 }, { x: 0.45, y: 0.5 }])).toEqual({ scope: 'all' });
  });
});

describe('reverseDrawnSegment', () => {
  it('is the two picks of a reverse fold drawn as a free line or by Axiom 1, where the folded pane shows them', () => {
    expect(reverseDrawnSegment(tools)).toEqual([{ x: 0.85, y: 0.5 }, { x: 0.75, y: 0.52 }]);
    expect(reverseDrawnSegment({ ...tools, lineMode: 'axiom-1', picks: [point(0.85, 0.5), point(0.75, 0.5)] })).toEqual([
      { x: 0.85, y: 0.5 },
      { x: 0.75, y: 0.5 },
    ]);
  });

  it('is null for a constructed line, another tool, a fix’s line, and until both ends are in', () => {
    expect(reverseDrawnSegment({ ...tools, lineMode: 'axiom-2' })).toBeNull();
    const crease: FoldSegmentPick = { kind: 'segment', edge: 1, segment: 'bend', sheet: [[0, 0], [1, 1]], scene: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };
    expect(reverseDrawnSegment({ ...tools, lineMode: 'crease', picks: [crease] })).toBeNull();
    expect(reverseDrawnSegment({ ...tools, tool: 'crimp' })).toBeNull();
    expect(reverseDrawnSegment({ ...tools, picks: tools.picks.slice(0, 1) })).toBeNull();
    expect(reverseDrawnSegment({ ...tools, lineMode: 'axiom-1', picks: [point(0.85, 0.5), { ...point(0.75, 0.5), scene: null }] })).toBeNull();
    expect(
      reverseDrawnSegment({ ...tools, override: { op: { kind: 'inside-reverse', line: { via: 'free', through: [[0, 0], [1, 0]] }, seed: { scope: 'all' } } } })
    ).toBeNull();
  });
});
