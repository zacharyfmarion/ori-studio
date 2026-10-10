import { describe, expect, it } from 'vitest';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import type { PaperLineItem, PaperScene } from '../../lib/paper/paperScene';
import { sceneOf, face, line, SQUARE } from '../../lib/paper/paperScene.fixtures';
import { cpDocument, twoSquaresSegmentation } from './capture.fixtures';
import { chooseStepCreases, type StepCreases } from './captureCreases';
import { CAPTURE_PX_PER_UNIT, storableScene } from './captureGeometry';
import { creasePatternScene } from './creasePatternScene';

const segmentation = twoSquaresSegmentation();
const [left, right] = resolveCpSegments(segmentation);

function regionCreases(segment: typeof left): StepCreases {
  const choice = chooseStepCreases(
    cpDocument(),
    { kind: 'segment', region: regionReferenceFor(segment!) },
    segmentation
  );
  if (choice.status !== 'found') throw new Error('the region should be found');
  return choice.creases;
}

const leftCreases = () => regionCreases(left);

const lines = (scene: PaperScene) => scene.items.filter((item): item is PaperLineItem => item.kind === 'line');

describe('creasePatternScene', () => {
  it('fills the region with paper and draws its lines over it, each in its role', () => {
    const scene = creasePatternScene(cpDocument(), leftCreases(), 0);
    expect(scene.items[0]).toMatchObject({ kind: 'face', side: 'front', shade: 1, hidden: false });
    expect(lines(scene).map((item) => item.role)).toEqual(['aux', 'diagram-mountain', 'edge', 'edge', 'edge', 'edge']);
    // At Edit's 100%: the 100-unit square is that many px across.
    expect(scene.sheet).toBeCloseTo(100 * CAPTURE_PX_PER_UNIT);
    expect(scene.bounds.maxX - scene.bounds.minX).toBeCloseTo(100 * CAPTURE_PX_PER_UNIT);
  });

  it('draws its folds as the diagram creases to make: a valley in the valley pen', () => {
    const scene = creasePatternScene(cpDocument(), regionCreases(right), 0);
    expect(lines(scene).map((item) => item.role)).toEqual(['diagram-valley', 'edge', 'edge', 'edge', 'edge']);
  });

  it('pulls an aux line back where it meets the paper’s edge or a fold, and nowhere else', () => {
    const [aux] = lines(creasePatternScene(cpDocument(), leftCreases(), 0));
    // From the left edge to the diagonal.
    expect(aux!.onBoundary).toEqual([true, true]);
    const short = cpDocument(undefined, (cp, id) => (id === 10 ? { ...cp, b: { x: 30, y: 50 } } : cp));
    const [open] = lines(creasePatternScene(short, leftCreases(), 0));
    expect(open!.onBoundary).toEqual([true, false]);
    // A fold runs to the edge.
    expect(lines(creasePatternScene(cpDocument(), leftCreases(), 0))[1]!.onBoundary).toEqual([false, false]);
  });

  it('joins lines where they meet, so a corner closes rather than caps', () => {
    const edges = lines(creasePatternScene(cpDocument(), leftCreases(), 0)).filter((item) => item.role === 'edge');
    for (const edge of edges) expect(edge.joined).toEqual([true, true]);
  });

  it('turns the picture clockwise about the paper, keeping the sheet’s size', () => {
    const upright = creasePatternScene(cpDocument(), leftCreases(), 0);
    const turned = creasePatternScene(cpDocument(), leftCreases(), 45);
    expect(turned.sheet).toBeCloseTo(upright.sheet);
    // A square turned an eighth is √2 across.
    expect(turned.bounds.maxX - turned.bounds.minX).toBeCloseTo(upright.sheet * Math.SQRT2);
    // Clockwise on a y-down page: the mountain diagonal, top-left to bottom-right, turns upright.
    const diagonal = lines(turned).find((item) => item.role === 'diagram-mountain')!;
    expect(diagonal.a[0]).toBeCloseTo(diagonal.b[0]);
  });

  // Zach, 2026-10-06: "I wanted to just change the color of the face and not flip the creases."
  describe('on the paper’s back colour', () => {
    const front = (rotationDeg = 0) => creasePatternScene(cpDocument(), leftCreases(), rotationDeg);
    const back = (rotationDeg = 0) => creasePatternScene(cpDocument(), leftCreases(), rotationDeg, 'back');

    it('fills the paper with its back colour and changes nothing else: every line, the outline, the frame', () => {
      for (const rotationDeg of [0, 30, 315]) {
        const [seen, recoloured] = [front(rotationDeg), back(rotationDeg)];
        expect(recoloured.items[0]).toMatchObject({ kind: 'face', side: 'back', shade: 1, hidden: false });
        expect(seen.items[0]).toMatchObject({ kind: 'face', side: 'front' });
        // Not mirrored, not turned the other way, its mountains and valleys as they are.
        expect({ ...recoloured.items[0], side: 'front' }).toEqual(seen.items[0]);
        expect(recoloured.items.slice(1)).toEqual(seen.items.slice(1));
        expect(recoloured.bounds).toEqual(seen.bounds);
        expect(recoloured.sheet).toBe(seen.sheet);
      }
      expect(lines(back()).map((item) => item.role)).toEqual(['aux', 'diagram-mountain', 'edge', 'edge', 'edge', 'edge']);
      const valley = creasePatternScene(cpDocument(), regionCreases(right), 0, 'back');
      expect(lines(valley).map((item) => item.role)).toEqual(['diagram-valley', 'edge', 'edge', 'edge', 'edge']);
    });
  });
});

describe('storableScene', () => {
  it('keeps nothing hidden and no markup, to a hundredth of a px', () => {
    const scene = sceneOf(
      [
        face([SQUARE.map(([x, y]) => [x + 0.123456, y - 0.0049] as [number, number])]),
        face([SQUARE], { hidden: true }),
        line('mountain', [0.004, -0.004], [50.0051, 50], { hidden: true }),
        line('valley', [0.004, -0.004], [50.0051, 50]),
        { kind: 'markup', svg: '<g/>', bounds: { minX: -500, minY: -500, maxX: 0, maxY: 0 }, hidden: false },
      ],
      400
    );
    const stored = storableScene(scene);
    expect(stored.items.map((item) => item.kind)).toEqual(['face', 'line']);
    const [paper, valley] = stored.items as [{ rings: [number, number][][] }, PaperLineItem];
    expect(paper.rings[0]![0]).toEqual([0.12, 0]);
    expect(valley.a).toEqual([0, 0]);
    expect(Object.is(valley.a[1], -0)).toBe(false);
    expect(valley.b).toEqual([50.01, 50]);
    // The crop is what is kept, not the markup that went.
    expect(stored.bounds.minX).toBeCloseTo(0);
  });

  it('keeps a small sheet’s shape, with a finer step', () => {
    const tiny = sceneOf([line('edge', [0, 0], [0.0123, 0.0456])], 1);
    const [edge] = storableScene(tiny).items as PaperLineItem[];
    expect(edge!.b[0]).toBeCloseTo(0.0123, 4);
  });
});
