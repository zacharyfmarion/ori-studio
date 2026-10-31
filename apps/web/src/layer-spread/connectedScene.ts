import { preparedInk } from './preparedInk';
import {
  interpolate,
  pickSpread,
  visibility,
  visibleFragments,
  createLineClipper,
  visibleContours,
  type ConnectedSpread,
  type Point3,
  type ProjectedSpread,
  type SpreadSolution,
} from '@oristudio/layer-spread';
import type { OristudioCpFoldedPaperScene } from '../engine/oristudioCpTypes';
import type { Point } from '../lib/geometry';
import type { PaperItem, PaperLineItem, PaperScene, ScenePoint } from '../lib/paper/paperScene';
import { scenePoint, type ConnectedSpreadSource } from '../cp-workspace/folded/connectedSpreadSource';

export interface PreparedConnectedSpread {
  source: ConnectedSpreadSource;
  solution: SpreadSolution;
}
export interface ConnectedInk {
  line: PaperLineItem;
  a: Point3;
  b: Point3;
  face: number;
}
export interface ConnectedDrawing {
  mesh: ProjectedSpread;
  rings: number[][];
  planeGroups?: number[];
  /** Per original face: material side, independent of triangulation winding. */
  front: boolean[];
  ink: ConnectedInk[];
}
export interface ConnectedPaperScene extends PaperScene {
  connected: ConnectedDrawing;
}
export const hasConnectedDrawing = (scene: PaperScene): scene is ConnectedPaperScene => 'connected' in scene;

/** Shared placed geometry. Reveal is screen-relative, after the host's turn.
 * Solve coordinates and reference planes never change with a camera gesture.
 */
export function connectedDrawing(
  kernel: OristudioCpFoldedPaperScene,
  prepared: PreparedConnectedSpread,
  spread: ConnectedSpread,
  toScenePx: (point: Point) => ScenePoint,
  baseInk: readonly PaperItem[],
): ConnectedDrawing {
  const { source, solution } = prepared,
    { input, back } = source;
  const reference = solution.references[back ? 1 : 0].plane;
  const unit = Math.hypot(...source.frame.ex);
  const origin = toScenePx({ x: 0, y: 0 }),
    basis = toScenePx({ x: unit, y: 0 });
  const scale = Math.hypot(basis[0] - origin[0], basis[1] - origin[1]);
  const positions: Point3[] = input.xy.map(([x, y], v) => {
    const p = toScenePx(scenePoint(source, [x, y]));
    const z = solution.heights[v]!;
    const h = spread.amount * (z - reference[0] * x - reference[1] * y - reference[2]) * scale;
    // A screen drag pulls the near side; layers behind reveal oppositely.
    const side = back ? -1 : 1;
    return [p[0] + side * spread.reveal[0] * h, p[1] + side * spread.reveal[1] * h, side * spread.amount * z * scale];
  });
  const mesh: ProjectedSpread = {
    positions,
    triangles: input.triangles,
    triangleFaces: input.triangleFaces,
    visibility: visibility(input.faces.length, input.orders, back, input.planeGroups),
  };
  const ink: ConnectedInk[] = preparedInk(source, baseInk).map((edge) => {
    const a = interpolate(edge.ids, edge.a, positions),
      b = interpolate(edge.ids, edge.b, positions);
    const whole = edge.line.whole;
    const wa = edge.wholeA ? interpolate(edge.wholeA.ids, edge.wholeA.weights, positions) : null;
    const wb = edge.wholeB ? interpolate(edge.wholeB.ids, edge.wholeB.weights, positions) : null;
    return {
      face: edge.face,
      a,
      b,
      line: {
        ...edge.line,
        a: [a[0], a[1]],
        b: [b[0], b[1]],
        hidden: false,
        joined: edge.joined,
        ...(whole && wa && wb ? { whole: { ...whole, a: [wa[0], wa[1]], b: [wb[0], wb[1]] } } : {}),
      },
    };
  });
  return { mesh, rings: input.faces, planeGroups: input.planeGroups, front: kernel.faces.map((f) => f.front_up), ink };
}

export function connectedPaperScene(drawing: ConnectedDrawing, sheet: number, resolved = false): PaperScene {
  const { mesh, front, ink } = drawing;
  const items: PaperItem[] = [];
  // The first item for a material face is its whole ring. Stored annotation
  // anchors and buried-face marks use it; it contributes no visible ink.
  drawing.rings.forEach((ring, face) =>
    items.push({
      kind: 'face',
      face,
      side: front[face] ? 'front' : 'back',
      rings: [ring.map((v) => mesh.positions[v]!.slice(0, 2) as ScenePoint)],
      shade: 1,
      hidden: true,
    }),
  );
  const fragments = resolved
    ? visibleFragments(mesh)
    : mesh.triangles.map((ids, triangle) => ({
        triangle,
        face: mesh.triangleFaces[triangle]!,
        polygon: ids.map((v) => mesh.positions[v]!.slice(0, 2) as ScenePoint),
      }));
  for (const fragment of fragments)
    items.push({
      kind: 'face',
      face: fragment.face,
      side: front[fragment.face] ? 'front' : 'back',
      rings: [fragment.polygon],
      shade: 1,
      hidden: false,
    });
  const clipLine = resolved ? createLineClipper(mesh) : null;
  for (const edge of ink) {
    if (!clipLine) {
      items.push(edge.line);
      continue;
    }
    for (const [lo, hi] of clipLine(edge.face, edge.a, edge.b)) {
      const at = (t: number): ScenePoint => [
        edge.a[0] + t * (edge.b[0] - edge.a[0]),
        edge.a[1] + t * (edge.b[1] - edge.a[1]),
      ];
      items.push({
        ...edge.line,
        a: at(lo),
        b: at(hi),
        whole: edge.line.whole ?? { a: edge.line.a, b: edge.line.b, onBoundary: edge.line.onBoundary },
        joined: [lo > 0 || edge.line.joined?.[0] === true, hi < 1 || edge.line.joined?.[1] === true],
      });
    }
  }
  // A hidden mask may separate two other visible faces while losing its own
  // ink. Close only those contours, using the existing idle-capture geometry.
  if (resolved)
    for (const { a, b } of visibleContours(mesh, drawing.rings, fragments, drawing.planeGroups))
      items.push({ kind: 'line', role: 'edge', a, b, onBoundary: [false, false], joined: [true, true], hidden: false });
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of mesh.positions) {
    bounds.minX = Math.min(bounds.minX, p[0]);
    bounds.minY = Math.min(bounds.minY, p[1]);
    bounds.maxX = Math.max(bounds.maxX, p[0]);
    bounds.maxY = Math.max(bounds.maxY, p[1]);
  }
  return resolved ? { items, sheet, bounds } : ({ items, sheet, bounds, connected: drawing } as ConnectedPaperScene);
}

/** Material point under the visible triangle, even on a warped/inverted face. */
export function connectedPick(
  prepared: PreparedConnectedSpread,
  drawing: ConnectedDrawing,
  point: ScenePoint,
): { face: number; point: Point } | null {
  const pick = pickSpread(drawing.mesh, point);
  if (!pick) return null;
  const ids = prepared.source.input.triangles[pick.triangle]!;
  const xy = prepared.source.input.xy;
  const x = pick.weights.reduce((s, w, k) => s + w * xy[ids[k]!]![0], 0),
    y = pick.weights.reduce((s, w, k) => s + w * xy[ids[k]!]![1], 0);
  return { face: pick.face, point: scenePoint(prepared.source, [x, y]) };
}
