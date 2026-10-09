/**
 * Snapping as the Annotate canvas does it (implementation-plans/
 * diagram-annotate.md, 3; decisions 9 and 10): which marks snap where they
 * are put, how far they reach for a point, and where a press, a drag or a
 * release lands. What there is to land on is `pictureSnap.ts`'s.
 *
 * Pure: no DOM, no store.
 */
import type { DiagramAnnotationSnap } from '../../analytics/events';
import { CP_MODEL_TO_CSS } from '../../cp-workspace/snapRadius';
import type {
  DiagramAnnotation,
  DiagramAnnotationKind,
  DiagramAsset,
  DiagramStep,
  DiagramStyle,
  KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { isHungText, type PicturePoint } from './annotationModel';
import { pictureSnapTarget, type SnapTarget } from './pictureSnap';

/**
 * Edit's snap setting (decision 10), in Oriedita model units, as CSS px on
 * screen: what it reaches on the crease-pattern canvas at 100% (10 → 14.7,
 * a coarse pointer's 15 → 22). The Annotate canvas reaches that far at every
 * zoom, as it does for its hit reach.
 */
export function snapRadiusCss(setting: number): number {
  return setting * CP_MODEL_TO_CSS;
}

/**
 * The snap radius in picture units, with `screenPerUnit` screen px to a
 * picture unit at the zoom the press is made at; none for a picture not laid
 * out.
 */
export function snapRadiusUnits(setting: number, screenPerUnit: number): number {
  return screenPerUnit > 0 && Number.isFinite(screenPerUnit) ? snapRadiusCss(setting) / screenPerUnit : 0;
}

/**
 * Whether a mark of `kind` snaps where it is put (decision 9): a circle, a
 * star (Revision 3, R3-24 A), a right angle's corner, each end of a line,
 * the point a callout marks, and each end of the line equal divisions
 * measure (Revision 2).
 * An arrow is drawn where it is drawn (Zach, 2026-10-05): its ends are rarely
 * on a corner — a fold arrow starts on the flap and lands on the paper past
 * the crease — so a snap there would only pull it off. A sign or a label is
 * put beside what it names, never on it; a close-up's area or an enlarge
 * area round what it shows; an eye where the viewer stands, an oval or a
 * rectangle round an area, judged by eye (Revision 3, R3-24 A). A switch, so
 * a new kind has to say.
 */
export function snapsWhenPlaced(kind: DiagramAnnotationKind): boolean {
  switch (kind) {
    case 'valley-line':
    case 'mountain-line':
    case 'hidden-line':
    case 'solid-line':
    case 'circle':
    case 'star':
    case 'right-angle':
    case 'callout':
    case 'angle-mark':
    case 'divisions':
      return true;
    case 'valley-arrow':
    case 'mountain-arrow':
    case 'fold-unfold-arrow':
    case 'pleat-arrow':
    case 'push-arrow':
    case 'white-arrow':
    case 'turn-over':
    case 'rotate':
    case 'label':
    case 'close-up':
    case 'zoom':
    case 'eye':
    case 'oval':
    case 'rectangle':
      return false;
  }
}

/**
 * Whether one end of a mark of `kind` snaps where it is put: either end of
 * one that snaps ({@link snapsWhenPlaced}), but never a callout's box (`to`),
 * which sits where its words are read rather than on a point.
 */
export function snapsEnd(kind: DiagramAnnotationKind, end: 'from' | 'to'): boolean {
  return snapsWhenPlaced(kind) && (end === 'from' || kind !== 'callout');
}

/**
 * Whether an end of `annotation`, taken hold of and moved, snaps where it
 * lands: as {@link snapsEnd} says for its kind — and hung text's anchor (17b),
 * which is on what the text names, as a callout's point is, though its words,
 * as every label's, are put beside it and never snap.
 */
export function snapsAnchor(annotation: Pick<KnownDiagramAnnotation, 'kind' | 'offsetPt'>, end: 'from' | 'to'): boolean {
  return snapsEnd(annotation.kind, end) || (end === 'from' && isHungText(annotation));
}

/** What the canvas snaps against now: the step, its annotations as the store has them, the switch and the reach. */
export interface SnapContext {
  step: DiagramStep;
  assets: Readonly<Record<string, DiagramAsset>>;
  annotations: readonly DiagramAnnotation[];
  /** The Step pane's Snap switch: off for a finger that wants to put a mark down anywhere. */
  enabled: boolean;
  /** In picture units, at the zoom the press is made at. */
  radius: number;
  /** The diagram's style: an aux line it leaves out of the picture is no target. */
  style: DiagramStyle;
}

/** Where a point lands, and what it snapped to, if anything. */
export interface PlacedPoint {
  at: PicturePoint;
  target: SnapTarget | null;
}

/**
 * Where a point put down at `point` lands: on the nearest target within the
 * radius, or where it was put — with the switch off, with ⌘ (Ctrl) held
 * (`free`), or with nothing that near. `ignore` is the annotation in hand,
 * which would find itself.
 */
export function placePoint(
  context: SnapContext,
  point: PicturePoint,
  { free, ignore }: { free: boolean; ignore?: string }
): PlacedPoint {
  if (!context.enabled || free) return { at: point, target: null };
  const target = pictureSnapTarget(context.step, context.assets, point, context.radius, {
    annotations: context.annotations,
    ignore,
    style: context.style,
  });
  return target ? { at: target.at, target } : { at: point, target: null };
}

/**
 * What the annotation-added event says of how a new mark was put down: it
 * snapped (either end), it was put down freely with ⌘ held, the switch was
 * off, nothing was near — or it is a kind that never snaps.
 */
export function snapOutcome(
  kind: DiagramAnnotationKind,
  { enabled, free, snapped }: { enabled: boolean; free: boolean; snapped: boolean }
): DiagramAnnotationSnap {
  if (!snapsWhenPlaced(kind)) return 'none';
  if (snapped) return 'snapped';
  if (!enabled) return 'off';
  return free ? 'free' : 'nothing_near';
}
