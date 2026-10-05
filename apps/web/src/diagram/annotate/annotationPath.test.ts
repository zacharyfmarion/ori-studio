import { describe, expect, it } from 'vitest';
import { cubicPoint, nearestOnPath } from '../../lib/cubicBezier';
import type { DiagramPathNode, KnownDiagramAnnotation } from '../document/diagramDocument';
import {
  arcToPath,
  bendPathSegment,
  canResetPath,
  constrainHandleAngle,
  constrainToEighths,
  deletePathNode,
  isCornerNode,
  movePathHandle,
  movePathNode,
  nearestPathPoint,
  pathNodesOf,
  pathRepresentation,
  resetPath,
  sameRepresentation,
  setPathNodeType,
  splitPathSegment,
  togglePathNodeType,
  visiblePathHandles,
} from './annotationPath';
import { ANNOTATION_REACH, ARROW_BEND, MAX_PATH_NODES, arrowApex, defaultBend, pathCubics, type PicturePoint } from './annotationModel';

const SQUARE = { width: 1, height: 1 };

const arc = (bend: number | undefined, kind: KnownDiagramAnnotation['kind'] = 'valley-arrow'): KnownDiagramAnnotation => ({
  id: 'a',
  kind,
  from: [0.2, 0.5],
  to: [0.5, 0.5],
  ...(bend !== undefined ? { bend } : {}),
});

/** A three-node S: a smooth middle node, handles either side. */
const S_PATH: DiagramPathNode[] = [
  { at: [0.1, 0.5], out: [0.2, 0.3] },
  { at: [0.4, 0.5], in: [0.3, 0.6], out: [0.5, 0.4] },
  { at: [0.7, 0.5], in: [0.6, 0.7] },
];
const S_ARROW: KnownDiagramAnnotation = { id: 's', kind: 'mountain-arrow', from: [0.1, 0.5], to: [0.7, 0.5], path: S_PATH };

/** The circle through three points. */
function circleThrough(a: PicturePoint, b: PicturePoint, c: PicturePoint) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  const sa = a[0] ** 2 + a[1] ** 2;
  const sb = b[0] ** 2 + b[1] ** 2;
  const sc = c[0] ** 2 + c[1] ** 2;
  const centre: PicturePoint = [
    (sa * (b[1] - c[1]) + sb * (c[1] - a[1]) + sc * (a[1] - b[1])) / d,
    (sa * (c[0] - b[0]) + sb * (a[0] - c[0]) + sc * (b[0] - a[0])) / d,
  ];
  return { centre, radius: Math.hypot(a[0] - centre[0], a[1] - centre[1]) };
}

/** How far a path strays from its arc, at most: sampled densely along every segment. */
function arcError(annotation: KnownDiagramAnnotation, bend: number): number {
  const { centre, radius } = circleThrough(annotation.from, arrowApex(annotation.from, annotation.to, bend), annotation.to);
  let worst = 0;
  for (const cubic of pathCubics(annotation.path!)) {
    for (let step = 0; step <= 400; step += 1) {
      const p = cubicPoint(cubic, step / 400);
      worst = Math.max(worst, Math.abs(Math.hypot(p[0] - centre[0], p[1] - centre[1]) - radius));
    }
  }
  return worst;
}

/** Whether a node's two handles stand in line through it, on either side. */
function inLine(node: DiagramPathNode): boolean {
  const a: PicturePoint = [node.in![0] - node.at[0], node.in![1] - node.at[1]];
  const b: PicturePoint = [node.out![0] - node.at[0], node.out![1] - node.at[1]];
  const cross = a[0] * b[1] - a[1] * b[0];
  const dot = a[0] * b[0] + a[1] * b[1];
  return Math.abs(cross) < 1e-12 && dot < 0;
}

const length = (a: PicturePoint, b: PicturePoint) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Every point a path is made of. */
const pointsOf = (path: readonly DiagramPathNode[]) =>
  path.flatMap((node) => [node.at, ...(node.in ? [node.in] : []), ...(node.out ? [node.out] : [])]);

