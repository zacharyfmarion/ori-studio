import { describe, expect, it } from 'vitest';
import type { DiagramAnnotation, KnownDiagramAnnotation } from '../document/diagramDocument';
import { pathArrowGeometry } from '../../cp-workspace/references/stepDiagramGeometry';
import { cubicPoint } from '../../lib/cubicBezier';
import { ARROW_BEND, arrowApex, calloutShape, flipAnnotationArc, pathCubics, rightAngleAt } from './annotationModel';
import {
  arrowPolyline,
  circleRadius,
  divisionsInPicture,
  divisionsOffsetGrip,
  hitAnnotation,
  hitPathGrip,
  pleatArrowInPicture,
  rightAngleGrips,
  rightAngleInPicture,
  starRadius,
} from './annotationHit';
import { transformBoxHandles } from './transformGrips';
import { PT_TO_CSS_PX } from '../../lib/paper/paperStyle';
import { DEFAULT_DIAGRAM_STYLE } from '../document/diagramDocument';
import { liftCardMarks } from '../references/referencesCardMarks';
import { pointsCard } from '../references/referencesCardMarks.fixtures';
import { CARD_FRAME_PX } from './paintAnnotations';
import { ANNOTATION_INK_MM } from './canvasInk';
import { labelCentre } from './annotationModel';

/** About the canvas's: an ink is about 0.0066 of the frame, a callout's outline at the default 1.05 pt pen 0.0025. */
const SIZES = { tolerance: 0.02, glyph: 0.05, label: 0.05, ink: 0.0066, calloutPen: 0.0025, px: 0.0025 };

const line: KnownDiagramAnnotation = { id: 'line', kind: 'valley-line', from: [0.1, 0.5], to: [0.9, 0.5] };
const arrow: KnownDiagramAnnotation = { id: 'arrow', kind: 'valley-arrow', from: [0.2, 0.3], to: [0.6, 0.3], bend: 0.2 };
const sign: KnownDiagramAnnotation = { id: 'sign', kind: 'turn-over', from: [0.8, 0.8], to: [0.8, 0.8] };
const label: KnownDiagramAnnotation = { id: 'label', kind: 'label', from: [0.5, 0.5], to: [0.5, 0.5], text: 'AB' };

