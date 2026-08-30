// Which way round the paper is drawn.
//
// The crease pattern a user draws and the simulation of it have to read the same
// way: a crease running to the top-right corner on the canvas must run to the
// top-right corner in the simulation. That is one property, and it falls out of
// two facts that have to stay in step — the view transform is a *reflection*,
// and the 2D lift negates y to cancel it. Neither is visible from the other's
// file, so this pins the property they exist to produce rather than either half.
import { describe, expect, it } from 'vitest';
import { normalizePoint } from '../src/geometry.js';
import { cameraUniforms, projectVertices, viewRotation, type Mat3 } from '../src/webgl/camera.js';

function determinant(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

/**
 * The sheet's corners in crease-pattern model space, listed the way they appear
 * **clockwise on the canvas** — whose y points down, so this ring's shoelace is
 * positive.
 */
const CANVAS_CLOCKWISE: ReadonlyArray<readonly [number, number]> = [
  [0, 0], // top-left
  [100, 0], // top-right
  [100, 100], // bottom-right
  [0, 100], // bottom-left
];

/** Shoelace over a y-down frame: positive means the ring reads clockwise. */
function shoelace(points: ReadonlyArray<readonly [number, number]>): number {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    sum += points[j]![0] * points[i]![1] - points[i]![0] * points[j]![1];
  }
  return sum;
}

/** Where the sheet's corners land, in device pixels (y down, as the canvas is). */
function projectCorners(yaw: number, pitch: number): Array<[number, number]> {
  const positions = new Float32Array(CANVAS_CLOCKWISE.length * 3);
  CANVAS_CLOCKWISE.forEach((corner, index) => {
    positions.set(normalizePoint([corner[0], corner[1]]), index * 3);
  });
  const camera = cameraUniforms({ yaw, pitch, zoom: 1 }, [50, 0, -50], 71, 400, 400);
  const { screen } = projectVertices(positions, camera);
  return CANVAS_CLOCKWISE.map((_, index) => [screen[index * 2]!, screen[index * 2 + 1]!]);
}

/**
 * Eye-above-the-paper views. The two the product actually uses are the first
 * (the Simulate panel and an inline window both open at this iso view) and the
 * plain top-down; the rest are there because the property is not special to an
 * angle.
 */
const VIEWS: ReadonlyArray<readonly [string, number, number]> = [
  ['iso default', Math.PI / 4, -0.955],
  ['top down', 0, 0],
  ['yawed', 1.9, -0.4],
  ['low', -2.6, -1.4],
];

describe('paper orientation', () => {
  it('draws through a reflection, at every angle', () => {
    // Not an incidental fact: it is why `normalizePoint` negates, and why a
    // folded figure winds its triangles about the *opposite* of its paper
    // normal. Straightening this basis means revisiting both.
    for (const [, yaw, pitch] of VIEWS) {
      expect(determinant(viewRotation(yaw, pitch))).toBeCloseTo(-1, 12);
    }
  });

  it('keeps the crease pattern the way round the canvas draws it', () => {
    // The bug this replaces: the sheet came out vertically flipped, so a crease
    // to the canvas's top-right corner ran to the bottom-right on screen. A
    // mirror is exactly a change of sign here — nothing weaker would catch it,
    // since the corners still form the same quad.
    for (const [name, yaw, pitch] of VIEWS) {
      expect(shoelace(CANVAS_CLOCKWISE), 'the fixture ring reads clockwise').toBeGreaterThan(0);
      expect(shoelace(projectCorners(yaw, pitch)), name).toBeGreaterThan(0);
    }
  });

  it('puts the canvas top-left at the top from directly above', () => {
    // The cyclic check above cannot tell a correct sheet from one turned by a
    // half turn, and only a concrete view can. Straight down, the canvas's own
    // axes should survive: x to the right, y down the screen.
    const [topLeft, topRight, bottomRight, bottomLeft] = projectCorners(0, 0);
    expect(topLeft![0]).toBeLessThan(topRight![0]);
    expect(bottomLeft![0]).toBeLessThan(bottomRight![0]);
    expect(topLeft![1]).toBeLessThan(bottomLeft![1]);
    expect(topRight![1]).toBeLessThan(bottomRight![1]);
  });
});
