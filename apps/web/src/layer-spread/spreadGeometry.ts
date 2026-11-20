import { barycentric, type Point3 } from '@oristudio/layer-spread';
import {
  DashTable,
  faceFill,
  lineInk,
  paperSceneToFoldedGeometry,
  type FoldedSceneInk,
  type LineInk,
} from '../cp-workspace/adapters/cpFoldedToScene';
import type { SpreadFaceGeometry, SpreadGeometry } from '../cp-workspace/renderer/programs/spreadProgram';
import type { Rgba } from '../cp-workspace/renderer/types';
import type { PaperScene, PaperItem, PaperFaceItem, PaperLineItem, PaperLineRole, ScenePoint } from '../lib/paper/paperScene';
import type { PaperStyle } from '../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES, surfacePaperStyle } from '../lib/paper/paperStyleResolve';
import { erodeLine, paperFaceFill, penDashPt, penForRole } from '../lib/paper/paperSvg';
import type { ConnectedInk, ConnectedPaperScene } from './connectedScene';

/**
 * A live spread's geometry for the spread program: every face's fills and
 * lines, in the paper pens, erode, dash and colours the painter uses, each
 * vertex at its material depth. Depth follows the drawn triangles, never
 * painter index.
 *
 * Drawn straight from the mesh: a live scene's pieces are its triangles, and
 * its lines the ink it drew, so a vertex's depth is read where the mesh puts
 * it rather than looked for. A scene that is not that — a piece the host
 * changed, or more dashed pens than the program has slots — is drawn face by
 * face through the painter's own geometry instead, which draws the same.
 */
export function spreadGeometry(scene: ConnectedPaperScene, style: PaperStyle, ink: FoldedSceneInk): SpreadGeometry {
  return meshSpreadGeometry(scene, style, ink) ?? paintedSpreadGeometry(scene, style, ink);
}

/** The mesh's height range, which every depth is a share of. */
function depthRange(positions: readonly Point3[]): { lo: number; span: number } {
  let lo = Infinity,
    hi = -Infinity;
  for (const p of positions) {
    lo = Math.min(lo, p[2]);
    hi = Math.max(hi, p[2]);
  }
  return { lo, span: Math.max(hi - lo, 1e-8) };
}

/**
 * Depth by looking for the face's triangle under a point: for a point the
 * mesh does not place, or a scene drawn face by face.
 */
function depthSearch(scene: ConnectedPaperScene, lo: number, span: number) {
  const { mesh, front } = scene.connected;
  const triangles: Point3[][][] = front.map(() => []);
  mesh.triangleFaces.forEach((f, t) => triangles[f]!.push(mesh.triangles[t]!.map((v) => mesh.positions[v]!)));
  return (face: number, x: number, y: number): number => {
    let distance = Infinity;
    let closest = lo;
    for (const p of triangles[face]!) {
      const w = barycentric(p[0]!, p[1]!, p[2]!, [x, y]);
      if (w && Math.min(...w) >= 0) return (w.reduce((s, v, k) => s + v * p[k]![2], 0) - lo) / span;
      // The adapter's GPU positions are Float32. Rounding a boundary at large
      // page coordinates can put it outside every double-precision triangle,
      // especially on thin flaps. Extend depth from the nearest material edge
      // continuously instead of snapping that vertex to an arbitrary mid-plane.
      for (let i = 0; i < 3; i++) {
        const a = p[i]!, b = p[(i + 1) % 3]!;
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const length2 = dx * dx + dy * dy;
        const u = length2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / length2)) : 0;
        const d = (x - a[0] - u * dx) ** 2 + (y - a[1] - u * dy) ** 2;
        if (d < distance) {
          distance = d;
          closest = a[2] + u * (b[2] - a[2]);
        }
      }
    }
    return (closest - lo) / span;
  };
}

/**
 * Each face through the painter's own geometry, its vertices' depths looked
 * for: what a scene the mesh cannot draw is drawn with, and what the mesh's
 * drawing must match.
 */