describe('hitAnnotation', () => {
  // 17d review: a pulled letter's halo and the margin round it covered its ring's near rim, so the ring could only be
  // taken on its far side.
  it('takes a pulled ring anywhere on its rim, and its letter on its words or, with nothing under it, its halo', () => {
    const { annotations } = liftCardMarks(pointsCard(), false, { letters: true, highlights: true }, DEFAULT_DIAGRAM_STYLE)!;
    const letter = annotations.find((mark) => mark.kind === 'label')!;
    const ring = annotations.find((mark) => mark.kind === 'circle' && mark.from[0] === letter.from[0] && mark.from[1] === letter.from[1])!;
    const pair = [ring, letter];
    const r = circleRadius(SIZES.ink);
    for (let step = 0; step < 8; step += 1) {
      const angle = (step * Math.PI) / 4;
      const on: [number, number] = [ring.from[0] + r * Math.cos(angle), ring.from[1] + r * Math.sin(angle)];
      expect(hitAnnotation(pair, on, SIZES, null)?.annotationId).toBe(ring.id);
    }
    // The rim nearest the letter lies in the letter's halo and margin: the letter's when nothing is under it, or
    // when it is selected, to drag; else the ring's.
    const words = labelCentre(letter);
    const toWords = Math.hypot(words[0] - ring.from[0], words[1] - ring.from[1]);
    const near: [number, number] = [
      ring.from[0] + (r * (words[0] - ring.from[0])) / toWords,
      ring.from[1] + (r * (words[1] - ring.from[1])) / toWords,
    ];
    expect(hitAnnotation([letter], near, SIZES, null)?.annotationId).toBe(letter.id);
    expect(hitAnnotation(pair, near, SIZES, null)?.annotationId).toBe(ring.id);
    expect(hitAnnotation(pair, near, SIZES, letter.id)?.annotationId).toBe(letter.id);
    // Its words take it, over anything.
    expect(hitAnnotation(pair, words, SIZES, null)?.annotationId).toBe(letter.id);
  });

  it('takes a line by its length and an arrow by its arc, not its chord', () => {
    expect(hitAnnotation([line], [0.5, 0.51], SIZES, null)).toEqual({ annotationId: 'line', part: 'body' });
    expect(hitAnnotation([line], [0.5, 0.6], SIZES, null)).toBeNull();
    const apex = arrowApex(arrow.from, arrow.to, arrow.bend!);
    expect(hitAnnotation([arrow], apex, SIZES, null)?.annotationId).toBe('arrow');
    // The middle of the chord is a sagitta away from the arc.
    expect(hitAnnotation([arrow], [0.4, 0.3], SIZES, null)).toBeNull();
  });

  it('takes a sign within its reach, and a label within its letters', () => {
    expect(hitAnnotation([sign], [0.84, 0.8], SIZES, null)?.annotationId).toBe('sign');
    expect(hitAnnotation([sign], [0.9, 0.8], SIZES, null)).toBeNull();
    expect(hitAnnotation([label], [0.52, 0.51], SIZES, null)?.annotationId).toBe('label');
  });

  it('takes an end of the selected one before anything else', () => {
    expect(hitAnnotation([line], [0.9, 0.5], SIZES, 'line')).toEqual({ annotationId: 'line', part: 'to' });
    expect(hitAnnotation([line], [0.1, 0.5], SIZES, 'line')).toEqual({ annotationId: 'line', part: 'from' });
    // Unselected, an end is only its body.
    expect(hitAnnotation([line], [0.9, 0.5], SIZES, null)).toEqual({ annotationId: 'line', part: 'body' });
  });

  it('takes the topmost as drawn: a label over a line, whatever their order', () => {
    expect(hitAnnotation([label, line], [0.5, 0.5], SIZES, null)?.annotationId).toBe('label');
    expect(hitAnnotation([line, label], [0.5, 0.5], SIZES, null)?.annotationId).toBe('label');
  });

  it('takes a fold-and-unfold arrow by its return and its head, beside the outgoing arc', () => {
    const fold: KnownDiagramAnnotation = { id: 'fold', kind: 'fold-unfold-arrow', from: [0.2, 0.5], to: [0.7, 0.5], bend: 0.134 };
    // The head ends the return a little beside where the paper started: about 0.07 above it.
    const tight = { ...SIZES, tolerance: 0.005 };
    expect(hitAnnotation([fold], [0.199, 0.432], tight, null)?.annotationId).toBe('fold');
    expect(hitAnnotation([fold], [0.2, 0.36], tight, null)).toBeNull();
  });

  it('takes a circle by its ring, not its inside, where an arrow that lands on it ends', () => {
    const circle: KnownDiagramAnnotation = { id: 'circle', kind: 'circle', from: [0.5, 0.5], to: [0.5, 0.5] };
    const radius = circleRadius(SIZES.ink);
    // 3.07 ink: about 0.02 of the frame.
    expect(radius).toBeCloseTo(3.07 * SIZES.ink, 12);
    const tight = { ...SIZES, tolerance: 0.004 };
    expect(hitAnnotation([circle], [0.5 + radius, 0.5], tight, null)).toEqual({ annotationId: 'circle', part: 'body' });
    expect(hitAnnotation([circle], [0.5, 0.5 - radius - 0.003], tight, null)?.annotationId).toBe('circle');
    expect(hitAnnotation([circle], [0.5, 0.5], tight, null)).toBeNull();
    expect(hitAnnotation([circle], [0.5 + radius + 0.006, 0.5], tight, null)).toBeNull();
    // An arrow landing at its centre is the arrow's there; the ring is the circle's.
    const landing: KnownDiagramAnnotation = { id: 'landing', kind: 'push-arrow', from: [0.2, 0.5], to: [0.5, 0.5] };
    expect(hitAnnotation([circle, landing], [0.49, 0.5], tight, null)?.annotationId).toBe('landing');
    expect(hitAnnotation([landing, circle], [0.5, 0.5 + radius], tight, null)?.annotationId).toBe('circle');
    // Selected, it offers no ends: it has one place, and is moved whole.
    expect(hitAnnotation([circle], [0.5 + radius, 0.5], tight, 'circle')).toEqual({ annotationId: 'circle', part: 'body' });
  });

  it('leaves a circle its ring where a fold arrow drawn after it lands on it, stopped on the ring as drawn', () => {
    const a: KnownDiagramAnnotation = { id: 'a', kind: 'circle', from: [0.2, 0.5], to: [0.2, 0.5] };
    const b: KnownDiagramAnnotation = { id: 'b', kind: 'circle', from: [0.5, 0.5], to: [0.5, 0.5] };
    const radius = circleRadius(SIZES.ink);
    for (const arrow of [
      { id: 'arrow', kind: 'valley-arrow', from: [0.2, 0.5], to: [0.5, 0.5] },
      { id: 'arrow', kind: 'mountain-arrow', from: [0.2, 0.5], to: [0.5, 0.5] },
      flipAnnotationArc({ id: 'arrow', kind: 'valley-arrow', from: [0.2, 0.5], to: [0.5, 0.5] }),
    ] as KnownDiagramAnnotation[]) {
      for (const tolerance of [0.008, 0.002]) {
        for (let k = 0; k < 8; k += 1) {
          const angle = (k * Math.PI) / 4;
          const press: [number, number] = [0.5 + radius * Math.cos(angle), 0.5 + radius * Math.sin(angle)];
          for (const selected of [null, 'b']) {
            const hit = hitAnnotation([a, b, arrow], press, { ...SIZES, tolerance }, selected);
            expect(hit?.annotationId, `${arrow.kind} ${tolerance} at ${k * 45}° ${selected}`).toBe('b');
          }
        }
      }
      // The arrow keeps the rest of its length.
      const line = arrowPolyline(arrow);
      expect(hitAnnotation([a, b, arrow], line[Math.floor(line.length / 2)]!, SIZES, null)?.annotationId).toBe('arrow');
    }
  });

  it('takes a hollow push anywhere on or in its outline, not only on its spine', () => {
    const push: KnownDiagramAnnotation = { id: 'push', kind: 'push-arrow', from: [0.2, 0.5], to: [0.6, 0.5] };
    const tight = { ...SIZES, tolerance: 0.005 };
    // The shaft's outline is about 0.021 off its spine, the head's barbs 0.05.
    expect(hitAnnotation([push], [0.4, 0.521], tight, null)?.annotationId).toBe('push');
    expect(hitAnnotation([push], [0.53, 0.545], tight, null)?.annotationId).toBe('push');
    expect(hitAnnotation([push], [0.4, 0.56], tight, null)).toBeNull();
  });

  it('takes a pleat arrow on its bolt as it is drawn, its Zs on the side it says, and anywhere in its head (15c)', () => {
    const pleat: KnownDiagramAnnotation = { id: 'pleat', kind: 'pleat-arrow', from: [0.2, 0.5], to: [0.6, 0.5] };
    const tight = { ...SIZES, tolerance: 0.001 };
    const shape = pleatArrowInPicture(pleat, SIZES.ink)!;
    for (const { x, y } of shape.shaft!) expect(hitAnnotation([pleat], [x, y], tight, null)?.annotationId).toBe('pleat');
    // The Z's far corner is the bolt's, not a mirrored one's: that steps the other way.
    const corner = shape.bolt[2]!;
    expect(hitAnnotation([{ ...pleat, mirrored: true }], [corner.x, corner.y], tight, null)).toBeNull();
    const { tip, barbs } = shape.head;
    const inside: [number, number] = [(2 * tip.x + barbs[0].x + barbs[1].x) / 4, (2 * tip.y + barbs[0].y + barbs[1].y) / 4];
    expect(hitAnnotation([pleat], inside, tight, null)?.annotationId).toBe('pleat');
  });

  it('takes a white arrow anywhere in its hollow outline, as wide as its width draws it', () => {
    const white = (width: 'narrow' | 'regular' | 'wide', tail: 'pointed' | 'square' = 'square'): KnownDiagramAnnotation => ({
      id: width,
      kind: 'white-arrow',
      from: [0.2, 0.5],
      to: [0.8, 0.5],
      path: [{ at: [0.2, 0.5] }, { at: [0.8, 0.5] }],
      width,
      tail,
    });
    const tight = { ...SIZES, tolerance: 0.005 };
    // Half a neck off the spine: narrow 0.021, regular 0.036, wide 0.050 of the frame at this ink.
    expect(hitAnnotation([white('narrow')], [0.4, 0.53], tight, null)).toBeNull();
    expect(hitAnnotation([white('regular')], [0.4, 0.53], tight, null)?.annotationId).toBe('regular');
    expect(hitAnnotation([white('regular')], [0.4, 0.545], tight, null)).toBeNull();
    expect(hitAnnotation([white('wide')], [0.4, 0.545], tight, null)?.annotationId).toBe('wide');
    // A pointed tail is narrow where it starts: a press beside it there misses.
    expect(hitAnnotation([white('regular', 'square')], [0.21, 0.53], tight, null)?.annotationId).toBe('regular');
    expect(hitAnnotation([white('regular', 'pointed')], [0.21, 0.53], tight, null)).toBeNull();
    // Its head, out past the shaft by its barbs.
    expect(hitAnnotation([white('regular')], [0.73, 0.565], tight, null)?.annotationId).toBe('regular');
    // Bent, it is taken on the curve it was shaped along, not on its chord.
    const bent: KnownDiagramAnnotation = {
      ...white('regular'),
      path: [{ at: [0.2, 0.5], out: [0.35, 0.2] }, { at: [0.8, 0.5], in: [0.65, 0.2] }],
    };
    expect(hitAnnotation([bent], [0.5, 0.5], tight, null)).toBeNull();
    expect(hitAnnotation([bent], [0.5, 0.3], tight, null)?.annotationId).toBe('regular');
    expect(hitPathGrip(bent, [0.8, 0.5], 0.01, null)).toEqual({ part: 'node', node: 1 });
    expect(hitPathGrip(bent, [0.5, 0.276], 0.01, null)).toMatchObject({ part: 'segment', segment: 0 });
  });

  it('gives a press inside a hollow arrow drawn over a circle to the arrow, which hides it there (review)', () => {
    const circle: KnownDiagramAnnotation = { id: 'circle', kind: 'circle', from: [0.5, 0.5], to: [0.5, 0.5] };
    const white: KnownDiagramAnnotation = {
      id: 'white',
      kind: 'white-arrow',
      from: [0.3, 0.5],
      to: [0.75, 0.5],
      path: [{ at: [0.3, 0.5] }, { at: [0.75, 0.5] }],
      width: 'regular',
      tail: 'square',
    };
    // On the hidden circle's ring, inside the arrow's white.
    const ring: [number, number] = [0.5, 0.5 - circleRadius(SIZES.ink)];
    expect(hitAnnotation([circle, white], ring, SIZES, null)?.annotationId).toBe('white');
    // Drawn over the arrow, the circle is seen, and taken by its ring.
    expect(hitAnnotation([white, circle], ring, SIZES, null)?.annotationId).toBe('circle');
    // With nothing over it, as before.
    expect(hitAnnotation([circle], ring, SIZES, null)?.annotationId).toBe('circle');
    // A mark drawn over the arrow there is taken as if the hidden circle were not (review).
    const press: [number, number] = [0.5 + circleRadius(SIZES.ink), 0.5];
    const marks: KnownDiagramAnnotation[] = [
      { id: 'fold', kind: 'valley-arrow', from: [press[0], 0.3], to: [press[0], 0.7], path: [{ at: [press[0], 0.3] }, { at: [press[0], 0.7] }] },
      { id: 'turn', kind: 'turn-over', from: press, to: press },
    ];
    for (const mark of marks) {
      expect(hitAnnotation([white, mark], press, SIZES, null)?.annotationId).toBe(mark.id);
      expect(hitAnnotation([circle, white, mark], press, SIZES, null)?.annotationId, mark.kind).toBe(mark.id);
    }
  });

  it('takes a selected circle anywhere on its ring, drawn over everything, though a hollow arrow covers it (review)', () => {
    const circle: KnownDiagramAnnotation = { id: 'circle', kind: 'circle', from: [0.5, 0.5], to: [0.5, 0.5] };
    const white: KnownDiagramAnnotation = {
      id: 'white',
      kind: 'white-arrow',
      from: [0.3, 0.5],
      to: [0.75, 0.5],
      path: [{ at: [0.3, 0.5] }, { at: [0.75, 0.5] }],
      width: 'regular',
      tail: 'square',
    };
    const push: KnownDiagramAnnotation = { id: 'push', kind: 'push-arrow', from: [0.3, 0.5], to: [0.75, 0.5] };
    const radius = circleRadius(SIZES.ink);
    for (const over of [white, push]) {
      for (let k = 0; k < 8; k += 1) {
        const angle = (k * Math.PI) / 4;
        for (const r of [radius - SIZES.tolerance / 2, radius, radius + SIZES.tolerance / 2]) {
          const press: [number, number] = [0.5 + r * Math.cos(angle), 0.5 + r * Math.sin(angle)];
          // Its washed ring is what a press takes hold of, to move it out from under.
          expect(hitAnnotation([circle, over], press, SIZES, 'circle'), `${over.kind} ${k * 45}° ${r}`).toEqual({
            annotationId: 'circle',
            part: 'body',
          });
        }
      }
    }
  });

  describe('a callout', () => {
    // Its point lower left, its box up to the right: "Repeat behind" is about 0.39 wide and 0.085 tall.
    const callout: KnownDiagramAnnotation = { id: 'callout', kind: 'callout', from: [0.2, 0.7], to: [0.6, 0.3], text: 'Repeat behind' };
    const { box, line } = calloutShape(callout);
    const tight = { ...SIZES, tolerance: 0.005 };

    it('takes its box anywhere on it — its words included — on its own, and its line as the whole', () => {
      expect(hitAnnotation([callout], [0.6, 0.3], tight, null)).toEqual({ annotationId: 'callout', part: 'box' });
      // On a letter near the box's end, and on the pad past the words.
      expect(hitAnnotation([callout], [box.x + 0.03, 0.3], tight, null)).toEqual({ annotationId: 'callout', part: 'box' });
      expect(hitAnnotation([callout], [box.x + 0.004, box.y + 0.004], tight, null)?.part).toBe('box');
      // Just outside its outline, within reach of it.
      expect(hitAnnotation([callout], [box.x + box.width + 0.004, 0.3], tight, null)?.part).toBe('box');
      // Halfway along its line: the whole.
      const middle: [number, number] = [(line![0][0] + line![1][0]) / 2, (line![0][1] + line![1][1]) / 2];
      expect(hitAnnotation([callout], middle, tight, null)).toEqual({ annotationId: 'callout', part: 'body' });
      // Beside the line, and past the box: nothing.
      expect(hitAnnotation([callout], [middle[0] + 0.02, middle[1] + 0.02], tight, null)).toBeNull();
      expect(hitAnnotation([callout], [box.x + box.width + 0.02, 0.3], tight, null)).toBeNull();
    });

    it('offers its point, selected, before its line — never its box’s middle, which is the box', () => {
      expect(hitAnnotation([callout], [0.201, 0.699], tight, 'callout')).toEqual({ annotationId: 'callout', part: 'from' });
      expect(hitAnnotation([callout], [0.201, 0.699], tight, null)).toEqual({ annotationId: 'callout', part: 'body' });
      expect(hitAnnotation([callout], [0.6, 0.3], tight, 'callout')).toEqual({ annotationId: 'callout', part: 'box' });
    });

    it('is over the marks and lines it lies on, and under a label', () => {
      const under: KnownDiagramAnnotation = { id: 'under', kind: 'valley-line', from: [0.3, 0.3], to: [0.9, 0.3] };
      const over: KnownDiagramAnnotation = { id: 'over', kind: 'label', from: [0.6, 0.3], to: [0.6, 0.3], text: 'A' };
      const circle: KnownDiagramAnnotation = { id: 'circle', kind: 'circle', from: [0.6, 0.3 + circleRadius(SIZES.ink)], to: [0.6, 0.3 + circleRadius(SIZES.ink)] };
      expect(hitAnnotation([callout, under], [0.7, 0.3], tight, null)?.annotationId).toBe('callout');
      expect(hitAnnotation([callout, circle], [0.6, 0.3], tight, null)?.annotationId).toBe('callout');
      // A push under its box, drawn after it: the box is over it, as it is drawn.
      const push: KnownDiagramAnnotation = { id: 'push', kind: 'push-arrow', from: [0.3, 0.3], to: [0.7, 0.3] };
      expect(hitAnnotation([push], [0.4, 0.3], tight, null)?.annotationId).toBe('push');
      expect(hitAnnotation([callout, push], [0.4, 0.3], tight, null)?.annotationId).toBe('callout');
      expect(hitAnnotation([over, callout], [0.6, 0.3], tight, null)?.annotationId).toBe('over');
    });

    it('takes its box on all of its outline as drawn, outside the box, at the heaviest pen too — over a line it covers (review)', () => {
      // A 12 pt arrow pen, as the canvas draws it: about 0.028 of the frame, the outline from the box's edge out.
      const pen = (12 * PT_TO_CSS_PX) / CARD_FRAME_PX;
      const heavy = { ...tight, calloutPen: pen };
      // A valley line under the outline's top, along the middle of its stroke.
      const under: KnownDiagramAnnotation = { id: 'under', kind: 'valley-line', from: [0.3, box.y - pen / 2], to: [0.9, box.y - pen / 2] };
      for (const out of [0, pen / 4, pen / 2, (3 * pen) / 4, pen]) {
        expect(hitAnnotation([callout, under], [0.6, box.y - out], heavy, null), `${out / pen} of the pen out`).toEqual({
          annotationId: 'callout',
          part: 'box',
        });
      }
      // Within reach of its outer edge, and past it.
      expect(hitAnnotation([callout], [0.6, box.y - pen - 0.004], heavy, null)?.part).toBe('box');
      expect(hitAnnotation([callout], [0.6, box.y - pen - 0.006], heavy, null)).toBeNull();
    });

    it('has no line to take with its point inside its box', () => {
      const covered: KnownDiagramAnnotation = { ...callout, from: [0.62, 0.31] };
      expect(calloutShape(covered).line).toBeNull();
      expect(hitAnnotation([covered], [0.62, 0.31], tight, null)?.part).toBe('box');
    });
  });

  it('takes a wide label by its ends', () => {
    const wide: KnownDiagramAnnotation = { id: 'wide', kind: 'label', from: [0.5, 0.5], to: [0.5, 0.5], text: '谷折りして山折り' };
    const latin: KnownDiagramAnnotation = { ...wide, id: 'latin', text: 'fold here' };
    expect(hitAnnotation([wide], [0.69, 0.5], SIZES, null)?.annotationId).toBe('wide');
    expect(hitAnnotation([latin], [0.69, 0.5], SIZES, null)).toBeNull();
  });

  describe('a shaped arrow', () => {
    // An S: up over its first node's handle, down under its second's.
    const shaped: KnownDiagramAnnotation = {
      id: 'shaped',
      kind: 'valley-arrow',
      from: [0.1, 0.5],
      to: [0.7, 0.5],
      path: [
        { at: [0.1, 0.5], out: [0.2, 0.3] },
        { at: [0.4, 0.5], in: [0.3, 0.7], out: [0.5, 0.3] },
        { at: [0.7, 0.5], in: [0.6, 0.7] },
      ],
    };
    const tight = { ...SIZES, tolerance: 0.004 };

    it('is taken along its curve, not along the arc its ends would make', () => {
      // The first segment's top, well off the chord and off any arc between the ends.
      const top = cubicPoint(pathCubics(shaped.path!)[0]!, 0.5);
      expect(hitAnnotation([shaped], [top[0], top[1] + 0.002], tight, null)?.annotationId).toBe('shaped');
      expect(hitAnnotation([shaped], [top[0], top[1] - 0.02], tight, null)).toBeNull();
      // Where the default arc between its ends would be, nothing is drawn.
      const arcTop = arrowApex(shaped.from, shaped.to, ARROW_BEND);
      expect(hitAnnotation([shaped], arcTop, tight, null)).toBeNull();
      expect(arrowPolyline(shaped)[0]).toEqual([0.1, 0.5]);
      expect(arrowPolyline(shaped).at(-1)).toEqual([0.7, 0.5]);
    });

    it('is taken by a fold-and-unfold arrow’s return, where the drawing puts it beside the path', () => {
      // A C: its return stands off on the outside, as drawn.
      const curve: KnownDiagramAnnotation = {
        id: 'fold',
        kind: 'fold-unfold-arrow',
        from: [0.2, 0.6],
        to: [0.6, 0.6],
        path: [
          { at: [0.2, 0.6], out: [0.25, 0.4] },
          { at: [0.6, 0.6], in: [0.55, 0.4] },
        ],
      };
      const drawn = pathArrowGeometry(
        pathCubics(curve.path!),
        'fold-unfold',
        (length) => ({
          head: Math.min(8.5 * SIZES.ink, 0.26 * length),
          offset: Math.min(10.56 * SIZES.ink, 0.26 * length),
          rim: 0,
        }),
        [],
        2e-4
      )!;
      const middle = drawn.back![Math.floor(drawn.back!.length / 2)]!;
      // Above the curve's own top, which is a press away from it.
      const top = cubicPoint(pathCubics(curve.path!)[0]!, 0.5);
      expect(middle[1]).toBeLessThan(top[1] - 2 * tight.tolerance);
      expect(hitAnnotation([curve], [middle[0], middle[1]], tight, null)?.annotationId).toBe('fold');
      // The same press is nothing to a one-way arrow along the same path.
      expect(hitAnnotation([{ ...curve, kind: 'valley-arrow' }], [middle[0], middle[1]], tight, null)).toBeNull();
      // And the head, which ends the return beside the tail.
      expect(hitAnnotation([curve], [drawn.head.tip.x, drawn.head.tip.y], tight, null)?.annotationId).toBe('fold');
    });

    it('is taken along a fold-and-unfold arrow’s return shaped by hand, and not where the derived one would be', () => {
      const curve: KnownDiagramAnnotation = {
        id: 'fold',
        kind: 'fold-unfold-arrow',
        from: [0.2, 0.6],
        to: [0.6, 0.6],
        path: [
          { at: [0.2, 0.6], out: [0.25, 0.4] },
          { at: [0.6, 0.6], in: [0.55, 0.4] },
        ],
      };
      // Under the path, where the drawing would put none.
      const shaped: KnownDiagramAnnotation = {
        ...curve,
        back: [
          { at: [0.6, 0.6], out: [0.55, 0.75] },
          { at: [0.25, 0.62], in: [0.3, 0.75] },
        ],
      };
      const below = cubicPoint(pathCubics(shaped.back!)[0]!, 0.5);
      expect(hitAnnotation([shaped], [below[0], below[1]], tight, null)?.annotationId).toBe('fold');
      expect(hitAnnotation([curve], [below[0], below[1]], tight, null)).toBeNull();
      // Above it, where the derived return stands, nothing is drawn once it is shaped.
      const derived = pathArrowGeometry(
        pathCubics(curve.path!),
        'fold-unfold',
        (length) => ({
          head: Math.min(8.5 * SIZES.ink, 0.26 * length),
          offset: Math.min(10.56 * SIZES.ink, 0.26 * length),
          rim: 0,
        }),
        [],
        2e-4
      )!;
      const above = derived.back![Math.floor(derived.back!.length / 2)]!;
      expect(hitAnnotation([curve], [above[0], above[1]], tight, null)?.annotationId).toBe('fold');
      expect(hitAnnotation([shaped], [above[0], above[1]], tight, null)).toBeNull();
    });
  });

  it('ignores one this build cannot read', () => {
    const unknown: DiagramAnnotation = { id: 'n', unknown: { id: 'n', kind: 'spiral' } };
    expect(hitAnnotation([unknown], [0.5, 0.5], SIZES, 'n')).toBeNull();
  });
});

