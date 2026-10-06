import { describe, expect, it } from 'vitest';
import type { PicturePoint } from '../annotate/annotationModel';
import type { DiagramZoomOutline } from '../document/diagramDocument';
import { IMPRINT_CASES, craneStep, imprintCase } from './zoom.fixtures';
import {
  anchorPoint,
  defaultAnchor,
  faceAt,
  facePlacement,
  faceSpreadMove,
  fitPlacement,
  holds,
  imprintFrame,
  landFrame,
  landThrough,
  imprintThrough,
  offSpread,
  ontoSpread,
  paperFacesOf,
  pickAnchor,
  poleOf,
  rankedFaces,
  ringArea,
  topDrawn,
  topUnspread,
  unspreadOn,
  type StepFaces,
} from './zoomImprint';

const faces = (key: string): StepFaces => {
  const found = paperFacesOf(craneStep(key));
  if (!found) throw new Error(`no faces on ${key}`);
  return found;
};
const distance = (a: PicturePoint, b: PicturePoint) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Points inside a ring: its middle, and its corners pulled toward it by a few shares. */
function insideRing(ring: readonly PicturePoint[]): PicturePoint[] {
  const middle: PicturePoint = [
    ring.reduce((sum, [x]) => sum + x, 0) / ring.length,
    ring.reduce((sum, [, y]) => sum + y, 0) / ring.length,
  ];
  return [
    middle,
    ...[0.3, 0.6, 0.9].flatMap((share) =>
      ring.map(([x, y]): PicturePoint => [middle[0] + share * (x - middle[0]), middle[1] + share * (y - middle[1])])
    ),
  ];
}

/** Points inside a face, on the unspread picture. */
function insidePoints(stepFaces: StepFaces, face: number): PicturePoint[] {
  return insideRing(stepFaces.unspread[face]!);
}

/** Points just inside a ring's sides, half a px in from each side's middle and its thirds. */
function besideSides(ring: readonly PicturePoint[]): PicturePoint[] {
  const middle: PicturePoint = [
    ring.reduce((sum, [x]) => sum + x, 0) / ring.length,
    ring.reduce((sum, [, y]) => sum + y, 0) / ring.length,
  ];
  return ring.flatMap((a, index) => {
    const b = ring[(index + 1) % ring.length]!;
    return [1 / 3, 1 / 2, 2 / 3].map((t): PicturePoint => {
      const at: PicturePoint = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      const toward = distance(at, middle) || 1;
      return [at[0] + (0.5 * (middle[0] - at[0])) / toward, at[1] + (0.5 * (middle[1] - at[1])) / toward];
    });
  });
}

/**
 * A capture's whole two-stage landing, as a capture does it: S's frame off
 * S's spread, imprinted through the default anchor; landed on N through the
 * face holding the anchor's paper point, then onto N's spread.
 */
function twoStage(label: string) {
  const kase = imprintCase(label);
  const [s, n] = [faces(kase.s), faces(kase.n)];
  const frame: DiagramZoomOutline = { centre: kase.frame.centre, radius: kase.frame.radius };
  const anchor = defaultAnchor(s, frame)!;
  const on = anchorPoint(s, anchor)!;
  const imprint = imprintFrame(s, anchor, frame)!;
  const landed = landFrame(n, imprint, on)!;
  return { kase, s, n, frame, anchor, on, imprint, landed, share: distance(landed.centre, kase.truth) / (2 * landed.radius!) };
}

