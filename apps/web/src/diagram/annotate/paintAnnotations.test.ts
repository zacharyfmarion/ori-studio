import { describe, expect, it } from 'vitest';
import { DEFAULT_PAPER_STYLE, PEN_WIDTH_RANGE, PT_TO_CSS_PX } from '../../lib/paper/paperStyle';
import { canvasDiagramInk, DIAGRAM_ROTATE_INK, DIAGRAM_TURN_OVER_INK } from '../../cp-workspace/references/diagram/diagramInk';
import { DEFAULT_DIAGRAM_STYLE, type DiagramAnnotation, type KnownDiagramAnnotation } from '../document/diagramDocument';
import {
  divisionsDrawn,
  foldArrowDrawn,
  halfArrowheadCorners,
  oneWayArrowDrawn,
  pathArrowDrawn,
  polylineMitres,
  pushArrowDrawn,
  rotateGlyphDrawn,
  whiteArrowDrawn,
  TURN_OVER_BOX,
  TURN_OVER_HEAD,
  TURN_OVER_PATH,
  type Arrowhead,
  type DiagramArc,
  type SvgPoint,
} from '../../cp-workspace/references/stepDiagramGeometry';
import { cubicPoint } from '../../lib/cubicBezier';
import { ARROW_BEND, CALLOUT_TEXT_SIZE, calloutShape } from './annotationModel';
import { arcToPath } from './annotationPath';
import { STEP_DIAGRAM_LINE_WIDTH } from '../pictures/paintStepDiagram';
import { paintAsset } from '../pictures/paintDiagramStep';
import { annotationDrawing, annotationReach, annotationScene, annotationTextRuns, divisionsCrowded, labelRuns } from './annotationPrimitives';
import { ANNOTATION_INK_MM } from './canvasInk';
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

  it('draws a white arrow along its path, in its width, tail and fill, a straight one too', () => {
    const bent = a('w', 'white-arrow', { from: [0.2, 0.4], to: [0.8, 0.4], path, width: 'wide', tail: 'cleft', fill: 'black' });
    const straight = a('s', 'white-arrow', { from: [0.2, 0.6], to: [0.8, 0.6], path: [{ at: [0.2, 0.6] }, { at: [0.8, 0.6] }] });
    const drawing = annotationDrawing([bent, straight], FRAME, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE);
    expect(drawing.primitives).toEqual([
      {
        kind: 'white-arrow',
        width: 'wide',
        tail: 'cleft',
        fill: 'black',
        // y up, as References' unit frame is.
        path: [
          [[0.2, -0.4], [0.3, -0.1], [0.4, -0.7], [0.5, -0.4]],
          [[0.5, -0.4], [0.6, -0.1], [0.7, -0.7], [0.8, -0.4]],
        ],
      },
      {
        // Written with no look: the template's, regular, pointed and white.
        kind: 'white-arrow',
        width: 'regular',
        tail: 'pointed',
        fill: 'white',
        path: [[[0.2, -0.6], [0.2, -0.6], [0.8, -0.6], [0.8, -0.6]]],
      },
    ]);
    expect(drawing.primitiveIds).toEqual(['w', 's']);
    // A path of no length draws nothing.
    const stub = a('p', 'white-arrow', { from: [0.5, 0.5], to: [0.5, 0.5], path: [{ at: [0.5, 0.5] }, { at: [0.5, 0.5] }] });
    expect(annotationDrawing([stub], FRAME, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE).primitives).toEqual([]);
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

describe('a circle', () => {
  const ink = canvasDiagramInk(STEP_DIAGRAM_LINE_WIDTH);
  const circle = a('c', 'circle', { from: [0.5, 0.5], to: [0.5, 0.5] });

  it('is References’ ring round a point, in the annotation pen and ink, with no letter', () => {
    const drawing = annotationDrawing([circle], FRAME, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE);
    // y up, as References' unit frame is.
    expect(drawing.primitives).toEqual([{ kind: 'point', at: [0.5, -0.5], style: 'highlight' }]);
    expect(drawing.labels).toEqual([]);
    const arrow = a('v', 'valley-arrow', { from: [0.1, 0.2], to: [0.4, 0.2], bend: ARROW_BEND });
    const { markup } = paintAnnotations([circle, arrow], { x: 0, y: 0, width: 400, height: 300 }, 400, DEFAULT_DIAGRAM_STYLE)!;
    const ring = /<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)" stroke-width="([\d.]+)"[^>]*fill="none" stroke="([^"]+)"/.exec(
      markup
    );
    expect(ring).not.toBeNull();
    const [, cx, cy, r, width, stroke] = ring!;
    expect([Number(cx), Number(cy)]).toEqual([200, 200]);
    // 3.07 ink, about a millimetre printed (decision 7).
    expect(Number(r)).toBeCloseTo(3.07 * ink, 2);
    // The annotation pen: three quarters of the arrow's stroke, in the arrow's ink.
    const [, shaft] = /<path d="M [^"]*A [^"]*" stroke-width="([\d.]+)"/.exec(markup)!;
    const [, head] = /<path d="M [^"]*Z" fill="([^"]+)"/.exec(markup)!;
    expect(Number(width)).toBeCloseTo(0.75 * Number(shaft), 3);
    expect(stroke).toBe(head);
    expect(markup).not.toContain('<text');
    // In a style whose arrows are not its edges' colour, the arrows' — References rings in the edges'.
    const red = { style: { ...DEFAULT_PAPER_STYLE, arrows: { ...DEFAULT_PAPER_STYLE.arrows, color: '#cc0000' } } };
    const coloured = paintAnnotations([circle], { x: 0, y: 0, width: 400, height: 300 }, 400, red)!.markup;
    expect(coloured).toMatch(/<circle [^>]*stroke="#cc0000"/);
  });

  it('stops an arrow that lands on its centre at its rim, as References’ rings do', () => {
    const arrow = a('v', 'valley-arrow', { from: [0.2, 0.5], to: [0.5, 0.5], bend: ARROW_BEND });
    const tipOf = (annotations: KnownDiagramAnnotation[]) => {
      const markup = paintAnnotations(annotations, { x: 0, y: 0, width: 400, height: 300 }, 400, DEFAULT_DIAGRAM_STYLE)!.markup;
      // The valley's head: a filled triangle from its tip.
      const [, x, y] = /<path d="M ([-\d.]+) ([-\d.]+) L [^"]*Z" fill=/.exec(markup)!;
      return [Number(x), Number(y)];
    };
    const free = tipOf([arrow]);
    const landed = tipOf([circle, arrow]);
    expect(Math.hypot(free[0]! - 200, free[1]! - 200)).toBeLessThan(0.5);
    // The ring's radius short of the centre: on the ring.
    expect(Math.hypot(landed[0]! - 200, landed[1]! - 200)).toBeCloseTo(3.07 * ink, 0);
  });

  it('reaches past the frame as far as its ring', () => {
    const off = a('c', 'circle', { from: [-0.1, 0.5], to: [-0.1, 0.5] });
    const painted = paintAnnotations([off], { x: 0, y: 0, width: 400, height: 300 }, 400, DEFAULT_DIAGRAM_STYLE)!;
    const ringWidth = Number(/<circle [^>]*stroke-width="([\d.]+)"/.exec(painted.markup)![1]);
    expect(painted.bounds.x).toBeCloseTo(-40 - 3.07 * ink - ringWidth / 2, 3);
  });
});

describe('a right angle (Revision 2)', () => {
  const ink = canvasDiagramInk(STEP_DIAGRAM_LINE_WIDTH);
  // At the vertex (0.5, 0.5), opening down and to the right.
  const square = a('r', 'right-angle', { from: [0.5, 0.5], to: [0.52, 0.52] });
  const number = '(-?[\\d.]+)';
  const run = `M ${number} ${number} L ${number} ${number} L ${number} ${number}`;
  const markPath = new RegExp(
    `<path d="${run} ${run}" stroke-width="([\\d.]+)" stroke-linecap="butt" stroke-linejoin="miter" fill="none" stroke="([^"]+)"`
  );

  it('is an ∟ set 2 ink into the angle with a 3.5-ink square in its corner, one path in the aux lines’ pen and the arrows’ ink, mitred and cut square', () => {
    const drawing = annotationDrawing([square], FRAME, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE);
    // y up, as References' unit frame is.
    expect(drawing.primitives).toEqual([{ kind: 'right-angle', at: [0.5, -0.5], toward: [0.52, -0.52] }]);
    const arrow = a('v', 'valley-arrow', { from: [0.1, 0.2], to: [0.4, 0.2], bend: ARROW_BEND });
    const { markup } = paintAnnotations([square, arrow], { x: 0, y: 0, width: 400, height: 300 }, 400, DEFAULT_DIAGRAM_STYLE)!;
    const mark = markPath.exec(markup);
    expect(mark).not.toBeNull();
    const numbers = mark!.slice(1, 13).map(Number);
    // From the vertex (200, 200): the ∟ — a leg along x, its corner 2 ink in, a leg along y — then the
    // square's far sides, from the first leg round its far corner to the second.
    const expected = [
      [7.5, 2],
      [2, 2],
      [2, 7.5],
      [5.5, 2],
      [5.5, 5.5],
      [2, 5.5],
    ].flatMap(([x, y]) => [200 + x! * ink, 200 + y! * ink]);
    numbers.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 2));
    const [width, stroke] = [Number(mark![13]), mark![14]];
    // The aux lines' pen — the Diagram preset's 0.25 pt, a third of its arrows' 0.75 — in the arrow's ink.
    const [, shaft] = /<path d="M [^"]*A [^"]*" stroke-width="([\d.]+)"/.exec(markup)!;
    const [, head] = /<path d="M [^"]*Z" fill="([^"]+)"/.exec(markup)!;
    expect(width).toBeCloseTo(0.25 * PT_TO_CSS_PX, 3);
    expect(Number(shaft)).toBeCloseTo(0.75 * PT_TO_CSS_PX, 3);
    expect(stroke).toBe(head);
    // Mitred though the page joins round, which wraps every mark.
    expect(markup.startsWith('<g stroke-linejoin="round">')).toBe(true);
  });

  it('reaches past the frame as far as its legs’ ends', () => {
    // At the frame's top-left corner, opening up and out of it: its legs end 7.5 ink out along the frame's edges.
    const out = a('r', 'right-angle', { from: [0, 0], to: [-0.02, -0.02] });
    const painted = paintAnnotations([out], { x: 0, y: 0, width: 400, height: 300 }, 400, DEFAULT_DIAGRAM_STYLE)!;
    const width = Number(/stroke-width="([\d.]+)" stroke-linecap="butt"/.exec(painted.markup)![1]);
    expect(painted.bounds.x).toBeCloseTo(-7.5 * ink - width / 2, 3);
    expect(painted.bounds.y).toBeCloseTo(-7.5 * ink - width / 2, 3);
  });
});

describe('equal divisions (Revision 2)', () => {
  const ink = canvasDiagramInk(STEP_DIAGRAM_LINE_WIDTH);
  // Along the top edge, their line above it, off the picture.
  const top = a('d', 'divisions', { from: [0.1, 0], to: [0.9, 0], parts: 4, offset: 2.5, mirrored: true });

  it('compile to References’ primitive, their offset — a print length in mm — in the drawing’s ink, y up', () => {
    const drawing = annotationDrawing([{ ...top, ticks: 2, numbered: true }], FRAME, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE);
    expect(drawing.primitives).toEqual([
      {
        kind: 'divisions',
        from: [0.1, -0],
        to: [0.9, -0],
        parts: 4,
        offset: 2.5 / ANNOTATION_INK_MM,
        mirrored: true,
        ticks: 2,
        numbered: true,
      },
    ]);
    // An ink is 0.331 mm wherever it prints: 2.5 mm is about 7.6 ink.
    expect(ANNOTATION_INK_MM).toBeCloseTo(0.3307, 4);
  });

  it('draw every stroke as one path in the aux creases’ pen, in either preset, the count set as a page sets the rotate glyph’s fraction (Revision 3)', () => {
    for (const [style, auxPt] of [
      [DEFAULT_DIAGRAM_STYLE, 0.25],
      [{ preset: 'default' } as const, 0.5],
    ] as const) {
      const { markup } = paintAnnotations([{ ...top, parts: 7, numbered: true }], { x: 0, y: 0, width: 400, height: 300 }, 400, style)!;
      const paths = [...markup.matchAll(/<path d="(M[^"]*)" stroke-width="([\d.]+)" stroke-linecap="butt" fill="none" stroke="([^"]+)"/g)];
      expect(paths).toHaveLength(1);
      // The Diagram preset's aux creases are 0.25 pt, the Default's 0.5 pt: the line's pen, as it was, and now the dividers' and ticks'.
      expect(Number(paths[0]![2])).toBeCloseTo(auxPt * PT_TO_CSS_PX, 3);
      // The line, eight dividers and seven ticks.
      expect(paths[0]![1].match(/M/g)).toHaveLength(1 + 8 + 7);
      expect(markup).toContain(`font-family="'Noto Sans', sans-serif" font-weight="700">7</text>`);
      expect(markup).not.toContain('Inter');
      // Above the edge: 2.5 mm, then 1.65 mm of dividers past it.
      const divider = [...paths[0]![1].matchAll(/M ([\d.]+) (-?[\d.]+) L ([\d.]+) (-?[\d.]+)/g)][1]!;
      expect(Number(divider[2])).toBeCloseTo(0, 6);
      expect(Number(divider[4])).toBeCloseTo(-(2.5 / ANNOTATION_INK_MM + 5) * ink, 2);
    }
  });

  it('reach each stroke’s ink and the count’s box and no further, at either style’s pens and any size', () => {
    const heavy = { style: { ...DEFAULT_PAPER_STYLE, arrows: { ...DEFAULT_PAPER_STYLE.arrows, width: PEN_WIDTH_RANGE.max } } };
    const marks = [
      { ...top, numbered: true as const },
      a('d-slant', 'divisions', { from: [0.95, 0.2], to: [1.05, 0.9], parts: 32, offset: 0, ticks: 3 }),
      a('d-left', 'divisions', { from: [0, 0.9], to: [0, 0.1], parts: 12, offset: 15, numbered: true }),
    ];
    for (const style of [DEFAULT_DIAGRAM_STYLE, heavy]) {
      for (const framePx of [300, 1000]) {
        for (const mark of marks) {
          const drawing = annotationDrawing([mark], { width: 1, height: 1 }, framePx, style);
          const primitive = drawing.primitives[0]!;
          if (primitive.kind !== 'divisions') throw new Error('not divisions');
          const shape = divisionsDrawn(primitive.from, primitive.to, primitive, drawing.context.project)!;
          let [minX, minY, maxX, maxY] = [0, 0, framePx, framePx];
          const take = (x: number, y: number, pad: number) => {
            [minX, minY, maxX, maxY] = [Math.min(minX, x - pad), Math.min(minY, y - pad), Math.max(maxX, x + pad), Math.max(maxY, y + pad)];
          };
          // A butt end reaches half its pen to each side of it, and no further along.
          for (const stroke of [shape.line, ...shape.dividers, ...shape.ticks]) {
            for (const end of stroke) take(end.x, end.y, shape.pen / 2);
          }
          if (shape.number) {
            const { at, halfWidth, halfHeight } = shape.number;
            take(at.x - halfWidth, at.y - halfHeight, 0);
            take(at.x + halfWidth, at.y + halfHeight, 0);
          }
          const reach = annotationReach(drawing);
          const name = `${mark.id} ${framePx}`;
          expect(reach.x, name).toBeCloseTo(minX, 6);
          expect(reach.y, name).toBeCloseTo(minY, 6);
          expect(reach.x + reach.width, name).toBeCloseTo(maxX, 6);
          expect(reach.y + reach.height, name).toBeCloseTo(maxY, 6);
        }
      }
    }
  });

  it('crowd at 32 parts on a 25 mm edge with three ticks, and not with one, nor on a 50 mm edge with two', () => {
    const edge = a('d', 'divisions', { from: [0, 0], to: [1, 0], parts: 32, offset: 2.5, ticks: 3 });
    expect(divisionsCrowded(edge, { width: 1, height: 1 }, 25, DEFAULT_DIAGRAM_STYLE)).toBe(true);
    expect(divisionsCrowded({ ...edge, ticks: undefined }, { width: 1, height: 1 }, 25, DEFAULT_DIAGRAM_STYLE)).toBe(false);
    expect(divisionsCrowded({ ...edge, parts: 4, ticks: 2 }, { width: 1, height: 1 }, 50, DEFAULT_DIAGRAM_STYLE)).toBe(false);
    expect(divisionsCrowded(a('l', 'valley-line'), { width: 1, height: 1 }, 25, DEFAULT_DIAGRAM_STYLE)).toBe(false);
  });
});

describe('a callout', () => {
  const callout = a('c', 'callout', { from: [0.2, 0.7], to: [0.6, 0.3], text: 'Repeat behind 裏も' });
  const box = { x: 0, y: 0, width: 400, height: 300 };

  it('is a line in the annotation pen to a white box outlined in the arrow pen, its words set as a label’s', () => {
    const arrow = a('v', 'valley-arrow', { from: [0.1, 0.2], to: [0.4, 0.2], bend: ARROW_BEND });
    const { markup } = paintAnnotations([callout, arrow], box, 400, DEFAULT_DIAGRAM_STYLE)!;
    const [, shaft] = /<path d="M [^"]*A [^"]*" stroke-width="([\d.]+)"/.exec(markup)!;
    const [, head] = /<path d="M [^"]*Z" fill="([^"]+)"/.exec(markup)!;
    const line = /<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)" fill="none" stroke="([^"]+)" stroke-width="([\d.]+)" stroke-linecap="round"/.exec(markup)!;
    const rect = /<rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="([^"]+)" stroke="([^"]+)" stroke-width="([\d.]+)" stroke-linejoin="miter"/.exec(markup)!;
    expect(line).not.toBeNull();
    expect(rect).not.toBeNull();
    // The line from the point to the box's edge, in the annotation pen: a circle's ring's, three quarters of the arrow's.
    const shape = calloutShape(callout);
    expect([Number(line[1]), Number(line[2])]).toEqual([80, 280]);
    expect(Number(line[3])).toBeCloseTo(shape.line![1][0] * 400, 6);
    expect(Number(line[4])).toBeCloseTo(shape.line![1][1] * 400, 6);
    expect(Number(line[6])).toBeCloseTo(0.75 * Number(shaft), 3);
    // The box, filled with the page's white, outlined in the arrow pen, in the arrow's ink: the pen
    // outside the box its words were measured for, so it never covers them.
    const pen = Number(rect[7]);
    expect(Number(rect[1])).toBeCloseTo(shape.box.x * 400 - pen / 2, 6);
    expect(Number(rect[4])).toBeCloseTo(shape.box.height * 400 + pen, 6);
    expect(rect[5]).toBe('#ffffff');
    expect(Number(rect[7])).toBeCloseTo(Number(shaft), 3);
    expect([line[5], rect[6]]).toEqual([head, head]);
    // Its words, centred on the box's middle as a label's are on its point, each script in its font.
    const text = /<text x="([-\d.]+)" y="([-\d.]+)" font-size="([\d.]+)" text-anchor="middle" fill="([^"]+)">(.*?)<\/text>/.exec(markup)!;
    expect(Number(text[1])).toBeCloseTo(240, 3);
    expect(Number(text[2])).toBeCloseTo(120 + 0.36 * CALLOUT_TEXT_SIZE * 400, 3);
    expect(Number(text[3])).toBeCloseTo(CALLOUT_TEXT_SIZE * 400, 3);
    expect(text[4]).toBe(head);
    expect(text[5]).toBe(
      `<tspan font-family="&#x27;Noto Sans&#x27;, sans-serif" font-weight="400">Repeat behind </tspan>` +
        `<tspan font-family="&#x27;Noto Sans JP&#x27;, sans-serif" font-weight="400">裏も</tspan>`
    );
    // Line, box, then words — over the arrow, drawn first.
    expect(markup.indexOf('<line')).toBeGreaterThan(markup.indexOf('A '));
    expect(markup.indexOf('<rect')).toBeGreaterThan(markup.indexOf('<line'));
    expect(markup.indexOf('<text')).toBeGreaterThan(markup.indexOf('<rect'));
  });

  it('is drawn over the marks and under the labels, whatever their order', () => {
    const label = a('l', 'label', { from: [0.6, 0.3], to: [0.6, 0.3], text: 'A' });
    const push = a('p', 'push-arrow', { from: [0.5, 0.3], to: [0.7, 0.3] });
    const { markup } = paintAnnotations([label, callout, push], box, 400, DEFAULT_DIAGRAM_STYLE)!;
    const push0 = markup.indexOf('stroke-linejoin="miter"');
    expect(markup.indexOf('<rect')).toBeGreaterThan(push0);
    expect(markup.lastIndexOf('<text')).toBeGreaterThan(markup.indexOf('<rect'));
    expect(markup.slice(markup.lastIndexOf('<text'))).toContain('>A</tspan>');
  });

  it('has no line with its point inside its box, and draws nothing with no words', () => {
    const covered = { ...callout, from: [0.61, 0.31] as [number, number] };
    const { markup } = paintAnnotations([covered], box, 400, DEFAULT_DIAGRAM_STYLE)!;
    expect(markup).not.toContain('<line');
    expect(markup).toContain('<rect');
    expect(paintAnnotations([{ ...callout, text: '  ' }], box, 400, DEFAULT_DIAGRAM_STYLE)).toBeNull();
  });

  it('sets its words as runs a page loads its fonts for, Han in the diagram’s style', () => {
    expect(annotationTextRuns([a('c', 'callout', { text: 'Repeat 中文' }), a('v', 'valley-line')], 'tc')).toEqual([
      { face: { key: 'latin', weight: 400 }, text: 'Repeat ' },
      { face: { key: 'tc', weight: 400 }, text: '中文' },
    ]);
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

  it('reaches as far as a pleat arrow’s Zs mitre with a heavy pen, out past the frame (15c)', () => {
    const pt = 3;
    const style = { style: { ...DEFAULT_PAPER_STYLE, arrows: { ...DEFAULT_PAPER_STYLE.arrows, width: pt } } };
    const box = { x: 0, y: 0, width: 189, height: 189 };
    // Along the top edge, pointing right, its Zs stepping up off the picture.
    const pleat = a('z', 'pleat-arrow', { from: [0.1, 0], to: [0.9, 0], kinks: 3, mirrored: true });
    const painted = paintAnnotations([pleat], box, 189, style)!;
    const pen = pt * PT_TO_CSS_PX;
    const bolt = [...painted.markup.matchAll(/d="(M[^"Z]*)"/g)].map((match) => match[1]!).find((d) => d.split('L').length > 4)!;
    const numbers = bolt.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const points = Array.from({ length: numbers.length / 2 }, (_, i) => ({ x: numbers[2 * i]!, y: numbers[2 * i + 1]! }));
    const mitres = polylineMitres(points, pen);
    // A mitre each Z's corners make, standing past the half pen round them.
    expect(mitres).toHaveLength(6);
    expect(Math.min(...mitres.map(({ y }) => y))).toBeLessThan(Math.min(...points.map(({ y }) => y)) - pen / 2);
    for (const { x, y } of [...mitres, ...points]) {
      expect(x).toBeGreaterThanOrEqual(painted.bounds.x);
      expect(y).toBeGreaterThanOrEqual(painted.bounds.y - 1e-9);
      expect(x).toBeLessThanOrEqual(painted.bounds.x + painted.bounds.width);
      expect(y).toBeLessThanOrEqual(painted.bounds.y + painted.bounds.height);
    }
    expect(painted.bounds.y).toBeLessThan(0);
  });

  it('reaches as far as a fold-and-unfold arrow’s return, which bulges past its outgoing arc', () => {
    const fold = a('f', 'fold-unfold-arrow', { from: [0.1, 0.02], to: [0.9, 0.02], bend: 0.03 });
    const painted = paintAnnotations([fold], { x: 0, y: 0, width: 453, height: 340 }, 453, DEFAULT_DIAGRAM_STYLE)!;
    // The return's sagitta: well above the top edge, where the outgoing arc barely leaves it.
    expect(painted.bounds.y).toBeLessThan(-0.15 * 0.8 * 453);
  });

  it('reaches each arrow’s ink and no further, at any pen: half a pen round its strokes, a filled head to its corners, a mountain’s outline mitred (review 4)', () => {
    // Its reach was a whole pen round its strokes and 1.5 pens round its head's every corner, a mountain's spread barb
    // on both sides: up to 1.3 mm past its ink at the default pen, 10 mm at the heaviest.
    const heavy = { style: { ...DEFAULT_PAPER_STYLE, arrows: { ...DEFAULT_PAPER_STYLE.arrows, width: PEN_WIDTH_RANGE.max } } };
    const cornered = (kind: 'valley-arrow' | 'mountain-arrow' | 'fold-unfold-arrow', dx: number, dy: number) => {
      const path = [{ at: [0.2 + dx, 0.7 + dy] as [number, number] }, { at: [0.5 + dx, 0.3 + dy] as [number, number], type: 'corner' as const }, { at: [0.6 + dx, 0.75 + dy] as [number, number] }];
      return a('c', kind, { from: path[0]!.at, to: path[2]!.at, path });
    };
    const arrows = (dx: number, dy: number) => [
      a('v', 'valley-arrow', { from: [0.2 + dx, 0.5 + dy], to: [0.8 + dx, 0.5 + dy], bend: 0.15 }),
      a('v', 'valley-arrow', { from: [0.2 + dx, 0.5 + dy], to: [0.8 + dx, 0.5 + dy], bend: 0.01 }),
      a('m', 'mountain-arrow', { from: [0.2 + dx, 0.5 + dy], to: [0.8 + dx, 0.5 + dy], bend: 0.15 }),
      a('f', 'fold-unfold-arrow', { from: [0.2 + dx, 0.5 + dy], to: [0.8 + dx, 0.5 + dy], bend: 0.15 }),
      arcToPath(a('s', 'mountain-arrow', { from: [0.2 + dx, 0.5 + dy], to: [0.8 + dx, 0.5 + dy], bend: 0.3 })),
      cornered('valley-arrow', dx, dy),
      cornered('mountain-arrow', dx, dy),
      cornered('fold-unfold-arrow', dx, dy),
    ];
    const framePx = 200;
    for (const style of [DEFAULT_DIAGRAM_STYLE, heavy]) {
      // Past each side of the frame in turn, so each side of the reach is the arrow's own.
      for (const [dx, dy] of [[-1.2, 0], [1.2, 0], [0, -1.2], [0, 1.2]] as const) {
        for (const arrow of arrows(dx, dy)) {
          const drawing = annotationDrawing([arrow], { width: 1, height: 1 }, framePx, style);
          const { project, marks } = drawing.context;
          const half = (project.pens.arrow.width * project.ink) / 2;
          const ink = { left: 0, top: 0, right: framePx, bottom: framePx };
          const take = ({ x, y }: { x: number; y: number }, r: number) => {
            ink.left = Math.min(ink.left, x - r);
            ink.right = Math.max(ink.right, x + r);
            ink.top = Math.min(ink.top, y - r);
            ink.bottom = Math.max(ink.bottom, y + r);
          };
          // Its strokes sampled finely, round-capped and round-joined as a page draws them, half a pen round.
          const arc = (each: DiagramArc | null) => {
            if (!each) return;
            const sweep = each.ccw ? each.to - each.from : each.from - each.to;
            const extent = ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
            for (let i = 0; i <= 4000; i += 1) {
              const angle = each.from + (each.ccw ? 1 : -1) * extent * (i / 4000);
              take(project([each.center[0] + each.radius * Math.cos(angle), each.center[1] + each.radius * Math.sin(angle)]), half);
            }
          };
          const filled = (head: Arrowhead) => [head.tip, ...head.barbs].forEach((corner) => take(corner, 0));
          // A mountain's outline, mitred: each corner where its edges' outer sides meet, bevelled past SVG's limit of 4.
          const mitred = (outline: readonly SvgPoint[]) =>
            outline.forEach((corner, index) => {
              const before = outline[(index + outline.length - 1) % outline.length]!;
              const after = outline[(index + 1) % outline.length]!;
              const unit = (from: SvgPoint, to: SvgPoint) => {
                const length = Math.hypot(to.x - from.x, to.y - from.y);
                return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
              };
              const [u, w] = [unit(before, corner), unit(corner, after)];
              // The outer side of the turn: the normals pointing away from where the outline turns.
              const turn = Math.sign(u.x * w.y - u.y * w.x);
              const [nu, nw] = [{ x: u.y * turn, y: -u.x * turn }, { x: w.y * turn, y: -w.x * turn }];
              // The two offset edges' meeting point.
              const p = { x: corner.x + nu.x * half, y: corner.y + nu.y * half };
              const q = { x: corner.x + nw.x * half, y: corner.y + nw.y * half };
              const denominator = u.x * w.y - u.y * w.x;
              const t = ((q.x - p.x) * w.y - (q.y - p.y) * w.x) / denominator;
              const tip = { x: p.x + u.x * t, y: p.y + u.y * t };
              if (Math.hypot(tip.x - corner.x, tip.y - corner.y) <= 4 * half) take(tip, 0);
              else [p, q].forEach((end) => take(end, 0));
            });
          const primitive = drawing.primitives[0]!;
          if (primitive.kind === 'fold-arrow') {
            const drawn = foldArrowDrawn(primitive.out, project, marks)!;
            arc(drawn.out);
            arc(drawn.back);
            filled(drawn.head);
          } else if (primitive.kind === 'one-way-arrow') {
            const drawn = oneWayArrowDrawn(primitive.out, project, marks);
            arc(drawn.shaft);
            if (primitive.fold === 'mountain') mitred(halfArrowheadCorners(drawn.head, project(primitive.out.center)));
            else filled(drawn.head);
          } else if (primitive.kind === 'path-arrow') {
            const drawn = pathArrowDrawn(primitive.path, primitive.fold, project, marks)!;
            for (const cubic of drawn.shaft ?? []) for (let i = 0; i <= 2000; i += 1) {
              const [x, y] = cubicPoint(cubic, i / 2000);
              take({ x, y }, half);
            }
            for (const [x, y] of drawn.back ?? []) take({ x, y }, half);
            if (primitive.fold === 'mountain') mitred(halfArrowheadCorners(drawn.head, drawn.inside));
            else filled(drawn.head);
          } else {
            throw new Error(`an arrow, not ${primitive.kind}`);
          }
          const reach = paintAnnotations([arrow], { x: 0, y: 0, width: framePx, height: framePx }, framePx, style)!.bounds;
          const name = `${arrow.kind} ${arrow.path ? 'shaped' : arrow.bend}, ${dx} ${dy}, pen ${project.pens.arrow.width}`;
          expect(Math.abs(ink.left - reach.x), name).toBeLessThan(0.01);
          expect(Math.abs(ink.top - reach.y), name).toBeLessThan(0.01);
          expect(Math.abs(reach.x + reach.width - ink.right), name).toBeLessThan(0.01);
          expect(Math.abs(reach.y + reach.height - ink.bottom), name).toBeLessThan(0.01);
        }
      }
    }
  });

  it('keeps every drawn stroke inside its reach: a nearly flat arc between its points, a shaped shaft at a thin pen', () => {
    const thin = { style: { ...DEFAULT_PAPER_STYLE, arrows: { ...DEFAULT_PAPER_STYLE.arrows, width: 0.1 } } };
    const cases: Array<{ arrow: KnownDiagramAnnotation; framePx: number; style: typeof DEFAULT_DIAGRAM_STYLE }> = [
      { arrow: a('v', 'valley-arrow', { from: [0.1, -0.1], to: [0.9, -0.1], bend: 0.03 }), framePx: 1000, style: DEFAULT_DIAGRAM_STYLE },
      { arrow: a('m', 'mountain-arrow', { from: [-0.5, -0.1], to: [1.5, -0.1], bend: 0.01 }), framePx: 1000, style: DEFAULT_DIAGRAM_STYLE },
      { arrow: a('f', 'fold-unfold-arrow', { from: [0.1, -0.1], to: [0.9, -0.1], bend: 0.03 }), framePx: 600, style: thin },
      { arrow: arcToPath(a('s', 'valley-arrow', { from: [-0.05, -0.05], to: [0.35, -0.102], bend: 0.3 })), framePx: 453, style: DEFAULT_DIAGRAM_STYLE },
      { arrow: arcToPath(a('t', 'valley-arrow', { from: [-0.05, -0.05], to: [-0.03, -0.06], bend: 0.5 })), framePx: 600, style: thin },
    ];
    for (const { arrow, framePx, style } of cases) {
      const drawing = annotationDrawing([arrow], { width: 1, height: 1 }, framePx, style);
      const { project, marks } = drawing.context;
      const primitive = drawing.primitives[0]!;
      // The ink as drawn: arcs and cubics sampled finely, not at the points the reach is measured along.
      const ink: { x: number; y: number }[] = [];
      const arc = (each: DiagramArc | null) => {
        if (!each) return;
        const sweep = each.ccw ? each.to - each.from : each.from - each.to;
        const extent = ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        for (let i = 0; i <= 4000; i += 1) {
          const angle = each.from + (each.ccw ? 1 : -1) * extent * (i / 4000);
          ink.push(project([each.center[0] + each.radius * Math.cos(angle), each.center[1] + each.radius * Math.sin(angle)]));
        }
      };
      if (primitive.kind === 'fold-arrow') {
        const drawn = foldArrowDrawn(primitive.out, project, marks)!;
        arc(drawn.out);
        arc(drawn.back);
      } else if (primitive.kind === 'one-way-arrow') {
        arc(oneWayArrowDrawn(primitive.out, project, marks).shaft);
      } else if (primitive.kind === 'path-arrow') {
        const drawn = pathArrowDrawn(primitive.path, primitive.fold, project, marks)!;
        for (const cubic of drawn.shaft ?? []) {
          for (let i = 0; i <= 2000; i += 1) {
            const [x, y] = cubicPoint(cubic, i / 2000);
            ink.push({ x, y });
          }
        }
      } else {
        throw new Error(`an arrow, not ${primitive.kind}`);
      }
      expect(ink.length).toBeGreaterThan(0);
      const painted = paintAnnotations([arrow], { x: 0, y: 0, width: framePx, height: framePx }, framePx, style)!;
      const half = (project.pens.arrow.width * project.ink) / 2;
      const { x, y, width, height } = painted.bounds;
      for (const point of ink) {
        expect(point.x - half).toBeGreaterThanOrEqual(x - 1e-6);
        expect(point.y - half).toBeGreaterThanOrEqual(y - 1e-6);
        expect(point.x + half).toBeLessThanOrEqual(x + width + 1e-6);
        expect(point.y + half).toBeLessThanOrEqual(y + height + 1e-6);
      }
    }
  });

  it('keeps a crease line inside its reach at any pen, its ends and its sides, round-capped or not (review)', () => {
    const heavy = (cap: 'butt' | 'round') => ({
      style: {
        ...DEFAULT_PAPER_STYLE,
        valleyDiagramCreases: { ...DEFAULT_PAPER_STYLE.valleyDiagramCreases, width: PEN_WIDTH_RANGE.max, cap },
        mountainDiagramCreases: { ...DEFAULT_PAPER_STYLE.mountainDiagramCreases, width: PEN_WIDTH_RANGE.max, cap },
        edges: { ...DEFAULT_PAPER_STYLE.edges, width: PEN_WIDTH_RANGE.max },
      },
    });
    const lines = [
      a('v', 'valley-line', { from: [0.1, 0], to: [0.9, 0] }),
      a('m', 'mountain-line', { from: [0.5, 0], to: [0.5, 0.6] }),
      a('h', 'hidden-line', { from: [1, 0.2], to: [1, 0.8] }),
    ];
    for (const style of [DEFAULT_DIAGRAM_STYLE, heavy('butt'), heavy('round')]) {
      for (const line of lines) {
        const painted = paintAnnotations([line], { x: 0, y: 0, width: 300, height: 300 }, 1000, style)!;
        // The line as painted, in the box's units: its ends, and half its stroke round them.
        const element = /<line[^>]*>/.exec(painted.markup)![0];
        const attribute = (name: string) => Number(new RegExp(`${name}="([-\\d.]+)"`).exec(element)![1]);
        const half = attribute('stroke-width') / 2;
        const [x1, y1, x2, y2] = [attribute('x1'), attribute('y1'), attribute('x2'), attribute('y2')];
        const { x, y, width, height } = painted.bounds;
        const name = `${line.kind}, ${JSON.stringify(style).length}`;
        expect(Math.min(x1, x2) - half, name).toBeGreaterThanOrEqual(x - 1e-6);
        expect(Math.min(y1, y2) - half, name).toBeGreaterThanOrEqual(y - 1e-6);
        expect(Math.max(x1, x2) + half, name).toBeLessThanOrEqual(x + width + 1e-6);
        expect(Math.max(y1, y2) + half, name).toBeLessThanOrEqual(y + height + 1e-6);
      }
    }
  });

  it('reaches a turn-over’s ink and no further, at any pen: its curves, not their handles, and half its pen (third review)', () => {
    // Its reach was its handles' box and a whole pen round it: up to 3.5 mm past its ink at the heaviest pen.
    const heavy = { style: { ...DEFAULT_PAPER_STYLE, arrows: { ...DEFAULT_PAPER_STYLE.arrows, width: PEN_WIDTH_RANGE.max } } };
    for (const style of [DEFAULT_DIAGRAM_STYLE, heavy]) {
      for (const axis of ['vertical', 'horizontal'] as const) {
        // On a frame far smaller than the glyph, so its reach is the glyph's.
        const glyph = a('turn', 'turn-over', { from: [0.5, 0.5], to: [0.5, 0.5], axis });
        const framePx = 1;
        const drawing = annotationDrawing([glyph], { width: 1, height: 1 }, framePx, style);
        const { project } = drawing.context;
        const half = (project.pens.arrow.width * project.ink) / 2;
        const primitive = drawing.primitives[0]!;
        if (primitive.kind !== 'turn-over') throw new Error('a turn-over');
        const centre = project(primitive.at);
        const scale = (DIAGRAM_TURN_OVER_INK * project.ink) / TURN_OVER_BOX.width;
        const place = ([px, py]: readonly [number, number]) => {
          const at = { x: centre.x + (px - TURN_OVER_BOX.width / 2) * scale, y: centre.y + (py - TURN_OVER_BOX.height / 2) * scale };
          return axis === 'horizontal' ? { x: centre.x - (at.y - centre.y), y: centre.y + (at.x - centre.x) } : at;
        };
        // The ink: its stroke's cubics sampled, half a pen out each way, and its head's corners.
        const ink = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
        const take = ({ x, y }: { x: number; y: number }, r: number) => {
          ink.left = Math.min(ink.left, x - r);
          ink.right = Math.max(ink.right, x + r);
          ink.top = Math.min(ink.top, y - r);
          ink.bottom = Math.max(ink.bottom, y + r);
        };
        const numbers = TURN_OVER_PATH.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
        const points = Array.from({ length: numbers.length / 2 }, (_, i) => [numbers[2 * i]!, numbers[2 * i + 1]!] as [number, number]);
        for (let start = 0; start + 3 < points.length; start += 3) {
          const cubic = [points[start]!, points[start + 1]!, points[start + 2]!, points[start + 3]!] as const;
          for (let i = 0; i <= 2000; i += 1) take(place(cubicPoint(cubic, i / 2000)), half);
        }
        for (const corner of [TURN_OVER_HEAD.tip, TURN_OVER_HEAD.notch, ...TURN_OVER_HEAD.barbs]) take(place([corner.x, corner.y]), 0);
        const reach = paintAnnotations([glyph], { x: 0, y: 0, width: framePx, height: framePx }, framePx, style)!.bounds;
        const name = `${axis}, pen ${project.pens.arrow.width}`;
        expect(ink.left - reach.x, name).toBeLessThan(0.01);
        expect(ink.top - reach.y, name).toBeLessThan(0.01);
        expect(reach.x + reach.width - ink.right, name).toBeLessThan(0.01);
        expect(reach.y + reach.height - ink.bottom, name).toBeLessThan(0.01);
      }
    }
  });

  it('keeps a push, a white arrow, a rotate, a turn-over and a right angle inside their reach at any pen, the heaviest too, a push and a white arrow no further (reviews)', () => {
    // The heaviest arrow pen, and the heaviest aux pen, which a right angle is drawn in.
    const heavy = {
      style: {
        ...DEFAULT_PAPER_STYLE,
        arrows: { ...DEFAULT_PAPER_STYLE.arrows, width: PEN_WIDTH_RANGE.max },
        auxCreases: { ...DEFAULT_PAPER_STYLE.auxCreases, pen: { ...DEFAULT_PAPER_STYLE.auxCreases.pen, width: PEN_WIDTH_RANGE.max } },
      },
    };
    const white = (id: string, width: 'narrow' | 'regular' | 'wide', tail: 'pointed' | 'square' | 'cleft', path: KnownDiagramAnnotation['path']) =>
      a(id, 'white-arrow', { from: path![0]!.at, to: path![path!.length - 1]!.at, path, width, tail });
    const glyphs = [
      a('push', 'push-arrow', { from: [-0.1, 0.4], to: [0.3, 0.1] }),
      a('push-short', 'push-arrow', { from: [0.02, 0.98], to: [0.05, 1] }),
      // Pointing out past each side of the frame, so its tip, barbs and tail are what the reach is.
      white('white-narrow', 'narrow', 'pointed', [{ at: [0.6, 0.5] }, { at: [1.1, 0.5] }]),
      white('white-wide', 'wide', 'cleft', [{ at: [0.4, 0.5], out: [0.3, 0.2] }, { at: [-0.1, 0.4], in: [0.1, -0.1] }]),
      white('white-corner', 'regular', 'square', [
        { at: [0.5, 0.9] },
        { at: [0.5, 1.1], type: 'corner' },
        { at: [0.2, 1.1] },
      ]),
      white('white-short', 'regular', 'pointed', [{ at: [0.5, -0.02] }, { at: [0.52, -0.04] }]),
      a('rotate', 'rotate', { from: [0, 0], to: [0, 0], rotate: { amount: 'half', direction: 'ccw' } }),
      a('turn', 'turn-over', { from: [1, 0.5], to: [1, 0.5] }),
      a('turn-h', 'turn-over', { from: [0.5, 1], to: [0.5, 1], axis: 'horizontal' }),
      // In the frame's corner, opening out of it; and turned off the axes, off the picture.
      a('square', 'right-angle', { from: [0, 0], to: [-0.01, -0.01] }),
      a('square-turned', 'right-angle', { from: [1.02, 0.4], to: [1.02 + Math.cos(2), 0.4 + Math.sin(2)] }),
    ];
    for (const style of [DEFAULT_DIAGRAM_STYLE, heavy]) {
      for (const framePx of [300, 1000]) {
        for (const glyph of glyphs) {
          const drawing = annotationDrawing([glyph], { width: 1, height: 1 }, framePx, style);
          const { project } = drawing.context;
          const primitive = drawing.primitives[0]!;
          const half = (project.pens.arrow.width * project.ink) / 2;
          // The ink as drawn, its stroke's half-width already out round it.
          const ink: { x: number; y: number }[] = [];
          const round = (x: number, y: number) => {
            for (let i = 0; i < 32; i += 1) {
              const angle = (i / 32) * 2 * Math.PI;
              ink.push({ x: x + half * Math.cos(angle), y: y + half * Math.sin(angle) });
            }
          };
          if (primitive.kind === 'push-arrow') {
            // A mitred outline: each corner's two edges, offset half a pen to either side; on the outer
            // side of its turn they meet at its mitre's tip, or are bevelled where that is past SVG's
            // default limit of 4. (On the inner side they only overlap: an edge shorter than the pen
            // ends before they would meet.)
            const outline = pushArrowDrawn(primitive.from, primitive.to, project)!;
            outline.forEach((corner, index) => {
              const before = outline[(index + outline.length - 1) % outline.length]!;
              const after = outline[(index + 1) % outline.length]!;
              const normal = (p: { x: number; y: number }, q: { x: number; y: number }) => {
                const length = Math.hypot(q.x - p.x, q.y - p.y);
                return { x: -(q.y - p.y) / length, y: (q.x - p.x) / length };
              };
              const [n1, n2] = [normal(before, corner), normal(corner, after)];
              for (const side of [1, -1]) {
                const a1 = { x: corner.x + side * half * n1.x, y: corner.y + side * half * n1.y };
                const a2 = { x: corner.x + side * half * n2.x, y: corner.y + side * half * n2.y };
                ink.push(a1, a2);
                // Where the line through a1 along the first edge meets the line through a2 along the second.
                const d1 = { x: corner.x - before.x, y: corner.y - before.y };
                const d2 = { x: after.x - corner.x, y: after.y - corner.y };
                const cross = d1.x * d2.y - d1.y * d2.x;
                if (Math.abs(cross) < 1e-12) continue;
                const t = ((a2.x - a1.x) * d2.y - (a2.y - a1.y) * d2.x) / cross;
                const tip = { x: a1.x + d1.x * t, y: a1.y + d1.y * t };
                const outer = (tip.x - corner.x) * (d1.x - d2.x) + (tip.y - corner.y) * (d1.y - d2.y) > 0;
                if (outer && Math.hypot(tip.x - corner.x, tip.y - corner.y) <= 4 * half) ink.push(tip);
              }
            });
          } else if (primitive.kind === 'white-arrow') {
            // A mitred outline as SVG strokes it with `stroke-miterlimit="1.5"`: each corner's two
            // edges, offset half a pen to either side, meet on the outer side of its turn at its
            // mitre's tip, or are bevelled where that is past 1.5 half-pens.
            const outline = whiteArrowDrawn(primitive.path, primitive.width, primitive.tail, project)!;
            expect(outline.length).toBeGreaterThan(5);
            outline.forEach((corner, index) => {
              const before = outline[(index + outline.length - 1) % outline.length]!;
              const after = outline[(index + 1) % outline.length]!;
              const normal = (p: { x: number; y: number }, q: { x: number; y: number }) => {
                const length = Math.hypot(q.x - p.x, q.y - p.y);
                return { x: -(q.y - p.y) / length, y: (q.x - p.x) / length };
              };
              const [n1, n2] = [normal(before, corner), normal(corner, after)];
              for (const side of [1, -1]) {
                const a1 = { x: corner.x + side * half * n1.x, y: corner.y + side * half * n1.y };
                const a2 = { x: corner.x + side * half * n2.x, y: corner.y + side * half * n2.y };
                ink.push(a1, a2);
                const d1 = { x: corner.x - before.x, y: corner.y - before.y };
                const d2 = { x: after.x - corner.x, y: after.y - corner.y };
                const cross = d1.x * d2.y - d1.y * d2.x;
                if (Math.abs(cross) < 1e-12) continue;
                const t = ((a2.x - a1.x) * d2.y - (a2.y - a1.y) * d2.x) / cross;
                const tip = { x: a1.x + d1.x * t, y: a1.y + d1.y * t };
                const outer = (tip.x - corner.x) * (d1.x - d2.x) + (tip.y - corner.y) * (d1.y - d2.y) > 0;
                if (outer && Math.hypot(tip.x - corner.x, tip.y - corner.y) <= 1.5 * half) ink.push(tip);
              }
            });
          } else if (primitive.kind === 'rotate') {
            // Its two arcs, sampled, and its filled heads.
            const glyph = rotateGlyphDrawn(primitive.at, primitive.direction, project);
            const radius = DIAGRAM_ROTATE_INK.radius * project.ink;
            expect(glyph.radius).toBe(radius);
            for (const stroke of glyph.strokes) {
              const numbers = stroke.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
              const [sx, sy, ex, ey] = [numbers[0]!, numbers[1]!, numbers[numbers.length - 2]!, numbers[numbers.length - 1]!];
              const from = Math.atan2(sy - glyph.centre.y, sx - glyph.centre.x);
              let to = Math.atan2(ey - glyph.centre.y, ex - glyph.centre.x);
              const cw = primitive.direction === 'cw';
              if (cw && to < from) to += 2 * Math.PI;
              if (!cw && to > from) to -= 2 * Math.PI;
              for (let i = 0; i <= 400; i += 1) {
                const angle = from + (to - from) * (i / 400);
                round(glyph.centre.x + radius * Math.cos(angle), glyph.centre.y + radius * Math.sin(angle));
              }
            }
            for (const head of glyph.heads) ink.push(head.tip, head.notch, ...head.barbs);
          } else if (primitive.kind === 'turn-over') {
            // Its stroke's cubics, sampled, and its filled head, placed as the drawing places them.
            const centre = project(primitive.at);
            const scale = (DIAGRAM_TURN_OVER_INK * project.ink) / TURN_OVER_BOX.width;
            const place = (p: { x: number; y: number }) => {
              const at = {
                x: centre.x + (p.x - TURN_OVER_BOX.width / 2) * scale,
                y: centre.y + (p.y - TURN_OVER_BOX.height / 2) * scale,
              };
              return primitive.axis === 'horizontal' ? { x: centre.x - (at.y - centre.y), y: centre.y + (at.x - centre.x) } : at;
            };
            const numbers = TURN_OVER_PATH.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
            const points = Array.from({ length: numbers.length / 2 }, (_, i) => ({ x: numbers[2 * i]!, y: numbers[2 * i + 1]! }));
            for (let start = 0; start + 3 < points.length; start += 3) {
              const cubic = [points[start]!, points[start + 1]!, points[start + 2]!, points[start + 3]!].map(
                (p) => [p.x, p.y] as [number, number]
              ) as [[number, number], [number, number], [number, number], [number, number]];
              for (let i = 0; i <= 400; i += 1) {
                const [x, y] = cubicPoint(cubic, i / 400);
                const at = place({ x, y });
                round(at.x, at.y);
              }
            }
            for (const corner of [TURN_OVER_HEAD.tip, TURN_OVER_HEAD.notch, ...TURN_OVER_HEAD.barbs]) ink.push(place(corner));
          } else if (primitive.kind === 'right-angle') {
            // An ∟ 2 ink into the angle, its legs 5.5 long, and a 3.5-ink square in its corner, in the aux
            // lines' pen: each run cut square at its two ends and mitred at its corner, its legs 45° either
            // side of the way it opens.
            const pen = project.pens.aux.width * project.ink;
            const vertex = project(primitive.at);
            const toward = project(primitive.toward);
            const opens = Math.atan2(toward.y - vertex.y, toward.x - vertex.x);
            const unit = (turn: number) => ({ x: Math.cos(opens + turn), y: Math.sin(opens + turn) });
            const [legA, legB] = [unit(-Math.PI / 4), unit(Math.PI / 4)];
            const point = (alongA: number, alongB: number) => ({
              x: vertex.x + (alongA * legA.x + alongB * legB.x) * project.ink,
              y: vertex.y + (alongA * legA.y + alongB * legB.y) * project.ink,
            });
            const runs = [
              [point(7.5, 2), point(2, 2), point(2, 7.5)],
              [point(5.5, 2), point(5.5, 5.5), point(2, 5.5)],
            ];
            for (const [start, corner, end] of runs) {
              // A square end: half the pen either side, across the stroke.
              for (const [tip, from] of [
                [start!, corner!],
                [end!, corner!],
              ] as const) {
                const length = Math.hypot(tip.x - from.x, tip.y - from.y);
                const across = { x: -(tip.y - from.y) / length, y: (tip.x - from.x) / length };
                for (const sign of [1, -1]) ink.push({ x: tip.x + (sign * pen * across.x) / 2, y: tip.y + (sign * pen * across.y) / 2 });
              }
              // The mitre: the stroke's outer and inner edges meet √2 half-pens from its corner, on its diagonal.
              const diagonal = unit(0);
              for (const sign of [1, -1]) {
                const reach = (Math.SQRT2 * pen) / 2;
                ink.push({ x: corner!.x + sign * reach * diagonal.x, y: corner!.y + sign * reach * diagonal.y });
              }
            }
          } else {
            throw new Error(`a glyph, not ${primitive.kind}`);
          }
          const painted = paintAnnotations([glyph], { x: 0, y: 0, width: framePx, height: framePx }, framePx, style)!;
          const { x, y, width, height } = painted.bounds;
          const name = `${glyph.id} at ${framePx} px, pen ${project.pens.arrow.width}`;
          const overrun = Math.max(...ink.map((point) => Math.max(x - point.x, y - point.y, point.x - x - width, point.y - y - height)));
          expect(ink.length, name).toBeGreaterThan(4);
          expect(overrun, name).toBeLessThanOrEqual(1e-6);
          if (primitive.kind === 'push-arrow' || primitive.kind === 'white-arrow') {
            // And no further (review 4): a mitre reaches out along its corner's bisector, not every way round.
            const xs = ink.map((point) => point.x);
            const ys = ink.map((point) => point.y);
            expect(Math.abs(x - Math.min(0, ...xs)), name).toBeLessThan(0.01);
            expect(Math.abs(y - Math.min(0, ...ys)), name).toBeLessThan(0.01);
            expect(Math.abs(x + width - Math.max(framePx, ...xs)), name).toBeLessThan(0.01);
            expect(Math.abs(y + height - Math.max(framePx, ...ys)), name).toBeLessThan(0.01);
          }
        }
      }
    }
  });

  it('measures a white arrow as its stroke draws it: a corner past its own mitre limit bevelled between its edges’ ends, not mitred to SVG’s 4', () => {
    // A narrow head's tip is 64°: its mitre would reach 1.89 half-pens past it, within SVG's
    // default limit, but the white arrow is stroked to 1.5, which bevels it between its edges' ends.
    const arrow = a('w', 'white-arrow', {
      from: [0.6, 0.5],
      to: [1.1, 0.5],
      path: [{ at: [0.6, 0.5] }, { at: [1.1, 0.5] }],
      width: 'narrow',
      tail: 'square',
    });
    const drawing = annotationDrawing([arrow], { width: 1, height: 1 }, 1000, DEFAULT_DIAGRAM_STYLE);
    const { project } = drawing.context;
    const half = (project.pens.arrow.width * project.ink) / 2;
    const primitive = drawing.primitives[0]!;
    if (primitive.kind !== 'white-arrow') throw new Error('a white arrow');
    const outline = whiteArrowDrawn(primitive.path, primitive.width, primitive.tail, project)!;
    const tip = Math.max(...outline.map(({ x }) => x));
    expect(tip).toBeCloseTo(1100, 0);
    const painted = paintAnnotations([arrow], { x: 0, y: 0, width: 1000, height: 1000 }, 1000, DEFAULT_DIAGRAM_STYLE)!;
    // Each of the tip's edges ends half a pen out across it: no further along the arrow than that.
    const at = outline.findIndex(({ x }) => x === tip);
    const [before, corner, after] = [outline[(at + outline.length - 1) % outline.length]!, outline[at]!, outline[(at + 1) % outline.length]!];
    const across = (from: SvgPoint, to: SvgPoint) => Math.abs(to.y - from.y) / Math.hypot(to.x - from.x, to.y - from.y);
    expect(painted.bounds.x + painted.bounds.width).toBeCloseTo(tip + half * Math.max(across(before, corner), across(corner, after)), 6);
    expect(painted.bounds.x + painted.bounds.width).toBeLessThan(tip + half);
    // Drawn so: hollow in the page's white, outlined in the arrow's pen to that limit.
    expect(painted.markup).toMatch(/stroke="none" fill="#ffffff"/);
    expect(painted.markup).toMatch(/stroke-linejoin="miter" stroke-miterlimit="1.5"/);
  });

  it('keeps a callout inside its reach at any pen, the heaviest too: its box, its outline’s pen and its line, exactly', () => {
    const heavy = { style: { ...DEFAULT_PAPER_STYLE, arrows: { ...DEFAULT_PAPER_STYLE.arrows, width: PEN_WIDTH_RANGE.max } } };
    const callouts = [
      // Its line coming in from below left, from straight below, from the left, from above the right; none at all.
      a('below-left', 'callout', { from: [0.1, 0.9], to: [0.6, 0.3], text: 'Repeat behind' }),
      a('below', 'callout', { from: [0.6, 1.4], to: [0.6, 0.3], text: 'Repeat on the other flap' }),
      a('left', 'callout', { from: [-0.8, 0.3], to: [0.6, 0.3], text: '裏側も同様に' }),
      a('above', 'callout', { from: [0.9, -0.5], to: [0.2, 0.9], text: 'W' }),
      // Its box past the frame, each way: up and to the right, down and to the left.
      a('box-off-up-right', 'callout', { from: [0.8, 0.2], to: [1.1, -0.1], text: 'Repeat behind' }),
      a('box-off-down-left', 'callout', { from: [0.2, 0.8], to: [-0.1, 1.1], text: '裏側も同様に' }),
      a('covered', 'callout', { from: [0.61, 0.31], to: [0.6, 0.3], text: 'Repeat behind' }),
    ];
    for (const style of [DEFAULT_DIAGRAM_STYLE, heavy]) {
      for (const framePx of [150, 1000]) {
        for (const callout of callouts) {
          const painted = paintAnnotations([callout], { x: 0, y: 0, width: framePx, height: framePx }, framePx, style)!;
          const attribute = (element: string, name: string) => Number(new RegExp(` ${name}="([-\\d.e]+)"`).exec(element)![1]);
          // The ink as painted, read off the markup: the box's outline, its stroke's half-width round
          // its rectangle — a mitred right angle's corner is that far out on both sides — and the line,
          // its round ends half its stroke round each.
          const ink: { x: number; y: number }[] = [];
          const rect = /<rect [^>]*>/.exec(painted.markup)![0];
          const half = attribute(rect, 'stroke-width') / 2;
          const [x, y, width, height] = ['x', 'y', 'width', 'height'].map((name) => attribute(rect, name)) as [number, number, number, number];
          ink.push({ x: x - half, y: y - half }, { x: x + width + half, y: y + height + half });
          const line = /<line [^>]*>/.exec(painted.markup)?.[0];
          if (line) {
            const pen = attribute(line, 'stroke-width') / 2;
            for (const [px, py] of [
              [attribute(line, 'x1'), attribute(line, 'y1')],
              [attribute(line, 'x2'), attribute(line, 'y2')],
            ] as const) {
              ink.push({ x: px - pen, y: py - pen }, { x: px + pen, y: py + pen });
            }
          }
          const name = `${callout.id} at ${framePx} px, ${style === heavy ? 'a 12 pt pen' : 'the default pen'}`;
          expect(line === undefined, name).toBe(callout.id === 'covered');
          const { x: bx, y: by, width: bw, height: bh } = painted.bounds;
          // Exactly: the reach is the ink's own box, or the frame's where that is farther.
          const left = Math.min(0, ...ink.map((point) => point.x));
          const top = Math.min(0, ...ink.map((point) => point.y));
          const right = Math.max(framePx, ...ink.map((point) => point.x));
          const bottom = Math.max(framePx, ...ink.map((point) => point.y));
          expect(bx, name).toBeCloseTo(left, 6);
          expect(by, name).toBeCloseTo(top, 6);
          expect(bx + bw, name).toBeCloseTo(right, 6);
          expect(by + bh, name).toBeCloseTo(bottom, 6);
        }
      }
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