describe('arrowPolyline', () => {
  it('runs from tail to tip through the apex', () => {
    const points = arrowPolyline(arrow);
    expect(points).toHaveLength(25);
    expect(points[0]![0]).toBeCloseTo(0.2, 9);
    expect(points[24]![0]).toBeCloseTo(0.6, 9);
    const apex = arrowApex(arrow.from, arrow.to, arrow.bend!);
    expect(points[12]![0]).toBeCloseTo(apex[0], 9);
    expect(points[12]![1]).toBeCloseTo(apex[1], 9);
  });

  it('is worked out once per annotation object, and again for an edited one', () => {
    const points = arrowPolyline(arrow);
    expect(arrowPolyline(arrow)).toBe(points);
    const flipped = flipAnnotationArc(arrow);
    expect(arrowPolyline(flipped)).not.toBe(points);
    // The other way round: the apex on the other side of the chord.
    expect(arrowPolyline(flipped)[12]![1]).toBeCloseTo(arrow.from[1] + (arrow.from[1] - points[12]![1]), 9);
  });
});

describe('hitPathGrip', () => {
  const S: KnownDiagramAnnotation = {
    id: 's',
    kind: 'mountain-arrow',
    from: [0.1, 0.5],
    to: [0.7, 0.5],
    path: [
      { at: [0.1, 0.5], out: [0.2, 0.3] },
      { at: [0.4, 0.5], in: [0.3, 0.6], out: [0.5, 0.4] },
      { at: [0.7, 0.5], in: [0.6, 0.7] },
    ],
  };
  const REACH = 0.01;

  it('takes a node, then the curve at its segment and t, and nothing off them', () => {
    expect(hitPathGrip(S, [0.404, 0.503], REACH, null)).toEqual({ part: 'node', node: 1 });
    const point = cubicPoint(pathCubics(S.path!)[1]!, 0.5);
    const curve = hitPathGrip(S, [point[0] + 0.002, point[1]], REACH, null);
    expect(curve).toMatchObject({ part: 'segment', segment: 1 });
    expect((curve as { t: number }).t).toBeCloseTo(0.5, 1);
    expect(hitPathGrip(S, [0.4, 0.8], REACH, null)).toBeNull();
  });

  it('takes the handles the selected node shows, and no others', () => {
    // Node 1's out handle, hidden while no node is selected: the press finds the empty paper there.
    expect(hitPathGrip(S, [0.5, 0.4], REACH, null)).toBeNull();
    expect(hitPathGrip(S, [0.5, 0.4], REACH, 1)).toEqual({ part: 'handle', node: 1, side: 'out' });
    // With the tail selected, its own handle and node 1's facing one; node 1's far one stays hidden.
    expect(hitPathGrip(S, [0.2, 0.3], REACH, 0)).toEqual({ part: 'handle', node: 0, side: 'out' });
    expect(hitPathGrip(S, [0.3, 0.6], REACH, 0)).toEqual({ part: 'handle', node: 1, side: 'in' });
    expect(hitPathGrip(S, [0.5, 0.4], REACH, 0)).toBeNull();
  });

  it('gives a handle drawn over its node the tie, so it can be pulled out', () => {
    // A handle a 1024th from its node, and a press exactly halfway: the same distance from both.
    const over: KnownDiagramAnnotation = {
      ...S,
      path: [S.path![0]!, { at: [0.5, 0.5], in: [0.3, 0.6], out: [0.5, 0.5 + 2 ** -10] }, S.path![2]!],
    };
    expect(hitPathGrip(over, [0.5, 0.5 + 2 ** -11], REACH, 1)).toEqual({ part: 'handle', node: 1, side: 'out' });
    expect(hitPathGrip(over, [0.5, 0.5 + 2 ** -10], REACH, 1)).toEqual({ part: 'handle', node: 1, side: 'out' });
    expect(hitPathGrip(over, [0.5, 0.5 - 2 ** -11], REACH, 1)).toEqual({ part: 'node', node: 1 });
  });

  it('holds an arc by the nodes its first edit would give it, and a kind that is not shaped by none', () => {
    expect(hitPathGrip(arrow, arrow.to, REACH, null)).toEqual({ part: 'node', node: 1 });
    const apex = arrowApex(arrow.from, arrow.to, arrow.bend!);
    expect(hitPathGrip(arrow, apex, REACH, null)).toMatchObject({ part: 'segment', segment: 0 });
    expect(hitPathGrip(line, line.from, REACH, null)).toBeNull();
  });
});