describe('a face’s placement', () => {
  it('takes every named face of the crane from the paper onto its unspread picture, to the stored step', () => {
    const stepFaces = faces('S.none');
    let reflected = 0;
    stepFaces.paper.forEach((ring, face) => {
      if (ring.length < 3) return;
      const placement = facePlacement(stepFaces, face)!;
      if (placement.reflected) reflected += 1;
      ring.forEach((corner, index) => {
        expect(distance(placement.apply(corner), stepFaces.unspread[face]![index]!)).toBeLessThan(0.02);
        expect(distance(placement.invert(stepFaces.unspread[face]![index]!), corner)).toBeLessThan(0.02 / placement.scale);
      });
      expect(placement.scale).toBeCloseTo(stepFaces.unspread[face]!.length > 0 ? placement.scale : 0, 9);
    });
    // Both sides of the paper show on a folded crane: some faces are placed mirrored.
    expect(reflected).toBeGreaterThan(0);
    expect(reflected).toBeLessThan(stepFaces.paper.filter((ring) => ring.length >= 3).length);
  });

  it('is exact, and mirrored on a face showing its back', () => {
    const paper: PicturePoint[] = [
      [0, 0],
      [3, 0],
      [3, 2],
      [0, 2],
    ];
    const turn = (degrees: number, mirrored: boolean) => {
      const r = (degrees * Math.PI) / 180;
      return paper.map(([x, y]): PicturePoint => {
        const yy = mirrored ? -y : y;
        return [5 + 2 * (x * Math.cos(r) - yy * Math.sin(r)), -7 + 2 * (x * Math.sin(r) + yy * Math.cos(r))];
      });
    };
    for (const mirrored of [false, true]) {
      const placement = fitPlacement(paper, turn(37, mirrored))!;
      expect(placement.reflected).toBe(mirrored);
      expect(placement.scale).toBeCloseTo(2, 12);
      paper.forEach((corner, index) => expect(distance(placement.apply(corner), turn(37, mirrored)[index]!)).toBeLessThan(1e-12));
    }
  });
});

describe('off and onto the spread', () => {
  it('are the identity with no spread', () => {
    const stepFaces = faces('S.none');
    for (const point of insidePoints(stepFaces, 33)) {
      expect(offSpread(stepFaces, point)).toBe(point);
      expect(ontoSpread(stepFaces, point)).toBe(point);
    }
  });

  it('move a point as the painter’s own spread does: its mean value coordinates over its face, unspread to drawn', () => {
    for (const key of ['S.affine', 'S.depth']) {
      const stepFaces = faces(key);
      // A face's corners go exactly where the stored scene draws them.
      stepFaces.unspread.forEach((ring, face) =>
        ring.forEach((corner, index) =>
          expect(distance(faceSpreadMove(stepFaces, face, corner), stepFaces.drawn[face]![index]!)).toBeLessThan(1e-9)
        )
      );
    }
  });

  it('are inverse: exactly under the affine spread, to 1e-9 px under the depth spread', () => {
    for (const key of ['S.affine', 'S.depth', 'C.affine', 'C.depth', 'R21.affine', 'R21.depth']) {
      const stepFaces = faces(key);
      let checked = 0;
      for (const face of stepFaces.order) {
        for (const point of insidePoints(stepFaces, face)) {
          // A point where this face is on top unspread: onto, then off, comes home.
          if (topUnspread(stepFaces, point) !== face) continue;
          const drawn = ontoSpread(stepFaces, point);
          const back = offSpread(stepFaces, drawn);
          // Unless the spread laid another layer over the drawn point: off takes the one on top there.
          if (topUnspread(stepFaces, back) !== face) continue;
          expect(distance(back, point), `${key} face ${face}`).toBeLessThan(1e-9);
          expect(distance(ontoSpread(stepFaces, back), drawn)).toBeLessThan(1e-9);
          checked += 1;
        }
      }
      expect(checked, key).toBeGreaterThan(30);
    }
  });

  it('settle a point dropped in a strip the spread opened on the layer above it, at most the strip’s width away', () => {
    const stepFaces = faces('S.depth');
    let strips = 0;
    // A drawn point where a lower layer shows that a layer above covers unspread.
    for (const piece of stepFaces.pieces) {
      for (const point of besideSides(piece.ring)) {
        if (topDrawn(stepFaces, point) !== piece.face) continue;
        const under = unspreadOn(stepFaces, piece.face, point);
        const top = topUnspread(stepFaces, under);
        if (top === null || top === piece.face) continue;
        strips += 1;
        const settled = ontoSpread(stepFaces, offSpread(stepFaces, point));
        expect(distance(settled, point)).toBeGreaterThan(0);
        // The depth spread steps a layer 2.5% of the model over its depth: a strip is at most that wide.
        expect(distance(settled, point)).toBeLessThan(0.025 * 330);
      }
    }
    expect(strips).toBeGreaterThan(0);
  });

  it('carry a point on no face by the nearest face’s move at the nearest point of its ring', () => {
    const stepFaces = faces('S.affine');
    const far: PicturePoint = [stepFaces.bounds.minX - 50, stepFaces.bounds.minY - 50];
    expect(topUnspread(stepFaces, far)).toBeNull();
    const moved = ontoSpread(stepFaces, far);
    // It moves, by no more than the spread moves any corner.
    const most = Math.max(
      ...stepFaces.unspread.flatMap((ring, face) => ring.map((corner, index) => distance(corner, stepFaces.drawn[face]![index]!)))
    );
    expect(distance(moved, far)).toBeGreaterThan(0);
    expect(distance(moved, far)).toBeLessThanOrEqual(most + 1e-9);
    expect(distance(offSpread(stepFaces, moved), far)).toBeLessThan(1e-6);
  });
});