describe('an arc made a path', () => {
  it('draws References’ arc within a micron on a default 15 mm arrow, in one cubic', () => {
    const shaped = arcToPath(arc(ARROW_BEND));
    expect(shaped.path).toHaveLength(2);
    expect(shaped.bend).toBeUndefined();
    // The chord is 0.3 of the frame; 15 mm of print.
    const microns = (arcError(shaped, ARROW_BEND) / 0.3) * 15_000;
    expect(microns).toBeLessThan(1);
    expect(microns).toBeGreaterThan(0.1);
  });

  it('cuts a wider sweep into quarters or less, each node smooth, its ends exactly the arrow’s', () => {
    for (const [bend, pieces] of [
      [0.1, 1],
      [-0.3, 2],
      [0.5, 2],
    ] as const) {
      const shaped = arcToPath(arc(bend));
      expect(shaped.path).toHaveLength(pieces + 1);
      expect(shaped.path![0]!.at).toEqual([0.2, 0.5]);
      expect(shaped.path![pieces]!.at).toEqual([0.5, 0.5]);
      expect(shaped.path![0]!.in).toBeUndefined();
      expect(shaped.path![pieces]!.out).toBeUndefined();
      for (const node of shaped.path!.slice(1, -1)) expect(inLine(node)).toBe(true);
      // A half circle's quarters stray a few microns at 15 mm.
      expect((arcError(shaped, bend) / 0.3) * 15_000).toBeLessThan(5);
    }
  });

  it('bulges the way its bend did', () => {
    const up = arcToPath(arc(ARROW_BEND));
    const down = arcToPath(arc(-ARROW_BEND));
    // A positive bend bulges left of travel as the page shows it: up, for an arrow going right.
    expect(cubicPoint(pathCubics(up.path!)[0]!, 0.5)[1]).toBeLessThan(0.5);
    expect(cubicPoint(pathCubics(down.path!)[0]!, 0.5)[1]).toBeGreaterThan(0.5);
  });

  it('leaves a path, a push and a line as they are', () => {
    expect(arcToPath(S_ARROW)).toBe(S_ARROW);
    const push = arc(undefined, 'push-arrow');
    expect(arcToPath(push)).toBe(push);
    expect(pathNodesOf(push)).toBeNull();
    // An arrow written without a bend is References' 60°.
    expect(pathNodesOf(arc(undefined))).toEqual(arcToPath(arc(ARROW_BEND)).path);
  });
});

describe('Reset', () => {
  it('makes a path an arc again, bulging the side it lay on', () => {
    expect(resetPath(arcToPath(arc(0.4)), SQUARE)).toEqual(arc(ARROW_BEND));
    expect(resetPath(arcToPath(arc(-0.2)), SQUARE)).toEqual(arc(-ARROW_BEND));
  });

  it('bulges toward the frame’s middle, as a new arrow does, for a path on neither side', () => {
    const symmetric: KnownDiagramAnnotation = {
      ...S_ARROW,
      path: [
        { at: [0.1, 0.2], out: [0.3, 0.1] },
        { at: [0.7, 0.2], in: [0.5, 0.3] },
      ],
      from: [0.1, 0.2],
      to: [0.7, 0.2],
    };
    expect(resetPath(symmetric, SQUARE).bend).toBe(defaultBend([0.1, 0.2], [0.7, 0.2], SQUARE));
    expect(resetPath(symmetric, SQUARE).path).toBeUndefined();
  });

  it('leaves an arc, and a path whose ends meet, as they are', () => {
    const plain = arc(0.2);
    expect(resetPath(plain, SQUARE)).toBe(plain);
    const loop: KnownDiagramAnnotation = {
      ...S_ARROW,
      to: [0.1, 0.5],
      path: [
        { at: [0.1, 0.5], out: [0.5, 0.1] },
        { at: [0.1, 0.5], in: [0.5, 0.9] },
      ],
    };
    expect(resetPath(loop, SQUARE)).toBe(loop);
  });

  it('leaves a loop whose ends lie closer than the shortest arrow, which an arc there could not be', () => {
    const loop: KnownDiagramAnnotation = {
      ...S_ARROW,
      to: [0.11, 0.5],
      path: [
        { at: [0.1, 0.5], out: [0.5, 0.1] },
        { at: [0.11, 0.5], in: [0.5, 0.9] },
      ],
    };
    expect(resetPath(loop, SQUARE)).toBe(loop);
  });
});