describe('a right angle (Revision 2)', () => {
  // Its vertex at (0.5, 0.5), opening down and to the right: its legs along x and y, 2 ink in from the lines.
  const mark: KnownDiagramAnnotation = { id: 'square', kind: 'right-angle', ...rightAngleAt([0.5, 0.5], [1, 1]) };
  const ink = SIZES.ink;
  const at = (x: number, y: number): [number, number] => [0.5 + x * ink, 0.5 + y * ink];
  const tight = { ...SIZES, tolerance: 0.004 };
  // A finger's reach (18 px) at fit, where an ink is about 3 screen px: about 6 ink.
  const finger = { ...SIZES, tolerance: (18 / 3) * ink };

  it('is its ∟ and its square as drawn, set into the angle off the vertex', () => {
    const { legs, square } = rightAngleInPicture(mark, ink);
    const expected = { legs: [at(7.5, 2), at(2, 2), at(2, 7.5)], square: [at(5.5, 2), at(5.5, 5.5), at(2, 5.5)] };
    for (const part of ['legs', 'square'] as const) {
      const points = { legs, square }[part];
      points.forEach((point, index) => {
        expect(point.x).toBeCloseTo(expected[part][index]![0], 12);
        expect(point.y).toBeCloseTo(expected[part][index]![1], 12);
      });
    }
  });

  it('is taken anywhere in its square and along its strokes, a leg’s far end included, and not past them', () => {
    expect(hitAnnotation([mark], at(3.75, 3.75), tight, null)).toEqual({ annotationId: 'square', part: 'body' });
    expect(hitAnnotation([mark], at(7.5, 2), tight, null)).toEqual({ annotationId: 'square', part: 'body' });
    expect(hitAnnotation([mark], at(2, 7.5), tight, null)).toEqual({ annotationId: 'square', part: 'body' });
    expect(hitAnnotation([mark], at(6.5, 2.25), tight, null)?.annotationId).toBe('square');
    expect(hitAnnotation([mark], [0.5 + 7.5 * ink + 0.006, 0.5 + 2 * ink], tight, null)).toBeNull();
    // Beyond the square, between the legs: the angle's, not the mark's.
    expect(hitAnnotation([mark], at(8, 8), tight, null)).toBeNull();
  });

  it('leaves the vertex to the lines that meet there, at a finger’s reach at fit', () => {
    // Nearer the vertex than its ∟'s corner, nothing; nearer the corner, the mark.
    expect(hitAnnotation([mark], [0.5, 0.5], finger, null)).toBeNull();
    expect(hitAnnotation([mark], at(0.9, 0.9), finger, null)).toBeNull();
    expect(hitAnnotation([mark], at(1.1, 1.1), finger, null)?.annotationId).toBe('square');
    // A valley ending at the vertex: a press there takes the line, though marks are taken over lines.
    const edge: KnownDiagramAnnotation = { id: 'edge', kind: 'valley-line', from: [0.5, 0.5], to: [0.5, 0.9] };
    expect(hitAnnotation([edge, mark], [0.5, 0.5], finger, null)).toEqual({ annotationId: 'edge', part: 'body' });
    expect(hitAnnotation([mark, edge], [0.5, 0.501], finger, null)).toEqual({ annotationId: 'edge', part: 'body' });
  });

  it('offers the vertex it marks and its square’s far corner when selected, and no ends', () => {
    const grips = rightAngleGrips(mark, ink);
    expect(grips.corner).toEqual([0.5, 0.5]);
    expect(grips.direction[0]).toBeCloseTo(0.5 + 5.5 * ink, 12);
    expect(grips.direction[1]).toBeCloseTo(0.5 + 5.5 * ink, 12);
    // The vertex, though the mark leaves it to the lines: selected, it is the grip that moves it.
    expect(hitAnnotation([mark], [0.501, 0.5], tight, 'square')).toEqual({ annotationId: 'square', part: 'corner' });
    expect(hitAnnotation([mark], [0.5 + 5.5 * ink, 0.5 + 5.5 * ink + 0.001], tight, 'square')).toEqual({
      annotationId: 'square',
      part: 'direction',
    });
    // Its `to`, a short way along its diagonal, is no end of it: there, inside its square, it is the mark's body.
    expect(hitAnnotation([mark], mark.to, tight, 'square')).toEqual({ annotationId: 'square', part: 'body' });
    // Not selected, a press on its vertex is not the mark's at all.
    expect(hitAnnotation([mark], [0.501, 0.5], tight, null)).toBeNull();
  });
});

