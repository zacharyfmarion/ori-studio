import { describe, expect, it } from 'vitest';
import { bookScene, flatSquareLandmarks, flatSquareScene } from '../canvas/foldCanvas.fixtures';
import { lineThrough } from '../canvas/foldCanvasGeometry';
import { foldPickIndex, resolveFoldPick, type FoldPickIndex } from '../canvas/foldPicking';
import type { SheetPoint } from '../document/foldSequenceDocument';
import { buildFoldStep, freeLineAsDrawn, type FoldStepBuild } from './foldStepBuilder';

const RADII = { point: 0.03, line: 0.03 };
const FREE = { snap: 'free', edges: false, free: false } as const;

/** A free line clicked from `p` to `q` on the crease-pattern pane, built. */
function drawnOnCreasePattern(index: FoldPickIndex, p: SheetPoint, q: SheetPoint): FoldStepBuild {
  const first = resolveFoldPick(index, 'crease-pattern', { x: p[0], y: p[1] }, RADII, FREE);
  const second = resolveFoldPick(index, 'crease-pattern', { x: q[0], y: q[1] }, RADII, FREE);
  if (!first || !second) throw new Error('off the sheet');
  return buildFoldStep(
    {
      kind: 'valley',
      lineMode: 'free',
      picks: [first, second],
      candidate: null,
      swapped: false,
      seed: { scope: 'all' },
      precreaseDirection: 'valley',
    },
    index
  );
}

describe('a free line drawn on the crease pattern', () => {
  it('is the line drawn on the flat sheet', () => {
    const index = foldPickIndex(flatSquareScene(), flatSquareLandmarks(), []);
    const built = drawnOnCreasePattern(index, [0.25, 0.1], [0.75, 0.9]);
    if (built.status !== 'built') throw new Error(built.status);
    expect(built.acrossLayers).toBeUndefined();
  });

  it('says so when it crosses layers the folded form puts apart', () => {
    // The book: the right half lies folded over the left. A diagonal across
    // both halves is not one fold line: the fold runs through where its ends
    // lie folded, a vertical line.
    const index = foldPickIndex(bookScene(), null, []);
    const built = drawnOnCreasePattern(index, [0.25, 0.1], [0.75, 0.9]);
    if (built.status !== 'built') throw new Error(built.status);
    expect(built.acrossLayers).toBe(true);
  });

  it('is the line drawn on one face, or across faces the folded form keeps in line', () => {
    const scene = bookScene();
    const index = foldPickIndex(scene, null, []);
    // On the left half alone.
    const oneFace = drawnOnCreasePattern(index, [0.1, 0.2], [0.4, 0.7]);
    if (oneFace.status !== 'built') throw new Error(oneFace.status);
    expect(oneFace.acrossLayers).toBeUndefined();
    // Square across the bend: each half lands on the same horizontal line.
    const across = lineThrough({ x: 0.1, y: 0.2 }, { x: 0.25, y: 0.2 });
    if (!across) throw new Error('no line');
    expect(freeLineAsDrawn(scene, across, [0.1, 0.2], [0.75, 0.2])).toBe(true);
  });

  it('is not judged for a line drawn on the folded form', () => {
    const index = foldPickIndex(bookScene(), null, []);
    const first = resolveFoldPick(index, 'folded', { x: 0.25, y: -0.1 }, RADII, FREE);
    const second = resolveFoldPick(index, 'folded', { x: 0.25, y: 1.1 }, RADII, FREE);
    if (!first || !second) throw new Error('no picks');
    const built = buildFoldStep(
      {
        kind: 'valley',
        lineMode: 'free',
        picks: [first, second],
        candidate: null,
        swapped: false,
        seed: { scope: 'all' },
        precreaseDirection: 'valley',
      },
      index
    );
    if (built.status !== 'built') throw new Error(built.status);
    expect(built.acrossLayers).toBeUndefined();
  });
});
