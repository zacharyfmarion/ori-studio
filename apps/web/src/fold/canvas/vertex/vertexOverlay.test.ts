import { describe, expect, it } from 'vitest';
import type { Rgba } from '../../../cp-workspace/renderer/types';
import type { FoldVertexAnalysis } from '../../engine/foldEngineSquashWire';
import { flatSquareLandmarks, flatSquareScene } from '../foldCanvas.fixtures';
import type { FoldPaneCreaseLine } from '../foldPaneScenes';
import { foldPickIndex } from '../foldPicking';
import { rayOnPaper, swivelRegionsTint, vertexCreaseLines, vertexOverlayMarks } from './vertexOverlay';

const index = foldPickIndex(flatSquareScene(), flatSquareLandmarks(), []);
const accent: Rgba = [0.2, 0.4, 1, 1];
const outline: Rgba = [1, 1, 1, 1];
const inks = { accent, outline };

const squash: FoldVertexAnalysis = {
  kind: 'squash',
  vertex: [0.5, 0.5],
  hinge: { n: [0.7071, -0.7071], d: 0 },
  spine: { n: [0.7071, 0.7071], d: 0.7071 },
  hinge_direction: [-Math.SQRT1_2, -Math.SQRT1_2],
  spine_direction: [-Math.SQRT1_2, Math.SQRT1_2],
  upper: [1],
  lower: [2],
  upper_crease: { n: [0, 1], d: 0.5 },
  lower_crease: { n: [0, 1], d: 0.5 },
  wedge: -Math.PI / 2,
  share: 0,
};

const petal: FoldVertexAnalysis = {
  kind: 'petal',
  line: { n: [0, 1], d: 0.5 },
  ends: [
    [0.2, 0.5],
    [0.8, 0.5],
  ],
  corner: [0.5, 0],
  kites: [
    { n: [0.86, 0.51], d: 0.43 },
    { n: [-0.86, 0.51], d: -0.43 },
  ],
  top: [1],
  second: [2],
};

const fan: FoldVertexAnalysis = {
  kind: 'rabbit-ear',
  center: [0.5, 0.5],
  given: [
    [1, 0],
    [0, 1],
    [-1, 0],
  ],
  candidates: [
    [0, -1],
    [0.6, -0.8],
  ],
  emergent: 0,
  layers: [0],
};

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};

describe('a vertex tool’s marks over the folded pane', () => {
  it('runs each ray from its vertex to where it leaves the paper', () => {
    close(rayOnPaper(index, { x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }), { x: 1, y: 0.5 });
    close(rayOnPaper(index, { x: 0.5, y: 0.5 }, { x: 0.4, y: 0.4 }), { x: 0, y: 0 });
  });

  it('marks a squash’s vertex, its spine faint and where the spine lands bold — none of them a crease', () => {
    const marks = vertexOverlayMarks(index, { analysis: squash, emergent: null, emergents: [] }, inks);
    expect(marks.dots).toHaveLength(1);
    close(marks.dots[0]!.at, { x: 0.5, y: 0.5 });
    expect(marks.strokes).toHaveLength(2);
    // The spine as it lies, faint; the landing on the hinge, bold, to the paper's corner.
    const [spine, landing] = marks.strokes;
    expect(spine!.color[3]).toBeLessThan(1);
    close(spine!.b, { x: 0, y: 1 });
    expect(landing!.widthMul).toBeGreaterThan(spine!.widthMul);
    expect(landing!.color).toEqual(accent);
    close(landing!.b, { x: 0, y: 0 });
    // Aimed where it cannot land: drawn too, faint.
    const aimed = vertexOverlayMarks(
      index,
      { analysis: squash, emergent: null, emergents: [], aimed: [0, 1] },
      inks
    );
    expect(aimed.strokes).toHaveLength(3);
    close(aimed.strokes[2]!.b, { x: 0.5, y: 1 });
    expect(aimed.strokes[2]!.color[3]).toBeLessThan(1);
  });

  it('marks a petal fold’s ends and open corner, and draws none of its creases over the paper', () => {
    const marks = vertexOverlayMarks(index, { analysis: petal, emergent: null, emergents: [] }, inks);
    expect(marks.dots).toHaveLength(3);
    expect(marks.strokes).toHaveLength(0);
  });

  it('marks a rabbit ear’s center without offering other fourth creases', () => {
    const marks = vertexOverlayMarks(index, { analysis: fan, emergent: 1, emergents: [true, true] }, inks);
    expect(marks.strokes).toEqual([]);
    expect(marks.dots).toHaveLength(1);
    expect(vertexOverlayMarks(index, { analysis: fan, emergent: null, emergents: [] }, inks).strokes).toEqual([]);
    // Legacy swivel fans still show their other available rays.
    const swivel = { ...fan, kind: 'swivel' as const };
    expect(vertexOverlayMarks(index, { analysis: swivel, emergent: 0, emergents: [true, true] }, inks).strokes).toHaveLength(1);
  });
});

