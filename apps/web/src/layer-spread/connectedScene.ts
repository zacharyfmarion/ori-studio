import { preparedInk } from './preparedInk';
import {
  interpolate,
  layerChains,
  pickSpread,
  poseVisibility,
  shiftedXY,
  visibility,
  visibleFragments,
  createLineClipper,
  type ConnectedSpread,
  type LayerChains,
  type Point3,
  type ProjectedSpread,
  type SpreadSolution,
  type Visibility,
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
  /** Per original face: material side, independent of triangulation winding. */
  front: boolean[];
  ink: ConnectedInk[];
}
export interface ConnectedPaperScene extends PaperScene {
  connected: ConnectedDrawing;
}
export const hasConnectedDrawing = (scene: PaperScene): scene is ConnectedPaperScene => 'connected' in scene;

const visibilityCache = new WeakMap<ConnectedSpreadSource, ReturnType<typeof visibility>>();
/** Topology and side are fixed for a source; no camera/amount edit changes them. */
export function connectedVisibility(source: ConnectedSpreadSource): ReturnType<typeof visibility> {
  let result = visibilityCache.get(source);
  if (!result) {
    const { input, back } = source;
    result = visibility(input.faces.length, input.orders, back, input.planeGroups);
    visibilityCache.set(source, result);
  }
  return result;
}

const chainsCache = new WeakMap<ConnectedSpreadSource, LayerChains | null>();
function connectedChains(source: ConnectedSpreadSource): LayerChains | null {
  if (!chainsCache.has(source)) {
    const { input } = source;
    chainsCache.set(source, layerChains(input.faces.length, input.orders, input.planeGroups));
  }
  return chainsCache.get(source)!;
}

/**
 * The visibility `positions` draw with: the stack's ranks, re-solved where
 * this pose slides a layer over an unrelated one it lies under
 * (`poseVisibility`). `back` and `base` are the side the pose is seen from.
 */
export function connectedPoseVisibility(
  source: ConnectedSpreadSource,
  positions: readonly Point3[],
  back = source.back,
  base: Visibility = connectedVisibility(source),
): Visibility {
  const { triangles, triangleFaces, faces } = source.input;
  return poseVisibility(base, connectedChains(source), { positions, triangles, triangleFaces, rings: faces }, back);
}

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
  // Lifted paper keeps its size: faces draw shortened along their slope.
  const placed = shiftedXY(input, solution, spread.amount, back);
  // Indexed loops through a frame's drawing: WebKit's optimized code left a
  // per-frame `map`, `for…of` or destructuring at its end, every frame.
  const positions: Point3[] = [];
  for (let v = 0; v < input.xy.length; v++) {
    const x = input.xy[v]![0],
      y = input.xy[v]![1];
    const p = toScenePx(scenePoint(source, placed[v]!));
    const z = solution.heights[v]!;
    const h = spread.amount * (z - reference[0] * x - reference[1] * y - reference[2]) * scale;
    // A screen drag pulls the near side; layers behind reveal oppositely.
    const side = back ? -1 : 1;
    positions.push([p[0] + side * spread.reveal[0] * h, p[1] + side * spread.reveal[1] * h, side * spread.amount * z * scale]);
  }
  const mesh: ProjectedSpread = {
    positions,
    triangles: input.triangles,
    triangleFaces: input.triangleFaces,
    visibility: connectedPoseVisibility(source, positions),
  };
  const pieces = preparedInk(source, baseInk);
  const ink: ConnectedInk[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const edge = pieces[i]!;
    const a = interpolate(edge.ids, edge.a, positions),
      b = interpolate(edge.ids, edge.b, positions);
    const whole = edge.line.whole;
    const wa = whole ? creaseEnd(edge, edge.wholeA, 0, a, b, positions) : null;
    const wb = whole ? creaseEnd(edge, edge.wholeB, 1, a, b, positions) : null;
    ink.push({
      face: edge.face,
      a,
      b,
      line: {
        ...edge.line,
        a: [a[0], a[1]],
        b: [b[0], b[1]],
        hidden: false,
        joined: edge.joined,
        // Never the ink's own `whole`: it is in the fold's coordinates, not the picture's.
        whole: whole && wa && wb ? { ...whole, a: [wa[0], wa[1]], b: [wb[0], wb[1]] } : undefined,
      },
    });
  }
  const front: boolean[] = [];
  for (let f = 0; f < kernel.faces.length; f++) front.push(kernel.faces[f]!.front_up);
  return { mesh, rings: input.faces, front, ink };
}

/**
 * A crease end this face holds is drawn where the face puts it. One in
 * another face lies on this piece's own drawn line, at the piece's share of
 * the crease, so the crease still erodes along the piece.
 */
function creaseEnd(
  edge: ReturnType<typeof preparedInk>[number],
  sample: ReturnType<typeof preparedInk>[number]['wholeA'],
  at: 0 | 1,
  a: Point3,
  b: Point3,
  positions: readonly Point3[],
): Point3 | null {
  if (sample) return interpolate(sample.ids, sample.weights, positions);
  if (!edge.span || edge.span[0] === edge.span[1]) return null;
  const t = (at - edge.span[0]) / (edge.span[1] - edge.span[0]);
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
}

export function connectedPaperScene(drawing: ConnectedDrawing, sheet: number, resolved = false): PaperScene {
  const { mesh, front, ink } = drawing;
  const { positions } = mesh;
  const items: PaperItem[] = [];
  const point = (v: number): ScenePoint => [positions[v]![0], positions[v]![1]];
  // The first item for a material face is its whole ring. Stored annotation
  // anchors and buried-face marks use it; it contributes no visible ink.
  for (let face = 0; face < drawing.rings.length; face++) {
    const ring = drawing.rings[face]!;
    const outline: ScenePoint[] = [];
    for (let k = 0; k < ring.length; k++) outline.push(point(ring[k]!));
    items.push({ kind: 'face', face, side: front[face] ? 'front' : 'back', rings: [outline], shade: 1, hidden: true });
  }
  // A live picture's pieces are its triangles; a resolved one's, what shows of them.
  if (resolved)
    for (const fragment of visibleFragments(mesh))
      items.push({ kind: 'face', face: fragment.face, side: front[fragment.face] ? 'front' : 'back', rings: [fragment.polygon], shade: 1, hidden: false });
  else
    for (let t = 0; t < mesh.triangles.length; t++) {
      const ids = mesh.triangles[t]!,
        face = mesh.triangleFaces[t]!;
      const piece = [point(ids[0]), point(ids[1]), point(ids[2])];
      items.push({ kind: 'face', face, side: front[face] ? 'front' : 'back', rings: [piece], shade: 1, hidden: false });
    }
  const clipLine = resolved ? createLineClipper(mesh) : null;
  for (let i = 0; i < ink.length; i++) {
    const edge = ink[i]!;
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
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (let v = 0; v < positions.length; v++) {
    const p = positions[v]!;
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
