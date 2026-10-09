import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cubicPoint } from '../../lib/cubicBezier';
import { readFontMetrics } from '../fonts/fontMetrics';
import {
  CJK_RUN_ADVANCE_RUNS,
  CJK_RUN_BOLD_ADVANCE_RUNS,
  LABEL_ADVANCE_RUNS,
  LABEL_BOLD_ADVANCE_RUNS,
  labelAdvance,
} from './labelAdvances';
import { scriptFonts, textCjkKey } from '../fonts/fontScripts';
import { graphemesOf } from '../../lib/paper/textWrap';
import type { DiagramPathNode, KnownDiagramAnnotation } from '../document/diagramDocument';
import { arcToPath, bendPathSegment, pathNodesOf } from './annotationPath';
import {
  ANGLE_MARK_ARM,
  ANNOTATION_KINDS,
  ANNOTATION_REACH,
  ARROW_BEND,
  angleMarkArms,
  angleMarkAt,
  behindEnds,
  MAX_BEHIND_LAYERS,
  withBehind,
  withBehindLayers,
  DEFAULT_PLEAT_KINKS,
  DEFAULT_WHITE_ARROW,
  MAX_PATH_NODES,
  MIN_ANNOTATION_LENGTH,
  canBeShaped,
  flipChangesArc,
  flipsArc,
  isShapedArrow,
  CALLOUT_GAP,
  CALLOUT_HALF_HEIGHT_EMS,
  CALLOUT_PAD_EMS,
  CALLOUT_TEXT_SIZE,
  LABEL_MAX_LENGTH,
  NEW_CALLOUT_TEXT,
  annotationEnds,
  arrowApex,
  arrowShape,
  calloutHalfBox,
  calloutShape,
  carriesText,
  carryAnnotation,
  cleanAnnotation,
  createAnnotation,
  kindFromOtherSide,
  defaultBend,
  flipAnnotationArc,
  frameOf,
  isDegenerate,
  LABEL_SIZE,
  labelHalfWidth,
  mirrorMove,
  moveAnnotation,
  moveAnnotationEnd,
  pathCubics,
  PLEAT_KINKS,
  pleatKinks,
  RIGHT_ANGLE_DIAGONAL,
  SOLID_ARROW_LOOK,
  isSolidArrow,
  withWhiteArrowLook,
  rightAngleAt,
  rightAngleDiagonal,
  turnRightAngle,
  placedByClick,
  withPath,
  textEms,
  DIVISIONS_OFFSET_MM,
  DIVISIONS_PARTS,
  divisionsOffsetWithin,
  divisionsParts,
  flipAnnotation,
  flipChangesMark,
  hasTicks,
  withDivisionsOffset,
  withNumbered,
  withParts,
  withShortDividers,
  shortDividersShow,
  carriesColor,
  GLYPH_SCALE,
  glyphAngleOf,
  glyphScaleOf,
  withGlyphAngle,
  withGlyphScale,
  withStarFill,
  eyeLooking,
  flipCentre,
  flipsOver,
  keptTo,
  AREA_SIDE,
  areaFromCorners,
  withAreaAngle,
  withAreaBox,
  type PictureMove,
  type PicturePoint,
} from './annotationModel';
import { divisionsShape } from '../../cp-workspace/references/stepDiagramGeometry';
import { DIAGRAM_DIVISIONS_INK } from '../../cp-workspace/references/diagram/diagramInk';
import { ANNOTATION_INK_MM } from './canvasInk';

const SQUARE = { width: 1, height: 1 };
const id = () => 'annotation-1';

describe('a new annotation', () => {
  it('puts a sign or a label at the press, with its own defaults', () => {
    expect(createAnnotation('turn-over', [0.2, 0.3], [0.9, 0.9], SQUARE, id)).toEqual({
      id: 'annotation-1',
      kind: 'turn-over',
      from: [0.2, 0.3],
      to: [0.2, 0.3],
      axis: 'vertical',
    });
    expect(createAnnotation('rotate', [0.2, 0.3], [0.2, 0.3], SQUARE, id).rotate).toEqual({
      amount: 'quarter',
      direction: 'cw',
    });
    expect(createAnnotation('label', [0.2, 0.3], [0.2, 0.3], SQUARE, id).text).toBe('A');
  });

  it('draws a line or a push from the drag, with no bulge', () => {
    const line = createAnnotation('hidden-line', [0, 0], [1, 1], SQUARE, id);
    expect(line).toEqual({ id: 'annotation-1', kind: 'hidden-line', from: [0, 0], to: [1, 1] });
  });

  it('bulges a new fold arrow away from the picture’s middle (Zach, 2026-10-06)', () => {
    // Along the top, left to right: the middle is below, the right of its travel; it bulges up, to its left.
    const top = createAnnotation('valley-arrow', [0.2, 0.1], [0.8, 0.1], SQUARE, id);
    expect(top.bend).toBeCloseTo(ARROW_BEND, 9);
    expect(arrowApex(top.from, top.to, top.bend!)[1]).toBeLessThan(0.1);
    // Along the bottom: the middle is above; it bulges down.
    const bottom = createAnnotation('valley-arrow', [0.2, 0.9], [0.8, 0.9], SQUARE, id);
    expect(arrowApex(bottom.from, bottom.to, bottom.bend!)[1]).toBeGreaterThan(0.9);
    expect(defaultBend([0.2, 0.9], [0.8, 0.9], SQUARE)).toBeCloseTo(-ARROW_BEND, 9);
    // Down either side, a mountain and a fold-and-unfold arrow alike: outward.
    const left = createAnnotation('mountain-arrow', [0.1, 0.3], [0.1, 0.7], SQUARE, id);
    expect(arrowApex(left.from, left.to, left.bend!)[0]).toBeLessThan(0.1);
    const right = createAnnotation('fold-unfold-arrow', [0.9, 0.7], [0.9, 0.3], SQUARE, id);
    expect(arrowApex(right.from, right.to, right.bend!)[0]).toBeGreaterThan(0.9);
  });
});

describe('an arrow’s arc', () => {
  it('bulges to the left of its travel as the page shows it for a positive bend', () => {
    // Travelling right on a y-down page, left is up.
    const apex = arrowApex([0, 0.5], [1, 0.5], 0.25);
    expect(apex[0]).toBeCloseTo(0.5, 9);
    expect(apex[1]).toBeCloseTo(0.25, 9);
    // A 60° arc's sagitta: 1 − cos 30° of its chord.
    expect(arrowApex([0, 0], [1, 0], ARROW_BEND)[1]).toBeCloseTo(-(1 - Math.cos(Math.PI / 6)), 9);
  });

  it('turns over with Flip arc, and nothing else does', () => {
    const arrow: KnownDiagramAnnotation = { id: 'a', kind: 'mountain-arrow', from: [0, 0], to: [1, 0], bend: 0.2 };
    expect(flipAnnotationArc(arrow).bend).toBe(-0.2);
    const line: KnownDiagramAnnotation = { id: 'b', kind: 'valley-line', from: [0, 0], to: [1, 0] };
    expect(flipAnnotationArc(line)).toBe(line);
  });
});

describe('moving one', () => {
  const arrow: KnownDiagramAnnotation = { id: 'a', kind: 'push-arrow', from: [0.1, 0.1], to: [0.5, 0.5] };

  it('moves the whole, or one end', () => {
    expect(moveAnnotation(arrow, [0.1, -0.1])).toMatchObject({ from: [0.2, 0], to: [0.6, 0.4] });
    expect(moveAnnotation(arrow, [0, 0])).toBe(arrow);
    expect(moveAnnotationEnd(arrow, 'to', [0.9, 0.9])).toMatchObject({ from: [0.1, 0.1], to: [0.9, 0.9] });
  });

  it('moves a sign whole by either end: it has one place', () => {
    const sign: KnownDiagramAnnotation = { id: 's', kind: 'turn-over', from: [0.5, 0.5], to: [0.5, 0.5] };
    expect(moveAnnotationEnd(sign, 'from', [0.2, 0.2])).toMatchObject({ from: [0.2, 0.2], to: [0.2, 0.2] });
  });

  it('knows a slip from a line', () => {
    expect(isDegenerate({ ...arrow, to: [0.105, 0.1] }, 0.015)).toBe(true);
    expect(isDegenerate(arrow, 0.015)).toBe(false);
    expect(isDegenerate({ id: 'l', kind: 'label', from: [0, 0], to: [0, 0] }, 0.015)).toBe(false);
  });
});

describe('carrying one through its picture’s move', () => {
  it('flips a mirror’s bulge and sense, and turns a turn-over’s axis a quarter turn round', () => {
    const frame = frameOf(400, 300)!;
    expect(frame).toEqual({ width: 1, height: 0.75 });
    const mirror = mirrorMove(frame);
    const arrow: KnownDiagramAnnotation = { id: 'a', kind: 'valley-arrow', from: [0.1, 0.2], to: [0.4, 0.2], bend: 0.1 };
    expect(carryAnnotation(arrow, mirror)).toMatchObject({ from: [0.9, 0.2], to: [0.6, 0.2], bend: -0.1 });
    const rotate: KnownDiagramAnnotation = {
      id: 'r',
      kind: 'rotate',
      from: [0.5, 0.5],
      to: [0.5, 0.5],
      rotate: { amount: 'half', direction: 'cw' },
    };
    expect(carryAnnotation(rotate, mirror).rotate).toEqual({ amount: 'half', direction: 'ccw' });
    const turnOver: KnownDiagramAnnotation = { id: 't', kind: 'turn-over', from: [0, 0], to: [0, 0], axis: 'vertical' };
    const quarter = { point: (point: [number, number]) => point, mirrors: false, turnDeg: 90 };
    expect(carryAnnotation(turnOver, quarter).axis).toBe('horizontal');
    expect(carryAnnotation(turnOver, { ...quarter, turnDeg: 180 }).axis).toBe('vertical');
    expect(carryAnnotation(turnOver, { ...quarter, turnDeg: 15 }).axis).toBe('vertical');
  });

  it('turns over the arc an arrow is drawn with when none is written: References’ 60°', () => {
    const arrow: KnownDiagramAnnotation = { id: 'a', kind: 'valley-arrow', from: [0.1, 0.2], to: [0.4, 0.2] };
    expect(carryAnnotation(arrow, mirrorMove({ width: 1, height: 1 })).bend).toBe(-ARROW_BEND);
    // A move that is no mirror leaves it unwritten, drawn as it was.
    const shift = { point: ([x, y]: [number, number]): [number, number] => [x + 0.1, y], mirrors: false, turnDeg: 0 };
    expect(carryAnnotation(arrow, shift).bend).toBeUndefined();
  });
});

describe('carrying one onto the paper’s other side (RM7: 17c)', () => {
  const SIDE = { width: 1, height: 1 };
  /** A References step turned over: mirrored, and seen from the other side. */
  const turnOver = { ...mirrorMove(SIDE), otherSide: true as const };
  const at = (kind: KnownDiagramAnnotation['kind']): KnownDiagramAnnotation => ({ id: kind, kind, from: [0.1, 0.2], to: [0.4, 0.3] });

  it('names a valley line or arrow a mountain, and a mountain a valley', () => {
    expect(carryAnnotation(at('valley-line'), turnOver)).toEqual({ ...at('valley-line'), kind: 'mountain-line', from: [0.9, 0.2], to: [0.6, 0.3] });
    expect(carryAnnotation(at('mountain-line'), turnOver).kind).toBe('valley-line');
    const valley = { ...at('valley-arrow'), bend: 0.1 };
    expect(carryAnnotation(valley, turnOver)).toEqual({ ...valley, kind: 'mountain-arrow', from: [0.9, 0.2], to: [0.6, 0.3], bend: -0.1 });
    expect(carryAnnotation(at('mountain-arrow'), turnOver)).toMatchObject({ kind: 'valley-arrow', bend: -ARROW_BEND });
  });

  it('names a shaped arrow’s fold from there too, every node and handle mirrored with it', () => {
    const shaped: KnownDiagramAnnotation = {
      id: 's',
      kind: 'mountain-arrow',
      from: [0.2, 0.5],
      to: [0.6, 0.5],
      path: [
        { at: [0.2, 0.5], out: [0.3, 0.2] },
        { at: [0.6, 0.5], in: [0.5, 0.2] },
      ],
    };
    const turned = carryAnnotation(shaped, turnOver);
    expect(turned.kind).toBe('valley-arrow');
    expect(turned.path).toEqual([
      { at: [0.8, 0.5], out: [0.7, 0.2] },
      { at: [0.4, 0.5], in: [0.5, 0.2] },
    ]);
  });

  it('moves every mark that says no way to fold, and keeps its kind', () => {
    const folds = new Set(['valley-line', 'mountain-line', 'valley-arrow', 'mountain-arrow']);
    for (const kind of ANNOTATION_KINDS) {
      if (folds.has(kind)) expect(kindFromOtherSide(kind), kind).not.toBe(kind);
      else expect(kindFromOtherSide(kind), kind).toBe(kind);
    }
    for (const kind of ['fold-unfold-arrow', 'hidden-line', 'solid-line', 'pleat-arrow', 'push-arrow', 'circle'] as const) {
      const turned = carryAnnotation(at(kind), turnOver);
      expect(turned.kind, kind).toBe(kind);
      expect(turned.from, kind).toEqual([0.9, 0.2]);
    }
    const label: KnownDiagramAnnotation = { id: 'l', kind: 'label', from: [0.1, 0.2], to: [0.1, 0.2], text: 'P' };
    expect(carryAnnotation(label, turnOver)).toEqual({ ...label, from: [0.9, 0.2], to: [0.9, 0.2] });
  });

  it('names each fold back on the way back, and only on a move onto the other side', () => {
    for (const kind of ANNOTATION_KINDS) expect(kindFromOtherSide(kindFromOtherSide(kind)), kind).toBe(kind);
    const valley = at('valley-line');
    const near = (point: readonly number[]) => point.map((value) => expect.closeTo(value, 12));
    expect(carryAnnotation(carryAnnotation(valley, turnOver), turnOver)).toEqual({ ...valley, from: near(valley.from), to: near(valley.to) });
    // A mirror on the same side — an upload flipped, a mark flipped in place — names nothing.
    expect(carryAnnotation(valley, mirrorMove(SIDE)).kind).toBe('valley-line');
    expect(flipAnnotation(at('valley-arrow'), 'horizontal').kind).toBe('valley-arrow');
  });
});