describe('a vertex fold’s creases on the folded pane, by the letter each shows the viewer', () => {
  const letters = (creases: readonly FoldPaneCreaseLine[]) => creases.map((crease) => crease.letter);

  it('letters a rabbit ear’s three bisectors the direction’s way and its fourth crease the other', () => {
    const valley = vertexCreaseLines(index, { analysis: fan, emergent: 1 }, 'valley');
    expect(letters(valley)).toEqual(['valley', 'valley', 'valley', 'mountain']);
    close(valley[0]!.line[0], { x: 0.5, y: 0.5 });
    close(valley[0]!.line[1], { x: 1, y: 0.5 });
    // The fourth taken, (0.6, −0.8) from the center, to the paper's edge.
    close(valley[3]!.line[1], { x: 0.875, y: 0 });
    expect(letters(vertexCreaseLines(index, { analysis: fan, emergent: 1 }, 'mountain'))).toEqual([
      'mountain',
      'mountain',
      'mountain',
      'valley',
    ]);
    // No fourth crease taken yet: the three given.
    expect(letters(vertexCreaseLines(index, { analysis: fan, emergent: null }, 'valley'))).toEqual([
      'valley',
      'valley',
      'valley',
    ]);
  });

  it('letters a swivel as a rabbit ear: the three given the direction’s way, the fourth the other', () => {
    const swivel: FoldVertexAnalysis = { ...fan, kind: 'swivel' };
    expect(letters(vertexCreaseLines(index, { analysis: swivel, emergent: 0 }, 'valley'))).toEqual([
      'valley',
      'valley',
      'valley',
      'mountain',
    ]);
  });

  it('letters a petal fold’s H the direction’s way and the top layer’s kite creases the other', () => {
    const creases = vertexCreaseLines(index, { analysis: petal, emergent: null }, 'valley');
    expect(letters(creases)).toEqual(['valley', 'mountain', 'mountain']);
    close(creases[0]!.line[0], { x: 0.2, y: 0.5 });
    close(creases[0]!.line[1], { x: 0.8, y: 0.5 });
    close(creases[1]!.line[1], { x: 0.5, y: 0 });
    expect(letters(vertexCreaseLines(index, { analysis: petal, emergent: null }, 'mountain'))).toEqual([
      'mountain',
      'valley',
      'valley',
    ]);
  });

  it('letters a squash’s lower crease the direction’s way and the upper one the other, one line where they meet', () => {
    // The spine landing on the hinge: both layers crease on the bisector, drawn once, as the step's picture draws it.
    const symmetric = vertexCreaseLines(index, { analysis: squash, emergent: null }, 'valley');
    expect(letters(symmetric)).toEqual(['valley']);
    close(symmetric[0]!.line[1], { x: 0, y: 0.5 });
    // Landing off the hinge, the two creases part.
    const aimed = vertexCreaseLines(index, { analysis: { ...squash, share: 0.5 }, emergent: null }, 'valley');
    expect(letters(aimed)).toEqual(['valley', 'mountain']);
    expect(aimed[0]!.line[1].y).toBeGreaterThan(aimed[1]!.line[1].y);
  });
});