export function paintedSpreadGeometry(scene: ConnectedPaperScene, style: PaperStyle, ink: FoldedSceneInk): SpreadGeometry {
  const { mesh, front } = scene.connected;
  const { lo, span } = depthRange(mesh.positions);
  const depth = depthSearch(scene, lo, span);
  const items: PaperItem[][] = front.map(() => []);
  for (const item of scene.items)
    if (item.kind !== 'markup' && !item.hidden && item.face !== undefined) items[item.face]!.push(item);
  const faces = items.map((items, face) => {
    const plain: PaperScene = { items, sheet: scene.sheet, bounds: scene.bounds };
    const geometry = paperSceneToFoldedGeometry(plain, style, ink);
    const depths = (xy: Float32Array) =>
      Float32Array.from({ length: xy.length / 2 }, (_, v) => depth(face, xy[2 * v]!, xy[2 * v + 1]!));
    geometry.fills.depth = depths(geometry.fills.position);
    geometry.strokes.depth = depths(geometry.strokes.a);
    geometry.strokes.depthEnd = depths(geometry.strokes.b);
    return geometry;
  });
  return { faces, visibility: mesh.visibility };
}

/** Height at `point` on a drawn line, which lies inside one triangle: where along the line it is. */
function heightOn(line: ConnectedInk, point: ScenePoint): number {
  const { a, b } = line;
  if (point[0] === a[0] && point[1] === a[1]) return a[2];
  if (point[0] === b[0] && point[1] === b[1]) return b[2];
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const t = length2 > 0 ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2)) : 0;
  return a[2] + t * (b[2] - a[2]);
}

/**
 * The live scene's geometry in one pass over its items: a piece is its
 * triangle's three vertices, a line its eroded ends at the drawn line's
 * height there. Null for a scene that is not a live drawing of its mesh.
 */
