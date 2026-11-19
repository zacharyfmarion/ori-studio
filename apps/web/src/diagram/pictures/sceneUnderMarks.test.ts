import { describe, expect, it } from 'vitest';
import type { PaperLineItem, PaperScene } from '../../lib/paper/paperScene';
import { face, line, markup, sceneOf, SQUARE } from '../../lib/paper/paperScene.fixtures';
import { paperSceneSvgBody } from '../../lib/paper/paperSvg';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { sceneUnderMarks, storedSceneUnderMarks, type CoveringMarks, type MarkPoint } from './sceneUnderMarks';

/** Marks in scene px, on a scene whose px are its own units. */
function covering(...lines: (readonly [MarkPoint, MarkPoint])[]): CoveringMarks {
  return { lines, tolerance: 5e-5, key: JSON.stringify(lines) };
}

/** `scene` under marks given in its own px: one px a unit, so the tolerance is the fixture's 5e-5 px scaled by 100. */
function under(scene: PaperScene, marks: CoveringMarks): PaperScene {
  return sceneUnderMarks(scene, marks, ([x, y]) => [x, y], 100);
}

const lines = (scene: PaperScene) => scene.items.filter((item): item is PaperLineItem => item.kind === 'line');

describe('sceneUnderMarks', () => {
  const precrease = line('aux', [0, 50], [100, 50], { onBoundary: [true, true], face: 3 });

  it('leaves out a line a mark covers end to end, and nothing else', () => {
    const edge = line('edge', [0, 0], [100, 0]);
    const scene = sceneOf([face([SQUARE]), precrease, edge]);
    const left = under(scene, covering([[0, 50], [100, 50]]));
    expect(left.items).toEqual([scene.items[0], edge]);
    expect(left.bounds).toEqual(scene.bounds);
    expect(left.sheet).toBe(scene.sheet);
  });

  it('leaves out only the stretch a mark covers, the rest on its crease with its own end', () => {
    const scene = sceneOf([face([SQUARE]), { ...precrease, joined: [true, true] }]);
    const [rest] = lines(under(scene, covering([[0, 50], [40, 50]])));
    expect(rest).toEqual({
      ...precrease,
      a: [40, 50],
      b: [100, 50],
      // The cut end is the pen's own: it neither retreats under erode nor joins on.
      onBoundary: [false, true],
      joined: [false, true],
      whole: { a: [0, 50], b: [100, 50], onBoundary: [true, true] },
    });
    expect(lines(scene)).toHaveLength(1);
  });

  it('reads a mark drawn either way round alike', () => {
    const scene = sceneOf([face([SQUARE]), precrease]);
    expect(under(scene, covering([[40, 50], [0, 50]]))).toEqual(under(scene, covering([[0, 50], [40, 50]])));
  });

  it('leaves the stretch between two marks along one crease', () => {
    const scene = sceneOf([face([SQUARE]), precrease]);
    const left = lines(under(scene, covering([[0, 50], [30, 50]], [[100, 50], [70, 50]])));
    expect(left.map(({ a, b }) => [a, b])).toEqual([[[30, 50], [70, 50]]]);
  });

  it('keeps the crease a piece the tree cut belongs to', () => {
    const whole = { a: [0, 50] as [number, number], b: [100, 50] as [number, number], onBoundary: [true, false] as [boolean, boolean] };
    const piece = line('valley', [20, 50], [80, 50], { whole });
    const [left] = lines(under(sceneOf([face([SQUARE]), piece]), covering([[50, 50], [100, 50]])));
    expect(left).toMatchObject({ a: [20, 50], b: [50, 50], whole });
  });

  it('takes every piece of a crease a long mark covers, and a piece of it nearly on its line', () => {
    // A stored scene rounds each piece's ends on their own, so one can lie a little off its crease's line.
    const pieces = [
      line('mountain', [0, 0], [25, 25]),
      line('mountain', [25, 25], [50.002, 49.998]),
      line('mountain', [50.002, 49.998], [100, 100]),
    ];
    const scene = sceneOf([face([SQUARE]), ...pieces]);
    expect(lines(under(scene, covering([[0, 0], [100, 100]])))).toEqual([]);
  });

  it('never leaves out an edge, or a line a mark only crosses or runs beside', () => {
    const edge = line('edge', [0, 100], [100, 100]);
    const scene = sceneOf([face([SQUARE]), edge, precrease]);
    // Along the edge; across the precrease; a hair off the precrease; on its line past its end.
    const left = under(
      scene,
      covering([[0, 100], [100, 100]], [[50, 0], [50, 100]], [[0, 50.1], [100, 50.1]], [[120, 50], [160, 50]])
    );
    expect(left).toBe(scene);
  });

  it('gives a face outlined in a crease’s pen a line per side, and leaves the covered one out', () => {
    const outlined = face([SQUARE], { outline: 'aux', face: 7, group: 'patch-1' });
    const after = line('edge', [0, 0], [10, 10]);
    const scene = sceneOf([outlined, after]);
    const left = under(scene, covering([[0, 100], [100, 100]]));
    const { outline: _outline, ...plain } = outlined;
    expect(left.items[0]).toEqual(plain);
    const sides = left.items.slice(1, -1);
    expect(sides.map((side) => side.kind === 'line' && [side.a, side.b])).toEqual([
      [[0, 0], [100, 0]],
      [[100, 0], [100, 100]],
      [[0, 100], [0, 0]],
    ]);
    for (const side of sides) {
      expect(side).toMatchObject({ kind: 'line', role: 'aux', face: 7, joined: [true, true], group: 'patch-1', hidden: false });
    }
    expect(left.items.at(-1)).toBe(after);
  });

  it('keeps a face outlined in a crease’s pen whole where no mark lies along a side', () => {
    const scene = sceneOf([face([SQUARE], { outline: 'aux' })]);
    expect(under(scene, covering([[0, 50], [100, 50]]))).toBe(scene);
  });

  it('never touches a face outlined as the paper’s edge', () => {
    const scene = sceneOf([face([SQUARE], { outline: 'edge' })]);
    expect(under(scene, covering([[0, 0], [100, 0]]))).toBe(scene);
  });

  it('draws what is left as the painter draws any line, and nothing under the mark', () => {
    const scene = sceneOf([face([SQUARE]), line('aux', [0, 50], [100, 50]), markup('<g/>')]);
    const body = paperSceneSvgBody(under(scene, covering([[0, 50], [60, 50]])), DEFAULT_PAPER_STYLE, {
      project: (point) => point,
      unitsPerPt: 1,
      keepHiddenFaces: false,
    });
    expect(body).toContain('x1="60.00" y1="50.00" x2="100.00" y2="50.00"');
    expect(body).not.toContain('x1="0.00" y1="50.00"');
  });
});

describe('storedSceneUnderMarks', () => {
  it('reads the marks in picture units, the scene’s bounds its frame', () => {
    // Bounds 10..210 across and 20..120 down: a picture unit is 200 px, from (10, 20).
    const sheet: [number, number][] = [
      [10, 20],
      [210, 20],
      [210, 120],
      [10, 120],
    ];
    const scene = sceneOf([face([sheet]), line('aux', [10, 70], [210, 70])]);
    const left = lines(storedSceneUnderMarks(scene, covering([[0, 0.25], [0.5, 0.25]])));
    expect(left.map(({ a, b }) => [a, b])).toEqual([[[110, 70], [210, 70]]]);
  });

  it('is the scene itself with no marks', () => {
    const scene = sceneOf([face([SQUARE]), line('aux', [0, 50], [100, 50])]);
    expect(storedSceneUnderMarks(scene, null)).toBe(scene);
    expect(storedSceneUnderMarks(scene, covering())).toBe(scene);
  });
});