describe('moving a node or a handle', () => {
  it('moves a node with its handles, its neighbours where they were', () => {
    const moved = movePathNode(S_ARROW, 1, [0.45, 0.4]);
    const node = moved.path![1]!;
    expect(node.at).toEqual([0.45, 0.4]);
    expect(node.in![0]).toBeCloseTo(0.35, 12);
    expect(node.in![1]).toBeCloseTo(0.5, 12);
    expect(node.out![0]).toBeCloseTo(0.55, 12);
    expect(node.out![1]).toBeCloseTo(0.3, 12);
    expect(moved.path![0]).toBe(S_PATH[0]);
    expect(moved.path![2]).toBe(S_PATH[2]);
  });

  it('moves the arrow’s end with its tail or tip node', () => {
    expect(movePathNode(S_ARROW, 0, [0, 0]).from).toEqual([0, 0]);
    expect(movePathNode(S_ARROW, 2, [0.9, 0.9]).to).toEqual([0.9, 0.9]);
  });

  it('shapes an arc on its first edit', () => {
    const shaped = movePathNode(arc(ARROW_BEND), 1, [0.6, 0.6]);
    expect(shaped.bend).toBeUndefined();
    expect(shaped.to).toEqual([0.6, 0.6]);
  });

  it('turns a smooth node’s other handle to stay in line, keeping its length; a corner’s stays', () => {
    const before = S_PATH[1]!;
    const smooth = movePathHandle(S_ARROW, 1, 'out', [0.4, 0.3]).path![1]!;
    expect(smooth.out).toEqual([0.4, 0.3]);
    expect(inLine(smooth)).toBe(true);
    expect(length(smooth.at, smooth.in!)).toBeCloseTo(length(before.at, before.in!), 12);
    const corner = setPathNodeType(S_ARROW, 1, 'corner');
    const free = movePathHandle(corner, 1, 'out', [0.4, 0.3]).path![1]!;
    expect(free.in).toEqual(before.in);
    expect(free.out).toEqual([0.4, 0.3]);
  });

  it('has no handle before the tail or after the tip', () => {
    expect(movePathHandle(S_ARROW, 0, 'in', [0.3, 0.3])).toBe(S_ARROW);
    expect(movePathHandle(S_ARROW, 2, 'out', [0.3, 0.3])).toBe(S_ARROW);
    expect(movePathHandle(S_ARROW, 9, 'out', [0.3, 0.3])).toBe(S_ARROW);
  });

  it('keeps every point within reach, a handle drawn in along itself', () => {
    const far = movePathNode(S_ARROW, 1, [9, 0.5]);
    for (const [x, y] of pointsOf(far.path!)) {
      expect(Math.abs(x)).toBeLessThanOrEqual(ANNOTATION_REACH);
      expect(Math.abs(y)).toBeLessThanOrEqual(ANNOTATION_REACH);
    }
    // The node stopped where its handle met reach, its shape round it kept.
    const node = far.path![1]!;
    expect(node.out![0]).toBeCloseTo(ANNOTATION_REACH, 12);
    expect(node.out![0] - node.at[0]).toBeCloseTo(0.1, 12);
    const handle = movePathHandle(S_ARROW, 1, 'out', [12, 0.5]).path![1]!;
    expect(handle.out).toEqual([ANNOTATION_REACH, 0.5]);
    expect(inLine(handle)).toBe(true);
  });
});