export function meshSpreadGeometry(scene: ConnectedPaperScene, effective: PaperStyle, ink: FoldedSceneInk): SpreadGeometry | null {
  const { mesh, front, ink: drawn } = scene.connected;
  const { positions, triangles, triangleFaces } = mesh;
  const faceCount = front.length;
  const { lo, span } = depthRange(positions);
  const style = surfacePaperStyle(effective, ink.policy ?? PAPER_STYLE_POLICIES['folded-3d']);
  const erodePx = style.erode * scene.sheet;
  const faceAlpha = ink.faceAlpha ?? 1;

  const dashes = new DashTable();
  const pens = new Map<PaperLineRole, LineInk | null>();
  let crowded = false;
  const penOf = (role: PaperLineRole): LineInk | null => {
    let pen = pens.get(role);
    if (pen === undefined) {
      const source = penForRole(style, role);
      pen = lineInk(source, dashes);
      // A dashed pen past the program's slots would draw solid here; face by face, it keeps its dash.
      if (pen && source && pen.slot === 0 && penDashPt(source)) crowded = true;
      pens.set(role, pen);
    }
    return pen;
  };
  const sideFills = { front: new Map<number, Rgba>(), back: new Map<number, Rgba>() };
  const faceFills = new Map<number, Rgba>();
  const fillOf = (item: PaperFaceItem): Rgba => {
    const override = ink.faces?.get(item.face);
    const cache = override ? faceFills : sideFills[item.side];
    const key = override ? item.face : item.shade;
    let fill = cache.get(key);
    if (!fill) cache.set(key, (fill = faceFill(paperFaceFill(style, item.side, item.shade), faceAlpha, override)));
    return fill;
  };

  // Which triangle each piece is — the live scene lists them in mesh order —
  // and which drawn line each line is; then how much each face holds.
  const { items } = scene;
  const source = new Int32Array(items.length).fill(-1);
  // The scene lists its lines in the drawing's order, some left out (Fold's
  // Precreases off): follow along, and look one up only where they part.
  let lineIndex: Map<PaperLineItem, number> | null = null;
  let along = 0;
  const drawnLine = (item: PaperLineItem): number => {
    if (drawn[along]?.line === item) return along++;
    if (!lineIndex) {
      lineIndex = new Map();
      for (let k = 0; k < drawn.length; k++) lineIndex.set(drawn[k]!.line, k);
    }
    const k = lineIndex.get(item);
    if (k === undefined) return -1;
    along = k + 1;
    return k;
  };
  const fillCount = new Int32Array(faceCount + 1);
  const strokeCount = new Int32Array(faceCount + 1);
  let next = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (item.kind === 'markup' || item.hidden || item.face === undefined) continue;
    if (!(item.face >= 0 && item.face < faceCount)) return null;
    if (item.kind === 'face') {
      const ring = item.rings[0];
      const ids = triangles[next];
      if (item.outline || item.rings.length !== 1 || ring?.length !== 3 || !ids || triangleFaces[next] !== item.face) return null;
      for (let k = 0; k < 3; k++) {
        const p = positions[ids[k]!]!;
        if (ring[k]![0] !== p[0] || ring[k]![1] !== p[1]) return null;
      }
      source[i] = next++;
      fillCount[item.face + 1] += 3;
    } else if (item.kind === 'line' && penOf(item.role)) {
      source[i] = drawnLine(item);
      strokeCount[item.face + 1] += 1;
    }
  }
  if (crowded) return null;
  // Each face's run in one buffer per attribute, in face order.
  for (let f = 0; f < faceCount; f++) {
    fillCount[f + 1] += fillCount[f]!;
    strokeCount[f + 1] += strokeCount[f]!;
  }
  const fills = fillCount[faceCount]!,
    strokes = strokeCount[faceCount]!;
  const fillPos = new Float32Array(fills * 2),
    fillColor = new Float32Array(fills * 4),
    fillDepth = new Float32Array(fills);
  const a = new Float32Array(strokes * 2),
    b = new Float32Array(strokes * 2),
    color = new Float32Array(strokes * 4),
    widthMul = new Float32Array(strokes),
    depth = new Float32Array(strokes),
    depthEnd = new Float32Array(strokes),
    dashSlot = new Float32Array(strokes),
    dashPhase = new Float32Array(strokes);
  const fillAt = fillCount.slice(0, faceCount),
    strokeAt = strokeCount.slice(0, faceCount);
  const dashed = new Uint8Array(faceCount);
  let search: ReturnType<typeof depthSearch> | null = null;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (item.kind === 'face' && source[i]! >= 0) {
      const ring = item.rings[0]!,
        ids = triangles[source[i]!]!,
        fill = fillOf(item);
      for (let k = 0; k < 3; k++) {
        const v = fillAt[item.face]!++;
        fillPos[2 * v] = ring[k]![0];
        fillPos[2 * v + 1] = ring[k]![1];
        fillColor.set(fill, 4 * v);
        fillDepth[v] = (positions[ids[k]!]![2] - lo) / span;
      }
    } else if (item.kind === 'line' && item.face !== undefined && !item.hidden) {
      const pen = penOf(item.role);
      if (!pen) continue;
      const eroded = erodeLine(item, erodePx);
      if (!eroded) continue;
      const [from, to] = eroded;
      const s = strokeAt[item.face]!++;
      a[2 * s] = from[0];
      a[2 * s + 1] = from[1];
      b[2 * s] = to[0];
      b[2 * s + 1] = to[1];
      color.set(pen.color, 4 * s);
      widthMul[s] = pen.width;
      dashSlot[s] = pen.slot;
      // A centred pattern starts half the line's length before it: its first run's middle on the midpoint.
      dashPhase[s] = pen.slot === 0 || !pen.centred ? 0 : -Math.hypot(to[0] - from[0], to[1] - from[1]) / 2;
      if (pen.slot) dashed[item.face] = 1;
      const line = source[i]! >= 0 ? drawn[source[i]!]! : null;
      if (line) {
        depth[s] = (heightOn(line, from) - lo) / span;
        depthEnd[s] = (heightOn(line, to) - lo) / span;
      } else {
        search ??= depthSearch(scene, lo, span);
        depth[s] = search(item.face, Math.fround(from[0]), Math.fround(from[1]));
        depthEnd[s] = search(item.face, Math.fround(to[0]), Math.fround(to[1]));
      }
    }
  }
  const faces: SpreadFaceGeometry[] = [];
  for (let f = 0; f < faceCount; f++) {
    const f0 = fillCount[f]!,
      f1 = fillCount[f + 1]!,
      s0 = strokeCount[f]!,
      s1 = strokeAt[f]!;
    faces.push({
      fills: {
        position: fillPos.subarray(2 * f0, 2 * f1),
        color: fillColor.subarray(4 * f0, 4 * f1),
        count: f1 - f0,
        depth: fillDepth.subarray(f0, f1),
      },
      strokes: {
        a: a.subarray(2 * s0, 2 * s1),
        b: b.subarray(2 * s0, 2 * s1),
        color: color.subarray(4 * s0, 4 * s1),
        widthMul: widthMul.subarray(s0, s1),
        count: s1 - s0,
        depth: depth.subarray(s0, s1),
        depthEnd: depthEnd.subarray(s0, s1),
        ...(dashed[f]
          ? { dashPatterns: dashes.patterns, dashSlot: dashSlot.subarray(s0, s1), dashPhase: dashPhase.subarray(s0, s1) }
          : {}),
      },
    });
  }
  return { faces, visibility: mesh.visibility };
}