describe('keeping within reach', () => {
  it('stops an end, a new annotation and a carried point at the reach the file reads', () => {
    const line: KnownDiagramAnnotation = { id: 'l', kind: 'valley-line', from: [0.1, 0.5], to: [0.9, 0.5] };
    expect(moveAnnotationEnd(line, 'from', [-6, 0.5]).from).toEqual([-4, 0.5]);
    expect(createAnnotation('push-arrow', [-9, 0], [0, 9], SQUARE, id)).toMatchObject({ from: [-4, 0], to: [0, 4] });
    const mirror = mirrorMove({ width: 1, height: 1 });
    expect(carryAnnotation({ ...line, from: [-3.5, 0.5] }, mirror).from).toEqual([4, 0.5]);
  });

  it('moves a body only as far as keeps it whole', () => {
    const line: KnownDiagramAnnotation = { id: 'l', kind: 'valley-line', from: [0.1, 0.5], to: [0.9, 0.5] };
    const moved = moveAnnotation(line, [-9, 0]);
    expect(moved.from[0]).toBeCloseTo(-4, 9);
    expect(moved.to[0] - moved.from[0]).toBeCloseTo(0.8, 9);
  });
});

describe('a label’s width', () => {
  it('counts a wide character as an em and Latin as wide as its font sets it', () => {
    expect(labelHalfWidth('漢字漢字')).toBeCloseTo(LABEL_SIZE * (4 / 2 + 0.2), 12);
    expect(labelHalfWidth('iii')).toBeLessThan(labelHalfWidth('MMM') / 2);
    // A combining mark adds nothing; a letter the table has no width for, an em.
    expect(labelHalfWidth('e\u0301')).toBeCloseTo(labelHalfWidth('e'), 12);
    // Cyrillic and Greek as the font sets them (review: each was an em, a Russian callout twice as wide as its words).
    expect(labelHalfWidth('Ж')).toBeCloseTo(LABEL_SIZE * ((labelAdvance(0x416)! / 1000) / 2 + 0.2), 12);
    expect(labelHalfWidth('Ж')).toBeLessThan(labelHalfWidth('Ա'));
    expect(labelHalfWidth('Ա')).toBeCloseTo(LABEL_SIZE * (1 / 2 + 0.2), 12);
    // An emoji the font has no glyph for is drawn by the browser's fallback as one glyph, an em, however many
    // code points spell it: a family joined by joiners, a skin tone, a flag's two letters (review).
    for (const one of ['🧑\u200d🤝\u200d🧑', '👍🏽', '🇯🇵', '❤️']) {
      expect(labelHalfWidth(one), one).toBeCloseTo(LABEL_SIZE * (1 / 2 + 0.2), 12);
    }
    expect(labelHalfWidth('👍🏽👍🏽')).toBeCloseTo(LABEL_SIZE * (2 / 2 + 0.2), 12);
    expect(labelHalfWidth('')).toBeGreaterThan(0);
  });

  it('holds the ink of the widest Latin labels (review)', () => {
    // Half each one's ink, in ems, on its wider side: Noto Sans Regular's glyph outlines laid side by
    // side, measured in the review of c8389df19. The estimate before reached 0.04–0.6 em short.
    const ink: [string, number][] = [
      ['MAMMOTH', 2.622],
      ['WOW', 1.309],
      ['WHOM', 1.668],
      ['WWWWW', 2.313],
      ['mmmmm', 2.257],
      ['MW', 0.906],
      ['MOUNTAIN', 2.639],
    ];
    for (const [text, half] of ink) expect(labelHalfWidth(text) / LABEL_SIZE, text).toBeGreaterThanOrEqual(half);
  });

  it.each([
    ['Regular', LABEL_ADVANCE_RUNS, false],
    ['Bold', LABEL_BOLD_ADVANCE_RUNS, true],
  ] as const)('sets its Latin as the bundled Noto Sans %s does, glyph for glyph, every glyph it has (Bold: 17b)', (weight, runs, bold) => {
    const font = readFontMetrics(readFileSync(resolve(__dirname, `../fonts/NotoSans-${weight}.ttf`)));
    expect(font.unitsPerEm).toBe(1000);
    for (const run of runs) {
      run.advances.forEach((advance, index) => {
        const codePoint = run.from + index;
        expect(advance, codePoint.toString(16)).toBe(font.has(codePoint) ? font.advance(codePoint) : -1);
      });
    }
    // All of its map: no block it sets is left out of the table (review: its punctuation and Vietnamese were).
    for (const codePoint of font.codePoints()) {
      if (codePoint >= 0x20) expect(labelAdvance(codePoint, bold), codePoint.toString(16)).toBe(font.advance(codePoint));
    }
  });

  it('counts a digit, a space or a sign among CJK words as their font sets it, × ± · a whole em (third review)', () => {
    // 中心线: three ems; then a space, ±, 1, · and 2 in the CJK run: 0.224 + 1 + 0.555 + 1 + 0.555.
    expect(textEms('中心线 ±1·2')).toBeCloseTo(3 + 0.224 + 1 + 0.555 + 1 + 0.555, 9);
    // Among Latin words, as Noto Sans sets them.
    expect(textEms('1·2')).toBeCloseTo((labelAdvance(0x31)! + labelAdvance(0xb7)! + labelAdvance(0x32)!) / 1000, 9);
    // A dash only the CJK fonts have, a sign only Noto Sans has: each as the font that has it sets it (review 4).
    expect(textEms('折⸻')).toBeCloseTo(1 + 2.459, 9);
    expect(textEms('折⸺折')).toBeCloseTo(2 + 1.676, 9);
    const fold = [...'Fold '].reduce((sum, character) => sum + labelAdvance(character.codePointAt(0)!)!, 0) / 1000;
    expect(textEms('Fold ⸻')).toBeCloseTo(fold + 2.459, 9);
    expect(textEms('折‱')).toBeCloseTo(1 + labelAdvance(0x2031)! / 1000, 9);
    expect(labelAdvance(0x2031)! / 1000).toBeCloseTo(1.544, 3);
  });

  // The CJK fonts are a build output: checked against them where they are built.
  const built = resolve(__dirname, '../../../public/fonts/diagram');
  const cjkFonts = existsSync(built) ? readdirSync(built).filter((name) => /^NotoSans(SC|TC|JP|KR)-Regular\.full\./.test(name)) : [];
  const cjkBoldFonts = existsSync(built) ? readdirSync(built).filter((name) => /^NotoSans(SC|TC|JP|KR)-Bold\.full\./.test(name)) : [];
  it.runIf(cjkBoldFonts.length === 4)('holds the widest the four CJK fonts’ Bold set each, for a bold label (17b)', () => {
    const fonts = cjkBoldFonts.map((name) => readFontMetrics(readFileSync(resolve(built, name))));
    for (const run of CJK_RUN_BOLD_ADVANCE_RUNS) {
      run.advances.forEach((advance, index) => {
        const codePoint = run.from + index;
        const widest = Math.max(-1, ...fonts.filter((font) => font.has(codePoint)).map((font) => Math.round((font.advance(codePoint) * 1000) / font.unitsPerEm)));
        expect(advance, codePoint.toString(16)).toBe(widest);
      });
    }
  });
  it.runIf(cjkFonts.length === 4)('holds the widest the four CJK fonts set each, and a label as wide as any of them sets it', () => {
    const fonts = cjkFonts.map((name) => readFontMetrics(readFileSync(resolve(built, name))));
    for (const run of CJK_RUN_ADVANCE_RUNS) {
      run.advances.forEach((advance, index) => {
        const codePoint = run.from + index;
        const widest = Math.max(-1, ...fonts.filter((font) => font.has(codePoint)).map((font) => Math.round((font.advance(codePoint) * 1000) / font.unitsPerEm)));
        expect(advance, codePoint.toString(16)).toBe(widest);
      });
    }
    for (const text of ['中心线 ±1·2', '格子 8×8·16×16', '折り·開く·折り', 'Fold 折り 50%']) {
      const graphemes = graphemesOf(text);
      const keys = scriptFonts(graphemes, textCjkKey(text, 'sc'));
      for (const font of fonts) {
        const set = graphemes.reduce((sum, grapheme, index) => {
          const ems = [...grapheme].reduce((each, character) => {
            const codePoint = character.codePointAt(0)!;
            return each + (keys[index] === 'latin' ? labelAdvance(codePoint)! / 1000 : font.advance(codePoint) / font.unitsPerEm);
          }, 0);
          return sum + ems;
        }, 0);
        // Never narrower than any sets it; wider only by the widest's signs (· is 1 em in SC, 0.561 in JP).
        expect(textEms(text), text).toBeGreaterThanOrEqual(set - 1e-9);
        expect(textEms(text) - set, text).toBeLessThan(1);
      }
    }
  });

  it('counts a letter the font sets decomposed as its letter and marks', () => {
    // Polytonic Greek: no glyph of its own, set as α and its breathing and accent.
    expect(labelHalfWidth('ἀ')).toBeCloseTo(labelHalfWidth('α\u0313'), 12);
    expect(labelHalfWidth('ἀ')).toBeLessThan(labelHalfWidth('Ա'));
  });
});