describe('a swivel by its edge on the folded pane', () => {
  const swivel: FoldVertexAnalysis = {
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
    target: { n: [Math.SQRT1_2, -Math.SQRT1_2], d: 0 },
    rotation: Math.PI / 4,
    landed: [
      [
        [0.4, 0.4],
        [0.56, 0.56],
      ],
    ],
    creases: [
      { ray: 'meet', direction: [-0.92, -0.38], from: [0.8, 0.33], to: [0, 0], letter: 'valley', ridge: false },
      { ray: 'foot', direction: [0, -1], from: [0.8, 0.33], to: [0.8, 0], letter: 'mountain', ridge: true },
      { ray: 'end', direction: [0.52, -0.85], from: [0.8, 0.33], to: [1, 0], letter: 'valley', ridge: false },
      { ray: 'hinge', direction: [0.3, 0.95], from: [0.8, 0.33], to: [0.92, 0.68], letter: 'valley', ridge: false },
    ],
    ridges: [
      [0, -1],
      [0.52, -0.85],
    ],
    ridge: 0,
    layers: [0],
    regions: [
      { wedge: 'near', polygon: [[0, 0], [0.8, 0], [0.8, 0.33]] },
      { wedge: 'turn', polygon: [[0.8, 0], [1, 0], [0.8, 0.33]] },
    ],
  };

  it('draws its four creases from the vertex, each by the engine’s letter as seen, the ridge the odd one', () => {
    const creases = vertexCreaseLines(index, { analysis: swivel, emergent: 0 }, 'valley');
    expect(creases.map((crease) => crease.letter)).toEqual(['valley', 'mountain', 'valley', 'valley']);
    for (const crease of creases) close(crease.line[0], { x: 0.8, y: 0.33 });
    close(creases[1]!.line[1], { x: 0.8, y: 0 });
  });

  it('marks the vertex in the click’s place, where the edge lands, and the other ridge when it lands too', () => {
    const marks = vertexOverlayMarks(index, { analysis: swivel, emergent: 0, emergents: [true, true] }, inks);
    expect(marks.dots.map((dot) => dot.at)).toEqual([{ x: 0.8, y: 0.33 }]);
    // The landing, bold; the other ridge, faint.
    expect(marks.strokes).toHaveLength(2);
    expect(marks.strokes[0]).toMatchObject({ a: { x: 0.4, y: 0.4 }, b: { x: 0.56, y: 0.56 }, color: accent });
    expect(marks.strokes[1]!.color[3]).toBeLessThan(1);
    // The other ridge does not land: not drawn, as it is not offered.
    expect(vertexOverlayMarks(index, { analysis: swivel, emergent: 0, emergents: [true, false] }, inks).strokes).toHaveLength(1);
  });

  it('lights the paper that moves, the wedge that turns brightest', () => {
    const tint = swivelRegionsTint(index, swivel, accent);
    // One triangle each.
    expect(tint?.count).toBe(6);
    const alpha = (k: number) => tint!.color[k * 4 + 3]!;
    expect(alpha(3)).toBeGreaterThan(alpha(0));
    expect(swivelRegionsTint(index, { regions: [] }, accent)).toBeNull();
  });

  /**
   * On a folded edge (`compound/swivel_on_edge.rs`): three creases, the
   * swivel crease of the layer underneath drawn only past the one on top
   * (none where it is hidden all along), and the wedge that swivels — the
   * one that carries the edge — lit brightest.
   */
  const onFold: FoldVertexAnalysis = {
    ...swivel,
    vertex: [0.2, 0.5],
    creases: [
      { ray: 'meet', direction: [0, -1], from: [0.2, 0.3], to: [0.2, 0], letter: 'valley', ridge: false },
      { ray: 'meet', direction: [0, -1], from: [0.2, 0.5], to: [0.2, 0.3], letter: 'mountain', ridge: true },
      { ray: 'hinge', direction: [1, 0], from: [0.2, 0.5], to: [1, 0.5], letter: 'valley', ridge: false },
    ],
    ridges: [],
    regions: [
      { wedge: 'turn', polygon: [[0.2, 0.5], [0.2, 0.3], [0.4, 0.4]] },
      { wedge: 'near', polygon: [[0, 0], [0.2, 0], [0.2, 0.5]] },
    ],
    fold: {
      edge: [
        [0, 0],
        [0.2, 1],
      ],
      opens: [
        [0.2, 0.5],
        [0, 0],
      ],
      faces: [1, 2],
    },
  };

  it('on a folded edge draws the layer underneath only past the one on top, and lights the wedge that swivels brightest', () => {
    const creases = vertexCreaseLines(index, { analysis: onFold, emergent: 0 }, 'valley');
    expect(creases.map((crease) => crease.letter)).toEqual(['valley', 'mountain', 'valley']);
    close(creases[0]!.line[0], { x: 0.2, y: 0.3 });
    close(creases[1]!.line[0], { x: 0.2, y: 0.5 });
    const hidden: FoldVertexAnalysis = {
      ...onFold,
      creases: [{ ray: 'meet', direction: [0, -1], from: [0.2, 0], to: [0.2, 0], letter: 'valley', ridge: false }],
    };
    expect(vertexCreaseLines(index, { analysis: hidden, emergent: 0 }, 'valley')).toEqual([]);
    const tint = swivelRegionsTint(index, onFold, accent);
    const alpha = (k: number) => tint!.color[k * 4 + 3]!;
    expect(alpha(3)).toBeGreaterThan(alpha(0));
  });
});

