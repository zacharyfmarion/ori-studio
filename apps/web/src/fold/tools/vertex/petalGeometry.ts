/**
 * A petal fold's flap on the panes, from the engine's description of it
 * (`FoldPetalAnalysis`, the compound question's answer for a petal op): the
 * part that lifts — the kite below the hinge, from the hinge's two ends to
 * the corner where the kite creases meet, on the flap's top layer — on the
 * folded pane and on the sheet. The canvas lights it under the pointer before
 * the flap is picked, and while it is previewed (`useFoldPetalMarks`).
 *
 * Pure: no React, no store, no engine.
 */
import type { Point } from '../../../lib/geometry';
import type { FoldModelLine } from '../../document/foldSequenceDocument';
import type { FoldPetalAnalysis } from '../../engine/foldEngineSquashWire';
import { invertIsometry, lineThrough, polygonArea, toPoint, transformLine } from '../../canvas/foldCanvasGeometry';
import type { FoldPickIndex } from '../../canvas/foldPicking';
import { clipToWedges } from './fanGeometry';

/** The kite that lifts, in the scene frame: the hinge's two ends and the corner below them. */
export function petalKiteScene(index: FoldPickIndex, analysis: FoldPetalAnalysis): Point[] {
  const [left, right] = analysis.ends;
  return [left, right, analysis.corner].map((p) => index.toScene(toPoint(p)));
}

/** The half-planes a convex polygon keeps, each a line whose positive side is inside (`clipConvex`'s `1`). */
function insideOf(polygon: readonly Point[]): FoldModelLine[] {
  // `lineThrough`'s normal points left of its direction: inside a counter-clockwise ring.
  let twice = 0;
  polygon.forEach((a, k) => {
    const b = polygon[(k + 1) % polygon.length]!;
    twice += a.x * b.y - b.x * a.y;
  });
  const flip = twice < 0;
  return polygon.flatMap((a, k) => {
    const line = lineThrough(a, polygon[(k + 1) % polygon.length]!);
    if (!line) return [];
    return [flip ? { n: [-line.n[0], -line.n[1]] as [number, number], d: -line.d } : line];
  });
}

/** The scene's face indices of the faces an analysis names by id. */
function sceneFaces(index: FoldPickIndex, ids: readonly number[]): Set<number> {
  const wanted = new Set(ids);
  const faces = new Set<number>();
  index.scene.lineage.forEach((face, k) => {
    if (wanted.has(face.id)) faces.add(k);
  });
  return faces;
}

/** Pieces of no area, which a fill would not show. */
const SLIVER = 1e-12;

/**
 * The kite that lifts on the folded pane: each cell of the folded form where
 * the flap's top layer lies, cut to the kite.
 */
export function petalRegionOnFolded(index: FoldPickIndex, analysis: FoldPetalAnalysis): Point[][] {
  const kite = petalKiteScene(index, analysis);
  if (polygonArea(kite) <= SLIVER) return [];
  return facesRegionOnFolded(index, analysis.top, insideOf(kite));
}

/** The kite that lifts on the sheet: each face of the flap's top layer, cut to the kite where that face lies. */
export function petalRegionOnSheet(index: FoldPickIndex, analysis: FoldPetalAnalysis): Point[][] {
  const kite = petalKiteScene(index, analysis);
  if (polygonArea(kite) <= SLIVER) return [];
  return facesRegionOnSheet(index, analysis.top, insideOf(kite));
}

/**
 * Where faces an engine answer names by id lie on the folded pane: each cell
 * of the folded form they are in, cut to the half-planes `lines` keep (scene
 * frame, each line's positive side) — a petal's kite, a squash's side of its
 * drawn hinge, or none.
 */
export function facesRegionOnFolded(index: FoldPickIndex, ids: readonly number[], lines: readonly FoldModelLine[]): Point[][] {
  const faces = sceneFaces(index, ids);
  return index.subfaces
    .filter((cell) => cell.stack.some((face) => faces.has(face)))
    .flatMap((cell) => clipToWedges(cell.polygon, [lines]))
    .filter((piece) => polygonArea(piece) > SLIVER);
}

/** The same faces on the sheet: each one's outline, cut to the half-planes `lines` keep where that face lies. */
export function facesRegionOnSheet(index: FoldPickIndex, ids: readonly number[], lines: readonly FoldModelLine[]): Point[][] {
  const { scene } = index;
  const pieces: Point[][] = [];
  for (const f of sceneFaces(index, ids)) {
    const face = scene.faces[f];
    const transform = scene.face_transforms[f];
    const outline = face?.points.map((vertex) => scene.sheet_points[vertex]);
    if (!transform || !outline || outline.some((corner) => corner === undefined)) continue;
    const back = invertIsometry(transform);
    const local = lines.map((line) => transformLine(back, line));
    pieces.push(...clipToWedges(outline as Point[], [local]).filter((piece) => polygonArea(piece) > SLIVER));
  }
  return pieces;
}

/** Two answers naming one flap: the same hinge ends and corner, to a hair. */
export function sameKite(a: FoldPetalAnalysis, b: FoldPetalAnalysis): boolean {
  const near = (p: readonly [number, number], q: readonly [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9;
  return near(a.ends[0], b.ends[0]) && near(a.ends[1], b.ends[1]) && near(a.corner, b.corner);
}