describe('a shaped arrow', () => {
  const path: DiagramPathNode[] = [
    { at: [0.1, 0.5], out: [0.2, 0.3] },
    { at: [0.4, 0.5], in: [0.3, 0.6], out: [0.5, 0.4], type: 'corner' },
    { at: [0.7, 0.5], in: [0.6, 0.7] },
  ];
  const shaped: KnownDiagramAnnotation = { id: 's', kind: 'valley-arrow', from: [0.1, 0.5], to: [0.7, 0.5], path };
  const every = (arrow: KnownDiagramAnnotation) =>
    arrow.path!.flatMap((node) => [node.at, ...(node.in ? [node.in] : []), ...(node.out ? [node.out] : [])]);

  it('is a path to everything that asks its shape, never the default arc', () => {
    expect(arrowShape(shaped)).toEqual({ kind: 'path', path });
    expect(arrowShape({ bend: 0.2 })).toEqual({ kind: 'arc', bend: 0.2 });
    expect(arrowShape({})).toEqual({ kind: 'arc', bend: ARROW_BEND });
  });

  it('is carried point by point, handles too, a mirror needing nothing turned over', () => {
    const mirror = mirrorMove({ width: 1, height: 1 });
    const carried = carryAnnotation(shaped, mirror);
    expect(carried.bend).toBeUndefined();
    expect(carried.from).toEqual([0.9, 0.5]);
    expect(carried.path![1]).toEqual({ at: [0.6, 0.5], in: [0.7, 0.6], out: [0.5, 0.4], type: 'corner' });
    // The curve itself carried: every point of it lands where the move takes it.
    const quarter: PictureMove = { point: ([x, y]) => [1 - y, x], mirrors: false, turnDeg: 90 };
    const turned = pathCubics(carryAnnotation(shaped, quarter).path!);
    pathCubics(path).forEach((cubic, index) => {
      for (const t of [0.2, 0.5, 0.9]) {
        const [x, y] = cubicPoint(cubic, t);
        const [u, v] = cubicPoint(turned[index]!, t);
        expect(u).toBeCloseTo(1 - y, 12);
        expect(v).toBeCloseTo(x, 12);
      }
    });
    // An arc made a path and mirrored is the mirrored arc made a path.
    const arc: KnownDiagramAnnotation = { id: 'a', kind: 'valley-arrow', from: [0.2, 0.3], to: [0.6, 0.4], bend: 0.3 };
    const viaPath = carryAnnotation(arcToPath(arc), mirror).path!;
    const viaArc = arcToPath(carryAnnotation(arc, mirror)).path!;
    viaPath.forEach((node, index) => {
      expect(node.at[0]).toBeCloseTo(viaArc[index]!.at[0], 12);
      expect(node.at[1]).toBeCloseTo(viaArc[index]!.at[1], 12);
    });
  });

  it('moves whole only as far as keeps every node and handle within reach', () => {
    const moved = moveAnnotation(shaped, [9, 0]);
    // The furthest point right is the handle at 0.6 + 0.1: it stops at reach.
    expect(Math.max(...every(moved).map(([x]) => x))).toBeCloseTo(ANNOTATION_REACH, 12);
    expect(moved.to[0] - moved.from[0]).toBeCloseTo(0.6, 12);
    expect(moved.path![1]!.out![0] - moved.path![1]!.at[0]).toBeCloseTo(0.1, 12);
    expect(moveAnnotation(shaped, [0, 0])).toBe(shaped);
  });

  it('moves an end as its node, the handle coming with it', () => {
    const moved = moveAnnotationEnd(shaped, 'from', [0, 0.4]);
    expect(moved.from).toEqual([0, 0.4]);
    expect(moved.path![0]!.at).toEqual([0, 0.4]);
    expect(moved.path![0]!.out![0]).toBeCloseTo(0.1, 12);
    expect(moved.path![0]!.out![1]).toBeCloseTo(0.2, 12);
    expect(moveAnnotationEnd(shaped, 'to', [0.8, 0.6]).path![2]!.at).toEqual([0.8, 0.6]);
  });

  it('flips across its chord, and an arc made a path flips as the arc does', () => {
    const flipped = flipAnnotationArc(shaped);
    expect(flipped.from).toEqual(shaped.from);
    expect(flipped.path![0]!.out![0]).toBeCloseTo(0.2, 12);
    expect(flipped.path![0]!.out![1]).toBeCloseTo(0.7, 12);
    expect(flipped.path![1]!.type).toBe('corner');
    const arc: KnownDiagramAnnotation = { id: 'a', kind: 'mountain-arrow', from: [0.2, 0.3], to: [0.6, 0.4], bend: 0.2 };
    const viaPath = flipAnnotationArc(arcToPath(arc)).path!;
    const viaArc = arcToPath(flipAnnotationArc(arc)).path!;
    viaPath.forEach((node, index) => {
      expect(node.out?.[0] ?? 0).toBeCloseTo(viaArc[index]!.out?.[0] ?? 0, 12);
      expect(node.in?.[1] ?? 0).toBeCloseTo(viaArc[index]!.in?.[1] ?? 0, 12);
    });
    // One whose ends meet has no chord to flip across.
    const loop = { ...shaped, to: shaped.from, path: [path[0]!, { at: [0.1, 0.5] as [number, number], in: [0.3, 0.8] as [number, number] }] };
    expect(flipAnnotationArc(loop)).toBe(loop);
  });

  it('keeps a smooth node smooth when a flip takes it past reach: its handles come in with it', () => {
    const edge: KnownDiagramAnnotation = {
      id: 'e',
      kind: 'valley-arrow',
      from: [3.5, 0],
      to: [3.5, 1],
      path: [
        { at: [3.5, 0], out: [3.2, 0.1] },
        { at: [2.9, 0.5], in: [2.9, 0.3], out: [2.9, 0.7] },
        { at: [3.5, 1], in: [3.2, 0.9] },
      ],
    };
    // Mirrored across its chord the middle node lands at 4.1, past reach, and is brought in to 4.
    const middle = flipAnnotationArc(edge).path![1]!;
    expect(middle.at).toEqual([4, 0.5]);
    expect(middle.in![0]).toBeCloseTo(4, 12);
    expect(middle.in![1]).toBeCloseTo(0.3, 12);
    expect(middle.out![0]).toBeCloseTo(4, 12);
    expect(middle.out![1]).toBeCloseTo(0.7, 12);
  });

  it('has a length along its path: a loop that ends by its tail is an arrow, a stub is not', () => {
    const loop: KnownDiagramAnnotation = {
      ...shaped,
      to: [0.105, 0.5],
      path: [
        { at: [0.1, 0.5], out: [0.4, 0.1] },
        { at: [0.105, 0.5], in: [0.4, 0.9] },
      ],
    };
    expect(isDegenerate(loop, 0.015)).toBe(false);
    const stub = { ...loop, path: [{ at: [0.1, 0.5] as [number, number] }, { at: [0.105, 0.5] as [number, number] }] };
    expect(isDegenerate(stub, 0.015)).toBe(true);
  });

  it('is written as the reader reads it: points and handles within reach, no stray handle, no more nodes than it holds', () => {
    expect(cleanAnnotation(shaped)).toBe(shaped);
    const stray: KnownDiagramAnnotation = {
      ...shaped,
      bend: 0.2,
      from: [0, 0],
      path: [{ ...path[0]!, in: [0, 0] }, { ...path[1]!, out: [9, 0.4] }, { ...path[2]!, out: [1, 1] }],
    };
    const clean = cleanAnnotation(stray);
    expect(clean.bend).toBeUndefined();
    expect(clean.from).toEqual([0.1, 0.5]);
    expect(clean.path![0]!.in).toBeUndefined();
    expect(clean.path![2]!.out).toBeUndefined();
    // Drawn in along itself to reach's edge: its direction from the node kept.
    expect(clean.path![1]!.out).toEqual([ANNOTATION_REACH, 0.5 - (0.1 * (ANNOTATION_REACH - 0.4)) / (9 - 0.4)]);
    const many = Array.from({ length: 30 }, (_, index): DiagramPathNode => ({ at: [index / 30, 0.5] }));
    const long = cleanAnnotation({ ...shaped, path: many, to: [29 / 30, 0.5] });
    expect(long.path).toHaveLength(MAX_PATH_NODES);
    expect(long.to).toEqual([29 / 30, 0.5]);
    // A path on a kind that is not shaped, or of one node, is dropped: an arc, or straight, again.
    expect(cleanAnnotation({ ...shaped, kind: 'push-arrow' }).path).toBeUndefined();
    const lone = cleanAnnotation({ ...shaped, path: [path[0]!] });
    expect(lone.bend).toBe(ARROW_BEND);
    expect(lone.path).toBeUndefined();
  });
});

describe('a fold-and-unfold arrow’s return shaped by hand', () => {
  const path: DiagramPathNode[] = [
    { at: [0.2, 0.5], out: [0.3, 0.4] },
    { at: [0.6, 0.5], in: [0.5, 0.4] },
  ];
  const back: DiagramPathNode[] = [
    { at: [0.6, 0.5], out: [0.5, 0.65] },
    { at: [0.25, 0.55], in: [0.35, 0.7] },
  ];
  const unfold: KnownDiagramAnnotation = { id: 'u', kind: 'fold-unfold-arrow', from: [0.2, 0.5], to: [0.6, 0.5], path, back };
  const near = (point: readonly number[]) => point.map((value) => expect.closeTo(value, 12));

  it('starts where the path ends, wherever the tip goes, its handle with it', () => {
    const moved = withPath(unfold, [path[0]!, { at: [0.7, 0.45], in: [0.6, 0.4] }]);
    expect(moved.to).toEqual([0.7, 0.45]);
    expect(moved.back![0]).toEqual({ at: [0.7, 0.45], out: near([0.6, 0.6]) });
    expect(moved.back![1]).toBe(back[1]);
  });

  it('moves whole with its path, only as far as keeps every point of both within reach', () => {
    const moved = moveAnnotation(unfold, [0.1, -0.1]);
    expect(moved.back![1]).toEqual({ at: near([0.35, 0.45]), in: near([0.45, 0.6]) });
    expect(moved.back![0]!.at).toEqual(moved.to);
    const far = moveAnnotation(unfold, [9, 0]);
    const xs = [...far.path!, ...far.back!].flatMap((node) => [node.at, node.in, node.out].flatMap((p) => (p ? [p[0]] : [])));
    expect(Math.max(...xs)).toBeCloseTo(ANNOTATION_REACH, 12);
    expect(far.back![0]!.at).toEqual(far.to);
  });

  it('is carried with its picture, and flipped across the chord with its path', () => {
    const mirrored = carryAnnotation(unfold, mirrorMove(SQUARE));
    expect(mirrored.back![1]).toEqual({ at: near([0.75, 0.55]), in: near([0.65, 0.7]) });
    expect(mirrored.back![0]!.at).toEqual(mirrored.to);
    const flipped = flipAnnotationArc(unfold);
    expect(flipped.back![0]).toEqual({ at: [0.6, 0.5], out: near([0.5, 0.35]) });
    expect(flipped.back![1]).toEqual({ at: near([0.25, 0.45]), in: near([0.35, 0.3]) });
    // A straight path still flips with a return off its chord: the return changes sides.
    const straight: KnownDiagramAnnotation = { ...unfold, path: [{ at: [0.2, 0.5] }, { at: [0.6, 0.5] }] };
    expect(flipChangesArc(straight)).toBe(true);
    const { back: _back, ...derived } = straight;
    expect(flipChangesArc(derived)).toBe(false);
  });

  it('is written as the reader reads it, and only on a fold-and-unfold arrow with a path', () => {
    expect(cleanAnnotation(unfold)).toBe(unfold);
    // Off the tip: put on it, its handle with it.
    const off = cleanAnnotation({ ...unfold, back: [{ at: [0.5, 0.5], out: [0.4, 0.65] }, back[1]!] });
    expect(off.back![0]).toEqual({ at: [0.6, 0.5], out: near([0.5, 0.65]) });
    // No stray handle at either end, as a path has none.
    const stray = cleanAnnotation({ ...unfold, back: [{ ...back[0]!, in: [0, 0] }, { ...back[1]!, out: [1, 1] }] });
    expect(stray.back).toEqual(back);
    // One node is no return to keep: the drawing derives it again.
    expect(cleanAnnotation({ ...unfold, back: [back[0]!] })).not.toHaveProperty('back');
    // On an arc, or on an arrow of another kind, it goes.
    const { path: _path, ...arc } = unfold;
    expect(cleanAnnotation({ ...arc, bend: 0.2 })).not.toHaveProperty('back');
    expect(cleanAnnotation({ ...unfold, kind: 'valley-arrow' })).not.toHaveProperty('back');
  });
});

describe('a circle', () => {
  it('is put down at the press, its centre, with nothing more: no letter, no axis', () => {
    expect(createAnnotation('circle', [0.2, 0.3], [0.9, 0.9], SQUARE, id)).toEqual({
      id: 'annotation-1',
      kind: 'circle',
      from: [0.2, 0.3],
      to: [0.2, 0.3],
    });
  });

  it('moves whole by its body or its one place, and is never a slip', () => {
    const circle = createAnnotation('circle', [0.2, 0.3], [0.2, 0.3], SQUARE, id);
    const moved = moveAnnotation(circle, [0.1, 0.1]);
    expect(moved.from[0]).toBeCloseTo(0.3, 12);
    expect(moved.to).toEqual(moved.from);
    expect(moveAnnotationEnd(circle, 'to', [0.5, 0.6])).toMatchObject({ from: [0.5, 0.6], to: [0.5, 0.6] });
    expect(isDegenerate(circle, 0.5)).toBe(false);
  });

  it('is carried with its picture: its centre goes where the point does, and nothing turns', () => {
    const circle = createAnnotation('circle', [0.2, 0.3], [0.2, 0.3], SQUARE, id);
    expect(carryAnnotation(circle, mirrorMove(SQUARE))).toEqual({ ...circle, from: [0.8, 0.3], to: [0.8, 0.3] });
    // Not a fold arrow: Flip arc leaves it.
    expect(flipAnnotationArc(circle)).toBe(circle);
  });

  it('is written at one point, within reach', () => {
    const stray: KnownDiagramAnnotation = { id: 'c', kind: 'circle', from: [5, 0.3], to: [0.4, 0.4] };
    expect(cleanAnnotation(stray)).toEqual({
      id: 'c',
      kind: 'circle',
      from: [ANNOTATION_REACH, 0.3],
      to: [ANNOTATION_REACH, 0.3],
    });
  });
});

