/**
 * A pulled step looks as today's baked card until a mark is edited (17d, §13
 * of `implementation-plans/diagram-references-annotations.md`): each fixture,
 * front and back, in the Diagram preset, Default and a coloured paper, the
 * baked scene against the sheet's scene plus the marks' — at the 50 mm the
 * cards and the canvas draw, and at twice it.
 */
import { describe, expect, it } from 'vitest';
import type { PaperLineItem, PaperScene, ScenePoint } from '../../lib/paper/paperScene';
import { DEFAULT_PAPER_STYLE, PT_TO_CSS_PX } from '../../lib/paper/paperStyle';
import { mmToCssPx } from '../../lib/paper/paperSvg';
import { frameOf, textEms } from '../annotate/annotationModel';
import { annotationDrawing, annotationScene, LABEL_BASELINE } from '../annotate/annotationPrimitives';
import type { DiagramStyle } from '../document/diagramDocument';
import { stepDiagramScene, stepDiagramSheetBox, stepDiagramToPicture } from '../pictures/paintStepDiagram';
import { sourcePaper } from '../zoom/stepView';
import { liftFixtures, piecesCard } from './referencesCardMarks.fixtures';
import { LIFT_SHEET_MM, liftCardMarks } from './referencesCardMarks';

const STYLES: [string, DiagramStyle][] = [
  ['the Diagram preset', { preset: 'diagram' }],
  ['Default', { preset: 'default' }],
  ['a coloured paper', { style: { ...DEFAULT_PAPER_STYLE, paper: { ...DEFAULT_PAPER_STYLE.paper, front: '#f2c94c', back: '#4a7bd0' } } }],
];

interface Element {
  tag: string;
  attrs: Record<string, string>;
  text: string;
}

