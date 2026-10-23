/**
 * What the sequence chrome reads off a state's scene (plan D12), once per
 * state: where each face's sheet goes on screen, the silhouette's box and
 * area, the crease letters, and the two thumbnails — the folded form for the
 * step strip and the crease pattern for a Diagram step's thumbnail.
 *
 * A scene is the state's whole picture and can run to thousands of points;
 * this is what the strip, the sentences and the Step pane need of
 * it, small enough to keep for every step of a path. Every coordinate is in
 * the frame the step's picture is drawn in, the scene frame (the view
 * applied, y-up), except the faces' rings, which are on the sheet.
 *
 * The thumbnails are `SheetThumbnail`s, fitted as the pattern pickers fit one
 * (`fitSheetThumbnail`) and held to what a Diagram file takes back
 * (`storedSheetThumbnail`, snapped to a tenth as a captured step's is), so a
 * Diagram step linked to a Fold step can keep the same picture (plan D17).
 *
 * Pure: no React, no store, no engine.
 */
import {
  fitSheetThumbnail,
  storedSheetThumbnail,
  type SheetStroke,
  type SheetStrokeRole,
  type SheetThumbnail,
} from '../../cp-workspace/sheets/sheetThumbnail';
import type { Point } from '../../lib/geometry';
import type { SheetPoint } from '../document/foldSequenceDocument';
import type { FoldIsometry, FoldModelPoint, FoldScene, FoldSceneCrease } from '../engine/foldEngineWire';

/** A face: its ring on the sheet, and its map from the sheet to the scene. */
export interface FoldFrameFace {
  readonly sheet: readonly SheetPoint[];
  readonly toScene: FoldIsometry;
}

export interface FoldFrameBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface FoldStateFrame {
  readonly faces: readonly FoldFrameFace[];
  /** Model frame to scene. */
  readonly view: FoldIsometry;
  /** The silhouette's box in the scene frame. */
  readonly bounds: FoldFrameBounds;
  /** The silhouette's area. */
  readonly area: number;
  /**
   * The silhouette is its box: an upright rectangle, nothing sticking out.
   * Only then are its corners and sides the ones a reader names by compass.
   */
  readonly rectangular: boolean;
  /** The crease pattern by Fold's edge id: what a step's diff is counted from. */
  readonly creases: ReadonlyMap<number, FoldSceneCrease>;
  /** The folded form as the viewer sees it: its visible edges. Null for nothing drawable. */
  readonly form: SheetThumbnail | null;
  /** The crease pattern, front-relative: the paper's edge, M, V and flat creases. */
  readonly pattern: SheetThumbnail | null;
}

/** Relative to the sheet's longer side, 1: how close two points are to be one. */
const POINT_TOLERANCE = 1e-5;

/** How close two areas are, relatively, to be one. */
const AREA_TOLERANCE = 1e-4;

/** Samples along a face's edge to find the parts of it the viewer sees. */
const EDGE_SAMPLES = 12;

/** How far into a face a sample is nudged to ask which face covers it, in sheet units. */
const NUDGE = 1e-4;

/** The cells per side of the grid that finds the subfaces under a point. */
const GRID_CELLS = 24;

// ---------------------------------------------------------------------------
// Isometries and polygons

export function applyIsometry([a, b, c, d, e, f]: FoldIsometry, [x, y]: readonly [number, number]): FoldModelPoint {
  return [a * x + b * y + c, d * x + e * y + f];
}

/** The inverse map; null for one that collapses the plane, which no isometry does. */
export function invertIsometry([a, b, c, d, e, f]: FoldIsometry): FoldIsometry | null {
  const det = a * e - b * d;
  if (!(Math.abs(det) > 1e-12)) return null;
  const [ia, ib, id, ie] = [e / det, -b / det, -d / det, a / det];
  return [ia, ib, -(ia * c + ib * f), id, ie, -(id * c + ie * f)];
}

type Ring = readonly (readonly [number, number])[];

/** Twice the signed area: positive for a counter-clockwise ring. */
function signedArea2(ring: Ring): number {
  let sum = 0;
  for (let k = 0; k < ring.length; k += 1) {
    const [x0, y0] = ring[k]!;
    const [x1, y1] = ring[(k + 1) % ring.length]!;
    sum += x0 * y1 - x1 * y0;
  }
  return sum;
}