describe('an angle mark (15b)', () => {
  const vertex: PicturePoint = [0.5, 0.98];
  const placed = angleMarkAt(vertex, [0, 0.49], [0.5, 0])!;
  const mark: KnownDiagramAnnotation = { id: 'm-1', kind: 'angle-mark', ...placed };
  const armDirections = (annotation: Pick<KnownDiagramAnnotation, 'from' | 'to' | 'other'>) =>
    angleMarkArms(annotation)!.map(([x, y]) => [Math.round(x * 1e9) / 1e9 + 0, Math.round(y * 1e9) / 1e9 + 0]);

  it('keeps its vertex where it was put, and each arm’s point a short way along the arm: only its direction', () => {
    expect(placed.from).toEqual(vertex);
    for (const arm of [placed.to, placed.other!]) {
      expect(Math.hypot(arm[0] - vertex[0], arm[1] - vertex[1])).toBeCloseTo(ANGLE_MARK_ARM, 12);
    }
    // Toward the points it was given.
    const up = Math.hypot(0.5, 0.49);
    expect(armDirections(mark)).toEqual([
      [Math.round((-0.5 / up) * 1e9) / 1e9, Math.round((-0.49 / up) * 1e9) / 1e9],
      [0, -1],
    ]);
    // Arms along one line make no angle: none.
    expect(angleMarkAt(vertex, [0.2, 0.98], [0.8, 0.98])).toBeNull();
    expect(angleMarkAt(vertex, vertex, [0.8, 0.5])).toBeNull();
  });

  it('is written as placed, and placed again when an arm was written further along', () => {
    expect(cleanAnnotation(mark)).toBe(mark);
    const far: KnownDiagramAnnotation = { ...mark, to: [0, 0.49], other: [0.5, 0] };
    expect(cleanAnnotation(far)).toEqual(mark);
    // A tick count past three is written as one.
    expect(cleanAnnotation({ ...mark, ticks: 7 as never }).ticks).toBe(1);
    expect(cleanAnnotation({ ...mark, ticks: 2 })).toEqual({ ...mark, ticks: 2 });
  });

  it('moves whole, arms and all; and is degenerate only with no angle', () => {
    const moved = moveAnnotation(mark, [0.1, -0.2]);
    expect(moved.from).toEqual([0.6, 0.78]);
    expect(moved.other![0]).toBeCloseTo(mark.other![0] + 0.1, 12);
    expect(moved.other![1]).toBeCloseTo(mark.other![1] - 0.2, 12);
    expect(isDegenerate(mark, MIN_ANNOTATION_LENGTH)).toBe(false);
    expect(isDegenerate({ ...mark, other: mark.to }, MIN_ANNOTATION_LENGTH)).toBe(true);
    expect(annotationEnds({ kind: 'angle-mark' })).toEqual([]);
  });

  it('is carried by a mirror and a turn, its arms with the picture', () => {
    const mirrored = carryAnnotation(mark, mirrorMove(SQUARE));
    expect(mirrored.from[0]).toBeCloseTo(0.5, 12);
    expect(armDirections(mirrored)[0]![0]).toBeCloseTo(-armDirections(mark)[0]![0], 9);
    // A quarter turn clockwise about the frame's middle.
    const quarter: PictureMove = { point: ([u, v]) => [1 - v, u], mirrors: false, turnDeg: 90 };
    const turned = carryAnnotation(mark, quarter);
    expect(turned.from[0]).toBeCloseTo(0.02, 12);
    expect(turned.from[1]).toBeCloseTo(0.5, 12);
    expect(armDirections(turned)[1]).toEqual([1, 0]);
  });

  it('goes with the face its angle opens into under a spread, its arms turned as that face is', () => {
    // Two faces moved apart: the one its inside lies in slides right; its corner, on both, goes with that one.
    const spread: PictureMove = {
      point: ([u, v]) => (v < 0.98 ? [u + 0.05, v] : [u - 0.05, v]),
      mirrors: false,
      turnDeg: 0,
      vector: (vector) => vector,
      corner: (corner, inside) => (inside[1] < 0.98 ? [corner[0] + 0.05, corner[1]] : null),
    };
    const carried = carryAnnotation(mark, spread);
    expect(carried.from[0]).toBeCloseTo(0.55, 12);
    expect(armDirections(carried)).toEqual(armDirections(mark));
  });
});

describe('a right angle', () => {
  const R = Math.SQRT1_2;
  const opens = (annotation: KnownDiagramAnnotation) => rightAngleDiagonal(annotation).map((v) => Math.round(v * 1e9) / 1e9 + 0);
  const length = ({ from, to }: KnownDiagramAnnotation) => Math.hypot(to[0] - from[0], to[1] - from[1]);

  it('is put down in a corner, `to` a short way along the way it opens: only its direction', () => {
    const drawn = createAnnotation('right-angle', [0.2, 0.3], [0.5, 0.6], SQUARE, id);
    expect(drawn).toMatchObject({ id: 'annotation-1', kind: 'right-angle', from: [0.2, 0.3] });
    expect(length(drawn)).toBeCloseTo(RIGHT_ANGLE_DIAGONAL, 12);
    expect(opens(drawn)).toEqual([Math.round(R * 1e9) / 1e9, Math.round(R * 1e9) / 1e9]);
    // A click, which says no way: up and to the right, as an ∟'s square sits.
    expect(opens(createAnnotation('right-angle', [0.2, 0.3], [0.2, 0.3], SQUARE, id))).toEqual(
      [R, -R].map((v) => Math.round(v * 1e9) / 1e9 + 0)
    );
    // Its corner is where it was put, to the bit: a snapped corner stays on its point.
    expect(createAnnotation('right-angle', [0.1 + 0.2, 0.7], [1, 1], SQUARE, id).from).toEqual([0.1 + 0.2, 0.7]);
    expect(isDegenerate(drawn, 0.5)).toBe(false);
  });

  it('keeps `to` within reach by drawing the corner in, never by turning it', () => {
    const edge = rightAngleAt([ANNOTATION_REACH, 0.5], [1, 1]);
    expect(edge.to[0]).toBe(ANNOTATION_REACH);
    expect(edge.from[0]).toBeCloseTo(ANNOTATION_REACH - RIGHT_ANGLE_DIAGONAL * R, 12);
    // Drawn in across only: it stays level with where it was put.
    expect(edge.from[1]).toBeCloseTo(0.5, 12);
    expect(edge.to[1]).toBeCloseTo(0.5 + RIGHT_ANGLE_DIAGONAL * R, 12);
    const past = createAnnotation('right-angle', [9, -9], [10, -10], SQUARE, id);
    expect(Math.abs(past.to[0]) <= ANNOTATION_REACH && Math.abs(past.to[1]) <= ANNOTATION_REACH).toBe(true);
    expect(opens(past)).toEqual(opens({ ...past, from: [0, 0], to: [1, -1] }));
  });

  it('is written with its `to` a set way along, the same object when it already is', () => {
    const written = createAnnotation('right-angle', [0.2, 0.3], [0.5, 0.3], SQUARE, id);
    expect(cleanAnnotation(written)).toBe(written);
    // One a file or a newer build wrote further along: the same way, the length this build writes.
    const far: KnownDiagramAnnotation = { id: 'r', kind: 'right-angle', from: [0.2, 0.3], to: [0.2, 0.9] };
    const clean = cleanAnnotation(far);
    expect(clean.from).toEqual([0.2, 0.3]);
    expect(length(clean)).toBeCloseTo(RIGHT_ANGLE_DIAGONAL, 12);
    expect(opens(clean)).toEqual([0, 1]);
    // Past reach: the corner brought in, the way it opens kept.
    const stray: KnownDiagramAnnotation = { id: 'r', kind: 'right-angle', from: [5, 0.3], to: [6, 0.3] };
    expect(cleanAnnotation(stray).to).toEqual([ANNOTATION_REACH, 0.3]);
    expect(opens(cleanAnnotation(stray))).toEqual([1, 0]);
  });

  it('moves whole by its body or its corner, and turns toward a point by its other end', () => {
    const mark = createAnnotation('right-angle', [0.2, 0.3], [0.5, 0.6], SQUARE, id);
    const moved = moveAnnotation(mark, [0.1, -0.1]);
    expect(moved.from[0]).toBeCloseTo(0.3, 12);
    expect(opens(moved)).toEqual(opens(mark));
    const cornered = moveAnnotationEnd(mark, 'from', [0.6, 0.6]);
    expect(cornered.from).toEqual([0.6, 0.6]);
    expect(opens(cornered)).toEqual(opens(mark));
    const turned = moveAnnotationEnd(mark, 'to', [0.2, 0.9]);
    expect(turned.from).toEqual([0.2, 0.3]);
    expect(opens(turned)).toEqual([0, 1]);
  });

  it('turns a quarter clockwise about its corner, four turns round to where it was', () => {
    const mark = createAnnotation('right-angle', [0.2, 0.3], [0.5, 0.0], SQUARE, id);
    expect(opens(mark)).toEqual([R, -R].map((v) => Math.round(v * 1e9) / 1e9 + 0));
    // Clockwise on the page, y down: up-right, then down-right, down-left, up-left.
    const once = turnRightAngle(mark);
    expect(once.from).toEqual(mark.from);
    expect(opens(once)).toEqual([R, R].map((v) => Math.round(v * 1e9) / 1e9));
    expect(opens(turnRightAngle(once))).toEqual([-R, R].map((v) => Math.round(v * 1e9) / 1e9));
    const round = turnRightAngle(turnRightAngle(turnRightAngle(once)));
    expect(round.to[0]).toBeCloseTo(mark.to[0], 12);
    expect(round.to[1]).toBeCloseTo(mark.to[1], 12);
    // Nothing else turns.
    const circle = createAnnotation('circle', [0.2, 0.3], [0.2, 0.3], SQUARE, id);
    expect(turnRightAngle(circle)).toBe(circle);
    expect(flipAnnotationArc(mark)).toBe(mark);
  });

  it('is carried with its picture: its corner where the point goes, opening the way its diagonal went', () => {
    const mark = createAnnotation('right-angle', [0.2, 0.3], [0.5, 0.0], SQUARE, id);
    // A mirror turns it over: up-right becomes up-left.
    const mirrored = carryAnnotation(mark, mirrorMove(SQUARE));
    expect(mirrored.from[0]).toBeCloseTo(0.8, 12);
    expect(mirrored.from[1]).toBeCloseTo(0.3, 12);
    expect(opens(mirrored)).toEqual([-R, -R].map((v) => Math.round(v * 1e9) / 1e9));
    // A quarter turn clockwise about the middle turns the way it opens with it.
    const quarter: PictureMove = { point: ([x, y]) => [1 - y, x], mirrors: false, turnDeg: 90 };
    const turned = carryAnnotation(mark, quarter);
    expect(turned.from[0]).toBeCloseTo(0.7, 12);
    expect(turned.from[1]).toBeCloseTo(0.2, 12);
    expect(opens(turned)).toEqual([R, R].map((v) => Math.round(v * 1e9) / 1e9));
    // Scaled up, as a picture refitted larger is: `to` written its set way along again.
    const larger: PictureMove = { point: ([x, y]) => [2 * x, 2 * y], mirrors: false, turnDeg: 0 };
    expect(length(carryAnnotation(mark, larger))).toBeCloseTo(RIGHT_ANGLE_DIAGONAL, 12);
  });
});