describe('imprinting a frame and landing it', () => {
  it('lands where it was drawn on its own picture, spread or not', () => {
    for (const key of ['S.none', 'S.affine', 'S.depth']) {
      const stepFaces = faces(key);
      const frame: DiagramZoomOutline = imprintCase(`C.${key.split('.')[1]}`).frame;
      const anchor = defaultAnchor(stepFaces, frame)!;
      const imprint = imprintFrame(stepFaces, anchor, frame)!;
      const landed = landFrame(stepFaces, imprint, anchorPoint(stepFaces, anchor)!)!;
      expect(distance(landed.centre, frame.centre), key).toBeLessThan(1e-6);
      expect(landed.radius).toBeCloseTo(frame.radius!, 9);
    }
  });

  it('lands the crane’s R (21 → 22) and C within 2% of the frame under every spread, its folds holding different faces still', () => {
    const shares: Record<string, number> = {};
    for (const { label } of IMPRINT_CASES) shares[label] = twoStage(label).share;
    for (const [label, share] of Object.entries(shares)) expect(share, label).toBeLessThan(0.02);
    // With no spread the imprint is exact.
    expect(shares['R.none']).toBeLessThan(1e-4);
    expect(shares['C.none']).toBeLessThan(1e-4);
  });

  it('follows the spread by the face under the centre: by the landing face’s move instead it would miss by 5%', () => {
    for (const label of ['R.affine', 'C.affine']) {
      const { n, on, imprint, landed, kase, share } = twoStage(label);
      const unspread = landThrough(imprint, facePlacement(n, faceAt(n, on)!)!);
      const byB = faceSpreadMove(n, faceAt(n, on)!, unspread.centre);
      const byBShare = distance(byB, kase.truth) / (2 * landed.radius!);
      expect(byBShare, label).toBeGreaterThan(0.045);
      expect(share).toBeLessThan(byBShare / 4);
    }
  });

  it('keeps the frame’s unspread size and turn: the spread moves only its centre, and a circle lands a circle', () => {
    for (const label of ['C.affine', 'C.depth', 'R.affine']) {
      const { n, on, imprint, landed } = twoStage(label);
      const unspread = landThrough(imprint, facePlacement(n, faceAt(n, on)!)!);
      expect(landed.radius).toBe(unspread.radius);
      expect(landed.size).toBeUndefined();
      expect(distance(landed.centre, ontoSpread(n, unspread.centre))).toBe(0);
    }
  });

  it('turns a rounded rectangle with its face at any angle, and mirrors it with a face turned over', () => {
    const paper: PicturePoint[] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    const placed = (degrees: number, mirrored: boolean) => {
      const r = (degrees * Math.PI) / 180;
      return paper.map(([x, y]): PicturePoint => {
        const yy = mirrored ? -y : y;
        return [x * Math.cos(r) - yy * Math.sin(r), x * Math.sin(r) + yy * Math.cos(r)];
      });
    };
    const frame: DiagramZoomOutline = { centre: [30, 40], size: [20, 10], angle: 10 };
    const imprint = imprintThrough(frame, fitPlacement(paper, paper)!);
    expect(imprint).toEqual(frame);
    const turned = landThrough(imprint, fitPlacement(paper, placed(37, false))!);
    expect(turned.angle).toBeCloseTo(47, 9);
    expect(turned.size![0]).toBeCloseTo(20, 12);
    expect(turned.size![1]).toBeCloseTo(10, 12);
    // Turned over: the frame's long side runs the mirrored way.
    const over = landThrough(imprint, fitPlacement(paper, placed(0, true))!);
    expect(over.angle).toBeCloseTo(170, 9);
    expect(over.centre[0]).toBeCloseTo(30, 9);
    expect(over.centre[1]).toBeCloseTo(-40, 9);
  });

  it('lands nothing where the anchor’s paper point is off the step’s paper', () => {
    const stepFaces = faces('S.none');
    const frame = imprintCase('C.none').frame;
    const anchor = defaultAnchor(stepFaces, frame)!;
    const imprint = imprintFrame(stepFaces, anchor, frame)!;
    expect(landFrame(stepFaces, imprint, [5000, 5000])).toBeNull();
    expect(faceAt(stepFaces, [5000, 5000])).toBeNull();
  });

  it('anchors a pick on the face drawn on top under it, at the point picked on the paper', () => {
    const stepFaces = faces('S.affine');
    const pressed = imprintCase('C.affine').truth;
    const head = pickAnchor(faces('C.affine'), pressed)!;
    expect(head.face).toBe(topDrawn(faces('C.affine'), pressed));
    // The point picked is where the paper under the press is.
    const back = facePlacement(faces('C.affine'), head.face)!.apply(head.on);
    expect(distance(ontoSpread(faces('C.affine'), back), pressed)).toBeLessThan(1e-6);
    expect(pickAnchor(stepFaces, [stepFaces.bounds.minX - 100, 0])).toBeNull();
  });
});