describe('bending a segment by its curve', () => {
  it('puts the point pressed exactly where it is dragged, the segment’s ends where they were', () => {
    const t = 0.35;
    const bent = bendPathSegment(S_ARROW, 0, t, [0.3, 0.2]);
    const cubic = pathCubics(bent.path!)[0]!;
    const at = cubicPoint(cubic, t);
    expect(at[0]).toBeCloseTo(0.3, 12);
    expect(at[1]).toBeCloseTo(0.2, 12);
    expect(bent.path![0]!.at).toEqual(S_PATH[0]!.at);
    expect(bent.path![1]!.at).toEqual(S_PATH[1]!.at);
    // The handle nearer the press moves more.
    const moved = (a: PicturePoint, b: PicturePoint) => length(a, b);
    expect(moved(bent.path![0]!.out!, S_PATH[0]!.out!)).toBeGreaterThan(moved(bent.path![1]!.in!, S_PATH[1]!.in!));
  });

  it('keeps a smooth node smooth, its other handle turned with it', () => {
    const bent = bendPathSegment(S_ARROW, 0, 0.6, [0.35, 0.65]).path![1]!;
    expect(inLine(bent)).toBe(true);
    expect(length(bent.at, bent.out!)).toBeCloseTo(length(S_PATH[1]!.at, S_PATH[1]!.out!), 12);
  });

  it('moves nothing at a segment’s end, or past the last', () => {
    expect(bendPathSegment(S_ARROW, 0, 0, [0.3, 0.2])).toBe(S_ARROW);
    expect(bendPathSegment(S_ARROW, 5, 0.5, [0.3, 0.2])).toBe(S_ARROW);
  });
});

describe('adding a node', () => {
  it('cuts a segment where it is pressed without changing the curve', () => {
    const split = splitPathSegment(S_ARROW, 1, 0.3);
    expect(split.path).toHaveLength(4);
    const before = pathCubics(S_PATH);
    const after = pathCubics(split.path!);
    for (const path of [before, after]) {
      const other = path === before ? after : before;
      for (const cubic of path) {
        for (let step = 0; step <= 20; step += 1) {
          expect(nearestOnPath(other, cubicPoint(cubic, step / 20))!.distance).toBeLessThan(1e-9);
        }
      }
    }
    const added = split.path![2]!;
    expect(length(added.at, cubicPoint(before[1]!, 0.3) as PicturePoint)).toBeLessThan(1e-12);
    expect(inLine(added)).toBe(true);
    expect(added.type).toBeUndefined();
  });

  it('stops at the most nodes an arrow has, and at a segment’s ends', () => {
    let arrow: KnownDiagramAnnotation = S_ARROW;
    while (arrow.path!.length < MAX_PATH_NODES) arrow = splitPathSegment(arrow, 0, 0.5);
    expect(arrow.path).toHaveLength(MAX_PATH_NODES);
    expect(splitPathSegment(arrow, 0, 0.5)).toBe(arrow);
    expect(splitPathSegment(S_ARROW, 0, 1)).toBe(S_ARROW);
  });
});

describe('deleting a node', () => {
  it('joins its neighbours with the handles they had (Affinity)', () => {
    const three = splitPathSegment(S_ARROW, 0, 0.5);
    const deleted = deletePathNode(three, 1)!;
    expect(deleted.path).toHaveLength(3);
    expect(deleted.path![0]).toEqual(three.path![0]);
    expect(deleted.path![1]).toEqual(three.path![2]);
  });

  it('makes an end’s neighbour the end, without its handle toward the node', () => {
    const tail = deletePathNode(S_ARROW, 0)!;
    expect(tail.from).toEqual([0.4, 0.5]);
    expect(tail.path![0]).toEqual({ at: [0.4, 0.5], out: [0.5, 0.4] });
    const tip = deletePathNode(S_ARROW, 2)!;
    expect(tip.to).toEqual([0.4, 0.5]);
    expect(tip.path![1]).toEqual({ at: [0.4, 0.5], in: [0.3, 0.6] });
  });

  it('leaves the new end no corner: an end has one handle', () => {
    const cornered = setPathNodeType(splitPathSegment(S_ARROW, 0, 0.5), 1, 'corner');
    expect(isCornerNode(cornered, 1)).toBe(true);
    const tail = deletePathNode(cornered, 0)!;
    expect(tail.path![0]!.type).toBeUndefined();
  });

  it('says the arrow goes when a two-node path loses one', () => {
    const two = deletePathNode(S_ARROW, 1)!;
    expect(two.path).toHaveLength(2);
    expect(deletePathNode(two, 0)).toBeNull();
    expect(deletePathNode(arc(ARROW_BEND), 1)).toBeNull();
    expect(deletePathNode(S_ARROW, 7)).toBe(S_ARROW);
  });
});

