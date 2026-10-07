import { describe, expect, it } from 'vitest';
import { createSolverShape } from '@treemaker/origami-simulator';
import {
  decodeSimulatorShapeState,
  encodeSimulatorShapeState,
  facesAtPinPoints,
  pinPointsOf,
  shapeStateOf,
  SIMULATOR_SHAPE_MAX_BYTES,
  simulatorShapeBytes,
  simulatorSheetKey,
  simulatorSheetOf,
  solverShapeOf,
  type SimulatorSheetInput,
} from './simulatorShape';

/**
 * A 2×2 square cut into four triangles around its centre, with two diagonals
 * as creases. Nodes: 0-3 corners, 4 centre.
 */
function square(): SimulatorSheetInput {
  return {
    flat: Float32Array.from([0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 2, 0, 1, 1, 0]),
    triangles: Uint32Array.from([0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4]),
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [0, 4],
      [1, 4],
      [2, 4],
      [3, 4],
    ],
    creases: [
      { edge: 4, targetAngle: 180 },
      { edge: 5, targetAngle: -180 },
      { edge: 6, targetAngle: 180 },
      { edge: 7, targetAngle: -180 },
    ],
  };
}

/** The same sheet with its nodes, triangles and creases numbered differently. */
function renumbered(input: SimulatorSheetInput, order: number[]): SimulatorSheetInput {
  // `order[newIndex] = oldIndex`.
  const newIndexOf = new Map(order.map((old, index) => [old, index]));
  const flat = new Float32Array(input.flat.length);
  order.forEach((old, index) => flat.set(input.flat.subarray(old * 3, old * 3 + 3), index * 3));
  const triangleCount = input.triangles.length / 3;
  const triangles = new Uint32Array(input.triangles.length);
  for (let t = 0; t < triangleCount; t += 1) {
    // Triangles listed backwards, each keeping its winding.
    const from = triangleCount - 1 - t;
    for (let corner = 0; corner < 3; corner += 1) triangles[t * 3 + corner] = newIndexOf.get(input.triangles[from * 3 + corner]!)!;
  }
  const edges = [...input.edges].reverse().map(([a, b]) => [newIndexOf.get(b)!, newIndexOf.get(a)!] as const);
  const edgeIndexOf = (old: number) => input.edges.length - 1 - old;
  const creases = [...input.creases].reverse().map((crease) => ({ ...crease, edge: edgeIndexOf(crease.edge) }));
  return { flat, triangles, edges, creases };
}

describe('the sheet’s order and key', () => {
  it('keeps its key when the sheet moves or is scaled', () => {
    const base = square();
    const moved = { ...base, flat: base.flat.map((value, index) => value + [3.25, -1.5, 0][index % 3]!) };
    const scaled = { ...base, flat: base.flat.map((value) => value * 0.375) };
    expect(simulatorSheetKey(base)).toMatch(/^sk1:/);
    expect(simulatorSheetKey(moved)).toBe(simulatorSheetKey(base));
    expect(simulatorSheetKey(scaled)).toBe(simulatorSheetKey(base));
  });

  it('keeps its key, and puts the same node in each place, when the region is renumbered', () => {
    const base = square();
    const order = [3, 4, 0, 2, 1];
    const other = renumbered(base, order);
    const a = simulatorSheetOf(base);
    const b = simulatorSheetOf(other);
    expect(b.key).toBe(a.key);
    // Place by place, the same flat point; and crease by crease, the same edge.
    a.nodes.forEach((node, slot) => expect(order[b.nodes[slot]!]).toBe(node));
    a.creases.forEach((crease, slot) => {
      const edgeA = base.edges[base.creases[crease]!.edge]!;
      const edgeB = other.edges[other.creases[b.creases[slot]!]!.edge]!;
      expect(new Set(edgeB.map((node) => order[node]))).toEqual(new Set(edgeA));
    });
  });

  it('changes its key when a crease’s target or the triangulation changes', () => {
    const base = square();
    const retargeted = { ...base, creases: base.creases.map((c, i) => (i === 0 ? { ...c, targetAngle: 90 } : c)) };
    // The same four corners split by one diagonal instead of around a centre.
    const rediagonal: SimulatorSheetInput = {
      flat: base.flat.slice(0, 12),
      triangles: Uint32Array.from([0, 1, 2, 0, 2, 3]),
      edges: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [0, 2],
      ],
      creases: [{ edge: 4, targetAngle: 180 }],
    };
    expect(simulatorSheetKey(retargeted)).not.toBe(simulatorSheetKey(base));
    expect(simulatorSheetKey(rediagonal)).not.toBe(simulatorSheetKey(base));
  });

  it('tells a slit’s two sides apart by their triangles', () => {
    // A 2×2 square slit from the left edge's midpoint to the centre: nodes 4
    // and 5 lie on one point, 4 below the slit and 5 above it.
    const slit: SimulatorSheetInput = {
      flat: Float32Array.from([0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 2, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0]),
      triangles: Uint32Array.from([0, 1, 6, 0, 6, 4, 1, 2, 6, 2, 3, 6, 3, 5, 6]),
      edges: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 5],
        [5, 6],
        [6, 4],
        [4, 0],
        [0, 6],
        [1, 6],
        [2, 6],
        [3, 6],
      ],
      creases: [7, 8, 9, 10].map((edge) => ({ edge, targetAngle: 90 })),
    };
    const sheet = simulatorSheetOf(slit);
    expect(sheet.key).not.toBeNull();
    // Below the slit sorts first, whichever number it has.
    const swapped = renumbered(slit, [0, 1, 2, 3, 5, 4, 6]);
    const other = simulatorSheetOf(swapped);
    expect(other.key).toBe(sheet.key);
    const placeOf = (nodes: Uint32Array, node: number) => nodes.indexOf(node);
    expect(placeOf(other.nodes, 5)).toBe(placeOf(sheet.nodes, 4));
  });

  it('has no key when two nodes cannot be told apart', () => {
    // Two copies of one triangle: every node has a twin with the same triangles.
    const twins: SimulatorSheetInput = {
      flat: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0]),
      triangles: Uint32Array.from([0, 1, 2, 3, 4, 5]),
      edges: [],
      creases: [],
    };
    expect(simulatorSheetKey(twins)).toBeNull();
  });
});