describe('the default anchor (Z9)', () => {
  it('is the backmost face lying wholly outside the frame: the body’s back layer under the crane’s head', () => {
    for (const spread of ['none', 'affine', 'depth']) {
      const stepFaces = faces(`S.${spread}`);
      const anchor = defaultAnchor(stepFaces, imprintCase(`C.${spread}`).frame);
      // Faces 33 and 14, the body's rear layers, tie on level and on the paper:
      // the lower index, whichever the picture's rounding or a spread favours.
      expect(anchor, spread).toBe(14);
    }
  });

  it('breaks a tie on level by the paper’s area, within 0.1%, then by the lower index', () => {
    const stepFaces = faces('S.affine');
    const area = (face: number) => Math.abs(ringArea(stepFaces.paper[face]!));
    expect(stepFaces.levels[33]).toBe(stepFaces.levels[14]);
    expect(area(33)).toBeCloseTo(area(14), 6);
    // Drawn, under the affine spread, they are not the same size.
    const drawn = (face: number) => Math.abs(ringArea(stepFaces.drawn[face]!));
    expect(Math.abs(drawn(33) - drawn(14)) / drawn(14)).toBeGreaterThan(1e-3);
    const ranked = rankedFaces(stepFaces);
    expect(ranked.indexOf(14)).toBeLessThan(ranked.indexOf(33));
    // A larger face at the same level would come first.
    const grown = { ...stepFaces, paper: stepFaces.paper.map((ring, face) => (face === 33 ? ring.map(([x, y]): PicturePoint => [x * 1.01, y * 1.01]) : ring)) };
    expect(rankedFaces(grown).indexOf(33)).toBeLessThan(rankedFaces(grown).indexOf(14));
  });

  /** Two faces side by side on one paper, 10 units a side, placed as they lie: `back` at the back unless said. */
  function twoFaces(levels: [number, number] = [1, 0]): StepFaces {
    const rings: PicturePoint[][] = [
      [[0, 0], [10, 0], [10, 10], [0, 10]],
      [[10, 0], [20, 0], [20, 10], [10, 10]],
    ];
    return {
      kind: 'flat',
      paper: rings,
      unspread: rings,
      drawn: rings,
      levels,
      spread: false,
      order: [0, 1],
      pieces: rings.map((ring, face) => ({ face, ring })),
      bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
      epsilon: 1e-9,
    };
  }

  it('takes the backmost face lying wholly outside the frame, though a face in front of it lies outside too', () => {
    expect(defaultAnchor(twoFaces(), { centre: [25, 5], radius: 2 })).toBe(0);
    // The back face touches the frame: the face in front, wholly outside it, is the anchor.
    expect(defaultAnchor(twoFaces(), { centre: [3, 5], radius: 2 })).toBe(1);
    expect(defaultAnchor(twoFaces(), { centre: [3, 5], size: [3, 3], angle: 45 })).toBe(1);
  });

  it('falls back to the backmost face reaching outside a frame every face touches, and to the backmost under one that takes in the model', () => {
    // Both touch it and both reach outside it: the one at the back.
    expect(defaultAnchor(twoFaces(), { centre: [10, 5], radius: 3 })).toBe(0);
    // The back face lies wholly inside it: the face in front, which reaches outside.
    expect(defaultAnchor(twoFaces(), { centre: [5, 5], radius: 8 })).toBe(1);
    expect(defaultAnchor(twoFaces(), { centre: [10, 5], radius: 30 })).toBe(0);
    const stepFaces = faces('S.none');
    const { minX, minY, maxX, maxY } = stepFaces.bounds;
    const whole: DiagramZoomOutline = { centre: [(minX + maxX) / 2, (minY + maxY) / 2], radius: Math.hypot(maxX - minX, maxY - minY) };
    expect(defaultAnchor(stepFaces, whole)).toBe(rankedFaces(stepFaces)[0]);
  });

  it('ranks a picture from the side it shows: turned over, the other layer is at the back', () => {
    expect(defaultAnchor(twoFaces([1, 0]), { centre: [10, 5], radius: 30 })).toBe(0);
    expect(defaultAnchor(twoFaces([0, 1]), { centre: [10, 5], radius: 30 })).toBe(1);
    // R21 is a Back pass, its levels its own stacks as seen: the body's back layer there is face 30.
    expect(defaultAnchor(faces('R21.none'), imprintCase('R.none').frame)).toBe(30);
  });
});

