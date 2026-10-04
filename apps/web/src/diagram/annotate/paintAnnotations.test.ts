import { describe, expect, it } from 'vitest';
import { DEFAULT_PAPER_STYLE, PT_TO_CSS_PX } from '../../lib/paper/paperStyle';
import { DEFAULT_DIAGRAM_STYLE, type DiagramAnnotation, type KnownDiagramAnnotation } from '../document/diagramDocument';
import {
  arcPolyline,
  arrowheadExtent,
  foldArrowDrawn,
  oneWayArrowDrawn,
} from '../../cp-workspace/references/stepDiagramGeometry';
import { arcToPath } from './annotationPath';
import { paintAsset } from '../pictures/paintDiagramStep';
import { annotationDrawing, annotationScene, annotationTextRuns, labelRuns } from './annotationPrimitives';
import { annotatedPicture, CARD_FRAME_PX, paintAnnotations } from './paintAnnotations';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"/>';
const ASSET = { id: 'asset-1', kind: 'svg' as const, svg: SVG, widthPx: 400, heightPx: 300, bytes: SVG.length };
const FRAME = { width: 1, height: 0.75 };

const a = (id: string, kind: KnownDiagramAnnotation['kind'], extra: Partial<KnownDiagramAnnotation> = {}) =>
  ({ id, kind, from: [0.2, 0.3], to: [0.6, 0.3], ...extra }) as KnownDiagramAnnotation;

describe('annotationDrawing', () => {
  it('draws a crease line as a line in its role, and every other mark as a step-diagram shape', () => {
    const drawing = annotationDrawing(
      [
        a('v', 'valley-line'),
        a('m', 'mountain-line'),
        a('h', 'hidden-line'),
        a('arrow', 'valley-arrow', { bend: 0.1 }),
        a('push', 'push-arrow'),
        a('turn', 'turn-over', { to: [0.2, 0.3], axis: 'horizontal' }),
      ],
      FRAME,
      CARD_FRAME_PX,
      DEFAULT_DIAGRAM_STYLE
    );
    expect(drawing.lines.map((line) => line.role)).toEqual(['diagram-valley', 'diagram-mountain', 'diagram-hidden']);
    // Picture units at the frame's size: one unit is its longer side.
    expect(drawing.lines[0]!.a).toEqual([0.2 * CARD_FRAME_PX, 0.3 * CARD_FRAME_PX]);
    expect(drawing.primitives.map((primitive) => primitive.kind)).toEqual(['one-way-arrow', 'push-arrow', 'turn-over']);
    expect(drawing.primitiveIds).toEqual(['arrow', 'push', 'turn']);
    expect(drawing.width).toBeCloseTo(CARD_FRAME_PX, 9);
    expect(drawing.height).toBeCloseTo(0.75 * CARD_FRAME_PX, 9);
  });

  it('draws nothing for one it cannot read, or a label with no words', () => {
    const unknown: DiagramAnnotation = { id: 'n', unknown: { id: 'n', kind: 'spiral' } };
    const drawing = annotationDrawing([unknown, a('l', 'label', { text: '  ' })], FRAME, 100, DEFAULT_DIAGRAM_STYLE);
    expect(annotationScene(drawing)).toBeNull();
  });

  it('compiles each annotation once, whatever size it is drawn at, and an edited one again', () => {
    const arrow = a('arrow', 'fold-unfold-arrow', { bend: 0.1 });
    const line = a('line', 'valley-line');
    const small = annotationDrawing([arrow, line], FRAME, 100, DEFAULT_DIAGRAM_STYLE);
    const large = annotationDrawing([arrow, line], FRAME, 400, DEFAULT_DIAGRAM_STYLE);
    // One compile, in picture units, that each drawing scales.
    expect(large.primitives[0]).toBe(small.primitives[0]);
    expect(large.lines[0]!.a).toEqual([small.lines[0]!.a[0] * 4, small.lines[0]!.a[1] * 4]);
    // An edit is a new object, compiled afresh; what was not edited is read back.
    const moved = { ...arrow, to: [0.7, 0.4] as [number, number] };
    const next = annotationDrawing([moved, line], FRAME, 100, DEFAULT_DIAGRAM_STYLE);
    expect(next.primitives[0]).not.toBe(small.primitives[0]);
    expect(next.primitives[0]).toMatchObject({ kind: 'fold-arrow' });
    expect(next.primitives[0]).not.toEqual(small.primitives[0]);
    expect(annotationDrawing([arrow], FRAME, 100, DEFAULT_DIAGRAM_STYLE).primitives[0]).toBe(small.primitives[0]);
  });
});

