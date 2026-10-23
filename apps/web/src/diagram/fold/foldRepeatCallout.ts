/** Repeat's instruction points to affected material in the starting pose. */
import type { TFunction } from 'i18next';
import {
  alongLine, applyIsometry, chordOfConvex, insideConvex, lineThrough,
  pointOnLine, polygonArea, polygonCentroid, toPair,
} from '../../fold/canvas/foldCanvasGeometry';
import type { FoldModelLine } from '../../fold/document/foldSequenceDocument';
import type { FoldScene } from '../../fold/engine/foldEngineWire';
import { faceAt, modelMap, overlap, reflection, sameImages, sheetRing } from '../../fold/repeat/repeatGeometry';
import type { Point } from '../../lib/geometry';
import { CALLOUT_GAP, calloutHalfBox, createAnnotation, type PictureFrame, type PicturePoint } from '../annotate/annotationModel';
import type { DiagramIdFactory, KnownDiagramAnnotation } from '../document/diagramDocument';

type RepeatLocation = 'left' | 'right' | 'top' | 'bottom' | 'behind' | 'here';
export interface FoldRepeatCallout {
  targets: { at: Point; source: Point; weight: number; front: boolean; back: boolean }[];
  words: Record<RepeatLocation, string>;
}

function repeatWords(t: TFunction): FoldRepeatCallout['words'] {
  return {
    left: t('panels:diagram.fold.repeatLeft', 'Repeat on the left'),
    right: t('panels:diagram.fold.repeatRight', 'Repeat on the right'),
    top: t('panels:diagram.fold.repeatTop', 'Repeat at the top'),
    bottom: t('panels:diagram.fold.repeatBottom', 'Repeat at the bottom'),
    behind: t('panels:diagram.annotations.repeatBehind', 'Repeat behind'),
    here: t('panels:diagram.fold.repeatHere', 'Repeat here'),
  };
}

/**
 * Intersect material polygons, not face IDs: folds split faces. Ignore view
 * changes and project the affected pieces back onto the parent. If the range
 * only precreases (or folds and unfolds), use its new physical crease spans.
 * The reflected source points distinguish right/left from top/bottom even
 * when the target is in a corner of the model.
 */
export function foldRepeatCallout(
  before: FoldScene, after: FoldScene, parentStep: number, axis: FoldModelLine, t: TFunction,
): FoldRepeatCallout {
  const targets: FoldRepeatCallout['targets'] = [];
  const mirror = reflection(axis);
  const rings = before.faces.map((_, i) => sheetRing(before, i));
  const add = (sheet: Point, face: number, weight: number) => {
    const at = applyIsometry(before.face_transforms[face]!, sheet);
    const reflected = applyIsometry(mirror, sheet);
    const sourceFace = faceAt(before, toPair(reflected));
    const source = applyIsometry(before.face_transforms[sourceFace]!, reflected);
    const cells = before.subfaces.filter((cell) => insideConvex(cell.polygon, at, 1e-8));
    targets.push({
      at, source, weight,
      front: cells.some((cell) => cell.faces_top_to_bottom[0] === face),
      back: cells.some((cell) => cell.faces_top_to_bottom.at(-1) === face),
    });
  };
  for (let i = 0; i < after.faces.length; i++) {
    const ring = sheetRing(after, i);
    for (let j = 0; j < rings.length; j++) {
      const part = overlap(ring, rings[j]!);
      const area = Math.abs(polygonArea(part));
      if (area > 1e-12 && !sameImages(modelMap(after, i), modelMap(before, j), part)) {
        add(polygonCentroid(part), j, area);
      }
    }
  }
  if (targets.length === 0) {
    const creases = [...after.creases, ...(after.crease_marks ?? [])].filter((crease) => crease.made_at > parentStep);
    for (const crease of creases) {
      const line = lineThrough(crease.from, crease.to);
      if (!line) continue;
      const ends = [alongLine(line, crease.from), alongLine(line, crease.to)].sort((a, b) => a - b);
      for (let j = 0; j < rings.length; j++) {
        const chord = chordOfConvex(rings[j]!, line);
        if (!chord) continue;
        const lo = Math.max(ends[0]!, chord[0]), hi = Math.min(ends[1]!, chord[1]);
        if (hi - lo > 1e-8) add(pointOnLine(line, (lo + hi) / 2), j, hi - lo);
      }
    }
  }
  return { targets, words: repeatWords(t) };
}

/** Editable native callout; its box stays outside the paper, on the target's side. */
export function repeatCalloutMark(
  repeat: FoldRepeatCallout, frame: PictureFrame, toPicture: (point: Point) => PicturePoint,
  side: 'front' | 'back', newId: DiagramIdFactory,
): KnownDiagramAnnotation | null {
  if (!repeat.targets.length) return null;
  const points = repeat.targets.map((target) => ({ ...target, at: toPicture(target.at), source: toPicture(target.source) }));
  const total = points.reduce((sum, point) => sum + point.weight, 0);
  const average = (field: 'at' | 'source'): PicturePoint => [0, 1].map((i) =>
    points.reduce((sum, point) => sum + point[field][i]! * point.weight, 0) / total,
  ) as PicturePoint;
  const centre = average('at'), source = average('source');
  const dx = centre[0] - source[0], dy = centre[1] - source[1];
  const visible = points.filter((point) => point[side]);
  const location: RepeatLocation = Math.hypot(dx, dy) < 0.05
    ? visible.length ? 'here' : 'behind'
    : Math.abs(dx) >= Math.abs(dy) ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'bottom' : 'top';
  // A weighted centre can fall in a gap between flaps; attach to real paper.
  const candidates = visible.length ? visible : points;
  const at = candidates.reduce((best, point) =>
    Math.hypot(point.at[0] - centre[0], point.at[1] - centre[1]) < Math.hypot(best.at[0] - centre[0], best.at[1] - centre[1]) ? point : best,
  ).at;
  const text = repeat.words[location];
  const { halfWidth, halfHeight } = calloutHalfBox(text);
  const above = location === 'top' || (location !== 'bottom' && at[1] <= frame.height / 2);
  const x = location === 'left' ? halfWidth : location === 'right' ? frame.width - halfWidth : at[0];
  const box: PicturePoint = [
    Math.max(halfWidth, Math.min(frame.width - halfWidth, x)),
    above ? -CALLOUT_GAP - halfHeight : frame.height + CALLOUT_GAP + halfHeight,
  ];
  return { ...createAnnotation('callout', at, box, frame, newId, text), imported: 'untouched' };
}
