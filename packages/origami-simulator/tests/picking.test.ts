import { describe, expect, it } from 'vitest';
import {
  facesVisibleIn,
  facesWithCentreIn,
  frontmostFaceAt,
  frontmostHitAt,
  scaleRect,
  type PickTopology,
  type ScreenRect,
} from '../src/picking.js';
import { cameraUniforms, projectVertices, type CameraUniforms } from '../src/webgl/camera.js';

/**
 * Two layers and a stray face, in world space. At yaw = pitch = 0 the view is
 * the y/z swap, so world +y is toward the eye, world x is screen right and
 * world z is screen up.
 *
 * - FRONT (10): a square over the middle, nearer the eye.
 * - BACK (20): a wider square behind it, showing only as a strip on the right.
 * - STRAY (30): a small square off to the left, alone.
 */
const FRONT = 10;
const BACK = 20;
const STRAY = 30;

function square(x0: number, x1: number, z0: number, z1: number, y: number): number[] {
  return [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1];
}

const positions = new Float32Array([
  ...square(-0.5, 0.5, -0.5, 0.5, 0.2),
  ...square(-0.5, 0.9, -0.5, 0.5, -0.2),
  ...square(-0.95, -0.7, -0.1, 0.1, 0),
]);

function quad(first: number): number[] {
  return [first, first + 1, first + 2, first, first + 2, first + 3];
}

const topology: PickTopology = {
  indices: new Uint32Array([...quad(0), ...quad(4), ...quad(8)]),
  faceGroups: new Int32Array([FRONT, FRONT, BACK, BACK, STRAY, STRAY]),
};

const SIZE = 400;
const camera: CameraUniforms = cameraUniforms({ yaw: 0, pitch: 0, zoom: 1 }, [0, 0, 0], 1, SIZE, SIZE);

/** Where a world point lands on screen. */
function onScreen(x: number, y: number, z: number, perspective = true): { x: number; y: number } {
  const projected = projectVertices(new Float32Array([x, y, z]), camera, { perspective });
  return { x: projected.screen[0]!, y: projected.screen[1]! };
}

function around(point: { x: number; y: number }, half: number): ScreenRect {
  return { left: point.x - half, right: point.x + half, top: point.y - half, bottom: point.y + half };
}

const sorted = (faces: number[]) => [...faces].sort((a, b) => a - b);

describe('facesWithCentreIn', () => {
  it('picks every face centred in the box, hidden ones included', () => {
    // The back face's centre is behind the front face.
    const box = around(onScreen(0.1, 0, 0), 60);
    expect(sorted(facesWithCentreIn(positions, topology, camera, box, { perspective: true }))).toEqual([FRONT, BACK]);
  });

  it('leaves out a face that only passes under the box', () => {
    // Over the back face's exposed strip, but nowhere near its centre.
    const box = around(onScreen(0.8, -0.2, 0.4), 10);
    expect(facesWithCentreIn(positions, topology, camera, box, { perspective: true })).toEqual([]);
  });
});

describe('facesVisibleIn', () => {
  it('picks the front face and not the one hidden behind it', () => {
    const box = around(onScreen(0, 0.2, 0), 40);
    expect(facesVisibleIn(positions, topology, camera, box, { perspective: true, sampleStep: 1 })).toEqual([FRONT]);
  });

  it('picks a back face where it shows past the front one', () => {
    const box = around(onScreen(0.75, -0.2, 0), 8);
    expect(facesVisibleIn(positions, topology, camera, box, { perspective: true, sampleStep: 1 })).toEqual([BACK]);
  });

  it('picks nothing where nothing is drawn', () => {
    const box = { left: 0, top: 0, right: 10, bottom: 10 };
    expect(facesVisibleIn(positions, topology, camera, box, { perspective: true, sampleStep: 1 })).toEqual([]);
  });
});