describe('a white arrow', () => {
  const laid = () => createAnnotation('white-arrow', [0.2, 0.3], [0.6, 0.5], SQUARE, id);
  const bent = () => bendPathSegment(laid(), 0, 0.5, [0.35, 0.2]);

  it('is laid straight from the drag, a path of two nodes, in the template’s look: regular, pointed', () => {
    expect(laid()).toEqual({
      id: 'annotation-1',
      kind: 'white-arrow',
      from: [0.2, 0.3],
      to: [0.6, 0.5],
      path: [{ at: [0.2, 0.3] }, { at: [0.6, 0.5] }],
      width: 'regular',
      tail: 'pointed',
    });
    expect(DEFAULT_WHITE_ARROW).toEqual({ width: 'regular', tail: 'pointed' });
    // Always a path: no arc to fill in, and Edit Path shows its own nodes, not an arc's.
    expect(arrowShape(laid())).toEqual({ kind: 'path', path: laid().path });
    expect(pathNodesOf(laid())).toEqual(laid().path);
    expect(laid()).not.toHaveProperty('bend');
  });

  it('is shaped with Edit Path and flipped, as a fold arrow is; shaped only once it is no longer straight', () => {
    expect(canBeShaped('white-arrow')).toBe(true);
    expect(flipsArc('white-arrow')).toBe(true);
    expect(isShapedArrow(laid())).toBe(false);
    expect(isShapedArrow(bent())).toBe(true);
    // A fold arrow is shaped once it is a path at all.
    const arc = createAnnotation('valley-arrow', [0.2, 0.3], [0.6, 0.5], SQUARE, id);
    expect(isShapedArrow(arc)).toBe(false);
    expect(isShapedArrow(arcToPath(arc))).toBe(true);
    // A handle drawn back onto its node is straight again.
    const onNodes: KnownDiagramAnnotation = { ...laid(), path: [{ at: [0.2, 0.3], out: [0.2, 0.3] }, { at: [0.6, 0.5] }] };
    expect(isShapedArrow(onNodes)).toBe(false);
    // Flipped across its chord, its look kept: its bulge's handle on the other side.
    const flipped = flipAnnotationArc(bent());
    expect(flipped).toMatchObject({ kind: 'white-arrow', width: 'regular', tail: 'pointed' });
    expect(flipped.to[0]).toBeCloseTo(0.6, 12);
    const side = (annotation: KnownDiagramAnnotation) => {
      const [x, y] = annotation.path![0]!.out!;
      return Math.sign((0.6 - 0.2) * (y - 0.3) - (0.5 - 0.3) * (x - 0.2));
    };
    expect(side(flipped)).toBe(-side(bent()));
  });

  it('is a path whatever it is written as: one without is laid straight between its ends', () => {
    const { path: _path, ...bare } = laid();
    expect(cleanAnnotation(bare)).toEqual(laid());
    // A path of one node is no path: laid straight again, not made an arc.
    expect(cleanAnnotation({ ...laid(), path: [{ at: [0.2, 0.3] }] })).toEqual(laid());
    const clean = laid();
    expect(cleanAnnotation(clean)).toBe(clean);
  });

  it('moves, and is carried with its picture, its look kept and its every node and handle with it', () => {
    const arrow = { ...bent(), width: 'wide' as const, tail: 'cleft' as const };
    const moved = moveAnnotation(arrow, [0.1, 0]);
    expect(moved).toMatchObject({ kind: 'white-arrow', width: 'wide', tail: 'cleft', from: [expect.closeTo(0.3, 12), 0.3] });
    expect(moved.path![0]!.out![0]).toBeCloseTo(arrow.path![0]!.out![0] + 0.1, 12);
    const mirrored = carryAnnotation(arrow, mirrorMove(SQUARE));
    expect(mirrored).toMatchObject({ kind: 'white-arrow', width: 'wide', tail: 'cleft', from: [0.8, 0.3], to: [0.4, 0.5] });
    expect(mirrored.path![0]!.out![0]).toBeCloseTo(1 - arrow.path![0]!.out![0], 12);
  });

  it('is a slip when shorter than the shortest arrow, measured along it', () => {
    expect(isDegenerate(createAnnotation('white-arrow', [0.2, 0.3], [0.2, 0.3 + MIN_ANNOTATION_LENGTH / 2], SQUARE, id), MIN_ANNOTATION_LENGTH)).toBe(true);
    expect(isDegenerate(laid(), MIN_ANNOTATION_LENGTH)).toBe(false);
  });
});

describe('a callout', () => {
  const callout = (from: [number, number], to: [number, number], text = 'Repeat behind'): KnownDiagramAnnotation => ({
    id: 'c',
    kind: 'callout',
    from,
    to,
    text,
  });

  it('is drawn from the point it marks to where its box sits, saying the words it is given', () => {
    expect(createAnnotation('callout', [0.2, 0.3], [0.6, 0.1], SQUARE, id, '裏側も同様に')).toEqual({
      id: 'annotation-1',
      kind: 'callout',
      from: [0.2, 0.3],
      to: [0.6, 0.1],
      text: '裏側も同様に',
    });
    // Words of no language given: English's.
    expect(createAnnotation('callout', [0.2, 0.3], [0.6, 0.1], SQUARE, id).text).toBe(NEW_CALLOUT_TEXT);
    // Kept to what a label may say.
    expect(createAnnotation('callout', [0.2, 0.3], [0.6, 0.1], SQUARE, id, `a\nb${'x'.repeat(200)}`).text).toHaveLength(
      LABEL_MAX_LENGTH
    );
  });

  it('puts its box beside its point for a click, out from the middle, its near corner a gap out each way', () => {
    const { halfWidth, halfHeight } = calloutHalfBox(NEW_CALLOUT_TEXT);
    const cases: Array<[[number, number], [1 | -1, 1 | -1]]> = [
      [[0.3, 0.2], [-1, -1]],
      [[0.7, 0.2], [1, -1]],
      [[0.3, 0.8], [-1, 1]],
      [[0.7, 0.8], [1, 1]],
      // The middle itself: up and to the right.
      [[0.5, 0.5], [1, -1]],
    ];
    for (const [at, [sx, sy]] of cases) {
      const placed = createAnnotation('callout', at, at, SQUARE, id);
      expect(placed.from).toEqual(at);
      expect(placed.to[0]).toBeCloseTo(at[0] + sx * (halfWidth + CALLOUT_GAP), 12);
      expect(placed.to[1]).toBeCloseTo(at[1] + sy * (halfHeight + CALLOUT_GAP), 12);
      const { line, box } = calloutShape(placed);
      const corner = [sx > 0 ? box.x : box.x + box.width, sy > 0 ? box.y : box.y + box.height];
      expect(Math.abs(corner[0]! - at[0])).toBeCloseTo(CALLOUT_GAP, 12);
      expect(Math.abs(corner[1]! - at[1])).toBeCloseTo(CALLOUT_GAP, 12);
      // Its line heads for the box's middle and stops on the side facing the point: a wide box's top or bottom.
      expect(line![0]).toEqual(at);
      expect(line![1][1]).toBeCloseTo(sy > 0 ? box.y : box.y + box.height, 12);
      const toward = Math.atan2(placed.to[1] - at[1], placed.to[0] - at[0]);
      expect(Math.atan2(line![1][1] - at[1], line![1][0] - at[0])).toBeCloseTo(toward, 12);
    }
    // A drag shorter than a slip is a click.
    const slip = createAnnotation('callout', [0.3, 0.2], [0.305, 0.2], SQUARE, id);
    expect(slip.to).toEqual(createAnnotation('callout', [0.3, 0.2], [0.3, 0.2], SQUARE, id).to);
  });

  it('has a box as wide as its words are set, and a pad, as tall as a line and a pad', () => {
    const { halfWidth, halfHeight } = calloutHalfBox('Repeat behind');
    // Noto Sans sets "Repeat behind" 6.835 em wide.
    expect(textEms('Repeat behind')).toBeCloseTo(6.835, 9);
    expect(halfWidth).toBeCloseTo(CALLOUT_TEXT_SIZE * (6.835 / 2 + CALLOUT_PAD_EMS), 12);
    expect(halfHeight).toBeCloseTo(CALLOUT_TEXT_SIZE * CALLOUT_HALF_HEIGHT_EMS, 12);
    expect(calloutHalfBox('iii').halfWidth).toBeLessThan(calloutHalfBox('MMM').halfWidth);
    // Han an em a character; nothing at all as wide as a label with nothing in it.
    expect(calloutHalfBox('裏側').halfWidth).toBeCloseTo(CALLOUT_TEXT_SIZE * (2 / 2 + CALLOUT_PAD_EMS), 12);
    expect(calloutHalfBox('').halfWidth).toBeCloseTo(CALLOUT_TEXT_SIZE * (0.6 / 2 + CALLOUT_PAD_EMS), 12);
  });

  it('stops its line at its box’s outline, whichever side it comes in by, and has none from inside the box', () => {
    const { halfWidth, halfHeight } = calloutHalfBox('Repeat behind');
    const to: [number, number] = [0.5, 0.5];
    // From the left, straight in: the left side's middle.
    expect(calloutShape(callout([0.1, 0.5], to)).line).toEqual([[0.1, 0.5], [0.5 - halfWidth, 0.5]]);
    // From below: the bottom side's middle.
    const below = calloutShape(callout([0.5, 0.9], to)).line!;
    expect(below[1][0]).toBeCloseTo(0.5, 12);
    expect(below[1][1]).toBeCloseTo(0.5 + halfHeight, 12);
    // Steeply from above and to the right: through the top, on the way to the middle.
    const steep = calloutShape(callout([0.6, 0.1], to)).line!;
    expect(steep[1][1]).toBeCloseTo(0.5 - halfHeight, 12);
    expect((steep[1][0] - 0.5) / (steep[1][1] - 0.5)).toBeCloseTo((0.6 - 0.5) / (0.1 - 0.5), 12);
    // The box over its own point: no line.
    expect(calloutShape(callout([0.5 + halfWidth * 0.9, 0.5], to)).line).toBeNull();
    expect(calloutShape(callout([0.5, 0.5], to)).line).toBeNull();
    const { box } = calloutShape(callout([0.1, 0.5], to));
    expect(box.x).toBeCloseTo(0.5 - halfWidth, 12);
    expect(box.width).toBeCloseTo(2 * halfWidth, 12);
    expect(box.height).toBeCloseTo(2 * halfHeight, 12);
  });

  it('is never a slip: its box is drawn wherever it sits, its point under it or not', () => {
    expect(isDegenerate(callout([0.5, 0.5], [0.5, 0.5]), 0.5)).toBe(false);
    expect(placedByClick('callout')).toBe(true);
    expect(placedByClick('valley-line')).toBe(false);
    expect(placedByClick('label')).toBe(true);
  });

  it('carries words, as a label does, and offers its point to take hold of, its box being taken where it is drawn', () => {
    expect(ANNOTATION_KINDS.filter(carriesText).sort()).toEqual(['callout', 'label']);
    expect(annotationEnds({ kind: 'callout' })).toEqual(['from']);
    expect(annotationEnds({ kind: 'valley-arrow' })).toEqual(['to', 'from']);
    expect(annotationEnds({ kind: 'circle' })).toEqual([]);
  });

  it('moves whole by its line, and its box or its point alone', () => {
    const it = callout([0.2, 0.3], [0.6, 0.1]);
    expect(moveAnnotation(it, [0.1, 0.1])).toMatchObject({ from: [0.30000000000000004, 0.4], to: [0.7, 0.2] });
    expect(moveAnnotationEnd(it, 'to', [0.9, 0.9])).toMatchObject({ from: [0.2, 0.3], to: [0.9, 0.9] });
    expect(moveAnnotationEnd(it, 'from', [0.1, 0.1])).toMatchObject({ from: [0.1, 0.1], to: [0.6, 0.1] });
  });

  it('is carried with the face under its point: its box keeps its place beside the point, turned as the picture is', () => {
    const it = callout([0.2, 0.3], [0.6, 0.1]);
    // A mirror: the box goes to the point's other side, its words upright.
    expect(carryAnnotation(it, mirrorMove(SQUARE))).toEqual({ ...it, from: [0.8, 0.3], to: [0.4, 0.1] });
    // A spread: the point goes with its face, by a map no box follows — but the box
    // keeps its offset, turned as the picture turned (here a quarter turn clockwise).
    const spread: PictureMove = {
      point: ([x, y]) => [x + 0.3 * x * x, y + 0.05],
      mirrors: false,
      turnDeg: 90,
      vector: ([dx, dy]) => [-dy, dx],
    };
    const carried = carryAnnotation(it, spread);
    expect(carried.from[0]).toBeCloseTo(0.2 + 0.3 * 0.04, 12);
    expect(carried.from[1]).toBeCloseTo(0.35, 12);
    // Its box the way the picture turned the offset, its line as long as it was.
    const [dx, dy] = [carried.to[0] - carried.from[0], carried.to[1] - carried.from[1]];
    expect(dx * 0.4 - dy * 0.2).toBeCloseTo(0, 12);
    expect(dx).toBeGreaterThan(0);
    const lineLength = (annotation: KnownDiagramAnnotation) => {
      const [a, b] = calloutShape(annotation).line!;
      return Math.hypot(b[0] - a[0], b[1] - a[1]);
    };
    expect(lineLength(carried)).toBeCloseTo(lineLength(it), 12);
    expect(carried.text).toBe('Repeat behind');
    // Not a fold arrow: Flip arc leaves it.
    expect(flipAnnotationArc(it)).toBe(it);
  });

  it('keeps its line through a quarter turn, its box wider than tall still beside its point, and back (review)', () => {
    // Dragged with its box just under its point: a line 0.0575 long.
    const it = callout([0.5, 0.5], [0.5, 0.6]);
    const length = (annotation: KnownDiagramAnnotation) => {
      const line = calloutShape(annotation).line;
      return line ? Math.hypot(line[1][0] - line[0][0], line[1][1] - line[0][1]) : 0;
    };
    expect(length(it)).toBeCloseTo(0.0575, 4);
    for (const degrees of [75, 90, 270]) {
      const turn = degrees * (Math.PI / 180);
      const about = (([x, y]: PicturePoint): PicturePoint => [
        0.5 + (x - 0.5) * Math.cos(turn) - (y - 0.5) * Math.sin(turn),
        0.5 + (x - 0.5) * Math.sin(turn) + (y - 0.5) * Math.cos(turn),
      ]);
      const back = (([x, y]: PicturePoint): PicturePoint => [
        0.5 + (x - 0.5) * Math.cos(-turn) - (y - 0.5) * Math.sin(-turn),
        0.5 + (x - 0.5) * Math.sin(-turn) + (y - 0.5) * Math.cos(-turn),
      ]);
      const turned = carryAnnotation(it, { point: about, mirrors: false, turnDeg: degrees });
      expect(length(turned), `${degrees}°`).toBeCloseTo(0.0575, 9);
      const home = carryAnnotation(turned, { point: back, mirrors: false, turnDeg: -degrees });
      expect(home.to[0], `${degrees}° and back`).toBeCloseTo(0.5, 9);
      expect(home.to[1], `${degrees}° and back`).toBeCloseTo(0.6, 9);
    }
  });

  it('is written with its words clean and its box within reach', () => {
    const stray = callout([0.2, 0.3], [9, 0.1], 'Repeat\nbehind');
    expect(cleanAnnotation(stray)).toEqual({ ...stray, to: [ANNOTATION_REACH, 0.1], text: 'Repeat behind' });
  });
});