describe('the anchor’s point on a face with no one deepest point', () => {
  /** How deep a point lies in a ring: its distance to the nearest side, negative outside. */
  const depth = (ring: readonly PicturePoint[], point: PicturePoint) => {
    const nearest = Math.min(
      ...ring.map((a, index) => {
        const b = ring[(index + 1) % ring.length]!;
        const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
        const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy)));
        return distance(point, [a[0] + t * dx, a[1] + t * dy]);
      })
    );
    return holds(ring, point, 0) ? nearest : -nearest;
  };
  // Box-pleated models are mostly rectangles: every one of these has a ridge of equally deep points.
  const shapes: [string, PicturePoint[], number][] = [
    ['a nearly square rectangle', [[0, 0], [101, 0], [101, 100], [0, 100]], 50],
    ['a 2:1 rectangle', [[0, 0], [200, 0], [200, 100], [0, 100]], 50],
    ['a long thin strip', [[0, 0], [500, 0], [500, 10], [0, 10]], 5],
    ['a strip on the diagonal', [[0, 0], [10, 0], [360, 350], [350, 350]], 10 / Math.SQRT2 / 2],
    ['a parallelogram', [[0, 0], [300, 0], [360, 80], [60, 80]], 40],
    ['a trapezoid', [[0, 0], [400, 0], [340, 90], [60, 90]], 45],
  ];

  it.each(shapes)('is found at once on %s, as deep inside it as the face allows to a thousandth of its size', (_label, ring, deepest) => {
    const started = performance.now();
    const pole = poleOf(ring);
    // A box-pleated model has dozens of these on a step: each a few ms at most, even on a slow machine.
    expect(performance.now() - started).toBeLessThan(100);
    const xs = ring.map(([x]) => x);
    const ys = ring.map(([, y]) => y);
    const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    expect(depth(ring, pole)).toBeGreaterThanOrEqual(deepest - 1e-3 * size);
    expect(depth(ring, pole)).toBeLessThanOrEqual(deepest + 1e-9);
  });
});

describe('a step’s faces', () => {
  it('are a flat capture’s stored faces, its drawn rings the stored scene’s with a spread on', () => {
    const stepFaces = faces('S.affine');
    expect(stepFaces.kind).toBe('flat');
    expect(stepFaces.spread).toBe(true);
    expect(stepFaces.paper).toHaveLength(44);
    expect(stepFaces.drawn.every((ring, face) => ring.length === stepFaces.unspread[face]!.length)).toBe(true);
    // Read once per picture.
    const step = craneStep('S.affine');
    expect(paperFacesOf(step)).toBe(paperFacesOf(step));
  });

  it('are none for a flat capture made before it kept them', () => {
    expect(paperFacesOf(craneStep('S.affine', { faces: false }))).toBeNull();
  });
});
