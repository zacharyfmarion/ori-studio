import { expect, it } from 'vitest';
import { visibility, type Point3 } from '@oristudio/layer-spread';
import { DEFAULT_PAPER_STYLE } from '../lib/paper/paperStyle';
import { connectedPaperScene, type ConnectedDrawing, type ConnectedPaperScene } from './connectedScene';
import { spreadGeometry } from './spreadGeometry';

it('keeps thin flap vertices and ink at their material depth after Float32 coordinate rounding', () => {
  // The lower boundary rounds down, outside this triangle in double precision.
  // Moving the flap by a tiny amount must not snap its depth to the middle.
  for (const shift of [0, 0.00002, 0.0001]) {
    const a: Point3 = [4000.0001 + shift, 3000.0001, 0];
    const b: Point3 = [4100.0001 + shift, 3000.0001, 0];
    const c: Point3 = [4000.0001 + shift, 3000.0101, 0];
    const drawing: ConnectedDrawing = {
      mesh: {
        positions: [a, b, c, [4000, 3000, 1], [4100, 3000, 1], [4000, 3100, 1]],
        triangles: [[0, 1, 2], [3, 4, 5]],
        triangleFaces: [0, 1],
        visibility: visibility(2, [[0, 1]]),
      },
      rings: [[0, 1, 2], [3, 4, 5]],
      front: [true, false],
      ink: [{
        face: 0, a, b,
        line: {
          kind: 'line', role: 'edge', face: 0,
          a: [a[0], a[1]], b: [b[0], b[1]],
          hidden: false, onBoundary: [true, true],
        },
      }],
    };
    const scene = connectedPaperScene(drawing, 100) as ConnectedPaperScene;
    const geometry = spreadGeometry(scene, DEFAULT_PAPER_STYLE, {});
    expect([...geometry.faces[0]!.fills.depth!]).toEqual([0, 0, 0]);
    expect([...geometry.faces[0]!.strokes.depth!]).toEqual([0]);
    expect([...geometry.faces[0]!.strokes.depthEnd!]).toEqual([0]);
    expect([...geometry.faces[1]!.fills.depth!]).toEqual([1, 1, 1]);
  }
});