describe('a pleat arrow (15c)', () => {
  const arrow: KnownDiagramAnnotation = { id: 'p-1', kind: 'pleat-arrow', from: [0.25, 0.5], to: [0.75, 0.375] };

  it('is laid straight from tail to tip — one Z, stepping right, unsaid — and is never shaped, nor has words', () => {
    expect(createAnnotation('pleat-arrow', [0.25, 0.5], [0.75, 0.375], SQUARE, id)).toEqual({
      ...arrow,
      id: 'annotation-1',
    });
    expect(DEFAULT_PLEAT_KINKS).toBe(1);
    expect(canBeShaped('pleat-arrow')).toBe(false);
    expect(carriesText('pleat-arrow')).toBe(false);
    expect(annotationEnds({ kind: 'pleat-arrow' })).toEqual(['to', 'from']);
  });

  it('steps its Zs to the other side with Flip, and back, writing `mirrored` only when true', () => {
    expect(flipsArc('pleat-arrow')).toBe(true);
    expect(flipChangesArc(arrow)).toBe(true);
    const flipped = flipAnnotationArc(arrow);
    expect(flipped).toEqual({ ...arrow, mirrored: true });
    const back = flipAnnotationArc(flipped);
    expect(back).toEqual(arrow);
    expect(Object.hasOwn(back, 'mirrored')).toBe(false);
  });

  it('keeps its Zs on their side of the paper when the picture is mirrored, and as they were under any other move', () => {
    const mirrored = carryAnnotation({ ...arrow, kinks: 2 }, mirrorMove(SQUARE));
    expect(mirrored).toEqual({ ...arrow, kinks: 2, from: [0.75, 0.5], to: [0.25, 0.375], mirrored: true });
    expect(carryAnnotation(mirrored, mirrorMove(SQUARE))).toEqual({ ...arrow, kinks: 2 });
    const shift: PictureMove = { point: ([x, y]) => [x + 0.125, y], mirrors: false, turnDeg: 0 };
    expect(carryAnnotation({ ...arrow, mirrored: true }, shift)).toEqual({
      ...arrow,
      from: [0.375, 0.5],
      to: [0.875, 0.375],
      mirrored: true,
    });
  });

  it('counts its Zs whole, one to five', () => {
    expect(PLEAT_KINKS).toEqual([1, 2, 3, 4, 5]);
    expect([0, 1, 2.4, 2.6, 5, 7, -3, Number.NaN].map(pleatKinks)).toEqual([1, 1, 2, 3, 5, 5, 1, 1]);
  });
});

describe('a solid arrow (15d)', () => {
  const white: KnownDiagramAnnotation = {
    id: 'w-1',
    kind: 'white-arrow',
    from: [0.25, 0.5],
    to: [0.75, 0.5],
    path: [{ at: [0.25, 0.5] }, { at: [0.75, 0.5] }],
    width: 'regular',
    tail: 'pointed',
  };

  it('is a white arrow filled with ink, narrow and square-tailed as the tool lays it', () => {
    expect(SOLID_ARROW_LOOK).toEqual({ width: 'narrow', tail: 'square', fill: 'black' });
    expect(isSolidArrow(white)).toBe(false);
    expect(isSolidArrow({ ...white, fill: 'black' })).toBe(true);
    // Only a white arrow is one.
    expect(isSolidArrow({ kind: 'push-arrow', fill: 'black' })).toBe(false);
  });

  it('takes a look whole or in part, writing its fill only when black', () => {
    const solid = withWhiteArrowLook(white, SOLID_ARROW_LOOK);
    expect(solid).toEqual({ ...white, width: 'narrow', tail: 'square', fill: 'black' });
    // Its width alone: the fill as it was.
    expect(withWhiteArrowLook(solid, { width: 'wide' })).toEqual({ ...solid, width: 'wide' });
    const unfilled = withWhiteArrowLook(solid, { fill: 'white' });
    expect(unfilled).toEqual({ ...white, width: 'narrow', tail: 'square' });
    expect(Object.hasOwn(unfilled, 'fill')).toBe(false);
    // Nothing to change: the same arrow.
    expect(withWhiteArrowLook(white, {})).toEqual(white);
  });
});

describe('a mark behind a flap (15e)', () => {
  const arrow: KnownDiagramAnnotation = { id: 'a-1', kind: 'valley-arrow', from: [0.25, 0.5], to: [0.75, 0.5], bend: 0.125 };

  it('can be behind at a fold or pleat arrow’s ends, a valley, mountain or solid line’s, and a circle’s centre alone', () => {
    const behind = ANNOTATION_KINDS.filter((kind) => behindEnds(kind).length > 0);
    expect(behind).toEqual([
      'valley-arrow',
      'mountain-arrow',
      'fold-unfold-arrow',
      'pleat-arrow',
      'valley-line',
      'mountain-line',
      'solid-line',
      'circle',
    ]);
    expect(behindEnds('circle')).toEqual(['from']);
    expect(behindEnds('hidden-line')).toEqual([]);
  });

  it('puts an end behind and back in front, writing `behind` from end to end and dropping it once no end is', () => {
    const tail = withBehind(arrow, 'from', 1);
    expect(tail).toEqual({ ...arrow, behind: { from: 1 } });
    const both = withBehind(withBehind(arrow, 'to', 2), 'from', 1);
    expect(Object.keys(both.behind!)).toEqual(['from', 'to']);
    expect(withBehind(tail, 'from', null)).toEqual(arrow);
    expect(Object.hasOwn(withBehind(tail, 'from', null), 'behind')).toBe(false);
    // Every end behind at once, as Under sets them; whole layers, one to nine.
    expect(withBehindLayers(both, 3).behind).toEqual({ from: 3, to: 3 });
    expect(withBehindLayers(both, 40).behind).toEqual({ from: MAX_BEHIND_LAYERS, to: MAX_BEHIND_LAYERS });
  });

  it('keeps no `behind` its kind cannot have: a line made a hidden line, a circle’s second end', () => {
    const line: KnownDiagramAnnotation = { id: 'l-1', kind: 'valley-line', from: [0.25, 0.5], to: [0.75, 0.5], behind: { from: 1 } };
    expect(cleanAnnotation(line)).toBe(line);
    expect(cleanAnnotation({ ...line, kind: 'hidden-line' })).toEqual({ id: 'l-1', kind: 'hidden-line', from: [0.25, 0.5], to: [0.75, 0.5] });
    const circle: KnownDiagramAnnotation = { id: 'c-1', kind: 'circle', from: [0.5, 0.5], to: [0.5, 0.5], behind: { from: 2, to: 1 } };
    expect(cleanAnnotation(circle).behind).toEqual({ from: 2 });
  });
});