describe('equal divisions (Revision 2)', () => {
  // Along a level line, their line 2.5 mm below it, numbered.
  const divisions: KnownDiagramAnnotation = {
    id: 'd',
    kind: 'divisions',
    from: [0.2, 0.5],
    to: [0.8, 0.5],
    parts: 4,
    offset: 2.5,
    numbered: true,
  };
  const tight = { ...SIZES, tolerance: 0.004 };
  const below = (2.5 / ANNOTATION_INK_MM) * SIZES.ink;

  it('are their ink as drawn: the line set off the measured line, the dividers and the ticks', () => {
    const shape = divisionsInPicture(divisions, SIZES.ink)!;
    expect(shape.line[0].y).toBeCloseTo(0.5 + below, 12);
    expect(shape.dividers).toHaveLength(5);
    expect(shape.ticks).toHaveLength(4);
  });

  it('are taken on their line, a divider or a tick, and on their count’s box — never on the line they measure', () => {
    expect(hitAnnotation([divisions], [0.35, 0.5 + below], tight, null)).toEqual({ annotationId: 'd', part: 'body' });
    // Down a divider, past the line.
    expect(hitAnnotation([divisions], [0.5, 0.5 + below + 3 * SIZES.ink], tight, null)?.annotationId).toBe('d');
    // On a tick, off the line along its lean.
    const [tickTop] = divisionsInPicture(divisions, SIZES.ink)!.ticks[0]!;
    expect(hitAnnotation([divisions], [tickTop.x, tickTop.y], tight, null)?.annotationId).toBe('d');
    const { at } = divisionsInPicture(divisions, SIZES.ink)!.number!;
    expect(hitAnnotation([divisions], [at.x, at.y], tight, null)?.annotationId).toBe('d');
    // Along the measured line, between dividers, nothing is theirs.
    expect(hitAnnotation([divisions], [0.4, 0.5], tight, null)).toBeNull();
  });

  it('offer, selected, the ends of the line they measure and a handle at the middle of their line', () => {
    expect(hitAnnotation([divisions], [0.8, 0.5], tight, 'd')).toEqual({ annotationId: 'd', part: 'to' });
    expect(hitAnnotation([divisions], [0.2, 0.5], tight, 'd')).toEqual({ annotationId: 'd', part: 'from' });
    const grip = divisionsOffsetGrip(divisions, SIZES.ink);
    expect(grip[0]).toBeCloseTo(0.5, 12);
    expect(grip[1]).toBeCloseTo(0.5 + below, 12);
    expect(hitAnnotation([divisions], grip, tight, 'd')).toEqual({ annotationId: 'd', part: 'offset' });
    // Unselected, the handle is only their body.
    expect(hitAnnotation([divisions], grip, tight, null)).toEqual({ annotationId: 'd', part: 'body' });
  });

  it('are taken on a short divider where it is drawn, across their line, and not where a full one would run (Revision 3)', () => {
    const far = { ...divisions, offset: 10, numbered: undefined };
    const out = (10 / ANNOTATION_INK_MM) * SIZES.ink;
    // An interior divider, 3 mm off the line it measures: a full one runs there, a short one does not.
    const low: [number, number] = [0.35, 0.5 + (3 / ANNOTATION_INK_MM) * SIZES.ink];
    expect(hitAnnotation([far], low, tight, null)?.annotationId).toBe('d');
    expect(hitAnnotation([{ ...far, shortDividers: true }], low, tight, null)).toBeNull();
    // Across the line, 2 ink short of it: both.
    const across: [number, number] = [0.35, 0.5 + out - 2 * SIZES.ink];
    expect(hitAnnotation([{ ...far, shortDividers: true }], across, tight, null)?.annotationId).toBe('d');
    // The end dividers still run to the line they measure.
    expect(hitAnnotation([{ ...far, shortDividers: true }], [0.2, low[1]], tight, null)?.annotationId).toBe('d');
    expect(divisionsInPicture({ ...far, shortDividers: true }, SIZES.ink)!.dividers[1]![0].y).toBeCloseTo(0.5 + out - 5 * SIZES.ink, 12);
  });
});

