import { describe, expect, it } from 'vitest';
import type { DiagramAnnotation, KnownDiagramAnnotation } from '../document/diagramDocument';
import { pathArrowGeometry } from '../../cp-workspace/references/stepDiagramGeometry';
import { cubicPoint } from '../../lib/cubicBezier';
import { ARROW_BEND, arrowApex, calloutShape, flipAnnotationArc, pathCubics, rightAngleAt } from './annotationModel';
import { arrowPolyline, circleRadius, hitAnnotation, hitPathGrip, rightAngleGrips, rightAngleLegs } from './annotationHit';

/** About the canvas's: an ink is about 0.0066 of the frame. */
const SIZES = { tolerance: 0.02, glyph: 0.05, label: 0.05, ink: 0.0066 };

const line: KnownDiagramAnnotation = { id: 'line', kind: 'valley-line', from: [0.1, 0.5], to: [0.9, 0.5] };
const arrow: KnownDiagramAnnotation = { id: 'arrow', kind: 'valley-arrow', from: [0.2, 0.3], to: [0.6, 0.3], bend: 0.2 };
const sign: KnownDiagramAnnotation = { id: 'sign', kind: 'turn-over', from: [0.8, 0.8], to: [0.8, 0.8] };
const label: KnownDiagramAnnotation = { id: 'label', kind: 'label', from: [0.5, 0.5], to: [0.5, 0.5], text: 'AB' };

describe('hitAnnotation', () => {
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

describe('a right angle', () => {
  // Opening down and to the right from (0.5, 0.5): its square's sides along x and y, 7 ink long.
  const mark: KnownDiagramAnnotation = { id: 'square', kind: 'right-angle', ...rightAngleAt([0.5, 0.5], [1, 1]) };
  const side = 7 * SIZES.ink;
  const tight = { ...SIZES, tolerance: 0.004 };

  it('is its open square as drawn: the ends of its legs and the far corner, 7 ink a side', () => {
    const [a, b, c] = rightAngleLegs(mark, SIZES.ink);
    expect(a[0]).toBeCloseTo(0.5 + side, 12);
    expect(a[1]).toBeCloseTo(0.5, 12);
    expect(b[0]).toBeCloseTo(0.5 + side, 12);
    expect(b[1]).toBeCloseTo(0.5 + side, 12);
    expect(c[0]).toBeCloseTo(0.5, 12);
    expect(c[1]).toBeCloseTo(0.5 + side, 12);
  });

  it('is taken by its legs and anywhere in its square, and not past them', () => {
    expect(hitAnnotation([mark], [0.5 + side, 0.5 + side / 2], tight, null)).toEqual({ annotationId: 'square', part: 'body' });
    expect(hitAnnotation([mark], [0.5 + side / 3, 0.5 + side / 3], tight, null)?.annotationId).toBe('square');
    // Its corner is in its square: the place it marks.
    expect(hitAnnotation([mark], [0.5, 0.5], tight, null)?.annotationId).toBe('square');
    expect(hitAnnotation([mark], [0.5 + side + 0.006, 0.5 + side / 2], tight, null)).toBeNull();
    // The other side of its corner is the lines', not the mark's.
    expect(hitAnnotation([mark], [0.5 - 0.006, 0.5 - 0.006], tight, null)).toBeNull();
  });

  it('offers its corner and the way it opens when selected, and no ends', () => {
    const grips = rightAngleGrips(mark, SIZES.ink);
    expect(grips.corner).toEqual([0.5, 0.5]);
    expect(grips.direction[0]).toBeCloseTo(0.5 + side, 12);
    expect(grips.direction[1]).toBeCloseTo(0.5 + side, 12);
    expect(hitAnnotation([mark], [0.501, 0.5], tight, 'square')).toEqual({ annotationId: 'square', part: 'corner' });
    expect(hitAnnotation([mark], [0.5 + side, 0.5 + side + 0.001], tight, 'square')).toEqual({
      annotationId: 'square',
      part: 'direction',
    });
    // Its `to`, a short way along its diagonal, is no end of it.
    expect(hitAnnotation([mark], mark.to, tight, 'square')).toEqual({ annotationId: 'square', part: 'body' });
    // Not selected, a press on its corner takes it whole.
    expect(hitAnnotation([mark], [0.501, 0.5], tight, null)).toEqual({ annotationId: 'square', part: 'body' });
  });
});