describe('a swivel by its valley and mountain on the folded pane', () => {
  const byLines: FoldVertexAnalysis = {
    kind: 'swivel-valley-mountain',
    vertex: [0.5, 0.5],
    creases: [
      // The crease behind: hidden as far as the front layer reaches, then seen.
      { ray: 'meet', direction: [-0.6, -0.8], from: [0.5, 0.5], to: [0.38, 0.34], letter: 'valley', ridge: false, hidden: true },
      { ray: 'meet', direction: [-0.6, -0.8], from: [0.38, 0.34], to: [0.2, 0.1], letter: 'valley', ridge: false },
      { ray: 'meet', direction: [-0.8, -0.6], from: [0.5, 0.5], to: [0, 0.125], letter: 'mountain', ridge: true },
      { ray: 'hinge', direction: [-0.6, 0.8], from: [0.5, 0.5], to: [0.2, 0.9], letter: 'valley', ridge: false },
    ],
    layers: [2, 1],
    regions: [
      { wedge: 'beyond', polygon: [[0.5, 0.5], [0, 0.125], [0, 0.6]] },
      { wedge: 'near', polygon: [[0.5, 0.5], [0.2, 0.1], [0.5, 0]] },
    ],
    fold: { edge: [[0.5, 0], [0.5, 1]], opens: [[0.5, 0.5], [0.5, 0]], faces: [1, 2] },
  };

  it('draws the two named by their letters and the crease behind dotted where it is hidden', () => {
    const creases = vertexCreaseLines(index, { analysis: byLines, emergent: null }, 'valley');
    expect(creases.map((crease) => [crease.letter, crease.hidden === true])).toEqual([
      ['valley', true],
      ['valley', false],
      ['mountain', false],
      ['valley', false],
    ]);
    // Its vertex is marked, and nothing else: its two lines are the folder's.
    expect(vertexOverlayMarks(index, { analysis: byLines, emergent: null, emergents: [] }, inks).dots).toHaveLength(1);
  });

  it('lights the flap between the valley and the mountain brightest', () => {
    const tint = swivelRegionsTint(index, byLines, accent);
    const alpha = (k: number) => tint!.color[k * 3 * 4 + 3]!;
    expect(alpha(0)).toBeGreaterThan(alpha(1));
  });
});