function distanceToSegment([px, py]: readonly [number, number], [ax, ay]: readonly [number, number], [bx, by]: readonly [number, number]): number {
  const [dx, dy] = [bx - ax, by - ay];
  const length2 = dx * dx + dy * dy;
  const t = length2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Whether `p` is in the ring or within `tolerance` of its boundary. */
export function ringContains(ring: Ring, p: readonly [number, number], tolerance = POINT_TOLERANCE): boolean {
  let inside = false;
  for (let k = 0, j = ring.length - 1; k < ring.length; j = k, k += 1) {
    const a = ring[j]!;
    const b = ring[k]!;
    if (distanceToSegment(p, a, b) <= tolerance) return true;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

const pointOf = ({ x, y }: Point): [number, number] => [x, y];

// ---------------------------------------------------------------------------
// The frame

/** Where a sheet point is on screen: through the face it lies in. Null for a point on no face. */
export function sheetToScene(frame: FoldStateFrame, point: SheetPoint): FoldModelPoint | null {
  const face = frame.faces.find((each) => ringContains(each.sheet, point));
  return face ? applyIsometry(face.toScene, point) : null;
}

/** A scene point in the model frame, where a step's stored line lives. */
export function sceneToModel(frame: FoldStateFrame, point: FoldModelPoint): FoldModelPoint | null {
  const inverse = invertIsometry(frame.view);
  return inverse ? applyIsometry(inverse, point) : null;
}

export function foldStateFrame(scene: FoldScene): FoldStateFrame {
  const faces = scene.faces.map(
    (face, k): FoldFrameFace => ({
      sheet: face.points.map((index) => {
        const point = scene.sheet_points[index];
        return point ? ([point.x, point.y] as const) : ([Number.NaN, Number.NaN] as const);
      }),
      toScene: scene.face_transforms[k] ?? scene.view_transform,
    })
  );
  const rings: Ring[] = (scene.subfaces.length > 0 ? scene.subfaces.map((cell) => cell.polygon) : scene.faces.map((face) => face.outline)).map(
    (ring) => ring.map(pointOf)
  );
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings) {
    for (const [x, y] of ring) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const bounds: FoldFrameBounds = Number.isFinite(minX) ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  // Subfaces tile the silhouette without overlap, so their areas add up to it.
  const area = scene.subfaces.reduce((sum, cell) => sum + Math.abs(signedArea2(cell.polygon.map(pointOf))) / 2, 0);
  const boxArea = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
  return {
    faces,
    view: scene.view_transform,
    bounds,
    area,
    rectangular: boxArea > 0 && Math.abs(area - boxArea) <= AREA_TOLERANCE * boxArea,
    creases: new Map(scene.creases.map((crease) => [crease.id, crease])),
    form: storedThumbnail(visibleEdges(scene)),
    pattern: storedThumbnail(patternStrokes(scene)),
  };
}

// ---------------------------------------------------------------------------
// Thumbnails

/** A stroke from y-up coordinates to the thumbnail's y-down. */
function stroke(from: readonly [number, number], to: readonly [number, number], role: SheetStrokeRole): SheetStroke {
  return { x1: from[0], y1: -from[1], x2: to[0], y2: -to[1], role };
}

/** Fitted, snapped to a tenth of its 100-unit box and held to what a file takes back, as a captured step's is. */
function storedThumbnail(strokes: readonly SheetStroke[]): SheetThumbnail | null {
  const fitted = fitSheetThumbnail(strokes);
  return fitted ? storedSheetThumbnail(fitted) : null;
}

/**
 * The crease pattern in sheet coordinates, by its letters as stored: from the
 * front. A flat crease and a crease mark — a partial precrease — are aux
 * lines, as the crease-pattern pane draws them (`creasePatternPaneLines`).
 */
function patternStrokes(scene: FoldScene): SheetStroke[] {
  const creases = scene.creases.map((crease) => {
    const role: SheetStrokeRole =
      crease.kind === 'border' ? 'edge' : crease.kind === 'flat' ? 'aux' : crease.letter === 'mountain' ? 'mountain' : 'valley';
    return stroke(pointOf(crease.from), pointOf(crease.to), role);
  });
  const marks = (scene.crease_marks ?? []).map((mark) => stroke(pointOf(mark.from), pointOf(mark.to), 'aux'));
  return [...creases, ...marks];
}

/** The subfaces, bucketed on a grid over the silhouette's box, to find the ones under a point quickly. */
function subfaceGrid(scene: FoldScene) {
  const cells = scene.subfaces.map((cell) => ({ ring: cell.polygon.map(pointOf), top: cell.faces_top_to_bottom[0] }));
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { ring } of cells) {
    for (const [x, y] of ring) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const width = Math.max(maxX - minX, 1e-9);
  const height = Math.max(maxY - minY, 1e-9);
  const column = (x: number) => Math.min(GRID_CELLS - 1, Math.max(0, Math.floor(((x - minX) / width) * GRID_CELLS)));
  const row = (y: number) => Math.min(GRID_CELLS - 1, Math.max(0, Math.floor(((y - minY) / height) * GRID_CELLS)));
  const buckets: number[][] = Array.from({ length: GRID_CELLS * GRID_CELLS }, () => []);
  cells.forEach(({ ring }, index) => {
    const xs = ring.map(([x]) => x);
    const ys = ring.map(([, y]) => y);
    for (let c = column(Math.min(...xs)); c <= column(Math.max(...xs)); c += 1) {
      for (let r = row(Math.min(...ys)); r <= row(Math.max(...ys)); r += 1) buckets[r * GRID_CELLS + c]!.push(index);
    }
  });
  /** The face on top at `p`, or undefined off the paper. */
  return (p: readonly [number, number]): number | undefined => {
    if (p[0] < minX || p[0] > maxX || p[1] < minY || p[1] > maxY) return undefined;
    for (const index of buckets[row(p[1]) * GRID_CELLS + column(p[0])]!) {
      const cell = cells[index]!;
      if (ringContains(cell.ring, p, 0)) return cell.top;
    }
    return undefined;
  };
}

/**
 * The edges the viewer sees: each face's outline wherever that face is the
 * one on top just inside it. Sampled along each edge, so an edge half hidden
 * under a flap is drawn as far as it shows. A raw edge or a bend is the
 * paper's outline; a flat crease (a precrease) is drawn in the aux role.
 */
function visibleEdges(scene: FoldScene): SheetStroke[] {
  const topAt = subfaceGrid(scene);
  const strokes: SheetStroke[] = [];
  const seen = new Set<string>();
  const keep = (from: readonly [number, number], to: readonly [number, number], role: SheetStrokeRole) => {
    const key = [from, to]
      .map(([x, y]) => `${Math.round(x * 1e5)},${Math.round(y * 1e5)}`)
      .sort()
      .join(' ');
    if (seen.has(key)) return;
    seen.add(key);
    strokes.push(stroke(from, to, role));
  };
  scene.faces.forEach((face, faceIndex) => {
    // Counter-clockwise in the scene frame, so the face is on each edge's left.
    const orientation = Math.sign(signedArea2(face.outline.map(pointOf))) || 1;
    for (const edge of face.edges) {
      const from = pointOf(edge.from);
      const to = pointOf(edge.to);
      const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
      const length = Math.hypot(dx, dy);
      if (!(length > 0)) continue;
      const inward: [number, number] = [(-dy / length) * NUDGE * orientation, (dx / length) * NUDGE * orientation];
      const role: SheetStrokeRole = edge.kind === 'flat' ? 'aux' : 'edge';
      const at = (t: number): [number, number] => [from[0] + dx * t, from[1] + dy * t];
      let runStart: number | null = null;
      for (let k = 0; k <= EDGE_SAMPLES; k += 1) {
        const t = (k + 0.5) / EDGE_SAMPLES;
        const visible =
          k < EDGE_SAMPLES && topAt([at(t)[0] + inward[0], at(t)[1] + inward[1]]) === faceIndex;
        if (visible && runStart === null) runStart = k;
        if (!visible && runStart !== null) {
          keep(at(runStart === 0 ? 0 : runStart / EDGE_SAMPLES), at(k === EDGE_SAMPLES ? 1 : k / EDGE_SAMPLES), role);
          runStart = null;
        }
      }
    }
  });
  return strokes;
}
