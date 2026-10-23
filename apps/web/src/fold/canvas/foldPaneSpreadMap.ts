/**
 * Where the folded pane draws the paper while its layers are spread
 * (`foldedPaneScene` with the step's spread): every point of a face moved by
 * that face's field, as the painter moves it (`foldedFlatPaperScene`'s
 * placement) — so the folded pane's picks, its hover and its letters can be
 * put where the reader sees the paper, not where the engine's unspread scene
 * has it.
 *
 * Under an affine spread only the face held still stays put; every other face
 * moves, a face on top of its stack among them. Under a depth spread a face
 * moves by the mean level of the faces round each of its corners, so a face
 * on top moves too where it meets a deeper one. Points that coincide on the
 * folded paper — a corner of one layer on a crease of another — part.
 *
 * Coordinates are the scene frame of the state, as the pick index's are
 * (sheet units, y up, before the pane's display offset): a move the painter
 * makes in scene px is turned back into it.
 *
 * Pure: no React, no store, no engine.
 */
import { foldedPaintOrder, foldedSceneEpsilon } from '../../cp-workspace/folded/foldedFlatScene';
import {
  affineSpread,
  layerSpread,
  meanValueWeights,
  type LayerSpreadOptions,
} from '../../cp-workspace/folded/foldedLayerSpread';
import type { Point } from '../../lib/geometry';
import type { SheetPoint } from '../document/foldSequenceDocument';
import type { FoldScene } from '../engine/foldEngineWire';
import {
  applyIsometry,
  boundsOf,
  FOLD_USER_PER_UNIT,
  insideConvex,
  invertIsometry,
  toPair,
  toPoint,
  type Bounds,
} from './foldCanvasGeometry';
import { foldFrameSpread } from './foldPaneScenes';

/** A point of the pane as drawn, and what lies there on the paper. */
export interface FoldDrawnPoint {
  /** The face drawn on top there. */
  face: number;
  /** Where that face's point drawn there lies in the state's scene frame, unspread. */
  scene: Point;
  /** The sheet point it is. */
  sheet: SheetPoint;
}

export interface FoldPaneSpreadMap {
  /** Where the pane draws a point of face `face`, given in the scene frame. */
  onFace(face: number, point: Point): Point;
  /** Where the pane draws a sheet point, on a face that holds it (one on a crease is drawn alike either side); null off the sheet. */
  sheet(point: SheetPoint): Point | null;
  /**
   * Where the pane draws a segment with these sheet ends, its ends in the
   * order of `scene`, the segment where the unspread scene has it; an end off
   * the sheet stays where `scene` has it.
   */
  segment(sheet: readonly [SheetPoint, SheetPoint], scene: readonly [Point, Point]): [Point, Point];
  /** The paper drawn on top at a point of the pane; null off the paper. */
  under(drawn: Point): FoldDrawnPoint | null;
}

const SHEET_EPSILON = 1e-7;

interface FaceRings {
  face: number;
  /** In the scene frame, unspread. */
  outline: Point[];
  /** As drawn. */
  drawn: Point[];
  box: Bounds;
}

/**
 * The folded pane's map of `scene` under `spread` — the step's, as
 * `foldedPaneScene` takes it — or null for none, when the pane draws the
 * scene where it is.
 */
export function foldPaneSpreadMap(scene: FoldScene, spread: LayerSpreadOptions | null): FoldPaneSpreadMap | null {
  const here = foldFrameSpread(spread);
  if (!here) return null;
  const epsilon = foldedSceneEpsilon(scene);
  let onFace: (face: number, point: Point) => Point;
  if (here.kind === 'affine') {
    const { offset } = affineSpread(scene, here, { epsilon });
    onFace = (face, point) => {
      const move = offset(face, point);
      return { x: point.x + move.x, y: point.y + move.y };
    };
  } else {
    // A depth step is on the screen, in px with y down; the scene frame is in sheet units with y up.
    const { offset } = layerSpread(scene, foldedPaintOrder(scene), here, { scale: FOLD_USER_PER_UNIT, epsilon });
    onFace = (face, point) => {
      const [dx, dy] = offset(face, point);
      return { x: point.x + dx / FOLD_USER_PER_UNIT, y: point.y - dy / FOLD_USER_PER_UNIT };
    };
  }

  // Each face's sheet outline, for the sheet points it holds.
  const onSheet = scene.faces.map(({ points }) => {
    const ring = points.map((vertex) => scene.sheet_points[vertex]).filter((p): p is Point => p !== undefined);
    return { ring, box: boundsOf(ring) };
  });
  const sheet = (point: SheetPoint): Point | null => {
    const p = toPoint(point);
    for (const [face, { ring, box }] of onSheet.entries()) {
      if (!box || p.x < box.minX - SHEET_EPSILON || p.x > box.maxX + SHEET_EPSILON) continue;
      if (p.y < box.minY - SHEET_EPSILON || p.y > box.maxY + SHEET_EPSILON) continue;
      if (!insideConvex(ring, p, SHEET_EPSILON)) continue;
      const transform = scene.face_transforms[face];
      if (transform) return onFace(face, applyIsometry(transform, p));
    }
    return null;
  };

  // The faces as drawn, the one drawn last first: the painter's order decides what is on top.
  let rings: FaceRings[] | null = null;
  const drawnRings = (): FaceRings[] => {
    rings ??= foldedPaintOrder(scene)
      .slice()
      .reverse()
      .flatMap((face) => {
        const outline = scene.faces[face]?.outline.map((p) => ({ x: p.x, y: p.y }));
        if (!outline || outline.length < 3) return [];
        const drawn = outline.map((p) => onFace(face, p));
        const box = boundsOf(drawn);
        return box ? [{ face, outline, drawn, box }] : [];
      });
    return rings;
  };

  return {
    onFace,
    sheet,
    segment: (ends, [a, b]) => {
      const p = sheet(ends[0]) ?? a;
      const q = sheet(ends[1]) ?? b;
      const kept = Math.hypot(p.x - a.x, p.y - a.y) + Math.hypot(q.x - b.x, q.y - b.y);
      const swapped = Math.hypot(q.x - a.x, q.y - a.y) + Math.hypot(p.x - b.x, p.y - b.y);
      return kept <= swapped ? [p, q] : [q, p];
    },
    under: (point) => {
      for (const { face, outline, drawn, box } of drawnRings()) {
        if (point.x < box.minX || point.x > box.maxX || point.y < box.minY || point.y > box.maxY) continue;
        if (!insideConvex(drawn, point, SHEET_EPSILON)) continue;
        // The face's own map, undone: exact for an affine spread, which is affine on a face.
        const weights = meanValueWeights(drawn, point, epsilon);
        if (!weights) continue;
        const at = weights.reduce(
          (sum, weight, k) => ({ x: sum.x + weight * outline[k]!.x, y: sum.y + weight * outline[k]!.y }),
          { x: 0, y: 0 }
        );
        const transform = scene.face_transforms[face];
        if (!transform) continue;
        return { face, scene: at, sheet: toPair(applyIsometry(invertIsometry(transform), at)) };
      }
      return null;
    },
  };
}
