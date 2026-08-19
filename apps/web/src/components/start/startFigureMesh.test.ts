/**
 * The start figure's `orient`, and the thing that has to travel with it.
 *
 * `orient` is the fixed model-space rotation that stands the shipped figure up.
 * It is applied to the finished mesh's **positions**, which is fine on its own —
 * but a skin also carries `up` and `centroid`, and `folded3dDrawPasses` asks
 * both of them camera questions: which of a plane's two surfaces faces the eye,
 * and which plane is nearer. Rotating one and not the other answers those in a
 * frame the geometry no longer lives in.
 */

import { describe, expect, it } from 'vitest';
import { orient, orientSkins } from './startFigureMesh';
import type { Folded3dSkin } from '../../cp-workspace/folded/folded3dMesh';

/** The angles the shipped penguin is generated with. */
const SHIPPED: [number, number, number] = [3.1236, 1.2208, 1.5508];

function skin(up: [number, number, number], centroid: [number, number, number]): Folded3dSkin {
  return {
    plane: 0,
    up,
    centroid,
    side: 1,
    faceIndexStart: 0,
    faceIndexCount: 3,
    edgeStart: 0,
    edgeCount: 1,
    hingeGroups: [],
  };
}

describe('orienting the start figure', () => {
  it('rotates a skin’s vectors by the same map as the geometry', () => {
    // The invariant a wrong answer breaks: a direction stated in the model's
    // frame must land where the *same* direction taken as a point lands.
    const directions: Array<[number, number, number]> = [
      [0, 1, 0],
      [1, 0, 0],
      [0, 0, 1],
      [0.4364357804719848, 0.8728715609439696, 0.2182178902359924],
    ];
    const asPositions = orient(new Float32Array(directions.flat()), SHIPPED);
    const asSkins = orientSkins(
      directions.map((direction) => skin(direction, direction)),
      SHIPPED,
    );
    asSkins.forEach((rotated, index) => {
      for (const axis of [0, 1, 2]) {
        expect(rotated.up[axis]).toBeCloseTo(asPositions[index * 3 + axis]!, 6);
        expect(rotated.centroid[axis]).toBeCloseTo(asPositions[index * 3 + axis]!, 6);
      }
    });
  });

  it('keeps `up` a unit vector, so `up · viewAxis` stays a cosine', () => {
    const rotated = orientSkins([skin([0, 1, 0], [0, 0, 0])], SHIPPED);
    const [x, y, z] = rotated[0]!.up;
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
  });

  it('leaves everything else on the skin alone', () => {
    const original = skin([0, 1, 0], [1, 2, 3]);
    const [rotated] = orientSkins([original], SHIPPED);
    expect(rotated).toMatchObject({
      plane: original.plane,
      side: original.side,
      faceIndexStart: original.faceIndexStart,
      faceIndexCount: original.faceIndexCount,
      edgeStart: original.edgeStart,
      edgeCount: original.edgeCount,
    });
  });

  it('is a pass-through when the asset names no rotation', () => {
    const skins = [skin([0, 1, 0], [1, 2, 3])];
    expect(orientSkins(skins, undefined)).toBe(skins);
    expect(orientSkins(skins, [0, 0, 0])).toBe(skins);
    const positions = new Float32Array([1, 2, 3]);
    expect(orient(positions, undefined)).toBe(positions);
    expect(orient(positions, [0, 0, 0])).toBe(positions);
  });
});
