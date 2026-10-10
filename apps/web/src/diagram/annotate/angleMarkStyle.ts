import { DIAGRAM_ANGLE_MARK_INK } from '../../cp-workspace/references/diagram/diagramInk';
import type { KnownDiagramAnnotation } from '../document/diagramDocument';
import { ANNOTATION_INK_MM } from './canvasInk';

export const ANGLE_RADIUS_MM = { min: 0.5, max: 50, step: 0.5, default: DIAGRAM_ANGLE_MARK_INK.radius * ANNOTATION_INK_MM } as const;
export function angleRadiusMm(annotation: Pick<KnownDiagramAnnotation, 'radiusMm'>): number {
  return annotation.radiusMm ?? ANGLE_RADIUS_MM.default;
}
export function angleRadiusWithin(value: number): number {
  return Number.isFinite(value) ? Math.max(ANGLE_RADIUS_MM.min, Math.min(ANGLE_RADIUS_MM.max, value)) : ANGLE_RADIUS_MM.default;
}
export function angleRadiusInk(annotation: Pick<KnownDiagramAnnotation, 'radiusMm'>): number {
  return angleRadiusMm(annotation) / ANNOTATION_INK_MM;
}
