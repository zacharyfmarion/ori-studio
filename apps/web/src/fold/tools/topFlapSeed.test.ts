import { describe, expect, it } from 'vitest';
import { flatSquareLandmarks, flatSquareScene } from '../canvas/foldCanvas.fixtures';
import { foldPickIndex, type FoldPick } from '../canvas/foldPicking';
import type { FoldCrossSection, FoldCrossSectionRow, FoldFlap } from '../engine/foldEngineWire';
import type { FoldToolId } from './foldToolCatalog';
import { FOLD_TOOL_INITIAL, type FoldToolSeed } from './foldToolState';
import { lineSectionProbe, lineSideKeyOf, seedForTool, takesTopFlap, topFlapSeed } from './topFlapSeed';

const row = (faces: number[], flap: number): FoldCrossSectionRow => ({ faces, spans: [[0, 1]], flap });
const flapA: FoldFlap = { faces: [2, 3], witness: [0.2, 0.7] };
const flapB: FoldFlap = { faces: [0, 1], witness: [0.2, 0.2] };

/** Two flaps at the line, the engine's second on top as the front shows it. */
const twoFlaps = {
  line: { n: [0, 1], d: 0.5 },
  side: 'positive',
  from: { x: 0, y: 0.5 },
  to: { x: 1, y: 0.5 },
  flaps: [flapA, flapB],
  rows: [row([1], 1), row([0], 1), row([3], 0), row([2], 0)],
  intervals: [{ start: 0, end: 1, faces: [1, 0, 3, 2], rows: [0, 1, 2, 3] }],
  order: { kind: 'layered', unordered: [] },
  layers: 4,
  joins: [],
} as unknown as FoldCrossSection;

const TOP: FoldToolSeed = { scope: 'top' };

describe('the top flap a fold takes by default (owner request, 2026-10-13)', () => {
  it('is the default of the folds that fold one flap over; a fold of a whole point takes every layer', () => {
    const takesTop: FoldToolId[] = ['valley', 'mountain', 'precrease', 'tuck'];
    const takesAll: FoldToolId[] = ['inside-reverse', 'crimp', 'open-sink', 'closed-sink', 'unsink'];
    for (const tool of takesTop) {
      expect(takesTopFlap(tool)).toBe(true);
      expect(seedForTool(tool, TOP)).toEqual(TOP);
    }
    for (const tool of takesAll) {
      expect(takesTopFlap(tool)).toBe(false);
      expect(seedForTool(tool, TOP)).toEqual({ scope: 'all' });
    }
    // A seed the folder chose is theirs, whatever the tool.
    const picked: FoldToolSeed = { scope: 'flaps', flaps: [flapA] };
    expect(seedForTool('inside-reverse', picked)).toBe(picked);
    expect(seedForTool('valley', { scope: 'all' })).toEqual({ scope: 'all' });
    expect(['squash', 'rotate', 'divide-line'].some((tool) => takesTopFlap(tool as FoldToolId))).toBe(false);
  });

  it('is the flap of the section’s top row, named by the engine’s flap: the same for a mountain, the top as the front shows it', () => {
    expect(topFlapSeed(twoFlaps)).toEqual({ scope: 'flaps', flaps: [flapB] });
    const flipped = { ...twoFlaps, rows: [row([3], 0), row([2], 0), row([1], 1), row([0], 1)] };
    expect(topFlapSeed(flipped)).toEqual({ scope: 'flaps', flaps: [flapA] });
  });

  it('is every layer when the moving side is that one flap, or the section names none: the fold reads as it always did', () => {
    const one = { ...twoFlaps, flaps: [flapA], rows: [row([3], 0), row([2], 0)] } as FoldCrossSection;
    expect(topFlapSeed(one)).toEqual({ scope: 'all' });
    expect(topFlapSeed({ ...twoFlaps, rows: [] })).toEqual({ scope: 'all' });
  });
});

describe('lineSectionProbe', () => {
  const index = foldPickIndex(flatSquareScene(), flatSquareLandmarks(), []);
  const free = (x: number, y: number): FoldPick => ({ kind: 'free', pane: 'folded', scene: { x, y }, sheet: [x, y] });
  const located = { ...FOLD_TOOL_INITIAL, lineMode: 'free' as const, picks: [free(0, 0.5), free(1, 0.5)] };

  it('asks the section of the line and side the picks locate, in the model frame, before any step', () => {
    const probe = lineSectionProbe(located, index, null);
    expect(probe).not.toBeNull();
    // An even split moves the right of the line as drawn: below it, against the normal.
    expect(probe!.side).toBe('negative');
    expect(probe!.line.n[0]).toBeCloseTo(0);
    expect(Math.abs(probe!.line.n[1])).toBeCloseTo(1);
    expect(probe!.line.d * probe!.line.n[1]).toBeCloseTo(0.5);
    expect(probe!.key).toBe(lineSideKeyOf(probe!.line, -1));
    // Swapped, the other side: another section.
    const swapped = lineSectionProbe({ ...located, swapped: true }, index, null);
    expect(swapped).toMatchObject({ side: 'positive' });
    expect(swapped!.key).not.toBe(probe!.key);
    // A tuck's line is a fold's, and so is a reverse fold's drawn between two picks.
    expect(lineSectionProbe({ ...located, tool: 'tuck' }, index, null)).toEqual(probe);
    expect(lineSectionProbe({ ...located, tool: 'inside-reverse' }, index, null)).toEqual(probe);
  });

  it('asks nothing for a fold of a whole point, a fix’s line, or a line not yet located', () => {
    // A reverse fold by a constructed line takes every layer on it, and a crimp every layer at its first.
    expect(lineSectionProbe({ ...located, tool: 'inside-reverse', lineMode: 'axiom-2' }, index, null)).toBeNull();
    expect(lineSectionProbe({ ...located, tool: 'crimp' }, index, null)).toBeNull();
    expect(lineSectionProbe({ ...located, tool: 'squash' }, index, null)).toBeNull();
    const op = { kind: 'valley' as const, line: { via: 'free' as const, through: [[0, 0.4], [1, 0.4]] as [[number, number], [number, number]] }, seed: { scope: 'all' as const } };
    expect(lineSectionProbe({ ...located, override: { op } }, index, null)).toBeNull();
    expect(lineSectionProbe({ ...located, picks: located.picks.slice(0, 1) }, index, null)).toBeNull();
    // An axiom's line waits for its root.
    expect(lineSectionProbe({ ...FOLD_TOOL_INITIAL, picks: [free(0, 0), free(1, 1)] }, index, null)).toBeNull();
  });
});
