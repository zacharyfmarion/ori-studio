import { describe, expect, it } from 'vitest';
import { cpPointsToScene } from './cpPointsToScene';
import type { Rgba } from '../renderer/types';

const PF: Rgba = [1, 0, 0, 1];
const PS: Rgba = [0, 0, 0, 1];
const VF: Rgba = [0.9, 0.9, 0.8, 0.72];
const VS: Rgba = [0.5, 0.5, 0.5, 1];

const CS: Rgba = [0.2, 0.7, 0.7, 1];

const style = {
  pointSize: 1,
  pointFill: PF,
  pointStroke: PS,
  vertexFill: VF,
  vertexStroke: VS,
  circleStroke: CS,
};

describe('cpPointsToScene', () => {
  // Float32Array rounds values like 1.6/0.9; compare with tolerance.
  const closeToAll = (actual: Float32Array, expected: number[]) => {
    expect(actual).toHaveLength(expected.length);
    expected.forEach((v, i) => expect(actual[i]).toBeCloseTo(v, 5));
  };

  it('packs points then vertices with their radii and colours', () => {
    const geo = cpPointsToScene([{ x: 1, y: 2 }], [{ x: 3, y: 4 }], [], style);
    expect(geo.count).toBe(2);
    expect(Array.from(geo.center)).toEqual([1, 2, 3, 4]);
    // point radius = pointSize*2, vertex radius = pointSize*1.6
    closeToAll(geo.radius, [2, 1.6]);
    closeToAll(geo.fill.slice(0, 4), [1, 0, 0, 1]);
    closeToAll(geo.fill.slice(4, 8), [0.9, 0.9, 0.8, 0.72]);
    closeToAll(geo.stroke.slice(4, 8), [0.5, 0.5, 0.5, 1]);
  });

  it('scales radii with point size', () => {
    const geo = cpPointsToScene([{ x: 0, y: 0 }], [{ x: 0, y: 0 }], [], { ...style, pointSize: 2 });
    closeToAll(geo.radius, [4, 3.2]);
  });

  it('appends circles as transparent-fill rings after points and vertices', () => {
    const geo = cpPointsToScene(
      [{ x: 1, y: 1 }],
      [{ x: 2, y: 2 }],
      [{ center: { x: 9, y: 9 }, radius: 40 }],
      style
    );
    expect(geo.count).toBe(3);
    // circle is the 3rd instance
    expect(Array.from(geo.center.slice(4, 6))).toEqual([9, 9]);
    closeToAll(geo.radius.slice(2, 3), [40]);
    closeToAll(geo.fill.slice(8, 12), [0, 0, 0, 0]); // transparent fill
    closeToAll(geo.stroke.slice(8, 12), [...CS]);
  });

  it('handles an empty document', () => {
    const geo = cpPointsToScene([], [], [], style);
    expect(geo.count).toBe(0);
    expect(geo.center).toHaveLength(0);
  });

  it('recolours selected points, vertices, and circle rings', () => {
    const SEL: Rgba = [0, 0, 1, 1];
    const geo = cpPointsToScene(
      [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      [{ x: 2, y: 2 }],
      [{ center: { x: 9, y: 9 }, radius: 40 }],
      style,
      {
        pointIdx: new Set([1]),
        vertexIdx: new Set([0]),
        circleIdx: new Set([0]),
        color: SEL,
      }
    );
    // point 0 unselected keeps its fill; point 1 selected takes the accent
    closeToAll(geo.fill.slice(0, 4), [...PF]);
    closeToAll(geo.fill.slice(4, 8), [...SEL]);
    closeToAll(geo.stroke.slice(4, 8), [...SEL]);
    // vertex 0 (instance index 2) selected
    closeToAll(geo.fill.slice(8, 12), [...SEL]);
    // circle (instance index 3) keeps transparent fill, ring takes accent
    closeToAll(geo.fill.slice(12, 16), [0, 0, 0, 0]);
    closeToAll(geo.stroke.slice(12, 16), [...SEL]);
  });
});