describe('smooth and corner', () => {
  it('frees a corner’s handles, and smooths them into line again, each keeping its length', () => {
    const kinked: KnownDiagramAnnotation = {
      ...S_ARROW,
      path: [S_PATH[0]!, { at: [0.4, 0.5], in: [0.3, 0.4], out: [0.5, 0.4], type: 'corner' }, S_PATH[2]!],
    };
    expect(isCornerNode(kinked, 1)).toBe(true);
    const smooth = togglePathNodeType(kinked, 1).path![1]!;
    expect(smooth.type).toBeUndefined();
    expect(inLine(smooth)).toBe(true);
    expect(length(smooth.at, smooth.in!)).toBeCloseTo(Math.hypot(0.1, 0.1), 12);
    // Along the mean of the two directions: here, straight across.
    expect(smooth.in![1]).toBeCloseTo(0.5, 12);
    expect(togglePathNodeType(togglePathNodeType(kinked, 1), 1).path![1]!.type).toBe('corner');
  });

  it('draws a handle that lay on the node out along the line, a third of the way to its neighbour', () => {
    const retracted: KnownDiagramAnnotation = {
      ...S_ARROW,
      path: [S_PATH[0]!, { at: [0.4, 0.5], type: 'corner' }, S_PATH[2]!],
    };
    const smooth = setPathNodeType(retracted, 1, 'smooth').path![1]!;
    expect(inLine(smooth)).toBe(true);
    expect(length(smooth.at, smooth.in!)).toBeCloseTo(0.1, 12);
  });

  it('gives an end no type: it has one handle', () => {
    expect(setPathNodeType(S_ARROW, 0, 'corner')).toBe(S_ARROW);
    expect(setPathNodeType(S_ARROW, 2, 'corner')).toBe(S_ARROW);
  });
});

describe('a press on the curve', () => {
  it('finds the segment and where along it', () => {
    const at = cubicPoint(pathCubics(S_PATH)[1]!, 0.4);
    const found = nearestPathPoint(S_ARROW, [at[0], at[1] + 0.001])!;
    expect(found.segment).toBe(1);
    expect(found.t).toBeCloseTo(0.4, 2);
    expect(found.distance).toBeLessThan(0.0011);
    expect(nearestPathPoint(arc(undefined, 'hidden-line'), [0, 0])).toBeNull();
  });
});

describe('what Edit Path shows', () => {
  it('works out an arrow’s nodes once per annotation object', () => {
    const arrow = arc(0.4);
    expect(pathNodesOf(arrow)).toBe(pathNodesOf(arrow));
    expect(pathNodesOf({ ...arrow })).not.toBe(pathNodesOf(arrow));
  });

  it('shows the selected node’s handles and its neighbours’ facing ones, none with no node selected', () => {
    const four: DiagramPathNode[] = [
      { at: [0.1, 0.5], out: [0.15, 0.4] },
      { at: [0.3, 0.5], in: [0.25, 0.6], out: [0.35, 0.4] },
      { at: [0.5, 0.5], in: [0.45, 0.6], out: [0.55, 0.4] },
      { at: [0.7, 0.5], in: [0.65, 0.6] },
    ];
    expect(visiblePathHandles(four, null)).toEqual([]);
    expect(visiblePathHandles(four, 1).map(({ node, side }) => `${node}${side}`)).toEqual(['0out', '1in', '1out', '2in']);
    expect(visiblePathHandles(four, 0).map(({ node, side }) => `${node}${side}`)).toEqual(['0out', '1in']);
    expect(visiblePathHandles(four, 3).map(({ node, side }) => `${node}${side}`)).toEqual(['2out', '3in']);
    // A handle on its node has no direction to take hold of.
    const retracted = four.map((node, index) => (index === 1 ? { at: node.at, in: node.at, out: node.out } : node));
    expect(visiblePathHandles(retracted, 1).map(({ node, side }) => `${node}${side}`)).toEqual(['0out', '1out', '2in']);
    expect(visiblePathHandles(four, 9)).toEqual([]);
  });

  it('says what an arrow is made of: arc or path, and how many nodes it shows', () => {
    expect(pathRepresentation(arc(ARROW_BEND))).toEqual({ shaped: false, nodes: 2 });
    expect(pathRepresentation(arc(0.5))).toEqual({ shaped: false, nodes: 3 });
    expect(pathRepresentation(S_ARROW)).toEqual({ shaped: true, nodes: 3 });
    expect(pathRepresentation(arc(undefined, 'push-arrow'))).toBeNull();
    // The two-node arc and the path its first edit makes are not the same thing to hold.
    const shaped = movePathNode(arc(ARROW_BEND), 0, [0.2, 0.45]);
    expect(sameRepresentation(pathRepresentation(arc(ARROW_BEND)), pathRepresentation(shaped))).toBe(false);
    expect(sameRepresentation(pathRepresentation(shaped), pathRepresentation(movePathNode(shaped, 1, [0.5, 0.4])))).toBe(true);
    expect(sameRepresentation(null, null)).toBe(false);
  });
});