describe('a shape’s state', () => {
  it('goes into the sheet’s order and back exactly', () => {
    const input = square();
    const sheet = simulatorSheetOf(input);
    const solver = createSolverShape(5, 4);
    solver.offsets.set(Float32Array.from({ length: 15 }, (_, index) => index * 0.37 - 1));
    solver.theta.set([3.2, -1.1, 0.4, -3.15]);

    const state = shapeStateOf(sheet, solver);
    expect(state).toHaveLength(15 + 4);
    const back = solverShapeOf(sheet, state);
    expect(back && Array.from(back.offsets)).toEqual(Array.from(solver.offsets));
    expect(back && Array.from(back.theta)).toEqual(Array.from(solver.theta));
    expect(solverShapeOf(sheet, state.subarray(1))).toBeNull();
  });

  it('is 12 bytes a node and 4 a crease, encoded and decoded bit for bit', () => {
    expect(simulatorShapeBytes(5, 4)).toBe(76);
    const state = Float32Array.from([Math.PI, -0, 1e-30, -3.4e38, 0.1, Number.EPSILON]);
    const text = encodeSimulatorShapeState(state);
    expect(text).toMatch(/^ss1:/);
    const back = decodeSimulatorShapeState(text!);
    expect(back && new Uint8Array(back.buffer)).toEqual(new Uint8Array(state.buffer));
  });

  it('refuses a state over a megabyte, and text it did not write', () => {
    expect(encodeSimulatorShapeState(new Float32Array(SIMULATOR_SHAPE_MAX_BYTES / 4))).not.toBeNull();
    expect(encodeSimulatorShapeState(new Float32Array(SIMULATOR_SHAPE_MAX_BYTES / 4 + 1))).toBeNull();
    // About 87,000 nodes: the most a shape can hold.
    expect(simulatorShapeBytes(87_000, 0)).toBeLessThan(SIMULATOR_SHAPE_MAX_BYTES);
    expect(simulatorShapeBytes(88_000, 0)).toBeGreaterThan(SIMULATOR_SHAPE_MAX_BYTES);

    expect(decodeSimulatorShapeState('AAAA')).toBeNull();
    expect(decodeSimulatorShapeState('ss1:not base64!')).toBeNull();
    expect(decodeSimulatorShapeState('ss1:AAA=')).toBeNull();
  });
});

describe('pins as points', () => {
  it('finds each pinned face again from its point, on a moved and renumbered sheet', () => {
    const input = square();
    const faceGroups = Int32Array.from([10, 11, 12, 13]);
    const points = pinPointsOf(simulatorSheetOf(input), { ...input, faceGroups }, [13, 11]);
    expect(points).toHaveLength(2);

    const order = [3, 4, 0, 2, 1];
    const moved = renumbered({ ...input, flat: input.flat.map((v, i) => v + (i % 3 === 0 ? 5 : 0)) }, order);
    // Triangles were listed backwards: so are their faces.
    const movedGroups = Int32Array.from([13, 12, 11, 10]);
    expect(facesAtPinPoints(simulatorSheetOf(moved), { ...moved, faceGroups: movedGroups }, points)).toEqual([11, 13]);
  });

  it('places a non-convex face’s point inside it', () => {
    // An L of three triangles, one face: the centroid of the whole L is
    // outside it, a triangle's never is.
    const flat = Float32Array.from([0, 0, 0, 2, 0, 0, 2, 1, 0, 1, 1, 0, 1, 2, 0, 0, 2, 0]);
    const triangles = Uint32Array.from([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5].slice(0, 12));
    const input = { flat, triangles, faceGroups: Int32Array.from([7, 7, 7, 7]) };
    const sheet = simulatorSheetOf({ flat, triangles, edges: [], creases: [] });
    const points = pinPointsOf(sheet, input, [7]);
    expect(facesAtPinPoints(sheet, input, points)).toEqual([7]);
  });

  it('places nothing when a point lies on no face', () => {
    const input = square();
    const faceGroups = Int32Array.from([0, 1, 2, 3]);
    expect(facesAtPinPoints(simulatorSheetOf(input), { ...input, faceGroups }, [[5, 5, 0]])).toBeNull();
  });
});