describe('frontmostFaceAt', () => {
  it('answers with the nearer of two stacked faces', () => {
    expect(frontmostFaceAt(positions, topology, camera, onScreen(0, 0.2, 0), { perspective: true })).toBe(FRONT);
  });

  it('answers with a back face where it is the only one there', () => {
    expect(frontmostFaceAt(positions, topology, camera, onScreen(0.8, -0.2, 0), { perspective: true })).toBe(BACK);
    expect(frontmostFaceAt(positions, topology, camera, onScreen(-0.8, 0, 0), { perspective: true })).toBe(STRAY);
  });

  it('answers null off the model', () => {
    expect(frontmostFaceAt(positions, topology, camera, { x: 2, y: 2 }, { perspective: true })).toBeNull();
  });

  it('projects the way the screen was drawn, perspective or not', () => {
    // The front face is nearer the eye, so the perspective divide widens it:
    // its edge lands past 0.53 of the scale, where the orthographic picture
    // has already moved on to the back face.
    const point = { x: SIZE / 2 + 0.52 * camera.scale, y: SIZE / 2 };
    expect(frontmostFaceAt(positions, topology, camera, point, { perspective: true })).toBe(FRONT);
    expect(frontmostFaceAt(positions, topology, camera, point, { perspective: false })).toBe(BACK);
  });
});

describe('frontmostHitAt', () => {
  /** The world point a hit's weights name. */
  function pointOf(hit: NonNullable<ReturnType<typeof frontmostHitAt>>): [number, number, number] {
    const out: [number, number, number] = [0, 0, 0];
    hit.nodes.forEach((node, slot) => {
      for (let axis = 0; axis < 3; axis += 1) out[axis] += positions[node * 3 + axis]! * hit.weights[slot]!;
    });
    return out;
  }

  for (const perspective of [true, false]) {
    it(`grips the spot under the press on the nearer face (${perspective ? 'perspective' : 'orthographic'})`, () => {
      const press = onScreen(0.1, 0.2, -0.3, perspective);
      const hit = frontmostHitAt(positions, topology, camera, press, { perspective });
      expect(hit?.face).toBe(FRONT);
      const gripped = pointOf(hit!);
      // On the front face's plane, exactly where the press was aimed.
      expect(gripped[1]).toBeCloseTo(0.2, 6);
      const back = onScreen(...gripped, perspective);
      expect(back.x).toBeCloseTo(press.x, 3);
      expect(back.y).toBeCloseTo(press.y, 3);
      expect(hit!.weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 12);
    });
  }

  it('names the triangle and its three nodes', () => {
    const hit = frontmostHitAt(positions, topology, camera, onScreen(-0.8, 0, 0), { perspective: true });
    expect(hit?.face).toBe(STRAY);
    const triangle = hit!.triangle;
    expect(hit!.nodes).toEqual([
      topology.indices[triangle * 3],
      topology.indices[triangle * 3 + 1],
      topology.indices[triangle * 3 + 2],
    ]);
  });

  it('answers null off the model', () => {
    expect(frontmostHitAt(positions, topology, camera, { x: 2, y: 2 }, { perspective: true })).toBeNull();
  });
});

describe('scaleRect', () => {
  it('maps a drag in CSS pixels to drawing-buffer pixels', () => {
    const rect = scaleRect(
      { left: 10, top: 20, right: 110, bottom: 70 },
      { width: 400, height: 300 },
      { width: 800, height: 600 }
    );
    expect(rect).toEqual({ left: 20, top: 40, right: 220, bottom: 140 });
  });

  it('normalises a drag made up and to the left', () => {
    const rect = scaleRect({ left: 110, top: 70, right: 10, bottom: 20 }, { width: 1, height: 1 }, { width: 1, height: 1 });
    expect(rect).toEqual({ left: 10, top: 20, right: 110, bottom: 70 });
  });

  it('scales each axis on its own, for a buffer floored to a minimum size', () => {
    const rect = scaleRect({ left: 0, top: 0, right: 100, bottom: 100 }, { width: 200, height: 100 }, { width: 400, height: 360 });
    expect(rect).toEqual({ left: 0, top: 0, right: 200, bottom: 360 });
  });
});