describe('equal divisions (Revision 2)', () => {
  const top: KnownDiagramAnnotation = { id: 'd-1', kind: 'divisions', from: [0, 0], to: [1, 0], parts: 4, offset: 2.5, mirrored: true };

  /** The side a mark's line lies on, as a direction on the picture. */
  const sideOf = ({ from, to, mirrored }: KnownDiagramAnnotation): PicturePoint => {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const right: PicturePoint = [-(to[1] - from[1]) / length, (to[0] - from[0]) / length];
    return mirrored ? [-right[0], -right[1]] : right;
  };

  it('is laid in four parts, 2.5 mm off, on the side away from the picture’s middle — off the paper on each edge (ED3, ED5)', () => {
    expect(createAnnotation('divisions', [0, 0], [1, 0], SQUARE, id)).toEqual({ ...top, id: 'annotation-1' });
    expect(DIVISIONS_PARTS.laid).toBe(4);
    expect(DIVISIONS_OFFSET_MM.laid).toBe(2.5);
    const edges: [PicturePoint, PicturePoint, PicturePoint][] = [
      // Each edge either way round, and the way off the paper there.
      [[0, 0], [1, 0], [0, -1]],
      [[1, 0], [0, 0], [0, -1]],
      [[1, 0], [1, 1], [1, 0]],
      [[1, 1], [1, 0], [1, 0]],
      [[1, 1], [0, 1], [0, 1]],
      [[0, 1], [1, 1], [0, 1]],
      [[0, 1], [0, 0], [-1, 0]],
      [[0, 0], [0, 1], [-1, 0]],
    ];
    for (const [from, to, off] of edges) {
      const laid = createAnnotation('divisions', from, to, SQUARE, id);
      const side = sideOf(laid);
      expect([side[0] + 0, side[1] + 0], `${from} → ${to}`).toEqual(off);
      // `mirrored` written only when true.
      expect(laid.mirrored === undefined || laid.mirrored === true).toBe(true);
    }
    // Through the middle, to the right of the way it was drawn.
    const through = createAnnotation('divisions', [0, 0], [1, 1], SQUARE, id);
    expect(Object.hasOwn(through, 'mirrored')).toBe(false);
    expect(createAnnotation('divisions', [1, 1], [0, 0], SQUARE, id).mirrored).toBeUndefined();
  });

  it('is a mark, not a line nor shaped, with no words and no end behind a flap, its ends taken hold of, and ticks of its own', () => {
    expect(canBeShaped('divisions')).toBe(false);
    expect(carriesText('divisions')).toBe(false);
    expect(behindEnds('divisions')).toEqual([]);
    expect(annotationEnds({ kind: 'divisions' })).toEqual(['to', 'from']);
    expect(placedByClick('divisions')).toBe(false);
    expect(ANNOTATION_KINDS.filter(hasTicks)).toEqual(['angle-mark', 'divisions']);
    expect(ANNOTATION_KINDS.indexOf('divisions')).toBe(ANNOTATION_KINDS.indexOf('angle-mark') + 1);
  });

  it('is written as the reader reads it: parts whole within two to thirty-two, the offset within its range, `mirrored`, `numbered` and ticks only as written', () => {
    expect(cleanAnnotation(top)).toBe(top);
    const numbered = { ...top, numbered: true as const, ticks: 2 as const };
    expect(cleanAnnotation(numbered)).toBe(numbered);
    expect(cleanAnnotation({ ...top, parts: 2.6 }).parts).toBe(3);
    expect(cleanAnnotation({ ...top, parts: 40 }).parts).toBe(32);
    expect(cleanAnnotation({ ...top, parts: 1 }).parts).toBe(2);
    expect(cleanAnnotation({ ...top, offset: -1 }).offset).toBe(0);
    expect(cleanAnnotation({ ...top, offset: 20 }).offset).toBe(15);
    // Any value in range kept as it was, never rounded.
    expect(cleanAnnotation({ ...top, offset: 2.37 }).offset).toBe(2.37);
    // Always written: one with none is given the laid ones.
    const { parts: _p, offset: _o, ...bare } = top;
    expect(cleanAnnotation(bare)).toMatchObject({ parts: 4, offset: 2.5 });
    const loose = cleanAnnotation({
      ...top,
      mirrored: false as unknown as true,
      numbered: false as unknown as true,
      shortDividers: false as unknown as true,
      ticks: 7 as 1,
    });
    expect(['mirrored', 'numbered', 'shortDividers', 'ticks'].filter((key) => Object.hasOwn(loose, key))).toEqual([]);
    // Short dividers (Revision 3) kept as written, only when true.
    const short = { ...top, shortDividers: true as const };
    expect(cleanAnnotation(short)).toBe(short);
    expect(cleanAnnotation({ ...top, from: [9, 0] }).from).toEqual([ANNOTATION_REACH, 0]);
  });

  it('is a slip when shorter than the shortest line, as a line is', () => {
    expect(isDegenerate(top, MIN_ANNOTATION_LENGTH)).toBe(false);
    expect(isDegenerate({ ...top, to: [MIN_ANNOTATION_LENGTH / 2, 0] }, MIN_ANNOTATION_LENGTH)).toBe(true);
  });

  it('holds its parts and its offset to their ranges: the offset to a tenth, or with Shift a half', () => {
    expect([1, 2, 4.4, 4.6, 32, 33, Number.NaN].map(divisionsParts)).toEqual([2, 2, 4, 5, 32, 32, 4]);
    expect([-1, 0, 2.34, 2.36, 14.97, 16].map((mm) => divisionsOffsetWithin(mm))).toEqual([0, 0, 2.3, 2.4, 15, 15]);
    expect([2.2, 2.3, 2.76, 14.9].map((mm) => divisionsOffsetWithin(mm, true))).toEqual([2, 2.5, 3, 15]);
    expect(withParts(top, 7).parts).toBe(7);
    expect(withDivisionsOffset(top, 1.04)).toEqual({ ...top, offset: 1 });
    expect(withDivisionsOffset(top, 3, { mirrored: false })).toEqual({ id: 'd-1', kind: 'divisions', from: [0, 0], to: [1, 0], parts: 4, offset: 3 });
    expect(withNumbered(top, true)).toEqual({ ...top, numbered: true });
    expect(Object.hasOwn(withNumbered({ ...top, numbered: true }, false), 'numbered')).toBe(false);
  });

  it('takes short dividers as a switch, written only when on, and keeps them through a move, a flip and F (Revision 3, R3-1 A)', () => {
    expect(withShortDividers(top, true)).toEqual({ ...top, shortDividers: true });
    expect(Object.hasOwn(withShortDividers({ ...top, shortDividers: true }, false), 'shortDividers')).toBe(false);
    const short = { ...top, shortDividers: true as const };
    const grown: PictureMove = { point: ([x, y]) => [2 * x, 2 * y], mirrors: false, turnDeg: 0 };
    expect(carryAnnotation(short, grown).shortDividers).toBe(true);
    expect(carryAnnotation(short, mirrorMove(SQUARE)).shortDividers).toBe(true);
    expect(flipAnnotation(short, 'vertical').shortDividers).toBe(true);
    expect(flipAnnotationArc(short).shortDividers).toBe(true);
    // On its line they draw as full ones do: F and the flips are held there as before.
    expect(flipChangesArc({ ...short, offset: 0 })).toBe(false);
    expect(flipChangesMark({ ...short, offset: 0 }, 'vertical')).toBe(false);
  });

  it('says short dividers show only where they change the drawing: the line more than 1.65 mm out (the 18a follow-up)', () => {
    // As the drawing has it, in ink: the dividers between the ends, short and full.
    const drawn = (mm: number, shortDividers: boolean) =>
      divisionsShape({ x: 0, y: 0 }, { x: 100, y: 0 }, { parts: 3, ticks: 1, mirrored: false, numbered: false, shortDividers }, {
        offset: mm / ANNOTATION_INK_MM,
        overshoot: DIAGRAM_DIVISIONS_INK.overshoot,
        tick: 3,
        spacing: 2,
        tickFloor: 1.5,
        spacingFloor: 1,
        lean: 0,
        number: 7.2,
        gap: 2,
      })!.dividers;
    for (const mm of [0, 1, 1.6, 1.7, 2.5, 10]) {
      expect(shortDividersShow(mm)).toBe(JSON.stringify(drawn(mm, true)) !== JSON.stringify(drawn(mm, false)));
    }
    expect([1.6, 1.65, 1.7, DIVISIONS_OFFSET_MM.laid].map(shortDividersShow)).toEqual([false, false, true, true]);
  });

  it('keeps its line on its side of the paper through a mirror, its offset and its count through any move', () => {
    const mirrored = carryAnnotation(top, mirrorMove(SQUARE));
    expect(mirrored).toEqual({ ...top, from: [1, 0], to: [0, 0], mirrored: undefined });
    expect(Object.hasOwn(mirrored, 'mirrored')).toBe(false);
    // Still off the paper, above its top edge.
    expect(sideOf(mirrored).map((value) => value + 0)).toEqual([0, -1]);
    // Twice its size: its ends with it, its print sizes as they were.
    const grown: PictureMove = { point: ([x, y]) => [2 * x, 2 * y], mirrors: false, turnDeg: 0 };
    expect(carryAnnotation({ ...top, numbered: true, ticks: 3 }, grown)).toEqual({
      ...top,
      numbered: true,
      ticks: 3,
      to: [2, 0],
    });
  });

  it('flips about the middle of its line, a do-nothing flip along its own line told by what it draws', () => {
    // Left to right, its ends change places and its side turns over: drawn as it was.
    const across = flipAnnotation(top, 'horizontal');
    expect(across).toMatchObject({ from: [1, 0], to: [0, 0] });
    expect(flipChangesMark(top, 'horizontal')).toBe(false);
    // Top to bottom, its line goes over to the paper's side.
    expect(flipAnnotation(top, 'vertical')).toEqual({ ...top, mirrored: undefined });
    expect(flipChangesMark(top, 'vertical')).toBe(true);
    // F puts it over in place, unless it is alike on both sides (`flipChangesArc`).
    expect(flipsArc('divisions')).toBe(true);
    expect(flipAnnotationArc(top)).toEqual({ id: 'd-1', kind: 'divisions', from: [0, 0], to: [1, 0], parts: 4, offset: 2.5 });
    expect(flipChangesArc(top)).toBe(true);
    expect(flipChangesArc({ ...top, offset: 0 })).toBe(false);
    expect(flipChangesArc({ ...top, offset: 0, numbered: true })).toBe(true);
  });

  it('holds Flip Horizontal and Vertical where F is held: on its line with no count, alike on either side', () => {
    // Top to bottom only turns its side over, which draws nothing new on the line.
    expect(flipChangesMark({ ...top, offset: 0 }, 'vertical')).toBe(false);
    expect(flipChangesMark({ ...top, offset: 0 }, 'horizontal')).toBe(false);
    // With its count beside it, the count goes over.
    expect(flipChangesMark({ ...top, offset: 0, numbered: true }, 'vertical')).toBe(true);
    // Off a slanted line, its line goes elsewhere whichever side it is on.
    const slant = { ...top, to: [1, 0.5] as PicturePoint, offset: 0 };
    expect(flipChangesMark(slant, 'vertical')).toBe(true);
    expect(flipChangesMark(slant, 'horizontal')).toBe(true);
  });
});

describe('a star (Revision 3)', () => {
  const star = (more: Partial<KnownDiagramAnnotation> = {}): KnownDiagramAnnotation => ({
    id: 's-1',
    kind: 'star',
    from: [0.3, 0.4],
    to: [0.3, 0.4],
    ...more,
  });

  it('is put down at one point with a click, snapping as a circle does, an outline until its fill says otherwise', () => {
    expect(createAnnotation('star', [0.3, 0.4], [0.9, 0.9], SQUARE, id)).toEqual({ id: 'annotation-1', kind: 'star', from: [0.3, 0.4], to: [0.3, 0.4] });
    expect(placedByClick('star')).toBe(true);
    expect(isDegenerate(star(), MIN_ANNOTATION_LENGTH)).toBe(false);
    // Laid filled by the rail's Star Fill, as the Solid Arrow lays a white arrow filled.
    expect(withStarFill(star(), 'black')).toEqual(star({ fill: 'black' }));
    expect(Object.hasOwn(withStarFill(star({ fill: 'black' }), 'white'), 'fill')).toBe(false);
    // No ends to drag, no path, no text, no colour, nothing behind a flap: its box moves, scales and turns it.
    expect(annotationEnds(star())).toEqual([]);
    expect([canBeShaped('star'), carriesText('star'), carriesColor('star'), behindEnds('star').length]).toEqual([false, false, false, 0]);
    expect(kindFromOtherSide('star')).toBe('star');
  });

  it('takes a turn within [0, 360) and a scale within half to four times, writing neither at upright and its print size', () => {
    expect(withGlyphAngle(star(), 370)).toEqual(star({ angle: 10 }));
    expect(withGlyphAngle(star(), -15)).toEqual(star({ angle: 345 }));
    expect(Object.hasOwn(withGlyphAngle(star({ angle: 30 }), 360), 'angle')).toBe(false);
    expect(withGlyphScale(star(), 9)).toEqual(star({ scale: GLYPH_SCALE.max }));
    expect(withGlyphScale(star(), 0.1)).toEqual(star({ scale: GLYPH_SCALE.min }));
    expect(Object.hasOwn(withGlyphScale(star({ scale: 2 }), 1), 'scale')).toBe(false);
    expect([glyphAngleOf(star()), glyphScaleOf(star())]).toEqual([0, 1]);
  });

  it('is cleaned as the file reads it: its point within reach and `to` on it, a fill only when filled, its turn and scale held', () => {
    const clean = star({ fill: 'black', angle: 30, scale: 2 });
    expect(cleanAnnotation(clean)).toBe(clean);
    // A fill this build does not write — as a hand-edited file might hold — is dropped.
    const white = { ...star({ to: [0.9, 0.9], angle: 400, scale: 7 }), fill: 'white' } as unknown as KnownDiagramAnnotation;
    expect(cleanAnnotation(white)).toEqual(star({ angle: 40, scale: GLYPH_SCALE.max }));
    expect(cleanAnnotation(star({ angle: Number.NaN, scale: Number.POSITIVE_INFINITY }))).toEqual(star());
    expect(cleanAnnotation(star({ from: [9, 9], to: [9, 9] })).from).toEqual([ANNOTATION_REACH, ANNOTATION_REACH]);
  });

  it('keeps its turn and its scale through a carry: only its centre goes with the picture (R3-32 A)', () => {
    const turned = star({ angle: 20, scale: 1.5 });
    const quarter: PictureMove = { point: ([x, y]) => [1 - y, x], mirrors: false, turnDeg: 90 };
    expect(carryAnnotation(turned, quarter)).toEqual({ ...turned, from: [0.6, 0.3], to: [0.6, 0.3] });
    const mirrored = carryAnnotation(turned, mirrorMove(SQUARE));
    expect(mirrored).toEqual({ ...turned, from: [0.7, 0.4], to: [0.7, 0.4] });
    // Onto the paper's other side (Turn Over) it is still a star, as it was.
    expect(carryAnnotation(turned, { ...mirrorMove(SQUARE), otherSide: true })).toEqual(mirrored);
    // Grown with the picture, as into an enlarged step's window: its print size kept.
    const grown: PictureMove = { point: ([x, y]) => [2 * x, 2 * y], mirrors: false, turnDeg: 0 };
    expect(carryAnnotation(turned, grown).scale).toBe(1.5);
    // Moved, as a paste moves it.
    expect(moveAnnotation(turned, [0.25, 0.25])).toEqual({ ...turned, from: [0.55, 0.65], to: [0.55, 0.65] });
  });
});