describe('Shift', () => {
  it('keeps a node’s drag to the nearest of eight directions, as far along it as the drag goes', () => {
    expect(constrainToEighths([0.1, 0.01])).toEqual([expect.closeTo(0.1, 12), expect.closeTo(0, 12)]);
    const diagonal = constrainToEighths([0.05, 0.035]);
    expect(diagonal[0]).toBeCloseTo(0.0425, 12);
    expect(diagonal[1]).toBeCloseTo(0.0425, 12);
    expect(constrainToEighths([-0.002, -0.2])).toEqual([expect.closeTo(0, 12), expect.closeTo(-0.2, 12)]);
    expect(constrainToEighths([0, 0])).toEqual([0, 0]);
  });

  it('turns a handle to the nearest 15° about its node, keeping its length', () => {
    const [x, y] = constrainHandleAngle([0.5, 0.5], [0.6, 0.53]);
    const angle = (Math.atan2(y - 0.5, x - 0.5) * 180) / Math.PI;
    expect(angle).toBeCloseTo(15, 9);
    expect(Math.hypot(x - 0.5, y - 0.5)).toBeCloseTo(Math.hypot(0.1, 0.03), 12);
    expect(constrainHandleAngle([0.5, 0.5], [0.5, 0.5])).toEqual([0.5, 0.5]);
  });
});

describe('a white arrow in Edit Path', () => {
  const laid: KnownDiagramAnnotation = {
    id: 'w',
    kind: 'white-arrow',
    from: [0.2, 0.5],
    to: [0.6, 0.5],
    path: [{ at: [0.2, 0.5] }, { at: [0.6, 0.5] }],
    width: 'narrow',
    tail: 'square',
  };

  it('shows its two nodes and no handles, and bends from straight by its curve', () => {
    expect(pathNodesOf(laid)).toBe(laid.path);
    expect(visiblePathHandles(laid.path!, 0)).toEqual([]);
    const bent = bendPathSegment(laid, 0, 0.5, [0.4, 0.4]);
    const [x, y] = cubicPoint(pathCubics(bent.path!)[0]!, 0.5);
    expect(x).toBeCloseTo(0.4, 12);
    expect(y).toBeCloseTo(0.4, 12);
    expect(bent).toMatchObject({ kind: 'white-arrow', width: 'narrow', tail: 'square', from: [0.2, 0.5], to: [0.6, 0.5] });
    expect(bent).not.toHaveProperty('bend');
    expect(pathRepresentation(bent)).toEqual({ shaped: true, nodes: 2 });
  });

  it('is laid straight between its ends by Reset, its look kept — never made an arc', () => {
    const shaped = splitPathSegment(bendPathSegment(laid, 0, 0.5, [0.4, 0.3]), 0, 0.3);
    expect(canResetPath(shaped)).toBe(true);
    expect(resetPath(shaped, SQUARE)).toEqual(laid);
    // Straight already: nothing to go back to.
    expect(canResetPath(laid)).toBe(false);
    expect(resetPath(laid, SQUARE)).toBe(laid);
  });

  it('is its straight path to an edit that finds none written', () => {
    const { path: _path, ...bare } = laid;
    expect(arcToPath(bare)).toEqual(laid);
    expect(pathNodesOf(bare)).toEqual(laid.path);
  });
});
