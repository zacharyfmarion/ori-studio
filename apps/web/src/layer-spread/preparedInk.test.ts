import { expect, it } from 'vitest';
import type { ConnectedSpreadSource } from '../cp-workspace/folded/connectedSpreadSource';
import type { PaperLineItem } from '../lib/paper/paperScene';
import { interpolate } from '@oristudio/layer-spread';
import { preparedInk } from './preparedInk';
import { erodeLine } from '../lib/paper/paperSvg';
it('splits a crease at the render diagonal once and reuses its material weights as heights change', () => {
  const source: ConnectedSpreadSource = {
    frame: { origin: [0, 0], ex: [1, 0], ey: [0, 1] },
    vertices: [0, 1, 2, 3],
    back: false,
    input: {
      xy: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      faces: [[0, 1, 2, 3]],
      triangles: [
        [0, 1, 2],
        [0, 2, 3],
      ],
      triangleFaces: [0, 0],
      orders: [],
      cells: [],
    },
  };
  const lines: PaperLineItem[] = [
    { kind: 'line', role: 'aux', onBoundary: [true, true], face: 0, a: [0, 0.5], b: [1, 0.5], hidden: false },
  ];
  const prepared = preparedInk(source, lines);
  expect(prepared).toHaveLength(2);
  expect(preparedInk(source, lines)).toBe(prepared);
  const positions: [number, number, number][] = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 2],
    [0, 1, 0],
  ];
  const ends = prepared.map((edge) => [
    interpolate(edge.ids, edge.a, positions),
    interpolate(edge.ids, edge.b, positions),
  ]);
  expect(ends[0]![1]).toEqual(ends[1]![0]);
  expect(ends[0]![1]![2]).toBe(1);
  expect(prepared.map(p => p.line.onBoundary)).toEqual([[true, false], [false, true]]);
  const ink = prepared.map((edge, i) => erodeLine({ ...edge.line,
    a: ends[i]![0]!.slice(0, 2) as [number, number],
    b: ends[i]![1]!.slice(0, 2) as [number, number],
  }, .05)!);
  expect(ink).toEqual([[[.05,.5],[.5,.5]], [[.5,.5],[.95,.5]]]);
  positions[2]![2] = 4;
  expect(interpolate(prepared[0]!.ids, prepared[0]!.b, positions)[2]).toBe(2);
  expect(preparedInk({ ...source }, lines)).not.toBe(prepared);
});