describe('an eye (Revision 3)', () => {
  const eye = (more: Partial<KnownDiagramAnnotation> = {}): KnownDiagramAnnotation => ({
    id: 'e-1',
    kind: 'eye',
    from: [0.3, 0.4],
    to: [0.3, 0.4],
    ...more,
  });
  const WIDE = { width: 1, height: 0.5 };

  it('is put down where a drag starts, looking toward where it ends, at any angle (R3-8 A)', () => {
    // Down and to the right, 45° clockwise from looking right.
    expect(createAnnotation('eye', [0.3, 0.4], [0.5, 0.6], SQUARE, id)).toEqual({
      id: 'annotation-1',
      kind: 'eye',
      from: [0.3, 0.4],
      to: [0.3, 0.4],
      angle: 45,
    });
    // Straight right: looking right, its angle unsaid.
    expect(createAnnotation('eye', [0.3, 0.4], [0.8, 0.4], SQUARE, id)).toEqual({ id: 'annotation-1', kind: 'eye', from: [0.3, 0.4], to: [0.3, 0.4] });
    // Up and to the left at a free angle, kept to a hundredth of a degree.
    const free = createAnnotation('eye', [0.3, 0.4], [0.1, 0.33], SQUARE, id);
    expect(free.angle).toBe(keptTo(((Math.atan2(-0.07, -0.2) * 180) / Math.PI + 360) % 360, 0.01));
    expect(free.angle).toBeCloseTo(199.29, 2);
  });

  it('is held to 15° steps with Shift (R3-28 A)', () => {
    expect(eyeLooking([0.3, 0.4], [0.1, 0.33], SQUARE, { steps: true }, id).angle).toBe(195);
    expect(eyeLooking([0.3, 0.4], [0.5, 0.41], SQUARE, { steps: true }, id).angle).toBeUndefined();
    expect(eyeLooking([0.3, 0.4], [0.3, 0.1], SQUARE, { steps: true }, id).angle).toBe(270);
  });

  it('looks at the picture’s middle when it is clicked, or dragged shorter than a slip, and right from the middle itself', () => {
    // From the top left of a wide frame, toward (0.5, 0.25): down and to the right.
    const clicked = createAnnotation('eye', [0.1, 0.05], [0.1, 0.05], WIDE, id);
    expect(clicked.angle).toBe(keptTo((Math.atan2(0.2, 0.4) * 180) / Math.PI, 0.01));
    const short = createAnnotation('eye', [0.9, 0.25], [0.9 + MIN_ANNOTATION_LENGTH / 2, 0.25], WIDE, id);
    expect(short.angle).toBe(180);
    expect(createAnnotation('eye', [0.5, 0.25], [0.5, 0.25], WIDE, id).angle).toBeUndefined();
    expect(placedByClick('eye')).toBe(true);
    expect(isDegenerate(clicked, MIN_ANNOTATION_LENGTH)).toBe(false);
  });

  it('has no ends, path, text, colour or anything behind a flap: its box moves, scales and turns it', () => {
    expect(annotationEnds(eye())).toEqual([]);
    expect([canBeShaped('eye'), carriesText('eye'), carriesColor('eye'), behindEnds('eye').length]).toEqual([false, false, false, 0]);
    expect(kindFromOtherSide('eye')).toBe('eye');
    expect(withGlyphAngle(eye(), -90)).toEqual(eye({ angle: 270 }));
    expect(withGlyphScale(eye(), 6)).toEqual(eye({ scale: GLYPH_SCALE.max }));
  });

  it('is cleaned as the file reads it: its centre within reach and `to` on it, never filled, its turn and scale held', () => {
    const clean = eye({ angle: 200, scale: 2 });
    expect(cleanAnnotation(clean)).toBe(clean);
    const loose = { ...eye({ to: [0.9, 0.9], angle: 450, scale: 0.1 }), fill: 'black' } as KnownDiagramAnnotation;
    expect(cleanAnnotation(loose)).toEqual(eye({ angle: 90, scale: GLYPH_SCALE.min }));
    expect(cleanAnnotation(eye({ angle: Number.NaN }))).toEqual(eye());
  });

  it('flips about its centre: Horizontal to 180° less the way it looks, Vertical to its negative (R3-9b A)', () => {
    expect(flipsOver('eye')).toBe(true);
    const looking = eye({ angle: 30, scale: 1.5 });
    expect(flipCentre(looking)).toEqual([0.3, 0.4]);
    expect(flipAnnotation(looking, 'horizontal')).toEqual(eye({ angle: 150, scale: 1.5 }));
    expect(flipAnnotation(looking, 'vertical')).toEqual(eye({ angle: 330, scale: 1.5 }));
    // Looking left, a horizontal flip has it look right: its angle unsaid again.
    expect(flipAnnotation(eye({ angle: 180 }), 'horizontal')).toEqual(eye());
    // Looking straight down, Horizontal changes nothing; Vertical has it look up.
    expect(flipChangesMark(eye({ angle: 90 }), 'horizontal')).toBe(false);
    expect(flipAnnotation(eye({ angle: 90 }), 'vertical')).toEqual(eye({ angle: 270 }));
  });

  it('has no arc to flip: F on an eye is its Flip row’s Horizontal, not a half turn (R3-9b A, F amended 2026-10-08)', () => {
    expect(flipsArc('eye')).toBe(false);
    const looking = eye({ angle: 30, scale: 2 });
    expect(flipAnnotationArc(looking)).toBe(looking);
    expect(flipChangesArc(looking)).toBe(false);
  });

  it('turns with the picture through a carry, a mirror reflecting the way it looks; its scale a print size', () => {
    const looking = eye({ angle: 30, scale: 1.5 });
    // A quarter turn clockwise: its centre with the paper, and the way it looks a quarter on.
    const quarter: PictureMove = { point: ([x, y]) => [1 - y, x], mirrors: false, turnDeg: 90 };
    expect(carryAnnotation(looking, quarter)).toEqual(eye({ from: [0.6, 0.3], to: [0.6, 0.3], angle: 120, scale: 1.5 }));
    // Mirrored left to right: 180° less it.
    const mirrored = carryAnnotation(looking, mirrorMove(SQUARE));
    expect(mirrored).toEqual(eye({ from: [0.7, 0.4], to: [0.7, 0.4], angle: 150, scale: 1.5 }));
    // Turn Over: mirrored with the paper, and still an eye.
    expect(carryAnnotation(looking, { ...mirrorMove(SQUARE), otherSide: true })).toEqual(mirrored);
    // A spread's own turn there, by `vector`: a quarter turn back.
    const spread: PictureMove = { point: ([x, y]) => [x + 0.1, y], vector: ([x, y]) => [y, -x], mirrors: false, turnDeg: -90 };
    expect(carryAnnotation(looking, spread)).toEqual(eye({ from: [0.4, 0.4], to: [0.4, 0.4], angle: 300, scale: 1.5 }));
    // Grown with the picture, as into an enlarged step's window: its print size kept, the way it looks too.
    const grown: PictureMove = { point: ([x, y]) => [2 * x, 2 * y], mirrors: false, turnDeg: 0 };
    expect(carryAnnotation(looking, grown)).toEqual(eye({ from: [0.6, 0.8], to: [0.6, 0.8], angle: 30, scale: 1.5 }));
    // Moved, as a paste moves it.
    expect(moveAnnotation(looking, [0.25, 0.25])).toEqual({ ...looking, from: [0.55, 0.65], to: [0.55, 0.65] });
  });
});

describe('an oval and a rectangle (Revision 3)', () => {
  const shape = (kind: 'oval' | 'rectangle', more: Partial<KnownDiagramAnnotation> = {}): KnownDiagramAnnotation => ({
    id: 's-1',
    kind,
    from: [0.4, 0.5],
    to: [0.4, 0.5],
    size: [0.4, 0.2],
    ...more,
  });
  const near = (actual: readonly number[], expected: readonly number[]) =>
    actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 9));

  it('is dragged corner to corner as Enlarge in Frame’s area is, free of any snap: Shift a circle or a square, Alt from its middle (R3-10b A)', () => {
    expect(areaFromCorners('oval', [0.1, 0.2], [0.5, 0.4], {}, id)).toEqual({
      id: 'annotation-1',
      kind: 'oval',
      from: [0.30000000000000004, 0.30000000000000004],
      to: [0.30000000000000004, 0.30000000000000004],
      size: [0.4, 0.2],
    });
    // Dragged up and to the left, the same box.
    expect(areaFromCorners('rectangle', [0.5, 0.4], [0.1, 0.2], {}, id).size).toEqual([0.4, 0.2]);
    expect(areaFromCorners('oval', [0.1, 0.2], [0.5, 0.4], { square: true }, id).size).toEqual([0.4, 0.4]);
    expect(areaFromCorners('rectangle', [0.5, 0.5], [0.6, 0.55], { fromMiddle: true }, id)).toMatchObject({ from: [0.5, 0.5] });
    near(areaFromCorners('rectangle', [0.5, 0.5], [0.6, 0.55], { fromMiddle: true }, id).size!, [0.2, 0.1]);
    // As the tool lays one, and a click a standard size round where it was clicked.
    expect(createAnnotation('rectangle', [0.1, 0.2], [0.5, 0.4], SQUARE, id)).toEqual(areaFromCorners('rectangle', [0.1, 0.2], [0.5, 0.4], {}, id));
    expect(createAnnotation('oval', [0.3, 0.3], [0.3, 0.3], SQUARE, id)).toMatchObject({ from: [0.3, 0.3], size: [0.3, 0.3] });
    expect(placedByClick('oval')).toBe(true);
    expect(placedByClick('rectangle')).toBe(true);
    expect(isDegenerate(shape('oval'), MIN_ANNOTATION_LENGTH)).toBe(false);
  });

  it('is held to an enlarge area’s sides’ range, from a slip to twice the frame (R3-30b A)', () => {
    expect(AREA_SIDE).toEqual({ min: MIN_ANNOTATION_LENGTH, max: 2 });
    expect(areaFromCorners('oval', [-1, -1], [3, 0.4], {}, id).size).toEqual([2, 1.4]);
    expect(withAreaBox(shape('rectangle'), [0.5, 0.5], [5, 0.001]).size).toEqual([2, MIN_ANNOTATION_LENGTH]);
  });

  it('is cleaned as the file reads it: its centre within reach and `to` on it, its size held, its turn within [0, 180)', () => {
    const clean = shape('oval', { angle: 30 });
    expect(cleanAnnotation(clean)).toBe(clean);
    expect(cleanAnnotation(shape('rectangle', { to: [0.9, 0.9], size: [3, 0.1], angle: 210 }))).toEqual(
      shape('rectangle', { size: [2, 0.1], angle: 30 })
    );
    const { size: _none, ...unsized } = shape('oval');
    expect(cleanAnnotation(unsized)).toEqual(shape('oval', { size: [0.3, 0.3] }));
    expect(cleanAnnotation(shape('oval', { angle: Number.NaN }))).toEqual(shape('oval'));
  });

  it('is turned within [0, 180), a hundredth of a degree at a time, and written only when it is turned', () => {
    expect(withAreaAngle(shape('oval'), 37.123)).toEqual(shape('oval', { angle: 37.12 }));
    expect(withAreaAngle(shape('oval'), -30)).toEqual(shape('oval', { angle: 150 }));
    expect(withAreaAngle(shape('rectangle', { angle: 40 }), 180)).toEqual(shape('rectangle'));
    expect(withAreaAngle(shape('rectangle'), 179.996)).toEqual(shape('rectangle'));
  });

  it('has no ends, no path, no text, no colour, nothing behind a flap and no Flip: its box scales and turns it', () => {
    for (const kind of ['oval', 'rectangle'] as const) {
      expect(annotationEnds(shape(kind))).toEqual([]);
      expect(canBeShaped(kind)).toBe(false);
      expect(carriesText(kind)).toBe(false);
      expect(carriesColor(kind)).toBe(false);
      expect(behindEnds(kind)).toEqual([]);
      expect(flipsOver(kind)).toBe(false);
      expect(flipsArc(kind)).toBe(false);
      expect(kindFromOtherSide(kind)).toBe(kind);
    }
  });

  it('is carried with the paper as an enlarge area is (`carryArea`): its centre with the face, its size by the move’s scale, its turn by its turn, a mirror negating it', () => {
    const turned = shape('oval', { angle: 30 });
    // A quarter turn clockwise about the middle, the picture grown half again.
    const quarter: PictureMove = {
      point: ([x, y]) => [0.5 + 1.5 * (0.5 - y), 0.5 + 1.5 * (x - 0.5)],
      mirrors: false,
      turnDeg: 90,
    };
    const carried = carryAnnotation(turned, quarter);
    near(carried.from, [0.5, 0.35]);
    expect(carried.to).toEqual(carried.from);
    near(carried.size!, [0.6, 0.3]);
    expect(carried.angle).toBeCloseTo(120, 9);
    // Mirrored left to right, and Turn Over: its angle negated, its centre with the paper.
    const mirrored = carryAnnotation(turned, mirrorMove(SQUARE));
    expect(mirrored).toEqual(shape('oval', { from: [0.6, 0.5], to: [0.6, 0.5], angle: 150 }));
    expect(carryAnnotation(turned, { ...mirrorMove(SQUARE), otherSide: true })).toEqual(mirrored);
    expect(carryAnnotation(mirrored, mirrorMove(SQUARE)).angle).toBeCloseTo(30, 9);
    // An upright rectangle mirrored is upright still: no angle written.
    expect('angle' in carryAnnotation(shape('rectangle'), mirrorMove(SQUARE))).toBe(false);
    // A spread's own turn there, by `vector`: never stretched with the face under its rim.
    const spread: PictureMove = { point: ([x, y]) => [x + 0.1, y * 3], vector: ([x, y]) => [y, -x], mirrors: false, turnDeg: -90 };
    const spreadOut = carryAnnotation(turned, spread);
    near(spreadOut.from, [0.5, 1.5]);
    near(spreadOut.size!, [0.4, 0.2]);
    expect(spreadOut.angle).toBeCloseTo(120, 9);
    // Grown with the picture, as into an enlarged step's window: it rings the same part of the picture.
    const grown: PictureMove = { point: ([x, y]) => [2 * x, 2 * y], mirrors: false, turnDeg: 0 };
    expect(carryAnnotation(turned, grown)).toEqual(shape('oval', { from: [0.8, 1], to: [0.8, 1], size: [0.8, 0.4], angle: 30 }));
  });
});