describe('a shaped arrow', () => {
  const path = [
    { at: [0.2, 0.4] as [number, number], out: [0.3, 0.1] as [number, number] },
    { at: [0.5, 0.4] as [number, number], in: [0.4, 0.7] as [number, number], out: [0.6, 0.1] as [number, number] },
    { at: [0.8, 0.4] as [number, number], in: [0.7, 0.7] as [number, number] },
  ];

  it('draws its path, each segment a cubic, in References’ shapes, its head in the arrow’s ink', () => {
    for (const [kind, fold] of [
      ['valley-arrow', 'valley'],
      ['mountain-arrow', 'mountain'],
      ['fold-unfold-arrow', 'fold-unfold'],
    ] as const) {
      const arrow = a('s', kind, { from: [0.2, 0.4], to: [0.8, 0.4], path });
      const drawing = annotationDrawing([arrow], FRAME, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE);
      expect(drawing.primitives).toEqual([
        {
          kind: 'path-arrow',
          fold,
          // y up, as References' unit frame is.
          path: [
            [[0.2, -0.4], [0.3, -0.1], [0.4, -0.7], [0.5, -0.4]],
            [[0.5, -0.4], [0.6, -0.1], [0.7, -0.7], [0.8, -0.4]],
          ],
        },
      ]);
      const painted = paintAnnotations([arrow], { x: 0, y: 0, width: 400, height: 300 }, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE)!;
      // The shaft: a move and a cubic per segment the shaft keeps.
      expect(painted.markup).toMatch(/<path d="M [-\d.]+ [-\d.]+ C [-\d. ]+ C [-\d. ]+"/);
      // A valley's head filled, a mountain's outlined, a fold-and-unfold's return drawn as runs.
      if (fold === 'fold-unfold') expect(painted.markup).toMatch(/<path d="M [-\d.]+ [-\d.]+( L [-\d.]+ [-\d.]+){8,}"/);
      expect(painted.markup).toMatch(fold === 'mountain' ? /stroke-linejoin="miter"/ : /fill="#231f20"/);
    }
  });

  it('reaches round a loop that bulges far past its ends, and its return past that', () => {
    const loop = a('loop', 'fold-unfold-arrow', {
      from: [0.5, 0.5],
      to: [0.52, 0.5],
      path: [
        { at: [0.5, 0.5], out: [0.5, -0.4] },
        { at: [0.52, 0.5], in: [0.52, -0.4] },
      ],
    });
    const box = { x: 0, y: 0, width: 400, height: 300 };
    const painted = paintAnnotations([loop], box, 400, DEFAULT_DIAGRAM_STYLE)!;
    // The loop's top is about 0.175 of the frame above it: 70 px.
    expect(painted.bounds.y).toBeLessThan(-70);
    expect(painted.bounds.y).toBeGreaterThan(-120);
  });

  it('draws nothing for a path of no length', () => {
    const point = a('p', 'valley-arrow', {
      from: [0.5, 0.5],
      to: [0.5, 0.5],
      path: [{ at: [0.5, 0.5] }, { at: [0.5, 0.5] }],
    });
    expect(annotationDrawing([point], FRAME, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE).primitives).toEqual([]);
  });
});