describe('a star (Revision 3)', () => {
  const star: KnownDiagramAnnotation = { id: 'star', kind: 'star', from: [0.5, 0.5], to: [0.5, 0.5] };

  it('is taken anywhere inside its tips’ reach, at its scale', () => {
    const r = starRadius(star, SIZES.ink);
    // 4.5 ink and half an ink for an outline's pen.
    expect(r).toBeCloseTo(5 * SIZES.ink, 12);
    expect(hitAnnotation([star], [0.5, 0.5], SIZES, null)).toEqual({ annotationId: 'star', part: 'body' });
    expect(hitAnnotation([star], [0.5 + r + SIZES.tolerance - 1e-6, 0.5], SIZES, null)?.annotationId).toBe('star');
    expect(hitAnnotation([star], [0.5 + r + SIZES.tolerance + 1e-3, 0.5], SIZES, null)).toBeNull();
    const big = { ...star, scale: 3 };
    const R = starRadius(big, SIZES.ink);
    expect(R).toBeCloseTo((4.5 * 3 + 0.5) * SIZES.ink, 12);
    expect(hitAnnotation([big], [0.5, 0.5 + R + SIZES.tolerance - 1e-6], SIZES, null)?.annotationId).toBe('star');
    expect(hitAnnotation([star], [0.5, 0.5 + R + SIZES.tolerance - 1e-6], SIZES, null)).toBeNull();
  });

  it('offers its transform box’s handles once selected, before anything under them, and none before', () => {
    const { handles } = transformBoxHandles(star, SIZES.px)!;
    const corner = handles.scale.find((each) => each.handle === 'ne')!.at;
    const turn = handles.rotate.find((each) => each.corner === 'sw')!.at;
    // A line drawn over the corner's square and over the turn handle: the box is taken first.
    const over = (at: { x: number; y: number }, id: string): KnownDiagramAnnotation => ({
      id,
      kind: 'solid-line',
      from: [at.x - 0.1, at.y],
      to: [at.x + 0.1, at.y],
    });
    const lines = [star, over(corner, 'over-corner'), over(turn, 'over-turn')];
    expect(hitAnnotation(lines, [corner.x, corner.y], SIZES, 'star')).toEqual({
      annotationId: 'star',
      part: 'transform',
      handle: { kind: 'scale', handle: 'ne' },
    });
    expect(hitAnnotation(lines, [turn.x, turn.y], SIZES, 'star')).toEqual({
      annotationId: 'star',
      part: 'transform',
      handle: { kind: 'rotate', corner: 'sw' },
    });
    // Not selected: no box, and the line is what is there.
    expect(hitAnnotation(lines, [turn.x, turn.y], SIZES, null)?.annotationId).toBe('over-turn');
    const under: KnownDiagramAnnotation = { id: 'under', kind: 'valley-line', from: [0.4, 0.5], to: [0.6, 0.5] };
    // Its body moves it, selected or not.
    expect(hitAnnotation([under, star], [0.5, 0.5], SIZES, 'star')).toEqual({ annotationId: 'star', part: 'body' });
  });

  it('is moved by a finger on it, selected, though its box is at its 24 px floor and a corner within the finger’s reach (18b review)', () => {
    // A screen px of 0.0025: the box is drawn at its floor, each corner 17 px from the middle; a finger reaches 18.
    const finger = { ...SIZES, tolerance: 18 * SIZES.px };
    const { box } = transformBoxHandles(star, SIZES.px)!;
    expect(box.width / SIZES.px).toBeCloseTo(24, 9);
    for (const press of [[0.5, 0.5], [0.5 + 3 * SIZES.px, 0.5 - 3 * SIZES.px], [0.5, 0.5 + 8 * SIZES.px]] as [number, number][]) {
      expect(hitAnnotation([star], press, finger, 'star'), `${press}`).toEqual({ annotationId: 'star', part: 'body' });
    }
    // A square still takes a press on it.
    const corner = transformBoxHandles(star, SIZES.px)!.handles.scale.find((each) => each.handle === 'sw')!.at;
    expect(hitAnnotation([star], [corner.x, corner.y], finger, 'star')).toMatchObject({ part: 'transform', handle: { kind: 'scale', handle: 'sw' } });
  });

  it('hides a circle drawn before it where its arms cover the ring, filled or not, and leaves it the ring between them (18b review)', () => {
    const circle: KnownDiagramAnnotation = { id: 'circle', kind: 'circle', from: [0.5, 0.5], to: [0.5, 0.5] };
    const r = circleRadius(SIZES.ink);
    const onRing = (degrees: number): [number, number] => {
      const a = (degrees * Math.PI) / 180;
      return [0.5 + r * Math.sin(a), 0.5 - r * Math.cos(a)];
    };
    for (const over of [star, { ...star, fill: 'black' as const }, { ...star, angle: 36 }]) {
      // Its arms lie along its turn, every 72°; the ring shows between them.
      const arm = onRing(over.angle ?? 0);
      const gap = onRing((over.angle ?? 0) + 36);
      expect(hitAnnotation([circle, over], arm, SIZES, null)?.annotationId, `${over.fill} ${over.angle}`).toBe('star');
      expect(hitAnnotation([circle, over], gap, SIZES, null)?.annotationId, `${over.fill} ${over.angle}`).toBe('circle');
      // Drawn over the star, the circle is seen there.
      expect(hitAnnotation([over, circle], arm, SIZES, null)?.annotationId).toBe('circle');
      // Selected, its ring is drawn over everything.
      expect(hitAnnotation([circle, over], arm, SIZES, 'circle')?.annotationId).toBe('circle');
    }
  });
});