/** Every drawn element of some markup, groups and clips flattened away, in document order. */
function elements(svg: string): Element[] {
  const list: Element[] = [];
  for (const match of svg.matchAll(/<(\w+)((?:\s+[\w:-]+="[^"]*")*)\s*\/?>([^<]*)/g)) {
    const tag = match[1]!;
    if (['g', 'defs', 'clipPath', 'svg', 'tspan'].includes(tag)) continue;
    const attrs: Record<string, string> = {};
    for (const attr of match[2]!.matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[attr[1]!] = attr[2]!;
    list.push({ tag, attrs, text: match[3] ?? '' });
  }
  return list;
}

/** Whether two attribute values say the same, their numbers within 1e-6. */
function sameValue(a: string, b: string): boolean {
  const split = (value: string) => value.split(/(-?\d*\.?\d+(?:e[-+]?\d+)?)/i).filter((token) => token !== '');
  const [ta, tb] = [split(a), split(b)];
  return (
    ta.length === tb.length &&
    ta.every((token, index) => {
      const other = tb[index]!;
      const [x, y] = [Number(token), Number(other)];
      return Number.isFinite(x) && Number.isFinite(y) ? Math.abs(x - y) <= 1e-6 : token.trim() === other.trim();
    })
  );
}

function sameElement(a: Element, b: Element): boolean {
  const keys = Object.keys(a.attrs);
  return a.tag === b.tag && keys.length === Object.keys(b.attrs).length && keys.every((key) => key in b.attrs && sameValue(a.attrs[key]!, b.attrs[key]!));
}

const markups = (scene: PaperScene | null) =>
  (scene?.items ?? []).flatMap((item) => (item.kind === 'markup' ? [item.svg] : [])).join('');
const lineItems = (scene: PaperScene | null) => (scene?.items ?? []).filter((item): item is PaperLineItem => item.kind === 'line');
const near = (a: ScenePoint, b: ScenePoint) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-6;

/** The baked card and its lifted pull, drawn at `sheetMm`, as a page paints them: scenes in one frame of scene px. */
function drawn(model: Parameters<typeof liftCardMarks>[0], mirrored: boolean, style: DiagramStyle, sheetMm: number) {
  const lifted = liftCardMarks(model, mirrored, { letters: true, highlights: true }, style)!;
  const baked = stepDiagramScene(model, mirrored, style, sheetMm);
  const sheet = stepDiagramScene(lifted.sheet, mirrored, style, sheetMm);
  const frame = frameOf(model.sheet.width, model.sheet.height)!;
  const paper = sourcePaper({ kind: 'step-diagram', picture: { kind: 'step-diagram', model: lifted.sheet, mirrored, key: 'k' } });
  const marks = annotationDrawing(lifted.annotations, frame, mmToCssPx(sheetMm), style, null, paper);
  const box = stepDiagramSheetBox(model, mirrored, sheetMm);
  // The marks' drawing is in the frame's px; the scenes' frame is the sheet's box in them.
  const shift = ([x, y]: ScenePoint): ScenePoint => [x + box.x, y + box.y];
  return { lifted, baked, sheet, marks, notes: annotationScene(marks), shift };
}

describe('a pulled step paints as its baked card', () => {
  for (const { name, model } of [...liftFixtures(), { name: 'pieces', model: piecesCard() }]) {
    for (const mirrored of [false, true]) {
      for (const [styleName, style] of STYLES) {
        for (const sheetMm of [LIFT_SHEET_MM, 2 * LIFT_SHEET_MM]) {
          it(`${name}, ${mirrored ? 'back' : 'front'}, in ${styleName}, at ${sheetMm} mm`, () => {
            const { baked, sheet, notes, marks, shift, lifted } = drawn(model, mirrored, style, sheetMm);

            // Its lines: the sheet's and the marks', each a baked one by role and ends —
            // a merged fold the baked pieces it covers, end to end, exactly. The marks'
            // lines go on after the sheet's edge outline: a page draws them over the picture.
            const want = lineItems(baked);
            const got = [...lineItems(sheet), ...lineItems(notes).map((line) => ({ ...line, a: shift(line.a), b: shift(line.b) }))];
            const unmatched = [...want];
            for (const line of got) {
              const exact = unmatched.findIndex((other) => other.role === line.role && near(other.a, line.a) && near(other.b, line.b));
              if (exact >= 0) {
                unmatched.splice(exact, 1);
                continue;
              }
              // Coverage: the pieces on it, sorted along it, from its start to its end with no gap.
              const length = Math.hypot(line.b[0] - line.a[0], line.b[1] - line.a[1]);
              const along = (p: ScenePoint) => ((p[0] - line.a[0]) * (line.b[0] - line.a[0]) + (p[1] - line.a[1]) * (line.b[1] - line.a[1])) / length;
              const off = (p: ScenePoint) => Math.abs((p[0] - line.a[0]) * (line.b[1] - line.a[1]) - (p[1] - line.a[1]) * (line.b[0] - line.a[0])) / length;
              const pieces = unmatched
                .filter((other) => other.role === line.role && off(other.a) <= 1e-6 && off(other.b) <= 1e-6)
                .map((other) => [Math.min(along(other.a), along(other.b)), Math.max(along(other.a), along(other.b)), other] as const)
                .sort((x, y) => x[0] - y[0]);
              expect(pieces.length).toBeGreaterThan(1);
              let reach = 0;
              for (const [start, end] of pieces) {
                expect(start).toBeLessThanOrEqual(reach + 1e-6);
                reach = Math.max(reach, end);
              }
              expect(reach).toBeCloseTo(length, 6);
              for (const [, , piece] of pieces) unmatched.splice(unmatched.indexOf(piece), 1);
            }
            expect(unmatched).toEqual([]);

            // Every other drawn element, the same, in the same order.
            const before = elements(markups(baked)).filter((element) => element.tag !== 'text');
            const after = [...elements(markups(sheet)), ...elements(markups(notes))].filter((element) => element.tag !== 'text');
            expect(after.length).toBe(before.length);
            before.forEach((element, index) => {
              if (!sameElement(element, after[index]!)) {
                expect(after[index]).toEqual(element);
              }
            });

            // The letters: as a page sets them, each starts at the same x on the same baseline,
            // at the same size and weight, in the same ink, haloed alike — on the back too. At
            // twice the size, where the baked card lays them out again, each keeps its offset.
            const letters = elements(markups(baked)).filter((element) => element.tag === 'text');
            const texts = lifted.annotations.filter((mark) => mark.kind === 'label');
            const named = model.primitives.flatMap((primitive) => (primitive.kind === 'label' ? [primitive.at] : []));
            expect(marks.labels).toHaveLength(letters.length);
            marks.labels.forEach((label, k) => {
              const text = texts[k]!;
              const advance = textEms(text.text!, true) * label.size;
              const [x, y] = shift([label.x, label.y]);
              if (sheetMm === LIFT_SHEET_MM) {
                const letter = letters[k]!;
                const anchor = Number(letter.attrs.x);
                const start = letter.attrs['text-anchor'] === 'start' ? anchor : letter.attrs['text-anchor'] === 'end' ? anchor - advance : anchor - advance / 2;
                expect(x - advance / 2).toBeCloseTo(start, 6);
                expect(y + LABEL_BASELINE * label.size).toBeCloseTo(Number(letter.attrs.y), 6);
                expect(label.size).toBeCloseTo(Number(letter.attrs['font-size']), 6);
                expect(letter.attrs['font-weight']).toBe('700');
                expect(label.bold).toBe(true);
                expect(label.fill).toBe(letter.attrs.fill);
                expect(label.halo?.color).toBe(letter.attrs.stroke);
                expect(label.halo?.width).toBeCloseTo(Number(letter.attrs['stroke-width']), 6);
              } else {
                const [u, v] = stepDiagramToPicture(model, mirrored)(named[k]!);
                const framePx = mmToCssPx(sheetMm);
                expect(label.x).toBeCloseTo(u * framePx + text.offsetPt![0] * PT_TO_CSS_PX, 6);
                expect(label.y).toBeCloseTo(v * framePx + text.offsetPt![1] * PT_TO_CSS_PX, 6);
              }
            });
          });
        }
      }
    }
  }
});