describe('a label’s runs', () => {
  it('sets each script in its font, Han under the key the diagram’s style replaces', () => {
    expect(labelRuns('A 中文')).toEqual([
      { key: 'latin', text: 'A ' },
      { key: 'sc', text: '中文' },
    ]);
    // Kana makes a text Japanese, its Han too.
    expect(labelRuns('谷折り').map((run) => run.key)).toEqual(['jp']);
    expect(
      annotationTextRuns([a('l', 'label', { text: '中文' }), a('v', 'valley-line')], 'tc')
    ).toEqual([{ face: { key: 'tc', weight: 400 }, text: '中文' }]);
  });
});

describe('annotatedPicture', () => {
  const painted = paintAsset(ASSET);

  it('is the picture itself when nothing draws', () => {
    expect(annotatedPicture(painted, [], DEFAULT_DIAGRAM_STYLE)).toBe(painted.svg);
  });

  it('draws them over the picture, the size it is, ghosted when asked', () => {
    const svg = annotatedPicture(painted, [a('v', 'valley-line')], DEFAULT_DIAGRAM_STYLE, 0.3);
    const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(document.querySelector('parsererror')).toBeNull();
    const root = document.documentElement;
    expect([root.getAttribute('width'), root.getAttribute('height')]).toEqual(['400', '300']);
    expect(root.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 400 300');
    const ghost = root.querySelector(':scope > g[opacity]');
    expect(ghost?.getAttribute('opacity')).toBe('0.3');
    // The line, on the frame: a 400 px frame's 0.2 is 80 px.
    expect(Number(ghost?.querySelector('line')?.getAttribute('x1'))).toBe(80);
  });
});

describe('annotatedPicture past the frame', () => {
  it('grows the card to hold an arrow that starts off the picture, the picture where it was', () => {
    const painted = paintAsset(ASSET);
    const push = a('p', 'push-arrow', { from: [-0.2, 0.3], to: [0.3, 0.3] });
    const svg = annotatedPicture(painted, [push], DEFAULT_DIAGRAM_STYLE);
    const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    const [x, y, width, height] = root.getAttribute('viewBox')!.split(' ').map(Number);
    const reach = paintAnnotations([push], painted.frame, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE)!.bounds;
    expect(x).toBeCloseTo(reach.x, 2);
    expect(x! + width!).toBeGreaterThanOrEqual(400);
    expect([y, height]).toEqual([0, 300]);
    expect(Number(root.getAttribute('width'))).toBe(width);
    // The picture itself, at the origin and its own size.
    expect(root.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 400 300');
  });

  it('fills a hollow push with the page’s white, whatever the paper’s face', () => {
    const svg = annotatedPicture(paintAsset(ASSET), [a('p', 'push-arrow')], { preset: 'default' });
    expect(svg).toContain('fill="#ffffff"');
  });
});

describe('paintAnnotations', () => {
  it('reaches past the frame for an arrow that starts off it', () => {
    const box = { x: 10, y: 20, width: 100, height: 75 };
    const painted = paintAnnotations([a('p', 'push-arrow', { from: [-0.5, 0.3] })], box, 100, DEFAULT_DIAGRAM_STYLE)!;
    expect(painted.bounds.x).toBeLessThan(box.x - 40);
    expect(painted.bounds.y).toBeLessThanOrEqual(box.y);
  });

  it('reaches round a shaped arrow’s head as drawn with a heavy pen, a mountain’s barb and all', () => {
    const pt = 3;
    const style = { style: { ...DEFAULT_PAPER_STYLE, arrows: { ...DEFAULT_PAPER_STYLE.arrows, width: pt } } };
    const box = { x: 0, y: 0, width: 189, height: 189 };
    const cases: Array<[[number, number], [number, number]]> = [
      [
        [0.5, 0.01],
        [0.955, 0.01],
      ],
      [
        [0.955, 0.01],
        [0.5, 0.01],
      ],
      [
        [-0.3, 0.5],
        [-0.285, 0.5],
      ],
    ];
    for (const [from, to] of cases) {
      const shaped = arcToPath(a('m', 'mountain-arrow', { from, to, bend: 0.02 }));
      const painted = paintAnnotations([shaped], box, 189, style)!;
      const half = (pt * PT_TO_CSS_PX) / 2;
      // Every corner of the head's outline, a pen's half width round it, is inside what is kept.
      const heads = [...painted.markup.matchAll(/d="([^"]*Z)"/g)].map((match) => match[1]!);
      expect(heads.length).toBeGreaterThan(0);
      for (const d of heads) {
        const numbers = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
        for (let i = 0; i + 1 < numbers.length; i += 2) {
          const [x, y] = [numbers[i]!, numbers[i + 1]!];
          expect(x - half).toBeGreaterThanOrEqual(painted.bounds.x);
          expect(y - half).toBeGreaterThanOrEqual(painted.bounds.y);
          expect(x + half).toBeLessThanOrEqual(painted.bounds.x + painted.bounds.width);
          expect(y + half).toBeLessThanOrEqual(painted.bounds.y + painted.bounds.height);
        }
      }
    }
  });

  it('reaches as far as a fold-and-unfold arrow’s return, which bulges past its outgoing arc', () => {
    const fold = a('f', 'fold-unfold-arrow', { from: [0.1, 0.02], to: [0.9, 0.02], bend: 0.03 });
    const painted = paintAnnotations([fold], { x: 0, y: 0, width: 453, height: 340 }, 453, DEFAULT_DIAGRAM_STYLE)!;
    // The return's sagitta: well above the top edge, where the outgoing arc barely leaves it.
    expect(painted.bounds.y).toBeLessThan(-0.15 * 0.8 * 453);
  });

  it('reaches an arc arrow where it is drawn, a pen round it, not a head’s length round every point', () => {
    // At the top edge, so what each reaches past the frame is how far it is measured.
    for (const kind of ['fold-unfold-arrow', 'valley-arrow', 'mountain-arrow'] as const) {
      const arrow = a('f', kind, { from: [0.2, 0.004], to: [0.8, 0.004], bend: 0.05 });
      const drawing = annotationDrawing([arrow], { width: 1, height: 1 }, 453, DEFAULT_DIAGRAM_STYLE);
      const { project, marks } = drawing.context;
      const primitive = drawing.primitives.find((each) => each.kind === 'fold-arrow' || each.kind === 'one-way-arrow');
      if (primitive?.kind !== 'fold-arrow' && primitive?.kind !== 'one-way-arrow') throw new Error('an arc arrow');
      const drawn =
        primitive.kind === 'fold-arrow'
          ? foldArrowDrawn(primitive.out, project, marks)!
          : { ...oneWayArrowDrawn(primitive.out, project, marks), out: null };
      const strokes = [drawn.out, 'back' in drawn ? drawn.back : drawn.shaft].flatMap((arc) =>
        arc ? arcPolyline(arc).map((point) => project(point)) : []
      );
      const top = Math.min(...[...strokes, ...arrowheadExtent(drawn.head)].map(({ y }) => y));
      const painted = paintAnnotations([arrow], { x: 0, y: 0, width: 453, height: 453 }, 453, DEFAULT_DIAGRAM_STYLE)!;
      const pen = project.pens.arrow.width * project.ink;
      expect(top).toBeLessThan(0);
      // Its strokes' half width kept, and no more than a mitre's room round its head.
      expect(painted.bounds.y).toBeLessThanOrEqual(top - pen / 2);
      expect(painted.bounds.y).toBeGreaterThanOrEqual(top - Math.max(2 * project.ink, 1.5 * pen) - 1e-6);
    }
  });

  it('sets the rotate glyph’s fraction in the diagram’s font, as a run a page counts', () => {
    const painted = paintAnnotations(
      [a('r', 'rotate', { rotate: { amount: 'eighth', direction: 'cw' } })],
      { x: 0, y: 0, width: 100, height: 75 },
      100,
      DEFAULT_DIAGRAM_STYLE
    )!;
    expect(painted.markup).toContain(`font-family="'Noto Sans', sans-serif" font-weight="700">1/8</text>`);
    expect(painted.markup).toContain('>1/8</text>');
    expect(painted.markup).not.toContain('Inter');
  });
});
